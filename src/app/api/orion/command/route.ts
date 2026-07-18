/**
 * /api/orion/command/route.ts — Unified Orion command endpoint.
 *
 * Accepts { text, sessionId? }.
 *   1. Parses the intent via @/lib/orion-intent#parseIntent (fast, sync, <1ms).
 *   2. Branches on intent — performs the real action (DB write, agent spawn,
 *      skill exec, fleet/revenue/task summary, theme action, …) or falls back
 *      to the LLM for `chat`.
 *   3. Always returns { intent, response, latencyMs, ...payload }.
 *
 * The client (OrionShell) is responsible for:
 *   - Actually switching tabs (navigate) via useTabNav()
 *   - Actually toggling the theme (set-theme) via document.documentElement
 *   - Actually opening the help panel (help) — but we still return the help text
 *
 * Optional imports (model-sync) are wrapped in try/catch so the endpoint
 * works even if those libs are mid-flight in another agent's branch.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { chat } from '@/lib/llm';
import { parseIntent, type ParsedIntent } from '@/lib/orion-intent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CommandRequest {
  text?: string;
  sessionId?: string;
}

interface CommandResponse {
  intent: ParsedIntent['intent'];
  response: string;
  latencyMs: number;
  confidence?: number;
  sessionId?: string;
  tab?: string;
  action?: ParsedIntent['action'];
  params?: ParsedIntent['params'];
  suggestions?: string[];
  graph?: { label: string; value: number }[];

  // intent-specific payloads
  task?: unknown;
  agent?: unknown;
  message?: unknown;
  skillResult?: unknown;
  summary?: unknown;
  report?: unknown;
  error?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse<CommandResponse>> {
  const t0 = Date.now();
  const body = (await req.json().catch(() => ({}))) as CommandRequest;
  const text = (body.text || '').trim();
  const sessionId = body.sessionId || `orion-${Date.now()}`;

  if (!text) {
    return NextResponse.json(
      {
        intent: 'chat',
        response: 'I did not catch a command.',
        latencyMs: Date.now() - t0,
        sessionId,
        error: 'empty',
      },
      { status: 400 },
    );
  }

  const parsed = parseIntent(text);
  let out: CommandResponse;

  try {
    switch (parsed.intent) {
      case 'chat':
        out = await handleChat(text, parsed, sessionId);
        break;
      case 'navigate':
        out = await handleNavigate(parsed, sessionId);
        break;
      case 'create-task':
        out = await handleCreateTask(text, parsed, sessionId);
        break;
      case 'create-agent':
        out = await handleCreateAgent(text, parsed, sessionId);
        break;
      case 'run-skill':
        out = await handleRunSkill(parsed, sessionId);
        break;
      case 'send-comms':
        out = await handleSendComms(parsed, sessionId);
        break;
      case 'health-check':
        out = await handleHealthCheck(sessionId);
        break;
      case 'sync-models':
        out = await handleSyncModels(sessionId);
        break;
      case 'query-fleet':
        out = await handleQueryFleet(sessionId);
        break;
      case 'query-revenue':
        out = await handleQueryRevenue(sessionId);
        break;
      case 'query-tasks':
        out = await handleQueryTasks(sessionId);
        break;
      case 'set-theme':
        out = await handleSetTheme(parsed, sessionId);
        break;
      case 'search':
        out = await handleSearch(parsed, sessionId);
        break;
      case 'help':
        out = await handleHelp(sessionId);
        break;
      default:
        out = await handleChat(text, parsed, sessionId);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    out = {
      intent: parsed.intent,
      response: `That action failed: ${msg}. Falling back to a chat reply.`,
      latencyMs: Date.now() - t0,
      sessionId,
      error: msg,
      suggestions: ['Help', 'Show fleet status'],
    };
  }

  out.latencyMs = Date.now() - t0;
  return NextResponse.json(out);
}

/* ============================================================
   Intent handlers
   ============================================================ */

