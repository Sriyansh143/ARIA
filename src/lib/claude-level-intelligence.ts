// claude-level-intelligence.ts — Internal Claude-level intelligence module.
// Implements 5 reasoning patterns using JARVIS's own models (via the
// `./llm` chat() function).
//
//   1. chainOfThought(prompt, context?, model?)         — 2-phase: think → answer
//   2. recommendTool(task)                              — pick best tool/agent
//   3. handleLongContext(text, maxChars?)               — summarise long inputs
//   4. assessConfidence(thinking, answer)               — score 0-100
//   5. selfReflect(prompt, answer, model?)              — review own answer
//   + claudeLevelReasoning(prompt, context?, model?)    — master pipeline
//
// Every public function wraps its LLM call in try/catch and degrades
// gracefully — a failing model never throws to the caller.

import { chat, type ChatTurn } from '@/lib/llm'

const DEFAULT_MODEL = 'glm-4.6'

// ─────────────────────────────────────────────────────────────────────────
// 1. Chain-of-Thought (2-phase: think, then answer)
// ─────────────────────────────────────────────────────────────────────────
export interface ChainOfThoughtOutput {
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
): Promise<ChainOfThoughtOutput> {
  const started = Date.now()
  const ctxBlock = context ? `\n\n[Context]\n${context.slice(0, 8000)}` : ''
  const thinkSystem = 'Think step by step. Lay out assumptions, deductions, and edge cases. Do not produce the final answer yet — only the reasoning.'
  let thinking = ''
  try {
    const r = await chat(`${prompt}${ctxBlock}\n\nShow your step-by-step thinking.`, [], thinkSystem)
    thinking = r.content
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    try {
      const r = await chat(`${prompt}${ctxBlock}`)
      return { thinking: '[thinking step failed]', answer: r.content, model, latencyMs: Date.now() - started, fallback: true, error: msg }
    } catch (e2) {
      return { thinking: '', answer: '', model, latencyMs: Date.now() - started, fallback: true, error: e2 instanceof Error ? e2.message : String(e2) }
    }
  }
  try {
    const answerSystem = 'Using the reasoning provided, give a clear, concise final answer. Do not repeat the reasoning.'
    const r = await chat(`Question: ${prompt}${ctxBlock}\n\nReasoning:\n${thinking}\n\nFinal answer:`, [], answerSystem)
    return { thinking, answer: r.content, model, latencyMs: Date.now() - started }
  } catch (err) {
    return { thinking, answer: thinking, model, latencyMs: Date.now() - started, fallback: true, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. recommendTool(task) — pick best tool/agent
// ─────────────────────────────────────────────────────────────────────────
export interface ToolRecommendation {
  tool: string
  reason: string
  confidence: number
  alternatives: string[]
  model: string
  latencyMs: number
  fallback?: boolean
  error?: string
}

const FALLBACK_TOOLS = ['chat', 'web-search', 'code-sandbox', 'browser-use', 'image-generator']

export async function recommendTool(task: string, model: string = DEFAULT_MODEL): Promise<ToolRecommendation> {
  const started = Date.now()
  try {
    const system = 'Recommend the single best tool/agent for the task. Output strict JSON: {"tool":"<name>","reason":"<one sentence>","confidence":<0-100>,"alternatives":["a","b"]}. Tools: ' + FALLBACK_TOOLS.join(', ')
    const r = await chat(`Task: ${task}`, [], system)
    const m = r.content.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('no JSON in response')
    const parsed = JSON.parse(m[0]) as { tool?: string; reason?: string; confidence?: number; alternatives?: string[] }
    return {
      tool: String(parsed.tool || 'chat'),
      reason: String(parsed.reason || ''),
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
      alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives.map(String) : [],
      model,
      latencyMs: Date.now() - started,
    }
  } catch (err) {
    return {
      tool: 'chat',
      reason: 'recommendation failed — default to general chat',
      confidence: 0,
      alternatives: FALLBACK_TOOLS.filter((t) => t !== 'chat'),
      model,
      latencyMs: Date.now() - started,
      fallback: true,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 3. handleLongContext(text, maxChars?) — summarise long inputs
// ─────────────────────────────────────────────────────────────────────────
export interface LongContextSummary {
  summary: string
  originalChars: number
  summarisedChars: number
  chunks: number
  truncated: boolean
  model: string
  latencyMs: number
  fallback?: boolean
  error?: string
}

export async function handleLongContext(
  text: string,
  maxChars: number = 12_000,
  model: string = DEFAULT_MODEL,
): Promise<LongContextSummary> {
  const started = Date.now()
  const originalChars = text.length
  if (originalChars <= maxChars) {
    return { summary: text, originalChars, summarisedChars: originalChars, chunks: 1, truncated: false, model, latencyMs: Date.now() - started }
  }
  // Map-reduce summarisation.
  const chunkSize = Math.max(2000, Math.ceil(originalChars / Math.ceil(originalChars / (maxChars / 2))))
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += chunkSize) chunks.push(text.slice(i, i + chunkSize))
  try {
    const partial = await Promise.all(
      chunks.map((c, i) =>
        chat(c, [], `Summarise chunk ${i + 1}/${chunks.length}. Preserve all facts, entities, numbers. Prose only.`)
          .then((r) => r.content).catch(() => '[chunk failed]'),
      ),
    )
    const reduceR = await chat(
      partial.join('\n\n---\n\n'),
      [],
      'Combine the partial summaries into one coherent summary. Preserve all facts. Prose only.',
    )
    return { summary: reduceR.content, originalChars, summarisedChars: reduceR.content.length, chunks: chunks.length, truncated: true, model, latencyMs: Date.now() - started }
  } catch (err) {
    const truncated = text.slice(0, maxChars) + '\n[...truncated...]'
    return { summary: truncated, originalChars, summarisedChars: truncated.length, chunks: 1, truncated: true, model, latencyMs: Date.now() - started, fallback: true, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 4. assessConfidence(thinking, answer) — score 0-100
// ─────────────────────────────────────────────────────────────────────────
export interface ConfidenceAssessment {
  score: number
  rationale: string
  flags: string[]
  model: string
  latencyMs: number
  fallback?: boolean
  error?: string
}

export async function assessConfidence(
  thinking: string,
  answer: string,
  model: string = DEFAULT_MODEL,
): Promise<ConfidenceAssessment> {
  const started = Date.now()
  try {
    const system = 'Score the answer\'s confidence 0-100 based on the reasoning. Output strict JSON: {"score":<0-100>,"rationale":"<one sentence>","flags":["<concerns>"]}. Flags: "unsupported-claim", "hedging", "contradiction", "missing-evidence", "speculation".'
    const r = await chat(`Reasoning:\n${thinking.slice(0, 6000)}\n\nAnswer:\n${answer.slice(0, 4000)}`, [], system)
    const m = r.content.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('no JSON in response')
    const parsed = JSON.parse(m[0]) as { score?: number; rationale?: string; flags?: string[] }
    return {
      score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
      rationale: String(parsed.rationale || ''),
      flags: Array.isArray(parsed.flags) ? parsed.flags.map(String) : [],
      model,
      latencyMs: Date.now() - started,
    }
  } catch (err) {
    const tLen = thinking.length, aLen = answer.length
    const score = Math.max(0, Math.min(100, Math.round((tLen / Math.max(1, aLen)) * 20)))
    return { score, rationale: 'heuristic (LLM unavailable)', flags: ['llm-failed'], model, latencyMs: Date.now() - started, fallback: true, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 5. selfReflect(prompt, answer, model?) — review own answer
// ─────────────────────────────────────────────────────────────────────────
export interface SelfReflectionOutput {
  critique: string
  verdict: 'KEEP' | 'REVISE' | 'UNKNOWN'
  revised: string
  model: string
  latencyMs: number
  fallback?: boolean
  error?: string
}

export async function selfReflect(
  prompt: string,
  answer: string,
  model: string = DEFAULT_MODEL,
): Promise<SelfReflectionOutput> {
  const started = Date.now()
  try {
    const system = 'Review your own answer for factual errors, missing edge cases, fabrication, and unclear wording. Output:\nCRITIQUE: <one paragraph>\nVERDICT: KEEP or REVISE\nREVISED: <only if REVISE; otherwise omit>'
    const r = await chat(`Original question:\n${prompt}\n\nYour answer:\n${answer}`, [], system)
    const out = r.content
    const critique = (out.match(/CRITIQUE:\s*([\s\S]*?)(?:\nVERDICT:|$)/i)?.[1] || '').trim()
    const verdict = (out.match(/VERDICT:\s*(KEEP|REVISE)/i)?.[1] || 'UNKNOWN').toUpperCase() as 'KEEP' | 'REVISE' | 'UNKNOWN'
    const revised = (out.match(/REVISED:\s*([\s\S]*)$/i)?.[1] || '').trim()
    return { critique: critique || '[no critique]', verdict, revised: revised || (verdict === 'KEEP' ? answer : ''), model, latencyMs: Date.now() - started }
  } catch (err) {
    return { critique: '[reflection failed]', verdict: 'UNKNOWN', revised: answer, model, latencyMs: Date.now() - started, fallback: true, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Master pipeline — claudeLevelReasoning(prompt, context?, model?)
// Composes: handleLongContext → chainOfThought → assessConfidence → selfReflect
// ─────────────────────────────────────────────────────────────────────────
export interface ClaudeLevelReasoningResult {
  contextSummary: LongContextSummary
  thinking: string
  draftAnswer: string
  confidence: ConfidenceAssessment
  reflection: SelfReflectionOutput
  answer: string
  model: string
  latencyMs: number
  stages: string[]
  errors: string[]
}

export async function claudeLevelReasoning(
  prompt: string,
  context?: string,
  model: string = DEFAULT_MODEL,
): Promise<ClaudeLevelReasoningResult> {
  const started = Date.now()
  const stages: string[] = []
  const errors: string[] = []

  stages.push('long-context')
  let contextSummary: LongContextSummary
  try {
    contextSummary = await handleLongContext(context || '', 12_000, model)
    if (contextSummary.fallback && contextSummary.error) errors.push(`long-context: ${contextSummary.error}`)
  } catch (err) {
    contextSummary = { summary: context || '', originalChars: (context || '').length, summarisedChars: (context || '').length, chunks: 1, truncated: false, model, latencyMs: 0, fallback: true, error: err instanceof Error ? err.message : String(err) }
    errors.push(`long-context: ${contextSummary.error || 'failed'}`)
  }
  const condensedContext = contextSummary.summary

  stages.push('chain-of-thought')
  let cot: ChainOfThoughtOutput
  try {
    cot = await chainOfThought(prompt, condensedContext, model)
    if (cot.fallback && cot.error) errors.push(`cot: ${cot.error}`)
  } catch (err) {
    cot = { thinking: '', answer: '[chain-of-thought failed]', model, latencyMs: 0, fallback: true, error: err instanceof Error ? err.message : String(err) }
    errors.push(`cot: ${cot.error || 'failed'}`)
  }

  stages.push('confidence')
  let confidence: ConfidenceAssessment
  try {
    confidence = await assessConfidence(cot.thinking, cot.answer, model)
    if (confidence.fallback && confidence.error) errors.push(`confidence: ${confidence.error}`)
  } catch (err) {
    confidence = { score: 0, rationale: 'assessment failed', flags: ['llm-failed'], model, latencyMs: 0, fallback: true, error: err instanceof Error ? err.message : String(err) }
    errors.push(`confidence: ${confidence.error || 'failed'}`)
  }

  stages.push('self-reflect')
  let reflection: SelfReflectionOutput
  try {
    reflection = await selfReflect(prompt, cot.answer, model)
    if (reflection.fallback && reflection.error) errors.push(`reflection: ${reflection.error}`)
  } catch (err) {
    reflection = { critique: '[reflection failed]', verdict: 'UNKNOWN', revised: cot.answer, model, latencyMs: 0, fallback: true, error: err instanceof Error ? err.message : String(err) }
    errors.push(`reflection: ${reflection.error || 'failed'}`)
  }
  const answer = reflection.verdict === 'REVISE' && reflection.revised ? reflection.revised : cot.answer

  return {
    contextSummary,
    thinking: cot.thinking,
    draftAnswer: cot.answer,
    confidence,
    reflection,
    answer,
    model,
    latencyMs: Date.now() - started,
    stages,
    errors,
  }
}

// Re-export ChatTurn so consumers of the original API can still import it.
export type { ChatTurn }
