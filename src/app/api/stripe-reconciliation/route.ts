/**
 * GET /api/stripe-reconciliation — Phase 30
 *
 * Returns the Stripe reconciliation summary + the list of discrepancies.
 * Used by the dashboard's Financials → Reconciliation tab.
 *
 * Query params:
 *   ?days=7        — summary window (default 7, max 90)
 *   ?discrepancies=true — return only the discrepancy list (limit 50)
 */
import { NextRequest, NextResponse } from "next/server";
import { getReconciliationSummary, listDiscrepancies } from "@/lib/finance/stripe-reconciliation";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const days = Math.min(parseInt(sp.get("days") ?? "7", 10) || 7, 90);
    const onlyDiscrepancies = sp.get("discrepancies") === "true";

    if (onlyDiscrepancies) {
      const list = await listDiscrepancies(50);
      return NextResponse.json({ discrepancies: list, count: list.length });
    }

    const summary = await getReconciliationSummary(days);
    const discrepancies = await listDiscrepancies(20);

    return NextResponse.json({
      summary,
      recentDiscrepancies: discrepancies,
    });
  } catch (err) {
    logger.error("api.stripe-reconciliation.failed", { error: String(err) });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
