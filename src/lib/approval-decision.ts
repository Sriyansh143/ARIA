/**
 * src/lib/approval-decision.ts — Centralized Approval Decision System
 *
 * Monitoring agents (Pulse-Ops, Guard-Compliance, Shield-QA, Sage-Ethicist)
 * collectively decide whether to approve, deny, or escalate pending approvals.
 *
 * Decision flow:
 *   1. When a new approval is created, it's queued for agent review.
 *   2. Each monitoring agent evaluates the approval from its perspective:
 *      - Pulse-Ops: operational impact, system health
 *      - Guard-Compliance: legal/compliance risk
 *      - Shield-QA: quality/testing readiness
 *      - Sage-Ethicist: ethical considerations
 *   3. Agents vote (approve/deny/escalate) with reasoning.
 *   4. Majority decision + consensus threshold determines the outcome.
 *   5. If consensus is not reached, the approval is escalated to the owner.
 *   6. If all monitoring agents approve, it's auto-approved (no owner button press needed).
 *   7. If any agent denies with critical risk, it's auto-denied.
 *
 * The owner is always notified of the decision via Telegram + dashboard SSE.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { emit } from "@/lib/event-bus";
import { callLLM } from "@/lib/llm-client";

// v77 Phase 27 Fix 2: Deduplication lock to prevent the same approvalId
// from being processed multiple times in rapid succession.
// The user's logs showed the same approval being auto-approved 4-8x in 1 second.
const approvalProcessingLock = new Map<string, number>();
const APPROVAL_COOLDOWN_MS = 30_000; // 30 seconds between evaluations of the same approval

export interface AgentVote {
  agentId: string;
  agentName: string;
  role: string;
  vote: "approve" | "deny" | "escalate";
  reasoning: string;
  riskAssessment: "low" | "medium" | "high" | "critical";
  confidence: number; // 0-1
}

export interface ApprovalDecision {
  approvalId: string;
  votes: AgentVote[];
  consensus: "approved" | "denied" | "escalated" | "pending";
  autoDecided: boolean;
  summary: string;
  decidedAt: string;
}

// The 4 monitoring agents that collectively decide approvals
const MONITORING_AGENTS = [
  { name: "Pulse-Ops", role: "Ops", perspective: "operational impact and system health" },
  { name: "Guard-Compliance", role: "Compliance", perspective: "legal and regulatory compliance" },
  { name: "Shield-QA", role: "QA", perspective: "quality assurance and testing readiness" },
  { name: "Sage-Ethicist", role: "Ethics", perspective: "ethical considerations and societal impact" },
];

/**
 * Evaluate a pending approval using all monitoring agents.
 *
 * Each agent votes independently. The consensus is determined by majority.
 */
