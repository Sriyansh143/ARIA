"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import { LLM_PROVIDERS, type LlmProvider } from "@/lib/types";
import { compact } from "@/hooks/use-clock";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Cpu,
  Percent,
  Wallet,
  Scale,
} from "lucide-react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
} from "recharts";

/**
 * CostProfitAnalysis — LLM token cost vs revenue profitability panel.
 *
 * Estimates LLM inference costs from the audited `llmCalls` collection
 * (using per-provider token pricing) and compares against revenue from
 * the `revenueEvents` collection. Renders:
 *  1. Margin KPI cards (revenue, cost, gross profit, margin %)
 *  2. Cost-by-provider bar chart
 *  3. Revenue-vs-cost trend comparison
 *  4. Per-agent cost efficiency ranking
 *
 * Pricing is a realistic estimate per 1M tokens (in/out) by provider.
 */

// Estimated USD per 1M tokens (in/out blended for simplicity).
const PROVIDER_PRICING: Record<LlmProvider, { in: number; out: number }> = {
  zai: { in: 0.5, out: 1.5 },
  ollama: { in: 0.0, out: 0.0 }, // self-hosted
  openai: { in: 2.5, out: 10.0 },
  anthropic: { in: 3.0, out: 15.0 },
  gemini: { in: 1.25, out: 5.0 },
  groq: { in: 0.1, out: 0.4 },
  deepseek: { in: 0.14, out: 0.28 },
};

