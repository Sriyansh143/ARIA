"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import {
  AGENT_STATUS_META,
  AGENT_TIERS,
  type Agent,
  type AgentStatus,
  type Task,
} from "@/lib/types";
import { compact, relTime, formatTime } from "@/hooks/use-clock";
import {
  X,
  Cpu,
  Activity,
  ScrollText,
  ListTree,
  Zap,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Timer,
} from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface AgentDetailDrawerProps {
  agentId: string | null;
  onClose: () => void;
}

/**
 * AgentDetailDrawer — full-screen agent telemetry panel.
 *
 * Slides in from the right when an agent is selected (via the roster card
 * or the command palette). Shows: identity header with live status glow,
 * token throughput sparkline (derived from the metric store), recent
 * tasks assigned to this agent, and a filtered live log stream.
 *
 * Memory-safe: all data is derived from the shared store; the drawer
 * holds no local state beyond the open/close animation.
 */
export function AgentDetailDrawer({ agentId, onClose }: AgentDetailDrawerProps) {
  const agents = useMissionStore((s) => s.agents);
  const logs = useMissionStore((s) => s.logs);
  const metrics = useMissionStore((s) => s.metrics);
  const tasks = useMissionStore((s) => s.tasks);

  const agent = agentId ? (agents[agentId] ?? null) : null;

  const agentLogs = useMemo(
    () => (agent ? logs.filter((l) => l.agentId === agent.id).slice(0, 40) : []),
    [agent, logs]
  );

  const tokenSeries = useMemo(() => {
    if (!agent) return [];
    return metrics
      .filter((m) => m.agentId === agent.id && m.name === "tokens")
      .slice(0, 30)
      .reverse()
      .map((m, i) => ({ i, v: m.value, t: formatTime(m.createdAt) }));
  }, [agent, metrics]);

  const agentTasks = useMemo(
    () =>
      agent
        ? Object.values(tasks)
            .filter((t) => t.assignedToId === agent.id)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 8)
        : [],
    [agent, tasks]
  );

  return (
    <AnimatePresence>
      {agent && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          />
          {/* Drawer */}
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className="mc-surface-elevated fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border/70 bg-card"
            role="dialog"
            aria-label={`Agent detail: ${agent.name}`}
          >
            <DrawerHeader agent={agent} onClose={onClose} />

            <div className="mc-scroll flex-1 overflow-y-auto p-4">
              {/* Stat grid */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatTile icon={Zap} label="Tokens" value={compact(agent.tokensUsed)} tone="text-cyan-300" />
                <StatTile icon={CheckCircle2} label="Tasks" value={String(agent.tasksDone)} tone="text-emerald-300" />
                <StatTile icon={AlertTriangle} label="Errors" value={String(agent.errorCount)} tone={agent.errorCount > 0 ? "text-rose-300" : "text-slate-300"} />
                <StatTile icon={Timer} label="Heartbeat" value={relTime(agent.lastBeatAt)} tone="text-violet-300" />
              </div>

              {/* Capabilities */}
              <Section title="Capabilities" icon={Cpu}>
                <div className="flex flex-wrap gap-1.5">
                  {agent.capabilities.length === 0 ? (
                    <span className="font-mono text-[11px] text-muted-foreground">none registered</span>
                  ) : (
                    agent.capabilities.map((c) => (
                      <span
                        key={c}
                        className="rounded-md border border-cyan-500/30 bg-cyan-500/5 px-2 py-0.5 font-mono text-[10px] text-cyan-300"
                      >
                        {c}
                      </span>
                    ))
                  )}
                </div>
              </Section>

              {/* Token throughput sparkline */}
              <Section title="Token Throughput" icon={Activity} subtitle="last 30 emissions">
                {tokenSeries.length === 0 ? (
                  <div className="flex h-24 items-center justify-center font-mono text-[11px] text-muted-foreground">
                    awaiting telemetry…
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={100}>
                    <AreaChart data={tokenSeries} margin={{ top: 4, right: 4, bottom: 0, left: -32 }}>
                      <defs>
                        <linearGradient id="agentTok" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="oklch(0.78 0.16 195)" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="oklch(0.78 0.16 195)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="t" tick={{ fontSize: 8, fill: "oklch(0.64 0.012 250)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={20} />
                      <YAxis tick={{ fontSize: 8, fill: "oklch(0.64 0.012 250)" }} tickLine={false} axisLine={false} width={32} />
                      <Tooltip
                        contentStyle={{
                          background: "oklch(0.235 0.016 250)",
                          border: "1px solid oklch(1 0 0 / 0.1)",
                          borderRadius: 6,
                          fontSize: 10,
                          fontFamily: "var(--font-geist-mono)",
                        }}
                      />
                      <Area type="monotone" dataKey="v" stroke="oklch(0.78 0.16 195)" strokeWidth={2} fill="url(#agentTok)" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </Section>

              {/* Recent tasks */}
              <Section title="Recent Tasks" icon={ListTree} subtitle={`${agentTasks.length} assigned`}>
                {agentTasks.length === 0 ? (
                  <div className="font-mono text-[11px] text-muted-foreground">no tasks assigned</div>
                ) : (
                  <ul className="space-y-1.5">
                    {agentTasks.map((t) => (
                      <TaskMiniRow key={t.id} task={t} />
                    ))}
                  </ul>
                )}
              </Section>

              {/* Filtered log stream */}
              <Section title="Agent Log" icon={ScrollText} subtitle={`${agentLogs.length} recent`}>
                {agentLogs.length === 0 ? (
                  <div className="font-mono text-[11px] text-muted-foreground">no logs yet</div>
                ) : (
                  <div className="mc-scroll max-h-64 space-y-px overflow-y-auto rounded-md border border-border/40 bg-background/60 font-mono text-[11px]">
                    {agentLogs.map((l) => {
                      const tone =
                        l.level === "error" ? "text-rose-300" : l.level === "success" ? "text-emerald-300" : l.level === "warn" ? "text-amber-300" : "text-sky-300";
                      return (
                        <div key={l.id} className="flex items-start gap-2 border-b border-border/20 px-2 py-1 last:border-0 hover:bg-card/40">
                          <span className="shrink-0 text-muted-foreground/70 tabular-nums">{formatTime(l.createdAt)}</span>
                          <span className={`shrink-0 text-[9px] font-semibold uppercase ${tone}`}>{l.level}</span>
                          <span className="truncate text-foreground/90">{l.message}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Section>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function DrawerHeader({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const meta = AGENT_STATUS_META[agent.status as AgentStatus] ?? AGENT_STATUS_META.idle;
  const isActive = agent.status !== "idle" && agent.status !== "offline";
  return (
    <div className={`relative overflow-hidden border-b border-border/60 px-4 py-4 ${isActive ? meta.glow : ""}`}>
      {isActive && <div className="pointer-events-none absolute inset-x-0 top-0 h-px mc-sweep-line opacity-70" />}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3 shrink-0">
            {isActive && (
              <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 mc-anim-breathe ${meta.dot}`} />
            )}
            <span className={`relative inline-flex h-3 w-3 rounded-full ${meta.dot}`} />
          </span>
          <div>
            <h2 className="font-mono text-base font-semibold text-foreground">{agent.name}</h2>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
              <span className="uppercase tracking-wider">{agent.role}</span>
              <span className="text-border">·</span>
              <span className="uppercase">{agent.tier}</span>
              <span className="text-border">·</span>
              <span className="truncate">{agent.model ?? "—"}</span>
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-rose-500/40 hover:text-rose-300"
          aria-label="Close agent detail"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className={`font-mono text-xs font-semibold uppercase tracking-wider ${meta.tone}`}>
          {meta.label}
        </span>
        {agent.department && (
          <span className="rounded border border-border/60 bg-background/60 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
            {agent.department}
          </span>
        )}
        {agent.currentTask && (
          <span className="truncate font-mono text-[10px] text-amber-300">▸ {agent.currentTask}</span>
        )}
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Zap;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/40 p-2.5">
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3 w-3 ${tone}`} />
        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className={`mt-1 font-mono text-base font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  icon: Icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: typeof Cpu;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3 w-3 text-cyan-300" />
          <h3 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground">{title}</h3>
        </div>
        {subtitle && <span className="font-mono text-[9px] text-muted-foreground">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

function TaskMiniRow({ task }: { task: Task }) {
  const tone =
    task.status === "completed" ? "text-emerald-300" : task.status === "failed" ? "text-rose-300" : task.status === "running" ? "text-amber-300" : "text-slate-300";
  return (
    <li className="rounded-md border border-border/40 bg-background/40 px-2.5 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-foreground">{task.title}</span>
        <span className={`shrink-0 font-mono text-[9px] uppercase ${tone}`}>{task.status}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-border/30">
          <div
            className={`h-full rounded-full ${task.status === "completed" ? "bg-emerald-400" : task.status === "failed" ? "bg-rose-400" : "bg-cyan-400"}`}
            style={{ width: `${task.progress}%` }}
          />
        </div>
        <span className="shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground">{task.progress}%</span>
      </div>
    </li>
  );
}

export { AGENT_TIERS, TrendingUp };
