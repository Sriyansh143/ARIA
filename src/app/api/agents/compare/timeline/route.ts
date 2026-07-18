import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/compare/timeline?ids=id1,id2,id3&days=14
 * Returns daily activity timeline for 2-5 agents for comparison.
 * Each day includes: task count, log count (by level), comms count, skill runs.
 */
export async function GET(req: NextRequest) {
  const idsParam = req.nextUrl.searchParams.get('ids') ?? '';
  const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
  const daysParam = req.nextUrl.searchParams.get('days') ?? '14';
  const days = Math.min(Math.max(parseInt(daysParam, 10) || 14, 1), 90);

  if (ids.length < 2) {
    return NextResponse.json({ error: 'At least 2 agent IDs required' }, { status: 400 });
  }
  if (ids.length > 5) {
    return NextResponse.json({ error: 'Maximum 5 agents can be compared' }, { status: 400 });
  }

  const agents = await db.agent.findMany({
    where: { id: { in: ids } },
    select: { id: true, codename: true },
  });

  if (agents.length === 0) {
    return NextResponse.json({ error: 'No agents found' }, { status: 404 });
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [tasks, logs, messages, skillRuns] = await Promise.all([
    db.task.findMany({
      where: { assigneeId: { in: ids }, createdAt: { gte: since } },
      select: { assigneeId: true, status: true, createdAt: true },
    }),
    db.agentLog.findMany({
      where: { agentId: { in: ids }, createdAt: { gte: since } },
      select: { agentId: true, level: true, createdAt: true },
    }),
    db.agentMessage.findMany({
      where: { OR: [{ fromAgent: { in: agents.map((a) => a.codename) } }, { toAgent: { in: agents.map((a) => a.codename) } }], createdAt: { gte: since } },
      select: { fromAgent: true, toAgent: true, createdAt: true },
    }),
    db.skillRun.findMany({
      where: { createdAt: { gte: since } },
      select: { skillKey: true, status: true, latencyMs: true, createdAt: true },
    }).catch(() => []),
  ]);

  // Build day buckets.
  const buckets: Array<{ date: string; label: string }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const dateKey = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    buckets.push({ date: dateKey, label });
  }

  // Build per-agent per-day timeline.
  const timeline = agents.map((agent) => {
    const codename = agent.codename;
    const agentTasks = tasks.filter((t) => t.assigneeId === agent.id);
    const agentLogs = logs.filter((l) => l.agentId === agent.id);
    const agentSent = messages.filter((m) => m.fromAgent === codename);
    const agentReceived = messages.filter((m) => m.toAgent === codename || m.toAgent === 'BROADCAST');

    const series = buckets.map((b) => {
      const dayTasks = agentTasks.filter((t) => t.createdAt.toISOString().slice(0, 10) === b.date);
      const dayLogs = agentLogs.filter((l) => l.createdAt.toISOString().slice(0, 10) === b.date);
      const daySent = agentSent.filter((m) => m.createdAt.toISOString().slice(0, 10) === b.date);
      const dayReceived = agentReceived.filter((m) => m.createdAt.toISOString().slice(0, 10) === b.date);
      return {
        date: b.date,
        label: b.label,
        tasks: dayTasks.length,
        tasksCompleted: dayTasks.filter((t) => t.status === 'completed').length,
        logs: dayLogs.length,
        errors: dayLogs.filter((l) => l.level === 'error').length,
        successes: dayLogs.filter((l) => l.level === 'success').length,
        commsSent: daySent.length,
        commsReceived: dayReceived.length,
        commsTotal: daySent.length + dayReceived.length,
      };
    });

    return {
      id: agent.id,
      codename,
      series,
      totals: {
        tasks: agentTasks.length,
        logs: agentLogs.length,
        comms: agentSent.length + agentReceived.length,
        errors: agentLogs.filter((l) => l.level === 'error').length,
      },
    };
  });

  return NextResponse.json({
    timeline,
    buckets: buckets.map((b) => ({ date: b.date, label: b.label })),
    days,
    agentCount: agents.length,
  });
}
