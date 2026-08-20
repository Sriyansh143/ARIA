/**
 * src/lib/autonomy-control.ts — Global Autonomy Kill Switch (v58 Phase 2)
 *
 * Single source of truth for whether the autonomous engine should run.
 * When `autonomyPaused` is true, ALL 30 cron jobs and the autonomous
 * tick loop MUST short-circuit and return immediately.
 *
 * The pause state is stored in the Setting table (key="autonomy.paused")
 * so it survives server restarts. An in-memory cache (5s TTL) prevents
 * every cron job from hitting the DB on every tick.
 *
 * Pause/resume is exposed via:
 *   - POST /api/autonomy/pause   (owner-only)
 *   - POST /api/autonomy/resume (owner-only)
 *   - GET  /api/autonomy/status
 *   - Telegram bot: `/pause` and `/resume` commands
 *   - Dashboard Overview tab: "PAUSE AUTONOMY" toggle button
 *
 * When paused, the system continues to:
 *   - Serve HTTP requests (dashboard, /api/health, /api/services/checkout)
 *   - Process inbound webhooks (Stripe, Resend, WhatsApp)
 *   - Allow owner login + manual operations
 *
 * But it does NOT:
 *   - Run any cron jobs (lead-finder, outreach-executor, crypto-verifier, etc.)
 *   - Process the autonomous agent tick loop
 *   - Send any outbound emails, calls, or messages
 *   - Build any services (paid orders queue, but not processed)
 *
 * This gives the owner an instant "freeze" button without killing the server.
 */

import { db } from "./db";
import { logger } from "./logger";
import { emit } from "./event-bus";

const SETTING_KEY = "autonomy.paused";
const CACHE_TTL_MS = 5_000; // 5 seconds

let cachedPaused: boolean | null = null;
let cachedAt: number = 0;

/**
 * Returns true if autonomy is currently paused (kill switch ON).
 * Uses a 5-second in-memory cache to avoid hammering the DB on every
 * cron tick. The cache is invalidated by `setAutonomyPaused()` so
 * pause/resume takes effect immediately.
 */
export async function isAutonomyPaused(): Promise<boolean> {
  // Return cached value if fresh
  if (cachedPaused !== null && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedPaused;
  }

  try {
    const setting = await db.setting.findUnique({ where: { key: SETTING_KEY } });
    const paused = setting?.value === "true";
    cachedPaused = paused;
    cachedAt = Date.now();
    return paused;
  } catch (err) {
    // DB error → default to NOT paused (fail-open) so the engine keeps running
    // while the DB recovers. The owner can manually kill the server if needed.
    logger.error("autonomy.paused-check-failed", { error: String(err) });
    return false;
  }
}

/**
 * Set the autonomy pause state.
 * `paused=true`  → freeze all autonomous operations
 * `paused=false` → resume normal operations
 */
export async function setAutonomyPaused(paused: boolean, reason?: string): Promise<void> {
  try {
    await db.setting.upsert({
      where: { key: SETTING_KEY },
      update: { value: paused ? "true" : "false", category: "autonomy" },
      create: { key: SETTING_KEY, value: paused ? "true" : "false", category: "autonomy" },
    });

    // Invalidate cache immediately
    cachedPaused = paused;
    cachedAt = Date.now();

    // Emit event for the live action feed
    emit({
      type: "system",
      ts: new Date().toISOString(),
      message: paused
        ? `⏸️ Autonomy PAUSED${reason ? ` — ${reason}` : ""}`
        : `▶️ Autonomy RESUMED${reason ? ` — ${reason}` : ""}`,
      level: paused ? "warn" : "success",
    });

    logger.warn("autonomy.pause-state-changed", { paused, reason: reason || null });
  } catch (err) {
    logger.error("autonomy.set-paused-failed", { paused, error: String(err) });
    throw err;
  }
}

/**
 * Convenience: get the current pause state for API responses.
 */
export async function getAutonomyStatus(): Promise<{ paused: boolean; reason: string | null }> {
  const paused = await isAutonomyPaused();
  try {
    const reasonSetting = await db.setting.findUnique({ where: { key: "autonomy.pauseReason" } });
    return { paused, reason: reasonSetting?.value ?? null };
  } catch {
    return { paused, reason: null };
  }
}

/**
 * Convenience: set pause state with a reason (stored separately so the
 * Setting value column stays a clean boolean string).
 */
export async function setAutonomyPausedWithReason(paused: boolean, reason: string): Promise<void> {
  await setAutonomyPaused(paused, reason);
  try {
    await db.setting.upsert({
      where: { key: "autonomy.pauseReason" },
      update: { value: paused ? reason : "", category: "autonomy" },
      create: { key: "autonomy.pauseReason", value: paused ? reason : "", category: "autonomy" },
    });
  } catch (err) {
    logger.error("autonomy.set-reason-failed", { error: String(err) });
  }
}
