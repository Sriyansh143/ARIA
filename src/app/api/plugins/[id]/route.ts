import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// PATCH /api/plugins/[id] — update a plugin (toggle, config change, etc).
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const allowed = ['name', 'description', 'category', 'version', 'enabled', 'config'];
  const data: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) {
    if (k === 'config' && typeof body[k] !== 'string') {
      data[k] = JSON.stringify(body[k] ?? {});
    } else {
      data[k] = body[k];
    }
  }
  const plugin = await db.plugin.update({ where: { id }, data });
  return NextResponse.json({ plugin });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.plugin.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
