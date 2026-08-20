import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { emit } from "@/lib/event-bus";
import {
  type Approval,
} from "@/lib/types";
import { serializeApproval } from "@/lib/approval-brief";
// v61 (Audit B6): use the shared executor so the dashboard PATCH path
// and the Telegram /approve path perform the SAME real side effects.
import { executeApprovalAction } from "@/lib/approval-executor";
// Phase 29: comprehensive audit log with user attribution.
import { recordAudit } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

// v61 (Audit B6): executeApprovalAction now lives in the shared
// src/lib/approval-executor.ts module so the Telegram /approve command
// can call the exact same code path. Each action performs a REAL minimal
// side effect (DB write / email send) instead of just emit()-ing a log.

/**
 * GET /api/approvals/[id]
 *
 * Returns a single approval WITH its brief + discussion log (the JSON
 * columns are returned as raw strings; the client parses them lazily).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const row = await db.approval.findUnique({ where: { id } });
  if (!row) {
    return NextResponse.json({ error: "approval not found" }, { status: 404 });
  }
  const approval: Approval = serializeApproval(row);
  return NextResponse.json({ approval });
}

/**
 * PATCH /api/approvals/[id]
 *
 * Body: { decision: "approved" | "denied" }
 *
 * Decides a pending approval, executes the approved action (real side effects),
 * and re-broadcasts the updated record so every connected client reflects
 * the operator's decision immediately.
 *
 * Enhanced (Task 23):
 *   - If `body.oralConfirmed === true`, the approval is auto-approved
 *     without requiring an explicit `decision=approved` field. This is
 *     the path taken by the voice-call flow when `oralConfirm()` has
 *     already flipped the DB row — the PATCH is a no-op idempotent
 *     confirmation that simply re-broadcasts the updated state.
 *   - If the approval is already approved (e.g. via oral-confirm), a
 *     subsequent `decision=denied` PATCH is rejected with 409 Conflict.
 *   - Otherwise the standard `decision=approved|denied` flow runs.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    decision?: string;
    oralConfirmed?: boolean;
  };

  const existing = await db.approval.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "approval not found" }, { status: 404 });
  }

  // If the row was already orally confirmed, treat the PATCH as an
  // idempotent "auto-approve" — re-broadcast the approved state.
  if (body.oralConfirmed === true || existing.oralConfirmed) {
    if (existing.status === "pending") {
      // Persist the auto-approval.
      const updated = await db.approval.update({
        where: { id },
        data: { status: "approved", decidedAt: new Date() },
      });
      let actionResult: string | undefined;
      try {
        const outcome = await executeApprovalAction({
          id: updated.id,
          action: updated.action,
          title: updated.title,
          amount: updated.amount,
          payload: updated.payload,
          requester: updated.requester,
        });
        actionResult = outcome.message;
      } catch (err) {
        console.error("[api/approvals] oral action execution failed:", err);
        actionResult = "action execution failed";
      }
      emit({
        type: "approval",
        ts: new Date().toISOString(),
        approval: serializeApproval(updated),
      });
      // Phase 29: record audit entry.
      await recordAudit({
        actor: existing.requester ?? "owner",
        actorRole: "owner",
        action: "approve",
        resource: "Approval",
        resourceId: updated.id,
        before: { status: existing.status, title: existing.title },
        after: { status: "approved", title: updated.title, oralConfirmed: true, actionResult },
        source: "api",
      });
      return NextResponse.json({
        ok: true,
        status: "approved",
        oralConfirmed: true,
        actionResult,
      });
    }
    // Already decided — re-broadcast the existing state.
    emit({
      type: "approval",
      ts: new Date().toISOString(),
      approval: serializeApproval(existing),
    });
    return NextResponse.json({
      ok: true,
      status: existing.status,
      oralConfirmed: true,
      actionResult: "already decided — no-op",
    });
  }

  const decision =
    body.decision === "approved" ? "approved" : body.decision === "denied" ? "denied" : null;
  if (!decision) {
    return NextResponse.json(
      { error: "decision must be 'approved' or 'denied' (or pass oralConfirmed=true)" },
      { status: 400 }
    );
  }

  // Reject contradicting decisions on an already-decided approval.
  if (existing.status !== "pending") {
    return NextResponse.json(
      {
        error: `approval already ${existing.status}`,
        currentStatus: existing.status,
      },
      { status: 409 }
    );
  }

  const updated = await db.approval.update({
    where: { id },
    data: { status: decision, decidedAt: new Date() },
  });

  // Execute the approved action — real side effects (v61: shared executor).
  let actionResult: string | undefined;
  if (decision === "approved") {
    try {
      const outcome = await executeApprovalAction({
        id: updated.id,
        action: updated.action,
        title: updated.title,
        amount: updated.amount,
        payload: updated.payload,
        requester: updated.requester,
      });
      actionResult = outcome.message;
    } catch (err) {
      console.error("[api/approvals] action execution failed:", err);
      actionResult = "action execution failed";
    }
  }

  emit({
    type: "approval",
    ts: new Date().toISOString(),
    approval: serializeApproval(updated),
  });

  // Phase 29: record audit entry for the decision.
  await recordAudit({
    actor: existing.requester ?? "owner",
    actorRole: "owner",
    action: decision,
    resource: "Approval",
    resourceId: updated.id,
    before: { status: existing.status, title: existing.title },
    after: { status: decision, title: updated.title, actionResult },
    source: "api",
  });

  return NextResponse.json({ ok: true, status: decision, actionResult });
}