async function handleChat(text: string, parsed: ParsedIntent, sessionId: string): Promise<CommandResponse> {
  const { content, latencyMs } = await chat(text);
  return {
    intent: 'chat',
    response: content || '(no response)',
    latencyMs,
    sessionId,
    confidence: parsed.confidence,
    suggestions: ['Show fleet status', 'Create a task', 'Run a health check'],
  };
}

async function handleNavigate(parsed: ParsedIntent, sessionId: string): Promise<CommandResponse> {
  const tab = parsed.tab || 'overview';
  return {
    intent: 'navigate',
    tab,
    response: parsed.response || `Opening ${tab}.`,
    latencyMs: 0,
    sessionId,
    confidence: parsed.confidence,
    action: parsed.action,
    suggestions: parsed.suggestions,
  };
}

async function handleCreateTask(text: string, parsed: ParsedIntent, sessionId: string): Promise<CommandResponse> {
  const params = (parsed.params || {}) as { title?: string; priority?: string };
  // If no title was parsed, fall back to the raw text minus the trigger words.
  let title = (params.title || '').trim();
  if (!title) {
    title = text
      .replace(/^(create|add|new|make|schedule)\s+(a\s+)?(new\s+)?((?:critical|urgent|high|medium|low|p[0-3])(?:\s+priority)?\s+)?(task|to-?do|ticket|job)\s*(to|for|called|named|titled|:)?/i, '')
      .trim() || 'Untitled task (created via Orion)';
  }
  const priority = params.priority || 'medium';

  const task = await db.task.create({
    data: {
      title: title.slice(0, 200),
      description: `Created via Orion Shell — ${new Date().toISOString()}`,
      status: 'pending',
      priority,
      tags: JSON.stringify(['orion', 'voice']),
    },
  });

  const response =
    `Created a ${priority}-priority task: "${title}". ` +
    `It is now pending in the task queue. Open the Tasks tab to assign or start it.`;

  return {
    intent: 'create-task',
    task: serializeTask(task),
    response,
    latencyMs: 0,
    sessionId,
    confidence: parsed.confidence,
    action: parsed.action,
    suggestions: ['Open tasks tab', 'Create another task', 'Assign this to an agent'],
  };
}

async function handleCreateAgent(text: string, parsed: ParsedIntent, sessionId: string): Promise<CommandResponse> {
  const params = (parsed.params || {}) as { parentCodename?: string; role?: string };
  // Codenames in the seeded roster are uppercase (ORION, VEGA, ATLAS, …).
  // Users speak them in lowercase, so normalize before lookup.
  const parentCodename = (params.parentCodename || 'orion').toUpperCase();
  const role = (params.role || 'Sub Agent').slice(0, 80);

  // Dynamic import so the endpoint still boots if the spawner has a transient bug.
  const { spawnSubAgent } = await import('@/lib/agent-spawner');
  const agent = await spawnSubAgent({
    parentCodename,
    role,
    skills: [],
    reason: `Spawned via Orion Shell — "${text.slice(0, 100)}"`,
  });

  const response =
    `Spawned a new sub-agent under ${parentCodename}. ` +
    `Codename: ${agent.codename}, role: ${agent.role}. ` +
    `It is now active in the fleet and will auto-expire in 30 days of inactivity.`;

  return {
    intent: 'create-agent',
    agent,
    response,
    latencyMs: 0,
    sessionId,
    confidence: parsed.confidence,
    action: parsed.action,
    suggestions: ['Open spawned agents tab', 'Show fleet status', 'Send a message to the new agent'],
  };
}

