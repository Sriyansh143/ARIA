// agent-loop.ts — JARVIS agent loop.
//
// A thin wrapper around the LLM `chat()` call that optionally routes the
// prompt through one of the claude-skills reasoning patterns (CoT, ReAct,
// Tree-of-Thoughts, etc.) when `reasoningMode` is set.
//
// Wire-in (Task ID 7): the original behaviour (plain chat) is the default
// and is preserved exactly. The `reasoningMode` parameter is OPTIONAL and
// only takes effect when explicitly passed. The claude-skills module is
// imported dynamically to avoid circular dependencies with /api routes.
// If a skill invocation throws, we fall back to a plain `chat()` call so
// the loop never breaks.

import { chat, type ChatTurn, JARVIS_SYSTEM_PROMPT } from '@/lib/llm'

export type ReasoningMode =
  | 'chain-of-thought'
  | 'constitutional-ai'
  | 'react-pattern'
  | 'tree-of-thoughts'
  | 'step-back-prompting'
  | 'few-shot-learning'
  | 'self-reflection'
  | 'pipeline'
  | null

export interface AgentLoopOptions {
  /** When set, wraps the prompt with the matching claude-skill. */
  reasoningMode?: ReasoningMode
  /** Optional system prompt override. */
  systemPrompt?: string
  /** Optional conversation history. */
  history?: ChatTurn[]
  /** Optional context block passed to skills that accept one (CoT, pipeline). */
  context?: string
}

export interface AgentLoopResult {
  content: string
  latencyMs: number
  reasoningMode: ReasoningMode
  reasoningUsed: boolean
  reasoningError?: string
}

/**
 * Run a single agent loop step. Default behaviour: plain `chat()` call,
 * identical to calling `chat()` directly. When `opts.reasoningMode` is set,
 * the matching claude-skill is invoked via dynamic import; on failure, we
 * transparently fall back to `chat()` so callers always get an answer.
 */
export async function runAgentLoop(
  message: string,
  opts: AgentLoopOptions = {},
): Promise<AgentLoopResult> {
  const started = Date.now()
  const reasoningMode = opts.reasoningMode ?? null

  // No reasoning mode → plain chat, original behaviour preserved.
  if (!reasoningMode) {
    const { content, latencyMs } = await chat(
      message,
      opts.history ?? [],
      opts.systemPrompt ?? JARVIS_SYSTEM_PROMPT,
    )
    return {
      content,
      latencyMs,
      reasoningMode: null,
      reasoningUsed: false,
    }
  }

  // Reasoning mode → wrap with the matching claude-skill.
  try {
    const skills = await import('@/lib/claude-skills')
    let content = ''
    switch (reasoningMode) {
      case 'chain-of-thought': {
        const r = await skills.chainOfThought(message, opts.context)
        content = r.answer
        break
      }
      case 'constitutional-ai': {
        const r = await skills.constitutionalAI(message)
        content = r.revised || r.draft
        break
      }
      case 'react-pattern': {
        const r = await skills.reactPattern(message, [])
        content = r.answer
        break
      }
      case 'tree-of-thoughts': {
        const r = await skills.treeOfThoughts(message)
        content = r.refined || r.best?.thought || ''
        break
      }
      case 'step-back-prompting': {
        const r = await skills.stepBackPrompting(message)
        content = r.answer
        break
      }
      case 'few-shot-learning': {
        const r = await skills.fewShotLearning(message)
        content = r.answer
        break
      }
      case 'self-reflection': {
        // Self-reflection needs an answer to reflect on — get one first.
        const draft = (await chat(message, opts.history ?? [], opts.systemPrompt ?? JARVIS_SYSTEM_PROMPT)).content
        const r = await skills.selfReflection(message, draft)
        content = r.verdict === 'REVISE' && r.revised ? r.revised : draft
        break
      }
      case 'pipeline': {
        const r = await skills.claudeLevelPipeline(message, opts.context)
        content = r.answer
        break
      }
      default: {
        // Exhaustive guard — unknown mode falls back to plain chat.
        const r = await chat(message, opts.history ?? [], opts.systemPrompt ?? JARVIS_SYSTEM_PROMPT)
        content = r.content
      }
    }
    return {
      content,
      latencyMs: Date.now() - started,
      reasoningMode,
      reasoningUsed: true,
    }
  } catch (err: unknown) {
    // Skill failure → fall back to plain chat so the loop never breaks.
    const { content, latencyMs } = await chat(
      message,
      opts.history ?? [],
      opts.systemPrompt ?? JARVIS_SYSTEM_PROMPT,
    )
    return {
      content,
      latencyMs,
      reasoningMode,
      reasoningUsed: false,
      reasoningError: err instanceof Error ? err.message : String(err),
    }
  }
}
