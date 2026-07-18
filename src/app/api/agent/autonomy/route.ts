import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ZAI from 'z-ai-web-dev-sdk';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

let _zai: Awaited<ReturnType<typeof ZAI.create>> | null = null;
async function getClient() {
  if (!_zai) _zai = await ZAI.create();
  return _zai;
}

interface AutonomyStep {
  step: string;
  status: 'success' | 'error' | 'skipped';
  detail: string;
  latencyMs: number;
}

/**
 * Agent autonomy loop: an agent autonomously runs a research web-search on a
 * topic, summarizes the findings via GLM-4.6, and auto-creates up to 3 tasks
 * from the summary (assigned to the best-matching agent by keyword). Logs
 * every step under the running agent. Returns the full trace.
 *
 * Body: { agentCodename, topic }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { agentCodename, topic } = body as { agentCodename?: string; topic?: string };
  if (!agentCodename || !topic || !topic.trim()) {
    return NextResponse.json({ error: 'agentCodename and topic required' }, { status: 400 });
  }

  const agent = await db.agent.findFirst({ where: { codename: String(agentCodename).toUpperCase() } });
  if (!agent) return NextResponse.json({ error: 'agent not found' }, { status: 404 });

  const trace: AutonomyStep[] = [];
  const start = Date.now();

  // Flip agent to "working" while the loop runs.
  await db.agent.update({ where: { id: agent.id }, data: { status: 'working', lastActive: new Date() } });
  await db.agentLog.create({ data: { agentId: agent.id, level: 'info', message: `Autonomy loop started: research "${topic}"` } });

  try {
    const zai = await getClient();

    // Step 1: web search.
    const t1 = Date.now();
    let searchResults: Array<{ name?: string; url?: string; snippet?: string; host_name?: string }> = [];
    try {
      const r = await zai.functions.invoke('web_search', { query: topic, num: 5 });
      searchResults = Array.isArray(r) ? r : [];
      trace.push({ step: 'web-search', status: 'success', detail: `${searchResults.length} results`, latencyMs: Date.now() - t1 });
      await db.agentLog.create({ data: { agentId: agent.id, level: 'success', message: `Autonomy: web-search returned ${searchResults.length} results` } });
    } catch (e) {
      trace.push({ step: 'web-search', status: 'error', detail: e instanceof Error ? e.message : 'search failed', latencyMs: Date.now() - t1 });
    }

    // Step 2: read the top result (best-effort).
    let articleText = '';
    if (searchResults.length > 0 && searchResults[0].url) {
      const t2 = Date.now();
      try {
        const pr = await zai.functions.invoke('page_reader', { url: searchResults[0].url });
        const html = (pr as { data?: { html?: string } })?.data?.html ?? '';
        articleText = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000);
        trace.push({ step: 'web-reader', status: 'success', detail: `read ${searchResults[0].host_name ?? ''} (${articleText.length} chars)`, latencyMs: Date.now() - t2 });
      } catch (e) {
        trace.push({ step: 'web-reader', status: 'skipped', detail: e instanceof Error ? e.message : 'reader failed', latencyMs: Date.now() - t2 });
      }
    }

    // Step 3: GLM-4.6 summarizes + proposes 3 actionable tasks.
    const t3 = Date.now();
    const context = articleText || searchResults.map((r) => `${r.name}\n${r.snippet}`).join('\n\n');
    let proposedTasks: Array<{ title: string; priority: string; assignee: string }> = [];
    try {
      const completion = await zai.chat.completions.create({
        messages: [
          {
            role: 'assistant',
            content: `You are ${agent.codename}, a ${agent.role}. Based on the research below, propose exactly 3 concrete, actionable tasks for the fleet. Respond as a JSON array of {title, priority (low|medium|high), assignee (one of: ORION, VEGA, ATLAS, NOVA, ECHO, SAGE, FORGE, PULSE)}. Titles max 80 chars. No preamble, just the JSON array.`,
          },
          { role: 'user', content: `Topic: ${topic}\n\nResearch:\n${context.slice(0, 5000)}` },
        ],
        thinking: { type: 'disabled' },
      });
      const raw = completion.choices[0]?.message?.content ?? '[]';
      // Extract JSON array from the response.
      const match = raw.match(/\[[\s\S]*\]/);
      proposedTasks = match ? JSON.parse(match[0]) : [];
      trace.push({ step: 'glm-plan', status: 'success', detail: `proposed ${proposedTasks.length} tasks`, latencyMs: Date.now() - t3 });
      await db.agentLog.create({ data: { agentId: agent.id, level: 'success', message: `Autonomy: GLM-4.6 proposed ${proposedTasks.length} tasks` } });
    } catch (e) {
      trace.push({ step: 'glm-plan', status: 'error', detail: e instanceof Error ? e.message : 'planning failed', latencyMs: Date.now() - t3 });
    }

    // Step 4: persist the proposed tasks (validate assignee exists).
    const validCodenames = new Set((await db.agent.findMany({ select: { codename: true } })).map((a) => a.codename));
    const createdTasks = [];
    for (const pt of proposedTasks.slice(0, 3)) {
      const assignee = validCodenames.has(String(pt.assignee).toUpperCase())
        ? await db.agent.findFirst({ where: { codename: String(pt.assignee).toUpperCase() } })
        : null;
      const t = await db.task.create({
        data: {
          title: String(pt.title).slice(0, 200),
          status: 'pending',
          priority: ['low', 'medium', 'high', 'critical'].includes(pt.priority) ? pt.priority : 'medium',
          assigneeId: assignee?.id ?? null,
          tags: JSON.stringify(['autonomy', agent.codename.toLowerCase()]),
        },
      });
      createdTasks.push({ id: t.id, title: t.title, assignee: assignee?.codename ?? 'unassigned', priority: t.priority });
      if (assignee) {
        await db.agentLog.create({ data: { agentId: assignee.id, level: 'info', message: `Autonomy assigned: ${t.title}` } });
      }
    }
    trace.push({ step: 'create-tasks', status: 'success', detail: `${createdTasks.length} tasks created`, latencyMs: 0 });

    // Step 5: store the research summary as a memory item.
    try {
      await db.memoryItem.create({
        data: {
          scope: 'episodic',
          key: `autonomy-${agent.codename.toLowerCase()}-${Date.now()}`,
          value: `Autonomy loop on "${topic}": ${searchResults.length} results, ${articleText.length} chars read, ${createdTasks.length} tasks proposed. Top source: ${searchResults[0]?.host_name ?? 'none'}.`,
          tags: JSON.stringify(['autonomy', agent.codename.toLowerCase(), topic.split(' ')[0].toLowerCase()]),
        },
      });
    } catch { /* ignore */ }

    // Step 6: notification.
    await db.notification.create({
      data: {
        type: 'success',
        title: 'Autonomy Loop Complete',
        message: `${agent.codename} researched "${topic}", created ${createdTasks.length} tasks.`,
        read: false,
      },
    });

    // Flip agent back to idle.
    await db.agent.update({ where: { id: agent.id }, data: { status: 'idle', lastActive: new Date(), taskCount: { increment: createdTasks.length } } });
    await db.agentLog.create({ data: { agentId: agent.id, level: 'success', message: `Autonomy loop complete: ${createdTasks.length} tasks created` } });

    const totalLatencyMs = Date.now() - start;
    const status = trace.some((t) => t.status === 'error') ? 'error' : 'success';

    // Persist to history.
    try {
      await db.autonomyRun.create({
        data: {
          agentCodename: agent.codename,
          topic,
          source: 'manual',
          status,
          traceJson: JSON.stringify(trace),
          tasksCreated: createdTasks.length,
          taskTitles: JSON.stringify(createdTasks.map((t) => t.title)),
          latencyMs: totalLatencyMs,
        },
      });
    } catch { /* ignore */ }

    return NextResponse.json({
      agent: agent.codename,
      topic,
      trace,
      createdTasks,
      totalLatencyMs,
    });
  } catch (err) {
    // Flip agent to error state on unexpected failure.
    await db.agent.update({ where: { id: agent.id }, data: { status: 'error', lastActive: new Date() } });
    await db.agentLog.create({ data: { agentId: agent.id, level: 'error', message: `Autonomy loop failed: ${err instanceof Error ? err.message : 'unknown'}` } });
    // Persist the failed run to history too.
    try {
      await db.autonomyRun.create({
        data: {
          agentCodename: agent.codename,
          topic,
          source: 'manual',
          status: 'error',
          traceJson: JSON.stringify(trace),
          tasksCreated: 0,
          taskTitles: '[]',
          latencyMs: Date.now() - start,
        },
      });
    } catch { /* ignore */ }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'autonomy loop failed', trace }, { status: 500 });
  }
}
