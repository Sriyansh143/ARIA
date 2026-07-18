// =====================================================================
// /api/changes — App-Change Approval Gate API (Task ID 8)
// =====================================================================
// GET — list change requests + optional stats
//   ?status=<string>     — pending | approved | rejected | deployed | rolled-back
//   ?changeType=<string> — feature-add | feature-remove | upgrade | …
//   ?scope=<string>      — app | built-app | mini-service | plugin
//   ?limit=<int>         — page size (default 100, max 500)
//   ?offset=<int>        — pagination offset
//   ?stats=1             — include stats object in the response
//
// POST — create a new change request. Body: RequestChangeInput.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { requestChange, listChanges, getChangeStats } from '@/lib/change-gate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_TYPES = new Set([
  'feature-add', 'feature-remove', 'upgrade', 'dependency',
  'schema', 'config', 'rule', 'hotfix', 'refactor',
])
const ALLOWED_SCOPES = new Set(['app', 'built-app', 'mini-service', 'plugin'])

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const status = sp.get('status')?.trim() || null
  const changeType = sp.get('changeType')?.trim() || null
  const scope = sp.get('scope')?.trim() || null
  const limit = Math.min(Math.max(Number(sp.get('limit') ?? 100), 1), 500)
  const offset = Math.max(Number(sp.get('offset') ?? 0), 0)
  const includeStats = sp.get('stats') === '1'

  try {
    const [{ rows, total }, stats] = await Promise.all([
      listChanges({
        status: status as never,
        changeType: changeType as never,
        scope: scope as never,
        limit,
        offset,
      }),
      includeStats ? getChangeStats() : Promise.resolve(null),
    ])

    return NextResponse.json({
      rows,
      total,
      filters: { status, changeType, scope, limit, offset },
      stats,
    })
  } catch (err) {
    console.error('[/api/changes GET] failed:', err)
    return NextResponse.json(
      { rows: [], total: 0, error: err instanceof Error ? err.message : 'failed to read change requests' },
      { status: 200 },
    )
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const {
    changeType, scope, title, description, rationale, impact,
    proposedBy, filePaths, diffSummary,
  } = body

  if (typeof changeType !== 'string' || !ALLOWED_TYPES.has(changeType)) {
    return NextResponse.json({ error: `changeType must be one of: ${[...ALLOWED_TYPES].join(', ')}` }, { status: 400 })
  }
  if (typeof scope !== 'undefined' && (typeof scope !== 'string' || !ALLOWED_SCOPES.has(scope))) {
    return NextResponse.json({ error: `scope must be one of: ${[...ALLOWED_SCOPES].join(', ')}` }, { status: 400 })
  }
  if (typeof title !== 'string' || !title.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (typeof description !== 'string' || !description.trim()) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 })
  }

  try {
    const row = await requestChange({
      changeType: changeType as never,
      scope: (typeof scope === 'string' ? scope : 'app') as never,
      title,
      description,
      rationale: typeof rationale === 'string' ? rationale : undefined,
      impact: typeof impact === 'string' ? impact : undefined,
      proposedBy: typeof proposedBy === 'string' ? proposedBy : undefined,
      filePaths: Array.isArray(filePaths) ? filePaths.filter((p): p is string => typeof p === 'string') : [],
      diffSummary: typeof diffSummary === 'string' ? diffSummary : undefined,
    })
    return NextResponse.json({ row })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to create change request' },
      { status: 400 },
    )
  }
}
