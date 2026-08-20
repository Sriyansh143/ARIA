/**
 * src/lib/global-logics.ts — v61 Phase 5 (Global Logic Repository)
 *
 * Owner's rule: "Maintain a smart creative intelligent logics file which
 * can be used globally for every task along with skills and memories."
 *
 * This module is the global repository of advanced, production-grade logic
 * snippets extracted from:
 *   - The owner's attached Build Rules (v57 + v28)
 *   - The 500 AI Agents Projects patterns
 *   - The Notion "AI Company Map" automation rules
 *   - Best practices from the existing codebase
 *
 * These logics are injected into the Conductor's system prompt + the
 * step-debate context so every task benefits from accumulated wisdom.
 *
 * Rule: "Improvise rules and logics only if they are better. Don't delete
 * old ones which are good and usable unless they have improved versions."
 */

import "server-only";

export interface GlobalLogic {
  /** Unique ID. */
  id: string;
  /** Category: anti-hallucination | error-handling | security | db | api | prompt | compliance | debate. */
  category: string;
  /** The logic itself — a prompt snippet, a code pattern, or a rule. */
  content: string;
  /** When to apply this logic. */
  appliesWhen: string;
  /** Priority: CRITICAL (immutable) | HIGH | STANDARD. */
  priority: "CRITICAL" | "HIGH" | "STANDARD";
  /** Source: build-rules | 500-projects | notion-map | codebase-best. */
  source: string;
}

/**
 * The global logic repository. These are the accumulated "wisdom" rules
 * that every LLM call in the system should be aware of.
 *
 * CRITICAL rules are immutable — the rules-auditor cannot delete or
 * downgrade them. It can only propose additions or refinements.
 */
