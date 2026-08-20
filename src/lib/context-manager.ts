/**
 * src/lib/context-manager.ts — v70 Phase 20 (Multi-Tier Context Manager)
 *
 * Architectural Principle: "Constitution Guardrails are Absolute."
 * The full set of ALL 68 Constitution rules (RULE-01 through RULE-68,
 * unified in ALL_CONSTITUTION_RULES) is Priority 1 and is NEVER subject
 * to budget truncation. Token budget (maxChars) applies ONLY to:
 *   - execution history (previous step results)
 *   - agent logs
 *   - conversation turns
 *
 * v70 Phase 20 UPDATE: The ContextManager now reads from the unified
 * ALL_CONSTITUTION_RULES array via buildCompactConstitution(). All 68
 * rules appear in every LLM call in compact form (~700 tokens). The
 * previous v69 split — where only 37 rules in the third legacy block
 * had formal IDs + the other 31 (in the first two blocks) were plain
 * strings — is gone. There is ONE list now.
 *
 * Multi-Tier Strategy (token-saving):
 *   Tier 1 (Priority 1, IMMUTABLE): Compact Constitution (68 rules,
 *                                    ~700 tokens, never truncated).
 *   Tier 2 (Priority 2, summarized): Rolling summary of previous step
 *                                    results (~1000 tokens, generated
 *                                    by local Ollama llama3.2:3b).
 *   Tier 3 (Priority 3, local):      Proposer/Critic/Refiner reasoning
 *                                    routed to local Ollama.
 *   Tier 4 (Priority 4, external):   Final execution step routed to
 *                                    cloud APIs (Z.ai, Qwen Cloud).
 *
 * Usage:
 *   const ctx = contextManager.buildContext({
 *     // Caller can pass either:
 *     //   - a pre-built constitution string (uses caller's choice of
 *     //     buildCompactConstitution() or buildConstitutionPrompt())
 *     //   - OR omit `constitution` and we auto-call buildCompactConstitution()
 *     globalLogics: buildGlobalLogicsPrompt(2000),
 *     skillContext: skillFileContent,
 *     previousResults: [{ finalOutput: "...", stepName: "..." }, ...],
 *     taskDescription: "...",
 *     maxHistoryChars: 4000,  // budget for Tier 2 only
 *   });
 *   // → ctx is ready to feed to an LLM call
 *   // After the LLM returns, call:
 *   await contextManager.updateSummary(stepName, finalOutput);
 *
 * The ContextManager also exposes a buildCompactConstitution() method
 * that delegates to src/lib/constitution.ts's function of the same
 * name — useful when callers want to inspect the compact rules text
 * without re-importing the constitution module.
 */

import "server-only";
import { logger } from "./logger";
import { callLLM } from "./llm-client";
// v70 Phase 20: read from the unified ALL_CONSTITUTION_RULES array
// via buildCompactConstitution(). The 3 old siloed arrays are deleted.
import {
  buildCompactConstitution as _buildCompactConstitutionFromLib,
  ALL_CONSTITUTION_RULES,
  type ConstitutionRule,
} from "./constitution";

// ─── Types ────────────────────────────────────────────────────────────

export interface ContextBuildInput {
  /**
   * The Constitution block to inject as Priority 1.
   * v70 Phase 20: if omitted, the ContextManager auto-calls
   * buildCompactConstitution() which reads from ALL_CONSTITUTION_RULES
   * (all 68 rules, compact form, ~700 tokens, never truncated).
   * If you want the FULL text instead, pass buildConstitutionPrompt().
   */
  constitution?: string;
  /** Global logics prompt (capped at caller's discretion). */
  globalLogics?: string;
  /** Skill / file context injected for this step. */
  skillContext?: string;
  /** Internet research enhancement (optional). */
  enhancedContext?: string;
  /** Previous step results (full text — will be summarized to fit budget). */
  previousResults?: Array<{ stepName?: string; finalOutput: string }>;
  /** The current task description. */
  taskDescription: string;
  /** Budget for Tier 2 (rolling history summary). Default 4000 chars. */
  maxHistoryChars?: number;
}

export interface BuiltContext {
  /** The full assembled context string ready for an LLM call. */
  prompt: string;
  /** Token breakdown for logging + cost analysis. */
  breakdown: {
    constitutionChars: number;
    globalLogicsChars: number;
    skillContextChars: number;
    historySummaryChars: number;
    taskChars: number;
    totalChars: number;
    historyTruncated: boolean;
    constitutionTruncated: boolean; // always false — immutable
  };
  /** Whether the rolling summary was regenerated this call. */
  summaryRegenerated: boolean;
}

// ─── Rolling Summary State ────────────────────────────────────────────

