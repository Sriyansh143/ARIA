// pipeline.ts — Claude-level master pipeline.
// Stages: input-guard → step-back → chain-of-thought → self-reflection → output-guard.
// Each stage degrades gracefully; a failed stage does not abort the pipeline.
//
// Adapted from v8 zip: the master pipeline calls the 10 skill modules which
// internally use our v10 `chat()` API. `model` is metadata only.

import { chainOfThought } from './01-chain-of-thought'
import { stepBackPrompting } from './05-step-back-prompting'
import { selfReflection } from './10-self-reflection'
import { guardrails, type GuardrailPairResult } from './07-guardrails'

const DEFAULT_MODEL = 'glm-4.6'

export interface ClaudeLevelPipelineResult {
  inputGuard: GuardrailPairResult
  principle: string
  thinking: string
  draftAnswer: string
  reflection: { critique: string; verdict: 'KEEP' | 'REVISE' | 'UNKNOWN' }
  answer: string
  outputGuard: GuardrailPairResult
  blocked: boolean
  blockReason?: string
  model: string
  latencyMs: number
  stages: string[]
  errors: string[]
}

export async function claudeLevelPipeline(
  prompt: string,
  context?: string,
  model: string = DEFAULT_MODEL,
): Promise<ClaudeLevelPipelineResult> {
  const started = Date.now()
  const stages: string[] = []
  const errors: string[] = []

  // Stage 1 — Input guardrails.
  stages.push('input-guard')
  const inputGuard = guardrails(prompt, '')
  if (!inputGuard.input.ok) {
    return {
      inputGuard,
      principle: '',
      thinking: '',
      draftAnswer: '',
      reflection: { critique: '', verdict: 'UNKNOWN' },
      answer: `[blocked] ${inputGuard.input.reason}`,
      outputGuard: inputGuard,
      blocked: true,
      blockReason: inputGuard.input.reason,
      model,
      latencyMs: Date.now() - started,
      stages,
      errors,
    }
  }

  // Stage 2 — Step-back principle.
  stages.push('step-back')
  let principle = ''
  try {
    const sb = await stepBackPrompting(prompt, model)
    principle = sb.principle
    if (sb.fallback && sb.error) errors.push(`step-back: ${sb.error}`)
  } catch (err: unknown) {
    errors.push(`step-back: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Stage 3 — Chain-of-thought informed by principle.
  stages.push('chain-of-thought')
  const augmentedContext = [context, principle ? `[Governing principle]\n${principle}` : '']
    .filter(Boolean)
    .join('\n\n')
  let thinking = ''
  let draftAnswer = ''
  try {
    const cot = await chainOfThought(prompt, augmentedContext, model)
    thinking = cot.thinking
    draftAnswer = cot.answer
    if (cot.fallback && cot.error) errors.push(`cot: ${cot.error}`)
  } catch (err: unknown) {
    errors.push(`cot: ${err instanceof Error ? err.message : String(err)}`)
    draftAnswer = '[chain-of-thought failed]'
  }

  // Stage 4 — Self-reflection + revise.
  stages.push('self-reflection')
  let answer = draftAnswer
  let reflection: { critique: string; verdict: 'KEEP' | 'REVISE' | 'UNKNOWN' } = {
    critique: '',
    verdict: 'UNKNOWN',
  }
  try {
    const sr = await selfReflection(prompt, draftAnswer, model)
    reflection = { critique: sr.critique, verdict: sr.verdict }
    if (sr.verdict === 'REVISE' && sr.revised) answer = sr.revised
    if (sr.fallback && sr.error) errors.push(`reflection: ${sr.error}`)
  } catch (err: unknown) {
    errors.push(`reflection: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Stage 5 — Output guardrails.
  stages.push('output-guard')
  const outputGuard = guardrails(prompt, answer)
  if (!outputGuard.output.ok) {
    return {
      inputGuard,
      principle,
      thinking,
      draftAnswer,
      reflection,
      answer: `[blocked] ${outputGuard.output.reason}`,
      outputGuard,
      blocked: true,
      blockReason: outputGuard.output.reason,
      model,
      latencyMs: Date.now() - started,
      stages,
      errors,
    }
  }
  return {
    inputGuard,
    principle,
    thinking,
    draftAnswer,
    reflection,
    answer,
    outputGuard,
    blocked: false,
    model,
    latencyMs: Date.now() - started,
    stages,
    errors,
  }
}
