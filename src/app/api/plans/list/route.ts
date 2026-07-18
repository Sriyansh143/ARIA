import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const plans = await db.plan.findMany({
    include: { steps: { orderBy: { stepNumber: 'asc' } } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return NextResponse.json({ plans });
}
