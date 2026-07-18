// =====================================================================
// approval-escalation.ts — ApprovalRequest lifecycle + escalation engine.
// =====================================================================
// Task ID: 3-ESCALATION
//
// Manages the full lifecycle of an ApprovalRequest:
//   create  → resolve  → escalate (Telegram → Email → Voice call) → expire
//
// The escalation ladder fires whenever a pending approval's
// `nextEscalateAt` falls due:
//   Level 1 (after timeoutMinutes): Telegram + bell notification
//   Level 2 (after another timeout): Telegram + Email + bell (critical)
//   Level 3 (final, after another timeout): Telegram + Email + Voice call
//                                            + auto-expire if expiresAt passed
//
// All channels (Telegram / Email / FreeSWITCH) are wrapped in try/catch
// — a downstream failure never blocks the escalation step itself.
// Every escalation attempt is logged via `logAudit()`.
// =====================================================================

import { db } from '@/lib/db';
import type { ApprovalRequest } from '@prisma/client';
import { logAudit } from '@/lib/audit-log';
import { getBrandingConfig } from '@/lib/branding';
import { sendToOwner } from '@/lib/telegram-bot';
import { sendToOwnerEmail } from '@/lib/email-sender';

// ─── Types ────────────────────────────────────────────────────────────

export type ApprovalCategory =
  | 'app-change'
  | 'payment-refund'
  | 'earning-deploy'
  | 'agent-spawn'
  | 'plan-step'
  | 'destructive-cmd'
  | 'other';

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'superseded';

export interface CreateApprovalInput {
  category?: ApprovalCategory | string;
  title: string;
  description: string;
  requestedBy?: string;
  payload?: Record<string, unknown> | null;
  /** Override the default escalation window (minutes). */
  timeoutMinutes?: number;
}

export interface ResolveApprovalInput {
  decision: 'approved' | 'rejected';
  decidedBy?: string;
  decisionNote?: string;
}

export interface ListApprovalsFilter {
  status?: ApprovalStatus | string;
  category?: ApprovalCategory | string;
  limit?: number;
}

export interface ApprovalStats {
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  pending: number;
  escalating: number; // pending + escalationLevel > 0
  escalatedTotal: number; // lifetime escalation count
  approvedToday: number;
  rejectedToday: number;
  expiredTotal: number;
  avgResponseMinutes: number | null; // resolvedAt - createdAt, averaged
  oldestPendingMinutes: number | null; // age of oldest pending approval
}

// ─── Constants ────────────────────────────────────────────────────────

const MAX_ESCALATION_LEVEL = 3;
const DEFAULT_EXPIRY_HOURS = 24;

// ─── Helpers ──────────────────────────────────────────────────────────

async function getDefaultTimeoutMinutes(): Promise<number> {
  try {
    const cfg = await getBrandingConfig();
    const m = cfg.ownerEscalationMinutes;
    return typeof m === 'number' && m > 0 ? m : 30;
  } catch {
    return 30;
  }
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
}

// ─── createApproval ──────────────────────────────────────────────────

