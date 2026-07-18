/**
 * orion-intent.ts — Orion Shell intent-routing engine.
 *
 * Pure-TS, zero-dependency, sync parser. No DB, no LLM. Runs in <1ms so the
 * shell can show instant feedback (orb pulse + spoken ack) before the slow
 * /api/orion/command endpoint does the real work.
 *
 * Taxonomy (14 intents):
 *   navigate       → "show fleet", "open tasks", "go to payments"
 *   create-task    → "create a task to...", "add task"
 *   create-agent   → "spawn agent", "new agent for..."
 *   run-skill      → "run skill web-search", "execute skill summarize"
 *   send-comms     → "send message to orion", "tell agent", "notify"
 *   health-check   → "health check", "system status"
 *   sync-models    → "sync models", "update model list"
 *   query-fleet    → "fleet status", "agent status"
 *   query-revenue  → "revenue", "payments today"
 *   query-tasks    → "task status", "what's pending"
 *   set-theme      → "dark mode", "light mode"
 *   search         → "search for..."
 *   help           → "help", "what can you do"
 *   chat (fallback)→ everything else — let the LLM handle
 *
 * Output shape:
 *   { intent, tab?, action?, params?, confidence, response?, suggestions?, graph? }
 *
 * `response` is omitted for `chat` (the LLM writes it). For every other
 * intent the parser returns a ready-to-speak string so the shell can ack
 * instantly while the API round-trip is in flight.
 */

export type IntentName =
  | 'navigate'
  | 'create-task'
  | 'create-agent'
  | 'run-skill'
  | 'send-comms'
  | 'health-check'
  | 'sync-models'
  | 'query-fleet'
  | 'query-revenue'
  | 'query-tasks'
  | 'set-theme'
  | 'search'
  | 'help'
  | 'chat'
  // ── Execution / autonomy intents (added by AUTONOMOUS-EXECUTION-LAYER task) ──
  | 'make-plan'
  | 'run-command'
  | 'read-file'
  | 'write-file'
  | 'browse'
  // ── Business / CRM intents (Task ID BUSINESS) ──
  | 'create-lead'
  | 'create-client'
  | 'create-ticket'
  | 'query-clients';

export interface IntentGraph {
  label: string;
  value: number;
}

export interface IntentAction {
  type: string;
  [key: string]: unknown;
}

export interface ParsedIntent {
  intent: IntentName;
  tab?: string;
  action?: IntentAction;
  params?: Record<string, unknown>;
  confidence: number; // 0..1
  /** Spoken reply — omitted for `chat` (LLM writes it). */
  response?: string;
  suggestions?: string[];
  graph?: IntentGraph[];
}

/* ------------------------------------------------------------------ */
/* Tab-key vocabulary — mirrors the TabKey union in page-client.tsx.   */
/* Used by navigate + by contextual suggestions.                       */
/* ------------------------------------------------------------------ */

export const TAB_ALIASES: Record<string, string> = {
  overview: 'overview', dashboard: 'overview', home: 'overview',
  fleet: 'fleet', agents: 'fleet', 'agent fleet': 'fleet', 'agent list': 'fleet',
  topology: 'fleet-topology', 'fleet topology': 'fleet-topology',
  spawned: 'spawned', 'spawned agents': 'spawned',
  workforce: 'workforce',
  goals: 'goals', 'goal': 'goals',
  chat: 'chat', jarvis: 'chat',
  comms: 'comms', 'agent comms': 'comms', messages: 'comms',
  tasks: 'tasks', task: 'tasks',
  kanban: 'kanban', board: 'kanban',
  'task dag': 'task-dag', dag: 'task-dag',
  activity: 'activity',
  skills: 'skills', skill: 'skills',
  runner: 'runner', 'skill runner': 'runner', terminal: 'runner',
  chain: 'chain', pipeline: 'chain', 'skill pipeline': 'chain',
  autonomy: 'autonomy', 'autonomy loop': 'autonomy',
  learning: 'learning', 'learn and earn': 'learning', 'learn & earn': 'learning',
  rules: 'rules', rule: 'rules',
  plugins: 'plugins', plugin: 'plugins',
  models: 'models', model: 'models',
  services: 'services', 'services hub': 'services',
  apptree: 'apptree', 'app tree': 'apptree',
  analytics: 'analytics',
  reports: 'reports', report: 'reports',
  memory: 'memory',
  'memory graph': 'memory-graph', graph: 'memory-graph',
  artifacts: 'artifacts', artifact: 'artifacts',
  providers: 'providers', provider: 'providers',
  telemetry: 'telemetry', metrics: 'telemetry',
  health: 'health',
  logs: 'logs', log: 'logs',
  blackbox: 'blackbox', 'black box': 'blackbox',
  scheduler: 'scheduler', schedule: 'scheduler', cron: 'scheduler',
  'data mgmt': 'data-mgmt', 'data management': 'data-mgmt', data: 'data-mgmt',
  payments: 'payments', payment: 'payments',
  'payment methods': 'payment-methods',
  earnings: 'earnings', 'earning methods': 'earnings',
  branding: 'branding',
  teach: 'teach',
  insights: 'insights', insight: 'insights',
  crm: 'crm', 'crm & sales': 'crm', sales: 'crm',
};