async function handleRunSkill(parsed: ParsedIntent, sessionId: string): Promise<CommandResponse> {
  const params = (parsed.params || {}) as { skillKey?: string; input?: string };
  const skillKey = params.skillKey || '';
  const input = (params.input || '').trim();

  if (!skillKey) {
    return {
      intent: 'run-skill',
      response: 'Which skill should I run? Try: summarize, web-search, code-gen, code-review, forecast.',
      latencyMs: 0,
      sessionId,
      confidence: parsed.confidence,
      suggestions: ['Run skill summarize on the latest report', 'Use web-search for AI agents'],
    };
  }

  if (!input) {
    return {
      intent: 'run-skill',
      response: `Running the ${skillKey} skill needs input. Tell me what to ${skillKey}.`,
      latencyMs: 0,
      sessionId,
      confidence: parsed.confidence,
      suggestions: [`Run skill ${skillKey} on <text>`],
    };
  }

  // Execute via the same logic as /api/skills/run, but in-process (no self-fetch).
  const skillResult = await executeSkillInline(skillKey, input);

  // Persist the run for the skill-history tab.
  try {
    await db.skillRun.create({
      data: {
        skillKey,
        input: input.slice(0, 2000),
        output: JSON.stringify(skillResult.output).slice(0, 20000),
        status: skillResult.status,
        latencyMs: skillResult.latencyMs,
        tokens: skillResult.tokens ?? 0,
      },
    });
    await db.skill
      .update({ where: { key: skillKey }, data: { runs: { increment: 1 } } })
      .catch(() => { /* skill row may not exist */ });
  } catch {
    /* persistence is best-effort */
  }

  const preview = typeof skillResult.output === 'object'
    ? JSON.stringify(skillResult.output).slice(0, 400)
    : String(skillResult.output).slice(0, 400);

  const response =
    `Ran the ${skillKey} skill in ${skillResult.latencyMs}ms with status ${skillResult.status}. ` +
    `Result preview: ${preview || '(empty)'}`;

  return {
    intent: 'run-skill',
    skillResult,
    response,
    latencyMs: 0,
    sessionId,
    confidence: parsed.confidence,
    action: parsed.action,
    suggestions: ['Open skill runner', 'Show skill history', 'Run another skill'],
  };
}

async function handleSendComms(parsed: ParsedIntent, sessionId: string): Promise<CommandResponse> {
  const action = (parsed.action || {}) as {
    toAgent?: string;
    subject?: string;
    body?: string;
    priority?: string;
    thread?: string;
  };
  const toAgent = (action.toAgent || 'BROADCAST').toUpperCase();
  const subject = (action.subject || 'Orion message').slice(0, 200);
  const body = (action.body || '(no body)').slice(0, 2000);
  const priority = action.priority || 'normal';
  const thread = action.thread || 'orion';

  const message = await db.agentMessage.create({
    data: {
      fromAgent: 'ORION',
      toAgent,
      subject,
      body,
      priority,
      thread,
      read: false,
    },
  });

  const response =
    toAgent === 'BROADCAST'
      ? `Broadcast message sent to all agents: "${subject}".`
      : `Message sent to ${toAgent}: "${subject}".`;

  return {
    intent: 'send-comms',
    message: serializeMessage(message),
    response,
    latencyMs: 0,
    sessionId,
    confidence: parsed.confidence,
    action: parsed.action,
    suggestions: ['Open comms tab', 'Send another message', 'Show fleet status'],
  };
}

