// =====================================================================
// budget-controller.ts — Hard daily LLM budget cap.
// =====================================================================
// Prevents runaway LLM token burn by tracking daily usage against a
// configurable budget limit. When the budget is exceeded:
//   1. All non-critical autonomous tasks are paused
//   2. Owner is notified (once per hour, not spam)
//   3. Critical alerts (service crashes, security) still go through
//   4. Manual tasks (user-initiated chat) are NOT blocked
//
// Adapted for v10:
//   • No `dailyBudget` Prisma model — replaced with an in-memory Map
//     keyed by YYYY-MM-DD. The map persists for the lifetime of the
//     process (which is fine — the dev server runs continuously).
//   • No `telegram-broadcaster.sendToOwner` — replaced with a
//     Notification row (which the dashboard surfaces) + console.warn.
//   • Logger → console.
//
// Configuration (.env):
//   LLM_DAILY_BUDGET_USD=5.00     (default: $5/day)
//   LLM_COST_PER_1K_INPUT=0.002   (averaged across providers)
//   LLM_COST_PER_1K_OUTPUT=0.006
//   LLM_BUDGET_DISABLED=true      (disable caps for free/local models)
// =====================================================================

import { db } from '@/lib/db'

const DEFAULT_DAILY_BUDGET = parseFloat(process.env.LLM_DAILY_BUDGET_USD || '5.0')
const COST_PER_1K_INPUT = parseFloat(process.env.LLM_COST_PER_1K_INPUT || '0.002')
const COST_PER_1K_OUTPUT = parseFloat(process.env.LLM_COST_PER_1K_OUTPUT || '0.006')

interface DailyBudgetRecord {
  date: string
  tokensUsed: number
  estimatedCost: number
  budgetLimit: number
  status: 'active' | 'exceeded'
  alertsSent: number
}

// ─── In-memory daily budget store ────────────────────────────────────
const dailyBudgets = new Map<string, DailyBudgetRecord>()

function getTodayStr(): string {
  return new Date().toISOString().split('T')[0]
}

async function getTodayBudget(): Promise<DailyBudgetRecord> {
  const today = getTodayStr()
  let budget = dailyBudgets.get(today)
  if (!budget) {
    budget = {
      date: today,
      tokensUsed: 0,
      estimatedCost: 0,
      budgetLimit: DEFAULT_DAILY_BUDGET,
      status: 'active',
      alertsSent: 0,
    }
    dailyBudgets.set(today, budget)
  }
  return budget
}

/** Notify the operator (best-effort) via Notification + console. */
async function notifyOwner(message: string, level: 'warn' | 'error'): Promise<void> {
  console[level](`[budget-controller] ${message}`)
  try {
    await db.notification.create({
      data: {
        type: level === 'error' ? 'error' : 'warn',
        title: 'LLM Budget Alert',
        message: message.slice(0, 240),
        read: false,
      },
    })
  } catch {
    /* best-effort */
  }
}

