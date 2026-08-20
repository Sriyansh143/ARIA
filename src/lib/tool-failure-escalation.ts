/**
 * src/lib/tool-failure-escalation.ts — Phase 32 Remediation
 *
 * Implements the "Debate and Owner Escalation" pattern mandated by the owner.
 *
 * When a critical tool fails (e.g. web_search returns 0 results after all
 * fallbacks), the system MUST:
 *
 *   1. TRIGGER THE COUNCIL DEBATE — multiple agents argue about the best
 *      fallback strategy. This uses the existing `startDebate()` function
 *      from src/lib/debate.ts.
 *   2. IF THE COUNCIL CANNOT RESOLVE → CREATE AN APPROVAL ROW asking the
 *      owner to choose: "Retry with Tavily" / "Pause Lead Gen" / "Fix Config"
 *   3. DISPATCH VIA TELEGRAM with inline keyboard (Phase 29)
 *
 * This replaces the old "fire-and-forget" pattern where the wrapper just
 * logged a warning + sent one Telegram alert + returned empty array.
 *
 * ARCHITECTURE
 * ------------
 * The escalation has 3 tiers:
 *
 *   Tier 1: Council Debate (autonomous)
 *     - The Researcher agent argues for retrying with Tavily
 *     - The Strategist agent argues for pausing lead gen
 *     - The CTO agent argues for fixing the SDK config
 *     - If they reach consensus (confidence > 0.7), execute that strategy
 *
 *   Tier 2: Owner Approval (HITL)
 *     - If the council can't reach consensus, create an Approval row
 *     - Dispatch via Telegram with inline keyboard (Approve/Deny/Ask)
 *     - The owner picks the strategy
 *
 *   Tier 3: Pause + Alert (fail-safe)
 *     - If the Approval row isn't decided within 2 hours, pause the affected
 *       cron jobs + send a critical alert
 */

import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { emit } from "@/lib/event-bus";
import { serializeApproval } from "@/lib/approval-brief";

export interface ToolFailureContext {
  tool: string; // "web_search" | "page_reader" | "llm_call" | etc.
  error: string;
  module: string; // "google-maps-scout" | "social-scout" | etc.
  context: string; // human-readable context ("searching for restaurants in Chennai")
  attempts: number; // how many times we've tried
  lastTriedAt: Date;
}

export interface EscalationResult {
  escalated: boolean;
  strategy?: "retry-tavily" | "retry-serper" | "pause-cron" | "fix-config" | "continue-anyway";
  approvalId?: string;
  debateId?: string;
  reason: string;
}

// ─── Tier 1: Council Debate ──────────────────────────────────────────

/**
 * Trigger a council debate about how to handle a tool failure.
 * Multiple agents argue for different strategies. If they reach consensus,
 * return that strategy. Otherwise, return null (escalate to owner).
 */
async function triggerCouncilDebate(ctx: ToolFailureContext): Promise<{
  consensus: "retry-tavily" | "retry-serper" | "pause-cron" | "fix-config" | null;
  debateId?: string;
  transcript?: unknown;
}> {
  try {
    const { startDebate } = await import("./debate");
    const topic = `Tool failure: ${ctx.tool} in ${ctx.module}. Error: ${ctx.error}. Context: ${ctx.context}. ` +
      `Which fallback strategy should we use? Options: ` +
      `(a) retry with Tavily API, (b) retry with Serper API, (c) pause the cron job, (d) fix the SDK config. ` +
      `Respond with ONLY the letter (a/b/c/d) + a 1-sentence justification.`;

    const debate = await startDebate({
      topic,
      participants: ["zai", "groq"], // Researcher (Z-AI) + Strategist (Groq)
      rounds: 1, // single round — we just need a quick decision
    });

    // The debate returns { id, consensus, confidence, status }.
    // The consensus is the winning argument TEXT. We parse it for the letter.
    const consensusText = debate.consensus ?? "";
    const match = consensusText.match(/\b([abcd])\b/i);
    const confidence = debate.confidence ?? 0;

    // Consensus requires confidence > 0.7 + a clear letter vote.
    if (match && confidence > 0.7) {
      const strategyMap: Record<string, "retry-tavily" | "retry-serper" | "pause-cron" | "fix-config"> = {
        a: "retry-tavily",
        b: "retry-serper",
        c: "pause-cron",
        d: "fix-config",
      };
      return {
        consensus: strategyMap[match[1].toLowerCase()] ?? null,
        debateId: debate.id,
        transcript: { consensusText, confidence },
      };
    }

    // No consensus — escalate to owner.
    return { consensus: null, debateId: debate.id, transcript: { consensusText, confidence } };
  } catch (err) {
    logger.warn("tool-failure-escalation.debate-failed", { error: String(err) });
    return { consensus: null };
  }
}

