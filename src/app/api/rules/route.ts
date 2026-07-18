import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/rules — list rules, optionally filtered by ?category=
export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get('category');
  const where: Record<string, unknown> = {};
  if (category && category !== 'all') where.category = category;
  const rules = await db.rule.findMany({
    where,
    orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
  });
  return NextResponse.json({ rules });
}

// POST /api/rules — create a new rule.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { key, title, description, category, priority, enabled } = body;
  if (!key || !title) {
    return NextResponse.json({ error: 'key and title required' }, { status: 400 });
  }
  const rule = await db.rule.upsert({
    where: { key },
    update: { title, description, category, priority, enabled },
    create: {
      key,
      title,
      description: description ?? '',
      category: category ?? 'custom',
      priority: priority ?? 'medium',
      enabled: enabled ?? true,
    },
  });
  return NextResponse.json({ rule });
}
