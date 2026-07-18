import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/tasks/bulk
 * Bulk operations on multiple tasks at once.
 *
 * Body:
 *   action: 'advance' | 'delete' | 'reassign' | 'set-priority' | 'set-status'
 *   taskIds: string[]
 *   payload?: { assigneeId?, priority?, status?, progress? }
 *
 * Returns: { ok, affected, errors: [{ id, error }] }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { action, taskIds, payload } = body as {
    action?: string;
    taskIds?: string[];
    payload?: Record<string, unknown>;
  };

  if (!action || !['advance', 'delete', 'reassign', 'set-priority', 'set-status'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action. Must be one of: advance, delete, reassign, set-priority, set-status' }, { status: 400 });
  }
  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return NextResponse.json({ error: 'taskIds must be a non-empty array' }, { status: 400 });
  }

  let affected = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const id of taskIds) {
    try {
      if (action === 'delete') {
        await db.task.delete({ where: { id } });
        affected++;
      } else if (action === 'advance') {
        const task = await db.task.findUnique({ where: { id } });
        if (!task) { errors.push({ id, error: 'Not found' }); continue; }
        const next = task.status === 'pending' ? 'in_progress' : task.status === 'in_progress' ? 'completed' : 'in_progress';
        await db.task.update({
          where: { id },
          data: { status: next, progress: next === 'completed' ? 100 : next === 'in_progress' ? 25 : task.progress },
        });
        affected++;
      } else if (action === 'reassign') {
        const assigneeId = payload?.assigneeId;
        await db.task.update({
          where: { id },
          data: { assigneeId: assigneeId || null },
        });
        affected++;
      } else if (action === 'set-priority') {
        const priority = payload?.priority;
        if (!['low', 'medium', 'high', 'critical'].includes(priority as string)) {
          errors.push({ id, error: 'Invalid priority' });
          continue;
        }
        await db.task.update({ where: { id }, data: { priority: priority as string } });
        affected++;
      } else if (action === 'set-status') {
        const status = payload?.status;
        if (!['pending', 'in_progress', 'completed', 'failed', 'cancelled'].includes(status as string)) {
          errors.push({ id, error: 'Invalid status' });
          continue;
        }
        const progress = status === 'completed' ? 100 : (payload?.progress ?? 0) as number;
        await db.task.update({ where: { id }, data: { status: status as string, progress } });
        affected++;
      }
    } catch (e) {
      errors.push({ id, error: e instanceof Error ? e.message : 'Unknown error' });
    }
  }

  return NextResponse.json({ ok: true, action, affected, errors });
}
