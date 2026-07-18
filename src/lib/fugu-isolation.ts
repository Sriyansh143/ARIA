// =====================================================================
// fugu-isolation.ts — Context isolation for hierarchical orchestration.
// =====================================================================
// Phase 17 / Dimension 3 (Sakana Fugu adaptation) — adapted for v10.
//
// Problem: passing the FULL result text of every dependency sub-task as
// context to downstream sub-agents causes:
//   - context bloat (5K-token results pile up)
//   - "orchestration collapse" — sub-agents parrot each other
//   - loss of focus on the atomic sub-task
//
// Solution: each sub-agent sees ONLY:
//   1. its role triple (role/goal/backstory)
//   2. its atomic sub-task description (NOT the original user goal)
//   3. lightweight summaries from the State Bus (max N chars each)
//
// Shared state flows through the State Bus, not through prompt lineage.
//
// This module is self-contained — it does not depend on agent-loop.ts
// (which is owned by Task ID 7). Instead, sub-task execution shells out
// to our `chat()` directly. This keeps the Fugu isolation layer stable
// regardless of agent-loop's evolution.
// =====================================================================

import { stateBus } from './state-bus';
import { chat } from './llm';

const SUMMARY_MAX_CHARS = parseInt(process.env.PHASE17_FUGU_SUMMARY_MAX_CHARS || '500', 10);

export type IsolationRole =
  | 'manager'
  | 'researcher'
  | 'coder'
  | 'writer'
  | 'reviewer'
  | 'tester'
  | 'analyst'
  | 'general';

// SubTask definition — used by hierarchical-orchestrator-v2.ts.
export interface SubTask {
  id: string;
  title?: string;
  description: string;
  role: IsolationRole;
  dependsOn?: string[];
  status?: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  resultSummary?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  attempts?: number;
  guidance?: string[];
  startedAt?: number;
  completedAt?: number;
}

export interface IsolationContext {
  runId: string;
  subTaskId: string;
  role: IsolationRole;
  rolePrompt: { role: string; goal: string; backstory: string };
  subTaskDescription: string;
  toolScope: string[];
  sharedStateReadKeys: string[];
  sharedStateWriteKeys: string[];
  model: string;
  maxIterations: number;
}

