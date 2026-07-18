import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// CSV export for tasks, payments, comms, logs, agents, memory.
// GET /api/export/[type]  →  type: tasks | payments | comms | logs | agents | memory
export async function GET(_req: NextRequest, ctx: { params: Promise<{ type: string }> }) {
  const { type } = await ctx.params;
  const validTypes = ['tasks', 'payments', 'comms', 'logs', 'agents', 'memory'];
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: `invalid type. valid: ${validTypes.join(', ')}` }, { status: 400 });
  }

  let headers: string[] = [];
  let rows: string[][] = [];

  if (type === 'tasks') {
    const tasks = await db.task.findMany({ include: { assignee: { select: { codename: true } } }, orderBy: { createdAt: 'desc' } });
    headers = ['ID', 'Title', 'Status', 'Priority', 'Assignee', 'Progress', 'Created'];
    rows = tasks.map((t) => [t.id, t.title, t.status, t.priority, t.assignee?.codename ?? '', String(t.progress), t.createdAt.toISOString()]);
  } else if (type === 'payments') {
    const payments = await db.payment.findMany({ orderBy: { createdAt: 'desc' } });
    headers = ['ID', 'Method', 'Amount', 'Currency', 'Status', 'Payer', 'Note', 'Created'];
    rows = payments.map((p) => [p.id, p.method, String(p.amount), p.currency, p.status, p.payer ?? '', p.note ?? '', p.createdAt.toISOString()]);
  } else if (type === 'comms') {
    const msgs = await db.agentMessage.findMany({ orderBy: { createdAt: 'desc' } });
    headers = ['ID', 'From', 'To', 'Subject', 'Priority', 'Thread', 'Read', 'Created'];
    rows = msgs.map((m) => [m.id, m.fromAgent, m.toAgent, m.subject, m.priority, m.thread, String(m.read), m.createdAt.toISOString()]);
  } else if (type === 'logs') {
    const logs = await db.agentLog.findMany({ orderBy: { createdAt: 'desc' }, take: 500, include: { agent: { select: { codename: true } } } });
    headers = ['ID', 'Agent', 'Level', 'Message', 'Created'];
    rows = logs.map((l) => [l.id, l.agent?.codename ?? '', l.level, l.message, l.createdAt.toISOString()]);
  } else if (type === 'agents') {
    const agents = await db.agent.findMany({ orderBy: { codename: 'asc' } });
    headers = ['ID', 'Codename', 'Name', 'Role', 'Status', 'Load', 'SuccessRate', 'TaskCount', 'Model'];
    rows = agents.map((a) => [a.id, a.codename, a.name, a.role, a.status, String(a.load), String(a.successRate), String(a.taskCount), a.model]);
  } else if (type === 'memory') {
    const items = await db.memoryItem.findMany({ orderBy: { updatedAt: 'desc' } });
    headers = ['ID', 'Scope', 'Key', 'Value', 'Pinned', 'Tags', 'Updated'];
    rows = items.map((m) => [m.id, m.scope, m.key, m.value, String(m.pinned), m.tags, m.updatedAt.toISOString()]);
  }

  // Build CSV.
  const escape = (s: string) => {
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\r\n');
  const filename = `jarvis-${type}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
