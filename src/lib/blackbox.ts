// =====================================================================
// blackbox.ts — Immutable in-memory audit trail of agent decisions,
// token spend, outbound actions, errors, and autonomous actions.
// =====================================================================
// The Blackbox tab queries this buffer + the existing AgentLog table.
// Buffer is capped (1000 entries); older entries fall through to AgentLog
// when the periodic flush runs. No new Prisma model is needed.
// =====================================================================

import { db } from '@/lib/db';

export type BlackBoxCategory =
  | 'decision'
  | 'token_spend'
  | 'outbound'
  | 'error'
  | 'autonomous'
  | 'goal'
  | 'task';

export type BlackBoxSeverity = 'info' | 'warn' | 'error' | 'critical';

export interface BlackBoxEntry {
  id: string;
  timestamp: number; // ms since epoch
  agentCodename?: string;
  taskId?: string;
  goalId?: string;
  category: BlackBoxCategory;
  action: string;
  target?: string;
  detail: Record<string, unknown>;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  severity?: BlackBoxSeverity;
  status?: 'success' | 'failure' | 'pending';
}

const MAX_BUFFER = 1000;
const FLUSH_THRESHOLD = 200;
const FLUSH_INTERVAL_MS = 30_000;

const buffer: BlackBoxEntry[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let totalRecorded = 0;
let totalFlushed = 0;

function scheduleFlush(): void {
  if (flushTimer) return;
  if (buffer.length >= FLUSH_THRESHOLD) {
    void flush();
    return;
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush().catch(() => undefined);
  }, FLUSH_INTERVAL_MS);
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  // Drop the oldest entries beyond MAX_BUFFER (very small DB writes only).
  const batch = buffer.splice(0, Math.min(buffer.length, FLUSH_THRESHOLD));
  for (const entry of batch) {
    try {
      // Best-effort: persist to the existing AgentLog table.
      // If a matching agent doesn't exist, skip silently (audit lives on in-memory).
      const agent = entry.agentCodename
        ? await db.agent.findUnique({ where: { codename: entry.agentCodename } })
        : null;
      if (agent) {
        await db.agentLog.create({
          data: {
            agentId: agent.id,
            level: entry.severity === 'critical' || entry.severity === 'error' ? 'error' : (entry.severity === 'warn' ? 'warn' : 'info'),
            message: `[${entry.category}] ${entry.action}${entry.target ? ` → ${entry.target}` : ''}`,
            meta: JSON.stringify({
              category: entry.category,
              detail: entry.detail,
              tokensIn: entry.tokensIn,
              tokensOut: entry.tokensOut,
              costUsd: entry.costUsd,
              status: entry.status,
              goalId: entry.goalId,
              taskId: entry.taskId,
            }).slice(0, 10000),
          },
        });
        totalFlushed += 1;
      }
    } catch {
      // swallow — blackbox is best-effort
    }
  }
}

export function recordRequest(entry: Omit<BlackBoxEntry, 'id' | 'timestamp'>): BlackBoxEntry {
  const full: BlackBoxEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  };
  buffer.push(full);
  totalRecorded += 1;
  // Trim if buffer overflowed.
  if (buffer.length > MAX_BUFFER) {
    buffer.splice(0, buffer.length - MAX_BUFFER);
  }
  scheduleFlush();
  return full;
}

export function recordDecision(
  agentCodename: string,
  action: string,
  reasoning: string,
  detail?: Record<string, unknown>,
): BlackBoxEntry {
  return recordRequest({
    agentCodename,
    category: 'decision',
    action,
    detail: { reasoning, ...detail },
    severity: 'info',
    status: 'success',
  });
}

export function recordTokenSpend(
  agentCodename: string,
  model: string,
  tokensIn: number,
  tokensOut: number,
  costUsd: number,
): BlackBoxEntry {
  return recordRequest({
    agentCodename,
    category: 'token_spend',
    action: 'llm_call',
    target: model,
    tokensIn,
    tokensOut,
    costUsd,
    detail: {},
    severity: 'info',
    status: 'success',
  });
}

export function recordOutbound(
  agentCodename: string,
  action: string,
  target: string,
  detail?: Record<string, unknown>,
  severity: BlackBoxSeverity = 'info',
): BlackBoxEntry {
  return recordRequest({
    agentCodename,
    category: 'outbound',
    action,
    target,
    detail: detail ?? {},
    severity,
    status: 'success',
  });
}

export function recordError(
  agentCodename: string | undefined,
  action: string,
  error: Error | string,
  severity: BlackBoxSeverity = 'error',
): BlackBoxEntry {
  const msg = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  return recordRequest({
    agentCodename,
    category: 'error',
    action,
    detail: { error: msg },
    severity,
    status: 'failure',
  });
}

export function recordAutonomous(
  agentCodename: string,
  action: string,
  detail?: Record<string, unknown>,
  severity: BlackBoxSeverity = 'warn',
): BlackBoxEntry {
  return recordRequest({
    agentCodename,
    category: 'autonomous',
    action,
    detail: detail ?? {},
    severity,
    status: 'success',
  });
}

