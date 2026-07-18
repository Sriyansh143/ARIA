// =====================================================================
// agent-monitors.ts — Server-side Monitor Agents
// =====================================================================
// A registry of lightweight, self-contained monitor agents that scan the
// database for anomalies (broken agents, slow APIs, stale tasks, unpaid
// invoices, broken AI models, …) and persist findings to the
// `AgentMonitorFinding` table.
//
// Each monitor is idempotent, runs in isolation, and dedupes its own
// findings within a 24h window (no spam if the same condition persists).
//
// Monitors are invoked:
//   1. Manually via /api/agent-monitors (Run All / Run Now buttons)
//   2. Automatically by the `agent-monitors` cron job (every 10 min)
//   3. Programmatically via runMonitor(key) / runAllMonitors()
//
// Findings can suggest a navigation action (`actionTab` + `actionMeta`) so
// the operator can jump straight to the affected tab, and can be converted
// to Tasks via /api/agent-monitors/findings/[id]/create-task.
// =====================================================================

import { db } from '@/lib/db';

// ─── Types ───────────────────────────────────────────────────────────

export type MonitorSeverity = 'info' | 'warn' | 'error' | 'critical';
export type MonitorCategory =
  | 'bug'
  | 'performance'
  | 'ux'
  | 'security'
  | 'opportunity'
  | 'error-rate';

export interface MonitorFindingInput {
  /** Which tab is affected (e.g. 'fleet', 'tasks', 'comms'). */
  tab: string;
  severity: MonitorSeverity;
  category: MonitorCategory;
  /** Short headline — used for dedupe. */
  title: string;
  /** Long-form explanation. */
  detail: string;
  /** JSON-serializable evidence (metrics, agent ids, sample rows). */
  evidence?: Record<string, unknown>;
  /** Suggested action label e.g. "navigate:tasks", "create-task:fix-button". */
  suggestedAction?: string;
  /** Tab to navigate to when the operator clicks "Take Action". */
  actionTab?: string;
  /** Context payload passed to the nav store on action click. */
  actionMeta?: Record<string, unknown>;
}

export interface MonitorDef {
  key: string;
  name: string;
  description: string;
  intervalMs: number;
  /** Returns raw findings (persistence + dedupe handled by the runner). */
  check: () => Promise<MonitorFindingInput[]>;
}

export interface MonitorRunResult {
  key: string;
  ok: boolean;
  ranAt: string;
  durationMs: number;
  findingsCreated: number;
  findingsDeduped: number;
  error?: string;
}

// In-memory last-run cache. Persisted across requests via module singleton.
const lastRunByMonitor: Record<
  string,
  { ranAt: string; durationMs: number; findingsCreated: number; ok: boolean }
> = {};

// ─── Monitors ────────────────────────────────────────────────────────

