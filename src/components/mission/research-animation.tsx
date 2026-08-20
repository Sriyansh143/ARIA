"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import { FlaskConical, BarChart3, Brain, Sparkles, Activity } from "lucide-react";

/**
 * ResearchAnimation — animated research-lab visualization.
 *
 * Three research workstations (Nova-Research, Prism-DataAnalyst,
 * Quant-DataScientist) sit on a dark lab floor. Each desk has an
 * avatar, an animated "screen" (code marquee / bar chart / neural net),
 * and a live status indicator derived from the real mission store.
 * Data particles flow horizontally between the stations; insight
 * bubbles drift upward on a 4s cycle. All counts come from the
 * `useMissionStore` snapshot — no mock state.
 */

// ─── Static station manifest ────────────────────────────────────────
// The role names mirror the AGENT_ROLES union; `glow` is the per-station
// accent that ties avatar, screen-bezel, and status pill together.
type StationKind = "code" | "chart" | "neural";

interface StationSpec {
  id: "nova" | "prism" | "quant";
  role: "Research" | "DataAnalyst" | "DataScientist";
  label: string;
  icon: typeof FlaskConical;
  accent: string; // hex
  accentText: string; // tailwind text class
  accentBg: string; // tailwind bg class
  accentBorder: string; // tailwind border class
  accentRing: string; // tailwind ring/shadow class
  kind: StationKind;
}

const STATIONS: StationSpec[] = [
  {
    id: "nova",
    role: "Research",
    label: "Nova-Research",
    icon: FlaskConical,
    accent: "#10b981", // emerald-500
    accentText: "text-emerald-300",
    accentBg: "bg-emerald-500/10",
    accentBorder: "border-emerald-500/40",
    accentRing: "shadow-[0_0_24px_-4px_rgba(16,185,129,0.55)]",
    kind: "code",
  },
  {
    id: "prism",
    role: "DataAnalyst",
    label: "Prism-DataAnalyst",
    icon: BarChart3,
    accent: "#22d3ee", // cyan-400
    accentText: "text-cyan-300",
    accentBg: "bg-cyan-500/10",
    accentBorder: "border-cyan-500/40",
    accentRing: "shadow-[0_0_24px_-4px_rgba(34,211,238,0.55)]",
    kind: "chart",
  },
  {
    id: "quant",
    role: "DataScientist",
    label: "Quant-DataScientist",
    icon: Brain,
    accent: "#a78bfa", // violet-400
    accentText: "text-violet-300",
    accentBg: "bg-violet-500/10",
    accentBorder: "border-violet-500/40",
    accentRing: "shadow-[0_0_24px_-4px_rgba(167,139,250,0.55)]",
    kind: "neural",
  },
];

// Fake research snippets scrolling across Nova's terminal.
const CODE_SNIPPETS = [
  "analyzing cohort n=1482",
  "hypothesis H1: p<0.001 ✓",
  "regression r²=0.873",
  "tf-idf cosine 0.642",
  "cluster k=4 silhouette 0.71",
  "embedding dim=768 → 32",
  "anomaly score 0.94 @t=04:21",
  "bayes posterior 0.92",
  "feature importance > 0.45",
  "cross-val f1=0.881",
];

// Insight bubbles emitted by the lab. 5 visible per 4s cycle.
const INSIGHTS = [
  "trend detected",
  "anomaly found",
  "pattern matched",
  "signal locked",
  "hypothesis confirmed",
];

const STATUS_COLOR: Record<string, string> = {
  idle: "#64748b", // slate-500
  thinking: "#f59e0b", // amber-500
  executing: "#10b981", // emerald-500
  streaming: "#22d981", // emerald
  waiting: "#a78bfa", // violet-400
  error: "#f43f5e", // rose-500
  offline: "#334155", // slate-700
};

const STATUS_LABEL: Record<string, string> = {
  idle: "idle",
  thinking: "thinking",
  executing: "active",
  streaming: "streaming",
  waiting: "waiting",
  error: "error",
  offline: "offline",
};

// ─── Sub-components ─────────────────────────────────────────────────

/** Animated code marquee — vertical scrolling list of research snippets. */
function CodeScreen({ accent }: { accent: string }) {
  const doubled = [...CODE_SNIPPETS, ...CODE_SNIPPETS];
  return (
    <div className="relative h-full w-full overflow-hidden rounded-sm bg-black/60 font-mono text-[5px] leading-[1.4]">
      <motion.div
        className="absolute left-0 top-0 w-full"
        animate={{ y: ["0%", "-50%"] }}
        transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
      >
        {doubled.map((line, i) => (
          <div
            key={i}
            className="flex items-center gap-[3px] px-[3px] whitespace-nowrap"
            style={{ color: i % 3 === 0 ? accent : "#94a3b8" }}
          >
            <span style={{ color: accent }}>›</span>
            <span className="truncate">{line}</span>
          </div>
        ))}
      </motion.div>
      {/* Scanline overlay for CRT feel */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background:
            "repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.5) 2px 3px)",
        }}
      />
    </div>
  );
}

