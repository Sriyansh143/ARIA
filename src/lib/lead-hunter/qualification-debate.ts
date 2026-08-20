/**
 * src/lib/lead-hunter/qualification-debate.ts — v71 Phase 21 (Autonomous Lead Hunter)
 *
 * Multi-agent qualification debate. Convenes a council of 3 agents to
 * debate each discovered lead before any outreach is sent.
 *
 * The Council:
 *   - Scout Agent: argues FOR the lead (evidence it's genuine + worth pursuing).
 *   - Risk Agent: argues AGAINST (signs of spam, competitor fishing, unready).
 *   - Sales Agent: assesses readiness (ready to buy NOW or just researching?).
 *   - Conductor: synthesizes the 3 cases into a final verdict.
 *
 * Verdicts:
 *   - PURSUE (confidence > 70): genuine + ready. Generate personalized preview.
 *   - INVESTIGATE (confidence 40-70): genuine but unready. Reply with helpful comment.
 *   - SKIP (confidence < 40): spam, competitor, or not worth it. Log + move on.
 *
 * All 4 reasoning steps route to LOCAL Ollama (llama3.2:3b) per the
 * Multi-Tier Context Manager strategy (Tier 3 local). No external API
 * calls — the debate is free + unlimited.
 */

import "server-only";
import { logger } from "../logger";
import { callLLM } from "../llm-client";
import { contextManager } from "../context-manager";
import { buildCompactConstitution } from "../constitution";
import type { DiscoveredLead } from "./social-scout";
import type { ServiceMatch } from "./service-matcher";
import type { LeadBrandProfile } from "./profile-extractor";

// ─── Types ────────────────────────────────────────────────────────────

