"use client";

import { useMemo, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import {
  PRIORITY_META,
  type Task,
  type TaskStatus,
  type TaskPriority,
} from "@/lib/types";
import { relTime } from "@/hooks/use-clock";
import { Workflow, Circle, ArrowRight, Info } from "lucide-react";

/**
 * TaskDagView — interactive node-link dependency diagram.
 *
 * Renders the task pipeline as a directed acyclic graph: nodes positioned
 * in status lanes (columns), with SVG edges drawn for `dependsOn`
 * relationships. Nodes are color-coded by status, sized by priority, and
 * carry hover tooltips. Clicking a node scrolls the task pipeline into
 * view and highlights the matching row.
 *
 * Layout strategy: a deterministic lane-per-status column layout with
 * vertical stacking inside each lane. This avoids a full force-directed
 * simulation (which is jittery and hard to read) while still surfacing
 * the dependency topology clearly. Edges are bezier curves that route
 * around nodes.
 */

const STATUS_LANE_ORDER: TaskStatus[] = ["pending", "running", "completed", "failed", "blocked"];
const STATUS_LANE_LABEL: Record<TaskStatus, string> = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  blocked: "Blocked",
};
const STATUS_NODE_FILL: Record<TaskStatus, string> = {
  pending: "oklch(0.3 0.014 250)",
  running: "oklch(0.4 0.12 75)",
  completed: "oklch(0.4 0.12 150)",
  failed: "oklch(0.45 0.18 18)",
  blocked: "oklch(0.4 0.12 300)",
};
const STATUS_NODE_STROKE: Record<TaskStatus, string> = {
  pending: "oklch(0.55 0.01 250)",
  running: "oklch(0.78 0.15 80)",
  completed: "oklch(0.75 0.16 150)",
  failed: "oklch(0.68 0.22 18)",
  blocked: "oklch(0.7 0.18 300)",
};
const PRIORITY_RADIUS: Record<TaskPriority, number> = {
  low: 9,
  medium: 11,
  high: 13,
  critical: 15,
};

interface NodePos {
  id: string;
  task: Task;
  x: number;
  y: number;
  r: number;
  lane: TaskStatus;
}

const LANE_WIDTH = 200;
const LANE_GAP = 24;
const NODE_GAP_Y = 44;
const TOP_PADDING = 52;
const LEFT_PADDING = 32;
const SVG_HEIGHT = 360;