export const GLOBAL_LOGICS: GlobalLogic[] = [
  // ─── Anti-Hallucination (CRITICAL — from owner's Build Rules + Notion map) ──
  {
    id: "anti-hallucination-1",
    category: "anti-hallucination",
    content: "Never fabricate facts, URLs, API endpoints, or data. If you don't know, say 'I don't know' and ask for clarification. Never invent email addresses, phone numbers, or business names.",
    appliesWhen: "Every LLM response that includes factual claims.",
    priority: "CRITICAL",
    source: "build-rules",
  },
  {
    id: "anti-hallucination-2",
    category: "anti-hallucination",
    content: "If a required field is missing, do NOT guess. Halt and ask the owner for clarification (ZERO ASSUMPTIONS rule). Placeholder patterns (TBD/TODO/[fill in]) are treated as missing.",
    appliesWhen: "Before executing any task with required inputs.",
    priority: "CRITICAL",
    source: "build-rules",
  },
  {
    id: "anti-hallucination-3",
    category: "anti-hallucination",
    content: "When citing web search results, always include the source URL. Never present scraped content as your own. If the source is a ToS-violating scrape (LinkedIn/Yelp), flag it.",
    appliesWhen: "Lead generation, research, outreach.",
    priority: "CRITICAL",
    source: "build-rules",
  },

  // ─── Error Handling (from owner's Build Rules §5.1) ──
  {
    id: "error-handling-1",
    category: "error-handling",
    content: "Every API route MUST have a top-level try/catch. No exceptions. Catch → log → return 500. Never throw from a route handler.",
    appliesWhen: "Every src/app/api/**/route.ts file.",
    priority: "CRITICAL",
    source: "build-rules",
  },
  {
    id: "error-handling-2",
    category: "error-handling",
    content: "Every fetch() call MUST set a timeout via AbortSignal.timeout(ms) or AbortController. No unbounded hangs. Default 30s for external APIs, 10s for LLM calls.",
    appliesWhen: "Every fetch() call in the codebase.",
    priority: "HIGH",
    source: "build-rules",
  },
  {
    id: "error-handling-3",
    category: "error-handling",
    content: "Optional dependencies (nut-js, screenshot-desktop, playwright) are dynamic-imported. On failure, return {status:'unsupported'} rather than throwing.",
    appliesWhen: "computer-use.ts, screen-vision.ts, image-gen route.",
    priority: "HIGH",
    source: "build-rules",
  },

  // ─── Security (from owner's Build Rules §0 + §5.8) ──
  {
    id: "security-1",
    category: "security",
    content: "Never commit .env. The .env file contains real secrets. Auto-bootstrap generates NEXTAUTH_SECRET + ENCRYPTION_MASTER_KEY on first start if missing.",
    appliesWhen: "Git operations, deployment.",
    priority: "CRITICAL",
    source: "build-rules",
  },
  {
    id: "security-2",
    category: "security",
    content: "Credential Vault uses AES-256-GCM via Node crypto. Master key must be set via ENCRYPTION_MASTER_KEY. Never log ciphertext/iv/authTag.",
    appliesWhen: "credential-vault.ts, any secret storage.",
    priority: "CRITICAL",
    source: "build-rules",
  },
  {
    id: "security-3",
    category: "security",
    content: "AI_CALLER_ENABLED + AI_CALLER_CONSENT_VERIFIED must BOTH be 'true' for any outbound call/SMS. There is no override. This is legal compliance.",
    appliesWhen: "telephony.ts makeCall() + sendSms().",
    priority: "CRITICAL",
    source: "build-rules",
  },
  {
    id: "security-4",
    category: "security",
    content: "Resend webhook signature verification is fail-closed. Missing secret = no inbound replies processed. Same for Stripe + WhatsApp webhooks.",
    appliesWhen: "webhooks/resend, webhooks/stripe, whatsapp/webhook.",
    priority: "CRITICAL",
    source: "build-rules",
  },
  {
    id: "security-5",
    category: "security",
    content: "All owner-only routes use requirePermission() / requireAuthOrResponse(). Public routes are explicitly listed in src/proxy.ts PUBLIC_API_PREFIXES.",
    appliesWhen: "Every API route.",
    priority: "CRITICAL",
    source: "build-rules",
  },
  {
    id: "security-6",
    category: "security",
    content: "Security headers (X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy, Permissions-Policy) on every response. Never weaken.",
    appliesWhen: "next.config.ts headers().",
    priority: "HIGH",
    source: "build-rules",
  },

  // ─── Compliance (from owner's Build Rules §0.4 + §6) ──
  {
    id: "compliance-1",
    category: "compliance",
    content: "Outreach requires CAN-SPAM compliance: unsubscribe link + sender address + sender identification. No exceptions.",
    appliesWhen: "outreach-executor.ts, email-service.ts.",
    priority: "CRITICAL",
    source: "build-rules",
  },
  {
    id: "compliance-2",
    category: "compliance",
    content: "Crypto payment verification uses real on-chain data (Etherscan + BlockCypher + Solana RPC + TronGrid). No mocks in prod.",
    appliesWhen: "crypto-verifier.ts.",
    priority: "CRITICAL",
    source: "build-rules",
  },
  {
    id: "compliance-3",
    category: "compliance",
    content: "Daily outreach limit defaults to 10. Increase to 50 after warmup (day 15+). Honor the suppression list — unsubscribe within 10 business days.",
    appliesWhen: "outreach-executor.ts.",
    priority: "HIGH",
    source: "build-rules",
  },

  // ─── DB / Performance (from owner's Build Rules §5.3) ──
  {
    id: "db-1",
    category: "db",
    content: "Zustand stores are capped: Logs=200, Metrics=240, LLM=80, Alerts=60, Revenue=120, Deals=60, Messages=100. FIFO eviction. Never raise without owner approval.",
    appliesWhen: "mission-store.ts.",
    priority: "HIGH",
    source: "build-rules",
  },
  {
    id: "db-2",
    category: "db",
    content: "Zustand selectors MUST return stable refs. Use useShallow or select raw array + useMemo. Never map inside the selector.",
    appliesWhen: "Every useMissionStore() call.",
    priority: "HIGH",
    source: "build-rules",
  },
  {
    id: "db-3",
    category: "db",
    content: "SQLite write queue prevents SQLITE_BUSY. 100ms flush + 3 retries with exponential backoff, max depth 1000. Never bypass for direct writes.",
    appliesWhen: "db-write-queue.ts.",
    priority: "HIGH",
    source: "codebase-best",
  },

  // ─── Prompt Engineering (from 500-projects patterns + Notion map) ──
  {
    id: "prompt-1",
    category: "prompt",
    content: "For complex tasks, use the Council Pattern: consult 3-4 relevant agents in parallel before deciding. The Conductor aggregates perspectives into a unified brief.",
    appliesWhen: "Any task with complexity='high' (>6 steps).",
    priority: "HIGH",
    source: "notion-map",
  },
  {
    id: "prompt-2",
    category: "prompt",
    content: "For every step of a complex task, run a micro-debate: Proposer generates → Critic reviews for bugs/edge cases → Refiner produces the final output. Inject previous step results into every round.",
    appliesWhen: "High-complexity or financial/security-critical steps.",
    priority: "HIGH",
    source: "500-projects",
  },
  {
    id: "prompt-3",
    category: "prompt",
    content: "Use execution-based trajectory validation (AgentEval pattern): don't just check syntax — actually run the generated code + assert on stdout/exit-code/HTTP-status. MAX_RETRIES=2, then escalate.",
    appliesWhen: "service builder, code generation.",
    priority: "HIGH",
    source: "500-projects",
  },

  // ─── Debate (from owner's Phase 5 rule) ──
  {
    id: "debate-1",
    category: "debate",
    content: "Before executing every step of a complex task, run a micro-debate (Proposer → Critic → Refiner) using different models or personas. Inject the results of all previous steps.",
    appliesWhen: "Every step where complexity='high'.",
    priority: "CRITICAL",
    source: "build-rules",
  },
  {
    id: "debate-2",
    category: "debate",
    content: "The Critic persona is strict QA: look for bugs, edge cases, missing error handling, hardcoded secrets, non-production patterns. Reject 'draft' or 'placeholder' outputs.",
    appliesWhen: "Every Critic round.",
    priority: "CRITICAL",
    source: "build-rules",
  },
  {
    id: "debate-3",
    category: "debate",
    content: "For complex/lengthy tasks, check skill files + the internet for relevant context before generating. Enhance the prompt with fresh information.",
    appliesWhen: "Tasks marked complexity='high' or 'research'.",
    priority: "HIGH",
    source: "build-rules",
  },

  // ─── Operational Discipline (from Phases 1-4) ──
  {
    id: "ops-1",
    category: "ops",
    content: "Business hours: owner + customer interactions only 9 AM-6 PM in the recipient's timezone. Critical alerts bypass.",
    appliesWhen: "outreach-executor, lead-finder, notifications.",
    priority: "HIGH",
    source: "build-rules",
  },
  {
    id: "ops-2",
    category: "ops",
    content: "2-Hour Approval Deferral: if an approval is pending >2h, send a reminder + defer. Agents pivot to the next available non-blocked task. The fleet never sits idle.",
    appliesWhen: "approval-reminder cron, task dispatcher.",
    priority: "HIGH",
    source: "build-rules",
  },
  {
    id: "ops-3",
    category: "ops",
    content: "Payment approvals are ISOLATED: action='spend', risk='high', 60s cooldown via /pay-approve (not /approve). Auto-decider is BLOCKED from touching them.",
    appliesWhen: "conductor/router.ts, approval-decision.ts.",
    priority: "CRITICAL",
    source: "build-rules",
  },
  {
    id: "ops-4",
    category: "ops",
    content: "Daily Plan pushed to Telegram at 9 AM: 7 sections (yesterday's results, today's top 3 goals, blockers, decision queue, risk flags, recommended actions, OKR alignment).",
    appliesWhen: "executive-standup cron.",
    priority: "HIGH",
    source: "build-rules",
  },
  {
    id: "ops-5",
    category: "ops",
    content: "Agent Communication Board: every agent posts its action + resource claim to a shared blackboard. Before starting, check for conflicts. No two agents claim the same resource.",
    appliesWhen: "conductor/dispatcher.ts, every dispatchToAgent().",
    priority: "HIGH",
    source: "build-rules",
  },
  {
    id: "ops-6",
    category: "ops",
    content: "Self-Improving Rules: rules-auditor reviews failed traces every 6h + proposes concrete code changes via HUMAN_ASSISTED approvals. Owner approves before any rule is applied.",
    appliesWhen: "rules-auditor cron.",
    priority: "HIGH",
    source: "build-rules",
  },
];

