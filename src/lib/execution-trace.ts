/**
 * src/lib/execution-trace.ts — v61 Phase 3 (Self-Improving Rules)
 *
 * Logs an execution trace after every task/workflow run. The trace captures:
 *   - the prompts used (system + user, truncated)
 *   - the number of retries
 *   - the token cost (approximate)
 *   - success/failure + the failure reason (if any)
 *
 * Traces are stored in the AgentLog table with meta JSON — no new Prisma model
 * needed. The rules-auditor cron (every 6h) reads traces where retries > 1
 * OR the task failed, and uses an LLM to propose a rule improvement.
 */

import "server-only";
import { db } from "./db";
import { logger } from "./logger";

export interface ExecutionTrace {
  /** The workflow run ID or task ID. */
  runId: string;
  /** The skill slug or action verb. */
  skill: string;
  /** The system prompt used (truncated to 500 chars). */
  systemPrompt: string;
  /** The user prompt used (truncated to 500 chars). */
  userPrompt: string;
  /** Number of retries (0 = first attempt succeeded). */
  retries: number;
  /** Approximate token cost (input + output). */
  tokensUsed: number;
  /** Whether the task succeeded. */
  success: boolean;
  /** The failure reason (if !success). */
  failureReason?: string;
  /** The LLM provider used (zai, groq, ollama, etc.). */
  provider?: string;
  /** The model used (glm-4.5-air, llama3.2:3b, etc.). */
  model?: string;
  /** Latency in ms. */
  latencyMs: number;
}

/**
 * Log an execution trace to the AgentLog table.
 * Called after every workflow run / task completion.
 */
export async function logExecutionTrace(trace: ExecutionTrace): Promise<void> {
  try {
    await db.agentLog.create({
      data: {
        level: trace.success ? "info" : "warn",
        message: `Trace: ${trace.skill} ${trace.success ? "succeeded" : "failed"} (${trace.retries} retries, ${trace.tokensUsed} tokens, ${trace.latencyMs}ms)${trace.failureReason ? ` — ${trace.failureReason.slice(0, 100)}` : ""}`,
        meta: JSON.stringify({
          type: "execution-trace",
          runId: trace.runId,
          skill: trace.skill,
          systemPrompt: trace.systemPrompt.slice(0, 500),
          userPrompt: trace.userPrompt.slice(0, 500),
          retries: trace.retries,
          tokensUsed: trace.tokensUsed,
          success: trace.success,
          failureReason: trace.failureReason?.slice(0, 500),
          provider: trace.provider,
          model: trace.model,
          latencyMs: trace.latencyMs,
          loggedAt: new Date().toISOString(),
        }),
      },
    });
  } catch (err) {
    logger.warn("execution-trace.log-failed", { error: String(err) });
  }
}

/**
 * Find traces where retries > 1 OR the task failed.
 * Used by the rules-auditor cron to identify improvement opportunities.
 */
export async function findProblematicTraces(sinceHours: number = 6): Promise<ExecutionTrace[]> {
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
  try {
    const logs = await db.agentLog.findMany({
      where: {
        createdAt: { gte: since },
        meta: { contains: "execution-trace" },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const traces: ExecutionTrace[] = [];
    for (const log of logs) {
      try {
        const meta = JSON.parse(log.meta ?? "{}");
        if (meta.type !== "execution-trace") continue;
        // Only include traces with retries > 1 OR failures.
        if (meta.retries > 1 || !meta.success) {
          traces.push({
            runId: meta.runId,
            skill: meta.skill,
            systemPrompt: meta.systemPrompt ?? "",
            userPrompt: meta.userPrompt ?? "",
            retries: meta.retries ?? 0,
            tokensUsed: meta.tokensUsed ?? 0,
            success: meta.success ?? false,
            failureReason: meta.failureReason,
            provider: meta.provider,
            model: meta.model,
            latencyMs: meta.latencyMs ?? 0,
          });
        }
      } catch {
        // Skip malformed meta.
      }
    }
    return traces;
  } catch (err) {
    logger.warn("execution-trace.find-failed", { error: String(err) });
    return [];
  }
}
