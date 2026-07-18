// =====================================================================
// /api/cron/history — Cron Execution History API
// =====================================================================
// Task ID 4 (PARALLEL-C — zip import).
//
// GET — list cron execution history with optional filters:
//   ?key=<string>     — filter by cronKey (exact match)
//   ?status=<string>  — success | error | timeout | skipped
//   ?limit=<int>      — page size (default 20, max 200)
//
// When no `key` is provided, returns the global history (most recent
// runs across all crons) — used by the Scheduler tab's "Execution
// History" panel. When `key` is provided, returns runs for that
// specific cron.
//
// Returns:
//   { runs: CronRunRecord[], total: number, summaries?: Record<key, summary> }
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { getRecentRuns, getGlobalHistory, getAllJobSummaries } from '@/lib/cron-history'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const key = sp.get('key')?.trim() || null
  const status = sp.get('status')?.trim() || null
  const limit = Math.min(Math.max(Number(sp.get('limit') ?? 20), 1), 200)
  const includeSummaries = sp.get('summaries') === '1' || sp.get('summaries') === 'true'

  try {
    // Fetch the raw runs first.
    let runs = key
      ? await getRecentRuns(key, limit)
      : await getGlobalHistory(limit)

    // Apply optional status filter (in-memory — small list).
    if (status) {
      runs = runs.filter((r) => r.status === status)
    }

    // Optionally include per-cron summaries (used by the Scheduler tab
    // to render aggregate counts next to each job).
    const summaries = includeSummaries ? await getAllJobSummaries() : undefined

    return NextResponse.json({
      runs,
      total: runs.length,
      filters: { key, status, limit },
      ...(summaries !== undefined ? { summaries } : {}),
    })
  } catch (err) {
    console.error('[/api/cron/history GET] failed:', err)
    return NextResponse.json(
      {
        runs: [],
        total: 0,
        error: err instanceof Error ? err.message : 'failed to read cron history',
      },
      { status: 200 }, // 200 so the UI still renders; the panel shows the error
    )
  }
}
