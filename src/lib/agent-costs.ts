/**
 * ARIA Mission Control — Per-agent cost rollup + spend projection.
 *
 * Ported from FounderOS-DEMO/lib/agent-costs.ts, adapted for ARIA's LlmCall
 * model. The original rolled up `AgentRun` rows; ARIA tracks LLM usage as
 * `LlmCall` rows (provider, model, tokensIn, tokensOut, latencyMs, agentId).
 *
 * "Estimated" is the honest word throughout: this is tokens × published list
 * price, not a billed invoice. Real bills vary by tier, region, discount,
 * prompt-caching, and batched-vs-live traffic — none of which we can see.
 * The number is for forecasting + alerting, not accounting.
 *
 * Pure + deterministic: every function takes its inputs as arguments and
 * returns a plain value. No IO, no globals, no Zod. The API route / UI layer
 * feeds it LlmCall rows from the DB; this module doesn't know Prisma exists.
 *
 * Pricing table covers ARIA's full model roster:
 *   - GLM (ZAI):  glm-4.6, glm-4.5, glm-4.5-air (the simulation's defaults)
 *   - OpenAI:     gpt-4o, gpt-4o-mini, gpt-4-turbo
 *   - Anthropic:  claude-3.5-sonnet, claude-3.5-haiku, claude-3-opus
 *   - NVIDIA:     nemotron, llama-3.1-nemotron (NVIDIA NIM free tier = $0)
 *   - Ollama:     all local models = $0 (you paid in hardware + electricity)
 *   - Gemini:     gemini-1.5-pro, gemini-1.5-flash
 *   - DeepSeek:   deepseek-chat, deepseek-coder
 *   - Groq:       groq-llama variants (free tier = $0)
 *
 * Unknown models fall back to glm-4.5-air pricing (ARIA's default) so a
 * typo never zeroes out a real cost.
 */
import type { LlmCall } from "@/lib/types";

// ─── Pricing table (USD per 1,000,000 tokens) ────────────────────────
export type ModelPricing = { inputPerM: number; outputPerM: number };

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // ── GLM (ZAI) — ARIA's default provider ─────────────────────────────
  "glm-4.6":       { inputPerM: 2.5,  outputPerM: 10 },
  "glm-4.5":       { inputPerM: 2.0,  outputPerM: 8  },
  "glm-4.5-air":   { inputPerM: 0.5,  outputPerM: 2  },
  "glm-4-air":     { inputPerM: 0.5,  outputPerM: 2  },

  // ── OpenAI ──────────────────────────────────────────────────────────
  "gpt-4o":        { inputPerM: 2.5,  outputPerM: 10 },
  "gpt-4o-mini":   { inputPerM: 0.15, outputPerM: 0.6 },
  "gpt-4-turbo":   { inputPerM: 10,   outputPerM: 30 },

  // ── Anthropic ───────────────────────────────────────────────────────
  "claude-3.5-sonnet": { inputPerM: 3,  outputPerM: 15 },
  "claude-3-5-sonnet": { inputPerM: 3,  outputPerM: 15 },
  "claude-3.5-haiku":  { inputPerM: 0.8, outputPerM: 4 },
  "claude-3-opus":     { inputPerM: 15, outputPerM: 75 },

  // ── NVIDIA NIM (free tier = $0; paid tier uses these) ────────────────
  "nemotron-70b":          { inputPerM: 0, outputPerM: 0 },
  "llama-3.1-nemotron-70b": { inputPerM: 0, outputPerM: 0 },

  // ── Ollama (local; you pay in hardware, not tokens) ──────────────────
  "ollama":               { inputPerM: 0, outputPerM: 0 },
  "llama3":               { inputPerM: 0, outputPerM: 0 },
  "llama3.1":             { inputPerM: 0, outputPerM: 0 },
  "mistral":              { inputPerM: 0, outputPerM: 0 },
  "qwen2.5":              { inputPerM: 0, outputPerM: 0 },

  // ── Gemini ──────────────────────────────────────────────────────────
  "gemini-1.5-pro":   { inputPerM: 1.25, outputPerM: 5 },
  "gemini-1.5-flash": { inputPerM: 0.075, outputPerM: 0.3 },
  "gemini-pro":       { inputPerM: 0.5,  outputPerM: 1.5 },

  // ── DeepSeek ────────────────────────────────────────────────────────
  "deepseek-chat":  { inputPerM: 0.14, outputPerM: 0.28 },
  "deepseek-coder": { inputPerM: 0.14, outputPerM: 0.28 },

  // ── Groq (free tier = $0) ────────────────────────────────────────────
  "groq-llama-3.1-70b": { inputPerM: 0, outputPerM: 0 },
  "groq-llama-3.1-8b":  { inputPerM: 0, outputPerM: 0 },
};

/** Fallback when a model isn't in the table — glm-4.5-air is ARIA's default. */
export const DEFAULT_PRICING: ModelPricing = MODEL_PRICING["glm-4.5-air"];

/**
 * Resolve pricing for a model name. Strips common provider prefixes
 * (`anthropic/`, `openai/`, `zai/`) and lowercases for a case-insensitive
 * lookup. Unknown or null models fall back to DEFAULT_PRICING — never throws.
 */
