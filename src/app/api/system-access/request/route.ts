import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { emit } from "@/lib/event-bus";

export const dynamic = "force-dynamic";

/**
 * POST /api/system-access/request
 * Body: { requester, scope, reason, agentId?, ttlMinutes? }
 * Creates a SystemAccessSession in `pending` status.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.requester || !body?.scope || !body?.reason) {
      return NextResponse.json(
        { error: "requester, scope, reason required" },
        { status: 400 }
      );
    }
    const ttlMinutes = Math.min(Math.max(Number(body.ttlMinutes ?? 15), 1), 1440);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

    const session = await db.systemAccessSession.create({
      data: {
        agentId: body.agentId ? String(body.agentId) : null,
        requester: String(body.requester),
        scope: String(body.scope),
        reason: String(body.reason),
        status: "pending",
        expiresAt,
      },
    });

    emit({
      type: "system",
      ts: new Date().toISOString(),
      message: `system-access:request ${session.scope} by ${session.requester}`,
      level: "warn",
    });

    logger.success("api.system-access.request.created", { id: session.id });
    return NextResponse.json({ id: session.id, status: "pending", expiresAt });
  } catch (err) {
    logger.error("api.system-access.request.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to request access" },
      { status: 500 }
    );
  }
}
