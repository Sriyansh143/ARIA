import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { emit } from "@/lib/event-bus";

export const dynamic = "force-dynamic";

/**
 * POST /api/system-access/session/[id]/revoke
 * Marks an approved session as revoked.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await db.systemAccessSession.findUnique({ where: { id } });
    if (!session) {
      return NextResponse.json(
        { error: "session not found" },
        { status: 404 }
      );
    }
    await db.systemAccessSession.update({
      where: { id },
      data: { status: "revoked", revokedAt: new Date() },
    });

    emit({
      type: "system",
      ts: new Date().toISOString(),
      message: `system-access:revoke session ${id} (${session.scope})`,
      level: "warn",
    });

    logger.success("api.system-access.revoke.complete", { id });
    return NextResponse.json({ ok: true, status: "revoked" });
  } catch (err) {
    logger.error("api.system-access.revoke.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to revoke session" },
      { status: 500 }
    );
  }
}
