import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const level = req.nextUrl.searchParams.get('level');
  const agent = req.nextUrl.searchParams.get('agent');
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 200);
  const where: Record<string, unknown> = {};
  if (level) where.level = level;
  if (agent) where.agent = { codename: agent };
  const logs = await db.agentLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { agent: { select: { codename: true } } },
  });
  return NextResponse.json({ logs });
}
