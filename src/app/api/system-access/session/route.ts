import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/system-access/session?status=approved
 * Lists SystemAccessSession rows.
 */
export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get("status") ?? undefined;
    const sessions = await db.systemAccessSession.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ sessions, count: sessions.length });
  } catch (err) {
    logger.error("api.system-access.session.list.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to list sessions" },
      { status: 500 }
    );
  }
}
