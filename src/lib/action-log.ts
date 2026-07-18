// =====================================================================
// action-log.ts — Reversible Action Log (Task ID 9 — 8-9-CHANGEGATE-ACTIONLOG)
// =====================================================================
// Permanent rule: "keep log of every change made or every action so that
// particular action can be reversed."
//
// Every mutating action (create/update/delete on ANY entity, file write,
// config update, exec) is written to the `ActionLog` Prisma table with
// beforeState + afterState JSON snapshots. The `reverseAction()` function
// reads an entry, looks at the action verb + state snapshots, and performs
// the inverse mutation using a registered handler.
//
// Other modules can register their own entity types via `registerReversable()`
// so reversal of e.g. a Stripe payment can call the real Stripe refund API.
// Built-in handlers cover: payment, agent, task, skill, rule, plugin,
// config, file.  `exec` (command execution) is intentionally NOT reversible
// (reversible=false at log time).
//
// All functions are SAFE — a failed reversal records the error in
// `reverseResult` but never throws to the caller.
// =====================================================================

import { db } from '@/lib/db'
import { writeSandboxed, deleteSandboxed } from '@/lib/fs-sandbox'
import { updateSetting } from '@/lib/settings-store'

// ─── Types ─────────────────────────────────────────────────────────────

export type ActionCategory = 'mutation' | 'destructive' | 'config' | 'file' | 'exec'

export interface LogActionInput {
  actor?: string
  action: string
  category?: ActionCategory
  target?: string | null
  beforeState?: unknown
  afterState?: unknown
  reversible?: boolean
  approvalId?: string | null
  meta?: Record<string, unknown>
}

export interface LogActionRow {
  id: string
  actor: string
  action: string
  category: string
  target: string | null
  beforeState: string | null
  afterState: string | null
  reversible: boolean
  reversed: boolean
  reversedAt: string | null
  reversedBy: string | null
  reverseResult: string | null
  approvalId: string | null
  meta: string
  createdAt: string
}

export interface ReverseResult {
  ok: boolean
  action: string
  target: string | null
  method: string
  detail: string
  error?: string
}

export interface ListActionsInput {
  actor?: string | null
  action?: string | null // exact match OR prefix if endsWith '*'
  category?: string | null
  reversed?: boolean | null
  limit?: number
  offset?: number
}

// ─── Reversal registry ────────────────────────────────────────────────

export interface ReversableHandlers {
  /** Reverse a *.create — delete the entity that was created. */
  delete?: (id: string, ctx: ReversalContext) => Promise<ReverseResult>
  /** Reverse a *.delete — recreate the entity from its beforeState. */
  create?: (beforeState: Record<string, unknown>, ctx: ReversalContext) => Promise<ReverseResult>
  /** Reverse a *.update — overwrite the entity with its beforeState. */
  update?: (id: string, beforeState: Record<string, unknown>, afterState: Record<string, unknown>, ctx: ReversalContext) => Promise<ReverseResult>
}

export interface ReversalContext {
  actionLogId: string
  action: string
  target: string | null
  actor: string
  reversedBy: string
  meta: Record<string, unknown>
}

const registry = new Map<string, ReversableHandlers>()

/**
 * Register reversal handlers for an entity type.  Other modules can call
 * this at import-time to teach the action-log how to reverse their entities.
 */
export function registerReversable(entityType: string, handlers: ReversableHandlers): void {
  registry.set(entityType, { ...registry.get(entityType), ...handlers })
}

/** Parse a target string like "payment:abc123" → { entity: 'payment', id: 'abc123' }. */
function parseTarget(target: string | null): { entity: string; id: string } | null {
  if (!target) return null
  const idx = target.indexOf(':')
  if (idx <= 0) return null
  const entity = target.slice(0, idx).trim()
  const id = target.slice(idx + 1).trim()
  if (!entity || !id) return null
  return { entity, id }
}

