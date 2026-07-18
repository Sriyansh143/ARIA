import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Single aggregate call powering the Overview tab.
export async function GET() {
  const [agents, tasks, notifications, memory, payments, telemetry, skills, provider, artifacts, cronJobs] = await Promise.all([
    db.agent.findMany({ orderBy: { codename: 'asc' }, include: { _count: { select: { logs: true } } } }),
    db.task.findMany({ orderBy: { createdAt: 'desc' }, take: 8, include: { assignee: { select: { codename: true } } } }),
    db.notification.findMany({ orderBy: { createdAt: 'desc' }, take: 6 }),
    db.memoryItem.findMany({ orderBy: { updatedAt: 'desc' }, take: 6 }),
    db.payment.aggregate({ _sum: { amount: true }, where: { status: 'confirmed' } }),
    db.telemetry.findMany({ orderBy: { createdAt: 'desc' }, take: 12 }),
    db.skill.count(),
    db.provider.findUnique({ where: { key: 'zai' } }),
    db.artifact.count(),
    db.cronJob.count(),
  ]);

  const mem = process.memoryUsage();
  const activeAgents = agents.filter((a) => a.status === 'working' || a.status === 'thinking').length;
  const pendingTasks = tasks.filter((t) => t.status === 'pending').length;

  // Agent type breakdown (monitoring / executing / error-handling)
  const monitoringAgents = agents.filter((a) => a.agentType === 'monitor').length;
  const executingAgents = agents.filter((a) => a.agentType === 'exec').length;
  const errorHandlerAgents = agents.filter((a) => a.agentType === 'error-handler').length;

  return NextResponse.json({
    stats: {
      agents: agents.length,
      activeAgents,
      monitoringAgents,
      executingAgents,
      errorHandlerAgents,
      tasks: tasks.length,
      pendingTasks,
      skills,
      artifacts,
      cronJobs,
      revenue: payments._sum.amount || 0,
      tokens: 0,
      providerLatency: provider?.latency || 0,
      memMb: Math.round(mem.rss / 1024 / 1024),
      uptime: Math.floor(process.uptime()),
    },
    agents: agents.slice(0, 8).map((a) => ({
      id: a.id,
      name: a.name,
      codename: a.codename,
      role: a.role,
      status: a.status,
      load: a.load,
      successRate: a.successRate,
      skills: a.skills,
      agentType: a.agentType,
      department: a.department,
    })),
    tasks,
    notifications,
    memory,
    telemetry: telemetry.map((t) => ({ time: t.createdAt.toISOString(), cpu: t.cpu, mem: t.mem, latency: t.latency, tokens: t.tokens })),
  });
}
