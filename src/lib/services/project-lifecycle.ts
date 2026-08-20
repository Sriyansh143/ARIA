/**
 * src/lib/services/project-lifecycle.ts — Phase 30
 *
 * Centralized ServiceOrder lifecycle state machine. Previously,
 * transitions were scattered across 4+ files (crypto-checkout.ts,
 * stripe-checkout/index.ts, services/approve/route.ts, services/refund/route.ts).
 *
 * This module provides:
 *   - A single `assertCanTransition(from, to)` function that enforces
 *     the Phase 30 contract-signing gate: an order CANNOT move to
 *     "building" until its linked Contract (if any) has status="signed".
 *   - A `transitionServiceOrder(orderId, to, ctx)` function that performs
 *     the transition atomically + records an audit log entry.
 *   - A `canStartBuild(orderId)` helper used by the build scheduler.
 *
 * STATE MACHINE
 * -------------
 *
 *   pending_payment ──┬─ (Stripe webhook / crypto cron / UPI cron) ─→ paid_verified
 *                     │
 *                     └─ (owner manual approve, no payment) ─→ building*  (only if no contract)
 *                                                ↑
 *                                                └─ * blocked if Contract.status !== "signed"
 *
 *   paid_verified ──→ building* ──→ delivered
 *                                └→ failed
 *
 *   building ──→ refunded (mid-build refund, files deleted)
 *   * ──→ failed (build failure)
 *   delivered ──→ refunded (post-delivery refund)
 *
 * CONTRACT SIGNING GATE (Phase 30)
 * ---------------------------------
 * If a ServiceOrder has a linked Contract (via Contract.serviceOrderId),
 * the order CANNOT transition to "building" unless Contract.status === "signed".
 * This enforces the business rule: "no work begins until the contract is signed".
 *
 * The gate is enforced in `assertCanTransition()` + `transitionServiceOrder()`.
 * If the gate fails, the transition is refused with a clear error message
 * pointing to the contract id.
 */

import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/lib/audit-log";

// ─── Status Constants ───────────────────────────────────────────────

export const SERVICE_ORDER_STATUSES = [
  "pending_payment",
  "paid_verified",
  "building",
  "delivered",
  "failed",
  "refunded",
  "rejected",
] as const;
export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number];

// Allowed transitions: from → set of allowed target statuses.
const ALLOWED_TRANSITIONS: Record<ServiceOrderStatus, ServiceOrderStatus[]> = {
  pending_payment: ["paid_verified", "building", "failed", "rejected", "refunded"],
  paid_verified: ["building", "failed", "refunded"],
  building: ["delivered", "failed", "refunded"],
  delivered: ["refunded"],
  failed: [],
  refunded: [],
  rejected: [],
};

export interface TransitionResult {
  ok: boolean;
  status: ServiceOrderStatus;
  error?: string;
  contractBlocked?: boolean;
  contractId?: string;
  contractStatus?: string;
}

/**
 * Assert that a transition is allowed by the state machine.
 * Does NOT check the contract-signing gate (use `transitionServiceOrder`
 * for that, or call `checkContractGate` separately).
 */
export function assertCanTransition(from: string, to: string): { ok: boolean; error?: string } {
  if (!SERVICE_ORDER_STATUSES.includes(from as ServiceOrderStatus)) {
    return { ok: false, error: `unknown source status: ${from}` };
  }
  if (!SERVICE_ORDER_STATUSES.includes(to as ServiceOrderStatus)) {
    return { ok: false, error: `unknown target status: ${to}` };
  }
  const allowed = ALLOWED_TRANSITIONS[from as ServiceOrderStatus];
  if (!allowed.includes(to as ServiceOrderStatus)) {
    return {
      ok: false,
      error: `transition not allowed: ${from} → ${to} (allowed: ${allowed.join(", ")})`,
    };
  }
  return { ok: true };
}

/**
 * Check the contract-signing gate: if the ServiceOrder has a linked
 * Contract, the contract must be in status="signed" before the order
 * can transition to "building".
 *
 * Returns { ok: true } if no contract is linked OR if the contract is signed.
 * Returns { ok: false, contractId, contractStatus } if the contract is not yet signed.
 */
export async function checkContractGate(serviceOrderId: string): Promise<{
  ok: boolean;
  contractId?: string;
  contractStatus?: string;
  error?: string;
}> {
  const contract = await db.contract.findFirst({
    where: { serviceOrderId },
    select: { id: true, status: true },
  });
  if (!contract) {
    // No contract linked — gate passes.
    return { ok: true };
  }
  if (contract.status !== "signed") {
    return {
      ok: false,
      contractId: contract.id,
      contractStatus: contract.status,
      error: `Contract ${contract.id} is status="${contract.status}" (must be "signed" before build can start)`,
    };
  }
  return { ok: true, contractId: contract.id, contractStatus: "signed" };
}

