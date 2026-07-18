// =====================================================================
// parallel-orchestrator.ts — Multi-agent parallel execution of DAG plans.
// =====================================================================
// Adapted for v10. Closes the gap vs Teamily AI's "parallel execution of
// independent subtasks" + "multi-agent orchestration with task delegation".
//
// Accepts a plan (either a TaskPlan from task-decomposer or a DAGPlan
// from dag-planner), then:
//   1. Topologically sorts steps into execution batches (Kahn's algorithm)
//   2. Steps in the same batch (all deps satisfied) run in parallel via
//      Promise.allSettled — capped at `maxParallel` concurrent steps
//   3. Each step's result is written to the State Bus ("blackboard")
//      so downstream steps can read dep results
//   4. Aggregates per-step outcomes into an OrchestrationResult
//
// This module is self-contained — it does not depend on agent-collab.ts
// or agent-bus.ts (zip-only). State sharing is via our state-bus.
// =====================================================================

import { stateBus } from './state-bus';
import { chat } from './llm';
import { db } from './db';
import type { TaskPlan, SubTask as DecomposerSubTask } from './task-decomposer';

// ─── Public types ────────────────────────────────────────────────────

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  prompt?: string;
  dependsOn: string[];
  tool?: string;
  parallelizable?: boolean;
  estimatedIterations?: number;
}

export interface StructuredPlan {
  goal: string;
  steps: PlanStep[];
  reasoning?: string;
}

export interface StepOutcome {
  stepId: string;
  title: string;
  success: boolean;
  result: string;
  durationMs: number;
  executedBy: 'local' | string; // 'local' or agent codename
  error?: string;
}

export interface OrchestrationResult {
  planGoal: string;
  steps: StepOutcome[];
  successCount: number;
  failureCount: number;
  totalDurationMs: number;
  contextSummary: string;
  parallelBatches: number;
  batches: PlanStep[][]; // for DAG visualization
}

// ─── Adapters: convert TaskPlan / DAGPlan → StructuredPlan ───────────

export function planFromTaskPlan(goal: string, tp: TaskPlan): StructuredPlan {
  return {
    goal,
    reasoning: tp.reasoning,
    steps: tp.subtasks.map((s: DecomposerSubTask) => ({
      id: s.id,
      title: s.description.slice(0, 80),
      description: s.description,
      dependsOn: s.dependsOn,
      ...(s.tool ? { tool: s.tool } : {}),
      parallelizable: true,
      estimatedIterations: s.estimatedIterations,
    })),
  };
}

// ─── Shared context via State Bus ────────────────────────────────────

const CONTEXT_KEY_PREFIX = 'orchestration:context:';

async function writeStepContext(
  runId: string,
  stepId: string,
  result: string,
): Promise<void> {
  try {
    await stateBus.set(`${CONTEXT_KEY_PREFIX}${runId}:${stepId}`, result, 60 * 60 * 1000);
  } catch {
    // best-effort — State Bus unavailable means context not shared
  }
}

async function readStepContext(
  runId: string,
  stepId: string,
): Promise<string | null> {
  try {
    return await stateBus.get(`${CONTEXT_KEY_PREFIX}${runId}:${stepId}`);
  } catch {
    return null;
  }
}

// ─── Dependency resolution (topological batches) ─────────────────────

/**
 * Topologically sort plan steps into execution batches.
 * Steps in the same batch have all deps satisfied and can run in parallel.
 */
