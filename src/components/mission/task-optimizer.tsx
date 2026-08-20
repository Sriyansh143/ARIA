"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import {
  AGENT_STATUS_META,
  type Agent,
  type AgentStatus,
  type TaskKind,
} from "@/lib/types";
import { compact } from "@/hooks/use-clock";
import {
  Brain,
  Cpu,
  Trophy,
  Sparkles,
  TrendingUp,
  Zap,
  Target,
  RefreshCw,
  Send,
} from "lucide-react";

/**
 * TaskAssignmentOptimizer — recommends the best agent for a task.
 *
 * Given a task kind (work/tool_call/research/review/decision), scores
 * every agent on a composite of:
 *  - Capability match (does the agent have relevant capabilities?)
 *  - Current load (fewer active tasks = better)
 *  - Reliability (lower error rate = better)
 *  - Throughput (more tasks done = better)
 *
 * Renders a ranked recommendation list with score breakdowns + a
 * "best pick" spotlight. Operators can use this to dispatch new work
 * to the optimal agent.
 */

const KIND_CAPABILITY_MAP: Record<TaskKind, string[]> = {
  work: ["codegen", "deploy", "test", "invoicing", "triage", "reply"],
  tool_call: ["codegen", "deploy", "monitoring", "healing", "db_query"],
  research: ["web-search", "synthesis", "radar", "forecast"],
  review: ["architecture", "review", "codegen"],
  decision: ["strategy", "approval", "forecast", "qualify"],
};

const KIND_LABEL: Record<TaskKind, string> = {
  work: "Work",
  tool_call: "Tool Call",
  research: "Research",
  review: "Review",
  decision: "Decision",
};

interface AgentRecommendation {
  agent: Agent;
  score: number;
  capabilityMatch: number;
  loadScore: number;
  reliabilityScore: number;
  throughputScore: number;
  matchedCapabilities: string[];
  rank: number;
}

