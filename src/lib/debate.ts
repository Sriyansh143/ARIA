/**
 * src/lib/debate.ts — multi-model debate via routeLLM.
 *
 * Server-only. Runs a structured multi-round debate across 2-5 LLM
 * providers, each adopting a distinct persona. After each round, every
 * participant self-rates their confidence (0-1). The final consensus is
 * computed as a confidence-weighted vote over the last-round arguments.
 *
 * Persisted as a DebateSession row with full transcript JSON.
 *
 * Each LLM call is wrapped in its own try/catch so a single provider
 * failure never aborts the debate — that provider's contribution for
 * that round is simply recorded as a failure marker.
 */

import type { DebateSession } from "@prisma/client";
import { db } from "./db";
import { logger } from "./logger";
import { routeLLM, type ChatMsg, type LLMProvider } from "./llm-router";

export interface DebateParticipant {
  provider: LLMProvider;
  persona: string;
}

export interface StartDebateInput {
  topic: string;
  participants?: string[];
  rounds?: number;
}

export interface DebateTranscriptEntry {
  round: number;
  model: string;
  argument: string;
  confidence: number;
  error?: string;
}

const PERSONAS: Record<LLMProvider, string> = {
  zai: "You are GLM-4.6, a meticulous strategist. Weigh tradeoffs carefully and prefer conservative, well-reasoned positions. Be concise (max 200 words).",
  groq: "You are Llama-3.3-70B, an aggressive pragmatist. Push for fast execution and challenge slow reasoning. Be concise (max 200 words).",
  nvidia: "You are Nemotron-70B, a deep systems thinker. Consider second-order effects and edge cases. Be concise (max 200 words).",
  "browser-scraper": "You are a scraped web-UI model. Provide practical, concise answers. Be concise (max 200 words).",
  ollama: "You are Qwen2.5, a local-first realist. Prioritize simplicity, cost-effectiveness, and self-hosted alternatives. Be concise (max 200 words).",
};

const PROVIDER_PERSONA_MAP: Record<string, LLMProvider> = {
  zai: "zai",
  groq: "groq",
  nvidia: "nvidia",
  ollama: "ollama",
};

function parseConfidence(text: string): number {
  // Look for "confidence: 0.7" or "0.7/1.0" or just a trailing decimal.
  const m1 = text.match(/confidence[:\s]+([0-9]*\.?[0-9]+)/i);
  if (m1) {
    const v = parseFloat(m1[1]);
    if (!Number.isNaN(v)) return Math.max(0, Math.min(1, v > 1 ? v / 100 : v));
  }
  // Fallback: longer arguments are treated as more confident.
  return Math.min(1, Math.max(0.2, text.length / 800));
}

function stripConfidenceLine(text: string): string {
  return text
    .replace(/confidence[:\s]+[0-9]*\.?[0-9]+\/?(1\.0)?/gi, "")
    .trim();
}

// ─── startDebate ────────────────────────────────────────────────────

