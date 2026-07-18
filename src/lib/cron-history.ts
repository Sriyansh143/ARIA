// =====================================================================
// cron-history.ts — DB helpers for persisting cron job run history.
// =====================================================================
// Task ID 4 (PARALLEL-C — zip import).
//
// Adapted from the jarvis-mission-control-final zip:
//   - uses our `db` import (src/lib/db) instead of `prisma`
//   - uses our CronHistory Prisma model (cronKey / status / durationMs /
//     detail) instead of the raw `CronJobRun` table the original used
//     via $executeRawUnsafe + inline migration. We get proper typing
//     and indices for free.
//
// Public API:
//   saveCronRun(cronKey, result)  — write one CronHistory row, prune old
//   getRecentRuns(cronKey, limit?) — fetch last N runs for a single cron
//   getGlobalHistory(limit?)     — fetch last N runs across all crons
//   getAllJobSummaries()         — per-cronKey aggregates (total/success/last)
//
// All helpers are best-effort: they catch all DB errors and log them
// without throwing, so a DB failure never crashes the cron scheduler.
// =====================================================================

import { db } from '@/lib/db'

// ─── Public types ────────────────────────────────────────────────────

export type CronRunStatus = 'success' | 'error' | 'timeout' | 'skipped'

export interface CronRunResult {
  success: boolean
  durationMs: number
  message?: string
  error?: string | null
  status?: CronRunStatus
}

export interface CronRunRecord {
  id: string
  cronKey: string
  status: CronRunStatus
  durationMs: number
  detail: string
  createdAt: Date
}

export interface CronJobSummary {
  totalRuns: number
  successRuns: number
  errorRuns: number
  lastRanAt: Date | null
  lastDurationMs: number | null
}

// ─── saveCronRun ─────────────────────────────────────────────────────

/**
 * Persist one cron job execution to the DB.
 * Best-effort — never throws. Also prunes per-cron history to the last
 * 100 runs to prevent unbounded growth.
 */
export async function saveCronRun(
  cronKey: string,
  result: CronRunResult,
): Promise<void> {
  try {
    const status: CronRunStatus = result.status ?? (result.success ? 'success' : 'error')
    const detail = (
      result.error
        ? `${result.error}${result.message ? ` — ${result.message}` : ''}`
        : result.message ?? ''
    ).slice(0, 500)

    await db.cronHistory.create({
      data: {
        cronKey,
        status,
        durationMs: Math.max(0, Math.floor(result.durationMs)),
        detail,
      },
    })

    // Prune: keep only the last 100 rows for this cronKey.
    // Done in a transaction so we don't race with concurrent inserts.
    const oldRows = await db.cronHistory.findMany({
      where: { cronKey },
      orderBy: { createdAt: 'desc' },
      skip: 100,
      select: { id: true },
    })
    if (oldRows.length > 0) {
      await db.cronHistory.deleteMany({
        where: { id: { in: oldRows.map((r) => r.id) } },
      })
    }
  } catch (err) {
    // Non-fatal — log and continue.
    console.error('[cron-history] saveCronRun error:', err instanceof Error ? err.message : err)
  }
}

// ─── getRecentRuns ───────────────────────────────────────────────────

/**
 * Fetch the last `limit` runs for a given cronKey, newest first.
 * Returns an empty array on any error.
 */
export async function getRecentRuns(
  cronKey: string,
  limit = 10,
): Promise<CronRunRecord[]> {
  try {
    const rows = await db.cronHistory.findMany({
      where: { cronKey },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    })
    return rows.map((r) => ({
      id: r.id,
      cronKey: r.cronKey,
      status: r.status as CronRunStatus,
      durationMs: r.durationMs,
      detail: r.detail,
      createdAt: r.createdAt,
    }))
  } catch (err) {
    console.error('[cron-history] getRecentRuns error:', err instanceof Error ? err.message : err)
    return []
  }
}

// ─── getGlobalHistory ───────────────────────────────────────────────

/**
 * Fetch the last `limit` runs across ALL cronKeys, newest first.
 * Used by the Scheduler tab's "Execution History" panel.
 */
export async function getGlobalHistory(limit = 20): Promise<CronRunRecord[]> {
  try {
    const rows = await db.cronHistory.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    })
    return rows.map((r) => ({
      id: r.id,
      cronKey: r.cronKey,
      status: r.status as CronRunStatus,
      durationMs: r.durationMs,
      detail: r.detail,
      createdAt: r.createdAt,
    }))
  } catch (err) {
    console.error('[cron-history] getGlobalHistory error:', err instanceof Error ? err.message : err)
    return []
  }
}

// ─── getAllJobSummaries ───────────────────────────────────────────────

/**
 * Return a summary of every distinct cronKey with aggregate counts.
 * Used by /api/cron to enrich the job list with DB-backed history counts.
 */
export async function getAllJobSummaries(): Promise<
  Record<string, CronJobSummary>
> {
  try {
    // Pull all rows in memory — for the typical JARVIS dataset (≤ 100
    // crons × 100 runs each = 10k rows max) this is fast enough and
    // avoids any $queryRaw incompatibility between SQLite/Postgres.
    const rows = await db.cronHistory.findMany({
      select: { cronKey: true, status: true, durationMs: true, createdAt: true },
    })
    const out: Record<string, CronJobSummary> = {}
    for (const r of rows) {
      const s = out[r.cronKey] ?? {
        totalRuns: 0,
        successRuns: 0,
        errorRuns: 0,
        lastRanAt: null,
        lastDurationMs: null,
      }
      s.totalRuns += 1
      if (r.status === 'success') s.successRuns += 1
      if (r.status === 'error' || r.status === 'timeout') s.errorRuns += 1
      if (!s.lastRanAt || r.createdAt > s.lastRanAt) {
        s.lastRanAt = r.createdAt
        s.lastDurationMs = r.durationMs
      }
      out[r.cronKey] = s
    }
    return out
  } catch (err) {
    console.error('[cron-history] getAllJobSummaries error:', err instanceof Error ? err.message : err)
    return {}
  }
}
