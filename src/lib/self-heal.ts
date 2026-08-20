/**
 * src/lib/self-heal.ts — Continuous background-loop supervisor.
 *
 * On a 24/7 laptop / single-server deployment, the Next.js process
 * rarely restarts cleanly. Background timers (env-loader, monitor,
 * approval decider, simulation engine, blackbox, cron scheduler) can
 * silently die from an unhandled rejection, a Next.js HMR edge case,
 * or simply because a long-running setInterval was garbage-collected
 * after a hot reload.
 *
 * This module re-runs every 5 minutes and ensures every background
 * loop is alive. It is idempotent — every `start*()` function below
 * already checks an internal flag, so re-calling them is a no-op when
 * the loop is already running.
 *
 * On cold start (first invocation), it also auto-bootstraps the DB by
 * calling `/api/seed`-equivalent logic directly — so the app can come
 * up 24/7 with no manual intervention. This is critical for "free
 * 24/7" deployments where there's no operator to hit `/api/seed`.
 *
 * Task ID: HARDEN-SELF-HEAL (Task 6).
 */
import "server-only";

import { logger } from "./logger";
import { db } from "./db";
import { startEnvLoader } from "./env-loader";
import { startApprovalDecider } from "./approval-decision";
import { startMonitor } from "./monitor";

const HEAL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const BOOTSTRAP_RETRY_MS = 60 * 1000; // retry bootstrap every 1 min until it succeeds

interface SelfHealState {
  timer: NodeJS.Timeout | null;
  bootstrapTimer: NodeJS.Timeout | null;
  started: boolean;
  bootstrapped: boolean;
  healCount: number;
  lastHealAt: number | null;
}

const globalForHeal = globalThis as unknown as { __ariaSelfHeal?: SelfHealState };
const state: SelfHealState =
  globalForHeal.__ariaSelfHeal ?? {
    timer: null,
    bootstrapTimer: null,
    started: false,
    bootstrapped: false,
    healCount: 0,
    lastHealAt: null,
  };
if (!globalForHeal.__ariaSelfHeal) globalForHeal.__ariaSelfHeal = state;

/**
 * Check DB connectivity + integrity. If the SQLite DB is corrupted
 * (Prisma throws a connection / schema error), attempt auto-recovery:
 *
 *   1. Rename the corrupted .db file to .db.corrupted-{timestamp}
 *   2. Run `prisma db push --accept-data-loss` via execSync to re-create
 *   3. Return — the caller will re-seed on the next tryBootstrap() pass
 *
 * This makes ARIA truly autonomous — a corrupted DB doesn't require
 * operator intervention, the supervisor self-heals it.
 *
 * Only runs for SQLite (file: protocol). PostgreSQL errors are logged
 * but NOT auto-recovered (too risky to drop a shared Postgres).
 */
async function ensureDbHealthy(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL || "";
  const isSQLite = dbUrl.startsWith("file:");

  // Probe: can we connect + run a trivial query?
  try {
    await db.agent.count();
    return; // DB is healthy
  } catch (err) {
    const errMsg = String(err);

    // For PostgreSQL, log but don't auto-recover.
    if (!isSQLite) {
      logger.error("self-heal.db.unhealthy-postgres", { error: errMsg });
      throw err;
    }

    // For SQLite, check if the error indicates corruption.
    const isCorruption =
      errMsg.includes("SQLITE_CORRUPT") ||
      errMsg.includes("database disk image is malformed") ||
      errMsg.includes("P2003") || // foreign key constraint
      errMsg.includes("P3000") || // failed to open database
      errMsg.includes("no such table") ||
      errMsg.includes("relation does not exist");

    if (!isCorruption) {
      // Could be a transient error — don't touch the DB file.
      logger.warn("self-heal.db.transient-error", { error: errMsg });
      throw err;
    }

    // Auto-recover: rename corrupted DB + re-create.
    logger.error("self-heal.db.corrupted", { error: errMsg, action: "auto-recovering" });

    // Extract the DB file path from the DATABASE_URL.
    // Format: file:/path/to/db/custom.db  OR  file:./db/custom.db
    const dbPath = dbUrl.replace(/^file:/, "").replace(/\?.*$/, "");
    const fs = await import("fs");
    const path = await import("path");

    if (fs.existsSync(/*turbopackIgnore: true*/ dbPath)) {
      const backupPath = `${dbPath}.corrupted-${Date.now()}`;
      fs.renameSync(dbPath, backupPath);
      logger.warn("self-heal.db.renamed", { from: dbPath, to: backupPath });

      // Also remove the -journal + -wal + -shm files if they exist.
      for (const suffix of ["-journal", "-wal", "-shm"]) {
        const sidecar = `${dbPath}${suffix}`;
        if (fs.existsSync(/*turbopackIgnore: true*/ sidecar)) {
          fs.unlinkSync(sidecar);
        }
      }
    }

    // Re-create the schema via prisma db push.
    const { execSync } = await import("child_process");
    try {
      execSync("bunx prisma db push --accept-data-loss --skip-generate", {
        cwd: process.cwd(),
        timeout: 60_000,
        stdio: "pipe",
      });
      logger.info("self-heal.db.recreated", { dbPath });
    } catch (pushErr) {
      logger.error("self-heal.db.recreate-failed", { error: String(pushErr) });
      throw pushErr;
    }

    // Don't throw — let the caller (tryBootstrap) proceed to seedIfEmpty()
    // which will hydrate the fresh DB with the 37-agent roster.
  }
}

