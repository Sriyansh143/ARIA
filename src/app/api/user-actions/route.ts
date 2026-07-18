import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── GET /api/user-actions ──────────────────────────────────────────
// List user actions with filters. Accepts ?type=&tab=&severity=&limit=.
// Returns newest first. Default limit 100, max 500.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get('type') ?? undefined;
  const tab = sp.get('tab') ?? undefined;
  const severity = sp.get('severity') ?? undefined;
  const limitRaw = parseInt(sp.get('limit') ?? '100', 10);
  const limit = Math.min(Math.max(1, isNaN(limitRaw) ? 100 : limitRaw), 500);

  const where: Record<string, unknown> = {};
  if (type) where.type = type;
  if (tab) where.tab = tab;
  if (severity) where.severity = severity;

  const [actions, total] = await Promise.all([
    db.userAction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    db.userAction.count({ where }),
  ]);

  return NextResponse.json({
    actions,
    total,
    count: actions.length,
    filters: { type: type ?? null, tab: tab ?? null, severity: severity ?? null, limit },
  });
}

// ─── POST /api/user-actions ─────────────────────────────────────────
// Create a user action row. Called fire-and-forget by action-tracker.ts.
// Body: { type, target?, label?, tab?, meta?, severity?, duration?, actor?, sessionId? }
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 });
  }

  const type = typeof body.type === 'string' ? body.type : null;
  if (!type) {
    return NextResponse.json({ ok: false, error: 'type-required' }, { status: 400 });
  }

  const allowedTypes = ['navigate', 'click', 'submit', 'toggle', 'create', 'delete', 'error', 'search', 'command'];
  if (!allowedTypes.includes(type)) {
    return NextResponse.json({ ok: false, error: `invalid-type:${type}` }, { status: 400 });
  }

  const severity = typeof body.severity === 'string' ? body.severity : 'info';
  const allowedSev = ['info', 'warn', 'error', 'critical'];
  if (!allowedSev.includes(severity)) {
    return NextResponse.json({ ok: false, error: `invalid-severity:${severity}` }, { status: 400 });
  }

  const created = await db.userAction.create({
    data: {
      type,
      target: typeof body.target === 'string' ? body.target : null,
      label: typeof body.label === 'string' ? body.label : null,
      tab: typeof body.tab === 'string' ? body.tab : null,
      meta: typeof body.meta === 'string' ? body.meta : JSON.stringify(body.meta ?? {}),
      severity,
      duration: typeof body.duration === 'number' ? body.duration : null,
      actor: typeof body.actor === 'string' ? body.actor : 'operator',
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : 'default',
    },
  });

  return NextResponse.json({ ok: true, id: created.id, createdAt: created.createdAt }, { status: 201 });
}
