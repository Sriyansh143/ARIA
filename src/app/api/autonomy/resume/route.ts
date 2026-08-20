/**
 * POST /api/autonomy/resume — Owner-only. Resume autonomous operations.
 *
 * Clears the pause flag and lets all cron jobs + the tick loop run again.
 */
import { NextRequest, NextResponse } from "next/server";
import { setAutonomyPausedWithReason } from "@/lib/autonomy-control";
import { requireAuthOrResponse } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAuthOrResponse("POST", "/api/autonomy/resume");
  if (auth) return auth;

  try {
    await setAutonomyPausedWithReason(false, "manual resume via API");
    logger.info("api.autonomy.resume", { by: "owner" });
    return NextResponse.json({
      ok: true,
      paused: false,
      message: "Autonomy resumed. Cron jobs and the tick loop are now active.",
    });
  } catch (err) {
    logger.error("api.autonomy.resume.failed", { error: String(err) });
    return NextResponse.json({ error: "failed to resume autonomy" }, { status: 500 });
  }
}