const monitors: MonitorDef[] = [
  // ── 1. Fleet Watchdog ──
  // Flags agents stuck in error >5min, agents with 0% success, agents >90% load.
  {
    key: 'fleet-watchdog',
    name: 'Fleet Watchdog',
    description:
      'Scans the agent fleet for stuck agents (error state >5 min), agents with 0% success rate, and agents above 90% load.',
    intervalMs: 5 * 60 * 1000,
    check: async () => {
      const findings: MonitorFindingInput[] = [];
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

      const [errorAgents, zeroSuccessAgents, heavyAgents] = await Promise.all([
        db.agent.findMany({
          where: { status: 'error', lastActive: { lt: fiveMinAgo } },
          take: 20,
        }),
        db.agent.findMany({
          where: { successRate: 0 },
          take: 20,
        }),
        db.agent.findMany({
          where: { load: { gt: 90 } },
          take: 20,
        }),
      ]);

      if (errorAgents.length > 0) {
        findings.push({
          tab: 'fleet',
          severity: 'error',
          category: 'bug',
          title: `${errorAgents.length} agent(s) stuck in error state`,
          detail: `Agents in error state for >5 min: ${errorAgents
            .map((a) => `${a.codename} (${a.role})`)
            .join(', ')}. Recommend restarting via Health tab.`,
          evidence: {
            count: errorAgents.length,
            agents: errorAgents.map((a) => ({
              codename: a.codename,
              role: a.role,
              lastActive: a.lastActive,
              status: a.status,
            })),
          },
          suggestedAction: 'navigate:fleet',
          actionTab: 'fleet',
          actionMeta: { filter: 'error', focusAgentId: errorAgents[0]?.id },
        });
      }

      if (zeroSuccessAgents.length > 0) {
        findings.push({
          tab: 'fleet',
          severity: 'warn',
          category: 'bug',
          title: `${zeroSuccessAgents.length} agent(s) with 0% success rate`,
          detail: `Agents with 0% success rate: ${zeroSuccessAgents
            .map((a) => `${a.codename} (${a.successRate}%)`)
            .join(', ')}. Possible misconfiguration or repeated failures.`,
          evidence: {
            count: zeroSuccessAgents.length,
            agents: zeroSuccessAgents.map((a) => ({
              codename: a.codename,
              successRate: a.successRate,
            })),
          },
          suggestedAction: 'navigate:fleet',
          actionTab: 'fleet',
          actionMeta: { filter: 'low-success' },
        });
      }

      if (heavyAgents.length > 0) {
        findings.push({
          tab: 'fleet',
          severity: 'warn',
          category: 'performance',
          title: `${heavyAgents.length} agent(s) above 90% load`,
          detail: `Agents above 90% load: ${heavyAgents
            .map((a) => `${a.codename} (${Math.round(a.load)}%)`)
            .join(', ')}. Consider spawning sub-agents to redistribute work.`,
          evidence: {
            count: heavyAgents.length,
            agents: heavyAgents.map((a) => ({
              codename: a.codename,
              load: a.load,
              status: a.status,
            })),
          },
          suggestedAction: 'navigate:fleet',
          actionTab: 'fleet',
          actionMeta: { filter: 'high-load' },
        });
      }

      return findings;
    },
  },

  // ── 2. API Sentinel ──
  // Checks UserAction table for recent error rates + slow submits (>2s).
  {
    key: 'api-sentinel',
    name: 'API Sentinel',
    description:
      'Watches the UserAction stream for elevated error rates and slow submissions (>2s duration). Surfaces UX friction + broken endpoints.',
    intervalMs: 5 * 60 * 1000,
    check: async () => {
      const findings: MonitorFindingInput[] = [];
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      const [errorActions, slowActions, totalActions] = await Promise.all([
        db.userAction.count({
          where: { type: 'error', createdAt: { gt: oneHourAgo } },
        }),
        db.userAction.findMany({
          where: { duration: { gt: 2000 }, createdAt: { gt: oneHourAgo } },
          take: 50,
          orderBy: { duration: 'desc' },
        }),
        db.userAction.count({
          where: { createdAt: { gt: oneHourAgo } },
        }),
      ]);

      const errorRate = totalActions > 0 ? (errorActions / totalActions) * 100 : 0;

      if (errorActions >= 5 || errorRate >= 10) {
        findings.push({
          tab: 'agent-monitor',
          severity: errorRate >= 25 ? 'critical' : 'error',
          category: 'error-rate',
          title: `Elevated error rate: ${errorRate.toFixed(1)}% (${errorActions} errors in last hour)`,
          detail: `${errorActions} user-facing errors recorded in the last hour out of ${totalActions} total actions. This may indicate broken buttons, failing form submits, or JS exceptions.`,
          evidence: { errorCount: errorActions, totalActions, errorRate: Number(errorRate.toFixed(2)) },
          suggestedAction: 'navigate:logs',
          actionTab: 'logs',
          actionMeta: { level: 'error' },
        });
      }

      if (slowActions.length > 0) {
        const slowest = slowActions[0]!;
        findings.push({
          tab: 'agent-monitor',
          severity: 'warn',
          category: 'performance',
          title: `${slowActions.length} slow action(s) detected (>2s duration)`,
          detail: `Slowest action took ${slowest.duration}ms — type "${slowest.type}" on tab "${slowest.tab ?? '?'}" target "${slowest.target ?? '?'}". Possible slow API or heavy client render.`,
          evidence: {
            count: slowActions.length,
            slowest: {
              type: slowest.type,
              tab: slowest.tab,
              target: slowest.target,
              duration: slowest.duration,
            },
            allSlow: slowActions.map((a) => ({
              type: a.type,
              tab: a.tab,
              target: a.target,
              duration: a.duration,
            })),
          },
          suggestedAction: 'navigate:logs',
          actionTab: 'logs',
        });
      }

      return findings;
    },
  },

  // ── 3. Health Monitor ──
  // Checks system CPU/MEM/DISK thresholds from Telemetry table.
  {
    key: 'health-monitor',
    name: 'System Health Monitor',
    description:
      'Checks the most recent Telemetry row against CPU >80%, MEM >85%, DISK >90% thresholds. Emits critical findings on breach.',
    intervalMs: 2 * 60 * 1000,
    check: async () => {
      const findings: MonitorFindingInput[] = [];
      const latest = await db.telemetry.findFirst({
        orderBy: { createdAt: 'desc' },
      });

      if (!latest) return findings; // no telemetry yet — don't spam

      if (latest.cpu > 80) {
        findings.push({
          tab: 'telemetry',
          severity: latest.cpu > 95 ? 'critical' : 'error',
          category: 'performance',
          title: `CPU usage critical: ${latest.cpu.toFixed(1)}%`,
          detail: `System CPU is at ${latest.cpu.toFixed(1)}% (threshold 80%). Sustained high CPU can cause agent timeouts and slow responses.`,
          evidence: { cpu: latest.cpu, mem: latest.mem, disk: latest.disk, sampledAt: latest.createdAt },
          suggestedAction: 'navigate:telemetry',
          actionTab: 'telemetry',
          actionMeta: { metric: 'cpu' },
        });
      }

      if (latest.mem > 85) {
        findings.push({
          tab: 'telemetry',
          severity: latest.mem > 95 ? 'critical' : 'error',
          category: 'performance',
          title: `Memory usage critical: ${latest.mem.toFixed(1)}%`,
          detail: `System memory is at ${latest.mem.toFixed(1)}% (threshold 85%). May cause OOM crashes or agent eviction.`,
          evidence: { cpu: latest.cpu, mem: latest.mem, disk: latest.disk, sampledAt: latest.createdAt },
          suggestedAction: 'navigate:telemetry',
          actionTab: 'telemetry',
          actionMeta: { metric: 'mem' },
        });
      }

      if (latest.disk > 90) {
        findings.push({
          tab: 'telemetry',
          severity: 'critical',
          category: 'performance',
          title: `Disk usage critical: ${latest.disk.toFixed(1)}%`,
          detail: `Disk is at ${latest.disk.toFixed(1)}% (threshold 90%). SQLite writes may fail soon — prune logs/telemetry or expand storage.`,
          evidence: { cpu: latest.cpu, mem: latest.mem, disk: latest.disk, sampledAt: latest.createdAt },
          suggestedAction: 'navigate:telemetry',
          actionTab: 'telemetry',
          actionMeta: { metric: 'disk' },
        });
      }

      return findings;
    },
  },

  // ── 4. Task Watcher ──
  // Flags stale in_progress tasks (>3 days) and blocked tasks.
  {
    key: 'task-watcher',
    name: 'Task Watcher',
    description:
      'Flags tasks stuck in `in_progress` for >3 days and blocked tasks whose dependencies have not resolved.',
    intervalMs: 30 * 60 * 1000,
    check: async () => {
      const findings: MonitorFindingInput[] = [];
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

      const [staleTasks, blockedLinks] = await Promise.all([
        db.task.findMany({
          where: { status: 'in_progress', updatedAt: { lt: threeDaysAgo } },
          take: 30,
          orderBy: { updatedAt: 'asc' },
        }),
        db.taskLink.findMany({ take: 200 }),
      ]);

      if (staleTasks.length > 0) {
        findings.push({
          tab: 'tasks',
          severity: 'warn',
          category: 'bug',
          title: `${staleTasks.length} task(s) stuck in_progress >3 days`,
          detail: `Stale tasks: ${staleTasks
            .slice(0, 5)
            .map((t) => `"${t.title}" (updated ${t.updatedAt.toISOString().slice(0, 10)})`)
            .join(', ')}${staleTasks.length > 5 ? ` … +${staleTasks.length - 5} more` : ''}. Consider breaking them down or cancelling.`,
          evidence: {
            count: staleTasks.length,
            tasks: staleTasks.slice(0, 10).map((t) => ({
              id: t.id,
              title: t.title,
              priority: t.priority,
              updatedAt: t.updatedAt,
            })),
          },
          suggestedAction: 'navigate:tasks',
          actionTab: 'tasks',
          actionMeta: { filter: 'stale' },
        });
      }

      // Build blocked-task map: a task is blocked if any dependsOnId is not completed.
      if (blockedLinks.length > 0) {
        const taskIds = new Set<string>();
        blockedLinks.forEach((l) => {
          taskIds.add(l.taskId);
          taskIds.add(l.dependsOnId);
        });
        const tasks = await db.task.findMany({
          where: { id: { in: Array.from(taskIds) } },
          select: { id: true, title: true, status: true, priority: true },
        });
        const taskMap = new Map(tasks.map((t) => [t.id, t]));
        const blockedTasks: Array<{ id: string; title: string; blockingStatuses: string[] }> = [];
        for (const link of blockedLinks) {
          const t = taskMap.get(link.taskId);
          const dep = taskMap.get(link.dependsOnId);
          if (!t || !dep) continue;
          if (t.status !== 'completed' && t.status !== 'cancelled' && dep.status !== 'completed') {
            const existing = blockedTasks.find((b) => b.id === t.id);
            if (existing) existing.blockingStatuses.push(`${dep.title} (${dep.status})`);
            else blockedTasks.push({ id: t.id, title: t.title, blockingStatuses: [`${dep.title} (${dep.status})`] });
          }
        }
        if (blockedTasks.length > 0) {
          findings.push({
            tab: 'tasks',
            severity: 'info',
            category: 'ux',
            title: `${blockedTasks.length} blocked task(s) with unresolved dependencies`,
            detail: `Tasks blocked by incomplete dependencies: ${blockedTasks
              .slice(0, 5)
              .map((b) => `"${b.title}" (blocked by ${b.blockingStatuses.join(', ')})`)
              .join('; ')}${blockedTasks.length > 5 ? ` … +${blockedTasks.length - 5} more` : ''}.`,
            evidence: {
              count: blockedTasks.length,
              blocked: blockedTasks.slice(0, 10),
            },
            suggestedAction: 'navigate:task-dag',
            actionTab: 'task-dag',
          });
        }
      }

      return findings;
    },
  },

  // ── 5. Comms Watcher ──
  // Flags unread high-priority comms >24h old.
  {
    key: 'comm-watcher',
    name: 'Comms Watcher',
    description:
      'Flags unread high/urgent priority agent messages older than 24h. These may be alerts from autonomous agents that need attention.',
    intervalMs: 30 * 60 * 1000,
    check: async () => {
      const findings: MonitorFindingInput[] = [];
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const unread = await db.agentMessage.findMany({
        where: {
          read: false,
          priority: { in: ['high', 'urgent'] },
          createdAt: { lt: oneDayAgo },
        },
        take: 30,
        orderBy: { createdAt: 'asc' },
      });

      if (unread.length > 0) {
        const urgent = unread.filter((m) => m.priority === 'urgent');
        findings.push({
          tab: 'comms',
          severity: unread.some((m) => m.priority === 'urgent') ? 'error' : 'warn',
          category: 'ux',
          title: `${unread.length} unread high-priority message(s) >24h old (${urgent.length} urgent)`,
          detail: `Oldest unread: "${unread[0]!.subject}" from ${unread[0]!.fromAgent} (${unread[0]!.createdAt.toISOString().slice(0, 10)}). High-priority comms going unread may indicate an unhandled escalation.`,
          evidence: {
            count: unread.length,
            urgentCount: urgent.length,
            oldest: {
              from: unread[0]!.fromAgent,
              subject: unread[0]!.subject,
              createdAt: unread[0]!.createdAt,
            },
            messages: unread.slice(0, 10).map((m) => ({
              id: m.id,
              from: m.fromAgent,
              to: m.toAgent,
              subject: m.subject,
              priority: m.priority,
              createdAt: m.createdAt,
            })),
          },
          suggestedAction: 'navigate:comms',
          actionTab: 'comms',
          actionMeta: { filter: 'unread-high' },
        });
      }

      return findings;
    },
  },

  // ── 6. Cron Monitor ──
  // Flags cron jobs that haven't run in 2x their interval.
  {
    key: 'cron-monitor',
    name: 'Cron Monitor',
    description:
      'Flags enabled cron jobs whose last run is older than 2x their schedule interval. May indicate a stalled scheduler.',
    intervalMs: 15 * 60 * 1000,
    check: async () => {
      const findings: MonitorFindingInput[] = [];
      const jobs = await db.cronJob.findMany({
        where: { enabled: true },
      });

      const stale: Array<{ key: string; name: string; schedule: string; lastRun: Date | null; expectedEveryMin: number }> = [];
      for (const job of jobs) {
        // Parse "*/N * * * *" or "N * * * *" → expected interval in minutes.
        const minField = job.schedule.split(' ')[0]!;
        let expectedMin = 60; // default hourly
        if (minField.startsWith('*/')) {
          expectedMin = parseInt(minField.slice(2), 10) || 60;
        } else if (/^\d+$/.test(minField)) {
          // Specific minute(s) → assume hourly
          expectedMin = 60;
        }
        const staleAfterMs = expectedMin * 2 * 60 * 1000;
        if (!job.lastRun) {
          // Never run — only flag if it's been more than 2x interval since creation.
          if (Date.now() - job.createdAt.getTime() > staleAfterMs) {
            stale.push({ key: job.key, name: job.name, schedule: job.schedule, lastRun: null, expectedEveryMin: expectedMin });
          }
        } else if (Date.now() - job.lastRun.getTime() > staleAfterMs) {
          stale.push({ key: job.key, name: job.name, schedule: job.schedule, lastRun: job.lastRun, expectedEveryMin: expectedMin });
        }
      }

      if (stale.length > 0) {
        findings.push({
          tab: 'scheduler',
          severity: stale.length >= 5 ? 'error' : 'warn',
          category: 'bug',
          title: `${stale.length} cron job(s) haven't run in 2x their interval`,
          detail: `Stale jobs: ${stale
            .slice(0, 5)
            .map((j) => `${j.name} (last run: ${j.lastRun ? j.lastRun.toISOString().slice(0, 16) : 'never'})`)
            .join(', ')}${stale.length > 5 ? ` … +${stale.length - 5} more` : ''}. Check the scheduler service.`,
          evidence: {
            count: stale.length,
            jobs: stale.slice(0, 20).map((j) => ({
              key: j.key,
              name: j.name,
              schedule: j.schedule,
              lastRun: j.lastRun,
              expectedEveryMin: j.expectedEveryMin,
            })),
          },
          suggestedAction: 'navigate:scheduler',
          actionTab: 'scheduler',
        });
      }

      return findings;
    },
  },

  // ── 7. Payment Monitor ──
  // Flags pending payments >7 days old.
  {
    key: 'payment-monitor',
    name: 'Payment Monitor',
    description:
      'Flags payments stuck in `pending` status for >7 days. These may be failed payouts that need manual confirmation.',
    intervalMs: 60 * 60 * 1000,
    check: async () => {
      const findings: MonitorFindingInput[] = [];
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const pending = await db.payment.findMany({
        where: { status: 'pending', createdAt: { lt: sevenDaysAgo } },
        take: 30,
        orderBy: { createdAt: 'asc' },
      });

      if (pending.length > 0) {
        const totalAmount = pending.reduce((s, p) => s + p.amount, 0);
        findings.push({
          tab: 'payments',
          severity: 'warn',
          category: 'bug',
          title: `${pending.length} pending payment(s) >7 days old (₹${totalAmount.toFixed(2)})`,
          detail: `Oldest pending: ₹${pending[0]!.amount.toFixed(2)} ${pending[0]!.currency} via ${pending[0]!.method} created ${pending[0]!.createdAt.toISOString().slice(0, 10)}. May need manual confirmation or refund.`,
          evidence: {
            count: pending.length,
            totalAmount,
            oldest: {
              amount: pending[0]!.amount,
              currency: pending[0]!.currency,
              method: pending[0]!.method,
              createdAt: pending[0]!.createdAt,
            },
          },
          suggestedAction: 'navigate:payments',
          actionTab: 'payments',
          actionMeta: { filter: 'pending' },
        });
      }

      return findings;
    },
  },

  // ── 8. Model Watchdog ──
  // Flags AI models with status='broken'.
  {
    key: 'model-watchdog',
    name: 'Model Watchdog',
    description:
      'Counts AI models marked as `broken` (provider sync failed, deprecated, or returning errors). Suggests a provider re-sync.',
    intervalMs: 30 * 60 * 1000,
    check: async () => {
      const findings: MonitorFindingInput[] = [];

      const [brokenCount, brokenModels] = await Promise.all([
        db.model.count({ where: { status: 'broken' } }),
        db.model.findMany({
          where: { status: 'broken' },
          take: 20,
          select: { id: true, providerKey: true, modelId: true, status: true, lastChecked: true },
        }),
      ]);

      if (brokenCount > 0) {
        findings.push({
          tab: 'models',
          severity: brokenCount >= 5 ? 'error' : 'warn',
          category: 'bug',
          title: `${brokenCount} model(s) marked as broken`,
          detail: `Broken models: ${brokenModels
            .slice(0, 5)
            .map((m) => `${m.modelId} (${m.providerKey})`)
            .join(', ')}${brokenModels.length > 5 ? ` … +${brokenModels.length - 5} more` : ''}. Run a provider sync to refresh.`,
          evidence: {
            count: brokenCount,
            models: brokenModels.map((m) => ({
              id: m.id,
              providerKey: m.providerKey,
              modelId: m.modelId,
              lastChecked: m.lastChecked,
            })),
          },
          suggestedAction: 'navigate:models',
          actionTab: 'models',
          actionMeta: { filter: 'broken' },
        });
      }

      return findings;
    },
  },
];

