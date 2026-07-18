import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { queryBlackBox, getBlackBoxStats, seedBlackBoxIfEmpty, type BlackBoxCategory, type BlackBoxSeverity } from '@/lib/blackbox';

export const dynamic = 'force-dynamic';

// GET /api/blackbox?agent=&category=&severity=&since=&limit=
export async function GET(req: NextRequest) {
  const agentCodename = req.nextUrl.searchParams.get('agent') || undefined;
  const category = (req.nextUrl.searchParams.get('category') || undefined) as BlackBoxCategory | undefined;
  const severity = (req.nextUrl.searchParams.get('severity') || undefined) as BlackBoxSeverity | undefined;
  const sinceStr = req.nextUrl.searchParams.get('since');
  const since = sinceStr ? Number(sinceStr) : undefined;
  const limitStr = req.nextUrl.searchParams.get('limit');
  const limit = limitStr ? Number(limitStr) : 200;

  // Seed the in-memory blackbox on first call so the tab isn't empty.
  try {
    const agents = await db.agent.findMany({ select: { codename: true } });
    seedBlackBoxIfEmpty(agents);
  } catch {
    seedBlackBoxIfEmpty([]);
  }

  const entries = queryBlackBox({
    agentCodename,
    category,
    severity,
    since,
    limit,
  });

  // Also pull the latest AgentLog rows so the timeline reflects DB state.
  let dbLogs: Array<{
    id: string;
    createdAt: Date;
    agentCodename: string | null;
    level: string;
    message: string;
    meta: string | null;
  }> = [];
  try {
    const logs = await db.agentLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { agent: { select: { codename: true } } },
    });
    dbLogs = logs.map((l) => ({
      id: l.id,
      createdAt: l.createdAt,
      agentCodename: l.agent?.codename ?? null,
      level: l.level,
      message: l.message,
      meta: l.meta,
    }));
  } catch {
    // ignore — DB logs are optional
  }

  const stats = getBlackBoxStats();

  return NextResponse.json({ entries, dbLogs, stats });
}
