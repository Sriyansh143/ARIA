/**
 * src/lib/conductor/router.ts — Autonomy-Aware Workflow Router (v59)
 *
 * Implements the Notion "AI Company Map" Autonomy Tags integration.
 *
 * Every workflow + skill carries an `autonomyTag` (enum on the Prisma
 * `WorkflowDefinition` and `Skill` models):
 *   - HUMAN_LED         → the conductor refuses to auto-run; owner must trigger
 *   - HUMAN_ASSISTED    → router creates an Approval row + sends a Telegram
 *                         brief to the owner, then BLOCKS until the owner
 *                         approves/denies via the dashboard or `/approve`
 *                         Telegram command
 *   - FULLY_AUTONOMOUS  → runs directly (the Quality Supervisor still
 *                         trajectory-validates the output post-hoc)
 *
 * The router is the single chokepoint that ALL workflow + skill executions
 * pass through, so the autonomy policy cannot be bypassed by a rogue agent.
 */

import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { emit } from "@/lib/event-bus";
import { AutonomyTag } from "@prisma/client";
import { sendTelegramMessage } from "@/lib/telegram-notifier";

// Re-export the enum so callers don't need a second import.
export { AutonomyTag };

export type AutonomyTagValue = `${AutonomyTag}`;

export interface RouteDecision {
  /** Whether the conductor may proceed with execution right now. */
  allowed: boolean;
  /** Why execution was blocked (when `allowed === false`). */
  reason?: string;
  /** The autonomy tag that governed this decision. */
  autonomyTag: AutonomyTag;
  /** For HUMAN_ASSISTED — the Approval row id pending owner decision. */
  approvalId?: string;
  /** Whether a Telegram brief was sent. */
  telegramSent?: boolean;
}

/**
 * Route a persisted WorkflowDefinition by its autonomy tag.
 *
 * Called by the workflow-engine BEFORE `executeWorkflow()`. Returns a
 * `RouteDecision` describing whether to run, block-for-approval, or refuse.
 */
