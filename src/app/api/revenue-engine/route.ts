import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { runRevenueCycle, getRevenuePipeline } from "@/lib/revenue-engine";

export const dynamic = "force-dynamic";

/**
 * GET /api/revenue-engine — current pipeline (6 stages with counts).
 */
export async function GET() {
  try {
    const pipeline = await getRevenuePipeline();
    return NextResponse.json(pipeline);
  } catch (err) {
    logger.error("api.revenue-engine.pipeline.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to get pipeline" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/revenue-engine — run one full cycle.
 */
export async function POST() {
  try {
    const result = await runRevenueCycle();
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.revenue-engine.cycle.failed", { error: String(err) });
    return NextResponse.json(
      { error: "cycle failed" },
      { status: 500 }
    );
  }
}
