import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { emit } from "@/lib/event-bus";
import { toIso, type SystemAlert } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/alerts/[id]/ack
 * Acknowledges a system alert; broadcasts the update to all clients.
 */
export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const existing = await db.systemAlert.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

    const updated = await db.systemAlert.update({ where: { id }, data: { ack: true } });
    emit({
      type: "alert",
      ts: new Date().toISOString(),
      alert: {
        id: updated.id,
        severity: updated.severity as SystemAlert["severity"],
        source: updated.source,
        message: updated.message,
        ack: updated.ack,
        createdAt: toIso(updated.createdAt)!,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("api.alerts.ack.failed", { id, error: String(err) });
    return NextResponse.json(
      { error: "failed to acknowledge alert" },
      { status: 500 }
    );
  }
}
