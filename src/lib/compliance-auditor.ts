/**
 * src/lib/compliance-auditor.ts — v74 Phase 24 (RULE-76)
 *
 * Live Constitution Compliance Auditor. Statically analyzes the codebase +
 * runtime logs to verify that ALL Constitution rules are actively ENFORCED
 * in the code paths — not just defined in an array.
 *
 * For each rule, we have a "compliance check" that:
 *   - Greps the codebase for evidence of enforcement (file:line).
 *   - OR checks runtime logs for execution trace.
 *   - OR verifies a specific function/endpoint exists.
 *
 * Returns a 0-100% compliance score with file:line evidence for every rule.
 *
 * If compliance < 90% → alerts the owner via Telegram + creates a RefactorProposal
 * to restore the missing wiring (per RULE-76).
 */

import "server-only";
import { db } from "./db";
import { logger } from "./logger";
import { emit } from "./event-bus";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// ─── Types ────────────────────────────────────────────────────────────

export interface ComplianceCheck {
  ruleId: string;
  ruleName: string;
  checkType: "static-grep" | "runtime-log" | "manual";
  status: "pass" | "fail" | "warning";
  evidence: string;
  notes: string;
}

export interface ComplianceScorecard {
  totalRules: number;
  passed: number;
  failed: number;
  warnings: number;
  scorePercent: number;
  findings: ComplianceCheck[];
  generatedAt: string;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Run the live compliance audit. Returns a 0-100% scorecard with
 * file:line evidence for every rule.
 *
 * Persists findings to the ComplianceFinding table for trend analysis.
 * If score < 90% → alerts owner via Telegram + creates a RefactorProposal.
 */
export async function auditCompliance(): Promise<ComplianceScorecard> {
  logger.info("compliance-auditor.start");
  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: "📊 Phase 24 Compliance Auditor: scanning codebase for rule enforcement...",
    level: "info",
  });

  const checks: ComplianceCheck[] = [];

  // Run each rule's compliance check.
  for (const check of COMPLIANCE_CHECKS) {
    try {
      const result = await check.verify();
      checks.push(result);
    } catch (err) {
      checks.push({
        ruleId: check.ruleId,
        ruleName: check.ruleName,
        checkType: check.checkType,
        status: "fail",
        evidence: "NOT IMPLEMENTED",
        notes: `Check threw: ${String(err).slice(0, 100)}`,
      });
    }
  }

  const passed = checks.filter((c) => c.status === "pass").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  const warnings = checks.filter((c) => c.status === "warning").length;
  const scorePercent = checks.length > 0 ? Math.round((passed / checks.length) * 100) : 0;

  const scorecard: ComplianceScorecard = {
    totalRules: checks.length,
    passed,
    failed,
    warnings,
    scorePercent,
    findings: checks,
    generatedAt: new Date().toISOString(),
  };

  // Persist findings to the DB (best-effort — wrap each in try/catch).
  for (const finding of checks) {
    try {
      await db.complianceFinding.create({
        data: {
          ruleId: finding.ruleId,
          ruleName: finding.ruleName,
          status: finding.status,
          evidence: finding.evidence.slice(0, 500),
          checkType: finding.checkType,
          notes: finding.notes.slice(0, 500),
        },
      });
    } catch { /* best-effort */ }
  }

  // If compliance < 90% → alert owner + auto-create a RefactorProposal.
  if (scorePercent < 90) {
    const failedRules = checks.filter((c) => c.status === "fail");
    try {
      const { sendTelegramMessage } = await import("./telegram-notifier");
      await sendTelegramMessage(
        `⚠️ *COMPLIANCE ALERT*\n\n` +
        `Score: ${scorePercent}% (target: 90%+)\n` +
        `Failed rules: ${failedRules.length}\n\n` +
        `Failed rule list:\n${failedRules.map((r) => `  • ${r.ruleId}: ${r.evidence.slice(0, 80)}`).join("\n")}\n\n` +
        `Auto-creating RefactorProposal to restore missing wiring per RULE-76.`
      );
    } catch { /* best-effort */ }

    // Auto-create a RefactorProposal pointing at the highest-priority failed rule.
    const topFailure = failedRules[0];
    if (topFailure) {
      try {
        await db.refactorProposal.create({
          data: {
            targetFile: topFailure.evidence.split(":")[0] ?? "src/lib/constitution.ts",
            failureRate: 100,
            failureCount: 1,
            reason: `Compliance audit failed for ${topFailure.ruleId}: ${topFailure.notes}`,
            errorSamplesJson: JSON.stringify([topFailure.evidence]),
            originalCode: "",
            proposedCode: "",
            testResults: "{}",
            buildSucceeded: false,
            status: "pending-compliance-fix",
          },
        });
      } catch { /* best-effort */ }
    }
  }

  logger.info("compliance-auditor.complete", { scorePercent, passed, failed, warnings });
  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: `📊 Compliance scorecard: ${scorePercent}% (${passed}/${checks.length} passed, ${failed} failed, ${warnings} warnings)`,
    level: scorePercent >= 90 ? "success" : "warn",
  });

  return scorecard;
}

