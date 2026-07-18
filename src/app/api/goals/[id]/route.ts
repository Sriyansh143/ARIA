import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// PATCH /api/goals/[id] — update progress / status / priority.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const existing = await db.memoryItem.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(existing.value);
  } catch {
    parsed = { description: existing.value };
  }
  const merged: Record<string, unknown> = {
    title: parsed.title ?? existing.key,
    description: parsed.description ?? existing.value,
    status: body.status ?? parsed.status ?? 'pending',
    priority: body.priority ?? parsed.priority ?? 'medium',
    progress: typeof body.progress === 'number' ? body.progress : (parsed.progress ?? 0),
    owner: body.owner ?? parsed.owner ?? 'ORION',
    dueDate: body.dueDate ?? parsed.dueDate ?? null,
  };
  const updated = await db.memoryItem.update({
    where: { id },
    data: {
      value: JSON.stringify(merged),
      pinned: typeof body.pinned === 'boolean' ? body.pinned : existing.pinned,
    },
  });
  return NextResponse.json({ goal: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.memoryItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
