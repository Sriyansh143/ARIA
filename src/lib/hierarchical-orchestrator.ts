// =====================================================================
// hierarchical-orchestrator.ts (v1) — Sequential + dependency-aware
// parallel hierarchical orchestration.
// =====================================================================
// Adapted for v10. CrewAI-style hierarchical process:
//   1. A "manager" agent receives the user's goal
//   2. Manager decomposes the goal into sub-tasks
//   3. Manager assigns each sub-task to the best specialist role
//   4. Specialists execute their sub-tasks (in parallel where deps allow)
//   5. Manager assembles the final output
//
// IMPORTANT: this v1 must remain intact — v2 wraps it (doesn't replace
// it). The v2 overlay adds Fugu-style context isolation via the State
// Bus when PHASE17_FUGU_ISOLATION=true; otherwise it re-exports v1
// unchanged.
//
// This v1 does NOT depend on agent-loop.ts. Sub-task execution shells
// out to our `chat()` directly to keep the module standalone.
// =====================================================================

import { chat, extractJson } from './llm';

export type AgentRole =
  | 'manager'
  | 'researcher'
  | 'coder'
  | 'writer'
  | 'reviewer'
  | 'tester'
  | 'analyst'
  | 'general';

export interface SubTask {
  id: string;
  title: string;
  description: string;
  assignedRole: AgentRole;
  dependsOn: string[]; // IDs of sub-tasks that must complete first
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: string;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
}

export interface HierarchicalTaskResult {
  accomplished: boolean;
  finalReport: string;
  subTasks: SubTask[];
  totalTokensIn: number;
  totalTokensOut: number;
  totalDurationMs: number;
  revisionsRequested: number;
}

const ROLE_PROMPTS: Record<AgentRole, { role: string; goal: string; backstory: string }> = {
  manager: {
    role: 'project manager',
    goal: 'coordinate specialists to accomplish the user\'s goal efficiently',
    backstory: 'You are an experienced project manager who decomposes complex goals into clear sub-tasks, assigns them to the right specialists, and synthesizes their outputs into a cohesive final report.',
  },
  researcher: {
    role: 'researcher',
    goal: 'find accurate, up-to-date information on the assigned topic',
    backstory: 'You are a meticulous researcher. You cite sources and distinguish between facts and speculation.',
  },
  coder: {
    role: 'software engineer',
    goal: 'write correct, efficient, well-tested code',
    backstory: 'You are a senior software engineer. You write clean code, handle edge cases, and test your solutions before declaring them complete.',
  },
  writer: {
    role: 'technical writer',
    goal: 'communicate complex ideas clearly and concisely',
    backstory: 'You are an expert technical writer. You adapt your tone to the audience, use concrete examples, and avoid jargon when simpler words work.',
  },
  reviewer: {
    role: 'quality reviewer',
    goal: 'verify the quality and correctness of others\' work',
    backstory: 'You are a rigorous reviewer. You check facts, test code, and provide specific, actionable feedback rather than vague suggestions.',
  },
  tester: {
    role: 'QA tester',
    goal: 'verify that solutions work correctly across edge cases',
    backstory: 'You are a thorough QA tester. You write test cases that cover happy paths, edge cases, and failure modes.',
  },
  analyst: {
    role: 'data analyst',
    goal: 'analyze data and extract meaningful insights',
    backstory: 'You are a skilled data analyst. You use appropriate statistical methods, visualize trends, and clearly explain your findings.',
  },
  general: {
    role: 'general-purpose assistant',
    goal: 'complete the assigned task accurately',
    backstory: 'You are a versatile AI assistant capable of handling a wide range of tasks.',
  },
};

/**
 * The manager decomposes a goal into 2-5 sub-tasks.
 */
