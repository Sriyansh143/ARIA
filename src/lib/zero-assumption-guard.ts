/**
 * src/lib/zero-assumption-guard.ts — v61 Phase 3 (ZERO ASSUMPTIONS)
 *
 * Owner's rule: "If any information is missing to complete a task, the app
 * MUST NOT guess. It must halt and ask the owner/client for clarification.
 * No assumptions at any cost."
 *
 * Before dispatching a task, the conductor/dispatcher calls checkContextCompleteness()
 * with the task spec + the skill pattern's requiredInputs. If any required field
 * is missing/empty/ambiguous, the function returns a ContextGap describing
 * what's missing + a specific clarification question.
 *
 * The caller then:
 *   1. Sets the task status to "needs_context".
 *   2. Sends a Telegram message to the owner: "❓ CLARIFICATION NEEDED..."
 *   3. Halts dispatch until the owner provides the answer via /answer <id>.
 */

import "server-only";
import { getSkillPattern, type SkillPattern } from "./skill-patterns";

export interface ContextGap {
  /** True if the context is complete — task may proceed. */
  complete: boolean;
  /** The missing field name (when complete=false). */
  missingField?: string;
  /** A specific clarification question for the owner. */
  question?: string;
  /** The task ID to resume once answered. */
  taskId?: string;
}

/**
 * Check whether a task has all the required context to execute without guessing.
 *
 * @param taskKind The skill slug or action verb (e.g. "send_email", "llm", "docx").
 * @param taskPayload The task's input fields (e.g. { to, subject, body }).
 * @param taskId The task ID (for the resume link).
 * @returns ContextGap — complete=true if OK, or complete=false with the question.
 */
export function checkContextCompleteness(
  taskKind: string,
  taskPayload: Record<string, unknown>,
  taskId?: string,
): ContextGap {
  // Try to look up the skill pattern for requiredInputs.
  const pattern: SkillPattern | null = getSkillPattern(taskKind);

  // If no pattern, fall back to action-specific required fields.
  let requiredFields: string[] = pattern?.requiredInputs ?? [];
  if (!pattern) {
    // Action-specific defaults.
    switch (taskKind) {
      case "send_email":
      case "send_email_approval":
        requiredFields = ["to", "subject", "body"];
        break;
      case "deploy":
        requiredFields = ["target", "version"];
        break;
      case "spend":
      case "spend_approval":
        requiredFields = ["amount", "category"];
        break;
      case "sign_contract":
        requiredFields = ["counterparty", "amount"];
        break;
      case "call":
      case "phone_call":
        requiredFields = ["phoneNumber", "purpose"];
        break;
      case "build_service":
        requiredFields = ["serviceId", "spec"];
        break;
      default:
        // Unknown task kind — require at least a "message" or "task" field.
        requiredFields = ["task"];
    }
  }

  // Check each required field.
  for (const field of requiredFields) {
    const value = taskPayload[field];
    if (isMissingOrEmpty(value)) {
      const question = generateClarificationQuestion(taskKind, field, taskPayload);
      return {
        complete: false,
        missingField: field,
        question,
        taskId,
      };
    }
  }

  return { complete: true };
}

/**
 * Returns true if a value is missing, empty, or a placeholder.
 * "guess" patterns like "TBD", "TODO", "[fill in]" are also treated as missing.
 */
function isMissingOrEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return true;
    const PLACEHOLDER_PATTERNS = /^(tbd|todo|tba|fill\s*in|\[.*\]|placeholder|unknown|n\/a)$/i;
    if (PLACEHOLDER_PATTERNS.test(trimmed)) return true;
    return false;
  }
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/**
 * Generate a specific, actionable clarification question.
 * Uses the task kind + missing field to produce a precise ask.
 */
function generateClarificationQuestion(
  taskKind: string,
  missingField: string,
  payload: Record<string, unknown>,
): string {
  const context = Object.keys(payload).length > 0
    ? ` (I have: ${Object.keys(payload).join(", ")})`
    : "";
  switch (taskKind) {
    case "send_email":
    case "send_email_approval":
      if (missingField === "to") return `Who should this email be sent to? Please provide the recipient email address${context}.`;
      if (missingField === "subject") return `What should the subject line of this email be?${context}`;
      if (missingField === "body") return `What is the email body content? Please provide the full message you want sent${context}.`;
      break;
    case "deploy":
      if (missingField === "target") return `What is the deployment target (e.g. staging, production)?${context}`;
      if (missingField === "version") return `What version should be deployed?${context}`;
      break;
    case "spend":
    case "spend_approval":
      if (missingField === "amount") return `What is the exact spend amount?${context}`;
      if (missingField === "category") return `What category is this spend (e.g. infrastructure, marketing, tools)?${context}`;
      break;
    case "call":
    case "phone_call":
      if (missingField === "phoneNumber") return `What phone number should be called?${context}`;
      if (missingField === "purpose") return `What is the purpose of this call?${context}`;
      break;
    case "build_service":
      if (missingField === "serviceId") return `Which service should be built? (Options: seo-blog-post, landing-page, cli-tool, etc.)${context}`;
      if (missingField === "spec") return `What is the customer's specification for this build? Please describe what they want${context}.`;
      break;
  }
  // Generic fallback.
  return `The "${missingField}" field is required for this task but is missing. Please provide it${context}.`;
}
