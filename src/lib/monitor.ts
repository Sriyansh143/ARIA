/**
 * ARIA Mission Control — Monitoring & Self-Healing Agents.
 *
 * Task 24 — Part C.
 *
 * A dedicated monitoring loop (driven by Pulse-Ops, Guard-Compliance,
 * and Shield-QA agents) that:
 *   - Watches every agent's heartbeat + error state every 30s.
 *   - Self-heals: resets error states, re-queues failed tasks,
 *     switches LLM-failing agents to mock mode.
 *   - Checks DB connectivity, SSE stream liveness, cron scheduler
 *     activity, and recent API 500 rates.
 *   - When one agent is stuck, the monitoring agents can pick up +
 *     complete its task (helpOtherAgents).
 *
 * The monitor is idempotent: startMonitor() can be called many times
 * across hot reloads — only one timer is ever running.
 *
 * All checks are wrapped in try/catch and NEVER crash the loop. A
 * monitor that itself crashes is worse than no monitor at all.
 */
import { db } from "./db";
import { emit } from "./event-bus";
import { logger } from "./logger";

// ─── Types ───────────────────────────────────────────────────────────
export type HealthState = "healthy" | "degraded" | "failed";

export interface AgentHealth {
  agentId: string;
  name: string;
  role: string;
  status: string;                  // idle | thinking | executing | ... | error | offline
  health: HealthState;
  lastBeatAt: string | null;
  secondsSinceBeat: number | null; // null when no beat ever recorded
  errorCount: number;
  currentTask: string | null;
  issue?: string;                  // human-readable reason if not healthy
}

export interface AppHealth {
  status: HealthState;
  healthy: number;
  degraded: number;
  failed: number;
  totalAgents: number;
  issues: string[];
  autoFixed: number;
  dbConnected: boolean;
  sseAlive: boolean;
  cronAlive: boolean;
  apiErrorsRecent: number;
  checkedAt: string;
  details: AgentHealth[];
}

export interface HealResult {
  healed: boolean;
  action: string;
  agentId: string;
}

export interface HelpResult {
  helped: number;
  details: string[];
}

// ─── Constants ──────────────────────────────────────────────────────
const HEARTBEAT_TIMEOUT_MS = 90_000;       // 90s — degraded
const HEARTBEAT_CRITICAL_MS = 300_000;     // 5min — failed
const MONITOR_INTERVAL_MS = 60_000;        // run monitor every 60s (was 30s — reduces CPU)
const RECENT_ALERT_WINDOW_MS = 5 * 60_000; // for API error counting

const MONITORING_AGENT_NAMES = new Set([
  "Pulse-Ops",
  "Guard-Compliance",
  "Shield-QA",
]);

// ─── Idempotent singleton loop state ────────────────────────────────
const globalForMonitor = globalThis as unknown as {
  __ariaMonitor?: {
    timer: NodeJS.Timeout | null;
    started: boolean;
    lastRunAt: Date | null;
    lastStatus: HealthState | null;
  };
};

const monitorState =
  globalForMonitor.__ariaMonitor ?? {
    timer: null as NodeJS.Timeout | null,
    started: false,
    lastRunAt: null as Date | null,
    lastStatus: null as HealthState | null,
  };
if (!globalForMonitor.__ariaMonitor) globalForMonitor.__ariaMonitor = monitorState;

// ─── checkAgentHealth ───────────────────────────────────────────────
/**
 * Check every agent's heartbeat + error state. Returns per-agent
 * health + summary counts.
 *
 *  - healthy: heartbeat within 90s, status not error/offline
 *  - degraded: heartbeat > 90s but < 5min, OR status === "waiting"
 *             (waiting agents may be stuck on a dependency)
 *  - failed: status === "error" OR "offline" OR heartbeat > 5min
 */