async function handleHealthCheck(sessionId: string): Promise<CommandResponse> {
  // Direct DB queries — avoid an HTTP self-fetch loop to /api/health.
  const [agents, errorLogs, providers, fallbackEvents, staleAgents, cronJobs] = await Promise.all([
    db.agent.count(),
    db.agentLog.count({ where: { level: 'error' } }),
    db.provider.count(),
    db.fallbackEvent.count(),
    db.agent.count({
      where: {
        status: 'error',
        lastActive: { lt: new Date(Date.now() - 5 * 60 * 1000) },
      },
    }),
    db.cronJob.count(),
  ]);

  const enabledProviders = await db.provider.count({ where: { enabled: true } }).catch(() => 0);
  const recoveredFallbacks = await db.fallbackEvent.count({ where: { recovered: true } }).catch(() => 0);
  const recentErrors = await db.agentLog.count({
    where: { level: 'error', createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  }).catch(() => 0);

  const operational = agents - staleAgents;
  const overall = staleAgents > 0 ? 'critical' : recentErrors > 5 ? 'degraded' : 'operational';
  const recoveryRate = fallbackEvents > 0 ? Math.round((recoveredFallbacks / fallbackEvents) * 100) : 100;
  const providerHealth = providers > 0 ? Math.round((enabledProviders / providers) * 100) : 100;
  const fleetHealth = agents > 0 ? Math.round((operational / agents) * 100) : 100;

  const summary = {
    overall,
    fleetHealth,
    providerHealth,
    recoveryRate,
    counts: { agents, errorLogs, providers, enabledProviders, fallbackEvents, recoveredFallbacks, recentErrors, staleAgents, cronJobs },
  };

  const response =
    `System status: ${overall.toUpperCase()}. ` +
    `Fleet health: ${fleetHealth}% — ${agents} agents, ${staleAgents} stuck in error for >5min. ` +
    `Providers: ${enabledProviders}/${providers} enabled (${providerHealth}%). ` +
    `Fallback recovery: ${recoveryRate}% (${recoveredFallbacks}/${fallbackEvents}). ` +
    `${recentErrors} error log(s) in the last 24 hours.`;

  const graph = [
    { label: 'Fleet', value: fleetHealth },
    { label: 'Providers', value: providerHealth },
    { label: 'Recovery', value: recoveryRate },
  ];

  return {
    intent: 'health-check',
    summary,
    response,
    latencyMs: 0,
    sessionId,
    graph,
    suggestions: ['Open health tab', 'Run self-heal', 'Show errored agents'],
  };
}

async function handleSyncModels(sessionId: string): Promise<CommandResponse> {
  // Optional import — another agent may be building @/lib/model-sync. Try/catch.
  let report: unknown = null;
  let response: string;
  try {
    const mod: { syncAll?: () => Promise<unknown> } | null =
      await import('@/lib/model-sync').catch(() => null);
    if (mod && typeof mod.syncAll === 'function') {
      report = await mod.syncAll();
      const r = report as { added?: number; updated?: number; total?: number };
      response =
        `Model sync complete. ` +
        `${r?.added ?? 0} new, ${r?.updated ?? 0} updated, ${r?.total ?? 0} total models.`;
    } else {
      // No syncAll available — at least report current catalog size.
      const total = await db.model.count().catch(() => 0);
      response =
        `Model-sync library is not available yet. ` +
        `The catalog currently has ${total} models. Open the Models tab to manage them.`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    response = `Model sync could not run: ${msg}. The catalog is unchanged.`;
  }

  return {
    intent: 'sync-models',
    report,
    response,
    latencyMs: 0,
    sessionId,
    suggestions: ['Open models tab', 'Show provider health', 'Run a health check'],
  };
}

async function handleQueryFleet(sessionId: string): Promise<CommandResponse> {
  const statusGroups = await db.agent.groupBy({
    by: ['status'],
    _count: { _all: true },
  });

  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const g of statusGroups) {
    byStatus[g.status] = g._count._all;
    total += g._count._all;
  }

  const errorAgents = byStatus.error ?? 0;
  const idle = byStatus.idle ?? 0;
  const working = byStatus.working ?? 0;
  const thinking = byStatus.thinking ?? 0;
  const offline = byStatus.offline ?? 0;
  const healthy = idle + working + thinking;

  // Avg load + success rate
  const agg = await db.agent.aggregate({
    _avg: { load: true, successRate: true },
    _sum: { taskCount: true },
  }).catch(() => ({ _avg: { load: 0, successRate: 0 }, _sum: { taskCount: 0 } }));

  const avgLoad = Math.round(agg._avg.load ?? 0);
  const avgSuccess = Math.round(agg._avg.successRate ?? 0);
  const totalTasks = agg._sum.taskCount ?? 0;

  // Top-loaded agents (5)
  const topLoaded = await db.agent.findMany({
    orderBy: { load: 'desc' },
    take: 5,
    select: { codename: true, role: true, status: true, load: true, successRate: true },
  });

  const summary = {
    total,
    byStatus,
    healthy,
    errorAgents,
    offline,
    avgLoad,
    avgSuccess,
    totalTasks,
    topLoaded,
  };

  const response =
    `Fleet status: ${total} agents — ${healthy} healthy, ${errorAgents} in error, ${offline} offline. ` +
    `Average load ${avgLoad}%, success rate ${avgSuccess}%. ` +
    `${totalTasks} tasks completed across the fleet. ` +
    (topLoaded[0] ? `Most loaded: ${topLoaded[0].codename} at ${Math.round(topLoaded[0].load)}%.` : '');

  const graph = [
    { label: 'Healthy', value: healthy },
    { label: 'Error', value: errorAgents },
    { label: 'Offline', value: offline },
    { label: 'AvgLoad', value: avgLoad },
  ];

  return {
    intent: 'query-fleet',
    summary,
    response,
    latencyMs: 0,
    sessionId,
    graph,
    suggestions: ['Open fleet tab', 'Run self-heal', 'Show errored agents'],
  };
}

async function handleQueryRevenue(sessionId: string): Promise<CommandResponse> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [totalPayments, confirmedToday, pendingToday, failedToday, totalAllTime, confirmedAllTime] = await Promise.all([
    db.payment.count({ where: { createdAt: { gte: startOfToday } } }),
    db.payment.count({ where: { createdAt: { gte: startOfToday }, status: 'confirmed' } }),
    db.payment.count({ where: { createdAt: { gte: startOfToday }, status: 'pending' } }),
    db.payment.count({ where: { createdAt: { gte: startOfToday }, status: 'failed' } }),
    db.payment.count(),
    db.payment.count({ where: { status: 'confirmed' } }),
  ]);

  const sumToday = await db.payment.aggregate({
    where: { createdAt: { gte: startOfToday }, status: 'confirmed' },
    _sum: { amount: true },
  }).catch(() => ({ _sum: { amount: 0 } }));

  const sumAllTime = await db.payment.aggregate({
    where: { status: 'confirmed' },
    _sum: { amount: true },
  }).catch(() => ({ _sum: { amount: 0 } }));

  const revenueToday = sumToday._sum.amount ?? 0;
  const revenueAllTime = sumAllTime._sum.amount ?? 0;

  // currency breakdown (today, confirmed)
  const byCurrency = await db.payment.groupBy({
    by: ['currency'],
    where: { createdAt: { gte: startOfToday }, status: 'confirmed' },
    _sum: { amount: true },
    _count: { _all: true },
  }).catch(() => []);

  const summary = {
    today: { total: totalPayments, confirmed: confirmedToday, pending: pendingToday, failed: failedToday, revenue: revenueToday },
    allTime: { total: totalAllTime, confirmed: confirmedAllTime, revenue: revenueAllTime },
    byCurrency,
  };

  const response =
    `Today: ${confirmedToday} confirmed payment(s) totaling ${revenueToday.toLocaleString(undefined, { maximumFractionDigits: 2 })} INR. ` +
    `${pendingToday} pending, ${failedToday} failed. ` +
    `All-time: ${confirmedAllTime} confirmed payments, ${revenueAllTime.toLocaleString(undefined, { maximumFractionDigits: 2 })} INR total revenue.`;

  const graph = [
    { label: 'Confirmed', value: confirmedToday },
    { label: 'Pending', value: pendingToday },
    { label: 'Failed', value: failedToday },
  ];

  return {
    intent: 'query-revenue',
    summary,
    response,
    latencyMs: 0,
    sessionId,
    graph,
    suggestions: ['Open payments tab', 'Show pending payments', 'List earning methods'],
  };
}

