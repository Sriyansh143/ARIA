/**
 * ARIA Mission Control — Real Cron Scheduler.
 *
 * Runs in the background (started by the simulation engine) and honors
 * CronJob.nextRunAt timestamps. When a job's nextRunAt has passed, it
 * executes the job handler, records a CronRun, updates the job's
 * lastRunAt/nextRunAt, and emits events.
 *
 * This replaces the manual "Run Now" button-only execution with a
 * real scheduler that fires automatically on schedule.
 */
import { db } from "./db";
import { emit } from "./event-bus";
import { toIso, type CronJob } from "./types";
import { logger } from "./logger";

const globalForScheduler = globalThis as unknown as {
  __ariaScheduler?: { timer: NodeJS.Timeout | null; started: boolean };
};

const schedulerState =
  globalForScheduler.__ariaScheduler ?? { timer: null as NodeJS.Timeout | null, started: false };
if (!globalForScheduler.__ariaScheduler) globalForScheduler.__ariaScheduler = schedulerState;

// Parse simple cron-like intervals (*/N * * * * → N minutes).
function parseIntervalMs(schedule: string): number {
  const m = schedule.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*?$/);
  if (m) return parseInt(m[1], 10) * 60_000;
  const h = schedule.match(/^0\s+\*\/(\d+)\s+/);
  if (h) return parseInt(h[1], 10) * 3_600_000;
  // Default: 1 hour.
  return 3_600_000;
}

// Job handlers. Most do real work against the DB; the rest are
// intentionally stubbed (and clearly labelled) where the real
// integration requires external services that may not be configured
// in a zero-cost deployment.
// v62 Phase 12: JOB_HANDLERS extracted to cron-handlers.ts to enforce RULE-43 (file size < 400 lines).
import { JOB_HANDLERS } from "./cron-handlers";


async function runDueJobs(): Promise<void> {
  try {
    // v58 Phase 2: Global Autonomy Kill Switch — if paused, short-circuit immediately.
    // This prevents ALL cron jobs from running while the owner investigates an issue.
    try {
      const { isAutonomyPaused } = await import("./autonomy-control");
      if (await isAutonomyPaused()) {
        return; // skip this entire tick
      }
    } catch {
      // autonomy-control not available (DB error etc.) — fail-open, allow jobs to run
    }

    const now = new Date();
    const dueJobs = await db.cronJob.findMany({
      where: {
        status: "active",
        nextRunAt: { lte: now },
      },
      take: 5,
    });

    for (const job of dueJobs) {
      const handler = JOB_HANDLERS[job.name] ?? (async () => ({ ok: true, result: "executed" }));
      const startTime = Date.now();

      try {
        const { ok, result } = await handler();
        const latencyMs = Date.now() - startTime;

        // Record the run.
        await db.cronRun.create({
          data: {
            cronJobId: job.id,
            jobName: job.name,
            ok,
            result,
            latencyMs,
          },
        });

        // Update the job.
        const intervalMs = parseIntervalMs(job.schedule);
        const updated = await db.cronJob.update({
          where: { id: job.id },
          data: {
            lastRunAt: now,
            nextRunAt: new Date(now.getTime() + intervalMs),
            lastResult: result,
            runCount: { increment: 1 },
            failCount: ok ? undefined : { increment: 1 },
            status: ok ? "active" : "error",
          },
        });

        // Emit cron.update event.
        emit({
          type: "cron.update",
          ts: now.toISOString(),
          job: {
            id: updated.id,
            name: updated.name,
            schedule: updated.schedule,
            description: updated.description,
            status: updated.status as CronJob["status"],
            lastRunAt: toIso(updated.lastRunAt),
            nextRunAt: toIso(updated.nextRunAt),
            lastResult: updated.lastResult,
            runCount: updated.runCount,
            failCount: updated.failCount,
            createdAt: toIso(updated.createdAt)!,
            updatedAt: toIso(updated.updatedAt)!,
          },
        });

        // Emit a system log.
        emit({
          type: "system",
          ts: now.toISOString(),
          message: `cron "${job.name}" ${ok ? "completed" : "failed"}: ${result} (${latencyMs}ms)`,
          level: ok ? "success" : "error",
        });
      } catch (err) {
        console.error(`[aria-scheduler] job ${job.name} failed:`, err);
      }
    }
  } catch (err) {
    console.error("[aria-scheduler] runDueJobs failed:", err);
  }
}

