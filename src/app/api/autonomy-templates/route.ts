import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET — list all autonomy templates.
export async function GET() {
  const templates = await db.autonomyTemplate.findMany({ orderBy: { updatedAt: 'desc' } });
  return NextResponse.json({
    templates: templates.map((t) => ({ ...t, tags: JSON.parse(t.tags) })),
  });
}

// POST — create a template. Body: { name, agentCodename, topic, intervalMin?, tags? }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { name, agentCodename, topic, intervalMin, tags } = body;
  if (!name || !agentCodename || !topic) {
    return NextResponse.json({ error: 'name, agentCodename, topic required' }, { status: 400 });
  }
  const agent = await db.agent.findFirst({ where: { codename: String(agentCodename).toUpperCase() } });
  if (!agent) return NextResponse.json({ error: 'agent not found' }, { status: 404 });
  const existing = await db.autonomyTemplate.findFirst({ where: { name } });
  if (existing) {
    const updated = await db.autonomyTemplate.update({
      where: { id: existing.id },
      data: { agentCodename: agent.codename, topic, intervalMin: typeof intervalMin === 'number' ? intervalMin : existing.intervalMin, tags: JSON.stringify(tags ?? JSON.parse(existing.tags)) },
    });
    return NextResponse.json({ template: { ...updated, tags: JSON.parse(updated.tags) } });
  }
  const template = await db.autonomyTemplate.create({
    data: { name, agentCodename: agent.codename, topic, intervalMin: typeof intervalMin === 'number' ? intervalMin : 60, tags: JSON.stringify(tags ?? []) },
  });
  return NextResponse.json({ template: { ...template, tags: JSON.parse(template.tags) } });
}
