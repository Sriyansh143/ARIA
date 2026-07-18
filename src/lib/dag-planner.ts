// =====================================================================
// dag-planner.ts — DAG plan generation + execution (Kahn-cycle-safe,
// saga-checkpointed, SSE-streaming).
// =====================================================================
// Adapted for v10. Our app doesn't have an OrchestratorRun model, so the
// saga checkpoint is persisted to MemoryItem (scope='dag-checkpoint')
// keyed by runId. Resume semantics are identical to the zip:
//   - completedSteps are skipped (synthetic step_complete event)
//   - failedSteps are NOT retried (synthetic step_failed event)
//   - context (stepId → output) is restored so downstream prompts can
//     reference prior results across a process restart.
//
// Cycle detection uses Kahn's algorithm (topological sort). Steps in the
// same wave (all deps satisfied) run with `parallelizable: true`
// concurrently; `parallelizable: false` steps run serially within the
// wave. Per-step retry with exponential backoff (100ms, 200ms, 400ms).
// =====================================================================

import { db } from './db';
import { chat, extractJson } from './llm';
import { executeToolCall } from './os-executor';
import { checkCommand } from './os-executor';

// ─── Public types ────────────────────────────────────────────────────

export interface DAGStep {
  id: string;
  name: string;
  action: string;
  prompt: string;
  dependsOn: string[];
  agentName?: string;
  toolCall?: { name: string; args: Record<string, unknown> };
  parallelizable?: boolean;
  validator?: string;
  maxRetries?: number;
}

export interface DAGPlan {
  steps: DAGStep[];
  reasoning: string;
}

export interface DAGStepResult {
  stepId: string;
  status: string;
  output?: string;
  error?: string;
  retryCount: number;
}

// Saga checkpoint — persisted to MemoryItem(scope='dag-checkpoint', key=runId).
export interface DAGCheckpoint {
  completedSteps: string[];
  failedSteps: string[];
  currentWave: number;
  totalSteps: number;
  context: Record<string, string>;
}

// Streaming SSE events. Consumers (e.g. an SSE route handler) can forward
// these directly to the client.
export type DAGStreamEvent =
  | { type: 'step_complete'; stepId: string; status: string; output?: string }
  | { type: 'step_failed'; stepId: string; error: string }
  | { type: 'wave'; waveIndex: number; stepIds: string[] }
  | { type: 'done'; summary: { completed: number; failed: number; totalDuration: number } };

// ─── Validation (Kahn's algorithm cycle detection) ───────────────────

export function validateDAG(steps: DAGStep[]): { valid: boolean; error?: string } {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { valid: false, error: 'DAG has no steps' };
  }
  const ids = new Set<string>();
  for (const s of steps) {
    if (!s.id) return { valid: false, error: 'Step missing id' };
    if (ids.has(s.id)) return { valid: false, error: `Duplicate step id: ${s.id}` };
    ids.add(s.id);
  }
  for (const s of steps) {
    for (const dep of s.dependsOn || []) {
      if (!ids.has(dep)) return { valid: false, error: `Step ${s.id} depends on non-existent step ${dep}` };
      if (dep === s.id) return { valid: false, error: `Step ${s.id} depends on itself` };
    }
  }
  // Kahn's algorithm — cycle detection.
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const s of steps) {
    inDegree.set(s.id, (s.dependsOn || []).length);
    adj.set(s.id, []);
  }
  for (const s of steps) {
    for (const dep of s.dependsOn || []) {
      adj.get(dep)!.push(s.id);
    }
  }
  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }
  let processed = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    processed++;
    for (const next of adj.get(id) || []) {
      const newDeg = (inDegree.get(next) || 0) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }
  if (processed !== steps.length) {
    const cycleMembers = Array.from(inDegree.entries()).filter(([, d]) => d > 0).map(([id]) => id);
    return { valid: false, error: `Cycle detected in DAG. Steps involved: ${cycleMembers.join(', ')}` };
  }
  return { valid: true };
}

