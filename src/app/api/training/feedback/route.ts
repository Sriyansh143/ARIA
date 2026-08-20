import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { injectFeedback } from "@/lib/blackbox";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const FeedbackSchema = z.object({
  entryId: z.string().min(1),
  feedback: z.enum(["positive", "negative"]),
  note: z.string().max(500).optional(),
});

/**
 * POST /api/training/feedback — inject reinforcement learning feedback.
 *
 * v47 fix 3: Requires authentication. Was previously public, allowing anyone
 * to flip blackbox entry feedback flags.
 *
 * Body: { entryId: string, feedback: "positive" | "negative", note?: string }
 *
 * Marks a blackbox decision as good/bad. Future agent training loops
 * can use this signal to adjust behavior.
 */
export async function POST(req: NextRequest) {
  try {
    // v47 fix 3: Require auth
    await requireAuth();

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }

    const parsed = FeedbackSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation failed", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const result = injectFeedback(parsed.data.entryId, parsed.data.feedback, parsed.data.note);
    return NextResponse.json(result, { status: result.ok ? 200 : 404 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error("api.training.feedback.failed", { error: msg });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
