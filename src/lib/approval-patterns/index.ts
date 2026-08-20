/**
 * src/lib/approval-patterns/index.ts — v72 Phase 22 (RULE-71)
 *
 * Per-category approval pattern registry. The owner approves a PATTERN ONCE
 * — including the full post content, call script, or message template — and
 * the app can then reuse that approved pattern for all matching future
 * outreach without re-approving each individual instance.
 *
 * Approval shape (per RULE-71):
 *   - channel: instagram | facebook | x | linkedin | whatsapp-blast | email-blast | call
 *   - category: e.g. "free-offer-100", "no-website-outreach", "imported-contact-blast"
 *   - contentTemplate: the post text, message body, or call script
 *   - variablesJson: list of {{var}} placeholders in the template
 *   - targetAudienceDescription: who this targets
 *   - expiresAt: max 30 days after approval
 *
 * The approval is REUSABLE — the app calls isPatternApproved(channel, category)
 * to check before any outreach. New patterns or content variations require
 * fresh approval. Existing approved patterns can be revoked at any time.
 */

import "server-only";
import { db } from "../db";
import { logger } from "../logger";
import { emit } from "../event-bus";

// ─── Types ────────────────────────────────────────────────────────────

export type ApprovalChannel =
  | "instagram"
  | "facebook"
  | "x"
  | "linkedin"
  | "whatsapp-blast"
  | "email-blast"
  | "call";

export interface PatternApprovalRequest {
  patternName: string;
  channel: ApprovalChannel;
  category: string;
  contentTemplate: string;
  variablesJson?: string[];
  targetAudienceDescription?: string;
  expiresInDays?: number; // default 30, max 30
}

export interface ApprovedPattern {
  id: string;
  patternName: string;
  channel: ApprovalChannel;
  category: string;
  contentTemplate: string;
  variablesJson: string[];
  targetAudienceDescription: string;
  status: "pending" | "approved" | "rejected" | "revoked" | "expired";
  approvedAt: string | null;
  approvedBy: string;
  expiresAt: string | null;
  usageCount: number;
  maxUsage: number;
}

// ─── Constants ────────────────────────────────────────────────────────

export const MAX_PATTERN_DURATION_DAYS = 30;
export const DEFAULT_PATTERN_EXPIRY_DAYS = 30;
export const DEFAULT_MAX_USAGE = 1000;

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Create a new approval pattern (status: pending). The owner will be
 * notified via Telegram + dashboard. They review the content + approve.
 */
export async function requestPatternApproval(
  req: PatternApprovalRequest,
  requester: string = "ai-system",
): Promise<{ patternId: string; approvalId: string | null }> {
  const expiresInDays = Math.min(req.expiresInDays ?? DEFAULT_PATTERN_EXPIRY_DAYS, MAX_PATTERN_DURATION_DAYS);

  // Check if there's already an approved pattern for this (channel, category).
  const existingApproved = await db.approvedPattern.findFirst({
    where: {
      channel: req.channel,
      category: req.category,
      status: "approved",
      expiresAt: { gt: new Date() },
    },
  });
  if (existingApproved) {
    // If the content template is identical, no new approval needed.
    if (existingApproved.contentTemplate === req.contentTemplate) {
      logger.info("approval-patterns.already-approved", {
        patternId: existingApproved.id,
        channel: req.channel,
        category: req.category,
      });
      return { patternId: existingApproved.id, approvalId: null };
    }
  }

  // Create a new pending pattern.
  const pattern = await db.approvedPattern.create({
    data: {
      patternName: req.patternName,
      channel: req.channel,
      category: req.category,
      contentTemplate: req.contentTemplate,
      variablesJson: JSON.stringify(req.variablesJson ?? []),
      targetAudienceDescription: req.targetAudienceDescription ?? "",
      status: "pending",
      maxUsage: DEFAULT_MAX_USAGE,
    },
  });

  // Create an Approval row for the owner to review.
  const approval = await db.approval.create({
    data: {
      title: `📋 Pattern Approval: ${req.patternName}`,
      summary: `Channel: ${req.channel} | Category: ${req.category} | Expires in ${expiresInDays}d\n\nCONTENT TEMPLATE:\n${req.contentTemplate.slice(0, 800)}${req.contentTemplate.length > 800 ? "..." : ""}`,
      risk: "medium",
      requester,
      action: "execute_workflow_or_skill",
      payload: JSON.stringify({
        type: "pattern-approval",
        patternId: pattern.id,
        channel: req.channel,
        category: req.category,
        contentTemplate: req.contentTemplate,
        variables: req.variablesJson ?? [],
        targetAudienceDescription: req.targetAudienceDescription ?? "",
        expiresInDays,
      }),
      status: "pending",
    },
  });

  // Send a Telegram brief with the full content for the owner to review.
  try {
    const { sendTelegramMessage } = await import("../telegram-notifier");
    await sendTelegramMessage(
      `📋 *NEW PATTERN APPROVAL REQUEST*\n\n` +
      `*Pattern:* ${req.patternName}\n` +
      `*Channel:* ${req.channel}\n` +
      `*Category:* ${req.category}\n` +
      `*Target:* ${req.targetAudienceDescription?.slice(0, 100) ?? "unspecified"}\n` +
      `*Validity:* ${expiresInDays} days after approval\n\n` +
      `*CONTENT TEMPLATE:*\n\`\`\`\n${req.contentTemplate.slice(0, 1500)}\n\`\`\`\n\n` +
      `Variables: ${(req.variablesJson ?? []).join(", ") || "(none)"}\n\n` +
      `Approve: /approve ${approval.id.slice(-8)}\n` +
      `Reject: /deny ${approval.id.slice(-8)}\n` +
      `Discuss: /discuss ${approval.id.slice(-8)} <your question>`
    );
  } catch { /* best-effort */ }

  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: `📋 Pattern approval requested: "${req.patternName}" (${req.channel}/${req.category}) — approval ${approval.id.slice(-8)} queued`,
    level: "info",
  });

  return { patternId: pattern.id, approvalId: approval.id };
}

