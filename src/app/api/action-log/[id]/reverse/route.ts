// =====================================================================
// /api/action-log/[id]/reverse — Reverse an Action (Task ID 9)
// =====================================================================
// POST — perform the inverse mutation of an ActionLog row.
//   Body: { reversedBy?: string }
//
// Returns the ReverseResult describing what was done (or the error).
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { reverseAction } from '@/lib/action-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as { reversedBy?: string }
  const reversedBy = typeof body.reversedBy === 'string' ? body.reversedBy : 'operator'

  try {
    const result = await reverseAction(id, { reversedBy })
    return NextResponse.json({ result })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'reverse failed' },
      { status: 400 },
    )
  }
}
