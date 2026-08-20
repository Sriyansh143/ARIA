import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { discussApproval } from "@/lib/approval-brief";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/approvals/[id]/discuss
 *
 * Body: { question: string }
 *
 * The owner asks a follow-up question about a pending approval. The
 * system uses the LLM (with the approval context + prior discussion as
 * history) to answer, then appends both the owner's question and the
 * agent's answer to the `discussionLog` column.
 *
 * Returns:
 *   {
 *     answer: string,                       // agent's response
 *     discussionLog: ApprovalDiscussionEntry[], // updated full log
 *   }
 *
 * 404 if the approval doesn't exist; 400 if `question` is missing.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { question?: string };

  if (!body.question || typeof body.question !== "string" || body.question.trim().length === 0) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  // Verify the approval exists.
  const existing = await db.approval.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "approval not found" }, { status: 404 });
  }

  try {
    const { answer } = await discussApproval(id, body.question.trim());

    // Re-read to capture the updated discussion log.
    const updated = await db.approval.findUnique({ where: { id } });
    const discussionLog = updated?.discussionLog
      ? (JSON.parse(updated.discussionLog) as unknown[])
      : [];

    logger.info("api.approvals.discuss", { id, questionLen: body.question.length });
    return NextResponse.json({ answer, discussionLog });
  } catch (err) {
    logger.error("api.approvals.discuss.failed", { id, error: String(err) });
    return NextResponse.json({ error: "failed to discuss approval" }, { status: 500 });
  }
}
