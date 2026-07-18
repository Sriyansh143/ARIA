import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── GET /api/agent-monitors/findings ─────────────────────────────────
// List findings with filters. Accepts ?status=&severity=&tab=&monitorKey=&limit=.
// Returns newest first. Default limit 100, max 500.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const status = sp.get('status') ?? undefined;
  const severity = sp.get('severity') ?? undefined;
  const tab = sp.get('tab') ?? undefined;
  const monitorKey = sp.get('monitorKey') ?? undefined;
  const limitRaw = parseInt(sp.get('limit') ?? '100', 10);
  const limit = Math.min(Math.max(1, isNaN(limitRaw) ? 100 : limitRaw), 500);

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (severity) where.severity = severity;
  if (tab) where.tab = tab;
  if (monitorKey) where.monitorKey = monitorKey;

  const [findings, total] = await Promise.all([
    db.agentMonitorFinding.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    db.agentMonitorFinding.count({ where }),
  ]);

  // Parse JSON fields for the client.
  const parsed = findings.map((f) => ({
    ...f,
    evidence: safeParseJson(f.evidence, {}),
    actionMeta: safeParseJson(f.actionMeta, {}),
  }));

  return NextResponse.json({
    findings: parsed,
    total,
    count: parsed.length,
    filters: { status: status ?? null, severity: severity ?? null, tab: tab ?? null, monitorKey: monitorKey ?? null, limit },
  });
}

function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
