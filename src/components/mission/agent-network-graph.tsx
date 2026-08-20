"use client";

import { useCallback, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import {
  AGENT_STATUS_META,
  DEPARTMENT_META,
  AGENT_ROLE_META,
  type Agent,
  type AgentStatus,
  type AgentMessage,
  type Department,
  type MessageChannel,
  type MessageType,
  MESSAGE_TYPE_META,
} from "@/lib/types";
import {
  Network,
  ArrowRight,
  Users,
  Inbox,
  Send,
  Share2,
  Activity,
} from "lucide-react";
import { FullScreenPanel } from "./full-screen-panel";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * AgentNetworkGraph — interactive circular communication graph.
 *
 * Renders all 37 agents on a circle grouped by department. Department arcs
 * are colored bands behind each cluster. Only ACTIVE agents glow + have
 * connection lines (drawn from real `agentMessages` records, with line
 * thickness = message count). Moving particles travel along active
 * connection lines (sender → receiver) — only when BOTH endpoints are
 * active. Clicking an agent opens a side Sheet with messages sent,
 * received, and connection summary. No data is fabricated: an agent with
 * zero messages shows an empty state.
 *
 * Task ID: ANIM-REDESIGN (Task 2).
 */

const SVG_SIZE = 720;
const CENTER = SVG_SIZE / 2;
const OUTER_R = 290;
const NODE_R = 9;
const DEPT_ARC_R = OUTER_R + 22;
const DEPARTMENT_ORDER: Department[] = [
  "Executive",
  "Engineering",
  "Research",
  "Operations",
  "Finance",
  "Sales",
  "Support",
  "Marketing",
  "Legal",
  "Ethics",
  "Communications",
  "Community",
  "Linguist",
  "Clients",
  "Conductor",
];

interface DeptSlice {
  name: Department;
  startAngle: number; // degrees
  endAngle: number;
  midAngle: number;
  color: string;
  agents: Agent[];
}

interface NodePos {
  id: string;
  agent: Agent;
  x: number;
  y: number;
  angle: number;
  active: boolean;
  dept: Department;
}

interface Edge {
  key: string;
  from: string;
  to: string;
  count: number;
  path: string;
  bothActive: boolean;
  activeEndpointCount: number;
}

function isActiveStatus(status: AgentStatus): boolean {
  return status !== "idle" && status !== "offline";
}

function polar(angleDeg: number, radius: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CENTER + Math.cos(rad) * radius, y: CENTER + Math.sin(rad) * radius };
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
): string {
  const start = polar(startAngle, r);
  const end = polar(endAngle, r);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

const CHANNEL_TONE: Record<MessageChannel, string> = {
  task: "text-cyan-300",
  approval: "text-amber-300",
  alert: "text-rose-300",
  coordination: "text-violet-300",
  broadcast: "text-emerald-300",
};

export function AgentNetworkGraph() {
  const agents = useMissionStore((s) => s.agents);
  const agentMessages = useMissionStore((s) => s.agentMessages);
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const agentList = useMemo(() => Object.values(agents), [agents]);

  // Group agents by department, preserving DEPARTMENT_ORDER. Agents with
  // unmapped departments fall into Conductor.
  const deptSlices: DeptSlice[] = useMemo(() => {
    const map = new Map<Department, Agent[]>();
    for (const d of DEPARTMENT_ORDER) map.set(d, []);
    for (const a of agentList) {
      const dept = (a.department as Department) ?? "Conductor";
      const target = map.has(dept) ? dept : "Conductor";
      map.get(target)!.push(a);
    }
    for (const arr of map.values()) arr.sort((x, y) => x.name.localeCompare(y.name));

    const total = agentList.length || 1;
    const slices: DeptSlice[] = [];
    let cursor = -90; // start at top
    for (const name of DEPARTMENT_ORDER) {
      const arr = map.get(name) ?? [];
      if (arr.length === 0) continue;
      const span = (arr.length / total) * 360;
      const start = cursor;
      const end = cursor + span;
      slices.push({
        name,
        startAngle: start,
        endAngle: end,
        midAngle: (start + end) / 2,
        color: DEPARTMENT_META[name].color,
        agents: arr,
      });
      cursor = end;
    }
    return slices;
  }, [agentList]);

  // Position each agent along the circle inside its department arc.
  const nodes: NodePos[] = useMemo(() => {
    const out: NodePos[] = [];
    for (const slice of deptSlices) {
      const n = slice.agents.length;
      const span = slice.endAngle - slice.startAngle;
      slice.agents.forEach((agent, i) => {
        // Spread evenly inside the arc, with small margin so nodes don't
        // touch the arc boundary.
        const margin = Math.min(4, span * 0.05);
        const usable = span - margin * 2;
        const angle = slice.startAngle + margin + (n === 1 ? usable / 2 : (i + 0.5) * (usable / n));
        const pos = polar(angle, OUTER_R);
        out.push({
          id: agent.id,
          agent,
          x: pos.x,
          y: pos.y,
          angle,
          active: isActiveStatus(agent.status as AgentStatus),
          dept: slice.name,
        });
      });
    }
    return out;
  }, [deptSlices]);

  // Build edges from agentMessages (real data only). Edges are directional
  // pairs collapsed to an undirected pair sorted by id, with counts.
  const { edges, maxCount } = useMemo(() => {
    const counts = new Map<string, number>();
    const directions = new Map<string, Set<string>>();
    for (const m of agentMessages) {
      if (!m.fromAgentId || !m.toAgentId) continue;
      if (m.fromAgentId === m.toAgentId) continue;
      const key = [m.fromAgentId, m.toAgentId].sort().join("→");
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!directions.has(key)) directions.set(key, new Set());
      directions.get(key)!.add(`${m.fromAgentId}>${m.toAgentId}`);
    }
    let max = 1;
    const list: Edge[] = [];
    for (const [key, count] of counts) {
      const [from, to] = key.split("→");
      const fromNode = nodes.find((n) => n.id === from);
      const toNode = nodes.find((n) => n.id === to);
      if (!fromNode || !toNode) continue;
      // Curved path between the two nodes, bowing slightly outward.
      const mx = (fromNode.x + toNode.x) / 2;
      const my = (fromNode.y + toNode.y) / 2;
      // Bow outward from center
      const dx = mx - CENTER;
      const dy = my - CENTER;
      const dl = Math.sqrt(dx * dx + dy * dy) || 1;
      const bow = 18;
      const cx = mx + (dx / dl) * bow;
      const cy = my + (dy / dl) * bow;
      const path = `M ${fromNode.x} ${fromNode.y} Q ${cx} ${cy} ${toNode.x} ${toNode.y}`;
      const bothActive = fromNode.active && toNode.active;
      const activeEndpointCount =
        (fromNode.active ? 1 : 0) + (toNode.active ? 1 : 0);
      if (count > max) max = count;
      list.push({
        key,
        from,
        to,
        count,
        path,
        bothActive,
        activeEndpointCount,
      });
    }
    return { edges: list, maxCount: max };
  }, [agentMessages, nodes]);

  const activeCount = nodes.filter((n) => n.active).length;
  const totalMessages = agentMessages.length;
  const edgeCount = edges.length;

  // Per-edge deterministic particle seeds (1–3 particles scaled by count).
  const particleSeeds = useMemo(() => {
    const out: { edgeKey: string; delay: number; dur: number }[] = [];
    edges.forEach((edge, i) => {
      if (!edge.bothActive) return;
      const n = Math.min(3, Math.max(1, Math.ceil(edge.count / 2)));
      for (let p = 0; p < n; p++) {
        const seed = (i * 7 + p * 13) % 100;
        out.push({
          edgeKey: edge.key,
          delay: (seed / 100) * 2.4,
          dur: 2.4 + ((seed * 3) % 17) / 10,
        });
      }
    });
    return out;
  }, [edges]);

  const hoveredEdge = hoveredEdgeKey ? edges.find((e) => e.key === hoveredEdgeKey) : null;
  const hoveredFromAgent = hoveredEdge ? agents[hoveredEdge.from] : null;
  const hoveredToAgent = hoveredEdge ? agents[hoveredEdge.to] : null;

  const selectedAgent = selectedAgentId ? agents[selectedAgentId] : null;

  const closeSheet = useCallback(() => setSelectedAgentId(null), []);

  return (
    <>
      <FullScreenPanel
        title="Agent Communication Network"
        icon={<Network className="h-4 w-4 text-violet-300" />}
        actions={
          <div className="hidden items-center gap-2 font-mono text-[10px] text-muted-foreground sm:flex">
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" /> {nodes.length}
            </span>
            <span className="text-border">·</span>
            <span className="flex items-center gap-1">
              <ArrowRight className="h-2.5 w-2.5" /> {edgeCount}
            </span>
            <span className="text-border">·</span>
            <span className="text-cyan-300">{activeCount} live</span>
          </div>
        }
      >
        <div className="relative">
          <svg
            viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
            className="block h-auto max-h-[640px] w-full"
            role="img"
            aria-label="Agent communication network"
          >
            <defs>
              <radialGradient id="ang-core-grad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#a855f7" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#a855f7" stopOpacity={0} />
              </radialGradient>
              <filter id="ang-glow" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="2.5" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Backdrop haze */}
            <circle cx={CENTER} cy={CENTER} r={OUTER_R + 50} fill="url(#ang-core-grad)" />

            {/* Department arcs (colored bands) */}
            <g>
              {deptSlices.map((slice) => {
                // Fill arc as a thick stroked path.
                return (
                  <g key={`arc-${slice.name}`}>
                    <path
                      d={describeArc(CENTER, CENTER, DEPT_ARC_R, slice.startAngle + 1, slice.endAngle - 1)}
                      fill="none"
                      stroke={slice.color}
                      strokeWidth={6}
                      strokeLinecap="round"
                      opacity={0.18}
                    />
                    {(() => {
                      const labelPos = polar(slice.midAngle, DEPT_ARC_R + 14);
                      return (
                        <text
                          x={labelPos.x}
                          y={labelPos.y}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize={9}
                          className="fill-muted-foreground font-mono"
                          style={{ letterSpacing: "0.12em" }}
                        >
                          {slice.name.toUpperCase()}
                        </text>
                      );
                    })()}
                  </g>
                );
              })}
            </g>

            {/* Edges (curved lines) — only when both endpoints exist */}
            <g>
              {edges.map((edge) => {
                const sw = 0.6 + (edge.count / maxCount) * 2.4;
                const isHovered = hoveredEdgeKey === edge.key;
                const opacity = edge.bothActive ? 0.55 : edge.activeEndpointCount > 0 ? 0.3 : 0.18;
                return (
                  <path
                    key={edge.key}
                    d={edge.path}
                    fill="none"
                    stroke={isHovered ? "#22d3ee" : "#a78bfa"}
                    strokeWidth={isHovered ? sw + 0.6 : sw}
                    opacity={isHovered ? 0.95 : opacity}
                    style={{ transition: "stroke 0.15s, opacity 0.15s, stroke-width 0.15s" }}
                    onMouseEnter={() => setHoveredEdgeKey(edge.key)}
                    onMouseLeave={() => setHoveredEdgeKey(null)}
                  />
                );
              })}
            </g>

            {/* Flowing particles — only on edges where BOTH endpoints are active */}
            <g>
              {particleSeeds.map((p, i) => {
                const edge = edges.find((e) => e.key === p.edgeKey);
                if (!edge) return null;
                return (
                  <circle
                    key={`part-${i}`}
                    r={1.6}
                    fill="#22d3ee"
                    opacity={0.9}
                    style={{ filter: "drop-shadow(0 0 3px #22d3ee)" }}
                  >
                    <animateMotion
                      path={edge.path}
                      dur={`${p.dur}s`}
                      begin={`${p.delay}s`}
                      repeatCount="indefinite"
                      rotate="auto"
                    />
                    <animate
                      attributeName="opacity"
                      values="0;1;1;0"
                      keyTimes="0;0.12;0.88;1"
                      dur={`${p.dur}s`}
                      begin={`${p.delay}s`}
                      repeatCount="indefinite"
                    />
                  </circle>
                );
              })}
            </g>

            {/* Nodes */}
            <g>
              {nodes.map((node) => {
                const meta = AGENT_STATUS_META[node.agent.status as AgentStatus] ?? AGENT_STATUS_META.idle;
                const deptColor = DEPARTMENT_META[node.dept]?.color ?? "#a855f7";
                const isSelected = selectedAgentId === node.id;
                const dim = node.active ? 1 : 0.3;
                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x}, ${node.y})`}
                    style={{ cursor: "pointer", opacity: dim, transition: "opacity 0.2s" }}
                    onClick={() => setSelectedAgentId(node.id)}
                  >
                    {/* Glow for active agents */}
                    {node.active && (
                      <motion.circle
                        r={NODE_R + 5}
                        fill={deptColor}
                        opacity={0.18}
                        initial={{ opacity: 0.1 }} animate={{ opacity: [0.1, 0.28, 0.1], r: [NODE_R + 4, NODE_R + 7, NODE_R + 4] }}
                        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                        style={{ pointerEvents: "none" }}
                      />
                    )}
                    {/* Outer ring colored by department */}
                    <circle
                      r={NODE_R + 1.5}
                      fill="none"
                      stroke={deptColor}
                      strokeWidth={1.2}
                      opacity={0.7}
                      style={{ pointerEvents: "none" }}
                    />
                    {/* Selection highlight */}
                    {isSelected && (
                      <circle
                        r={NODE_R + 4}
                        fill="none"
                        stroke="#22d3ee"
                        strokeWidth={1.5}
                        style={{ pointerEvents: "none" }}
                      />
                    )}
                    {/* Main node */}
                    <circle
                      r={NODE_R}
                      fill={node.active ? "#0a0a0f" : "#0a0a0f"}
                      stroke={node.active ? meta.dot.replace("bg-", "").replace("-400", "") === "" ? deptColor : deptColor : "#3f3f46"}
                      strokeWidth={1.2}
                    />
                    {/* Status dot */}
                    <circle cx={NODE_R * 0.6} cy={-NODE_R * 0.6} r={2.4} className={meta.dot} />
                    {/* Label (short name) */}
                    <text
                      y={NODE_R + 11}
                      textAnchor="middle"
                      fontSize={8}
                      className="fill-foreground/70 font-mono"
                      style={{ pointerEvents: "none" }}
                    >
                      {node.agent.name.replace(/^Aria-|^Forge-|^Nova-|^Pulse-|^Ledger-|^Vector-|^Echo-|^Sage-|^Maestro-/, "")}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Edge hover tooltip */}
          <AnimatePresence>
            {hoveredEdge && hoveredFromAgent && hoveredToAgent && (
              <motion.div
                key={`tt-${hoveredEdge.key}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.15 }}
                className="pointer-events-none absolute right-3 top-3 z-10 max-w-xs rounded-lg border border-border/70 bg-popover/95 p-2.5 shadow-lg backdrop-blur"
              >
                <div className="flex items-center gap-1.5">
                  <Activity className="h-3 w-3 text-cyan-300" />
                  <span className="font-mono text-[10px] font-semibold text-foreground">
                    {hoveredEdge.count} message{hoveredEdge.count === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-1.5 font-mono text-[9px] text-muted-foreground">
                  <span className="text-cyan-300">{hoveredFromAgent.name}</span>
                  <span className="mx-1">→</span>
                  <span className="text-violet-300">{hoveredToAgent.name}</span>
                </div>
                <div className="mt-1 font-mono text-[9px] text-muted-foreground">
                  {hoveredEdge.bothActive ? "active channel" : "inactive channel"}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Empty state when no messages */}
          {edgeCount === 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 font-mono text-[10px] text-amber-300">
                No inter-agent messages yet — graph will populate as agents communicate.
              </div>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-4 py-2 font-mono text-[9px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-cyan-400" /> active
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-slate-500 opacity-50" /> inactive
          </span>
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-4 bg-violet-400" /> edge width = msg count
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" /> flowing particle
          </span>
          <span className="ml-auto hidden text-muted-foreground/70 sm:inline">
            click a node to inspect messages
          </span>
        </div>
      </FullScreenPanel>

      {/* Agent inspection Sheet */}
      <Sheet open={!!selectedAgent} onOpenChange={(o) => !o && closeSheet()}>
        <SheetContent
          side="right"
          className="mc-surface-elevated w-full max-w-md overflow-y-auto border-l border-border/70 p-0 sm:max-w-md"
        >
          {selectedAgent && (
            <AgentInspectionSheet
              agent={selectedAgent}
              messages={agentMessages}
              onClose={closeSheet}
              onJumpAgent={setSelectedAgentId}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function AgentInspectionSheet({
  agent,
  messages,
  onClose,
  onJumpAgent,
}: {
  agent: Agent;
  messages: AgentMessage[];
  onClose: () => void;
  onJumpAgent: (id: string) => void;
}) {
  const meta = AGENT_STATUS_META[agent.status as AgentStatus] ?? AGENT_STATUS_META.idle;
  const isActive = isActiveStatus(agent.status as AgentStatus);
  const deptMeta = DEPARTMENT_META[(agent.department as Department) ?? "Conductor"];
  const roleMeta = AGENT_ROLE_META[agent.role as keyof typeof AGENT_ROLE_META];

  const sent = useMemo(
    () => messages.filter((m) => m.fromAgentId === agent.id),
    [messages, agent.id]
  );
  const received = useMemo(
    () => messages.filter((m) => m.toAgentId === agent.id),
    [messages, agent.id]
  );

  // Connections: unique counterparties with counts.
  const connections = useMemo(() => {
    const map = new Map<string, { count: number; sent: number; received: number }>();
    for (const m of [...sent, ...received]) {
      const otherId = m.fromAgentId === agent.id ? m.toAgentId : m.fromAgentId;
      if (!otherId || otherId === agent.id) continue;
      const cur = map.get(otherId) ?? { count: 0, sent: 0, received: 0 };
      cur.count += 1;
      if (m.fromAgentId === agent.id) cur.sent += 1;
      else cur.received += 1;
      map.set(otherId, cur);
    }
    return Array.from(map.entries())
      .map(([id, c]) => ({ id, ...c }))
      .sort((a, b) => b.count - a.count);
  }, [sent, received, agent.id]);

  return (
    <div className="flex h-full flex-col">
      <SheetHeader className={`relative overflow-hidden border-b border-border/60 px-4 py-4 ${isActive ? meta.glow : ""}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3 shrink-0">
              {isActive && (
                <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 mc-anim-breathe ${meta.dot}`} />
              )}
              <span className={`relative inline-flex h-3 w-3 rounded-full ${meta.dot}`} />
            </span>
            <div>
              <SheetTitle className="font-mono text-base font-semibold text-foreground">
                {agent.name}
              </SheetTitle>
              <SheetDescription className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                {agent.role} · {agent.department ?? "Conductor"} · {agent.tier}
              </SheetDescription>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-rose-500/40 hover:text-rose-300"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className={`font-semibold uppercase tracking-wider ${meta.tone}`}>
            {meta.label}
          </span>
          {deptMeta && (
            <span
              className="rounded border px-1.5 py-0.5"
              style={{ borderColor: `${deptMeta.color}40`, color: deptMeta.color }}
            >
              {deptMeta.label}
            </span>
          )}
          {roleMeta && (
            <span className="rounded border border-border/60 bg-background/60 px-1.5 py-0.5 text-muted-foreground">
              {roleMeta.label}
            </span>
          )}
          {agent.model && (
            <span className="truncate text-cyan-300">{agent.model}</span>
          )}
        </div>
      </SheetHeader>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          {/* Connections summary */}
          <InspectionSection
            title="Connections"
            icon={Share2}
            count={connections.length}
          >
            {connections.length === 0 ? (
              <EmptyState label="No connections yet" />
            ) : (
              <ul className="space-y-1">
                {connections.map((c) => {
                  const other = useMissionStore.getState().agents[c.id];
                  return (
                    <li
                      key={c.id}
                      className="flex items-center justify-between rounded-md border border-border/40 bg-background/40 px-2 py-1.5"
                    >
                      <button
                        type="button"
                        onClick={() => onJumpAgent(c.id)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                        <span className="truncate font-mono text-[11px] text-foreground">
                          {other?.name ?? c.id.slice(0, 8)}
                        </span>
                        <span className="truncate font-mono text-[9px] text-muted-foreground">
                          {other?.role ?? ""}
                        </span>
                      </button>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                        <span className="text-cyan-300">{c.sent}</span>
                        <span className="text-muted-foreground/50">/</span>
                        <span className="text-violet-300">{c.received}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </InspectionSection>

          {/* Messages sent */}
          <InspectionSection title="Messages Sent" icon={Send} count={sent.length}>
            {sent.length === 0 ? (
              <EmptyState label="No messages sent" />
            ) : (
              <MessageList messages={sent} kind="sent" onJumpAgent={onJumpAgent} />
            )}
          </InspectionSection>

          {/* Messages received */}
          <InspectionSection title="Messages Received" icon={Inbox} count={received.length}>
            {received.length === 0 ? (
              <EmptyState label="No messages received" />
            ) : (
              <MessageList messages={received} kind="received" onJumpAgent={onJumpAgent} />
            )}
          </InspectionSection>
        </div>
      </ScrollArea>
    </div>
  );
}

function InspectionSection({
  title,
  icon: Icon,
  count,
  children,
}: {
  title: string;
  icon: typeof Send;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3 w-3 text-cyan-300" />
          <h3 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground">
            {title}
          </h3>
        </div>
        <span className="font-mono text-[9px] text-muted-foreground">{count}</span>
      </div>
      {children}
    </section>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-border/40 bg-background/30 px-3 py-2 text-center font-mono text-[10px] text-muted-foreground">
      {label}
    </div>
  );
}

function MessageList({
  messages,
  kind,
  onJumpAgent,
}: {
  messages: AgentMessage[];
  kind: "sent" | "received";
  onJumpAgent: (id: string) => void;
}) {
  return (
    <div className="mc-scroll max-h-48 space-y-1 overflow-y-auto rounded-md border border-border/40 bg-background/40">
      {messages.map((m) => {
        const otherId = kind === "sent" ? m.toAgentId : m.fromAgentId;
        const other = useMissionStore.getState().agents[otherId ?? ""];
        const typeMeta = MESSAGE_TYPE_META[m.messageType as MessageType];
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => otherId && onJumpAgent(otherId)}
            className="flex w-full items-start gap-2 border-b border-border/20 px-2 py-1.5 text-left transition-colors last:border-0 hover:bg-card/40"
          >
            <span className="mt-0.5 font-mono text-[9px] text-muted-foreground">
              {fmtTime(m.createdAt)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className={`font-mono text-[9px] uppercase ${typeMeta?.tone ?? "text-muted-foreground"}`}>
                  {typeMeta?.label ?? m.messageType}
                </span>
                <span className={`font-mono text-[9px] uppercase ${CHANNEL_TONE[m.channel as MessageChannel] ?? "text-muted-foreground"}`}>
                  · {m.channel}
                </span>
              </div>
              <div className="truncate font-mono text-[11px] text-foreground">
                {m.subject}
              </div>
              <div className="truncate font-mono text-[9px] text-muted-foreground">
                {kind === "sent" ? "→ " : "← "}
                {other?.name ?? (otherId?.slice(0, 8) ?? "—")}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default AgentNetworkGraph;
