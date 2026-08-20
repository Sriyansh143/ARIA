/**
 * src/lib/oral-confirmation.ts — v67 Phase 17 (Oral Call Confirmation)
 *
 * RULE-63: ORAL-CONFIRMATION — calls can approve.
 *
 * During owner calls, oral confirmation can proceed things further — no need
 * to press an approve button every time. The call conversation is analyzed
 * to understand what the owner is responding to.
 *
 * Also handles customer and investor call analysis:
 *   - Customer calls: detect buying signals, objections, sentiment
 *   - Investor calls: detect interest level, partnership questions, franchise intent
 *
 * The oral confirmation is logged with a transcript + timestamp for audit.
 */

import "server-only";
import { db } from "./db";
import { logger } from "./logger";
import { emit } from "./event-bus";

// ─── Approval keyword detection ─────────────────────────────────────

const APPROVAL_KEYWORDS = [
  "yes",
  "approved",
  "proceed",
  "go ahead",
  "go for it",
  "do it",
  "sounds good",
  "let's do it",
  "confirm",
  "confirmed",
  "okay",
  "ok",
  "sure",
  "looks good",
  "i agree",
  "that works",
  "make it happen",
  "ship it",
  "launch it",
  "start it",
];

const DENIAL_KEYWORDS = [
  "no",
  "deny",
  "denied",
  "reject",
  "rejected",
  "stop",
  "don't",
  "do not",
  "not now",
  "maybe later",
  "i disagree",
  "that doesn't work",
  "hold off",
  "wait",
  "let me think",
  "not sure",
];

const QUESTION_KEYWORDS = [
  "why",
  "what",
  "how",
  "when",
  "where",
  "who",
  "which",
  "can you",
  "could you",
  "would you",
  "is it",
  "are you",
  "what if",
  "explain",
  "clarify",
  "elaborate",
];

export interface OralAnalysisResult {
  isApproval: boolean;
  isDenial: boolean;
  isQuestion: boolean;
  confidence: number; // 0-1
  matchedKeyword: string | null;
  transcript: string;
  timestamp: string;
  callerType: "owner" | "customer" | "investor";
  detectedIntent: string;
}

/**
 * Analyze a call transcript for oral confirmation.
 * Works for owner (approvals), customer (buying signals), and investor (interest).
 */
export function analyzeOralConfirmation(
  transcript: string,
  callerType: "owner" | "customer" | "investor" = "owner",
): OralAnalysisResult {
  const lower = transcript.toLowerCase().trim();
  const timestamp = new Date().toISOString();

  // Check for approval keywords.
  let matchedKeyword: string | null = null;
  let isApproval = false;
  for (const keyword of APPROVAL_KEYWORDS) {
    if (lower.includes(keyword)) {
      isApproval = true;
      matchedKeyword = keyword;
      break;
    }
  }

  // Check for denial keywords (override approval if both present — denial wins).
  let isDenial = false;
  for (const keyword of DENIAL_KEYWORDS) {
    if (lower.includes(keyword)) {
      isDenial = true;
      isApproval = false; // denial overrides
      matchedKeyword = keyword;
      break;
    }
  }

  // Check for question keywords.
  let isQuestion = false;
  for (const keyword of QUESTION_KEYWORDS) {
    if (lower.includes(keyword)) {
      isQuestion = true;
      break;
    }
  }

  // Determine intent based on caller type + keywords.
  let detectedIntent = "unknown";
  if (callerType === "owner") {
    if (isApproval) detectedIntent = "owner-approves";
    else if (isDenial) detectedIntent = "owner-denies";
    else if (isQuestion) detectedIntent = "owner-asks-question";
    else detectedIntent = "owner-discussing";
  } else if (callerType === "customer") {
    if (isApproval) detectedIntent = "customer-buying-signal";
    else if (isDenial) detectedIntent = "customer-objection";
    else if (isQuestion) detectedIntent = "customer-asking";
    else detectedIntent = "customer-listening";
  } else if (callerType === "investor") {
    if (isApproval) detectedIntent = "investor-interested";
    else if (isDenial) detectedIntent = "investor-passing";
    else if (isQuestion) detectedIntent = "investor-due-diligence";
    else detectedIntent = "investor-evaluating";
  }

  // Confidence: higher if keyword is a strong signal (longer phrase).
  const confidence = matchedKeyword
    ? Math.min(1, matchedKeyword.length / 15 + 0.3)
    : 0.1;

  return {
    isApproval,
    isDenial,
    isQuestion,
    confidence,
    matchedKeyword,
    transcript,
    timestamp,
    callerType,
    detectedIntent,
  };
}

