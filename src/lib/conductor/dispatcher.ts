/**
 * src/lib/conductor/dispatcher.ts — Subagent Delegation Protocol
 *
 * Native TypeScript port of Hermes' subagent spawning model.
 *
 * When a primary agent receives a complex prompt, it can invoke
 * spawn_subagent({ department, role, task }). The dispatcher:
 *   1. Finds the best-fit agent in the target department
 *   2. Creates a SubAgentTask record
 *   3. Runs the subagent's execution loop (isolated)
 *   4. Writes the result back to shared Prisma state
 *   5. Returns a concise summary to the parent agent
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { emit } from "@/lib/event-bus";
import { callLLM } from "@/lib/llm-client";
import { SKILL_SYSTEM_PROMPT_SECTION } from "@/lib/hermes/skills";
import { TOOLS_SYSTEM_PROMPT_SECTION } from "@/lib/hermes/toolsets";
import { searchMemory } from "@/lib/hermes/memory";
import { parseJsonArray } from "@/lib/types";

export interface DispatchRequest {
  department: string;
  role: string;
  task: string;
  parentId: string;
  taskId?: string;
}

export interface DispatchResult {
  ok: boolean;
  subAgentId: string;
  subAgentName: string;
  result?: string;
  summary?: string;
  error?: string;
}

/**
 * Find the best-fit agent for a department + role.
 */
async function findAgent(department: string, role: string) {
  // First try exact role match
  let agent = await db.agent.findFirst({
    where: { role, department },
  });

  // Fallback: any agent in the department
  if (!agent) {
    agent = await db.agent.findFirst({
      where: { department },
    });
  }

  // Fallback: any agent with the role (regardless of department)
  if (!agent) {
    agent = await db.agent.findFirst({
      where: { role },
    });
  }

  return agent;
}

/**
 * Dispatch a task to a subagent.
 *
 * 1. Find the best-fit agent
 * 2. Create a SubAgentTask record
 * 3. Run the subagent's execution loop (LLM call with skills + tools + memory)
 * 4. Write the result back to the SubAgentTask
 * 5. Emit SSE event
 * 6. Return concise summary to the parent
 */
