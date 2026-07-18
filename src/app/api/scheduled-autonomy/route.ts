import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET — list all scheduled autonomy loops.
export async function GET() {
  const schedules = await db.scheduledAutonomy.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ schedules });
}

// POST — create a new scheduled autonomy loop. Body: { agentCodename, topic, intervalMin }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { agentCodename, topic, intervalMin } = body;
  if (!agentCodename || !topic) {
    return NextResponse.json({ error: 'agentCodename and topic required' }, { status: 400 });
  }
  // Validate agent exists.
  const agent = await db.agent.findFirst({ where: { codename: String(agentCodename).toUpperCase() } });
  if (!agent) return NextResponse.json({ error: 'agent not found' }, { status: 404 });
  // Prevent duplicates (same agent + topic).
  const existing = await db.scheduledAutonomy.findFirst({ where: { agentCodename: agent.codename, topic } });
  if (existing) {
    return NextResponse.json({ error: 'schedule already exists for this agent+topic', schedule: existing }, { status: 400 });
  }
  const schedule = await db.scheduledAutonomy.create({
    data: {
      agentCodename: agent.codename,
      topic,
      intervalMin: typeof intervalMin === 'number' ? intervalMin : 60,
      enabled: true,
    },
  });
  await db.notification.create({
    data: { type: 'info', title: 'Scheduled Autonomy', message: `${agent.codename} will research "${topic}" every ${schedule.intervalMin}min.`, read: false },
  });
  return NextResponse.json({ schedule });
}
