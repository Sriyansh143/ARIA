// =====================================================================
// change-gate.ts — App-Change Approval Gate (Task ID 8 — 8-9-CHANGEGATE-ACTIONLOG)
// =====================================================================
// Permanent rule from the user:
//   "any changes in app or app built by our app which effect things the way
//    they work definitely need approval this is rule (it includes important
//    changes upgrades features adding or removal etc)"
//
// Every app-level change (feature-add / feature-remove / upgrade / dependency
// / schema / config / rule / hotfix / refactor) MUST go through this gate:
//
//   requestChange()  →  status=pending, create linked ApprovalRequest
//   approveChange()  →  status=approved, resolve approval
//   rejectChange()   →  status=rejected
//   markDeployed()   →  status=deployed, link ActionLog that recorded the change
//   rollbackChange() →  status=rolled-back, trigger ActionLog reversal
//
// The ChangeRequest Prisma model already exists in `prisma/schema.prisma`.
// The ApprovalRequest Prisma model also exists — we link them via `approvalId`.
// If the approval-escalation lib is later added, it can be wired in here.
// =====================================================================

import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-log'
import { reverseAction } from '@/lib/action-log'

// ─── Types ─────────────────────────────────────────────────────────────

export type ChangeType =
  | 'feature-add'
  | 'feature-remove'
  | 'upgrade'
  | 'dependency'
  | 'schema'
  | 'config'
  | 'rule'
  | 'hotfix'
  | 'refactor'

export type ChangeScope = 'app' | 'built-app' | 'mini-service' | 'plugin'

export type ChangeStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'deployed'
  | 'rolled-back'

export interface RequestChangeInput {
  changeType: ChangeType
  scope?: ChangeScope
  title: string
  description: string
  rationale?: string
  impact?: string
  proposedBy?: string
  filePaths?: string[]
  diffSummary?: string
}

export interface ChangeRow {
  id: string
  changeType: string
  scope: string
  title: string
  description: string
  rationale: string | null
  impact: string | null
  proposedBy: string
  filePaths: string
  diffSummary: string | null
  approvalId: string | null
  status: string
  deployedAt: string | null
  rolledBackAt: string | null
  actionLogId: string | null
  createdAt: string
  updatedAt: string
}

export interface ListChangesInput {
  status?: ChangeStatus | null
  changeType?: ChangeType | null
  scope?: ChangeScope | null
  limit?: number
  offset?: number
}

export interface ChangeStats {
  total: number
  byStatus: Record<string, number>
  byChangeType: Record<string, number>
  byScope: Record<string, number>
  avgApprovalMs: number | null // average ms from createdAt → status=approved
}

// ─── requestChange ────────────────────────────────────────────────────

/**
 * Create a new ChangeRequest with status=pending. Also creates a linked
 * ApprovalRequest (category='app-change') and stores its id back onto the
 * change request via `approvalId`. Returns the change request row.
 */
