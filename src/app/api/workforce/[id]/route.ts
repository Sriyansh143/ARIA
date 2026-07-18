import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// PATCH /api/workforce/[id] — update a workforce agent.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const allowed = ['title', 'departmentKey', 'seniority', 'modelTier', 'skills', 'personality', 'status', 'reportsTo'];
  const data: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) data[k] = body[k];
  const agent = await db.workforceAgent.update({ where: { id }, data });
  return NextResponse.json({ agent });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.workforceAgent.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
