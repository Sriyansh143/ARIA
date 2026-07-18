import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get('scope');
  const q = req.nextUrl.searchParams.get('q');
  const where: Record<string, unknown> = {};
  if (scope) where.scope = scope;
  if (q) where.value = { contains: q };
  const items = await db.memoryItem.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 200 });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { scope, key, value, tags, pinned } = body;
  // ── Input validation ────────────────────────────────────────────
  if (typeof key !== 'string' || key.trim().length === 0) {
    return NextResponse.json({ error: 'key required' }, { status: 400 });
  }
  if (key.length > 200) {
    return NextResponse.json({ error: 'key must be 200 characters or fewer' }, { status: 400 });
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return NextResponse.json({ error: 'value required' }, { status: 400 });
  }
  if (value.length > 50000) {
    return NextResponse.json({ error: 'value must be 50000 characters or fewer' }, { status: 400 });
  }
  const item = await db.memoryItem.upsert({
    where: { key_scope: { key, scope: scope ?? 'semantic' } },
    update: { value, tags: JSON.stringify(tags ?? []), pinned: pinned ?? false },
    create: { scope: scope ?? 'semantic', key, value, tags: JSON.stringify(tags ?? []), pinned: pinned ?? false },
  });
  return NextResponse.json({ item });
}
