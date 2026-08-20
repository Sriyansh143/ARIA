/**
 * POST /api/refactor-proposals/[id]/review — v74 Phase 24 (RULE-75)
 *
 * Owner inspects a refactor proposal. The LLM explains WHY it made each change
 * + answers the owner's questions.
 *
 * Body: { question?: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrResponse } from "@/lib/auth";
import { handleReviewCommand } from "@/lib/self-evolution/refactor-engine";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthOrResponse("POST", "/api/refactor-proposals/[id]/review");
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const question = body.question;

    const result = await handleReviewCommand(id, question);
    if (result.ok) {
      return NextResponse.json({ ok: true, explanation: result.explanation });
    } else {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
  } catch (err) {
    logger.error("api.refactor-proposals.review.failed", { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err).slice(0, 100) }, { status: 500 });
  }
}
