// =====================================================================
// self-healing.ts -- Auto-retry wrapper for agent tasks.
// =====================================================================
// Adapted for v10: our chat() returns { content, latencyMs } (no
// tokensIn/tokensOut/model kwargs). Token usage is estimated from the
// content length so the budget gate still works. AgentMetric doesn't
// exist in our Prisma schema, so we log outcomes to Notification +
// keep an in-memory ring buffer for callers that want recent history.
// =====================================================================

import { chat } from '@/lib/llm'
import { db } from '@/lib/db'

const MAX_RETRIES = 3
const MAX_TOKENS_PER_TASK = 50_000 // hard cap to prevent runaway token burn

/** In-memory ring of recent self-healing outcomes (for dashboards). */
export interface SelfHealingOutcome {
  id: string
  task: string
  success: boolean
  attempts: number
  totalTokens: number
  durationMs: number
  errorHistory: string[]
  createdAt: Date
}
const RECENT_OUTCOMES_LIMIT = 50
const recentOutcomes: SelfHealingOutcome[] = []

export function getRecentSelfHealingOutcomes(): SelfHealingOutcome[] {
  return [...recentOutcomes]
}

export interface SelfHealingResult {
  success: boolean
  result: string
  attempts: number
  totalTokens: number
  durationMs: number
  errorHistory: string[]
}

/** Crude token estimate: ~4 chars per token, summed across prompt+output. */
function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4)
}

/** Persist an outcome as a Notification (best-effort) + in-memory ring. */
async function recordOutcome(outcome: SelfHealingOutcome): Promise<void> {
  recentOutcomes.unshift(outcome)
  if (recentOutcomes.length > RECENT_OUTCOMES_LIMIT) recentOutcomes.pop()
  try {
    await db.notification.create({
      data: {
        type: outcome.success ? 'success' : 'warn',
        title: `Self-healing ${outcome.success ? 'succeeded' : 'failed'} (${outcome.attempts} attempts)`,
        message: outcome.task.slice(0, 180),
        read: false,
      },
    })
  } catch {
    /* best-effort — never block on audit log */
  }
}

// ─── Execute a task with self-healing ────────────────────────────────
export async function executeWithSelfHealing(opts: {
  task: string
  systemPrompt?: string
  maxTokens?: number
}): Promise<SelfHealingResult> {
  const start = Date.now()
  const errors: string[] = []
  let totalTokens = 0
  let lastResult = ''

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Check token budget
    if (totalTokens >= MAX_TOKENS_PER_TASK) {
      console.warn(
        `[self-healing] token budget exhausted (used ${totalTokens} of ${MAX_TOKENS_PER_TASK})`,
      )
      errors.push(`Token budget exhausted (${totalTokens} >= ${MAX_TOKENS_PER_TASK})`)
      break
    }

    // Build prompt — include error history on retries
    let prompt = opts.task
    if (attempt > 1 && errors.length > 0) {
      const lastError = errors[errors.length - 1]
      prompt = `Previous attempt failed with error:
${lastError}

Fix the issue and retry the original task:
${opts.task}

Common fixes:
- If "module not found" → check import paths
- If "timeout" → simplify the approach
- If "syntax error" → check for typos
- If "permission denied" → check file permissions`
    }

    try {
      const result = await chat(prompt, [], opts.systemPrompt)
      totalTokens += estimateTokens(prompt) + estimateTokens(result.content)
      lastResult = result.content

      // Check if the result indicates success
      if (!result.content.startsWith('[error]') && !result.content.includes('Error:')) {
        const outcome: SelfHealingOutcome = {
          id: crypto.randomUUID(),
          task: opts.task,
          success: true,
          attempts: attempt,
          totalTokens,
          durationMs: Date.now() - start,
          errorHistory: errors,
          createdAt: new Date(),
        }
        await recordOutcome(outcome)

        return {
          success: true,
          result: lastResult,
          attempts: attempt,
          totalTokens,
          durationMs: Date.now() - start,
          errorHistory: errors,
        }
      }

      // Result contains an error
      errors.push(result.content.slice(0, 500))
      console.warn(
        `[self-healing] attempt ${attempt} failed, retrying. Error: ${errors[errors.length - 1]}`,
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(msg)
      console.warn(`[self-healing] attempt ${attempt} threw, retrying. Error: ${msg}`)
    }
  }

  // All retries exhausted — escalate
  console.warn(
    `[self-healing] all ${MAX_RETRIES} retries failed, escalating. Errors: ${errors.join(' | ')}`,
  )

  const failedOutcome: SelfHealingOutcome = {
    id: crypto.randomUUID(),
    task: opts.task,
    success: false,
    attempts: MAX_RETRIES,
    totalTokens,
    durationMs: Date.now() - start,
    errorHistory: errors,
    createdAt: new Date(),
  }
  await recordOutcome(failedOutcome)

  return {
    success: false,
    result: `Task failed after ${MAX_RETRIES} attempts.\n\nError history:\n${errors
      .map((e, i) => `${i + 1}. ${e}`)
      .join('\n')}\n\nLast result:\n${lastResult}`,
    attempts: MAX_RETRIES,
    totalTokens,
    durationMs: Date.now() - start,
    errorHistory: errors,
  }
}

// ─── Escalate to CTO agent ───────────────────────────────────────────
export async function escalateToCTO(task: string, errorHistory: string[]): Promise<string> {
  const prompt = `As CTO, a task has been escalated to you after ${errorHistory.length} failed attempts.

ORIGINAL TASK: ${task}

ERROR HISTORY:
${errorHistory.map((e, i) => `${i + 1}. ${e}`).join('\n')}

Analyze the errors, identify the root cause, and provide a definitive solution.`

  try {
    const result = await chat(
      prompt,
      [],
      'You are the CTO. Be decisive — give the single most likely root cause and the exact fix.',
    )
    return result.content
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return `CTO escalation also failed: ${msg}`
  }
}
