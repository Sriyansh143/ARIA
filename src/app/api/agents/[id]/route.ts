import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const agent = await db.agent.findUnique({
    where: { id },
    include: { logs: { orderBy: { createdAt: 'desc' }, take: 50 } },
  });
  if (!agent) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ agent });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const allowed = ['status', 'load', 'successRate', 'role', 'skills', 'model', 'taskCount', 'logCount'];
  const data: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) data[k] = body[k];
  data['lastActive'] = new Date();
  const agent = await db.agent.update({ where: { id }, data });
  return NextResponse.json({ agent });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.agent.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
