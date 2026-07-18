import { NextResponse } from 'next/server';
import { getQueuedTasks, getQueueLength, dispatchNext } from '@/lib/task-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — list queued tasks
export async function GET() {
  return NextResponse.json({
    tasks: getQueuedTasks(),
    length: getQueueLength(),
  });
}

// POST — dispatch next task
export async function POST() {
  const task = await dispatchNext();
  return NextResponse.json({ dispatched: task });
}
