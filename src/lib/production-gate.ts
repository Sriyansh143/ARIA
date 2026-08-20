/**
 * src/lib/production-gate.ts — v61 Phase 5 (100% Production-Grade Gate)
 *
 * Owner's rule: "Every step, no matter how small, must be verified for
 * real-world usability before being marked complete. No 'draft' or
 * 'placeholder' outputs allowed in production."
 *
 * Before marking a step as "complete", run specific checks based on the
 * output type. If the output fails the gate, it's sent back to the Refiner
 * in the debate loop. If it fails 3 times, it halts + asks the owner
 * for clarification (Zero-Assumption rule).
 */

import "server-only";
import { logger } from "./logger";

export interface ProductionGateResult {
  /** True if the output passed the production gate. */
  passed: boolean;
  /** Specific issues found (empty if passed). */
  issues: string[];
  /** The step type that was checked. */
  stepType: string;
  /** Whether to retry (send back to the Refiner). */
  shouldRetry: boolean;
  /** Whether to halt + ask the owner (after 3 failures). */
  shouldHalt: boolean;
}

/**
 * Verify that a step's output is production-ready.
 *
 * @param output The step's output text.
 * @param stepType The step type: code | email | deploy | research | decision | general.
 * @param failureCount How many times this step has failed the gate (0 = first attempt).
 */
export function verifyProductionReadiness(
  output: string,
  stepType: string,
  failureCount: number = 0,
): ProductionGateResult {
  const issues: string[] = [];

  // ─── Universal checks (apply to all output types) ───
  if (!output || output.trim().length === 0) {
    issues.push("Output is empty");
  }
  // Check for placeholder/draft markers.
  const PLACEHOLDER_PATTERNS = [
    /\bTODO\b/i,
    /\bFIXME\b/i,
    /\bTBD\b/i,
    /\bPLACEHOLDER\b/i,
    /\bDRAFT\b/i,
    /\[fill in\]/i,
    /\[insert.*here\]/i,
    /lorem ipsum/i,
    /\.\.\.\s*$/, // ends with ellipsis (incomplete)
    /\(error:.*\)/i, // BUG-10 FIX: LLM-error fallback strings like "(error: timeout)"
  ];
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(output)) {
      issues.push(`Output contains placeholder/draft marker: ${pattern.source}`);
    }
  }
  // Check for hardcoded secrets.
  if (/(sk_live_|sk_test_|AKIA|ghp_|gho_)/.test(output)) {
    issues.push("Output contains hardcoded API key/secret");
  }

  // ─── Type-specific checks ───
  switch (stepType) {
    case "code":
    case "Engineering":
    case "codegen":
      checkCodeOutput(output, issues);
      break;
    case "email":
    case "outreach":
    case "send_email":
      checkEmailOutput(output, issues);
      break;
    case "deploy":
    case "DevOps":
      checkDeployOutput(output, issues);
      break;
    case "research":
    case "Research":
      checkResearchOutput(output, issues);
      break;
  }

  const passed = issues.length === 0;
  const shouldRetry = !passed && failureCount < 3;
  const shouldHalt = !passed && failureCount >= 3;

  if (!passed) {
    logger.warn("production-gate.failed", {
      stepType,
      issues,
      failureCount,
      shouldRetry,
      shouldHalt,
    });
  }

  return { passed, issues, stepType, shouldRetry, shouldHalt };
}

/**
 * Code-specific checks: error handling, syntax, no hardcoded secrets.
 */
function checkCodeOutput(output: string, issues: string[]): void {
  // Check for error handling (try/catch or .catch()).
  if (!/try\s*\{|\.catch\s*\(/.test(output) && /fetch\(|await\s/.test(output)) {
    issues.push("Code uses fetch/await but has no error handling (try/catch or .catch)");
  }
  // Check for balanced braces (basic syntax).
  const openBraces = (output.match(/{/g) ?? []).length;
  const closeBraces = (output.match(/}/g) ?? []).length;
  if (Math.abs(openBraces - closeBraces) > 2) {
    issues.push(`Unbalanced braces: ${openBraces} open, ${closeBraces} close`);
  }
  // Check for console.log in production code (not in tests).
  if (/console\.log\(/.test(output) && !/test|spec/i.test(output)) {
    issues.push("Production code contains console.log (use logger instead)");
  }
}

/**
 * Email/outreach-specific checks: professional tone, CTA, CAN-SPAM compliance.
 */
function checkEmailOutput(output: string, issues: string[]): void {
  // Check for unsubscribe link (CAN-SPAM).
  if (!/unsubscribe|opt.out|manage.*preferences/i.test(output)) {
    issues.push("Email missing unsubscribe link (CAN-SPAM compliance)");
  }
  // Check for a clear CTA.
  if (!/click|reply|book|schedule|contact|call|visit/i.test(output)) {
    issues.push("Email missing clear call-to-action");
  }
  // Check for sender address (CAN-SPAM).
  if (!/@.*\./.test(output)) {
    issues.push("Email missing sender email address (CAN-SPAM compliance)");
  }
}

/**
 * Deploy/infra-specific checks: rollback plan, health checks.
 */
function checkDeployOutput(output: string, issues: string[]): void {
  // Check for rollback plan.
  if (!/rollback|revert|undo|previous version/i.test(output)) {
    issues.push("Deploy plan missing rollback strategy");
  }
  // Check for health checks.
  if (!/health|smoke test|verification|curl.*health/i.test(output)) {
    issues.push("Deploy plan missing health check / verification step");
  }
}

/**
 * Research-specific checks: sources cited, no fabrication.
 */
function checkResearchOutput(output: string, issues: string[]): void {
  // Check for source citations.
  if (!/source|citation|according to|based on|https?:\/\//i.test(output)) {
    issues.push("Research output missing source citations");
  }
  // Check for "I don't know" patterns (good — shows no fabrication).
  // This is NOT an issue — it's a positive signal.
}