export function TaskAssignmentOptimizer({
  onAssign,
}: {
  onAssign?: (agentId: string, kind: TaskKind) => void;
}) {
  const agents = useMissionStore((s) => s.agents);
  const tasks = useMissionStore((s) => s.tasks);
  const [selectedKind, setSelectedKind] = useState<TaskKind>("work");

  const recommendations = useMemo<AgentRecommendation[]>(() => {
    const agentList = Object.values(agents);
    if (agentList.length === 0) return [];

    const desiredCaps = KIND_CAPABILITY_MAP[selectedKind] ?? [];

    // Compute current load per agent (running tasks).
    const loadMap = new Map<string, number>();
    for (const t of Object.values(tasks)) {
      if (t.status === "running" && t.assignedToId) {
        loadMap.set(t.assignedToId, (loadMap.get(t.assignedToId) ?? 0) + 1);
      }
    }
    const maxLoad = Math.max(1, ...Array.from(loadMap.values()));

    const scored = agentList.map((agent) => {
      const agentCaps = new Set(agent.capabilities);
      const matched = desiredCaps.filter((c) => agentCaps.has(c));
      const capabilityMatch = desiredCaps.length > 0 ? matched.length / desiredCaps.length : 0.5;

      const load = loadMap.get(agent.id) ?? 0;
      const loadScore = 1 - load / maxLoad; // fewer running tasks = higher score

      const totalAttempts = agent.tasksDone + agent.errorCount;
      const reliabilityScore = totalAttempts > 0 ? 1 - agent.errorCount / totalAttempts : 1;

      const maxTasks = Math.max(1, ...agentList.map((a) => a.tasksDone));
      const throughputScore = agent.tasksDone / maxTasks;

      // Composite: capability 40%, load 25%, reliability 20%, throughput 15%.
      const score = Math.round(
        (capabilityMatch * 0.40 + loadScore * 0.25 + reliabilityScore * 0.20 + throughputScore * 0.15) * 100
      );

      return {
        agent,
        score,
        capabilityMatch: Math.round(capabilityMatch * 100),
        loadScore: Math.round(loadScore * 100),
        reliabilityScore: Math.round(reliabilityScore * 100),
        throughputScore: Math.round(throughputScore * 100),
        matchedCapabilities: matched,
        rank: 0,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    scored.forEach((s, i) => (s.rank = i + 1));
    return scored;
  }, [agents, tasks, selectedKind]);

  const topPick = recommendations[0];

  return (
    <section className="mc-surface flex flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-violet-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Task Assignment Optimizer
          </h2>
          <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-violet-300">
            AI
          </span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">{recommendations.length} agents</span>
      </div>

      {/* Task kind selector */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border/40 px-3 py-2">
        <span className="mr-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Task kind:</span>
        {(Object.keys(KIND_LABEL) as TaskKind[]).map((kind) => (
          <button
            key={kind}
            onClick={() => setSelectedKind(kind)}
            className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
              selectedKind === kind
                ? "border-violet-500/50 bg-violet-500/10 text-violet-300"
                : "border-border/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            {KIND_LABEL[kind]}
          </button>
        ))}
      </div>

      {/* Top pick spotlight */}
      {topPick && (
        <div className="relative overflow-hidden border-b border-border/60 bg-gradient-to-r from-violet-500/10 via-violet-500/5 to-transparent px-4 py-3">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px mc-sweep-line opacity-60" />
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-full border border-violet-500/40 bg-violet-500/10">
              <motion.span
                className="absolute inset-0 rounded-full"
                initial={{ opacity: 0.4 }} animate={{ opacity: [0.4, 0.8, 0.4] }}
                transition={{ duration: 2, repeat: Infinity }}
                style={{ boxShadow: "0 0 20px -2px oklch(0.7 0.18 300 / 0.6)" }}
              />
              <Sparkles className="relative h-5 w-5 text-violet-300" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-foreground">{topPick.agent.name}</span>
                <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-violet-300">
                  Best Pick
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 font-mono text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Target className="h-2.5 w-2.5 text-cyan-300" />
                  {topPick.capabilityMatch}% cap match
                </span>
                <span className="flex items-center gap-1">
                  <Zap className="h-2.5 w-2.5 text-amber-300" />
                  {topPick.loadScore}% availability
                </span>
                {topPick.matchedCapabilities.length > 0 && (
                  <span className="text-emerald-300">
                    ✓ {topPick.matchedCapabilities.join(", ")}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <div className="text-right">
                <div className="font-mono text-2xl font-bold tabular-nums text-violet-300">{topPick.score}</div>
                <div className="font-mono text-[9px] uppercase text-muted-foreground">score</div>
              </div>
              {onAssign && (
                <button
                  onClick={() => onAssign(topPick.agent.id, selectedKind)}
                  className="flex items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-violet-300 transition-colors hover:bg-violet-500/20"
                  title={`Assign a ${KIND_LABEL[selectedKind]} task to ${topPick.agent.name}`}
                >
                  <Send className="h-3 w-3" />
                  Assign
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Ranked recommendations */}
      <div className="mc-scroll max-h-[24rem] flex-1 overflow-y-auto p-2">
        <table className="w-full">
          <thead className="sticky top-0 z-10 bg-card/90 backdrop-blur">
            <tr className="border-b border-border/60 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              <th className="px-2 py-1.5 text-left">#</th>
              <th className="px-2 py-1.5 text-left">Agent</th>
              <th className="px-2 py-1.5 text-right">Score</th>
              <th className="px-2 py-1.5 text-right hidden sm:table-cell">Cap</th>
              <th className="px-2 py-1.5 text-right hidden sm:table-cell">Load</th>
              <th className="px-2 py-1.5 text-right hidden md:table-cell">Rel</th>
              <th className="px-2 py-1.5 text-right hidden md:table-cell">Thr</th>
            </tr>
          </thead>
          <tbody>
            {recommendations.map((rec) => (
              <RecRow key={rec.agent.id} rec={rec} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 px-4 py-2 font-mono text-[8px] text-muted-foreground">
        <span>Cap = capability match</span>
        <span>·</span>
        <span>Load = availability</span>
        <span>·</span>
        <span>Rel = reliability</span>
        <span>·</span>
        <span>Thr = throughput</span>
        <span className="ml-auto flex items-center gap-1 text-violet-300/70">
          <RefreshCw className="h-2.5 w-2.5" /> re-evaluates live
        </span>
      </div>
    </section>
  );
}

function RecRow({ rec }: { rec: AgentRecommendation }) {
  const meta = AGENT_STATUS_META[rec.agent.status as AgentStatus] ?? AGENT_STATUS_META.idle;
  const isActive = rec.agent.status !== "idle" && rec.agent.status !== "offline";

  const scoreTone = rec.score >= 70 ? "text-emerald-300" : rec.score >= 40 ? "text-amber-300" : "text-rose-300";
  const scoreBarClass = rec.score >= 70 ? "bg-emerald-400" : rec.score >= 40 ? "bg-amber-400" : "bg-rose-400";

  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`border-b border-border/30 hover:bg-card/40 ${rec.rank === 1 ? "bg-violet-500/5" : ""}`}
    >
      <td className="px-2 py-1.5">
        {rec.rank === 1 ? (
          <Trophy className="h-3.5 w-3.5 text-violet-300" />
        ) : (
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{rec.rank}</span>
        )}
      </td>
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
          <div className="min-w-0">
            <div className="truncate font-mono text-[11px] font-medium text-foreground">{rec.agent.name}</div>
            <div className="font-mono text-[8px] text-muted-foreground">{rec.agent.role}</div>
          </div>
        </div>
      </td>
      <td className="px-2 py-1.5 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <div className="hidden w-10 sm:block">
            <div className="h-1.5 overflow-hidden rounded-full bg-border/30">
              <motion.div
                className={`h-full rounded-full ${scoreBarClass}`}
                initial={{ width: 0 }}
                animate={{ width: `${rec.score}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
          </div>
          <span className={`font-mono text-xs font-semibold tabular-nums ${scoreTone}`}>{rec.score}</span>
        </div>
      </td>
      <td className="px-2 py-1.5 text-right hidden sm:table-cell">
        <span className="font-mono text-[10px] tabular-nums text-cyan-300">{rec.capabilityMatch}%</span>
      </td>
      <td className="px-2 py-1.5 text-right hidden sm:table-cell">
        <span className={`font-mono text-[10px] tabular-nums ${rec.loadScore >= 70 ? "text-emerald-300" : rec.loadScore >= 40 ? "text-amber-300" : "text-rose-300"}`}>
          {rec.loadScore}%
        </span>
      </td>
      <td className="px-2 py-1.5 text-right hidden md:table-cell">
        <span className={`font-mono text-[10px] tabular-nums ${rec.reliabilityScore >= 90 ? "text-emerald-300" : "text-amber-300"}`}>
          {rec.reliabilityScore}%
        </span>
      </td>
      <td className="px-2 py-1.5 text-right hidden md:table-cell">
        <span className="font-mono text-[10px] tabular-nums text-violet-300">{rec.throughputScore}%</span>
      </td>
    </motion.tr>
  );
}

export { Cpu, TrendingUp };
