/**
 * src/lib/cash-claw.ts — evolutionary agent survival scoring.
 *
 * Classifies each Agent into one of four survival tiers based on a
 * weighted score:
 *
 *   score = tasksDone*2 - errorCount*3 - tokensUsed/10000
 *
 *   thriving  ≥ 20
 *   surviving ≥ 5
 *   dying     ≥ 0
 *   dead      < 0
 *
 * A `runCashClawSweep()` will classify every agent in the fleet, persist
 * a SystemAlert (warn for dying, critical for dead) for each at-risk
 * agent, and return a list of agents recommended for retirement.
 */

import type { Agent } from "@prisma/client";
import { db } from "./db";
import { logger } from "./logger";
import { emit } from "./event-bus";
import { toIso } from "./types";

export type SurvivalTier = "thriving" | "surviving" | "dying" | "dead";

export interface SurvivalClassification {
  tier: SurvivalTier;
  score: number;
  reason: string;
}

export interface SurvivalBoardEntry extends SurvivalClassification {
  agent: Agent;
}

// ─── classifyAgent ──────────────────────────────────────────────────

export function classifyAgent(agent: Agent): SurvivalClassification {
  const score = Math.round(
    agent.tasksDone * 2 - agent.errorCount * 3 - agent.tokensUsed / 10000
  );

  let tier: SurvivalTier;
  let reason: string;

  if (score >= 20) {
    tier = "thriving";
    reason = `High productivity (${agent.tasksDone} tasks) with low error rate (${agent.errorCount} errors).`;
  } else if (score >= 5) {
    tier = "surviving";
    reason = `Steady output (${agent.tasksDone} tasks) — within healthy operating range.`;
  } else if (score >= 0) {
    tier = "dying";
    reason = `Marginal score: ${agent.tasksDone} tasks vs ${agent.errorCount} errors; review prompt + toolset.`;
  } else {
    tier = "dead";
    reason = `Net-negative contribution: ${agent.errorCount} errors outweigh ${agent.tasksDone} tasks (${agent.tokensUsed.toLocaleString()} tokens burned).`;
  }

  return { tier, score, reason };
}

// ─── runCashClawSweep ───────────────────────────────────────────────

export async function runCashClawSweep(): Promise<{
  classified: Agent[];
  dying: number;
  dead: number;
  recommendedRetire: string[];
}> {
  try {
    const agents = await db.agent.findMany();
    let dying = 0;
    let dead = 0;
    const recommendedRetire: string[] = [];

    for (const agent of agents) {
      const cls = classifyAgent(agent);

      if (cls.tier === "dying") {
        dying++;
        const alert = await db.systemAlert.create({
          data: {
            severity: "warn",
            source: "cash-claw",
            message: `Agent ${agent.name} is dying (score=${cls.score}): ${cls.reason}`,
          },
        });
        emit({
          type: "alert",
          ts: new Date().toISOString(),
          alert: {
            id: alert.id,
            severity: alert.severity as "warn",
            source: alert.source,
            message: alert.message,
            ack: false,
            createdAt: toIso(alert.createdAt)!,
          },
        });
      } else if (cls.tier === "dead") {
        dead++;
        recommendedRetire.push(agent.name);
        const alert = await db.systemAlert.create({
          data: {
            severity: "critical",
            source: "cash-claw",
            message: `Agent ${agent.name} is DEAD (score=${cls.score}): ${cls.reason} — recommend retirement.`,
          },
        });
        emit({
          type: "alert",
          ts: new Date().toISOString(),
          alert: {
            id: alert.id,
            severity: alert.severity as "critical",
            source: alert.source,
            message: alert.message,
            ack: false,
            createdAt: toIso(alert.createdAt)!,
          },
        });
      }
    }

    logger.success("cash-claw.sweep.complete", {
      total: agents.length,
      dying,
      dead,
    });

    return {
      classified: agents,
      dying,
      dead,
      recommendedRetire,
    };
  } catch (err) {
    logger.error("cash-claw.sweep.failed", { error: String(err) });
    return { classified: [], dying: 0, dead: 0, recommendedRetire: [] };
  }
}

// ─── getSurvivalBoard ───────────────────────────────────────────────

export async function getSurvivalBoard(): Promise<SurvivalBoardEntry[]> {
  try {
    const agents = await db.agent.findMany({
      orderBy: { tasksDone: "desc" },
    });
    return agents.map((agent) => ({ agent, ...classifyAgent(agent) }));
  } catch (err) {
    logger.error("cash-claw.board.failed", { error: String(err) });
    return [];
  }
}
