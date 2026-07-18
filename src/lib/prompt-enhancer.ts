// =====================================================================
// prompt-enhancer.ts — MANDATORY pro-level prompt enhancement pipeline
// =====================================================================
// USER RULE (non-negotiable):
//   "all prompts plans and tasks given from anywhere agent or owner are
//    enhanced with pro level prompt before executing this is rule for app"
//
// Every prompt, plan, or task — regardless of source (owner, agent, cron,
// Orion shell, API caller) — MUST pass through `enhancePromptPro()` before
// it is executed by an LLM. This module:
//   1. Clarifies ambiguous language (pronouns, vague requests).
//   2. Adds role + context + memory injection.
//   3. Wraps the prompt in a "pro-level" scaffold that enforces:
//      - step-by-step reasoning
//      - explicit assumptions
//      - edge-case consideration
//      - output format specification
//      - self-verification before responding
//   4. Logs the before/after to the ActionLog for auditability.
//
// The enhancement is BEST-EFFORT: if the LLM clarification call fails,
// the original prompt is still wrapped in the pro-level scaffold (which
// requires no LLM call) so the rule is always enforced.
// =====================================================================

import { quickChat } from '@/lib/llm';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { buildProScaffold, type ProTaskType } from '@/lib/pro-scaffold';

export interface PromptEnhancerContext {
  conventions?: string;
  memory?: string[];
  technologies?: string[];
  taskType?: ProTaskType;
  agentRole?: string;
  maxLength?: number;
  /** Who/what originated this prompt — for audit logging. */
  source?: 'owner' | 'agent' | 'cron' | 'orion' | 'api' | 'system';
  sourceId?: string; // agent codename, cron key, etc.
  /** Skip the LLM clarification step (still applies the scaffold). */
  skipLLMClarify?: boolean;
}

const AMBIGUOUS_MARKERS = [
  /^\s*(it|this|that|they|them)\b/i,
  /^\s*(do|fix|make|handle|update)\s+(it|this|that)\b/i,
  /^\s*(can you|could you|please)\b/i,
  /\b(something|stuff|things?|whatever)\b/i,
];

function isAmbiguous(prompt: string): boolean {
  const t = prompt.trim();
  if (t.length < 25) return true;
  return AMBIGUOUS_MARKERS.some((re) => re.test(t));
}

function buildContextBlock(ctx: PromptEnhancerContext): string {
  const lines: string[] = [];
  if (ctx.agentRole) lines.push(`Agent role: ${ctx.agentRole}.`);
  if (ctx.technologies?.length) {
    lines.push(`Tech stack: ${ctx.technologies.join(', ')}.`);
  }
  if (ctx.conventions) {
    lines.push(`Project conventions:\n${ctx.conventions.slice(0, 1500)}`);
  }
  if (ctx.memory?.length) {
    const mem = ctx.memory.slice(0, 5).map((m, i) => `  ${i + 1}. ${m}`).join('\n');
    lines.push(`Relevant memory:\n${mem}`);
  }
  if (lines.length === 0) return '';
  return lines.join('\n');
}

const CLARIFY_SYSTEM_PROMPT = `You are a senior prompt engineer. Rewrite the given prompt to be specific, actionable, and unambiguous — preserving the user's intent.

Rules:
- Add concrete detail ONLY when strongly implied by context.
- Do NOT invent features, requirements, or technologies the user didn't hint at.
- Make the expected output format explicit (e.g., "respond with JSON", "list 3 options").
- Add success criteria if missing (e.g., "the code must compile", "the plan must be executable in 1 hour").
- Keep the rewrite under 5 sentences.
- Output ONLY the rewritten prompt — no preamble, no quotes, no markdown.`;

async function clarifyWithLLM(prompt: string, ctx: PromptEnhancerContext): Promise<string | null> {
  const userMsg = ctx.taskType
    ? `Task type: ${ctx.taskType}\n${ctx.agentRole ? `Agent role: ${ctx.agentRole}\n` : ''}\nOriginal prompt: ${prompt}`
    : `Original prompt: ${prompt}`;
  try {
    const out = (await quickChat(userMsg.slice(0, 2500), CLARIFY_SYSTEM_PROMPT)).trim();
    return out.length > 0 && out.length <= 1500 ? out : null;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'prompt-enhancer: clarify LLM call failed',
    );
    return null;
  }
}

