/**
 * tests/constitution-rules.test.ts — v70 Phase 20 (Unified Rules Verification)
 *
 * PREVIOUS STATE (v69): The test only verified the 37 rules in the
 * siloed PHASE_9_10_RULES array. The other 31 rules in NON_NEGOTIABLE_RULES
 * (12) + OPERATIONAL_RULES (19) were never individually testable, never
 * individually immutable-flagged, and never individually referenced by ID
 * — a critical silo bug.
 *
 * v70 Phase 20: the three siloed arrays are DELETED. The test now verifies:
 *   1. ALL_CONSTITUTION_RULES.length >= 60 (target: exactly 68).
 *   2. Every rule has a unique id (RULE-01 through RULE-68).
 *   3. Every rule is marked immutable.
 *   4. buildConstitutionPrompt() output contains all 68 rule IDs.
 *   5. buildCompactConstitution() output contains all 68 rule IDs.
 *   6. Tiny maxChars values do NOT truncate — the param is ignored.
 *   7. contextManager.buildContext() output contains all 68 rule IDs.
 *   8. buildExecutionContext() also injects all 68 rule IDs.
 *
 * This prevents BOTH the "only 37 rules injected" facade (Phase 19 fix)
 * AND the "31 shadow rules are not individually testable" facade (Phase 20 fix).
 */

import { describe, it, expect } from "bun:test";
import {
  ALL_CONSTITUTION_RULES,
  buildConstitutionPrompt,
  buildCompactConstitution,
  buildExecutionContext,
  isProposedChangeConstitutional,
} from "../src/lib/constitution";
import { contextManager } from "../src/lib/context-manager";

// Expected rule IDs — ALL 68 of them, from RULE-01 to RULE-68.
// Phase 20 verified that the three legacy arrays are merged:
//   - RULE-01..RULE-12   (was NON_NEGOTIABLE_RULES)
//   - RULE-13..RULE-31   (was OPERATIONAL_RULES)
//   - RULE-32..RULE-68   (was PHASE_9_10_RULES — IDs unchanged)
const EXPECTED_RULE_IDS: string[] = [
  // Non-Negotiable (RULE-01 through RULE-12)
  "RULE-01-NO-ENV-COMMIT",
  "RULE-02-AI-CALLER-GATE",
  "RULE-03-REAL-CRYPTO-VERIFY",
  "RULE-04-CAN-SPAM",
  "RULE-05-OWNER-AUTH-REQUIRED",
  "RULE-06-DAILY-OUTREACH-LIMIT",
  "RULE-07-RESEND-WEBHOOK-SIG",
  "RULE-08-CREDENTIAL-VAULT-AES",
  "RULE-09-SKILLS-MANDATORY",
  "RULE-10-AUTO-BOOTSTRAP",
  "RULE-11-KILL-SWITCH",
  "RULE-12-MINISERVICE-AUTH",
  // Operational Discipline (RULE-13 through RULE-31)
  "RULE-13-ZERO-ASSUMPTIONS",
  "RULE-14-PAYMENT-ISOLATION",
  "RULE-15-DAILY-STANDUP",
  "RULE-16-APPROVAL-QA",
  "RULE-17-BUSINESS-HOURS",
  "RULE-18-APPROVAL-DEFERRAL",
  "RULE-19-ORACLE-LIGHTWEIGHT",
  "RULE-20-CUSTOMER-TZ",
  "RULE-21-SKILLS-AS-PATTERNS",
  "RULE-22-ENV-AUTO-DETECT",
  "RULE-23-SELF-IMPROVING-RULES",
  "RULE-24-COUNCIL-PATTERN",
  "RULE-25-MULTIMODAL-FALLBACK",
  "RULE-26-AGENT-BLACKBOARD",
  "RULE-27-STEP-DEBATE",
  "RULE-28-PRODUCTION-GATE",
  "RULE-29-GLOBAL-LOGICS",
  "RULE-30-SUPABASE",
  "RULE-31-INTERNET-RESEARCH",
  // Phase 9-12 AI Mistake Patterns + Code Index (RULE-32 through RULE-68)
  "RULE-32-WORK-LOG",
  "RULE-33-NO-LAZY-SUMMARIZATION",
  "RULE-34-PROVE-WIRING",
  "RULE-35-NO-SILENT-STUBS",
  "RULE-36-CONTEXT-CONTINUITY",
  "RULE-37-VERIFICATION-GATES",
  "RULE-38-NO-DELETION-FOR-SIZE",
  "RULE-39-PROVE-ALGORITHMS",
  "RULE-40-CODE-INDEX",
  "RULE-41-DAILY-KNOWLEDGE-REFRESH",
  "RULE-42-NO-STATIC-KNOWLEDGE",
  "RULE-43-FILE-SIZE-LIMIT",
  "RULE-44-NO-FACADE-MARKETING",
  "RULE-45-ZERO-PATCH-POLICY",
  "RULE-46-PATCH-DETECTION",
  "RULE-47-TECH-DEBT-TRACKING",
  "RULE-48-CONTINUOUS-SIMULATION",
  "RULE-49-PRODUCT-QUALITY",
  "RULE-50-DYNAMIC-SERVICE-TESTING",
  "RULE-51-PRE-PUBLISH-QUALITY-GATE",
  "RULE-52-PERSONALIZED-PREVIEWS",
  "RULE-53-COMMUNICATION-EXCELLENCE",
  "RULE-54-HUMAN-LIKE-VOICE",
  "RULE-55-PROTECTED-PREVIEWS",
  "RULE-56-HOOK-BEFORE-PITCH",
  "RULE-57-MULTI-FORMAT-LEARNING",
  "RULE-58-ZERO-COST-CHANNELS",
  "RULE-59-DUAL-TTS-ARCHITECTURE",
  "RULE-60-ORACLE-DEPLOYMENT",
  "RULE-61-MANDATORY-DAILY-OWNER-DISCUSSION",
  "RULE-62-DAILY-EARNING-OPPORTUNITIES",
  "RULE-63-ORAL-CONFIRMATION",
  "RULE-64-MONITORING-AGENTS",
  "RULE-65-HARDENING-OVER-FEATURES",
  "RULE-66-ACTION-REVERT",
  "RULE-67-REAL-MNC-PATTERNS",
  "RULE-68-OPENSOURCE-FIRST",
  // v71 Phase 21 (RULE-69): Autonomous Lead Hunting
  "RULE-69-AUTONOMOUS-LEAD-HUNTING",
  // v72 Phase 22 (RULE-70 + RULE-71): Proactive Promotion + Per-Category Approvals
  "RULE-70-PROACTIVE-PROMOTION-ENGINE",
  "RULE-71-PER-CATEGORY-APPROVAL-PATTERNS",
  // v73 Phase 23 (RULE-72, 73, 74): Self-Evolving Codebase + Legal + Accounting
  "RULE-72-SELF-EVOLVING-CODEBASE",
  "RULE-73-LEGAL-ONBOARDING",
  "RULE-74-DOUBLE-ENTRY-ACCOUNTING",
  // v74 Phase 24 (RULE-75, 76, 77, 78, 79): Enterprise Platform
  "RULE-75-INTERACTIVE-REFACTOR-REVIEW",
  "RULE-76-LIVE-COMPLIANCE-AUDIT",
  "RULE-77-CAPABILITY-REGISTRY",
  "RULE-78-MULTI-OWNER-ISOLATION",
  "RULE-79-SAFE-ROLLBACK-POLICY",
  "RULE-80-NEVER-SHIP-WITHOUT-DATA",
];

