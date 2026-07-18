import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { scoreLead } from '@/lib/lead-score';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_SOURCE = ['web', 'referral', 'cold-outreach', 'inbound'];
const ALLOWED_STATUS = ['new', 'contacted', 'qualified', 'converted', 'lost'];

/**
 * GET /api/leads?status=new&source=web
 * Returns up to 200 leads + counts by status + avg score.
 */
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status');
  const source = req.nextUrl.searchParams.get('source');
  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (source) where.source = source;
  const leads = await db.lead.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const all = await db.lead.findMany({ select: { status: true, score: true, source: true } });
  const byStatus: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let totalScore = 0;
  let totalCount = 0;
  for (const l of all) {
    byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
    bySource[l.source] = (bySource[l.source] ?? 0) + 1;
    totalScore += l.score ?? 0;
    totalCount += 1;
  }
  return NextResponse.json({
    leads: leads.map(serializeLead),
    stats: {
      total: totalCount,
      avgScore: totalCount > 0 ? Math.round(totalScore / totalCount) : 0,
      byStatus,
      bySource,
    },
  });
}

/**
 * POST /api/leads
 * Create a new lead. Auto-scores based on source + completeness unless
 * `score` is provided explicitly.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : '';
  if (!clientName) {
    return NextResponse.json({ error: 'clientName is required' }, { status: 400 });
  }
  const source = ALLOWED_SOURCE.includes(body.source) ? body.source : 'web';
  const status = ALLOWED_STATUS.includes(body.status) ? body.status : 'new';
  const company = typeof body.company === 'string' ? body.company.trim() || null : null;
  const email = typeof body.email === 'string' ? body.email.trim() || null : null;
  const phone = typeof body.phone === 'string' ? body.phone.trim() || null : null;
  const notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;
  const explicitScore = typeof body.score === 'number' && isFinite(body.score)
    ? Math.max(0, Math.min(100, Math.floor(body.score)))
    : null;
  const score = explicitScore ?? scoreLead({ source, clientName, company, email, phone, notes });
  const lead = await db.lead.create({
    data: {
      clientName,
      company,
      email,
      phone,
      source,
      status,
      score,
      notes,
    },
  });
  return NextResponse.json({ lead: serializeLead(lead) });
}

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
