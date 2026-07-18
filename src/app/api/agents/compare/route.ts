import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/compare?ids=id1,id2,id3
 * Returns side-by-side metrics for 2-5 agents for comparison.
 * Includes: agent info, task stats, log stats, comms stats, skills, performance scores.
 */
export async function GET(req: NextRequest) {
  const idsParam = req.nextUrl.searchParams.get('ids') ?? '';
  const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);

  if (ids.length < 2) {
    return NextResponse.json({ error: 'At least 2 agent IDs required' }, { status: 400 });
  }
  if (ids.length > 5) {
    return NextResponse.json({ error: 'Maximum 5 agents can be compared' }, { status: 400 });
  }

  const agents = await db.agent.findMany({
    where: { id: { in: ids } },
    orderBy: { codename: 'asc' },
  });

  if (agents.length === 0) {
    return NextResponse.json({ error: 'No agents found' }, { status: 404 });
  }

  // Fetch related data for all agents in parallel
  const [tasks, logs, messages, skillRuns] = await Promise.all([
    db.task.findMany({
      where: { assigneeId: { in: ids } },
      select: { id: true, assigneeId: true, status: true, priority: true, progress: true, createdAt: true },
    }),
    db.agentLog.findMany({
      where: { agentId: { in: ids } },
      select: { id: true, agentId: true, level: true, createdAt: true },
    }),
    db.agentMessage.findMany({
      where: { OR: [{ fromAgent: { in: agents.map((a) => a.codename) } }, { toAgent: { in: agents.map((a) => a.codename) } }] },
      select: { id: true, fromAgent: true, toAgent: true, createdAt: true },
    }),
    db.skillRun.findMany({
      where: { agentId: { in: ids } },
      select: { id: true, agentId: true, skillKey: true, status: true, latencyMs: true },
    }).catch(() => []),
  ]);

  // Build per-agent comparison data
  const comparison = agents.map((agent) => {
    const agentTasks = tasks.filter((t) => t.assigneeId === agent.id);
    const agentLogs = logs.filter((l) => l.agentId === agent.id);
    const sent = messages.filter((m) => m.fromAgent === agent.codename).length;
    const received = messages.filter((m) => m.toAgent === agent.codename || m.toAgent === 'BROADCAST').length;
    const agentSkillRuns = skillRuns.filter((s) => s.agentId === agent.id);
    const completed = agentTasks.filter((t) => t.status === 'completed').length;
    const errors = agentLogs.filter((l) => l.level === 'error').length;
    const successes = agentLogs.filter((l) => l.level === 'success').length;
    const skillSuccesses = agentSkillRuns.filter((s) => s.status === 'success').length;

    // Compute a composite health score (0-100)
    const taskScore = agentTasks.length > 0 ? (completed / agentTasks.length) * 40 : 20;
    const successScore = agent.successRate * 0.3;
    const logScore = agentLogs.length > 0 ? Math.min(20, (successes / Math.max(1, agentLogs.length)) * 20) : 10;
    const loadPenalty = agent.load > 80 ? 10 : agent.load > 50 ? 5 : 0;
    const healthScore = Math.max(0, Math.min(100, Math.round(taskScore + successScore + logScore - loadPenalty)));

    return {
      id: agent.id,
      codename: agent.codename,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      model: agent.model,
      skills: agent.skills,
      load: agent.load,
      successRate: agent.successRate,
      taskCount: agent.taskCount,
      logCount: agent.logCount,
      metrics: {
        tasks: {
          total: agentTasks.length,
          completed,
          inProgress: agentTasks.filter((t) => t.status === 'in_progress').length,
          pending: agentTasks.filter((t) => t.status === 'pending').length,
          failed: agentTasks.filter((t) => t.status === 'failed').length,
          completionRate: agentTasks.length > 0 ? Math.round((completed / agentTasks.length) * 100) : 0,
        },
        logs: {
          total: agentLogs.length,
          errors,
          successes,
          warnings: agentLogs.filter((l) => l.level === 'warn').length,
        },
        comms: {
          sent,
          received,
          total: sent + received,
        },
        skills: {
          totalRuns: agentSkillRuns.length,
          successes: skillSuccesses,
          successRate: agentSkillRuns.length > 0 ? Math.round((skillSuccesses / agentSkillRuns.length) * 100) : 0,
          avgLatency: agentSkillRuns.length > 0 ? Math.round(agentSkillRuns.reduce((s, r) => s + r.latencyMs, 0) / agentSkillRuns.length) : 0,
        },
      },
      healthScore,
      lastActive: agent.lastActive,
    };
  });

  // Compute winners per metric
  const winners: Record<string, string> = {};
  const metrics = [
    { key: 'healthScore', label: 'Health Score', higher: true },
    { key: 'successRate', label: 'Success Rate', higher: true },
    { key: 'load', label: 'Load (lower is better)', higher: false },
    { key: 'taskCount', label: 'Task Count', higher: true },
    { key: 'logCount', label: 'Log Count', higher: true },
  ];

  for (const m of metrics) {
    let best = comparison[0];
    for (const a of comparison) {
      const val = (a as never)[m.key] as number;
      const bestVal = (best as never)[m.key] as number;
      if (m.higher ? val > bestVal : val < bestVal) best = a;
    }
    winners[m.key] = best.codename;
  }

  // Task completion winner
  let bestCompletion = comparison[0];
  for (const a of comparison) {
    if (a.metrics.tasks.completionRate > bestCompletion.metrics.tasks.completionRate) bestCompletion = a;
  }
  winners.completionRate = bestCompletion.codename;

  return NextResponse.json({
    agents: comparison,
    winners,
    count: comparison.length,
  });
}
