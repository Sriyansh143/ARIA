import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET — fetch one template.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const t = await db.autonomyTemplate.findUnique({ where: { id } });
  if (!t) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ template: { ...t, tags: JSON.parse(t.tags) } });
}

// DELETE — remove a template.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.autonomyTemplate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
