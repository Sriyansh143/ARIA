// =====================================================================
// hierarchical-orchestrator-v2.ts
// =====================================================================
// Phase 17 / Dimension 3 — adapted for v10.
//
// Additive overlay on top of the existing `hierarchical-orchestrator.ts`
// (v1). When PHASE17_FUGU_ISOLATION=true, replaces the context-passing
// logic with Fugu-style isolation: sub-agents see only their atomic task
// + State Bus summaries, never the global prompt lineage.
//
// When PHASE17_FUGU_ISOLATION=false (default), re-exports the original
// `runHierarchicalTask` unchanged — zero behavior change.
//
// This v2 does NOT depend on agent-loop.ts. Sub-task execution shells
// out to the Fugu isolation layer (which uses chat() directly).
// =====================================================================

import { chat } from './llm';
import {
  buildIsolationContext,
  executeSubTaskIsolated,
  type IsolationRole,
  type SubTask,
} from './fugu-isolation';
import { stateBus } from './state-bus';

// Re-export the v1 types + interface so callers don't need to change imports.
export type { AgentRole, HierarchicalTaskResult } from './hierarchical-orchestrator';
import type { HierarchicalTaskResult, AgentRole } from './hierarchical-orchestrator';

const FUGU_ENABLED = process.env.PHASE17_FUGU_ISOLATION === 'true';

const VALID_ROLES: AgentRole[] = [
  'manager', 'researcher', 'coder', 'writer', 'reviewer', 'tester', 'analyst', 'general',
];