/**
 * Get all logics for a given category.
 */
export function getLogicsByCategory(category: string): GlobalLogic[] {
  return GLOBAL_LOGICS.filter((l) => l.category === category);
}

/**
 * Get all CRITICAL (immutable) logics.
 */
export function getCriticalLogics(): GlobalLogic[] {
  return GLOBAL_LOGICS.filter((l) => l.priority === "CRITICAL");
}

/**
 * Build a compact summary of all global logics for injection into the
 * Conductor's system prompt. Truncated to fit in the context window.
 */
export function buildGlobalLogicsPrompt(maxChars: number = 4000): string {
  const lines: string[] = ["GLOBAL LOGICS (enforced for every task):", ""];
  let total = lines.join("\n").length;
  for (const logic of GLOBAL_LOGICS) {
    const line = `[${logic.priority}] ${logic.id}: ${logic.content.slice(0, 200)}`;
    if (total + line.length > maxChars) break;
    lines.push(line);
    total += line.length;
  }
  return lines.join("\n");
}

/**
 * Check whether a proposed rule change is allowed.
 * CRITICAL rules cannot be deleted or downgraded — only refined.
 */
export function canModifyRule(ruleId: string, action: "delete" | "downgrade" | "refine"): boolean {
  const rule = GLOBAL_LOGICS.find((l) => l.id === ruleId);
  if (!rule) return true; // new rule — always allowed
  if (rule.priority === "CRITICAL") {
    // CRITICAL rules can only be refined, never deleted or downgraded.
    return action === "refine";
  }
  return true; // non-critical rules can be modified
}
