"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import { compact } from "@/hooks/use-clock";
import { CalendarDays, Activity, Clock } from "lucide-react";

/**
 * ActivityHeatmap — time-of-day activity grid.
 *
 * Shows a heatmap of agent activity by hour-of-day × day-of-week (or
 * a compact hour × agent grid). Each cell's intensity encodes the number
 * of events (logs, metrics, messages) that occurred in that hour. This
 * answers: "when is the autonomous fleet most active?"
 *
 * Data is derived from the store's logs + agentMessages + metrics slices,
 * bucketed by the hour-of-day extracted from each event's createdAt.
 */

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_LABELS = ["00", "02", "04", "06", "08", "10", "12", "14", "16", "18", "20", "22"];

export function ActivityHeatmap() {
  const logs = useMissionStore((s) => s.logs);
  const agentMessages = useMissionStore((s) => s.agentMessages);
  const metrics = useMissionStore((s) => s.metrics);
  const agents = useMissionStore((s) => s.agents);

  const { hourCounts, maxCount, peakHour, totalEvents, agentActivity } = useMemo(() => {
    const counts = new Array(24).fill(0);
    const agentMap = new Map<string, number[]>();

    const bucket = (iso: string | null | undefined) => {
      if (!iso) return;
      const hour = new Date(iso).getHours();
      if (hour >= 0 && hour < 24) counts[hour] += 1;
    };

    for (const l of logs) bucket(l.createdAt);
    for (const m of agentMessages) bucket(m.createdAt);
    for (const m of metrics) bucket(m.createdAt);

    // Per-agent activity (total events attributed).
    const agentList = Object.values(agents);
    for (const a of agentList) {
      // Approximate: attribute logs by agentId.
      const agentLogs = logs.filter((l) => l.agentId === a.id);
      agentMap.set(a.id, new Array(24).fill(0));
      for (const l of agentLogs) {
        if (!l.createdAt) continue;
        const hour = new Date(l.createdAt).getHours();
        if (hour >= 0 && hour < 24) {
          agentMap.get(a.id)![hour] += 1;
        }
      }
    }

    const max = Math.max(1, ...counts);
    const peak = counts.indexOf(max);
    const total = counts.reduce((a, b) => a + b, 0);

    return {
      hourCounts: counts,
      maxCount: max,
      peakHour: peak,
      totalEvents: total,
      agentActivity: agentList
        .map((a) => ({ agent: a, hours: agentMap.get(a.id) ?? new Array(24).fill(0) }))
        .sort((a, b) => b.hours.reduce((s, h) => s + h, 0) - a.hours.reduce((s, h) => s + h, 0))
        .slice(0, 6),
    };
  }, [logs, agentMessages, metrics, agents]);

  const intensity = (count: number) => {
    if (count === 0) return 0;
    return Math.min(1, count / maxCount);
  };

  const cellColor = (intensity: number) => {
    if (intensity === 0) return "oklch(1 0 0 / 0.02)";
    // Gradient from dim cyan to bright cyan based on intensity.
    const l = 0.25 + intensity * 0.5;
    const c = 0.05 + intensity * 0.13;
    return `oklch(${l} ${c} 195)`;
  };

  return (
    <section className="mc-surface flex flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-cyan-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Activity Heatmap
          </h2>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Activity className="h-3 w-3" /> {compact(totalEvents)} events
          </span>
          <span className="text-border">·</span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3 text-amber-300" /> peak {peakHour.toString().padStart(2, "0")}:00
          </span>
        </div>
      </div>

      <div className="p-4">
        {/* Hourly activity strip */}
        <div className="mb-3">
          <div className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            Events by hour (UTC)
          </div>
          <div className="flex items-end gap-px">
            {HOURS.map((hour) => {
              const count = hourCounts[hour];
              const int = intensity(count);
              const height = Math.max(4, int * 48);
              const isPeak = hour === peakHour;
              return (
                <div key={hour} className="group relative flex flex-1 flex-col items-center">
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height }}
                    transition={{ duration: 0.4, delay: hour * 0.01 }}
                    className="w-full rounded-t-sm"
                    style={{ background: cellColor(int), minHeight: 4 }}
                  />
                  {isPeak && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.5 }}
                      className="absolute -top-5 whitespace-nowrap rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 font-mono text-[8px] text-amber-300"
                    >
                      peak
                    </motion.div>
                  )}
                  {/* Tooltip on hover */}
                  <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 rounded border border-border/60 bg-popover/95 px-1.5 py-0.5 font-mono text-[8px] text-foreground opacity-0 transition-opacity group-hover:opacity-100">
                    {hour.toString().padStart(2, "0")}:00 · {count}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between font-mono text-[8px] text-muted-foreground/60">
            {HOUR_LABELS.map((h) => (
              <span key={h}>{h}</span>
            ))}
          </div>
        </div>

        {/* Per-agent heatmap grid */}
        <div>
          <div className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            Top agents by activity
          </div>
          <div className="mc-scroll overflow-x-auto">
            <div className="min-w-[400px]">
              {/* Hour headers */}
              <div className="mb-1 flex items-center gap-px pl-20">
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="flex-1 text-center font-mono text-[7px] text-muted-foreground/50"
                  >
                    {hour % 3 === 0 ? hour.toString().padStart(2, "0") : ""}
                  </div>
                ))}
              </div>
              {/* Agent rows */}
              {agentActivity.map(({ agent, hours }) => (
                <div key={agent.id} className="mb-px flex items-center gap-px">
                  <div className="w-20 shrink-0 truncate pr-2 font-mono text-[9px] text-muted-foreground">
                    {agent.name.replace(/^Aria-|^Forge-|^Nova-|^Pulse-|^Ledger-|^Vector-|^Echo-/, "")}
                  </div>
                  {hours.map((count, hour) => {
                    const int = intensity(count);
                    return (
                      <motion.div
                        key={hour}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: hour * 0.005 }}
                        className="group relative h-4 flex-1 rounded-sm"
                        style={{ background: cellColor(int) }}
                        title={`${agent.name} @ ${hour.toString().padStart(2, "0")}:00 · ${count} events`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Intensity legend */}
        <div className="mt-3 flex items-center justify-between font-mono text-[9px] text-muted-foreground">
          <span>less</span>
          <div className="flex items-center gap-px">
            {[0, 0.2, 0.4, 0.6, 0.8, 1].map((i) => (
              <div key={i} className="h-3 w-6 rounded-sm" style={{ background: cellColor(i) }} />
            ))}
          </div>
          <span>more</span>
        </div>
      </div>
    </section>
  );
}
