import { NextRequest, NextResponse } from 'next/server';
import {
  getRefund,
  processRefund,
  rejectRefund,
} from '@/lib/refund-system';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── GET /api/refunds/[id] ──────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  }
  const refund = await getRefund(id);
  if (!refund) {
    return NextResponse.json({ error: 'Refund not found.' }, { status: 404 });
  }
  return NextResponse.json({ refund });
}

// ── POST /api/refunds/[id] ─────────────────────────────────────────────────
// Body: { action: 'process' | 'reject', gatewayRef?, reviewNote?, reviewer }
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const { action, gatewayRef, reviewNote, reviewer } = body as {
    action?: string;
    gatewayRef?: string;
    reviewNote?: string;
    reviewer?: string;
  };

  if (action !== 'process' && action !== 'reject') {
    return NextResponse.json(
      { error: "action must be 'process' or 'reject'." },
      { status: 400 },
    );
  }
  if (typeof reviewer !== 'string' || !reviewer.trim()) {
    return NextResponse.json(
      { error: 'reviewer (reviewer name) is required.' },
      { status: 400 },
    );
  }

  if (action === 'process') {
    const result = await processRefund(id, {
      gatewayRef: typeof gatewayRef === 'string' ? gatewayRef : null,
      reviewNote: typeof reviewNote === 'string' ? reviewNote : null,
      reviewer: reviewer.trim(),
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    const refund = await getRefund(id);
    return NextResponse.json({ refund });
  }

  // action === 'reject'
  const result = await rejectRefund(id, {
    reviewNote: typeof reviewNote === 'string' ? reviewNote : null,
    reviewer: reviewer.trim(),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const refund = await getRefund(id);
  return NextResponse.json({ refund });
}
