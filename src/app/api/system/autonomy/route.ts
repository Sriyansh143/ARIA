import { NextRequest, NextResponse } from 'next/server';
import { dispatchCronJob, setAutonomyPaused } from '@/lib/cron-dispatcher';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — check autonomy status
export async function GET() {
  const item = await db.memoryItem.findFirst({
    where: { key: 'autonomy-paused', scope: 'semantic' },
  });
  const paused = item?.value === 'true';
  return NextResponse.json({ paused, status: paused ? 'PAUSED' : 'ACTIVE' });
}

// POST — pause/resume autonomy
// Body: { paused: boolean } or { action: 'pause' | 'resume' | 'toggle' }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  let paused: boolean;
  
  if (typeof body.paused === 'boolean') {
    paused = body.paused;
  } else if (body.action === 'pause') {
    paused = true;
  } else if (body.action === 'resume') {
    paused = false;
  } else if (body.action === 'toggle') {
    const item = await db.memoryItem.findFirst({
      where: { key: 'autonomy-paused', scope: 'semantic' },
    });
    paused = item?.value !== 'true';
  } else {
    return NextResponse.json({ error: 'paused (boolean) or action (pause|resume|toggle) required' }, { status: 400 });
  }

  await setAutonomyPaused(paused);
  return NextResponse.json({ ok: true, paused, status: paused ? 'PAUSED' : 'ACTIVE' });
}
