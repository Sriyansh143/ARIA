import { NextRequest, NextResponse } from 'next/server';
import {
  listSpawnedAgents,
  listRespawnableLogs,
  spawnSubAgent,
  type SpawnedAgentRow,
  type SpawnedLogRow,
} from '@/lib/agent-spawner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const status = url.searchParams.get('status') || undefined;
  const parentCodename = url.searchParams.get('parent') || undefined;

  const [active, logs] = await Promise.all([
    listSpawnedAgents({ status, parentCodename }),
    listRespawnableLogs(),
  ]);

  const totalEarnings = active.reduce((s, a) => s + (a.earnings || 0), 0);
  const totalTasks = active.reduce((s, a) => s + (a.taskCount || 0), 0);

  return NextResponse.json({
    active: active as SpawnedAgentRow[],
    logs: logs as SpawnedLogRow[],
    stats: {
      active: active.length,
      retired: active.filter((a) => a.status === 'retired').length,
      respawnable: logs.length,
      totalEarnings,
      totalTasks,
    },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { parentCodename, role, skills, reason, model, respawnFromLogId } = body as {
    parentCodename?: string;
    role?: string;
    skills?: string[];
    reason?: string;
    model?: string;
    respawnFromLogId?: string;
  };

  if (!parentCodename && !respawnFromLogId) {
    return NextResponse.json(
      { error: 'parentCodename or respawnFromLogId required' },
      { status: 400 },
    );
  }

  try {
    const spawned = await spawnSubAgent({
      parentCodename: parentCodename || '',
      role,
      skills,
      reason,
      spawnedReason: reason,
      model,
      respawnFromLogId,
    });
    return NextResponse.json({ spawned });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'spawn failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
