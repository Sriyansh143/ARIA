/**
 * src/lib/step-debate.ts — v61 Phase 5 (Step-by-Step Multi-Model Debate)
 *
 * Owner's rule: "Before executing every step of a complex task, run a
 * micro-debate (Proposer → Critic → Refiner) using different models or
 * personas. Inject the results of all previous steps into this debate."
 *
 * This is the "Claude-level intelligence loop" — it forces the system to
 * think critically about each step before committing, not just generate
 * and ship.
 *
 * Flow:
 *   1. Proposer: generates the step execution plan/code using the primary model.
 *   2. Critic: reviews the proposal for bugs, edge cases, production-readiness
 *      using a strict QA persona (can be the same model with a different
 *      system prompt, or a different model if available).
 *   3. Refiner: the Proposer reviews the Critic's feedback and generates
 *      the final, refined output.
 *
 * Optimization for Oracle Free Tier: only trigger the full 3-agent debate
 * for steps marked as "high complexity" or "financial/security critical".
 * For simple steps, use a lightweight single-pass execution.
 */

import "server-only";
import { callLLM } from "./llm-client";
import { logger } from "./logger";
import { buildGlobalLogicsPrompt } from "./global-logics";
import { buildConstitutionPrompt } from "./constitution";
import { enhancePromptWithResearch } from "./internet-research";
import { verifyProductionReadiness } from "./production-gate";
// v69 Phase 19 BLOCKER 0: Multi-Tier Context Manager — rolling summaries,
// local Proposer/Critic/Refiner, external API reserved for final execution.
import { contextManager, shouldUseLocalModel } from "./context-manager";

export interface StepContext {
  /** The step description / task. */
  description: string;
  /** The step type: code | email | deploy | research | decision | general. */
  stepType: string;
  /** The skill slug (if applicable). */
  skillSlug?: string;
  /** The full context (system prompt + skill file + global logics). */
  context: string;
  /** The complexity: low | medium | high. */
  complexity: "low" | "medium" | "high";
  /** Whether this step is financial or security critical. */
  critical?: boolean;
}

export interface StepDebateResult {
  /** The final refined output. */
  finalOutput: string;
  /** The Proposer's initial output. */
  proposal: string;
  /** The Critic's feedback. */
  critique: string;
  /** Whether the debate ran (false = single-pass for low complexity). */
  debated: boolean;
  /** Number of refinement rounds. */
  rounds: number;
  /** Whether the final output passed the production gate. */
  productionReady: boolean;
}

/**
 * Run a step debate (Proposer → Critic → Refiner).
 *
 * For low/medium complexity, this is a single-pass execution (no debate).
 * For high complexity or critical steps, the full 3-agent debate runs.
 *
 * @param step The step context.
 * @param previousStepResults The results of all previous steps (injected for context continuity).
 * @returns The debate result with the final refined output.
 */
