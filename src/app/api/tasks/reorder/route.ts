import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Task ID 3 (PARALLEL-C) — drag-and-drop reordering within a Kanban column.
//
// POST /api/tasks/reorder
// Body: { items: Array<{ id: string; sortOrder: number }> }
// Updates the `sortOrder` field for each task inside a single transaction so
// the column reorders atomically. Returns { ok: true, updated: N }.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const rawItems: unknown = body?.items;

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ ok: true, updated: 0 });
  }

  // Validate + coerce each item — silently drop malformed entries.
  const items: Array<{ id: string; sortOrder: number }> = [];
  const seenIds = new Set<string>();
  for (const it of rawItems) {
    if (!it || typeof it !== 'object') continue;
    const id = (it as { id?: unknown }).id;
    const sortOrder = (it as { sortOrder?: unknown }).sortOrder;
    if (typeof id !== 'string' || typeof sortOrder !== 'number' || !Number.isFinite(sortOrder)) continue;
    if (seenIds.has(id)) continue; // dedupe — last write wins in array order
    seenIds.add(id);
    items.push({ id, sortOrder: Math.trunc(sortOrder) });
  }

  if (items.length === 0) {
    return NextResponse.json({ error: 'no valid items' }, { status: 400 });
  }

  // Single transaction — all updates succeed or none do.
  const results = await db.$transaction(
    items.map((it) =>
      db.task.update({
        where: { id: it.id },
        data: { sortOrder: it.sortOrder },
        select: { id: true },
      }),
    ),
  );

  return NextResponse.json({ ok: true, updated: results.length });
}
