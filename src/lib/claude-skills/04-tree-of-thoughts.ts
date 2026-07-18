// 04 — Tree-of-Thoughts. Generates N (capped 2-5) independent candidate
// thoughts in parallel, scores each, picks the best, then refines. Good for
// problems where multiple solution strategies should be explored.
//
// Adapted from v8 zip: uses our chat(userMessage, history, systemPrompt).

import { chat, type ChatTurn } from '@/lib/llm'

const DEFAULT_MODEL = 'glm-4.6'

export interface ThoughtNode {
  thought: string
  score: number
  critique: string
}

export interface TreeOfThoughtsResult {
  candidates: ThoughtNode[]
  best: ThoughtNode | null
  refined: string
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

async function generateThought(prompt: string, idx: number): Promise<string> {
  const messages: Msg[] = [
    {
      role: 'system',
      content: `You are reasoner variant #${idx + 1}. Propose a distinct approach to solving the problem. Be specific and structured. Variant ${idx + 1} should${idx === 0 ? ' be the most direct' : idx === 1 ? ' explore edge cases first' : idx === 2 ? ' decompose into subproblems' : ' consider alternative framings'}.`,
    },
    { role: 'user', content: prompt },
  ]
  return llmCall(messages)
}

async function scoreThought(prompt: string, thought: string): Promise<ThoughtNode> {
  const r = await llmCall([
    {
      role: 'system',
      content:
        'Score the thought 0-100 on correctness, completeness, and efficiency. Format:\nSCORE: <number>\nCRITIQUE: <one sentence>',
    },
    { role: 'user', content: `Problem:\n${prompt}\n\nThought:\n${thought}` },
  ])
  const score = parseInt((r.match(/SCORE:\s*(\d+)/i)?.[1] || '0'), 10)
  const critique = (r.match(/CRITIQUE:\s*([\s\S]*)$/i)?.[1] || '').trim()
  return { thought, score: isNaN(score) ? 0 : Math.max(0, Math.min(100, score)), critique }
}

export async function treeOfThoughts(
  prompt: string,
  branchingFactor: number = 3,
  model: string = DEFAULT_MODEL,
): Promise<TreeOfThoughtsResult> {
  const started = Date.now()
  const n = Math.max(2, Math.min(5, branchingFactor))
  let candidates: ThoughtNode[] = []

  // Generate + score in parallel.
  try {
    const thoughts = await Promise.all(
      Array.from({ length: n }, (_, i) => generateThought(prompt, i).catch(() => '')),
    )
    candidates = await Promise.all(
      thoughts
        .filter(Boolean)
        .map((t) => scoreThought(prompt, t).catch(() => ({ thought: t, score: 0, critique: '[scoring failed]' }))),
    )
  } catch (err: unknown) {
    return {
      candidates: [],
      best: null,
      refined: '',
      model,
      latencyMs: Date.now() - started,
      fallback: true,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const best = candidates.slice().sort((a, b) => b.score - a.score)[0] || null
  if (!best) {
    return { candidates, best: null, refined: '', model, latencyMs: Date.now() - started, fallback: true }
  }

  // Refine the best thought into a final answer.
  try {
    const refined = await llmCall([
      { role: 'system', content: 'Refine the chosen thought into a polished final answer.' },
      { role: 'user', content: `Problem:\n${prompt}\n\nChosen thought (score ${best.score}/100):\n${best.thought}\n\nCritique: ${best.critique}\n\nFinal answer:` },
    ])
    return { candidates, best, refined, model, latencyMs: Date.now() - started }
  } catch (err: unknown) {
    return {
      candidates,
      best,
      refined: best.thought,
      model,
      latencyMs: Date.now() - started,
      fallback: true,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
