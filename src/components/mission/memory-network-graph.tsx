"use client";

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import {
  MEMORY_SCOPE_META,
  MEMORY_SCOPES,
  type MemoryItem,
  type MemoryScope,
} from "@/lib/types";
import { Brain, Link2, Pin, Search, RotateCw } from "lucide-react";

/**
 * MemoryNetworkGraph — circular connected knowledge graph.
 *
 * Renders memory items as nodes in a circular layout, with SVG edges
 * connecting memories that reference each other (via `linkedTo`). The
 * visualization has three layers:
 *
 *  1. OUTER RING: scope segments (config/branding/agent/system/strategy/knowledge)
 *  2. NODE RING: memory nodes positioned within their scope's arc
 *  3. EDGES: animated bezier curves connecting linked memories
 *
 * Nodes are sized by connection strength; pinned memories get a comet
 * sweep. Hovering a node highlights its connections + dims the rest.
 * Clicking a node opens a detail tooltip with the memory's value + tags.
 *
 * SVG animations: comet sweeps on pinned nodes, marching dashes on
 * edges, breathing rings on high-strength nodes, heartbeat halos.
 */

const SVG_SIZE = 460;
const CENTER = SVG_SIZE / 2;
const SCOPE_R = 200;
const NODE_R = 165;
const HUB_R = 60;

interface MemoryNode {
  memory: MemoryItem;
  x: number;
  y: number;
  scopeAngle: number;
}

interface MemoryEdge {
  from: MemoryNode;
  to: MemoryNode;
  strength: number;
}

function polarToCartesian(angleDeg: number, radius: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CENTER + Math.cos(rad) * radius, y: CENTER + Math.sin(rad) * radius };
}