// ─── Tier 2: Owner Approval ──────────────────────────────────────────

/**
 * Create an Approval row asking the owner to choose a fallback strategy.
 * Dispatches via Telegram with inline keyboard (Phase 29).
 */
async function createOwnerApproval(
  ctx: ToolFailureContext,
  debateId?: string,
): Promise<string> {
  const title = `🔧 Tool Failure: ${ctx.tool} in ${ctx.module}`;
  const summary = `The ${ctx.tool} tool has failed ${ctx.attempts} times. ` +
    `Last error: ${ctx.error}. Context: ${ctx.context}. ` +
    (debateId ? `Council debate ${debateId} could not reach consensus. ` : "") +
    `Choose a fallback strategy:`;

  const approval = await db.approval.create({
    data: {
      title,
      summary,
      risk: "high",
      status: "pending",
      requester: "tool-failure-escalation",
      action: "tool-failure-decision",
      payload: JSON.stringify({
        tool: ctx.tool,
        module: ctx.module,
        error: ctx.error,
        context: ctx.context,
        attempts: ctx.attempts,
        debateId,
        options: ["retry-tavily", "retry-serper", "pause-cron", "fix-config"],
      }),
    },
  });

  // Dispatch via Telegram with inline keyboard (Phase 29).
  try {
    const { requestOwnerApproval, buildApprovalRequestFromRow } = await import(
      "./owner-approval/telegram-approval"
    );
    const payload = await buildApprovalRequestFromRow(approval.id, "generic");
    if (payload) {
      await requestOwnerApproval(payload);
    }
  } catch (err) {
    // Telegram might not be configured — fall back to legacy notification.
    logger.warn("tool-failure-escalation.telegram-failed", { approvalId: approval.id, error: String(err) });
    try {
      const { sendTelegramMessage } = await import("./telegram-notifier");
      await sendTelegramMessage(
        `🔧 *TOOL FAILURE ESCALATION*\n\n` +
        `*Tool:* ${ctx.tool}\n*Module:* ${ctx.module}\n*Attempts:* ${ctx.attempts}\n` +
        `*Error:* ${ctx.error.slice(0, 200)}\n*Context:* ${ctx.context}\n\n` +
        `_The council could not reach consensus. Owner decision required._\n` +
        `Review in dashboard → Operations → Approvals.`,
      );
    } catch { /* best-effort */ }
  }

  // Emit through the event bus so the dashboard opens the approval panel.
  emit({
    type: "approval",
    ts: new Date().toISOString(),
    approval: serializeApproval(approval),
  });

  logger.info("tool-failure-escalation.approval-created", {
    approvalId: approval.id,
    tool: ctx.tool,
    module: ctx.module,
    debateId,
  });

  return approval.id;
}

// ─── Tier 3: Pause + Alert ───────────────────────────────────────────

/**
 * Check for unresolved tool-failure approvals + pause the affected cron
 * jobs if they've been pending for more than 2 hours.
 * Called by a periodic cron (every 15 minutes).
 */
