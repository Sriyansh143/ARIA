"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import { AGENT_STATUS_META, type Agent, type AgentStatus } from "@/lib/types";
import { compact } from "@/hooks/use-clock";
import {
  Trophy,
  Medal,
  Award,
  TrendingUp,
  AlertTriangle,
  Zap,
  Target,
  Crown,
} from "lucide-react";

/**
 * AgentPerformanceLeaderboard — ranked agent efficiency table.
 *
 * Scores each agent on a composite of: tasks completed, tokens processed,
 * error rate, and current activity. Renders a ranked leaderboard with
 * medals (top 3), per-metric bars, and a highlighted "Agent of the Hour".
 *
 * All metrics are derived from the store's `agents` slice — no extra API
 * calls needed. The scoring formula rewards throughput + reliability.
 */

interface AgentScore {
  agent: Agent;
  rank: number;
  score: number;
  taskRate: number;
  errorRate: number;
  tokenEfficiency: number;
  isActive: boolean;
}

export function AgentPerformanceLeaderboard() {
  const agents = useMissionStore((s) => s.agents);
  const heartbeat = useMissionStore((s) => s.heartbeat);

  const ranked = useMemo<AgentScore[]>(() => {
    const list = Object.values(agents);
    if (list.length === 0) return [];

    const uptimeSeconds = heartbeat?.uptime ?? 1;
    const uptimeHours = Math.max(0.1, uptimeSeconds / 3600);

    const scored = list.map((agent) => {
      const isActive = agent.status !== "idle" && agent.status !== "offline";
      const taskRate = agent.tasksDone / uptimeHours; // tasks/hour
      const errorRate = agent.tasksDone > 0 ? agent.errorCount / (agent.tasksDone + agent.errorCount) : 0;
      const tokenEfficiency = agent.tokensUsed > 0 ? agent.tasksDone / (agent.tokensUsed / 1000) : 0; // tasks per 1k tokens

      // Composite score (0-100): throughput 40%, reliability 35%, activity 25%.
      const maxTasks = Math.max(1, ...list.map((a) => a.tasksDone));
      const throughputScore = (agent.tasksDone / maxTasks) * 40;
      const reliabilityScore = (1 - Math.min(1, errorRate)) * 35;
      const activityScore = isActive ? 25 : agent.status === "idle" ? 8 : 0;
      const score = Math.round(throughputScore + reliabilityScore + activityScore);

      return {
        agent,
        rank: 0,
        score,
        taskRate,
        errorRate,
        tokenEfficiency,
        isActive,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    scored.forEach((s, i) => (s.rank = i + 1));
    return scored;
  }, [agents, heartbeat]);

  const topAgent = ranked[0];
  const maxScore = Math.max(1, ...ranked.map((r) => r.score));

  return (
    <section className="mc-surface flex flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Agent Performance Leaderboard
          </h2>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">{ranked.length} ranked</span>
      </div>

      {/* Agent of the Hour spotlight */}
      {topAgent && (
        <div className="relative overflow-hidden border-b border-border/60 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent px-4 py-3">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px mc-sweep-line opacity-60" />
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10">
              <motion.span
                className="absolute inset-0 rounded-full"
                initial={{ opacity: 0.4 }} animate={{ opacity: [0.4, 0.8, 0.4] }}
                transition={{ duration: 2, repeat: Infinity }}
                style={{ boxShadow: "0 0 20px -2px oklch(0.78 0.15 80 / 0.6)" }}
              />
              <Crown className="relative h-5 w-5 text-amber-300" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-foreground">{topAgent.agent.name}</span>
                <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-amber-300">
                  Top Performer
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 font-mono text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Zap className="h-2.5 w-2.5 text-cyan-300" />
                  {topAgent.taskRate.toFixed(1)} tasks/hr
                </span>
                <span className="flex items-center gap-1">
                  <Target className="h-2.5 w-2.5 text-emerald-300" />
                  {((1 - topAgent.errorRate) * 100).toFixed(0)}% reliability
                </span>
                <span className="flex items-center gap-1">
                  <TrendingUp className="h-2.5 w-2.5 text-violet-300" />
                  {compact(topAgent.agent.tokensUsed)} tokens
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-2xl font-bold tabular-nums text-amber-300">{topAgent.score}</div>
              <div className="font-mono text-[9px] uppercase text-muted-foreground">score</div>
            </div>
          </div>
        </div>
      )}

      {/* Ranked table */}
      <div className="mc-scroll max-h-[28rem] flex-1 overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 z-10 bg-card/90 backdrop-blur">
            <tr className="border-b border-border/60 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Agent</th>
              <th className="px-2 py-2 text-right">Score</th>
              <th className="px-2 py-2 text-right hidden sm:table-cell">Tasks/hr</th>
              <th className="px-2 py-2 text-right hidden sm:table-cell">Errors</th>
              <th className="px-3 py-2 text-left hidden md:table-cell">Reliability</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((entry) => (
              <LeaderboardRow key={entry.agent.id} entry={entry} maxScore={maxScore} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LeaderboardRow({ entry, maxScore }: { entry: AgentScore; maxScore: number }) {
  const meta = AGENT_STATUS_META[entry.agent.status as AgentStatus] ?? AGENT_STATUS_META.idle;
  const reliability = (1 - entry.errorRate) * 100;
  const scorePct = (entry.score / maxScore) * 100;

  const medal =
    entry.rank === 1 ? { icon: Medal, tone: "text-amber-300", bg: "bg-amber-500/10" } :
    entry.rank === 2 ? { icon: Medal, tone: "text-slate-300", bg: "bg-slate-500/10" } :
    entry.rank === 3 ? { icon: Award, tone: "text-orange-300", bg: "bg-orange-500/10" } :
    null;

  const MedalIcon = medal?.icon;

  return (
    <motion.tr
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`border-b border-border/30 transition-colors hover:bg-card/40 ${entry.rank <= 3 ? medal!.bg : ""}`}
    >
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          {MedalIcon ? (
            <MedalIcon className={`h-3.5 w-3.5 ${medal!.tone}`} />
          ) : (
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{entry.rank}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
          <div className="min-w-0">
            <div className="truncate font-mono text-xs font-medium text-foreground">{entry.agent.name}</div>
            <div className="font-mono text-[9px] text-muted-foreground">{entry.agent.role}</div>
          </div>
        </div>
      </td>
      <td className="px-2 py-2 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <div className="hidden w-12 sm:block">
            <div className="h-1.5 overflow-hidden rounded-full bg-border/30">
              <motion.div
                className={`h-full rounded-full ${entry.score >= 70 ? "bg-emerald-400" : entry.score >= 40 ? "bg-amber-400" : "bg-rose-400"}`}
                initial={{ width: 0 }}
                animate={{ width: `${scorePct}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
          </div>
          <span className={`font-mono text-xs font-semibold tabular-nums ${entry.score >= 70 ? "text-emerald-300" : entry.score >= 40 ? "text-amber-300" : "text-rose-300"}`}>
            {entry.score}
          </span>
        </div>
      </td>
      <td className="px-2 py-2 text-right hidden sm:table-cell">
        <span className="font-mono text-[11px] tabular-nums text-cyan-300">{entry.taskRate.toFixed(1)}</span>
      </td>
      <td className="px-2 py-2 text-right hidden sm:table-cell">
        <span className={`font-mono text-[11px] tabular-nums ${entry.agent.errorCount > 5 ? "text-rose-300" : entry.agent.errorCount > 0 ? "text-amber-300" : "text-emerald-300"}`}>
          {entry.agent.errorCount}
        </span>
      </td>
      <td className="px-3 py-2 hidden md:table-cell">
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border/30">
            <motion.div
              className={`h-full rounded-full ${reliability >= 95 ? "bg-emerald-400" : reliability >= 80 ? "bg-amber-400" : "bg-rose-400"}`}
              initial={{ width: 0 }}
              animate={{ width: `${reliability}%` }}
              transition={{ duration: 0.4 }}
            />
          </div>
          <span className="w-9 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
            {reliability.toFixed(0)}%
          </span>
          {entry.agent.errorCount > 5 && (
            <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-rose-300" />
          )}
        </div>
      </td>
    </motion.tr>
  );
}