export interface QualificationResult {
  verdict: "pursue" | "investigate" | "skip";
  confidence: number; // 0-100
  scoutCase: string;
  riskCase: string;
  salesCase: string;
  conductorSynthesis: string;
  recommendedAction: string;
  reasoning: string; // short Conductor summary (1-3 sentences)
  reasoningTrace: string; // full multi-step trace for audit
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Run a multi-agent qualification debate on a discovered lead.
 * Returns the final verdict + confidence + recommended action.
 *
 * All LLM calls route to local Ollama per the Multi-Tier strategy.
 */
export async function qualifyLead(
  lead: DiscoveredLead,
  serviceMatches: ServiceMatch[],
  brand: LeadBrandProfile | null,
): Promise<QualificationResult> {
  const trace: string[] = [];

  // Build the shared context for all 3 agents.
  const constitution = buildCompactConstitution();
  const context = contextManager.buildContext({
    constitution,
    skillContext: `
LEAD UNDER EVALUATION:
  - Platform: ${lead.platform}
  - Username: ${lead.username}
  - Display name: ${lead.displayName}
  - Profile URL: ${lead.profileUrl}
  - Account age: ${lead.accountAgeDays} days
  - Follower count: ${lead.followerCount}

BUYING SIGNAL (their post):
  "${lead.postContent.slice(0, 300)}"

ENGAGEMENT:
  - Likes: ${lead.likes}
  - Replies: ${lead.replies}
  - Reposts: ${lead.reposts}

BRAND PROFILE (from social profile):
  ${brand ? `Primary color: ${brand.primaryColor}\n  Tone: ${brand.brandTone}\n  Industry: ${brand.industry}` : "(no brand profile extracted)"}

MATCHED SERVICES (top 3):
${serviceMatches.map((m, i) => `  ${i + 1}. ${m.serviceName} (${m.conversionProbability}% conversion probability) — ${m.reason}`).join("\n")}
`.trim(),
    taskDescription: "Qualify this lead via multi-agent debate. Is this a genuine buying signal from a real buyer who is ready to act?",
    maxHistoryChars: 2000,
  });

  // ─── Agent 1: Scout argues FOR ───
  const scoutPrompt = `${context.prompt}

You are the SCOUT AGENT. Your job is to argue WHY this lead is genuine and worth pursuing. Cite specific evidence:
- Account age + follower count (older + more followers = more likely real)
- Engagement metrics (likes/replies show resonance)
- Language in the post (specific problem statements vs. vague venting)
- Matched services (does the post specifically request what we offer?)

Make a strong case FOR pursuing this lead. 2-3 paragraphs max.`;

  trace.push("=== SCOUT AGENT (argues FOR) ===");
  const scoutResult = await callLLM("Scout", "research", scoutPrompt, {
    maxRetries: 1,
    model: process.env.WORKFLOW_PROPOSER_MODEL || "llama3.2:3b",
    preferLocal: true,
  } as any);
  const scoutCase = scoutResult.success ? scoutResult.completion : "(scout unavailable — proceeding with no case FOR)";
  trace.push(scoutCase);

  // ─── Agent 2: Risk argues AGAINST ───
  const riskPrompt = `${context.prompt}

SCOUT'S CASE FOR PURSUING:
${scoutCase}

You are the RISK AGENT. Your job is to argue WHY this lead might be:
  - Spam / bot account (low account age, no engagement, generic post)
  - A competitor fishing for pricing / process info
  - Someone just venting (not actually ready to buy)
  - Outside our target market (wrong industry, wrong size, wrong geography)

Be skeptical. Poke holes in the scout's case. 2-3 paragraphs max.`;

  trace.push("\n=== RISK AGENT (argues AGAINST) ===");
  const riskResult = await callLLM("Risk", "research", riskPrompt, {
    maxRetries: 1,
    model: process.env.WORKFLOW_PROPOSER_MODEL || "llama3.2:3b",
    preferLocal: true,
  } as any);
  const riskCase = riskResult.success ? riskResult.completion : "(risk unavailable — proceeding with no case AGAINST)";
  trace.push(riskCase);

  // ─── Agent 3: Sales assesses readiness ───
  const salesPrompt = `${context.prompt}

SCOUT'S CASE FOR:
${scoutCase}

RISK'S CASE AGAINST:
${riskCase}

You are the SALES AGENT. Given both arguments, assess READINESS:
  - Even if genuine, is this lead ready to buy NOW (this week) or just researching?
  - Should we send a personalized preview (high cost) or just start a conversation (low cost)?
  - What's the best opening: preview, helpful comment, or do nothing?

Recommend a single next action. 2-3 paragraphs max.`;

  trace.push("\n=== SALES AGENT (readiness assessment) ===");
  const salesResult = await callLLM("Sales", "research", salesPrompt, {
    maxRetries: 1,
    model: process.env.WORKFLOW_PROPOSER_MODEL || "llama3.2:3b",
    preferLocal: true,
  } as any);
  const salesCase = salesResult.success ? salesResult.completion : "(sales unavailable — defaulting to INVESTIGATE)";
  trace.push(salesCase);

  // ─── Conductor: synthesize the verdict ───
  const conductorPrompt = `${context.prompt}

SCOUT'S CASE (FOR):
${scoutCase}

RISK'S CASE (AGAINST):
${riskCase}

SALES' READINESS ASSESSMENT:
${salesCase}

You are the CONDUCTOR. Synthesize the 3 arguments above into a final verdict.

Respond in EXACTLY this format:
VERDICT: PURSUE | INVESTIGATE | SKIP
CONFIDENCE: <0-100 integer>
ACTION: <one specific action: "generate preview + send via WhatsApp", "reply with helpful comment on their post", "skip — log only">
REASONING: <2-3 sentences summarizing why you chose this verdict>`;

  trace.push("\n=== CONDUCTOR (synthesis) ===");
  const conductorResult = await callLLM("Conductor", "research", conductorPrompt, {
    maxRetries: 1,
    model: process.env.WORKFLOW_PROPOSER_MODEL || "llama3.2:3b",
    preferLocal: true,
  } as any);
  const synthesis = conductorResult.success ? conductorResult.completion : "VERDICT: SKIP\nCONFIDENCE: 0\nACTION: skip — conductor unavailable\nREASONING: All agents failed; conservative default.";
  trace.push(synthesis);

  // Parse the Conductor's verdict.
  const parsed = parseVerdict(synthesis);

  logger.info("qualification-debate.complete", {
    lead: lead.username,
    verdict: parsed.verdict,
    confidence: parsed.confidence,
  });

  return {
    ...parsed,
    scoutCase,
    riskCase,
    salesCase,
    conductorSynthesis: synthesis,
    reasoningTrace: trace.join("\n\n"),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function parseVerdict(synthesis: string): {
  verdict: QualificationResult["verdict"];
  confidence: number;
  recommendedAction: string;
  reasoning: string;
} {
  const verdictMatch = synthesis.match(/VERDICT:\s*(PURSUE|INVESTIGATE|SKIP)/i);
  const confidenceMatch = synthesis.match(/CONFIDENCE:\s*(\d{1,3})/i);
  const actionMatch = synthesis.match(/ACTION:\s*([^\n]+)/i);
  const reasoningMatch = synthesis.match(/REASONING:\s*([\s\S]+?)(?=\n\w+:|$)/i);

  const verdictRaw = (verdictMatch?.[1] ?? "SKIP").toLowerCase() as QualificationResult["verdict"];
  const confidence = Math.max(0, Math.min(100, parseInt(confidenceMatch?.[1] ?? "0", 10) || 0));
  const action = (actionMatch?.[1] ?? "").trim();
  const reasoning = (reasoningMatch?.[1] ?? "").trim();

  // Sanity check: if confidence says 85 but verdict is SKIP, that's a contradiction.
  // Trust the verdict over the confidence — but log a warning.
  let finalVerdict = verdictRaw;
  let finalConfidence = confidence;
  if (verdictRaw === "pursue" && confidence < 70) {
    finalVerdict = "investigate";
    finalConfidence = Math.max(40, confidence);
    logger.warn("qualification-debate.verdict-confidence-mismatch", {
      rawVerdict: verdictRaw,
      rawConfidence: confidence,
      hint: "Downgraded to INVESTIGATE because confidence < 70",
    });
  }

  return {
    verdict: finalVerdict,
    confidence: finalConfidence,
    recommendedAction: action,
    reasoning,
  };
}
