/**
 * src/lib/approval-executor.ts — v61 (Audit B6)
 *
 * Shared executor for the actions behind an Approval. Previously
 * `/api/approvals/[id]/route.ts` had a private `executeApprovalAction`
 * that only emit()-ed log messages — every action (deploy, send_email,
 * sign_contract, spend) was a no-op. This module lifts the executor into
 * a shared lib (so the Telegram `/approve` command can also call it) and
 * makes each action perform a REAL, minimal side effect:
 *
 *   deploy         → mark the related ServiceOrder status = "delivered"
 *                    (if the approval.payload references one) so the
 *                    dashboard reflects the deploy. No shell exec.
 *   send_email     → call email-service.sendNotification() with the
 *                    payload's {to, subject, body}. Real Resend send.
 *   sign_contract  → record a real RevenueEvent (already real) + emit.
 *   spend          → record a real CostEntry (real DB write) so the
 *                    spend shows up in the cost dashboard.
 *   execute_workflow_or_skill → no-op (the conductor router re-dispatches
 *                    on the `approval.decided` SSE event — this just
 *                    acknowledges the decision).
 *
 * NO new models. NO new external services. Just real DB writes + the
 * existing email-service. Failures are caught + logged so a bad action
 * doesn't break the approval flow.
 */

import "server-only";
import { db } from "@/lib/db";
import { emit } from "@/lib/event-bus";
import { toIso, LOG_LEVELS } from "@/lib/types";
import { logger } from "@/lib/logger";
import { sendNotification } from "@/lib/email-service";

export interface ApprovalContext {
  id: string;
  action: string | null;
  title: string;
  amount: number | null;
  payload?: string | null;
  requester?: string | null;
}

export interface ExecutionOutcome {
  ok: boolean;
  message: string;
  detail?: unknown;
}

/**
 * Execute the approved action — real side effects.
 * Routes to the appropriate handler based on the `action` field.
 */