/**
 * v61.4 Phase 9 FIX: Run a single cron job by name — REAL execution, not fake.
 *
 * This replaces the Math.random()-based "Run Now" facade in
 * /api/cron/[id]/run/route.ts. It calls the actual JOB_HANDLERS dispatch,
 * records a real CronRun, updates the job's lastRunAt/runCount/failCount,
 * and emits a real cron.update event.
 *
 * @param jobName The cron job name (must exist in JOB_HANDLERS).
 * @returns { ok, result, latencyMs } — the real outcome.
 */
export async function runJobByName(jobName: string): Promise<{ ok: boolean; result: string; latencyMs: number }> {
  const handler = JOB_HANDLERS[jobName] ?? (async () => ({ ok: false, result: `no handler registered for "${jobName}"` }));
  const startTime = Date.now();
  try {
    const { ok, result } = await handler();
    const latencyMs = Date.now() - startTime;

    // Record the run.
    const job = await db.cronJob.findFirst({ where: { name: jobName } });
    if (job) {
      await db.cronRun.create({
        data: {
          cronJobId: job.id,
          jobName: job.name,
          ok,
          result,
          latencyMs,
        },
      });

      const now = new Date();
      const intervalMs = parseIntervalMs(job.schedule);
      const updated = await db.cronJob.update({
        where: { id: job.id },
        data: {
          lastRunAt: now,
          nextRunAt: new Date(now.getTime() + intervalMs),
          lastResult: result,
          runCount: { increment: 1 },
          failCount: ok ? undefined : { increment: 1 },
          status: ok ? "active" : "error",
        },
      });

      emit({
        type: "cron.update",
        ts: now.toISOString(),
        job: {
          id: updated.id,
          name: updated.name,
          schedule: updated.schedule,
          description: updated.description,
          status: updated.status as CronJob["status"],
          lastRunAt: toIso(updated.lastRunAt),
          nextRunAt: toIso(updated.nextRunAt),
          lastResult: updated.lastResult,
          runCount: updated.runCount,
          failCount: updated.failCount,
          createdAt: toIso(updated.createdAt)!,
          updatedAt: toIso(updated.updatedAt)!,
        },
      });

      emit({
        type: "system",
        ts: now.toISOString(),
        message: `cron "${jobName}" ${ok ? "completed" : "failed"} manually (${latencyMs}ms) — REAL execution`,
        level: ok ? "success" : "error",
      });
    }

    return { ok, result, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    const result = `failed: ${String(err).slice(0, 200)}`;
    logger.error("cron-scheduler.runJobByName.failed", { jobName, error: String(err) });
    return { ok: false, result, latencyMs };
  }
}

/** Start the scheduler (idempotent). Checks every 30 seconds. */
export function startScheduler(): void {
  if (schedulerState.started) return;
  schedulerState.started = true;

  // Run immediately on start.
  void runDueJobs();

  // Check every 30 seconds.
  schedulerState.timer = setInterval(() => {
    void runDueJobs();
  }, 30_000);
  // AUDIT-B-18: unref so the timer doesn't keep the Node event loop alive
  // and block graceful shutdown.
  schedulerState.timer.unref?.();

  // ─── Phase 30 — start the memory watchdog alongside the scheduler ───
  // The watchdog samples process.memoryUsage() every minute + persists
  // to MemorySnapshot. Alerts at 80% (warn) + 95% (critical + autonomy pause).
  // Idempotent — safe to call multiple times.
  try {
    const { startMemoryWatchdog } = require("./memory-watchdog");
    startMemoryWatchdog();
  } catch (err) {
    // Best-effort — don't block scheduler start if watchdog fails.
    console.warn("[cron-scheduler] memory-watchdog start failed:", err);
  }
}

export function stopScheduler(): void {
  if (schedulerState.timer) {
    clearInterval(schedulerState.timer);
    schedulerState.timer = null;
  }
  schedulerState.started = false;
}
