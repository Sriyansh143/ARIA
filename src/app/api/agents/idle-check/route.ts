import { NextResponse } from 'next/server';
import { assignIdleAgents } from '@/lib/task-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST — check for idle agents and assign them tasks
export async function POST() {
  const result = await assignIdleAgents();
  return NextResponse.json(result);
}
