/**
 * GET /api/autonomy/status — Returns whether autonomy is currently paused.
 *
 * Public (no auth required) so the dashboard banner can show the state
 * to logged-out viewers (e.g., on the login page).
 */
import { NextResponse } from "next/server";
import { getAutonomyStatus } from "@/lib/autonomy-control";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const status = await getAutonomyStatus();
    return NextResponse.json({
      paused: status.paused,
      reason: status.reason,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { paused: false, error: "failed to check autonomy status", detail: String(err) },
      { status: 500 },
    );
  }
}