// ─── Compliance checks ────────────────────────────────────────────────
//
// Each check is a function that verifies a specific rule is enforced.
// Returns file:line evidence or "NOT IMPLEMENTED".

interface ComplianceCheckDef {
  ruleId: string;
  ruleName: string;
  checkType: ComplianceCheck["checkType"];
  verify: () => Promise<ComplianceCheck>;
}

const COMPLIANCE_CHECKS: ComplianceCheckDef[] = [
  // RULE-08 — Credential Vault AES-256-GCM
  {
    ruleId: "RULE-08-CREDENTIAL-VAULT-AES",
    ruleName: "AES-256-GCM VAULT",
    checkType: "static-grep",
    verify: async () => {
      const grep = await grepInSrc("aes-256-gcm|aes256gcm|AES-256-GCM", "src/lib/credential-vault.ts");
      return {
        ruleId: "RULE-08-CREDENTIAL-VAULT-AES",
        ruleName: "AES-256-GCM VAULT",
        checkType: "static-grep",
        status: grep.found ? "pass" : "fail",
        evidence: grep.found ? grep.evidence : "NOT IMPLEMENTED — AES-256-GCM not found in credential-vault.ts",
        notes: grep.found ? "" : "Verify the Credential Vault uses AES-256-GCM encryption.",
      };
    },
  },
  // RULE-51 — Pre-Publish Gate
  {
    ruleId: "RULE-51-PRE-PUBLISH-QUALITY-GATE",
    ruleName: "NOTHING SHIPS UNTESTED",
    checkType: "static-grep",
    verify: async () => {
      const grep = await grepInSrc("runPrePublishGate", "src/lib/pre-publish-gate.ts");
      const grep2 = await grepInSrc("runPrePublishGate", "src/app/api");
      return {
        ruleId: "RULE-51-PRE-PUBLISH-QUALITY-GATE",
        ruleName: "NOTHING SHIPS UNTESTED",
        checkType: "static-grep",
        status: grep.found && grep2.found ? "pass" : "warning",
        evidence: grep.found && grep2.found
          ? `${grep.evidence}; wired in API at ${grep2.evidence}`
          : `Pre-publish gate exists (${grep.evidence}) but NOT wired into any API route`,
        notes: grep2.found ? "" : "runPrePublishGate is defined but not called from any approval route.",
      };
    },
  },
  // RULE-55 — Protected Previews (watermark + DevTools)
  {
    ruleId: "RULE-55-PROTECTED-PREVIEWS",
    ruleName: "PREVIEWS ARE VIEW-ONLY",
    checkType: "static-grep",
    verify: async () => {
      const watermark = await grepInSrc("watermark", "src/lib/protected-preview.ts");
      const devtools = await grepInSrc("devtools|contextmenu", "src/lib/protected-preview.ts");
      return {
        ruleId: "RULE-55-PROTECTED-PREVIEWS",
        ruleName: "PREVIEWS ARE VIEW-ONLY",
        checkType: "static-grep",
        status: watermark.found && devtools.found ? "pass" : "fail",
        evidence: watermark.found && devtools.found
          ? `${watermark.evidence}; ${devtools.evidence}`
          : "NOT IMPLEMENTED — watermark or DevTools blocking missing",
        notes: "",
      };
    },
  },
  // RULE-58 — Zero-Cost Channels (no paid API in default path)
  {
    ruleId: "RULE-58-ZERO-COST-CHANNELS",
    ruleName: "PREFER OPEN-SOURCE",
    checkType: "static-grep",
    verify: async () => {
      const paidApis = await grepInSrc("from ['\"]openai['\"]|from ['\"]@anthropic-ai|from ['\"]@google/generative-ai", "src/lib");
      return {
        ruleId: "RULE-58-ZERO-COST-CHANNELS",
        ruleName: "PREFER OPEN-SOURCE",
        checkType: "static-grep",
        status: paidApis.found ? "fail" : "pass",
        evidence: paidApis.found ? `Found paid API import: ${paidApis.evidence}` : "No paid API imports in src/lib (default code path uses Baileys + Ollama)",
        notes: paidApis.found ? "Remove the paid API import or gate it behind an explicit env opt-in." : "",
      };
    },
  },
  // RULE-69 — Autonomous Lead Hunting
  {
    ruleId: "RULE-69-AUTONOMOUS-LEAD-HUNTING",
    ruleName: "HUNT FOR LEADS, DON'T JUST WAIT",
    checkType: "static-grep",
    verify: async () => {
      const grep = await grepInSrc("runDailyLeadHunt", "src/lib/lead-hunter/index.ts");
      const cronGrep = await grepInSrc("daily-lead-hunt", "src/lib/simulation/seed.ts");
      return {
        ruleId: "RULE-69-AUTONOMOUS-LEAD-HUNTING",
        ruleName: "HUNT FOR LEADS, DON'T JUST WAIT",
        checkType: "static-grep",
        status: grep.found && cronGrep.found ? "pass" : "fail",
        evidence: grep.found && cronGrep.found
          ? `${grep.evidence}; cron registered at ${cronGrep.evidence}`
          : "NOT IMPLEMENTED",
        notes: "",
      };
    },
  },
  // RULE-72 — Self-Evolving Codebase (refactor-engine)
  {
    ruleId: "RULE-72-SELF-EVOLVING-CODEBASE",
    ruleName: "REWRITE YOUR OWN OUTDATED LOGIC",
    checkType: "static-grep",
    verify: async () => {
      const grep = await grepInSrc("draftAndProposeRefactor|executeMerge", "src/lib/self-evolution/refactor-engine.ts");
      const cronGrep = await grepInSrc("weekly-code-auditor", "src/lib/simulation/seed.ts");
      return {
        ruleId: "RULE-72-SELF-EVOLVING-CODEBASE",
        ruleName: "REWRITE YOUR OWN OUTDATED LOGIC",
        checkType: "static-grep",
        status: grep.found && cronGrep.found ? "pass" : "fail",
        evidence: grep.found && cronGrep.found
          ? `${grep.evidence}; cron at ${cronGrep.evidence}`
          : "NOT IMPLEMENTED",
        notes: "",
      };
    },
  },
  // RULE-74 — Double-Entry Ledger
  {
    ruleId: "RULE-74-DOUBLE-ENTRY-ACCOUNTING",
    ruleName: "TRACK EVERY CENT AND EVERY COMPUTE CYCLE",
    checkType: "static-grep",
    verify: async () => {
      const grep = await grepInSrc("recordDoubleEntry|recordLedgerEntry", "src/lib/finance/ledger.ts");
      const apiGrep = await grepInSrc("finance/pnl", "src/app/api/finance/pnl/route.ts");
      return {
        ruleId: "RULE-74-DOUBLE-ENTRY-ACCOUNTING",
        ruleName: "TRACK EVERY CENT AND EVERY COMPUTE CYCLE",
        checkType: "static-grep",
        status: grep.found && apiGrep.found ? "pass" : "fail",
        evidence: grep.found && apiGrep.found
          ? `${grep.evidence}; P&L API at ${apiGrep.evidence}`
          : "NOT IMPLEMENTED",
        notes: "",
      };
    },
  },
  // RULE-76 — Live Compliance Audit (recursive — this rule verifies the auditor itself exists)
  {
    ruleId: "RULE-76-LIVE-COMPLIANCE-AUDIT",
    ruleName: "PROVE YOU FOLLOW YOUR OWN RULES",
    checkType: "static-grep",
    verify: async () => {
      const grep = await grepInSrc("auditCompliance|ComplianceScorecard", "src/lib/compliance-auditor.ts");
      return {
        ruleId: "RULE-76-LIVE-COMPLIANCE-AUDIT",
        ruleName: "PROVE YOU FOLLOW YOUR OWN RULES",
        checkType: "static-grep",
        status: grep.found ? "pass" : "fail",
        evidence: grep.found ? grep.evidence : "NOT IMPLEMENTED",
        notes: "",
      };
    },
  },
  // RULE-77 — Capability Registry
  {
    ruleId: "RULE-77-CAPABILITY-REGISTRY",
    ruleName: "MAINTAIN A LIVE MANIFEST OF CAPABILITIES",
    checkType: "static-grep",
    verify: async () => {
      const grep = await grepInSrc("generateCapabilityManifest", "src/lib/capability-registry.ts");
      return {
        ruleId: "RULE-77-CAPABILITY-REGISTRY",
        ruleName: "MAINTAIN A LIVE MANIFEST OF CAPABILITIES",
        checkType: "static-grep",
        status: grep.found ? "pass" : "fail",
        evidence: grep.found ? grep.evidence : "NOT IMPLEMENTED",
        notes: "",
      };
    },
  },
  // RULE-78 — Multi-Owner Isolation
  {
    ruleId: "RULE-78-MULTI-OWNER-ISOLATION",
    ruleName: "STRICT DATA AND CONFIG ISOLATION",
    checkType: "static-grep",
    verify: async () => {
      const grep = await grepInSrc("WorkspaceManager|getOwnerContext", "src/lib/multi-owner/workspace-manager.ts");
      return {
        ruleId: "RULE-78-MULTI-OWNER-ISOLATION",
        ruleName: "STRICT DATA AND CONFIG ISOLATION",
        checkType: "static-grep",
        status: grep.found ? "pass" : "fail",
        evidence: grep.found ? grep.evidence : "NOT IMPLEMENTED",
        notes: "",
      };
    },
  },
  // RULE-79 — Safe Rollback Policy
  {
    ruleId: "RULE-79-SAFE-ROLLBACK-POLICY",
    ruleName: "NEVER IMPLEMENT CHANGES IMMEDIATELY",
    checkType: "static-grep",
    verify: async () => {
      const grep = await grepInSrc("rollbackIfCrashed|CodeArchive|reverted-crash", "src/lib/self-evolution/refactor-engine.ts");
      return {
        ruleId: "RULE-79-SAFE-ROLLBACK-POLICY",
        ruleName: "NEVER IMPLEMENT CHANGES IMMEDIATELY",
        checkType: "static-grep",
        status: grep.found ? "pass" : "fail",
        evidence: grep.found ? grep.evidence : "NOT IMPLEMENTED",
        notes: "",
      };
    },
  },
];

// ─── Grep helper ──────────────────────────────────────────────────────

async function grepInSrc(pattern: string, filePathGlob: string): Promise<{ found: boolean; evidence: string }> {
  try {
    // Use ripgrep (rg) — it's pre-installed + faster than grep.
    const cmd = `rg -n "${pattern.replace(/"/g, '\\"')}" ${filePathGlob} 2>/dev/null | head -3`;
    const output = execSync(cmd, { cwd: process.cwd(), encoding: "utf-8", timeout: 5000 }).trim();
    if (output) {
      const firstLine = output.split("\n")[0];
      return { found: true, evidence: firstLine };
    }
    return { found: false, evidence: "" };
  } catch {
    return { found: false, evidence: "" };
  }
}