export async function routeWorkflowByAutonomy(
  workflowId: string,
  requester: string,
): Promise<RouteDecision> {
  const wf = await db.workflowDefinition.findUnique({ where: { id: workflowId } });
  if (!wf) {
    return { allowed: false, reason: "workflow not found", autonomyTag: AutonomyTag.HUMAN_LED };
  }

  // v61 Phase 4 (Owner Rule: The Council Pattern) — before any complex
  // workflow proceeds (even FULLY_AUTONOMOUS), convene a council of 3-4
  // relevant agents to get their perspectives. The brief is logged so the
  // execution path can read it. This mirrors how a real MNC CEO doesn't
  // make complex decisions alone — they consult the C-suite first.
  try {
    // Determine complexity from the step count + trigger type.
    const stepCount = wf.stepsJson ? JSON.parse(wf.stepsJson).length : 0;
    const complexity: "low" | "medium" | "high" = stepCount > 6 ? "high" : stepCount > 3 ? "medium" : "low";
    if (complexity === "high") {
      const { conveneCouncil } = await import("./council");
      // Infer the domain from the workflow's name/description.
      const domain = inferDomain(wf.name + " " + (wf.description ?? ""));

      // Phase 33 Fix 4: AWAIT the council + use its output to inform execution.
      //
      // Before this fix, the council was fire-and-forget (`.then()` without await).
      // The council's brief (aggregatedRisks, riskMitigation, recommendation) was
      // logged but never read back to inform execution.
      //
      // Now we:
      //   1. Await the council (with a 30s timeout — best-effort, never blocking)
      //   2. If the recommendation is "ESCALATE", create an Approval row before proceeding
      //   3. If "BLOCK", halt the workflow + emit a system event
      //   4. If "PROCEED_WITH_CAUTION" or null, continue execution with risks noted
      //
      let councilRisks: string[] = [];
      let councilMitigation: string[] = [];
      try {
        const brief = await Promise.race([
          conveneCouncil({
            description: `${wf.name}: ${wf.description ?? "(no description)"}`,
            domain,
            complexity,
            requester,
            taskId: workflowId,
          }),
          new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error("council timeout")), 30_000),
          ),
        ]);

        if (brief) {
          councilRisks = brief.aggregatedRisks ?? [];

          logger.info("conductor.router.council-convened", {
            workflowId,
            members: brief.members.length,
            risks: councilRisks.length,
            synthesis: (brief.conductorSynthesis ?? "").slice(0, 100),
          });

          // Phase 33 Fix 4: If the council synthesis contains "escalate" or
          // "owner approval" or "human", treat it as an ESCALATE recommendation.
          const synthesis = (brief.conductorSynthesis ?? "").toLowerCase();
          const shouldEscalate = synthesis.includes("escalate") || synthesis.includes("owner approval") || synthesis.includes("human");
          const shouldBlock = synthesis.includes("block") || synthesis.includes("halt") || synthesis.includes("stop");

          // If the council recommends escalation, create an Approval row.
          if (shouldEscalate) {
            const { db } = await import("../db");
            const { emit } = await import("../event-bus");
            const { serializeApproval } = await import("../approval-brief");

            const councilApproval = await db.approval.create({
              data: {
                title: `🧠 Council Escalation: ${wf.name}`,
                summary: `The multi-agent council reviewed this high-complexity workflow and recommends owner escalation.\n\nRisks:\n${councilRisks.map((r) => `• ${r}`).join("\n")}\n\nCouncil Synthesis:\n${brief.conductorSynthesis ?? "(no synthesis)"}`,
                risk: "high",
                status: "pending",
                requester,
                action: "council-escalation",
                payload: JSON.stringify({ workflowId, risks: councilRisks, synthesis: brief.conductorSynthesis ?? "" }),
              },
            });

            try {
              const { requestOwnerApproval, buildApprovalRequestFromRow } = await import("../owner-approval/telegram-approval");
              const payload = await buildApprovalRequestFromRow(councilApproval.id, "generic");
              if (payload) await requestOwnerApproval(payload);
            } catch { /* Telegram not configured */ }

            emit({
              type: "system",
              ts: new Date().toISOString(),
              message: `🧠 Council escalated workflow "${wf.name}" — ${councilRisks.length} risks identified. Owner approval required.`,
              level: "warn",
            });

            return {
              allowed: false,
              autonomyTag: AutonomyTag.HUMAN_ASSISTED,
              reason: `Council escalation — ${councilRisks.length} risks identified. Owner approval required (approval ${councilApproval.id.slice(-8)}).`,
              approvalId: councilApproval.id,
            };
          }

          // If the council recommends blocking, halt the workflow.
          if (shouldBlock) {
            const { emit } = await import("../event-bus");
            emit({
              type: "system",
              ts: new Date().toISOString(),
              message: `🛑 Council BLOCKED workflow "${wf.name}" — critical risks: ${councilRisks.slice(0, 3).join(", ")}`,
              level: "error",
            });

            return {
              allowed: false,
              autonomyTag: AutonomyTag.HUMAN_LED,
              reason: `Council blocked — critical risks: ${councilRisks.slice(0, 3).join(", ")}`,
            };
          }

          // PROCEED_WITH_CAUTION or null — continue with risks noted
        }
      } catch (councilErr) {
        // Council timeout or failure — proceed without it (best-effort)
        logger.warn("conductor.router.council-failed-or-timeout", { workflowId, error: String(councilErr) });
      }

      // Store the council risks for the workflow execution context.
      // The workflow engine will pick these up via the event bus system message.
      if (councilRisks.length > 0) {
        try {
          const { emit } = await import("../event-bus");
          emit({
            type: "system",
            ts: new Date().toISOString(),
            message: `🧠 Council risks for "${wf.name}": ${councilRisks.slice(0, 5).join(" · ")}`,
            level: "warn",
          });
        } catch { /* best-effort */ }
      }
    }
  } catch (councilErr) {
    logger.warn("conductor.router.council-injection-failed", { workflowId, error: String(councilErr) });
  }

  switch (wf.autonomyTag) {
    case AutonomyTag.FULLY_AUTONOMOUS:
      logger.info("conductor.router.autonomous", { workflowId, slug: wf.slug });
      return { allowed: true, autonomyTag: AutonomyTag.FULLY_AUTONOMOUS };

    case AutonomyTag.HUMAN_LED:
      // The owner must trigger this explicitly via the dashboard — cron /
      // autonomous agents may NOT invoke it.
      logger.warn("conductor.router.blocked-human-led", { workflowId, slug: wf.slug, requester });
      emit({
        type: "system",
        ts: new Date().toISOString(),
        message: `🔒 Workflow "${wf.name}" is HUMAN_LED — refused auto-execution (requester: ${requester})`,
        level: "warn",
      });
      return {
        allowed: false,
        autonomyTag: AutonomyTag.HUMAN_LED,
        reason: "HUMAN_LED workflow — owner must trigger manually via the dashboard",
      };

    case AutonomyTag.HUMAN_ASSISTED:
      // Create an Approval row + send a Telegram brief + block.
      return queueTelegramApproval(wf.id, wf.name, wf.description ?? undefined, requester);

    default:
      return { allowed: false, reason: `unknown autonomyTag: ${wf.autonomyTag as string}`, autonomyTag: AutonomyTag.HUMAN_LED };
  }
}

