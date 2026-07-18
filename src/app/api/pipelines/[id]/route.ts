import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET — fetch one pipeline template (with parsed steps).
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const p = await db.pipeline.findUnique({ where: { id } });
  if (!p) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ pipeline: { ...p, steps: JSON.parse(p.steps) } });
}

// DELETE — remove a pipeline template.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.pipeline.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

// POST — increment the run counter (when a pipeline is executed).
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pipeline = await db.pipeline.update({ where: { id }, data: { runs: { increment: 1 } } });
  return NextResponse.json({ pipeline });
}
