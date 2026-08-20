import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { emit } from "@/lib/event-bus";
import { toIso, type CronJob } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/cron/[id]/run
 *
 * Manually triggers a cron job: calls the REAL JOB_HANDLERS dispatch (not a
 * Math.random() simulation), records a CronRun, updates the job's
 * lastRunAt/nextRunAt/runCount, and re-broadcasts the updated CronJob so
 * every client reflects the manual execution.
 *
 * v61.4 Phase 9 FIX: This route previously faked the outcome with
 * Math.random() based on the job's historical fail rate — corrupting the
 * audit table with fabricated data. It now calls the real handler via
 * runJobByName() exported from cron-scheduler.ts.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const job = await db.cronJob.findUnique({ where: { id } });
    if (!job) {
      return NextResponse.json({ error: "cron job not found" }, { status: 404 });
    }

    // v61.4 Phase 9 FIX: call the REAL handler, not Math.random().
    const { runJobByName } = await import("@/lib/cron-scheduler");
    const { ok, result, latencyMs } = await runJobByName(job.name);

    // runJobByName already recorded the CronRun + updated the job + emitted events.
    // Re-fetch the updated job to return the fresh state.
    const updated = await db.cronJob.findUnique({ where: { id } });
    if (!updated) {
      return NextResponse.json({ ok: true, run: { ok, latencyMs, result } });
    }

    const jobPayload: CronJob = {
      id: updated.id,
      name: updated.name,
      schedule: updated.schedule,
      description: updated.description,
      status: updated.status as CronJob["status"],
      lastRunAt: toIso(updated.lastRunAt),
      nextRunAt: toIso(updated.nextRunAt),
      lastResult: updated.lastResult,
      runCount: updated.runCount,
      failCount: updated.failCount,
      createdAt: toIso(updated.createdAt)!,
      updatedAt: toIso(updated.updatedAt)!,
    };

    return NextResponse.json({
      ok: true,
      job: jobPayload,
      run: { ok, latencyMs, result },
    });
  } catch (err) {
    logger.error("api.cron.run.failed", { id, error: String(err) });
    return NextResponse.json(
      { error: "failed to run cron job" },
      { status: 500 }
    );
  }
}