export async function createApproval(
  input: CreateApprovalInput,
): Promise<{ ok: boolean; approval?: ApprovalRequest; error?: string }> {
  try {
    if (!input.title?.trim() || !input.description?.trim()) {
      return { ok: false, error: 'title and description are required' };
    }
    const timeoutMinutes =
      typeof input.timeoutMinutes === 'number' && input.timeoutMinutes > 0
        ? input.timeoutMinutes
        : await getDefaultTimeoutMinutes();

    const now = new Date();
    const nextEscalateAt = addMinutes(now, timeoutMinutes);
    const expiresAt = addMinutes(now, DEFAULT_EXPIRY_HOURS * 60);

    const payloadStr = safeJsonStringify(input.payload ?? {});

    const approval = await db.approvalRequest.create({
      data: {
        category: input.category ?? 'other',
        title: input.title.trim(),
        description: input.description.trim(),
        requestedBy: input.requestedBy?.trim() || 'system',
        payload: payloadStr,
        status: 'pending',
        escalationLevel: 0,
        nextEscalateAt,
        expiresAt,
      },
    });

    // Surface in the bell notification.
    try {
      await db.notification.create({
        data: {
          type: 'approval-required',
          title: `Approval required · ${approval.title}`,
          message: approval.description.slice(0, 280),
          read: false,
        },
      });
    } catch {
      // Non-fatal — approval still exists.
    }

    // Best-effort Telegram ping (immediate, not the escalation ladder).
    try {
      const msg =
        `🔔 *New Approval Required*\n\n` +
        `*${approval.title}*\n` +
        `Category: \`${approval.category}\`\n` +
        `Requested by: \`${approval.requestedBy}\`\n\n` +
        `${approval.description.slice(0, 600)}\n\n` +
        `You will be reminded again in ${timeoutMinutes} min if not actioned.`;
      await sendToOwner(msg);
    } catch {
      // Non-fatal.
    }

    await logAudit({
      actor: approval.requestedBy,
      action: 'approval.create',
      target: `approval:${approval.id}`,
      meta: {
        category: approval.category,
        title: approval.title,
        timeoutMinutes,
        nextEscalateAt: nextEscalateAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    });

    return { ok: true, approval };
  } catch (err) {
    return {
      ok: false,
      error: `createApproval failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── resolveApproval ─────────────────────────────────────────────────

export async function resolveApproval(
  id: string,
  input: ResolveApprovalInput,
): Promise<{ ok: boolean; approval?: ApprovalRequest; error?: string }> {
  try {
    if (input.decision !== 'approved' && input.decision !== 'rejected') {
      return { ok: false, error: 'decision must be approved or rejected' };
    }
    const existing = await db.approvalRequest.findUnique({ where: { id } });
    if (!existing) {
      return { ok: false, error: 'approval not found' };
    }
    if (existing.status !== 'pending') {
      return { ok: false, error: `approval is already ${existing.status}` };
    }

    const now = new Date();
    const updated = await db.approvalRequest.update({
      where: { id },
      data: {
        status: input.decision,
        decidedBy: input.decidedBy?.trim() || 'operator',
        decisionNote: input.decisionNote?.trim() || null,
        resolvedAt: now,
        nextEscalateAt: null, // no further escalation once resolved
      },
    });

    // Follow-up notification in the bell.
    try {
      await db.notification.create({
        data: {
          type: input.decision === 'approved' ? 'success' : 'warn',
          title: `Approval ${input.decision.toUpperCase()} · ${updated.title}`,
          message:
            `Decided by ${updated.decidedBy}.` +
            (updated.decisionNote ? ` Note: ${updated.decisionNote.slice(0, 200)}` : ''),
          read: false,
        },
      });
    } catch {
      // Non-fatal.
    }

    await logAudit({
      actor: updated.decidedBy ?? 'operator',
      action: `approval.${input.decision}`,
      target: `approval:${id}`,
      meta: {
        title: updated.title,
        category: updated.category,
        note: updated.decisionNote ?? null,
        escalationLevel: updated.escalationLevel,
      },
    });

    return { ok: true, approval: updated };
  } catch (err) {
    return {
      ok: false,
      error: `resolveApproval failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── escalatePendingApprovals ────────────────────────────────────────
//
// THE KEY FUNCTION. Finds all ApprovalRequests where:
//   status='pending' AND nextEscalateAt <= now
//
// For each one:
//   - Increments escalationLevel (max 3).
//   - Level 1: Telegram + urgent notification.
//   - Level 2: Telegram + Email + critical notification.
//   - Level 3 (final): Telegram + Email + Voice call attempt.
//                      If expiresAt < now, mark as expired.
//   - Sets lastEscalatedAt, recomputes nextEscalateAt.
//   - All attempts recorded via logAudit.
//
// Channels are isolated — a Telegram failure does not block the Email.

export async function escalatePendingApprovals(): Promise<{
  ok: boolean;
  escalated: number;
  expired: number;
  details: Array<{ id: string; title: string; level: number; channels: string[]; expired: boolean }>;
  error?: string;
}> {
  const details: Array<{ id: string; title: string; level: number; channels: string[]; expired: boolean }> = [];
  let escalated = 0;
  let expired = 0;

  try {
    const now = new Date();
    const due = await db.approvalRequest.findMany({
      where: {
        status: 'pending',
        nextEscalateAt: { lte: now },
      },
      orderBy: { nextEscalateAt: 'asc' },
      take: 50, // bounded batch per tick
    });

    if (due.length === 0) {
      return { ok: true, escalated: 0, expired: 0, details };
    }

    const defaultTimeout = await getDefaultTimeoutMinutes();
    const branding = await getBrandingConfig().catch(() => null);

    for (const apv of due) {
      const nextLevel = Math.min(MAX_ESCALATION_LEVEL, apv.escalationLevel + 1);
      const channels: string[] = [];

      // ─── Level 1: Telegram + bell ──────────────────────────────────
      if (nextLevel >= 1) {
        try {
          const msg =
            `⚠️ *Approval Reminder (Level ${nextLevel}/3)*\n\n` +
            `*${apv.title}*\n` +
            `Category: \`${apv.category}\`\n` +
            `Requested by: \`${apv.requestedBy}\`\n` +
            `Age: ${Math.round((now.getTime() - apv.createdAt.getTime()) / 60000)} min\n\n` +
            `${apv.description.slice(0, 600)}`;
          const ok = await sendToOwner(msg);
          if (ok) channels.push('telegram');
        } catch {
          // Non-fatal.
        }
      }

      // ─── Level 2: + Email ──────────────────────────────────────────
      if (nextLevel >= 2) {
        try {
          const subject = `[JARVIS · L2] Approval required: ${apv.title}`;
          const body =
            `Approval escalation Level 2\n\n` +
            `Title: ${apv.title}\n` +
            `Category: ${apv.category}\n` +
            `Requested by: ${apv.requestedBy}\n` +
            `Created: ${apv.createdAt.toISOString()}\n` +
            `Age (min): ${Math.round((now.getTime() - apv.createdAt.getTime()) / 60000)}\n\n` +
            `Description:\n${apv.description}\n\n` +
            `Please open the Mission Control dashboard to approve or reject.`;
          const res = await sendToOwnerEmail(subject, body);
          if (res.success) channels.push('email');
        } catch {
          // Non-fatal.
        }
      }

      // ─── Level 3 (final): + Voice call + expire if past expiresAt ──
      if (nextLevel >= MAX_ESCALATION_LEVEL) {
        try {
          const callOk = await attemptVoiceCall(apv, branding);
          if (callOk) channels.push('voice');
        } catch {
          // Non-fatal — voice is best-effort.
        }
      }

      // ─── Update row ────────────────────────────────────────────────
      const willExpire =
        nextLevel >= MAX_ESCALATION_LEVEL && apv.expiresAt && apv.expiresAt < now;

      const updatedRow = await db.approvalRequest.update({
        where: { id: apv.id },
        data: {
          escalationLevel: nextLevel,
          lastEscalatedAt: now,
          // If we're already at max, don't schedule another escalation —
          // the row will auto-expire (or be resolved).
          nextEscalateAt: nextLevel >= MAX_ESCALATION_LEVEL ? null : addMinutes(now, defaultTimeout),
          status: willExpire ? 'expired' : 'pending',
          resolvedAt: willExpire ? now : null,
        },
      });

      escalated++;
      if (willExpire) expired++;

      // ─── Bell notification for the escalation step ────────────────
      try {
        const notifType =
          nextLevel >= MAX_ESCALATION_LEVEL ? 'error' : nextLevel === 2 ? 'warn' : 'info';
        const notifTitle =
          nextLevel >= MAX_ESCALATION_LEVEL
            ? `🚨 Final escalation · ${apv.title}`
            : nextLevel === 2
            ? `⚠️ L2 escalation · ${apv.title}`
            : `🔔 Approval reminder · ${apv.title}`;
        const notifMsg =
          `Level ${nextLevel}/3 · Channels: ${channels.join(', ') || 'none configured'}\n` +
          (willExpire ? `Auto-expired (past hard timeout).` : `Next check in ${defaultTimeout} min.`);
        await db.notification.create({
          data: {
            type: notifType,
            title: notifTitle,
            message: notifMsg.slice(0, 500),
            read: false,
          },
        });
      } catch {
        // Non-fatal.
      }

      // ─── Audit log ────────────────────────────────────────────────
      try {
        await logAudit({
          actor: 'escalation-engine',
          action: willExpire ? 'approval.expire' : 'approval.escalate',
          target: `approval:${apv.id}`,
          meta: {
            title: apv.title,
            level: nextLevel,
            channels,
            category: apv.category,
            requestedBy: apv.requestedBy,
            ageMinutes: Math.round((now.getTime() - apv.createdAt.getTime()) / 60000),
          },
        });
      } catch {
        // Non-fatal.
      }

      details.push({
        id: apv.id,
        title: apv.title,
        level: nextLevel,
        channels,
        expired: willExpire,
      });
    }

    return { ok: true, escalated, expired, details };
  } catch (err) {
    return {
      ok: false,
      escalated,
      expired,
      details,
      error: `escalatePendingApprovals failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── Voice call attempt (Level 3 only) ───────────────────────────────
//
// Try the FreeSWITCH bridge first; if that's not configured, fall back to
// the voice-agent workflow engine. Both modules are optional, so all
// failures are caught and logged.

async function attemptVoiceCall(
  apv: { id: string; title: string; category: string; description: string },
  branding: { ownerPhone?: string } | null,
): Promise<boolean> {
  const phoneNumber = branding?.ownerPhone ?? process.env.OWNER_PHONE ?? '';
  if (!phoneNumber) {
    console.warn('[approval-escalation] voice call skipped — no ownerPhone configured');
    return false;
  }

  // ── Try FreeSWITCH bridge first ──
  try {
    const freeswitch = await import('@/lib/freeswitch-bridge');
    if (freeswitch.isFreeSWITCHConfigured()) {
      const r = await freeswitch.makeCall({ to: phoneNumber });
      if (r.ok) {
        await logAudit({
          actor: 'escalation-engine',
          action: 'approval.voice-call',
          target: `approval:${apv.id}`,
          meta: { provider: 'freeswitch', callUuid: r.callUuid ?? null, to: phoneNumber },
        });
        return true;
      }
      // fall through to voice-agent
    }
  } catch (err) {
    console.warn('[approval-escalation] FreeSWITCH call failed:', err instanceof Error ? err.message : err);
  }

  // ── Fallback: voice-agent workflow ──
  try {
    const voice = await import('@/lib/voice-agent');
    const workflows = await voice.listVoiceWorkflows();
    const escalationWf = workflows.find(
      (w) => w.status === 'active' && /escalat|approval|notify/i.test(w.name),
    );
    if (escalationWf) {
      const r = await voice.startCallSession({
        workflowId: escalationWf.id,
        direction: 'outbound',
        phoneNumber,
      });
      if (r.ok) {
        await logAudit({
          actor: 'escalation-engine',
          action: 'approval.voice-call',
          target: `approval:${apv.id}`,
          meta: { provider: 'voice-agent', callId: r.callId ?? null, to: phoneNumber },
        });
        return true;
      }
    }
  } catch (err) {
    console.warn(
      '[approval-escalation] voice-agent call failed:',
      err instanceof Error ? err.message : err,
    );
  }

  return false;
}

// ─── getApprovalStats ────────────────────────────────────────────────

export async function getApprovalStats(): Promise<ApprovalStats> {
  const empty: ApprovalStats = {
    byStatus: {},
    byCategory: {},
    pending: 0,
    escalating: 0,
    escalatedTotal: 0,
    approvedToday: 0,
    rejectedToday: 0,
    expiredTotal: 0,
    avgResponseMinutes: null,
    oldestPendingMinutes: null,
  };
  try {
    const all = await db.approvalRequest.findMany({
      select: {
        status: true,
        category: true,
        escalationLevel: true,
        createdAt: true,
        resolvedAt: true,
      },
    });

    const byStatus: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let pending = 0;
    let escalating = 0;
    let escalatedTotal = 0;
    let expiredTotal = 0;
    let resolvedCount = 0;
    let resolvedMsSum = 0;
    let oldestPendingMs: number | null = null;

    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    let approvedToday = 0;
    let rejectedToday = 0;

    for (const r of all) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;

      if (r.status === 'pending') {
        pending++;
        if (r.escalationLevel > 0) escalating++;
        const ageMs = now - r.createdAt.getTime();
        if (oldestPendingMs === null || ageMs > oldestPendingMs) oldestPendingMs = ageMs;
      }
      if (r.escalationLevel > 0) escalatedTotal++;
      if (r.status === 'expired') expiredTotal++;
      if (r.status === 'approved' && r.resolvedAt && r.resolvedAt >= startOfToday) approvedToday++;
      if (r.status === 'rejected' && r.resolvedAt && r.resolvedAt >= startOfToday) rejectedToday++;
      if (r.resolvedAt) {
        resolvedCount++;
        resolvedMsSum += r.resolvedAt.getTime() - r.createdAt.getTime();
      }
    }

    return {
      byStatus,
      byCategory,
      pending,
      escalating,
      escalatedTotal,
      approvedToday,
      rejectedToday,
      expiredTotal,
      avgResponseMinutes: resolvedCount > 0 ? Math.round(resolvedMsSum / resolvedCount / 60000) : null,
      oldestPendingMinutes: oldestPendingMs !== null ? Math.round(oldestPendingMs / 60000) : null,
    };
  } catch (err) {
    console.error('[approval-escalation] getApprovalStats failed:', err);
    return empty;
  }
}

// ─── listApprovals ───────────────────────────────────────────────────

export async function listApprovals(
  filter: ListApprovalsFilter = {},
): Promise<ApprovalRequest[]> {
  try {
    const where: { status?: string; category?: string } = {};
    if (filter.status && filter.status !== 'all') where.status = filter.status;
    if (filter.category && filter.category !== 'all') where.category = filter.category;
    return await db.approvalRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(filter.limit ?? 100, 1), 500),
    });
  } catch (err) {
    console.error('[approval-escalation] listApprovals failed:', err);
    return [];
  }
}

// ─── getApproval (single) ────────────────────────────────────────────

export async function getApproval(id: string) {
  try {
    return await db.approvalRequest.findUnique({ where: { id } });
  } catch (err) {
    console.error('[approval-escalation] getApproval failed:', err);
    return null;
  }
}