/**
 * Try to bootstrap the DB + start engine loops. Called on a 1-min
 * retry loop until it succeeds (so a missing DB or failed seed doesn't
 * permanently brick the app — it just keeps trying).
 *
 * v31 enhancement: if the DB is corrupted (Prisma throws P2003 / P3000
 * / SQLITE_CORRUPT), the supervisor automatically:
 *   1. Renames the corrupted .db to .db.corrupted-{timestamp}
 *   2. Runs `prisma db push` to re-create a fresh schema
 *   3. Re-seeds the 37-agent roster
 *   4. Logs the event for audit
 * This makes ARIA truly autonomous — it can recover from DB corruption
 * without operator intervention.
 */
async function tryBootstrap(): Promise<void> {
  if (state.bootstrapped) return;
  try {
    // 1. Start env loader (loads .env.defaults + .env).
    startEnvLoader();

    // 2. Check DB connectivity. If the DB is corrupted, attempt auto-recovery.
    await ensureDbHealthy();

    // 3. Run seedIfEmpty — hydrates the 37-agent roster if the DB is empty.
    const { seedIfEmpty } = await import("./simulation");
    await seedIfEmpty();

    // 3a. Load all ClawHub skills from the skills/ directory (v38).
    // Parses SKILL.md files + upserts them as Skill records in the DB.
    void (async () => {
      try {
        const { loadSkillsFromDisk } = await import("./skill-loader");
        const result = await loadSkillsFromDisk();
        logger.info("self-heal.skills-loaded", result);
      } catch (err) {
        logger.warn("self-heal.skills-load-failed", { error: String(err) });
      }
    })();

    // 3b. Auto-pull Ollama models (v32 Mission 5).
    // v38: auto-DETECT installed models first, then auto-pull if missing.
    // If Ollama is running but the configured models are missing, pull them
    // silently in the background so the app self-provisions on first boot.
    void (async () => {
      try {
        const { isOllamaAvailable, autoDetectOllamaModels, ensureOllamaModel } = await import("./ollama-client");
        const running = await isOllamaAvailable();
        if (running) {
          // v38: auto-detect which models are installed + set env vars
          const detected = await autoDetectOllamaModels();
          if (detected.detected) {
            logger.info("self-heal.ollama.models-detected", {
              strong: detected.strong,
              balanced: detected.balanced,
              fast: detected.fast,
            });
          }

          // Still ensure the detected models are available (in case auto-detect
          // returned fallbacks for tiers where no suitable model was found)
          const required = [
            process.env.WORKFORCE_MODEL_STRONG || "qwen2.5:14b",
            process.env.WORKFORCE_MODEL_BALANCED || "qwen2.5:7b",
            process.env.WORKFORCE_MODEL_FAST || "qwen2.5:3b",
          ];
          for (const model of required) {
            if (!detected.detected || model !== process.env[`WORKFORCE_MODEL_${model.includes("14b") ? "STRONG" : model.includes("3b") ? "FAST" : "BALANCED"}`]) {
              logger.info("self-heal.ollama.auto-pull", { model, reason: "missing" });
              await ensureOllamaModel(model);
            }
          }
        }
      } catch (err) {
        logger.debug("self-heal.ollama.auto-pull-skipped", { error: String(err) });
      }
    })();

    // 4. Check onboarding gate. If a CompanyProfile exists, start the
    //    engine + decider + monitor. Otherwise keep retrying every 1 min.
    const companyCount = await db.companyProfile.count({ where: { isActive: true } });
    if (companyCount === 0) {
      logger.info("self-heal.bootstrap.onboarding-pending", { companyCount });
      return;
    }

    // 5. Start the engine + decider + monitor + blackbox.
    const { startEngine } = await import("./simulation");
    startEngine();
    startApprovalDecider();
    startMonitor();
    import("@/lib/blackbox")
      .then(({ startBlackbox }) => startBlackbox())
      .catch((err) => logger.warn("self-heal.blackbox-start-failed", { error: String(err) }));

    state.bootstrapped = true;
    if (state.bootstrapTimer) {
      clearInterval(state.bootstrapTimer);
      state.bootstrapTimer = null;
    }
    logger.info("self-heal.bootstrap.complete", { companyCount });
  } catch (err) {
    logger.warn("self-heal.bootstrap.failed", { error: String(err), retryInMs: BOOTSTRAP_RETRY_MS });
  }
}

