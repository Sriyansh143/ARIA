/**
 * GET /api/system-memory — Phase 30
 *
 * Returns the current memory usage + the last N samples. Used by the
 * dashboard's Memory tab.
 *
 * Query params:
 *   ?hours=1   — sample window (default 1, max 24)
 *   ?limit=60  — max samples to return (default 60, max 1000)
 */
import { NextRequest, NextResponse } from "next/server";
import { getLatestMemorySample, getMemorySamples, detectMemoryLeak, takeMemorySample } from "@/lib/memory-watchdog";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const hours = Math.min(parseInt(sp.get("hours") ?? "1", 10) || 1, 24);
    const limit = Math.min(parseInt(sp.get("limit") ?? "60", 10) || 60, 1000);
    const sample = sp.get("sample") === "true"; // if true, take a new sample first

    if (sample) {
      await takeMemorySample();
    }

    const [latest, history, leakAnalysis] = await Promise.all([
      getLatestMemorySample(),
      getMemorySamples(hours, limit),
      detectMemoryLeak(hours),
    ]);

    return NextResponse.json({
      current: latest,
      history,
      leakAnalysis,
      threshold: {
        warnPercent: process.env.MEMORY_WARN_PERCENT ? parseFloat(process.env.MEMORY_WARN_PERCENT) : 80,
        criticalPercent: process.env.MEMORY_CRITICAL_PERCENT ? parseFloat(process.env.MEMORY_CRITICAL_PERCENT) : 95,
        thresholdBytes: process.env.MEMORY_THRESHOLD_BYTES ? parseInt(process.env.MEMORY_THRESHOLD_BYTES, 10) : 19_000_000_000,
      },
    });
  } catch (err) {
    logger.error("api.system-memory.failed", { error: String(err) });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