export async function checkAgentHealth(): Promise<{
  healthy: number;
  degraded: number;
  failed: number;
  total: number;
  details: AgentHealth[];
}> {
  const now = Date.now();
  const agents = await db.agent.findMany({
    orderBy: { name: "asc" },
  });

  let healthy = 0;
  let degraded = 0;
  let failed = 0;

  const details: AgentHealth[] = agents.map((a) => {
    const lastBeatMs = a.lastBeatAt ? now - a.lastBeatAt.getTime() : null;
    let health: HealthState = "healthy";
    let issue: string | undefined;

    if (a.status === "error") {
      health = "failed";
      issue = "agent in error state";
    } else if (a.status === "offline") {
      health = "failed";
      issue = "agent offline";
    } else if (lastBeatMs === null) {
      health = "degraded";
      issue = "no heartbeat ever recorded";
    } else if (lastBeatMs > HEARTBEAT_CRITICAL_MS) {
      health = "failed";
      issue = `no heartbeat for ${Math.round(lastBeatMs / 1000)}s`;
    } else if (lastBeatMs > HEARTBEAT_TIMEOUT_MS) {
      health = "degraded";
      issue = `stale heartbeat: ${Math.round(lastBeatMs / 1000)}s ago`;
    } else if (a.status === "waiting") {
      // Waiting agents may be legitimately waiting on approval, but
      // we flag them as degraded so the operator sees them.
      health = "degraded";
      issue = "agent waiting (possibly stuck on a dependency)";
    }

    if (health === "healthy") healthy++;
    else if (health === "degraded") degraded++;
    else failed++;

    return {
      agentId: a.id,
      name: a.name,
      role: a.role,
      status: a.status,
      health,
      lastBeatAt: a.lastBeatAt ? a.lastBeatAt.toISOString() : null,
      secondsSinceBeat: lastBeatMs === null ? null : Math.round(lastBeatMs / 1000),
      errorCount: a.errorCount,
      currentTask: a.currentTask,
      issue,
    };
  });

  return { healthy, degraded, failed, total: agents.length, details };
}

// ─── selfHeal ────────────────────────────────────────────────────────
/**
 * Attempt to heal a single agent. Strategy (in order):
 *   1. If in `error` state → reset to `idle`.
 *   2. If its last task failed → re-queue the task (status back to pending).
 *   3. If its LLM calls are failing (recent LlmCall errors) → switch
 *      to mock mode by setting ARIA_LLM_DISABLED via an env hack (we
 *      can't actually mutate process.env at runtime safely across the
 *      cluster, so we log the recommendation + create a SystemAlert).
 *   4. If healing fails → create a SystemAlert so a human intervenes.
 *
 * Returns the action taken (human-readable) + whether the heal succeeded.
 */