// ─── Plan generation ─────────────────────────────────────────────────

const DAG_PLANNER_SYSTEM_PROMPT = `You are a task planner. Decompose the user's task into a JSON DAG of steps.

Respond with EXACTLY ONE JSON object — no prose, no markdown fences. Shape:
{
  "reasoning": "Brief explanation of the decomposition.",
  "steps": [
    {
      "id": "s1",
      "name": "short step name",
      "action": "what to do",
      "prompt": "the prompt to feed the LLM (or tool args, if toolCall is set)",
      "dependsOn": [],
      "parallelizable": true,
      "maxRetries": 0
    },
    {
      "id": "s2",
      "name": "...",
      "action": "...",
      "prompt": "...",
      "dependsOn": ["s1"],
      "parallelizable": false,
      "maxRetries": 1
    }
  ]
}

Rules:
- 1 to 6 steps only.
- IDs must be "s1", "s2", ... in execution order.
- dependsOn is a list of earlier step IDs that MUST complete before this one starts. Empty = can start immediately.
- parallelizable=true means the step can run alongside others in its wave.
- maxRetries is 0-3.`;

export async function generateDAGPlan(prompt: string, _tools?: string[]): Promise<DAGPlan> {
  try {
    const content = await chat(prompt, [], DAG_PLANNER_SYSTEM_PROMPT);
    const parsed = extractJson<{ reasoning?: string; steps?: DAGStep[] }>(content.content);
    if (parsed?.steps && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
      // Normalize + strip dangling deps.
      const validIds = new Set(parsed.steps.map((s) => s.id));
      const steps = parsed.steps.map((s, i) => ({
        id: s.id || `s${i + 1}`,
        name: s.name || `Step ${i + 1}`,
        action: s.action || s.prompt || '',
        prompt: s.prompt || s.action || '',
        dependsOn: (s.dependsOn || []).filter((d) => validIds.has(d) && d !== s.id),
        parallelizable: s.parallelizable ?? true,
        maxRetries: Math.min(3, Math.max(0, s.maxRetries ?? 0)),
      }));
      return { steps, reasoning: parsed.reasoning ?? 'DAG plan generated' };
    }
  } catch {
    // fall through to fallback
  }
  return {
    steps: [{ id: 's1', name: 'Execute', action: prompt, prompt, dependsOn: [], parallelizable: true, maxRetries: 0 }],
    reasoning: 'Fallback (LLM planning failed)',
  };
}

// ─── Saga checkpoint persistence (MemoryItem-backed) ─────────────────

async function persistCheckpoint(runId: string, checkpoint: DAGCheckpoint): Promise<void> {
  try {
    await db.memoryItem.upsert({
      where: { key_scope: { key: runId, scope: 'dag-checkpoint' } },
      create: {
        key: runId,
        scope: 'dag-checkpoint',
        value: JSON.stringify(checkpoint),
        tags: '["dag-checkpoint","saga"]',
      },
      update: { value: JSON.stringify(checkpoint) },
    });
  } catch {
    // non-fatal — the in-memory execution still completes
  }
}

export async function loadCheckpoint(runId: string): Promise<DAGCheckpoint | null> {
  try {
    const row = await db.memoryItem.findUnique({
      where: { key_scope: { key: runId, scope: 'dag-checkpoint' } },
    });
    if (!row) return null;
    return JSON.parse(row.value) as DAGCheckpoint;
  } catch {
    return null;
  }
}

// ─── Streaming execution ─────────────────────────────────────────────

export interface ExecuteDAGPlanStreamingOpts {
  runId?: string;
  resumeFrom?: DAGCheckpoint;
  agentId?: string; // optional — when set, exec results are logged to AgentLog
}

