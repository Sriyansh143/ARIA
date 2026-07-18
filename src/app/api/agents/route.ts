import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const agents = await db.agent.findMany({ orderBy: { codename: 'asc' } });
  return NextResponse.json({ agents });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { name, codename, role, skills, model } = body;
  // Validate name — non-empty string within max length.
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }
  if (name.length > 200) {
    return NextResponse.json({ error: 'name must be 200 characters or fewer' }, { status: 400 });
  }
  // Validate codename — non-empty, max length, uppercase-only letters/numbers.
  if (!codename || typeof codename !== 'string' || codename.trim().length === 0) {
    return NextResponse.json({ error: 'codename required' }, { status: 400 });
  }
  if (codename.length > 64) {
    return NextResponse.json({ error: 'codename must be 64 characters or fewer' }, { status: 400 });
  }
  if (codename !== codename.toUpperCase()) {
    return NextResponse.json({ error: 'codename must be uppercase' }, { status: 400 });
  }
  const agent = await db.agent.create({
    data: {
      name,
      codename: String(codename).toUpperCase(),
      role: role ?? 'Generalist',
      skills: JSON.stringify(skills ?? []),
      model: model ?? 'glm-4.6',
      status: 'idle',
    },
  });
  return NextResponse.json({ agent });
}
