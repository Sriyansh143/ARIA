// 05 — Step-Back Prompting. Before answering, derive a higher-level
// abstraction / general principle behind the specific question. Then answer
// the original question informed by that principle. (Google Research, 2023.)
//
// Adapted from v8 zip: uses our chat(userMessage, history, systemPrompt).

import { chat, type ChatTurn } from '@/lib/llm'

const DEFAULT_MODEL = 'glm-4.6'

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

export interface StepBackResult {
  principle: string
  answer: string
  model: string
  latencyMs: number
  fallback?: boolean
  error?: string
}

export async function stepBackPrompting(
  prompt: string,
  model: string = DEFAULT_MODEL,
): Promise<StepBackResult> {
  const started = Date.now()

  // Phase 1 — Step back: derive the underlying principle / abstraction.
  let principle = ''
  try {
    principle = await llmCall([
      {
        role: 'system',
        content:
          'You are a reasoning coach. Given a specific question, derive the higher-level principle, concept, or general rule it depends on. Do NOT answer the specific question — only state the governing principle in 1-3 sentences.',
      },
      { role: 'user', content: `Question: ${prompt}\n\nWhat is the underlying principle?` },
    ])
  } catch (err: unknown) {
    // Fallback: skip step-back, single-shot answer.
    try {
      const r = await chat(prompt, [], '')
      return {
        principle: '[step-back failed]',
        answer: r.content,
        model,
        latencyMs: Date.now() - started,
        fallback: true,
        error: err instanceof Error ? err.message : String(err),
      }
    } catch (err2: unknown) {
      return {
        principle: '',
        answer: '',
        model,
        latencyMs: Date.now() - started,
        fallback: true,
        error: err2 instanceof Error ? err2.message : String(err2),
      }
    }
  }

  // Phase 2 — Answer the original question informed by the principle.
  try {
    const answer = await llmCall([
      {
        role: 'system',
        content:
          'Answer the user\'s question. Apply the governing principle to the specifics. Be concrete and correct.',
      },
      {
        role: 'user',
        content: `Question: ${prompt}\n\nGoverning principle: ${principle}\n\nAnswer:`,
      },
    ])
    return { principle, answer, model, latencyMs: Date.now() - started }
  } catch (err: unknown) {
    return {
      principle,
      answer: principle, // best effort
      model,
      latencyMs: Date.now() - started,
      fallback: true,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
