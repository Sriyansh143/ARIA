/**
 * src/lib/memory-watchdog.ts — Phase 30
 *
 * Background memory watchdog that samples process.memoryUsage() every
 * N seconds + writes a MemorySnapshot row. Triggers SystemAlert +
 * Telegram owner notification when RSS exceeds 80% of threshold.
 * At 95%, triggers global autonomy pause (kill switch).
 *
 * DESIGN NOTES
 * ------------
 * - The watchdog is started once at server boot (via src/lib/auto-bootstrap.ts
 *   or the first API request) + uses `setInterval`. The interval is
 *   `.unref()`-ed so it doesn't block graceful shutdown.
 * - Samples are persisted to MemorySnapshot table for trend analysis
 *   (the daily-soak-analysis cron detects leaks by looking at growth rate).
 * - The watchdog uses `globalThis.__ariaMemoryWatchdog` to prevent double-
 *   registration during Next.js HMR.
 * - Alert thresholds are configurable via env vars:
 *     MEMORY_WARN_PERCENT=80   (default 80)
 *     MEMORY_CRITICAL_PERCENT=95 (default 95)
 *     MEMORY_THRESHOLD_BYTES=19000000000 (default 19 GB — Oracle 24GB minus 5GB buffer)
 *   The threshold should be set based on the deployment environment:
 *     - Oracle Free Tier (24 GB): 19 GB
 *     - Local dev (8 GB): 6 GB
 *     - Docker (4 GB): 3 GB
 */

import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendTelegramMessage } from "@/lib/telegram-notifier";
import { setAutonomyPausedWithReason } from "@/lib/autonomy-control";

// ─── Types ───────────────────────────────────────────────────────────

export interface MemorySample {
  pid: number;
  uptimeSeconds: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  arrayBufferBytes: number;
  systemTotalMemoryBytes: number;
  systemFreeMemoryBytes: number;
  rssPercent: number;
  alertLevel: "ok" | "warn" | "critical";
}

// ─── Config ──────────────────────────────────────────────────────────

const SAMPLE_INTERVAL_MS = 60 * 1000; // 1 minute (production default)
const TEST_SAMPLE_INTERVAL_MS = 1_000; // 1 second (tests)

function getWarnPercent(): number {
  const raw = process.env.MEMORY_WARN_PERCENT;
  const parsed = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : 80;
}

function getCriticalPercent(): number {
  const raw = process.env.MEMORY_CRITICAL_PERCENT;
  const parsed = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : 95;
}

function getThresholdBytes(): number {
  const raw = process.env.MEMORY_THRESHOLD_BYTES;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  // Default: 19 GB (Oracle Free Tier safe threshold on 24 GB box).
  // For local dev (8 GB), set MEMORY_THRESHOLD_BYTES=6000000000 in .env.
  return 19_000_000_000;
}

// ─── Singleton state (HMR-safe) ──────────────────────────────────────

interface WatchdogState {
  interval: ReturnType<typeof setInterval>;
  lastAlertLevel: "ok" | "warn" | "critical";
  startedAt: number;
  sampleCount: number;
}

function getGlobalState(): WatchdogState | null {
  const g = globalThis as unknown as { __ariaMemoryWatchdog?: WatchdogState };
  return g.__ariaMemoryWatchdog ?? null;
}

function setGlobalState(state: WatchdogState | null): void {
  const g = globalThis as unknown as { __ariaMemoryWatchdog?: WatchdogState };
  if (state) {
    g.__ariaMemoryWatchdog = state;
  } else {
    delete g.__ariaMemoryWatchdog;
  }
}

// ─── Sampling ────────────────────────────────────────────────────────

/**
 * Take a memory sample + persist to MemorySnapshot table. Returns the
 * sample for callers (tests, dashboard) to inspect.
 */
export async function takeMemorySample(): Promise<MemorySample> {
  const mem = process.memoryUsage();
  const os = await import("os");
  const systemTotalMemoryBytes = os.totalmem();
  const systemFreeMemoryBytes = os.freemem();

  const thresholdBytes = getThresholdBytes();
  const rssPercent = (mem.rss / thresholdBytes) * 100;

  let alertLevel: "ok" | "warn" | "critical" = "ok";
  if (rssPercent >= getCriticalPercent()) {
    alertLevel = "critical";
  } else if (rssPercent >= getWarnPercent()) {
    alertLevel = "warn";
  }

  const sample: MemorySample = {
    pid: process.pid,
    uptimeSeconds: Math.floor(process.uptime()),
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    heapTotalBytes: mem.heapTotal,
    externalBytes: mem.external,
    arrayBufferBytes: mem.arrayBuffers,
    systemTotalMemoryBytes,
    systemFreeMemoryBytes,
    rssPercent,
    alertLevel,
  };

  // Persist to DB (best-effort — don't block on DB errors).
  // Values are converted to MB before storage (SQLite Int is 32-bit signed,
  // max ~2.1 GB; storing bytes would overflow on systems with > 2 GB RAM).
  try {
    await db.memorySnapshot.create({
      data: {
        pid: sample.pid,
        uptimeSeconds: sample.uptimeSeconds,
        rssMB: Math.floor(sample.rssBytes / 1024 / 1024),
        heapUsedMB: Math.floor(sample.heapUsedBytes / 1024 / 1024),
        heapTotalMB: Math.floor(sample.heapTotalBytes / 1024 / 1024),
        externalMB: Math.floor(sample.externalBytes / 1024 / 1024),
        arrayBufferMB: Math.floor(sample.arrayBufferBytes / 1024 / 1024),
        systemTotalMB: Math.floor(sample.systemTotalMemoryBytes / 1024 / 1024),
        systemFreeMB: Math.floor(sample.systemFreeMemoryBytes / 1024 / 1024),
        rssPercent: sample.rssPercent,
        alertLevel: sample.alertLevel,
      },
    });
  } catch (err) {
    // DB might not be ready yet during boot.
    logger.warn("memory-watchdog.persist-failed", { error: String(err) });
  }

  // Fire alerts on threshold transitions.
  await checkThresholdAlerts(sample);

  return sample;
}

