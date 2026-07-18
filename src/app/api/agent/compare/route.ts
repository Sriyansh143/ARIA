import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { JARVIS } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Compare 2 autonomy runs side-by-side.
// GET /api/agent/compare?a=<id>&b=<id>
export async function GET(req: NextRequest) {
  const a = req.nextUrl.searchParams.get('a');
  const b = req.nextUrl.searchParams.get('b');
  if (!a || !b) return NextResponse.json({ error: 'a and b run ids required' }, { status: 400 });

  const [runA, runB] = await Promise.all([
    db.autonomyRun.findUnique({ where: { id: a } }),
    db.autonomyRun.findUnique({ where: { id: b } }),
  ]);
  if (!runA || !runB) return NextResponse.json({ error: 'one or both runs not found' }, { status: 404 });

  const parse = (r: typeof runA) => ({
    ...r,
    trace: JSON.parse(r.traceJson) as Array<{ step: string; status: string; detail: string; latencyMs: number }>,
    taskTitles: JSON.parse(r.taskTitles) as string[],
  });

  const A = parse(runA);
  const B = parse(runB);

  // Build a step-by-step diff.
  const allSteps = Array.from(new Set([...A.trace.map((t) => t.step), ...B.trace.map((t) => t.step)]));
  const stepDiff = allSteps.map((step) => {
    const sa = A.trace.find((t) => t.step === step);
    const sb = B.trace.find((t) => t.step === step);
    return {
      step,
      aStatus: sa?.status ?? 'absent',
      bStatus: sb?.status ?? 'absent',
      aLatency: sa?.latencyMs ?? 0,
      bLatency: sb?.latencyMs ?? 0,
      latencyDelta: (sb?.latencyMs ?? 0) - (sa?.latencyMs ?? 0),
      aDetail: sa?.detail ?? '',
      bDetail: sb?.detail ?? '',
    };
  });

  const comparison = {
    a: { id: A.id, agent: A.agentCodename, topic: A.topic, source: A.source, status: A.status, tasksCreated: A.tasksCreated, latencyMs: A.latencyMs, createdAt: A.createdAt, taskTitles: A.taskTitles },
    b: { id: B.id, agent: B.agentCodename, topic: B.topic, source: B.source, status: B.status, tasksCreated: B.tasksCreated, latencyMs: B.latencyMs, createdAt: B.createdAt, taskTitles: B.taskTitles },
    deltas: {
      latencyMs: B.latencyMs - A.latencyMs,
      tasksCreated: B.tasksCreated - A.tasksCreated,
      faster: B.latencyMs < A.latencyMs,
    },
    stepDiff,
  };

  return NextResponse.json({ comparison, accent: JARVIS.colors.cyan });
}
