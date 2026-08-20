"use client";

import { useMemo } from "react";
import { useMissionStore } from "@/stores/mission-store";
import { compact } from "@/hooks/use-clock";
import { LLM_PROVIDERS, type LlmProvider } from "@/lib/types";
import { BarChart3, Zap, Timer, TrendingUp, Layers } from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
  Cell,
} from "recharts";

const PROVIDER_COLOR: Record<LlmProvider, string> = {
  zai: "oklch(0.78 0.16 195)",
  ollama: "oklch(0.7 0.16 150)",
  openai: "oklch(0.78 0.15 80)",
  anthropic: "oklch(0.7 0.18 300)",
  gemini: "oklch(0.65 0.22 20)",
  groq: "oklch(0.75 0.15 200)",
  deepseek: "oklch(0.7 0.18 250)",
};

/**
 * MetricsDashboard — real-time telemetry charts.
 *
 * Derives sparkline + bar data from the store's bounded metric + LLM
 * collections. All aggregations are memoized so the charts only recompute
 * when new data actually arrives.
 */
export function MetricsDashboard() {
  const metrics = useMissionStore((s) => s.metrics);
  const llmCalls = useMissionStore((s) => s.llmCalls);
  const agents = useMissionStore((s) => s.agents);

  const tokenSeries = useMemo(() => {
    // Bucket token metrics into ~20 time buckets (newest last).
    const tokenPoints = metrics.filter((m) => m.name === "tokens").reverse();
    if (tokenPoints.length === 0) return [];
    const bucketSize = Math.max(1, Math.ceil(tokenPoints.length / 20));
    const buckets: Array<{ t: string; v: number }> = [];
    for (let i = 0; i < tokenPoints.length; i += bucketSize) {
      const slice = tokenPoints.slice(i, i + bucketSize);
      const v = slice.reduce((sum, p) => sum + p.value, 0);
      buckets.push({ t: new Date(slice[0].createdAt).toLocaleTimeString("en-US", { hour12: false }), v });
    }
    return buckets;
  }, [metrics]);

  const totalTokens = useMemo(
    () => metrics.filter((m) => m.name === "tokens").reduce((s, m) => s + m.value, 0),
    [metrics]
  );

  const latencyStats = useMemo(() => {
    const latencies = llmCalls.map((c) => c.latencyMs).filter((l) => l > 0);
    if (latencies.length === 0) return { avg: 0, p95: 0, max: 0 };
    const sorted = [...latencies].sort((a, b) => a - b);
    const avg = Math.round(latencies.reduce((s, l) => s + l, 0) / latencies.length);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1];
    const max = sorted[sorted.length - 1];
    return { avg, p95, max };
  }, [llmCalls]);

  const providerData = useMemo(() => {
    const counts: Record<string, { calls: number; tokens: number; errors: number }> = {};
    for (const p of LLM_PROVIDERS) counts[p] = { calls: 0, tokens: 0, errors: 0 };
    for (const c of llmCalls) {
      const bucket = counts[c.provider] ?? { calls: 0, tokens: 0, errors: 0 };
      bucket.calls += 1;
      bucket.tokens += c.tokensIn + c.tokensOut;
      if (c.status !== "ok") bucket.errors += 1;
      counts[c.provider] = bucket;
    }
    return LLM_PROVIDERS.map((p) => ({ provider: p, ...counts[p] })).filter((d) => d.calls > 0);
  }, [llmCalls]);

  const fleetTokens = useMemo(
    () =>
      Object.values(agents)
        .map((a) => ({ name: a.name.replace(/^Aria-|^Forge-|^Nova-|^Pulse-|^Ledger-|^Vector-|^Echo-/, ""), tokens: a.tokensUsed, role: a.role }))
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 8),
    [agents]
  );

  return (
    <section className="mc-surface flex flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <BarChart3 className="h-4 w-4 text-cyan-300" />
        <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
          Telemetry
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-2 border-b border-border/60 px-3 py-2.5 lg:grid-cols-4">
        <Kpi icon={Zap} label="Token Throughput" value={compact(totalTokens)} sub="cumulative" tone="text-cyan-300" />
        <Kpi icon={Timer} label="Avg Latency" value={`${latencyStats.avg}ms`} sub={`p95 ${latencyStats.p95}ms`} tone="text-amber-300" />
        <Kpi icon={Layers} label="LLM Calls" value={String(llmCalls.length)} sub="audited" tone="text-violet-300" />
        <Kpi icon={TrendingUp} label="Providers" value={String(providerData.length)} sub="active" tone="text-emerald-300" />
      </div>

      <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-2">
        {/* Token throughput sparkline */}
        <ChartCard title="Token Throughput" subtitle="per time bucket">
          {tokenSeries.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={tokenSeries} margin={{ top: 6, right: 6, bottom: 0, left: -28 }}>
                <defs>
                  <linearGradient id="tok" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.78 0.16 195)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="oklch(0.78 0.16 195)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.06)" />
                <XAxis dataKey="t" tick={{ fontSize: 9, fill: "oklch(0.64 0.012 250)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tick={{ fontSize: 9, fill: "oklch(0.64 0.012 250)" }} tickLine={false} axisLine={false} width={36} />
                <Tooltip
                  contentStyle={{
                    background: "oklch(0.235 0.016 250)",
                    border: "1px solid oklch(1 0 0 / 0.1)",
                    borderRadius: 8,
                    fontSize: 11,
                    fontFamily: "var(--font-geist-mono)",
                  }}
                  labelStyle={{ color: "oklch(0.64 0.012 250)" }}
                />
                <Area type="monotone" dataKey="v" stroke="oklch(0.78 0.16 195)" strokeWidth={2} fill="url(#tok)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* LLM provider breakdown */}
        <ChartCard title="LLM Provider Mix" subtitle="calls per provider">
          {providerData.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={providerData} margin={{ top: 6, right: 6, bottom: 0, left: -28 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.06)" />
                <XAxis dataKey="provider" tick={{ fontSize: 9, fill: "oklch(0.64 0.012 250)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "oklch(0.64 0.012 250)" }} tickLine={false} axisLine={false} width={36} />
                <Tooltip
                  contentStyle={{
                    background: "oklch(0.235 0.016 250)",
                    border: "1px solid oklch(1 0 0 / 0.1)",
                    borderRadius: 8,
                    fontSize: 11,
                    fontFamily: "var(--font-geist-mono)",
                  }}
                  cursor={{ fill: "oklch(1 0 0 / 0.04)" }}
                />
                <Bar dataKey="calls" radius={[3, 3, 0, 0]}>
                  {providerData.map((d) => (
                    <Cell key={d.provider} fill={PROVIDER_COLOR[d.provider as LlmProvider]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Fleet token usage horizontal bars */}
        <ChartCard title="Fleet Token Usage" subtitle="top consumers" className="lg:col-span-2">
          {fleetTokens.length === 0 ? (
            <Empty />
          ) : (
            <div className="space-y-1.5 py-1">
              {fleetTokens.map((a) => {
                const max = fleetTokens[0].tokens || 1;
                const pct = Math.round((a.tokens / max) * 100);
                return (
                  <div key={a.name} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 truncate font-mono text-[10px] text-muted-foreground">{a.name}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-border/30">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-400 transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right font-mono text-[10px] tabular-nums text-foreground">{compact(a.tokens)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </ChartCard>
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
  icon: typeof Zap;
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

function Empty() {
  return (
    <div className="flex h-[140px] items-center justify-center font-mono text-[10px] text-muted-foreground">
      awaiting telemetry…
    </div>
  );
}