/**
 * Route a Skill invocation by its autonomy tag.
 *
 * Called by the Hermes skill executor BEFORE running the skill script.
 * Same semantics as `routeWorkflowByAutonomy` for skills.
 */
export async function routeSkillByAutonomy(
  skillId: string,
  requester: string,
): Promise<RouteDecision> {
  const skill = await db.skill.findUnique({ where: { id: skillId } });
  if (!skill) {
    return { allowed: false, reason: "skill not found", autonomyTag: AutonomyTag.HUMAN_LED };
  }

  switch (skill.autonomyTag) {
    case AutonomyTag.FULLY_AUTONOMOUS:
      return { allowed: true, autonomyTag: AutonomyTag.FULLY_AUTONOMOUS };

    case AutonomyTag.HUMAN_LED:
      logger.warn("conductor.router.skill-blocked-human-led", { skillId, slug: skill.slug, requester });
      return {
        allowed: false,
        autonomyTag: AutonomyTag.HUMAN_LED,
        reason: `HUMAN_LED skill "${skill.name}" — owner must invoke manually`,
      };

    case AutonomyTag.HUMAN_ASSISTED:
      return queueTelegramApproval(skill.id, `Skill: ${skill.name}`, skill.description ?? undefined, requester);

    default:
      return { allowed: false, reason: `unknown autonomyTag: ${skill.autonomyTag as string}`, autonomyTag: AutonomyTag.HUMAN_LED };
  }
}

/**
 * Create an Approval row + send a Telegram brief, then return a "blocked"
 * decision. The caller polls `isApprovalResolved(approvalId)` or waits for
 * the SSE `approval.decided` event before re-dispatching.
 *
 * This is the heart of the HUMAN_ASSISTED autonomy policy.
 *
 * v61 Phase 1 (Audit Findings #3 + #4):
 *   - Detects payment/spend workflows and sets action="spend" + risk="high"
 *     so payment approvals are ISOLATED from routine approvals.
 *   - Calls generateApprovalBrief() to produce a real LLM-generated brief
 *     (WHY/RISKS/IF-APPROVED/IF-NOT/CLARIFICATIONS) saved to Approval.brief.
 *   - Sends a VISUALLY DISTINCT Telegram brief for payment approvals
 *     (🔴 ALL-CAPS prefix + amount) so they can't be rubber-stamped.
 */
