import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { emit } from "@/lib/event-bus";
import { toIso, type Approval, type ApprovalRisk } from "@/lib/types";
import {
  generateApprovalBrief,
  briefToJson,
  serializeApproval,
  notifyOwner,
} from "@/lib/approval-brief";
import { logger } from "@/lib/logger";
import { parsePagination, paginatedResponse } from "@/lib/pagination";

export const dynamic = "force-dynamic";

/**
 * GET /api/approvals
 *
 * Returns the most recent approvals WITH their briefs + discussion logs
 * (the JSON columns are returned as raw strings; the client parses them
 * lazily for the drawer).
 *
 * Query params:
 *   ?status=pending   filter by status (default: all)
 *   ?brief=1          only approvals that have a brief generated
 *   ?limit=30         cap (max 100, default 30) — legacy envelope, ignored when ?page= is present
 *   ?page=1           when present, response uses the paginated envelope:
 *                       { data, pagination: { page, limit, total, totalPages, hasMore } }
 *                     when absent, response is the legacy { approvals, count } envelope.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const onlyWithBrief = url.searchParams.get("brief") === "1";
    const hasPage = url.searchParams.has("page");

    const where: { status?: string; brief?: { not: null } } = {};
    if (status && ["pending", "approved", "denied", "expired"].includes(status)) {
      where.status = status;
    }
    if (onlyWithBrief) {
      where.brief = { not: null };
    }

    if (hasPage) {
      const { take, skip, page, limit } = parsePagination(req);
      const [rows, total] = await Promise.all([
        db.approval.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take,
          skip,
        }),
        db.approval.count({ where }),
      ]);
      const approvals = rows.map(serializeApproval);
      return NextResponse.json(paginatedResponse(approvals, total, page, limit));
    }

    // Legacy path (no ?page=) — original envelope.
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "30", 10) || 30, 100);

    const rows = await db.approval.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const approvals = rows.map(serializeApproval);
    return NextResponse.json({ approvals, count: approvals.length });
  } catch (err) {
    logger.error("api.approvals.list.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to list approvals", detail: String(err) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/approvals
 *
 * Create a new approval request AND auto-generate its owner brief.
 *
 * Body:
 *   {
 *     title: string,
 *     summary?: string,
 *     risk?: "low"|"medium"|"high"|"critical",  // default "medium"
 *     requester?: string,                       // agent name
 *     agentId?: string,
 *     action?: string,                         // deploy | spend | send_email | sign_contract
 *     amount?: number,
 *     payload?: object,                         // JSON action payload
 *     agentRole?: string,                       // for brief generation context
 *     args?: object,                            // brief args
 *     notify?: "telegram"|"call"|null           // proactively notify the owner
 *   }
 *
 * Returns the created approval with its brief.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    summary?: string;
    risk?: string;
    requester?: string;
    agentId?: string;
    action?: string;
    amount?: number;
    payload?: Record<string, unknown>;
    agentRole?: string;
    args?: Record<string, unknown>;
    notify?: "telegram" | "call" | null;
  };

  if (!body.title || typeof body.title !== "string" || body.title.trim().length === 0) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const risk: ApprovalRisk = (
    ["low", "medium", "high", "critical"].includes(body.risk ?? "")
      ? body.risk
      : "medium"
  ) as ApprovalRisk;

  const payloadStr = body.payload ? JSON.stringify(body.payload) : null;

  // Insert the approval row first.
  const row = await db.approval.create({
    data: {
      title: body.title.trim(),
      summary: body.summary?.trim() ?? null,
      risk,
      status: "pending",
      requester: body.requester?.trim() ?? null,
      agentId: body.agentId?.trim() || null,
      action: body.action?.trim() ?? null,
      amount: typeof body.amount === "number" ? body.amount : null,
      payload: payloadStr,
    },
  });

  // Generate the owner brief (LLM with deterministic fallback).
  const brief = await generateApprovalBrief(
    {
      id: row.id,
      title: row.title,
      summary: row.summary,
      action: row.action,
      amount: row.amount,
      risk: row.risk,
      requester: row.requester,
    },
    {
      agentRole: body.agentRole ?? body.requester ?? "Conductor",
      action: body.action ?? "(unspecified)",
      args: body.args ?? {},
    }
  );

  const updated = await db.approval.update({
    where: { id: row.id },
    data: { brief: briefToJson(brief) },
  });

  // Emit through the event bus so the dashboard opens the approval panel.
  const approvalPayload: Approval = serializeApproval(updated);
  emit({ type: "approval", ts: new Date().toISOString(), approval: approvalPayload });

  // Phase 29 — Telegram-FIRST approval dispatch.
  // When the request includes `notify: "telegram"` (or doesn't specify a
  // notify channel but Telegram is configured), we send the brief with
  // inline Approve/Deny/Ask/Suggest buttons. The legacy notifyOwner() path
  // is preserved as a fallback for `notify: "call"`.
  const notifyChannel: "telegram" | "call" | null =
    body.notify === "telegram" || body.notify === "call" ? body.notify : null;

  if (notifyChannel === "telegram") {
    try {
      const { requestOwnerApproval, buildApprovalRequestFromRow } = await import(
        "@/lib/owner-approval/telegram-approval"
      );
      const payload = await buildApprovalRequestFromRow(updated.id);
      if (payload) {
        await requestOwnerApproval(payload);
      } else {
        // Fallback to legacy text-only brief if payload build fails.
        await notifyOwner(updated.id, "telegram");
      }
    } catch (err) {
      logger.warn("api.approvals.post.telegram-approval-failed", { id: updated.id, error: String(err) });
      // Fall back to the legacy notifier so a Telegram message at least goes out.
      try { await notifyOwner(updated.id, "telegram"); } catch { /* best-effort */ }
    }
  } else if (notifyChannel === "call") {
    try {
      await notifyOwner(updated.id, "call");
    } catch (err) {
      logger.warn("api.approvals.post.notify-failed", { id: updated.id, error: String(err) });
    }
  }

  // Phase 29: record audit entry for the approval creation.
  try {
    const { recordAudit } = await import("@/lib/audit-log");
    await recordAudit({
      actor: body.requester ?? "system",
      actorRole: body.requester ? "agent" : "system",
      action: "create",
      resource: "Approval",
      resourceId: updated.id,
      after: { title: updated.title, risk: updated.risk, action: updated.action, amount: updated.amount },
      source: "api",
    });
  } catch (auditErr) {
    logger.warn("api.approvals.post.audit-failed", { id: updated.id, error: String(auditErr) });
  }

  logger.info("api.approvals.create", { id: updated.id, action: updated.action, risk: updated.risk });
  return NextResponse.json(
    {
      approval: approvalPayload,
      brief,
      notified: body.notify ?? null,
    },
    { status: 201 }
  );
}

// Re-export toIso for downstream consumers (prevents tree-shake removal
// in case other modules import via this route file in tests — none today
// but kept for safety).
void toIso;