async function decomposeGoal(goal: string, _managerModel: string): Promise<SubTask[]> {
  const prompt = `You are a project manager. Decompose the following goal into 2-5 sub-tasks.

GOAL: ${goal}

For each sub-task, specify:
- title: short title
- description: what needs to be done (1-2 sentences)
- assigned_role: one of [researcher, coder, writer, reviewer, tester, analyst, general]
- depends_on: array of sub-task IDs (1, 2, 3...) that must complete before this one. Empty array = can start immediately.

Respond with JSON only:
{
  "subtasks": [
    {
      "title": "...",
      "description": "...",
      "assigned_role": "researcher",
      "depends_on": []
    }
  ]
}

Guidelines:
- Keep it to 2-5 sub-tasks (don't over-decompose)
- The last sub-task should usually be a "writer" or "reviewer" to assemble the final output
- Mark dependencies explicitly (e.g. the writer depends on the researcher)`;

  try {
    const result = await chat(prompt, [], 'You are a project planner. Respond with JSON only.');
    const parsed = extractJson<{ subtasks?: Array<{ title?: string; description?: string; assigned_role?: string; depends_on?: unknown[] }> }>(result.content);
    if (parsed?.subtasks && Array.isArray(parsed.subtasks)) {
      return parsed.subtasks.map((st, i) => ({
        id: String(i + 1),
        title: String(st.title || `Task ${i + 1}`),
        description: String(st.description || ''),
        assignedRole: (Object.keys(ROLE_PROMPTS).includes(st.assigned_role || '')
          ? (st.assigned_role as AgentRole)
          : 'general') as AgentRole,
        dependsOn: Array.isArray(st.depends_on) ? st.depends_on.map((d) => String(d)) : [],
        status: 'pending' as const,
      }));
    }
  } catch {
    // fall through to fallback
  }

  return [{
    id: '1',
    title: 'Complete the goal',
    description: goal,
    assignedRole: 'general',
    dependsOn: [],
    status: 'pending',
  }];
}

/**
 * A specialist executes their sub-task. Uses our `chat()` directly — does
 * not depend on agent-loop.ts (which is owned by Task ID 7).
 */
async function executeSubTask(
  subTask: SubTask,
  _specialistModel: string,
  context: string,
): Promise<{ result: string; tokensIn: number; tokensOut: number; durationMs: number }> {
  const rolePrompt = ROLE_PROMPTS[subTask.assignedRole];
  const systemPrompt = `You are a ${rolePrompt.role}.
Your goal: ${rolePrompt.goal}
${rolePrompt.backstory}

${context ? `Context from previous sub-tasks:\n${context}\n` : ''}

YOUR SUB-TASK: ${subTask.title}
${subTask.description}

Complete this sub-task. Provide a clear, concise result.`;

  const start = Date.now();
  const r = await chat(subTask.description, [], systemPrompt);
  return {
    result: r.content,
    tokensIn: Math.ceil(systemPrompt.length / 4) + Math.ceil(subTask.description.length / 4),
    tokensOut: Math.ceil(r.content.length / 4),
    durationMs: Date.now() - start,
  };
}

/**
 * Manager assembles the final report.
 */
async function assembleReport(
  goal: string,
  subTasks: SubTask[],
  _managerModel: string,
): Promise<{ report: string; revisions: number; tokensIn: number; tokensOut: number }> {
  const subTaskResults = subTasks
    .filter((st) => st.status === 'completed' && st.result)
    .map((st) => `### ${st.title} (assigned to: ${st.assignedRole})\n${st.result}`)
    .join('\n\n');

  const prompt = `You are the project manager. The specialists have completed their sub-tasks.

ORIGINAL GOAL: ${goal}

SPECIALIST RESULTS:
${subTaskResults}

Assemble a final report that:
1. Synthesizes the specialists' work
2. Resolves any contradictions
3. Presents the information in a clear, well-organized way
4. Addresses the original goal directly

Write the final report. Do not mention the specialists or the process — just deliver the result as if you wrote it yourself.`;

  const r = await chat(prompt, [], 'You are a project manager. Assemble the final report.');
  return {
    report: r.content,
    revisions: 0,
    tokensIn: Math.ceil(prompt.length / 4),
    tokensOut: Math.ceil(r.content.length / 4),
  };
}

/**
 * Run a hierarchical multi-agent task.
 *
 * Flow:
 *   1. Manager decomposes goal → sub-tasks
 *   2. Sub-tasks with no dependencies run in parallel (up to maxConcurrent)
 *   3. As dependencies complete, dependent sub-tasks start
 *   4. Manager assembles final report
 *
 * Skip-aware: if a dependency fails, dependents are skipped (not deadlocked).
 */
