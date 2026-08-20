/**
 * src/lib/gdpr.ts — Phase 29
 *
 * GDPR Data Subject Request (DSR) handler. Supports the four GDPR rights:
 *
 *   1. access         — owner/user requests a copy of their personal data.
 *   2. erasure        — "right to be forgotten" — personal data is purged.
 *   3. portability    — owner/user requests an export in a portable format.
 *   4. rectification  — owner/user requests a correction to their data.
 *
 * WORKFLOW
 * --------
 *   1. Owner submits a DSR via POST /api/gdpr/request (with subject + type).
 *   2. A DataSubjectRequest row is created with status="pending".
 *   3. For "access" / "portability" — the data is collected + the row is
 *      marked "completed" with the affectedRecords JSON populated.
 *   4. For "erasure" — the row is marked "verified" and a scheduledPurgeAt
 *      timestamp is set (default: 7 days from now, configurable). The
 *      actual purge runs via a cron handler.
 *   5. For "rectification" — the row is marked "pending" and a human
 *      reviews it (no auto-action).
 *
 * DESIGN NOTES
 * ------------
 * - Erasure respects a configurable grace window (GDPR_ARTICLE_17_GRACE_DAYS
 *   env var, default 7) so the owner can cancel accidental requests.
 * - Erasure scrubs PII fields (email, phone, name) on Lead, ImportedContact,
 *   Personnel, ClientPortalAccess, etc. — but PRESERVES audit log entries
 *   (which are required by law to be retained for 7 years for financial
 *   records). The audit log instead has the actor field anonymized.
 * - Access / portability return a JSON snapshot of all tables where the
 *   subject's identifier appears.
 */

import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export type DsrType = "access" | "erasure" | "portability" | "rectification";

export interface DsrSubmission {
  type: DsrType;
  subject: string; // email | telegramHandle | phone
  requestedBy?: string; // owner | userId — who submitted the request
  reason?: string;
}

export interface DsrResult {
  id: string;
  status: string;
  affectedRecords: Record<string, number>;
  scheduledPurgeAt?: string;
  exportData?: Record<string, unknown>; // for access / portability
}

const DEFAULT_GRACE_DAYS = 7;

function graceWindowDays(): number {
  const raw = process.env.GDPR_ARTICLE_17_GRACE_DAYS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 90 ? parsed : DEFAULT_GRACE_DAYS;
}

/**
 * Submit a new DSR. Creates a DataSubjectRequest row + immediately
 * processes access / portability (synchronous — they're read-only).
 *
 * Erasure requests are scheduled for the grace window + marked "verified"
 * so the cron handler can pick them up after the grace expires.
 */
export async function submitDsr(submission: DsrSubmission): Promise<DsrResult> {
  const row = await db.dataSubjectRequest.create({
    data: {
      type: submission.type,
      subject: submission.subject,
      status: "pending",
    },
  });

  try {
    switch (submission.type) {
      case "access":
      case "portability": {
        const exportData = await collectSubjectData(submission.subject);
        const affected: Record<string, number> = {};
        for (const [table, rows] of Object.entries(exportData)) {
          if (Array.isArray(rows)) affected[table] = rows.length;
        }
        await db.dataSubjectRequest.update({
          where: { id: row.id },
          data: {
            status: "completed",
            affectedRecords: JSON.stringify(affected),
            completedAt: new Date(),
          },
        });
        return {
          id: row.id,
          status: "completed",
          affectedRecords: affected,
          exportData,
        };
      }
      case "erasure": {
        const purgeAt = new Date(Date.now() + graceWindowDays() * 24 * 60 * 60 * 1000);
        await db.dataSubjectRequest.update({
          where: { id: row.id },
          data: {
            status: "verified",
            scheduledPurgeAt: purgeAt,
          },
        });
        return {
          id: row.id,
          status: "verified",
          affectedRecords: {},
          scheduledPurgeAt: purgeAt.toISOString(),
        };
      }
      case "rectification":
      default: {
        // Manual review — leave as "pending" until owner acts on it.
        return {
          id: row.id,
          status: "pending",
          affectedRecords: {},
        };
      }
    }
  } catch (err) {
    logger.error("gdpr.submit-failed", { id: row.id, error: String(err) });
    await db.dataSubjectRequest.update({
      where: { id: row.id },
      data: { status: "rejected" },
    });
    throw err;
  }
}

