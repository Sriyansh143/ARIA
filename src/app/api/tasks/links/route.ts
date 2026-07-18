import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET — all task dependency edges (with task titles for the graph).
export async function GET() {
  const links = await db.taskLink.findMany({ orderBy: { createdAt: 'asc' } });
  // Fetch referenced tasks in one query for efficiency.
  const taskIds = Array.from(new Set(links.flatMap((l) => [l.taskId, l.dependsOnId])));
  const tasks = taskIds.length ? await db.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, title: true, status: true, priority: true } }) : [];
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const enriched = links.map((l) => ({
    ...l,
    task: taskMap.get(l.taskId) ?? null,
    dependsOn: taskMap.get(l.dependsOnId) ?? null,
  }));
  return NextResponse.json({ links: enriched });
}

// POST — create a dependency edge. Body: { taskId, dependsOnId }
// taskId depends on dependsOnId (dependsOnId blocks taskId).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { taskId, dependsOnId } = body;
  if (!taskId || !dependsOnId) {
    return NextResponse.json({ error: 'taskId and dependsOnId required' }, { status: 400 });
  }
  if (taskId === dependsOnId) {
    return NextResponse.json({ error: 'a task cannot depend on itself' }, { status: 400 });
  }
  // Prevent cycles: if dependsOnId already (transitively) depends on taskId, refuse.
  const wouldCycle = await hasPath(dependsOnId, taskId, new Set());
  if (wouldCycle) {
    return NextResponse.json({ error: 'this dependency would create a cycle' }, { status: 400 });
  }
  try {
    const link = await db.taskLink.create({ data: { taskId, dependsOnId } });
    return NextResponse.json({ link });
  } catch {
    return NextResponse.json({ error: 'link already exists or tasks not found' }, { status: 400 });
  }
}

// DELETE — remove a dependency edge. Body: { taskId, dependsOnId }
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { taskId, dependsOnId } = body;
  if (!taskId || !dependsOnId) {
    return NextResponse.json({ error: 'taskId and dependsOnId required' }, { status: 400 });
  }
  await db.taskLink.deleteMany({ where: { taskId, dependsOnId } });
  return NextResponse.json({ ok: true });
}

// Depth-first cycle check: is there a path from `from` to `to` following dependsOn edges?
async function hasPath(from: string, to: string, visited: Set<string>): Promise<boolean> {
  if (from === to) return true;
  if (visited.has(from)) return false;
  visited.add(from);
  const out = await db.taskLink.findMany({ where: { taskId: from }, select: { dependsOnId: true } });
  for (const e of out) {
    if (await hasPath(e.dependsOnId, to, visited)) return true;
  }
  return false;
}
