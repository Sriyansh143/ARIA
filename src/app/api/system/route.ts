import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSystemSnapshot, APP_FEATURES, API_ROUTES } from "@/lib/central-registry";
import { parsePagination, paginatedResponse } from "@/lib/pagination";

export const dynamic = "force-dynamic";

/**
 * GET /api/system — centralized system snapshot.
 *
 * This is the canonical source of truth for all dashboard panels.
 *
 * Query params (all optional):
 *   ?page=1    — when present, the response additionally includes a
 *                `lists` object with paginated `agents` + `tasks` +
 *                `approvals` + `alerts` arrays using the standard
 *                paginated envelope.
 *   ?limit=50  — page size for the paginated arrays (max 200).
 *
 * When `?page=` is absent the response is unchanged (backward compat):
 *   { snapshot, features, apiRoutes, version }
 * (Capping at 100 still applies if a caller passes a bare `?limit=` —
 * the snapshot route never returns more than 100 rows per array so a
 * misbehaving caller can't OOM the dashboard.)
 */
export async function GET(req: NextRequest) {
  try {
    const snapshot = await getSystemSnapshot();
    const baseResponse = {
      snapshot,
      features: APP_FEATURES,
      apiRoutes: API_ROUTES,
      version: "v28.0-hermes-native",
    };

    // Backward-compat path: no ?page= → return the bare snapshot.
    if (!req.nextUrl.searchParams.has("page")) {
      return NextResponse.json(baseResponse);
    }

    // Paginated path: ?page= present → fetch each list with the same
    // page/limit and return a `lists` object containing four paginated
    // envelopes (agents, tasks, approvals, alerts). Each is capped at
    // 100 rows when no explicit ?limit= is provided so the snapshot
    // route stays cheap even for very large fleets.
    const sp = req.nextUrl.searchParams;
    const limitRaw = parseInt(sp.get("limit") ?? "100", 10);
    const cap = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(limitRaw, 100) : 100;
    // Re-derive page from the pagination helper but force the limit cap.
    const { skip, page } = parsePagination(req);
    const take = cap;

    const [
      agentsRows, agentsTotal,
      tasksRows, tasksTotal,
      approvalsRows, approvalsTotal,
      alertsRows, alertsTotal,
    ] = await Promise.all([
      db.agent.findMany({ take, skip, orderBy: { createdAt: "desc" } }),
      db.agent.count(),
      db.task.findMany({ take, skip, orderBy: { createdAt: "desc" }, include: { assignedTo: true } }),
      db.task.count(),
      db.approval.findMany({ take, skip, orderBy: { createdAt: "desc" } }),
      db.approval.count(),
      db.systemAlert.findMany({ take, skip, orderBy: { createdAt: "desc" } }),
      db.systemAlert.count(),
    ]);

    return NextResponse.json({
      ...baseResponse,
      lists: {
        agents: paginatedResponse(agentsRows, agentsTotal, page, take),
        tasks: paginatedResponse(tasksRows, tasksTotal, page, take),
        approvals: paginatedResponse(approvalsRows, approvalsTotal, page, take),
        alerts: paginatedResponse(alertsRows, alertsTotal, page, take),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