/**
 * Collect all data associated with a subject across all tables where
 * their identifier (email / phone / telegram handle) may appear.
 *
 * Used by "access" and "portability" DSRs. Returns a JSON-serializable
 * object keyed by table name.
 *
 * NOTE: PII fields (email, phone, name) are included verbatim — this
 * IS the data subject's own data. They have a right to see it.
 */
export async function collectSubjectData(subject: string): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  const subj = subject.toLowerCase();

  // Lead stores identity in `username` (social handle or email) or `displayName`.
  try {
    const leads = await db.lead.findMany({
      where: {
        OR: [
          { username: { contains: subj } },
          { displayName: { contains: subj } },
        ],
      },
      take: 500,
    });
    if (leads.length) out.Lead = leads;
  } catch { /* table may not exist in this env */ }

  // ImportedContact has email + phone columns.
  try {
    const contacts = await db.importedContact.findMany({
      where: {
        OR: [
          { email: { contains: subj } },
          { phone: { contains: subj } },
        ],
      },
      take: 500,
    });
    if (contacts.length) out.ImportedContact = contacts;
  } catch { /* ignore */ }

  // Personnel only has `name` (no email/phone in the current schema).
  try {
    const personnel = await db.personnel.findMany({
      where: { name: { contains: subj } },
      take: 500,
    });
    if (personnel.length) out.Personnel = personnel;
  } catch { /* ignore */ }

  // ClientPortalAccess uses `clientEmail` + `clientName`.
  try {
    const portal = await db.clientPortalAccess.findMany({
      where: {
        OR: [
          { clientEmail: { contains: subj } },
          { clientName: { contains: subj } },
        ],
      },
      take: 500,
    });
    if (portal.length) out.ClientPortalAccess = portal;
  } catch { /* ignore */ }

  try {
    const users = await db.user.findMany({
      where: { email: { contains: subj } },
      take: 500,
    });
    if (users.length) out.User = users;
  } catch { /* ignore */ }

  // Audit log entries where the subject was the actor.
  try {
    const audit = await db.auditLogEntry.findMany({
      where: { actor: { contains: subj } },
      take: 1000,
    });
    if (audit.length) out.AuditLogEntry = audit;
  } catch { /* ignore */ }

  return out;
}

/**
 * Execute a pending erasure request (called by the cron handler after the
 * grace window expires). Scrubs PII from all tables where the subject's
 * identifier appears, then marks the request "completed".
 *
 * Audit log entries are NOT deleted — they are required by law to be
 * retained for 7 years for financial records. Instead, the `actor` field
 * is anonymized to "subject-erased:<requestId>".
 */
