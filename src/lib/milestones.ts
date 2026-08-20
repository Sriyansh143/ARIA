/**
 * src/lib/milestones.ts — milestone event log.
 *
 * Server-only. Records significant fleet-level events (first revenue,
 * agent online, deal closed, etc.) as MilestoneEvent rows + emits an
 * SSE `system` event so the dashboard can trigger its celebration
 * overlay.
 *
 * 14 milestone types cover the headline capabilities ported from v25:
 * each new capability can fire its own milestone when it crosses a
 * threshold for the first time.
 */

import type { MilestoneEvent } from "@prisma/client";
import { db } from "./db";
import { logger } from "./logger";
import { emit } from "./event-bus";

export const MILESTONE_TYPES = [
  "first-revenue",
  "agent-online",
  "deal-closed",
  "milestone-100-tasks",
  "simulation-complete",
  "approval-granted",
  "skill-learned",
  "debate-consensus",
  "feasibility-go",
  "failure-alchemy",
  "cash-claw-thrive",
  "kpi-snapshot",
  "revenue-cycle",
  "system-nominal",
] as const;

export type MilestoneType = (typeof MILESTONE_TYPES)[number];

export interface RecordMilestoneInput {
  type: string;
  title: string;
  description?: string;
  intensity?: "subtle" | "normal" | "epic";
}

// ─── recordMilestone ────────────────────────────────────────────────

export async function recordMilestone(
  input: RecordMilestoneInput
): Promise<{ id: string }> {
  try {
    const row = await db.milestoneEvent.create({
      data: {
        type: input.type,
        title: input.title,
        description: input.description ?? "",
        intensity: input.intensity ?? "normal",
      },
    });

    emit({
      type: "system",
      ts: new Date().toISOString(),
      message: `milestone:${input.type} — ${input.title}`,
      level: "success",
    });

    logger.success("milestone.recorded", { id: row.id, type: input.type });
    return { id: row.id };
  } catch (err) {
    logger.error("milestone.record.failed", { error: String(err) });
    throw err;
  }
}

// ─── listMilestones ─────────────────────────────────────────────────

export async function listMilestones(viewed?: boolean): Promise<MilestoneEvent[]> {
  try {
    return await db.milestoneEvent.findMany({
      where: viewed !== undefined ? { viewed } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  } catch (err) {
    logger.error("milestone.list.failed", { error: String(err) });
    return [];
  }
}

// ─── markViewed ─────────────────────────────────────────────────────

export async function markViewed(id: string): Promise<{ ok: boolean }> {
  try {
    await db.milestoneEvent.update({ where: { id }, data: { viewed: true } });
    return { ok: true };
  } catch (err) {
    logger.error("milestone.markViewed.failed", { id, error: String(err) });
    return { ok: false };
  }
}
