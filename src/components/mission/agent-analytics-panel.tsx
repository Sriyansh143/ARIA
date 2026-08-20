"use client";

import { useMemo, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import { compact } from "@/hooks/use-clock";
import { FullScreenPanel } from "./full-screen-panel";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Area,
  AreaChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp,
  Cpu,
  Coins,
  CheckCircle2,
  AlertTriangle,
  Activity,
  Gauge,
  Inbox,
} from "lucide-react";

// ─── Color palette (consistent across all 4 charts) ─────────────────
const COLORS = {
  violet: "#8b5cf6",
  cyan: "#22d3ee",
  emerald: "#34d399",
  amber: "#fbbf24",
  rose: "#f87171",
};

const PROVIDER_COLORS: Record<string, string> = {
  zai: COLORS.violet,
  groq: COLORS.cyan,
  nvidia: COLORS.emerald,
  ollama: COLORS.amber,
  openai: COLORS.rose,
  anthropic: "#d8b4fe",
  gemini: "#fde68a",
  deepseek: "#a5f3fc",
};

const TOOLTIP_STYLE = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  fontFamily: "var(--font-mono)",
  fontSize: "10px",
  color: "var(--text)",
  padding: "6px 8px",
} as const;

/**
 * AgentAnalyticsPanel — comprehensive agent + LLM analytics dashboard.
 *
 * All four chart sections derive their data from the Zustand store
 * (`agents` + `llmCalls` slices) — no API calls. Derived datasets are
 * memoized so they only recompute when the underlying slices change.
 *
 * Task ID: FEATURES-ANALYTICS-METRICS
 */
