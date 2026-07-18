import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  createRefund,
  listRefunds,
  getRefundStats,
  REFUND_REASONS,
} from '@/lib/refund-system';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── GET /api/refunds ───────────────────────────────────────────────────────
// Query params:
//   ?status=requested|under_review|approved|processed|rejected|cancelled
//   ?paymentId=<cuid>
//   ?stats=1  → include aggregate stats in the response
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status') || undefined;
  const paymentId = req.nextUrl.searchParams.get('paymentId') || undefined;
  const includeStats = req.nextUrl.searchParams.get('stats') === '1';

  const [refunds, stats] = await Promise.all([
    listRefunds({ status, paymentId }),
    includeStats ? getRefundStats() : Promise.resolve(null),
  ]);

  return NextResponse.json({ refunds, stats });
}

// ── POST /api/refunds ──────────────────────────────────────────────────────
// Body: { paymentId, amount, reason, reasonNote?, requestedBy?, paymentRefId? }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { paymentId, amount, reason, reasonNote, requestedBy, paymentRefId } = body as {
    paymentId?: string;
    amount?: unknown;
    reason?: string;
    reasonNote?: string;
    requestedBy?: string;
    paymentRefId?: string;
  };

  // ── Input validation ────────────────────────────────────────────────
  if (typeof paymentId !== 'string' || !paymentId.trim()) {
    return NextResponse.json({ error: 'paymentId is required.' }, { status: 400 });
  }
  if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount must be a positive number.' }, { status: 400 });
  }
  if (typeof reason !== 'string' || !(REFUND_REASONS as readonly string[]).includes(reason)) {
    return NextResponse.json(
      { error: `reason must be one of: ${REFUND_REASONS.join(', ')}` },
      { status: 400 },
    );
  }

  // ── Delegate to lib (does the strict parent-payment + amount checks) ──
  const result = await createRefund({
    paymentId: paymentId.trim(),
    amount,
    reason,
    reasonNote: typeof reasonNote === 'string' ? reasonNote : null,
    requestedBy: typeof requestedBy === 'string' ? requestedBy : 'operator',
    paymentRefId: typeof paymentRefId === 'string' ? paymentRefId : null,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Fetch the full refund + parent payment for the response so the client
  // can render the new row without a second round-trip.
  const refund = await db.refund.findUnique({
    where: { id: result.refund.id },
  });
  const payment = refund
    ? await db.payment.findUnique({ where: { id: refund.paymentId } })
    : null;

  return NextResponse.json(
    {
      refund: refund
        ? {
            ...refund,
            payment: payment
              ? {
                  id: payment.id,
                  method: payment.method,
                  amount: payment.amount,
                  currency: payment.currency,
                  status: payment.status,
                  payer: payment.payer,
                  note: payment.note,
                }
              : null,
          }
        : null,
      approvalRequestId: result.refund.approvalRequestId,
    },
    { status: 201 },
  );
}
