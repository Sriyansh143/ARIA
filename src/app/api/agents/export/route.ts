import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { JARVIS } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Export analytics data as CSV.
// GET /api/agents/export?range=7d|30d|all&type=perAgent|skillStats|timeSeries
export async function GET(req: NextRequest) {
  const range = req.nextUrl.searchParams.get('range') ?? '30d';
  const type = req.nextUrl.searchParams.get('type') ?? 'perAgent';
  const days = range === '7d' ? 7 : range === 'all' ? 9999 : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [agents, tasks, logs, messages, skillRuns] = await Promise.all([
    db.agent.findMany({ orderBy: { codename: 'asc' } }),
    db.task.findMany({ where: { createdAt: { gte: since } }, include: { assignee: { select: { codename: true } } } }),
    db.agentLog.findMany({ where: { createdAt: { gte: since } }, include: { agent: { select: { codename: true } } } }),
    db.agentMessage.findMany({ where: { createdAt: { gte: since } }, select: { fromAgent: true, toAgent: true } }),
    db.skillRun.findMany({ where: { createdAt: { gte: since } }, select: { skillKey: true, status: true, latencyMs: true, createdAt: true } }),
  ]);

  let headers: string[] = [];
  let rows: string[][] = [];

  if (type === 'perAgent') {
    headers = ['Codename', 'Role', 'Status', 'Load', 'SuccessRate', 'Tasks', 'Completed', 'CompletionRate', 'Logs', 'Errors', 'CommsSent', 'CommsReceived'];
    rows = agents.map((a) => {
      const at = tasks.filter((t) => t.assignee?.codename === a.codename);
      const al = logs.filter((l) => l.agent?.codename === a.codename);
      const sent = messages.filter((m) => m.fromAgent === a.codename).length;
      const received = messages.filter((m) => m.toAgent === a.codename || m.toAgent === 'BROADCAST').length;
      const completed = at.filter((t) => t.status === 'completed').length;
      return [a.codename, a.role, a.status, String(a.load), String(a.successRate), String(at.length), String(completed), String(at.length ? Math.round((completed / at.length) * 100) : 0), String(al.length), String(al.filter((l) => l.level === 'error').length), String(sent), String(received)];
    });
  } else if (type === 'skillStats') {
    const m: Record<string, { count: number; successes: number; errors: number; totalLatency: number }> = {};
    for (const r of skillRuns) {
      if (!m[r.skillKey]) m[r.skillKey] = { count: 0, successes: 0, errors: 0, totalLatency: 0 };
      m[r.skillKey].count++;
      if (r.status === 'success') m[r.skillKey].successes++; else m[r.skillKey].errors++;
      m[r.skillKey].totalLatency += r.latencyMs;
    }
    headers = ['SkillKey', 'Runs', 'Successes', 'Errors', 'SuccessRate', 'AvgLatencyMs'];
    rows = Object.entries(m).map(([k, v]) => [k, String(v.count), String(v.successes), String(v.errors), String(v.count ? Math.round((v.successes / v.count) * 100) : 0), String(v.count ? Math.round(v.totalLatency / v.count) : 0)]);
  } else if (type === 'timeSeries') {
    const seriesDays = Math.min(days, 30);
    const buckets: Record<string, { date: string; tasks: number; logs: number; comms: number; skills: number }> = {};
    for (let i = seriesDays - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      buckets[key] = { date: key, tasks: 0, logs: 0, comms: 0, skills: 0 };
    }
    for (const t of tasks) { const k = t.createdAt.toISOString().slice(0, 10); if (buckets[k]) buckets[k].tasks++; }
    for (const l of logs) { const k = l.createdAt.toISOString().slice(0, 10); if (buckets[k]) buckets[k].logs++; }
    for (const m2 of messages) { const k = new Date().toISOString().slice(0, 10); if (buckets[k]) buckets[k].comms++; }
    for (const s of skillRuns) { const k = s.createdAt.toISOString().slice(0, 10); if (buckets[k]) buckets[k].skills++; }
    headers = ['Date', 'Tasks', 'Logs', 'Comms', 'Skills'];
    rows = Object.values(buckets).map((b) => [b.date, String(b.tasks), String(b.logs), String(b.comms), String(b.skills)]);
  }

  const escape = (s: string) => /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\r\n');
  const filename = `jarvis-analytics-${type}-${range}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
