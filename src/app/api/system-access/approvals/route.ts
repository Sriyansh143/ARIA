import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/system-access/approvals?status=pending
 * Lists SystemAccessApproval rows joined with their sessions.
 */
export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get("status") ?? undefined;
    // We surface pending sessions as the "approvals queue" — these are
    // sessions that need a decision.
    const sessions = await db.systemAccessSession.findMany({
      where: status ? { status } : { status: "pending" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ sessions, count: sessions.length });
  } catch (err) {
    logger.error("api.system-access.approvals.list.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to list approvals" },
      { status: 500 }
    );
  }
}