/**
 * Check if a pattern is currently approved for a given (channel, category).
 * This is the gate the outreach executor calls before any autonomous send/post.
 */
export async function isPatternApproved(
  channel: ApprovalChannel,
  category: string,
): Promise<{ approved: boolean; patternId?: string; contentTemplate?: string; variables?: string[]; expiresAt?: string | null }> {
  const pattern = await db.approvedPattern.findFirst({
    where: {
      channel,
      category,
      status: "approved",
      expiresAt: { gt: new Date() },
      usageCount: { lt: DEFAULT_MAX_USAGE },
    },
    orderBy: { approvedAt: "desc" },
  });
  if (!pattern) return { approved: false };
  return {
    approved: true,
    patternId: pattern.id,
    contentTemplate: pattern.contentTemplate,
    variables: JSON.parse(pattern.variablesJson || "[]"),
    expiresAt: pattern.expiresAt?.toISOString() ?? null,
  };
}

/**
 * Mark a pattern as approved. Called by the approval-executor when the
 * owner /approves the Telegram brief.
 */
export async function approvePattern(
  patternId: string,
  approvedBy: string = "owner",
  expiresInDays: number = DEFAULT_PATTERN_EXPIRY_DAYS,
): Promise<{ ok: boolean; reason?: string }> {
  const actualExpiry = Math.min(expiresInDays, MAX_PATTERN_DURATION_DAYS);
  const expiresAt = new Date(Date.now() + actualExpiry * 24 * 60 * 60 * 1000);
  try {
    await db.approvedPattern.update({
      where: { id: patternId },
      data: {
        status: "approved",
        approvedAt: new Date(),
        approvedBy,
        expiresAt,
      },
    });
    logger.info("approval-patterns.approved", { patternId, approvedBy, expiresAt });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err).slice(0, 100) };
  }
}

/**
 * Revoke an approved pattern. Called when the owner /denies or when the
 * pattern is no longer wanted.
 */
