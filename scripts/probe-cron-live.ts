/**
 * scripts/probe-cron-live.ts — Phase 32 Remediation
 *
 * Runs the ACTUAL cron handlers to verify they work end-to-end.
 * This is the "trigger the daily-lead-hunt and earning-research cron jobs
 * manually to verify the 404s are gone" step the user asked for.
 */

import { mock } from "bun:test";
mock.module("server-only", () => ({}));

async function main() {
  console.log("=== CRON HANDLER LIVE PROBE ===");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log();

  // 1. Run the lead-finder cron handler
  console.log("[1] Running lead-finder-daily cron handler...");
  try {
    const { JOB_HANDLERS } = await import("../src/lib/cron-handlers");
    const handler = JOB_HANDLERS["lead-finder-daily"];
    if (handler) {
      const result = await handler();
      console.log(`    ok: ${result.ok}`);
      console.log(`    result: ${result.result}`);
    } else {
      console.log("    ✗ handler not found");
    }
  } catch (err) {
    console.log(`    ✗ cron handler failed: ${String(err).slice(0, 200)}`);
  }
  console.log();

  // 2. Run the earning-research cron handler
  console.log("[2] Running earning-research cron handler...");
  try {
    const { JOB_HANDLERS } = await import("../src/lib/cron-handlers");
    const handler = JOB_HANDLERS["earning-research"];
    if (handler) {
      const result = await handler();
      console.log(`    ok: ${result.ok}`);
      console.log(`    result: ${result.result}`);
    } else {
      console.log("    ✗ handler not found");
    }
  } catch (err) {
    console.log(`    ✗ cron handler failed: ${String(err).slice(0, 200)}`);
  }
  console.log();

  // 3. Check for any 404 errors in the recent AgentLog
  console.log("[3] Checking recent AgentLog for 404 errors...");
  try {
    const { db } = await import("../src/lib/db");
    const recentLogs = await db.agentLog.findMany({
      where: {
        createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) }, // last 5 min
        OR: [
          { message: { contains: "404" } },
          { message: { contains: "Not Found" } },
          { message: { contains: "/v4/functions/invoke" } },
        ],
      },
      take: 10,
      orderBy: { createdAt: "desc" },
    });
    console.log(`    Found ${recentLogs.length} logs mentioning 404/Not Found in the last 5 min`);
    for (const log of recentLogs) {
      console.log(`      • [${log.level}] ${log.message.slice(0, 150)}`);
    }
  } catch (err) {
    console.log(`    ✗ DB query failed: ${err}`);
  }
  console.log();

  console.log("=== PROBE COMPLETE ===");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
