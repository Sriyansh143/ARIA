// 01 — Chain-of-Thought reasoning (2-phase: think, then answer).
// Pattern: prompt the model to lay out its reasoning explicitly before
// producing the final answer.
// Graceful degradation: if the LLM call fails, fall back to a single-shot
// best-effort answer so the pipeline can continue.
//
// Adapted from the v8 zip to our v10 app: uses `chat(userMessage, history,
// systemPrompt)` from `@/lib/llm`. The `model` param is retained on the
// public API for pipeline/back-compat, but is recorded as metadata only —
// our GLM-4.6 client does not accept per-call model overrides.

import { chat, type ChatTurn } from '@/lib/llm'

const DEFAULT_MODEL = 'glm-4.6'

type Msg = { role: 'system' | 'user' | 'assistant'; content: string }

/** Local adapter: convert zip-style messages → our chat() signature. */
async function llmCall(messages: Msg[]): Promise<string> {
  const sys = messages.find((m) => m.role === 'system')?.content ?? ''
  const convo = messages.filter((m) => m.role !== 'system')
  if (convo.length === 0) throw new Error('no user message')
  const last = convo[convo.length - 1]
  const history: ChatTurn[] = convo.slice(0, -1).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))
  const r = await chat(last.content, history, sys)
  return r.content
}

export interface ChainOfThoughtResult {
  thinking: string
  answer: string
  model: string
  latencyMs: number
  fallback?: boolean
  error?: string
}

export async function chainOfThought(
  prompt: string,
  context?: string,
  model: string = DEFAULT_MODEL,
): Promise<ChainOfThoughtResult> {
  const started = Date.now()
  const ctxBlock = context ? `\n\n[Context]\n${context.slice(0, 8000)}` : ''

  // Phase 1 — Think step-by-step.
  const thinkMessages: Msg[] = [
    {
      role: 'system',
      content:
        'You are a careful reasoner. Think step by step. Lay out every assumption, intermediate deduction, and edge case BEFORE the final answer. Do not produce the answer in this step — only the reasoning.',
    },
    { role: 'user', content: `${prompt}${ctxBlock}\n\nShow your step-by-step thinking.` },
  ]

  let thinking = ''
  try {
    thinking = await llmCall(thinkMessages)
  } catch (err: unknown) {
    // Fallback: single-shot answer, no separate thinking step.
    const msg = err instanceof Error ? err.message : String(err)
    try {
      const r = await chat(`${prompt}${ctxBlock}`, [], '')
      return {
        thinking: '[thinking step failed]',
        answer: r.content,
        model,
        latencyMs: Date.now() - started,
        fallback: true,
        error: msg,
      }
    } catch (err2: unknown) {
      return {
        thinking: '',
        answer: '',
        model,
        latencyMs: Date.now() - started,
        fallback: true,
        error: err2 instanceof Error ? err2.message : String(err2),
      }
    }
  }

  // Phase 2 — Produce the final answer given the thinking.
  const answerMessages: Msg[] = [
    {
      role: 'system',
      content:
        'Using the reasoning provided, give a clear, concise final answer. Do not repeat the reasoning. If the reasoning is flawed, correct it silently.',
    },
    { role: 'user', content: `Question: ${prompt}${ctxBlock}\n\nReasoning:\n${thinking}\n\nFinal answer:` },
  ]
  try {
    const answer = await llmCall(answerMessages)
    return { thinking, answer, model, latencyMs: Date.now() - started }
  } catch (err: unknown) {
    return {
      thinking,
      answer: thinking, // best effort — surface the thinking as the answer.
      model,
      latencyMs: Date.now() - started,
      fallback: true,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