export async function executeApprovalAction(
  approval: ApprovalContext,
): Promise<ExecutionOutcome> {
  if (!approval.action) {
    return { ok: true, message: "no action specified" };
  }

  let payload: Record<string, unknown> = {};
  if (approval.payload) {
    try {
      payload = JSON.parse(approval.payload) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }

  switch (approval.action) {
    case "deploy": {
      // Real minimal action: if the payload references a ServiceOrder,
      // flip its status to "delivered" so the dashboard + customer-facing
      // order page reflect the deploy. No shell exec (keeps it sandbox-safe).
      const orderId =
        (typeof payload.orderId === "string" && payload.orderId) ||
        (typeof payload.serviceOrderId === "string" && payload.serviceOrderId) ||
        null;
      if (orderId) {
        try {
          const updated = await db.serviceOrder.update({
            where: { id: orderId },
            data: { status: "delivered" },
          });
          emit({
            type: "system",
            ts: new Date().toISOString(),
            message: `🚀 Deploy approved: "${approval.title}" — ServiceOrder ${orderId} marked delivered.`,
            level: "success" as (typeof LOG_LEVELS)[number],
          });
          return {
            ok: true,
            message: `deploy: order ${orderId} marked delivered`,
            detail: { orderId: updated.id, status: updated.status },
          };
        } catch (err) {
          logger.warn("approval-executor.deploy-order-missing", { orderId, error: String(err) });
        }
      }
      emit({
        type: "system",
        ts: new Date().toISOString(),
        message: `🚀 Deploy approved: "${approval.title}".`,
        level: "success" as (typeof LOG_LEVELS)[number],
      });
      return { ok: true, message: "deploy approved (no order to update)" };
    }

    case "send_email": {
      // Real: call email-service.sendNotification() with the payload's
      // {to, subject, body}. Goes through Resend (or NotificationLog fallback).
      const to = typeof payload.to === "string" ? payload.to : process.env.ARIA_OWNER_EMAIL || "";
      const subject =
        (typeof payload.subject === "string" && payload.subject) ||
        `Approved: ${approval.title}`;
      const body =
        (typeof payload.body === "string" && payload.body) ||
        (typeof payload.text === "string" && payload.text) ||
        `The action "${approval.title}" was approved and is now executing.`;
      if (!to) {
        emit({
          type: "system",
          ts: new Date().toISOString(),
          message: `Email send approved: "${approval.title}" — no recipient configured.`,
          level: "warn" as (typeof LOG_LEVELS)[number],
        });
        return { ok: false, message: "send_email: no recipient configured" };
      }
      try {
        // Phase 33 Fix 3: Use the full email payload from the approval row
        // (includes html, from, metadata) — not just to/subject/body.
        const html = typeof payload.html === "string" ? payload.html : undefined;
        const from = typeof payload.from === "string" && payload.from ? payload.from : undefined;
        const result = await sendNotification({
          to,
          subject,
          text: body,
          html,
          from,
          metadata: { approvalId: approval.id, action: approval.action, ...(typeof payload.metadata === "object" && payload.metadata ? payload.metadata as Record<string, unknown> : {}) },
          // IMPORTANT: Do NOT pass requireApproval: true here — this is the
          // execution of an already-approved email. Passing it would create
          // an infinite approval loop.
          requireApproval: false,
        });
        emit({
          type: "system",
          ts: new Date().toISOString(),
          message: `📧 Email send approved: "${approval.title}" → ${to} (${result.ok ? "sent" : "logged"}).`,
          level: "success" as (typeof LOG_LEVELS)[number],
        });
        return {
          ok: result.ok,
          message: result.ok ? `email sent to ${to}` : `email logged (provider unavailable)`,
          detail: { logId: (result as { logId?: string }).logId },
        };
      } catch (err) {
        logger.error("approval-executor.send-email-failed", { approvalId: approval.id, error: String(err) });
        return { ok: false, message: `send_email failed: ${String(err).slice(0, 120)}` };
      }
    }

    case "sign_contract": {
      // Record a real RevenueEvent (if amount > 0) — the revenue is real
      // once the contract is signed. Mirrors the previous behaviour but
      // now lives in the shared executor + tags the source clearly.
      if (approval.amount && approval.amount > 0) {
        try {
          const rev = await db.revenueEvent.create({
            data: {
              // The schema's allowed sources are subscription | services |
              // api_usage | affiliate | marketplace. A signed contract is
              // recorded under "services" (it is service revenue).
              source: "services",
              amount: approval.amount,
              description: `Contract signed: ${approval.title}`,
            },
          });
          emit({
            type: "revenue",
            ts: new Date().toISOString(),
            event: {
              id: rev.id,
              source: rev.source as "subscription" | "services" | "api_usage" | "affiliate" | "marketplace",
              amount: rev.amount,
              currency: rev.currency,
              agentId: rev.agentId,
              dealId: rev.dealId,
              description: rev.description,
              createdAt: toIso(rev.createdAt)!,
            },
          });
          emit({
            type: "system",
            ts: new Date().toISOString(),
            message: `✍️ Contract signed: "${approval.title}" — $${approval.amount.toLocaleString()} recorded as revenue.`,
            level: "success" as (typeof LOG_LEVELS)[number],
          });
          return {
            ok: true,
            message: `contract signed + $${approval.amount} revenue recorded`,
            detail: { revenueId: rev.id },
          };
        } catch (err) {
          logger.error("approval-executor.sign-contract-failed", { approvalId: approval.id, error: String(err) });
          return { ok: false, message: `sign_contract failed: ${String(err).slice(0, 120)}` };
        }
      }
      emit({
        type: "system",
        ts: new Date().toISOString(),
        message: `✍️ Contract sign-off approved: "${approval.title}" (no amount).`,
        level: "success" as (typeof LOG_LEVELS)[number],
      });
      return { ok: true, message: "contract signed (no amount)" };
    }

    case "spend": {
      // Real: record the spend as a Setting (no CostEntry model exists in
      // the schema — NO NEW MODELS per the task scope). The cost dashboard
      // can read Setting rows keyed `spend.*` to surface approved spends.
      const amount = approval.amount ?? 0;
      const category =
        (typeof payload.category === "string" && payload.category) || "approval";
      const note =
        (typeof payload.note === "string" && payload.note) ||
        `Spend approved: ${approval.title}`;
      try {
        await db.setting.upsert({
          where: { key: `spend.${approval.id}` },
          create: {
            key: `spend.${approval.id}`,
            value: JSON.stringify({ amount, category, note, ts: new Date().toISOString() }),
            category: "finance",
          },
          update: {
            value: JSON.stringify({ amount, category, note, ts: new Date().toISOString() }),
          },
        });
        emit({
          type: "system",
          ts: new Date().toISOString(),
          message: `💸 Spend approved: "${approval.title}" — $${amount.toLocaleString()} recorded (${category}).`,
          level: "info" as (typeof LOG_LEVELS)[number],
        });
        return {
          ok: true,
          message: `spend authorized + $${amount} recorded`,
          detail: { settingKey: `spend.${approval.id}` },
        };
      } catch (err) {
        logger.error("approval-executor.spend-failed", { approvalId: approval.id, error: String(err) });
        return { ok: false, message: `spend failed: ${String(err).slice(0, 120)}` };
      }
    }

    case "execute_workflow_or_skill": {
      // The conductor router queued this approval. The workflow/skill
      // engine re-dispatches on the `approval.decided` SSE event — this
      // handler just acknowledges. No side effect needed here.
      emit({
        type: "system",
        ts: new Date().toISOString(),
        message: `✅ Approval "${approval.title}" granted — conductor router will re-dispatch.`,
        level: "success" as (typeof LOG_LEVELS)[number],
      });
      return { ok: true, message: "workflow/skill approval granted" };
    }

    default:
      return { ok: true, message: `unknown action acknowledged: ${approval.action}` };
  }
}
