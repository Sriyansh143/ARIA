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
  if (!key || !name || !schedule) return NextResponse.json({ error: 'key, name, schedule required' }, { status: 400 });
  const job = await db.cronJob.upsert({
    where: { key },
    update: { name, schedule, description, enabled },
    create: { key, name, schedule, description, enabled: enabled ?? true },
  });
  return NextResponse.json({ job });
}
