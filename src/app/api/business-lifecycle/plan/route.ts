import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
  planExecution,
  type FoundOpportunity,
} from "@/lib/autonomous-business-engine";

export const dynamic = "force-dynamic";

/**
 * POST /api/business-lifecycle/plan — generate an execution plan for a single opportunity.
 * Body: { opportunity: FoundOpportunity }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      opportunity?: FoundOpportunity;
    };
    if (!body.opportunity) {
      return NextResponse.json(
        { error: "opportunity is required" },
        { status: 400 },
      );
    }
    const result = await planExecution(body.opportunity);
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.business-lifecycle.plan.failed", { error: String(err) });
    return NextResponse.json(
      { error: "plan execution failed" },
      { status: 500 },
    );
  }
}