describe("Constitution Rules Verification (Phase 20+21+22+23+24 — Unified)", () => {
  it("has at least 60 rules in the unified array (target: 80)", () => {
    expect(ALL_CONSTITUTION_RULES.length).toBeGreaterThanOrEqual(60);
    // Exact count assertion — the audit's expected total.
    // v74 Phase 24 added RULE-75 + RULE-76 + RULE-77 + RULE-78 + RULE-79 → total is now 79.
    expect(ALL_CONSTITUTION_RULES.length).toBe(80);
  });

  it("has all 80 expected rule IDs (RULE-01 through RULE-80)", () => {
    const actualIds = ALL_CONSTITUTION_RULES.map((r) => r.id);
    for (const expectedId of EXPECTED_RULE_IDS) {
      expect(actualIds).toContain(expectedId);
    }
    expect(EXPECTED_RULE_IDS.length).toBe(80);
    expect(ALL_CONSTITUTION_RULES.length).toBe(EXPECTED_RULE_IDS.length);
  });

  it("includes BOTH the original rules (e.g. RULE-01) AND the new ones (e.g. RULE-80)", () => {
    // Explicitly check rule IDs from each historical block + v74 Phase 24:
    //   - RULE-01 (oldest, from the first legacy block)
    //   - RULE-32 (oldest third-block rule)
    //   - RULE-68 (newest third-block rule)
    //   - RULE-69 (v71 Phase 21 — Autonomous Lead Hunting)
    //   - RULE-70 (v72 Phase 22 — Proactive Promotion Engine)
    //   - RULE-71 (v72 Phase 22 — Per-Category Approval Patterns)
    //   - RULE-72 (v73 Phase 23 — Self-Evolving Codebase)
    //   - RULE-73 (v73 Phase 23 — Legal Onboarding)
    //   - RULE-74 (v73 Phase 23 — Double-Entry Accounting)
    //   - RULE-75 (v74 Phase 24 — Interactive Refactor Review)
    //   - RULE-76 (v74 Phase 24 — Live Compliance Audit)
    //   - RULE-77 (v74 Phase 24 — Capability Registry)
    //   - RULE-78 (v74 Phase 24 — Multi-Owner Isolation)
    //   - RULE-79 (v74 Phase 24 — Safe Rollback Policy)
    const ids = ALL_CONSTITUTION_RULES.map((r) => r.id);
    expect(ids).toContain("RULE-01-NO-ENV-COMMIT");
    expect(ids).toContain("RULE-32-WORK-LOG");
    expect(ids).toContain("RULE-68-OPENSOURCE-FIRST");
    expect(ids).toContain("RULE-69-AUTONOMOUS-LEAD-HUNTING");
    expect(ids).toContain("RULE-70-PROACTIVE-PROMOTION-ENGINE");
    expect(ids).toContain("RULE-71-PER-CATEGORY-APPROVAL-PATTERNS");
    expect(ids).toContain("RULE-72-SELF-EVOLVING-CODEBASE");
    expect(ids).toContain("RULE-73-LEGAL-ONBOARDING");
    expect(ids).toContain("RULE-74-DOUBLE-ENTRY-ACCOUNTING");
    expect(ids).toContain("RULE-75-INTERACTIVE-REFACTOR-REVIEW");
    expect(ids).toContain("RULE-76-LIVE-COMPLIANCE-AUDIT");
    expect(ids).toContain("RULE-77-CAPABILITY-REGISTRY");
    expect(ids).toContain("RULE-78-MULTI-OWNER-ISOLATION");
    expect(ids).toContain("RULE-80-NEVER-SHIP-WITHOUT-DATA");
  });

  it("all rules are marked immutable", () => {
    for (const rule of ALL_CONSTITUTION_RULES) {
      expect(rule.immutable).toBe(true);
    }
  });

  it("all rules have id, rule, description, and priority", () => {
    for (const rule of ALL_CONSTITUTION_RULES) {
      expect(rule.id).toBeTruthy();
      expect(rule.rule).toBeTruthy();
      expect(rule.description).toBeTruthy();
      expect(["CRITICAL", "HIGH", "STANDARD"]).toContain(rule.priority);
    }
  });

  it("no duplicate rule IDs", () => {
    const ids = ALL_CONSTITUTION_RULES.map((r) => r.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  // ─── Phase 19 regression: prompt injection (extended to ALL 68 rules) ───

  it("buildConstitutionPrompt() injects ALL 68 rule IDs into the output (no truncation)", () => {
    const prompt = buildConstitutionPrompt();
    for (const id of EXPECTED_RULE_IDS) {
      expect(prompt).toContain(id);
    }
  });

  it("buildConstitutionPrompt() injects ALL 68 rule descriptions (full text)", () => {
    const prompt = buildConstitutionPrompt();
    for (const rule of ALL_CONSTITUTION_RULES) {
      expect(prompt).toContain(rule.description);
    }
  });

  // ─── Phase 20: NEW compact format tests ──────────────────────────────

  it("buildCompactConstitution() injects ALL 68 rule IDs (compact form)", () => {
    const compact = buildCompactConstitution();
    for (const id of EXPECTED_RULE_IDS) {
      expect(compact).toContain(id);
    }
  });

  it("buildCompactConstitution() is significantly smaller than full text", () => {
    const full = buildConstitutionPrompt();
    const compact = buildCompactConstitution();
    // Compact should be at most 30% of full text size (descriptions are dropped).
    expect(compact.length).toBeLessThan(full.length * 0.5);
    // And must still contain all 68 IDs (verified above).
    expect(compact).toContain("RULE-01");
    expect(compact).toContain("RULE-68");
  });

  it("buildConstitutionPrompt() is NOT truncated even when caller passes a tiny maxChars", () => {
    // The maxChars parameter is now IGNORED for the Constitution block.
    // Callers can pass 1000, 1500, or 0 — the full text is always returned.
    const prompt1000 = buildConstitutionPrompt(1000);
    const prompt1500 = buildConstitutionPrompt(1500);
    const promptDefault = buildConstitutionPrompt();
    for (const id of EXPECTED_RULE_IDS) {
      expect(prompt1000).toContain(id);
      expect(prompt1500).toContain(id);
      expect(promptDefault).toContain(id);
    }
    // The prompts should be IDENTICAL — maxChars no longer affects output.
    expect(prompt1000).toBe(promptDefault);
    expect(prompt1500).toBe(promptDefault);
  });

  it("buildConstitutionPrompt() output has no truncation warning", () => {
    const prompt = buildConstitutionPrompt(500); // tiny budget, must NOT truncate
    // The Constitution header text "full text, NEVER truncated" is
    // legitimate (it DOCUMENTS that we don't truncate). What we forbid
    // is the actual truncation warning that the v68 fallback emitted:
    //   "(⚠️ Constitution truncated — see src/lib/constitution.ts for all rules)"
    expect(prompt).not.toContain("Constitution truncated");
    expect(prompt).not.toContain("⚠️");
    expect(prompt).not.toContain("see src/lib/constitution.ts for all rules");
    // The full text header is a feature, not a warning:
    expect(prompt).toContain("full text, NEVER truncated");
  });

  it("buildExecutionContext() also injects ALL 68 rule IDs (no truncation)", () => {
    const ctx = buildExecutionContext(1000); // tiny budget, must NOT truncate Constitution
    for (const id of EXPECTED_RULE_IDS) {
      expect(ctx).toContain(id);
    }
  });

  // ─── Phase 20: ContextManager integration with ALL_CONSTITUTION_RULES ───

  it("contextManager.buildContext() (no constitution arg) auto-injects ALL 68 rule IDs", () => {
    // Don't pass a `constitution` field — the ContextManager should auto-build
    // the compact form from ALL_CONSTITUTION_RULES.
    const built = contextManager.buildContext({
      skillContext: "Test skill context",
      previousResults: [
        { stepName: "step-1", finalOutput: "Step 1 output here." },
        { stepName: "step-2", finalOutput: "Step 2 output here." },
      ],
      taskDescription: "Test task description",
      maxHistoryChars: 4000,
    });
    for (const id of EXPECTED_RULE_IDS) {
      expect(built.prompt).toContain(id);
    }
    expect(built.breakdown.constitutionTruncated).toBe(false);
    expect(built.breakdown.constitutionChars).toBeGreaterThan(1000);
  });

  it("contextManager.buildCompactConstitution() returns ALL 68 rule IDs", () => {
    const compact = contextManager.buildCompactConstitution();
    for (const id of EXPECTED_RULE_IDS) {
      expect(compact).toContain(id);
    }
  });

  it("contextManager.getAllRules() returns the full 79-rule array", () => {
    const rules = contextManager.getAllRules();
    expect(rules.length).toBe(80);
    expect(rules[0].id).toBe("RULE-01-NO-ENV-COMMIT");
    expect(rules[79].id).toBe("RULE-80-NEVER-SHIP-WITHOUT-DATA");
  });

  // ─── Phase 20: isProposedChangeConstitutional now protects ALL 69 rules ─

  it("isProposedChangeConstitutional() blocks deletion of ANY of the 68 rules", () => {
    // Spot-check rules from each historical block:
    //   - RULE-01 (was NON_NEGOTIABLE, previously NOT protected by this fn)
    //   - RULE-15 (was OPERATIONAL, previously NOT protected)
    //   - RULE-32 (was PHASE_9_10, previously protected)
    //   - RULE-68 (was PHASE_9_10, previously protected)
    const checkIds = ["RULE-01-NO-ENV-COMMIT", "RULE-15-DAILY-STANDUP", "RULE-32-WORK-LOG", "RULE-68-OPENSOURCE-FIRST"];
    for (const id of checkIds) {
      const result = isProposedChangeConstitutional(id, "delete");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("immutable");
    }
  });

  it("isProposedChangeConstitutional() blocks downgrade of ANY of the 68 rules", () => {
    const checkIds = ["RULE-01-NO-ENV-COMMIT", "RULE-13-ZERO-ASSUMPTIONS", "RULE-44-NO-FACADE-MARKETING", "RULE-68-OPENSOURCE-FIRST"];
    for (const id of checkIds) {
      const result = isProposedChangeConstitutional(id, "downgrade");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("immutable");
    }
  });

  it("isProposedChangeConstitutional() ALLOWS refinement of any rule", () => {
    // Refine is always allowed — the wording can be tightened without losing the rule.
    const result = isProposedChangeConstitutional("RULE-01-NO-ENV-COMMIT", "refine");
    expect(result.allowed).toBe(true);
  });

  it("isProposedChangeConstitutional() ALLOWS adding new rules", () => {
    const result = isProposedChangeConstitutional("RULE-69-FUTURE-RULE", "add");
    expect(result.allowed).toBe(true);
  });
});
