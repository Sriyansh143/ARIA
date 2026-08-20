import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { emit } from "@/lib/event-bus";

export const dynamic = "force-dynamic";

/**
 * POST /api/system-access/approvals/[id]/decide
 * Body: { decision: "approve" | "deny", decider, rationale? }
 * Records the decision + flips the session status.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const decision = String(body?.decision ?? "").toLowerCase();
    if (decision !== "approve" && decision !== "deny") {
      return NextResponse.json(
        { error: "decision must be 'approve' or 'deny'" },
        { status: 400 }
      );
    }

    const session = await db.systemAccessSession.findUnique({ where: { id } });
    if (!session) {
      return NextResponse.json(
        { error: "session not found" },
        { status: 404 }
      );
    }

    const approval = await db.systemAccessApproval.create({
      data: {
        sessionId: id,
        decision,
        decider: String(body?.decider ?? "owner"),
        rationale: String(body?.rationale ?? ""),
      },
    });

    const newStatus = decision === "approve" ? "approved" : "denied";
    await db.systemAccessSession.update({
      where: { id },
      data: { status: newStatus },
    });

    emit({
      type: "system",
      ts: new Date().toISOString(),
      message: `system-access:${decision} session ${id} (${session.scope})`,
      level: decision === "approve" ? "success" : "warn",
    });

    logger.success("api.system-access.decide.recorded", { id, decision });
    return NextResponse.json({ ok: true, approval, status: newStatus });
  } catch (err) {
    logger.error("api.system-access.decide.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to record decision" },
      { status: 500 }
    );
  }
}