async function queueTelegramApproval(
  entityId: string,
  title: string,
  summary: string | undefined,
  requester: string,
): Promise<RouteDecision> {
  try {
    // ─── v61 Phase 1 (Audit #3): Classify payment approvals ──────────
    // Inspect the title + summary for payment/spend keywords. If matched,
    // set action="spend" + risk="high" so the auto-decider skips it +
    // the Telegram brief is visually distinct + the 60s cooldown applies.
    const lowerTitle = title.toLowerCase();
    const lowerSummary = (summary ?? "").toLowerCase();
    const PAYMENT_KEYWORDS = [
      "spend", "payment", "pay ", "payout", "disburse", "transfer funds",
      "withdraw", "purchase", "subscribe", "subscription", "renew",
      "upgrade", "credit card", "wire", "invoice payment",
    ];
    const isPayment = PAYMENT_KEYWORDS.some(
      (k) => lowerTitle.includes(k) || lowerSummary.includes(k),
    );
    // Extract an amount from the title/summary if present (e.g. "$5,000" or "5000 USD")
    const amountMatch = (title + " " + (summary ?? "")).match(/\$?\s*([\d,]+(?:\.\d{2})?)\s*(?:USD|dollars|\$)?/i);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, "")) : null;
    const action = isPayment ? "spend" : "execute_workflow_or_skill";
    const risk = isPayment ? "high" : "medium";

    const approval = await db.approval.create({
      data: {
        title: `${title}`.slice(0, 200),
        summary: summary?.slice(0, 500) ?? null,
        risk,
        requester,
        action,
        amount,
        payload: JSON.stringify({ entityId, requester, queuedAt: new Date().toISOString(), isPayment }),
        status: "pending",
      },
    });

    // ─── v61 Phase 1 (Audit #4): Generate the LLM approval brief ──────
    // The brief produces structured WHY/RISKS/IF-APPROVED/IF-NOT/CLARIFICATIONS
    // so the owner can make an informed decision. Saved to Approval.brief.
    // Best-effort — if the LLM is unavailable, the deterministic fallback in
    // approval-brief.ts produces a usable brief from the approval fields.
    try {
      const { generateApprovalBrief, briefToJson } = await import("@/lib/approval-brief");
      const brief = await generateApprovalBrief(
        {
          id: approval.id,
          title: approval.title,
          summary: approval.summary,
          action: approval.action,
          amount: approval.amount,
          risk: approval.risk,
          requester: approval.requester,
        },
        {
          agentRole: requester,
          action: action,
          args: { isPayment, amount, entityId },
        },
      );
      await db.approval.update({
        where: { id: approval.id },
        data: { brief: briefToJson(brief) },
      });
    } catch (briefErr) {
      logger.warn("conductor.router.brief-generation-failed", { approvalId: approval.id, error: String(briefErr) });
    }

    // Send the Telegram brief (best-effort — if Telegram isn't configured,
    // the dashboard still shows the pending approval).
    // v61 Phase 1 (Audit #3): Payment approvals get a VISUALLY DISTINCT
    // brief (🔴 ALL-CAPS prefix + amount) so they can't be overlooked.
    //
    // ─── Phase 29 — Telegram-FIRST with inline keyboard ───────────────
    // We now use requestOwnerApproval() which sends the brief WITH
    // inline Approve/Deny/Ask/Suggest buttons. The legacy text-only path
    // is preserved as a fallback (and still used for payment approvals
    // which require the /pay-approve cooldown — inline Approve is disabled
    // for those to prevent accidental rubber-stamping).
    let telegramSent = false;
    try {
      if (isPayment) {
        // Payment approvals — keep the text-only path (no inline Approve
        // button) to enforce the /pay-approve 60s cooldown.
        const amountLine = amount ? `*Amount:* $${amount.toLocaleString()}\n` : "";
        const text =
          `🔴🔴🔴 *PAYMENT APPROVAL REQUIRED* 🔴🔴🔴\n\n` +
          `*Title:* ${approval.title}\n` +
          amountLine +
          `*Risk:* ${approval.risk.toUpperCase()}\n` +
          `*Requester:* ${requester}\n\n` +
          `⚠️ This is a FINANCIAL approval. The auto-decider is BLOCKED.\n` +
          `⚠️ Use /discuss ${approval.id.slice(-8)} <question> to ask before deciding.\n` +
          `⚠️ Use /pay-approve ${approval.id.slice(-8)} (NOT /approve) to approve.\n\n` +
          `_Or review the full brief in the dashboard._`;
        telegramSent = await sendTelegramMessage(text);
      } else {
        // Phase 29: use the new Telegram-FIRST approval flow with
        // inline keyboard buttons.
        const { requestOwnerApproval, buildApprovalRequestFromRow } = await import(
          "@/lib/owner-approval/telegram-approval"
        );
        const reqPayload = await buildApprovalRequestFromRow(approval.id);
        if (reqPayload) {
          const result = await requestOwnerApproval(reqPayload);
          telegramSent = result.sent;
        } else {
          // Fallback: payload build failed (approval was deleted?), use text-only.
          telegramSent = await sendTelegramMessage(
            `⏳ *ARIA Approval Required (HUMAN_ASSISTED)*\n\n*Title:* ${approval.title}\n*Requester:* ${requester}\n\n_Type /approvals to see pending items._`,
          );
        }
      }
    } catch (tgErr) {
      logger.warn("conductor.router.telegram-failed", { approvalId: approval.id, error: String(tgErr) });
    }

    emit({
      type: "system",
      ts: new Date().toISOString(),
      message: `🔒 HUMAN_ASSISTED — ${isPayment ? "PAYMENT " : ""}approval queued for "${approval.title}" (id ${approval.id.slice(-8)})`,
      level: isPayment ? "error" : "warn",
    });

    logger.info("conductor.router.approval-queued", {
      entityId,
      approvalId: approval.id,
      telegramSent,
      requester,
      isPayment,
      action,
      risk,
      amount,
    });

    return {
      allowed: false, // BLOCKED — caller must wait for approval
      autonomyTag: AutonomyTag.HUMAN_ASSISTED,
      reason: isPayment
        ? "HUMAN_ASSISTED PAYMENT — awaiting owner approval (auto-decider blocked, 60s cooldown applies)"
        : "HUMAN_ASSISTED — awaiting owner approval (Telegram brief sent)",
      approvalId: approval.id,
      telegramSent,
    };
  } catch (err) {
    logger.error("conductor.router.approval-queue-failed", { entityId, error: String(err) });
    // Fail-closed: if we can't create the approval row, refuse to run.
    return {
      allowed: false,
      autonomyTag: AutonomyTag.HUMAN_ASSISTED,
      reason: `failed to queue approval: ${String(err).slice(0, 120)}`,
    };
  }
}