/**
 * Atomically transition a ServiceOrder to a new status.
 *
 * Enforces:
 *   1. The transition is allowed by the state machine (assertCanTransition).
 *   2. The contract-signing gate passes (checkContractGate) — IF the target
 *      status is "building".
 *   3. The transition is atomic (updateMany with WHERE clause prevents
 *      race conditions when multiple callers try to transition simultaneously).
 *
 * Records an audit log entry on success.
 */
export async function transitionServiceOrder(
  orderId: string,
  to: ServiceOrderStatus,
  ctx?: {
    actor?: string;
    actorRole?: string;
    source?: string;
    reason?: string;
    ip?: string;
    userAgent?: string;
  },
): Promise<TransitionResult> {
  const order = await db.serviceOrder.findUnique({ where: { id: orderId } });
  if (!order) {
    return { ok: false, status: "failed" as ServiceOrderStatus, error: "order not found" };
  }

  const from = order.status as ServiceOrderStatus;

  // 1. Check the state machine.
  const transitionCheck = assertCanTransition(from, to);
  if (!transitionCheck.ok) {
    return { ok: false, status: from, error: transitionCheck.error };
  }

  // 2. Check the contract-signing gate (only for "building").
  if (to === "building") {
    const gate = await checkContractGate(orderId);
    if (!gate.ok) {
      logger.warn("project-lifecycle.contract-gate-blocked", {
        orderId,
        contractId: gate.contractId,
        contractStatus: gate.contractStatus,
      });
      return {
        ok: false,
        status: from,
        error: gate.error,
        contractBlocked: true,
        contractId: gate.contractId,
        contractStatus: gate.contractStatus,
      };
    }
  }

  // 3. Atomic transition (prevents race conditions).
  const updateData: Record<string, unknown> = { status: to };
  if (to === "delivered") updateData.deliveredAt = new Date();

  const updated = await db.serviceOrder.updateMany({
    where: { id: orderId, status: from }, // atomic: only if status hasn't changed
    data: updateData,
  });

  if (updated.count === 0) {
    // Status changed between our read + write — race condition.
    const refreshed = await db.serviceOrder.findUnique({ where: { id: orderId } });
    return {
      ok: false,
      status: (refreshed?.status ?? from) as ServiceOrderStatus,
      error: "concurrent transition — order status changed during update",
    };
  }

  // 4. Record audit log entry.
  await recordAudit({
    actor: ctx?.actor ?? "system",
    actorRole: ctx?.actorRole ?? "system",
    action: to,
    resource: "ServiceOrder",
    resourceId: orderId,
    before: { status: from },
    after: { status: to, reason: ctx?.reason },
    source: ctx?.source ?? "api",
    context: { ip: ctx?.ip, userAgent: ctx?.userAgent },
  });

  logger.info("project-lifecycle.transition", {
    orderId,
    from,
    to,
    actor: ctx?.actor ?? "system",
    reason: ctx?.reason,
  });

  return { ok: true, status: to };
}

/**
 * Can the build scheduler start building this order?
 * Returns true if:
 *   - Order status is "paid_verified" (or "pending_payment" with ownerApproved)
 *   - Contract-signing gate passes (or no contract linked)
 */
export async function canStartBuild(orderId: string): Promise<{
  ok: boolean;
  reason?: string;
  contractBlocked?: boolean;
}> {
  const order = await db.serviceOrder.findUnique({ where: { id: orderId } });
  if (!order) return { ok: false, reason: "order not found" };

  if (order.status !== "paid_verified" && order.status !== "pending_payment") {
    return { ok: false, reason: `order status is ${order.status} (must be paid_verified or pending_payment)` };
  }

  if (!order.ownerApproved) {
    return { ok: false, reason: "order not owner-approved" };
  }

  const gate = await checkContractGate(orderId);
  if (!gate.ok) {
    return { ok: false, reason: gate.error, contractBlocked: true };
  }

  return { ok: true };
}

/**
 * Get the full lifecycle history of a ServiceOrder (audit log entries
 * ordered oldest-first). Used by the dashboard's "Project History" panel.
 */
export async function getServiceOrderHistory(orderId: string, limit = 50): Promise<{
  id: string;
  actor: string;
  action: string;
  before: string | null;
  after: string | null;
  source: string;
  createdAt: Date;
}[]> {
  const rows = await db.auditLogEntry.findMany({
    where: { resource: "ServiceOrder", resourceId: orderId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
  });
  return rows.reverse();
}
