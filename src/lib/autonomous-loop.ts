// =====================================================================
// autonomous-loop.ts — 24/7 autonomous event loop service.
// =====================================================================
// Adapted for v10: the original loop ticked 6 sub-checks (okara feed,
// pending tasks, stale runs, daily research, CRM leads, support tickets)
// each backed by Prisma models we don't have (MarketingOpportunityFeed,
// OrchestratorRun, Revenue, etc.) plus ~10 unavailable lib imports
// (mnc-orchestrator, telegram-broadcaster, voice-notifier, crm-integration,
// legal-support, file-watcher-native, timer-util, login-watchdog,
// revenue-engine, daily-research-engine, genetic-optimizer, rules-engine).
//
// We preserve the CORE design:
//   • A single setInterval that ticks every LOOP_INTERVAL_MS.
//   • A kill-switch guard (autonomous-watchdog.isArmed).
//   • A budget guard (budget-controller.isBudgetAvailable).
//   • Each tick runs a set of independent check_* functions wrapped in
//     try/catch via Promise.allSettled — one failing check never crashes
//     the loop.
//   • Every autonomous action is logged for audit.
//
// We adapt the audit log: instead of `prisma.autonomousAction.create`
// (model doesn't exist), we use `db.notification.create`. And we use
// `db.task` (which DOES exist) for the pending-task check.
// =====================================================================

import { db } from '@/lib/db'
import { runAgentLoop } from '@/lib/agent-loop'
import { isBudgetAvailable } from '@/lib/budget-controller'
import { isArmed } from '@/lib/autonomous-watchdog'

const LOOP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
let loopRunning = false
let loopStarted = false

// ─── Audit log helper ─────────────────────────────────────────────────
// Maps the old AutonomousAction schema to a Notification row so dashboards
// still see autonomous activity.
async function logAutonomousAction(entry: {
  trigger: string
  agentRole: string
  prompt: string
  outcome: 'success' | 'partial' | 'failure' | 'pending'
  result?: string
}): Promise<void> {
  try {
    await db.notification.create({
      data: {
        type:
          entry.outcome === 'success'
            ? 'success'
            : entry.outcome === 'failure'
              ? 'error'
              : 'info',
        title: `[autonomous:${entry.trigger}] ${entry.agentRole} → ${entry.outcome}`,
        message: entry.prompt.slice(0, 240),
        read: false,
      },
    })
  } catch {
    /* best-effort */
  }
}

