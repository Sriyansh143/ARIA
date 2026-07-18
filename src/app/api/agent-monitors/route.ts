import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  listMonitors,
  runAllMonitors,
  getAllLastRuns,
  type MonitorDef,
} from '@/lib/agent-monitors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── GET /api/agent-monitors ──────────────────────────────────────────
// Returns the monitor registry + last-run info + open finding counts per
// monitor. Used by the AgentMonitor tab's "Monitor registry grid".
export async function GET() {
  const monitors: MonitorDef[] = listMonitors();
  const lastRuns = getAllLastRuns();

  // Fetch open finding counts per monitor in parallel.
  const openCountsArr = await Promise.all(
    monitors.map((m) =>
      db.agentMonitorFinding.count({
        where: { monitorKey: m.key, status: 'open' },
      }),
    ),
  );
  const openCounts: Record<string, number> = {};
  monitors.forEach((m, i) => {
    openCounts[m.key] = openCountsArr[i] ?? 0;
  });

  // Also fetch total + critical finding counts.
  const [totalOpen, totalCritical, totalError] = await Promise.all([
    db.agentMonitorFinding.count({ where: { status: 'open' } }),
    db.agentMonitorFinding.count({
      where: { status: 'open', severity: 'critical' },
    }),
    db.agentMonitorFinding.count({
      where: { status: 'open', severity: 'error' },
    }),
  ]);

  return NextResponse.json({
    monitors: monitors.map((m) => ({
      key: m.key,
      name: m.name,
      description: m.description,
      intervalMs: m.intervalMs,
      lastRun: lastRuns[m.key] ?? null,
      openFindings: openCounts[m.key] ?? 0,
    })),
    summary: {
      totalMonitors: monitors.length,
      totalOpenFindings: totalOpen,
      criticalOpen: totalCritical,
      errorOpen: totalError,
    },
    sampledAt: new Date().toISOString(),
  });
}

// ─── POST /api/agent-monitors ─────────────────────────────────────────
// Run ALL monitors. Returns per-monitor results. NEVER throws.
export async function POST() {
  const results = await runAllMonitors();
  const created = results.reduce((s, r) => s + r.findingsCreated, 0);
  const deduped = results.reduce((s, r) => s + r.findingsDeduped, 0);
  const failed = results.filter((r) => !r.ok);

  return NextResponse.json({
    ok: failed.length === 0,
    ranAt: new Date().toISOString(),
    results,
    summary: {
      totalMonitors: results.length,
      findingsCreated: created,
      findingsDeduped: deduped,
      failedCount: failed.length,
    },
  });
}
