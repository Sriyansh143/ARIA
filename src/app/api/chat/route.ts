import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// Recent events for the live event ticker + logs view.
export async function GET() {
  try {
    // re-export of events under /api/chat for the live feed (kept separate
    // from SSE for polling clients)
    const events = await db.event.findMany({ orderBy: { createdAt: "desc" }, take: 80 });
    return NextResponse.json({ events });
  } catch (err) {
    logger.error("api.chat.events.failed", { err: String(err) });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