export async function runHierarchicalTask(opts: {
  goal: string;
  managerModel?: string;
  specialistModel?: string;
  maxConcurrent?: number; // default 3
  onSubTaskStart?: (subTask: SubTask) => void;
  onSubTaskComplete?: (subTask: SubTask) => void;
}): Promise<HierarchicalTaskResult> {
  const start = Date.now();
  const maxConcurrent = opts.maxConcurrent ?? 3;
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  // 1. Decompose
  const subTasks = await decomposeGoal(opts.goal, opts.managerModel ?? 'glm-4.6');

  // 2. Execute with skip-aware topological scheduling.
  const resolved = new Set<string>();
  const succeeded = new Set<string>();
  const running = new Set<string>();
  const idOf = new Map(subTasks.map((st) => [st.id, st]));

  while (resolved.size < subTasks.length) {
    // Cascade-skip: any pending task whose deps are all resolved but NOT
    // all succeeded can never run — mark it skipped now (skip-aware edge).
    for (const st of subTasks) {
      if (st.status !== 'pending' || running.has(st.id)) continue;
      const depsResolved = st.dependsOn.every((depId) => resolved.has(depId) || !idOf.has(depId));
      const depsSucceeded = st.dependsOn.every((depId) => succeeded.has(depId) || !idOf.has(depId));
      if (depsResolved && !depsSucceeded) {
        st.status = 'skipped';
        st.result = 'Skipped: one or more upstream dependencies failed or were skipped.';
        resolved.add(st.id);
        opts.onSubTaskComplete?.(st);
      }
    }

    const ready = subTasks.filter((st) =>
      st.status === 'pending' &&
      !running.has(st.id) &&
      st.dependsOn.every((depId) => succeeded.has(depId) || !idOf.has(depId)),
    );

    if (ready.length === 0 && running.size === 0) {
      // No runnable tasks and nothing in flight — fail stuck tasks (cycle).
      const stuck = subTasks.filter((st) => st.status === 'pending');
      for (const st of stuck) {
        st.status = 'failed';
        st.result = 'Failed: unresolvable dependency cycle.';
        resolved.add(st.id);
        opts.onSubTaskComplete?.(st);
      }
      break;
    }

    const toStart = ready.slice(0, maxConcurrent - running.size);
    for (const st of toStart) {
      running.add(st.id);
      st.status = 'running';
      opts.onSubTaskStart?.(st);

      const context = st.dependsOn
        .map((depId) => {
          const dep = subTasks.find((s) => s.id === depId);
          return dep?.result ? `From ${dep.assignedRole} (${dep.title}):\n${dep.result}` : '';
        })
        .filter(Boolean)
        .join('\n\n');

      executeSubTask(st, opts.specialistModel ?? 'glm-4.6', context)
        .then(({ result, tokensIn, tokensOut, durationMs }) => {
          st.result = result;
          st.tokensIn = tokensIn;
          st.tokensOut = tokensOut;
          st.durationMs = durationMs;
          st.status = 'completed';
          totalTokensIn += tokensIn;
          totalTokensOut += tokensOut;
          resolved.add(st.id);
          succeeded.add(st.id);
          running.delete(st.id);
          opts.onSubTaskComplete?.(st);
        })
        .catch((err) => {
          st.status = 'failed';
          st.result = `Error: ${err instanceof Error ? err.message : String(err)}`;
          resolved.add(st.id);
          running.delete(st.id);
          opts.onSubTaskComplete?.(st);
        });
    }

    if (running.size > 0) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // 3. Assemble
  const assembly = await assembleReport(opts.goal, subTasks, opts.managerModel ?? 'glm-4.6');
  totalTokensIn += assembly.tokensIn;
  totalTokensOut += assembly.tokensOut;

  return {
    accomplished: subTasks.every((st) => st.status === 'completed'),
    finalReport: assembly.report,
    subTasks,
    totalTokensIn,
    totalTokensOut,
    totalDurationMs: Date.now() - start,
    revisionsRequested: assembly.revisions,
  };
}
