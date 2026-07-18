/**
 * audit-log.ts — Task ID 4 (PARALLEL-C — zip import)
 *
 * Structured audit logging for all admin/operator actions in JARVIS.
 * Writes to the AuditLog Prisma model for persistence and queryability.
 *
 * Adapted from the jarvis-mission-control-final zip:
 *   - uses our `db` import (src/lib/db) instead of prisma
 *   - uses our flat field names (actor/action/target/meta) instead of
 *     userId/orgId/resource/metadata
 *
 * Usage:
 *   import { logAudit } from '@/lib/audit-log'
 *   await logAudit({ actor: 'operator', action: 'agent.delete', target: 'agent:abc', req })
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

// ── Types ──────────────────────────────────────────────────────────────────

export interface AuditEntry {
  /** Who performed the action — userId, agent codename, or "operator". */
  actor?: string | null
  /** Dotted action key, e.g. "agent.create", "settings.update". */
  action: string
  /** Resource identifier, e.g. "agent:abc" or "rule:rls-1". */
  target?: string | null
  /** Contextual details (serialized to JSON). */
  meta?: Record<string, unknown> | null
  /** Optional request — used to capture IP + user-agent. */
  req?: NextRequest | null
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getIp(req?: NextRequest | null): string | null {
  if (!req) return null
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    null
  )
}

function getUserAgent(req?: NextRequest | null): string | null {
  if (!req) return null
  return req.headers.get('user-agent')?.slice(0, 500) ?? null
}

// ── Core function ──────────────────────────────────────────────────────────

/**
 * Write an audit log entry. Fire-and-forget safe — errors are swallowed
 * so audit logging never breaks the main request flow.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actor: entry.actor ?? 'operator',
        action: entry.action,
        target: entry.target ?? null,
        meta: entry.meta ? JSON.stringify(entry.meta) : '{}',
        ipAddress: getIp(entry.req),
        userAgent: getUserAgent(entry.req),
      },
    })
  } catch (err) {
    // Never let audit logging crash the main flow
    console.error('[audit-log] Failed to write audit entry:', err)
  }
}

/**
 * Convenience: log and return immediately (for use in middleware chains).
 */
export function logAuditAsync(entry: AuditEntry): void {
  logAudit(entry).catch(() => {})
}

// ── Common action constants ────────────────────────────────────────────────

export const AuditActions = {
  // Auth
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_FAILED: 'auth.failed',

  // Users / Operator
  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_DELETE: 'user.delete',
  USER_ROLE_CHANGE: 'user.role_change',

  // Agents
  AGENT_CREATE: 'agent.create',
  AGENT_UPDATE: 'agent.update',
  AGENT_DELETE: 'agent.delete',
  AGENT_RUN: 'agent.run',
  AGENT_STOP: 'agent.stop',
  AGENT_SPAWN: 'agent.spawn',

  // Skills / Pipelines
  SKILL_RUN: 'skill.run',
  PIPELINE_RUN: 'pipeline.run',
  PIPELINE_CREATE: 'pipeline.create',

  // Tasks
  TASK_CREATE: 'task.create',
  TASK_UPDATE: 'task.update',
  TASK_DELETE: 'task.delete',
  TASK_ASSIGN: 'task.assign',

  // Data Management
  DATA_SEED: 'data.seed',
  DATA_CLEAR: 'data.clear',
  BACKUP_CREATE: 'backup.create',
  BACKUP_DELETE: 'backup.delete',
  BACKUP_RESTORE: 'backup.restore',

  // Settings / Admin
  ADMIN_ACTION: 'admin.action',
  SETTINGS_UPDATE: 'settings.update',
  CRON_TOGGLE: 'cron.toggle',
  CRON_RUN: 'cron.run',
} as const

export type AuditAction = (typeof AuditActions)[keyof typeof AuditActions]
