// =====================================================================
// task-decomposer.ts — Break complex tasks into sub-tasks.
// =====================================================================
// Adapted for v10. Asks GLM-4.6 to decompose a complex task into 1-7
// sub-tasks with dependency edges, then validates / simplifies the plan
// against a hard cap of 20 total estimated iterations.
//
// Flow:
//   1. Build a system prompt asking the LLM to emit JSON:
//        { "reasoning": "...", "subtasks": [ { id, description, tool,
//          depends_on, estimated_iterations }, ... ] }
//   2. Call `chat()` from src/lib/llm.ts.
//   3. Parse the response with fallback strategies
//      (full JSON → markdown fence → balanced-brace scan).
//   4. Validate / normalize:
//        • Assign sequential IDs s1, s2, ... if missing.
//        • Strip dependency edges that point to non-existent IDs.
//        • Cap each sub-task's estimated_iterations to [1, 10].
//        • If estimatedTotalIterations > 20, drop trailing sub-tasks
//          until the sum fits (preserves the highest-priority prefix).
//        • If decomposition fails entirely, fall back to a single
//          sub-task wrapping the original task.
//
// Design rules:
//   • Never throws — returns a valid `TaskPlan` on any failure.
//   • All exports have explicit TypeScript types.
// =====================================================================

import { chat, type ChatTurn, extractJson } from './llm';

// ─── Public types ────────────────────────────────────────────────────

export interface SubTask {
  id: string;
  description: string;
  tool?: string; // suggested tool to use
  dependsOn: string[];
  estimatedIterations: number;
}

export interface TaskPlan {
  subtasks: SubTask[];
  reasoning: string;
  estimatedTotalIterations: number;
}

const MAX_SUBTASKS = 7;
const MIN_SUBTASKS = 1;
const MAX_ITERATIONS_TOTAL = 20;
const MAX_PER_SUBTASK = 10;
const MIN_PER_SUBTASK = 1;

// ─── System prompt ───────────────────────────────────────────────────

const DECOMPOSER_SYSTEM_PROMPT = `You are a task planner for an autonomous AI agent. Break the user's task into 1-7 sub-tasks that the agent can execute sequentially using tools.

Respond with EXACTLY ONE JSON object — no prose, no markdown fences. Shape:

{
  "reasoning": "Brief explanation of why you chose this decomposition.",
  "subtasks": [
    {
      "id": "s1",
      "description": "What to do in this sub-task (concrete, actionable).",
      "tool": "optional — name of a tool the agent should consider using",
      "depends_on": [],
      "estimated_iterations": 2
    },
    {
      "id": "s2",
      "description": "...",
      "tool": "...",
      "depends_on": ["s1"],
      "estimated_iterations": 3
    }
  ]
}

Rules:
- 1 to 7 sub-tasks only.
- IDs MUST be "s1", "s2", "s3", ... in execution order.
- depends_on is a list of earlier sub-task IDs that MUST complete before this one starts. Empty list = no dependencies.
- estimated_iterations is a positive integer (1-10) — how many agent-loop iterations this sub-task will likely need.
- Total estimated_iterations across all sub-tasks MUST be at most 20.
- If the task is simple (one tool call + final answer), return ONE sub-task with estimated_iterations=1 or 2.
- Prefer fewer, well-scoped sub-tasks over many tiny ones.
- The "tool" field is optional — omit it if no specific tool is suggested.`;

// ─── Validation / normalization ──────────────────────────────────────

interface RawSubTask {
  id?: unknown;
  description?: unknown;
  tool?: unknown;
  depends_on?: unknown;
  dependsOn?: unknown;
  estimated_iterations?: unknown;
  estimatedIterations?: unknown;
}

interface RawPlan {
  reasoning?: unknown;
  subtasks?: unknown;
}

function isStr(x: unknown): x is string {
  return typeof x === 'string';
}

function isPosInt(x: unknown): x is number {
  return typeof x === 'number' && isFinite(x) && x >= 1;
}