export interface IsolatedSubTaskResult {
  result: string;
  summary: string;
  artifacts: string[];
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

const ROLE_PROMPTS: Record<IsolationRole, { role: string; goal: string; backstory: string }> = {
  manager: {
    role: 'project manager',
    goal: 'coordinate specialists efficiently',
    backstory: 'You are an experienced PM. You decompose goals and synthesize outputs.',
  },
  researcher: {
    role: 'researcher',
    goal: 'find accurate, up-to-date information',
    backstory: 'You are meticulous. You cite sources and distinguish facts from speculation.',
  },
  coder: {
    role: 'software engineer',
    goal: 'write correct, efficient, well-tested code',
    backstory: 'You are a senior engineer. You write clean code and handle edge cases.',
  },
  writer: {
    role: 'technical writer',
    goal: 'communicate complex ideas clearly',
    backstory: 'You adapt tone to audience. You use concrete examples.',
  },
  reviewer: {
    role: 'quality reviewer',
    goal: 'verify the quality and correctness of others\' work',
    backstory: 'You are rigorous. You check facts and give specific, actionable feedback.',
  },
  tester: {
    role: 'QA tester',
    goal: 'verify that solutions work correctly across edge cases',
    backstory: 'You cover happy paths, edge cases, and failure modes.',
  },
  analyst: {
    role: 'data analyst',
    goal: 'analyze data and extract meaningful insights',
    backstory: 'You use appropriate statistical methods and explain findings clearly.',
  },
  general: {
    role: 'general-purpose assistant',
    goal: 'complete the assigned task accurately',
    backstory: 'You are a versatile AI assistant capable of handling a wide range of tasks.',
  },
};

/**
 * Build an isolation context for a sub-task. The context captures the
 * role prompt, tool scope, and State Bus read/write keys. The sub-agent
 * will see ONLY these — never the original user goal or other sub-tasks'
 * full results.
 */
export function buildIsolationContext(opts: {
  runId: string;
  subTaskId: string;
  role: IsolationRole;
  subTaskDescription: string;
  model?: string;
  tools?: unknown[];
  dependsOn?: string[];
}): IsolationContext {
  const rolePrompt = ROLE_PROMPTS[opts.role] ?? ROLE_PROMPTS.general;
  return {
    runId: opts.runId,
    subTaskId: opts.subTaskId,
    role: opts.role,
    rolePrompt,
    subTaskDescription: opts.subTaskDescription,
    toolScope: [],
    sharedStateReadKeys: [
      `run:${opts.runId}:step:*:result:summary`,
      `run:${opts.runId}:shared:goal`,
    ],
    sharedStateWriteKeys: [
      `run:${opts.runId}:step:${opts.subTaskId}:result`,
      `run:${opts.runId}:step:${opts.subTaskId}:result:summary`,
    ],
    model: opts.model ?? 'glm-4.6',
    maxIterations: 3,
  };
}

/**
 * Execute a sub-task in isolation. The sub-agent:
 *   1. Reads lightweight summaries from the State Bus (from its deps).
 *   2. Calls the LLM with its role prompt + atomic sub-task description
 *      + the dep summaries (capped at SUMMARY_MAX_CHARS each).
 *   3. Writes its full result + a summary back to the State Bus for
 *      downstream sub-agents.
 */
export async function executeSubTaskIsolated(
  ctx: IsolationContext,
  _tools?: unknown[],
): Promise<IsolatedSubTaskResult> {
  const start = Date.now();

  // Gather dep summaries from the State Bus.
  const depSummaries: string[] = [];
  for (const pattern of ctx.sharedStateReadKeys) {
    if (!pattern.includes('*')) continue;
    const entries = await stateBus.list(pattern.replace(/\*.*/g, ''));
    for (const e of entries) {
      if (e.key.endsWith(':result:summary') && e.key.includes(':step:')) {
        depSummaries.push(e.value.slice(0, SUMMARY_MAX_CHARS));
      }
    }
  }

  const systemPrompt = `You are a ${ctx.rolePrompt.role}.
Your goal: ${ctx.rolePrompt.goal}
${ctx.rolePrompt.backstory}

${depSummaries.length > 0 ? `Relevant context from prior specialists (summaries only):\n${depSummaries.join('\n---\n')}\n` : ''}

YOUR SUB-TASK: ${ctx.subTaskDescription}

Complete this sub-task. Be concise and direct. Do not reference the original goal or other specialists.`;

  let result: string;
  try {
    const r = await chat(ctx.subTaskDescription, [], systemPrompt);
    result = r.content;
  } catch (err) {
    result = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Derive a short summary for downstream sub-agents.
  const summary = result.length > SUMMARY_MAX_CHARS
    ? result.slice(0, SUMMARY_MAX_CHARS) + '…'
    : result;

  // Write back to State Bus — both the full result and the summary.
  for (const writeKey of ctx.sharedStateWriteKeys) {
    if (writeKey.endsWith(':result:summary')) {
      await stateBus.set(writeKey, summary, 24 * 60 * 60 * 1000);
    } else if (writeKey.endsWith(':result')) {
      await stateBus.set(writeKey, result, 24 * 60 * 60 * 1000);
    }
  }

  // Rough token estimate — our chat() doesn't return token counts.
  const tokensIn = Math.ceil(systemPrompt.length / 4) + Math.ceil(ctx.subTaskDescription.length / 4);
  const tokensOut = Math.ceil(result.length / 4);

  return {
    result,
    summary,
    artifacts: [],
    tokensIn,
    tokensOut,
    durationMs: Date.now() - start,
  };
}
