import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function serialize(m: {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  earningPotential: string;
  riskLevel: string;
  skillsRequired: string;
  method: string;
  approved: boolean;
  enabled: boolean;
  autoExecute: boolean;
  estimatedMonthly: number;
  lastResearched: Date | null;
  lastExecuted: Date | null;
  executionCount: number;
  totalEarnings: number;
  feedback: string;
  tags: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: m.id,
    key: m.key,
    name: m.name,
    description: m.description,
    category: m.category,
    earningPotential: m.earningPotential,
    riskLevel: m.riskLevel,
    skillsRequired: safeParse<string[]>(m.skillsRequired, []),
    method: m.method,
    approved: m.approved,
    enabled: m.enabled,
    autoExecute: m.autoExecute,
    estimatedMonthly: m.estimatedMonthly,
    lastResearched: m.lastResearched ? m.lastResearched.toISOString() : null,
    lastExecuted: m.lastExecuted ? m.lastExecuted.toISOString() : null,
    executionCount: m.executionCount,
    totalEarnings: m.totalEarnings,
    feedback: safeParse<unknown[]>(m.feedback, []),
    tags: safeParse<string[]>(m.tags, []),
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const existing = await db.earningMethod.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const data: Record<string, unknown> = {};
  const scalars = [
    'name', 'description', 'category', 'earningPotential', 'riskLevel', 'method',
    'estimatedMonthly', 'approved', 'enabled', 'autoExecute',
  ];
  for (const k of scalars) {
    if (k in body) data[k] = (body as Record<string, unknown>)[k];
  }
  if ('skillsRequired' in body && Array.isArray(body.skillsRequired)) {
    data.skillsRequired = JSON.stringify(body.skillsRequired);
  }
  if ('tags' in body && Array.isArray(body.tags)) {
    data.tags = JSON.stringify(body.tags);
  }
  if ('lastResearched' in body) {
    data.lastResearched = body.lastResearched ? new Date(body.lastResearched as string) : null;
  }
  if ('lastExecuted' in body) {
    data.lastExecuted = body.lastExecuted ? new Date(body.lastExecuted as string) : null;
  }
  if ('executionCount' in body) data.executionCount = Number(body.executionCount);
  if ('totalEarnings' in body) data.totalEarnings = Number(body.totalEarnings);

  const updated = await db.earningMethod.update({ where: { id }, data });
  return NextResponse.json({ method: serialize(updated) });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.earningMethod.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
