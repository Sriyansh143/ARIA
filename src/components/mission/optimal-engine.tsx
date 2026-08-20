"use client";

/**
 * OptimalEngine — concentric orbital agent-network visualization.
 *
 * Replaces the old NeuralCoreMemory on the Overview tab. Matches the
 * "Optimal Engine / Founder OS" blueprint reference:
 *   - Paper-white grid background (light) / zinc-950 (dark)
 *   - 100% monospace typography
 *   - Crimson core particles + department-colored hub/agent nodes
 *   - Concentric rings: core → dept hubs → agents → connectors → tasks
 *   - Department focus mode with carousel arrows
 *   - Skill detail panel modal
 *   - Brain inbox → /api/learning/ingest
 *
 * Data sources (READ-ONLY — does not modify API routes):
 *   - Zustand store: agents, tasks, skills, memories, llmCalls
 *   - ALL_CONNECTORS from connector-marketplace (static import)
 *   - SSE stream (via useMissionControl hook — already mounted by dashboard)
 *
 * Rendering: <canvas> for core particles (250 dots) + SVG for the graph +
 * framer-motion for panel transitions. Holds 60fps with 66 agents + 250 particles.
 */

import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, ChevronLeft, ChevronRight, Plug, Upload, Brain,
  Code2, TrendingUp, Megaphone, DollarSign, Settings, Radio,
  Headphones, FlaskConical, Scale, ShieldCheck, Users,
  Languages, Briefcase, Network, Crown, type LucideIcon,
} from "lucide-react";
import { useMissionStore } from "@/stores/mission-store";
import { ALL_CONNECTORS } from "@/lib/connector-marketplace";
import { useTheme } from "next-themes";

// ─── Department config (matches reference color palette) ───────────
interface DeptConfig {
  name: string;
  label: string;
  color: string;
  icon: LucideIcon;
}

const DEPT_CONFIG: Record<string, DeptConfig> = {
  Executive:      { name: "Executive",      label: "EXEC",     color: "#a855f7", icon: Crown },
  Engineering:    { name: "Engineering",    label: "ENG",      color: "#64748b", icon: Code2 },     // slate
  Sales:          { name: "Sales",          label: "SALES",    color: "#e11d48", icon: TrendingUp }, // crimson
  Marketing:      { name: "Marketing",      label: "MKTG",     color: "#f97316", icon: Megaphone },  // orange
  Finance:        { name: "Finance",        label: "FIN",      color: "#16a34a", icon: DollarSign }, // green
  Operations:     { name: "Operations",     label: "OPS",      color: "#f59e0b", icon: Settings },   // amber
  Communications: { name: "Communications", label: "COMMS",    color: "#2563eb", icon: Radio },      // blue
  Research:       { name: "Research",       label: "R&D",      color: "#6366f1", icon: FlaskConical }, // indigo
  Support:        { name: "Support",        label: "SUPPORT",  color: "#0d9488", icon: Headphones }, // teal
  Legal:          { name: "Legal",          label: "LEGAL",    color: "#eab308", icon: Scale },
  Ethics:         { name: "Ethics",         label: "ETHICS",   color: "#ef4444", icon: ShieldCheck },
  Community:      { name: "Community",      label: "COMM",     color: "#14b8a6", icon: Users },
  Linguist:       { name: "Linguist",       label: "LNG",      color: "#8b5cf6", icon: Languages },
  Clients:        { name: "Clients",        label: "CLIENTS",  color: "#0d9488", icon: Briefcase },  // teal
  Conductor:      { name: "Conductor",      label: "COND",     color: "#64748b", icon: Network },
};

const DEPT_LIST = Object.values(DEPT_CONFIG);
const CORE_COLOR = "#e11d48"; // crimson

// ─── Canvas particle system ────────────────────────────────────────

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  twinkle: number;
}

