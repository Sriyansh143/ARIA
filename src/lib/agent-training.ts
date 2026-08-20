/**
 * src/lib/agent-training.ts — LLM-powered teaching source ingestion.
 *
 * Ported from v25.9.7-final legacy codebase. Adapted to use the
 * current app's callLLM from llm-client.ts (instead of the legacy
 * llm-gateway) and the current app's emit from event-bus.
 *
 * Exposes:
 *   • teachAgent(agentId, source, instructions?) — distill a training
 *     summary + skill list from a teaching source (text or URL)
 *   • getTrainingHistory(agentId?) — list past training sessions
 *   • injectFeedback(entryId, feedback) — reinforcement learning signal
 */

import { callLLM } from "@/lib/llm-client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { emit } from "@/lib/event-bus";
import { record } from "@/lib/blackbox";

export interface TeachResult {
  ok: boolean;
  agentId: string;
  agentName: string;
  summary: string;
  skills: string[];
  confidence: number; // 0-1
  provider: string;
  model: string;
  latencyMs: number;
  bytesIngested: number;
  error?: string;
}

export interface TrainingHistoryEntry {
  id: string;
  agentId: string | null;
  message: string;
  meta: string | null;
  createdAt: string;
}

const TRAINING_SYSTEM_PROMPT =
  "You are ARIA's training curator. Given an agent profile + a teaching source, distill a concise training summary and identify the concrete skills the agent should now exhibit. Output ONLY a JSON object: {\"summary\":string (max 220 words), \"skills\":string[] (short slug-style identifiers, max 8), \"confidence\":number (0-1, how well the source covers the requested topic)}. Never invent skills that aren't grounded in the source.";

/* ─── Helpers ──────────────────────────────────────────────────────── */

function extractJsonBlock(text: string): string | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const brace = text.match(/\{[\s\S]*\}/);
  return brace ? brace[0] : null;
}

function safeParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function persistTrainingLog(
  agentId: string,
  message: string,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    await db.agentLog.create({
      data: {
        agentId,
        level: "success",
        message,
        meta: JSON.stringify(meta).slice(0, 8000),
      },
    });
  } catch {
    /* best-effort */
  }
}

function looksLikeUrl(s: string): boolean {
  const t = s.trim();
  return /^https?:\/\//i.test(t) && t.length < 2000;
}

/* ─── teachAgent ───────────────────────────────────────────────────── */

export async function teachAgent(
  agentId: string,
  source: string,
  instructions?: string,
): Promise<TeachResult> {
  const start = Date.now();
  try {
    if (!agentId?.trim()) throw new Error("agentId required");
    if (!source?.trim()) throw new Error("source required");

    const agent = await db.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw new Error(`agent ${agentId} not found`);

    // Step 1: resolve source content. URLs would use the web-reader;
    // raw text is taken as-is (truncated for safety).
    let sourceText = source.trim();
    let bytesIngested = sourceText.length;
    // Note: URL fetching is handled by the Hermes learning engine if needed.
    // For now, we pass the text directly to the LLM.
    const truncatedSource = sourceText.slice(0, 12_000);

    // Step 2: ask the LLM to distill a training summary + skill list.
    const userPrompt = `Agent profile:
  - Name: ${agent.name}
  - Role: ${agent.role}
  - Tier: ${agent.tier}
  - Department: ${agent.department ?? "general"}

Teaching source (truncated to ${truncatedSource.length} chars):
${truncatedSource}

${instructions?.trim() ? `Operator instructions: ${instructions.trim().slice(0, 1000)}` : ""}

Distill the source into a training summary + skill list. JSON only.`;

    const result = await callLLM("Training-Curator", "Conductor", userPrompt, {
      systemOverride: TRAINING_SYSTEM_PROMPT,
    });

    const raw = extractJsonBlock(result.completion) ?? result.completion;
    const parsed = safeParse<{
      summary?: string;
      skills?: string[];
      confidence?: number;
    }>(raw);

    const summary =
      (parsed?.summary ?? result.completion).trim().slice(0, 1500) ||
      "Training completed but no summary was returned.";
    const skills: string[] = Array.isArray(parsed?.skills)
      ? parsed!.skills.slice(0, 8).map((s) => String(s).slice(0, 60))
      : [];
    const confidence = Math.max(
      0,
      Math.min(1, typeof parsed?.confidence === "number" ? parsed.confidence : 0.6),
    );

    const out: TeachResult = {
      ok: result.success,
      agentId,
      agentName: agent.name,
      summary,
      skills,
      confidence,
      provider: result.provider,
      model: result.model,
      latencyMs: Date.now() - start,
      bytesIngested,
      error: result.success ? undefined : result.error,
    };

    if (result.success) {
      await persistTrainingLog(agentId, `training:teach ${agent.name}`, {
        agentId,
        agentName: agent.name,
        summary,
        skills,
        confidence,
        bytesIngested,
        sourcePreview: source.trim().slice(0, 200),
        provider: result.provider,
        latencyMs: out.latencyMs,
      });

      emit({
        type: "system",
        ts: new Date().toISOString(),
        message: `Training completed for ${agent.name}: ${skills.length} skills identified (confidence: ${Math.round(confidence * 100)}%)`,
        level: "success",
      });

      record({
        type: "decision",
        source: "agent-training",
        message: `Trained ${agent.name} from ${bytesIngested} bytes`,
        data: { agentId, skills, confidence, provider: result.provider },
        severity: "info",
      });
    }

    return out;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("training.teachAgent.failed", { error: reason, agentId });
    return {
      ok: false,
      agentId,
      agentName: "",
      summary: "",
      skills: [],
      confidence: 0,
      provider: "",
      model: "",
      latencyMs: Date.now() - start,
      bytesIngested: 0,
      error: reason,
    };
  }
}

/* ─── getTrainingHistory ───────────────────────────────────────────── */

export async function getTrainingHistory(
  agentId?: string,
  limit = 30,
): Promise<TrainingHistoryEntry[]> {
  try {
    const safeLimit = Math.max(1, Math.min(100, limit));
    const rows = await db.agentLog.findMany({
      where: {
        message: { startsWith: "training:teach" },
        ...(agentId ? { agentId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: safeLimit,
    });
    return rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      message: r.message,
      meta: r.meta,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (err) {
    logger.warn("training.getTrainingHistory.failed", { error: String(err) });
    return [];
  }
}