export function AgentAnalyticsPanel() {
  const agents = useMissionStore((s) => s.agents);
  const llmCalls = useMissionStore((s) => s.llmCalls);

  // ─── Summary stats bar ─────────────────────────────────────────────
  const summary = useMemo(() => {
    const agentList = Object.values(agents);
    const totalAgents = agentList.length;
    const activeAgents = agentList.filter(
      (a) => a.status !== "idle" && a.status !== "offline"
    ).length;
    const totalTokens = agentList.reduce((s, a) => s + a.tokensUsed, 0);
    const totalTasksDone = agentList.reduce((s, a) => s + a.tasksDone, 0);
    const totalErrors = agentList.reduce((s, a) => s + a.errorCount, 0);

    const latencies = llmCalls.map((c) => c.latencyMs).filter((l) => l > 0);
    const avgLatency =
      latencies.length > 0
        ? Math.round(latencies.reduce((s, l) => s + l, 0) / latencies.length)
        : 0;
    const successCount = llmCalls.filter((c) => c.status === "ok").length;
    const successRate =
      llmCalls.length > 0
        ? Math.round((successCount / llmCalls.length) * 1000) / 10
        : 0;

    return {
      totalAgents,
      activeAgents,
      totalTokens,
      totalTasksDone,
      totalErrors,
      avgLatency,
      successRate,
      llmCallCount: llmCalls.length,
    };
  }, [agents, llmCalls]);

  // ─── Chart 1: Top 10 agents by tokensUsed (horizontal BarChart) ────
  const tokenByAgent = useMemo(() => {
    return Object.values(agents)
      .filter((a) => a.tokensUsed > 0)
      .sort((a, b) => b.tokensUsed - a.tokensUsed)
      .slice(0, 10)
      .map((a) => ({
        name: a.name.length > 18 ? a.name.slice(0, 17) + "…" : a.name,
        fullName: a.name,
        tokens: a.tokensUsed,
        model: a.model ?? "—",
      }));
  }, [agents]);

  // ─── Chart 2: Tasks completed vs errors per department ─────────────
  const departmentData = useMemo(() => {
    const buckets: Record<string, { completed: number; errors: number }> = {};
    for (const a of Object.values(agents)) {
      const dept = a.department ?? "Unassigned";
      if (!buckets[dept]) buckets[dept] = { completed: 0, errors: 0 };
      buckets[dept].completed += a.tasksDone;
      buckets[dept].errors += a.errorCount;
    }
    return Object.entries(buckets)
      .map(([dept, v]) => ({ department: dept, ...v }))
      .sort((a, b) => b.completed + b.errors - (a.completed + a.errors))
      .slice(0, 15);
  }, [agents]);

  // ─── Chart 3: LLM provider distribution (PieChart/Donut) ──────────
  const providerData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of llmCalls) {
      counts[c.provider] = (counts[c.provider] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([provider, count]) => ({
        provider,
        count,
        color: PROVIDER_COLORS[provider] ?? COLORS.violet,
      }))
      .sort((a, b) => b.count - a.count);
  }, [llmCalls]);

  const totalCalls = providerData.reduce((s, d) => s + d.count, 0);

  // ─── Chart 4: LLM latency over time (last 50 calls, LineChart) ────
  const latencyOverTime = useMemo(() => {
    return [...llmCalls]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(-50)
      .map((c) => ({
        t: new Date(c.createdAt).toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        latency: c.latencyMs,
        provider: c.provider,
        model: c.model,
      }));
  }, [llmCalls]);

  return (
    <FullScreenPanel
      title="Agent Performance Analytics"
      icon={<TrendingUp className="h-4 w-4 text-violet-300" />}
    >
      <div className="p-3 sm:p-4">
        {/* Summary stats bar */}
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryStat
            icon={<Cpu className="h-3 w-3" />}
            label="Agents"
            value={`${summary.activeAgents}/${summary.totalAgents}`}
            sub="active/total"
            tone="text-violet-300"
          />
          <SummaryStat
            icon={<Coins className="h-3 w-3" />}
            label="Tokens"
            value={compact(summary.totalTokens)}
            sub="cumulative"
            tone="text-cyan-300"
          />
          <SummaryStat
            icon={<CheckCircle2 className="h-3 w-3" />}
            label="Tasks Done"
            value={String(summary.totalTasksDone)}
            sub="completed"
            tone="text-emerald-300"
          />
          <SummaryStat
            icon={<AlertTriangle className="h-3 w-3" />}
            label="Errors"
            value={String(summary.totalErrors)}
            sub="accumulated"
            tone="text-rose-300"
          />
          <SummaryStat
            icon={<Gauge className="h-3 w-3" />}
            label="Avg Latency"
            value={`${summary.avgLatency}ms`}
            sub="per LLM call"
            tone="text-amber-300"
          />
          <SummaryStat
            icon={<Activity className="h-3 w-3" />}
            label="LLM Success"
            value={`${summary.successRate}%`}
            sub={`${summary.llmCallCount} calls`}
            tone="text-emerald-300"
          />
        </div>

        {/* 2×2 chart grid */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <ChartCard
            title="Token Usage by Agent"
            subtitle="top 10 consumers"
            empty={tokenByAgent.length === 0}
            emptyText="No token usage yet"
            emptyIcon={<Inbox className="h-5 w-5" />}
          >
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={tokenByAgent}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 9, fill: "#a1a1aa" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => compact(v)}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 9, fill: "#a1a1aa" }}
                  tickLine={false}
                  axisLine={false}
                  width={110}
                />
                <Tooltip
                  cursor={{ fill: "rgba(139, 92, 246, 0.08)" }}
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value: number, _name, props) => [
                    `${value.toLocaleString()} tokens`,
                    `${(props?.payload as { model?: string })?.model ?? "—"}`,
                  ]}
                />
                <Bar dataKey="tokens" fill={COLORS.violet} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Task Completion vs Error Rate"
            subtitle="by department"
            empty={departmentData.length === 0}
            emptyText="No department data yet"
            emptyIcon={<Inbox className="h-5 w-5" />}
          >
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={departmentData}
                margin={{ top: 4, right: 8, bottom: 4, left: -16 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="department"
                  tick={{ fontSize: 8, fill: "#a1a1aa" }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  angle={-30}
                  textAnchor="end"
                  height={50}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: "#a1a1aa" }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Legend
                  wrapperStyle={{ fontSize: 9, fontFamily: "var(--font-mono)", paddingTop: 4 }}
                />
                <Bar dataKey="completed" name="Completed" fill={COLORS.emerald} radius={[2, 2, 0, 0]} />
                <Bar dataKey="errors" name="Errors" fill={COLORS.rose} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="LLM Provider Distribution"
            subtitle="calls per provider"
            empty={providerData.length === 0}
            emptyText="No LLM calls yet"
            emptyIcon={<Inbox className="h-5 w-5" />}
          >
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={providerData}
                  dataKey="count"
                  nameKey="provider"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={85}
                  paddingAngle={2}
                  stroke="var(--surface)"
                  strokeWidth={2}
                >
                  {providerData.map((d) => (
                    <Cell key={d.provider} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value: number, name: string) => [
                    `${value} calls`,
                    name,
                  ]}
                />
                <Legend
                  wrapperStyle={{ fontSize: 9, fontFamily: "var(--font-mono)", paddingTop: 4 }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Center total overlay (positioned absolutely over the donut hole) */}
            {totalCalls > 0 && (
              <div className="pointer-events-none absolute inset-x-0 top-[60px] flex flex-col items-center">
                <span className="font-mono text-xl font-bold tabular-nums text-foreground">
                  {totalCalls}
                </span>
                <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  total calls
                </span>
              </div>
            )}
          </ChartCard>

          <ChartCard
            title="LLM Call Latency Over Time"
            subtitle="last 50 calls"
            empty={latencyOverTime.length === 0}
            emptyText="No LLM calls yet"
            emptyIcon={<Inbox className="h-5 w-5" />}
          >
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart
                data={latencyOverTime}
                margin={{ top: 4, right: 8, bottom: 4, left: -16 }}
              >
                <defs>
                  <linearGradient id="latencyGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.cyan} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={COLORS.cyan} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="t"
                  tick={{ fontSize: 8, fill: "#a1a1aa" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  minTickGap={32}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: "#a1a1aa" }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  tickFormatter={(v: number) => `${v}ms`}
                />
                <Tooltip
                  cursor={{ stroke: "rgba(34, 211, 238, 0.4)" }}
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value: number, _name, props) => {
                    const p = props?.payload as { provider?: string; model?: string };
                    return [`${value}ms`, `${p?.provider ?? ""} / ${p?.model ?? ""}`];
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="latency"
                  stroke={COLORS.cyan}
                  strokeWidth={2}
                  fill="url(#latencyGrad)"
                  dot={false}
                  activeDot={{ r: 3, fill: COLORS.cyan }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>
    </FullScreenPanel>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

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
      className="rounded-lg border border-border/50 bg-surface-2 p-2.5"
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

function ChartCard({
  title,
  subtitle,
  empty,
  emptyText,
  emptyIcon,
  children,
}: {
  title: string;
  subtitle: string;
  empty: boolean;
  emptyText: string;
  emptyIcon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mc-glow-card relative rounded-lg border border-border/60 bg-surface-2 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground">
          {title}
        </span>
        <span className="font-mono text-[9px] text-muted-foreground">{subtitle}</span>
      </div>
      {empty ? (
        <div className="flex h-[240px] flex-col items-center justify-center gap-2 font-mono text-[10px] text-muted-foreground">
          <span className="opacity-40">{emptyIcon}</span>
          <span>{emptyText}</span>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export default AgentAnalyticsPanel;
