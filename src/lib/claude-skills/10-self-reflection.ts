// 10 — Self-Reflection. After producing an answer, ask the model to review
// its own answer for correctness, completeness, and honesty — then output
// a verdict (KEEP / REVISE) and a revised answer if needed. Closes the
// quality loop on every reasoning step.
//
// Adapted from v8 zip: uses our chat(userMessage, history, systemPrompt).

import { chat, type ChatTurn } from '@/lib/llm'

const DEFAULT_MODEL = 'glm-4.6'

export interface SelfReflectionResult {
  critique: string
  verdict: 'KEEP' | 'REVISE' | 'UNKNOWN'
  revised: string
  model: string
  latencyMs: number
  fallback?: boolean
  error?: string
}

type Msg = { role: 'system' | 'user' | 'assistant'; content: string }

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

export async function selfReflection(
  prompt: string,
  answer: string,
  model: string = DEFAULT_MODEL,
): Promise<SelfReflectionResult> {
  const started = Date.now()
  const messages: Msg[] = [
    {
      role: 'system',
      content:
        'You are reviewing your own answer. Check for: factual errors, missing edge cases, fabricated facts, and unclear wording. Output:\nCRITIQUE: <one paragraph>\nVERDICT: KEEP or REVISE\nREVISED: <only if REVISE; otherwise omit>',
    },
    {
      role: 'user',
      content: `Original question:\n${prompt}\n\nYour answer:\n${answer}`,
    },
  ]

  try {
    const out = await llmCall(messages)
    const critique = (out.match(/CRITIQUE:\s*([\s\S]*?)(?:\nVERDICT:|$)/i)?.[1] || '').trim()
    const verdictMatch = (out.match(/VERDICT:\s*(KEEP|REVISE)/i)?.[1] || 'UNKNOWN').toUpperCase() as
      | 'KEEP'
      | 'REVISE'
      | 'UNKNOWN'
    const revised = (out.match(/REVISED:\s*([\s\S]*)$/i)?.[1] || '').trim()
    return {
      critique: critique || '[no critique produced]',
      verdict: verdictMatch,
      revised: revised || (verdictMatch === 'KEEP' ? answer : ''),
      model,
      latencyMs: Date.now() - started,
    }
  } catch (err: unknown) {
    return {
      critique: '[reflection failed]',
      verdict: 'UNKNOWN',
      revised: answer,
      model,
      latencyMs: Date.now() - started,
      fallback: true,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
