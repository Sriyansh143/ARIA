import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
  qualifyOpportunities,
  type FoundOpportunity,
} from "@/lib/autonomous-business-engine";

export const dynamic = "force-dynamic";

/**
 * POST /api/business-lifecycle/qualify — qualify a batch of opportunities.
 * Body: { opportunities: FoundOpportunity[] }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      opportunities?: FoundOpportunity[];
    };
    if (!Array.isArray(body.opportunities)) {
      return NextResponse.json(
        { error: "opportunities array is required" },
        { status: 400 },
      );
    }
    const result = await qualifyOpportunities(body.opportunities);
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.business-lifecycle.qualify.failed", { error: String(err) });
    return NextResponse.json(
      { error: "qualify opportunities failed" },
      { status: 500 },
    );
  }
}
