/**
 * GET /api/audit-log — query the audit trail.
 *
 * Query params:
 *   ?actor=<name>      — filter by actor (exact match)
 *   ?resource=<name>   — filter by resource (e.g. "Approval", "Contract")
 *   ?action=<verb>     — filter by action (e.g. "approve", "deny", "sign")
 *   ?since=<iso-date>  — entries on or after this date
 *   ?until=<iso-date> — entries on or before this date
 *   ?limit=<n>         — max results (default 100, max 1000)
 */
import { NextRequest, NextResponse } from "next/server";
import { queryAuditLog } from "@/lib/audit-log";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const actor = sp.get("actor") ?? undefined;
    const resource = sp.get("resource") ?? undefined;
    const action = sp.get("action") ?? undefined;
    const sinceStr = sp.get("since");
    const untilStr = sp.get("until");
    const limitStr = sp.get("limit");

    const since = sinceStr ? new Date(sinceStr) : undefined;
    const until = untilStr ? new Date(untilStr) : undefined;
    const limit = limitStr ? parseInt(limitStr, 10) : 100;

    if (sinceStr && (!since || !Number.isFinite(since.getTime()))) {
      return NextResponse.json({ error: "invalid `since` date" }, { status: 400 });
    }
    if (untilStr && (!until || !Number.isFinite(until.getTime()))) {
      return NextResponse.json({ error: "invalid `until` date" }, { status: 400 });
    }

    const entries = await queryAuditLog({ actor, resource, action, since, until, limit });
    return NextResponse.json({ entries, count: entries.length });
  } catch (err) {
    logger.error("api.audit-log.list-failed", { error: String(err) });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