/**
 * Log the enhancement to ActionLog for auditability. Never throws.
 */
async function logEnhancement(
  original: string,
  enhanced: string,
  ctx: PromptEnhancerContext,
): Promise<void> {
  try {
    await db.actionLog.create({
      data: {
        actor: ctx.sourceId ?? ctx.source ?? 'system',
        action: 'prompt.enhance',
        category: 'mutation',
        target: ctx.sourceId ? `${ctx.source}:${ctx.sourceId}` : (ctx.source ?? 'unknown'),
        beforeState: JSON.stringify({ prompt: original.slice(0, 2000), taskType: ctx.taskType }),
        afterState: JSON.stringify({ enhanced: enhanced.slice(0, 4000) }),
        reversible: false, // prompt enhancement is not reversible
        meta: JSON.stringify({
          source: ctx.source ?? 'unknown',
          taskType: ctx.taskType ?? 'chat',
          originalLen: original.length,
          enhancedLen: enhanced.length,
        }),
      },
    });
  } catch (err) {
    logger.debug(
      { err: err instanceof Error ? err.message : String(err) },
      'prompt-enhancer: failed to log enhancement (non-fatal)',
    );
  }
}

/**
 * MANDATORY pro-level prompt enhancement. Every prompt that will be sent
 * to an LLM MUST go through this function. It:
 *   1. Clarifies ambiguous language (if LLM available).
 *   2. Injects context (memory, conventions, tech stack).
 *   3. Wraps in the pro-level scaffold (always — no LLM needed).
 *   4. Logs the before/after.
 *
 * Never throws — returns the scaffold-wrapped original on any failure.
 */
export async function enhancePromptPro(
  prompt: string,
  context?: PromptEnhancerContext,
): Promise<string> {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) return prompt;
  const ctx = context ?? {};
  const ctxBlock = buildContextBlock(ctx);

  let core = prompt;
  if (!ctx.skipLLMClarify && isAmbiguous(prompt)) {
    const clarified = await clarifyWithLLM(prompt, ctx);
    if (clarified) {
      logger.debug(
        { original: prompt.slice(0, 60), clarified: clarified.slice(0, 60) },
        'prompt-enhancer: prompt clarified',
      );
      core = clarified;
    }
  }

  // Assemble: scaffold + context + the actual prompt
  const scaffold = buildProScaffold(ctx.taskType ?? 'chat');
  const parts: string[] = [scaffold];
  if (ctxBlock) parts.push(`\n--- CONTEXT ---\n${ctxBlock}`);
  parts.push(`\n--- TASK ---\n${core}`);

  const enhanced = parts.join('\n');

  // Audit log (fire-and-forget)
  await logEnhancement(prompt, enhanced, ctx);

  return enhanced;
}

/**
 * Backward-compatible alias for the old `enhancePrompt` function.
 * Now redirects to enhancePromptPro so all callers get the mandatory upgrade.
 */
export async function enhancePrompt(
  prompt: string,
  context?: PromptEnhancerContext,
): Promise<string> {
  return enhancePromptPro(prompt, context);
}

/**
 * Enhance a multi-step plan (each step gets its own pro-level treatment).
 * Used by the plan executor before running each step.
 */
export async function enhancePlan(
  steps: Array<{ title: string; description?: string; action: string }>,
  context?: PromptEnhancerContext,
): Promise<Array<{ title: string; description: string; action: string; enhancedPrompt: string }>> {
  const enhanced: Array<{ title: string; description: string; action: string; enhancedPrompt: string }> = [];
  for (const step of steps) {
    const stepPrompt = `${step.title}${step.description ? `\n\n${step.description}` : ''}`;
    const enhancedPrompt = await enhancePromptPro(stepPrompt, {
      ...context,
      taskType: 'plan',
    });
    enhanced.push({
      title: step.title,
      description: step.description ?? '',
      action: step.action,
      enhancedPrompt,
    });
  }
  return enhanced;
}
