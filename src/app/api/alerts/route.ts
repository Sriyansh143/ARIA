import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { toIso, type SystemAlert } from "@/lib/types";
import { parsePagination, paginatedResponse } from "@/lib/pagination";

export const dynamic = "force-dynamic";

/**
 * GET /api/alerts — list system alerts.
 *
 * Supports optional query params:
 *   ?ack=false  — only unacknowledged alerts
 *   ?severity=critical|error|warn|info
 *   ?limit=50   (capped to 200) — legacy envelope, ignored when ?page= is present
 *   ?page=1     — when present, response uses the paginated envelope:
 *                  { data, pagination: { page, limit, total, totalPages, hasMore } }
 *                when absent, response is the legacy { alerts, count, unacked, critical } envelope.
 *
 * Returns newest-first. Used by the central registry snapshot and
 * the AlertsPanel dashboard widget.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const ackRaw = searchParams.get("ack");
  const severity = searchParams.get("severity");
  const hasPage = searchParams.has("page");

  const where: { ack?: boolean; severity?: string } = {};
  if (ackRaw === "true") where.ack = true;
  if (ackRaw === "false") where.ack = false;
  if (severity) where.severity = severity;

  try {
    if (hasPage) {
      const { take, skip, page, limit } = parsePagination(req);
      const [rows, total] = await Promise.all([
        db.systemAlert.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take,
          skip,
        }),
        db.systemAlert.count({ where }),
      ]);
      const alerts: SystemAlert[] = rows.map((a) => ({
        id: a.id,
        severity: a.severity as SystemAlert["severity"],
        source: a.source,
        message: a.message,
        ack: a.ack,
        createdAt: toIso(a.createdAt)!,
      }));
      return NextResponse.json(paginatedResponse<SystemAlert>(alerts, total, page, limit));
    }

    // Legacy path (no ?page=) — original envelope with summary counts.
    const limitRaw = searchParams.get("limit");
    const limit = Math.min(Math.max(parseInt(limitRaw ?? "50", 10) || 50, 1), 200);

    const rows = await db.systemAlert.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const alerts: SystemAlert[] = rows.map((a) => ({
      id: a.id,
      severity: a.severity as SystemAlert["severity"],
      source: a.source,
      message: a.message,
      ack: a.ack,
      createdAt: toIso(a.createdAt)!,
    }));

    // Summary counts useful for the dashboard ticker.
    const unacked = alerts.filter((a) => !a.ack).length;
    const critical = alerts.filter((a) => !a.ack && a.severity === "critical").length;

    return NextResponse.json({
      alerts,
      count: alerts.length,
      unacked,
      critical,
    });
  } catch (err) {
    logger.error("api.alerts.list.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to list alerts" },
      { status: 500 }
    );
  }
}
