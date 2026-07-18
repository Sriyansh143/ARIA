// =====================================================================
// /api/action-log/[id] — Single Action Log detail (Task ID 9)
// =====================================================================
// GET — return a single ActionLog row by id (includes full beforeState /
// afterState / reverseResult JSON, useful for the expand-to-detail view).
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { getAction } from '@/lib/action-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const row = await getAction(id)
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ row })
}
