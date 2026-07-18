import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Toggle enabled + increment run counter.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const skill = await db.skill.findUnique({ where: { key } });
  if (!skill) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const data: Record<string, unknown> = {};
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled;
  if (typeof body.runs === 'number') data.runs = body.runs;
  const updated = await db.skill.update({ where: { key }, data });
  return NextResponse.json({ skill: updated });
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const skill = await db.skill.update({ where: { key }, data: { runs: { increment: 1 } } });
  return NextResponse.json({ skill });
}
