import { NextRequest, NextResponse } from "next/server";
import { isOutreachPaused, resumeOutreach } from "@/lib/health-sim";
import { requireAuthOrResponse } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/outreach/status — owner-only. Returns whether outreach is currently paused.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthOrResponse("GET", "/api/outreach/status");
    if (auth) return auth;

    const paused = await isOutreachPaused();
    return NextResponse.json({ paused });
  } catch (err) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/**
 * POST /api/outreach/status — owner-only. Resume outreach after reviewing alerts.
 * Body: { action: "resume" }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthOrResponse("POST", "/api/outreach/status");
    if (auth) return auth;

    const body = await req.json().catch(() => ({}));
    if (body.action !== "resume") {
      return NextResponse.json({ error: "action must be 'resume'" }, { status: 400 });
    }

    await resumeOutreach();
    return NextResponse.json({ ok: true, paused: false });
  } catch (err) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