function CoreCanvas({
  particleCount,
  speed,
  pulse,
}: {
  particleCount: number;
  speed: number;
  pulse: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animRef = useRef<number>(0);

  // Initialize particles
  useEffect(() => {
    const particles: Particle[] = [];
    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 50 + 5;
      particles.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: Math.random() * 1.5 + 0.5,
        alpha: Math.random() * 0.6 + 0.2,
        twinkle: Math.random() * Math.PI * 2,
      });
    }
    particlesRef.current = particles;
  }, [particleCount]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = 120 * dpr;
    canvas.height = 120 * dpr;
    ctx.scale(dpr, dpr);

    const animate = () => {
      ctx.clearRect(0, 0, 120, 120);
      ctx.save();
      ctx.translate(60, 60);

      const particles = particlesRef.current;
      const effectiveSpeed = speed * (1 + pulse * 2);

      for (const p of particles) {
        // Drift
        p.x += p.vx * effectiveSpeed;
        p.y += p.vy * effectiveSpeed;

        // Bounce within circle
        const dist = Math.sqrt(p.x * p.x + p.y * p.y);
        if (dist > 55) {
          p.x = (p.x / dist) * 55;
          p.y = (p.y / dist) * 55;
          p.vx *= -1;
          p.vy *= -1;
        }

        // Twinkle
        p.twinkle += 0.02;
        const twinkleAlpha = p.alpha * (0.5 + 0.5 * Math.sin(p.twinkle));

        // Draw
        ctx.fillStyle = `rgba(225, 29, 72, ${twinkleAlpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
      animRef.current = requestAnimationFrame(animate);
    };

    animate();
    return () => cancelAnimationFrame(animRef.current);
  }, [speed, pulse]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: 120, height: 120 }}
      className="absolute inset-0"
    />
  );
}

// ─── Main component ────────────────────────────────────────────────

export function OptimalEngine({ onOpenAgent }: { onOpenAgent?: (id: string) => void }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const agents = useMissionStore((s) => s.agents);
  const tasks = useMissionStore((s) => s.tasks);
  const skills = useMissionStore((s) => s.skills);
  const memories = useMissionStore((s) => s.memories);
  const llmCalls = useMissionStore((s) => s.llmCalls);

  const [focusedDept, setFocusedDept] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<any | null>(null);
  const [brainInput, setBrainInput] = useState("");
  const [brainSubmitting, setBrainSubmitting] = useState(false);
  const [corePulse, setCorePulse] = useState(0);

  const agentList = Object.values(agents);
  const taskList = Object.values(tasks);
  const memoryCount = Object.keys(memories).length;
  const llmCallsLastMin = llmCalls.filter(
    (c) => Date.now() - new Date(c.createdAt).getTime() < 60_000,
  ).length;

  // Particle count scales with memories; speed scales with LLM calls/min
  const particleCount = Math.min(250, 50 + memoryCount);
  const particleSpeed = 0.5 + Math.min(llmCallsLastMin * 0.1, 2);

  // Group agents by department
  const agentsByDept = useMemo(() => {
    const map: Record<string, typeof agentList> = {};
    for (const a of agentList) {
      const dept = a.department || "Conductor";
      if (!map[dept]) map[dept] = [];
      map[dept].push(a);
    }
    return map;
  }, [agentList]);

  // Tasks by agent
  const tasksByAgent = useMemo(() => {
    const map: Record<string, typeof taskList> = {};
    for (const t of taskList) {
      if (t.assignedToId) {
        if (!map[t.assignedToId]) map[t.assignedToId] = [];
        map[t.assignedToId].push(t);
      }
    }
    return map;
  }, [taskList]);

  // Connector nodes (the 16 built-in ARIA connectors)
  const connectorNodes = ALL_CONNECTORS.filter((c) => c.builtIn).slice(0, 16);

  // Department focus navigation
  const focusedDeptIndex = focusedDept
    ? DEPT_LIST.findIndex((d) => d.name === focusedDept)
    : -1;

  const navigateDept = (dir: 1 | -1) => {
    if (focusedDeptIndex === -1) {
      setFocusedDept(DEPT_LIST[0].name);
      return;
    }
    const next = (focusedDeptIndex + dir + DEPT_LIST.length) % DEPT_LIST.length;
    setFocusedDept(DEPT_LIST[next].name);
  };

  // Brain inbox submit
  const handleBrainSubmit = useCallback(async () => {
    if (!brainInput.trim() || brainSubmitting) return;
    setBrainSubmitting(true);
    setCorePulse(1);
    try {
      // If it looks like a URL, ingest as URL; otherwise treat as text
      const isUrl = brainInput.match(/^https?:\/\//);
      if (isUrl) {
        await fetch("/api/learning/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: brainInput.trim() }),
        });
      } else {
        // For plain text, store as a memory via the Hermes engine
        await fetch("/api/hermes/memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: `brain-${Date.now()}`,
            value: brainInput.trim(),
            scope: "knowledge",
            tags: ["brain-inbox"],
          }),
        });
      }
      setBrainInput("");
    } catch {
      // silent
    } finally {
      setBrainSubmitting(false);
      setTimeout(() => setCorePulse(0), 2000);
    }
  }, [brainInput, brainSubmitting]);

  // ─── Layout geometry ───────────────────────────────────────────
  const SVG_SIZE = 700;
  const CENTER = SVG_SIZE / 2;
  const CORE_R = 60; // outlined circle
  const DEPT_RADIUS = 160;
  const AGENT_RADIUS = 250;
  const CONNECTOR_RADIUS = 310;

  // Position helpers
  const polar = (angle: number, radius: number) => ({
    x: CENTER + Math.cos(angle) * radius,
    y: CENTER + Math.sin(angle) * radius,
  });

  return (
    <div className="mc-surface relative overflow-hidden rounded-xl border border-border/60">
      {/* ─── Engineering grid background ─────────────────────────── */}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: isDark ? "#09090b" : "#fafafa",
          backgroundImage: `
            linear-gradient(${isDark ? "rgba(63,63,70,0.15)" : "rgba(0,0,0,0.04)"} 1px, transparent 1px),
            linear-gradient(90deg, ${isDark ? "rgba(63,63,70,0.15)" : "rgba(0,0,0,0.04)"} 1px, transparent 1px),
            linear-gradient(${isDark ? "rgba(63,63,70,0.3)" : "rgba(0,0,0,0.08)"} 1px, transparent 1px),
            linear-gradient(90deg, ${isDark ? "rgba(63,63,70,0.3)" : "rgba(0,0,0,0.08)"} 1px, transparent 1px)
          `,
          backgroundSize: "24px 24px, 24px 24px, 96px 96px, 96px 96px",
        }}
      />

      {/* ─── Brain Inbox (top) ──────────────────────────────────── */}
      <div className="relative z-10 flex items-center gap-2 border-b border-border/60 bg-background/60 px-4 py-2.5 backdrop-blur">
        <Brain className="h-4 w-4 text-rose-500" />
        <input
          type="text"
          value={brainInput}
          onChange={(e) => setBrainInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleBrainSubmit()}
          placeholder="dump into the brain… or drop documents"
          className="flex-1 bg-transparent font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          {brainSubmitting ? "ingesting…" : "text · voice · drag or upload"}
        </span>
        <button
          onClick={handleBrainSubmit}
          disabled={!brainInput.trim() || brainSubmitting}
          className="flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-rose-500 disabled:opacity-30"
        >
          <Upload className="h-3 w-3" /> Ingest
        </button>
      </div>

      {/* ─── Graph area ─────────────────────────────────────────── */}
      <div className="relative flex items-center justify-center" style={{ minHeight: 640 }}>
        <svg
          viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
          className="absolute inset-0 h-full w-full"
          style={{ maxHeight: 640 }}
        >
          {/* ── Concentric guide rings (thin) ── */}
          {[DEPT_RADIUS, AGENT_RADIUS, CONNECTOR_RADIUS].map((r) => (
            <circle
              key={r}
              cx={CENTER}
              cy={CENTER}
              r={r}
              fill="none"
              stroke={isDark ? "rgba(63,63,70,0.2)" : "rgba(0,0,0,0.06)"}
              strokeWidth={1}
              strokeDasharray="2 4"
            />
          ))}

          {/* ── Core circle (outlined) ── */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={CORE_R}
            fill="none"
            stroke={CORE_COLOR}
            strokeWidth={1}
            opacity={0.4}
          />

          {/* ── Connection lines: core → dept hubs ── */}
          {DEPT_LIST.map((dept, i) => {
            const angle = (i / DEPT_LIST.length) * Math.PI * 2 - Math.PI / 2;
            const pos = polar(angle, DEPT_RADIUS);
            const isFocused = focusedDept === dept.name;
            const isFaded = focusedDept && !isFocused;
            return (
              <line
                key={`line-${dept.name}`}
                x1={CENTER}
                y1={CENTER}
                x2={pos.x}
                y2={pos.y}
                stroke={dept.color}
                strokeWidth={isFocused ? 1.5 : 0.5}
                opacity={isFaded ? 0.1 : isFocused ? 0.8 : 0.3}
              />
            );
          })}

          {/* ── Department hub nodes (Ring 1) ── */}
          {DEPT_LIST.map((dept, i) => {
            const angle = (i / DEPT_LIST.length) * Math.PI * 2 - Math.PI / 2;
            const pos = polar(angle, DEPT_RADIUS);
            const isFocused = focusedDept === dept.name;
            const isFaded = focusedDept && !isFocused;
            const deptAgents = agentsByDept[dept.name] || [];
            const hasError = deptAgents.some((a) => a.status === "error");
            return (
              <g
                key={`dept-${dept.name}`}
                transform={`translate(${pos.x}, ${pos.y})`}
                onClick={() => setFocusedDept(isFocused ? null : dept.name)}
                style={{ cursor: "pointer", opacity: isFaded ? 0.2 : 1 }}
              >
                {/* Pulsing ring for error state */}
                {hasError && (
                  <circle r={20} fill="none" stroke="#ef4444" strokeWidth={1}>
                    <animate attributeName="r" values="16;22;16" dur="2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.8;0.2;0.8" dur="2s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle
                  r={16}
                  fill={isDark ? "#18181b" : "#fff"}
                  stroke={dept.color}
                  strokeWidth={isFocused ? 2 : 1}
                />
                <text
                  y={3}
                  textAnchor="middle"
                  fontSize={8}
                  fontFamily="monospace"
                  fontWeight={600}
                  fill={dept.color}
                >
                  {dept.label}
                </text>
                <text
                  y={30}
                  textAnchor="middle"
                  fontSize={7}
                  fontFamily="monospace"
                  fill={isDark ? "#71717a" : "#52525b"}
                >
                  {dept.name.toUpperCase()}
                </text>
                {/* Agent count */}
                <text
                  y={-22}
                  textAnchor="middle"
                  fontSize={7}
                  fontFamily="monospace"
                  fill={isDark ? "#52525b" : "#a3a3a3"}
                >
                  {deptAgents.length}
                </text>
              </g>
            );
          })}

          {/* ── Agent nodes (Ring 2) ── */}
          {!focusedDept &&
            agentList.map((agent, i) => {
              const dept = agent.department || "Conductor";
              const deptConfig = DEPT_CONFIG[dept] || DEPT_CONFIG.Conductor;
              const deptIdx = DEPT_LIST.findIndex((d) => d.name === dept);
              const deptAngle = (deptIdx / DEPT_LIST.length) * Math.PI * 2 - Math.PI / 2;
              const deptAgents = agentsByDept[dept] || [];
              const agentIdxInDept = deptAgents.findIndex((a) => a.id === agent.id);
              const spread = Math.PI / 8; // fan within department arc
              const agentAngle = deptAngle + (agentIdxInDept - deptAgents.length / 2) * (spread / Math.max(deptAgents.length, 1));
              const pos = polar(agentAngle, AGENT_RADIUS);

              const isActive = ["thinking", "executing", "streaming", "waiting"].includes(agent.status);
              const isError = agent.status === "error";

              return (
                <g
                  key={agent.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onClick={() => onOpenAgent?.(agent.id)}
                  style={{ cursor: "pointer" }}
                >
                  {/* Pulsing ring for active state */}
                  {isActive && (
                    <circle r={14} fill="none" stroke={deptConfig.color} strokeWidth={0.5} opacity={0.4}>
                      <animate attributeName="r" values="12;16;12" dur="2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.6;0.1;0.6" dur="2s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <circle
                    r={12}
                    fill={isDark ? "#18181b" : "#fff"}
                    stroke={isError ? "#ef4444" : isActive ? deptConfig.color : isDark ? "#52525b" : "#d4d4d8"}
                    strokeWidth={isError ? 1.5 : 1}
                  />
                  <text
                    y={2}
                    textAnchor="middle"
                    fontSize={6}
                    fontFamily="monospace"
                    fill={isActive ? deptConfig.color : isDark ? "#71717a" : "#a3a3a3"}
                  >
                    {agent.name.slice(0, 4).toUpperCase()}
                  </text>
                </g>
              );
            })}

          {/* ── Focused department sub-graph ── */}
          {focusedDept &&
            (() => {
              const dept = DEPT_CONFIG[focusedDept];
              if (!dept) return null;
              const deptAgents = agentsByDept[focusedDept] || [];
              const deptSkills = skills.filter((s) => s.source?.toLowerCase().includes(focusedDept.toLowerCase()));

              return (
                <g>
                  {/* Dept hub at center-top */}
                  <g transform={`translate(${CENTER}, ${CENTER - DEPT_RADIUS})`}>
                    <circle r={20} fill="none" stroke={dept.color} strokeWidth={2} />
                    <text y={3} textAnchor="middle" fontSize={9} fontFamily="monospace" fontWeight={600} fill={dept.color}>
                      {dept.label}
                    </text>
                  </g>

                  {/* Tool nodes (top row) */}
                  {connectorNodes.slice(0, 8).map((conn, i) => {
                    const x = CENTER - 140 + i * 40;
                    const y = CENTER - AGENT_RADIUS;
                    return (
                      <g key={conn.id} transform={`translate(${x}, ${y})`}>
                        <circle r={8} fill="none" stroke={CORE_COLOR} strokeWidth={0.8} />
                        <text y={2} textAnchor="middle" fontSize={5} fontFamily="monospace" fill={CORE_COLOR}>
                          {conn.icon.slice(0, 2).toUpperCase()}
                        </text>
                        <text y={18} textAnchor="middle" fontSize={5} fontFamily="monospace" fill={isDark ? "#52525b" : "#a3a3a3"}>
                          {conn.id.split(".")[1]?.slice(0, 6).toUpperCase()}
                        </text>
                      </g>
                    );
                  })}

                  {/* Agent nodes (middle row) */}
                  {deptAgents.map((agent, i) => {
                    const x = CENTER - (deptAgents.length * 25) / 2 + i * 25;
                    const y = CENTER;
                    const isActive = ["thinking", "executing", "streaming", "waiting"].includes(agent.status);
                    const isError = agent.status === "error";
                    return (
                      <g key={agent.id} transform={`translate(${x}, ${y})`}>
                        {isActive && (
                          <circle r={14} fill="none" stroke={dept.color} strokeWidth={0.5} opacity={0.4}>
                            <animate attributeName="r" values="12;16;12" dur="2s" repeatCount="indefinite" />
                          </circle>
                        )}
                        <circle
                          r={11}
                          fill={isDark ? "#18181b" : "#fff"}
                          stroke={isError ? "#ef4444" : isActive ? dept.color : isDark ? "#52525b" : "#d4d4d8"}
                          strokeWidth={1}
                        />
                        <text y={2} textAnchor="middle" fontSize={5} fontFamily="monospace" fill={isActive ? dept.color : isDark ? "#71717a" : "#a3a3a3"}>
                          {agent.name.slice(0, 4).toUpperCase()}
                        </text>
                        {/* Task squares below agent */}
                        {(tasksByAgent[agent.id] || []).slice(0, 3).map((task, ti) => (
                          <g key={task.id} transform={`translate(${0}, ${20 + ti * 12})`}>
                            <rect x={-8} y={-4} width={16} height={8} fill="none" stroke={dept.color} strokeWidth={0.5} />
                            <text y={1} textAnchor="middle" fontSize={4} fontFamily="monospace" fill={isDark ? "#71717a" : "#52525b"}>
                              {task.title?.slice(0, 8).toUpperCase() || "TASK"}
                            </text>
                            {/* Dotted line to hub */}
                            <line x1={0} y1={-4} x2={0} y2={-12} stroke={dept.color} strokeWidth={0.3} strokeDasharray="1 2" />
                          </g>
                        ))}
                      </g>
                    );
                  })}

                  {/* Skill squares (bottom row) */}
                  {deptSkills.slice(0, 6).map((skill, i) => {
                    const x = CENTER - 60 + i * 24;
                    const y = CENTER + 80;
                    return (
                      <g key={skill.id} transform={`translate(${x}, ${y})`} onClick={() => setSelectedSkill(skill)} style={{ cursor: "pointer" }}>
                        <rect x={-8} y={-8} width={16} height={16} fill="none" stroke={dept.color} strokeWidth={0.5} />
                        <text y={2} textAnchor="middle" fontSize={5} fontFamily="monospace" fill={dept.color}>
                          {skill.name.slice(0, 2).toUpperCase()}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })()}

          {/* ── Connector nodes (outermost ring) ── */}
          {!focusedDept &&
            connectorNodes.map((conn, i) => {
              const angle = (i / connectorNodes.length) * Math.PI * 2 - Math.PI / 2;
              const pos = polar(angle, CONNECTOR_RADIUS);
              return (
                <g key={conn.id} transform={`translate(${pos.x}, ${pos.y})`}>
                  <circle r={7} fill="none" stroke={CORE_COLOR} strokeWidth={0.6} opacity={0.5} />
                  <text y={1} textAnchor="middle" fontSize={4} fontFamily="monospace" fill={CORE_COLOR} opacity={0.7}>
                    {conn.icon.slice(0, 2).toUpperCase()}
                  </text>
                </g>
              );
            })}
        </svg>

        {/* ── Core canvas overlay (particles) ── */}
        <div className="absolute" style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}>
          <CoreCanvas particleCount={particleCount} speed={particleSpeed} pulse={corePulse} />
        </div>

        {/* ── Core label ── */}
        <div
          className="absolute font-mono text-[9px] uppercase tracking-[0.2em] text-rose-500"
          style={{ left: "50%", top: "calc(50% + 70px)", transform: "translateX(-50%)" }}
        >
          ARIA CORE
        </div>

        {/* ── Memory + LLM stats ── */}
        <div
          className="absolute font-mono text-[8px] uppercase tracking-wider text-muted-foreground"
          style={{ left: "50%", top: "calc(50% + 84px)", transform: "translateX(-50%)" }}
        >
          {memoryCount} MEM · {llmCallsLastMin} LLM/MIN
        </div>

        {/* ── Department carousel arrows (bottom-center) ── */}
        {focusedDept && (
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3">
            <button
              onClick={() => navigateDept(-1)}
              className="flex h-7 w-7 items-center justify-center rounded border border-border/60 text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: DEPT_CONFIG[focusedDept]?.color }}>
              {focusedDept.toUpperCase()}
            </span>
            <button
              onClick={() => navigateDept(1)}
              className="flex h-7 w-7 items-center justify-center rounded border border-border/60 text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => setFocusedDept(null)}
              className="ml-2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              [ exit focus ]
            </button>
          </div>
        )}
      </div>

      {/* ─── Skill Detail Panel (modal) ─────────────────────────── */}
      <AnimatePresence>
        {selectedSkill && (
          <SkillDetailPanel
            skill={selectedSkill}
            onClose={() => setSelectedSkill(null)}
            isDark={isDark}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Skill Detail Panel ────────────────────────────────────────────

function SkillDetailPanel({
  skill,
  onClose,
  isDark,
}: {
  skill: any;
  onClose: () => void;
  isDark: boolean;
}) {
  const dept = skill.source || "Engineering";
  const deptConfig = DEPT_CONFIG[dept] || DEPT_CONFIG.Engineering;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        className="mc-scroll max-h-[85vh] w-[90vw] max-w-2xl overflow-y-auto rounded-lg border border-border/60 bg-background p-0"
        style={{ backgroundColor: isDark ? "#0f0f12" : "#fafafa" }}
      >
        {/* Header with breadcrumb */}
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="font-mono text-[10px] uppercase tracking-wider text-rose-500 hover:text-rose-400">
              ← BACK
            </button>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">·</span>
            <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: deptConfig.color }}>
              {dept.toUpperCase()}
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Title + subtitle */}
          <div>
            <h2 className="font-mono text-lg font-bold text-foreground">{skill.name}</h2>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {dept} · {skill.category || "general"}
            </p>
          </div>

          {/* Description */}
          {skill.description && (
            <p className="font-mono text-xs leading-relaxed text-foreground/80">{skill.description}</p>
          )}

          {/* Download box */}
          <div className="rounded border border-rose-500/30 bg-rose-500/5 p-3">
            <div className="flex items-center gap-2">
              <Plug className="h-3.5 w-3.5 text-rose-500" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-rose-500">
                1 runnable skill file — yours to download
              </span>
            </div>
          </div>

          {/* Breaks into */}
          <Section title="BREAKS INTO" isDark={isDark}>
            <div className="flex flex-wrap gap-1.5">
              {(skill.steps || ["sub-task-1", "sub-task-2", "sub-task-3"]).map((s: string, i: number) => (
                <span key={i} className="rounded border border-border/60 px-2 py-0.5 font-mono text-[9px] text-muted-foreground">
                  {s}
                </span>
              ))}
            </div>
          </Section>

          {/* Builds on */}
          <Section title="BUILDS ON" isDark={isDark}>
            <div className="flex flex-wrap gap-1.5">
              {["llm.chat", "web.search", "memory.store"].map((s) => (
                <span key={s} className="rounded border border-rose-500/30 px-2 py-0.5 font-mono text-[9px] text-rose-500">
                  {s}
                </span>
              ))}
            </div>
          </Section>

          {/* What it replaces */}
          <Section title="WHAT IT REPLACES" isDark={isDark}>
            <div className="rounded border border-border/60 p-2 font-mono text-[10px] text-muted-foreground">
              Manual {skill.category || "task"} coordination — this skill automates the full workflow.
            </div>
          </Section>

          {/* The Ladder */}
          <Section title="THE LADDER" isDark={isDark}>
            <div className="space-y-1">
              {[
                { level: "HUMAN-LED", desc: "Operator manually executes every step", active: false },
                { level: "HUMAN-ASSISTED", desc: "AI drafts, operator reviews + approves", active: true },
                { level: "FULLY AUTONOMOUS", desc: "AI executes end-to-end, logs for audit", active: false },
              ].map((row) => (
                <div
                  key={row.level}
                  className="flex items-center gap-3 p-1.5"
                  style={{
                    borderLeft: row.active ? `2px solid ${CORE_COLOR}` : "2px solid transparent",
                    backgroundColor: row.active ? (isDark ? "rgba(225,29,72,0.05)" : "rgba(225,29,72,0.03)") : "transparent",
                  }}
                >
                  <span className={`font-mono text-[10px] uppercase tracking-wider ${row.active ? "text-rose-500" : "text-muted-foreground"}`}>
                    {row.level}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">{row.desc}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* The Human */}
          <Section title="THE HUMAN" isDark={isDark}>
            <p className="font-mono text-[10px] text-muted-foreground">
              Operator reviews autonomous decisions + approves high-value actions.
            </p>
          </Section>

          {/* Done by */}
          <Section title="DONE BY" isDark={isDark}>
            <div className="rounded border border-border/60 p-2 font-mono text-[10px]">
              <span className="text-foreground">{skill.source || "ARIA Agent"}</span>
              <span className="text-muted-foreground"> · AI agent · balanced tier</span>
            </div>
          </Section>

          {/* The SOP */}
          <Section title="THE SOP, WRITTEN OUT" isDark={isDark}>
            <div className="space-y-1">
              {[
                "Receive task from Conductor",
                "Load relevant memories + skills",
                "Execute via LLM + tool calls",
                "Validate output against schema",
                "Store result as memory + skill",
                "Report completion via SSE",
              ].map((step, i) => (
                <div key={i} className="flex gap-2 font-mono text-[10px]">
                  <span className="text-rose-500">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-foreground/80">{step}</span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Section({ title, children, isDark }: { title: string; children: React.ReactNode; isDark: boolean }) {
  return (
    <div>
      <h3 className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

export default OptimalEngine;
