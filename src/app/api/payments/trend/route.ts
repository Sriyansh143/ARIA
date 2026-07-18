import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Revenue trend: confirmed payments bucketed by day for the last `days` days.
export async function GET() {
  const days = 14;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const payments = await db.payment.findMany({
    where: { status: 'confirmed', createdAt: { gte: since } },
    select: { amount: true, method: true, createdAt: true },
  });

  // Build day buckets.
  const buckets: Record<string, { date: string; total: number; count: number; byMethod: Record<string, number> }> = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    buckets[key] = { date: key, total: 0, count: 0, byMethod: {} };
  }
  for (const p of payments) {
    const key = p.createdAt.toISOString().slice(0, 10);
    if (!buckets[key]) continue;
    buckets[key].total += p.amount;
    buckets[key].count += 1;
    buckets[key].byMethod[p.method] = (buckets[key].byMethod[p.method] ?? 0) + p.amount;
  }

  const series = Object.values(buckets).map((b) => ({
    date: b.date,
    label: new Date(b.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    total: b.total,
    count: b.count,
    upi: b.byMethod.upi ?? 0,
    card: b.byMethod.card ?? 0,
    netbanking: b.byMethod.netbanking ?? 0,
    qr: b.byMethod.qr ?? 0,
    wallet: b.byMethod.wallet ?? 0,
  }));

  const cumulative: number[] = [];
  let running = 0;
  for (const s of series) {
    running += s.total;
    cumulative.push(running);
  }

  return NextResponse.json({
    series,
    cumulative,
    total: running,
    avgDaily: Math.round(running / days),
    bestDay: series.reduce((a, b) => (b.total > a.total ? b : a), series[0] ?? { date: '', total: 0, label: '' }),
  });
}
