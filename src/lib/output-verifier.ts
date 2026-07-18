// output-verifier.ts — LLM self-grading output verification layer.
//
// Before marking a task complete, the agent verifies its own output:
//   1. Scores output quality 0-10
//   2. Checks factual consistency with the original task
//   3. Flags low-confidence results (< threshold)
//   4. Optionally triggers a re-run with corrective guidance
//
// Adapted for v10: our chat() doesn't support per-call maxTokens or
// AbortController signals, so we race the call against a setTimeout.
// Token usage is estimated from content length. Logger replaced with
// console.
//
// Usage:
//   import { verifyOutput } from '@/lib/output-verifier'
//   const result = await verifyOutput({ task, output, threshold: 6 })
//   if (!result.passed) { /* re-run with result.correctionHint */ }

import { chat, extractJson } from '@/lib/llm'

export interface VerifyOutputOpts {
  task: string
  output: string
  threshold?: number // 0-10, default 6 — below this = fail
  maxOutputChars?: number // truncate output before sending to verifier
  timeoutMs?: number
}

export interface VerifyOutputResult {
  passed: boolean
  score: number // 0-10
  confidence: number // 0-1 (normalized score/10)
  issues: string[] // list of identified problems
  correctionHint: string // guidance for re-run
  summary: string // one-sentence verdict
  tokensIn: number
  tokensOut: number
  skipped: boolean // true if verifier itself failed (best-effort)
}

const DEFAULT_THRESHOLD = 6
const DEFAULT_MAX_OUTPUT_CHARS = 3000
const DEFAULT_TIMEOUT_MS = 45_000

function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4)
}

export async function verifyOutput(opts: VerifyOutputOpts): Promise<VerifyOutputResult> {
  const {
    task,
    output,
    threshold = DEFAULT_THRESHOLD,
    maxOutputChars = DEFAULT_MAX_OUTPUT_CHARS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = opts

  const truncatedOutput = output.slice(0, maxOutputChars)
  const truncated = output.length > maxOutputChars

  const verifierPrompt = `You are a strict quality-control reviewer. Evaluate the following AI output.

ORIGINAL TASK:
${task.slice(0, 800)}

AI OUTPUT${truncated ? ' (truncated)' : ''}:
${truncatedOutput}

Evaluate the output on these criteria:
1. Completeness — does it fully address the task?
2. Accuracy — are the facts/code/logic correct?
3. Clarity — is it clear and well-structured?
4. Safety — does it avoid harmful, biased, or hallucinated content?

Respond ONLY with valid JSON (no markdown):
{
  "score": <integer 0-10>,
  "issues": ["issue1", "issue2"],
  "correction_hint": "<specific guidance for improvement, or empty string if none>",
  "summary": "<one sentence verdict>"
}`

  const skippedResult: VerifyOutputResult = {
    passed: true,
    score: 7,
    confidence: 0.7,
    issues: [],
    correctionHint: '',
    summary: 'Verifier skipped (best-effort pass).',
    tokensIn: 0,
    tokensOut: 0,
    skipped: true,
  }

  // C5: when the verifier LLM fails or returns garbage we must NOT report
  // a pass. Fail CLOSED (passed:false, score:0) so callers treat the
  // output as unverified/needs-replan rather than silently accepting it.
  const failedResult: VerifyOutputResult = {
    passed: false,
    score: 0,
    confidence: 0,
    issues: [
      'Verifier unavailable or returned invalid output — treated as failed (fail-closed).',
    ],
    correctionHint:
      'The quality verifier could not evaluate this output. Re-run and ensure the output is well-formed.',
    summary: 'Verification failed.',
    tokensIn: 0,
    tokensOut: 0,
    skipped: false,
  }

  const systemPrompt =
    'You are a strict output quality reviewer. Always respond with valid JSON only.'

  // Race the chat call against a hard timeout (our chat() doesn't accept
  // an AbortSignal, so we wrap with Promise.race).
  let raw: string | null = null
  try {
    const chatPromise = chat(verifierPrompt, [], systemPrompt).then((r) => r.content)
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs),
    )
    raw = await Promise.race([chatPromise, timeoutPromise])
  } catch (err) {
    console.warn(
      `[output-verifier] verification threw — failing closed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return failedResult
  }

  if (!raw) {
    console.warn('[output-verifier] verification timed out — failing closed')
    return failedResult
  }

  // Try strict JSON extraction first; fall back to regex.
  const parsed = extractJson<{
    score?: number
    issues?: unknown
    correction_hint?: string
    summary?: string
  }>(raw)

  let score: number
  let issues: string[]
  let correctionHint: string
  let summary: string

  if (parsed) {
    score =
      typeof parsed.score === 'number' ? Math.max(0, Math.min(10, Math.round(parsed.score))) : 5
    issues = Array.isArray(parsed.issues)
      ? parsed.issues.filter((x): x is string => typeof x === 'string').slice(0, 5)
      : []
    correctionHint =
      typeof parsed.correction_hint === 'string' ? parsed.correction_hint.slice(0, 500) : ''
    summary = typeof parsed.summary === 'string' ? parsed.summary.slice(0, 300) : ''
  } else {
    console.warn('[output-verifier] no JSON in response — failing closed')
    return failedResult
  }

  const passed = score >= threshold
  console.info(
    `[output-verifier] score=${score} threshold=${threshold} passed=${passed} issues=${issues.length}`,
  )

  return {
    passed,
    score,
    confidence: score / 10,
    issues,
    correctionHint,
    summary,
    tokensIn: estimateTokens(verifierPrompt),
    tokensOut: estimateTokens(raw),
    skipped: false,
  }
}

// ── Batch verification for multi-step outputs ─────────────────────────────

export interface StepVerification {
  stepId: string
  stepName: string
  result: VerifyOutputResult
}

export async function verifySteps(
  steps: Array<{ id: string; name: string; task: string; output: string }>,
  opts: Omit<VerifyOutputOpts, 'task' | 'output'> = {},
): Promise<StepVerification[]> {
  // Run verifications concurrently (cap at 3 to avoid rate limits)
  const CONCURRENCY = 3
  const results: StepVerification[] = []

  for (let i = 0; i < steps.length; i += CONCURRENCY) {
    const batch = steps.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map(async (step) => ({
        stepId: step.id,
        stepName: step.name,
        result: await verifyOutput({ ...opts, task: step.task, output: step.output }),
      })),
    )
    results.push(...batchResults)
  }

  return results
}

// ── Re-plan hint builder ──────────────────────────────────────────────────

export function buildReplanPrompt(
  originalTask: string,
  failedOutput: string,
  verifyResult: VerifyOutputResult,
): string {
  const issueList = verifyResult.issues.map((i) => `  - ${i}`).join('\n')
  return `Your previous attempt at this task scored ${verifyResult.score}/10 and did not meet the quality threshold.

ORIGINAL TASK: ${originalTask.slice(0, 600)}

FAILED OUTPUT (for context):
${failedOutput.slice(0, 800)}

ISSUES IDENTIFIED:
${issueList || '  - Output quality was insufficient'}

CORRECTION GUIDANCE: ${
    verifyResult.correctionHint || 'Please try a different approach and be more thorough.'
  }

Please retry the task addressing all identified issues. Be more careful, thorough, and accurate this time.`
}


