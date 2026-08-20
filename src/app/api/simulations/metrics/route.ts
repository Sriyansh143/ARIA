/**
 * GET /api/simulations/metrics — v63 Phase 13
 * Returns real-time simulation metrics for the dashboard.
 */
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSimulationMetrics } from "@/lib/simulation-engine";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const metrics = await getSimulationMetrics();
    return NextResponse.json(metrics);
  } catch (err) {
    logger.error("api.simulations.metrics.failed", { error: String(err) });
    return NextResponse.json({ error: "failed to get metrics" }, { status: 500 });
  }
}
