"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import {
  REVENUE_SOURCE_META,
  DEAL_STAGE_META,
  DEAL_STAGES,
  type RevenueSource,
  type DealStage,
  type Deal,
} from "@/lib/types";
import { compact, relTime, formatTime } from "@/hooks/use-clock";
import {
  DollarSign,
  TrendingUp,
  Wallet,
  Target,
  ArrowUpRight,
  Trophy,
  Briefcase,
} from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

/**
 * FinancialDashboard — autonomous revenue + deal pipeline telemetry.
 *
 * Renders:
 *  1. Revenue KPI cards (total revenue, deal pipeline value, avg deal, win rate)
 *  2. Revenue trend area chart (cumulative over time, by source)
 *  3. Deal pipeline kanban (stages: lead → qualified → proposal → negotiation → won/lost)
 *  4. Recent revenue events feed
 *
 * All data is derived from the shared store's `revenueEvents` + `deals`
 * slices, which are populated by the simulation engine's tickRevenue +
 * tickDeals functions and delivered via SSE.
 */
export function FinancialDashboard({ onOpenDeal }: { onOpenDeal?: (dealId: string) => void }) {
  const revenueEvents = useMissionStore((s) => s.revenueEvents);
  const deals = useMissionStore((s) => s.deals);
  const agents = useMissionStore((s) => s.agents);

  const totalRevenue = useMemo(
    () => revenueEvents.reduce((sum, r) => sum + r.amount, 0),
    [revenueEvents]
  );

  const pipelineValue = useMemo(
    () =>
      Object.values(deals)
        .filter((d) => d.stage !== "won" && d.stage !== "lost")
        .reduce((sum, d) => sum + d.value, 0),
    [deals]
  );

  const wonDeals = useMemo(
    () => Object.values(deals).filter((d) => d.stage === "won"),
    [deals]
  );
  const lostDeals = useMemo(
    () => Object.values(deals).filter((d) => d.stage === "lost"),
    [deals]
  );
  const winRate = useMemo(() => {
    const total = wonDeals.length + lostDeals.length;
    return total > 0 ? Math.round((wonDeals.length / total) * 100) : 0;
  }, [wonDeals, lostDeals]);

  const avgDeal = useMemo(() => {
    const active = Object.values(deals).filter((d) => d.stage !== "lost");
    if (active.length === 0) return 0;
    return Math.round(active.reduce((s, d) => s + d.value, 0) / active.length);
  }, [deals]);

  // Revenue trend series (bucketed by time).
  const revenueSeries = useMemo(() => {
    if (revenueEvents.length === 0) return [];
    const sorted = [...revenueEvents].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    let cumulative = 0;
    return sorted.map((r) => {
      cumulative += r.amount;
      return {
        t: formatTime(r.createdAt),
        cumulative: Math.round(cumulative),
        delta: r.amount,
        source: r.source,
      };
    });
  }, [revenueEvents]);

  // Revenue by source breakdown.
  const sourceBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of revenueEvents) {
      map.set(r.source, (map.get(r.source) ?? 0) + r.amount);
    }
    return Array.from(map.entries())
      .map(([source, amount]) => ({ source: source as RevenueSource, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [revenueEvents]);

  // Deals grouped by stage.
  const dealsByStage = useMemo(() => {
    const map = new Map<DealStage, Deal[]>();
    for (const s of DEAL_STAGES) map.set(s, []);
    for (const d of Object.values(deals)) {
      const stage = map.get(d.stage as DealStage);
      if (stage) stage.push(d);
    }
    for (const [, list] of map) {
      list.sort((a, b) => b.value - a.value);
    }
    return map;
  }, [deals]);

  const agentName = (id: string | null) => (id ? agents[id]?.name ?? "—" : "—");

  return (
    <section className="mc-surface flex flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-emerald-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Financial Operations
          </h2>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Wallet className="h-3 w-3" /> {revenueEvents.length} events
          </span>
          <span className="text-border">·</span>
          <span>{Object.keys(deals).length} deals</span>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-2 border-b border-border/60 px-3 py-2.5 lg:grid-cols-4">
        <Kpi
          icon={DollarSign}
          label="Total Revenue"
          value={`$${compact(totalRevenue)}`}
          sub={`${revenueEvents.length} transactions`}
          tone="text-emerald-300"
        />
        <Kpi
          icon={Briefcase}
          label="Pipeline Value"
          value={`$${compact(pipelineValue)}`}
          sub={`${Object.values(deals).filter((d) => d.stage !== "won" && d.stage !== "lost").length} active`}
          tone="text-cyan-300"
        />
        <Kpi
          icon={Target}
          label="Avg Deal Size"
          value={`$${compact(avgDeal)}`}
          sub="weighted"
          tone="text-violet-300"
        />
        <Kpi
          icon={Trophy}
          label="Win Rate"
          value={`${winRate}%`}
          sub={`${wonDeals.length}W / ${lostDeals.length}L`}
          tone={winRate >= 50 ? "text-emerald-300" : "text-amber-300"}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-2">
        {/* Revenue trend chart */}
        <ChartCard title="Revenue Accrual" subtitle="cumulative over time">
          {revenueSeries.length < 2 ? (
            <Empty label="awaiting revenue telemetry…" />
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={revenueSeries} margin={{ top: 6, right: 6, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.75 0.16 150)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="oklch(0.75 0.16 150)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.06)" />
                <XAxis dataKey="t" tick={{ fontSize: 8, fill: "oklch(0.64 0.012 250)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={30} />
                <YAxis tick={{ fontSize: 8, fill: "oklch(0.64 0.012 250)" }} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => `$${compact(v as number)}`} />
                <Tooltip
                  contentStyle={{
                    background: "oklch(0.235 0.016 250)",
                    border: "1px solid oklch(1 0 0 / 0.1)",
                    borderRadius: 8,
                    fontSize: 11,
                    fontFamily: "var(--font-geist-mono)",
                  }}
                  formatter={(value: number) => [`$${compact(value)}`, "cumulative"]}
                />
                <Area type="monotone" dataKey="cumulative" stroke="oklch(0.75 0.16 150)" strokeWidth={2} fill="url(#revGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Revenue by source */}
        <ChartCard title="Revenue by Source" subtitle="breakdown">
          {sourceBreakdown.length === 0 ? (
            <Empty label="no revenue sources yet" />
          ) : (
            <div className="space-y-2 py-1">
              {sourceBreakdown.map((s) => {
                const meta = REVENUE_SOURCE_META[s.source];
                const pct = totalRevenue > 0 ? Math.round((s.amount / totalRevenue) * 100) : 0;
                return (
                  <div key={s.source} className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                    <span className="w-24 shrink-0 truncate font-mono text-[10px] text-muted-foreground">
                      {meta.label}
                    </span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-border/30">
                      <motion.div
                        className={`h-full rounded-full ${meta.dot}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right font-mono text-[10px] tabular-nums text-foreground">
                      ${compact(s.amount)}
                    </span>
                    <span className="w-8 shrink-0 text-right font-mono text-[9px] text-muted-foreground">
                      {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </ChartCard>

        {/* Deal pipeline kanban */}
        <ChartCard title="Deal Pipeline" subtitle="by stage" className="lg:col-span-2">
          {Object.keys(deals).length === 0 ? (
            <Empty label="no deals in pipeline" />
          ) : (
            <div className="mc-scroll flex gap-2 overflow-x-auto pb-1">
              {DEAL_STAGES.filter((s) => s !== "lost").map((stage) => {
                const stageDeals = dealsByStage.get(stage) ?? [];
                const meta = DEAL_STAGE_META[stage];
                const stageValue = stageDeals.reduce((s, d) => s + d.value, 0);
                return (
                  <div key={stage} className="w-44 shrink-0">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className={`font-mono text-[9px] font-semibold uppercase tracking-wider ${meta.tone}`}>
                        {meta.label}
                      </span>
                      <span className="font-mono text-[9px] text-muted-foreground">
                        {stageDeals.length}
                      </span>
                    </div>
                    <div className={`mb-1.5 rounded border border-border/40 ${meta.bg} px-2 py-0.5 text-center font-mono text-[10px] font-semibold ${meta.tone}`}>
                      ${compact(stageValue)}
                    </div>
                    <div className="space-y-1">
                      {stageDeals.slice(0, 4).map((deal) => (
                        <DealCard key={deal.id} deal={deal} agentName={agentName(deal.agentId)} onOpenDeal={onOpenDeal} />
                      ))}
                      {stageDeals.length === 0 && (
                        <div className="flex flex-col items-center gap-1 rounded border border-dashed border-border/30 py-4 text-center">
                          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/40">
                            no deals
                          </span>
                          <span className="font-mono text-[8px] text-muted-foreground/30">
                            awaiting pipeline
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ChartCard>
      </div>

      {/* Recent revenue events */}
      <div className="border-t border-border/60 px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <ArrowUpRight className="h-3 w-3 text-emerald-300" />
          <h3 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground">
            Recent Revenue
          </h3>
        </div>
        {revenueEvents.length === 0 ? (
          <div className="font-mono text-[11px] text-muted-foreground">no revenue events yet</div>
        ) : (
          <div className="mc-scroll max-h-32 space-y-px overflow-y-auto">
            {revenueEvents.slice(0, 8).map((r) => {
              const meta = REVENUE_SOURCE_META[r.source];
              return (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-2 rounded px-2 py-1 font-mono text-[11px] hover:bg-card/40"
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
                  <span className="shrink-0 text-muted-foreground/70 tabular-nums">{formatTime(r.createdAt)}</span>
                  <span className={`shrink-0 text-[9px] uppercase ${meta.tone}`}>{r.source}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground/80">
                    {r.description ?? "—"}
                  </span>
                  <span className="shrink-0 font-semibold text-emerald-300">
                    +${r.amount.toLocaleString()}
                  </span>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function DealCard({ deal, agentName, onOpenDeal }: { deal: Deal; agentName: string; onOpenDeal?: (dealId: string) => void }) {
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => onOpenDeal?.(deal.id)}
      className="w-full cursor-pointer rounded-md border border-border/50 bg-card/60 p-2 text-left transition-colors hover:border-cyan-500/40 hover:bg-card/80"
      title="Click to view deal details"
    >
      <div className="truncate font-mono text-[10px] font-medium text-foreground">
        {deal.title}
      </div>
      {deal.counterparty && (
        <div className="truncate font-mono text-[9px] text-muted-foreground">
          {deal.counterparty}
        </div>
      )}
      <div className="mt-1 flex items-center justify-between font-mono text-[9px]">
        <span className="font-semibold text-foreground">${compact(deal.value)}</span>
        <span className="text-muted-foreground">{deal.probability}%</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-border/30">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-500"
          style={{ width: `${deal.probability}%` }}
        />
      </div>
      <div className="mt-1 truncate font-mono text-[8px] text-muted-foreground">
        ▸ {agentName}
      </div>
    </motion.button>
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
        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
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
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground">
          {title}
        </span>
        <span className="font-mono text-[9px] text-muted-foreground">{subtitle}</span>
      </div>
      {children}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-[140px] items-center justify-center font-mono text-[10px] text-muted-foreground">
      {label}
    </div>
  );
}

export { TrendingUp };