// ─── Threshold alerting ──────────────────────────────────────────────

async function checkThresholdAlerts(sample: MemorySample): Promise<void> {
  const state = getGlobalState();
  if (!state) return;

  // Only fire when the alert level CHANGES (avoid spamming every minute).
  if (sample.alertLevel === state.lastAlertLevel) return;
  state.lastAlertLevel = sample.alertLevel;

  if (sample.alertLevel === "warn") {
    const message =
      `🟡 *Memory Watchdog — WARN*\n\n` +
      `RSS: ${(sample.rssBytes / 1024 / 1024).toFixed(0)} MB (${sample.rssPercent.toFixed(1)}% of threshold)\n` +
      `Heap: ${(sample.heapUsedBytes / 1024 / 1024).toFixed(0)} MB / ${(sample.heapTotalBytes / 1024 / 1024).toFixed(0)} MB\n` +
      `Uptime: ${(sample.uptimeSeconds / 60).toFixed(0)} min\n` +
      `PID: ${sample.pid}\n\n` +
      `_Action: monitor closely. If RSS exceeds ${getCriticalPercent()}%, autonomy will be paused._`;
    await sendTelegramMessage(message).catch(() => null);

    // Create a SystemAlert row.
    try {
      await db.systemAlert.create({
        data: {
          severity: "warn",
          source: "memory-watchdog",
          message: `RSS at ${sample.rssPercent.toFixed(1)}% of threshold (${(sample.rssBytes / 1024 / 1024).toFixed(0)} MB)`,
          ack: false,
        },
      });
    } catch { /* best-effort */ }
  }

  if (sample.alertLevel === "critical") {
    const message =
      `🔴 *Memory Watchdog — CRITICAL*\n\n` +
      `RSS: ${(sample.rssBytes / 1024 / 1024).toFixed(0)} MB (${sample.rssPercent.toFixed(1)}% of threshold)\n` +
      `Heap: ${(sample.heapUsedBytes / 1024 / 1024).toFixed(0)} MB / ${(sample.heapTotalBytes / 1024 / 1024).toFixed(0)} MB\n` +
      `Uptime: ${(sample.uptimeSeconds / 60).toFixed(0)} min\n` +
      `PID: ${sample.pid}\n\n` +
      `_⚠️ Autonomy PAUSED to prevent OOM. Run \`/resume\` to override (only if you know what you're doing)._`;
    await sendTelegramMessage(message).catch(() => null);

    try {
      await db.systemAlert.create({
        data: {
          severity: "critical",
          source: "memory-watchdog",
          message: `RSS at ${sample.rssPercent.toFixed(1)}% of threshold — autonomy paused`,
          ack: false,
        },
      });
    } catch { /* best-effort */ }

    // Trigger the global kill switch.
    try {
      await setAutonomyPausedWithReason(
        true,
        `memory-pressure: RSS at ${sample.rssPercent.toFixed(1)}% of threshold`,
      );
      logger.error("memory-watchdog.autonomy-paused", {
        rssPercent: sample.rssPercent,
        rssMB: sample.rssBytes / 1024 / 1024,
      });
    } catch (err) {
      logger.error("memory-watchdog.pause-failed", { error: String(err) });
    }
  }

  // Reset alert level back to "ok" — log the recovery.
  if (sample.alertLevel === "ok" && state.lastAlertLevel !== "ok") {
    logger.info("memory-watchdog.recovered", {
      rssPercent: sample.rssPercent,
      rssMB: sample.rssBytes / 1024 / 1024,
    });
  }
}

// ─── Public: start + stop ────────────────────────────────────────────

/**
 * Start the memory watchdog. Idempotent — safe to call multiple times
 * (the second call is a no-op). The interval is `.unref()`-ed so it
 * doesn't block graceful shutdown.
 *
 * In production: called once at server boot.
 * In tests: called explicitly with `testMode: true` to use a 1s interval.
 */
