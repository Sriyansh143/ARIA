import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { startDebate, listDebates } from "@/lib/debate";

export const dynamic = "force-dynamic";

/**
 * GET /api/debate — list recent debate sessions.
 */
export async function GET() {
  try {
    const debates = await listDebates(20);
    return NextResponse.json({ debates, count: debates.length });
  } catch (err) {
    logger.error("api.debate.list.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to list debates" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/debate
 * Body: { topic, participants?, rounds? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.topic) {
      return NextResponse.json(
        { error: "topic required" },
        { status: 400 }
      );
    }
    const result = await startDebate({
      topic: String(body.topic),
      participants: Array.isArray(body.participants) ? body.participants : undefined,
      rounds: body.rounds ? Number(body.rounds) : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.debate.start.failed", { error: String(err) });
    return NextResponse.json(
      { error: "debate failed to start" },
      { status: 500 }
    );
  }
}