export function buildExecutionBatches(steps: PlanStep[]): PlanStep[][] {
  const completed = new Set<string>();
  const remaining = [...steps];
  const batches: PlanStep[][] = [];

  // Guard against cycles — if we can't make progress, fail gracefully.
  let lastRemaining = -1;
  while (remaining.length > 0) {
    if (remaining.length === lastRemaining) {
      // Cycle or unsatisfiable dep — push the rest as a single serial batch
      // and break. This prevents infinite loops on malformed plans.
      batches.push(remaining.slice());
      break;
    }
    lastRemaining = remaining.length;

    const ready = remaining.filter((step) =>
      step.dependsOn.every((dep) => completed.has(dep)),
    );

    if (ready.length === 0) {
      // No ready steps — pick the first remaining and force it through
      // so we don't deadlock on missing deps.
      const forced = remaining[0];
      batches.push([forced]);
      completed.add(forced.id);
      const idx = remaining.findIndex((s) => s.id === forced.id);
      if (idx >= 0) remaining.splice(idx, 1);
      continue;
    }

    batches.push(ready);
    for (const step of ready) {
      completed.add(step.id);
      const idx = remaining.findIndex((s) => s.id === step.id);
      if (idx >= 0) remaining.splice(idx, 1);
    }
  }

  return batches;
}

// ─── Step executor ───────────────────────────────────────────────────

export type LocalExecutor = (step: PlanStep, context: string) => Promise<string>;

/**
 * Default local executor: calls chat() with the step's prompt/description
 * + accumulated context from dependency steps.
 */
export const defaultLocalExecutor: LocalExecutor = async (step, context) => {
  const userMsg = step.prompt || step.description;
  const enriched = context
    ? `${userMsg}\n\n[Context from prior steps]:\n${context}`
    : userMsg;
  const r = await chat(enriched, [], `You are a specialist agent. Execute the following sub-task concisely: "${step.title}"`);
  return r.content;
};

/**
 * Try to delegate the step to a specialist agent in the fleet.
 * Returns the agent codename on success, or null if no specialist was
 * available (caller falls back to local execution).
 */
async function tryDelegateToSpecialist(
  step: PlanStep,
  context: string,
  agentCodename?: string,
): Promise<{ executedBy: string; result: string } | null> {
  if (!agentCodename) return null;
  try {
    const agent = await db.agent.findFirst({ where: { codename: agentCodename } });
    if (!agent) return null;
    const userMsg = step.prompt || step.description;
    const enriched = context
      ? `${userMsg}\n\n[Context]:\n${context.slice(0, 1500)}`
      : userMsg;
    const r = await chat(enriched, [], `You are ${agent.codename}, a ${agent.role}. Execute this sub-task: "${step.title}"`);
    return { executedBy: agent.codename, result: r.content };
  } catch {
    return null;
  }
}

/**
 * Execute a single plan step.
 * 1. Build enriched context from dependency results (via State Bus)
 * 2. Try specialist delegation (if agentCodename provided)
 * 3. Fall back to localExecutor
 * 4. Write result to State Bus for downstream steps
 */
async function executeStep(
  step: PlanStep,
  contextSoFar: string,
  runId: string,
  localExecutor: LocalExecutor,
  agentCodename?: string,
): Promise<StepOutcome> {
  const start = Date.now();

  // Enrich context with results of dependency steps (from State Bus).
  let enrichedContext = contextSoFar;
  for (const depId of step.dependsOn) {
    const depResult = await readStepContext(runId, depId);
    if (depResult) {
      enrichedContext += `\n\n[Result of step ${depId}]:\n${depResult.slice(0, 1500)}`;
    }
  }

  let executedBy: 'local' | string = 'local';
  let result = '';
  let success = false;
  let error: string | undefined;

  // Try specialist delegation first.
  if (agentCodename) {
    const delegated = await tryDelegateToSpecialist(step, enrichedContext, agentCodename);
    if (delegated) {
      result = delegated.result;
      success = true;
      executedBy = delegated.executedBy;
    }
  }

  // Local execution fallback.
  if (!success) {
    try {
      result = await localExecutor(step, enrichedContext);
      success = true;
      executedBy = 'local';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Local execution failed';
      result = `Error: ${error}`;
      success = false;
    }
  }

  // Write result to State Bus for downstream steps.
  if (success) {
    await writeStepContext(runId, step.id, result);
  }

  return {
    stepId: step.id,
    title: step.title,
    success,
    result,
    durationMs: Date.now() - start,
    executedBy,
    ...(error ? { error } : {}),
  };
}

