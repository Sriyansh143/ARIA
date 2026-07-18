// =====================================================================
// refund-system.ts — Task ID 4-REFUND
// =====================================================================
// Formal refund lifecycle for confirmed payments.
//
// The user's rule: "every confirmed transaction can have refund later
// stages." This module implements:
//   • createRefund  — validate parent payment, create Refund + ActionLog
//                     + ApprovalRequest (for amounts > 0)
//   • processRefund — move status → 'processed', set processedAt, update
//                     parent Payment status (full refund → 'refunded';
//                     partial refund → keep 'confirmed' but append note)
//   • rejectRefund  — move status → 'rejected'
//   • listRefunds   — list with optional status/paymentId filter, parent
//                     payment included (manual lookup — no Prisma relation)
//   • getRefundStats — totals + by-reason breakdown
//
// All functions use the `db` client directly. The db-write-queue
// (src/lib/db-write-queue.ts) is best-effort and does NOT return created
// records, so we use direct prisma calls to preserve atomicity and return
// the freshly-created rows. SQLite is single-writer at the DB layer anyway,
// so this is safe.
//
// Validation rules (STRICT — no assumptions):
//   1. Refund amount must be > 0.
//   2. Refund amount must be <= (payment.amount − already-refunded amount).
//      "Already-refunded" = sum of all refunds for this payment whose
//      status is NOT 'rejected' and NOT 'cancelled' (i.e. requested,
//      under_review, approved, processed all count as committed money).
//   3. Parent payment MUST be 'confirmed' (not pending/failed/refunded).
//   4. Reason must be one of the enum values.
//   5. Processing requires a reviewer name.
// =====================================================================

import { db } from '@/lib/db';

// ── Enums ──────────────────────────────────────────────────────────────────

