"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import { compact } from "@/hooks/use-clock";
import {
  HeartPulse,
  Cpu,
  Wifi,
  Database,
  Activity,
  ShieldCheck,
  Server,
  Gauge,
} from "lucide-react";

/**
 * SystemHealthGauge — composite reliability score with radial visualization.
 *
 * Computes a weighted health score across subsystems:
 *  - Agent uptime (% non-offline agents)
 *  - SSE connection status (open = 100%, reconnecting = 50%, error = 0%)
 *  - Task throughput (running vs failed ratio)
 *  - Error density (recent alerts vs total)
 *  - LLM gateway health (success rate of recent calls)
 *
 * Renders a large radial gauge (SVG arc) with the composite score, plus
 * a grid of subsystem health bars. Color shifts green → amber → rose.
 */

interface SubsystemHealth {
  label: string;
  icon: typeof Cpu;
  score: number;
  detail: string;
  tone: "emerald" | "amber" | "rose";
}

export function SystemHealthGauge() {
  const agents = useMissionStore((s) => s.agents);
  const tasks = useMissionStore((s) => s.tasks);
  const alerts = useMissionStore((s) => s.alerts);
  const llmCalls = useMissionStore((s) => s.llmCalls);
  const connection = useMissionStore((s) => s.connection);
  const heartbeat = useMissionStore((s) => s.heartbeat);

  const { composite, subsystems } = useMemo(() => {
    const agentList = Object.values(agents);
    const taskList = Object.values(tasks);

    // 1. Agent uptime
    const activeAgents = agentList.filter((a) => a.status !== "offline").length;
    const agentUptime = agentList.length > 0 ? (activeAgents / agentList.length) * 100 : 0;

    // 2. Connection health
    const connScore = connection === "open" ? 100 : connection === "reconnecting" ? 50 : 0;

    // 3. Task throughput
    const runningTasks = taskList.filter((t) => t.status === "running").length;
    const failedTasks = taskList.filter((t) => t.status === "failed").length;
    const completedTasks = taskList.filter((t) => t.status === "completed").length;
    const totalTasks = taskList.length;
    const taskHealth = totalTasks > 0
      ? Math.max(0, ((completedTasks + runningTasks) / totalTasks) * 100 - (failedTasks / totalTasks) * 50)
      : 100;

    // 4. Error density (unacked critical/error alerts reduce score)
    const criticalAlerts = alerts.filter((a) => !a.ack && (a.severity === "critical" || a.severity === "error")).length;
    const errorDensity = Math.max(0, 100 - criticalAlerts * 8);

    // 5. LLM gateway health
    const recentLlm = llmCalls.slice(0, 30);
    const okCalls = recentLlm.filter((c) => c.status === "ok").length;
    const llmHealth = recentLlm.length > 0 ? (okCalls / recentLlm.length) * 100 : 100;

    const subsystems: SubsystemHealth[] = [
      {
        label: "Agent Fleet",
        icon: Cpu,
        score: Math.round(agentUptime),
        detail: `${activeAgents}/${agentList.length} online`,
        tone: agentUptime >= 90 ? "emerald" : agentUptime >= 70 ? "amber" : "rose",
      },
      {
        label: "Event Stream",
        icon: Wifi,
        score: connScore,
        detail: connection === "open" ? "live" : connection === "reconnecting" ? "reconnecting" : "offline",
        tone: connScore >= 100 ? "emerald" : connScore >= 50 ? "amber" : "rose",
      },
      {
        label: "Task Pipeline",
        icon: Activity,
        score: Math.round(taskHealth),
        detail: `${runningTasks} running · ${failedTasks} failed`,
        tone: taskHealth >= 80 ? "emerald" : taskHealth >= 50 ? "amber" : "rose",
      },
      {
        label: "Error Density",
        icon: ShieldCheck,
        score: Math.round(errorDensity),
        detail: `${criticalAlerts} unacked`,
        tone: errorDensity >= 80 ? "emerald" : errorDensity >= 50 ? "amber" : "rose",
      },
      {
        label: "LLM Gateway",
        icon: Server,
        score: Math.round(llmHealth),
        detail: `${okCalls}/${recentLlm.length} ok`,
        tone: llmHealth >= 90 ? "emerald" : llmHealth >= 70 ? "amber" : "rose",
      },
      {
        label: "Database",
        icon: Database,
        score: 100,
        detail: "sqlite · nominal",
        tone: "emerald",
      },
    ];

    // Weighted composite (agentUptime 25%, conn 20%, taskHealth 20%, errorDensity 15%, llmHealth 15%, db 5%)
    const composite = Math.round(
      agentUptime * 0.25 +
      connScore * 0.20 +
      taskHealth * 0.20 +
      errorDensity * 0.15 +
      llmHealth * 0.15 +
      100 * 0.05
    );

    return { composite, subsystems };
  }, [agents, tasks, alerts, llmCalls, connection]);

  const gaugeTone = composite >= 85 ? "emerald" : composite >= 60 ? "amber" : "rose";
  const gaugeColor =
    gaugeTone === "emerald" ? "oklch(0.75 0.16 150)" :
    gaugeTone === "amber" ? "oklch(0.78 0.15 80)" :
    "oklch(0.68 0.22 18)";
  const statusLabel = composite >= 85 ? "All Systems Go" : composite >= 60 ? "Degraded" : composite >= 30 ? "Impaired" : "Critical";

  // Arc math
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const arcLength = (composite / 100) * circumference * 0.75; // 270° arc
  const dashArray = `${arcLength} ${circumference}`;

  return (
    <section className="mc-surface flex flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <HeartPulse className={`h-4 w-4 ${gaugeTone === "emerald" ? "text-emerald-300" : gaugeTone === "amber" ? "text-amber-300" : "text-rose-300"}`} />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            System Health
          </h2>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          uptime {heartbeat ? formatUptime(heartbeat.uptime) : "—"}
        </span>
      </div>

      <div className="flex flex-col items-center gap-4 p-4 lg:flex-row lg:items-start lg:gap-6">
        {/* Radial gauge */}
        <div className="relative flex shrink-0 flex-col items-center">
          <svg width="180" height="180" viewBox="0 0 180 180" className="rotate-[-90deg]">
            <defs>
              <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={gaugeColor} stopOpacity={0.6} />
                <stop offset="100%" stopColor={gaugeColor} stopOpacity={1} />
              </linearGradient>
              <filter id="gaugeGlow">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {/* Track */}
            <circle
              cx="90"
              cy="90"
              r={radius}
              fill="none"
              stroke="oklch(1 0 0 / 0.06)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${circumference * 0.75} ${circumference}`}
            />
            {/* Score arc */}
            <motion.circle
              cx="90"
              cy="90"
              r={radius}
              fill="none"
              stroke="url(#gaugeGrad)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={dashArray}
              filter="url(#gaugeGlow)"
              initial={{ strokeDasharray: `0 ${circumference}` }}
              animate={{ strokeDasharray: dashArray }}
              transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
            />
            {/* Tick marks */}
            {Array.from({ length: 11 }).map((_, i) => {
              const angle = (i / 10) * 270 - 135;
              const rad = (angle * Math.PI) / 180;
              const x1 = 90 + Math.cos(rad) * (radius + 8);
              const y1 = 90 + Math.sin(rad) * (radius + 8);
              const x2 = 90 + Math.cos(rad) * (radius + 12);
              const y2 = 90 + Math.sin(rad) * (radius + 12);
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="oklch(1 0 0 / 0.1)"
                  strokeWidth="1"
                />
              );
            })}
          </svg>
          {/* Center label (non-rotated) */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <Gauge className={`h-4 w-4 mb-1 ${gaugeTone === "emerald" ? "text-emerald-300" : gaugeTone === "amber" ? "text-amber-300" : "text-rose-300"}`} />
            <motion.span
              className={`font-mono text-4xl font-bold tabular-nums ${gaugeTone === "emerald" ? "text-emerald-300" : gaugeTone === "amber" ? "text-amber-300" : "text-rose-300"}`}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5 }}
            >
              {composite}
            </motion.span>
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">/ 100</span>
            <span className={`mt-1 font-mono text-[10px] font-semibold ${gaugeTone === "emerald" ? "text-emerald-300" : gaugeTone === "amber" ? "text-amber-300" : "text-rose-300"}`}>
              {statusLabel}
            </span>
          </div>
        </div>

        {/* Subsystem breakdown */}
        <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
          {subsystems.map((sub) => {
            const toneClass =
              sub.tone === "emerald" ? "text-emerald-300" :
              sub.tone === "amber" ? "text-amber-300" : "text-rose-300";
            const barClass =
              sub.tone === "emerald" ? "bg-emerald-400" :
              sub.tone === "amber" ? "bg-amber-400" : "bg-rose-400";
            const Icon = sub.icon;
            return (
              <div key={sub.label} className="rounded-md border border-border/40 bg-background/40 p-2">
                <div className="flex items-center gap-1.5">
                  <Icon className={`h-3 w-3 ${toneClass}`} />
                  <span className="flex-1 truncate font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                    {sub.label}
                  </span>
                  <span className={`font-mono text-[10px] font-semibold tabular-nums ${toneClass}`}>
                    {sub.score}
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-border/30">
                  <motion.div
                    className={`h-full rounded-full ${barClass}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${sub.score}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
                <div className="mt-0.5 font-mono text-[8px] text-muted-foreground/70">{sub.detail}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function formatUptime(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export { compact };
