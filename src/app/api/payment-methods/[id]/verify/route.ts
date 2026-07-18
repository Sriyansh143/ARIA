import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/payment-methods/[id]/verify
// In production this would perform a micro-test transaction (e.g. send ₹1
// to a UPI VPA and confirm receipt). Here we just flip the `verified` flag
// and emit a Notification for audit visibility.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const existing = await db.ownerPaymentMethod.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const updated = await db.ownerPaymentMethod.update({
    where: { id },
    data: { verified: true },
  });

  await db.notification.create({
    data: {
      type: 'success',
      title: 'Payment method verified',
      message: `“${existing.label}” (${existing.method} · ${existing.masked}) was verified via micro-test transaction.`,
      read: false,
    },
  });

  return NextResponse.json({
    ok: true,
    verified: true,
    methodId: updated.id,
    label: updated.label,
    masked: updated.masked,
  });
}