interface RollingSummary {
  text: string;
  lastUpdated: string;
  stepCount: number;
}

// Module-level state — persists across calls within the same process.
// In a multi-process deployment, this state is per-worker; that's acceptable
// because each workflow run typically executes within one worker.
let rollingSummary: RollingSummary = {
  text: "",
  lastUpdated: new Date(0).toISOString(),
  stepCount: 0,
};

const SUMMARY_TARGET_CHARS = 1000; // ~250 tokens
const MAX_FULL_RESULT_CHARS_PER_STEP = 4000; // cap each step's raw contribution
const OLLAMA_MODEL = process.env.WORKFLOW_PROPOSER_MODEL
  || process.env.WORKFORCE_MODEL_SMALL
  || "llama3.2:3b"; // local Ollama default

// ─── ContextManager ───────────────────────────────────────────────────

export class ContextManager {
  /**
   * Build the full LLM context with the Constitution as Priority 1
   * (immutable, never truncated) and execution history as Priority 2
   * (rolling summary, budget-bound).
   */
  buildContext(input: ContextBuildInput): BuiltContext {
    // v70 Phase 20: if the caller did NOT pass a pre-built constitution,
    // auto-build the compact form from ALL_CONSTITUTION_RULES. This makes
    // the ContextManager the single source of truth for Constitution
    // injection — no caller can forget to include the rules.
    const constitutionText = input.constitution ?? _buildCompactConstitutionFromLib();
    const constitutionChars = constitutionText.length;
    const globalLogicsChars = input.globalLogics?.length ?? 0;
    const skillContextChars = input.skillContext?.length
      ?? input.enhancedContext?.length
      ?? 0;

    // ─── Tier 2: Build previous-results section ───
    // Two modes:
    //   (a) No prior summary exists yet → use raw previous results (capped).
    //   (b) Summary exists → use the summary + the most recent step's raw output.
    const maxHistory = input.maxHistoryChars ?? 4000;
    let historySummary = "";
    let historyTruncated = false;

    if (input.previousResults && input.previousResults.length > 0) {
      // Prefer the rolling summary if it exists and is recent.
      if (rollingSummary.text && rollingSummary.stepCount > 0) {
        const lastStep = input.previousResults[input.previousResults.length - 1];
        const lastStepText = (lastStep.finalOutput ?? "").slice(0, MAX_FULL_RESULT_CHARS_PER_STEP);
        historySummary =
          `PREVIOUS WORK (rolling summary, ${rollingSummary.stepCount} steps):\n` +
          `${rollingSummary.text}\n\n` +
          `MOST RECENT STEP (${lastStep.stepName ?? "unknown"}):\n${lastStepText}`;
      } else {
        // No summary yet — concat raw (capped per step).
        const parts: string[] = [];
        let total = 0;
        for (let i = 0; i < input.previousResults.length; i++) {
          const r = input.previousResults[i];
          const snippet = (r.finalOutput ?? "").slice(0, MAX_FULL_RESULT_CHARS_PER_STEP);
          parts.push(`Step ${i + 1} (${r.stepName ?? "unknown"}): ${snippet}`);
          total += snippet.length + 50;
          if (total > maxHistory) {
            historyTruncated = true;
            break;
          }
        }
        historySummary = `PREVIOUS STEP RESULTS (raw, inject for context continuity):\n${parts.join("\n")}`;
      }
      // Hard cap on the history block (we already prefer the summary above).
      if (historySummary.length > maxHistory) {
        historySummary = historySummary.slice(0, maxHistory - 80)
          + `\n...(history truncated at ${maxHistory} chars; Constitution NOT truncated)`;
        historyTruncated = true;
      }
    }

    const taskChars = input.taskDescription.length;

    // ─── Assemble the final prompt ───
    // Constitution is ALWAYS first + never trimmed.
    const sections: string[] = [
      constitutionText,
      input.globalLogics ?? "",
      input.skillContext ?? input.enhancedContext ?? "",
      historySummary,
      `TASK: ${input.taskDescription}`,
    ].filter((s) => s && s.length > 0);

    const prompt = sections.join("\n\n");

    return {
      prompt,
      breakdown: {
        constitutionChars,
        globalLogicsChars,
        skillContextChars,
        historySummaryChars: historySummary.length,
        taskChars,
        totalChars: prompt.length,
        historyTruncated,
        constitutionTruncated: false, // IMMUTABLE
      },
      summaryRegenerated: false, // set true only inside updateSummary()
    };
  }