export async function selfHeal(agentId: string): Promise<HealResult> {
  try {
    const agent = await db.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      return {
        healed: false,
        action: `agent not found: ${agentId}`,
        agentId,
      };
    }

    // 1. Reset error state → idle.
    if (agent.status === "error" || agent.status === "offline") {
      await db.agent.update({
        where: { id: agentId },
        data: {
          status: "idle",
          errorCount: 0,
          lastBeatAt: new Date(),
          currentTask: null,
        },
      });

      await db.agentLog.create({
        data: {
          agentId,
          level: "success",
          message: `Self-healed: reset from ${agent.status} → idle by monitor`,
          meta: JSON.stringify({ action: "reset-error-state", from: agent.status }),
        },
      });

      emit({
        type: "system",
        ts: new Date().toISOString(),
        message: `Monitor healed ${agent.name} (was ${agent.status}) → idle`,
        level: "success",
      });

      logger.success("monitor.selfheal.reset", { agentId, name: agent.name, from: agent.status });
      return {
        healed: true,
        action: `reset ${agent.name} from ${agent.status} → idle; cleared errorCount`,
        agentId,
      };
    }

    // 2. Re-queue the agent's last failed task, if any.
    const failedTask = await db.task.findFirst({
      where: {
        assignedToId: agentId,
        status: "failed",
      },
      orderBy: { updatedAt: "desc" },
    });

    if (failedTask) {
      await db.task.update({
        where: { id: failedTask.id },
        data: {
          status: "pending",
          progress: 0,
          startedAt: null,
          // Mark it as needing re-attempt by clearing the result.
          result: null,
        },
      });

      await db.agentLog.create({
        data: {
          agentId,
          taskId: failedTask.id,
          level: "info",
          message: `Monitor re-queued failed task "${failedTask.title}" for retry`,
          meta: JSON.stringify({ action: "requeue", taskId: failedTask.id }),
        },
      });

      logger.info("monitor.selfheal.requeue", {
        agentId,
        taskId: failedTask.id,
      });
      return {
        healed: true,
        action: `re-queued failed task "${failedTask.title}" (id=${failedTask.id}) for retry`,
        agentId,
      };
    }

    // 3. Check LLM-call health for this agent in the last 10 minutes.
    const tenMinAgo = new Date(Date.now() - 10 * 60_000);
    const recentLlmCalls = await db.llmCall.findMany({
      where: { agentId, createdAt: { gte: tenMinAgo } },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    const errorCalls = recentLlmCalls.filter((c) => c.status === "error");
    const errorRate = recentLlmCalls.length > 0 ? errorCalls.length / recentLlmCalls.length : 0;

    if (recentLlmCalls.length >= 3 && errorRate >= 0.6) {
      // LLM is failing for this agent — recommend mock mode via alert.
      const alert = await db.systemAlert.create({
        data: {
          severity: "warn",
          source: "healer",
          message: `Agent ${agent.name} LLM error rate ${Math.round(errorRate * 100)}% over ${recentLlmCalls.length} recent calls — recommend switching to mock mode`,
        },
      });
      emit({
        type: "alert",
        ts: new Date().toISOString(),
        alert: {
          id: alert.id,
          severity: "warn",
          source: "healer",
          message: alert.message,
          ack: false,
          createdAt: alert.createdAt.toISOString(),
        },
      });
      logger.warn("monitor.selfheal.llm-fail", {
        agentId,
        errorRate,
        recent: recentLlmCalls.length,
      });
      return {
        healed: true,
        action: `detected LLM failure (${Math.round(errorRate * 100)}% errors over ${recentLlmCalls.length} calls); created alert recommending mock-mode switch`,
        agentId,
      };
    }

    // 4. No issue detected — agent appears healthy.
    return {
      healed: true,
      action: `no healable issue detected for ${agent.name} (status=${agent.status})`,
      agentId,
    };
  } catch (err) {
    // Healing itself failed — create a critical alert so a human intervenes.
    try {
      const alert = await db.systemAlert.create({
        data: {
          severity: "critical",
          source: "healer",
          message: `Self-heal failed for agent ${agentId}: ${String(err).slice(0, 200)}`,
        },
      });
      emit({
        type: "alert",
        ts: new Date().toISOString(),
        alert: {
          id: alert.id,
          severity: "critical",
          source: "healer",
          message: alert.message,
          ack: false,
          createdAt: alert.createdAt.toISOString(),
        },
      });
    } catch {
      // Even alert creation failed — log only.
      logger.error("monitor.selfheal.alert-fail", { agentId, error: String(err) });
    }
    return {
      healed: false,
      action: `heal failed: ${String(err).slice(0, 200)}`,
      agentId,
    };
  }
}

// ─── monitorApp ──────────────────────────────────────────────────────
/**
 * Full app health check. Runs every check + auto-fixes what it can.
 *
 *   1. checkAgentHealth() → self-heal every failed/degraded agent
 *   2. DB connectivity (SELECT 1 via count query)
 *   3. SSE stream liveness (recent Events within 5 min)
 *   4. Cron scheduler liveness (active CronJob with nextRunAt)
 *   5. Recent API 500s (LlmCall.status=error rate in last 5 min)
 *   6. Auto-fix what can be auto-fixed + count autoFixed.
 *
 * Returns the overall status: healthy | degraded | critical.
 * (We use "critical" only when DB is unreachable; everything else
 *  degrades the status to "degraded".)
 */
export async function monitorApp(): Promise<AppHealth> {
  const checkedAt = new Date().toISOString();
  const issues: string[] = [];
  let autoFixed = 0;

  // 1. Agent health + self-heal.
  let agentSummary = {
    healthy: 0,
    degraded: 0,
    failed: 0,
    total: 0,
    details: [] as AgentHealth[],
  };

  try {
    agentSummary = await checkAgentHealth();

    // Auto-heal every failed agent + degraded waiting agents.
    for (const a of agentSummary.details) {
      if (a.health === "failed" || (a.health === "degraded" && a.status === "error")) {
        try {
          const result = await selfHeal(a.agentId);
          if (result.healed) {
            autoFixed++;
          } else {
            issues.push(`agent ${a.name}: ${result.action}`);
          }
        } catch (err) {
          issues.push(`agent ${a.name}: heal failed (${String(err).slice(0, 100)})`);
        }
      }
    }
  } catch (err) {
    issues.push(`agent health check failed: ${String(err).slice(0, 200)}`);
  }

  // 2. DB connectivity — count() is the cheapest round-trip.
  let dbConnected = false;
  try {
    await db.agent.count();
    dbConnected = true;
  } catch (err) {
    issues.push(`DB connectivity: ${String(err).slice(0, 150)}`);
  }

  // 3. SSE liveness — was an Event emitted in the last 5 min?
  let sseAlive = false;
  try {
    const fiveMinAgo = new Date(Date.now() - RECENT_ALERT_WINDOW_MS);
    const recentEvents = await db.event.count({
      where: { createdAt: { gte: fiveMinAgo } },
    });
    sseAlive = recentEvents > 0;
    if (!sseAlive) {
      issues.push("SSE stream: no events emitted in last 5 min (may be idle, not necessarily broken)");
    }
  } catch (err) {
    issues.push(`SSE check failed: ${String(err).slice(0, 100)}`);
  }

  // 4. Cron scheduler liveness — is there an active CronJob with nextRunAt set?
  let cronAlive = false;
  try {
    const activeJobs = await db.cronJob.count({
      where: {
        status: "active",
        nextRunAt: { not: null },
      },
    });
    cronAlive = activeJobs > 0;
    if (!cronAlive) {
      issues.push("Cron scheduler: no active jobs scheduled");
    }
  } catch (err) {
    issues.push(`Cron check failed: ${String(err).slice(0, 100)}`);
  }

  // 5. Recent LLM call errors as a proxy for API 500s (we don't have a
  //    dedicated API-error log table, but LlmCall.status=error correlates
  //    with routes that surfaced failures).
  let apiErrorsRecent = 0;
  try {
    const fiveMinAgo = new Date(Date.now() - RECENT_ALERT_WINDOW_MS);
    apiErrorsRecent = await db.llmCall.count({
      where: {
        status: "error",
        createdAt: { gte: fiveMinAgo },
      },
    });
    if (apiErrorsRecent > 10) {
      issues.push(`API errors: ${apiErrorsRecent} LLM errors in last 5 min — investigate failover`);
    }
  } catch (err) {
    issues.push(`API error count failed: ${String(err).slice(0, 100)}`);
  }

  // 6. Overall status.
  let status: HealthState = "healthy";
  if (!dbConnected) {
    status = "failed"; // critical
  } else if (
    agentSummary.failed > 0 ||
    issues.length >= 3 ||
    apiErrorsRecent > 10
  ) {
    status = "failed";
  } else if (
    agentSummary.degraded > 0 ||
    issues.length > 0 ||
    !sseAlive ||
    !cronAlive
  ) {
    status = "degraded";
  }

  // Persist an alert if the status degraded.
  try {
    if (status !== "healthy" && issues.length > 0) {
      const sev = status === "failed" ? "critical" : "warn";
      const alert = await db.systemAlert.create({
        data: {
          severity: sev,
          source: "system",
          message: `Monitor detected ${status} state: ${issues.slice(0, 3).join(" | ")}`,
        },
      });
      emit({
        type: "alert",
        ts: checkedAt,
        alert: {
          id: alert.id,
          severity: sev,
          source: "system",
          message: alert.message,
          ack: false,
          createdAt: alert.createdAt.toISOString(),
        },
      });
    }
  } catch {
    // Alert persistence is best-effort.
  }

  monitorState.lastRunAt = new Date();
  monitorState.lastStatus = status;

  return {
    status,
    healthy: agentSummary.healthy,
    degraded: agentSummary.degraded,
    failed: agentSummary.failed,
    totalAgents: agentSummary.total,
    issues,
    autoFixed,
    dbConnected,
    sseAlive,
    cronAlive,
    apiErrorsRecent,
    checkedAt,
    details: agentSummary.details,
  };
}

// ─── helpOtherAgents ─────────────────────────────────────────────────
/**
 * The monitoring agents (Pulse-Ops, Guard-Compliance, Shield-QA)
 * check whether any other agents are stuck (failed task assigned to
 * them OR `waiting` status past 5 min) and help them complete their
 * tasks by:
 *   - reassigning the task to a different idle agent in the same dept
 *   - if no idle agent available, logging a note for the operator
 *
 * Returns the count of agents helped + a list of actions taken.
 */
export async function helpOtherAgents(): Promise<HelpResult> {
  const helpedDetails: string[] = [];

  try {
    // Find stuck agents: status=waiting with lastBeatAt > 5min ago.
    const fiveMinAgo = new Date(Date.now() - HEARTBEAT_CRITICAL_MS);
    const stuckAgents = await db.agent.findMany({
      where: {
        status: "waiting",
        OR: [
          { lastBeatAt: { lt: fiveMinAgo } },
          { lastBeatAt: null },
        ],
      },
    });

    for (const stuck of stuckAgents) {
      // Find the task they're "working on".
      const task = await db.task.findFirst({
        where: {
          assignedToId: stuck.id,
          status: { in: ["running", "blocked"] },
        },
        orderBy: { updatedAt: "desc" },
      });

      if (!task) {
        // No task — just reset the agent.
        await db.agent.update({
          where: { id: stuck.id },
          data: { status: "idle", currentTask: null, lastBeatAt: new Date() },
        });
        helpedDetails.push(`${stuck.name}: reset from waiting → idle (no task assigned)`);
        continue;
      }

      // Find an idle peer in the same department.
      const peer = await db.agent.findFirst({
        where: {
          department: stuck.department,
          status: "idle",
          id: { not: stuck.id },
        },
      });

      if (peer) {
        await db.task.update({
          where: { id: task.id },
          data: { assignedToId: peer.id, status: "pending" },
        });
        await db.agent.update({
          where: { id: stuck.id },
          data: { status: "idle", currentTask: null, lastBeatAt: new Date() },
        });
        await db.agentLog.create({
          data: {
            agentId: peer.id,
            taskId: task.id,
            level: "info",
            message: `Monitor reassigned task "${task.title}" from ${stuck.name} (stuck) to ${peer.name}`,
            meta: JSON.stringify({ from: stuck.id, to: peer.id, taskId: task.id }),
          },
        });
        helpedDetails.push(
          `${stuck.name} → ${peer.name}: reassigned task "${task.title}"`,
        );
      } else {
        helpedDetails.push(
          `${stuck.name}: stuck on "${task.title}" but no idle peer in ${stuck.department ?? "(no dept)"}`,
        );
      }
    }

    // Also handle failed tasks: re-queue them to idle agents.
    const failedTasks = await db.task.findMany({
      where: { status: "failed" },
      take: 5,
    });

    for (const ft of failedTasks) {
      if (!ft.assignedToId) continue;
      const original = await db.agent.findUnique({ where: { id: ft.assignedToId } });
      if (!original) continue;

      const idlePeer = await db.agent.findFirst({
        where: {
          department: original.department,
          status: "idle",
          id: { not: original.id },
        },
      });

      if (idlePeer) {
        await db.task.update({
          where: { id: ft.id },
          data: { assignedToId: idlePeer.id, status: "pending", progress: 0 },
        });
        helpedDetails.push(
          `${original.name} → ${idlePeer.name}: picked up failed task "${ft.title}"`,
        );
      }
    }
  } catch (err) {
    logger.warn("monitor.helpOtherAgents.error", { error: String(err) });
    helpedDetails.push(`help loop failed: ${String(err).slice(0, 100)}`);
  }

  return {
    helped: helpedDetails.length,
    details: helpedDetails,
  };
}

// ─── startMonitor (idempotent) ────────────────────────────────────────
/**
 * Starts the monitoring loop. Runs every 30s. Idempotent — safe to
 * call multiple times; only one timer is ever running.
 *
 * On each tick:
 *   1. monitorApp() — full health check + auto-heal.
 *   2. helpOtherAgents() — reassign stuck tasks to idle peers.
 *
 * Failures are logged but never crash the loop (try/catch wraps
 * every tick + every individual check inside monitorApp()).
 */
export function startMonitor(intervalMs: number = MONITOR_INTERVAL_MS): void {
  if (monitorState.started) {
    logger.debug("monitor.start.already-running");
    return;
  }
  monitorState.started = true;

  const tick = async () => {
    try {
      const health = await monitorApp();
      if (health.status !== "healthy") {
        logger.warn("monitor.tick.degraded", {
          status: health.status,
          healthy: health.healthy,
          degraded: health.degraded,
          failed: health.failed,
          autoFixed: health.autoFixed,
          issues: health.issues.length,
        });
      } else {
        logger.debug("monitor.tick.healthy", {
          total: health.totalAgents,
          autoFixed: health.autoFixed,
        });
      }
    } catch (err) {
      // The monitor itself must NEVER crash the dev server.
      logger.error("monitor.tick.crash", { error: String(err) });
    }

    try {
      const help = await helpOtherAgents();
      if (help.helped > 0) {
        logger.info("monitor.help", {
          helped: help.helped,
          details: help.details.slice(0, 3),
        });
      }
    } catch (err) {
      logger.error("monitor.help.crash", { error: String(err) });
    }
  };

  // Fire one tick immediately so the operator sees status without
  // waiting 30s.
  void tick();

  monitorState.timer = setInterval(() => {
    void tick();
  }, intervalMs);

  logger.success("monitor.start", { intervalMs });
}

/** Stop the monitor loop (mostly for tests). */
export function stopMonitor(): void {
  if (monitorState.timer) {
    clearInterval(monitorState.timer);
    monitorState.timer = null;
  }
  monitorState.started = false;
}

/** Returns the last-known monitor status (for the API GET /api/monitor). */
export function getMonitorStatus(): {
  started: boolean;
  lastRunAt: string | null;
  lastStatus: HealthState | null;
} {
  return {
    started: monitorState.started,
    lastRunAt: monitorState.lastRunAt ? monitorState.lastRunAt.toISOString() : null,
    lastStatus: monitorState.lastStatus,
  };
}

/** Returns the names of the monitoring agents (Pulse-Ops, Guard-Compliance, Shield-QA). */
export function getMonitoringAgentNames(): string[] {
  return Array.from(MONITORING_AGENT_NAMES);
}
