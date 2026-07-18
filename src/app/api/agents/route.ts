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
  if (!name || !codename) {
    return NextResponse.json({ error: 'name and codename required' }, { status: 400 });
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
