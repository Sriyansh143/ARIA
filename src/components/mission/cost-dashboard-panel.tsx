"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  DollarSign,
  RefreshCw,
  TrendingUp,
  Wallet,
  CalendarDays,
  Gauge,
  AlertTriangle,
  Cpu,
} from "lucide-react";
import { FullScreenPanel } from "./full-screen-panel";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Pie,
  PieChart,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts";
import type { CostBreakdown } from "@/lib/cost-dashboard";

// ─── Color palette ───────────────────────────────────────────────────

const COLORS = {
  violet: "#8b5cf6",
  cyan: "#22d3ee",
  emerald: "#34d399",
  amber: "#fbbf24",
  rose: "#f87171",
  zinc: "#71717a",
};

const PROVIDER_COLORS: Record<string, string> = {
  zai: COLORS.violet,
  groq: COLORS.cyan,
  nvidia: COLORS.amber,
  ollama: COLORS.zinc,
  openai: COLORS.rose,
  anthropic: "#d8b4fe",
  gemini: "#fde68a",
  deepseek: "#a5f3fc",
};

function providerColor(provider: string): string {
  return PROVIDER_COLORS[provider.toLowerCase()] ?? COLORS.emerald;
}

const TOOLTIP_STYLE = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  fontFamily: "var(--font-mono)",
  fontSize: "10px",
  color: "var(--text)",
  padding: "6px 8px",
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────