// ─── Record token usage + calculate cost ─────────────────────────────
export async function recordTokenUsage(opts: {
  tokensIn: number
  tokensOut: number
  model?: string
  taskType?: string // autonomous | manual | research | outreach
  provider?: string // 'ollama' → cost 0
}): Promise<{
  recorded: boolean
  budgetExceeded: boolean
  remainingBudget: number
}> {
  // Local Ollama = free. The provider hint is the most reliable signal
  // (localFirstChat / chat() set it explicitly), but we also fall back
  // to a model-name heuristic so callers that only pass `model` still
  // benefit. Ollama model ids look like 'qwen2.5:7b', 'llama3.1:8b' —
  // i.e. contain a colon AND have no '/' (cloud model ids like
  // 'groq/llama-3.3-70b' or 'openai/gpt-4o' contain a slash).
  const isLocalOllama =
    opts.provider === 'ollama' ||
    opts.provider === 'ollama-cloud' ||
    (!!opts.model &&
      opts.model.includes(':') &&
      !opts.model.includes('/') &&
      !opts.model.startsWith('browser:'))

  const cost = isLocalOllama
    ? 0
    : (opts.tokensIn / 1000) * COST_PER_1K_INPUT +
      (opts.tokensOut / 1000) * COST_PER_1K_OUTPUT

  try {
    const budget = await getTodayBudget()
    budget.tokensUsed += opts.tokensIn + opts.tokensOut
    budget.estimatedCost = Math.round((budget.estimatedCost + cost) * 1e6) / 1e6

    // Check if budget exceeded
    if (
      budget.estimatedCost >= budget.budgetLimit &&
      budget.status === 'active'
    ) {
      budget.status = 'exceeded'

      if (budget.alertsSent === 0) {
        await notifyOwner(
          `DAILY LLM BUDGET EXCEEDED\n\n` +
            `Spent: $${budget.estimatedCost.toFixed(2)} / $${budget.budgetLimit.toFixed(2)}\n` +
            `Tokens used: ${budget.tokensUsed.toLocaleString()}\n\n` +
            `All non-critical autonomous tasks have been paused. ` +
            `Manual chat is still available. Budget resets at midnight UTC.`,
          'error',
        )
        budget.alertsSent = 1
      }

      return { recorded: true, budgetExceeded: true, remainingBudget: 0 }
    }

    // Warn at 80% usage
    if (
      budget.estimatedCost >= budget.budgetLimit * 0.8 &&
      budget.alertsSent === 0
    ) {
      await notifyOwner(
        `LLM Budget Alert: 80% of daily budget used\n\n` +
          `Spent: $${budget.estimatedCost.toFixed(2)} / $${budget.budgetLimit.toFixed(2)}\n` +
          `Tokens: ${budget.tokensUsed.toLocaleString()}\n\n` +
          `Autonomous tasks will pause when budget is reached.`,
        'warn',
      )
      budget.alertsSent = 1
    }

    const remaining = Math.max(0, budget.budgetLimit - budget.estimatedCost)
    return { recorded: true, budgetExceeded: false, remainingBudget: remaining }
  } catch (err) {
    console.warn(
      `[budget-controller] failed to record usage: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return { recorded: false, budgetExceeded: false, remainingBudget: 0 }
  }
}

// ─── Check if budget allows autonomous tasks ─────────────────────────
export async function isBudgetAvailable(): Promise<boolean> {
  // Owner can completely disable LLM budget caps for personal use
  // (free/local models only).
  if (process.env.LLM_BUDGET_DISABLED === 'true') return true

  try {
    const budget = await getTodayBudget()
    return budget.status === 'active' && budget.estimatedCost < budget.budgetLimit
  } catch {
    return true // fail-open (don't block on errors)
  }
}

// ─── Get budget stats for dashboard ──────────────────────────────────
export async function getBudgetStats(): Promise<{
  today: {
    date: string
    tokensUsed: number
    estimatedCost: number
    budgetLimit: number
    status: string
    remaining: number
    percentUsed: number
  }
  last7days: Array<{ date: string; tokensUsed: number; estimatedCost: number }>
  totalSpent7days: number
}> {
  const today = await getTodayBudget()
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]

  const last7days: Array<{ date: string; tokensUsed: number; estimatedCost: number }> = []
  for (const [date, b] of dailyBudgets.entries()) {
    if (date >= sevenDaysAgo) {
      last7days.push({
        date: b.date,
        tokensUsed: b.tokensUsed,
        estimatedCost: b.estimatedCost,
      })
    }
  }
  last7days.sort((a, b) => a.date.localeCompare(b.date))

  const totalSpent7days = Math.round(
    last7days.reduce((sum, b) => sum + b.estimatedCost, 0) * 100,
  ) / 100

  return {
    today: {
      date: today.date,
      tokensUsed: today.tokensUsed,
      estimatedCost: today.estimatedCost,
      budgetLimit: today.budgetLimit,
      status: today.status,
      remaining: Math.max(0, today.budgetLimit - today.estimatedCost),
      percentUsed:
        today.budgetLimit > 0
          ? Math.round((today.estimatedCost / today.budgetLimit) * 100)
          : 0,
    },
    last7days,
    totalSpent7days,
  }
}

// ─── Reset budget (manual override) ──────────────────────────────────
export async function resetBudget(): Promise<void> {
  const today = getTodayStr()
  const budget = dailyBudgets.get(today)
  if (budget) {
    budget.status = 'active'
    budget.alertsSent = 0
  }
  console.log('[budget-controller] manually reset to active')
}

// ─── Set new budget limit ────────────────────────────────────────────
export async function setBudgetLimit(limit: number): Promise<void> {
  const today = getTodayStr()
  const budget = await getTodayBudget()
  budget.budgetLimit = limit
  budget.status = 'active'
  dailyBudgets.set(today, budget)
  console.log(`[budget-controller] limit updated to $${limit}`)
}