const TAB_GROUP_LABEL: Record<string, string> = {
  overview: 'Overview', fleet: 'Agent Fleet', 'fleet-topology': 'Fleet Topology',
  spawned: 'Spawned Agents', workforce: 'Workforce', goals: 'Goals', chat: 'JARVIS Chat',
  comms: 'Agent Comms', tasks: 'Tasks', kanban: 'Kanban', 'task-dag': 'Task DAG',
  activity: 'Activity', skills: 'Skills', runner: 'Skill Runner', chain: 'Skill Pipeline',
  autonomy: 'Autonomy Loop', learning: 'Learn & Earn', rules: 'Rules', plugins: 'Plugins',
  models: 'Models', services: 'Services Hub', apptree: 'App Tree', analytics: 'Analytics',
  reports: 'Reports', memory: 'Memory', 'memory-graph': 'Memory Graph', artifacts: 'Artifacts',
  providers: 'Providers', telemetry: 'Telemetry', health: 'Health', logs: 'Logs',
  blackbox: 'Black Box', scheduler: 'Scheduler', 'data-mgmt': 'Data Management',
  payments: 'Payments', 'payment-methods': 'Payment Methods', earnings: 'Earning Methods',
  branding: 'Branding', teach: 'Teach', insights: 'Insights',
  crm: 'CRM & Sales',
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function has(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

function pickFirst<T>(arr: T[]): T | undefined {
  return arr.length ? arr[0] : undefined;
}

/* ------------------------------------------------------------------ */
/* Intent matchers (order matters — most specific first)               */
/* ------------------------------------------------------------------ */

interface MatchResult {
  intent: IntentName;
  confidence: number;
  tab?: string;
  action?: IntentAction;
  params?: Record<string, unknown>;
  response?: string;
  suggestions?: string[];
  graph?: IntentGraph[];
}

/* ---- help ---- */
function matchHelp(t: string): MatchResult | null {
  if (/^(help|what can you do|what can i say|commands|capabilities)/.test(t)) {
    return {
      intent: 'help',
      confidence: 0.99,
      action: { type: 'open-help' },
      response:
        "I can navigate tabs, create tasks and agents, run skills, send agent messages, " +
        "check system health, sync models, and answer fleet, revenue, and task questions. " +
        "Try: 'show fleet', 'create a task to ship the API', 'run skill summarize', or 'health check'.",
      suggestions: [
        'Show fleet status',
        'Create a task to review PRs',
        'Run skill summarize on the latest report',
        'What is the revenue today?',
      ],
    };
  }
  return null;
}

/* ---- set-theme ---- */
function matchTheme(t: string): MatchResult | null {
  if (/\b(dark mode|switch to dark|enable dark|night mode)\b/.test(t)) {
    return {
      intent: 'set-theme',
      confidence: 0.97,
      action: { type: 'set-theme', theme: 'dark' },
      response: 'Switching to dark mode.',
      suggestions: ['Switch to light mode', 'Show fleet status'],
    };
  }
  if (/\b(light mode|switch to light|enable light|day mode)\b/.test(t)) {
    return {
      intent: 'set-theme',
      confidence: 0.97,
      action: { type: 'set-theme', theme: 'light' },
      response: 'Switching to light mode.',
      suggestions: ['Switch to dark mode', 'Show fleet status'],
    };
  }
  if (/\b(switch theme|toggle theme|change theme|flip theme)\b/.test(t)) {
    return {
      intent: 'set-theme',
      confidence: 0.9,
      action: { type: 'set-theme', theme: 'toggle' },
      response: 'Toggling theme.',
      suggestions: ['Show fleet status'],
    };
  }
  return null;
}

/* ---- search ---- */
function matchSearch(t: string): MatchResult | null {
  // "search for X", "search X", "find X in agents"
  const m = t.match(/\b(?:search(?:\s+for)?|find|look\s+up)\s+(.+?)(?:\s+in\s+(\w+))?$/);
  if (m) {
    const query = m[1].trim();
    const scope = m[2]?.trim() || 'global';
    return {
      intent: 'search',
      confidence: 0.93,
      action: { type: 'search', query, scope },
      params: { query, scope },
      response: `Searching for "${query}".`,
      suggestions: [`Open ${scope === 'global' ? 'fleet' : scope} tab`, 'Create a task from this search'],
    };
  }
  return null;
}

/* ---- health-check ---- */
function matchHealth(t: string): MatchResult | null {
  if (has(t, ['health check', 'system status', 'are we healthy', 'how is the system', 'system health', 'health report', 'run a health', 'run health'])) {
    return {
      intent: 'health-check',
      confidence: 0.95,
      action: { type: 'health-check' },
      response: 'Running a full system health check now.',
      suggestions: ['Show errored agents', 'Open health tab', 'Run self-heal'],
    };
  }
  return null;
}

/* ---- sync-models ---- */
function matchSyncModels(t: string): MatchResult | null {
  if (has(t, ['sync model', 'sync the model', 'check for new model', 'update model list', 'refresh models', 'pull models', 'model sync'])) {
    return {
      intent: 'sync-models',
      confidence: 0.95,
      action: { type: 'sync-models' },
      response: 'Syncing the model catalog from all enabled providers.',
      suggestions: ['Open models tab', 'Show provider health'],
    };
  }
  return null;
}

/* ---- create-task ---- */
function matchCreateTask(t: string): MatchResult | null {
  if (!/\b(create|add|new|make|schedule)\b/.test(t)) return null;
  if (!/\b(task|to-?do|ticket|job)\b/.test(t)) return null;

  // Try to peel off a title: "create a task to ship the API" → "ship the API"
  // Also tolerates priority words between the article and the noun:
  //   "create a high priority task to review the API" → "review the API"
  //   "create a critical task to fix login"            → "fix login"
  let title = '';
  const m = t.match(
    /(?:create|add|new|make|schedule)\s+(?:a\s+)?(?:new\s+)?(?:(?:critical|urgent|high|medium|low|p[0-3])(?:\s+priority)?\s+)?(?:task|to-?do|ticket|job)\s+(?:to|for|called|named|titled|:)?\s*(.+)$/,
  );
  if (m) title = m[1].replace(/^["'`]|["'`]$/g, '').trim();

  // Priority
  let priority = 'medium';
  if (/\b(critical|urgent|p0)\b/.test(t)) priority = 'critical';
  else if (/\bhigh\b|\bp1\b/.test(t)) priority = 'high';
  else if (/\blow\b|\bp3\b/.test(t)) priority = 'low';

  const response = title
    ? `Creating a ${priority}-priority task: "${title}".`
    : `Creating a new ${priority}-priority task.`;

  return {
    intent: 'create-task',
    confidence: 0.92,
    action: { type: 'create-task', title, priority },
    params: { title, priority },
    response,
    suggestions: ['Show pending tasks', 'Open tasks tab', 'Assign this to an agent'],
  };
}

/* ---- create-agent ---- */
function matchCreateAgent(t: string): MatchResult | null {
  if (!/\b(spawn|create|new|make|build)\b/.test(t)) return null;
  if (!/\b(agent|sub-?agent|worker|bot)\b/.test(t)) return null;

  // Parent agent: "spawn agent from orion", "spawn agent under vega"
  let parent = '';
  const pm = t.match(/\b(?:from|under|child of|offspring of)\s+([a-z][a-z0-9_-]{1,24})/);
  if (pm) parent = pm[1];

  // Role: "for research", "to handle support"
  let role = '';
  const rm = t.match(/\b(?:for|to handle|to do|specializing in|specialized in)\s+(.+?)(?:\s+using|\s+with|$)/);
  if (rm) role = rm[1].replace(/\b(agent|sub agent|sub-agent)\b/g, '').trim();

  // If no parent mentioned, default to "orion" (the orchestrator)
  if (!parent) parent = 'orion';

  const response = role
    ? `Spawning a new sub-agent under ${parent} for ${role}.`
    : `Spawning a new sub-agent under ${parent}.`;

  return {
    intent: 'create-agent',
    confidence: 0.9,
    action: { type: 'create-agent', parentCodename: parent, role },
    params: { parentCodename: parent, role },
    response,
    suggestions: ['Open spawned agents tab', 'Show fleet status', 'Send a message to the new agent'],
  };
}

/* ---- run-skill ---- */
function matchRunSkill(t: string): MatchResult | null {
  if (!/\b(run|execute|use|invoke|trigger)\b/.test(t)) return null;
  if (!/\b(skill|web-?search|web-?reader|summarize|summarise|code-?gen|code-?review|forecast)\b/.test(t)) return null;

  // Identify skill key
  let skillKey = '';
  if (/\bweb-?search\b/.test(t)) skillKey = 'web-search';
  else if (/\bweb-?reader\b/.test(t)) skillKey = 'web-reader';
  else if (/\b(summarize|summarise|summary)\b/.test(t)) skillKey = 'summarize';
  else if (/\bcode-?gen\b/.test(t)) skillKey = 'code-gen';
  else if (/\bcode-?review\b/.test(t)) skillKey = 'code-review';
  else if (/\bforecast\b/.test(t)) skillKey = 'forecast';
  else {
    // generic: "run skill <key>"
    const m = t.match(/skill\s+([a-z][a-z0-9_-]{1,32})/);
    if (m) skillKey = m[1];
  }
  if (!skillKey) return null;

  // Input: "run skill summarize on <text>", "use web-search for <query>"
  let input = '';
  const im = t.match(/(?:on|for|with|about|:)\s+(.+)$/);
  if (im) input = im[1].replace(/^["'`]|["'`]$/g, '').trim();

  const response = input
    ? `Running the ${skillKey} skill on "${input.slice(0, 80)}".`
    : `Running the ${skillKey} skill.`;

  return {
    intent: 'run-skill',
    confidence: 0.9,
    action: { type: 'run-skill', skillKey, input },
    params: { skillKey, input },
    response,
    suggestions: ['Open skill runner', 'Show skill history', 'Run another skill'],
  };
}

/* ---- send-comms ---- */
function matchSendComms(t: string): MatchResult | null {
  if (!/\b(send|tell|notify|message|ping|broadcast)\b/.test(t)) return null;
  if (!/\b(message|agent|comms|notify|tell|ping|broadcast)\b/.test(t)) return null;

  // recipient: "send message to orion" / "tell vega" / "notify all" / "broadcast"
  let toAgent = 'BROADCAST';
  let isBroadcast = /\b(broadcast|all agents|everyone|notify all)\b/.test(t);
  const rm = t.match(/\b(?:to|tell|notify|ping)\s+([a-z][a-z0-9_-]{1,24})/);
  if (rm && !isBroadcast) {
    const cand = rm[1];
    // filter out common stopwords that follow "tell/notify"
    if (!['me', 'us', 'them', 'him', 'her', 'the', 'about', 'that', 'everyone', 'all'].includes(cand)) {
      toAgent = cand;
    } else if (cand === 'all' || cand === 'everyone') {
      isBroadcast = true;
    }
  }

  // subject + body
  let body = '';
  const bm = t.match(/(?:message|notify|tell|ping|broadcast)(?:\s+\w+){0,3}\s*[:\-]?\s*(.+)$/);
  if (bm) body = bm[1].replace(/^["'`]|["'`]$/g, '').trim();
  if (!body) {
    const sm = t.match(/(?:saying|that|:)\s+(.+)$/);
    if (sm) body = sm[1].trim();
  }
  if (!body) body = '(no body)';

  const subject = body.length > 60 ? body.slice(0, 57) + '…' : body;
  const response = isBroadcast
    ? `Broadcasting: "${body.slice(0, 80)}".`
    : `Sending a message to ${toAgent}: "${body.slice(0, 80)}".`;

  return {
    intent: 'send-comms',
    confidence: 0.88,
    action: { type: 'send-comms', toAgent, subject, body, priority: 'normal', thread: 'orion' },
    params: { toAgent, subject, body, isBroadcast },
    response,
    suggestions: ['Open comms tab', 'Send another message', 'Show fleet status'],
  };
}

/* ---- query-fleet ---- */
function matchQueryFleet(t: string): MatchResult | null {
  if (has(t, ['fleet status', 'agent status', 'how are agents', 'how is the fleet', 'how\'s the fleet', 'fleet report', 'fleet summary', 'fleet health', 'agent fleet'])) {
    return {
      intent: 'query-fleet',
      confidence: 0.95,
      action: { type: 'query-fleet' },
      response: 'Pulling live fleet status now.',
      suggestions: ['Show errored agents', 'Open fleet tab', 'Run self-heal'],
    };
  }
  return null;
}

/* ---- query-revenue ---- */
function matchQueryRevenue(t: string): MatchResult | null {
  if (has(t, ['revenue', 'how much money', 'payments today', 'payment status', 'earnings today', 'income today', 'today\'s revenue', 'todays revenue', 'how much did we make'])) {
    return {
      intent: 'query-revenue',
      confidence: 0.94,
      action: { type: 'query-revenue' },
      response: 'Summarizing today\'s revenue and payments.',
      suggestions: ['Open payments tab', 'Show pending payments', 'List earning methods'],
    };
  }
  return null;
}

/* ---- query-tasks ---- */
function matchQueryTasks(t: string): MatchResult | null {
  if (has(t, ['task status', 'what\'s pending', 'what is pending', 'whats pending', 'pending tasks', 'blocked tasks', 'task summary', 'task report', 'what tasks', 'how many tasks', 'task queue'])) {
    return {
      intent: 'query-tasks',
      confidence: 0.94,
      action: { type: 'query-tasks' },
      response: 'Summarizing current task status.',
      suggestions: ['Open tasks tab', 'Open Kanban board', 'Create a task'],
    };
  }
  return null;
}

/* ---- navigate ---- */
function matchNavigate(t: string): MatchResult | null {
  // "show fleet", "open tasks", "go to payments", "view health", "take me to models"
  const m = t.match(/\b(?:show|open|go\s+to|view|visit|take\s+me\s+to|switch\s+to|navigate\s+to|jump\s+to|bring\s+up)\s+(?:the\s+|all\s+)?(.+)$/);
  if (!m) return null;
  const phrase = m[1].replace(/\b(tab|page|view|panel|section)\b/g, '').trim();
  // try direct alias lookup
  let tab = TAB_ALIASES[phrase];
  // try last word (e.g. "open agent fleet" → "fleet")
  if (!tab) {
    const words = phrase.split(/\s+/);
    for (let i = words.length - 1; i >= 0; i--) {
      const w = words[i];
      if (TAB_ALIASES[w]) { tab = TAB_ALIASES[w]; break; }
    }
  }
  // try multi-word combinations
  if (!tab) {
    for (const k of Object.keys(TAB_ALIASES)) {
      if (phrase.includes(k)) { tab = TAB_ALIASES[k]; break; }
    }
  }
  if (!tab) return null;

  const label = TAB_GROUP_LABEL[tab] ?? tab;
  return {
    intent: 'navigate',
    confidence: 0.9,
    tab,
    action: { type: 'navigate', tab },
    response: `Opening ${label}.`,
    suggestions: [`Show ${label.toLowerCase()} status`, 'Take me to overview'],
  };
}

/* ---- Bare single-word navigation: just "fleet" or "tasks" ---- */
function matchBareNavigate(t: string): MatchResult | null {
  const trimmed = t.trim().replace(/^the\s+/, '');
  if (trimmed.length > 24) return null; // bare words only
  const tab = TAB_ALIASES[trimmed];
  if (!tab) return null;
  const label = TAB_GROUP_LABEL[tab] ?? tab;
  return {
    intent: 'navigate',
    confidence: 0.7,
    tab,
    action: { type: 'navigate', tab },
    response: `Opening ${label}.`,
    suggestions: [`Show ${label.toLowerCase()} status`, 'Take me to overview'],
  };
}

/* ---- make-plan (task decomposition) ---- */
function matchMakePlan(t: string): MatchResult | null {
  // "plan: decompose Q3 roadmap", "make a plan for...", "decompose...", "break down..."
  const m = t.match(/^(?:plan|make\s+a\s+plan|create\s+a\s+plan|decompose|break\s+down|analyze\s+and\s+plan)\s*[:\s]*(.+)$/);
  if (m) {
    const topic = m[1].trim();
    return {
      intent: 'make-plan',
      confidence: 0.95,
      action: { type: 'make-plan', topic },
      params: { topic },
      response: `Planning: ${topic}. I'll decompose this into actionable steps.`,
      suggestions: ['Execute plan', 'Modify plan', 'Save as tasks'],
    };
  }
  // "plan to...", "plan for..."
  const m2 = t.match(/^plan\s+(?:to|for)\s+(.+)$/);
  if (m2) {
    return {
      intent: 'make-plan',
      confidence: 0.92,
      action: { type: 'make-plan', topic: m2[1].trim() },
      params: { topic: m2[1].trim() },
      response: `Planning: ${m2[1].trim()}. Decomposing into steps.`,
      suggestions: ['Execute plan', 'Modify plan', 'Save as tasks'],
    };
  }
  return null;
}

/* ---- run-command (terminal/shell execution) ---- */
function matchRunCommand(t: string): MatchResult | null {
  // "run command: git status", "execute: ls -la", "run: npm install"
  const m = t.match(/^(?:run|execute)\s+(?:command\s*[:\s]+|cmd\s*[:\s]+)?(.+)$/);
  if (m) {
    return {
      intent: 'run-command',
      confidence: 0.95,
      action: { type: 'run-command', command: m[1].trim() },
      params: { command: m[1].trim() },
      response: `Executing: ${m[1].trim()}`,
    };
  }
  // "shell: ...", "terminal: ..."
  const m2 = t.match(/^(?:shell|terminal)\s*[:\s]+(.+)$/);
  if (m2) {
    return {
      intent: 'run-command',
      confidence: 0.93,
      action: { type: 'run-command', command: m2[1].trim() },
      params: { command: m2[1].trim() },
      response: `Executing: ${m2[1].trim()}`,
    };
  }
  return null;
}

/* ---- read-file ---- */
function matchReadFile(t: string): MatchResult | null {
  // "read file: src/app/page.tsx", "show file config.ts"
  const m = t.match(/^(?:read|show|cat|view)\s+file\s*[:\s]+(.+)$/);
  if (m) {
    return {
      intent: 'read-file',
      confidence: 0.95,
      action: { type: 'read-file', path: m[1].trim() },
      params: { path: m[1].trim() },
      response: `Reading file: ${m[1].trim()}`,
    };
  }
  const m2 = t.match(/^(?:read|show|cat)\s+([\w./-]+\.\w+)$/);
  if (m2) {
    return {
      intent: 'read-file',
      confidence: 0.88,
      action: { type: 'read-file', path: m2[1].trim() },
      params: { path: m2[1].trim() },
      response: `Reading file: ${m2[1].trim()}`,
    };
  }
  return null;
}

/* ---- write-file ---- */
function matchWriteFile(t: string): MatchResult | null {
  // "write file: path" or "create file: path"
  const m = t.match(/^(?:write|create|edit)\s+file\s*[:\s]+(.+)$/);
  if (m) {
    return {
      intent: 'write-file',
      confidence: 0.93,
      action: { type: 'write-file', path: m[1].trim() },
      params: { path: m[1].trim() },
      response: `Preparing to write file: ${m[1].trim()}`,
      suggestions: ['What content should I write?'],
    };
  }
  return null;
}

/* ---- browse (browser automation) ---- */
function matchBrowse(t: string): MatchResult | null {
  // "browse to github.com", "open website cnn.com", "go to news.ycombinator.com"
  const m = t.match(/^(?:browse\s+to|open\s+website|go\s+to\s+website|visit\s+site|browse)\s+(.+)$/);
  if (m) {
    let url = m[1].trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    return {
      intent: 'browse',
      confidence: 0.92,
      action: { type: 'browse', url },
      params: { url },
      response: `Opening ${url} in the browser.`,
      suggestions: ['Take a screenshot', 'Extract page content', 'Click an element'],
    };
  }
  return null;
}

/* ---- create-lead (CRM) ---- */
function matchCreateLead(t: string): MatchResult | null {
  // "add lead: John from Acme, john@acme.com"
  // "new lead: Jane Doe (janedoe@example.com)"
  // "create lead: Bob Smith from Globex, bob@globex.io"
  const m = t.match(/^(?:add|new|create|register)\s+lead\s*[:\s]+(.+)$/);
  if (!m) return null;
  const raw = m[1].trim();
  const c = parseContactString(raw);
  // Lead API expects `clientName` (not `name`).
  const params = {
    clientName: c.name,
    company: c.company,
    email: c.email,
    phone: c.phone,
    source: c.source ?? 'web',
  };
  return {
    intent: 'create-lead',
    confidence: 0.95,
    action: { type: 'create-lead', ...params },
    params,
    response: `Adding lead ${params.clientName}${params.company ? ` from ${params.company}` : ''}.`,
    suggestions: ['Show leads', 'Convert to client', 'Add another lead'],
  };
}

/* ---- create-client (CRM) ---- */
function matchCreateClient(t: string): MatchResult | null {
  // "add client: Jane Doe, janedoe@example.com"
  // "new client: Acme Corp (finance@acme.com)"
  // "create client: Bob Smith at Globex"
  const m = t.match(/^(?:add|new|create|register)\s+client\s*[:\s]+(.+)$/);
  if (!m) return null;
  const raw = m[1].trim();
  const params = parseContactString(raw);
  return {
    intent: 'create-client',
    confidence: 0.95,
    action: { type: 'create-client', ...params },
    params,
    response: `Adding client ${params.name}${params.company ? ` from ${params.company}` : ''}.`,
    suggestions: ['Show clients', 'Add a lead', 'Open CRM tab'],
  };
}

/* ---- create-ticket (support) ---- */
function matchCreateTicket(t: string): MatchResult | null {
  // "create support ticket: client can't login"
  // "new ticket: billing issue from Jane"
  // "open ticket: shipping delay for order #1234"
  const m = t.match(/^(?:create|new|open|raise|file)\s+(?:support\s+)?ticket\s*[:\s]+(.+)$/);
  if (!m) return null;
  const subject = m[1].trim();
  // Try to detect a client name pattern: "from X" or "for X"
  let clientName = 'Unknown';
  const fromMatch = subject.match(/\b(?:from|for|by)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/);
  if (fromMatch) clientName = fromMatch[1];
  return {
    intent: 'create-ticket',
    confidence: 0.93,
    action: { type: 'create-ticket', subject, clientName, body: subject, priority: 'medium', channel: 'chat' },
    params: { subject, clientName, body: subject, priority: 'medium', channel: 'chat' },
    response: `Opening support ticket: "${subject.slice(0, 60)}".`,
    suggestions: ['Show support tickets', 'Assign to an agent', 'Mark as urgent'],
  };
}

/* ---- query-clients (CRM analytics) ---- */
function matchQueryClients(t: string): MatchResult | null {
  if (has(t, [
    'show clients', 'list clients', 'client status', 'client list', 'client report',
    'how many clients', 'how many leads', 'show leads', 'lead status', 'leads status',
    'pipeline status', 'pipeline value', 'crm status', 'crm report', 'support tickets',
    'open tickets', 'ticket status',
  ])) {
    return {
      intent: 'query-clients',
      confidence: 0.93,
      action: { type: 'query-clients' },
      response: 'Pulling live CRM pipeline, leads, and support ticket stats.',
      suggestions: ['Open CRM tab', 'Add a lead', 'Add a client'],
    };
  }
  return null;
}

/**
 * Parse a free-text contact string into structured fields.
 * Handles:
 *   "John from Acme Corp, john@acme.com, +91 99999 12345"
 *   "Jane Doe (janedoe@example.com)"
 *   "Bob Smith at Globex"
 */
function parseContactString(raw: string): {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  source?: string;
} {
  let s = raw;
  // Extract email
  let email: string | undefined;
  const emailMatch = s.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (emailMatch) {
    email = emailMatch[0];
    s = s.replace(emailMatch[0], '').trim();
  }
  // Extract phone (very loose — any 7+ digit sequence with optional + and separators)
  let phone: string | undefined;
  const phoneMatch = s.match(/\+?\d[\d\s\-().]{6,}\d/);
  if (phoneMatch) {
    phone = phoneMatch[0].trim();
    s = s.replace(phoneMatch[0], ' ').trim();
  }
  // Strip trailing punctuation/commas/parens
  s = s.replace(/[,.()]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Extract company: "X from Y" / "X at Y" / "X - Y"
  let company: string | undefined;
  const companyMatch = s.match(/\s+(?:from|at|-|@)\s+(.+)$/);
  let name = s;
  if (companyMatch) {
    company = companyMatch[1].trim();
    name = s.slice(0, companyMatch.index).trim();
  }
  if (!name) name = 'Unknown';
  // Source heuristic
  let source: string | undefined;
  const lower = raw.toLowerCase();
  if (/\breferral\b/.test(lower)) source = 'referral';
  else if (/\binbound\b/.test(lower)) source = 'inbound';
  else if (/\bcold\b/.test(lower)) source = 'cold-outreach';
  return { name, company, email, phone, source };
}

/* ------------------------------------------------------------------ */
/* Ordered matcher pipeline                                            */
/* ------------------------------------------------------------------ */

const MATCHERS: Array<(t: string) => MatchResult | null> = [
  matchHelp,
  matchTheme,
  matchSearch,
  matchHealth,
  matchSyncModels,
  matchMakePlan,
  matchRunCommand,
  matchReadFile,
  matchWriteFile,
  matchBrowse,
  matchCreateLead,
  matchCreateClient,
  matchCreateTicket,
  matchQueryClients,
  matchUserTask,
  matchImproveEarning,
  matchCreateTask,
  matchCreateAgent,
  matchRunSkill,
  matchSendComms,
  matchQueryFleet,
  matchQueryRevenue,
  matchQueryTasks,
  matchNavigate,
  matchBareNavigate,
];

/**
 * Parse a free-text command into a structured intent.
 *
 * Always returns a ParsedIntent — never throws. Falls back to `chat` with
 * confidence 0 if no matcher fires, leaving the response to the LLM.
 */
export function parseIntent(text: string): ParsedIntent {
  const raw = (text || '').trim();
  if (!raw) {
    return { intent: 'chat', confidence: 0 };
  }
  const t = raw.toLowerCase().replace(/[.,!?]+$/g, '').replace(/\s+/g, ' ');

  for (const matcher of MATCHERS) {
    try {
      const r = matcher(t);
      if (r) {
        return {
          intent: r.intent,
          tab: r.tab,
          action: r.action,
          params: r.params,
          confidence: r.confidence,
          response: r.response,
          suggestions: r.suggestions,
          graph: r.graph,
        };
      }
    } catch {
      // a matcher bug should never break the shell — keep going
    }
  }

  // Fallback: let the LLM handle it.
  return { intent: 'chat', confidence: 0 };
}

/* ------------------------------------------------------------------ */
/* Suggestion catalog (used by the shell's "What can I say?" panel)    */
/* ------------------------------------------------------------------ */

export interface IntentExample {
  intent: IntentName;
  label: string;
  examples: string[];
  icon: string; // lucide icon name
  color: string; // hex
}

export const INTENT_CATALOG: IntentExample[] = [
  {
    intent: 'navigate',
    label: 'Navigate Tabs',
    icon: 'Compass',
    color: '#7DD3FC',
    examples: ['Show fleet', 'Open tasks', 'Go to payments', 'Take me to health', 'Switch to models'],
  },
  {
    intent: 'create-task',
    label: 'Create Tasks',
    icon: 'ListTodo',
    color: '#FBBF24',
    examples: ['Create a task to ship the API', 'Add a critical task: fix login bug', 'New task to review PRs'],
  },
  {
    intent: 'create-agent',
    label: 'Spawn Agents',
    icon: 'Bot',
    color: '#C4B5FD',
    examples: ['Spawn an agent under orion for research', 'Create a sub-agent from vega', 'New agent for support'],
  },
  {
    intent: 'run-skill',
    label: 'Run Skills',
    icon: 'Terminal',
    color: '#34D399',
    examples: ['Run skill summarize on <text>', 'Use web-search for AI agents', 'Execute code-review on my function'],
  },
  {
    intent: 'send-comms',
    label: 'Send Messages',
    icon: 'MessagesSquare',
    color: '#C4B5FD',
    examples: ['Send message to orion: deploy now', 'Tell vega the build passed', 'Broadcast: stand-up in 5'],
  },
  {
    intent: 'health-check',
    label: 'Health Check',
    icon: 'HeartPulse',
    color: '#34D399',
    examples: ['Health check', 'System status', 'Are we healthy?'],
  },
  {
    intent: 'sync-models',
    label: 'Sync Models',
    icon: 'RefreshCw',
    color: '#7DD3FC',
    examples: ['Sync models', 'Update model list', 'Check for new models'],
  },
  {
    intent: 'query-fleet',
    label: 'Query Fleet',
    icon: 'Bot',
    color: '#7DD3FC',
    examples: ['Fleet status', 'How are agents doing?', 'Agent status'],
  },
  {
    intent: 'query-revenue',
    label: 'Query Revenue',
    icon: 'Wallet',
    color: '#34D399',
    examples: ['Revenue today', 'How much money did we make?', 'Payments today'],
  },
  {
    intent: 'query-tasks',
    label: 'Query Tasks',
    icon: 'ListTodo',
    color: '#FBBF24',
    examples: ["What's pending?", 'Task status', 'Blocked tasks'],
  },
  {
    intent: 'set-theme',
    label: 'Switch Theme',
    icon: 'Moon',
    color: '#C4B5FD',
    examples: ['Dark mode', 'Light mode', 'Switch theme'],
  },
  {
    intent: 'search',
    label: 'Search',
    icon: 'Search',
    color: '#7DD3FC',
    examples: ['Search for orion', 'Find vega in agents', 'Look up payment failures'],
  },
  {
    intent: 'help',
    label: 'Help',
    icon: 'HelpCircle',
    color: '#FBBF24',
    examples: ['Help', 'What can you do?', 'What can I say?'],
  },
  {
    intent: 'chat',
    label: 'Ask Anything',
    icon: 'Sparkles',
    color: '#7DD3FC',
    examples: ['Summarize today', 'Research AI agents', 'Plan a launch strategy'],
  },
  {
    intent: 'create-lead',
    label: 'Add Lead',
    icon: 'UserPlus',
    color: '#FBBF24',
    examples: ['add lead: John from Acme, john@acme.com', 'new lead: Jane Doe', 'create lead: Bob at Globex'],
  },
  {
    intent: 'create-client',
    label: 'Add Client',
    icon: 'Users',
    color: '#FBBF24',
    examples: ['add client: Jane Doe, janedoe@example.com', 'new client: Acme Corp', 'create client: Bob at Globex'],
  },
  {
    intent: 'create-ticket',
    label: 'Open Ticket',
    icon: 'Headphones',
    color: '#34D399',
    examples: ['create ticket: client can\'t login', 'new ticket: billing issue from Jane', 'open ticket: shipping delay'],
  },
  {
    intent: 'query-clients',
    label: 'CRM Stats',
    icon: 'Briefcase',
    color: '#7DD3FC',
    examples: ['Show clients', 'How many leads?', 'Pipeline status', 'Open tickets'],
  },
];

/* ------------------------------------------------------------------ */
/* Command palette entries (used by the shell's typeahead dropdown)    */
/* ------------------------------------------------------------------ */

export interface PaletteEntry {
  id: string;
  label: string;
  hint: string;
  intent: IntentName;
  icon: string;
  color: string;
  /** A pre-filled prompt the user can edit + Enter to send. */
  prompt: string;
}

export const PALETTE_ENTRIES: PaletteEntry[] = [
  { id: 'p-fleet-status', label: 'Show Fleet Status', hint: 'query-fleet', intent: 'query-fleet', icon: 'Bot', color: '#7DD3FC', prompt: 'Fleet status' },
  { id: 'p-fleet-tab', label: 'Open Fleet Tab', hint: 'navigate', intent: 'navigate', icon: 'Compass', color: '#7DD3FC', prompt: 'Open fleet' },
  { id: 'p-fleet-spawn', label: 'Spawn Fleet Agent', hint: 'create-agent', intent: 'create-agent', icon: 'Bot', color: '#C4B5FD', prompt: 'Spawn an agent under orion for fleet ops' },
  { id: 'p-revenue-today', label: 'Revenue Today', hint: 'query-revenue', intent: 'query-revenue', icon: 'Wallet', color: '#34D399', prompt: 'Revenue today' },
  { id: 'p-payments-tab', label: 'Open Payments Tab', hint: 'navigate', intent: 'navigate', icon: 'Compass', color: '#7DD3FC', prompt: 'Open payments' },
  { id: 'p-pending-tasks', label: 'Pending Tasks', hint: 'query-tasks', intent: 'query-tasks', icon: 'ListTodo', color: '#FBBF24', prompt: "What's pending?" },
  { id: 'p-tasks-tab', label: 'Open Tasks Tab', hint: 'navigate', intent: 'navigate', icon: 'Compass', color: '#7DD3FC', prompt: 'Open tasks' },
  { id: 'p-create-task', label: 'Create Task…', hint: 'create-task', intent: 'create-task', icon: 'ListTodo', color: '#FBBF24', prompt: 'Create a task to ' },
  { id: 'p-health-check', label: 'Health Check', hint: 'health-check', intent: 'health-check', icon: 'HeartPulse', color: '#34D399', prompt: 'Health check' },
  { id: 'p-health-tab', label: 'Open Health Tab', hint: 'navigate', intent: 'navigate', icon: 'Compass', color: '#7DD3FC', prompt: 'Open health' },
  { id: 'p-sync-models', label: 'Sync Models', hint: 'sync-models', intent: 'sync-models', icon: 'RefreshCw', color: '#7DD3FC', prompt: 'Sync models' },
  { id: 'p-models-tab', label: 'Open Models Tab', hint: 'navigate', intent: 'navigate', icon: 'Compass', color: '#7DD3FC', prompt: 'Open models' },
  { id: 'p-spawn-agent', label: 'Spawn Agent…', hint: 'create-agent', intent: 'create-agent', icon: 'Bot', color: '#C4B5FD', prompt: 'Spawn an agent under orion for ' },
  { id: 'p-run-skill', label: 'Run Skill…', hint: 'run-skill', intent: 'run-skill', icon: 'Terminal', color: '#34D399', prompt: 'Run skill ' },
  { id: 'p-send-comms', label: 'Send Message…', hint: 'send-comms', intent: 'send-comms', icon: 'MessagesSquare', color: '#C4B5FD', prompt: 'Send message to ' },
  { id: 'p-comms-tab', label: 'Open Comms Tab', hint: 'navigate', intent: 'navigate', icon: 'Compass', color: '#7DD3FC', prompt: 'Open comms' },
  { id: 'p-dark-mode', label: 'Dark Mode', hint: 'set-theme', intent: 'set-theme', icon: 'Moon', color: '#C4B5FD', prompt: 'Dark mode' },
  { id: 'p-light-mode', label: 'Light Mode', hint: 'set-theme', intent: 'set-theme', icon: 'Sun', color: '#FBBF24', prompt: 'Light mode' },
  { id: 'p-search', label: 'Search…', hint: 'search', intent: 'search', icon: 'Search', color: '#7DD3FC', prompt: 'Search for ' },
  { id: 'p-help', label: 'Help', hint: 'help', intent: 'help', icon: 'HelpCircle', color: '#FBBF24', prompt: 'Help' },
  { id: 'p-crm-tab', label: 'Open CRM Tab', hint: 'navigate', intent: 'navigate', icon: 'Compass', color: '#7DD3FC', prompt: 'Open CRM' },
  { id: 'p-add-lead', label: 'Add Lead…', hint: 'create-lead', intent: 'create-lead', icon: 'UserPlus', color: '#FBBF24', prompt: 'Add lead: ' },
  { id: 'p-add-client', label: 'Add Client…', hint: 'create-client', intent: 'create-client', icon: 'Users', color: '#FBBF24', prompt: 'Add client: ' },
  { id: 'p-open-ticket', label: 'Open Ticket…', hint: 'create-ticket', intent: 'create-ticket', icon: 'Headphones', color: '#34D399', prompt: 'Create ticket: ' },
  { id: 'p-crm-stats', label: 'CRM Stats', hint: 'query-clients', intent: 'query-clients', icon: 'Briefcase', color: '#7DD3FC', prompt: 'Show clients' },
];

/**
 * Filter palette entries by a query string. Matches on label + hint + intent.
 */
export function filterPalette(query: string): PaletteEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return PALETTE_ENTRIES;
  return PALETTE_ENTRIES.filter((e) => {
    const hay = `${e.label} ${e.hint} ${e.intent}`.toLowerCase();
    return q.split(/\s+/).every((tok) => hay.includes(tok));
  });
}

/* ------------------------------------------------------------------ */
/* Proactive idle suggestions (rotated by the shell every 30s)         */
/* ------------------------------------------------------------------ */

export const PROACTIVE_PROMPTS: string[] = [
  "Try: \"What's the fleet status?\"",
  'Try: "Create a task to review the API"',
  'Try: "Show me revenue today"',
  'Try: "Run a health check"',
  'Try: "Open the tasks tab"',
  'Try: "Sync models from providers"',
  'Try: "Send a message to orion"',
  'Try: "Spawn an agent for research"',
  'Try: "What can you do?"',
  'Try: "Switch to light mode"',
];

/* ------------------------------------------------------------------ */
/* Multi-turn context detector — sets the "context chip" label         */
/* ------------------------------------------------------------------ */

const CONTEXT_KEYWORDS: Array<{ ctx: string; words: string[] }> = [
  { ctx: 'fleet discussion', words: ['fleet', 'agent', 'agent', 'sub-agent', 'spawn', 'orion', 'vega', 'atlas'] },
  { ctx: 'revenue discussion', words: ['revenue', 'payment', 'money', 'income', 'payout', 'earning'] },
  { ctx: 'task discussion', words: ['task', 'todo', 'ticket', 'pending', 'blocked', 'kanban'] },
  { ctx: 'health discussion', words: ['health', 'error', 'fail', 'recovery', 'self-heal', 'stale'] },
  { ctx: 'model discussion', words: ['model', 'provider', 'sync', 'fallback', 'token'] },
  { ctx: 'comms discussion', words: ['message', 'notify', 'broadcast', 'comms', 'tell'] },
];

export function detectContext(text: string): string | null {
  const t = (text || '').toLowerCase();
  if (!t) return null;
  for (const { ctx, words } of CONTEXT_KEYWORDS) {
    if (words.some((w) => t.includes(w))) return ctx;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Quick command chips (the 8 enhanced chips)                          */
/* ------------------------------------------------------------------ */

export interface QuickCommand {
  id: string;
  label: string;
  prompt: string;
  intent: IntentName;
  icon: string;
  color: string;
}

export const QUICK_COMMANDS_V2: QuickCommand[] = [
  { id: 'qc-fleet', label: 'Fleet Status', prompt: 'Fleet status', intent: 'query-fleet', icon: 'Bot', color: '#7DD3FC' },
  { id: 'qc-revenue', label: 'Revenue Today', prompt: 'Revenue today', intent: 'query-revenue', icon: 'Wallet', color: '#34D399' },
  { id: 'qc-tasks', label: 'Pending Tasks', prompt: "What's pending?", intent: 'query-tasks', icon: 'ListTodo', color: '#FBBF24' },
  { id: 'qc-health', label: 'Health Check', prompt: 'Health check', intent: 'health-check', icon: 'HeartPulse', color: '#34D399' },
  { id: 'qc-sync', label: 'Sync Models', prompt: 'Sync models', intent: 'sync-models', icon: 'RefreshCw', color: '#7DD3FC' },
  { id: 'qc-task', label: 'Create Task…', prompt: 'Create a task to ', intent: 'create-task', icon: 'ListTodo', color: '#FBBF24' },
  { id: 'qc-fleet-tab', label: 'Open Fleet Tab', prompt: 'Open fleet', intent: 'navigate', icon: 'Compass', color: '#7DD3FC' },
  { id: 'qc-help', label: 'Help', prompt: 'Help', intent: 'help', icon: 'HelpCircle', color: '#FBBF24' },
];

/* ---- user-task (explicitly requested by user via chat/telegram/orion) ---- */
function matchUserTask(t: string): MatchResult | null {
  // "I need...", "I want...", "Can you...", "Please do...", "Do this for me..."
  // These are user-requested tasks, not auto-generated by CEO
  const m = t.match(/^(?:i\s+need|i\s+want|can\s+you|please|do\s+this|help\s+me\s+(?:with|do))\s+(.+)$/i);
  if (m) {
    const taskDesc = m[1].trim();
    return {
      intent: 'user-task',
      confidence: 0.88,
      action: { type: 'user-task', description: taskDesc, source: 'user' },
      params: { description: taskDesc, source: 'user' },
      response: `I'll help you with: ${taskDesc}. Let me create a task and assign it to the right agent.`,
      suggestions: ['Track this task', 'Assign to specific agent', 'Plan this task'],
    };
  }
  return null;
}

/* ---- improve-earning (CEO improvement loop for earning methods) ---- */
function matchImproveEarning(t: string): MatchResult | null {
  // "improve earning method X", "suggest improvements for X", "redo earning method X"
  const m = t.match(/^(?:improve|enhance|redo|rework|suggest\s+improvements\s+for)\s+(?:earning\s+method\s+)?(.+)$/i);
  if (m) {
    return {
      intent: 'improve-earning',
      confidence: 0.90,
      action: { type: 'improve-earning', methodName: m[1].trim() },
      params: { methodName: m[1].trim() },
      response: `I'll review "${m[1].trim()}" and suggest improvements, then redo the full flow with the improvements applied.`,
      suggestions: ['View current simulation', 'Approve improvements', 'Reject and try different approach'],
    };
  }
  return null;
}
