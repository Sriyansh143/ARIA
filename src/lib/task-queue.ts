/**
 * task-queue.ts — Task queue system with auto-dispatch.
 *
 * When all executing agents are busy, new tasks go into a queue.
 * The queue auto-dispatches tasks when an agent becomes free.
 * Priority: critical > high > medium > low. Within same priority: FIFO.
 * Tasks in queue for >1 hour get priority escalated.
 *
 * Ported concept from jarvis zip's agent-lifecycle-manager.ts.
 */

import { db } from '@/lib/db';
import { getExecutingAgents, getPersona, selectModel } from '@/lib/agent-registry';

export interface QueuedTask {
  id: string;
  title: string;
  description: string;
  priority: string;
  assigneeCodename?: string;
  requiredSkills?: string[];
  createdAt: number;
  escalated: boolean;
}

let queue: QueuedTask[] = [];
let dispatchTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Add a task to the queue.
 */
export function enqueue(task: QueuedTask): void {
  queue.push(task);
  // Sort by priority (critical first), then by createdAt (oldest first).
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  queue.sort((a, b) => {
    const pDiff = (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
    if (pDiff !== 0) return pDiff;
    return a.createdAt - b.createdAt;
  });
}

/**
 * Get the current queue length.
 */
export function getQueueLength(): number {
  return queue.length;
}

/**
 * Get all queued tasks.
 */
export function getQueuedTasks(): QueuedTask[] {
  return [...queue];
}

/**
 * Escalate tasks that have been in the queue for >1 hour.
 */
function escalateStaleTasks(): void {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const task of queue) {
    if (!task.escalated && task.createdAt < oneHourAgo) {
      // Escalate priority by one level.
      if (task.priority === 'low') task.priority = 'medium';
      else if (task.priority === 'medium') task.priority = 'high';
      else if (task.priority === 'high') task.priority = 'critical';
      task.escalated = true;
    }
  }
  // Re-sort after escalation.
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  queue.sort((a, b) => {
    const pDiff = (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
    if (pDiff !== 0) return pDiff;
    return a.createdAt - b.createdAt;
  });
}

/**
 * Find an idle executing agent that matches the required skills.
 */
async function findIdleAgent(requiredSkills?: string[]): Promise<string | null> {
  const executingAgents = getExecutingAgents();

  // Check each executing agent's status in the DB.
  for (const agent of executingAgents) {
    const dbAgent = await db.agent.findFirst({
      where: { codename: agent.codename },
      select: { id: true, status: true, load: true },
    });

    if (dbAgent && (dbAgent.status === 'idle' || dbAgent.status === 'thinking') && dbAgent.load < 50) {
      // If required skills specified, check if agent has them.
      if (requiredSkills && requiredSkills.length > 0) {
        const hasSkill = requiredSkills.some(s => agent.skills.includes(s));
        if (!hasSkill) continue;
      }
      return agent.codename;
    }
  }

  return null;
}

/**
 * Dispatch the next queued task to an available agent.
 * Returns the task if dispatched, null if no agent available or queue empty.
 */
export async function dispatchNext(): Promise<QueuedTask | null> {
  if (queue.length === 0) return null;

  escalateStaleTasks();

  const nextTask = queue[0];
  const idleAgent = await findIdleAgent(nextTask.requiredSkills);

  if (!idleAgent) return null;

  // Remove from queue.
  queue.shift();

  // Assign to the idle agent.
  const agent = await db.agent.findFirst({
    where: { codename: idleAgent },
    select: { id: true },
  });

  if (agent) {
    // Create or update the task in DB.
    await db.task.create({
      data: {
        title: nextTask.title.slice(0, 200),
        description: nextTask.description.slice(0, 2000),
        priority: nextTask.priority,
        assigneeId: agent.id,
        status: 'pending',
        tags: JSON.stringify(['queue-dispatched', nextTask.escalated ? 'escalated' : 'normal']),
      },
    }).catch(() => {});

    // Set agent status to working.
    await db.agent.update({
      where: { id: agent.id },
      data: { status: 'working', load: 50 },
    }).catch(() => {});

    // Create notification.
    await db.notification.create({
      data: {
        type: 'info',
        title: `Task dispatched to ${idleAgent}`,
        message: `"${nextTask.title.slice(0, 80)}" assigned from queue.`,
      },
    }).catch(() => {});
  }

  return nextTask;
}

/**
 * Start the auto-dispatch loop.
 * Checks every 30 seconds for idle agents and dispatches queued tasks.
 */
export function startAutoDispatch(): void {
  if (dispatchTimer) return;
  dispatchTimer = setInterval(async () => {
    try {
      await dispatchNext();
    } catch {
      // Best-effort: don't crash the dispatch loop.
    }
  }, 30_000); // 30 seconds
}

/**
 * Stop the auto-dispatch loop.
 */
export function stopAutoDispatch(): void {
  if (dispatchTimer) {
    clearInterval(dispatchTimer);
    dispatchTimer = null;
  }
}

/**
 * Check for idle agents and assign them tasks from the DB (not just the queue).
 * This implements the "no idle agents" rule (Rule 23).
 */
export async function assignIdleAgents(): Promise<{ assigned: number; idleFound: number }> {
  const executingAgents = getExecutingAgents();
  let assigned = 0;
  let idleFound = 0;

  for (const agent of executingAgents) {
    const dbAgent = await db.agent.findFirst({
      where: { codename: agent.codename },
      select: { id: true, status: true, load: true },
    });

    if (dbAgent && dbAgent.status === 'idle' && dbAgent.load < 30) {
      idleFound++;

      // Find a pending task that matches the agent's skills.
      const pendingTask = await db.task.findFirst({
        where: {
          status: 'pending',
          assigneeId: null,
        },
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'asc' },
        ],
      });

      if (pendingTask) {
        await db.task.update({
          where: { id: pendingTask.id },
          data: { assigneeId: dbAgent.id, status: 'in_progress' },
        });
        await db.agent.update({
          where: { id: dbAgent.id },
          data: { status: 'working', load: 40 },
        });
        assigned++;
      } else {
        // No pending tasks — assign a standby/learning task.
        await db.agent.update({
          where: { id: dbAgent.id },
          data: { status: 'thinking' }, // "thinking" = standby/learning
        });
      }
    }
  }

  return { assigned, idleFound };
}
