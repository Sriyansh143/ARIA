import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { dispatchCronJob } from '@/lib/cron-dispatcher';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// PATCH — toggle enabled / update schedule.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled;
  if (body.schedule) data.schedule = body.schedule;
  const job = await db.cronJob.update({ where: { id }, data });
  return NextResponse.json({ job });
}

// Run the cron job now: bump runCount + lastRun, dispatch to real logic, emit notification.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = await db.cronJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const updated = await db.cronJob.update({
    where: { id },
    data: { runCount: { increment: 1 }, lastRun: new Date() },
  });

  // Dispatch to real job logic.
  const result = await dispatchCronJob(job.key);

  // Create a notification with the result.
  await db.notification.create({
    data: {
      type: result.ok ? 'success' : 'error',
      title: `Cron: ${job.name}`,
      message: `${result.detail} (${result.durationMs}ms)`,
      read: false,
    },
  });

  return NextResponse.json({ job: updated, result });
}
