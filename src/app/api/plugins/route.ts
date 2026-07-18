import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/plugins — list plugins, optionally filtered by ?category= or ?enabled=
export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get('category');
  const enabled = req.nextUrl.searchParams.get('enabled');
  const where: Record<string, unknown> = {};
  if (category && category !== 'all') where.category = category;
  if (enabled === 'true') where.enabled = true;
  if (enabled === 'false') where.enabled = false;
  const plugins = await db.plugin.findMany({
    where,
    orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
  });
  return NextResponse.json({ plugins });
}

// POST /api/plugins — create a new plugin.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { key, name, description, category, version, enabled, config } = body;
  if (!key || !name) {
    return NextResponse.json({ error: 'key and name required' }, { status: 400 });
  }
  const plugin = await db.plugin.upsert({
    where: { key },
    update: { name, description, category, version, enabled, config },
    create: {
      key,
      name,
      description: description ?? '',
      category: category ?? 'general',
      version: version ?? '1.0.0',
      enabled: enabled ?? false,
      config: typeof config === 'string' ? config : JSON.stringify(config ?? {}),
    },
  });
  return NextResponse.json({ plugin });
}
