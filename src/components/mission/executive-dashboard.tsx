"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import {
  Users,
  DollarSign,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Activity,
  Cpu,
  Target,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { FullScreenPanel } from "./full-screen-panel";
import { compact } from "@/hooks/use-clock";

/**
 * ExecutiveDashboard — C-level overview panel.
 *
 * Combines the most critical metrics into a single glanceable panel
 * for executives. Shows: revenue, pipeline, agent health, task velocity,
 * LLM cost efficiency, alert count, and a trend indicator per metric.
 *
 * All data derived from the Zustand store — no API calls needed.
 */
export function ExecutiveDashboard() {
  const agents = useMissionStore((s) => s.agents);
  const tasks = useMissionStore((s) => s.tasks);
  const approvals = useMissionStore((s) => s.approvals);
  const alerts = useMissionStore((s) => s.alerts);
  const revenueEvents = useMissionStore((s) => s.revenueEvents);
  const deals = useMissionStore((s) => s.deals);
  const llmCalls = useMissionStore((s) => s.llmCalls);

  const metrics = useMemo(() => {
    const agentList = Object.values(agents);
    const activeAgents = agentList.filter((a) => a.status !== "idle" && a.status !== "offline").length;
    const errorAgents = agentList.filter((a) => a.status === "error").length;
    const taskList = Object.values(tasks);
    const completedTasks = taskList.filter((t) => t.status === "completed").length;
    const runningTasks = taskList.filter((t) => t.status === "running").length;
    const pendingApprovals = Object.values(approvals).filter((a) => a.status === "pending").length;
    const unackedAlerts = alerts.filter((a) => !a.ack).length;
    const criticalAlerts = alerts.filter((a) => !a.ack && a.severity === "critical").length;
    const totalRevenue = revenueEvents.reduce((s, r) => s + r.amount, 0);
    const pipelineValue = Object.values(deals)
      .filter((d) => d.stage !== "won" && d.stage !== "lost")
      .reduce((s, d) => s + d.value, 0);
    const llmSuccessRate = llmCalls.length > 0
      ? (llmCalls.filter((c) => c.status === "ok").length / llmCalls.length) * 100
      : 100;

    return [
      {
        label: "Total Revenue",
        value: compact(totalRevenue),
        sub: `${revenueEvents.length} events`,
        icon: DollarSign,
        tone: "emerald" as const,
        trend: revenueEvents.length > 5 ? "up" : "flat" as const,
      },
      {
        label: "Pipeline Value",
        value: compact(pipelineValue),
        sub: `${Object.values(deals).filter((d) => d.stage !== "won" && d.stage !== "lost").length} deals`,
        icon: TrendingUp,
        tone: "cyan" as const,
        trend: "flat" as const,
      },
      {
        label: "Active Agents",
        value: `${activeAgents}`,
        sub: `/ ${agentList.length} total`,
        icon: Users,
        tone: activeAgents > agentList.length * 0.5 ? "emerald" : "amber" as const,
        trend: activeAgents > 20 ? "up" : "flat" as const,
      },
      {
        label: "Task Velocity",
        value: `${completedTasks}`,
        sub: `${runningTasks} running`,
        icon: CheckCircle2,
        tone: "violet" as const,
        trend: completedTasks > 50 ? "up" : "flat" as const,
      },
      {
        label: "LLM Success",
        value: `${llmSuccessRate.toFixed(0)}%`,
        sub: `${llmCalls.length} calls`,
        icon: Cpu,
        tone: llmSuccessRate > 80 ? "emerald" : "amber" as const,
        trend: llmSuccessRate > 80 ? "up" : "down" as const,
      },
      {
        label: "Pending Approvals",
        value: `${pendingApprovals}`,
        sub: pendingApprovals > 0 ? "needs attention" : "all clear",
        icon: Target,
        tone: pendingApprovals > 0 ? "amber" : "emerald" as const,
        trend: pendingApprovals > 0 ? "down" : "flat" as const,
      },
      {
        label: "Critical Alerts",
        value: `${criticalAlerts}`,
        sub: `${unackedAlerts} unacked`,
        icon: AlertTriangle,
        tone: criticalAlerts > 0 ? "rose" : "emerald" as const,
        trend: criticalAlerts > 0 ? "down" : "flat" as const,
      },
      {
        label: "Error Agents",
        value: `${errorAgents}`,
        sub: errorAgents > 0 ? "needs healing" : "healthy",
        icon: Zap,
        tone: errorAgents > 0 ? "rose" : "emerald" as const,
        trend: errorAgents > 0 ? "down" : "flat" as const,
      },
    ];
  }, [agents, tasks, approvals, alerts, revenueEvents, deals, llmCalls]);

  const toneClass = {
    emerald: "border-emerald-500/20 bg-emerald-500/5 text-emerald-400",
    amber: "border-amber-500/20 bg-amber-500/5 text-amber-400",
    rose: "border-rose-500/20 bg-rose-500/5 text-rose-400",
    cyan: "border-cyan-500/20 bg-cyan-500/5 text-cyan-400",
    violet: "border-violet-500/20 bg-violet-500/5 text-violet-400",
  };

  return (
    <FullScreenPanel title="Executive Dashboard" icon={<Activity className="h-3.5 w-3.5 text-violet-400" />}>
      <div className="space-y-4 p-4">
        {/* Metric cards grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {metrics.map((m, i) => {
            const Icon = m.icon;
            return (
              <motion.div
                key={m.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: i * 0.05 }}
                className={`mc-glow-card rounded-lg border p-3 ${toneClass[m.tone]}`}
              >
                <div className="flex items-center justify-between">
                  <Icon className="h-4 w-4" />
                  {m.trend === "up" && <TrendingUp className="h-3 w-3 text-emerald-400" />}
                  {m.trend === "down" && <TrendingDown className="h-3 w-3 text-rose-400" />}
                </div>
                <div className="mt-2 font-mono text-xl font-bold tabular-nums text-foreground">
                  {m.value}
                </div>
                <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  {m.label}
                </div>
                <div className="mt-0.5 truncate font-mono text-[8px] text-muted-foreground/60">
                  {m.sub}
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* System health summary */}
        <div className="rounded-lg border border-border/60 bg-surface-2 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-cyan-400" />
            <h3 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground">
              System Health Summary
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
            <HealthStat label="Fleet" value={`${metrics[2].value}/${Object.keys(agents).length}`} tone="emerald" />
            <HealthStat label="Throughput" value={`${metrics[3].value} tasks`} tone="violet" />
            <HealthStat label="Reliability" value={metrics[4].value} tone={metrics[4].tone as "emerald" | "amber" | "rose" | "cyan" | "violet"} />
            <HealthStat label="Alerts" value={`${metrics[6].value} crit`} tone={metrics[6].tone as "emerald" | "amber" | "rose" | "cyan" | "violet"} />
          </div>
        </div>

        <div className="font-mono text-[9px] text-muted-foreground/60">
          All metrics are derived from the live Zustand store — no API calls. Data updates in real-time via SSE.
        </div>
      </div>
    </FullScreenPanel>
  );
}

function HealthStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "amber" | "rose" | "cyan" | "violet";
}) {
  const toneClass = {
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    rose: "text-rose-400",
    cyan: "text-cyan-400",
    violet: "text-violet-400",
  }[tone];
  return (
    <div className="rounded border border-border/40 bg-background/40 px-2 py-1.5">
      <div className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-mono text-xs font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

export default ExecutiveDashboard;
