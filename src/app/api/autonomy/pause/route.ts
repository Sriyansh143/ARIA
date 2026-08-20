/**
 * POST /api/autonomy/pause — Owner-only. Freeze all autonomous operations.
 *
 * Body: { reason?: string }
 *
 * When paused:
 *   - All 30 cron jobs short-circuit and return immediately
 *   - The autonomous agent tick loop stops
 *   - No outbound emails/calls/messages are sent
 *   - No service orders are built (but queue is preserved)
 *
 * The server continues to:
 *   - Serve HTTP requests (dashboard, /api/health, /api/services/checkout)
 *   - Process inbound webhooks (Stripe, Resend, WhatsApp replies)
 *
 * This is the global kill switch — use when you need to investigate an
 * issue, do maintenance, or stop the autonomous company immediately.
 */
import { NextRequest, NextResponse } from "next/server";
import { setAutonomyPausedWithReason } from "@/lib/autonomy-control";
import { requireAuthOrResponse } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAuthOrResponse("POST", "/api/autonomy/pause");
  if (auth) return auth;

  let body: { reason?: string } = {};
  try {
    body = await req.json();
  } catch {
    // body is optional
  }

  const reason = (body.reason || "manual pause via API").slice(0, 200);

  try {
    await setAutonomyPausedWithReason(true, reason);
    logger.warn("api.autonomy.pause", { reason, by: "owner" });
    return NextResponse.json({
      ok: true,
      paused: true,
      reason,
      message: "Autonomy paused. All cron jobs and the tick loop will short-circuit on their next run.",
    });
  } catch (err) {
    logger.error("api.autonomy.pause.failed", { error: String(err) });
    return NextResponse.json({ error: "failed to pause autonomy" }, { status: 500 });
  }
}
