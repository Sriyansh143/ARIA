import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status');
  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  const payments = await db.payment.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
  const confirmed = await db.payment.aggregate({ where: { status: 'confirmed' }, _sum: { amount: true } });
  const pending = await db.payment.aggregate({ where: { status: 'pending' }, _sum: { amount: true } });
  const count = await db.payment.count();
  return NextResponse.json({
    payments,
    stats: {
      confirmedTotal: confirmed._sum.amount ?? 0,
      pendingTotal: pending._sum.amount ?? 0,
      count,
    },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { method, amount, payer, note, status, currency } = body;
  if (!method || typeof amount !== 'number') return NextResponse.json({ error: 'method and amount required' }, { status: 400 });
  const payment = await db.payment.create({
    data: { method, amount, payer, note, status: status ?? 'pending', currency: currency ?? 'INR' },
  });
  return NextResponse.json({ payment });
}
