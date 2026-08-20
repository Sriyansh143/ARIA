/**
 * GET /api/finance/pnl — v73 Phase 23 (RULE-74)
 *
 * Returns real-time Profit & Loss = Revenue - COGS - OpEx.
 *
 * Query params:
 *   ?from=2026-01-01 (ISO date, default: 30 days ago)
 *   ?to=2026-12-31   (ISO date, default: now)
 *   ?subAccount=Revenue:SaaS-Scaffold (filter by sub-account)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrResponse } from "@/lib/auth";
import { calculatePnL, verifyLedgerBalance, getCashBalance } from "@/lib/finance/ledger";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuthOrResponse("GET", "/api/finance/pnl");
  if (auth instanceof NextResponse) return auth;

  try {
    const fromParam = req.nextUrl.searchParams.get("from");
    const toParam = req.nextUrl.searchParams.get("to");
    const fromDate = fromParam ? new Date(fromParam) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = toParam ? new Date(toParam) : new Date();

    const [pnl, balance, ledgerCheck] = await Promise.all([
      calculatePnL(fromDate, toDate),
      getCashBalance(),
      verifyLedgerBalance(),
    ]);

    return NextResponse.json({
      ok: true,
      pnl,
      cashBalance: balance,
      ledgerBalance: ledgerCheck,
      message: `P&L ${fromDate.toISOString().slice(0, 10)} → ${toDate.toISOString().slice(0, 10)}: Revenue=$${(pnl.revenue.totalCents / 100).toFixed(2)}, COGS=$${(pnl.cogs.totalCents / 100).toFixed(2)}, OpEx=$${(pnl.opex.totalCents / 100).toFixed(2)}, Net Profit=$${(pnl.netProfitCents / 100).toFixed(2)} (${pnl.marginPercent.toFixed(1)}% margin)`,
    });
  } catch (err) {
    logger.error("api.finance.pnl.failed", { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
  }
}
