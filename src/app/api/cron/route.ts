import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { toIso, type CronJob } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron — list registered cron jobs.
 *
 * Supports optional query params:
 *   ?status=active|paused|error
 *   ?limit=50  (capped to 200)
 *
 * Returns newest-first. Used by the CronRegistry dashboard widget and
 * the central registry snapshot.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status");
  const limitRaw = searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitRaw ?? "50", 10) || 50, 1), 200);

  const where: { status?: string } = {};
  if (status) where.status = status;

  try {
    const rows = await db.cronJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const jobs: CronJob[] = rows.map((j) => ({
      id: j.id,
      name: j.name,
      schedule: j.schedule,
      description: j.description,
      status: j.status as CronJob["status"],
      lastRunAt: toIso(j.lastRunAt),
      nextRunAt: toIso(j.nextRunAt),
      lastResult: j.lastResult,
      runCount: j.runCount,
      failCount: j.failCount,
      createdAt: toIso(j.createdAt)!,
      updatedAt: toIso(j.updatedAt)!,
    }));

    const active = jobs.filter((j) => j.status === "active").length;
    const errored = jobs.filter((j) => j.status === "error").length;

    return NextResponse.json({
      jobs,
      count: jobs.length,
      active,
      errored,
    });
  } catch (err) {
    logger.error("api.cron.list.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to list cron jobs" },
      { status: 500 }
    );
  }
}
