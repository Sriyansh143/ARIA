import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { emit } from "@/lib/event-bus";
import { logger } from "@/lib/logger";
import { toIso, type SystemAlert } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/alerts/ack-all
 *
 * Acknowledge every currently-unacked system alert in one round-trip.
 * Useful when alerts have piled up (e.g. after a smoke-test run or a
 * monitoring flap) and the operator wants to clear the queue without
 * clicking "ack" on each row.
 *
 * Returns `{ok, acked, remaining}` where:
 *   - acked: number of alerts that were flipped from ack=false → ack=true
 *   - remaining: number of alerts that were already acked (untouched)
 *
 * Emits one SSE `alert` event per acked alert so every connected
 * dashboard client updates in real time without needing a refresh.
 *
 * Optional body: `{ severity?: "info"|"warn"|"error"|"critical" }`
 * — if provided, only acks alerts of that severity. Without it, all
 * unacked alerts are acked regardless of severity.
 */
export async function POST(req: Request) {
  let body: { severity?: string } = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as { severity?: string };
    }
  } catch {
    // Empty body is fine — ack everything.
  }

  // Validate severity if provided.
  const ALLOWED = ["info", "warn", "error", "critical"] as const;
  const severity =
    typeof body.severity === "string" && (ALLOWED as readonly string[]).includes(body.severity)
      ? body.severity
      : undefined;

  const where = severity
    ? { ack: false, severity }
    : { ack: false };

  try {
    // Fetch first so we can emit per-alert SSE events (the updateMany
    // call alone wouldn't tell us which IDs were affected).
    const targets = await db.systemAlert.findMany({
      where,
      select: { id: true },
    });

    if (targets.length === 0) {
      return NextResponse.json({ ok: true, acked: 0, remaining: 0 });
    }

    const result = await db.systemAlert.updateMany({
      where,
      data: { ack: true },
    });

    // Emit one SSE event per acked alert so dashboards update live.
    // Re-fetch each alert to get the full row for the payload.
    const acked = await db.systemAlert.findMany({
      where: { id: { in: targets.map((t) => t.id) } },
    });
    for (const a of acked) {
      emit({
        type: "alert",
        ts: new Date().toISOString(),
        alert: {
          id: a.id,
          severity: a.severity as SystemAlert["severity"],
          source: a.source,
          message: a.message,
          ack: a.ack,
          createdAt: toIso(a.createdAt)!,
        },
      });
    }

    logger.info("alerts.ack-all", { acked: result.count, severity: severity ?? "all" });

    return NextResponse.json({
      ok: true,
      acked: result.count,
      remaining: 0,
    });
  } catch (err) {
    logger.error("alerts.ack-all.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to acknowledge alerts" },
      { status: 500 }
    );
  }
}
