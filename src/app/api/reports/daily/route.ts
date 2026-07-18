import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { quickChat } from '@/lib/llm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET — generate a GLM-4.6 daily fleet report.
export async function GET() {
  // Gather fleet state.
  const [agents, tasks, payments, logs, comms, skillRuns, memory] = await Promise.all([
    db.agent.findMany({ orderBy: { codename: 'asc' } }),
    db.task.findMany({ orderBy: { createdAt: 'desc' }, take: 20, include: { assignee: { select: { codename: true } } } }),
    db.payment.aggregate({ _sum: { amount: true }, where: { status: 'confirmed' } }),
    db.agentLog.findMany({ orderBy: { createdAt: 'desc' }, take: 30, include: { agent: { select: { codename: true } } } }),
    db.agentMessage.count(),
    db.skillRun.count(),
    db.memoryItem.count(),
  ]);

  const completed = tasks.filter((t) => t.status === 'completed').length;
  const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
  const pending = tasks.filter((t) => t.status === 'pending').length;
  const failed = tasks.filter((t) => t.status === 'failed').length;
  const workingAgents = agents.filter((a) => a.status === 'working').length;
  const errorLogs = logs.filter((l) => l.level === 'error').length;

  const summary = {
    timestamp: new Date().toISOString(),
    fleet: {
      agents: agents.length,
      working: workingAgents,
      idle: agents.filter((a) => a.status === 'idle').length,
      avgLoad: Math.round((agents.reduce((s, a) => s + a.load, 0) / (agents.length || 1)) * 10) / 10,
      avgSuccess: Math.round((agents.reduce((s, a) => s + a.successRate, 0) / (agents.length || 1)) * 10) / 10,
    },
    tasks: { total: tasks.length, completed, inProgress, pending, failed, completionRate: tasks.length ? Math.round((completed / tasks.length) * 100) : 0 },
    revenue: payments._sum.amount ?? 0,
    activity: { logs: logs.length, errors: errorLogs, comms, skillRuns, memory },
    topTasks: tasks.slice(0, 5).map((t) => ({ title: t.title, status: t.status, priority: t.priority, assignee: t.assignee?.codename ?? 'unassigned' })),
    recentLogs: logs.slice(0, 8).map((l) => ({ agent: l.agent?.codename ?? '?', level: l.level, message: l.message })),
  };

  // Have GLM-4.6 generate the narrative report.
  const prompt = `You are JARVIS. Generate a concise daily fleet operations report in markdown based on this state:
${JSON.stringify(summary, null, 2)}

Format:
## Fleet Daily Report — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}

### Executive Summary
(2-3 sentences on overall fleet health and key outcomes)

### Key Metrics
- Fleet: X agents (Y working, Z idle), avg load A%, avg success B%
- Tasks: X total (C completed, P in progress, F failed) — CR% completion rate
- Revenue: ₹X confirmed
- Activity: X logs (Y errors), Z comms, W skill runs

### Priority Tasks
(brief list of top 3 tasks with assignees)

### Issues & Risks
(any errors, overloaded agents, or blockers — if none, state "No active issues")

### Recommendations
(2-3 actionable next steps)

Keep it under 300 words. Be operational and direct.`;

  let report: string;
  try {
    report = await quickChat(prompt, 'You are JARVIS, generating a fleet operations report. Be concise and operational.');
  } catch (e) {
    report = `## Fleet Daily Report — ${new Date().toLocaleDateString()}\n\n*(GLM-4.6 report generation failed: ${e instanceof Error ? e.message : 'unknown'})*\n\n### Raw Summary\n- Fleet: ${summary.fleet.agents} agents (${summary.fleet.working} working), avg load ${summary.fleet.avgLoad}%\n- Tasks: ${summary.tasks.total} total, ${summary.tasks.completionRate}% completion\n- Revenue: ₹${summary.revenue}\n- Errors: ${summary.activity.errors}`;
  }

  // Store the report as an episodic memory.
  try {
    await db.memoryItem.create({
      data: {
        scope: 'episodic',
        key: `daily-report-${new Date().toISOString().slice(0, 10)}`,
        value: report.slice(0, 5000),
        tags: JSON.stringify(['report', 'daily']),
      },
    });
  } catch { /* ignore */ }

  // Create a notification.
  await db.notification.create({
    data: { type: 'success', title: 'Daily Report Generated', message: `Fleet report for ${new Date().toLocaleDateString()} is ready.`, read: false },
  });

  return NextResponse.json({ report, summary, generatedAt: new Date().toISOString() });
}