export async function evaluateApproval(approvalId: string): Promise<ApprovalDecision> {
  // v77 Phase 27 Fix 2: Check deduplication lock — skip if recently processed.
  const lastProcessed = approvalProcessingLock.get(approvalId) || 0;
  const now = Date.now();
  if (now - lastProcessed < APPROVAL_COOLDOWN_MS) {
    logger.info("approval-decision.skip-recent", {
      approvalId: approvalId.slice(-8),
      msSinceLast: now - lastProcessed,
    });
    return {
      approvalId,
      votes: [],
      consensus: "approved" as const,
      autoDecided: true,
      summary: `Skipped — processed ${(now - lastProcessed) / 1000}s ago (dedup lock)`,
      decidedAt: new Date(lastProcessed).toISOString(),
    };
  }
  // Set the lock BEFORE processing to prevent concurrent evaluations.
  approvalProcessingLock.set(approvalId, now);

  try {
    const approval = await db.approval.findUnique({ where: { id: approvalId } });
    if (!approval) {
      throw new Error(`Approval ${approvalId} not found`);
    }

    // Skip if already decided
    if (approval.status === "approved" || approval.status === "denied") {
      return {
        approvalId,
        votes: [],
        consensus: approval.status as "approved" | "denied",
        autoDecided: true,
        summary: `Already ${approval.status}`,
        decidedAt: (approval.decidedAt ?? approval.createdAt).toISOString(),
      };
    }

    // Get the approval brief (or generate a summary)
    const briefData = approval.brief
      ? JSON.parse(approval.brief)
      : { why: approval.summary ?? approval.title, risks: [], ifApproved: "", ifNotApproved: "" };

    // Each monitoring agent votes
    const votes: AgentVote[] = [];
    for (const agent of MONITORING_AGENTS) {
      const vote = await getAgentVote(approval, agent, briefData);
      votes.push(vote);
    }

    // Determine consensus
    const approves = votes.filter((v) => v.vote === "approve").length;
    const denies = votes.filter((v) => v.vote === "deny").length;
    const escalates = votes.filter((v) => v.vote === "escalate").length;
    const criticalRisks = votes.filter((v) => v.riskAssessment === "critical").length;

    let consensus: "approved" | "denied" | "escalated" | "pending";
    let autoDecided = false;

    // If ANY agent flags critical risk → auto-deny
    if (criticalRisks > 0) {
      consensus = "denied";
      autoDecided = true;
    }
    // If all 4 approve → auto-approve
    else if (approves === MONITORING_AGENTS.length) {
      consensus = "approved";
      autoDecided = true;
    }
    // If majority denies → deny
    else if (denies > MONITORING_AGENTS.length / 2) {
      consensus = "denied";
      autoDecided = true;
    }
    // If majority approves (but not unanimous) → escalate to owner
    else if (approves > MONITORING_AGENTS.length / 2) {
      consensus = "escalated";
      autoDecided = false;
    }
    // Mixed / escalate votes → escalate
    else {
      consensus = "escalated";
      autoDecided = false;
    }

    // Build the summary
    const summary = [
      `Decision: ${consensus.toUpperCase()}`,
      `Votes: ${approves} approve, ${denies} deny, ${escalates} escalate`,
      ...votes.map((v) => `  [${v.agentName}] ${v.vote.toUpperCase()} (${v.riskAssessment} risk): ${v.reasoning.slice(0, 100)}`),
    ].join("\n");

    // Apply the decision
    if (autoDecided && consensus !== "escalated") {
      await db.approval.update({
        where: { id: approvalId },
        data: {
          status: consensus,
          brief: JSON.stringify({ ...briefData, monitoringVotes: votes, decision: consensus }),
        },
      });

      // Emit SSE event
      emit({
        type: "approval",
        ts: new Date().toISOString(),
        approval: {
          id: approvalId,
          title: approval.title,
          summary: approval.summary,
          risk: approval.risk as "low" | "medium" | "high" | "critical",
          status: consensus,
          requester: approval.requester,
          agentId: approval.agentId,
          action: approval.action,
          amount: approval.amount,
          payload: approval.payload,
          brief: approval.brief,
          discussionLog: approval.discussionLog,
          oralConfirmed: approval.oralConfirmed,
          voiceCallId: approval.voiceCallId,
          createdAt: approval.createdAt.toISOString(),
          decidedAt: approval.decidedAt?.toISOString() ?? null,
        },
      });

      // Emit a system log
      emit({
        type: "system",
        ts: new Date().toISOString(),
        message: `Approval "${approval.title}" ${consensus === "approved" ? "auto-approved" : "auto-denied"} by monitoring agents: ${approves}/${MONITORING_AGENTS.length} approved`,
        level: consensus === "approved" ? "success" : "warn",
      });

      logger.info("approval-decision.auto", {
        approvalId,
        consensus,
        approves,
        denies,
        escalates,
      });
    } else {
      // Escalated to owner — update brief with votes
      await db.approval.update({
        where: { id: approvalId },
        data: {
          brief: JSON.stringify({ ...briefData, monitoringVotes: votes, decision: "escalated" }),
        },
      });

      logger.info("approval-decision.escalated", {
        approvalId,
        approves,
        denies,
        escalates,
      });
    }

    return {
      approvalId,
      votes,
      consensus,
      autoDecided,
      summary,
      decidedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.error("approval-decision.error", { approvalId, error: String(err) });
    return {
      approvalId,
      votes: [],
      consensus: "pending",
      autoDecided: false,
      summary: `Evaluation failed: ${String(err)}`,
      decidedAt: new Date().toISOString(),
    };
  }
}

/**
 * Get a single monitoring agent's vote on an approval.
 *
 * Uses the LLM (or mock if ARIA_LLM_DISABLED=1) to evaluate the approval
 * from the agent's specific perspective.
 */
async function getAgentVote(
  approval: { id: string; title: string; summary: string | null; risk: string; requester: string | null; action: string | null },
  agent: { name: string; role: string; perspective: string },
  brief: { why: string; risks: string[]; ifApproved: string; ifNotApproved: string },
): Promise<AgentVote> {
  try {
    const prompt = `You are ${agent.name}, a monitoring agent responsible for ${agent.perspective}.

An approval request has been submitted:
Title: ${approval.title}
Description: ${approval.summary ?? approval.title}
Risk Level: ${approval.risk}
Why it's needed: ${brief.why}
Risks: ${brief.risks.join(", ") || "none identified"}
If approved: ${brief.ifApproved}
If not approved: ${brief.ifNotApproved}

Evaluate this from your perspective (${agent.perspective}).
Respond in EXACTLY this JSON format (no markdown):
{
  "vote": "approve" | "deny" | "escalate",
  "reasoning": "1-2 sentences explaining your vote",
  "riskAssessment": "low" | "medium" | "high" | "critical",
  "confidence": 0.0-1.0
}`;

    const result = await callLLM(agent.name, agent.role, prompt, { maxRetries: 1 });

    let parsed: {
      vote: "approve" | "deny" | "escalate";
      reasoning: string;
      riskAssessment: "low" | "medium" | "high" | "critical";
      confidence: number;
    };

    try {
      const cleaned = result.content
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // Mock fallback — approve low-risk, deny critical, escalate high
      parsed = {
        vote: approval.risk === "critical" ? "deny" : approval.risk === "high" ? "escalate" : "approve",
        reasoning: `Mock vote based on risk level: ${approval.risk}`,
        riskAssessment: approval.risk as "low" | "medium" | "high" | "critical",
        confidence: 0.7,
      };
    }

    // Find the agent's ID from the DB
    const agentRecord = await db.agent.findFirst({ where: { name: agent.name } });

    return {
      agentId: agentRecord?.id ?? agent.name,
      agentName: agent.name,
      role: agent.role,
      vote: parsed.vote,
      reasoning: parsed.reasoning,
      riskAssessment: parsed.riskAssessment,
      confidence: parsed.confidence,
    };
  } catch (err) {
    return {
      agentId: agent.name,
      agentName: agent.name,
      role: agent.role,
      vote: "escalate",
      reasoning: `Evaluation failed: ${String(err).slice(0, 80)}`,
      riskAssessment: "medium",
      confidence: 0.3,
    };
  }
}

/**
 * Start the approval decision loop — checks for new pending approvals every 10 seconds.
 * Idempotent — safe to call multiple times.
 */
const globalForDecider = globalThis as unknown as { __ariaApprovalDecider?: { timer: NodeJS.Timeout | null; started: boolean } };
const deciderState = globalForDecider.__ariaApprovalDecider ?? { timer: null as NodeJS.Timeout | null, started: false };
if (!globalForDecider.__ariaApprovalDecider) globalForDecider.__ariaApprovalDecider = deciderState;

export function startApprovalDecider(intervalMs = 30_000): void {
  if (deciderState.started) return;
  deciderState.started = true;

  // Run immediately
  void processPendingApprovals();

  // Check periodically
  deciderState.timer = setInterval(() => {
    void processPendingApprovals();
  }, intervalMs);

  logger.info("approval-decision.started", { intervalMs });
}

export function stopApprovalDecider(): void {
  if (deciderState.timer) {
    clearInterval(deciderState.timer);
    deciderState.timer = null;
  }
  deciderState.started = false;
}

/**
 * Process all pending approvals that haven't been decided yet.
 */
async function processPendingApprovals(): Promise<void> {
  try {
    const pending = await db.approval.findMany({
      where: { status: "pending" },
      take: 5,
      orderBy: { createdAt: "asc" },
    });

    for (const approval of pending) {
      // v61 Phase 1 (Audit #3): NEVER auto-decide payment approvals.
      // Payment approvals (action="spend" OR risk="high") MUST be
      // manually approved by the owner via /pay-approve (60s cooldown).
      // The auto-decider is blocked from even EVALUATING them.
      if (approval.action === "spend" || approval.risk === "high") {
        continue;
      }
      // Skip if already has monitoring votes (already evaluated)
      if (approval.brief && approval.brief.includes("monitoringVotes")) {
        continue;
      }

      await evaluateApproval(approval.id);
    }
  } catch (err) {
    logger.warn("approval-decision.process.error", { error: String(err) });
  }
}

/**
 * Get the decision for a specific approval (if it's been evaluated).
 */
export async function getApprovalDecision(approvalId: string): Promise<ApprovalDecision | null> {
  try {
    const approval = await db.approval.findUnique({ where: { id: approvalId } });
    if (!approval || !approval.brief) return null;

    const briefData = JSON.parse(approval.brief);
    if (!briefData.monitoringVotes) return null;

    return {
      approvalId,
      votes: briefData.monitoringVotes,
      consensus: briefData.decision ?? "pending",
      autoDecided: approval.status !== "pending",
      summary: `Decided: ${briefData.decision ?? "pending"}`,
      decidedAt: (approval.decidedAt ?? approval.createdAt).toISOString(),
    };
  } catch {
    return null;
  }
}
