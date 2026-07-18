import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface MethodRow {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  earningPotential: string;
  riskLevel: string;
  skillsRequired: string[];
  method: string;
  approved: boolean;
  enabled: boolean;
  autoExecute: boolean;
  estimatedMonthly: number;
  lastResearched: string | null;
  lastExecuted: string | null;
  executionCount: number;
  totalEarnings: number;
  feedback: unknown[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

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
}): MethodRow {
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

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const category = url.searchParams.get('category') || undefined;
  const approved = url.searchParams.get('approved');
  const enabled = url.searchParams.get('enabled');

  const where: Record<string, unknown> = {};
  if (category) where.category = category;
  if (approved !== null && approved !== null && approved !== undefined && approved !== '') {
    where.approved = approved === 'true';
  }
  if (enabled !== null && enabled !== undefined && enabled !== '') {
    where.enabled = enabled === 'true';
  }

  const rows = await db.earningMethod.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  const total = rows.length;
  const approvedCount = rows.filter((r) => r.approved).length;
  const activeCount = rows.filter((r) => r.enabled).length;
  const estMonthly = rows.reduce((s, r) => s + (r.estimatedMonthly || 0), 0);

  return NextResponse.json({
    methods: rows.map(serialize),
    stats: { total, approved: approvedCount, active: activeCount, estMonthly },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    key,
    name,
    description,
    category,
    earningPotential,
    riskLevel,
    skillsRequired,
    method,
    estimatedMonthly,
    tags,
    approved,
    enabled,
    autoExecute,
  } = body as {
    key?: string;
    name?: string;
    description?: string;
    category?: string;
    earningPotential?: string;
    riskLevel?: string;
    skillsRequired?: string[];
    method?: string;
    estimatedMonthly?: number;
    tags?: string[];
    approved?: boolean;
    enabled?: boolean;
    autoExecute?: boolean;
  };

  if (typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }
  if (name.length > 200) {
    return NextResponse.json({ error: 'name must be 200 characters or fewer' }, { status: 400 });
  }
  if (key !== undefined && key !== null) {
    if (typeof key !== 'string' || key.trim().length === 0) {
      return NextResponse.json({ error: 'key must be a non-empty string when provided' }, { status: 400 });
    }
    if (key.length > 128) {
      return NextResponse.json({ error: 'key must be 128 characters or fewer' }, { status: 400 });
    }
  }

  // Auto-derive a key from the name if not supplied.
  const finalKey = (key && key.trim()) || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // Avoid clashing on duplicates.
  const clash = await db.earningMethod.findUnique({ where: { key: finalKey } });
  if (clash) {
    return NextResponse.json({ error: `key "${finalKey}" already exists` }, { status: 409 });
  }

  const created = await db.earningMethod.create({
    data: {
      key: finalKey,
      name,
      description: description || '',
      category: category || 'general',
      earningPotential: earningPotential || 'medium',
      riskLevel: riskLevel || 'none',
      skillsRequired: JSON.stringify(skillsRequired || []),
      method: method || '',
      estimatedMonthly: Number(estimatedMonthly) || 0,
      tags: JSON.stringify(tags || []),
      approved: !!approved,
      enabled: !!enabled,
      autoExecute: !!autoExecute,
    },
  });

  return NextResponse.json({ method: serialize(created) });
}

// Suppress unused-import warning for randomUUID (kept for future use).
void randomUUID;
