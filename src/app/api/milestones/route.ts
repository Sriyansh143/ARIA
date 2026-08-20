import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { listMilestones, recordMilestone, MILESTONE_TYPES } from "@/lib/milestones";

export const dynamic = "force-dynamic";

/**
 * GET /api/milestones?viewed=false
 */
export async function GET(req: NextRequest) {
  try {
    const viewedRaw = req.nextUrl.searchParams.get("viewed");
    const viewed =
      viewedRaw === "true" ? true : viewedRaw === "false" ? false : undefined;
    const milestones = await listMilestones(viewed);
    return NextResponse.json({ milestones, count: milestones.length, types: MILESTONE_TYPES });
  } catch (err) {
    logger.error("api.milestones.list.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to list milestones" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/milestones
 * Body: { type, title, description?, intensity? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.type || !body?.title) {
      return NextResponse.json(
        { error: "type + title required" },
        { status: 400 }
      );
    }
    const result = await recordMilestone({
      type: String(body.type),
      title: String(body.title),
      description: body.description ? String(body.description) : undefined,
      intensity: body.intensity,
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.milestones.record.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to record milestone" },
      { status: 500 }
    );
  }
}