// ─── Check for pending tasks → trigger agent loop ────────────────────
async function checkPendingTasks(): Promise<void> {
  try {
    const pendingTasks = await db.task.findMany({
      where: { status: 'pending' },
      take: 1,
    })
    if (pendingTasks.length === 0) return

    const task = pendingTasks[0]
    console.log(`[autonomous] processing pending task: ${task.title}`)

    // Mark as in_progress
    await db.task.update({
      where: { id: task.id },
      data: { status: 'in_progress' },
    })

    await logAutonomousAction({
      trigger: 'task_queue',
      agentRole: 'orion',
      prompt: task.title,
      outcome: 'pending',
    })

    const result = await runAgentLoop(
      task.description || task.title,
      {},
    )

    // Update task
    await db.task.update({
      where: { id: task.id },
      data: {
        status: 'completed',
        progress: 100,
      },
    })

    await logAutonomousAction({
      trigger: 'task_queue',
      agentRole: 'orion',
      prompt: task.title,
      outcome: 'success',
      result: result.content.slice(0, 2000),
    })

    console.log(`[autonomous] pending task completed: ${task.title}`)
  } catch (err) {
    console.warn(
      `[autonomous] task check failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

// ─── Check for stale "in_progress" tasks → reset to pending ──────────
// (Originally: stale orchestrator runs. We adapt to stale tasks.)
async function checkStaleTasks(): Promise<void> {
  try {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000)
    const stale = await db.task.findMany({
      where: {
        status: 'in_progress',
        updatedAt: { lt: tenMinAgo },
      },
      take: 5,
    })
    if (stale.length === 0) return

    for (const t of stale) {
      await db.task.update({
        where: { id: t.id },
        data: { status: 'pending' },
      })
      await logAutonomousAction({
        trigger: 'stale_task_recovery',
        agentRole: 'orion',
        prompt: t.title,
        outcome: 'pending',
      })
    }
    console.log(`[autonomous] reset ${stale.length} stale tasks → pending`)
  } catch (err) {
    console.warn(
      `[autonomous] stale task check failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

// ─── Health check: log a heartbeat telemetry sample ──────────────────
async function checkFleetHealth(): Promise<void> {
  try {
    // Count agents by status; surface any agent stuck in 'working' for >10min.
    const agents = await db.agent.findMany({
      where: { status: 'working' },
      select: { id: true, name: true, lastActive: true, updatedAt: true },
    })
    const tenMinAgo = Date.now() - 10 * 60 * 1000
    const stuck = agents.filter(
      (a) => a.updatedAt.getTime() < tenMinAgo,
    )
    for (const a of stuck) {
      await db.agent.update({
        where: { id: a.id },
        data: { status: 'idle' },
      })
    }
    if (stuck.length > 0) {
      await logAutonomousAction({
        trigger: 'health_check',
        agentRole: 'pulse',
        prompt: `Reset ${stuck.length} stuck agents to idle`,
        outcome: 'success',
      })
    }
  } catch (err) {
    console.warn(
      `[autonomous] health check failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

// ─── Main loop ───────────────────────────────────────────────────────
async function runLoop(): Promise<void> {
  if (loopRunning) return
  loopRunning = true

  console.log('[autonomous] running event loop tick')

  // Kill-switch — blocks EVERYTHING (even no-LLM safety checks should
  // still run, but if armed the operator has said "stop all autonomy".)
  if (isArmed()) {
    console.warn('[autonomous] kill-switch armed — skipping tick')
    loopRunning = false
    return
  }

  // Budget check — skip LLM-consuming tasks if budget is exhausted.
  const budgetOk = await isBudgetAvailable()

  // Safety / health checks always run (no LLM cost).
  await Promise.allSettled([
    checkFleetHealth(),
    checkStaleTasks(),
  ])

  // LLM-consuming tasks gated by budget.
  if (budgetOk) {
    await Promise.allSettled([checkPendingTasks()])
  } else {
    console.warn('[autonomous] budget exhausted — skipping LLM-consuming tasks')
  }

  loopRunning = false
}

// ─── Start the autonomous loop ───────────────────────────────────────
export function startAutonomousLoop(): void {
  if (loopStarted) return
  loopStarted = true

  // Run immediately on start
  setTimeout(() => {
    runLoop().catch((err) => {
      console.warn(
        `[autonomous] initial tick failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    })
  }, 5000)

  // Then every 5 minutes
  const loopTimer = setInterval(() => {
    runLoop().catch((err) => {
      console.warn(
        `[autonomous] loop tick failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    })
  }, LOOP_INTERVAL_MS)
  loopTimer.unref()

  console.log(
    `[autonomous] event loop started (runs every ${LOOP_INTERVAL_MS / 1000}s)`,
  )
}

// ─── Get autonomous stats ────────────────────────────────────────────
// Originally grouped by AutonomousAction.trigger — we now query
// Notification by title prefix `[autonomous:` to keep the same shape.
export async function getAutonomousStats(): Promise<{
  totalActions: number
  recentActions: number
}> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const [total, recent] = await Promise.all([
      db.notification.count({
        where: { title: { startsWith: '[autonomous:' } },
      }),
      db.notification.count({
        where: {
          title: { startsWith: '[autonomous:' },
          createdAt: { gte: since },
        },
      }),
    ])
    return { totalActions: total, recentActions: recent }
  } catch {
    return { totalActions: 0, recentActions: 0 }
  }
}

// ─── Get recent autonomous actions for dashboard ────────────────────
export async function getAutonomousActions(limit = 20): Promise<
  Array<{
    id: string
    title: string
    message: string
    type: string
    createdAt: Date
  }>
> {
  try {
    return await db.notification.findMany({
      where: { title: { startsWith: '[autonomous:' } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, title: true, message: true, type: true, createdAt: true },
    })
  } catch {
    return []
  }
}