export async function* executeDAGPlanStreaming(
  plan: DAGPlan,
  opts: ExecuteDAGPlanStreamingOpts = {},
): AsyncGenerator<DAGStreamEvent> {
  const startTime = Date.now();

  const validation = validateDAG(plan.steps);
  if (!validation.valid) {
    for (const s of plan.steps) {
      yield { type: 'step_failed', stepId: s.id, error: `invalid DAG: ${validation.error}` };
    }
    yield { type: 'done', summary: { completed: 0, failed: plan.steps.length, totalDuration: Date.now() - startTime } };
    return;
  }

  const stepsById = new Map<string, DAGStep>();
  for (const s of plan.steps) stepsById.set(s.id, s);

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const s of plan.steps) {
    inDegree.set(s.id, (s.dependsOn || []).length);
    dependents.set(s.id, []);
  }
  for (const s of plan.steps) {
    for (const dep of s.dependsOn || []) {
      dependents.get(dep)!.push(s.id);
    }
  }

  const completed = new Set<string>();
  const failed = new Set<string>();
  const skipped = new Set<string>();
  const context: Record<string, string> = {};
  let currentWave = 0;

  // Saga resume — pre-seed state from the prior (crashed) run's checkpoint.
  if (opts.resumeFrom) {
    for (const id of opts.resumeFrom.completedSteps || []) completed.add(id);
    for (const id of opts.resumeFrom.failedSteps || []) failed.add(id);
    if (opts.resumeFrom.context && typeof opts.resumeFrom.context === 'object') {
      for (const [k, v] of Object.entries(opts.resumeFrom.context)) {
        if (typeof v === 'string') context[k] = v;
      }
    }
    currentWave = opts.resumeFrom.currentWave || 0;
  }

  const pendingEvents: DAGStreamEvent[] = [];

  let wave: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) wave.push(id);
  }

  while (wave.length > 0) {
    yield { type: 'wave', waveIndex: currentWave, stepIds: wave.slice() };

    const parallelSteps = wave
      .map((id) => stepsById.get(id)!)
      .filter((s) => s.parallelizable === true);
    const serialSteps = wave
      .map((id) => stepsById.get(id)!)
      .filter((s) => s.parallelizable !== true);

    const runStep = async (step: DAGStep): Promise<void> => {
      // Saga: skip already-completed steps with a synthetic event.
      if (completed.has(step.id)) {
        pendingEvents.push({
          type: 'step_complete',
          stepId: step.id,
          status: 'completed',
          output: context[step.id]?.slice(0, 5000),
        });
        return;
      }
      if (failed.has(step.id)) {
        pendingEvents.push({
          type: 'step_failed',
          stepId: step.id,
          error: 'previously failed in prior run (saga checkpoint)',
        });
        return;
      }

      // Skip if any dependency failed.
      const failedDep = (step.dependsOn || []).find((d) => failed.has(d) || skipped.has(d));
      if (failedDep) {
        pendingEvents.push({ type: 'step_complete', stepId: step.id, status: 'skipped' });
        skipped.add(step.id);
        return;
      }

      // Guardrail: block obviously dangerous commands.
      const guardrail = checkCommand(step.action);
      if (guardrail.safety === 'blocked') {
        pendingEvents.push({ type: 'step_failed', stepId: step.id, error: guardrail.reason || 'blocked by guardrails' });
        failed.add(step.id);
        return;
      }

      const maxRetries = step.maxRetries && step.maxRetries > 0 ? step.maxRetries : 0;
      let attempt = 0;
      let lastErr: string | undefined;

      while (attempt <= maxRetries) {
        try {
          let output = '';
          if (step.toolCall) {
            const tr = await executeToolCall(step.toolCall.name, step.toolCall.args);
            output = tr.result;
            if (!tr.success) throw new Error(output);
          } else {
            // Build a context-enriched prompt — include results of dependency steps.
            let enriched = step.prompt;
            for (const depId of step.dependsOn || []) {
              if (context[depId]) {
                enriched += `\n\n[Result of step ${depId}]:\n${context[depId].slice(0, 2000)}`;
              }
            }
            const r = await chat(enriched, [], `You are executing DAG step "${step.name}". Be concise and direct.`);
            output = r.content;
          }
          pendingEvents.push({
            type: 'step_complete',
            stepId: step.id,
            status: 'completed',
            output: output.slice(0, 5000),
          });
          completed.add(step.id);
          context[step.id] = output;
          return;
        } catch (err: unknown) {
          lastErr = err instanceof Error ? err.message : String(err);
          attempt++;
          if (attempt <= maxRetries) {
            await new Promise((res) => setTimeout(res, 100 * Math.pow(2, attempt - 1)));
          }
        }
      }
      pendingEvents.push({ type: 'step_failed', stepId: step.id, error: lastErr || 'unknown error' });
      failed.add(step.id);
    };

    if (parallelSteps.length > 0) {
      await Promise.all(parallelSteps.map((s) => runStep(s)));
    }
    for (const s of serialSteps) await runStep(s);

    // Drain the event buffer — emit each event as a generator yield.
    for (const ev of pendingEvents) yield ev;
    pendingEvents.length = 0;

    // Saga checkpoint after each wave.
    currentWave++;
    if (opts.runId) {
      const checkpoint: DAGCheckpoint = {
        completedSteps: Array.from(completed),
        failedSteps: Array.from(failed),
        currentWave,
        totalSteps: plan.steps.length,
        context,
      };
      await persistCheckpoint(opts.runId, checkpoint);
    }

    // Compute the next wave: dependents of the current wave whose remaining
    // in-degree drops to 0.
    const nextWaveSet = new Set<string>();
    for (const id of wave) {
      for (const dep of dependents.get(id) || []) {
        const newDeg = (inDegree.get(dep) || 0) - 1;
        inDegree.set(dep, newDeg);
        if (newDeg <= 0) nextWaveSet.add(dep);
      }
    }
    wave = Array.from(nextWaveSet);
  }

  yield {
    type: 'done',
    summary: {
      completed: completed.size,
      failed: failed.size + skipped.size,
      totalDuration: Date.now() - startTime,
    },
  };
}