  /**
   * Update the rolling summary after a step completes. Uses local Ollama
   * to compress the previous summary + the new step output into a fresh
   * ~1000-char summary. This is the key token-saving mechanism.
   */
  async updateSummary(stepName: string, stepOutput: string): Promise<void> {
    try {
      const newChunk = `${stepName}: ${stepOutput.slice(0, MAX_FULL_RESULT_CHARS_PER_STEP)}`;
      const existing = rollingSummary.text || "(no prior summary)";
      const compressPrompt = `You are a context compressor. Below is the existing rolling summary of previous workflow steps, followed by the most recent step's output. Produce a NEW concise summary (~800-1000 chars) that preserves the key decisions, files modified, errors seen, and lessons learned. Do NOT include the Constitution — only the execution history.\n\nEXISTING SUMMARY:\n${existing}\n\nNEW STEP (${stepName}):\n${newChunk}\n\nRespond with only the new summary text (no preamble, no markdown).`;

      // Route to LOCAL Ollama (Tier 3) — not to a paid cloud API.
      const result = await callLLM("ContextCompressor", "research", compressPrompt, {
        maxRetries: 1,
        model: OLLAMA_MODEL,
        preferLocal: true, // hint to llm-client to use Ollama
      } as any);

      if (result.success && result.completion && result.completion.length > 50) {
        rollingSummary = {
          text: result.completion.slice(0, SUMMARY_TARGET_CHARS * 2),
          lastUpdated: new Date().toISOString(),
          stepCount: rollingSummary.stepCount + 1,
        };
        logger.info("context-manager.summary-updated", {
          stepName,
          stepCount: rollingSummary.stepCount,
          summaryChars: rollingSummary.text.length,
          model: OLLAMA_MODEL,
        });
      } else {
        // Fallback: do a manual concat-and-truncate (no LLM call).
        rollingSummary = {
          text: `${existing}\n${newChunk}`.slice(0, SUMMARY_TARGET_CHARS * 3),
          lastUpdated: new Date().toISOString(),
          stepCount: rollingSummary.stepCount + 1,
        };
        logger.warn("context-manager.summary-fallback", {
          stepName,
          reason: result.error ?? "empty completion",
        });
      }
    } catch (err) {
      // Never block a workflow on summary failure.
      logger.warn("context-manager.update-failed", { stepName, error: String(err).slice(0, 120) });
    }
  }

  /**
   * Reset the rolling summary (e.g. at the start of a new workflow run).
   */
  resetSummary(): void {
    rollingSummary = {
      text: "",
      lastUpdated: new Date(0).toISOString(),
      stepCount: 0,
    };
    logger.info("context-manager.summary-reset");
  }

  /**
   * Get the current rolling summary (for inspection / debugging).
   */
  getSummary(): RollingSummary {
    return { ...rollingSummary };
  }

  /**
   * v70 Phase 20: Build the compact Constitution string from
   * ALL_CONSTITUTION_RULES. Delegates to the function in
   * src/lib/constitution.ts. Returns all 68 rules in compact form
   * (RULE-ID: Short Name (Priority)) — ~700 tokens total, NEVER truncated.
   *
   * Use this when you need the compact Constitution on its own (e.g. to
   * log its size, to embed it in a non-LLM context, or to inspect which
   * rules will be injected). For routine LLM calls, just call buildContext()
   * without passing `constitution` — the ContextManager will call this
   * method automatically.
   */
  buildCompactConstitution(): string {
    return _buildCompactConstitutionFromLib();
  }

  /**
   * v70 Phase 20: Convenience accessor for the unified rules array.
   * Returns ALL_CONSTITUTION_RULES (68 rules). Useful for tests + the
   * rules-auditor to look up rules by ID without importing the
   * constitution module directly.
   */
  getAllRules(): ConstitutionRule[] {
    return [...ALL_CONSTITUTION_RULES];
  }
}

// ─── Singleton ────────────────────────────────────────────────────────

export const contextManager = new ContextManager();

/**
 * Helper: determine whether a given step should route to local Ollama
 * (Proposer/Critic/Refiner intermediate reasoning) vs. external cloud API
 * (final execution step only). Returns true if the step should use local.
 *
 * Rule: ALL intermediate debate rounds → local. Only the FINAL output that
 * will be delivered to the user / written to a file → external (Tier 4).
 */
export function shouldUseLocalModel(
  agentName: string,
  isFinalExecution: boolean,
): boolean {
  // Always-local agents (Proposer, Critic, Refiner, ContextCompressor).
  const LOCAL_AGENTS = ["Proposer", "Critic", "Refiner", "ContextCompressor"];
  if (LOCAL_AGENTS.some((a) => agentName.toLowerCase().includes(a.toLowerCase()))) {
    return true;
  }
  // Final execution step → use external (cloud) for higher quality.
  if (isFinalExecution) return false;
  // Default: local (cheaper).
  return true;
}
