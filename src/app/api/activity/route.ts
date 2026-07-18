import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { timeAgo } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Unified activity feed: recent logs, tasks, payments, agent status, memory updates.
export async function GET() {
  const [logs, tasks, payments, memory, notifications] = await Promise.all([
    db.agentLog.findMany({ orderBy: { createdAt: 'desc' }, take: 12, include: { agent: { select: { codename: true } } } }),
    db.task.findMany({ orderBy: { createdAt: 'desc' }, take: 10, include: { assignee: { select: { codename: true } } } }),
    db.payment.findMany({ orderBy: { createdAt: 'desc' }, take: 6 }),
    db.memoryItem.findMany({ orderBy: { updatedAt: 'desc' }, take: 6 }),
    db.notification.findMany({ orderBy: { createdAt: 'desc' }, take: 6 }),
  ]);

  type Event = { id: string; type: string; level: string; agent?: string; title: string; detail?: string; time: string; ts: number };
  const events: Event[] = [];

  for (const l of logs) {
    events.push({ id: `log-${l.id}`, type: 'log', level: l.level, agent: l.agent?.codename, title: l.message, time: timeAgo(l.createdAt), ts: l.createdAt.getTime() });
  }
  for (const t of tasks) {
    events.push({ id: `task-${t.id}`, type: 'task', level: t.status === 'completed' ? 'success' : t.status === 'failed' ? 'error' : 'info', agent: t.assignee?.codename, title: `Task ${t.status}: ${t.title}`, detail: t.priority, time: timeAgo(t.createdAt), ts: t.createdAt.getTime() });
  }
  for (const p of payments) {
    events.push({ id: `pay-${p.id}`, type: 'payment', level: p.status === 'confirmed' ? 'success' : p.status === 'failed' ? 'error' : 'warn', title: `Payment ${p.status}: ₹${p.amount} (${p.method})`, detail: p.payer ?? '', time: timeAgo(p.createdAt), ts: p.createdAt.getTime() });
  }
  for (const m of memory) {
    events.push({ id: `mem-${m.id}`, type: 'memory', level: 'info', title: `Memory updated: ${m.key}`, detail: m.scope, time: timeAgo(m.updatedAt), ts: m.updatedAt.getTime() });
  }
  for (const n of notifications) {
    events.push({ id: `notif-${n.id}`, type: 'notification', level: n.type, title: n.title, detail: n.message, time: timeAgo(n.createdAt), ts: n.createdAt.getTime() });
  }

  events.sort((a, b) => b.ts - a.ts);
  return NextResponse.json({ events: events.slice(0, 30) });
}
