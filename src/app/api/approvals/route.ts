import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — list pending approvals (notifications with type='approval-required')
export async function GET() {
  const approvals = await db.notification.findMany({
    where: { type: 'approval-required', read: false },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return NextResponse.json({ pending: approvals, count: approvals.length });
}

// POST — resolve an approval { id, decision: 'approved' | 'rejected' }
export async function POST(req: NextRequest) {
  const { id, decision } = await req.json().catch(() => ({})) as { id?: string; decision?: string };
  if (!id || !decision || !['approved', 'rejected'].includes(decision)) {
    return NextResponse.json({ error: 'id and decision (approved|rejected) required' }, { status: 400 });
  }
  const updated = await db.notification.update({
    where: { id },
    data: { read: true, type: decision === 'approved' ? 'success' : 'warn', message: `[${decision.toUpperCase()}] ${''}` },
  });
  return NextResponse.json({ ok: true, id, decision, notification: updated });
}
