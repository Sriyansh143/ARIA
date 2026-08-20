import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { listArtifacts, synthesizeArtifacts } from "@/lib/failure-alchemy";

export const dynamic = "force-dynamic";

/**
 * GET /api/failure-alchemy?type=antibody
 */
export async function GET(req: NextRequest) {
  try {
    const type = req.nextUrl.searchParams.get("type") ?? undefined;
    const artifacts = await listArtifacts(type);
    return NextResponse.json({ artifacts, count: artifacts.length });
  } catch (err) {
    logger.error("api.failure-alchemy.list.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to list artifacts" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/failure-alchemy — synthesize new artifacts from recent errors.
 */
export async function POST() {
  try {
    const result = await synthesizeArtifacts();
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.failure-alchemy.synthesize.failed", { error: String(err) });
    return NextResponse.json(
      { error: "synthesize failed" },
      { status: 500 }
    );
  }
}
