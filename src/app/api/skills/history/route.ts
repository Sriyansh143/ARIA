import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET — recent skill execution history.
export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 20);
  const runs = await db.skillRun.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(limit, 100) });
  return NextResponse.json({ runs });
}
