import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const FLOW: Record<string, string> = {
  pending: 'in_progress',
  in_progress: 'completed',
  completed: 'pending',
  failed: 'in_progress',
};

/**
 * Auto-unblock: when a task is completed, find all tasks that depend on it.
 * For each dependent, check if ALL its blockers are now completed. If so,
 * create a notification that the task is ready to start.
 */
async function unblockDependents(completedTaskId: string, completedTitle: string) {
  // Find edges where the completed task is the blocker (dependsOnId).
  const dependents = await db.taskLink.findMany({ where: { dependsOnId: completedTaskId }, select: { taskId: true } });
  const unblocked: string[] = [];
  for (const { taskId } of dependents) {
    // Get all blockers of this dependent task.
    const allBlockers = await db.taskLink.findMany({ where: { taskId }, select: { dependsOnId: true } });
    if (allBlockers.length === 0) continue;
    // Check every blocker is completed.
    const blockerIds = allBlockers.map((l) => l.dependsOnId);
    const blockerTasks = await db.task.findMany({ where: { id: { in: blockerIds } }, select: { id: true, status: true } });
    const allDone = blockerTasks.length === blockerIds.length && blockerTasks.every((t) => t.status === 'completed');
    if (allDone) {
      const dep = await db.task.findUnique({ where: { id: taskId }, select: { id: true, title: true, assigneeId: true } });
      if (dep) {
        await db.notification.create({
          data: {
            type: 'success',
            title: 'Task Unblocked',
            message: `"${dep.title}" is now ready — all dependencies completed (last: "${completedTitle}").`,
            read: false,
          },
        });
        // Log under the dependent task's assignee if any.
        if (dep.assigneeId) {
          await db.agentLog.create({
            data: { agentId: dep.assigneeId, level: 'success', message: `Task unblocked: ${dep.title} — all deps done` },
          });
        }
        unblocked.push(dep.title);
      }
    }
  }
  return unblocked;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  let markingCompleted = false;
  if (body.status) {
    data.status = body.status;
    if (body.status === 'completed') { data.progress = 100; markingCompleted = true; }
    if (body.status === 'in_progress' && body.progress == null) data.progress = 10;
  }
  if (typeof body.progress === 'number') data.progress = body.progress;
  if (body.assigneeId !== undefined) data.assigneeId = body.assigneeId || null;
  if (body.priority) data.priority = body.priority;
  const task = await db.task.update({ where: { id }, data });

  let unblocked: string[] = [];
  if (markingCompleted) {
    unblocked = await unblockDependents(id, task.title);
  }
  return NextResponse.json({ task, unblocked });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Advance status along the flow.
  const { id } = await ctx.params;
  const task = await db.task.findUnique({ where: { id } });
  if (!task) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const next = FLOW[task.status] ?? 'in_progress';
  const updated = await db.task.update({
    where: { id },
    data: { status: next, progress: next === 'completed' ? 100 : task.status === 'pending' ? 15 : Math.min(90, task.progress + 25) },
  });

  let unblocked: string[] = [];
  if (next === 'completed') {
    unblocked = await unblockDependents(id, updated.title);
  }
  void req;
  return NextResponse.json({ task: updated, unblocked });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Clean up any dependency edges referencing this task before deleting.
  await db.taskLink.deleteMany({ where: { OR: [{ taskId: id }, { dependsOnId: id }] } });
  await db.task.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