export async function runStepDebate(
  step: StepContext,
  previousStepResults: StepDebateResult[] = [],
): Promise<StepDebateResult> {
  const shouldDebate = step.complexity === "high" || step.critical === true;
  const globalLogics = buildGlobalLogicsPrompt(2000);
  // v69 Phase 19 BLOCKER 3: Constitution is now IMMUTABLE — full text of
  // all 37 rules is always injected. The maxChars param is ignored for the
  // Constitution block. Token budget control moves to the ContextManager
  // which applies history budgets ONLY to execution history, never to rules.
  const constitution = buildConstitutionPrompt();
  // v69 Phase 19 BLOCKER 0: Build the full context via the ContextManager.
  // The Constitution is Priority 1 (never truncated). The previous-results
  // block is Priority 2 (rolling summary, budget-bound via maxHistoryChars).
  const built = contextManager.buildContext({
    constitution,
    globalLogics,
    skillContext: step.context,
    previousResults: previousStepResults.map((r) => ({
      stepName: r.proposal.slice(0, 60), // best-effort label
      finalOutput: r.finalOutput,
    })),
    taskDescription: step.description,
    maxHistoryChars: 4000,
  });
  logger.info("step-debate.context-built", {
    constitutionChars: built.breakdown.constitutionChars,
    historyChars: built.breakdown.historySummaryChars,
    historyTruncated: built.breakdown.historyTruncated,
    constitutionTruncated: built.breakdown.constitutionTruncated,
    totalChars: built.breakdown.totalChars,
  });
  const previousContext = ""; // folded into contextManager output

  // ─── Low/Medium complexity: single-pass (no debate) ───
  if (!shouldDebate) {
    // v69 Phase 19 BLOCKER 0: Single-pass still uses the ContextManager
    // output (full Constitution + summarized history + task). For low/
    // medium complexity the Proposer is routed to LOCAL Ollama (Tier 3)
    // per the multi-tier strategy — final execution only uses cloud.
    const proposerPrompt = `${built.prompt}\n\nGenerate the output for this step. Be production-ready.`;
    const useLocal = shouldUseLocalModel("Proposer", false);
    const result = await callLLM("Proposer", step.stepType, proposerPrompt, {
      maxRetries: 1,
      model: useLocal ? (process.env.WORKFLOW_PROPOSER_MODEL || "llama3.2:3b") : undefined,
      preferLocal: useLocal,
    } as any);
    const output = result.success ? result.completion : `(error: ${result.error})`;
    // v61 FIX (Finding 4b): Run the production gate even on single-pass outputs.
    // If the output contains placeholders (TODO/FIXME/DRAFT), hardcoded secrets,
    // or missing error handling, mark it NOT production-ready + prefix with
    // NEEDS_CONTEXT so the workflow-engine escalates to the Zero-Assumption
    // guard. Single-pass has no Refiner loop, so any gate failure halts.
    let finalOutput = output;
    let productionReady = result.success;
    let critique = "(skipped — low complexity)";
    if (result.success) {
      const gate = verifyProductionReadiness(output, step.stepType, 0);
      productionReady = gate.passed;
      if (!gate.passed) {
        critique = `Production Gate rejected: ${gate.issues.join("; ")}`;
        finalOutput = `NEEDS_CONTEXT: Production Gate rejected this output. Issues: ${gate.issues.join("; ")}. Owner clarification required.`;
        logger.warn("step-debate.single-pass.gate-rejected", {
          stepType: step.stepType,
          issues: gate.issues,
        });
      }
    }
    return {
      finalOutput,
      proposal: output,
      critique,
      debated: false,
      rounds: 1,
      productionReady,
    };
  }

  // ─── High complexity / critical: full 3-agent debate ───
  logger.info("step-debate.starting", {
    description: step.description.slice(0, 80),
    stepType: step.stepType,
    critical: step.critical,
  });

  // Round 1: Proposer generates the initial proposal.
  // v61 Phase 5: enhance the prompt with internet research + full skill context.
  // v69 Phase 19 BLOCKER 0: Proposer routes to LOCAL Ollama (Tier 3) to save
  // external API tokens. Only the final execution step uses cloud APIs.
  const enhancedContext = shouldDebate
    ? await enhancePromptWithResearch(step.context, step.description, step.skillSlug, step.complexity).catch(() => step.context)
    : step.context;
  // Rebuild context with the enhanced research attached (still preserves full Constitution).
  const builtDebate = contextManager.buildContext({
    constitution,
    globalLogics,
    skillContext: enhancedContext,
    previousResults: previousStepResults.map((r) => ({
      stepName: r.proposal.slice(0, 60),
      finalOutput: r.finalOutput,
    })),
    taskDescription: step.description,
    maxHistoryChars: 4000,
  });
  const proposerPrompt = `${builtDebate.prompt}\n\nYou are the PROPOSER. Generate the step execution plan/code. Be thorough + production-ready. This is a complex/critical step — take it seriously.`;
  const proposerUseLocal = shouldUseLocalModel("Proposer", false);
  const proposerResult = await callLLM("Proposer", step.stepType, proposerPrompt, {
    maxRetries: 1,
    model: proposerUseLocal ? (process.env.WORKFLOW_PROPOSER_MODEL || "llama3.2:3b") : undefined,
    preferLocal: proposerUseLocal,
  } as any);
  const proposal = proposerResult.success ? proposerResult.completion : `(error: ${proposerResult.error})`;

  // Round 2: Critic reviews for bugs, edge cases, production-readiness.
  // v69 Phase 19 BLOCKER 0: Critic routes to LOCAL Ollama (Tier 3).
  const criticPrompt = `${builtDebate.prompt}\n\nThe PROPOSER generated this output:\n\n${proposal}\n\nYou are the CRITIC — a strict QA engineer. Review this output for:\n1. Bugs or logical errors\n2. Missing error handling\n3. Edge cases not covered\n4. Hardcoded secrets or non-production patterns\n5. Whether this is truly production-ready (no drafts/placeholders)\n6. Whether it violates any CONSTITUTION rule above\n\nList specific issues. If the output is production-ready, say "APPROVED" at the end. Otherwise say "REJECT" with specific fixes needed.`;
  const criticUseLocal = shouldUseLocalModel("Critic", false);
  const criticResult = await callLLM("Critic", "QA", criticPrompt, {
    maxRetries: 1,
    model: criticUseLocal ? (process.env.WORKFLOW_PROPOSER_MODEL || "llama3.2:3b") : undefined,
    preferLocal: criticUseLocal,
  } as any);
  const critique = criticResult.success ? criticResult.completion : "(critic unavailable)";

  // Round 3: Refiner produces the final output based on the critique.
  let finalOutput = proposal;
  let rounds = 1;
  const isApproved = critique.toUpperCase().includes("APPROVED");

  if (!isApproved) {
    // v69 Phase 19 BLOCKER 0: Refiner routes to LOCAL Ollama (Tier 3).
    const refinerPrompt = `${builtDebate.prompt}\n\nYour previous proposal:\n${proposal}\n\nThe CRITIC found these issues:\n${critique}\n\nYou are the REFINER. Fix every issue the Critic identified. Generate the final, production-ready output. This is your last chance — make it perfect.`;
    const refinerUseLocal = shouldUseLocalModel("Refiner", false);
    const refinerResult = await callLLM("Refiner", step.stepType, refinerPrompt, {
      maxRetries: 1,
      model: refinerUseLocal ? (process.env.WORKFLOW_PROPOSER_MODEL || "llama3.2:3b") : undefined,
      preferLocal: refinerUseLocal,
    } as any);
    if (refinerResult.success) {
      finalOutput = refinerResult.completion;
      rounds = 2;
    }
  }

  // v61 FIX (Finding 4b): Production Gate — verify the final output is
  // production-ready (no TODO/FIXME/DRAFT placeholders, no hardcoded secrets,
  // no missing error handling). If it fails, send it back to the Refiner with
  // the gate's specific issues. After 3 total failures, halt + escalate to the
  // Zero-Assumption guard (NEEDS_CONTEXT) so the workflow-engine asks the owner
  // for clarification. This is the active enforcement point — previously the
  // gate existed but was never invoked (dead code).
  const MAX_GATE_ATTEMPTS = 3;
  let gateFailureCount = 0;
  let gateResult = verifyProductionReadiness(finalOutput, step.stepType, gateFailureCount);
  // BUG-1 FIX: use `< MAX_GATE_ATTEMPTS` (not `< MAX_GATE_ATTEMPTS - 1`) so the
  // loop iterates 3×, reaching failureCount=3 which triggers shouldHalt=true.
  while (!gateResult.passed && gateResult.shouldRetry && gateFailureCount < MAX_GATE_ATTEMPTS) {
    gateFailureCount++;
    const gateRefinerPrompt = `${builtDebate.prompt}\n\nYour previous output:\n${finalOutput}\n\nThe PRODUCTION GATE found these specific issues:\n${gateResult.issues.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}\n\nYou are the REFINER. Fix EVERY issue the gate identified. Produce the final, production-ready output. No placeholders, no TODOs, no FIXMEs, no DRAFT markers, no hardcoded secrets.`;
    const gateUseLocal = shouldUseLocalModel("Refiner", false);
    const gateRefinerResult = await callLLM("Refiner", step.stepType, gateRefinerPrompt, {
      maxRetries: 1,
      model: gateUseLocal ? (process.env.WORKFLOW_PROPOSER_MODEL || "llama3.2:3b") : undefined,
      preferLocal: gateUseLocal,
    } as any);
    if (gateRefinerResult.success) {
      finalOutput = gateRefinerResult.completion;
      rounds++;
    }
    gateResult = verifyProductionReadiness(finalOutput, step.stepType, gateFailureCount);
  }

  const productionReady = gateResult.passed;
  if (!productionReady && gateResult.shouldHalt) {
    // Escalate to the Zero-Assumption guard — the workflow-engine detects the
    // NEEDS_CONTEXT prefix and halts + sends a Telegram clarification request.
    finalOutput = `NEEDS_CONTEXT: Production Gate rejected this output after ${MAX_GATE_ATTEMPTS} attempts. Issues: ${gateResult.issues.join("; ")}. Owner clarification required.`;
  }

  logger.info("step-debate.complete", {
    approved: isApproved,
    rounds,
    finalOutputLength: finalOutput.length,
    productionReady,
    gateIssues: gateResult.issues,
    gateFailures: gateFailureCount,
  });

  // v69 Phase 19 BLOCKER 0: After the debate completes, update the rolling
  // summary so future steps see a compressed view of this step's outcome.
  // This is the key token-saving mechanism — instead of re-injecting the
  // full finalOutput into the next step's prompt, we inject a ~1000-char
  // summary generated by local Ollama.
  await contextManager.updateSummary(step.description.slice(0, 60), finalOutput);

  return {
    finalOutput,
    proposal,
    critique,
    debated: true,
    rounds,
    productionReady,
  };
}
