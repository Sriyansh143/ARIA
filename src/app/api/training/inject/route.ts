/**
 * POST /api/training/inject — Inject human feedback into the Hermes engine.
 *
 * Body: {
 *   entryId: string,         // blackbox entry ID
 *   agentId?: string,        // target agent (optional — defaults to entry's agent)
 *   feedback: "positive" | "negative",
 *   note: string,            // human feedback text
 *   createSkill?: boolean,   // if true + positive, synthesize a Skill via createSkillFromExecution
 * }
 *
 * This route:
 *   1. Looks up the blackbox entry.
 *   2. Stores the feedback as a MemoryItem (scope="agent" or "knowledge").
 *   3. If positive + createSkill, calls createSkillFromExecution to synthesize a reusable Skill.
 *   4. Records the injection in the blackbox for audit.
 *   5. Returns the created memory + skill IDs.
 *
 * This is the "Inject Training" button in the Blackbox Training tab.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth";
import { injectFeedback, getById } from "@/lib/blackbox";
import { storeMemory } from "@/lib/hermes/memory";
import { emit } from "@/lib/event-bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const InjectSchema = z.object({
  entryId: z.string().min(1),
  agentId: z.string().optional(),
  feedback: z.enum(["positive", "negative"]),
  note: z.string().min(1).max(2000),
  createSkill: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  try {
    // v47 fix 3: Require auth — mutates blackbox + may synthesize skills (LLM cost).
    await requireAuth();

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }

    const parsed = InjectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation failed", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const { entryId, agentId, feedback, note, createSkill } = parsed.data;

    // 1. Look up the blackbox entry.
    const entry = getById(entryId);
    if (!entry) {
      return NextResponse.json({ error: "blackbox entry not found" }, { status: 404 });
    }

    // Determine the target agent.
    const targetAgentId = agentId || (entry.data?.agentId as string) || null;

    // 2. Store the feedback as a MemoryItem.
    const memoryKey = `training-feedback-${entryId}`;
    const memoryValue = JSON.stringify({
      entryId,
      entryType: entry.type,
      entrySource: entry.source,
      entryMessage: entry.message,
      feedback,
      note,
      injectedAt: new Date().toISOString(),
    });

    await storeMemory(
      memoryKey,
      memoryValue,
      "agent", // scope
      targetAgentId || undefined,
      ["training", "feedback", feedback, entry.type],
    );

    // 3. If positive + createSkill, synthesize a Skill via the Hermes engine.
    let skillCreated = false;
    if (createSkill && feedback === "positive") {
      try {
        const { createSkillFromExecution } = await import("@/lib/hermes/skills");
        const steps = [
          {
            order: 1,
            action: entry.message,
            result: note,
            success: true,
          },
        ];
        const skill = await createSkillFromExecution(
          steps as any,
          "Operator-Feedback",
          `Training injection from blackbox entry ${entryId}`,
        );
        skillCreated = !!skill;
        if (skill) {
          logger.info("api.training.inject.skill-created", { entryId, skillId: skill.id });
        }
      } catch (err) {
        logger.warn("api.training.inject.skill-failed", { entryId, error: String(err) });
      }
    }

    // 4. Record the injection in the blackbox for audit.
    injectFeedback(entryId, feedback, note);

    // 5. Emit an SSE event so the dashboard updates live.
    emit({
      type: "system",
      ts: new Date().toISOString(),
      message: `Training injected for ${entry.source}: ${feedback}`,
      level: feedback === "positive" ? "success" : "warn",
    });

    // 6. Log to AgentLog if we have a target agent.
    if (targetAgentId) {
      try {
        await db.agentLog.create({
          data: {
            agentId: targetAgentId,
            level: feedback === "positive" ? "info" : "warn",
            message: `Training feedback injected: ${note.slice(0, 200)}`,
            meta: JSON.stringify({ entryId, feedback, skillCreated }),
          },
        });
      } catch (err) {
        logger.warn("api.training.inject.agentlog-failed", { error: String(err) });
      }
    }

    logger.info("api.training.inject.complete", {
      entryId,
      agentId: targetAgentId,
      feedback,
      skillCreated,
    });

    return NextResponse.json({
      ok: true,
      entryId,
      agentId: targetAgentId,
      feedback,
      skillCreated,
      memoryKey,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error("api.training.inject.failed", { error: msg });
    return NextResponse.json({ error: "failed to inject training" }, { status: 500 });
  }
}