// Fugu-isolated decomposition — manager sees goal, decomposes into
// atomic sub-tasks (each must be self-contained, no references to the
// original goal or other sub-tasks).
async function decomposeGoalIsolated(
  goal: string,
  _managerModel: string,
  runId: string,
): Promise<SubTask[]> {
  // Store the original goal on the State Bus — only the manager sees it.
  await stateBus.set(`run:${runId}:shared:goal`, goal, 24 * 60 * 60 * 1000);

  const prompt = `You are a project manager. Decompose the following goal into 2-5 sub-tasks.

GOAL: ${goal}

For each sub-task, specify:
- title: short title
- description: what needs to be done (1-2 sentences). MUST be self-contained — do NOT reference the original goal or other sub-tasks.
- role: one of [researcher, coder, writer, reviewer, tester, analyst, general]
- depends_on: array of sub-task IDs (1, 2, 3...) that must complete first. Empty = parallel.

Respond with JSON only:
{"subtasks": [{"title": "...", "description": "...", "role": "...", "depends_on": []}]}`;

  try {
    const result = await chat(prompt, [], 'You are a project planner. Respond with JSON only.');
    const match = result.content.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : null;
    if (parsed?.subtasks && Array.isArray(parsed.subtasks)) {
      return parsed.subtasks.map((st: { title?: string; description?: string; role?: string; assigned_role?: string; depends_on?: unknown[] }, i: number) => ({
        id: String(i + 1),
        title: String(st.title || `Task ${i + 1}`),
        description: String(st.description || ''),
        role: (VALID_ROLES.includes((st.assigned_role || st.role) as AgentRole)
          ? ((st.assigned_role || st.role) as AgentRole)
          : 'general') as IsolationRole,
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
    role: 'general' as IsolationRole,
    dependsOn: [],
    status: 'pending' as const,
  }];
}

// Fugu-isolated execution — sub-agent sees ONLY its atomic task.
async function executeIsolated(
  runId: string,
  subTask: SubTask,
  specialistModel: string,
  onSubTaskStart?: (st: SubTask) => void,
  onSubTaskComplete?: (st: SubTask) => void,
): Promise<void> {
  onSubTaskStart?.(subTask);
  subTask.status = 'running';

  const ctx = buildIsolationContext({
    runId,
    subTaskId: subTask.id,
    role: subTask.role as IsolationRole,
    subTaskDescription: subTask.description,
    model: specialistModel,
    dependsOn: subTask.dependsOn,
  });

  try {
    const result = await executeSubTaskIsolated(ctx, []);
    subTask.result = result.result;
    subTask.resultSummary = result.summary;
    subTask.tokensIn = result.tokensIn;
    subTask.tokensOut = result.tokensOut;
    subTask.durationMs = result.durationMs;
    subTask.status = 'completed';
  } catch (err) {
    subTask.status = 'failed';
    subTask.result = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }

  onSubTaskComplete?.(subTask);
}

// Fugu-isolated assembly — manager sees goal + summaries only (not full results).
async function assembleReportIsolated(
  goal: string,
  subTasks: SubTask[],
  _managerModel: string,
  runId: string,
): Promise<{ report: string; tokensIn: number; tokensOut: number }> {
  // Load summaries from State Bus — NOT full results.
  const summaries: string[] = [];
  for (const st of subTasks) {
    if (st.status !== 'completed') continue;
    const summary = await stateBus.get(`run:${runId}:step:${st.id}:result:summary`);
    summaries.push(`### ${st.title} (${st.role})\n${summary || st.result?.slice(0, 200) || '[no summary]'}`);
  }

  const prompt = `You are the project manager. Specialists have completed their sub-tasks.

ORIGINAL GOAL: ${goal}

SPECIALIST SUMMARIES (condensed — full results are on the State Bus if needed):
${summaries.join('\n\n')}

Assemble a final report that synthesizes these summaries into a cohesive deliverable.
Do not mention the specialists or the process — deliver the result as if you wrote it yourself.`;

  const r = await chat(prompt, [], 'You are a project manager. Assemble the final report.');
  return {
    report: r.content,
    tokensIn: Math.ceil(prompt.length / 4),
    tokensOut: Math.ceil(r.content.length / 4),
  };
}

// Main entry point — Fugu-isolated hierarchical task.
export async function runHierarchicalTaskV2(opts: {
  goal: string;
  managerModel?: string;
  specialistModel?: string;
  maxConcurrent?: number;
  onSubTaskStart?: (st: SubTask) => void;
  onSubTaskComplete?: (st: SubTask) => void;
}): Promise<HierarchicalTaskResult> {
  if (!FUGU_ENABLED) {
    // Fall through to v1 — zero behavior change.
    const { runHierarchicalTask } = await import('./hierarchical-orchestrator');
    return runHierarchicalTask({
      goal: opts.goal,
      managerModel: opts.managerModel,
      specialistModel: opts.specialistModel,
      maxConcurrent: opts.maxConcurrent,
      onSubTaskStart: opts.onSubTaskStart as ((st: import('./hierarchical-orchestrator').SubTask) => void) | undefined,
      onSubTaskComplete: opts.onSubTaskComplete as ((st: import('./hierarchical-orchestrator').SubTask) => void) | undefined,
    });
  }

  const start = Date.now();
  const maxConcurrent = opts.maxConcurrent ?? 3;
  const runId = `fugu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  const subTasks = await decomposeGoalIsolated(opts.goal, opts.managerModel ?? 'glm-4.6', runId);

  const completed = new Set<string>();
  const running = new Set<string>();

  while (completed.size < subTasks.length) {
    const ready = subTasks.filter((st) =>
      st.status === 'pending' &&
      !running.has(st.id) &&
      (st.dependsOn || []).every((depId) => completed.has(depId)),
    );

    if (ready.length === 0 && running.size === 0) {
      // Deadlock — mark all pending as failed.
      for (const st of subTasks) if (st.status === 'pending') st.status = 'failed';
      break;
    }

    const toStart = ready.slice(0, maxConcurrent - running.size);
    for (const st of toStart) {
      running.add(st.id);
      st.status = 'running';
      executeIsolated(runId, st, opts.specialistModel ?? 'glm-4.6', opts.onSubTaskStart, opts.onSubTaskComplete)
        .then(() => {
          totalTokensIn += st.tokensIn || 0;
          totalTokensOut += st.tokensOut || 0;
          completed.add(st.id);
          running.delete(st.id);
        })
        .catch(() => {
          st.status = 'failed';
          completed.add(st.id);
          running.delete(st.id);
        });
    }

    if (running.size > 0) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  const assembly = await assembleReportIsolated(opts.goal, subTasks, opts.managerModel ?? 'glm-4.6', runId);
  totalTokensIn += assembly.tokensIn;
  totalTokensOut += assembly.tokensOut;

  return {
    accomplished: subTasks.every((st) => st.status === 'completed'),
    finalReport: assembly.report,
    subTasks: subTasks as unknown as import('./hierarchical-orchestrator').SubTask[],
    totalTokensIn,
    totalTokensOut,
    totalDurationMs: Date.now() - start,
    revisionsRequested: 0,
  };
}

// Default export — callers can swap `import { runHierarchicalTask } → runHierarchicalTaskV2`.
export const runHierarchicalTask = runHierarchicalTaskV2;

// Whether Fugu isolation is currently enabled (for UI display).
export const fuguIsolationEnabled = FUGU_ENABLED;
