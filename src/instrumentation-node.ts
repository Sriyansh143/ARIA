/**
 * src/instrumentation-node.ts — Node-only instrumentation.
 *
 * This file is dynamically imported by `instrumentation.ts` ONLY when
 * `process.env.NEXT_RUNTIME === "nodejs"`. It contains all the Node.js-
 * specific startup logic (self-heal supervisor, env-loader, etc.).
 *
 * Because it's behind a dynamic import in the edge-safe wrapper,
 * Turbopack does NOT include this file in the Edge Runtime bundle —
 * so the `fs`, `path`, and `process.cwd()` imports here don't trigger
 * Edge Runtime warnings.
 */

export async function startNodeInstrumentation(): Promise<void> {
  // v58: Auto-bootstrap — generate NEXTAUTH_SECRET + ENCRYPTION_MASTER_KEY
  // if missing, copy .env.example → .env if .env doesn't exist, create db/ dir.
  // This makes the app bootable from a fresh clone with zero pre-config.
  try {
    const { autoBootstrap } = await import("./lib/auto-bootstrap");
    const result = await autoBootstrap();
    if (result.generated.length > 0 || result.envFileCreated) {
      console.log(`[instrumentation] auto-bootstrap: ${result.generated.length} secret(s) generated, ${result.defaulted.length} default(s) applied${result.envFileCreated ? ", .env created from .env.example" : ""}`);
    }
  } catch (err) {
    console.error("[instrumentation] auto-bootstrap failed:", err);
    // Non-fatal — the app may still boot if env vars are set externally.
  }

  // v42: Install global error handlers FIRST (before anything else can fail)
  try {
    const { installGlobalErrorHandlers } = await import("./lib/error-tracking");
    installGlobalErrorHandlers();
    console.log("[instrumentation] global error handlers installed");
  } catch (err) {
    console.error("[instrumentation] error-tracking failed to start:", err);
    // Non-fatal — errors won't be logged to DB, but the app still runs.
  }

  // Start the self-heal supervisor (env-loader, monitor, decider,
  // engine, blackbox — all re-asserted every 5 min, plus auto-bootstrap
  // on cold start).
  try {
    // Dynamic import — keeps Node-only modules out of the Edge bundle.
    const { startSelfHeal } = await import("./lib/self-heal");
    startSelfHeal();
    console.log("[instrumentation] self-heal supervisor started");
  } catch (err) {
    console.error("[instrumentation] self-heal failed to start:", err);
    // Non-fatal — the app still works, just without the supervisor.
    // The keeper.sh / keeper.ps1 process supervisor handles restarts.
  }

  // v58 Phase 3: Start the SQLite write queue flush loop
  try {
    const { getQueueStats } = await import("./lib/db-write-queue");
    // Just by importing + calling getQueueStats, the queue's flush loop starts
    getQueueStats();
    console.log("[instrumentation] SQLite write queue started (flush every 100ms)");
  } catch (err) {
    console.error("[instrumentation] db-write-queue failed to start:", err);
    // Non-fatal — writes will go through Prisma directly (with SQLITE_BUSY risk)
  }

  // v58: Auto-apply Prisma schema if DB file doesn't exist (zero-config first run)
  try {
    const { ensureSchemaApplied } = await import("./lib/db-schema-ensure");
    await ensureSchemaApplied();
  } catch (err) {
    console.error("[instrumentation] schema auto-apply failed:", err);
    // Non-fatal — first DB query will fail with a clear error message
  }

  // v58: Auto-seed the autonomous engine + cron jobs if DB is empty
  // (zero-config first run — engine starts without waiting for /api/onboarding)
  try {
    const { db } = await import("./lib/db");
    const agentCount = await db.agent.count().catch(() => 0);
    if (agentCount === 0) {
      console.log("[instrumentation] DB is empty — auto-seeding fleet + cron jobs...");
      const { seedIfEmpty } = await import("./lib/simulation/seed");
      await seedIfEmpty();
      console.log("[instrumentation] seed complete — fleet + cron jobs ready");
    }
    // Start the engine + cron scheduler immediately (don't wait for /api/onboarding)
    const { startEngine } = await import("./lib/simulation/engine");
    startEngine();
    console.log("[instrumentation] autonomous engine started");
  } catch (err) {
    console.error("[instrumentation] auto-seed/engine-start failed:", err);
    // Non-fatal — owner can manually trigger via /api/seed or /api/onboarding
  }
}