/** Animated bar chart — 3 bars growing/shrinking on a loop. */
function ChartScreen({ accent }: { accent: string }) {
  const bars = [
    { delay: 0, height: 60 },
    { delay: 0.4, height: 85 },
    { delay: 0.8, height: 40 },
  ];
  return (
    <div className="relative flex h-full w-full items-end justify-around rounded-sm bg-black/60 px-[3px] pb-[3px]">
      {bars.map((bar, i) => (
        <motion.div
          key={i}
          className="w-[8px] rounded-t-[1px]"
          style={{
            background: `linear-gradient(to top, ${accent}, ${accent}55)`,
            boxShadow: `0 0 6px -1px ${accent}99`,
          }}
          animate={{ height: [`${bar.height * 0.4}%`, `${bar.height}%`, `${bar.height * 0.6}%`] }}
          transition={{
            duration: 2,
            delay: bar.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
      {/* Baseline */}
      <div
        className="absolute bottom-[2px] left-0 right-0 h-px"
        style={{ background: `${accent}44` }}
      />
    </div>
  );
}

/** Animated neural network — 3 nodes with pulsing connections. */
function NeuralScreen({ accent }: { accent: string }) {
  // Layered topology: input(1) → hidden(3) → output(1), simplified to 3 nodes.
  const nodes = [
    { x: 6, y: 5 },
    { x: 6, y: 16 },
    { x: 6, y: 27 },
  ];
  const edges = [
    [0, 1],
    [1, 2],
    [0, 2],
  ];
  return (
    <div className="relative h-full w-full overflow-hidden rounded-sm bg-black/60">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 40 32" preserveAspectRatio="none">
        {/* Pulsing edges */}
        {edges.map(([a, b], i) => (
          <motion.line
            key={i}
            x1={nodes[a].x}
            y1={nodes[a].y}
            x2={nodes[b].x}
            y2={nodes[b].y}
            stroke={accent}
            strokeWidth={0.4}
            strokeOpacity={0.6}
            animate={{ strokeOpacity: [0.2, 0.9, 0.2] }}
            transition={{ duration: 1.5, delay: i * 0.3, repeat: Infinity, ease: "easeInOut" }}
          />
        ))}
        {/* Nodes */}
        {nodes.map((n, i) => (
          <motion.circle
            key={i}
            cx={n.x}
            cy={n.y}
            r={1.6}
            fill={accent}
            initial={{ opacity: 0.6 }} animate={{
              r: [1.4, 2.2, 1.4],
              opacity: [0.6, 1, 0.6],
            }}
            transition={{
              duration: 1.4,
              delay: i * 0.35,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            style={{ filter: `drop-shadow(0 0 2px ${accent})` }}
          />
        ))}
        {/* Output pulse traveling to the right */}
        <motion.circle
          cx={34}
          cy={16}
          r={1.4}
          fill={accent}
          initial={{ opacity: 0.3 }} animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          style={{ filter: `drop-shadow(0 0 3px ${accent})` }}
        />
      </svg>
    </div>
  );
}

/** A single workstation with avatar, screen, and status pill. */
function Workstation({
  spec,
  agentName,
  status,
  tasksDone,
}: {
  spec: StationSpec;
  agentName: string;
  status: string;
  tasksDone: number;
}) {
  const Icon = spec.icon;
  const dotColor = STATUS_COLOR[status] ?? STATUS_COLOR.idle;
  const statusLabel = STATUS_LABEL[status] ?? status;

  return (
    <div className="flex w-[120px] shrink-0 flex-col items-center">
      {/* Avatar */}
      <div className="relative mb-1">
        <motion.div
          className={`flex h-[50px] w-[50px] items-center justify-center rounded-full border ${spec.accentBorder} ${spec.accentBg} ${spec.accentRing}`}
          animate={{
            boxShadow: [
              `0 0 18px -6px ${spec.accent}66`,
              `0 0 28px -3px ${spec.accent}99`,
              `0 0 18px -6px ${spec.accent}66`,
            ],
          }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
        >
          <Icon className={`h-5 w-5 ${spec.accentText}`} strokeWidth={1.8} />
        </motion.div>
        {/* Mini glow underlay */}
        <div
          className="absolute -inset-1 -z-10 rounded-full opacity-40 blur-md"
          style={{ background: spec.accent }}
        />
      </div>

      {/* Agent name */}
      <div className="mb-1 font-mono text-[8px] tracking-tight text-slate-300">
        {agentName}
      </div>

      {/* Desk (rect) */}
      <div
        className={`relative h-[44px] w-full rounded-[3px] border ${spec.accentBorder} bg-gradient-to-b from-slate-900/80 to-black/80`}
        style={{ boxShadow: `inset 0 -2px 0 0 ${spec.accent}33` }}
      >
        {/* Screen on desk — 40x30 centered */}
        <div
          className="absolute left-1/2 top-1/2 h-[30px] w-[40px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[2px] border"
          style={{ borderColor: `${spec.accent}55` }}
        >
          {spec.kind === "code" && <CodeScreen accent={spec.accent} />}
          {spec.kind === "chart" && <ChartScreen accent={spec.accent} />}
          {spec.kind === "neural" && <NeuralScreen accent={spec.accent} />}
        </div>
        {/* Desk legs hint */}
        <div
          className="absolute -bottom-[3px] left-1 h-[3px] w-1 rounded-b-sm"
          style={{ background: `${spec.accent}55` }}
        />
        <div
          className="absolute -bottom-[3px] right-1 h-[3px] w-1 rounded-b-sm"
          style={{ background: `${spec.accent}55` }}
        />
      </div>

      {/* Status indicator below desk */}
      <div className="mt-1.5 flex items-center gap-1 rounded-full border border-slate-800 bg-black/60 px-1.5 py-[1px] font-mono text-[7px]">
        <motion.span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: dotColor }}
          initial={{ opacity: 0 }} animate={{ opacity: status === "idle" || status === "offline" ? 1 : [1, 0.3, 1] }}
          transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
        />
        <span style={{ color: dotColor }}>{statusLabel}</span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-400">{tasksDone}tk</span>
      </div>
    </div>
  );
}

/** Horizontal data-sharing particle stream between workstations. */
function DataParticles() {
  // Pre-compute particle configs once.
  interface Particle {
    id: number;
    delay: number;
    duration: number;
    direction: number;
    yOffset: number;
    color: string;
    size: number;
  }
  const particles = useMemo<Particle[]>(() => {
    const arr: Particle[] = [];
    for (let i = 0; i < 14; i++) {
      arr.push({
        id: i,
        delay: (i * 0.7) % 6,
        duration: 4 + (i % 4),
        direction: i % 2 === 0 ? 1 : -1,
        yOffset: (i % 5) * 2 - 4,
        color: ["#10b981", "#22d3ee", "#a78bfa"][i % 3],
        size: 2 + (i % 3),
      });
    }
    return arr;
  }, []);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[185px] h-3">
      {/* The horizontal rail */}
      <div className="absolute left-1/2 top-1/2 h-px w-[88%] -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-emerald-500/10 via-cyan-500/30 to-violet-500/10" />
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute top-1/2 rounded-full"
          style={{
            width: p.size,
            height: p.size,
            background: p.color,
            boxShadow: `0 0 6px 1px ${p.color}`,
            y: p.yOffset,
          }}
          initial={{ left: p.direction === 1 ? "8%" : "92%", opacity: 0 }}
          animate={{
            left: p.direction === 1 ? ["8%", "92%"] : ["92%", "8%"],
            opacity: [0, 1, 1, 0],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: "linear",
            times: [0, 0.1, 0.9, 1],
          }}
        />
      ))}
    </div>
  );
}

/** A single floating insight bubble drifting upward. */
function InsightBubble({
  insight,
  leftPercent,
  color,
  delay,
}: {
  insight: string;
  leftPercent: number;
  color: string;
  delay: number;
}) {
  return (
    <motion.div
      className="absolute top-[155px] flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-[1px] font-mono text-[7px]"
      style={{
        left: `${leftPercent}%`,
        borderColor: `${color}55`,
        background: `linear-gradient(90deg, ${color}22, ${color}05)`,
        color,
        backdropFilter: "blur(2px)",
      }}
      initial={{ y: 0, opacity: 0, scale: 0.7 }}
      animate={{ y: -90, opacity: [0, 1, 1, 0], scale: [0.7, 1, 1, 0.85] }}
      transition={{
        duration: 3.8,
        delay,
        repeat: Infinity,
        ease: "easeOut",
        times: [0, 0.15, 0.85, 1],
      }}
    >
      <Sparkles className="h-1.5 w-1.5" style={{ color }} />
      {insight}
    </motion.div>
  );
}

// ─── Main component ─────────────────────────────────────────────────

export function ResearchAnimation() {
  const agents = useMissionStore((s) => s.agents);
  const memories = useMissionStore((s) => s.memories);
  const llmCalls = useMissionStore((s) => s.llmCalls);

  // Resolve each station's agent from the store (live snapshot).
  const stationAgents = useMemo(() => {
    const list = Object.values(agents);
    return STATIONS.map((spec) => {
      const agent = list.find((a) => a.role === spec.role);
      return {
        spec,
        agent,
      };
    });
  }, [agents]);

  // Aggregate stats
  const insightsToday = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return llmCalls.filter((c) => new Date(c.createdAt).getTime() >= todayStart.getTime()).length;
  }, [llmCalls]);

  const memoriesCreated = useMemo(() => Object.keys(memories).length, [memories]);

  // 4s cycle — stagger the 5 insight bubbles across the cycle.
  const insightConfigs = useMemo(
    () =>
      INSIGHTS.map((text, i) => ({
        text,
        leftPercent: 18 + i * 16,
        color: STATIONS[i % STATIONS.length].accent,
        delay: i * 0.8,
      })),
    []
  );

  // "analyzing..." pulse text — toggles the dot count for a live feel.
  const [dots, setDots] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setDots((d) => (d % 3) + 1), 500);
    return () => clearInterval(id);
  }, []);

  return (
    <section
      className="relative w-full overflow-hidden rounded-lg border border-slate-800/60 bg-[#0a0a0f] font-mono"
      style={{ height: 450 }}
      role="img"
      aria-label="Research lab live visualization with three research workstations"
    >
      {/* Ambient background grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
      {/* Vignette glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 60%, rgba(167,139,250,0.08) 0%, transparent 60%)",
        }}
      />

      {/* Title (top-left) */}
      <div className="absolute left-4 top-3 z-10 flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1">
          <FlaskConical className="h-3 w-3 text-emerald-400" />
          <span className="text-[10px] font-semibold tracking-[0.18em] text-emerald-300">
            RESEARCH LAB
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-slate-800 bg-black/50 px-2 py-1">
          <motion.span
            className="h-1.5 w-1.5 rounded-full bg-emerald-400"
            initial={{ opacity: 1 }} animate={{ opacity: [1, 0.2, 1] }}
            transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
          />
          <span className="text-[9px] tracking-tight text-slate-400">
            analyzing{".".repeat(dots)}
          </span>
        </div>
      </div>

      {/* Stats (top-right) */}
      <div className="absolute right-4 top-3 z-10 flex items-center gap-2 rounded-md border border-slate-800 bg-black/50 px-2.5 py-1">
        <Activity className="h-3 w-3 text-cyan-400" />
        <span className="text-[9px] tracking-tight text-slate-300">
          <span className="text-cyan-300">3</span> researchers
          <span className="mx-1 text-slate-600">·</span>
          <span className="text-violet-300">{insightsToday}</span> insights today
          <span className="mx-1 text-slate-600">·</span>
          <span className="text-emerald-300">{memoriesCreated}</span> memories created
        </span>
      </div>

      {/* Workstations row — vertically centered in the floor */}
      <div className="absolute inset-x-0 top-[80px] z-[5] flex items-start justify-center gap-8">
        {stationAgents.map(({ spec, agent }) => (
          <Workstation
            key={spec.id}
            spec={spec}
            agentName={agent?.name ?? spec.label}
            status={agent?.status ?? "offline"}
            tasksDone={agent?.tasksDone ?? 0}
          />
        ))}
      </div>

      {/* Data particle stream between workstations */}
      <DataParticles />

      {/* Floating insight bubbles */}
      {insightConfigs.map((c, i) => (
        <InsightBubble
          key={i}
          insight={c.text}
          leftPercent={c.leftPercent}
          color={c.color}
          delay={c.delay}
        />
      ))}

      {/* Floor reflection — subtle horizontal sheen under the desks */}
      <div
        className="pointer-events-none absolute inset-x-8 top-[235px] h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(167,139,250,0.4), rgba(34,211,238,0.4), rgba(16,185,129,0.4), transparent)",
        }}
      />

      {/* Bottom legend */}
      <div className="absolute inset-x-0 bottom-3 z-10 flex items-center justify-center gap-4 font-mono text-[8px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="h-1 w-1 rounded-full bg-emerald-400" /> active
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1 w-1 rounded-full bg-amber-400" /> thinking
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1 w-1 rounded-full bg-rose-500" /> error
        </span>
        <span className="text-slate-700">|</span>
        <span className="tracking-tight">live · mission store</span>
      </div>
    </section>
  );
}

export default ResearchAnimation;
