import { NextResponse } from 'next/server';
import { cleanupExpiredSpawnedAgents } from '@/lib/agent-spawner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const result = await cleanupExpiredSpawnedAgents();
  return NextResponse.json({
    ok: true,
    deleted: result.deleted,
    preservedLogs: result.preservedLogs,
    message: `Deleted ${result.deleted} expired spawned agents; ${result.preservedLogs} logs preserved.`,
  });
}

export async function POST() {
  const result = await cleanupExpiredSpawnedAgents();
  return NextResponse.json({
    ok: true,
    deleted: result.deleted,
    preservedLogs: result.preservedLogs,
    message: `Cleanup complete: deleted ${result.deleted}, preserved ${result.preservedLogs} logs.`,
  });
}
