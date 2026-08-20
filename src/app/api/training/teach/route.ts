import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { teachAgent } from "@/lib/agent-training";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TeachSchema = z.object({
  agentId: z.string().min(1).max(120),
  source: z.string().min(1).max(100_000),
  instructions: z.string().max(2000).optional(),
});

/**
 * POST /api/training/teach — teach an agent from a source (text or URL).
 *
 * v47 fix 3: Requires authentication. Was previously public, allowing anyone
 * to trigger expensive LLM calls + mutate agent training state.
 *
 * Body: { agentId: string, source: string, instructions?: string }
 *
 * The source is distilled into a training summary + skill list via LLM.
 * Results are persisted to AgentLog and the blackbox.
 */
export async function POST(req: NextRequest) {
  try {
    // v47 fix 3: Require auth — this route incurs LLM costs.
    await requireAuth();

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { error: "invalid JSON body" },
        { status: 400 },
      );
    }

    const parsed = TeachSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation failed", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const result = await teachAgent(
      parsed.data.agentId,
      parsed.data.source,
      parsed.data.instructions,
    );

    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unauthorized")) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    logger.error("api.training.teach.failed", { error: msg });
    return NextResponse.json(
      {
        ok: false,
        error: msg.slice(0, 240),
        summary: "",
        skills: [],
        confidence: 0,
      },
      { status: 500 },
    );
  }
}
