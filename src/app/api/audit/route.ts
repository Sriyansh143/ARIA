// =====================================================================
// /api/audit — Audit Log API
// =====================================================================
// Task ID 4 (PARALLEL-C — zip import).
//
// GET — list audit entries with optional filters:
//   ?actor=<string>      — filter by actor (exact match)
//   ?action=<prefix>     — filter by action prefix (e.g. "agent.")
//   ?target=<string>     — filter by target (exact match)
//   ?since=<iso>         — only entries after this ISO timestamp
//   ?limit=<int>         — page size (default 100, max 500)
//   ?offset=<int>        — pagination offset (default 0)
//
// Returns:
//   { entries: AuditLog[], total: number, filters: {...} }
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const actor = sp.get('actor')?.trim() || null
  const actionPrefix = sp.get('action')?.trim() || null
  const target = sp.get('target')?.trim() || null
  const sinceRaw = sp.get('since')
  const limit = Math.min(Math.max(Number(sp.get('limit') ?? 100), 1), 500)
  const offset = Math.max(Number(sp.get('offset') ?? 0), 0)

  // Build the where clause — every filter is optional.
  const where: Record<string, unknown> = {}
  if (actor) where.actor = actor
  if (target) where.target = target
  if (actionPrefix) {
    // Prisma supports `startsWith` on String fields for SQLite.
    where.action = { startsWith: actionPrefix }
  }
  if (sinceRaw) {
    const since = new Date(sinceRaw)
    if (!Number.isNaN(since.getTime())) {
      where.createdAt = { gte: since }
    }
  }

  try {
    const [entries, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.auditLog.count({ where }),
    ])

    return NextResponse.json({
      entries,
      total,
      filters: { actor, action: actionPrefix, target, since: sinceRaw, limit, offset },
    })
  } catch (err) {
    console.error('[/api/audit GET] failed:', err)
    return NextResponse.json(
      { entries: [], total: 0, error: err instanceof Error ? err.message : 'failed to read audit log' },
      { status: 200 }, // 200 so the UI still renders; the panel shows the error
    )
  }
}
