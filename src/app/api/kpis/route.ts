import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { captureSnapshot, getKpiSummary, getKpiSeries } from "@/lib/kpi-engine";

export const dynamic = "force-dynamic";

/**
 * GET /api/kpis?series=1&days=7
 *
 *   - Without ?series: returns the latest snapshot + 24h deltas.
 *   - With ?series=1: returns the 7-day (or ?days=N) snapshot series.
 */
export async function GET(req: NextRequest) {
  try {
    const seriesFlag = req.nextUrl.searchParams.get("series");
    if (seriesFlag === "1") {
      const daysRaw = req.nextUrl.searchParams.get("days");
      const days = daysRaw ? parseInt(daysRaw, 10) : 7;
      const series = await getKpiSeries(Number.isFinite(days) ? days : 7);
      return NextResponse.json({ series, count: series.length });
    }
    const summary = await getKpiSummary();
    return NextResponse.json(summary);
  } catch (err) {
    logger.error("api.kpis.summary.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to get kpi summary" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/kpis — capture a fresh snapshot.
 */
export async function POST() {
  try {
    const result = await captureSnapshot();
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.kpis.capture.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to capture snapshot" },
      { status: 500 }
    );
  }
}
