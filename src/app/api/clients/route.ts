import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/clients?status=lead
 * Returns up to 200 clients (optionally filtered by status) plus pipeline
 * stats (counts per status + total pipeline value).
 */
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status');
  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  const clients = await db.client.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  // Aggregate counts + pipeline value.
  const all = await db.client.findMany({ select: { status: true, value: true } });
  const stats: Record<string, { count: number; value: number }> = {};
  let totalValue = 0;
  let totalCount = 0;
  for (const c of all) {
    stats[c.status] = stats[c.status] ?? { count: 0, value: 0 };
    stats[c.status].count += 1;
    stats[c.status].value += c.value ?? 0;
    totalValue += c.value ?? 0;
    totalCount += 1;
  }
  return NextResponse.json({
    clients: clients.map(serializeClient),
    stats: {
      total: totalCount,
      pipelineValue: totalValue,
      byStatus: stats,
    },
  });
}

/**
 * POST /api/clients
 * Create a new client. Accepts: name (required), company, email, phone,
 * status (default "lead"), source, value, notes, assignee.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const ALLOWED_STATUS = [
    'lead', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost',
  ];
  const ALLOWED_SOURCE = ['web', 'referral', 'cold-outreach', 'inbound'];
  const status = ALLOWED_STATUS.includes(body.status) ? body.status : 'lead';
  const source = ALLOWED_SOURCE.includes(body.source) ? body.source : null;
  const value = typeof body.value === 'number' && isFinite(body.value) ? body.value : 0;
  const client = await db.client.create({
    data: {
      name,
      company: typeof body.company === 'string' ? body.company.trim() || null : null,
      email: typeof body.email === 'string' ? body.email.trim() || null : null,
      phone: typeof body.phone === 'string' ? body.phone.trim() || null : null,
      status,
      source,
      value,
      notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
      assignee: typeof body.assignee === 'string' ? body.assignee.trim() || null : null,
    },
  });
  return NextResponse.json({ client: serializeClient(client) });
}

function serializeClient(c: {
  id: string; name: string; company: string | null; email: string | null;
  phone: string | null; status: string; source: string | null; value: number;
  notes: string | null; assignee: string | null;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id: c.id,
    name: c.name,
    company: c.company,
    email: c.email,
    phone: c.phone,
    status: c.status,
    source: c.source,
    value: c.value,
    notes: c.notes,
    assignee: c.assignee,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