/**
 * Re-assert that every background loop is alive. Idempotent — every
 * `start*()` function below is a no-op if its loop is already running.
 */
async function heal(): Promise<void> {
  state.healCount++;
  state.lastHealAt = Date.now();

  try {
    // Always make sure the env loader is running — it's the cheapest
    // check and the most foundational.
    startEnvLoader();

    // If we haven't bootstrapped yet, the engine/decider/monitor can't
    // start (they depend on the 37-agent roster + a CompanyProfile).
    // tryBootstrap() is a no-op once it has succeeded.
    if (!state.bootstrapped) {
      await tryBootstrap();
      return;
    }

    // Re-assert every loop. Each start*() is idempotent.
    const { startEngine } = await import("./simulation");
    startEngine();
    startApprovalDecider();
    startMonitor();

    // Blackbox is a globalThis singleton — re-call is safe.
    // AUDIT-B-17: log the failure instead of swallowing it silently.
    import("@/lib/blackbox")
      .then(({ startBlackbox }) => startBlackbox())
      .catch((err) => { logger.warn("self-heal.blackbox-start-failed", { error: String(err) }); });

    logger.debug("self-heal.heartbeat", {
      healCount: state.healCount,
      bootstrapped: state.bootstrapped,
    });
  } catch (err) {
    logger.error("self-heal.heartbeat.failed", { error: String(err) });
  }
}

/**
 * Start the self-heal supervisor. Idempotent.
 *
 * Two timers run:
 *   1. A 1-min bootstrap retry loop — runs until the DB is hydrated
 *      and the engine has started, then clears itself.
 *   2. A 5-min heal loop — runs forever, re-asserting every loop is
 *      alive (idempotent no-ops when healthy).
 */
export function startSelfHeal(): void {
  if (state.started) return;
  state.started = true;

  // Kick off the bootstrap immediately, then every 1 min until it succeeds.
  void tryBootstrap();
  state.bootstrapTimer = setInterval(() => {
    if (!state.bootstrapped) void tryBootstrap();
  }, BOOTSTRAP_RETRY_MS);
  state.bootstrapTimer.unref?.();

  // Heal every 5 minutes.
  state.timer = setInterval(() => {
    void heal();
  }, HEAL_INTERVAL_MS);
  // AUDIT-B-19: unref both timers so they don't block graceful shutdown.
  state.timer.unref?.();

  logger.info("self-heal.started", {
    healIntervalMs: HEAL_INTERVAL_MS,
    bootstrapRetryMs: BOOTSTRAP_RETRY_MS,
  });
}

/** Stop the self-heal supervisor (mostly for tests). */
export function stopSelfHeal(): void {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  if (state.bootstrapTimer) {
    clearInterval(state.bootstrapTimer);
    state.bootstrapTimer = null;
  }
  state.started = false;
}

/** Status snapshot (for the API + dashboard). */
export function getSelfHealStatus(): {
  started: boolean;
  bootstrapped: boolean;
  healCount: number;
  lastHealAt: number | null;
  healIntervalMs: number;
} {
  return {
    started: state.started,
    bootstrapped: state.bootstrapped,
    healCount: state.healCount,
    lastHealAt: state.lastHealAt,
    healIntervalMs: HEAL_INTERVAL_MS,
  };
}
