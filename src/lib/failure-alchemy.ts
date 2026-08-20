/**
 * src/lib/failure-alchemy.ts — Antibody/Vaccine/Catalyst artifacts from errors.
 *
 * Server-only. Distills recurring error patterns into actionable
 * artifacts:
 *
 *   - antibody  : a one-off fix for a specific error signature
 *   - vaccine   : a preventive pattern that hardens against a class of errors
 *   - catalyst  : a positive transformation triggered by the failure
 *                 (e.g. "this outage prompted us to add a circuit breaker")
 *
 * `synthesizeArtifacts()` queries the most recent AgentLog error rows,
 * groups them by message signature, and uses routeLLM to generate a
 * {rootCause, remedy, sreActions[]} triple for the top signatures.
 */

import type { FailureAlchemyArtifact } from "@prisma/client";
import { db } from "./db";
import { logger } from "./logger";
import { routeLLM, type ChatMsg } from "./llm-router";

export type ArtifactType = "antibody" | "vaccine" | "catalyst";

export interface RecordFailureInput {
  signature: string;
  rootCause: string;
  error?: string;
  type?: ArtifactType;
}

// ─── recordFailure ──────────────────────────────────────────────────

export async function recordFailure(
  input: RecordFailureInput
): Promise<{ id: string }> {
  try {
    const row = await db.failureAlchemyArtifact.create({
      data: {
        type: input.type ?? "antibody",
        failureSignature: input.signature,
        rootCause: input.rootCause,
        remedy: input.error ?? "",
        sreActions: JSON.stringify([
          `investigate signature: ${input.signature}`,
          `reproduce: ${input.rootCause}`,
        ]),
      },
    });
    logger.success("failure-alchemy.recorded", {
      id: row.id,
      signature: input.signature,
    });
    return { id: row.id };
  } catch (err) {
    logger.error("failure-alchemy.record.failed", { error: String(err) });
    throw err;
  }
}

// ─── synthesizeArtifacts ────────────────────────────────────────────

interface ParsedArtifact {
  type: ArtifactType;
  rootCause: string;
  remedy: string;
  sreActions: string[];
}

function parseArtifactResponse(text: string): ParsedArtifact {
  // Expecting a JSON-ish response; tolerate markdown fences + extra prose.
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) {
    return {
      type: "antibody",
      rootCause: cleaned.slice(0, 240),
      remedy: "manual review required",
      sreActions: ["inspect agent logs"],
    };
  }
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as Partial<ParsedArtifact>;
    return {
      type: (obj.type as ArtifactType) ?? "antibody",
      rootCause: obj.rootCause ?? "unknown",
      remedy: obj.remedy ?? "manual review required",
      sreActions: Array.isArray(obj.sreActions) ? obj.sreActions.slice(0, 6) : [],
    };
  } catch {
    return {
      type: "antibody",
      rootCause: cleaned.slice(0, 240),
      remedy: "manual review required",
      sreActions: ["inspect agent logs"],
    };
  }
}

export async function synthesizeArtifacts(): Promise<{
  created: number;
  artifacts: FailureAlchemyArtifact[];
}> {
  try {
    // Pull the last 100 error logs and group by a coarse signature.
    const logs = await db.agentLog.findMany({
      where: { level: "error" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const groups = new Map<string, { count: number; sample: string }>();
    for (const log of logs) {
      // Coarse signature: first 80 chars of the message.
      const sig = log.message.slice(0, 80).trim() || "unknown-error";
      const existing = groups.get(sig);
      if (existing) {
        existing.count++;
      } else {
        groups.set(sig, { count: 1, sample: log.message });
      }
    }

    // Top 3 most-frequent error signatures.
    const top = Array.from(groups.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3);

    const created: FailureAlchemyArtifact[] = [];

    for (const [signature, info] of top) {
      try {
        const messages: ChatMsg[] = [
          {
            role: "system",
            content:
              "You are an SRE alchemist. Given a recurring error signature, " +
              "produce a JSON object with fields: " +
              "{type: \"antibody\"|\"vaccine\"|\"catalyst\", " +
              "rootCause: string, remedy: string, sreActions: string[]}. " +
              "Use \"antibody\" for one-off fixes, \"vaccine\" for preventive " +
              "patterns, \"catalyst\" if the failure enables a positive transformation. " +
              "Respond with ONLY the JSON object.",
          },
          {
            role: "user",
            content:
              `Error signature: ${signature}\n` +
              `Occurrences (last 100 errors): ${info.count}\n` +
              `Sample message: ${info.sample.slice(0, 400)}`,
          },
        ];

        const result = await routeLLM(messages, { complexity: "medium" });
        const parsed = result.success && result.completion
          ? parseArtifactResponse(result.completion)
          : {
              type: "antibody" as ArtifactType,
              rootCause: info.sample.slice(0, 240),
              remedy: "manual review required",
              sreActions: ["inspect agent logs"],
            };

        // AUDIT-B-8: dedupe by (failureSignature, type) — previously each run
        // created a NEW row per signature, so the table accumulated duplicates.
        // We delete prior rows for the same signature before inserting the latest
        // synthesis (the historical count is preserved in the `rootCause`/`remedy`).
        try { await db.failureAlchemyArtifact.deleteMany({ where: { failureSignature: signature } }); } catch (e) { logger.warn("failure-alchemy.dedupe-failed",{signature,error:String(e)}); }
        const row = await db.failureAlchemyArtifact.create({
          data: {
            type: parsed.type,
            failureSignature: signature,
            rootCause: parsed.rootCause,
            remedy: parsed.remedy,
            sreActions: JSON.stringify(parsed.sreActions),
          },
        });
        created.push(row);
      } catch (err) {
        logger.error("failure-alchemy.synthesize.one.failed", {
          signature,
          error: String(err),
        });
      }
    }

    logger.success("failure-alchemy.synthesized", {
      created: created.length,
      considered: top.length,
    });
    return { created: created.length, artifacts: created };
  } catch (err) {
    logger.error("failure-alchemy.synthesize.failed", { error: String(err) });
    return { created: 0, artifacts: [] };
  }
}

// ─── listArtifacts ──────────────────────────────────────────────────

export async function listArtifacts(type?: string): Promise<FailureAlchemyArtifact[]> {
  try {
    return await db.failureAlchemyArtifact.findMany({
      where: type ? { type } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  } catch (err) {
    logger.error("failure-alchemy.list.failed", { error: String(err) });
    return [];
  }
}
