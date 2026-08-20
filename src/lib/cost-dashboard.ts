/**
 * src/lib/cost-dashboard.ts — LLM cost breakdown + budget enforcement.
 *
 * Server-only module that aggregates the last 30 days of `LlmCall` rows
 * by provider, model, and day, then multiplies token counts by a
 * published per-1M-token pricing table to estimate spend. A daily
 * budget (env: `LLM_DAILY_BUDGET_USD`, default $10) is enforced — when
 * today's spend exceeds the budget, the breakdown flags
 * `budgetAlert: "over_budget"` so the UI can show a rose banner.
 *
 * Pricing (USD per 1M tokens):
 *   - zai:     in 0.50 / out 1.50   (glm-4.6 / glm-4.5 family)
 *   - groq:    in 0.05 / out 0.08   (free tier — essentially $0)
 *   - nvidia:  in 0.15 / out 0.30   (NIM free tier = $0 in practice)
 *   - ollama:  in 0.00 / out 0.00   (self-hosted, free)
 *
 * Honest about its limits: like `agent-costs.ts`, this is tokens × list
 * price, not a billed invoice. Use it for forecasting + alerting, not
 * accounting.
 *
 * Task ID: FEATURES-STREAM-GOALS-COST (Task 3).
 */
import "server-only";

import { db } from "./db";
import { logger } from "./logger";

// ─── Types ───────────────────────────────────────────────────────────

export type ProviderKey = "zai" | "groq" | "nvidia" | "ollama";

export interface ProviderPricing {
  in: number;
  out: number;
}

export interface ProviderBreakdown {
  provider: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  pctOfTotal: number;
}

export interface ModelBreakdown {
  model: string;
  provider: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  cost: number;
  calls: number;
}

export interface CostBreakdown {
  totals: {
    total30d: number;
    today: number;
    avgDaily: number;
    totalCalls: number;
    tokensIn: number;
    tokensOut: number;
  };
  budget: {
    dailyBudgetUsd: number;
    utilizationPct: number;
    alert: "ok" | "over_budget";
    remainingUsd: number;
  };
  byProvider: ProviderBreakdown[];
  byModel: ModelBreakdown[];
  daily: DailyPoint[];
  generatedAt: string;
}

// ─── Pricing table (USD per 1M tokens) ──────────────────────────────

const PROVIDER_PRICING: Record<ProviderKey, ProviderPricing> = {
  zai: { in: 0.5, out: 1.5 },
  groq: { in: 0.05, out: 0.08 },
  nvidia: { in: 0.15, out: 0.3 },
  ollama: { in: 0, out: 0 },
};

/**
 * Resolve pricing for an arbitrary provider string. Unknown providers
 * (e.g. openai/anthropic which the simulator rarely emits) fall back to
 * the zai rate so a typo never zeroes out a real cost. Local providers
 * (ollama + anything containing "ollama" or "local") are free.
 */
function pricingFor(provider: string): ProviderPricing {
  const key = provider.toLowerCase();
  if (key.includes("ollama") || key.includes("local")) {
    return PROVIDER_PRICING.ollama;
  }
  if (key in PROVIDER_PRICING) {
    return PROVIDER_PRICING[key as ProviderKey];
  }
  // Unknown provider — fall back to zai's rate (ARIA's default).
  return PROVIDER_PRICING.zai;
}

/** Estimated USD for a single call's tokens. */
function callCost(
  tokensIn: number,
  tokensOut: number,
  provider: string,
): number {
  const p = pricingFor(provider);
  const ti = Number.isFinite(tokensIn) && tokensIn > 0 ? tokensIn : 0;
  const to = Number.isFinite(tokensOut) && tokensOut > 0 ? tokensOut : 0;
  return (ti / 1_000_000) * p.in + (to / 1_000_000) * p.out;
}

// ─── Date helpers ───────────────────────────────────────────────────

const DAY_MS = 86_400_000;

function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Build the list of the last N days (oldest first), each as
 * { date: "YYYY-MM-DD" }. Used to seed the daily series so days with
 * no calls still appear (cost: 0, calls: 0).
 */
function lastNDays(n: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(utcDateKey(new Date(now.getTime() - i * DAY_MS)));
  }
  return out;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Aggregate the last 30 days of `LlmCall` rows into a cost breakdown
 * suitable for the dashboard. Never throws — on any error, returns a
 * zero-filled breakdown so the UI shows an empty state rather than
 * crashing.
 */