/**
 * Check whether a previously-queued HUMAN_ASSISTED approval has been decided.
 * Returns:
 *   - { resolved: false } when still pending
 *   - { resolved: true, approved: true } when the owner approved
 *   - { resolved: true, approved: false } when denied/expired
 */
export async function isApprovalResolved(
  approvalId: string,
): Promise<{ resolved: boolean; approved?: boolean; reason?: string }> {
  const row = await db.approval.findUnique({ where: { id: approvalId } });
  if (!row) return { resolved: true, approved: false, reason: "approval not found" };
  if (row.status === "pending") return { resolved: false };
  return { resolved: true, approved: row.status === "approved", reason: row.status };
}

/**
 * Convenience: route + wait (poll) for a HUMAN_ASSISTED workflow.
 *
 * Polls every `pollMs` (default 5s) up to `timeoutMs` (default 5min).
 * Used by long-running orchestrators that can afford to block. Cron jobs
 * should use `routeWorkflowByAutonomy` + a separate re-dispatch on the
 * `approval.decided` SSE event instead.
 */
export async function routeAndWaitForApproval(
  workflowId: string,
  requester: string,
  opts: { pollMs?: number; timeoutMs?: number } = {},
): Promise<RouteDecision & { approved?: boolean }> {
  const decision = await routeWorkflowByAutonomy(workflowId, requester);
  if (decision.allowed) return { ...decision, approved: true };
  if (!decision.approvalId) return { ...decision, approved: false };

  const pollMs = opts.pollMs ?? 5_000;
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const r = await isApprovalResolved(decision.approvalId);
    if (r.resolved) {
      return { ...decision, approved: r.approved, reason: r.reason };
    }
  }
  return { ...decision, approved: false, reason: "approval timed out" };
}

/**
 * v61 Phase 4 (Council Pattern): Infer the task domain from the workflow
 * name + description so the council can select the right agents.
 */
function inferDomain(text: string): string {
  const lower = text.toLowerCase();
  if (/code|deploy|build|engineer|api|architecture|pr|review/.test(lower)) return "code";
  if (/market|content|blog|seo|ad|brand|campaign/.test(lower)) return "marketing";
  if (/finance|revenue|invoice|payment|tax|account|cost|budget/.test(lower)) return "finance";
  if (/sales|lead|outreach|deal|pipeline|crm|prospect/.test(lower)) return "sales";
  if (/research|analy|data|forecast|metric|report/.test(lower)) return "research";
  if (/ops|monitor|incident|deploy|infra|cron|schedule/.test(lower)) return "operations";
  return "general";
}