export function pricingFor(model: string | null | undefined): ModelPricing {
  if (!model) return DEFAULT_PRICING;
  const bare = model.replace(/^(anthropic|openai|zai|nvidia|ollama|groq|deepseek|gemini)\//i, "").toLowerCase();
  return MODEL_PRICING[bare] ?? MODEL_PRICING[model.toLowerCase()] ?? DEFAULT_PRICING;
}

/** Estimated USD for a single call's token usage at list price. */
export function runCostUsd(
  tokensIn: number,
  tokensOut: number,
  model?: string | null,
): number {
  const p = pricingFor(model);
  const ti = Number.isFinite(tokensIn) && tokensIn > 0 ? tokensIn : 0;
  const to = Number.isFinite(tokensOut) && tokensOut > 0 ? tokensOut : 0;
  return (ti / 1_000_000) * p.inputPerM + (to / 1_000_000) * p.outputPerM;
}

/** A single LlmCall's cost — derived from tokens + model. Never negative. */
export function costOf(call: Pick<LlmCall, "tokensIn" | "tokensOut" | "model">): number {
  return runCostUsd(call.tokensIn, call.tokensOut, call.model);
}

// ─── Per-agent rollup ────────────────────────────────────────────────
export type AgentCostRow = {
  agentId: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** Average USD per call — useful for spot-anomaly ("why is Conductor 10x?"). */
  avgCostPerCall: number;
  lastCallAt: string | null;
};

/**
 * Per-agent cost rollup. Returns a `Record<agentId, AgentCostRow>` so the UI
 * can index directly without a linear scan. Calls with `agentId === null`
 * (system / Conductor calls without an owning agent) are bucketed under the
 * synthetic key `"system"`. Sorted-by-cost is the caller's job — the record
 * keeps insertion order (first call wins).
 */
export function agentCostBreakdown(
  llmCalls: LlmCall[],
): Record<string, AgentCostRow> {
  const byAgent = new Map<string, AgentCostRow>();

  for (const call of llmCalls) {
    const agentId = call.agentId ?? "system";
    const existing = byAgent.get(agentId);
    const cost = costOf(call);
    if (existing) {
      existing.calls += 1;
      existing.tokensIn += call.tokensIn;
      existing.tokensOut += call.tokensOut;
      existing.costUsd += cost;
      existing.avgCostPerCall = existing.costUsd / existing.calls;
      if (
        existing.lastCallAt === null ||
        call.createdAt > existing.lastCallAt
      ) {
        existing.lastCallAt = call.createdAt;
      }
    } else {
      byAgent.set(agentId, {
        agentId,
        calls: 1,
        tokensIn: call.tokensIn,
        tokensOut: call.tokensOut,
        costUsd: cost,
        avgCostPerCall: cost,
        lastCallAt: call.createdAt,
      });
    }
  }

  return Object.fromEntries(byAgent);
}

// ─── Per-day series ──────────────────────────────────────────────────
export type DailySpend = { date: string; cost: number };

const DAY_MS = 86_400_000;

/** UTC date key (YYYY-MM-DD) for an ISO timestamp. */
function utcDateKey(ts: string | Date): string | null {
  const t = typeof ts === "string" ? Date.parse(ts) : ts.getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Daily spend for the last `days` days, oldest to newest, bucketed by
 * `createdAt`. Days with no calls still appear (cost: 0) — the sparkline
 * never collapses to a shorter array. `now` is injectable for deterministic
 * tests.
 */
export function spendPerDay(
  llmCalls: LlmCall[],
  days: number = 7,
  now: Date = new Date(),
): DailySpend[] {
  const out: DailySpend[] = [];
  if (days <= 0) return out;

  // Build the date-key index (oldest first).
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    keys.push(new Date(now.getTime() - i * DAY_MS).toISOString().slice(0, 10));
  }
  const index = new Map(keys.map((k, i) => [k, i]));
  for (const k of keys) out.push({ date: k, cost: 0 });

  // Bucket each call into its day.
  for (const call of llmCalls) {
    const key = utcDateKey(call.createdAt);
    if (key === null) continue;
    const i = index.get(key);
    if (i === undefined) continue; // out of range
    out[i].cost += costOf(call);
  }

  return out;
}

// ─── Monthly projection ──────────────────────────────────────────────
/**
 * Project the next 30 days of spend from the trailing 7-day actuals.
 *
 * The math: average daily spend over the last 7 days × 30. Falls back to 0
 * when there's no recent activity (a brand-new install with 0 calls should
 * project $0, not NaN). The 7-day window is chosen to smooth one-off spikes
 * (a single expensive batch run shouldn't triple the projection) while
 * staying short enough to reflect recent model-mix changes.
 *
 * Honest about its limits: this assumes the next 30 days look like the last
 * 7. It doesn't know about planned campaigns, agent additions, or rate-limit
 * changes. Use it as a budget guardrail, not a commitment.
 */
export function projectedMonthlySpend(
  llmCalls: LlmCall[],
  now: Date = new Date(),
): number {
  const series = spendPerDay(llmCalls, 7, now);
  if (series.length === 0) return 0;
  const total = series.reduce((s, d) => s + d.cost, 0);
  const avgPerDay = total / series.length;
  return avgPerDay * 30;
}

// ─── Totals ──────────────────────────────────────────────────────────
export type CostTotals = {
  totalCost: number;
  totalCalls: number;
  tokensIn: number;
  tokensOut: number;
  avgCostPerCall: number;
};

/** Aggregate cost over an arbitrary LlmCall set. */
export function costTotals(llmCalls: LlmCall[]): CostTotals {
  const totalCost = llmCalls.reduce((s, c) => s + costOf(c), 0);
  const tokensIn = llmCalls.reduce((s, c) => s + c.tokensIn, 0);
  const tokensOut = llmCalls.reduce((s, c) => s + c.tokensOut, 0);
  return {
    totalCost,
    totalCalls: llmCalls.length,
    tokensIn,
    tokensOut,
    avgCostPerCall: llmCalls.length ? totalCost / llmCalls.length : 0,
  };
}
