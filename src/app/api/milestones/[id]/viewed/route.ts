import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { markViewed } from "@/lib/milestones";

export const dynamic = "force-dynamic";

/**
 * POST /api/milestones/[id]/viewed
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await markViewed(id);
    if (!result.ok) {
      return NextResponse.json(
        { error: "milestone not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.milestones.viewed.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to mark viewed" },
      { status: 500 }
    );
  }
}