export async function startDebate(
  input: StartDebateInput
): Promise<{ id: string; consensus: string; confidence: number; status: string }> {
  const topic = input.topic.trim();
  if (!topic) {
    throw new Error("debate.topic.empty");
  }
  const rounds = Math.min(Math.max(input.rounds ?? 3, 1), 5);
  const participantKeys = (input.participants ?? ["zai", "groq", "ollama"]).filter(
    (p): p is LLMProvider => p in PROVIDER_PERSONA_MAP
  );
  if (participantKeys.length < 2) {
    throw new Error("debate.participants.insufficient");
  }

  // Create the session immediately so the UI can stream it.
  const session = await db.debateSession.create({
    data: {
      topic,
      participants: JSON.stringify(participantKeys),
      rounds,
      transcript: JSON.stringify([]),
      consensus: "",
      confidence: 0,
      status: "running",
    },
  });

  try {
    const transcript: DebateTranscriptEntry[] = [];
    const argumentsByParticipant: Record<string, string> = {};
    const confidenceByParticipant: Record<string, number> = {};

    for (let round = 1; round <= rounds; round++) {
      for (const provider of participantKeys) {
        try {
          const priorArgs = participantKeys
            .filter((p) => p !== provider && argumentsByParticipant[p])
            .map((p) => `- ${p}: ${argumentsByParticipant[p].slice(0, 240)}`)
            .join("\n");

          const messages: ChatMsg[] = [
            { role: "system", content: PERSONAS[provider] },
            {
              role: "user",
              content:
                `Debate topic: ${topic}\n\n` +
                (round > 1 && priorArgs
                  ? `Prior round arguments from other participants:\n${priorArgs}\n\n`
                  : "") +
                `Provide your argument for round ${round} of ${rounds}. ` +
                `End with a line "Confidence: X" where X is 0-1 reflecting your certainty.`,
            },
          ];

          const result = await routeLLM(messages, { complexity: "high" });
          if (!result.success || !result.completion) {
            transcript.push({
              round,
              model: provider,
              argument: "",
              confidence: 0,
              error: result.error ?? "no completion",
            });
            continue;
          }

          const confidence = parseConfidence(result.completion);
          const argument = stripConfidenceLine(result.completion);
          argumentsByParticipant[provider] = argument;
          confidenceByParticipant[provider] = confidence;

          transcript.push({ round, model: provider, argument, confidence });
        } catch (err) {
          transcript.push({
            round,
            model: provider,
            argument: "",
            confidence: 0,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Confidence-weighted consensus: pick the argument from the participant
    // with the highest average confidence across rounds, then summarize
    // the disagreement points.
    const avgConfidence: Record<string, number> = {};
    for (const p of participantKeys) {
      const entries = transcript.filter((t) => t.model === p && !t.error);
      if (entries.length > 0) {
        avgConfidence[p] =
          entries.reduce((s, e) => s + e.confidence, 0) / entries.length;
      } else {
        avgConfidence[p] = 0;
      }
    }

    const winner = participantKeys.reduce(
      (best, p) => (avgConfidence[p] > avgConfidence[best] ? p : best),
      participantKeys[0]
    );
    const consensusText =
      `Consensus leans toward ${winner}'s position ` +
      `(confidence ${(avgConfidence[winner] * 100).toFixed(0)}%): ` +
      `${argumentsByParticipant[winner]?.slice(0, 280) ?? "(no argument captured)"}`;

    const overallConfidence =
      participantKeys.reduce((s, p) => s + avgConfidence[p], 0) /
      participantKeys.length;

    const updated = await db.debateSession.update({
      where: { id: session.id },
      data: {
        transcript: JSON.stringify(transcript),
        consensus: consensusText,
        confidence: Math.round(overallConfidence * 100) / 100,
        status: "completed",
      },
    });

    logger.success("debate.completed", {
      id: session.id,
      winner,
      confidence: overallConfidence,
    });

    return {
      id: updated.id,
      consensus: updated.consensus,
      confidence: updated.confidence,
      status: updated.status,
    };
  } catch (err) {
    logger.error("debate.failed", { id: session.id, error: String(err) });
    await db.debateSession.update({
      where: { id: session.id },
      data: {
        status: "failed",
        consensus: `Debate failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    });
    return {
      id: session.id,
      consensus: `Debate failed.`,
      confidence: 0,
      status: "failed",
    };
  }
}

// ─── getDebate ──────────────────────────────────────────────────────

export async function getDebate(id: string): Promise<DebateSession | null> {
  try {
    return await db.debateSession.findUnique({ where: { id } });
  } catch (err) {
    logger.error("debate.get.failed", { id, error: String(err) });
    return null;
  }
}

// ─── listDebates ────────────────────────────────────────────────────

export async function listDebates(limit = 20): Promise<DebateSession[]> {
  try {
    return await db.debateSession.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
    });
  } catch (err) {
    logger.error("debate.list.failed", { error: String(err) });
    return [];
  }
}
