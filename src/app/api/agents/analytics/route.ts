import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { JARVIS } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Per-agent performance analytics: task counts by status, avg success rate,
// avg load, log activity, comms sent/received, autonomy-derived tasks.
// Query param: range=7d|30d|all (default 30d).
export async function GET(req: NextRequest) {
  const range = req.nextUrl.searchParams.get('range') ?? '30d';
  const days = range === '7d' ? 7 : range === 'all' ? 9999 : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [agents, tasks, logs, messages, skillRuns] = await Promise.all([
    db.agent.findMany({ orderBy: { codename: 'asc' } }),
    db.task.findMany({ where: { createdAt: { gte: since } }, include: { assignee: { select: { codename: true } } } }),
    db.agentLog.findMany({ where: { createdAt: { gte: since } }, take: 500, orderBy: { createdAt: 'desc' }, include: { agent: { select: { codename: true } } } }),
    db.agentMessage.findMany({ where: { createdAt: { gte: since } }, take: 200, orderBy: { createdAt: 'desc' }, select: { fromAgent: true, toAgent: true, createdAt: true } }),
    db.skillRun.findMany({ where: { createdAt: { gte: since } }, take: 500, orderBy: { createdAt: 'desc' }, select: { skillKey: true, status: true, latencyMs: true, createdAt: true } }),
  ]);

  // Per-agent stats.
  const perAgent = agents.map((a) => {
    const agentTasks = tasks.filter((t) => t.assignee?.codename === a.codename);
    const completed = agentTasks.filter((t) => t.status === 'completed').length;
    const inProgress = agentTasks.filter((t) => t.status === 'in_progress').length;
    const pending = agentTasks.filter((t) => t.status === 'pending').length;
    const failed = agentTasks.filter((t) => t.status === 'failed').length;
    const agentLogs = logs.filter((l) => l.agent?.codename === a.codename);
    const sent = messages.filter((m) => m.fromAgent === a.codename).length;
    const received = messages.filter((m) => m.toAgent === a.codename || m.toAgent === 'BROADCAST').length;
    const errorLogs = agentLogs.filter((l) => l.level === 'error').length;
    const successLogs = agentLogs.filter((l) => l.level === 'success').length;
    const completionRate = agentTasks.length > 0 ? Math.round((completed / agentTasks.length) * 100) : 0;
    return {
      codename: a.codename,
      name: a.name,
      role: a.role,
      status: a.status,
      load: a.load,
      successRate: a.successRate,
      tasks: { total: agentTasks.length, completed, inProgress, pending, failed, completionRate },
      logs: { total: agentLogs.length, errors: errorLogs, successes: successLogs },
      comms: { sent, received },
    };
  });

  // Fleet-wide totals.
  const totalTasks = tasks.length;
  const totalCompleted = tasks.filter((t) => t.status === 'completed').length;
  const totalInProgress = tasks.filter((t) => t.status === 'in_progress').length;
  const totalPending = tasks.filter((t) => t.status === 'pending').length;
  const totalFailed = tasks.filter((t) => t.status === 'failed').length;
  const fleetCompletionRate = totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0;

  // Task status distribution (for pie chart).
  const statusDist = [
    { name: 'completed', value: totalCompleted, color: JARVIS.colors.green },
    { name: 'in_progress', value: totalInProgress, color: JARVIS.colors.cyan },
    { name: 'pending', value: totalPending, color: JARVIS.colors.amber },
    { name: 'failed', value: totalFailed, color: JARVIS.colors.red },
  ].filter((d) => d.value > 0);

  // Skill run distribution by skillKey (for bar chart).
  const skillCounts: Record<string, { count: number; successes: number; errors: number; avgLatency: number }> = {};
  for (const r of skillRuns) {
    if (!skillCounts[r.skillKey]) skillCounts[r.skillKey] = { count: 0, successes: 0, errors: 0, avgLatency: 0 };
    skillCounts[r.skillKey].count++;
    if (r.status === 'success') skillCounts[r.skillKey].successes++;
    else skillCounts[r.skillKey].errors++;
    skillCounts[r.skillKey].avgLatency += r.latencyMs;
  }
  const skillStats = Object.entries(skillCounts).map(([k, v]) => ({
    skillKey: k,
    count: v.count,
    successRate: v.count > 0 ? Math.round((v.successes / v.count) * 100) : 0,
    avgLatency: v.count > 0 ? Math.round(v.avgLatency / v.count) : 0,
  })).sort((a, b) => b.count - a.count);

  // Top performers (by completion rate, min 1 task).
  const topPerformers = [...perAgent]
    .filter((a) => a.tasks.total > 0)
    .sort((a, b) => b.tasks.completionRate - a.tasks.completionRate || b.tasks.completed - a.tasks.completed)
    .slice(0, 5);

  // Most active agents (by log count).
  const mostActive = [...perAgent].sort((a, b) => b.logs.total - a.logs.total).slice(0, 5);

  // Most connected agents (by comms).
  const mostConnected = [...perAgent].sort((a, b) => (b.comms.sent + b.comms.received) - (a.comms.sent + a.comms.received)).slice(0, 5);

  // Daily activity time-series (tasks created + logs + comms + skill runs per day).
  const seriesDays = Math.min(days, 30);
  const buckets: Record<string, { date: string; label: string; tasks: number; logs: number; comms: number; skills: number }> = {};
  for (let i = seriesDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    buckets[key] = { date: key, label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), tasks: 0, logs: 0, comms: 0, skills: 0 };
  }
  for (const t of tasks) { const k = t.createdAt.toISOString().slice(0, 10); if (buckets[k]) buckets[k].tasks++; }
  for (const l of logs) { const k = l.createdAt.toISOString().slice(0, 10); if (buckets[k]) buckets[k].logs++; }
  for (const m of messages) { const k = m.createdAt.toISOString().slice(0, 10); if (buckets[k]) buckets[k].comms++; }
  for (const s of skillRuns) { const k = s.createdAt.toISOString().slice(0, 10); if (buckets[k]) buckets[k].skills++; }
  const timeSeries = Object.values(buckets);

  return NextResponse.json({
    perAgent,
    fleet: {
      totalTasks,
      totalCompleted,
      fleetCompletionRate,
      totalLogs: logs.length,
      totalComms: messages.length,
      totalSkillRuns: skillRuns.length,
      avgLoad: Math.round((agents.reduce((s, a) => s + a.load, 0) / (agents.length || 1)) * 10) / 10,
      avgSuccessRate: Math.round((agents.reduce((s, a) => s + a.successRate, 0) / (agents.length || 1)) * 10) / 10,
    },
    statusDist,
    skillStats,
    topPerformers,
    mostActive,
    mostConnected,
    timeSeries,
    range,
  });
}