/**
 * Process an oral confirmation from a call + resolve the matching approval.
 * If the owner says "yes/approved/proceed" during a call about a specific
 * approval, automatically resolve it without requiring a button press.
 */
export async function processOralApproval(
  transcript: string,
  approvalId: string,
): Promise<{ resolved: boolean; result: OralAnalysisResult }> {
  const analysis = analyzeOralConfirmation(transcript, "owner");

  // Log the oral confirmation for audit.
  try {
    await db.agentLog.create({
      data: {
        level: "info",
        message: `Oral confirmation analyzed for approval ${approvalId}: ${analysis.detectedIntent} (confidence: ${analysis.confidence.toFixed(2)}, keyword: ${analysis.matchedKeyword ?? "none"})`,
        meta: JSON.stringify({
          type: "oral-confirmation",
          approvalId,
          ...analysis,
        }),
      },
    });
  } catch {
    // best-effort
  }

  if (analysis.isApproval && analysis.confidence >= 0.5) {
    // Resolve the approval automatically.
    try {
      await db.approval.update({
        where: { id: approvalId },
        data: {
          status: "approved",
          // Store the oral confirmation transcript for audit.
          payload: JSON.stringify({
            oralConfirmation: true,
            transcript: transcript.slice(0, 500),
            keyword: analysis.matchedKeyword,
            confidence: analysis.confidence,
            timestamp: analysis.timestamp,
          }),
        },
      });

      emit({
        type: "system",
        ts: analysis.timestamp,
        message: `✅ Oral approval detected — approval ${approvalId.slice(-8)} resolved via call (keyword: "${analysis.matchedKeyword}", confidence: ${analysis.confidence.toFixed(2)})`,
        level: "success",
      });

      logger.info("oral-confirmation.approved", {
        approvalId,
        keyword: analysis.matchedKeyword,
        confidence: analysis.confidence,
      });

      return { resolved: true, result: analysis };
    } catch (err) {
      logger.warn("oral-confirmation.resolve-failed", { approvalId, error: String(err) });
      return { resolved: false, result: analysis };
    }
  }

  if (analysis.isDenial) {
    // Auto-deny the approval.
    try {
      await db.approval.update({
        where: { id: approvalId },
        data: {
          status: "denied",
          payload: JSON.stringify({
            oralDenial: true,
            transcript: transcript.slice(0, 500),
            keyword: analysis.matchedKeyword,
            timestamp: analysis.timestamp,
          }),
        },
      });

      emit({
        type: "system",
        ts: analysis.timestamp,
        message: `❌ Oral denial detected — approval ${approvalId.slice(-8)} denied via call (keyword: "${analysis.matchedKeyword}")`,
        level: "warn",
      });

      return { resolved: true, result: analysis };
    } catch {
      return { resolved: false, result: analysis };
    }
  }

  // Not a clear approval or denial — log for review.
  logger.info("oral-confirmation.ambiguous", {
    approvalId,
    intent: analysis.detectedIntent,
    confidence: analysis.confidence,
  });

  return { resolved: false, result: analysis };
}

/**
 * Analyze a customer call for buying signals + objections.
 * Used by the Pipecat voice service to adapt the pitch in real time.
 */