function bezierPath(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  // Curve toward center for a nice arc.
  const cx = CENTER + (mx - CENTER) * 0.3;
  const cy = CENTER + (my - CENTER) * 0.3;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

export function MemoryNetworkGraph() {
  const memories = useMissionStore((s) => s.memories);
  const agents = useMissionStore((s) => s.agents);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<MemoryScope | "all">("all");
  const [rotation, setRotation] = useState(0);
  const rafRef = useRef<number>(0);

  // Slow auto-rotation (living machinery).
  useEffect(() => {
    let last = performance.now();
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      setRotation((r) => (r + dt * 0.003) % 360);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const memoryList = useMemo(
    () => Object.values(memories).sort((a, b) => b.strength - a.strength),
    [memories]
  );

  // Compute scope segments + node positions.
  const { scopeSegments, nodes, edges } = useMemo(() => {
    const filtered = scopeFilter === "all" ? memoryList : memoryList.filter((m) => m.scope === scopeFilter);
    if (filtered.length === 0) return { scopeSegments: [], nodes: [], edges: [] };

    // Group by scope.
    const byScope = new Map<MemoryScope, MemoryItem[]>();
    for (const m of filtered) {
      const list = byScope.get(m.scope as MemoryScope) ?? [];
      list.push(m);
      byScope.set(m.scope as MemoryScope, list);
    }

    // Compute scope arc segments via for-loop (no mutable accumulators in .map()).
    const activeScopes = MEMORY_SCOPES.filter((s) => byScope.has(s));
    const total = filtered.length;
    const segments: Array<{ scope: MemoryScope; items: MemoryItem[]; startAngle: number; endAngle: number; midAngle: number }> = [];
    let angle = -90;
    for (const scope of activeScopes) {
      const items = byScope.get(scope)!;
      const proportion = items.length / total;
      const arcSize = Math.max(20, proportion * 360);
      const startAngle = angle;
      const endAngle = angle + arcSize - 3;
      const midAngle = (startAngle + endAngle) / 2;
      angle = endAngle + 3;
      segments.push({ scope, items, startAngle, endAngle, midAngle });
    }

    // Position nodes within their scope's arc.
    const nodeMap = new Map<string, MemoryNode>();
    for (const seg of segments) {
      seg.items.forEach((memory, i) => {
        const angleSpread = seg.endAngle - seg.startAngle;
        const angleStep = angleSpread / Math.max(1, seg.items.length);
        const angle = seg.startAngle + angleStep * (i + 0.5) + rotation;
        const pos = polarToCartesian(angle, NODE_R);
        nodeMap.set(memory.id, { memory, x: pos.x, y: pos.y, scopeAngle: angle });
      });
    }

    // Build edges from linkedTo.
    const edgeList: MemoryEdge[] = [];
    for (const node of Array.from(nodeMap.values())) {
      for (const linkedId of node.memory.linkedTo) {
        const target = nodeMap.get(linkedId);
        if (target && target.memory.id !== node.memory.id) {
          const strength = (node.memory.strength + target.memory.strength) / 2;
          edgeList.push({ from: node, to: target, strength });
        }
      }
    }

    return { scopeSegments: segments, nodes: Array.from(nodeMap.values()), edges: edgeList };
  }, [memoryList, scopeFilter, rotation]);

  const isConnected = useCallback(
    (nodeId: string, edge: MemoryEdge) => edge.from.memory.id === nodeId || edge.to.memory.id === nodeId,
    []
  );

  const isDimmed = useCallback(
    (nodeId: string) => {
      if (!hoveredNode) return false;
      if (nodeId === hoveredNode) return false;
      return !edges.some((e) => hoveredNode === e.from.memory.id && nodeId === e.to.memory.id || hoveredNode === e.to.memory.id && nodeId === e.from.memory.id);
    },
    [hoveredNode, edges]
  );

  const selectedMemory = selectedNode ? memories[selectedNode] : null;

  return (
    <section className="mc-surface flex flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-violet-300" />
          <h2 className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-foreground">
            Memory Network
          </h2>
          <span className="font-mono text-[10px] text-muted-foreground">
            {memoryList.length} memories · {edges.length} links
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => setScopeFilter("all")}
            className={`border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors ${
              scopeFilter === "all" ? "border-primary/50 bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:text-foreground"
            }`}
            style={{ borderRadius: 0 }}
          >
            all
          </button>
          {MEMORY_SCOPES.filter((s) => memoryList.some((m) => m.scope === s)).map((scope) => {
            const meta = MEMORY_SCOPE_META[scope];
            return (
              <button
                key={scope}
                onClick={() => setScopeFilter(scope)}
                className={`border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors ${
                  scopeFilter === scope ? `${meta.tone} border-current/30` : "border-border/60 text-muted-foreground hover:text-foreground"
                }`}
                style={{ borderRadius: 0 }}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col items-center gap-4 p-4 lg:flex-row lg:items-start lg:gap-6">
        <div className="relative shrink-0">
          <svg width={SVG_SIZE} height={SVG_SIZE} className="block" style={{ overflow: "visible" }}>
            <defs>
              <radialGradient id="memBg" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="oklch(0.7 0.18 300 / 0.04)" />
                <stop offset="100%" stopColor="oklch(0.14 0.008 250 / 0)" />
              </radialGradient>
            </defs>

            <circle cx={CENTER} cy={CENTER} r={SCOPE_R + 15} fill="url(#memBg)" />

            {/* Scope arc segments */}
            {scopeSegments.map((seg) => {
              const meta = MEMORY_SCOPE_META[seg.scope];
              const sStart = polarToCartesian(seg.startAngle + rotation, SCOPE_R);
              const sEnd = polarToCartesian(seg.endAngle + rotation, SCOPE_R);
              const iStart = polarToCartesian(seg.endAngle + rotation, SCOPE_R - 12);
              const iEnd = polarToCartesian(seg.startAngle + rotation, SCOPE_R - 12);
              const largeArc = seg.endAngle - seg.startAngle > 180 ? 1 : 0;
              const arcD = `M ${sStart.x} ${sStart.y} A ${SCOPE_R} ${SCOPE_R} 0 ${largeArc} 1 ${sEnd.x} ${sEnd.y} L ${iStart.x} ${iStart.y} A ${SCOPE_R - 12} ${SCOPE_R - 12} 0 ${largeArc} 0 ${iEnd.x} ${iEnd.y} Z`;
              return (
                <g key={seg.scope}>
                  <path d={arcD} fill={meta.color} opacity={0.15} stroke={meta.color} strokeWidth={0.5} />
                  <text
                    x={polarToCartesian(seg.midAngle + rotation, SCOPE_R + 14).x}
                    y={polarToCartesian(seg.midAngle + rotation, SCOPE_R + 14).y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="font-mono"
                    style={{ fontSize: 8, fontWeight: 600, fill: meta.color, textTransform: "uppercase", letterSpacing: "0.1em" }}
                  >
                    {meta.label}
                  </text>
                </g>
              );
            })}

            {/* Edges (drawn behind nodes) */}
            {edges.map((edge, i) => {
              const isHovered = hoveredNode && isConnected(hoveredNode, edge);
              const isDimmedEdge = hoveredNode && !isHovered;
              const strokeWidth = 0.5 + edge.strength * 2;
              return (
                <g key={`edge-${i}`}>
                  <path
                    d={bezierPath(edge.from.x, edge.from.y, edge.to.x, edge.to.y)}
                    fill="none"
                    stroke={isHovered ? "oklch(0.78 0.16 195 / 0.7)" : "oklch(1 0 0 / 0.1)"}
                    strokeWidth={strokeWidth}
                    opacity={isDimmedEdge ? 0.05 : 1}
                    className={isHovered ? "mc-funnel-dash" : ""}
                    style={{ transition: "opacity 0.15s, stroke 0.15s" }}
                  />
                </g>
              );
            })}

            {/* Memory nodes */}
            {nodes.map((node) => {
              const meta = MEMORY_SCOPE_META[node.memory.scope as MemoryScope] ?? MEMORY_SCOPE_META.knowledge;
              const isPinned = node.memory.pinned;
              const isHighStrength = node.memory.strength > 0.7;
              const isHovered = hoveredNode === node.memory.id;
              const isSelected = selectedNode === node.memory.id;
              const dimmed = isDimmed(node.memory.id);
              const nodeRadius = 4 + node.memory.strength * 6;

              return (
                <g
                  key={node.memory.id}
                  onMouseEnter={() => setHoveredNode(node.memory.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  onClick={() => setSelectedNode(isSelected ? null : node.memory.id)}
                  style={{ cursor: "pointer", opacity: dimmed ? 0.2 : 1, transition: "opacity 0.15s" }}
                >
                  {/* Comet sweep for pinned memories */}
                  {isPinned && (
                    <motion.circle
                      cx={node.x}
                      cy={node.y}
                      r={nodeRadius + 4}
                      fill="none"
                      stroke={meta.color}
                      strokeWidth={1}
                      strokeDasharray="3 6"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                      style={{ transformOrigin: `${node.x}px ${node.y}px` }}
                    />
                  )}
                  {/* Breathing ring for high-strength memories */}
                  {isHighStrength && (
                    <motion.circle
                      cx={node.x}
                      cy={node.y}
                      r={nodeRadius + 6}
                      fill="none"
                      stroke={meta.color}
                      strokeWidth={1}
                      initial={{ opacity: 0.3 }} animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0.1, 0.3] }}
                      transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                      style={{ transformOrigin: `${node.x}px ${node.y}px` }}
                    />
                  )}
                  {/* Heartbeat halo on hover */}
                  {isHovered && (
                    <motion.circle
                      cx={node.x}
                      cy={node.y}
                      r={nodeRadius + 3}
                      fill="none"
                      stroke={meta.color}
                      strokeWidth={1.5}
                      initial={{ scale: 1, opacity: 0.6 }}
                      animate={{ scale: 2, opacity: 0 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "easeOut" }}
                      style={{ transformOrigin: `${node.x}px ${node.y}px` }}
                    />
                  )}
                  {/* Node */}
                  <motion.circle
                    cx={node.x}
                    cy={node.y}
                    r={nodeRadius}
                    fill={isSelected ? meta.color : "oklch(0.14 0.008 250)"}
                    stroke={meta.color}
                    strokeWidth={isHovered || isSelected ? 2.5 : 1.5}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.3 }}
                    style={{ transformOrigin: `${node.x}px ${node.y}px` }}
                  />
                  {/* Pin indicator */}
                  {isPinned && (
                    <text
                      x={node.x}
                      y={node.y + 3}
                      textAnchor="middle"
                      className="font-mono"
                      style={{ fontSize: 7, fontWeight: 700, fill: "oklch(0.14 0.008 250)", pointerEvents: "none" }}
                    >
                      ★
                    </text>
                  )}
                  {/* Label */}
                  {(isHovered || isSelected) && (
                    <text
                      x={node.x}
                      y={node.y + nodeRadius + 12}
                      textAnchor="middle"
                      className="font-mono"
                      style={{ fontSize: 8, fill: "var(--foreground)", pointerEvents: "none", fontWeight: 600 }}
                    >
                      {node.memory.key}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Center hub */}
            <circle cx={CENTER} cy={CENTER} r={HUB_R} fill="none" stroke="oklch(1 0 0 / 0.06)" strokeWidth={1} />
            <motion.circle
              cx={CENTER}
              cy={CENTER}
              r={HUB_R - 8}
              fill="none"
              stroke="oklch(0.7 0.18 300 / 0.3)"
              strokeWidth={1}
              strokeDasharray="4 8"
              animate={{ rotate: -360 }}
              transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
              style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
            />
            <text
              x={CENTER}
              y={CENTER - 4}
              textAnchor="middle"
              className="fill-muted-foreground font-mono"
              style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: "0.15em" }}
            >
              memory
            </text>
            <text
              x={CENTER}
              y={CENTER + 12}
              textAnchor="middle"
              className="fill-foreground font-mono"
              style={{ fontSize: 18, fontWeight: 700 }}
            >
              {memoryList.length}
            </text>
            <text
              x={CENTER}
              y={CENTER + 24}
              textAnchor="middle"
              className="fill-muted-foreground font-mono"
              style={{ fontSize: 7 }}
            >
              items
            </text>
          </svg>

          {/* Auto-rotate indicator */}
          <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 font-mono text-[8px] text-muted-foreground/50">
            <RotateCw className="h-2.5 w-2.5 animate-spin" style={{ animationDuration: "30s" }} />
            auto-rotate
          </div>
        </div>

        {/* Side panel: selected memory details or list */}
        <div className="w-full min-w-0 flex-1">
          {selectedMemory ? (
            <motion.div
              key={selectedMemory.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-2"
            >
              <div className="flex items-center gap-2">
                <Link2 className="h-3 w-3 text-cyan-300" />
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  memory detail
                </span>
              </div>
              <div className="border border-border/40 bg-background/40 p-3" style={{ borderRadius: 0 }}>
                <div className="flex items-center gap-2">
                  <span
                    className="mc-led"
                    style={{ background: MEMORY_SCOPE_META[selectedMemory.scope as MemoryScope]?.color }}
                  />
                  <span className="font-mono text-sm font-bold text-foreground">
                    {selectedMemory.key}
                  </span>
                  {selectedMemory.pinned && (
                    <Pin className="h-3 w-3 text-amber-300" fill="currentColor" />
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 font-mono text-[9px] text-muted-foreground">
                  <span className={MEMORY_SCOPE_META[selectedMemory.scope as MemoryScope]?.tone}>
                    {MEMORY_SCOPE_META[selectedMemory.scope as MemoryScope]?.label}
                  </span>
                  <span>·</span>
                  <span>strength {Math.round(selectedMemory.strength * 100)}%</span>
                  <span>·</span>
                  <span>{selectedMemory.linkedTo.length} links</span>
                </div>
                <p className="mt-2 font-mono text-[11px] leading-relaxed text-foreground/80">
                  {selectedMemory.value}
                </p>
                {/* Strength bar */}
                <div className="mt-2">
                  <div className="mb-0.5 font-mono text-[8px] uppercase tracking-wider text-muted-foreground">
                    connection strength
                  </div>
                  <div className="h-1.5 overflow-hidden bg-border/30" style={{ borderRadius: 0 }}>
                    <motion.div
                      className="h-full"
                      style={{ background: MEMORY_SCOPE_META[selectedMemory.scope as MemoryScope]?.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${selectedMemory.strength * 100}%` }}
                      transition={{ duration: 0.4 }}
                    />
                  </div>
                </div>
                {/* Tags */}
                {selectedMemory.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {selectedMemory.tags.map((tag) => (
                      <span
                        key={tag}
                        className="border border-border/60 bg-background/60 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground"
                        style={{ borderRadius: 0 }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {/* Owner */}
                {selectedMemory.agentId && (
                  <div className="mt-2 font-mono text-[9px] text-cyan-300">
                    ▸ {agents[selectedMemory.agentId]?.name ?? "unknown"}
                  </div>
                )}
              </div>
              {/* Linked memories */}
              {selectedMemory.linkedTo.length > 0 && (
                <div>
                  <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                    linked to ({selectedMemory.linkedTo.length})
                  </div>
                  <div className="space-y-1">
                    {selectedMemory.linkedTo
                      .map((id) => memories[id])
                      .filter((m): m is MemoryItem => m != null)
                      .map((linked) => (
                        <button
                          key={linked.id}
                          onClick={() => setSelectedNode(linked.id)}
                          className="flex w-full items-center gap-2 border border-border/40 bg-background/40 px-2.5 py-1.5 text-left transition-colors hover:border-border/70"
                          style={{ borderRadius: 0 }}
                        >
                          <span
                            className="mc-led"
                            style={{ background: MEMORY_SCOPE_META[linked.scope as MemoryScope]?.color }}
                          />
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                            {linked.key}
                          </span>
                          <span className="font-mono text-[9px] text-muted-foreground">
                            {Math.round(linked.strength * 100)}%
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </motion.div>
          ) : (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Search className="h-3 w-3 text-muted-foreground" />
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  all memories · click a node to inspect
                </span>
              </div>
              <div className="mc-scroll max-h-[28rem] space-y-1 overflow-y-auto">
                {memoryList.map((memory) => {
                  const meta = MEMORY_SCOPE_META[memory.scope as MemoryScope] ?? MEMORY_SCOPE_META.knowledge;
                  return (
                    <button
                      key={memory.id}
                      onClick={() => setSelectedNode(memory.id)}
                      onMouseEnter={() => setHoveredNode(memory.id)}
                      onMouseLeave={() => setHoveredNode(null)}
                      className="flex w-full items-center gap-2 border border-border/40 bg-background/40 px-2.5 py-1.5 text-left transition-colors hover:border-border/70"
                      style={{ borderRadius: 0 }}
                    >
                      <span
                        className={`mc-led ${memory.pinned ? "mc-led-blink" : ""}`}
                        style={{ background: meta.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-mono text-[11px] font-medium text-foreground">
                            {memory.key}
                          </span>
                          {memory.pinned && <Pin className="h-2.5 w-2.5 text-amber-300" fill="currentColor" />}
                        </div>
                        <div className="truncate font-mono text-[9px] text-muted-foreground">
                          {memory.value.slice(0, 60)}…
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-0.5">
                        <span className={`font-mono text-[9px] uppercase ${meta.tone}`}>
                          {meta.label}
                        </span>
                        <span className="font-mono text-[8px] text-muted-foreground">
                          {memory.linkedTo.length} links
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-4 py-2 font-mono text-[9px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="mc-led mc-led-blink" style={{ background: "oklch(0.78 0.15 80)" }} /> pinned
        </span>
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-4 bg-cyan-400/50" style={{ borderTop: "1px dashed" }} /> linked
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 border border-violet-400" style={{ borderRadius: 0 }} /> high strength
        </span>
        <span className="ml-auto text-muted-foreground/60">
          node size = strength · click to inspect
        </span>
      </div>
    </section>
  );
}
