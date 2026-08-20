import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getDebate } from "@/lib/debate";

export const dynamic = "force-dynamic";

/**
 * GET /api/debate/[id] — fetch a single debate (including transcript JSON).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const debate = await getDebate(id);
    if (!debate) {
      return NextResponse.json(
        { error: "debate not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ debate });
  } catch (err) {
    logger.error("api.debate.get.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to get debate" },
      { status: 500 }
    );
  }
}
