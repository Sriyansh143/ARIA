import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_PRIORITY = ['low', 'medium', 'high', 'urgent'];
const ALLOWED_STATUS = ['open', 'in_progress', 'resolved', 'closed'];
const ALLOWED_CHANNEL = ['chat', 'email', 'phone', 'telegram'];

function serializeTicket(t: {
  id: string; clientName: string; subject: string; body: string;
  priority: string; status: string; channel: string;
  assignee: string | null; resolution: string | null;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id: t.id,
    clientName: t.clientName,
    subject: t.subject,
    body: t.body,
    priority: t.priority,
    status: t.status,
    channel: t.channel,
    assignee: t.assignee,
    resolution: t.resolution,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ticket = await db.supportTicket.findUnique({ where: { id } });
  if (!ticket) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ticket: serializeTicket(ticket) });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const existing = await db.supportTicket.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.clientName === 'string' && body.clientName.trim()) data.clientName = body.clientName.trim();
  if (typeof body.subject === 'string' && body.subject.trim()) data.subject = body.subject.trim();
  if (typeof body.body === 'string' && body.body.trim()) data.body = body.body.trim();
  if (ALLOWED_PRIORITY.includes(body.priority)) data.priority = body.priority;
  if (ALLOWED_STATUS.includes(body.status)) data.status = body.status;
  if (ALLOWED_CHANNEL.includes(body.channel)) data.channel = body.channel;
  if (typeof body.assignee === 'string') data.assignee = body.assignee.trim() || null;
  if (typeof body.resolution === 'string') data.resolution = body.resolution.trim() || null;
  const updated = await db.supportTicket.update({ where: { id }, data });
  return NextResponse.json({ ticket: serializeTicket(updated) });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const existing = await db.supportTicket.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await db.supportTicket.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
