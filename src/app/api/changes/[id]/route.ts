// =====================================================================
// /api/changes/[id] — Single Change Request detail + actions (Task ID 8)
// =====================================================================
// GET — return a single ChangeRequest row by id.
// POST — perform an action on the change request.
//   Body: { action: 'approve' | 'reject' | 'deploy' | 'rollback',
//           decidedBy?: string, decisionNote?: string,
//           actionLogId?: string, rolledBy?: string, rollbackNote?: string }
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import {
  getChange, approveChange, rejectChange, markDeployed, rollbackChange,
} from '@/lib/change-gate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_ACTIONS = new Set(['approve', 'reject', 'deploy', 'rollback'])

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const row = await getChange(id)
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ row })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as {
    action?: string
    decidedBy?: string
    decisionNote?: string
    actionLogId?: string
    rolledBy?: string
    rollbackNote?: string
    deployedBy?: string
  }

  const action = body.action
  if (!action || !VALID_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: `action must be one of: ${[...VALID_ACTIONS].join(', ')}` },
      { status: 400 },
    )
  }

  try {
    if (action === 'approve') {
      const row = await approveChange(id, {
        decidedBy: body.decidedBy,
        decisionNote: body.decisionNote,
      })
      return NextResponse.json({ row })
    }
    if (action === 'reject') {
      const row = await rejectChange(id, {
        decidedBy: body.decidedBy,
        decisionNote: body.decisionNote,
      })
      return NextResponse.json({ row })
    }
    if (action === 'deploy') {
      const row = await markDeployed(id, {
        actionLogId: body.actionLogId,
        deployedBy: body.deployedBy,
      })
      return NextResponse.json({ row })
    }
    // rollback
    const { change, reversal } = await rollbackChange(id, {
      rolledBy: body.rolledBy,
      rollbackNote: body.rollbackNote,
    })
    return NextResponse.json({ row: change, reversal })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'action failed' },
      { status: 400 },
    )
  }
}