export async function requestChange(input: RequestChangeInput): Promise<ChangeRow> {
  if (!input.title?.trim()) throw new Error('requestChange: title is required')
  if (!input.description?.trim()) throw new Error('requestChange: description is required')

  const filePaths = Array.isArray(input.filePaths) ? input.filePaths : []

  // Create the linked ApprovalRequest first so we can store its id.
  const approval = await db.approvalRequest.create({
    data: {
      category: 'app-change',
      title: input.title.slice(0, 200),
      description: `**${input.changeType}** (${input.scope ?? 'app'})\n\n${input.description}${input.impact ? `\n\n**Impact:** ${input.impact}` : ''}`,
      requestedBy: input.proposedBy ?? 'system',
      payload: JSON.stringify({
        changeType: input.changeType,
        scope: input.scope ?? 'app',
        rationale: input.rationale ?? null,
        impact: input.impact ?? null,
        filePaths,
        diffSummary: input.diffSummary ?? null,
      }),
      status: 'pending',
      // Hard expiry: 7 days
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  const row = await db.changeRequest.create({
    data: {
      changeType: input.changeType,
      scope: input.scope ?? 'app',
      title: input.title,
      description: input.description,
      rationale: input.rationale ?? null,
      impact: input.impact ?? null,
      proposedBy: input.proposedBy ?? 'system',
      filePaths: JSON.stringify(filePaths),
      diffSummary: input.diffSummary ?? null,
      approvalId: approval.id,
      status: 'pending',
    },
  })

  // Also create a Notification so it surfaces in the bell + approval queue.
  try {
    await db.notification.create({
      data: {
        type: 'approval-required',
        title: `Change Request: ${input.title.slice(0, 100)}`,
        message: `${input.changeType} · ${input.scope ?? 'app'} — proposed by ${input.proposedBy ?? 'system'}`,
      },
    })
  } catch (e) {
    console.warn('[change-gate] Failed to create notification:', e)
  }

  // Fire-and-forget audit log entry.
  await logAudit({
    actor: input.proposedBy ?? 'system',
    action: 'change.request',
    target: `change:${row.id}`,
    meta: { changeType: input.changeType, scope: input.scope, approvalId: approval.id },
  }).catch(() => {})

  return row as unknown as ChangeRow
}

// ─── approveChange ────────────────────────────────────────────────────

export async function approveChange(
  id: string,
  opts: { decidedBy?: string; decisionNote?: string } = {},
): Promise<ChangeRow> {
  const decidedBy = opts.decidedBy ?? 'operator'
  const existing = await db.changeRequest.findUnique({ where: { id } })
  if (!existing) throw new Error(`ChangeRequest ${id} not found`)
  if (existing.status !== 'pending') {
    throw new Error(`ChangeRequest ${id} is not pending (status=${existing.status})`)
  }

  // Resolve the linked approval.
  if (existing.approvalId) {
    try {
      await db.approvalRequest.update({
        where: { id: existing.approvalId },
        data: {
          status: 'approved',
          decidedBy,
          decisionNote: opts.decisionNote ?? null,
          resolvedAt: new Date(),
        },
      })
    } catch (e) {
      console.warn('[change-gate] Failed to resolve approval:', e)
    }
  }

  const row = await db.changeRequest.update({
    where: { id },
    data: { status: 'approved' },
  })

  await logAudit({
    actor: decidedBy,
    action: 'change.approve',
    target: `change:${id}`,
    meta: { decisionNote: opts.decisionNote ?? null },
  }).catch(() => {})

  return row as unknown as ChangeRow
}

// ─── rejectChange ─────────────────────────────────────────────────────

export async function rejectChange(
  id: string,
  opts: { decidedBy?: string; decisionNote?: string } = {},
): Promise<ChangeRow> {
  const decidedBy = opts.decidedBy ?? 'operator'
  const existing = await db.changeRequest.findUnique({ where: { id } })
  if (!existing) throw new Error(`ChangeRequest ${id} not found`)
  if (existing.status !== 'pending') {
    throw new Error(`ChangeRequest ${id} is not pending (status=${existing.status})`)
  }

  if (existing.approvalId) {
    try {
      await db.approvalRequest.update({
        where: { id: existing.approvalId },
        data: {
          status: 'rejected',
          decidedBy,
          decisionNote: opts.decisionNote ?? null,
          resolvedAt: new Date(),
        },
      })
    } catch (e) {
      console.warn('[change-gate] Failed to resolve approval:', e)
    }
  }

  const row = await db.changeRequest.update({
    where: { id },
    data: { status: 'rejected' },
  })

  await logAudit({
    actor: decidedBy,
    action: 'change.reject',
    target: `change:${id}`,
    meta: { decisionNote: opts.decisionNote ?? null },
  }).catch(() => {})

  return row as unknown as ChangeRow
}

// ─── markDeployed ─────────────────────────────────────────────────────

/**
 * Mark a change as deployed. Optionally link the ActionLog row that recorded
 * the actual change (so we can reverse it later via `rollbackChange`).
 */
export async function markDeployed(
  id: string,
  opts: { actionLogId?: string | null; deployedBy?: string } = {},
): Promise<ChangeRow> {
  const existing = await db.changeRequest.findUnique({ where: { id } })
  if (!existing) throw new Error(`ChangeRequest ${id} not found`)
  if (existing.status !== 'approved') {
    throw new Error(`ChangeRequest ${id} is not approved (status=${existing.status}) — deploy refused`)
  }

  const row = await db.changeRequest.update({
    where: { id },
    data: {
      status: 'deployed',
      deployedAt: new Date(),
      actionLogId: opts.actionLogId ?? existing.actionLogId ?? null,
    },
  })

  await logAudit({
    actor: opts.deployedBy ?? 'system',
    action: 'change.deploy',
    target: `change:${id}`,
    meta: { actionLogId: opts.actionLogId ?? null },
  }).catch(() => {})

  return row as unknown as ChangeRow
}

// ─── rollbackChange ───────────────────────────────────────────────────

/**
 * Roll back a deployed change. If `actionLogId` is set on the change request,
 * also triggers `reverseAction()` so the actual mutation is undone.
 */
export async function rollbackChange(
  id: string,
  opts: { rolledBy?: string; rollbackNote?: string } = {},
): Promise<{ change: ChangeRow; reversal?: unknown }> {
  const rolledBy = opts.rolledBy ?? 'operator'
  const existing = await db.changeRequest.findUnique({ where: { id } })
  if (!existing) throw new Error(`ChangeRequest ${id} not found`)
  if (existing.status !== 'deployed') {
    throw new Error(`ChangeRequest ${id} is not deployed (status=${existing.status}) — rollback refused`)
  }

  let reversal: unknown = undefined
  if (existing.actionLogId) {
    try {
      reversal = await reverseAction(existing.actionLogId, { reversedBy: rolledBy })
    } catch (e) {
      console.error('[change-gate] Reversal failed:', e)
      reversal = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  const row = await db.changeRequest.update({
    where: { id },
    data: {
      status: 'rolled-back',
      rolledBackAt: new Date(),
    },
  })

  await logAudit({
    actor: rolledBy,
    action: 'change.rollback',
    target: `change:${id}`,
    meta: { rollbackNote: opts.rollbackNote ?? null, actionLogId: existing.actionLogId, reversal },
  }).catch(() => {})

  return { change: row as unknown as ChangeRow, reversal }
}

// ─── listChanges ──────────────────────────────────────────────────────

export async function listChanges(opts: ListChangesInput = {}): Promise<{ rows: ChangeRow[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500)
  const offset = Math.max(opts.offset ?? 0, 0)
  const where: Record<string, unknown> = {}
  if (opts.status) where.status = opts.status
  if (opts.changeType) where.changeType = opts.changeType
  if (opts.scope) where.scope = opts.scope

  const [rows, total] = await Promise.all([
    db.changeRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
    db.changeRequest.count({ where }),
  ])
  return { rows: rows as unknown as ChangeRow[], total }
}

export async function getChange(id: string): Promise<ChangeRow | null> {
  const row = await db.changeRequest.findUnique({ where: { id } })
  return row as unknown as ChangeRow | null
}

// ─── getChangeStats ───────────────────────────────────────────────────

export async function getChangeStats(): Promise<ChangeStats> {
  const [total, byStatusRows, byTypeRows, byScopeRows] = await Promise.all([
    db.changeRequest.count(),
    db.changeRequest.groupBy({ by: ['status'], _count: { _all: true } }),
    db.changeRequest.groupBy({ by: ['changeType'], _count: { _all: true } }),
    db.changeRequest.groupBy({ by: ['scope'], _count: { _all: true } }),
  ])

  const byStatus: Record<string, number> = {}
  for (const r of byStatusRows) byStatus[r.status] = r._count._all

  const byChangeType: Record<string, number> = {}
  for (const r of byTypeRows) byChangeType[r.changeType] = r._count._all

  const byScope: Record<string, number> = {}
  for (const r of byScopeRows) byScope[r.scope] = r._count._all

  // Average approval time = avg(updatedAt - createdAt) for rows where status=approved OR deployed OR rolled-back.
  // We compute this by fetching those rows and averaging client-side (SQLite doesn't have native date diff in Prisma).
  const approvedRows = await db.changeRequest.findMany({
    where: { status: { in: ['approved', 'deployed', 'rolled-back'] } },
    select: { createdAt: true, updatedAt: true },
    take: 200,
  })
  let avgApprovalMs: number | null = null
  if (approvedRows.length > 0) {
    const sum = approvedRows.reduce((acc, r) => acc + (r.updatedAt.getTime() - r.createdAt.getTime()), 0)
    avgApprovalMs = Math.round(sum / approvedRows.length)
  }

  return { total, byStatus, byChangeType, byScope, avgApprovalMs }
}