async function handleQueryTasks(sessionId: string): Promise<CommandResponse> {
  const statusGroups = await db.task.groupBy({
    by: ['status'],
    _count: { _all: true },
  }).catch(() => []);

  const byStatus: Record<string, number> = { pending: 0, in_progress: 0, completed: 0, failed: 0, cancelled: 0 };
  let total = 0;
  for (const g of statusGroups) {
    byStatus[g.status] = g._count._all;
    total += g._count._all;
  }

  const priorityGroups = await db.task.groupBy({
    by: ['priority'],
    where: { status: { in: ['pending', 'in_progress'] } },
    _count: { _all: true },
  }).catch(() => []);

  const byPriority: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const g of priorityGroups) byPriority[g.priority] = g._count._all;

  const blockedTasks = await db.task.count({
    where: { status: 'in_progress', updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  }).catch(() => 0);

  // Next few pending tasks
  const upcoming = await db.task.findMany({
    where: { status: 'pending' },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    take: 5,
    select: { id: true, title: true, priority: true, createdAt: true },
  }).catch(() => []);

  const summary = {
    total,
    byStatus,
    byPriority,
    blockedTasks,
    upcoming,
  };

  const pending = byStatus.pending ?? 0;
  const inProgress = byStatus.in_progress ?? 0;
  const completed = byStatus.completed ?? 0;

  const response =
    `Task queue: ${total} total — ${pending} pending, ${inProgress} in progress, ${completed} completed. ` +
    `Blocked (no update in 24h): ${blockedTasks}. ` +
    `Active priority mix: ${byPriority.critical} critical, ${byPriority.high} high, ${byPriority.medium} medium, ${byPriority.low} low. ` +
    (upcoming[0] ? `Next up: "${upcoming[0].title}" (${upcoming[0].priority}).` : '');

  const graph = [
    { label: 'Pending', value: pending },
    { label: 'In Progress', value: inProgress },
    { label: 'Completed', value: completed },
    { label: 'Blocked', value: blockedTasks },
  ];

  return {
    intent: 'query-tasks',
    summary,
    response,
    latencyMs: 0,
    sessionId,
    graph,
    suggestions: ['Open tasks tab', 'Open Kanban board', 'Create a task'],
  };
}

