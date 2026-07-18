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
  // Validate required string fields — non-empty + max length.
  if (!fromAgent || typeof fromAgent !== 'string' || fromAgent.trim().length === 0) {
    return NextResponse.json({ error: 'fromAgent required' }, { status: 400 });
  }
  if (fromAgent.length > 64) {
    return NextResponse.json({ error: 'fromAgent must be 64 characters or fewer' }, { status: 400 });
  }
  if (!toAgent || typeof toAgent !== 'string' || toAgent.trim().length === 0) {
    return NextResponse.json({ error: 'toAgent required' }, { status: 400 });
  }
  if (toAgent.length > 64) {
    return NextResponse.json({ error: 'toAgent must be 64 characters or fewer' }, { status: 400 });
  }
  if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
    return NextResponse.json({ error: 'subject required' }, { status: 400 });
  }
  if (subject.length > 500) {
    return NextResponse.json({ error: 'subject must be 500 characters or fewer' }, { status: 400 });
  }
  if (!msgBody || typeof msgBody !== 'string' || msgBody.trim().length === 0) {
    return NextResponse.json({ error: 'body required' }, { status: 400 });
  }
  if (msgBody.length > 10000) {
    return NextResponse.json({ error: 'body must be 10000 characters or fewer' }, { status: 400 });
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