export async function dispatchToAgent(
  req: DispatchRequest,
): Promise<DispatchResult> {
  try {
    const agent = await findAgent(req.department, req.role);
    if (!agent) {
      return {
        ok: false,
        subAgentId: "",
        subAgentName: "",
        error: `No agent found for department=${req.department}, role=${req.role}`,
      };
    }

    // v61 Phase 4 (Agent Communication Board) — before dispatching, check
    // the shared blackboard for conflicts. If the task claims a resource
    // already claimed by another agent, refuse + tell the caller to pivot.
    // The claim is derived from the task description (e.g. "lead:abc123"
    // for outreach to a specific lead, "deploy:staging" for deploys).
    const resourceClaim = inferResourceClaim(req.task);
    if (resourceClaim) {
      const { isResourceClaimed, postToBlackboard, releaseFromBlackboard } = await import("../agent-blackboard");
      if (await isResourceClaimed(resourceClaim)) {
        // v61 FIX (Finding 5c): Conflict — another agent is already working on
        // this resource. Actively reject the dispatch + mark the Task as
        // BLOCKED + trigger the pivot logic to promote the next non-blocked
        // pending task. Previously this only returned an error string without
        // updating the task status or pivoting, so the fleet could stall.
        if (req.taskId) {
          try {
            await db.task.update({
              where: { id: req.taskId },
              data: {
                status: "blocked",
                result: `CONFLICT: resource "${resourceClaim}" already claimed by another agent`,
              },
            });
          } catch (e) {
            logger.warn("dispatcher.conflict-defer-failed", { taskId: req.taskId, error: String(e) });
          }
          // Trigger the pivot — promote the next non-blocked pending task so
          // the fleet always has work to do (Owner Rule: Never sit idle).
          await promoteNextNonBlockedTask(req.taskId);
          // BUG-7 FIX: only emit the "Pivot triggered" event when a pivot
          // actually happened (req.taskId is defined). Previously this emitted
          // even when taskId was undefined, lying to operators.
          emit({
            type: "system",
            ts: new Date().toISOString(),
            message: `🔄 Pivot triggered: task ${req.taskId} blocked by resource conflict on "${resourceClaim}" — fleet pivoting to next available task.`,
            level: "warn",
          });
          logger.info("dispatcher.conflict-pivoted", {
            taskId: req.taskId,
            resourceClaim,
            agent: agent.name,
          });
        }
        return {
          ok: false,
          subAgentId: "",
          subAgentName: agent.name,
          error: `CONFLICT: resource "${resourceClaim}" is already claimed by another agent. Task blocked + pivot triggered.`,
        };
      }
      // Post the claim so other agents see it.
      const posted = await postToBlackboard({
        agentName: agent.name,
        action: req.task.slice(0, 200),
        resourceClaim,
        postedAt: new Date().toISOString(),
      });
      if (!posted) {
        // Race condition — another agent claimed it between our check + post.
        return {
          ok: false,
          subAgentId: "",
          subAgentName: agent.name,
          error: `CONFLICT: resource "${resourceClaim}" was claimed by another agent during dispatch. Pivot.`,
        };
      }
      // Schedule cleanup — release the claim after 5 min (TTL) or when the
      // subtask completes. We can't await the subtask here (it runs async),
      // so the TTL in the blackboard handles stale claims.
      setTimeout(() => {
        releaseFromBlackboard(agent.name, resourceClaim).catch(() => {});
      }, 5 * 60 * 1000);
    }

    // Create SubAgentTask record
    const subTask = await db.subAgentTask.create({
      data: {
        parentId: req.parentId,
        childAgentId: agent.id,
        task: req.task,
        status: "running",
      },
    });

    // Emit SSE event
    emit({
      type: "agent.message",
      ts: new Date().toISOString(),
      message: {
        id: subTask.id,
        fromAgentId: req.parentId ?? null,
        toAgentId: agent.id,
        channel: "task",
        messageType: "delegate",
        subject: `Subagent dispatch: ${req.task.slice(0, 80)}`,
        body: req.task,
        taskId: req.taskId ?? null,
        createdAt: new Date().toISOString(),
      },
    });

    // Search memory for relevant context
    const memories = await searchMemory(req.task, agent.id, undefined, 3);
    const memoryContext = memories.length
      ? memories.map((m) => `[${m.scope}] ${m.key}: ${m.value.slice(0, 200)}`).join("\n")
      : "";

    // Build the system prompt with skills + tools
    const skillsSection = await SKILL_SYSTEM_PROMPT_SECTION(agent.role);
    const systemPrompt = [
      `You are ${agent.name}, a ${agent.role} agent in the ${agent.department} department.`,
      `Your capabilities: ${agent.capabilities}`,
      "",
      skillsSection,
      "",
      TOOLS_SYSTEM_PROMPT_SECTION(),
      memoryContext ? `\nRelevant Memory:\n${memoryContext}` : "",
    ].join("\n");

    // Execute the task via LLM
    const result = await callLLM(agent.name, agent.role, req.task, {
      systemOverride: systemPrompt,
      maxRetries: 1,
    });

    const summary = result.content.slice(0, 500);

    // Update the SubAgentTask
    await db.subAgentTask.update({
      where: { id: subTask.id },
      data: {
        status: "completed",
        result: result.content,
        summary,
        completedAt: new Date(),
      },
    });

    // Emit completion event
    emit({
      type: "agent.message",
      ts: new Date().toISOString(),
      message: {
        id: `reply_${subTask.id}`,
        fromAgentId: agent.id,
        toAgentId: req.parentId ?? null,
        channel: "task",
        messageType: "response",
        subject: `Subagent result: ${req.task.slice(0, 80)}`,
        body: summary,
        taskId: req.taskId ?? null,
        createdAt: new Date().toISOString(),
      },
    });

    logger.info("conductor.dispatcher.completed", {
      parentAgentId: req.parentId,
      childAgentId: agent.id,
      childAgentName: agent.name,
      taskPreview: req.task.slice(0, 80),
    });

    return {
      ok: true,
      subAgentId: agent.id,
      subAgentName: agent.name,
      result: result.content,
      summary,
    };
  } catch (err) {
    logger.error("conductor.dispatcher.error", { error: String(err) });
    return {
      ok: false,
      subAgentId: "",
      subAgentName: "",
      error: String(err),
    };
  }
}

/**
 * Get all subagent tasks for a parent agent.
 */
