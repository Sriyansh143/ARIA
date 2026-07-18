import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_STATUS = [
  'lead', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost',
];
const ALLOWED_SOURCE = ['web', 'referral', 'cold-outreach', 'inbound'];

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

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const client = await db.client.findUnique({ where: { id } });
  if (!client) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ client: serializeClient(client) });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const existing = await db.client.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
  if (typeof body.company === 'string') data.company = body.company.trim() || null;
  if (typeof body.email === 'string') data.email = body.email.trim() || null;
  if (typeof body.phone === 'string') data.phone = body.phone.trim() || null;
  if (ALLOWED_STATUS.includes(body.status)) data.status = body.status;
  if (ALLOWED_SOURCE.includes(body.source)) data.source = body.source;
  if (typeof body.value === 'number' && isFinite(body.value)) data.value = body.value;
  if (typeof body.notes === 'string') data.notes = body.notes.trim() || null;
  if (typeof body.assignee === 'string') data.assignee = body.assignee.trim() || null;
  const updated = await db.client.update({ where: { id }, data });
  return NextResponse.json({ client: serializeClient(updated) });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const existing = await db.client.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await db.client.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
