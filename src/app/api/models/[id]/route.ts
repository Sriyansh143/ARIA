import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/models/[id] — single model detail.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const model = await db.model.findUnique({ where: { id } });
  if (!model) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ model });
}

// PATCH /api/models/[id] — update enabled / status / latencyMs / pricingPer1k
// (also tier / contextWindow / capabilities / name) for a single model.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const allowed = new Set([
    'enabled',
    'status',
    'latencyMs',
    'pricingPer1k',
    'tier',
    'contextWindow',
    'capabilities',
    'name',
  ]);
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (allowed.has(k)) data[k] = v;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 });
  }

  try {
    const updated = await db.model.update({ where: { id }, data });
    return NextResponse.json({ ok: true, model: updated });
  } catch {
    return NextResponse.json({ error: 'Model not found or update failed' }, { status: 404 });
  }
}

// DELETE /api/models/[id] — hard delete a single model row.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await db.model.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Model not found' }, { status: 404 });
  }
}
