import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { JARVIS } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Returns graph data for the task dependency DAG: nodes = tasks, edges = dependency links.
// Edge direction: dependsOn → task (the blocker points to the blocked task).
export async function GET() {
  const [tasks, links] = await Promise.all([
    db.task.findMany({ orderBy: { createdAt: 'asc' }, include: { assignee: { select: { codename: true } } } }),
    db.taskLink.findMany({}),
  ]);

  const STATUS_COLORS: Record<string, string> = {
    pending: JARVIS.colors.amber,
    in_progress: JARVIS.colors.cyan,
    completed: JARVIS.colors.green,
    failed: JARVIS.colors.red,
    cancelled: JARVIS.colors.textMute,
  };

  const PRIORITY_COLORS: Record<string, string> = {
    low: JARVIS.colors.cyan,
    medium: JARVIS.colors.violet,
    high: JARVIS.colors.amber,
    critical: JARVIS.colors.red,
  };

  type Node = { id: string; label: string; type: string; color: string; size: number; meta: Record<string, unknown> };
  type Edge = { source: string; target: string; color: string; width: number; label: string };

  const nodes: Node[] = tasks.map((t) => ({
    id: t.id,
    label: t.title.length > 24 ? t.title.slice(0, 23) + '…' : t.title,
    type: t.status,
    color: STATUS_COLORS[t.status] ?? JARVIS.colors.textDim,
    size: t.priority === 'critical' ? 13 : t.priority === 'high' ? 11 : 9,
    meta: {
      status: t.status,
      priority: t.priority,
      priorityColor: PRIORITY_COLORS[t.priority] ?? JARVIS.colors.textDim,
      assignee: t.assignee?.codename ?? null,
      progress: t.progress,
      fullTitle: t.title,
    },
  }));

  const edges: Edge[] = links.map((l) => ({
    source: l.dependsOnId, // blocker
    target: l.taskId,      // blocked
    color: JARVIS.colors.violet,
    width: 1.5,
    label: 'blocks',
  }));

  // Stats: which tasks are blocked (have unmet deps), which are ready (no deps or all deps done).
  const blockedSet = new Set(links.map((l) => l.taskId));
  const doneDeps = new Set(tasks.filter((t) => t.status === 'completed').map((t) => t.id));
  const ready = tasks.filter((t) => {
    const deps = links.filter((l) => l.taskId === t.id).map((l) => l.dependsOnId);
    return deps.length > 0 && deps.every((d) => doneDeps.has(d));
  }).length;

  return NextResponse.json({
    nodes,
    edges,
    stats: {
      tasks: tasks.length,
      links: links.length,
      blocked: blockedSet.size,
      ready,
      completed: tasks.filter((t) => t.status === 'completed').length,
    },
  });
}
