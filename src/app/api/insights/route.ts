import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { quickChat } from '@/lib/llm';

export const dynamic = 'force-dynamic';

// Generate a short proactive insight summarizing the fleet state.
export async function GET() {
  const [agents, tasks, telemetry, payments] = await Promise.all([
    db.agent.findMany({ select: { codename: true, status: true, load: true, successRate: true } }),
    db.task.findMany({ select: { status: true, priority: true } }),
    db.telemetry.findMany({ orderBy: { createdAt: 'desc' }, take: 1 }),
    db.payment.aggregate({ _sum: { amount: true }, where: { status: 'confirmed' } }),
  ]);

  const working = agents.filter((a) => a.status === 'working').length;
  const idle = agents.filter((a) => a.status === 'idle').length;
  const overloaded = agents.filter((a) => a.load > 70).map((a) => a.codename);
  const pending = tasks.filter((t) => t.status === 'pending').length;
  const t = telemetry[0];

  let insight: string;
  try {
    insight = await quickChat(
      `You are JARVIS. Give ONE crisp operational insight (max 30 words) about this fleet state: ${working} working, ${idle} idle, ${pending} pending tasks, overloaded agents: ${overloaded.join(',') || 'none'}, cpu ${Math.round(t?.cpu ?? 0)}%, confirmed revenue ₹${payments._sum.amount ?? 0}. Reply with just the insight.`,
      'You are a mission-control AI. Reply with a single concise insight sentence, no preamble.',
    );
  } catch {
    insight = overloaded.length
      ? `Fleet nominal, but ${overloaded.join(', ')} over 70% load — consider rebalancing.`
      : `Fleet nominal — ${working} agents working, ${idle} idle, ${pending} tasks pending.`;
  }

  return NextResponse.json({
    insight,
    snapshot: {
      working,
      idle,
      pending,
      overloaded,
      cpu: Math.round(t?.cpu ?? 0),
      revenue: payments._sum.amount ?? 0,
      avgSuccess: Math.round((agents.reduce((s, a) => s + a.successRate, 0) / (agents.length || 1)) * 10) / 10,
    },
  });
}
