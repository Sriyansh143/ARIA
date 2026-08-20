"use client";

import { useCallback, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import {
  AGENT_STATUS_META,
  type Agent,
  type AgentStatus,
  type MemoryItem,
  type MemoryScope,
} from "@/lib/types";
import { FullScreenPanel } from "./full-screen-panel";
import {
  Crown,
  Code2,
  FlaskConical,
  Settings,
  DollarSign,
  TrendingUp,
  Headphones,
  Megaphone,
  Scale,
  ShieldCheck,
  Radio,
  Users,
  Languages,
  Briefcase,
  Network,
  Brain,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";

/**
 * NeuralCoreMemory — unified centerpiece visualization.
 *
 * Combines the neural department graph + the memory galaxy into ONE panel
 * that REPLACES both in the Overview tab. The ARIA Core pulses at the
 * center surrounded by a tight spiral of memory "stars" (colored by
 * scope). 15 department hexagons orbit on the outer ring.
 *
 * Default view: ONLY departments on the outer ring + memories in the
 * center (department agent dots are HIDDEN).
 *
 * Interactions:
 *  - Click a department → it scales up, others dim to 30%, its agents
 *    appear as FULL agent balls (with name + role icon) arranged in a fan
 *    beside the department. Slide navigation (ChevronLeft/ChevronRight)
 *    appears to step through departments without going back to default.
 *  - Click the ARIA core or empty SVG background → returns to default.
 *  - Click an agent ball → calls onOpenAgent(agentId) to open the
 *    AgentDetailDrawer.
 *
 * Real-time: data-flow particles only pulse on lines connected to
 * departments that have at least one active agent.
 *
 * Task ID: ANIM-REDESIGN (Task 3).
 */

interface DeptConfig {
  name: string;
  label: string;
  color: string;
  icon: LucideIcon;
}

const DEPT_CONFIG: Record<string, DeptConfig> = {
  Executive: { name: "Executive", label: "EXEC", color: "#a855f7", icon: Crown },
  Engineering: { name: "Engineering", label: "ENG", color: "#06b6d4", icon: Code2 },
  Research: { name: "Research", label: "R&D", color: "#10b981", icon: FlaskConical },
  Operations: { name: "Operations", label: "OPS", color: "#f59e0b", icon: Settings },
  Finance: { name: "Finance", label: "FIN", color: "#84cc16", icon: DollarSign },
  Sales: { name: "Sales", label: "SALES", color: "#ec4899", icon: TrendingUp },
  Support: { name: "Support", label: "SUPPORT", color: "#3b82f6", icon: Headphones },
  Marketing: { name: "Marketing", label: "MKTG", color: "#f97316", icon: Megaphone },
  Legal: { name: "Legal", label: "LEGAL", color: "#eab308", icon: Scale },
  Ethics: { name: "Ethics", label: "ETHICS", color: "#ef4444", icon: ShieldCheck },
  Communications: { name: "Communications", label: "COMMS", color: "#8b5cf6", icon: Radio },
  Community: { name: "Community", label: "COMMUNITY", color: "#14b8a6", icon: Users },
  Linguist: { name: "Linguist", label: "LINGUIST", color: "#6366f1", icon: Languages },
  Clients: { name: "Clients", label: "CLIENTS", color: "#f43f5e", icon: Briefcase },
  Conductor: { name: "Conductor", label: "CONDUCTOR", color: "#64748b", icon: Network },
};

const DEPT_ORDER = Object.keys(DEPT_CONFIG);

const SVG_SIZE = 700;
const CENTER = SVG_SIZE / 2;
const DEPT_RADIUS = 220;
const HEX_R = 22;
// v35: reduced core radius from 46 to 28 — the big center ball is no longer
// the focal point. The memory stars + connection lines carry the visual
// weight, making the panel feel like a neural network of memories.
const CORE_R = 28;
const ACTIVE_STATUSES: AgentStatus[] = ["thinking", "executing", "streaming", "waiting"];

// ─── Memory scope → visual bucket ──────────────────────────────────
// knowledge=violet, context=cyan, skill=emerald, preference=amber.
type Bucket = "knowledge" | "context" | "skill" | "preference";

const SCOPE_BUCKET: Record<MemoryScope, Bucket> = {
  knowledge: "knowledge",
  strategy: "knowledge",
  branding: "context",
  config: "context",
  agent: "skill",
  system: "preference",
};

const BUCKET_META: Record<Bucket, { color: string; rgb: string; label: string }> = {
  knowledge: { color: "#a78bfa", rgb: "167, 139, 250", label: "Knowledge" },
  context: { color: "#22d3ee", rgb: "34, 211, 238", label: "Context" },
  skill: { color: "#34d399", rgb: "52, 211, 153", label: "Skill" },
  preference: { color: "#fbbf24", rgb: "251, 191, 36", label: "Preference" },
};

const MAX_MEMORIES = 24;

function seededRand(i: number, salt: number): number {
  const seed = (i * 9301 + 49297 + salt * 7919) % 233280;
  return seed / 233280;
}

function polar(angleDeg: number, radius: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CENTER + Math.cos(rad) * radius, y: CENTER + Math.sin(rad) * radius };
}

function hexPath(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((-90 + i * 60) * Math.PI) / 180;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts.join(" L")} Z`;
}

function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

interface NeuralCoreMemoryProps {
  /** Called when an agent ball is clicked. */
  onOpenAgent?: (id: string) => void;
}

export function NeuralCoreMemory({ onOpenAgent }: NeuralCoreMemoryProps) {
  const agents = useMissionStore((s) => s.agents);
  const memories = useMissionStore((s) => s.memories);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);

  // Group agents by department.
  const { deptList, totalAgents, activeAgents, memoryCount } = useMemo(() => {
    const map: Record<string, Agent[]> = {};
    for (const d of DEPT_ORDER) map[d] = [];
    for (const a of Object.values(agents)) {
      const dept = a.department && map[a.department] ? a.department : "Conductor";
      map[dept].push(a);
    }
    for (const d of Object.keys(map)) {
      map[d].sort((x, y) => x.name.localeCompare(y.name));
    }

    const list = DEPT_ORDER.map((name, i) => {
      const angle = (i / DEPT_ORDER.length) * 360 - 90;
      const pos = polar(angle, DEPT_RADIUS);
      const cfg = DEPT_CONFIG[name];
      const deptAgents = map[name] ?? [];
      return {
        name,
        label: cfg.label,
        color: cfg.color,
        icon: cfg.icon,
        angle,
        x: pos.x,
        y: pos.y,
        agents: deptAgents,
        activeCount: deptAgents.filter((a) => ACTIVE_STATUSES.includes(a.status as AgentStatus)).length,
      };
    });

    const all = Object.values(agents);
    const memCount = Object.keys(memories).length;
    return {
      deptList: list,
      totalAgents: all.length,
      activeAgents: all.filter((a) => ACTIVE_STATUSES.includes(a.status as AgentStatus)).length,
      memoryCount: memCount,
    };
  }, [agents, memories]);

  // Deterministic memory positions in a tight spiral around the core.
  const memoryStars = useMemo(() => {
    const all = Object.values(memories).slice(0, MAX_MEMORIES);
    return all.map((m, i) => {
      const arm = i % 2;
      const along = Math.floor(i / 2);
      const theta = along * 0.85 + arm * Math.PI;
      const r = 14 + along * 7;
      const x = CENTER + r * Math.cos(theta);
      const y = CENTER + r * Math.sin(theta);
      const sizeRand = seededRand(i, 1);
      const delay = seededRand(i, 2) * 3;
      return {
        memory: m,
        x,
        y,
        size: 2.2 + sizeRand * 1.6,
        bucket: SCOPE_BUCKET[m.scope as MemoryScope] ?? "knowledge",
        delay,
      };
    });
  }, [memories]);

  // Particle seeds for connection lines (dept → core), bidirectional.
  const particleSeeds = useMemo(() => {
    const out: { deptName: string; path: string; delay: number; dur: number }[] = [];
    DEPT_ORDER.forEach((name, i) => {
      const angle = (i / DEPT_ORDER.length) * 360 - 90;
      const pos = polar(angle, DEPT_RADIUS);
      const inward = `M${pos.x.toFixed(2)},${pos.y.toFixed(2)} L${CENTER},${CENTER}`;
      const outward = `M${CENTER},${CENTER} L${pos.x.toFixed(2)},${pos.y.toFixed(2)}`;
      out.push({ deptName: name, path: inward, delay: (i * 0.7) % 3.2, dur: 2.8 + (i % 3) * 0.6 });
      out.push({ deptName: name, path: outward, delay: (i * 1.3 + 1.4) % 3.4, dur: 3.2 + (i % 4) * 0.5 });
    });
    return out;
  }, []);

  // Fan layout for selected department's agents (V-shape, alternating L/R arms).
  const fanLayout = useMemo(() => {
    if (!selectedDept) return null;
    const dept = deptList.find((d) => d.name === selectedDept);
    if (!dept) return null;
    const slots = dept.agents.map((agent, i) => {
      const isLeft = i % 2 === 0;
      const step = Math.floor(i / 2);
      const armOffset = isLeft ? -32 : 32;
      const absoluteAngle = dept.angle + armOffset;
      const distance = 64 + step * 32;
      const rad = (absoluteAngle * Math.PI) / 180;
      return {
        agent,
        x: dept.x + Math.cos(rad) * distance,
        y: dept.y + Math.sin(rad) * distance,
        active: ACTIVE_STATUSES.includes(agent.status as AgentStatus),
      };
    });
    return { dept, slots };
  }, [selectedDept, deptList]);

  const handleReset = useCallback(() => setSelectedDept(null), []);

  const stepDept = useCallback(
    (dir: 1 | -1) => {
      setSelectedDept((cur) => {
        if (!cur) return DEPT_ORDER[0];
        const idx = DEPT_ORDER.indexOf(cur);
        const next = (idx + dir + DEPT_ORDER.length) % DEPT_ORDER.length;
        return DEPT_ORDER[next];
      });
    },
    []
  );

  const handleAgentClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      onOpenAgent?.(id);
    },
    [onOpenAgent]
  );

  const bucketCounts = useMemo(() => {
    const counts: Record<Bucket, number> = {
      knowledge: 0,
      context: 0,
      skill: 0,
      preference: 0,
    };
    for (const s of memoryStars) counts[s.bucket]++;
    return counts;
  }, [memoryStars]);

  return (
    <FullScreenPanel
      title="ARIA Neural Core + Memory"
      icon={<Brain className="h-4 w-4 text-violet-300" />}
      actions={
        <div className="hidden items-center gap-2 font-mono text-[10px] text-muted-foreground sm:flex">
          <span>
            <span className="text-cyan-300">{activeAgents}</span>
            <span className="text-muted-foreground/60">/</span>
            <span>{totalAgents}</span> agents
          </span>
          <span className="text-border">·</span>
          <span className="text-violet-300">{memoryCount}</span>
          <span>memories</span>
        </div>
      }
    >
      <div className="relative">
        <svg
          viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
          className="block h-auto max-h-[640px] w-full"
          role="img"
          aria-label="ARIA neural core with department ring and memory stars"
          onClick={(e) => {
            // Click on background (the SVG root) resets selection.
            if (e.target === e.currentTarget) handleReset();
          }}
        >
          <defs>
            <radialGradient id="ncm-core-grad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="35%" stopColor="#c4b5fd" />
              <stop offset="65%" stopColor="#a855f7" />
              <stop offset="100%" stopColor="#06b6d4" />
            </radialGradient>
            <filter id="ncm-glow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="ncm-strong-glow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="7" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <style>{`
              @keyframes ncm-flow-out {
                from { stroke-dashoffset: 16; }
                to   { stroke-dashoffset: 0; }
              }
              .ncm-flow-line {
                animation: ncm-flow-out 2.4s linear infinite;
              }
            `}</style>
          </defs>

          {/* Background click target — also resets selection when clicked */}
          <rect
            x={0}
            y={0}
            width={SVG_SIZE}
            height={SVG_SIZE}
            fill="transparent"
            onClick={handleReset}
          />

          {/* Subtle radial backdrop glow behind the core */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={260}
            fill="url(#ncm-core-grad)"
            opacity={0.04}
            style={{ pointerEvents: "none" }}
          />

          {/* Connection lines: core → each department */}
          <g>
            {deptList.map((d) => {
              const isSel = selectedDept === d.name;
              const dim = selectedDept !== null && !isSel;
              const isActive = d.activeCount > 0;
              return (
                <g
                  key={`line-${d.name}`}
                  opacity={dim ? 0.12 : 1}
                  style={{ transition: "opacity 0.4s", pointerEvents: "none" }}
                >
                  <motion.line
                    x1={CENTER}
                    y1={CENTER}
                    x2={d.x}
                    y2={d.y}
                    stroke={withAlpha(d.color, 0.22)}
                    strokeWidth={1}
                    initial={{ opacity: 0 }} animate={{ opacity: isActive ? [0.4, 0.8, 0.4] : 0.4 }}
                    transition={{ duration: 1.8, repeat: isActive ? Infinity : 0, ease: "easeInOut" }}
                  />
                  <line
                    x1={CENTER}
                    y1={CENTER}
                    x2={d.x}
                    y2={d.y}
                    stroke={withAlpha(d.color, isSel ? 0.95 : isActive ? 0.7 : 0.5)}
                    strokeWidth={isSel ? 1.6 : 1}
                    strokeDasharray="6 10"
                    strokeLinecap="round"
                    className="ncm-flow-line"
                    style={{
                      animationDelay: `${(-((d.angle + 360) % 360) / 360) * 2.4}s`,
                      filter: isSel ? `drop-shadow(0 0 4px ${d.color})` : "none",
                    }}
                  />
                </g>
              );
            })}
          </g>

          {/* Flowing particles (only on lines connected to active departments) */}
          <g style={{ pointerEvents: "none" }}>
            {particleSeeds.map((p, i) => {
              const dept = deptList.find((d) => d.name === p.deptName);
              if (!dept) return null;
              const isSel = selectedDept === p.deptName;
              const dim = selectedDept !== null && !isSel;
              const isActive = dept.activeCount > 0;
              if (!isActive) return null; // no particles if no active agents
              return (
                <g key={`part-${i}`} opacity={dim ? 0.12 : 1} style={{ transition: "opacity 0.4s" }}>
                  <circle
                    r={1.7}
                    fill={withAlpha("#22d3ee", isSel ? 0.95 : 0.8)}
                    style={{ filter: `drop-shadow(0 0 3px ${withAlpha("#22d3ee", 0.7)})` }}
                  >
                    <animateMotion
                      path={p.path}
                      dur={`${p.dur}s`}
                      begin={`${p.delay}s`}
                      repeatCount="indefinite"
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
                </g>
              );
            })}
          </g>

          {/* Department hexagons */}
          <g>
            {deptList.map((d) => {
              const isSel = selectedDept === d.name;
              const dim = selectedDept !== null && !isSel;
              const Icon = d.icon;
              return (
                <g key={`dept-${d.name}`} transform={`translate(${d.x},${d.y})`}>
                  <motion.g
                    initial={{ opacity: 0 }} animate={{ opacity: dim ? 0.3 : 1, scale: isSel ? 1.3 : 1 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    style={{ transformBox: "fill-box", transformOrigin: "center", cursor: "pointer" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedDept(isSel ? null : d.name);
                    }}
                  >
                    <circle
                      r={HEX_R + 7}
                      fill={withAlpha(d.color, isSel ? 0.22 : 0.12)}
                      filter="url(#ncm-glow)"
                      style={{ pointerEvents: "none" }}
                    />
                    <AnimatePresence>
                      {isSel && (
                        <motion.circle
                          key="sel-ring"
                          r={HEX_R + 4}
                          fill="none"
                          stroke={d.color}
                          strokeWidth={1.5}
                          initial={{ opacity: 0, r: HEX_R }}
                          animate={{ opacity: [0.8, 0.2, 0.8], r: [HEX_R + 4, HEX_R + 10, HEX_R + 4] }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                          style={{ pointerEvents: "none" }}
                        />
                      )}
                    </AnimatePresence>
                    <path
                      d={hexPath(0, 0, HEX_R)}
                      fill={withAlpha(d.color, 0.8)}
                      stroke={d.color}
                      strokeWidth={1.5}
                      style={{ filter: `drop-shadow(0 0 5px ${withAlpha(d.color, 0.6)})` }}
                    />
                    <path
                      d={hexPath(0, 0, HEX_R - 5)}
                      fill="none"
                      stroke={withAlpha("#ffffff", 0.18)}
                      strokeWidth={0.75}
                      style={{ pointerEvents: "none" }}
                    />
                    <g transform="translate(-9,-9)" style={{ pointerEvents: "none" }}>
                      <Icon size={18} color="#ffffff" strokeWidth={2} />
                    </g>
                    <g transform={`translate(${HEX_R - 1},${-HEX_R + 3})`} style={{ pointerEvents: "none" }}>
                      <circle r={8.5} fill="#0a0a0f" stroke={d.color} strokeWidth={1.3} />
                      <text
                        textAnchor="middle"
                        y={3.2}
                        fontSize={9.5}
                        fontWeight={700}
                        className="fill-white font-mono"
                      >
                        {d.agents.length}
                      </text>
                    </g>
                  </motion.g>

                  <text
                    y={HEX_R + 17}
                    textAnchor="middle"
                    fontSize={10}
                    className="fill-zinc-400 font-mono"
                    style={{ letterSpacing: "0.1em", pointerEvents: "none" }}
                  >
                    {d.label}
                  </text>
                  {d.activeCount > 0 && (
                    <text
                      y={HEX_R + 28}
                      textAnchor="middle"
                      fontSize={7}
                      className="fill-cyan-400/70 font-mono"
                      style={{ letterSpacing: "0.14em", pointerEvents: "none" }}
                    >
                      {d.activeCount} LIVE
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          {/* Selected department's agents — full agent balls in a fan */}
          <AnimatePresence>
            {fanLayout && (
              <motion.g
                key="fan"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                {/* Connecting lines: dept → each agent */}
                {fanLayout.slots.map((s) => (
                  <motion.line
                    key={`fline-${s.agent.id}`}
                    x1={fanLayout.dept.x}
                    y1={fanLayout.dept.y}
                    x2={s.x}
                    y2={s.y}
                    stroke={withAlpha(fanLayout.dept.color, 0.55)}
                    strokeWidth={1}
                    strokeDasharray="3 4"
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    style={{ pointerEvents: "none" }}
                  />
                ))}
                {/* Agent balls */}
                {fanLayout.slots.map((s, i) => {
                  const statusColor =
                    s.agent.status === "error"
                      ? "#ef4444"
                      : s.agent.status === "idle" || s.agent.status === "offline"
                        ? "#64748b"
                        : fanLayout.dept.color;
                  return (
                    <g key={`fball-${s.agent.id}`} transform={`translate(${s.x},${s.y})`}>
                      <motion.g
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.4, delay: 0.05 + i * 0.05, ease: "backOut" }}
                        style={{ transformBox: "fill-box", transformOrigin: "center", cursor: "pointer" }}
                        onClick={(e) => handleAgentClick(s.agent.id, e)}
                      >
                        {/* Halo */}
                        <circle r={12} fill={withAlpha(fanLayout.dept.color, 0.16)} style={{ pointerEvents: "none" }} />
                        {/* Active ping */}
                        {s.active && (
                          <motion.circle
                            r={7}
                            fill="none"
                            stroke={statusColor}
                            strokeWidth={1.2}
                            initial={{ opacity: 0.7 }} animate={{ r: [7, 14], opacity: [0.7, 0] }}
                            transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
                            style={{ pointerEvents: "none" }}
                          />
                        )}
                        {/* Ball body */}
                        <circle
                          r={8}
                          fill="#0a0a0f"
                          stroke={statusColor}
                          strokeWidth={1.5}
                          style={{
                            filter: `drop-shadow(0 0 5px ${statusColor})`,
                            pointerEvents: "none",
                          }}
                        />
                        {/* Status dot */}
                        <circle cx={5.5} cy={-5.5} r={2} fill={statusColor} style={{ pointerEvents: "none" }} />
                        {/* Agent name label */}
                        <text
                          y={-13}
                          textAnchor="middle"
                          fontSize={8}
                          className="fill-zinc-200 font-mono"
                          style={{ pointerEvents: "none" }}
                        >
                          {s.agent.name.length > 14 ? s.agent.name.slice(0, 13) + "…" : s.agent.name}
                        </text>
                        {/* Role label */}
                        <text
                          y={-5}
                          textAnchor="middle"
                          fontSize={6}
                          className="fill-zinc-500 font-mono"
                          style={{ pointerEvents: "none", letterSpacing: "0.08em" }}
                        >
                          {s.agent.role}
                        </text>
                        {/* Hit area */}
                        <circle r={13} fill="transparent" />
                      </motion.g>
                    </g>
                  );
                })}
              </motion.g>
            )}
          </AnimatePresence>

          {/* ARIA Core + memory stars (rendered last so it sits on top + is clickable) */}
          <g transform={`translate(${CENTER},${CENTER})`}>
            {/* Radiating rings */}
            {[0, 1, 2].map((i) => (
              <motion.circle
                key={`ring-${i}`}
                cx={0}
                cy={0}
                fill="none"
                stroke={withAlpha("#8b5cf6", 0.5)}
                strokeWidth={1}
                initial={{ r: CORE_R, opacity: 0 }}
                animate={{ r: [CORE_R, 120], opacity: [0.55, 0] }}
                transition={{ duration: 3, repeat: Infinity, delay: i * 1, ease: "easeOut" }}
                style={{ pointerEvents: "none" }}
              />
            ))}

            {/* Rotating dashed scan ring */}
            <circle
              cx={0}
              cy={0}
              r={CORE_R - 6}
              fill="none"
              stroke={withAlpha("#22d3ee", 0.5)}
              strokeWidth={1}
              strokeDasharray="4 8"
              style={{ pointerEvents: "none" }}
            >
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="0 0 0"
                to="360 0 0"
                dur="9s"
                repeatCount="indefinite"
              />
            </circle>

            {/* Counter-rotating inner ring */}
            <circle
              cx={0}
              cy={0}
              r={CORE_R - 14}
              fill="none"
              stroke={withAlpha("#a855f7", 0.45)}
              strokeWidth={0.75}
              strokeDasharray="2 6"
              style={{ pointerEvents: "none" }}
            >
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="360 0 0"
                to="0 0 0"
                dur="7s"
                repeatCount="indefinite"
              />
            </circle>

            {/* The core orb itself (clickable → resets selection) */}
            <motion.circle
              cx={0}
              cy={0}
              r={CORE_R}
              fill="url(#ncm-core-grad)"
              filter="url(#ncm-strong-glow)"
              animate={{ r: [CORE_R, CORE_R + 2, CORE_R] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              onClick={handleReset}
              style={{ cursor: selectedDept ? "pointer" : "default" }}
            />

            {/* Memory stars (rendered relative to center) */}
            {memoryStars.length === 0 ? (
              <text
                x={0}
                y={2}
                textAnchor="middle"
                fontSize={9}
                className="fill-white/80 font-mono"
                style={{ pointerEvents: "none", letterSpacing: "0.12em" }}
              >
                0 memories
              </text>
            ) : (
              memoryStars.map((s) => {
                const meta = BUCKET_META[s.bucket];
                const relX = s.x - CENTER;
                const relY = s.y - CENTER;
                return (
                  <motion.circle
                    key={s.memory.id}
                    cx={relX}
                    cy={relY}
                    r={s.size}
                    fill={meta.color}
                    style={{ filter: `drop-shadow(0 0 4px ${meta.color})`, pointerEvents: "none" }}
                    initial={{ opacity: 0.5 }} animate={{ opacity: [0.5, 1, 0.5], r: [s.size, s.size + 0.6, s.size] }}
                    transition={{
                      duration: 2.5 + (s.delay % 1.5),
                      repeat: Infinity,
                      delay: s.delay,
                      ease: "easeInOut",
                    }}
                  />
                );
              })
            )}

            {/* "ARIA" wordmark inside the core (only if there's room — memories don't overlap text) */}
            <text
              x={0}
              y={-2}
              textAnchor="middle"
              fontSize={16}
              fontWeight={800}
              className="fill-white font-mono"
              style={{
                letterSpacing: "0.18em",
                pointerEvents: "none",
                textShadow: "0 0 8px rgba(168,85,247,0.8)",
              }}
            >
              ARIA
            </text>
            <text
              x={0}
              y={11}
              textAnchor="middle"
              fontSize={6}
              className="fill-white/70 font-mono"
              style={{ letterSpacing: "0.32em", pointerEvents: "none" }}
            >
              CORE
            </text>

            {/* Reset hint when a department is selected */}
            <AnimatePresence>
              {selectedDept && (
                <motion.text
                  key="reset-hint"
                  x={0}
                  y={CORE_R + 36}
                  textAnchor="middle"
                  fontSize={7}
                  className="fill-cyan-300/70 font-mono"
                  style={{ letterSpacing: "0.2em", pointerEvents: "none" }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  ◦ CLICK CORE TO RESET ◦
                </motion.text>
              )}
            </AnimatePresence>
          </g>
        </svg>

        {/* Slide navigation for departments — appears when a dept is selected */}
        <AnimatePresence>
          {selectedDept && (
            <motion.div
              key="slide-nav"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2 }}
              className="pointer-events-auto absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-md border border-border/60 bg-background/80 px-1.5 py-1 backdrop-blur"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  stepDept(-1);
                }}
                aria-label="Previous department"
                className="flex h-6 w-6 items-center justify-center rounded border border-border/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="font-mono text-[10px] uppercase tracking-wider text-foreground">
                {DEPT_CONFIG[selectedDept]?.label ?? selectedDept}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  stepDept(1);
                }}
                aria-label="Next department"
                className="flex h-6 w-6 items-center justify-center rounded border border-border/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 px-4 py-2 font-mono text-[9px] text-muted-foreground">
        <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground/70">Memories</span>
        {(Object.keys(BUCKET_META) as Bucket[]).map((b) => (
          <span key={b} className="flex items-center gap-1">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: BUCKET_META[b].color, boxShadow: `0 0 4px ${BUCKET_META[b].color}` }}
            />
            {BUCKET_META[b].label}
            <span className="text-muted-foreground/60">{bucketCounts[b]}</span>
          </span>
        ))}
        <span className="ml-auto hidden text-muted-foreground/70 sm:inline">
          {selectedDept ? "click an agent ball for telemetry" : "click a department to expand"}
        </span>
      </div>
    </FullScreenPanel>
  );
}

export default NeuralCoreMemory;