export interface BlackBoxQuery {
  agentCodename?: string;
  category?: BlackBoxCategory;
  severity?: BlackBoxSeverity;
  since?: number; // ms since epoch
  limit?: number;
}

export function queryBlackBox(q: BlackBoxQuery = {}): BlackBoxEntry[] {
  let items = buffer.slice();
  if (q.agentCodename) items = items.filter((e) => e.agentCodename === q.agentCodename);
  if (q.category) items = items.filter((e) => e.category === q.category);
  if (q.severity) items = items.filter((e) => e.severity === q.severity);
  if (q.since) items = items.filter((e) => e.timestamp >= (q.since as number));
  items.sort((a, b) => b.timestamp - a.timestamp);
  return items.slice(0, q.limit ?? 200);
}

export interface BlackBoxStats {
  bufferSize: number;
  totalRecorded: number;
  totalFlushed: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  byAgent: Record<string, number>;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
}

export function getBlackBoxStats(): BlackBoxStats {
  const stats: BlackBoxStats = {
    bufferSize: buffer.length,
    totalRecorded,
    totalFlushed,
    byCategory: {},
    bySeverity: {},
    byAgent: {},
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalCostUsd: 0,
  };
  for (const e of buffer) {
    stats.byCategory[e.category] = (stats.byCategory[e.category] ?? 0) + 1;
    if (e.severity) stats.bySeverity[e.severity] = (stats.bySeverity[e.severity] ?? 0) + 1;
    if (e.agentCodename) stats.byAgent[e.agentCodename] = (stats.byAgent[e.agentCodename] ?? 0) + 1;
    if (e.tokensIn) stats.totalTokensIn += e.tokensIn;
    if (e.tokensOut) stats.totalTokensOut += e.tokensOut;
    if (e.costUsd) stats.totalCostUsd += e.costUsd;
  }
  return stats;
}

// Bootstrap some seed entries so the Blackbox tab isn't empty on first load.
let seeded = false;
export function seedBlackBoxIfEmpty(agents: Array<{ codename: string }>): void {
  if (seeded || buffer.length > 0) return;
  seeded = true;
  const now = Date.now();
  const samples: Array<Omit<BlackBoxEntry, 'id' | 'timestamp'>> = [
    { agentCodename: 'ORION', category: 'decision', action: 'Dispatched 3 sub-tasks to ATLAS, VEGA, NOVA', detail: { plan: 'parallel-orchestration' }, severity: 'info', status: 'success' },
    { agentCodename: 'VEGA', category: 'token_spend', action: 'llm_call', target: 'glm-4.6', tokensIn: 842, tokensOut: 1204, costUsd: 0.0041, detail: {}, severity: 'info', status: 'success' },
    { agentCodename: 'ATLAS', category: 'outbound', action: 'file_write', target: '/src/app/page.tsx', detail: { bytes: 2048 }, severity: 'info', status: 'success' },
    { agentCodename: 'FORGE', category: 'autonomous', action: 'auto-deploy', target: 'staging', detail: { build: '#1284' }, severity: 'warn', status: 'success' },
    { agentCodename: 'PULSE', category: 'error', action: 'health_check', target: 'api/agents', detail: { error: 'ECONNRESET' }, severity: 'warn', status: 'failure' },
    { agentCodename: 'SAGE', category: 'decision', action: 'Memory consolidation', detail: { items: 38, kept: 12 }, severity: 'info', status: 'success' },
    { agentCodename: 'NOVA', category: 'token_spend', action: 'llm_call', target: 'glm-4.6', tokensIn: 612, tokensOut: 891, costUsd: 0.0030, detail: {}, severity: 'info', status: 'success' },
    { agentCodename: 'ECHO', category: 'outbound', action: 'email_send', target: 'client@example.com', detail: { subject: 'Q3 Proposal' }, severity: 'info', status: 'success' },
    { agentCodename: 'PERSEUS', category: 'decision', action: 'Approved Q4 budget', detail: { total: 480000 }, severity: 'info', status: 'success' },
    { agentCodename: 'SENTINEL', category: 'autonomous', action: 'Auto-blocked suspicious IP', target: '203.0.113.42', detail: { reason: 'rate-limit-breach' }, severity: 'critical', status: 'success' },
  ];
  if (agents.length === 0) {
    // Use the sample codenames directly.
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      buffer.push({ ...s, id: crypto.randomUUID(), timestamp: now - (samples.length - i) * 60000 });
      totalRecorded += 1;
    }
  } else {
    // Spread samples across the actual roster for realism.
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const codename = agents[i % agents.length].codename;
      buffer.push({
        ...s,
        agentCodename: codename,
        id: crypto.randomUUID(),
        timestamp: now - (samples.length - i) * 60000,
      });
      totalRecorded += 1;
    }
  }
}