// ─── Main orchestrator ───────────────────────────────────────────────

export interface ExecutePlanParallelOpts {
  goal: string;
  plan: StructuredPlan;
  agentCodename?: string;       // optional specialist agent for delegation
  maxParallel?: number;         // default 4
  localExecutor?: LocalExecutor; // default = chat()-based
}

/**
 * Execute a structured plan with parallel step execution where possible.
 */
export async function executePlanParallel(
  opts: ExecutePlanParallelOpts,
): Promise<OrchestrationResult> {
  const runId = `orch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const maxParallel = opts.maxParallel ?? 4;
  const localExecutor = opts.localExecutor ?? defaultLocalExecutor;
  const allOutcomes: StepOutcome[] = [];
  const start = Date.now();

  // Build execution batches (topological sort).
  const batches = buildExecutionBatches(opts.plan.steps);

  // Track accumulated context as a summary string.
  let contextSummary = '';

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];

    // Split the batch into parallelizable + serial sub-batches.
    const parallelBatch = batch.filter((s) => s.parallelizable !== false);
    const serialBatch = batch.filter((s) => s.parallelizable === false);

    // Execute parallelizable steps (capped at maxParallel concurrent).
    const parallelOutcomes: StepOutcome[] = [];
    for (let i = 0; i < parallelBatch.length; i += maxParallel) {
      const slice = parallelBatch.slice(i, i + maxParallel);
      const settled = await Promise.allSettled(
        slice.map((step) => executeStep(step, contextSummary, runId, localExecutor, opts.agentCodename)),
      );
      for (let j = 0; j < settled.length; j++) {
        const s = settled[j];
        if (s.status === 'fulfilled') {
          parallelOutcomes.push(s.value);
        } else {
          parallelOutcomes.push({
            stepId: slice[j].id,
            title: slice[j].title,
            success: false,
            result: `Unhandled error: ${s.reason instanceof Error ? s.reason.message : 'unknown'}`,
            durationMs: 0,
            executedBy: 'local',
            error: s.reason instanceof Error ? s.reason.message : String(s.reason),
          });
        }
      }
    }

    // Execute serial steps one at a time.
    const serialOutcomes: StepOutcome[] = [];
    for (const step of serialBatch) {
      try {
        const outcome = await executeStep(step, contextSummary, runId, localExecutor, opts.agentCodename);
        serialOutcomes.push(outcome);
      } catch (err) {
        serialOutcomes.push({
          stepId: step.id,
          title: step.title,
          success: false,
          result: `Error: ${err instanceof Error ? err.message : String(err)}`,
          durationMs: 0,
          executedBy: 'local',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Merge outcomes in original step order.
    const batchOutcomes = [...parallelOutcomes, ...serialOutcomes];
    allOutcomes.push(...batchOutcomes);

    // Update the context summary for the next batch.
    contextSummary += batchOutcomes
      .map((o) => `### ${o.title} (${o.stepId}): ${o.success ? '✓' : '✗'}\n${o.result.slice(0, 200)}`)
      .join('\n\n');
  }

  const successCount = allOutcomes.filter((o) => o.success).length;
  const failureCount = allOutcomes.length - successCount;

  return {
    planGoal: opts.goal,
    steps: allOutcomes,
    successCount,
    failureCount,
    totalDurationMs: Date.now() - start,
    contextSummary,
    parallelBatches: batches.length,
    batches,
  };
}

/**
 * Simple sequential executor — for plans that don't need parallelism.
 * Same shape as executePlanParallel but with all steps forced serial.
 */
export async function executePlanSequential(
  opts: ExecutePlanParallelOpts,
): Promise<OrchestrationResult> {
  const sequentialPlan: StructuredPlan = {
    ...opts.plan,
    steps: opts.plan.steps.map((s) => ({ ...s, parallelizable: false })),
  };
  return executePlanParallel({ ...opts, plan: sequentialPlan });
}
