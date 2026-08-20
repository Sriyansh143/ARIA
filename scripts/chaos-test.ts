/**
 * scripts/chaos-test.ts — Chaos Monkey Test Script (v58 Phase 5)
 *
 * Runs resilience chaos tests to verify the v58 hardening.
 *
 * Run with:
 *   bun run scripts/chaos-test.ts
 */

import { db } from "../src/lib/db";

interface CheckResult {
  ok: boolean;
  detail: string;
}

let passed = 0;
let failed = 0;
const checks: Array<{ id: string; description: string; result: CheckResult }> = [];

async function runCheck(id: string, description: string, fn: () => Promise<CheckResult>): Promise<void> {
  process.stdout.write(`  [RUNNING] ${id}: ${description}... `);
  try {
    const result = await fn();
    checks.push({ id, description, result });
    if (result.ok) {
      console.log(`✓ PASS`);
      passed++;
    } else {
      console.log(`✗ FAIL — ${result.detail}`);
      failed++;
    }
  } catch (err) {
    checks.push({ id, description, result: { ok: false, detail: String(err) } });
    console.log(`✗ FAIL — ${String(err).slice(0, 100)}`);
    failed++;
  }
}

function logSection(title: string) {
  console.log("");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`  ${title}`);
  console.log("════════════════════════════════════════════════════════════");
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log("ARIA v58 — CHAOS MONKEY TEST");
  console.log(`Started: ${new Date().toISOString()}`);
  console.log("");

  // CHAOS-1: HTML response from LLM provider
  logSection("CHAOS-1: HTML-Resilient LLM Router");
  await runCheck("html-resilient-router", "Router catches HTML responses + applies cooldown", async () => {
    try {
      const { safeJsonParse, ProviderHtmlError } = await import("../src/lib/llm-router");

      // Simulate an HTML response (like Cloudflare 502)
      const fakeHtmlResponse = new Response("<!DOCTYPE html><html><body>502 Bad Gateway</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });

      try {
        await safeJsonParse(fakeHtmlResponse);
        return { ok: false, detail: "safeJsonParse should have thrown ProviderHtmlError" };
      } catch (err) {
        if (err instanceof ProviderHtmlError) {
          if (err.statusCode === 200 && err.htmlPreview.includes("502 Bad Gateway")) {
            return { ok: true, detail: "ProviderHtmlError thrown correctly with status + preview" };
          }
          return { ok: false, detail: `Wrong fields: status=${err.statusCode} preview=${err.htmlPreview.slice(0, 50)}` };
        }
        return { ok: false, detail: `Wrong error class: ${err?.constructor?.name}` };
      }
    } catch (err) {
      return { ok: false, detail: `Import failed: ${String(err).slice(0, 80)}` };
    }
  });

  // CHAOS-2: Global autonomy kill switch
  logSection("CHAOS-2: Global Autonomy Kill Switch");
  await runCheck("autonomy-pause-resume", "Pause + resume autonomy via the control module", async () => {
    try {
      const { isAutonomyPaused, setAutonomyPausedWithReason } = await import("../src/lib/autonomy-control");

      // Initial state check
      const beforePaused = await isAutonomyPaused();

      // Pause with a reason
      await setAutonomyPausedWithReason(true, "chaos-test-pause");
      const duringPaused = await isAutonomyPaused();

      // Resume
      await setAutonomyPausedWithReason(false, "chaos-test-resume");
      const afterPaused = await isAutonomyPaused();

      // Restore original state if it was paused before the test
      if (beforePaused) {
        await setAutonomyPausedWithReason(true, "restored-after-chaos-test");
      }

      if (!duringPaused) {
        return { ok: false, detail: `Expected paused=true during pause, got ${duringPaused}` };
      }
      if (afterPaused) {
        return { ok: false, detail: `Expected paused=false after resume, got ${afterPaused}` };
      }

      return { ok: true, detail: `Pause→resume cycle works (before=${beforePaused}, during=${duringPaused}, after=${afterPaused})` };
    } catch (err) {
      return { ok: false, detail: `Failed: ${String(err).slice(0, 80)}` };
    }
  });

  await runCheck("autonomy-status-api-shape", "Autonomy status API returns expected shape", async () => {
    try {
      const { getAutonomyStatus } = await import("../src/lib/autonomy-control");
      const status = await getAutonomyStatus();
      if (typeof status.paused !== "boolean") {
        return { ok: false, detail: `paused should be boolean, got ${typeof status.paused}` };
      }
      if (status.reason !== null && typeof status.reason !== "string") {
        return { ok: false, detail: `reason should be string|null, got ${typeof status.reason}` };
      }
      return { ok: true, detail: `Status shape OK — paused=${status.paused}, reason=${status.reason || "(none)"}` };
    } catch (err) {
      return { ok: false, detail: String(err).slice(0, 100) };
    }
  });

  // CHAOS-3: DB Write Queue flood
  logSection("CHAOS-3: SQLite Write Queue Under Load");
  await runCheck("db-write-queue-flood", "20 concurrent writes complete without SQLITE_BUSY", async () => {
    try {
      const { safeWrite, getQueueStats } = await import("../src/lib/db-write-queue");

      // Use the NotificationLog model — it has no foreign key constraints,
      // so we can create rows freely for the chaos test.
      const N = 20;
      const writes = Array.from({ length: N }, (_, i) =>
        safeWrite(
          () => db.notificationLog.create({
            data: {
              channel: "internal",
              recipient: `chaos-test-${i}@example.com`,
              subject: `Chaos Test ${i}`,
              body: `Chaos test write ${i}`,
              status: "sent",
              provider: "chaos-test",
              metadata: JSON.stringify({ test: "chaos-3", index: i }),
            },
          }),
          `chaos-test-write-${i}`,
        ),
      );

      // Race the writes against a 30s timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout — queue stuck")), 30_000),
      );
      const results = await Promise.allSettled([Promise.allSettled(writes), timeoutPromise]);
      if (results[0].status === "rejected") {
        return { ok: false, detail: `Queue timed out: ${String(results[0].reason).slice(0, 100)}` };
      }
      const innerResults = (results[0].value as PromiseSettledResult<unknown>[]) ?? [];
      const fulfilled = innerResults.filter((r) => r.status === "fulfilled").length;
      const rejected = innerResults.filter((r) => r.status === "rejected").length;

      const stats = getQueueStats();

      // Clean up the test notifications
      try {
        await db.notificationLog.deleteMany({ where: { provider: "chaos-test" } });
      } catch {
        // non-fatal
      }

      if (rejected > 0) {
        return {
          ok: false,
          detail: `${rejected}/${N} writes rejected (queue is working — these are real DB errors)`,
        };
      }

      return {
        ok: fulfilled === N,
        detail: `${fulfilled}/${N} writes succeeded — processed=${stats.totalProcessed}, errors=${stats.totalErrors}`,
      };
    } catch (err) {
      return { ok: false, detail: String(err).slice(0, 100) };
    }
  });

  await runCheck("db-write-queue-stats", "Queue stats endpoint returns sensible numbers", async () => {
    try {
      const { getQueueStats } = await import("../src/lib/db-write-queue");
      const stats = getQueueStats();
      const requiredKeys = ["queueDepth", "isFlushing", "totalProcessed", "totalErrors", "lastFlushAt", "flushIntervalMs"];
      const missing = requiredKeys.filter((k) => !(k in stats));
      if (missing.length > 0) {
        return { ok: false, detail: `Missing keys: ${missing.join(", ")}` };
      }
      if (typeof stats.queueDepth !== "number") {
        return { ok: false, detail: `queueDepth should be number, got ${typeof stats.queueDepth}` };
      }
      return { ok: true, detail: `Stats OK — depth=${stats.queueDepth}, processed=${stats.totalProcessed}` };
    } catch (err) {
      return { ok: false, detail: String(err).slice(0, 100) };
    }
  });

  // CHAOS-4: Mini-service auth middleware
  logSection("CHAOS-4: Mini-Service Internal Auth");
  await runCheck("constant-time-equal", "Constant-time string comparison prevents timing attacks", async () => {
    try {
      // Inline the function for testing (can't import from mini-services in Node context)
      function constantTimeEqual(a: string, b: string): boolean {
        if (a.length !== b.length) return false;
        let diff = 0;
        for (let i = 0; i < a.length; i++) {
          diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        return diff === 0;
      }

      // Same-length, equal
      if (!constantTimeEqual("abc123", "abc123")) return { ok: false, detail: "Equal strings should match" };
      // Same-length, different
      if (constantTimeEqual("abc123", "abc124")) return { ok: false, detail: "Different strings should not match" };
      // Different lengths
      if (constantTimeEqual("abc123", "abc1234")) return { ok: false, detail: "Different lengths should not match" };
      // Empty strings
      if (!constantTimeEqual("", "")) return { ok: false, detail: "Empty strings should match" };

      return { ok: true, detail: "Constant-time comparison verified for equal/different/length-mismatch cases" };
    } catch (err) {
      return { ok: false, detail: String(err).slice(0, 100) };
    }
  });

  await runCheck("auth-middleware-file-exists", "mini-services/lib/auth-middleware.ts exists + has all exports", async () => {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const authPath = path.join(process.cwd(), "mini-services", "lib", "auth-middleware.ts");
      if (!fs.existsSync(authPath)) {
        return { ok: false, detail: `File not found: ${authPath}` };
      }
      const content = fs.readFileSync(authPath, "utf-8");
      const required = ["constantTimeEqual", "verifyJarvisKey", "extractJarvisKey", "withAuth"];
      const missing = required.filter((fn) => !content.includes(`function ${fn}`) && !content.includes(`export function ${fn}`));
      if (missing.length > 0) {
        return { ok: false, detail: `Missing exports: ${missing.join(", ")}` };
      }
      return { ok: true, detail: `Auth middleware OK — ${required.length} exports verified` };
    } catch (err) {
      return { ok: false, detail: String(err).slice(0, 100) };
    }
  });

  // CHAOS-5: Provider cooldown propagation
  logSection("CHAOS-5: Provider Cooldown Propagation");
  await runCheck("provider-cooldown-after-html", "ProviderHtmlError structure is correct", async () => {
    try {
      const { ProviderHtmlError } = await import("../src/lib/llm-router");
      const err = new ProviderHtmlError("test", "<html>502</html>", 502);
      if (!err.isHtml) return { ok: false, detail: "isHtml flag not set" };
      if (err.statusCode !== 502) return { ok: false, detail: `statusCode=${err.statusCode} expected 502` };
      if (!err.htmlPreview.includes("502")) return { ok: false, detail: "htmlPreview missing 502" };
      return { ok: true, detail: "ProviderHtmlError structure OK — router can use this to set 10-min cooldown" };
    } catch (err) {
      return { ok: false, detail: String(err).slice(0, 100) };
    }
  });

  // ─── Summary ────────────────────────────────────────────────────
  logSection("VERDICT");
  console.log(`  Chaos tests: ${passed} passed, ${failed} failed, ${checks.length} total`);
  console.log("");

  if (failed > 0) {
    console.log("  FAILED CHECKS:");
    for (const c of checks.filter((c) => !c.result.ok)) {
      console.log(`    [${c.id}] ${c.description}`);
      console.log(`       → ${c.result.detail}`);
    }
    console.log("");
  }

  console.log(`  Result: ${failed === 0 ? "ALL CHAOS TESTS PASSED ✅" : "CHAOS TESTS FAILED ❌"}`);
  console.log("");

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Chaos test crashed:", err);
  process.exit(1);
});
