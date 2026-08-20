/**
 * POST /api/refactor-proposals/[id]/suggest — v74 Phase 24 (RULE-75)
 *
 * Owner requests changes to a refactor proposal. The engine re-drafts the code
 * incorporating the owner's feedback, re-runs sandbox tests, and updates the proposal.
 *
 * Body: { feedback: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrResponse } from "@/lib/auth";
import { handleSuggestCommand } from "@/lib/self-evolution/refactor-engine";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthOrResponse("POST", "/api/refactor-proposals/[id]/suggest");
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const feedback = body.feedback;
    if (!feedback) {
      return NextResponse.json({ ok: false, error: "Missing 'feedback' field" }, { status: 400 });
    }

    const result = await handleSuggestCommand(id, feedback);
    if (result.ok) {
      return NextResponse.json({
        ok: true,
        newExplanation: result.newExplanation,
        testPassed: result.testPassed,
      });
    } else {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
  } catch (err) {
    logger.error("api.refactor-proposals.suggest.failed", { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err).slice(0, 100) }, { status: 500 });
  }
}
