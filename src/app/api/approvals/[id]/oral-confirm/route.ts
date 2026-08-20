import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { oralConfirm } from "@/lib/approval-brief";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/approvals/[id]/oral-confirm
 *
 * Body: { transcript: string }
 *
 * Analyzes a voice-call transcript to determine if the owner orally
 * approved the pending approval. Looks for affirmative phrases ("yes",
 * "approved", "go ahead", "proceed", "do it"). If confirmed, sets
 * `oralConfirmed=true` and `status=approved` on the row.
 *
 * Returns:
 *   {
 *     confirmed: boolean,
 *     reason: string,                          // human-readable decision
 *     status: "approved" | "pending"           // current row status
 *   }
 *
 * 404 if the approval doesn't exist; 400 if `transcript` is missing.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { transcript?: string };

  if (
    !body.transcript ||
    typeof body.transcript !== "string" ||
    body.transcript.trim().length === 0
  ) {
    return NextResponse.json({ error: "transcript is required" }, { status: 400 });
  }

  // Verify the approval exists.
  const existing = await db.approval.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "approval not found" }, { status: 404 });
  }

  try {
    const result = await oralConfirm(id, body.transcript);

    // Re-read for the post-update status.
    const updated = await db.approval.findUnique({ where: { id } });
    const status = updated?.status ?? "pending";

    logger.info("api.approvals.oral-confirm", {
      id,
      confirmed: result.confirmed,
      reason: result.reason,
    });
    return NextResponse.json({
      confirmed: result.confirmed,
      reason: result.reason,
      status,
    });
  } catch (err) {
    logger.error("api.approvals.oral-confirm.failed", { id, error: String(err) });
    return NextResponse.json({ error: "failed to analyze transcript" }, { status: 500 });
  }
}
