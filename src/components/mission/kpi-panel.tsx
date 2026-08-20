"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  BarChart3,
  Loader2,
  Camera,
  TrendingUp,
  TrendingDown,
  DollarSign,
  CheckCircle2,
  Network,
  CreditCard,
  Users,
  UserPlus,
} from "lucide-react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

interface KpiSnapshot {
  id: string;
  revenue: number;
  tasksDone: number;
  agentsActive: number;
  payments: number;
  leads: number;
  customers: number;
  createdAt: string;
}

interface KpiSummary {
  latest: KpiSnapshot | null;
  deltas: { metric: string; value: number; delta: number }[];
}

interface KpiSeriesResponse {
  series: KpiSnapshot[];
}

const fmtMoney = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;

function DeltaArrow({ delta }: { delta: number }) {
  if (delta > 0) return <TrendingUp className="h-3 w-3 text-emerald-300" />;
  if (delta < 0) return <TrendingDown className="h-3 w-3 text-rose-300" />;
  return <span className="h-3 w-3 text-muted-foreground">—</span>;
}

const KPI_CARDS: Array<{
  key: string;
  label: string;
  icon: typeof DollarSign;
  tone: string;
  format: (n: number) => string;
}> = [
  { key: "revenue", label: "Revenue", icon: DollarSign, tone: "text-emerald-300", format: fmtMoney },
  { key: "tasks", label: "Tasks Done", icon: CheckCircle2, tone: "text-cyan-300", format: (n) => String(n) },
  { key: "agents", label: "Active Agents", icon: Network, tone: "text-violet-300", format: (n) => String(n) },
  { key: "payments", label: "Payments", icon: CreditCard, tone: "text-amber-300", format: (n) => String(n) },
  { key: "leads", label: "Leads", icon: UserPlus, tone: "text-sky-300", format: (n) => String(n) },
  { key: "customers", label: "Customers", icon: Users, tone: "text-rose-300", format: (n) => String(n) },
];

export function KpiPanel() {
  const [summary, setSummary] = useState<KpiSummary | null>(null);
  const [series, setSeries] = useState<KpiSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [sumRes, serRes] = await Promise.all([
        fetch("/api/kpis"),
        fetch("/api/kpis?series=1"),
      ]);
      const sum = (await sumRes.json()) as KpiSummary;
      const ser = (await serRes.json()) as KpiSeriesResponse;
      setSummary(sum);
      setSeries(ser.series ?? []);
    } catch {
      setSummary({ latest: null, deltas: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  async function capture() {
    setCapturing(true);
    try {
      const res = await fetch("/api/kpis", { method: "POST" });
      if (!res.ok) throw new Error("capture failed");
      toast.success("KPI snapshot captured");
      await fetchData();
    } catch {
      toast.error("Failed to capture snapshot");
    } finally {
      setCapturing(false);
    }
  }

  const latest = summary?.latest;
  const deltaMap: Record<string, number> = {};
  for (const d of summary?.deltas ?? []) {
    deltaMap[d.metric] = d.delta;
  }

  const chartData = series.map((s) => ({
    time: new Date(s.createdAt).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    revenue: Math.round(s.revenue),
  }));

  return (
    <section className="mc-surface flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-cyan-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            KPI Engine
          </h2>
        </div>
        <button
          onClick={() => void capture()}
          disabled={capturing}
          className="flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-cyan-300 transition-colors hover:bg-cyan-500/15 disabled:opacity-50"
        >
          {capturing ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Camera className="h-2.5 w-2.5" />}
          {capturing ? "capturing…" : "capture snapshot"}
        </button>
      </div>

      <div className="mc-scroll max-h-96 flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded bg-border/30" />
            ))}
          </div>
        ) : (
          <>
            {/* 6 KPI cards */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {KPI_CARDS.map((card) => {
                const value =
                  card.key === "revenue"
                    ? latest?.revenue ?? 0
                    : card.key === "tasks"
                    ? latest?.tasksDone ?? 0
                    : card.key === "agents"
                    ? latest?.agentsActive ?? 0
                    : latest
                    ? (latest as unknown as Record<string, number>)[card.key] ?? 0
                    : 0;
                const delta = deltaMap[card.key] ?? 0;
                const Icon = card.icon;
                return (
                  <motion.div
                    key={card.key}
                    layout
                    className="rounded-md border border-border/50 bg-card/50 p-2"
                  >
                    <div className="flex items-center gap-1.5">
                      <Icon className={`h-3 w-3 ${card.tone}`} />
                      <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                        {card.label}
                      </span>
                    </div>
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <span className="font-mono text-base font-bold tabular-nums text-foreground">
                        {card.format(value)}
                      </span>
                      {latest && (
                        <span className="flex items-center gap-0.5 font-mono text-[9px]">
                          <DeltaArrow delta={delta} />
                          <span className={delta > 0 ? "text-emerald-300" : delta < 0 ? "text-rose-300" : "text-muted-foreground"}>
                            {Math.abs(delta) > 0 && card.key === "revenue"
                              ? fmtMoney(Math.abs(delta))
                              : Math.abs(delta)}
                          </span>
                        </span>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Revenue chart */}
            <div className="mt-3 rounded-md border border-border/50 bg-card/40 p-2">
              <div className="mb-1 flex items-center gap-1.5 px-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                <DollarSign className="h-2.5 w-2.5 text-emerald-300" />
                Revenue · 7-day series
              </div>
              {chartData.length === 0 ? (
                <div className="flex h-24 items-center justify-center font-mono text-[10px] text-muted-foreground">
                  no snapshots — click "capture snapshot" to seed the series
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0 0)" opacity={0.2} />
                    <XAxis
                      dataKey="time"
                      tick={{ fill: "oklch(0.6 0 0)", fontSize: 9 }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fill: "oklch(0.6 0 0)", fontSize: 9 }}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "oklch(0.18 0 0)",
                        border: "1px solid oklch(0.3 0 0)",
                        borderRadius: 4,
                        fontSize: 10,
                        fontFamily: "monospace",
                      }}
                      labelStyle={{ color: "oklch(0.7 0 0)" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="revenue"
                      stroke="oklch(0.78 0.16 145)"
                      strokeWidth={2}
                      dot={false}
                      name="Revenue"
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {!latest && (
              <div className="mt-2 px-1 font-mono text-[10px] text-muted-foreground">
                <span className="text-border">▸ </span>
                No snapshots yet. Capture one to start tracking KPIs over time.
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
