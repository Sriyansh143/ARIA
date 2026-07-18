// =====================================================================
// /api/action-log — Reversible Action Log API (Task ID 9)
// =====================================================================
// GET — list action log rows with filters + pagination + stats.
//   ?actor=<string>      — filter by actor (exact match)
//   ?action=<string>     — exact match OR prefix if endsWith '*'
//   ?category=<string>   — mutation | destructive | config | file | exec
//   ?reversed=true|false — filter by reversed status
//   ?limit=<int>         — page size (default 100, max 500)
//   ?offset=<int>        — pagination offset
//   ?stats=1             — include stats object in the response
//
// POST — log a new action. Body: LogActionInput.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { logAction, listActions, getActionStats } from '@/lib/action-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const actor = sp.get('actor')?.trim() || null
  const action = sp.get('action')?.trim() || null
  const category = sp.get('category')?.trim() || null
  const reversedRaw = sp.get('reversed')
  const reversed = reversedRaw === 'true' ? true : reversedRaw === 'false' ? false : null
  const limit = Math.min(Math.max(Number(sp.get('limit') ?? 100), 1), 500)
  const offset = Math.max(Number(sp.get('offset') ?? 0), 0)
  const includeStats = sp.get('stats') === '1'

  try {
    const [{ rows, total }, stats] = await Promise.all([
      listActions({ actor, action, category, reversed, limit, offset }),
      includeStats ? getActionStats() : Promise.resolve(null),
    ])

    return NextResponse.json({
      rows,
      total,
      filters: { actor, action, category, reversed, limit, offset },
      stats,
    })
  } catch (err) {
    console.error('[/api/action-log GET] failed:', err)
    return NextResponse.json(
      { rows: [], total: 0, error: err instanceof Error ? err.message : 'failed to read action log' },
      { status: 200 },
    )
  }
}

// POST — log a new action manually (most callers will import logAction directly,
// but the API is exposed so external/CLI tools can also submit entries).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const { actor, action, category, target, beforeState, afterState, reversible, approvalId, meta } = body

  if (typeof action !== 'string' || !action.trim()) {
    return NextResponse.json({ error: 'action is required' }, { status: 400 })
  }

  try {
    const row = await logAction({
      actor: typeof actor === 'string' ? actor : 'system',
      action,
      category: typeof category === 'string' ? (category as never) : undefined,
      target: typeof target === 'string' ? target : null,
      beforeState,
      afterState,
      reversible: typeof reversible === 'boolean' ? reversible : undefined,
      approvalId: typeof approvalId === 'string' ? approvalId : null,
      meta: (meta as Record<string, unknown>) ?? {},
    })
    return NextResponse.json({ row })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to log action' },
      { status: 400 },
    )
  }
}
