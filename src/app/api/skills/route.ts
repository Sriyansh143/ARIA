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
  if (!key || !name) return NextResponse.json({ error: 'key and name required' }, { status: 400 });
  const skill = await db.skill.upsert({
    where: { key },
    update: { name, description, category, icon },
    create: { key, name, description, category: category ?? 'general', icon: icon ?? 'Sparkles' },
  });
  return NextResponse.json({ skill });
}
