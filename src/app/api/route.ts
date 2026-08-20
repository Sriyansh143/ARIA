import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api — liveness + connectivity probe. */
export async function GET() {
  let dbOk = false;
  try {
    await db.agent.count();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return NextResponse.json({
    service: "aria-mission-control",
    version: "25.9.7",
    status: dbOk ? "operational" : "degraded",
    db: dbOk ? "connected" : "disconnected",
    uptime: Math.floor(process.uptime()),
    ts: new Date().toISOString(),
  });
}
