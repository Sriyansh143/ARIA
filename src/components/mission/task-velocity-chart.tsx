"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import { compact } from "@/hooks/use-clock";
import { TrendingDown, Activity, Gauge, Zap } from "lucide-react";
import {
  Area,
  AreaChart,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

/**
 * TaskVelocityChart — completion velocity + cumulative burndown.
 *
 * Buckets tasks by creation time and computes:
 *  1. Per-bucket completion count (velocity bars)
 *  2. Cumulative completed vs total (burndown lines)
 *  3. Remaining work trend
 *
 * This shows whether the autonomous fleet is accelerating, steady, or
 * stalling — the burndown line trending to zero means the pipeline is
 * clearing. Renders as a composed chart (bars + lines) with a gradient
 * velocity area + dual burndown lines.
 */
export function TaskVelocityChart() {
  const tasks = useMissionStore((s) => s.tasks);

  const { series, totalCompleted, totalTasks, velocityRate, remaining } = useMemo(() => {
    const taskList = Object.values(tasks);
    if (taskList.length === 0) {
      return { series: [], totalCompleted: 0, totalTasks: 0, velocityRate: 0, remaining: 0 };
    }

    // Bucket by 10-min windows based on createdAt.
    const buckets = new Map<string, { created: number; completed: number; ts: number }>();
    for (const t of taskList) {
      const ts = new Date(t.createdAt).getTime();
      const bucketKey = new Date(Math.floor(ts / 600000) * 600000).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const bucket = buckets.get(bucketKey) ?? { created: 0, completed: 0, ts: Math.floor(ts / 600000) * 600000 };
      bucket.created += 1;
      if (t.status === "completed") {
        bucket.completed += 1;
      }
      buckets.set(bucketKey, bucket);
    }

    // Sort by timestamp and compute cumulative via a scan (prefix-sum) approach.
    const sorted = Array.from(buckets.entries()).sort((a, b) => a[1].ts - b[1].ts);
    const series: Array<{
      t: string;
      velocity: number;
      created: number;
      cumulativeCompleted: number;
      cumulativeTotal: number;
      remaining: number;
    }> = [];
    let accCreated = 0;
    let accCompleted = 0;
    for (const [key, b] of sorted) {
      accCreated += b.created;
      accCompleted += b.completed;
      series.push({
        t: key,
        velocity: b.completed,
        created: b.created,
        cumulativeCompleted: accCompleted,
        cumulativeTotal: accCreated,
        remaining: accCreated - accCompleted,
      });
    }

    const totalCompleted = taskList.filter((t) => t.status === "completed").length;
    const totalTasks = taskList.length;
    const remaining = totalTasks - totalCompleted;
    // Velocity = completions per bucket
    const completedBuckets = series.filter((s) => s.velocity > 0).length;
    const velocityRate = completedBuckets > 0 ? totalCompleted / completedBuckets : 0;

    return { series, totalCompleted, totalTasks, velocityRate, remaining };
  }, [tasks]);

  const completionRate = totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0;

  return (
    <section className="mc-surface flex flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-emerald-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Task Velocity & Burndown
          </h2>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {totalTasks} total · {totalCompleted} done
        </span>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-2 border-b border-border/60 px-3 py-2.5 lg:grid-cols-4">
        <Kpi icon={Activity} label="Completion Rate" value={`${completionRate}%`} sub={`${totalCompleted}/${totalTasks}`} tone="text-emerald-300" />
        <Kpi icon={Zap} label="Velocity" value={velocityRate.toFixed(1)} sub="tasks/bucket" tone="text-cyan-300" />
        <Kpi icon={Gauge} label="Remaining" value={String(remaining)} sub="in pipeline" tone={remaining > 5 ? "text-amber-300" : "text-emerald-300"} />
        <Kpi icon={TrendingDown} label="Trajectory" value={remaining === 0 ? "Cleared" : remaining < totalTasks / 2 ? "On track" : "Behind"} sub="burndown" tone={remaining === 0 ? "text-emerald-300" : remaining < totalTasks / 2 ? "text-emerald-300" : "text-amber-300"} />
      </div>

      {/* Chart */}
      <div className="p-3">
        {series.length < 2 ? (
          <div className="flex h-[200px] items-center justify-center font-mono text-[10px] text-muted-foreground">
            awaiting sufficient task data for burndown…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="velGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.78 0.16 195)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="oklch(0.78 0.16 195)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.06)" />
              <XAxis
                dataKey="t"
                tick={{ fontSize: 8, fill: "oklch(0.64 0.012 250)" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={20}
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 8, fill: "oklch(0.64 0.012 250)" }}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 8, fill: "oklch(0.64 0.012 250)" }}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip
                contentStyle={{
                  background: "oklch(0.235 0.016 250)",
                  border: "1px solid oklch(1 0 0 / 0.1)",
                  borderRadius: 8,
                  fontSize: 11,
                  fontFamily: "var(--font-geist-mono)",
                }}
              />
              {/* Velocity bars (per-bucket completions) */}
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="velocity"
                stroke="oklch(0.78 0.16 195)"
                strokeWidth={1.5}
                fill="url(#velGrad)"
                name="Velocity"
              />
              {/* Cumulative completed line */}
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="cumulativeCompleted"
                stroke="oklch(0.75 0.16 150)"
                strokeWidth={2.5}
                dot={false}
                name="Cumulative Done"
              />
              {/* Cumulative total line */}
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="cumulativeTotal"
                stroke="oklch(0.7 0.18 300)"
                strokeWidth={2}
                strokeDasharray="4 2"
                dot={false}
                name="Cumulative Total"
              />
              {/* Remaining line (burndown) */}
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="remaining"
                stroke="oklch(0.68 0.22 18)"
                strokeWidth={2}
                dot={false}
                name="Remaining"
              />
              {remaining === 0 && <ReferenceLine y={0} yAxisId="right" stroke="oklch(0.75 0.16 150)" strokeDasharray="2 2" />}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-4 py-2 font-mono text-[9px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm bg-cyan-400/40" /> Velocity (completions/bucket)
        </span>
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-4 rounded-sm bg-emerald-400" /> Cumulative done
        </span>
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-4 rounded-sm bg-violet-400" style={{ borderTop: "1px dashed" }} /> Cumulative total
        </span>
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-4 rounded-sm bg-rose-400" /> Remaining (burndown)
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
  icon: typeof Activity;
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

export { compact };
