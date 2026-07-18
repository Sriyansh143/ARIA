import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { scoreLead } from '@/lib/lead-score';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_SOURCE = ['web', 'referral', 'cold-outreach', 'inbound'];
const ALLOWED_STATUS = ['new', 'contacted', 'qualified', 'converted', 'lost'];

function serializeLead(l: {
  id: string; clientName: string; company: string | null; email: string | null;
  phone: string | null; source: string; status: string; score: number;
  notes: string | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: l.id,
    clientName: l.clientName,
    company: l.company,
    email: l.email,
    phone: l.phone,
    source: l.source,
    status: l.status,
    score: l.score,
    notes: l.notes,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const lead = await db.lead.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ lead: serializeLead(lead) });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const existing = await db.lead.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.clientName === 'string' && body.clientName.trim()) data.clientName = body.clientName.trim();
  if (typeof body.company === 'string') data.company = body.company.trim() || null;
  if (typeof body.email === 'string') data.email = body.email.trim() || null;
  if (typeof body.phone === 'string') data.phone = body.phone.trim() || null;
  if (ALLOWED_SOURCE.includes(body.source)) data.source = body.source;
  if (ALLOWED_STATUS.includes(body.status)) data.status = body.status;
  if (typeof body.notes === 'string') data.notes = body.notes.trim() || null;
  if (typeof body.score === 'number' && isFinite(body.score)) {
    data.score = Math.max(0, Math.min(100, Math.floor(body.score)));
  }
  // Re-score if key fields changed and no explicit score was provided.
  const mergedSource = (data.source as string | undefined) ?? existing.source;
  const mergedName = (data.clientName as string | undefined) ?? existing.clientName;
  const mergedCompany = data.company !== undefined ? (data.company as string | null) : existing.company;
  const mergedEmail = data.email !== undefined ? (data.email as string | null) : existing.email;
  const mergedPhone = data.phone !== undefined ? (data.phone as string | null) : existing.phone;
  const mergedNotes = data.notes !== undefined ? (data.notes as string | null) : existing.notes;
  const keyFieldsChanged =
    data.source !== undefined || data.clientName !== undefined ||
    data.company !== undefined || data.email !== undefined ||
    data.phone !== undefined || data.notes !== undefined;
  if (keyFieldsChanged && data.score === undefined) {
    data.score = scoreLead({
      source: mergedSource,
      clientName: mergedName,
      company: mergedCompany,
      email: mergedEmail,
      phone: mergedPhone,
      notes: mergedNotes,
    });
  }
  const updated = await db.lead.update({ where: { id }, data });
  return NextResponse.json({ lead: serializeLead(updated) });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const existing = await db.lead.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await db.lead.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
