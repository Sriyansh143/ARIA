/**
 * src/lib/audit-log.ts — Phase 29
 *
 * Comprehensive audit-trail helper with user attribution. Every mutating
 * API call (POST / PATCH / DELETE) on a sensitive resource (Approval,
 * Contract, Payment, Personnel, Credential) should call `recordAudit()`
 * to append a row to the `AuditLogEntry` table.
 *
 * DESIGN NOTES
 * ------------
 * - Append-only: no UPDATE / DELETE on AuditLogEntry rows. The Prisma
 *   schema has no delete helper exposed for this model (enforced via
 *   the source-level convention in this file — only `create` is used).
 * - PII-safe: `before` and `after` snapshots are passed through
 *   `redactSensitive()` which strips credential/password/token fields
 *   before persistence.
 * - Best-effort: failures are logged but never throw — audit logging
 *   must NOT break the underlying operation.
 * - Queryable: indexes on actor, resource, action, createdAt allow
 *   efficient filtering for compliance reports.
 */

import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export interface AuditContext {
  /** Who performed the action: "owner" | agentId | userId | "system" */
  actor: string;
  /** Actor role: "owner" | "admin" | "agent" | "system" | "user" */
  actorRole?: string;
  /** Action verb: "create" | "update" | "delete" | "approve" | "deny" | "sign" | "send" | "export" */
  action: string;
  /** Resource name: "Approval" | "Contract" | "Payment" | "Credential" */
  resource: string;
  /** Resource id (if applicable) */
  resourceId?: string;
  /** Snapshot of the resource BEFORE the change (will be redacted) */
  before?: Record<string, unknown>;
  /** Snapshot of the resource AFTER the change (will be redacted) */
  after?: Record<string, unknown>;
  /** Source: "api" | "telegram" | "cron" | "system" */
  source?: string;
  /** Request context (ip, userAgent, chatId) */
  context?: { ip?: string; userAgent?: string; chatId?: string };
}

// Fields that must be redacted from audit snapshots.
const SENSITIVE_FIELDS = new Set([
  "password",
  "passwd",
  "token",
  "secret",
  "apiKey",
  "api_key",
  "privateKey",
  "private_key",
  "stripeSecretKey",
  "telegramBotToken",
  "botToken",
  "sessionToken",
  "refreshToken",
  "verificationCode",
  "totpSecret",
  "mfaSecret",
  "credential",
  "credentials",
  "pin",
  "otp",
]);

/**
 * Recursively redact sensitive fields from an object (returns a deep copy).
 * Sensitive values are replaced with "[REDACTED]". Nested objects + arrays
 * are traversed.
 */
export function redactSensitive<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (typeof input !== "object") return input;
  if (Array.isArray(input)) {
    return input.map((item) => redactSensitive(item)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_FIELDS.has(key)) {
      out[key] = "[REDACTED]";
    } else if (value !== null && typeof value === "object") {
      out[key] = redactSensitive(value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

/**
 * Append a row to the audit log. Best-effort: errors are logged but never
 * thrown (audit logging must not break the underlying operation).
 *
 * Returns the created row id (or null on failure).
 */
export async function recordAudit(ctx: AuditContext): Promise<string | null> {
  try {
    const before = ctx.before ? JSON.stringify(redactSensitive(ctx.before)) : null;
    const after = ctx.after ? JSON.stringify(redactSensitive(ctx.after)) : null;
    const contextStr = ctx.context ? JSON.stringify(ctx.context) : "{}";

    const row = await db.auditLogEntry.create({
      data: {
        actor: ctx.actor,
        actorRole: ctx.actorRole ?? "user",
        action: ctx.action,
        resource: ctx.resource,
        resourceId: ctx.resourceId ?? "",
        before,
        after,
        source: ctx.source ?? "api",
        context: contextStr,
      },
    });
    return row.id;
  } catch (err) {
    logger.error("audit-log.record-failed", {
      actor: ctx.actor,
      action: ctx.action,
      resource: ctx.resource,
      error: String(err),
    });
    return null;
  }
}

/**
 * Query the audit log with filters. Used by the compliance dashboard +
 * the GDPR "right to access" endpoint to produce an audit trail for a
 * specific actor.
 */
export async function queryAuditLog(filters: {
  actor?: string;
  resource?: string;
  action?: string;
  since?: Date;
  until?: Date;
  limit?: number;
}): Promise<{
  id: string;
  actor: string;
  actorRole: string;
  action: string;
  resource: string;
  resourceId: string;
  before: string | null;
  after: string | null;
  source: string;
  context: string;
  createdAt: Date;
}[]> {
  const where: Record<string, unknown> = {};
  if (filters.actor) where.actor = filters.actor;
  if (filters.resource) where.resource = filters.resource;
  if (filters.action) where.action = filters.action;
  if (filters.since || filters.until) {
    where.createdAt = {
      ...(filters.since ? { gte: filters.since } : {}),
      ...(filters.until ? { lte: filters.until } : {}),
    };
  }

  return db.auditLogEntry.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(filters.limit ?? 100, 1000),
  });
}

/**
 * Get the audit trail for a specific resource (e.g. all actions ever
 * performed on a Contract). Returns entries oldest-first so the caller
 * can reconstruct the resource's history.
 */
export async function getResourceHistory(
  resource: string,
  resourceId: string,
  limit = 50,
): Promise<{
  id: string;
  actor: string;
  action: string;
  before: string | null;
  after: string | null;
  source: string;
  createdAt: Date;
}[]> {
  const rows = await db.auditLogEntry.findMany({
    where: { resource, resourceId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
  });
  return rows.reverse();
}