export async function executeErasure(requestId: string): Promise<DsrResult> {
  const row = await db.dataSubjectRequest.findUnique({ where: { id: requestId } });
  if (!row) throw new Error(`DSR ${requestId} not found`);
  if (row.type !== "erasure") throw new Error(`DSR ${requestId} is not an erasure request`);
  if (row.status === "completed") return { id: row.id, status: "completed", affectedRecords: JSON.parse(row.affectedRecords || "{}") };

  await db.dataSubjectRequest.update({
    where: { id: requestId },
    data: { status: "processing" },
  });

  const affected: Record<string, number> = {};
  const subj = row.subject.toLowerCase();

  // 1. Scrub Lead rows (identity in `username` + `displayName`).
  try {
    const leads = await db.lead.findMany({
      where: { OR: [{ username: { contains: subj } }, { displayName: { contains: subj } }] },
      take: 1000,
    });
    if (leads.length) {
      await db.lead.updateMany({
        where: { id: { in: leads.map((l) => l.id) } },
        data: { username: "[erased]", displayName: "[erased]" },
      });
      affected.Lead = leads.length;
    }
  } catch (err) { logger.warn("gdpr.erase-leads-failed", { error: String(err) }); }

  // 2. Scrub ImportedContact rows.
  try {
    const contacts = await db.importedContact.findMany({
      where: { OR: [{ email: { contains: subj } }, { phone: { contains: subj } }] },
      take: 1000,
    });
    if (contacts.length) {
      await db.importedContact.updateMany({
        where: { id: { in: contacts.map((c) => c.id) } },
        data: { email: "[erased]", phone: "[erased]", name: "[erased]" },
      });
      affected.ImportedContact = contacts.length;
    }
  } catch (err) { logger.warn("gdpr.erase-contacts-failed", { error: String(err) }); }

  // 3. Scrub Personnel rows (only `name` available in the current schema).
  try {
    const personnel = await db.personnel.findMany({
      where: { name: { contains: subj } },
      take: 1000,
    });
    if (personnel.length) {
      await db.personnel.updateMany({
        where: { id: { in: personnel.map((p) => p.id) } },
        data: { name: "[erased]" },
      });
      affected.Personnel = personnel.length;
    }
  } catch (err) { logger.warn("gdpr.erase-personnel-failed", { error: String(err) }); }

  // 4. Scrub ClientPortalAccess rows (clientEmail + clientName + token).
  try {
    const portal = await db.clientPortalAccess.findMany({
      where: { OR: [{ clientEmail: { contains: subj } }, { clientName: { contains: subj } }] },
      take: 1000,
    });
    if (portal.length) {
      await db.clientPortalAccess.updateMany({
        where: { id: { in: portal.map((p) => p.id) } },
        data: { clientEmail: "[erased]", clientName: "[erased]", token: "[erased]" },
      });
      affected.ClientPortalAccess = portal.length;
    }
  } catch (err) { logger.warn("gdpr.erase-portal-failed", { error: String(err) }); }

  // 5. Scrub User rows.
  try {
    const users = await db.user.findMany({ where: { email: { contains: subj } }, take: 1000 });
    if (users.length) {
      await db.user.updateMany({
        where: { id: { in: users.map((u) => u.id) } },
        data: { email: "[erased]", name: "[erased]" },
      });
      affected.User = users.length;
    }
  } catch (err) { logger.warn("gdpr.erase-users-failed", { error: String(err) }); }

  // 6. Anonymize AuditLogEntry.actor (do NOT delete — required for 7-year retention).
  try {
    const audit = await db.auditLogEntry.findMany({
      where: { actor: { contains: subj } },
      take: 5000,
    });
    if (audit.length) {
      await db.auditLogEntry.updateMany({
        where: { id: { in: audit.map((a) => a.id) } },
        data: { actor: `subject-erased:${requestId}` },
      });
      affected.AuditLogEntry = audit.length;
    }
  } catch (err) { logger.warn("gdpr.anonymize-audit-failed", { error: String(err) }); }

  await db.dataSubjectRequest.update({
    where: { id: requestId },
    data: {
      status: "completed",
      affectedRecords: JSON.stringify(affected),
      completedAt: new Date(),
    },
  });

  logger.info("gdpr.erasure-completed", { requestId, affected });

  return { id: requestId, status: "completed", affectedRecords: affected };
}

/**
 * Cron handler: process all erasure requests whose grace window has
 * expired. Called by the daily cron job.
 */
export async function processExpiredErasureRequests(): Promise<{ processed: number; results: DsrResult[] }> {
  const expired = await db.dataSubjectRequest.findMany({
    where: {
      type: "erasure",
      status: "verified",
      scheduledPurgeAt: { lte: new Date() },
    },
    take: 50,
  });

  const results: DsrResult[] = [];
  for (const row of expired) {
    try {
      const result = await executeErasure(row.id);
      results.push(result);
    } catch (err) {
      logger.error("gdpr.cron-erasure-failed", { id: row.id, error: String(err) });
    }
  }

  return { processed: results.length, results };
}
