import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── GET /api/user-actions/stats ──────────────────────────────────────
// Returns counts by type / tab / severity for the last 24h. Used by the
// AgentMonitor tab's "User Activity Stats" panel.
export async function GET() {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [byTypeRaw, byTabRaw, bySeverityRaw, total, errorCount, topTabsRaw] = await Promise.all([
    db.userAction.groupBy({
      by: ['type'],
      where: { createdAt: { gt: oneDayAgo } },
      _count: { _all: true },
    }),
    db.userAction.groupBy({
      by: ['tab'],
      where: { createdAt: { gt: oneDayAgo } },
      _count: { _all: true },
    }),
    db.userAction.groupBy({
      by: ['severity'],
      where: { createdAt: { gt: oneDayAgo } },
      _count: { _all: true },
    }),
    db.userAction.count({ where: { createdAt: { gt: oneDayAgo } } }),
    db.userAction.count({
      where: { severity: { in: ['error', 'critical'] }, createdAt: { gt: oneDayAgo } },
    }),
    db.userAction.groupBy({
      by: ['tab'],
      where: { createdAt: { gt: oneDayAgo }, type: 'navigate' },
      _count: { _all: true },
      orderBy: { _count: { tab: 'desc' } },
      take: 5,
    }),
  ]);

  const byType: Record<string, number> = {};
  for (const r of byTypeRaw) byType[r.type] = r._count._all;

  const byTab: Record<string, number> = {};
  for (const r of byTabRaw) byTab[r.tab ?? 'unknown'] = r._count._all;

  const bySeverity: Record<string, number> = {};
  for (const r of bySeverityRaw) bySeverity[r.severity] = r._count._all;

  return NextResponse.json({
    window: '24h',
    total,
    errorCount,
    errorRate: total > 0 ? Number(((errorCount / total) * 100).toFixed(2)) : 0,
    byType,
    byTab,
    bySeverity,
    topTabs: topTabsRaw.map((r) => ({ tab: r.tab ?? 'unknown', count: r._count._all })),
    sampledAt: new Date().toISOString(),
  });
}