export async function revokePattern(
  patternId: string,
  reason: string = "Owner revocation",
): Promise<{ ok: boolean }> {
  try {
    await db.approvedPattern.update({
      where: { id: patternId },
      data: {
        status: "revoked",
        revokedAt: new Date(),
        revokeReason: reason,
      },
    });
    logger.info("approval-patterns.revoked", { patternId, reason });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Increment the usage count of a pattern (after each successful outreach
 * that used it). Auto-revokes when usageCount >= maxUsage.
 */
export async function incrementPatternUsage(patternId: string): Promise<{ reachedCap: boolean }> {
  const pattern = await db.approvedPattern.findUnique({ where: { id: patternId } });
  if (!pattern) return { reachedCap: true };
  const newCount = pattern.usageCount + 1;
  await db.approvedPattern.update({
    where: { id: patternId },
    data: { usageCount: newCount },
  });
  if (newCount >= pattern.maxUsage) {
    await revokePattern(patternId, `Auto-revoked after reaching maxUsage cap (${pattern.maxUsage})`);
    return { reachedCap: true };
  }
  return { reachedCap: false };
}

/**
 * List all patterns with their current status (for the dashboard).
 */
export async function listPatterns(filter?: {
  channel?: ApprovalChannel;
  category?: string;
  status?: string;
}): Promise<ApprovedPattern[]> {
  const where: any = {};
  if (filter?.channel) where.channel = filter.channel;
  if (filter?.category) where.category = filter.category;
  if (filter?.status) where.status = filter.status;

  const patterns = await db.approvedPattern.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return patterns.map((p: any) => ({
    id: p.id,
    patternName: p.patternName,
    channel: p.channel as ApprovalChannel,
    category: p.category,
    contentTemplate: p.contentTemplate,
    variablesJson: JSON.parse(p.variablesJson || "[]"),
    targetAudienceDescription: p.targetAudienceDescription,
    status: p.status as ApprovedPattern["status"],
    approvedAt: p.approvedAt?.toISOString() ?? null,
    approvedBy: p.approvedBy,
    expiresAt: p.expiresAt?.toISOString() ?? null,
    usageCount: p.usageCount,
    maxUsage: p.maxUsage,
  }));
}

// ─── CallScript (related approval pattern for outbound calls) ────────

/**
 * Request approval for a call script (what the Pipecat voice agent will say
 * on outbound calls). Same per-category approval flow.
 */
export async function requestCallScriptApproval(
  scriptName: string,
  category: string,
  targetAudience: string,
  openingHook: string,
  pitchBody: string,
  objectionHandlers: Array<{ objection: string; response: string }>,
  closingQuestion: string,
): Promise<{ callScriptId: string; approvalId: string }> {
  const script = await db.callScript.create({
    data: {
      scriptName,
      category,
      targetAudience,
      openingHook,
      pitchBody,
      objectionHandlersJson: JSON.stringify(objectionHandlers),
      closingQuestion,
      approvalStatus: "pending",
    },
  });

  const approval = await db.approval.create({
    data: {
      title: `📞 Call Script Approval: ${scriptName}`,
      summary: `Category: ${category}\nTarget: ${targetAudience}\n\nOPENING HOOK (first 5s):\n${openingHook}\n\nPITCH:\n${pitchBody.slice(0, 500)}\n\nCLOSING:\n${closingQuestion}`,
      risk: "high", // calls are higher risk than social posts
      requester: "ai-system",
      action: "execute_workflow_or_skill",
      payload: JSON.stringify({
        type: "call-script-approval",
        callScriptId: script.id,
        category,
        openingHook,
        pitchBody,
        closingQuestion,
      }),
      status: "pending",
    },
  });

  try {
    const { sendTelegramMessage } = await import("../telegram-notifier");
    await sendTelegramMessage(
      `📞 *CALL SCRIPT APPROVAL REQUIRED*\n\n` +
      `*Script:* ${scriptName}\n` +
      `*Category:* ${category}\n` +
      `*Target:* ${targetAudience.slice(0, 100)}\n\n` +
      `*OPENING (first 5s):*\n\`\`\`\n${openingHook}\n\`\`\`\n\n` +
      `*PITCH:*\n\`\`\`\n${pitchBody.slice(0, 800)}\n\`\`\`\n\n` +
      `*CLOSING:*\n${closingQuestion}\n\n` +
      `Approve: /approve ${approval.id.slice(-8)}\n` +
      `Reject: /deny ${approval.id.slice(-8)}`
    );
  } catch { /* best-effort */ }

  return { callScriptId: script.id, approvalId: approval.id };
}

/**
 * Check if a call script is approved for a given category.
 */
export async function isCallScriptApproved(
  category: string,
): Promise<{ approved: boolean; scriptId?: string; openingHook?: string; pitchBody?: string; closingQuestion?: string }> {
  const script = await db.callScript.findFirst({
    where: { category, approvalStatus: "approved" },
    orderBy: { approvedAt: "desc" },
  });
  if (!script) return { approved: false };
  return {
    approved: true,
    scriptId: script.id,
    openingHook: script.openingHook,
    pitchBody: script.pitchBody,
    closingQuestion: script.closingQuestion,
  };
}
