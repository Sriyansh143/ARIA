// =====================================================================
// smart-router.ts -- LLM-based prompt classification.
// =====================================================================
// Asks the LLM to classify when fast-router (regex) confidence is low,
// falling back to the fast-router result on any error. Never throws.
// =====================================================================

import { quickChat } from '@/lib/llm'
import { classifyPrompt, type PromptCategory } from '@/lib/fast-router'
import { logger } from '@/lib/logger'

export type { PromptCategory }

const VALID_CATEGORIES: PromptCategory[] = [
  'greeting', 'code', 'reasoning', 'vision', 'tool-use', 'chat',
]

const SYSTEM_PROMPT = `You are a prompt classifier for an AI assistant.
Read the user's prompt and respond with EXACTLY ONE word from this list:
greeting | code | reasoning | vision | tool-use | chat

Rules:
- greeting: hi/hello/thanks/small-talk, <20 chars, no task.
- code: writing/debugging/refactoring code, mentions languages or functions.
- reasoning: analyze/compare/decide/strategy/research/deep thought.
- vision: looks at images/screenshots/OCR.
- tool-use: needs an external tool (scrape/search/file/email/api).
- chat: general conversation that doesn't fit the others.

Respond with the single word only — no punctuation, no explanation.`

/**
 * Estimate how confident the regex classifier is. 0..1.
 */
function regexConfidence(prompt: string, category: PromptCategory): number {
  const t = prompt.trim()
  if (t.length < 20) return 0.95
  if (/```[\s\S]*?```/.test(t)) return 0.95
  if (/\b(screenshot|image|photo|look\s+at)\b/i.test(t)) return 0.9
  if (/\b(function|class|debug|refactor|sql|api\s+endpoint)\b/i.test(t)) return 0.9
  if (/\b(analyze|compare|strategy|trade-?offs?|pros\s+and\s+cons)\b/i.test(t)) return 0.9
  if (category === 'chat') return 0.3
  return 0.6
}

function parseCategory(raw: string): PromptCategory | null {
  const t = (raw || '').trim().toLowerCase()
  const first = t.split(/\s+/)[0]?.replace(/[^a-z-]/g, '')
  if (!first) return null
  return VALID_CATEGORIES.includes(first as PromptCategory)
    ? (first as PromptCategory)
    : null
}

/**
 * Smart prompt classification. Uses the LLM when regex confidence is low.
 * Never throws — always returns a valid PromptCategory.
 */
export async function smartClassifyPrompt(prompt: string): Promise<PromptCategory> {
  const regexResult = classifyPrompt(prompt)
  const confidence = regexConfidence(prompt, regexResult)

  if (confidence >= 0.85) return regexResult

  try {
    const raw = await quickChat(prompt.slice(0, 2000), SYSTEM_PROMPT)
    const llmResult = parseCategory(raw)
    if (llmResult) {
      logger.debug(
        { regexResult, llmResult, confidence, promptPreview: prompt.slice(0, 60) },
        'smart-router: LLM classification used',
      )
      return llmResult
    }
    logger.warn(
      { raw: raw.slice(0, 40), regexResult },
      'smart-router: LLM returned unknown label, using regex result',
    )
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), regexResult },
      'smart-router: LLM call failed, using regex result',
    )
  }
  return regexResult
}