export function startMemoryWatchdog(opts?: { testMode?: boolean }): void {
  if (getGlobalState()) {
    return; // already started
  }

  const intervalMs = opts?.testMode ? TEST_SAMPLE_INTERVAL_MS : SAMPLE_INTERVAL_MS;
  const interval = setInterval(() => {
    takeMemorySample().catch((err) => {
      logger.error("memory-watchdog.sample-failed", { error: String(err) });
    });
  }, intervalMs);
  interval.unref?.(); // don't block Node.js exit

  setGlobalState({
    interval,
    lastAlertLevel: "ok",
    startedAt: Date.now(),
    sampleCount: 0,
  });

  logger.info("memory-watchdog.started", {
    intervalMs,
    thresholdBytes: getThresholdBytes(),
    warnPercent: getWarnPercent(),
    criticalPercent: getCriticalPercent(),
  });
}

/**
 * Stop the memory watchdog. Clears the interval + resets global state.
 * Used in tests + during graceful shutdown.
 */
export function stopMemoryWatchdog(): void {
  const state = getGlobalState();
  if (!state) return;
  clearInterval(state.interval);
  setGlobalState(null);
  logger.info("memory-watchdog.stopped", { sampleCount: state.sampleCount });
}

/**
 * Is the watchdog currently running?
 */
export function isMemoryWatchdogRunning(): boolean {
  return getGlobalState() !== null;
}

// ─── Public: query helpers (for dashboard) ──────────────────────────

export async function getLatestMemorySample(): Promise<MemorySample | null> {
  const row = await db.memorySnapshot.findFirst({
    orderBy: { sampledAt: "desc" },
  });
  if (!row) return null;
  // Convert MB back to bytes for the in-memory type (the dashboard expects bytes).
  return {
    pid: row.pid,
    uptimeSeconds: row.uptimeSeconds,
    rssBytes: row.rssMB * 1024 * 1024,
    heapUsedBytes: row.heapUsedMB * 1024 * 1024,
    heapTotalBytes: row.heapTotalMB * 1024 * 1024,
    externalBytes: row.externalMB * 1024 * 1024,
    arrayBufferBytes: row.arrayBufferMB * 1024 * 1024,
    systemTotalMemoryBytes: row.systemTotalMB * 1024 * 1024,
    systemFreeMemoryBytes: row.systemFreeMB * 1024 * 1024,
    rssPercent: row.rssPercent,
    alertLevel: row.alertLevel as MemorySample["alertLevel"],
  };
}

/**
 * Get memory samples from the last N hours. Used by the dashboard's
 * memory chart + by the daily-soak-analysis cron.
 */
export async function getMemorySamples(hours = 1, limit = 60): Promise<Array<{
  sampledAt: Date;
  rssBytes: number;
  heapUsedBytes: number;
  rssPercent: number;
  alertLevel: string;
}>> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = await db.memorySnapshot.findMany({
    where: { sampledAt: { gte: since } },
    orderBy: { sampledAt: "desc" },
    take: Math.min(limit, 1000),
    select: {
      sampledAt: true,
      rssMB: true,
      heapUsedMB: true,
      rssPercent: true,
      alertLevel: true,
    },
  });
  // Convert MB back to bytes for the caller.
  return rows.map((r) => ({
    sampledAt: r.sampledAt,
    rssBytes: r.rssMB * 1024 * 1024,
    heapUsedBytes: r.heapUsedMB * 1024 * 1024,
    rssPercent: r.rssPercent,
    alertLevel: r.alertLevel,
  }));
}

/**
 * Detect memory leak: compute the linear regression slope of RSS over
 * the last N hours. If the slope is positive + R² > 0.7, flag a leak.
 *
 * Returns { leakDetected, slopeBytesPerHour, rSquared }.
 */
export async function detectMemoryLeak(hours = 24): Promise<{
  leakDetected: boolean;
  slopeBytesPerHour: number;
  rSquared: number;
  samples: number;
}> {
  const samples = await getMemorySamples(hours, 500);
  if (samples.length < 10) {
    return { leakDetected: false, slopeBytesPerHour: 0, rSquared: 0, samples: samples.length };
  }

  // Reverse to chronological order (oldest first).
  const chrono = samples.reverse();
  const n = chrono.length;

  // Linear regression: x = minutes since first sample, y = rssBytes.
  const x0 = chrono[0].sampledAt.getTime();
  const xs = chrono.map((s) => (s.sampledAt.getTime() - x0) / (60 * 1000)); // minutes
  const ys = chrono.map((s) => s.rssBytes);

  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((sum, x, i) => sum + x * ys[i], 0);
  const sumX2 = xs.reduce((sum, x) => sum + x * x, 0);
  const sumY2 = ys.reduce((sum, y) => sum + y * y, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const slopeBytesPerHour = slope * 60; // convert per-minute to per-hour

  // R²
  const numerator = (n * sumXY - sumX * sumY) ** 2;
  const denominator = (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY);
  const rSquared = denominator === 0 ? 0 : numerator / denominator;

  // Leak detected: positive slope > 10 MB/hour + R² > 0.7
  const leakDetected = slopeBytesPerHour > 10 * 1024 * 1024 && rSquared > 0.7;

  return { leakDetected, slopeBytesPerHour, rSquared, samples: n };
}
