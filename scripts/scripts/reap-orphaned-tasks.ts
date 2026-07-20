#!/usr/bin/env tsx
// =====================================================================
// reap-orphaned-tasks.ts — Mark orphaned 'running' tasks as 'failed'.
// =====================================================================
//
// Bug (BUG-2-5): If the JARVIS server crashes during task execution, tasks
// stay in the 'running' state forever. The dashboard shows them as
// "in-progress" but nothing is actually happening — the agent process that
// was working on them is gone.
//
// This script is the reaper:
//   1. Finds all tasks with `status: 'running'` AND `createdAt < (now - 30m)`.
//   2. Marks them as `status: 'failed'` with
//      `error: 'Task orphaned (server likely restarted)'`.
//   3. Prints a count of reaped tasks.
//
// Invocation:
//   npm run reap-tasks
//   tsx scripts/reap-orphaned-tasks.ts
//
// Exit codes:
//   0 = reaper ran successfully (including the case where nothing was reaped)
//   1 = fatal error (DB unavailable, etc.)
//
// This script is also called from scripts/ensure-env.js on startup (best-
// effort) so a fresh boot after a crash auto-clears orphaned tasks before
// the dashboard renders them as phantom "running" work.
// =====================================================================

import { db } from '../src/lib/db'

const ORPHAN_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes

async function reapOrphanedTasks(): Promise<number> {
  const cutoff = new Date(Date.now() - ORPHAN_THRESHOLD_MS)

  // Find orphaned tasks — running for longer than the threshold.
  const orphans = await db.task.findMany({
    where: {
      status: 'running',
      createdAt: { lt: cutoff },
    },
    select: { id: true, title: true, createdAt: true },
  })

  if (orphans.length === 0) {
    // eslint-disable-next-line no-console
    console.log('[reap-orphaned-tasks] No orphaned running tasks found.')
    return 0
  }

  // eslint-disable-next-line no-console
  console.log(
    `[reap-orphaned-tasks] Found ${orphans.length} orphaned task(s) ` +
      `(running for >${ORPHAN_THRESHOLD_MS / 60_000}min). Marking as failed...`,
  )

  // Mark each as failed. We do this one-by-one rather than updateMany so the
  // DB log clearly shows each transition (and so a partial failure doesn't
  // lose track of which tasks were reaped).
  let reaped = 0
  for (const t of orphans) {
    try {
      await db.task.update({
        where: { id: t.id },
        data: {
          status: 'failed',
          lastError: 'Task orphaned (server likely restarted)',
          // Bump failedAttempts so the DLQ view picks it up if the operator
          // has the dead-letter tab open.
          failedAttempts: { increment: 1 },
        },
      })
      reaped++
      // eslint-disable-next-line no-console
      console.log(
        `[reap-orphaned-tasks]   reaped ${t.id} (created ${t.createdAt.toISOString()}) — "${t.title.slice(0, 60)}"`,
      )
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error(
        `[reap-orphaned-tasks]   failed to reap ${t.id}: ${err?.message || err}`,
      )
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[reap-orphaned-tasks] Done. Reaped ${reaped} of ${orphans.length} orphaned task(s).`)
  return reaped
}

async function main(): Promise<void> {
  try {
    await reapOrphanedTasks()
    process.exit(0)
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error(
      '[reap-orphaned-tasks] fatal:',
      err instanceof Error ? err.stack || err.message : String(err),
    )
    process.exit(1)
  }
}

// Run only when invoked directly (not when imported by ensure-env.js, which
// calls reapOrphanedTasks() directly so it can swallow errors without
// process.exit).
if (require.main === module) {
  main()
}

export { reapOrphanedTasks }
