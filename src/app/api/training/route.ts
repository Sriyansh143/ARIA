import { NextRequest, NextResponse } from "next/server";
import { getTrainingHistory } from "@/lib/agent-training";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/training — training history.
 *
 * v47 fix 3: Requires authentication. Was previously public, leaking training
 * source previews (up to 200 chars each) + allowing unauthenticated enumeration.
 *
 * Query params:
 *   ?agentId=<id> (optional — filter by agent)
 *   ?limit=30 (max 100)
 */
export async function GET(req: NextRequest) {
  try {
    // v47 fix 3: Require auth
    await requireAuth();
    const agentId = req.nextUrl.searchParams.get("agentId") ?? undefined;
    const limit = Math.max(1, Math.min(100, Number(req.nextUrl.searchParams.get("limit") ?? "30")));
    const history = await getTrainingHistory(agentId, limit);
    return NextResponse.json({ history, count: history.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error("api.training.history.failed", { error: msg });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
