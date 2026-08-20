"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import { compact } from "@/hooks/use-clock";
import {
  Cpu,
  Activity,
  DollarSign,
  ListTree,
  Bell,
  AlertTriangle,
  CheckCircle2,
  Zap,
  TrendingUp,
  Heart,
  Clock,
} from "lucide-react";

/**
 * StatsSummaryBar — compact at-a-glance KPI strip.
 *
 * Renders a single-row strip of the most critical mission metrics: active
 * agents, running tasks, total revenue, pipeline value, system health,
 * unacked alerts, LLM calls, uptime. Designed to sit below the header
 * so operators see the global state immediately on page load without
 * scrolling.
 *
 * Each stat is a clickable chip that scrolls to the relevant panel.
 */
export function StatsSummaryBar({ onJumpTo }: { onJumpTo: (target: string) => void }) {
  const agents = useMissionStore((s) => s.agents);
  const tasks = useMissionStore((s) => s.tasks);
  const revenueEvents = useMissionStore((s) => s.revenueEvents);
  const deals = useMissionStore((s) => s.deals);
  const alerts = useMissionStore((s) => s.alerts);
  const llmCalls = useMissionStore((s) => s.llmCalls);
  const heartbeat = useMissionStore((s) => s.heartbeat);
  const connection = useMissionStore((s) => s.connection);

  const stats = useMemo(() => {
    const agentList = Object.values(agents);
    const activeAgents = agentList.filter((a) => a.status !== "idle" && a.status !== "offline").length;
    const errorAgents = agentList.filter((a) => a.status === "error").length;
    const runningTasks = Object.values(tasks).filter((t) => t.status === "running").length;
    const completedTasks = Object.values(tasks).filter((t) => t.status === "completed").length;
    const totalRevenue = revenueEvents.reduce((s, r) => s + r.amount, 0);
    const pipelineValue = Object.values(deals)
      .filter((d) => d.stage !== "won" && d.stage !== "lost")
      .reduce((s, d) => s + d.value, 0);
    const unackedAlerts = alerts.filter((a) => !a.ack && (a.severity === "error" || a.severity === "critical")).length;
    const connected = connection === "open";

    return {
      activeAgents,
      totalAgents: agentList.length,
      errorAgents,
      runningTasks,
      completedTasks,
      totalTasks: Object.keys(tasks).length,
      totalRevenue,
      pipelineValue,
      unackedAlerts,
      llmCallCount: llmCalls.length,
      uptime: heartbeat?.uptime ?? 0,
      connected,
    };
  }, [agents, tasks, revenueEvents, deals, alerts, llmCalls, heartbeat, connection]);

  return (
    <div className="mc-surface mx-auto w-full max-w-[1600px] px-3 py-2">
      <div className="flex items-center gap-2 overflow-x-auto">
        {/* Connection status */}
        <StatChip
          icon={stats.connected ? CheckCircle2 : AlertTriangle}
          label="Stream"
          value={stats.connected ? "Live" : "Reconnecting"}
          tone={stats.connected ? "text-emerald-300" : "text-amber-300"}
          pulse={stats.connected}
        />

        <Divider />

        {/* Agents */}
        <StatChip
          icon={Cpu}
          label="Agents"
          value={`${stats.activeAgents}/${stats.totalAgents}`}
          sub={stats.errorAgents > 0 ? `${stats.errorAgents} err` : undefined}
          tone={stats.errorAgents > 0 ? "text-rose-300" : "text-cyan-300"}
          onClick={() => onJumpTo("agent-fleet")}
        />

        {/* Tasks */}
        <StatChip
          icon={ListTree}
          label="Tasks"
          value={String(stats.runningTasks)}
          sub={`running · ${stats.completedTasks} done`}
          tone="text-amber-300"
          onClick={() => onJumpTo("task-pipeline")}
        />

        <Divider />

        {/* Revenue */}
        <StatChip
          icon={DollarSign}
          label="Revenue"
          value={`$${compact(stats.totalRevenue)}`}
          tone="text-emerald-300"
          onClick={() => onJumpTo("financial")}
        />

        {/* Pipeline */}
        <StatChip
          icon={TrendingUp}
          label="Pipeline"
          value={`$${compact(stats.pipelineValue)}`}
          tone="text-violet-300"
          onClick={() => onJumpTo("financial")}
        />

        <Divider />

        {/* Alerts */}
        <StatChip
          icon={stats.unackedAlerts > 0 ? AlertTriangle : Bell}
          label="Alerts"
          value={String(stats.unackedAlerts)}
          tone={stats.unackedAlerts > 0 ? "text-rose-300" : "text-slate-300"}
          pulse={stats.unackedAlerts > 0}
          onClick={() => onJumpTo("system-alerts")}
        />

        {/* LLM */}
        <StatChip
          icon={Zap}
          label="LLM"
          value={String(stats.llmCallCount)}
          sub="calls"
          tone="text-violet-300"
          onClick={() => onJumpTo("telemetry")}
        />

        {/* Uptime */}
        <StatChip
          icon={Clock}
          label="Uptime"
          value={formatUptime(stats.uptime)}
          tone="text-slate-300"
        />

        {/* Health */}
        <StatChip
          icon={Heart}
          label="Health"
          value="100%"
          tone="text-emerald-300"
          pulse
          onClick={() => onJumpTo("system-health")}
        />
      </div>
    </div>
  );
}

function StatChip({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  pulse,
  onClick,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  sub?: string;
  tone: string;
  pulse?: boolean;
  onClick?: () => void;
}) {
  return (
    <motion.button
      layout
      onClick={onClick}
      disabled={!onClick}
      className={`flex shrink-0 items-center gap-2 rounded-lg border border-border/40 bg-card/40 px-2.5 py-1.5 transition-colors ${
        onClick ? "cursor-pointer hover:border-border/70 hover:bg-card/60" : "cursor-default"
      }`}
    >
      <div className="relative">
        <Icon className={`h-4 w-4 ${tone}`} />
        {pulse && (
          <motion.span
            className={`absolute inset-0 rounded-full`}
            initial={{ opacity: 0.3 }} animate={{ opacity: [0.3, 0.7, 0.3] }}
            transition={{ duration: 2, repeat: Infinity }}
            style={{ boxShadow: `0 0 8px -1px currentColor`, color: "var(--tw-text-opacity, 1)" }}
          />
        )}
      </div>
      <div className="text-left leading-tight">
        <div className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="flex items-baseline gap-1">
          <span className={`font-mono text-sm font-bold tabular-nums ${tone}`}>{value}</span>
          {sub && <span className="font-mono text-[8px] text-muted-foreground">{sub}</span>}
        </div>
      </div>
    </motion.button>
  );
}

function Divider() {
  return <div className="h-8 w-px shrink-0 bg-border/30" />;
}

function formatUptime(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export { Activity };