export function CostProfitAnalysis() {
  const llmCalls = useMissionStore((s) => s.llmCalls);
  const revenueEvents = useMissionStore((s) => s.revenueEvents);
  const agents = useMissionStore((s) => s.agents);

  const totalRevenue = useMemo(
    () => revenueEvents.reduce((sum, r) => sum + r.amount, 0),
    [revenueEvents]
  );

  const costStats = useMemo(() => {
    let totalCost = 0;
    const byProvider: Record<string, { cost: number; calls: number; tokens: number }> = {};
    const byAgent: Record<string, { cost: number; calls: number }> = {};

    for (const c of llmCalls) {
      const pricing = PROVIDER_PRICING[c.provider as LlmProvider] ?? PROVIDER_PRICING.zai;
      const cost = (c.tokensIn / 1_000_000) * pricing.in + (c.tokensOut / 1_000_000) * pricing.out;
      totalCost += cost;

      const prov = byProvider[c.provider] ?? { cost: 0, calls: 0, tokens: 0 };
      prov.cost += cost;
      prov.calls += 1;
      prov.tokens += c.tokensIn + c.tokensOut;
      byProvider[c.provider] = prov;

      if (c.prompt) {
        // Extract agent name from prompt prefix like "[Aria-CEO] ..."
        const match = c.prompt.match(/^\[([^\]]+)\]/);
        if (match) {
          const agentName = match[1];
          const ag = byAgent[agentName] ?? { cost: 0, calls: 0 };
          ag.cost += cost;
          ag.calls += 1;
          byAgent[agentName] = ag;
        }
      }
    }

    return { totalCost, byProvider, byAgent };
  }, [llmCalls]);

  const grossProfit = totalRevenue - costStats.totalCost;
  const margin = totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 100) : 0;

  const providerData = useMemo(
    () =>
      LLM_PROVIDERS.filter((p) => costStats.byProvider[p])
        .map((p) => ({
          provider: p,
          cost: parseFloat(costStats.byProvider[p].cost.toFixed(2)),
          calls: costStats.byProvider[p].calls,
        }))
        .sort((a, b) => b.cost - a.cost),
    [costStats]
  );

  const agentCostData = useMemo(
    () =>
      Object.entries(costStats.byAgent)
        .map(([name, data]) => ({ name, cost: parseFloat(data.cost.toFixed(2)), calls: data.calls }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 6),
    [costStats]
  );

  // Revenue vs cost trend (bucketed by time, aligned).
  const trendData = useMemo(() => {
    const revByTime = new Map<string, number>();
    const costByTime = new Map<string, number>();
    for (const r of revenueEvents) {
      const bucket = new Date(r.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
      revByTime.set(bucket, (revByTime.get(bucket) ?? 0) + r.amount);
    }
    for (const c of llmCalls) {
      const pricing = PROVIDER_PRICING[c.provider as LlmProvider] ?? PROVIDER_PRICING.zai;
      const cost = (c.tokensIn / 1_000_000) * pricing.in + (c.tokensOut / 1_000_000) * pricing.out;
      const bucket = new Date(c.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
      costByTime.set(bucket, (costByTime.get(bucket) ?? 0) + cost);
    }
    const allBuckets = Array.from(new Set([...revByTime.keys(), ...costByTime.keys()])).sort();
    return allBuckets.slice(-12).map((t) => ({
      t,
      revenue: Math.round((revByTime.get(t) ?? 0) * 100) / 100,
      cost: Math.round((costByTime.get(t) ?? 0) * 100) / 100,
    }));
  }, [revenueEvents, llmCalls]);

  const maxProviderCost = Math.max(0.01, ...providerData.map((d) => d.cost));
  void agents;

  return (
    <section className="mc-surface flex flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-emerald-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Cost / Profit Analysis
          </h2>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {llmCalls.length} calls audited
        </span>
      </div>

      {/* Margin KPI Row */}
      <div className="grid grid-cols-2 gap-2 border-b border-border/60 px-3 py-2.5 lg:grid-cols-4">
        <Kpi icon={DollarSign} label="Revenue" value={`$${compact(totalRevenue)}`} sub="total" tone="text-emerald-300" />
        <Kpi icon={Cpu} label="LLM Cost" value={`$${costStats.totalCost.toFixed(2)}`} sub={`${llmCalls.length} calls`} tone="text-amber-300" />
        <Kpi
          icon={Wallet}
          label="Gross Profit"
          value={`$${compact(grossProfit)}`}
          sub={grossProfit >= 0 ? "surplus" : "deficit"}
          tone={grossProfit >= 0 ? "text-emerald-300" : "text-rose-300"}
        />
        <Kpi
          icon={Percent}
          label="Margin"
          value={`${margin}%`}
          sub={margin >= 50 ? "healthy" : margin >= 0 ? "thin" : "loss"}
          tone={margin >= 50 ? "text-emerald-300" : margin >= 0 ? "text-amber-300" : "text-rose-300"}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-2">
        {/* Cost by provider */}
        <ChartCard title="Cost by Provider" subtitle="estimated spend">
          {providerData.length === 0 ? (
            <Empty label="no LLM calls yet" />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={providerData} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.06)" />
                  <XAxis dataKey="provider" tick={{ fontSize: 8, fill: "oklch(0.64 0.012 250)" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 8, fill: "oklch(0.64 0.012 250)" }} tickLine={false} axisLine={false} width={36} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{
                      background: "oklch(0.235 0.016 250)",
                      border: "1px solid oklch(1 0 0 / 0.1)",
                      borderRadius: 6,
                      fontSize: 10,
                      fontFamily: "var(--font-geist-mono)",
                    }}
                    cursor={{ fill: "oklch(1 0 0 / 0.04)" }}
                    formatter={(value: number) => [`$${value.toFixed(2)}`, "cost"]}
                  />
                  <Bar dataKey="cost" radius={[3, 3, 0, 0]}>
                    {providerData.map((d) => {
                      const intensity = d.cost / maxProviderCost;
                      return (
                        <Cell
                          key={d.provider}
                          fill={`oklch(${0.5 + intensity * 0.3} 0.16 ${30 + intensity * 30})`}
                        />
                      );
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-1.5 space-y-0.5">
                {providerData.slice(0, 4).map((p) => (
                  <div key={p.provider} className="flex items-center justify-between font-mono text-[9px] text-muted-foreground">
                    <span className="uppercase">{p.provider}</span>
                    <span>${p.cost.toFixed(2)} · {p.calls} calls</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </ChartCard>

        {/* Revenue vs cost trend */}
        <ChartCard title="Revenue vs Cost" subtitle="time-aligned">
          {trendData.length < 2 ? (
            <Empty label="awaiting data…" />
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.06)" />
                <XAxis dataKey="t" tick={{ fontSize: 7, fill: "oklch(0.64 0.012 250)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={20} />
                <YAxis tick={{ fontSize: 8, fill: "oklch(0.64 0.012 250)" }} tickLine={false} axisLine={false} width={36} tickFormatter={(v) => `$${compact(v as number)}`} />
                <Tooltip
                  contentStyle={{
                    background: "oklch(0.235 0.016 250)",
                    border: "1px solid oklch(1 0 0 / 0.1)",
                    borderRadius: 6,
                    fontSize: 10,
                    fontFamily: "var(--font-geist-mono)",
                  }}
                  cursor={{ fill: "oklch(1 0 0 / 0.04)" }}
                  formatter={(value: number, name: string) => [`$${compact(value)}`, name === "revenue" ? "Revenue" : "Cost"]}
                />
                <Bar dataKey="revenue" fill="oklch(0.75 0.16 150)" radius={[2, 2, 0, 0]} />
                <Bar dataKey="cost" fill="oklch(0.68 0.18 50)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Per-agent cost efficiency */}
        <ChartCard title="Agent Cost Efficiency" subtitle="top spenders" className="lg:col-span-2">
          {agentCostData.length === 0 ? (
            <Empty label="no per-agent cost data yet" />
          ) : (
            <div className="space-y-1.5 py-1">
              {agentCostData.map((a) => {
                const maxCost = agentCostData[0]?.cost || 1;
                const pct = Math.round((a.cost / maxCost) * 100);
                return (
                  <div key={a.name} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate font-mono text-[10px] text-muted-foreground">
                      {a.name}
                    </span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-border/30">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-amber-400 to-rose-400"
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right font-mono text-[10px] tabular-nums text-foreground">
                      ${a.cost.toFixed(2)}
                    </span>
                    <span className="w-12 shrink-0 text-right font-mono text-[9px] text-muted-foreground">
                      {a.calls}c
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </ChartCard>
      </div>

      {/* Profitability banner */}
      <div className={`flex items-center gap-2 border-t border-border/60 px-4 py-2.5 ${margin >= 50 ? "bg-emerald-500/5" : margin >= 0 ? "bg-amber-500/5" : "bg-rose-500/5"}`}>
        {margin >= 0 ? (
          <TrendingUp className={`h-4 w-4 ${margin >= 50 ? "text-emerald-300" : "text-amber-300"}`} />
        ) : (
          <TrendingDown className="h-4 w-4 text-rose-300" />
        )}
        <span className={`font-mono text-[11px] font-semibold ${margin >= 50 ? "text-emerald-300" : margin >= 0 ? "text-amber-300" : "text-rose-300"}`}>
          {margin >= 50
            ? `Healthy margins — ${margin}% gross profit on $${compact(totalRevenue)} revenue`
            : margin >= 0
              ? `Thin margins — ${margin}% on $${compact(totalRevenue)} revenue; optimize LLM routing`
              : `Operating at a loss — $${compact(Math.abs(grossProfit))} deficit; reduce costs or increase revenue`}
        </span>
      </div>
    </section>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  sub: string;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/40 p-2.5">
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3 w-3 ${tone}`} />
        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`font-mono text-lg font-semibold tabular-nums ${tone}`}>{value}</span>
        <span className="font-mono text-[9px] text-muted-foreground">{sub}</span>
      </div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-border/50 bg-background/40 p-3 ${className}`}>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground">{title}</span>
        <span className="font-mono text-[9px] text-muted-foreground">{subtitle}</span>
      </div>
      {children}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-[120px] items-center justify-center font-mono text-[10px] text-muted-foreground">
      {label}
    </div>
  );
}