async function handleSetTheme(parsed: ParsedIntent, sessionId: string): Promise<CommandResponse> {
  const action = parsed.action as { type: string; theme: string } | undefined;
  const theme = action?.theme || 'toggle';
  const response =
    theme === 'dark' ? 'Switching to dark mode.' :
    theme === 'light' ? 'Switching to light mode.' :
    'Toggling the theme.';
  return {
    intent: 'set-theme',
    response,
    latencyMs: 0,
    sessionId,
    confidence: parsed.confidence,
    action: parsed.action,
    suggestions: ['Show fleet status', 'Open overview'],
  };
}

async function handleSearch(parsed: ParsedIntent, sessionId: string): Promise<CommandResponse> {
  const action = parsed.action as { type: string; query: string; scope: string } | undefined;
  const query = action?.query || '';
  const scope = action?.scope || 'global';
  return {
    intent: 'search',
    response: `Searching for "${query}"${scope !== 'global' ? ` in ${scope}` : ''}.`,
    latencyMs: 0,
    sessionId,
    confidence: parsed.confidence,
    action: parsed.action,
    suggestions: [`Open ${scope === 'global' ? 'fleet' : scope} tab`, 'Create a task from this search'],
  };
}

async function handleHelp(sessionId: string): Promise<CommandResponse> {
  const response =
    "I can do fourteen things. Navigate: 'open fleet'. " +
    "Create: 'create a task to ship the API', 'spawn an agent under orion for research'. " +
    "Run: 'run skill summarize on <text>', 'use web-search for AI agents'. " +
    "Communicate: 'send message to orion: deploy now', 'broadcast: stand-up in 5'. " +
    "Query: 'fleet status', 'revenue today', 'what is pending?'. " +
    "Operate: 'health check', 'sync models', 'dark mode', 'search for vega'. " +
    "Or just ask me anything for a conversational reply.";
  return {
    intent: 'help',
    response,
    latencyMs: 0,
    sessionId,
    suggestions: [
      'Show fleet status',
      'Create a task to review PRs',
      'Run skill summarize on the latest report',
      'What is the revenue today?',
    ],
  };
}

