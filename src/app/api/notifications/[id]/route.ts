import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// PATCH — mark read/unread.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const n = await db.notification.update({ where: { id }, data: { read: !!body.read } });
  return NextResponse.json({ notification: n });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.notification.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