function fmtUsd(n: number, opts?: { compact?: boolean }): string {
  if (!Number.isFinite(n)) return "$0.00";
  if (opts?.compact) {
    if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
    if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
    return `$${n.toFixed(4)}`;
  }
  return `$${n.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function shortDate(iso: string): string {
  // "YYYY-MM-DD" → "MM/DD"
  const parts = iso.split("-");
  if (parts.length < 3) return iso;
  return `${parts[1]}/${parts[2]}`;
}

// ─── Component ───────────────────────────────────────────────────────

export function CostDashboardPanel() {
  const [data, setData] = useState<CostBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBreakdown = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/cost-dashboard", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json().catch(() => ({}))) as CostBreakdown & {
        error?: string;
      };
      if (json.error) {
        setError(json.error);
      }
      setData(json);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to load cost breakdown";
      setError(msg);
      if (!opts?.silent) {
        toast.error("Failed to load cost data", { description: msg });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchBreakdown();
  }, [fetchBreakdown]);

  const overBudget = data?.budget.alert === "over_budget";

  return (
    <FullScreenPanel
      title="Cost & Budget Dashboard"
      icon={<DollarSign className="h-3.5 w-3.5 text-emerald-300" />}
      actions={
        <button
          type="button"
          onClick={() => void fetchBreakdown()}
          disabled={refreshing}
          aria-label="Refresh cost dashboard"
          title="Refresh"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      }
    >
      <div className="space-y-3 p-3 sm:p-4">
        {/* ── Error banner ────────────────────────────────────────── */}
        {error && (
          <div className="rounded border border-rose-500/30 bg-rose-500/5 px-3 py-1.5 font-mono text-[10px] text-rose-300">
            load failed: {error}
          </div>
        )}

        {loading && !data ? (
          <CostDashboardSkeleton />
        ) : !data || data.totals.totalCalls === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* ── Budget alert banner (rose, if over budget) ────── */}
            {overBudget && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-300" />
                <span className="font-mono text-[11px] font-semibold text-rose-300">
                  Over daily budget —
                </span>
                <span className="font-mono text-[10px] text-rose-200/80">
                  today&apos;s spend ({fmtUsd(data.totals.today)}) exceeds the
                  ${data.budget.dailyBudgetUsd} daily limit
                </span>
              </motion.div>
            )}

            {/* ── Summary bar ────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryStat
                icon={<CalendarDays className="h-3 w-3" />}
                label="30-Day Total"
                value={fmtUsd(data.totals.total30d, { compact: true })}
                sub={`${data.totals.totalCalls} calls`}
                tone="text-emerald-300"
              />
              <SummaryStat
                icon={<DollarSign className="h-3 w-3" />}
                label="Today"
                value={fmtUsd(data.totals.today, { compact: true })}
                sub="spend today"
                tone={overBudget ? "text-rose-300" : "text-amber-300"}
              />
              <SummaryStat
                icon={<TrendingUp className="h-3 w-3" />}
                label="Avg / Day"
                value={fmtUsd(data.totals.avgDaily, { compact: true })}
                sub="30-day avg"
                tone="text-cyan-300"
              />
              <BudgetStat
                utilizationPct={data.budget.utilizationPct}
                dailyBudget={data.budget.dailyBudgetUsd}
                remaining={data.budget.remainingUsd}
              />
            </div>

            {/* ── Charts (2×2 grid) ─────────────────────────────── */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <ChartCard
                title="Daily Cost (30 days)"
                subtitle="USD per day"
                icon={<CalendarDays className="h-3 w-3" />}
              >
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart
                    data={data.daily}
                    margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
                  >
                    <defs>
                      <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLORS.emerald} stopOpacity={0.5} />
                        <stop offset="100%" stopColor={COLORS.emerald} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={shortDate}
                      tick={{ fontSize: 8, fill: "#a1a1aa" }}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      tick={{ fontSize: 8, fill: "#a1a1aa" }}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                      tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      cursor={{ stroke: "rgba(52,211,153,0.4)" }}
                      formatter={(value: number) => [fmtUsd(value), "cost"]}
                      labelFormatter={(label: string) => `date: ${label}`}
                    />
                    <Area
                      type="monotone"
                      dataKey="cost"
                      stroke={COLORS.emerald}
                      strokeWidth={2}
                      fill="url(#costGrad)"
                      dot={false}
                      activeDot={{ r: 3, fill: COLORS.emerald }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard
                title="Cost by Provider"
                subtitle="share of total spend"
                icon={<Wallet className="h-3 w-3" />}
              >
                <div className="relative h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data.byProvider}
                        dataKey="costUsd"
                        nameKey="provider"
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={75}
                        paddingAngle={2}
                        stroke="var(--surface)"
                        strokeWidth={2}
                      >
                        {data.byProvider.map((d) => (
                          <Cell key={d.provider} fill={providerColor(d.provider)} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(value: number, name: string) => [
                          fmtUsd(value),
                          name,
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Center total overlay */}
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                      total
                    </span>
                    <span className="font-mono text-[14px] font-bold tabular-nums text-emerald-300">
                      {fmtUsd(data.totals.total30d, { compact: true })}
                    </span>
                  </div>
                </div>
                {/* Legend */}
                <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                  {data.byProvider.map((p) => (
                    <span
                      key={p.provider}
                      className="flex items-center gap-1 font-mono text-[9px] text-muted-foreground"
                    >
                      <span
                        aria-hidden="true"
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: providerColor(p.provider) }}
                      />
                      <span className="uppercase">{p.provider}</span>
                      <span className="text-foreground/80">{p.pctOfTotal}%</span>
                    </span>
                  ))}
                </div>
              </ChartCard>

              <ChartCard
                title="Token Usage by Provider"
                subtitle="in vs out"
                icon={<Cpu className="h-3 w-3" />}
              >
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart
                    data={data.byProvider}
                    margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="provider"
                      tick={{ fontSize: 8, fill: "#a1a1aa" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 8, fill: "#a1a1aa" }}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                      tickFormatter={(v: number) => fmtTokens(v)}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      cursor={{ fill: "rgba(255,255,255,0.04)" }}
                      formatter={(value: number, name: string) => [
                        fmtTokens(value),
                        name === "tokensIn" ? "Input" : "Output",
                      ]}
                    />
                    <Bar dataKey="tokensIn" name="tokensIn" fill={COLORS.cyan} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="tokensOut" name="tokensOut" fill={COLORS.violet} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard
                title="Cost by Model"
                subtitle="top 10 by spend"
                icon={<Gauge className="h-3 w-3" />}
              >
                {data.byModel.length === 0 ? (
                  <div className="flex h-[180px] items-center justify-center font-mono text-[10px] text-muted-foreground/60">
                    no model data
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart
                      layout="vertical"
                      data={data.byModel}
                      margin={{ top: 4, right: 24, bottom: 0, left: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 8, fill: "#a1a1aa" }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                      />
                      <YAxis
                        type="category"
                        dataKey="model"
                        tick={{ fontSize: 8, fill: "#a1a1aa" }}
                        tickLine={false}
                        axisLine={false}
                        width={100}
                        interval={0}
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        cursor={{ fill: "rgba(255,255,255,0.04)" }}
                        formatter={(value: number, _name, props) => {
                          const p = props?.payload as { provider?: string };
                          return [fmtUsd(value), `${p?.provider ?? ""}/${props?.payload?.model ?? ""}`];
                        }}
                      />
                      <Bar dataKey="costUsd" radius={[0, 2, 2, 0]}>
                        {data.byModel.map((d, i) => (
                          <Cell
                            key={`${d.model}-${i}`}
                            fill={providerColor(d.provider)}
                          />
                        ))}
                        <LabelList
                          dataKey="costUsd"
                          position="right"
                          formatter={(v: number) => `$${v.toFixed(2)}`}
                          style={{ fontSize: 8, fill: "#a1a1aa", fontFamily: "var(--font-mono)" }}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>
            </div>

            {/* ── Provider breakdown table ──────────────────────── */}
            <div className="rounded-lg border border-border/60 bg-surface-2/30">
              <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground">
                  Provider Breakdown
                </span>
                <span className="font-mono text-[9px] text-muted-foreground">
                  {data.byProvider.length} providers · 30 days
                </span>
              </div>
              <div className="mc-scroll max-h-72 overflow-y-auto">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 bg-background/95 backdrop-blur">
                    <tr className="border-b border-border/40 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-1.5 text-left">Provider</th>
                      <th className="px-3 py-1.5 text-right">Calls</th>
                      <th className="px-3 py-1.5 text-right">Tokens In</th>
                      <th className="px-3 py-1.5 text-right">Tokens Out</th>
                      <th className="px-3 py-1.5 text-right">Cost</th>
                      <th className="px-3 py-1.5 text-right">% Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byProvider.map((p) => (
                      <tr
                        key={p.provider}
                        className="border-b border-border/20 font-mono text-[10px] text-foreground/90 transition-colors hover:bg-surface-2/40"
                      >
                        <td className="px-3 py-1.5">
                          <span className="flex items-center gap-1.5">
                            <span
                              aria-hidden="true"
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ background: providerColor(p.provider) }}
                            />
                            <span className="uppercase">{p.provider}</span>
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{p.calls}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-cyan-300/80">{fmtTokens(p.tokensIn)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-violet-300/80">{fmtTokens(p.tokensOut)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-emerald-300/90">{fmtUsd(p.costUsd)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{p.pctOfTotal}%</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border/60 font-mono text-[10px] font-semibold text-foreground">
                      <td className="px-3 py-1.5">TOTAL</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{data.totals.totalCalls}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-cyan-300/80">{fmtTokens(data.totals.tokensIn)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-violet-300/80">{fmtTokens(data.totals.tokensOut)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-emerald-300">{fmtUsd(data.totals.total30d)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* ── Footer ─────────────────────────────────────────── */}
            <div className="flex items-center justify-between border-t border-border/40 pt-2 font-mono text-[9px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <RefreshCw className="h-2.5 w-2.5" />
                generated {new Date(data.generatedAt).toLocaleTimeString("en-US", { hour12: false })}
              </span>
              <span>
                budget: ${data.budget.dailyBudgetUsd}/day ·{" "}
                <span className={overBudget ? "text-rose-300" : "text-emerald-300"}>
                  {data.budget.utilizationPct}% used
                </span>
              </span>
            </div>
          </>
        )}
      </div>
    </FullScreenPanel>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

function SummaryStat({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-border/50 bg-surface-2/40 p-2.5"
    >
      <div className="flex items-center gap-1.5">
        <span className={tone}>{icon}</span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`font-mono text-base font-semibold tabular-nums ${tone}`}>
          {value}
        </span>
        <span className="font-mono text-[9px] text-muted-foreground">{sub}</span>
      </div>
    </motion.div>
  );
}

function BudgetStat({
  utilizationPct,
  dailyBudget,
  remaining,
}: {
  utilizationPct: number;
  dailyBudget: number;
  remaining: number;
}) {
  const over = utilizationPct > 100;
  const tone = over ? "text-rose-300" : utilizationPct >= 80 ? "text-amber-300" : "text-emerald-300";
  const barColor = over ? "bg-rose-400" : utilizationPct >= 80 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-border/50 bg-surface-2/40 p-2.5"
    >
      <div className="flex items-center gap-1.5">
        <Gauge className={`h-3 w-3 ${tone}`} />
        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          Budget
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`font-mono text-base font-semibold tabular-nums ${tone}`}>
          {utilizationPct.toFixed(1)}%
        </span>
        <span className="font-mono text-[9px] text-muted-foreground">
          of ${dailyBudget}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border/30">
        <motion.div
          className={`h-full rounded-full ${barColor}`}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, utilizationPct)}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>
      <div className="mt-1 font-mono text-[8px] text-muted-foreground">
        ${remaining.toFixed(2)} remaining today
      </div>
    </motion.div>
  );
}

function ChartCard({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mc-glow-card rounded-lg border border-border/60 bg-surface-2/40 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-cyan-300">{icon}</span>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground">
            {title}
          </span>
        </div>
        <span className="font-mono text-[9px] text-muted-foreground">{subtitle}</span>
      </div>
      {children}
    </div>
  );
}

function CostDashboardSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[68px] w-full rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[230px] w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[180px] w-full rounded-lg" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <DollarSign className="h-7 w-7 text-muted-foreground/30" />
      <div className="font-mono text-[11px] font-medium text-muted-foreground">
        No LLM calls recorded yet — costs will appear here once agents start working
      </div>
      <div className="max-w-sm px-4 font-mono text-[9px] text-muted-foreground/60">
        The dashboard refreshes automatically as the fleet generates LLM
        traffic. Daily, provider, and model breakdowns will populate the
        charts above.
      </div>
    </div>
  );
}

export default CostDashboardPanel;