/* ============================================================
   Helpers
   ============================================================ */

/**
 * Lightweight in-process skill executor (mirrors /api/skills/run logic).
 * Avoids a self-fetch loop while still using the same LLM client.
 */
async function executeSkillInline(
  skillKey: string,
  input: string,
): Promise<{ output: unknown; status: string; latencyMs: number; tokens: number }> {
  const start = Date.now();
  const ZAI = (await import('z-ai-web-dev-sdk')).default;
  const zai = await ZAI.create();

  let output: unknown;
  let tokens = 0;
  let status = 'success';

  try {
    if (skillKey === 'web-search') {
      output = await zai.functions.invoke('web_search', { query: input, num: 8 });
    } else if (skillKey === 'web-reader') {
      let url = input.trim();
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      const result = await zai.functions.invoke('page_reader', { url });
      output = result;
      tokens = (result as { data?: { usage?: { tokens?: number } } })?.data?.usage?.tokens ?? 0;
    } else if (skillKey === 'summarize') {
      const c = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: 'Summarize the following text into 5 crisp bullet points.' },
          { role: 'user', content: input },
        ],
        thinking: { type: 'disabled' },
      });
      output = { summary: c.choices[0]?.message?.content ?? '' };
    } else if (skillKey === 'code-gen') {
      const c = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: 'Generate clean, production-ready, well-commented code. Return only the code in a fenced block.' },
          { role: 'user', content: input },
        ],
        thinking: { type: 'disabled' },
      });
      output = { code: c.choices[0]?.message?.content ?? '' };
    } else if (skillKey === 'code-review') {
      const c = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: 'Review the code for bugs, security, performance, and style. Return a short structured review.' },
          { role: 'user', content: input },
        ],
        thinking: { type: 'disabled' },
      });
      output = { review: c.choices[0]?.message?.content ?? '' };
    } else if (skillKey === 'forecast') {
      const c = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: 'You are a data scientist. Produce a short forecast with key trends and a 3-point prediction.' },
          { role: 'user', content: input },
        ],
        thinking: { type: 'disabled' },
      });
      output = { forecast: c.choices[0]?.message?.content ?? '' };
    } else {
      const c = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: `You are JARVIS executing the "${skillKey}" skill. Respond helpfully and concisely.` },
          { role: 'user', content: input },
        ],
        thinking: { type: 'disabled' },
      });
      output = { result: c.choices[0]?.message?.content ?? '' };
    }
  } catch (err) {
    status = 'error';
    output = { error: err instanceof Error ? err.message : 'skill execution failed' };
  }

  return { output, status, latencyMs: Date.now() - start, tokens };
}

function serializeTask(t: {
  id: string; title: string; status: string; priority: string;
  progress: number; tags: string; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    progress: t.progress,
    tags: safeParse(t.tags, [] as string[]),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function serializeMessage(m: {
  id: string; fromAgent: string; toAgent: string; subject: string;
  body: string; priority: string; thread: string; read: boolean;
  createdAt: Date;
}) {
  return {
    id: m.id,
    fromAgent: m.fromAgent,
    toAgent: m.toAgent,
    subject: m.subject,
    body: m.body,
    priority: m.priority,
    thread: m.thread,
    read: m.read,
    createdAt: m.createdAt.toISOString(),
  };
}

function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