export async function getSubAgentTasks(parentId: string) {
  return db.subAgentTask.findMany({
    where: { parentId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

/**
 * v61 Phase 4 (Agent Communication Board): Infer a resource claim from the
 * task description so the blackboard can detect conflicts (e.g., two agents
 * both trying to email the same lead, or both deploying to staging).
 *
 * Returns a resource ID string like "lead:abc123" or "deploy:staging", or
 * null if no conflict-prone resource is detected.
 */
function inferResourceClaim(taskDescription: string): string | null {
  const lower = taskDescription.toLowerCase();
  // Email outreach to a specific address → claim "email:<addr>"
  const emailMatch = taskDescription.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (emailMatch && /outreach|email|send.*to/i.test(taskDescription)) {
    return `email:${emailMatch[0].toLowerCase()}`;
  }
  // Deploy to an environment → claim "deploy:<env>"
  const deployMatch = lower.match(/deploy.*?(staging|production|prod|dev)/);
  if (deployMatch) {
    return `deploy:${deployMatch[1]}`;
  }
  // Service order build → claim "order:<id>"
  const orderMatch = taskDescription.match(/order[:\s]+([a-z0-9_-]{6,})/i);
  if (orderMatch) {
    return `order:${orderMatch[1]}`;
  }
  // Payment / spend → claim "payment:<amount>" (prevents double-spend)
  if (/spend|payment|payout/i.test(taskDescription)) {
    const amtMatch = taskDescription.match(/\$?([\d,]+(?:\.\d{2})?)/);
    if (amtMatch) return `payment:${amtMatch[1]}`;
  }
  return null; // no conflict-prone resource detected
}

/**
 * v61 FIX (Finding 5c): Promote the next non-blocked pending task to running.
 *
 * Called when a task is blocked by a resource conflict (another agent already
 * claimed the resource). The fleet must pivot to other available work so it
 * never sits idle (Owner Rule: Never sit idle). This mirrors the pivot logic
 * in simulation/engine.ts:441-470 but is production-safe (not coupled to the
 * simulation tick loop) so the dispatcher can call it directly.
 *
 * A task is "blocked" if:
 *   - it IS the excluded task (the one that just got blocked), OR
 *   - its dependsOn array references an Approval with deferredUntil set.
 *
 * @param excludeTaskId The task that was just blocked (skipped during promotion).
 * @returns The id of the promoted task, or null if no non-blocked task was found.
 */
export async function promoteNextNonBlockedTask(excludeTaskId?: string): Promise<string | null> {
  try {
    const candidates = await db.task.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
    for (const t of candidates) {
      // Skip the task that was just blocked.
      if (t.id === excludeTaskId) continue;
      // Skip tasks blocked by a deferred approval (dependsOn references a
      // deferred Approval id).
      const deps = parseJsonArray<string>(t.dependsOn, []);
      if (deps.length > 0) {
        const blockedDep = await db.approval.findFirst({
          where: { id: { in: deps }, deferredUntil: { not: null } },
        });
        if (blockedDep) continue;
      }
      // Promote this task to running.
      const updated = await db.task.update({
        where: { id: t.id },
        data: { status: "running", startedAt: new Date() },
      });
      emit({
        type: "task.update",
        ts: new Date().toISOString(),
        task: {
          id: updated.id,
          title: updated.title,
          description: updated.description,
          status: "running",
          priority: updated.priority as "low" | "medium" | "high" | "critical",
          assignedToId: updated.assignedToId,
          dependsOn: parseJsonArray<string>(updated.dependsOn, []),
          result: updated.result,
          progress: updated.progress,
          kind: updated.kind as "work" | "tool_call" | "research" | "review" | "decision",
          createdAt: updated.createdAt.toISOString(),
          startedAt: updated.startedAt?.toISOString() ?? null,
          completedAt: updated.completedAt?.toISOString() ?? null,
          updatedAt: updated.updatedAt.toISOString(),
        },
      });
      logger.info("dispatcher.pivot-promoted", {
        promotedTaskId: t.id,
        blockedTaskId: excludeTaskId,
      });
      return t.id;
    }
    logger.info("dispatcher.pivot-no-candidate", { blockedTaskId: excludeTaskId });
    return null;
  } catch (err) {
    logger.warn("dispatcher.pivot-failed", { error: String(err) });
    return null;
  }
}
