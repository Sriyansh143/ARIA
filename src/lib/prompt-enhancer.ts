// =====================================================================
// prompt-enhancer.ts -- Prompt enhancement pipeline.
// =====================================================================
// Auto-adds context (project conventions, relevant memory) and clarifies
// ambiguous prompts before they're sent to the LLM. Enhancement is opt-in:
// if the prompt is already specific, it's returned unchanged.
// =====================================================================

import { quickChat } from '@/lib/llm'
import { logger } from '@/lib/logger'

export interface PromptEnhancerContext {
  conventions?: string
  memory?: string[]
  technologies?: string[]
  taskType?: 'code' | 'reasoning' | 'vision' | 'tool-use' | 'chat'
  agentRole?: string
  maxLength?: number
}

const AMBIGUOUS_MARKERS = [
  /^\s*(it|this|that|they|them)\b/i,            // pronoun start
  /^\s*(do|fix|make|handle|update)\s+(it|this|that)\b/i,
  /^\s*(can you|could you|please)\b/i,           // vague request
  /\b(something|stuff|things?|whatever)\b/i,
]

function isAmbiguous(prompt: string): boolean {
  const t = prompt.trim()
  if (t.length < 25) return true
  return AMBIGUOUS_MARKERS.some((re) => re.test(t))
}

function buildContextBlock(ctx: PromptEnhancerContext): string {
  const lines: string[] = []
  if (ctx.agentRole) lines.push(`Agent role: ${ctx.agentRole}.`)
  if (ctx.technologies?.length) {
    lines.push(`Tech stack: ${ctx.technologies.join(', ')}.`)
  }
  if (ctx.conventions) {
    lines.push(`Project conventions:\n${ctx.conventions.slice(0, 1500)}`)
  }
  if (ctx.memory?.length) {
    const mem = ctx.memory.slice(0, 5).map((m, i) => `  ${i + 1}. ${m}`).join('\n')
    lines.push(`Relevant memory:\n${mem}`)
  }
  if (lines.length === 0) return ''
  return lines.join('\n')
}

const CLARIFY_SYSTEM_PROMPT = `You clarify ambiguous user prompts for an AI assistant.
Rewrite the prompt to be specific and actionable, preserving the user's intent.
- Add concrete detail ONLY when it's strongly implied by the surrounding context.
- Do NOT invent features, requirements, or technologies the user didn't hint at.
- Keep the rewrite under 4 sentences.
- Output ONLY the rewritten prompt — no preamble, no quotes, no markdown.`

async function clarifyWithLLM(prompt: string, ctx: PromptEnhancerContext): Promise<string | null> {
  const userMsg = ctx.taskType
    ? `Task type hint: ${ctx.taskType}\n\nUser prompt: ${prompt}`
    : `User prompt: ${prompt}`
  try {
    const out = (await quickChat(userMsg.slice(0, 2000), CLARIFY_SYSTEM_PROMPT)).trim()
    return out.length > 0 && out.length <= 1200 ? out : null
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'prompt-enhancer: clarify LLM call failed',
    )
    return null
  }
}

/**
 * Enhance a prompt with context + clarification. Never throws.
 * Returns the original prompt on any failure.
 */
export async function enhancePrompt(
  prompt: string,
  context?: PromptEnhancerContext,
): Promise<string> {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) return prompt
  const ctx = context ?? {}
  const ctxBlock = buildContextBlock(ctx)

  let core = prompt
  if (isAmbiguous(prompt)) {
    const clarified = await clarifyWithLLM(prompt, ctx)
    if (clarified) {
      logger.debug(
        { original: prompt.slice(0, 60), clarified: clarified.slice(0, 60) },
        'prompt-enhancer: prompt clarified',
      )
      core = clarified
    }
  }

  if (!ctxBlock) return core
  return `${ctxBlock}\n---\n${core}`
}