function normalizeSubtasks(raw: RawPlan): SubTask[] {
  if (!raw || !Array.isArray(raw.subtasks) || raw.subtasks.length === 0) return [];

  const seen = new Set<string>();
  const out: SubTask[] = [];
  let n = 0;
  for (const item of raw.subtasks) {
    if (n >= MAX_SUBTASKS) break;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const r = item as RawSubTask;
    if (!isStr(r.description) || r.description.trim().length === 0) continue;
    n++;
    const fallbackId = `s${n}`;
    let id = isStr(r.id) && r.id.length > 0 ? r.id : fallbackId;
    if (seen.has(id)) id = fallbackId;
    if (seen.has(id)) continue;
    seen.add(id);
    const estRaw = r.estimated_iterations ?? r.estimatedIterations;
    const est = isPosInt(estRaw)
      ? Math.min(MAX_PER_SUBTASK, Math.max(MIN_PER_SUBTASK, Math.floor(estRaw as number)))
      : 2;
    const tool = isStr(r.tool) && r.tool.length > 0 ? r.tool : undefined;
    out.push({
      id,
      description: r.description,
      ...(tool ? { tool } : {}),
      dependsOn: [], // filled in second pass after all IDs are known
      estimatedIterations: est,
    });
  }
  if (out.length === 0) return [];

  // Second pass: resolve depends_on against the known ID set.
  for (let i = 0; i < raw.subtasks.length && i < out.length; i++) {
    const r = raw.subtasks[i] as RawSubTask;
    const rawDeps = r.depends_on ?? r.dependsOn;
    if (!Array.isArray(rawDeps)) continue;
    const validIds = new Set(out.map((s) => s.id));
    const deps: string[] = [];
    for (const d of rawDeps) {
      if (isStr(d) && validIds.has(d) && d !== out[i].id) {
        if (!deps.includes(d)) deps.push(d);
      }
    }
    out[i].dependsOn = deps;
  }

  return out;
}

/**
 * If the plan's total estimated iterations exceed MAX_ITERATIONS_TOTAL,
 * drop trailing sub-tasks until the sum fits. If even the first sub-task
 * exceeds the cap, clamp its estimate. Preserves the highest-priority
 * prefix of the plan.
 */
function fitToCap(subtasks: SubTask[]): SubTask[] {
  if (subtasks.length === 0) return subtasks;
  let sum = subtasks.reduce((a, s) => a + s.estimatedIterations, 0);
  if (sum <= MAX_ITERATIONS_TOTAL) return subtasks;

  const out = subtasks.slice();
  while (out.length > 1 && sum > MAX_ITERATIONS_TOTAL) {
    const dropped = out.pop()!;
    sum -= dropped.estimatedIterations;
  }
  if (out.length === 1 && out[0].estimatedIterations > MAX_ITERATIONS_TOTAL) {
    out[0].estimatedIterations = MAX_ITERATIONS_TOTAL;
    sum = MAX_ITERATIONS_TOTAL;
  }
  const validIds = new Set(out.map((s) => s.id));
  for (const s of out) {
    s.dependsOn = s.dependsOn.filter((d) => validIds.has(d));
  }
  return out;
}

// ─── Fallback plan ───────────────────────────────────────────────────

function fallbackPlan(task: string, reason: string): TaskPlan {
  return {
    subtasks: [
      {
        id: 's1',
        description: task,
        dependsOn: [],
        estimatedIterations: 5,
      },
    ],
    reasoning: `Decomposition failed (${reason}); falling back to running the original task as a single sub-task.`,
    estimatedTotalIterations: 5,
  };
}

// ─── Public entry point ──────────────────────────────────────────────

/**
 * Decompose a complex task into 1-7 sub-tasks. Uses the LLM to propose
 * a plan, then validates / simplifies it. Always returns a usable
 * `TaskPlan` — falls back to a single sub-task wrapping the original
 * task if the LLM call fails or the response can't be parsed.
 */
export async function decomposeTask(task: string, _model?: string): Promise<TaskPlan> {
  if (typeof task !== 'string' || task.trim().length === 0) {
    return fallbackPlan('', 'empty task');
  }

  const history: ChatTurn[] = [];
  let raw = '';
  try {
    const result = await chat(task, history, DECOMPOSER_SYSTEM_PROMPT);
    raw = result.content;
  } catch (err) {
    return fallbackPlan(task, `LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const parsed = extractJson<RawPlan>(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fallbackPlan(task, 'could not parse LLM response as JSON');
  }

  const subtasks = normalizeSubtasks(parsed);
  if (subtasks.length < MIN_SUBTASKS) {
    return fallbackPlan(task, 'no well-formed sub-tasks in LLM response');
  }

  const fitted = fitToCap(subtasks);
  const reasoning = isStr(parsed.reasoning)
    ? parsed.reasoning
    : 'No reasoning provided by the LLM.';
  const estimatedTotalIterations = fitted.reduce((a, s) => a + s.estimatedIterations, 0);

  return {
    subtasks: fitted,
    reasoning,
    estimatedTotalIterations,
  };
}