export async function getCostBreakdown(): Promise<CostBreakdown> {
  try {
    const now = new Date();
    const todayKey = utcDateKey(now);
    const since = new Date(now.getTime() - 30 * DAY_MS);

    const calls = await db.llmCall.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 10_000,
    });

    // ── Per-provider aggregation ──────────────────────────────────
    const providerMap = new Map<
      string,
      { calls: number; tokensIn: number; tokensOut: number; cost: number }
    >();
    // ── Per-model aggregation ─────────────────────────────────────
    const modelMap = new Map<
      string,
      {
        model: string;
        provider: string;
        calls: number;
        tokensIn: number;
        tokensOut: number;
        cost: number;
      }
    >();
    // ── Daily series ──────────────────────────────────────────────
    const dailyMap = new Map<string, { cost: number; calls: number }>();
    for (const day of lastNDays(30, now)) {
      dailyMap.set(day, { cost: 0, calls: 0 });
    }

    let totalCost = 0;
    let totalCalls = 0;
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let todayCost = 0;

    for (const c of calls) {
      const cost = callCost(c.tokensIn, c.tokensOut, c.provider);
      totalCost += cost;
      totalCalls += 1;
      totalTokensIn += c.tokensIn;
      totalTokensOut += c.tokensOut;

      // Provider bucket
      const p = providerMap.get(c.provider) ?? {
        calls: 0,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
      };
      p.calls += 1;
      p.tokensIn += c.tokensIn;
      p.tokensOut += c.tokensOut;
      p.cost += cost;
      providerMap.set(c.provider, p);

      // Model bucket
      const modelKey = `${c.provider}/${c.model}`;
      const m = modelMap.get(modelKey) ?? {
        model: c.model,
        provider: c.provider,
        calls: 0,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
      };
      m.calls += 1;
      m.tokensIn += c.tokensIn;
      m.tokensOut += c.tokensOut;
      m.cost += cost;
      modelMap.set(modelKey, m);

      // Daily bucket
      const dayKey = utcDateKey(c.createdAt);
      const d = dailyMap.get(dayKey);
      if (d) {
        d.cost += cost;
        d.calls += 1;
      }

      // Today bucket
      if (dayKey === todayKey) {
        todayCost += cost;
      }
    }

    // ── Build response arrays (sorted) ─────────────────────────────
    const byProvider: ProviderBreakdown[] = Array.from(providerMap.entries())
      .map(([provider, v]) => ({
        provider,
        calls: v.calls,
        tokensIn: v.tokensIn,
        tokensOut: v.tokensOut,
        costUsd: parseFloat(v.cost.toFixed(4)),
        pctOfTotal:
          totalCost > 0
            ? parseFloat(((v.cost / totalCost) * 100).toFixed(1))
            : 0,
      }))
      .sort((a, b) => b.costUsd - a.costUsd);

    const byModel: ModelBreakdown[] = Array.from(modelMap.values())
      .map((m) => ({
        ...m,
        costUsd: parseFloat(m.cost.toFixed(4)),
      }))
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, 10);

    const daily: DailyPoint[] = Array.from(dailyMap.entries()).map(
      ([date, v]) => ({
        date,
        cost: parseFloat(v.cost.toFixed(4)),
        calls: v.calls,
      }),
    );

    const avgDaily = totalCost / 30;

    // ── Budget enforcement ─────────────────────────────────────────
    const dailyBudgetUsd = parseFloat(
      process.env.LLM_DAILY_BUDGET_USD ?? "10",
    );
    const budgetNum = Number.isFinite(dailyBudgetUsd) ? dailyBudgetUsd : 10;
    const utilizationPct =
      budgetNum > 0
        ? Math.round((todayCost / budgetNum) * 1000) / 10
        : 0;
    const alert: "ok" | "over_budget" =
      budgetNum > 0 && todayCost > budgetNum ? "over_budget" : "ok";
    const remainingUsd = parseFloat(
      Math.max(0, budgetNum - todayCost).toFixed(4),
    );

    return {
      totals: {
        total30d: parseFloat(totalCost.toFixed(4)),
        today: parseFloat(todayCost.toFixed(4)),
        avgDaily: parseFloat(avgDaily.toFixed(4)),
        totalCalls,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
      },
      budget: {
        dailyBudgetUsd: budgetNum,
        utilizationPct,
        alert,
        remainingUsd,
      },
      byProvider,
      byModel,
      daily,
      generatedAt: now.toISOString(),
    };
  } catch (err) {
    logger.error("cost-dashboard.get.error", { error: String(err) });
    // Empty-state fallback — UI shows the "no LLM calls" empty state.
    const now = new Date();
    return {
      totals: {
        total30d: 0,
        today: 0,
        avgDaily: 0,
        totalCalls: 0,
        tokensIn: 0,
        tokensOut: 0,
      },
      budget: {
        dailyBudgetUsd: parseFloat(process.env.LLM_DAILY_BUDGET_USD ?? "10"),
        utilizationPct: 0,
        alert: "ok",
        remainingUsd: parseFloat(process.env.LLM_DAILY_BUDGET_USD ?? "10"),
      },
      byProvider: [],
      byModel: [],
      daily: lastNDays(30, now).map((date) => ({ date, cost: 0, calls: 0 })),
      generatedAt: now.toISOString(),
    };
  }
}
