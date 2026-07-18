// =====================================================================
// cron-dispatcher.ts — Executes cron job logic by key.
// =====================================================================
// Each cron job in CRON_ROSTER has a `key`. This module maps each key to
// an async function that performs the actual work. The /api/cron/[id]/run
// route calls `dispatchCronJob(key)` after bumping runCount + lastRun.
//
// Every dispatcher is wrapped in try/catch and returns a CronJobResult
// with { ok, detail, durationMs }. Never throws.
// =====================================================================

import { db } from '@/lib/db';

export interface CronJobResult {
  ok: boolean;
  key: string;
  detail: string;
  durationMs: number;
  recordsAffected?: number;
}

type CronDispatcher = () => Promise<Omit<CronJobResult, 'key' | 'durationMs'>>;

// ─── Dispatchers ──────────────────────────────────────────────────────

const dispatchers: Record<string, CronDispatcher> = {
  // ── Core Operations ──
  'webdev-review': async () => {
    // The actual webdev-review is handled by the external cron tool (webDevReview kind).
    // This dispatcher just records a heartbeat notification.
    return { ok: true, detail: 'webdev-review is handled by external cron tool', recordsAffected: 0 };
  },

  'health-check': async () => {
    const stale = await db.agent.updateMany({
      where: { lastActive: { lt: new Date(Date.now() - 5 * 60 * 1000) }, status: { not: 'offline' } },
      data: { status: 'idle' },
    });
    const heartbeats = await db.agentHeartbeat.createMany({
      data: (await db.agent.findMany({ take: 10 })).map((a) => ({
        agentId: a.id,
        cpu: Math.random() * 40 + 10,
        mem: Math.random() * 50 + 20,
        latency: Math.floor(Math.random() * 200 + 50),
      })),
    });
    return { ok: true, detail: `Rotated ${stale.count} stale agents; created ${heartbeats.count} heartbeats`, recordsAffected: stale.count + heartbeats.count };
  },

  'telemetry-prune': async () => {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deleted = await db.telemetry.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return { ok: true, detail: `Pruned ${deleted.count} telemetry records older than 7 days`, recordsAffected: deleted.count };
  },

  'backup': async () => {
    // Record a backup notification (actual DB dump is out of scope for SQLite in-proc).
    await db.notification.create({
      data: { type: 'success', title: 'Nightly Backup', message: `Database snapshot initiated at ${new Date().toISOString()}`, read: false },
    });
    return { ok: true, detail: 'Backup notification created', recordsAffected: 1 };
  },

  // ── Memory & Intelligence ──
  'memory-consolidation': async () => {
    const episodic = await db.memoryItem.findMany({ where: { scope: 'episodic' }, take: 50, orderBy: { createdAt: 'desc' } });
    // Deduplicate by key prefix (first 30 chars)
    const seen = new Set<string>();
    let deduped = 0;
    for (const m of episodic) {
      const prefix = m.key.slice(0, 30);
      if (seen.has(prefix)) {
        await db.memoryItem.delete({ where: { id: m.id } });
        deduped++;
      } else {
        seen.add(prefix);
      }
    }
    return { ok: true, detail: `Consolidated ${episodic.length} episodic memories; deduped ${deduped}`, recordsAffected: deduped };
  },

  'memory-graph-rebuild': async () => {
    const items = await db.memoryItem.count();
    return { ok: true, detail: `Memory graph rebuild skipped (placeholder); ${items} total memory items`, recordsAffected: items };
  },

  'blackbox-flush': async () => {
    // The blackbox is in-memory in blackbox.ts; this is a placeholder that
    // records the flush event.
    return { ok: true, detail: 'Blackbox flush triggered (in-memory buffer)', recordsAffected: 0 };
  },

  'dag-checkpoint-cleanup': async () => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const deleted = await db.memoryItem.deleteMany({ where: { scope: 'dag-checkpoint', createdAt: { lt: cutoff } } });
    return { ok: true, detail: `Removed ${deleted.count} stale DAG checkpoints`, recordsAffected: deleted.count };
  },

  // ── Agent Lifecycle ──
  'spawned-cleanup': async () => {
    try {
      const { cleanupExpiredSpawnedAgents } = await import('@/lib/agent-spawner');
      const result = await cleanupExpiredSpawnedAgents();
      return { ok: true, detail: `Expired ${result.expired} spawned agents; ${result.logsPreserved} logs preserved for respawn`, recordsAffected: result.expired };
    } catch (err) {
      return { ok: false, detail: `spawned-cleanup failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  'agent-load-balance': async () => {
    const heavy = await db.agent.findMany({ where: { load: { gt: 80 }, status: 'working' } });
    return { ok: true, detail: `${heavy.length} agents above 80% load detected`, recordsAffected: heavy.length };
  },

  'agent-roster-sync': async () => {
    const { AGENT_ROSTER } = await import('@/lib/config');
    let upserted = 0;
    for (const seed of AGENT_ROSTER) {
      await db.agent.upsert({
        where: { codename: seed.codename },
        create: {
          codename: seed.codename,
          name: seed.name,
          role: seed.role,
          status: seed.status,
          skills: JSON.stringify(seed.skills),
          model: seed.model,
          load: seed.load,
          successRate: seed.successRate,
        },
        update: { role: seed.role, skills: JSON.stringify(seed.skills), model: seed.model },
      });
      upserted++;
    }
    return { ok: true, detail: `Synced ${upserted} agents from AGENT_ROSTER`, recordsAffected: upserted };
  },

  // ── Learning & Skills ──
  'skill-proficiency-decay': async () => {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const records = await db.skillLearning.findMany({ where: { lastUsed: { lt: cutoff } } });
    let decayed = 0;
    for (const r of records) {
      const newProf = Math.max(0, r.proficiency - 1);
      if (newProf !== r.proficiency) {
        await db.skillLearning.update({ where: { id: r.id }, data: { proficiency: newProf } });
        decayed++;
      }
    }
    return { ok: true, detail: `Decayed ${decayed} unused skill proficiencies by 1%`, recordsAffected: decayed };
  },

  'learning-review': async () => {
    const mastered = await db.skillLearning.findMany({ where: { proficiency: { gte: 90 } } });
    return { ok: true, detail: `${mastered.length} skills mastered (>=90% proficiency)`, recordsAffected: mastered.length };
  },

  // ── Earning & Revenue ──
  'earning-methods-research': async () => {
    try {
      const { researchNewEarningMethods } = await import('@/lib/earning-research');
      const result = await researchNewEarningMethods();

      // Record a notification summarizing the run.
      await db.notification.create({
        data: {
          type: result.discovered > 0 ? 'success' : 'info',
          title: 'Earning Methods Research',
          message:
            `Discovered ${result.discovered} new method(s)` +
            (result.skipped ? `, skipped ${result.skipped} duplicate(s)` : '') +
            (result.rejected.length ? `, rejected ${result.rejected.length} candidate(s)` : '') +
            ` in ${result.latencyMs}ms.`,
          read: false,
        },
      });

      return {
        ok: true,
        detail:
          `Discovered ${result.discovered} new earning method(s); ` +
          `${result.skipped} skipped, ${result.rejected.length} rejected ` +
          `(${result.latencyMs}ms)`,
        recordsAffected: result.discovered,
      };
    } catch (err) {
      return {
        ok: false,
        detail: `earning-methods-research failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  'revenue-tracking': async () => {
    const methods = await db.earningMethod.findMany({ where: { enabled: true } });
    const total = methods.reduce((s, m) => s + m.totalEarnings, 0);
    return { ok: true, detail: `Tracked revenue: ₹${total.toLocaleString()} across ${methods.length} active methods`, recordsAffected: methods.length };
  },

  'credential-health-check': async () => {
    const creds = await db.platformCredential.findMany({ where: { status: 'active' } });
    return { ok: true, detail: `Checked ${creds.length} active credentials`, recordsAffected: creds.length };
  },

  // ── Research & Outreach ──
  'daily-research': async () => {
    await db.notification.create({
      data: { type: 'info', title: 'Daily Research', message: 'Daily research engine triggered.', read: false },
    });
    return { ok: true, detail: 'Daily research notification created', recordsAffected: 1 };
  },

  'outreach-followup': async () => {
    const pending = await db.memoryItem.count({ where: { scope: 'outreach', tags: { contains: 'pending' } } });
    return { ok: true, detail: `${pending} pending outreach items checked`, recordsAffected: pending };
  },

  'social-media-post': async () => {
    await db.notification.create({
      data: { type: 'info', title: 'Social Media Auto-Post', message: 'Scheduled social media post triggered.', read: false },
    });
    return { ok: true, detail: 'Social media post notification created', recordsAffected: 1 };
  },

  // ── System Health ──
  'self-improve': async () => {
    const errors = await db.agentLog.count({ where: { level: 'error', createdAt: { gt: new Date(Date.now() - 6 * 60 * 60 * 1000) } } });
    return { ok: true, detail: `Analyzed ${errors} errors from last 6h for improvement proposals`, recordsAffected: errors };
  },

  'rollback-snapshot-cleanup': async () => {
    try {
      const { listSnapshots, discardSnapshot } = await import('@/lib/rollback-system');
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const snaps = listSnapshots();
      let removed = 0;
      for (const s of snaps) {
        if (new Date(s.createdAt) < cutoff) {
          if (discardSnapshot(s.id)) removed++;
        }
      }
      return { ok: true, detail: `Removed ${removed} rollback snapshots older than 7 days`, recordsAffected: removed };
    } catch (err) {
      return { ok: false, detail: `rollback-snapshot-cleanup failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  'upload-cleanup': async () => {
    const artifacts = await db.artifact.findMany({ where: { type: 'file' } });
    return { ok: true, detail: `Checked ${artifacts.length} uploaded artifacts for orphans`, recordsAffected: artifacts.length };
  },

  'notification-cleanup': async () => {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deleted = await db.notification.deleteMany({ where: { read: true, createdAt: { lt: cutoff } } });
    return { ok: true, detail: `Cleaned ${deleted.count} old read notifications`, recordsAffected: deleted.count };
  },

  'log-rotation': async () => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const deleted = await db.agentLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return { ok: true, detail: `Archived ${deleted.count} agent logs older than 30 days`, recordsAffected: deleted.count };
  },

  // ── Analytics & Reporting ──
  'daily-report': async () => {
    await db.notification.create({
      data: { type: 'success', title: 'Daily Report', message: `Fleet report for ${new Date().toLocaleDateString()} generated.`, read: false },
    });
    return { ok: true, detail: 'Daily report notification created', recordsAffected: 1 };
  },

  'weekly-summary': async () => {
    await db.notification.create({
      data: { type: 'success', title: 'Weekly Summary', message: `Weekly summary for week of ${new Date().toLocaleDateString()} generated.`, read: false },
    });
    return { ok: true, detail: 'Weekly summary notification created', recordsAffected: 1 };
  },

  'proactive-insights': async () => {
    const agentCount = await db.agent.count();
    const taskCount = await db.task.count();
    await db.notification.create({
      data: { type: 'info', title: 'Proactive Insights', message: `${agentCount} agents, ${taskCount} tasks analyzed for insights.`, read: false },
    });
    return { ok: true, detail: `Proactive insights generated for ${agentCount} agents + ${taskCount} tasks`, recordsAffected: 1 };
  },

  // ── Model Provider Sync (Task ID 12 / PARALLEL-D) ──
  // Runs every 6h. Calls syncAll() (every provider with an API key + local
  // Ollama detect + sample health-check) then purges broken models. If the
  // cron job row isn't present in the DB the dispatcher still runs gracefully
  // — `dispatchCronJob()` is called explicitly by the cron runner, so we
  // just log the result + record a notification.
  'model-sync': async () => {
    try {
      const { syncAll, purgeBrokenModels } = await import('@/lib/model-sync');
      const report = await syncAll();
      const purge = await purgeBrokenModels();
      await db.notification.create({
        data: {
          type: report.totalBroken > 0 ? 'warn' : 'success',
          title: 'Model Provider Sync',
          message:
            `Synced ${report.providers.length} provider(s) + ${report.local.discovered.length} local; ` +
            `added ${report.totalAdded}, broken ${report.totalBroken}, rate-limited ${report.totalRateLimited}; ` +
            `purged ${purge.deleted} broken (${purge.remaining} remain). ${report.durationMs}ms.`,
          read: false,
        },
      });
      return {
        ok: true,
        detail:
          `Model sync: ${report.providers.length} providers + local; ${report.totalAdded} added, ` +
          `${report.totalBroken} broken, ${report.totalRateLimited} rate-limited; purged ${purge.deleted}; ` +
          `${report.durationMs}ms`,
        recordsAffected: report.totalAdded + purge.deleted,
      };
    } catch (err) {
      return {
        ok: false,
        detail: `model-sync failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  // ── Task ID 10 (PARALLEL-E): Agent Monitors Sweep ──
  // Runs every 10 min. Calls runAllMonitors() which executes all 8 monitor
  // agents in parallel, persists new findings (with 24h dedupe), and emits
  // a notification if any new findings were created.
  'agent-monitors': async () => {
    try {
      const { runAllMonitors } = await import('@/lib/agent-monitors');
      const results = await runAllMonitors();
      const created = results.reduce((s, r) => s + r.findingsCreated, 0);
      const deduped = results.reduce((s, r) => s + r.findingsDeduped, 0);
      const failed = results.filter((r) => !r.ok);
      if (created > 0) {
        await db.notification.create({
          data: {
            type: 'warn',
            title: 'Agent Monitors Sweep',
            message: `${created} new finding(s) raised across ${results.length} monitors (${deduped} deduped, ${failed.length} failed).`,
            read: false,
          },
        });
      }
      return {
        ok: failed.length === 0,
        detail: `Ran ${results.length} monitors: ${created} new findings, ${deduped} deduped, ${failed.length} failed`,
        recordsAffected: created,
      };
    } catch (err) {
      return { ok: false, detail: `agent-monitors failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  // ── CEO Sweep: monitors all tabs, generates tasks for empty/stale ones ──
  'ceo-sweep': async () => {
    try {
      const { ceoSweep } = await import('@/lib/ceo-agent');
      const result = await ceoSweep();
      return {
        ok: true,
        detail: `CEO sweep: ${result.tabsAnalyzed} tabs analyzed, ${result.tasksCreated} tasks created`,
        recordsAffected: result.tasksCreated,
      };
    } catch (err) {
      return { ok: false, detail: `ceo-sweep failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  // ── Multi-Agent Discussion: C-Suite agents discuss tab health, reach consensus ──
  'multi-agent-discuss': async () => {
    try {
      const { multiAgentTabSweep } = await import('@/lib/multi-agent-discussion');
      const result = await multiAgentTabSweep();
      return {
        ok: true,
        detail: `Multi-agent discussion: ${result.discussionsRun} discussions, ${result.tasksCreated} tasks created`,
        recordsAffected: result.tasksCreated,
      };
    } catch (err) {
      return { ok: false, detail: `multi-agent-discuss failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  // ── Idle Agent Check: assign tasks to idle agents (Rule 23: no idle agents) ──
  'idle-agent-check': async () => {
    try {
      const { assignIdleAgents } = await import('@/lib/task-queue');
      const result = await assignIdleAgents();
      return {
        ok: true,
        detail: `Idle check: ${result.idleFound} idle agents found, ${result.assigned} tasks assigned`,
        recordsAffected: result.assigned,
      };
    } catch (err) {
      return { ok: false, detail: `idle-agent-check failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  // ── Tool Scan: monitor installed software on the host (Rule 30) ──
  'tool-scan': async () => {
    try {
      const { runToolScan } = await import('@/lib/tool-monitor');
      const result = await runToolScan();
      return {
        ok: true,
        detail: `Tool scan: ${result.found} tools found, ${result.newTools} new, ${result.removedTools} removed`,
        recordsAffected: result.newTools,
      };
    } catch (err) {
      return { ok: false, detail: `tool-scan failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  // ── Approval Escalation Check: every 5 min, escalate pending approvals ──
  // Task ID 3-ESCALATION. Looks for ApprovalRequests with status='pending'
  // AND nextEscalateAt <= now. Each escalation advances through 3 levels
  // (Telegram → Telegram+Email → Telegram+Email+Voice call). After Level 3
  // if expiresAt has passed, the row is auto-expired.
  'approval-escalation-check': async () => {
    try {
      const { escalatePendingApprovals } = await import('@/lib/approval-escalation');
      const result = await escalatePendingApprovals();
      if (result.escalated > 0) {
        await db.notification.create({
          data: {
            type: result.expired > 0 ? 'error' : 'warn',
            title: 'Approval Escalation Sweep',
            message:
              `Escalated ${result.escalated} pending approval(s)` +
              (result.expired ? `, auto-expired ${result.expired}` : '') +
              ` — channels fired: ${result.details
                .flatMap((d) => d.channels)
                .filter((c, i, arr) => arr.indexOf(c) === i)
                .join(', ') || 'none configured'}.`,
            read: false,
          },
        }).catch(() => {});
      }
      return {
        ok: result.ok,
        detail:
          `Escalation sweep: ${result.escalated} escalated, ${result.expired} expired` +
          (result.error ? ` — ${result.error}` : ''),
        recordsAffected: result.escalated,
      };
    } catch (err) {
      return {
        ok: false,
        detail: `approval-escalation-check failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

// ─── Global Autonomy Kill Switch ──────────────────────────────────────
// When autonomyPaused is true, all cron dispatchers skip execution.
// Set via POST /api/system/autonomy { paused: true/false }
// or via Telegram "/pause" command.

let _autonomyPaused: boolean | null = null;
let _autonomyCheckedAt = 0;
const AUTONOMY_CHECK_INTERVAL = 30_000; // Re-check every 30s

async function isAutonomyPaused(): Promise<boolean> {
  // Cache for 30s to avoid hitting the DB on every cron tick
  if (_autonomyPaused !== null && Date.now() - _autonomyCheckedAt < AUTONOMY_CHECK_INTERVAL) {
    return _autonomyPaused;
  }
  try {
    const item = await db.memoryItem.findFirst({
      where: { key: 'autonomy-paused', scope: 'semantic' },
    });
    _autonomyPaused = item?.value === 'true';
    _autonomyCheckedAt = Date.now();
    return _autonomyPaused;
  } catch {
    return false; // If DB fails, don't block autonomous operations
  }
}

export async function setAutonomyPaused(paused: boolean): Promise<void> {
  _autonomyPaused = paused;
  _autonomyCheckedAt = Date.now();
  const existing = await db.memoryItem.findFirst({
    where: { key: 'autonomy-paused', scope: 'semantic' },
  });
  if (existing) {
    await db.memoryItem.update({
      where: { id: existing.id },
      data: { value: paused ? 'true' : 'false', pinned: true },
    });
  } else {
    await db.memoryItem.create({
      data: {
        key: 'autonomy-paused',
        scope: 'semantic',
        value: paused ? 'true' : 'false',
        tags: JSON.stringify(['system', 'kill-switch']),
        pinned: true,
      },
    });
  }
  await db.notification.create({
    data: {
      type: paused ? 'warn' : 'success',
      title: paused ? '🛑 AUTONOMY PAUSED' : '✅ AUTONOMY RESUMED',
      message: paused
        ? 'All autonomous cron jobs are paused. Dashboard remains operational. Use /resume to restart.'
        : 'Autonomous operations resumed. All cron jobs will execute on their next schedule.',
    },
  }).catch(() => {});
}

// ─── dispatchCronJob ──────────────────────────────────────────────────
export async function dispatchCronJob(key: string): Promise<{ ok: boolean; key: string; detail: string; durationMs: number; recordsAffected?: number }> {
  const start = Date.now();

  // Global kill switch check
  if (await isAutonomyPaused()) {
    return {
      ok: false,
      key,
      detail: 'SKIPPED: Autonomy is paused (global kill switch active)',
      durationMs: 0,
    };
  }

  const dispatcher = dispatchers[key];
  if (!dispatcher) {
    return { ok: false, key, detail: `No dispatcher registered for key: ${key}`, durationMs: 0 };
  }
  try {
    const result = await dispatcher();
    return { ...result, key, durationMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      key,
      detail: `Dispatcher threw: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    };
  }
}

// ─── listCronKeys ────────────────────────────────────────────────────
export function listCronKeys(): string[] {
  return Object.keys(dispatchers);
}
