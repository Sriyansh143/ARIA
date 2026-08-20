import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getSurvivalBoard, runCashClawSweep } from "@/lib/cash-claw";

export const dynamic = "force-dynamic";

/**
 * GET /api/cash-claw — survival board (all agents + their tier/score).
 */
export async function GET() {
  try {
    const board = await getSurvivalBoard();
    return NextResponse.json({ board, count: board.length });
  } catch (err) {
    logger.error("api.cash-claw.board.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to get survival board" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cash-claw — run a sweep across the fleet.
 */
export async function POST() {
  try {
    const result = await runCashClawSweep();
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.cash-claw.sweep.failed", { error: String(err) });
    return NextResponse.json(
      { error: "sweep failed" },
      { status: 500 }
    );
  }
}
