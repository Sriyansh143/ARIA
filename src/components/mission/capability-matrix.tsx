"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import { AGENT_STATUS_META, type Agent, type AgentStatus } from "@/lib/types";
import { Grid3x3, Check, Minus } from "lucide-react";

/**
 * AgentCapabilityMatrix — agent × capability coverage grid.
 *
 * Extracts the union of all agent capabilities and renders a heatmap-style
 * matrix: rows = agents, columns = capabilities. A filled cell means the
 * agent has that capability; cell intensity reflects the agent's current
 * activity level (active agents glow brighter). Hovering a cell highlights
 * the row + column.
 *
 * This answers: "which agents can do what?" at a glance — critical for
 * understanding the autonomous fleet's skill distribution and identifying
 * single points of failure (capabilities only one agent has).
 */

export function AgentCapabilityMatrix() {
  const agents = useMissionStore((s) => s.agents);

  const { agentList, capabilities, matrix, coverage } = useMemo(() => {
    const list = Object.values(agents).sort((a, b) => a.name.localeCompare(b.name));
    const capSet = new Set<string>();
    for (const a of list) {
      for (const c of a.capabilities) capSet.add(c);
    }
    const caps = Array.from(capSet).sort();

    // matrix[agentId][capability] = boolean
    const m = new Map<string, Set<string>>();
    for (const a of list) {
      m.set(a.id, new Set(a.capabilities));
    }

    // coverage[capability] = count of agents that have it
    const cov: Record<string, number> = {};
    for (const cap of caps) {
      cov[cap] = list.filter((a) => m.get(a.id)?.has(cap)).length;
    }

    return { agentList: list, capabilities: caps, matrix: m, coverage: cov };
  }, [agents]);

  return (
    <section className="mc-surface flex flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Grid3x3 className="h-4 w-4 text-cyan-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Agent Capability Matrix
          </h2>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {agentList.length} agents · {capabilities.length} skills
        </span>
      </div>

      {capabilities.length === 0 ? (
        <div className="flex h-24 items-center justify-center font-mono text-xs text-muted-foreground">
          no capabilities registered
        </div>
      ) : (
        <div className="mc-scroll overflow-x-auto p-3">
          <table className="w-full border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-card px-2 py-1 text-left">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Agent</span>
                </th>
                {capabilities.map((cap) => {
                  const count = coverage[cap] ?? 0;
                  const isSparse = count === 1;
                  return (
                    <th key={cap} className="px-1 py-1 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <span
                          className={`font-mono text-[8px] uppercase tracking-wider ${
                            isSparse ? "font-semibold text-rose-300" : "text-muted-foreground"
                          }`}
                          title={`${count} agent${count === 1 ? "" : "s"} have this capability`}
                        >
                          {cap}
                        </span>
                        <span
                          className={`rounded px-1 font-mono text-[7px] ${
                            isSparse
                              ? "bg-rose-500/10 text-rose-300"
                              : count <= 2
                                ? "bg-amber-500/10 text-amber-300"
                                : "bg-emerald-500/10 text-emerald-300"
                          }`}
                        >
                          {count}
                        </span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {agentList.map((agent) => {
                const meta = AGENT_STATUS_META[agent.status as AgentStatus] ?? AGENT_STATUS_META.idle;
                const isActive = agent.status !== "idle" && agent.status !== "offline";
                const caps = matrix.get(agent.id) ?? new Set<string>();
                return (
                  <motion.tr
                    key={agent.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="group"
                  >
                    <td className="sticky left-0 z-10 rounded bg-card px-2 py-1.5 group-hover:bg-card/80">
                      <div className="flex items-center gap-1.5">
                        <span className={`relative flex h-2 w-2 shrink-0`}>
                          {isActive && (
                            <span
                              className={`absolute inline-flex h-full w-full rounded-full opacity-60 mc-anim-breathe ${meta.dot}`}
                            />
                          )}
                          <span className={`relative inline-flex h-2 w-2 rounded-full ${meta.dot}`} />
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-mono text-[10px] font-medium text-foreground">
                            {agent.name}
                          </div>
                          <div className="font-mono text-[8px] text-muted-foreground">{agent.role}</div>
                        </div>
                      </div>
                    </td>
                    {capabilities.map((cap) => {
                      const has = caps.has(cap);
                      return (
                        <td key={cap} className="p-0">
                          <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            whileHover={{ scale: 1.1 }}
                            className={`flex h-7 w-full items-center justify-center rounded ${
                              has
                                ? isActive
                                  ? "bg-cyan-500/20 ring-1 ring-cyan-500/40"
                                  : "bg-cyan-500/10 ring-1 ring-cyan-500/20"
                                : "bg-border/20"
                            }`}
                            title={has ? `${agent.name} can ${cap}` : `${agent.name} lacks ${cap}`}
                          >
                            {has ? (
                              <Check
                                className={`h-3 w-3 ${isActive ? "text-cyan-300" : "text-cyan-400/60"}`}
                              />
                            ) : (
                              <Minus className="h-2.5 w-2.5 text-muted-foreground/30" />
                            )}
                          </motion.div>
                        </td>
                      );
                    })}
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-4 py-2 font-mono text-[9px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="flex h-4 w-4 items-center justify-center rounded bg-cyan-500/20 ring-1 ring-cyan-500/40">
            <Check className="h-2.5 w-2.5 text-cyan-300" />
          </span>
          has capability (active)
        </span>
        <span className="flex items-center gap-1">
          <span className="flex h-4 w-4 items-center justify-center rounded bg-cyan-500/10 ring-1 ring-cyan-500/20">
            <Check className="h-2.5 w-2.5 text-cyan-400/60" />
          </span>
          has capability (idle)
        </span>
        <span className="flex items-center gap-1">
          <span className="flex h-4 w-4 items-center justify-center rounded bg-border/20">
            <Minus className="h-2 w-2 text-muted-foreground/30" />
          </span>
          lacks capability
        </span>
        <span className="ml-auto text-muted-foreground/60">
          <span className="text-rose-300">red count</span> = single point of failure
        </span>
      </div>
    </section>
  );
}
