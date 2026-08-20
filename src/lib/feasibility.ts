/**
 * src/lib/feasibility.ts — Monte Carlo feasibility (P10/P50/P90 + GO/HALT/PIVOT).
 *
 * Server-only. Provides:
 *
 *   - `runMonteCarlo({ baseEstimate, variance, iterations })` — Box-Muller
 *     gaussian sampling around baseEstimate with the given variance.
 *     Returns P10/P50/P90 percentiles + a GO/HALT/PIVOT recommendation.
 *   - `scoreOpportunity(opportunityId)` — loads an EarningOpportunity,
 *     runs Monte Carlo on its estimatedRevenue, persists the result into
 *     the opportunity's `feasibilityScore`, and returns the result.
 */

import { db } from "./db";
import { logger } from "./logger";

export interface MonteCarloInput {
  baseEstimate: number;
  variance: number; // standard-deviation-like; higher = wider spread
  iterations?: number;
}

export type GoHaltPivot = "GO" | "HALT" | "PIVOT";

export interface MonteCarloResult {
  p10: number;
  p50: number;
  p90: number;
  goHaltPivot: GoHaltPivot;
  confidence: number; // 0-1, fraction of samples >= 0.5 * base
  iterations: number;
}

// ─── Box-Muller gaussian random ─────────────────────────────────────

function gaussian(mean: number, stddev: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * stddev;
}

// ─── runMonteCarlo ──────────────────────────────────────────────────

export function runMonteCarlo(input: MonteCarloInput): MonteCarloResult {
  const iterations = Math.min(Math.max(input.iterations ?? 1000, 100), 50_000);
  const base = input.baseEstimate;
  const stddev = Math.max(input.variance, 0.01);

  const samples: number[] = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    samples[i] = Math.max(0, gaussian(base, stddev));
  }
  samples.sort((a, b) => a - b);

  const pick = (p: number) => samples[Math.min(iterations - 1, Math.floor(p * iterations))];
  const p10 = pick(0.1);
  const p50 = pick(0.5);
  const p90 = pick(0.9);

  let goHaltPivot: GoHaltPivot;
  if (p50 >= 0.6 * base) {
    goHaltPivot = "GO";
  } else if (p50 < 0.3 * base) {
    goHaltPivot = "HALT";
  } else {
    goHaltPivot = "PIVOT";
  }

  // Confidence = fraction of samples above 0.5 * base estimate.
  const threshold = 0.5 * base;
  const above = samples.filter((s) => s >= threshold).length;
  const confidence = above / iterations;

  return { p10, p50, p90, goHaltPivot, confidence, iterations };
}

// ─── scoreOpportunity ───────────────────────────────────────────────

export async function scoreOpportunity(
  opportunityId: string
): Promise<MonteCarloResult & { opportunityId: string; status: string }> {
  try {
    const opp = await db.earningOpportunity.findUnique({
      where: { id: opportunityId },
    });
    if (!opp) {
      throw new Error(`opportunity not found: ${opportunityId}`);
    }

    // Variance scales with how uncertain the agent's feasibilityScore is:
    // a low score (0.1) means lots of variance; a high score (0.9) means
    // the agent is confident. We cap variance at base * 0.8 to avoid wild
    // outliers on tiny estimates.
    const confidenceInput = Math.max(0.05, Math.min(opp.feasibilityScore, 0.95));
    const variance = opp.estimatedRevenue * (1 - confidenceInput) * 0.6 + 1;
    const mc = runMonteCarlo({
      baseEstimate: opp.estimatedRevenue,
      variance,
      iterations: 1000,
    });

    // Persist the median estimate back into feasibilityScore (0-1 normalized
    // against the original estimate so it remains interpretable as a 0-1
    // confidence rating).
    const normalized = opp.estimatedRevenue > 0
      ? Math.min(1, mc.p50 / opp.estimatedRevenue)
      : mc.confidence;

    await db.earningOpportunity.update({
      where: { id: opportunityId },
      data: {
        feasibilityScore: Math.round(normalized * 100) / 100,
        status: mc.goHaltPivot === "GO" ? "qualified" : opp.status,
      },
    });

    logger.success("feasibility.opportunity.scored", {
      opportunityId,
      goHaltPivot: mc.goHaltPivot,
      p50: mc.p50,
    });

    return {
      ...mc,
      opportunityId,
      status: mc.goHaltPivot === "GO" ? "qualified" : "review",
    };
  } catch (err) {
    logger.error("feasibility.opportunity.failed", {
      opportunityId,
      error: String(err),
    });
    throw err;
  }
}