// ─── Registry helpers ────────────────────────────────────────────────

export function listMonitors(): MonitorDef[] {
  return monitors;
}

export function getMonitor(key: string): MonitorDef | undefined {
  return monitors.find((m) => m.key === key);
}

export function getLastRun(key: string): MonitorRunResult['ranAt'] | null {
  return lastRunByMonitor[key]?.ranAt ?? null;
}

export function getAllLastRuns(): Record<string, { ranAt: string; durationMs: number; findingsCreated: number; ok: boolean }> {
  return { ...lastRunByMonitor };
}

// ─── Persistence + dedupe ────────────────────────────────────────────

/**
 * Persist a finding IF no open finding with the same (monitorKey, title)
 * exists in the last 24h. Returns true if created, false if deduped.
 */
async function persistFinding(
  monitorKey: string,
  input: MonitorFindingInput,
): Promise<{ created: boolean; id?: string }> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await db.agentMonitorFinding.findFirst({
    where: {
      monitorKey,
      title: input.title,
      status: 'open',
      createdAt: { gt: oneDayAgo },
    },
    select: { id: true },
  });
  if (existing) {
    return { created: false };
  }
  const created = await db.agentMonitorFinding.create({
    data: {
      monitorKey,
      tab: input.tab,
      severity: input.severity,
      category: input.category,
      title: input.title,
      detail: input.detail,
      evidence: JSON.stringify(input.evidence ?? {}),
      suggestedAction: input.suggestedAction ?? null,
      actionTab: input.actionTab ?? null,
      actionMeta: JSON.stringify(input.actionMeta ?? {}),
      status: 'open',
    },
  });
  return { created: true, id: created.id };
}

