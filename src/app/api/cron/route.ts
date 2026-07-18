import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const jobs = await db.cronJob.findMany({ orderBy: { createdAt: 'asc' } });
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { key, name, schedule, description, enabled } = body;
  // ── Input validation ────────────────────────────────────────────
  if (typeof key !== 'string' || key.trim().length === 0) {
    return NextResponse.json({ error: 'key required' }, { status: 400 });
  }
  if (key.length > 128) {
    return NextResponse.json({ error: 'key must be 128 characters or fewer' }, { status: 400 });
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }
  if (name.length > 200) {
    return NextResponse.json({ error: 'name must be 200 characters or fewer' }, { status: 400 });
  }
  if (typeof schedule !== 'string' || schedule.trim().length === 0) {
    return NextResponse.json({ error: 'schedule required' }, { status: 400 });
  }
  if (schedule.length > 100) {
    return NextResponse.json({ error: 'schedule must be 100 characters or fewer' }, { status: 400 });
  }
  const job = await db.cronJob.upsert({
    where: { key },
    update: { name, schedule, description, enabled },
    create: { key, name, schedule, description, enabled: enabled ?? true },
  });
  return NextResponse.json({ job });
}
