import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Assign a task to an agent: creates a task, logs the assignment, flips agent to thinking if idle.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const { title, description, priority } = body;
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });
  const agent = await db.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: 'agent not found' }, { status: 404 });
  const task = await db.task.create({
    data: {
      title,
      description,
      priority: priority ?? 'medium',
      assigneeId: agent.id,
      status: 'in_progress',
      progress: 0,
    },
  });
  await db.agentLog.create({
    data: { agentId: agent.id, level: 'info', message: `Assigned task: ${title}` },
  });
  const updated = await db.agent.update({
    where: { id },
    data: { status: agent.status === 'idle' ? 'thinking' : agent.status, taskCount: { increment: 1 }, lastActive: new Date() },
  });
  return NextResponse.json({ agent: updated, task });
}
