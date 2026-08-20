"use client";

import { useMissionStore } from "@/stores/mission-store";
import { useMemo } from "react";
import { Users, Activity, Clock, DollarSign, Bell, CheckCircle2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface StatConfig {
  label: string;
  value: string;
  subValue?: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
  borderColor: string;
}

/**
 * PrimaryStatsBar — horizontal grid of high-level metrics.
 *
 * Displays: Agents (active/total), Active Tasks, Pending Approvals,
 * Revenue, Pipeline Value, Active Alerts.
 *
 * This REPLACES the duplicate stats that were in both the header and
 * the dashboard grid. The header now only has Health + Uptime; this
 * bar has the operational metrics.
 */
export function PrimaryStatsBar({ onJumpTo }: { onJumpTo?: (target: string) => void }) {
  const agents = useMissionStore((s) => s.agents);
  const tasks = useMissionStore((s) => s.tasks);
  const approvals = useMissionStore((s) => s.approvals);
  const alerts = useMissionStore((s) => s.alerts);
  const revenueEvents = useMissionStore((s) => s.revenueEvents);
  const deals = useMissionStore((s) => s.deals);

  const stats = useMemo<StatConfig[]>(() => {
    const agentArr = Object.values(agents);
    const activeAgents = agentArr.filter((a) => a.status !== "idle" && a.status !== "offline").length;
    const runningTasks = Object.values(tasks).filter((t) => t.status === "running").length;
    const pendingApprovals = Object.values(approvals).filter((a) => a.status === "pending").length;
    const totalRevenue = revenueEvents.reduce((s, r) => s + r.amount, 0);
    const pipelineValue = Object.values(deals)
      .filter((d) => d.stage !== "won" && d.stage !== "lost")
      .reduce((s, d) => s + d.value, 0);
    const activeAlerts = alerts.filter((a) => !a.ack && (a.severity === "error" || a.severity === "critical")).length;

    return [
      {
        label: "Agents",
        value: `${activeAgents}`,
        subValue: `/ ${agentArr.length} total`,
        icon: Users,
        color: "text-violet-400",
        bgColor: "bg-violet-500/5",
        borderColor: "border-violet-500/20",
      },
      {
        label: "Active Tasks",
        value: `${runningTasks}`,
        subValue: Object.values(tasks).length > 0 ? `${Object.values(tasks).length} total` : undefined,
        icon: Activity,
        color: "text-cyan-400",
        bgColor: "bg-cyan-500/5",
        borderColor: "border-cyan-500/20",
      },
      {
        label: "Pending Approvals",
        value: `${pendingApprovals}`,
        subValue: pendingApprovals > 0 ? "needs attention" : "all clear",
        icon: CheckCircle2,
        color: pendingApprovals > 0 ? "text-amber-400" : "text-emerald-400",
        bgColor: pendingApprovals > 0 ? "bg-amber-500/5" : "bg-emerald-500/5",
        borderColor: pendingApprovals > 0 ? "border-amber-500/20" : "border-emerald-500/20",
      },
      {
        label: "Revenue",
        value: formatCurrency(totalRevenue),
        subValue: "total",
        icon: DollarSign,
        color: "text-emerald-400",
        bgColor: "bg-emerald-500/5",
        borderColor: "border-emerald-500/20",
      },
      {
        label: "Pipeline",
        value: formatCurrency(pipelineValue),
        subValue: `${Object.values(deals).filter((d) => d.stage !== "won" && d.stage !== "lost").length} deals`,
        icon: DollarSign,
        color: "text-cyan-400",
        bgColor: "bg-cyan-500/5",
        borderColor: "border-cyan-500/20",
      },
      {
        label: "Active Alerts",
        value: `${activeAlerts}`,
        subValue: activeAlerts > 0 ? "unacknowledged" : "all clear",
        icon: Bell,
        color: activeAlerts > 0 ? "text-rose-400" : "text-emerald-400",
        bgColor: activeAlerts > 0 ? "bg-rose-500/5" : "bg-emerald-500/5",
        borderColor: activeAlerts > 0 ? "border-rose-500/20" : "border-emerald-500/20",
      },
    ];
  }, [agents, tasks, approvals, alerts, revenueEvents, deals]);

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 mc-scroll md:grid md:grid-cols-6 md:overflow-visible">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <button
            key={stat.label}
            onClick={() => onJumpTo?.(stat.label.toLowerCase().replace(/\s+/g, "-"))}
            className={`flex shrink-0 items-center gap-2 rounded-lg border ${stat.borderColor} ${stat.bgColor} px-2.5 py-2 text-left transition-colors hover:border-strong md:w-auto md:shrink`}
            style={{ minWidth: "0" }}
          >
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${stat.bgColor} ${stat.borderColor} border`}>
              <Icon className={`h-3.5 w-3.5 ${stat.color}`} />
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[9px] uppercase tracking-wider text-muted-foreground">{stat.label}</div>
              <div className="flex items-baseline gap-1">
                <span className="text-sm font-bold tabular-nums text-foreground">{stat.value}</span>
                {stat.subValue && (
                  <span className="truncate text-[9px] text-muted-foreground">{stat.subValue}</span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}k`;
  return `$${amount.toLocaleString()}`;
}