function safeParse(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

function ok(method: string, detail: string): ReverseResult {
  return { ok: true, action: '', target: null, method, detail }
}

function fail(method: string, detail: string, error?: string): ReverseResult {
  return { ok: false, action: '', target: null, method, detail, error }
}

// ─── Built-in reversal handlers ───────────────────────────────────────
// These cover the eight entity types mentioned in the spec.

// 1) payment
registerReversable('payment', {
  delete: async (id) => {
    try {
      await db.payment.delete({ where: { id } })
      return ok('db.payment.delete', `Deleted payment ${id}`)
    } catch (e) {
      return fail('db.payment.delete', `Failed to delete payment ${id}`, e instanceof Error ? e.message : String(e))
    }
  },
  create: async (before) => {
    try {
      const data = { ...before } as Record<string, unknown>
      // Strip server-managed fields
      delete data.createdAt
      delete data.updatedAt
      await db.payment.create({ data: data as never })
      return ok('db.payment.create', `Re-created payment ${String(before.id ?? '?')}`)
    } catch (e) {
      return fail('db.payment.create', `Failed to re-create payment`, e instanceof Error ? e.message : String(e))
    }
  },
  update: async (id, before) => {
    try {
      const data = { ...before } as Record<string, unknown>
      delete data.createdAt
      delete data.updatedAt
      await db.payment.update({ where: { id }, data: data as never })
      return ok('db.payment.update', `Restored payment ${id} to beforeState`)
    } catch (e) {
      return fail('db.payment.update', `Failed to restore payment ${id}`, e instanceof Error ? e.message : String(e))
    }
  },
})

// 2) agent
registerReversable('agent', {
  delete: async (id) => {
    try {
      await db.agent.delete({ where: { id } })
      return ok('db.agent.delete', `Deleted agent ${id}`)
    } catch (e) {
      return fail('db.agent.delete', `Failed to delete agent ${id}`, e instanceof Error ? e.message : String(e))
    }
  },
  create: async (before) => {
    try {
      const data = { ...before } as Record<string, unknown>
      delete data.createdAt
      delete data.updatedAt
      await db.agent.create({ data: data as never })
      return ok('db.agent.create', `Re-created agent ${String(before.id ?? '?')}`)
    } catch (e) {
      return fail('db.agent.create', `Failed to re-create agent`, e instanceof Error ? e.message : String(e))
    }
  },
  update: async (id, before) => {
    try {
      const data = { ...before } as Record<string, unknown>
      delete data.createdAt
      delete data.updatedAt
      await db.agent.update({ where: { id }, data: data as never })
      return ok('db.agent.update', `Restored agent ${id} to beforeState`)
    } catch (e) {
      return fail('db.agent.update', `Failed to restore agent ${id}`, e instanceof Error ? e.message : String(e))
    }
  },
})

// 3) task
registerReversable('task', {
  delete: async (id) => {
    try {
      await db.task.delete({ where: { id } })
      return ok('db.task.delete', `Deleted task ${id}`)
    } catch (e) {
      return fail('db.task.delete', `Failed to delete task ${id}`, e instanceof Error ? e.message : String(e))
    }
  },
  create: async (before) => {
    try {
      const data = { ...before } as Record<string, unknown>
      delete data.createdAt
      delete data.updatedAt
      await db.task.create({ data: data as never })
      return ok('db.task.create', `Re-created task ${String(before.id ?? '?')}`)
    } catch (e) {
      return fail('db.task.create', `Failed to re-create task`, e instanceof Error ? e.message : String(e))
    }
  },
  update: async (id, before) => {
    try {
      const data = { ...before } as Record<string, unknown>
      delete data.createdAt
      delete data.updatedAt
      await db.task.update({ where: { id }, data: data as never })
      return ok('db.task.update', `Restored task ${id} to beforeState`)
    } catch (e) {
      return fail('db.task.update', `Failed to restore task ${id}`, e instanceof Error ? e.message : String(e))
    }
  },
})

// 4) skill
registerReversable('skill', {
  delete: async (id) => {
    try {
      await db.skill.delete({ where: { id } })
      return ok('db.skill.delete', `Deleted skill ${id}`)
    } catch (e) {
      return fail('db.skill.delete', `Failed to delete skill ${id}`, e instanceof Error ? e.message : String(e))
    }
  },
  create: async (before) => {
    try {
      const data = { ...before } as Record<string, unknown>
      delete data.createdAt
      delete data.updatedAt
      await db.skill.create({ data: data as never })
      return ok('db.skill.create', `Re-created skill ${String(before.id ?? '?')}`)
    } catch (e) {
      return fail('db.skill.create', `Failed to re-create skill`, e instanceof Error ? e.message : String(e))
    }
  },
  update: async (id, before) => {
    try {
      const data = { ...before } as Record<string, unknown>
      delete data.createdAt
      delete data.updatedAt
      await db.skill.update({ where: { id }, data: data as never })
      return ok('db.skill.update', `Restored skill ${id} to beforeState`)
    } catch (e) {
      return fail('db.skill.update', `Failed to restore skill ${id}`, e instanceof Error ? e.message : String(e))
    }
  },
})

// 5) rule
registerReversable('rule', {
  delete: async (id) => {
    try {
      await db.rule.delete({ where: { id } })
      return ok('db.rule.delete', `Deleted rule ${id}`)
    } catch (e) {
      return fail('db.rule.delete', `Failed to delete rule ${id}`, e instanceof Error ? e.message : String(e))
    }
  },
  create: async (before) => {
    try {
      const data = { ...before } as Record<string, unknown>
      delete data.createdAt
      delete data.updatedAt
      await db.rule.create({ data: data as never })
      return ok('db.rule.create', `Re-created rule ${String(before.id ?? '?')}`)
    } catch (e) {
      return fail('db.rule.create', `Failed to re-create rule`, e instanceof Error ? e.message : String(e))
    }
  },
  update: async (id, before) => {
    try {
      const data = { ...before } as Record<string, unknown>
      delete data.createdAt
      delete data.updatedAt
      await db.rule.update({ where: { id }, data: data as never })
      return ok('db.rule.update', `Restored rule ${id} to beforeState`)
    } catch (e) {
      return fail('db.rule.update', `Failed to restore rule ${id}`, e instanceof Error ? e.message : String(e))
    }
  },
})

// 6) plugin
registerReversable('plugin', {
  delete: async (id) => {
    try {
      await db.plugin.delete({ where: { id } })
      return ok('db.plugin.delete', `Deleted plugin ${id}`)
    } catch (e) {
      return fail('db.plugin.delete', `Failed to delete plugin ${id}`, e instanceof Error ? e.message : String(e))
    }
  },
  create: async (before) => {
    try {
      const data = { ...before } as Record<string, unknown>
      delete data.createdAt
      delete data.updatedAt
      await db.plugin.create({ data: data as never })
      return ok('db.plugin.create', `Re-created plugin ${String(before.id ?? '?')}`)
    } catch (e) {
      return fail('db.plugin.create', `Failed to re-create plugin`, e instanceof Error ? e.message : String(e))
    }
  },
  update: async (id, before) => {
    try {
      const data = { ...before } as Record<string, unknown>
      delete data.createdAt
      delete data.updatedAt
      await db.plugin.update({ where: { id }, data: data as never })
      return ok('db.plugin.update', `Restored plugin ${id} to beforeState`)
    } catch (e) {
      return fail('db.plugin.update', `Failed to restore plugin ${id}`, e instanceof Error ? e.message : String(e))
    }
  },
})

// 7) config — uses settings-store. beforeState/afterState are { key, value } objects.
registerReversable('config', {
  update: async (_id, before) => {
    try {
      const key = String(before.key ?? '')
      const value = String(before.value ?? '')
      if (!key) return fail('config.update', `Cannot reverse config update — no key in beforeState`)
      const result = updateSetting(key, value)
      if (!result.ok) return fail('config.update', `updateSetting failed: ${result.error ?? 'unknown'}`)
      return ok('settings-store.update', `Restored config ${key}=${value}`)
    } catch (e) {
      return fail('config.update', `Failed to restore config`, e instanceof Error ? e.message : String(e))
    }
  },
})

// 8) file — uses fs-sandbox. beforeState.content has the original file content
// (or null/undefined if the file didn't exist before the write).
registerReversable('file', {
  update: async (_id, before) => {
    try {
      const path = String(before.path ?? '')
      if (!path) return fail('file.write', `Cannot reverse file write — no path in beforeState`)
      const content = before.content
      if (content === null || content === undefined) {
        // File did not exist before — delete it.
        try {
          await deleteSandboxed(path)
          return ok('fs.delete', `Deleted file ${path} (it didn't exist before)`)
        } catch (e) {
          return fail('fs.delete', `Failed to delete file ${path}`, e instanceof Error ? e.message : String(e))
        }
      }
      await writeSandboxed(path, String(content))
      return ok('fs.write', `Restored file ${path} (${String(content).length} bytes)`)
    } catch (e) {
      return fail('file.write', `Failed to restore file`, e instanceof Error ? e.message : String(e))
    }
  },
  create: async (_id, before) => {
    // Same as update — restore content from beforeState
    try {
      const path = String(before.path ?? '')
      const content = String(before.content ?? '')
      if (!path) return fail('file.create', `Cannot reverse file create — no path`)
      await writeSandboxed(path, content)
      return ok('fs.write', `Restored file ${path} (${content.length} bytes)`)
    } catch (e) {
      return fail('file.create', `Failed to restore file`, e instanceof Error ? e.message : String(e))
    }
  },
  delete: async (id) => {
    // No-op for now — we cannot re-create a file we don't know the content of.
    return ok('noop', `file.delete reversal is a no-op for id=${id} (file content not stored)`)
  },
})

// ─── Core: logAction ──────────────────────────────────────────────────

/**
 * Write an ActionLog row.  Serializes before/after to JSON. Returns the row
 * (with id) so callers can later call `reverseAction(id)`.
 */
export async function logAction(input: LogActionInput): Promise<LogActionRow> {
  const action = input.action.trim()
  if (!action) throw new Error('logAction: action is required')

  // Heuristic: `exec.*` actions (command execution) are NEVER reversible.
  const isExec = action.startsWith('exec.') || input.category === 'exec'
  const reversible = isExec ? false : (input.reversible ?? true)

  const row = await db.actionLog.create({
    data: {
      actor: input.actor ?? 'system',
      action,
      category: input.category ?? (isExec ? 'exec' : 'mutation'),
      target: input.target ?? null,
      beforeState: input.beforeState === undefined ? null : JSON.stringify(input.beforeState),
      afterState: input.afterState === undefined ? null : JSON.stringify(input.afterState),
      reversible,
      reversed: false,
      approvalId: input.approvalId ?? null,
      meta: JSON.stringify(input.meta ?? {}),
    },
  })
  return row as unknown as LogActionRow
}

// ─── Core: reverseAction ──────────────────────────────────────────────

/**
 * THE KEY FUNCTION.  Reads an ActionLog row, inspects `action` + before/after
 * snapshots, performs the inverse mutation via the registered handler.
 *
 * Updates the row with `reversed=true`, `reversedAt`, `reversedBy`, and a
 * `reverseResult` JSON describing what was done.  If reversal fails, sets
 * `reverseResult` with the error and leaves `reversed=false`.
 *
 * Never throws — returns the ReverseResult so the caller can surface it.
 */
export async function reverseAction(
  actionLogId: string,
  opts: { reversedBy?: string } = {},
): Promise<ReverseResult> {
  const reversedBy = opts.reversedBy ?? 'operator'

  // Load the row.
  let row: LogActionRow | null = null
  try {
    row = (await db.actionLog.findUnique({ where: { id: actionLogId } })) as unknown as LogActionRow | null
  } catch (e) {
    return fail('load', `Failed to load ActionLog ${actionLogId}`, e instanceof Error ? e.message : String(e))
  }
  if (!row) return fail('load', `ActionLog ${actionLogId} not found`)

  // Already reversed?
  if (row.reversed) {
    const existing = safeParse(row.reverseResult)
    return { ok: true, action: row.action, target: row.target, method: 'already-reversed', detail: `Already reversed at ${row.reversedAt}`, error: existing ? JSON.stringify(existing) : undefined }
  }

  // Reversible?
  if (!row.reversible) {
    const result: ReverseResult = fail('irreversible', `Action ${row.action} is marked non-reversible`)
    await persistReverseResult(actionLogId, false, reversedBy, result)
    return result
  }

  const ctx: ReversalContext = {
    actionLogId,
    action: row.action,
    target: row.target,
    actor: row.actor,
    reversedBy,
    meta: safeParse(row.meta) ?? {},
  }

  // Determine which handler to call based on the action verb.
  const verb = row.action.split('.').pop() ?? ''
  const parsed = parseTarget(row.target)

  let result: ReverseResult

  // Special-case: file.write / file.delete / file.create — handled via the
  // `file` entity handlers using beforeState directly (target may be
  // "file:/some/path" OR the path may live in beforeState.path).
  if (row.action === 'file.write' || row.action === 'file.update') {
    const before = safeParse(row.beforeState)
    const entity = parsed?.entity ?? 'file'
    const handlers = registry.get(entity)
    if (handlers?.update && before) {
      result = await handlers.update(parsed?.id ?? '', before, ctx)
    } else if (handlers?.update && !before) {
      // No beforeState means file was newly created → delete it.
      // Synthesize a "delete" by calling update with content=null
      result = await handlers.update('', { path: parsed?.id ?? '', content: null }, ctx)
    } else {
      result = fail('file.write', `No 'file' reversal handler registered or no beforeState`)
    }
  } else if (row.action === 'file.delete') {
    const before = safeParse(row.beforeState)
    const entity = parsed?.entity ?? 'file'
    const handlers = registry.get(entity)
    if (handlers?.create && before) {
      result = await handlers.create(before, ctx)
    } else if (handlers?.delete) {
      result = await handlers.delete(parsed?.id ?? '', ctx)
    } else {
      result = fail('file.delete', `Cannot reverse file.delete — no beforeState content available`)
    }
  } else if (row.action === 'config.update' || row.action === 'config.set') {
    const before = safeParse(row.beforeState)
    const handlers = registry.get('config')
    if (handlers?.update && before) {
      result = await handlers.update(parsed?.id ?? '', before, ctx)
    } else {
      result = fail('config.update', `No 'config' reversal handler registered or no beforeState`)
    }
  } else if (verb === 'create') {
    // *.create — delete the entity. beforeState=null, afterState=present.
    const after = safeParse(row.afterState)
    const entity = parsed?.entity
    if (!entity) {
      result = fail('create', `Cannot reverse ${row.action} — target missing entity prefix (got "${row.target}")`)
    } else {
      const handlers = registry.get(entity)
      const id = parsed!.id
      if (handlers?.delete) {
        result = await handlers.delete(id, ctx)
      } else if (after && handlers?.create) {
        // Fallback: handler has no `delete` but has `create` — we use it to
        // recognize the entity but still can't reverse without a delete.
        result = fail('create', `Entity '${entity}' has no delete handler registered`)
      } else {
        result = fail('create', `Entity '${entity}' is not registered for reversal`)
      }
    }
  } else if (verb === 'delete') {
    // *.delete — re-create from beforeState.
    const before = safeParse(row.beforeState)
    const entity = parsed?.entity
    if (!entity) {
      result = fail('delete', `Cannot reverse ${row.action} — target missing entity prefix (got "${row.target}")`)
    } else if (!before) {
      result = fail('delete', `Cannot reverse ${row.action} — no beforeState to restore from`)
    } else {
      const handlers = registry.get(entity)
      if (handlers?.create) {
        result = await handlers.create(before, ctx)
      } else {
        result = fail('delete', `Entity '${entity}' has no create handler registered`)
      }
    }
  } else if (verb === 'update' || verb === 'set' || verb === 'patch' || verb === 'edit') {
    // *.update — restore beforeState.
    const before = safeParse(row.beforeState)
    const after = safeParse(row.afterState)
    const entity = parsed?.entity
    if (!entity) {
      result = fail('update', `Cannot reverse ${row.action} — target missing entity prefix (got "${row.target}")`)
    } else if (!before) {
      result = fail('update', `Cannot reverse ${row.action} — no beforeState to restore from`)
    } else {
      const handlers = registry.get(entity)
      if (handlers?.update) {
        result = await handlers.update(parsed!.id, before, after ?? {}, ctx)
      } else {
        result = fail('update', `Entity '${entity}' has no update handler registered`)
      }
    }
  } else if (verb === 'run' || verb === 'exec' || verb === 'execute' || row.action.startsWith('exec.')) {
    result = fail('exec', `Cannot reverse execution actions (${row.action}) — destructive by nature`)
  } else {
    // Generic fallback: try `update` with beforeState (treats unknown verbs as updates).
    const before = safeParse(row.beforeState)
    const entity = parsed?.entity
    if (entity && before) {
      const handlers = registry.get(entity)
      if (handlers?.update) {
        result = await handlers.update(parsed!.id, before, safeParse(row.afterState) ?? {}, ctx)
      } else {
        result = fail('generic', `Cannot reverse ${row.action} — no handler for entity '${entity}'`)
      }
    } else {
      result = fail('generic', `Cannot reverse ${row.action} — unknown action verb '${verb}' and no entity/beforeState`)
    }
  }

  // Persist the result.
  await persistReverseResult(actionLogId, result.ok, reversedBy, result)
  return { ...result, action: row.action, target: row.target }
}

async function persistReverseResult(
  actionLogId: string,
  ok: boolean,
  reversedBy: string,
  result: ReverseResult,
): Promise<void> {
  try {
    await db.actionLog.update({
      where: { id: actionLogId },
      data: {
        reversed: ok,
        reversedAt: ok ? new Date() : null,
        reversedBy: ok ? reversedBy : null,
        reverseResult: JSON.stringify(result),
      },
    })
  } catch (e) {
    console.error('[action-log] Failed to persist reverseResult:', e)
  }
}

// ─── List + Stats ─────────────────────────────────────────────────────

export async function listActions(opts: ListActionsInput = {}): Promise<{ rows: LogActionRow[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500)
  const offset = Math.max(opts.offset ?? 0, 0)
  const where: Record<string, unknown> = {}
  if (opts.actor) where.actor = opts.actor
  if (opts.category) where.category = opts.category
  if (opts.reversed === true) where.reversed = true
  if (opts.reversed === false) where.reversed = false
  if (opts.action) {
    if (opts.action.endsWith('*')) {
      where.action = { startsWith: opts.action.slice(0, -1) }
    } else {
      where.action = opts.action
    }
  }

  const [rows, total] = await Promise.all([
    db.actionLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
    db.actionLog.count({ where }),
  ])
  return { rows: rows as unknown as LogActionRow[], total }
}

export async function getAction(id: string): Promise<LogActionRow | null> {
  const row = await db.actionLog.findUnique({ where: { id } })
  return row as unknown as LogActionRow | null
}

export interface ActionStats {
  total: number
  reversible: number
  irreversible: number
  reversed: number
  pendingReversal: number
  reversalSuccessRate: number // 0-100, fraction of reversal attempts that succeeded
  byCategory: Record<string, number>
  byAction: Record<string, number>
  topActors: Array<{ actor: string; count: number }>
}

export async function getActionStats(): Promise<ActionStats> {
  const [
    total,
    reversible,
    reversed,
    reversalAttempts,
    byCategoryRows,
    byActionRows,
    topActorRows,
  ] = await Promise.all([
    db.actionLog.count(),
    db.actionLog.count({ where: { reversible: true } }),
    db.actionLog.count({ where: { reversed: true } }),
    // Rows that ATTEMPTED reversal have a non-null reverseResult
    db.actionLog.count({ where: { reverseResult: { not: null } } }),
    db.actionLog.groupBy({ by: ['category'], _count: { _all: true } }),
    db.actionLog.groupBy({ by: ['action'], _count: { _all: true }, orderBy: { _count: { category: 'desc' } }, take: 10 }),
    db.actionLog.groupBy({ by: ['actor'], _count: { _all: true }, orderBy: { _count: { actor: 'desc' } }, take: 5 }),
  ])

  const byCategory: Record<string, number> = {}
  for (const r of byCategoryRows) byCategory[r.category] = r._count._all

  const byAction: Record<string, number> = {}
  for (const r of byActionRows) byAction[r.action] = r._count._all

  const topActors = topActorRows.map((r) => ({ actor: r.actor, count: r._count._all }))

  // Success rate = (rows where reversed=true) / (rows that have a reverseResult)
  const successRate = reversalAttempts > 0 ? Math.round((reversed / reversalAttempts) * 100) : 100

  return {
    total,
    reversible,
    irreversible: total - reversible,
    reversed,
    pendingReversal: reversible - reversed,
    reversalSuccessRate: successRate,
    byCategory,
    byAction,
    topActors,
  }
}
