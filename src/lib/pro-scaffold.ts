// =====================================================================
// pro-scaffold.ts — Pro-level prompt scaffold (dependency-free)
// =====================================================================
// Extracted from prompt-enhancer.ts so that llm.ts can import it without
// creating a circular dependency (prompt-enhancer imports quickChat from
// llm.ts). This module has NO imports — it's a pure template builder.
// =====================================================================

export type ProTaskType = 'code' | 'reasoning' | 'vision' | 'tool-use' | 'chat' | 'plan' | 'research';

const TASK_GUIDANCE: Record<ProTaskType, string> = {
  code: `When writing code:
- Plan the approach before writing (enumerate the steps mentally).
- Handle edge cases: empty input, null, large numbers, concurrent access.
- Include error handling — don't let exceptions propagate silently.
- Prefer pure functions and explicit types.
- Output ONLY the code with a brief 1-line comment per major block.`,
  reasoning: `When reasoning:
- State your assumptions explicitly before drawing conclusions.
- Consider at least 2 alternative explanations before committing to one.
- Quantify confidence (low/medium/high) for each conclusion.
- Flag what evidence would change your mind.`,
  vision: `When analyzing images:
- Describe what you literally see before interpreting.
- Note confidence level for each identified element.
- If unclear, say so — do not fabricate details.`,
  'tool-use': `When using tools:
- State which tool you'll use and why before calling it.
- Validate the tool's output before acting on it.
- If the tool fails, fall back gracefully — don't crash the flow.`,
  chat: `When responding:
- Be direct and useful. Prefer crisp bullet points.
- Keep responses under ~250 words unless depth is requested.
- If you don't know something, say so — never fabricate.`,
  plan: `When creating a plan:
- Decompose into ordered, verifiable steps.
- For each step: state the action, the expected outcome, and how to verify it succeeded.
- Identify dependencies between steps.
- Estimate time/complexity per step.
- Include a rollback or fallback for risky steps.`,
  research: `When researching:
- Cite sources for every factual claim (URL or document name).
- Distinguish between facts, estimates, and opinions.
- Note the recency of the information.
- Flag any conflicts between sources.`,
};

/**
 * Build the pro-level scaffold. Pure function — no LLM calls, no side effects.
 * This is applied to EVERY prompt that goes through the JARVIS LLM router,
 * enforcing the user's rule: "all prompts... are enhanced with pro level
 * prompt before executing."
 */
export function buildProScaffold(taskType: ProTaskType = 'chat'): string {
  const guidance = TASK_GUIDANCE[taskType] ?? TASK_GUIDANCE.chat;
  return `You are operating in PRO-LEVEL mode. Apply expert reasoning to every response.

${guidance}

Before responding, mentally verify your output:
- Does it directly answer what was asked?
- Are there unstated assumptions? If so, state them.
- Could a senior reviewer find a flaw? If yes, fix it first.

Respond with confidence proportional to your evidence. Never bluff.`;
}

/**
 * Wrap a system prompt with the pro-level scaffold. Used by llm.ts chat().
 */
export function withProScaffold(systemPrompt: string, taskType: ProTaskType = 'chat'): string {
  const scaffold = buildProScaffold(taskType);
  return `${systemPrompt}\n\n---\n${scaffold}`;
}
