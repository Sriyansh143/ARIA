import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Live system metrics + recent telemetry series + agent load distribution.
export async function GET() {
  const recent = await db.telemetry.findMany({ orderBy: { createdAt: 'desc' }, take: 30 });
  const series = recent.reverse();

  // Live-ish OS metrics (best-effort, sandbox-safe)
  const mem = process.memoryUsage();
  const cpu = Math.min(99, 18 + (mem.rss / 1024 / 1024 / 50) * 30);

  const current = series[series.length - 1];

  // Agent load distribution
  const agents = await db.agent.findMany({ select: { codename: true, load: true, status: true } });

  // Provider tokens
  const provider = await db.provider.findUnique({ where: { key: 'zai' } });

  return NextResponse.json({
    current: {
      cpu: current?.cpu ?? cpu,
      mem: current?.mem ?? mem.rss / 1024 / 1024,
      disk: current?.disk ?? 41,
      net: current?.net ?? 12,
      latency: current?.latency ?? provider?.latency ?? 620,
      tokens: current?.tokens ?? provider?.tokens ?? 0,
      uptime: Math.floor(process.uptime()),
    },
    series: series.map((t) => ({
      time: t.createdAt.toISOString(),
      cpu: Math.round(t.cpu * 10) / 10,
      mem: Math.round(t.mem * 10) / 10,
      disk: Math.round(t.disk * 10) / 10,
      latency: t.latency,
      tokens: t.tokens,
    })),
    agents: agents.map((a) => ({ name: a.codename, load: a.load, status: a.status })),
  });
}
