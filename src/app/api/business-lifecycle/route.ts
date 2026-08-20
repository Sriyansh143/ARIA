import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
  runAutonomousCycle,
  getLifecyclePipeline,
} from "@/lib/autonomous-business-engine";

export const dynamic = "force-dynamic";

/**
 * GET /api/business-lifecycle — current lifecycle pipeline (8 stages with counts).
 */
export async function GET() {
  try {
    const pipeline = await getLifecyclePipeline();
    return NextResponse.json(pipeline);
  } catch (err) {
    logger.error("api.business-lifecycle.get.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to get lifecycle pipeline" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/business-lifecycle — run one full autonomous cycle for an industry.
 * Body: { industryPlaybookId: string }
 *
 * Long-running: may take 30-60s depending on LLM provider latency.
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
    const result = await runAutonomousCycle(body.industryPlaybookId);
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.business-lifecycle.post.failed", { error: String(err) });
    return NextResponse.json(
      { error: "autonomous cycle failed" },
      { status: 500 },
    );
  }
}
