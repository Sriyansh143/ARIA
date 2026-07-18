import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { quickChat } from '@/lib/llm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST — generate + store a scheduled daily report (triggered by the cron system or manually).
// Body: { source?: 'manual' | 'scheduled' }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const source = body.source === 'scheduled' ? 'scheduled' : 'manual';

  // Gather fleet state (reuse the daily report logic).
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
  const summary = {
    timestamp: new Date().toISOString(),
    source,
    fleet: { agents: agents.length, working: agents.filter((a) => a.status === 'working').length, avgLoad: Math.round((agents.reduce((s, a) => s + a.load, 0) / (agents.length || 1)) * 10) / 10, avgSuccess: Math.round((agents.reduce((s, a) => s + a.successRate, 0) / (agents.length || 1)) * 10) / 10 },
    tasks: { total: tasks.length, completed, completionRate: tasks.length ? Math.round((completed / tasks.length) * 100) : 0 },
    revenue: payments._sum.amount ?? 0,
    activity: { logs: logs.length, errors: logs.filter((l) => l.level === 'error').length, comms, skillRuns, memory },
    topTasks: tasks.slice(0, 5).map((t) => ({ title: t.title, status: t.status, assignee: t.assignee?.codename ?? 'unassigned' })),
  };

  const prompt = `You are JARVIS. Generate a concise ${source === 'scheduled' ? 'scheduled ' : ''}fleet operations report in markdown:
${JSON.stringify(summary, null, 2)}

Format with: ## Report — {date}, ### Executive Summary (2-3 sentences), ### Key Metrics (bullets), ### Priority Tasks (top 3), ### Recommendations (2-3 actions). Under 250 words.`;

  let report: string;
  try {
    report = await quickChat(prompt, 'You are JARVIS generating a fleet report. Be concise.');
  } catch (e) {
    report = `## Fleet Report — ${new Date().toLocaleDateString()}\n\n*(GLM-4.6 failed: ${e instanceof Error ? e.message : 'unknown'})*\n\n- Tasks: ${summary.tasks.total} (${summary.tasks.completionRate}% done)\n- Revenue: ₹${summary.revenue}\n- Errors: ${summary.activity.errors}`;
  }

  // Store the report as a memory item (keyed by source + timestamp).
  try {
    await db.memoryItem.create({
      data: {
        scope: 'episodic',
        key: `report-${source}-${new Date().toISOString().slice(0, 16)}`,
        value: report.slice(0, 5000),
        tags: JSON.stringify(['report', source]),
      },
    });
  } catch { /* ignore */ }

  // Notification.
  await db.notification.create({
    data: { type: 'success', title: source === 'scheduled' ? 'Scheduled Report Generated' : 'Report Generated', message: `Fleet report for ${new Date().toLocaleDateString()} is ready.`, read: false },
  });

  return NextResponse.json({ report, summary, source, generatedAt: new Date().toISOString() });
}
