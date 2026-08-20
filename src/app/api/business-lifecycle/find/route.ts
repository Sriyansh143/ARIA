import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { findOpportunities } from "@/lib/autonomous-business-engine";

export const dynamic = "force-dynamic";

/**
 * POST /api/business-lifecycle/find — discover fresh opportunities for an industry.
 * Body: { industryPlaybookId: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      industryPlaybookId?: string;
    };
    if (!body.industryPlaybookId) {
      return NextResponse.json(
        { error: "industryPlaybookId is required" },
        { status: 400 },
      );
    }
    const result = await findOpportunities(body.industryPlaybookId);
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.business-lifecycle.find.failed", { error: String(err) });
    return NextResponse.json(
      { error: "find opportunities failed" },
      { status: 500 },
    );
  }
}