export function analyzeCustomerCall(transcript: string): {
  buyingSignals: string[];
  objections: string[];
  sentiment: "positive" | "neutral" | "negative";
} {
  const lower = transcript.toLowerCase();
  const buyingSignals: string[] = [];
  const objections: string[] = [];

  // Detect buying signals.
  const signalPatterns = [
    { pattern: /how (do|can) i (pay|sign up|get started)/i, signal: "asking how to pay" },
    { pattern: /what's the (next step|process)/i, signal: "asking about next steps" },
    { pattern: /i (want|need|like) (this|that|it)/i, signal: "expressing desire" },
    { pattern: /let's (do it|go ahead|start)/i, signal: "ready to proceed" },
    { pattern: /when can you (start|deliver)/i, signal: "asking about timeline" },
    { pattern: /sounds (great|good|perfect)/i, signal: "positive response" },
  ];
  for (const { pattern, signal } of signalPatterns) {
    if (pattern.test(lower)) buyingSignals.push(signal);
  }

  // Detect objections.
  const objectionPatterns = [
    { pattern: /too (expensive|much|pricey)/i, objection: "price objection" },
    { pattern: /i need to (think|consider|check)/i, objection: "needs time" },
    { pattern: /not sure (if|that|about)/i, objection: "uncertainty" },
    { pattern: /competitor|other option|alternative/i, objection: "comparing competitors" },
    { pattern: /maybe later|not now/i, objection: "delaying" },
    { pattern: /i (don't|do not) (need|want|have budget)/i, objection: "no need/budget" },
  ];
  for (const { pattern, objection } of objectionPatterns) {
    if (pattern.test(lower)) objections.push(objection);
  }

  // Determine sentiment.
  let sentiment: "positive" | "neutral" | "negative" = "neutral";
  if (buyingSignals.length > objections.length) sentiment = "positive";
  else if (objections.length > buyingSignals.length) sentiment = "negative";

  return { buyingSignals, objections, sentiment };
}

/**
 * Analyze an investor/partner call for interest level + franchise intent.
 */
export function analyzeInvestorCall(transcript: string): {
  interestLevel: "high" | "medium" | "low" | "none";
  franchiseIntent: boolean;
  partnershipQuestions: string[];
  concerns: string[];
} {
  const lower = transcript.toLowerCase();

  // Detect franchise/partnership intent.
  const franchiseIntent = /franchise|partner|resell|white.?label|distribut|setup cost|maintenance cost|one.?time/i.test(lower);

  // Detect interest level.
  let interestLevel: "high" | "medium" | "low" | "none" = "none";
  if (/very interested|love this|how do we (start|proceed)|what's the (investment|cost)|let's (talk|discuss)/i.test(lower)) {
    interestLevel = "high";
  } else if (/interesting|tell me more|how does (it|this) work|what's the (model|revenue)/i.test(lower)) {
    interestLevel = "medium";
  } else if (/not sure|maybe|i'll think|not right now/i.test(lower)) {
    interestLevel = "low";
  }

  // Detect partnership questions.
  const partnershipQuestions: string[] = [];
  if (/how much.*cost/i.test(lower)) partnershipQuestions.push("cost inquiry");
  if (/revenue (share|split|model)/i.test(lower)) partnershipQuestions.push("revenue share");
  if (/exclusiv|territory/i.test(lower)) partnershipQuestions.push("exclusivity/territory");
  if (/support|training|onboard/i.test(lower)) partnershipQuestions.push("support/training");
  if (/tech stack|architecture|infrastructure/i.test(lower)) partnershipQuestions.push("tech stack");
  if (/customer|market|competition/i.test(lower)) partnershipQuestions.push("market analysis");

  // Detect concerns.
  const concerns: string[] = [];
  if (/risk|concern|worried/i.test(lower)) concerns.push("risk concern");
  if (/compete|competition|market share/i.test(lower)) concerns.push("competition concern");
  if (/scal|growth|expand/i.test(lower)) concerns.push("scalability concern");
  if (/secur|privacy|data/i.test(lower)) concerns.push("security concern");
  if (/support|maintain|uptime/i.test(lower)) concerns.push("support concern");

  return { interestLevel, franchiseIntent, partnershipQuestions, concerns };
}
