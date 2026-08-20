import { NextResponse } from "next/server";
import { getCostBreakdown } from "@/lib/cost-dashboard";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/cost-dashboard
 *
 * Returns the LLM cost breakdown for the last 30 days:
 *   - totals (30d, today, avg/day, calls, tokens)
 *   - budget (daily budget, utilization %, over-budget alert)
 *   - byProvider (cost + calls + tokens per provider)
 *   - byModel (top 10 models by cost)
 *   - daily (cost per day for the last 30 days, for the area chart)
 */
export async function GET() {
  try {
    const breakdown = await getCostBreakdown();
    return NextResponse.json(breakdown);
  } catch (err) {
    logger.error("api.cost-dashboard.get.error", { error: String(err) });
    return NextResponse.json(
      { error: "failed to load cost breakdown", detail: String(err) },
      { status: 500 },
    );
  }
}