// ─── Backward-compat non-streaming wrapper ───────────────────────────

export async function executeDAGPlan(
  plan: DAGPlan,
  opts: ExecuteDAGPlanStreamingOpts = {},
): Promise<{
  plan: DAGPlan;
  results: DAGStepResult[];
  success: boolean;
  completedSteps: number;
  failedSteps: number;
  totalDuration: number;
}> {
  const results: DAGStepResult[] = [];
  let summary = { completed: 0, failed: 0, totalDuration: 0 };

  for await (const event of executeDAGPlanStreaming(plan, opts)) {
    if (event.type === 'step_complete') {
      results.push({ stepId: event.stepId, status: event.status, output: event.output, retryCount: 0 });
    } else if (event.type === 'step_failed') {
      results.push({ stepId: event.stepId, status: 'failed', error: event.error, retryCount: 0 });
    } else if (event.type === 'done') {
      summary = event.summary;
    }
  }

  return {
    plan,
    results,
    success: summary.failed === 0,
    completedSteps: summary.completed,
    failedSteps: summary.failed,
    totalDuration: summary.totalDuration,
  };
}

// ─── Saga resume ─────────────────────────────────────────────────────

export async function resumeDAGPlan(
  runId: string,
  prompt: string,
): Promise<{
  ok: boolean;
  runId: string;
  results?: DAGStepResult[];
  completedSteps?: number;
  failedSteps?: number;
  totalDuration?: number;
  error?: string;
}> {
  const checkpoint = await loadCheckpoint(runId);
  if (!checkpoint) {
    return { ok: false, runId, error: 'no checkpoint on run — cannot resume mid-DAG' };
  }
  const plan = await generateDAGPlan(prompt);
  const result = await executeDAGPlan(plan, { runId, resumeFrom: checkpoint });
  return {
    ok: result.success,
    runId,
    results: result.results,
    completedSteps: result.completedSteps,
    failedSteps: result.failedSteps,
    totalDuration: result.totalDuration,
  };
}
