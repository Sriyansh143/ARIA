import { NextRequest, NextResponse } from 'next/server';
import {
  getSpawnedAgent,
  touchSpawnedAgent,
  retireSpawnedAgent,
  recordSpawnedEarnings,
  deleteSpawnedAgent,
} from '@/lib/agent-spawner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = await getSpawnedAgent(id);
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ spawned: row });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');

  const existing = await getSpawnedAgent(id);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (action === 'touch') {
    const row = await touchSpawnedAgent(existing.codename);
    return NextResponse.json({ spawned: row });
  }

  if (action === 'retire') {
    const row = await retireSpawnedAgent(existing.codename);
    return NextResponse.json({ spawned: row });
  }

  if (action === 'record-earnings') {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 });
    }
    const row = await recordSpawnedEarnings(existing.codename, amount);
    return NextResponse.json({ spawned: row });
  }

  return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteSpawnedAgent(id);
  return NextResponse.json({ ok: true });
}
