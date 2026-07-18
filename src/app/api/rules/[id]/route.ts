import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// PATCH /api/rules/[id] — update a rule.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const allowed = ['title', 'description', 'category', 'priority', 'enabled'];
  const data: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) data[k] = body[k];
  const rule = await db.rule.update({ where: { id }, data });
  return NextResponse.json({ rule });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.rule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
