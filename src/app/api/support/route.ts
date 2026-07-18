import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_PRIORITY = ['low', 'medium', 'high', 'urgent'];
const ALLOWED_STATUS = ['open', 'in_progress', 'resolved', 'closed'];
const ALLOWED_CHANNEL = ['chat', 'email', 'phone', 'telegram'];

/**
 * GET /api/support?status=open&priority=urgent
 * Returns up to 200 tickets + counts by status / priority.
 */
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status');
  const priority = req.nextUrl.searchParams.get('priority');
  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (priority) where.priority = priority;
  const tickets = await db.supportTicket.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const all = await db.supportTicket.findMany({ select: { status: true, priority: true, channel: true } });
  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  for (const t of all) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
    byChannel[t.channel] = (byChannel[t.channel] ?? 0) + 1;
  }
  return NextResponse.json({
    tickets: tickets.map(serializeTicket),
    stats: {
      total: all.length,
      byStatus,
      byPriority,
      byChannel,
    },
  });
}

/**
 * POST /api/support
 * Create a new support ticket. clientName + subject + body are required.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : '';
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const bodyText = typeof body.body === 'string' ? body.body.trim() : '';
  if (!clientName || !subject || !bodyText) {
    return NextResponse.json(
      { error: 'clientName, subject, and body are required' },
      { status: 400 },
    );
  }
  const priority = ALLOWED_PRIORITY.includes(body.priority) ? body.priority : 'medium';
  const status = ALLOWED_STATUS.includes(body.status) ? body.status : 'open';
  const channel = ALLOWED_CHANNEL.includes(body.channel) ? body.channel : 'chat';
  const ticket = await db.supportTicket.create({
    data: {
      clientName,
      subject,
      body: bodyText,
      priority,
      status,
      channel,
      assignee: typeof body.assignee === 'string' ? body.assignee.trim() || null : null,
      resolution: typeof body.resolution === 'string' ? body.resolution.trim() || null : null,
    },
  });
  return NextResponse.json({ ticket: serializeTicket(ticket) });
}

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