export function TaskDagView({ onJumpToTask }: { onJumpToTask?: () => void }) {
  const tasks = useMissionStore((s) => s.tasks);
  const [hovered, setHovered] = useState<string | null>(null);

  const { nodes, edges, lanes } = useMemo(() => {
    const taskList = Object.values(tasks);
    const byLane = new Map<TaskStatus, Task[]>();
    for (const s of STATUS_LANE_ORDER) byLane.set(s, []);
    for (const t of taskList) {
      const lane = byLane.get(t.status as TaskStatus);
      if (lane) lane.push(t);
    }

    const nodeMap = new Map<string, NodePos>();
    STATUS_LANE_ORDER.forEach((lane, laneIdx) => {
      const items = byLane.get(lane) ?? [];
      items.forEach((task, i) => {
        const x = LEFT_PADDING + laneIdx * (LANE_WIDTH + LANE_GAP) + LANE_WIDTH / 2;
        const y = TOP_PADDING + i * NODE_GAP_Y + 20;
        nodeMap.set(task.id, {
          id: task.id,
          task,
          x,
          y,
          r: PRIORITY_RADIUS[task.priority as TaskPriority] ?? 11,
          lane,
        });
      });
    });

    const edgeList: Array<{ from: NodePos; to: NodePos }> = [];
    for (const t of taskList) {
      const deps = t.dependsOn ?? [];
      const to = nodeMap.get(t.id);
      if (!to) continue;
      for (const depId of deps) {
        const from = nodeMap.get(depId);
        if (from) edgeList.push({ from, to });
      }
    }

    return {
      nodes: Array.from(nodeMap.values()),
      edges: edgeList,
      lanes: STATUS_LANE_ORDER.map((s, i) => ({
        status: s,
        x: LEFT_PADDING + i * (LANE_WIDTH + LANE_GAP),
        count: byLane.get(s)?.length ?? 0,
      })),
    };
  }, [tasks]);

  const totalWidth = LEFT_PADDING + STATUS_LANE_ORDER.length * (LANE_WIDTH + LANE_GAP);
  const svgWidth = Math.max(totalWidth, 600);

  const onNodeClick = useCallback(
    (task: Task) => {
      onJumpToTask?.();
      // Defer the scroll so the DAG collapses first if in a sheet.
      window.setTimeout(() => {
        const el = document.getElementById(`task-row-${task.id}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("mc-highlight-flash");
          window.setTimeout(() => el.classList.remove("mc-highlight-flash"), 1200);
        }
      }, 60);
    },
    [onJumpToTask]
  );

  return (
    <section className="mc-surface flex flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Workflow className="h-4 w-4 text-cyan-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Task Dependency Graph
          </h2>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Circle className="h-2 w-2 fill-current text-cyan-300" /> {nodes.length} nodes
          </span>
          <span className="text-border">·</span>
          <span className="flex items-center gap-1">
            <ArrowRight className="h-2.5 w-2.5 text-violet-300" /> {edges.length} edges
          </span>
        </div>
      </div>

      <div className="mc-scroll relative overflow-x-auto">
        <svg
          width={svgWidth}
          height={SVG_HEIGHT}
          className="block"
          role="img"
          aria-label="Task dependency graph"
        >
          {/* Lane backgrounds + labels */}
          {lanes.map((lane) => (
            <g key={lane.status}>
              <rect
                x={lane.x}
                y={8}
                width={LANE_WIDTH}
                height={SVG_HEIGHT - 16}
                rx={8}
                fill="oklch(1 0 0 / 0.015)"
                stroke="oklch(1 0 0 / 0.05)"
                strokeWidth={1}
              />
              <text
                x={lane.x + LANE_WIDTH / 2}
                y={28}
                textAnchor="middle"
                className="fill-muted-foreground font-mono"
                style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase" }}
              >
                {STATUS_LANE_LABEL[lane.status]} · {lane.count}
              </text>
            </g>
          ))}

          {/* Edges (drawn before nodes so nodes sit on top) */}
          {edges.map((edge, i) => {
            const isHoveredLink =
              hovered === edge.from.id || hovered === edge.to.id;
            return (
              <path
                key={`${edge.from.id}-${edge.to.id}-${i}`}
                d={bezierPath(edge.from.x, edge.from.y, edge.to.x, edge.to.y)}
                fill="none"
                stroke={isHoveredLink ? "oklch(0.78 0.16 195 / 0.8)" : "oklch(1 0 0 / 0.14)"}
                strokeWidth={isHoveredLink ? 2 : 1}
                strokeDasharray={edge.to.task.status === "blocked" ? "4 3" : undefined}
                style={{ transition: "stroke 0.15s, stroke-width 0.15s" }}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const isHovered = hovered === node.id;
            const isDimmed = hovered !== null && !isHovered && !hasEdgeTo(hovered, node.id, edges);
            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                className="cursor-pointer"
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onNodeClick(node.task)}
              >
                {/* Glow ring when hovered or running */}
                {(isHovered || node.task.status === "running") && (
                  <circle
                    r={node.r + 5}
                    fill="none"
                    stroke={STATUS_NODE_STROKE[node.lane]}
                    strokeWidth={1.5}
                    opacity={node.task.status === "running" ? 0.5 : 0.8}
                    className={node.task.status === "running" ? "mc-anim-breathe" : ""}
                    style={{ transformOrigin: "center" }}
                  />
                )}
                <motion.circle
                  r={node.r}
                  fill={STATUS_NODE_FILL[node.lane]}
                  stroke={STATUS_NODE_STROKE[node.lane]}
                  strokeWidth={isHovered ? 2.5 : 1.5}
                  opacity={isDimmed ? 0.3 : 1}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  style={{ transformOrigin: "center" }}
                />
                {/* Progress arc for running tasks */}
                {node.task.status === "running" && (
                  <circle
                    r={node.r + 3}
                    fill="none"
                    stroke="oklch(0.78 0.15 80)"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeDasharray={`${(node.task.progress / 100) * 2 * Math.PI * (node.r + 3)} ${2 * Math.PI * (node.r + 3)}`}
                    transform="rotate(-90)"
                  />
                )}
                {/* Task label */}
                <text
                  y={node.r + 14}
                  textAnchor="middle"
                  className="fill-foreground/80 font-mono"
                  style={{ fontSize: 9, pointerEvents: "none" }}
                >
                  {truncate(node.task.title, 22)}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Hover tooltip overlay */}
        {hovered && (
          <div className="pointer-events-none absolute right-3 top-3 max-w-xs rounded-lg border border-border/70 bg-popover/95 p-2.5 shadow-lg backdrop-blur">
            {(() => {
              const node = nodes.find((n) => n.id === hovered);
              if (!node) return null;
              const pm = PRIORITY_META[node.task.priority as TaskPriority] ?? PRIORITY_META.medium;
              return (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_NODE_STROKE[node.lane]}`} style={{ background: STATUS_NODE_STROKE[node.lane] }} />
                    <span className="font-mono text-[10px] font-semibold uppercase text-foreground">{node.task.title}</span>
                  </div>
                  {node.task.description && (
                    <p className="font-mono text-[10px] text-muted-foreground">{node.task.description}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-2 font-mono text-[9px] text-muted-foreground">
                    <span className={`uppercase ${pm.tone}`}>{pm.label}</span>
                    <span className="text-border">·</span>
                    <span>{node.task.kind}</span>
                    <span className="text-border">·</span>
                    <span>{node.task.progress}%</span>
                    <span className="text-border">·</span>
                    <span>{relTime(node.task.createdAt)}</span>
                  </div>
                  {node.task.assignedTo?.name && (
                    <div className="font-mono text-[9px] text-cyan-300">▸ {node.task.assignedTo.name}</div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-4 py-2 font-mono text-[9px] text-muted-foreground">
        {STATUS_LANE_ORDER.map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: STATUS_NODE_STROKE[s] }} />
            {STATUS_LANE_LABEL[s]}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-1 text-muted-foreground/70">
          <Info className="h-2.5 w-2.5" /> click a node to locate in pipeline
        </span>
      </div>
    </section>
  );
}

/** Cubic bezier path between two points, routing horizontally between lanes. */
function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.abs(x2 - x1);
  const cp = Math.max(40, dx * 0.5);
  return `M ${x1} ${y1} C ${x1 + cp} ${y1}, ${x2 - cp} ${y2}, ${x2} ${y2}`;
}

function hasEdgeTo(fromId: string, toId: string, edges: Array<{ from: NodePos; to: NodePos }>): boolean {
  return edges.some((e) => (e.from.id === fromId && e.to.id === toId) || (e.from.id === toId && e.to.id === fromId));
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
