import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/goals — list goals (MemoryItem with scope='goal').
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status');
  const priority = req.nextUrl.searchParams.get('priority');
  const items = await db.memoryItem.findMany({
    where: { scope: 'goal' },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });
  let goals = items.map((m) => {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(m.value);
    } catch {
      parsed = { description: m.value };
    }
    return {
      id: m.id,
      key: m.key,
      title: (parsed.title as string) ?? m.key,
      description: (parsed.description as string) ?? m.value,
      status: (parsed.status as string) ?? 'pending',
      priority: (parsed.priority as string) ?? 'medium',
      progress: (parsed.progress as number) ?? 0,
      owner: (parsed.owner as string) ?? 'ORION',
      dueDate: (parsed.dueDate as string) ?? null,
      tags: (() => {
        try {
          return JSON.parse(m.tags || '[]');
        } catch {
          return [];
        }
      })(),
      pinned: m.pinned,
      updatedAt: m.updatedAt,
      createdAt: m.createdAt,
    };
  });
  if (status && status !== 'all') goals = goals.filter((g) => g.status === status);
  if (priority && priority !== 'all') goals = goals.filter((g) => g.priority === priority);
  return NextResponse.json({ goals });
}

// POST /api/goals — create or upsert a goal as MemoryItem(scope='goal').
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { id, title, description, status, priority, progress, owner, dueDate, tags, pinned } = body;
  if (!title) {
    return NextResponse.json({ error: 'title required' }, { status: 400 });
  }
  const key = (id as string) || `goal-${String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
  const value = JSON.stringify({
    title,
    description: description ?? '',
    status: status ?? 'pending',
    priority: priority ?? 'medium',
    progress: typeof progress === 'number' ? progress : 0,
    owner: owner ?? 'ORION',
    dueDate: dueDate ?? null,
  });
  const item = await db.memoryItem.upsert({
    where: { key_scope: { key, scope: 'goal' } },
    update: {
      value,
      tags: JSON.stringify(tags ?? []),
      pinned: pinned ?? false,
    },
    create: {
      scope: 'goal',
      key,
      value,
      tags: JSON.stringify(tags ?? []),
      pinned: pinned ?? false,
    },
  });
  return NextResponse.json({ goal: item });
}