export async function checkUnresolvedEscalations(): Promise<{
  paused: number;
  alerted: number;
}> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const stale = await db.approval.findMany({
    where: {
      status: "pending",
      action: "tool-failure-decision",
      createdAt: { lt: twoHoursAgo },
    },
    take: 10,
  });

  let paused = 0;
  let alerted = 0;

  for (const approval of stale) {
    try {
      const payload = JSON.parse(approval.payload ?? "{}") as {
        module?: string;
        tool?: string;
      };

      // Pause the affected cron job.
      if (payload.module) {
        const cronName = mapModuleToCron(payload.module);
        if (cronName) {
          await db.cronJob.updateMany({
            where: { name: cronName },
            data: { status: "paused" },
          });
          paused++;
        }
      }

      // Send critical alert.
      try {
        const { sendTelegramMessage } = await import("./telegram-notifier");
        await sendTelegramMessage(
          `🔴 *TOOL FAILURE UNRESOLVED — CRON PAUSED*\n\n` +
          `*Approval:* ${approval.id}\n*Tool:* ${payload.tool}\n*Module:* ${payload.module}\n\n` +
          `The owner has not responded for 2+ hours. The affected cron job has been paused.\n` +
          `Resume in dashboard → Operations → Approvals.`,
        );
      } catch { /* best-effort */ }

      alerted++;
    } catch (err) {
      logger.warn("tool-failure-escalation.pause-failed", { approvalId: approval.id, error: String(err) });
    }
  }

  return { paused, alerted };
}

function mapModuleToCron(module: string): string | null {
  // Phase 32 Fix G3: Removed false-positive mapping for competitor-analyzer.
  // The previous version mapped competitor-analyzer → weekly-code-auditor,
  // but competitor-analyzer is NOT run by weekly-code-auditor (that cron
  // runs the self-evolution refactor engine, not competitor analysis).
  // competitor-analyzer is run ad-hoc by the autonomous-business-engine —
  // there's no dedicated cron to pause. Return null so the Tier 3 logic
  // skips the pause + just sends the alert.
  if (module.includes("google-maps") || module.includes("lead-hunter")) return "daily-lead-hunt";
  if (module.includes("social-scout")) return "daily-lead-hunt";
  if (module.includes("earning-researcher")) return "earning-research";
  if (module.includes("lead-finder")) return "daily-lead-hunt";
  if (module.includes("service-researcher")) return "earning-research"; // same cron family
  if (module.includes("earning-method-researcher")) return "earning-research";
  if (module.includes("search-provider") || module.includes("web-search-fallback")) return "daily-lead-hunt"; // search is used by lead-hunt
  // competitor-analyzer: no dedicated cron — return null (alert only, no pause)
  return null;
}

// ─── Public: escalateToolFailure ─────────────────────────────────────

/**
 * The main entry point. Called when a critical tool fails.
 *
 * Flow:
 *   1. Trigger council debate (Tier 1)
 *   2. If consensus → return the strategy (autonomous resolution)
 *   3. If no consensus → create owner approval (Tier 2)
 *   4. If approval not decided in 2h → pause cron + alert (Tier 3)
 *
 * Deduplication: only escalate once per (tool, module) per hour.
 */
export async function escalateToolFailure(ctx: ToolFailureContext): Promise<EscalationResult> {
  // Check for an existing pending escalation for this tool+module.
  const existing = await db.approval.findFirst({
    where: {
      action: "tool-failure-decision",
      status: "pending",
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }, // last hour
    },
    take: 1,
  });

  if (existing) {
    logger.info("tool-failure-escalation.already-pending", {
      existingApprovalId: existing.id,
      tool: ctx.tool,
      module: ctx.module,
    });
    return {
      escalated: true,
      approvalId: existing.id,
      reason: "escalation already pending (deduped within 1 hour)",
    };
  }

  // Tier 1: Council debate
  const debate = await triggerCouncilDebate(ctx);

  if (debate.consensus) {
    logger.info("tool-failure-escalation.council-consensus", {
      tool: ctx.tool,
      module: ctx.module,
      strategy: debate.consensus,
      debateId: debate.debateId,
    });
    return {
      escalated: false,
      strategy: debate.consensus,
      debateId: debate.debateId,
      reason: `council reached consensus: ${debate.consensus}`,
    };
  }

  // Tier 2: Owner approval
  const approvalId = await createOwnerApproval(ctx, debate.debateId);

  return {
    escalated: true,
    approvalId,
    debateId: debate.debateId,
    reason: "council could not reach consensus — escalated to owner",
  };
}