// ─── Runners ─────────────────────────────────────────────────────────

/**
 * Run a single monitor by key. Persists findings (with dedupe) and updates
 * the in-memory last-run cache. NEVER throws — returns an error result.
 */
export async function runMonitor(key: string): Promise<MonitorRunResult> {
  const start = Date.now();
  const monitor = getMonitor(key);
  if (!monitor) {
    return {
      key,
      ok: false,
      ranAt: new Date().toISOString(),
      durationMs: 0,
      findingsCreated: 0,
      findingsDeduped: 0,
      error: `Unknown monitor key: ${key}`,
    };
  }
  try {
    const rawFindings = await monitor.check();
    let created = 0;
    let deduped = 0;
    for (const f of rawFindings) {
      const result = await persistFinding(monitor.key, f);
      if (result.created) created++;
      else deduped++;
    }
    const durationMs = Date.now() - start;
    lastRunByMonitor[monitor.key] = {
      ranAt: new Date().toISOString(),
      durationMs,
      findingsCreated: created,
      ok: true,
    };
    return {
      key: monitor.key,
      ok: true,
      ranAt: new Date().toISOString(),
      durationMs,
      findingsCreated: created,
      findingsDeduped: deduped,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    lastRunByMonitor[monitor.key] = {
      ranAt: new Date().toISOString(),
      durationMs,
      findingsCreated: 0,
      ok: false,
    };
    return {
      key: monitor.key,
      ok: false,
      ranAt: new Date().toISOString(),
      durationMs,
      findingsCreated: 0,
      findingsDeduped: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Run ALL monitors in parallel. Returns a result for each. NEVER throws.
 */
export async function runAllMonitors(): Promise<MonitorRunResult[]> {
  const results = await Promise.all(monitors.map((m) => runMonitor(m.key)));
  return results;
}
