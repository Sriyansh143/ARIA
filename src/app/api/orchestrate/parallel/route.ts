import { NextRequest, NextResponse } from 'next/server';
import { decomposeTask } from '@/lib/task-decomposer';
import { generateDAGPlan, validateDAG, executeDAGPlanStreaming } from '@/lib/dag-planner';
import {
  executePlanParallel,
  planFromTaskPlan,
  type StructuredPlan,
  type PlanStep,
  type StepOutcome,
} from '@/lib/parallel-orchestrator';
import { stateBus } from '@/lib/state-bus';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface DecomposedPlan {
  goal: string;
  reasoning: string;
  estimatedTotalIterations: number;
  steps: PlanStep[];
  source: 'task-decomposer' | 'dag-planner';
}

interface TraceEntry {
  step: string;
  status: 'success' | 'error' | 'skipped';
  detail: string;
  latencyMs: number;
}

/**
 * POST /api/orchestrate/parallel
 *
 * Body: { goal: string, agentCodename?: string, maxParallel?: number,
 *         useDagPlanner?: boolean }
 *
 * Response: { plan, trace, results }
 *
 * Flow:
 *   1. Decompose the goal into sub-tasks via the task-decomposer (LLM).
 *      If `useDagPlanner` is true, use the dag-planner instead (which
 *      produces a richer DAG with parallelizable/maxRetries flags).
 *   2. Build a StructuredPlan from the decomposition.
 *   3. Validate the plan's DAG (Kahn's cycle detection).
 *   4. Execute the plan via the parallel-orchestrator (state-bus-backed
 *      blackboard + topological batches + Promise.allSettled).
 *   5. Return the plan + per-step outcomes + a trace.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { goal, agentCodename, maxParallel, useDagPlanner } = body as {
    goal?: string;
    agentCodename?: string;
    maxParallel?: number;
    useDagPlanner?: boolean;
  };

  if (!goal || !goal.trim()) {
    return NextResponse.json({ error: 'goal required' }, { status: 400 });
  }

  const trace: TraceEntry[] = [];
  const start = Date.now();
  const runId = `parallel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Optional: validate agent exists.
  let agentId: string | undefined;
  if (agentCodename) {
    const agent = await db.agent
      .findFirst({ where: { codename: String(agentCodename).toUpperCase() } })
      .catch(() => null);
    if (agent) agentId = agent.id;
  }

  // ─── Step 1: Decompose ───────────────────────────────────────────
  const t1 = Date.now();
  let plan: DecomposedPlan;
  try {
    if (useDagPlanner) {
      const dagPlan = await generateDAGPlan(goal);
      const validIds = new Set(dagPlan.steps.map((s) => s.id));
      plan = {
        goal,
        reasoning: dagPlan.reasoning,
        estimatedTotalIterations: dagPlan.steps.reduce((a, s) => a + (s.maxRetries ?? 0) + 1, 0),
        steps: dagPlan.steps.map((s) => ({
          id: s.id,
          title: s.name,
          description: s.action,
          ...(s.prompt ? { prompt: s.prompt } : {}),
          dependsOn: (s.dependsOn || []).filter((d) => validIds.has(d) && d !== s.id),
          parallelizable: s.parallelizable ?? true,
          estimatedIterations: (s.maxRetries ?? 0) + 1,
        })),
        source: 'dag-planner',
      };
    } else {
      const tp = await decomposeTask(goal);
      plan = {
        goal,
        reasoning: tp.reasoning,
        estimatedTotalIterations: tp.estimatedTotalIterations,
        steps: tp.subtasks.map((s) => ({
          id: s.id,
          title: s.description.slice(0, 80),
          description: s.description,
          dependsOn: s.dependsOn,
          ...(s.tool ? { tool: s.tool } : {}),
          parallelizable: true,
          estimatedIterations: s.estimatedIterations,
        })),
        source: 'task-decomposer',
      };
    }
    trace.push({
      step: 'decompose',
      status: 'success',
      detail: `${plan.source} → ${plan.steps.length} sub-tasks (est. ${plan.estimatedTotalIterations} iters)`,
      latencyMs: Date.now() - t1,
    });
  } catch (e) {
    trace.push({
      step: 'decompose',
      status: 'error',
      detail: e instanceof Error ? e.message : 'decomposition failed',
      latencyMs: Date.now() - t1,
    });
    return NextResponse.json(
      { error: 'decomposition failed', trace },
      { status: 500 },
    );
  }

  // ─── Step 2: Validate DAG (Kahn cycle detection) ─────────────────
  const t2 = Date.now();
  const validation = validateDAG(plan.steps.map((s) => ({
    id: s.id,
    name: s.title,
    action: s.description,
    prompt: s.prompt ?? s.description,
    dependsOn: s.dependsOn,
  })));
  if (!validation.valid) {
    trace.push({
      step: 'validate-dag',
      status: 'error',
      detail: validation.error ?? 'invalid DAG',
      latencyMs: Date.now() - t2,
    });
    return NextResponse.json(
      { error: `invalid DAG: ${validation.error}`, plan, trace },
      { status: 400 },
    );
  }
  trace.push({
    step: 'validate-dag',
    status: 'success',
    detail: validation.valid ? 'DAG is acyclic' : 'invalid',
    latencyMs: Date.now() - t2,
  });

  // ─── Step 3: Execute via parallel-orchestrator ───────────────────
  const t3 = Date.now();
  const structuredPlan: StructuredPlan = {
    goal: plan.goal,
    reasoning: plan.reasoning,
    steps: plan.steps,
  };

  let results: StepOutcome[] = [];
  let orchestrationMeta: {
    successCount: number;
    failureCount: number;
    totalDurationMs: number;
    parallelBatches: number;
    batches: PlanStep[][];
    contextSummary: string;
  };

  try {
    // Use the dag-planner's streaming executor for richer SSE events
    // when maxParallel is 1 (sequential mode), otherwise use the
    // parallel-orchestrator. This gives consumers a choice.
    if (useDagPlanner) {
      // Use dag-planner streaming — collect events.
      const dagPlan = {
        steps: plan.steps.map((s) => ({
          id: s.id,
          name: s.title,
          action: s.description,
          prompt: s.prompt ?? s.description,
          dependsOn: s.dependsOn,
          parallelizable: s.parallelizable ?? true,
          maxRetries: 0,
        })),
        reasoning: plan.reasoning,
      };
      const streamEvents: Array<{ type: string; stepId?: string; status?: string; output?: string; error?: string }> = [];
      for await (const ev of executeDAGPlanStreaming(dagPlan, { runId, agentId })) {
        streamEvents.push(ev as { type: string; stepId?: string; status?: string; output?: string; error?: string });
      }
      // Convert events → StepOutcome[].
      results = streamEvents
        .filter((ev) => ev.type === 'step_complete' || ev.type === 'step_failed')
        .map((ev) => {
          const step = plan.steps.find((s) => s.id === ev.stepId);
          const success = ev.type === 'step_complete' && ev.status === 'completed';
          return {
            stepId: ev.stepId ?? '',
            title: step?.title ?? ev.stepId ?? '',
            success,
            result: ev.output ?? ev.error ?? '',
            durationMs: 0,
            executedBy: 'local',
            ...(success ? {} : { error: ev.error }),
          } as StepOutcome;
        });
      orchestrationMeta = {
        successCount: results.filter((r) => r.success).length,
        failureCount: results.filter((r) => !r.success).length,
        totalDurationMs: Date.now() - t3,
        parallelBatches: streamEvents.filter((ev) => ev.type === 'wave').length,
        batches: [],
        contextSummary: results.map((r) => `### ${r.title} (${r.stepId}): ${r.success ? '✓' : '✗'}\n${r.result.slice(0, 200)}`).join('\n\n'),
      };
    } else {
      const orch = await executePlanParallel({
        goal: plan.goal,
        plan: structuredPlan,
        agentCodename: agentCodename ? String(agentCodename).toUpperCase() : undefined,
        maxParallel: maxParallel ?? 4,
      });
      results = orch.steps;
      orchestrationMeta = {
        successCount: orch.successCount,
        failureCount: orch.failureCount,
        totalDurationMs: orch.totalDurationMs,
        parallelBatches: orch.parallelBatches,
        batches: orch.batches,
        contextSummary: orch.contextSummary,
      };
    }
    trace.push({
      step: 'execute',
      status: orchestrationMeta.failureCount === 0 ? 'success' : 'error',
      detail: `${orchestrationMeta.successCount}/${results.length} steps succeeded across ${orchestrationMeta.parallelBatches} batches`,
      latencyMs: Date.now() - t3,
    });
  } catch (e) {
    trace.push({
      step: 'execute',
      status: 'error',
      detail: e instanceof Error ? e.message : 'execution failed',
      latencyMs: Date.now() - t3,
    });
    return NextResponse.json(
      { error: 'execution failed', plan, trace },
      { status: 500 },
    );
  }

  // ─── Step 4: Persist run summary (best-effort) ───────────────────
  try {
    await db.memoryItem.create({
      data: {
        scope: 'episodic',
        key: `parallel-orchestration-${runId}`,
        value: JSON.stringify({
          runId,
          goal,
          agentCodename: agentCodename ?? null,
          plan,
          results: results.map((r) => ({
            stepId: r.stepId,
            title: r.title,
            success: r.success,
            executedBy: r.executedBy,
            durationMs: r.durationMs,
            resultPreview: r.result.slice(0, 500),
          })),
          orchestrationMeta,
          trace,
          totalDurationMs: Date.now() - start,
        }),
        tags: JSON.stringify(['parallel-orchestration', 'autonomy']),
      },
    });
  } catch {
    // best-effort — non-fatal
  }

  // ─── Step 5: Notification ─────────────────────────────────────────
  try {
    await db.notification.create({
      data: {
        type: orchestrationMeta.failureCount === 0 ? 'success' : 'warn',
        title: 'Parallel Orchestration Complete',
        message: `Goal: "${goal.slice(0, 60)}…" → ${orchestrationMeta.successCount}/${results.length} steps succeeded in ${orchestrationMeta.parallelBatches} batches (${((Date.now() - start) / 1000).toFixed(1)}s)`,
        read: false,
      },
    });
  } catch {
    // best-effort
  }

  // ─── Step 6: Cleanup the state-bus context for this run ──────────
  try {
    const entries = await stateBus.list(`orchestration:context:${runId}:`);
    for (const e of entries) {
      await stateBus.delete(e.key);
    }
  } catch {
    // best-effort
  }

  return NextResponse.json({
    runId,
    plan,
    trace,
    results,
    orchestration: orchestrationMeta,
    totalDurationMs: Date.now() - start,
  });
}

/**
 * GET /api/orchestrate/parallel — returns a small descriptor for clients
 * probing the endpoint. Useful for the AutonomyTab toggle to verify the
 * API is reachable before showing the "Parallel Orchestrator" mode.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    mode: 'parallel-orchestrator',
    description: 'POST { goal, agentCodename?, maxParallel?, useDagPlanner? } → { plan, trace, results }',
  });
}