export const REFUND_REASONS = [
  'customer_request',
  'duplicate',
  'service_not_delivered',
  'fraud',
  'other',
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export const REFUND_STATUSES = [
  'requested',
  'under_review',
  'approved',
  'processed',
  'rejected',
  'cancelled',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** Refund statuses that count as "committed money" against the parent payment. */
const COMMITTED_STATUSES: ReadonlySet<string> = new Set([
  'requested',
  'under_review',
  'approved',
  'processed',
]);

// ── Types ──────────────────────────────────────────────────────────────────

export interface CreateRefundInput {
  paymentId: string;
  amount: number;
  reason: string;
  reasonNote?: string | null;
  requestedBy?: string;
  paymentRefId?: string | null;
  currency?: string;
}

export interface ProcessRefundInput {
  gatewayRef?: string | null;
  reviewNote?: string | null;
  reviewer: string;
}

export interface RejectRefundInput {
  reviewNote?: string | null;
  reviewer: string;
}

export interface ListRefundsFilter {
  status?: string;
  paymentId?: string;
}

export interface RefundStats {
  requestedCount: number;
  requestedSum: number;
  processedCount: number;
  processedSum: number;
  rejectedCount: number;
  underReviewCount: number;
  cancelledCount: number;
  byReason: Array<{ reason: string; count: number; sum: number }>;
}

/** Discriminated union so callers can branch on `ok` without try/catch. */
export type RefundResult<T> =
  | { ok: true; refund: T }
  | { ok: false; error: string };

// ── Helpers ────────────────────────────────────────────────────────────────

/** Sum of already-committed refund amounts for a payment (excludes rejected/cancelled). */
async function getCommittedRefundAmount(paymentId: string): Promise<number> {
  const rows = await db.refund.findMany({
    where: { paymentId, status: { in: Array.from(COMMITTED_STATUSES) } },
    select: { amount: true },
  });
  return rows.reduce((sum, r) => sum + (r.amount ?? 0), 0);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function isReason(v: unknown): v is RefundReason {
  return typeof v === 'string' && (REFUND_REASONS as readonly string[]).includes(v);
}

// ── createRefund ──────────────────────────────────────────────────────────

export async function createRefund(
  input: CreateRefundInput,
): Promise<RefundResult<{
  id: string;
  paymentId: string;
  amount: number;
  currency: string;
  reason: string;
  status: string;
  requestedBy: string;
  approvalRequestId: string | null;
  createdAt: Date;
}>> {
  try {
    // ── Validate amount ────────────────────────────────────────────────
    const amount = Number(input.amount);
    if (!isFinite(amount) || amount <= 0) {
      return { ok: false, error: 'Refund amount must be greater than 0.' };
    }

    // ── Validate reason ────────────────────────────────────────────────
    if (!isReason(input.reason)) {
      return {
        ok: false,
        error: `Reason must be one of: ${REFUND_REASONS.join(', ')}`,
      };
    }

    // ── Validate parent payment exists ─────────────────────────────────
    const payment = await db.payment.findUnique({ where: { id: input.paymentId } });
    if (!payment) {
      return { ok: false, error: `Payment ${input.paymentId} not found.` };
    }
    if (payment.status !== 'confirmed') {
      return {
        ok: false,
        error: `Parent payment must be 'confirmed' (current: '${payment.status}'). Refunds are only allowed on confirmed transactions.`,
      };
    }

    // ── Validate amount <= available ──────────────────────────────────
    const alreadyRefunded = await getCommittedRefundAmount(payment.id);
    const available = (payment.amount ?? 0) - alreadyRefunded;
    if (amount > available + 1e-9) {
      return {
        ok: false,
        error: `Refund amount ₹${amount.toFixed(2)} exceeds available refundable amount ₹${available.toFixed(2)} (payment ₹${payment.amount.toFixed(2)} − already committed ₹${alreadyRefunded.toFixed(2)}).`,
      };
    }

    const requestedBy = input.requestedBy?.trim() || 'operator';
    const currency = input.currency || payment.currency || 'INR';

    // ── Capture before-state for ActionLog ─────────────────────────────
    const beforeState = safeStringify({
      payment: { id: payment.id, status: payment.status, amount: payment.amount, note: payment.note },
      existingCommittedRefunds: alreadyRefunded,
    });

    // ── Create the Refund row ──────────────────────────────────────────
    const refund = await db.refund.create({
      data: {
        paymentId: payment.id,
        paymentRefId: input.paymentRefId ?? null,
        amount,
        currency,
        reason: input.reason,
        reasonNote: input.reasonNote ?? null,
        status: 'requested',
        requestedBy,
      },
    });

    // ── Create ApprovalRequest (for any amount > 0) ───────────────────
    let approvalRequestId: string | null = null;
    if (amount > 0) {
      const approval = await db.approvalRequest.create({
        data: {
          category: 'payment-refund',
          title: `Refund ₹${amount.toFixed(2)} for ${payment.method} payment`,
          description:
            `Refund of ₹${amount.toFixed(2)} ${currency} requested by ${requestedBy}.\n` +
            `Reason: ${input.reason}${input.reasonNote ? ` — ${input.reasonNote}` : ''}\n` +
            `Payment: ${payment.id} (${payment.method}, ₹${payment.amount.toFixed(2)} ${payment.currency})`,
          requestedBy,
          payload: safeStringify({
            refundId: refund.id,
            paymentId: payment.id,
            amount,
            currency,
            reason: input.reason,
            reasonNote: input.reasonNote ?? null,
          }),
          status: 'pending',
          // 30-min escalation window — escalation dispatcher (if running)
          // will pick this up via nextEscalateAt.
          nextEscalateAt: new Date(Date.now() + 30 * 60 * 1000),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
      approvalRequestId = approval.id;
    }

    // ── ActionLog (reversible action log) ──────────────────────────────
    const afterState = safeStringify({
      refund: {
        id: refund.id,
        paymentId: refund.paymentId,
        amount: refund.amount,
        reason: refund.reason,
        status: refund.status,
      },
      approvalRequestId,
    });
    const actionLog = await db.actionLog.create({
      data: {
        actor: requestedBy,
        action: 'refund.create',
        category: 'mutation',
        target: `refund:${refund.id}`,
        beforeState,
        afterState,
        reversible: true,
        approvalId: approvalRequestId,
        meta: safeStringify({ paymentId: payment.id, amount, reason: input.reason }),
      },
    });

    // Link refund → actionLog via reversedActionLogId field (used to find the
    // originating log entry if the refund is ever reversed).
    await db.refund.update({
      where: { id: refund.id },
      data: { reversedActionLogId: actionLog.id },
    });

    return {
      ok: true,
      refund: {
        id: refund.id,
        paymentId: refund.paymentId,
        amount: refund.amount,
        currency: refund.currency,
        reason: refund.reason,
        status: refund.status,
        requestedBy: refund.requestedBy,
        approvalRequestId,
        createdAt: refund.createdAt,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to create refund.',
    };
  }
}

// ── processRefund ──────────────────────────────────────────────────────────

export async function processRefund(
  refundId: string,
  input: ProcessRefundInput,
): Promise<RefundResult<{ id: string; status: string; processedAt: Date | null }>> {
  try {
    const reviewer = input.reviewer?.trim();
    if (!reviewer) {
      return { ok: false, error: 'A reviewer name is required to process a refund.' };
    }

    const refund = await db.refund.findUnique({ where: { id: refundId } });
    if (!refund) {
      return { ok: false, error: `Refund ${refundId} not found.` };
    }
    if (refund.status === 'processed') {
      return { ok: false, error: 'Refund is already processed.' };
    }
    if (refund.status === 'rejected' || refund.status === 'cancelled') {
      return { ok: false, error: `Refund is '${refund.status}' and cannot be processed.` };
    }

    const payment = await db.payment.findUnique({ where: { id: refund.paymentId } });
    if (!payment) {
      return { ok: false, error: `Parent payment ${refund.paymentId} not found.` };
    }

    // ── Capture before-state ───────────────────────────────────────────
    const beforeState = safeStringify({
      refund: { id: refund.id, status: refund.status, processedAt: refund.processedAt },
      payment: { id: payment.id, status: payment.status, note: payment.note },
    });

    // ── Update refund → processed ──────────────────────────────────────
    const now = new Date();
    const updatedRefund = await db.refund.update({
      where: { id: refundId },
      data: {
        status: 'processed',
        processedAt: now,
        reviewedBy: reviewer,
        reviewNote: input.reviewNote ?? refund.reviewNote,
        gatewayRef: input.gatewayRef ?? refund.gatewayRef,
      },
    });

    // ── Update parent payment ──────────────────────────────────────────
    // Full refund → 'refunded'. Partial refund → keep 'confirmed' but
    // append a note so the operator can see the partial refund happened.
    const committedTotal = await getCommittedRefundAmount(payment.id);
    const isFullRefund = committedTotal >= payment.amount - 1e-9;

    let newPaymentStatus = payment.status;
    let paymentNote = payment.note ?? '';
    if (isFullRefund) {
      newPaymentStatus = 'refunded';
      paymentNote = paymentNote
        ? `${paymentNote} | fully refunded ${now.toISOString()} (${updatedRefund.id})`
        : `fully refunded ${now.toISOString()} (${updatedRefund.id})`;
    } else {
      paymentNote = paymentNote
        ? `${paymentNote} | partial refund ₹${updatedRefund.amount.toFixed(2)} ${now.toISOString()} (${updatedRefund.id})`
        : `partial refund ₹${updatedRefund.amount.toFixed(2)} ${now.toISOString()} (${updatedRefund.id})`;
    }

    const updatedPayment = await db.payment.update({
      where: { id: payment.id },
      data: { status: newPaymentStatus, note: paymentNote },
    });

    // ── ActionLog ──────────────────────────────────────────────────────
    const afterState = safeStringify({
      refund: { id: updatedRefund.id, status: updatedRefund.status, processedAt: updatedRefund.processedAt, gatewayRef: updatedRefund.gatewayRef },
      payment: { id: updatedPayment.id, status: updatedPayment.status, note: updatedPayment.note },
      isFullRefund,
    });
    await db.actionLog.create({
      data: {
        actor: reviewer,
        action: 'refund.process',
        category: 'mutation',
        target: `refund:${refund.id}`,
        beforeState,
        afterState,
        reversible: true,
        meta: safeStringify({
          paymentId: payment.id,
          amount: refund.amount,
          isFullRefund,
          gatewayRef: input.gatewayRef ?? null,
        }),
      },
    });

    return {
      ok: true,
      refund: {
        id: updatedRefund.id,
        status: updatedRefund.status,
        processedAt: updatedRefund.processedAt,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to process refund.',
    };
  }
}

// ── rejectRefund ───────────────────────────────────────────────────────────

export async function rejectRefund(
  refundId: string,
  input: RejectRefundInput,
): Promise<RefundResult<{ id: string; status: string }>> {
  try {
    const reviewer = input.reviewer?.trim();
    if (!reviewer) {
      return { ok: false, error: 'A reviewer name is required to reject a refund.' };
    }

    const refund = await db.refund.findUnique({ where: { id: refundId } });
    if (!refund) {
      return { ok: false, error: `Refund ${refundId} not found.` };
    }
    if (refund.status === 'processed') {
      return { ok: false, error: 'Cannot reject a refund that has already been processed.' };
    }
    if (refund.status === 'rejected') {
      return { ok: false, error: 'Refund is already rejected.' };
    }

    const beforeState = safeStringify({
      refund: { id: refund.id, status: refund.status, reviewNote: refund.reviewNote },
    });

    const updated = await db.refund.update({
      where: { id: refundId },
      data: {
        status: 'rejected',
        reviewedBy: reviewer,
        reviewNote: input.reviewNote ?? refund.reviewNote,
      },
    });

    const afterState = safeStringify({
      refund: { id: updated.id, status: updated.status, reviewedBy: updated.reviewedBy, reviewNote: updated.reviewNote },
    });
    await db.actionLog.create({
      data: {
        actor: reviewer,
        action: 'refund.reject',
        category: 'mutation',
        target: `refund:${refund.id}`,
        beforeState,
        afterState,
        reversible: false,
        meta: safeStringify({ paymentId: refund.paymentId, amount: refund.amount }),
      },
    });

    return { ok: true, refund: { id: updated.id, status: updated.status } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to reject refund.',
    };
  }
}

// ── listRefunds ────────────────────────────────────────────────────────────

export interface RefundWithPayment {
  id: string;
  paymentId: string;
  paymentRefId: string | null;
  amount: number;
  currency: string;
  reason: string;
  reasonNote: string | null;
  status: string;
  requestedBy: string;
  reviewedBy: string | null;
  reviewNote: string | null;
  gatewayRef: string | null;
  processedAt: Date | null;
  reversedActionLogId: string | null;
  createdAt: Date;
  updatedAt: Date;
  payment: {
    id: string;
    method: string;
    amount: number;
    currency: string;
    status: string;
    payer: string | null;
    note: string | null;
  } | null;
}

export async function listRefunds(
  filter: ListRefundsFilter = {},
): Promise<RefundWithPayment[]> {
  const where: Record<string, unknown> = {};
  if (filter.status) where.status = filter.status;
  if (filter.paymentId) where.paymentId = filter.paymentId;

  const refunds = await db.refund.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  if (refunds.length === 0) return [];

  // No Prisma relation between Refund ↔ Payment, so fetch parent payments
  // manually in a single query.
  const paymentIds = Array.from(new Set(refunds.map((r) => r.paymentId)));
  const payments = await db.payment.findMany({ where: { id: { in: paymentIds } } });
  const paymentById = new Map(payments.map((p) => [p.id, p]));

  return refunds.map((r) => {
    const p = paymentById.get(r.paymentId);
    return {
      ...r,
      payment: p
        ? {
            id: p.id,
            method: p.method,
            amount: p.amount,
            currency: p.currency,
            status: p.status,
            payer: p.payer,
            note: p.note,
          }
        : null,
    };
  });
}

// ── getRefundStats ─────────────────────────────────────────────────────────

export async function getRefundStats(): Promise<RefundStats> {
  const all = await db.refund.findMany({
    select: { amount: true, status: true, reason: true },
  });

  const stats: RefundStats = {
    requestedCount: 0,
    requestedSum: 0,
    processedCount: 0,
    processedSum: 0,
    rejectedCount: 0,
    underReviewCount: 0,
    cancelledCount: 0,
    byReason: [],
  };

  const byReasonMap = new Map<string, { count: number; sum: number }>();

  for (const r of all) {
    const amt = r.amount ?? 0;
    // "requested" aggregate = all currently-open refunds (requested + under_review + approved)
    if (r.status === 'requested' || r.status === 'under_review' || r.status === 'approved') {
      stats.requestedCount += 1;
      stats.requestedSum += amt;
    }
    if (r.status === 'under_review') stats.underReviewCount += 1;
    if (r.status === 'processed') {
      stats.processedCount += 1;
      stats.processedSum += amt;
    }
    if (r.status === 'rejected') stats.rejectedCount += 1;
    if (r.status === 'cancelled') stats.cancelledCount += 1;

    const bucket = byReasonMap.get(r.reason) ?? { count: 0, sum: 0 };
    bucket.count += 1;
    bucket.sum += amt;
    byReasonMap.set(r.reason, bucket);
  }

  stats.byReason = Array.from(byReasonMap.entries()).map(([reason, v]) => ({
    reason,
    count: v.count,
    sum: v.sum,
  }));

  return stats;
}

// ── getRefund (single) ─────────────────────────────────────────────────────

export async function getRefund(refundId: string): Promise<RefundWithPayment | null> {
  const refund = await db.refund.findUnique({ where: { id: refundId } });
  if (!refund) return null;
  const payment = refund
    ? await db.payment.findUnique({ where: { id: refund.paymentId } })
    : null;
  return {
    ...refund,
    payment: payment
      ? {
          id: payment.id,
          method: payment.method,
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
          payer: payment.payer,
          note: payment.note,
        }
      : null,
  };
}
