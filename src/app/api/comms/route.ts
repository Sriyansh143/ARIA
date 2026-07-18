import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET — list messages, optionally filtered by agent (as sender OR recipient) or thread.
export async function GET(req: NextRequest) {
  const agent = req.nextUrl.searchParams.get('agent');
  const thread = req.nextUrl.searchParams.get('thread');
  const where: Record<string, unknown> = {};
  if (thread) where.thread = thread;
  if (agent) where.OR = [{ fromAgent: agent }, { toAgent: agent }, { toAgent: 'BROADCAST' }];
  const messages = await db.agentMessage.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const unread = await db.agentMessage.count({ where: { read: false, ...(agent ? { toAgent: agent } : {}) } });
  return NextResponse.json({ messages, unread });
}

// POST — send a message between agents (or broadcast).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { fromAgent, toAgent, subject, body: msgBody, priority, thread } = body;
  if (!fromAgent || !toAgent || !subject || !msgBody) {
    return NextResponse.json({ error: 'fromAgent, toAgent, subject, body required' }, { status: 400 });
  }
  const msg = await db.agentMessage.create({
    data: {
      fromAgent: String(fromAgent).toUpperCase(),
      toAgent: String(toAgent).toUpperCase(),
      subject,
      body: msgBody,
      priority: priority ?? 'normal',
      thread: thread ?? 'general',
    },
  });
  // Also log it under the sender for the activity feed.
  const sender = await db.agent.findFirst({ where: { codename: String(fromAgent).toUpperCase() } });
  if (sender) {
    await db.agentLog.create({
      data: {
        agentId: sender.id,
        level: 'info',
        message: `Sent message to ${toAgent}: ${subject}`,
      },
    });
  }
  return NextResponse.json({ message: msg });
}
