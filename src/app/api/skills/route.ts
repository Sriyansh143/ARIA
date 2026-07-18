import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const skills = await db.skill.findMany({ orderBy: { category: 'asc' } });
  return NextResponse.json({ skills });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { key, name, description, category, icon } = body;
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
  const skill = await db.skill.upsert({
    where: { key },
    update: { name, description, category, icon },
    create: { key, name, description, category: category ?? 'general', icon: icon ?? 'Sparkles' },
  });
  return NextResponse.json({ skill });
}
