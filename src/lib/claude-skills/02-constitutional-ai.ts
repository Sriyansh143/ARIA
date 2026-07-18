// 02 — Constitutional AI. Generates a response, then critiques and revises
// it against an explicit list of principles (helpful, harmless, honest).
// Inspired by Anthropic's Constitutional AI paper.
// Two-phase: (1) draft, (2) critique + revision.
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

export const DEFAULT_PRINCIPLES: string[] = [
  'Be helpful: answer the user\'s actual question, fully and concretely.',
  'Be harmless: refuse to produce dangerous, illegal, or malicious content.',
  'Be honest: do not fabricate facts, citations, or capabilities. Admit uncertainty.',
  'Be fair: avoid bias, stereotyping, or unwarranted assumptions about people.',
  'Be privacy-respecting: never echo back PII, secrets, or credentials.',
]

export interface ConstitutionalResult {
  draft: string
  critique: string
  revised: string
  principles: string[]
  model: string
  latencyMs: number
  fallback?: boolean
  error?: string
}

export async function constitutionalAI(
  prompt: string,
  principles: string[] = DEFAULT_PRINCIPLES,
  model: string = DEFAULT_MODEL,
): Promise<ConstitutionalResult> {
  const started = Date.now()
  const principleBlock = principles.map((p, i) => `${i + 1}. ${p}`).join('\n')

  // Phase 1 — Draft.
  let draft = ''
  try {
    draft = await chat(prompt, [], '')
  } catch (err: unknown) {
    return {
      draft: '',
      critique: '',
      revised: '',
      principles,
      model,
      latencyMs: Date.now() - started,
      fallback: true,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  // Phase 2 — Critique + revise against the constitution.
  const reviseMessages: Msg[] = [
    {
      role: 'system',
      content:
        'You are a constitutional reviewer. Compare the draft to the principles. Identify violations, then output a revised response that satisfies ALL principles. Format:\nCRITIQUE: <one-paragraph list of issues, or "none">\nREVISED: <the corrected response only>',
    },
    {
      role: 'user',
      content: `User request:\n${prompt}\n\nConstitution:\n${principleBlock}\n\nDraft response:\n${draft}`,
    },
  ]
  try {
    const out = await llmCall(reviseMessages)
    const critiqueMatch = out.match(/CRITIQUE:\s*([\s\S]*?)(?:\nREVISED:|$)/i)
    const revisedMatch = out.match(/REVISED:\s*([\s\S]*)$/i)
    return {
      draft,
      critique: (critiqueMatch?.[1] || '').trim() || 'none',
      revised: (revisedMatch?.[1] || out).trim(),
      principles,
      model,
      latencyMs: Date.now() - started,
    }
  } catch (err: unknown) {
    return {
      draft,
      critique: '[revision failed]',
      revised: draft,
      principles,
      model,
      latencyMs: Date.now() - started,
      fallback: true,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
