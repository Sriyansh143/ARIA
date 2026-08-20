"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import {
  Phone,
  MessageSquare,
  Users as UsersIcon,
  Footprints,
  Clock,
  Keyboard,
} from "lucide-react";
import type { Agent, AgentStatus } from "@/lib/types";

/**
 * EmployeesAnimation — animated top-down office-floor visualization.
 *
 * Maps every agent in the mission store to a desk on a 2-row office
 * floor. Each agent's `status` drives a distinct working animation:
 *
 *   executing  → typing tick dots
 *   thinking   → pulsing phone call
 *   streaming  → gathering at the center meeting table
 *   waiting    → walking between desks
 *   idle       → sitting still
 *   error      → red ring around the avatar
 *
 * Speech bubbles cycle every 5s (3 visible at a time). A vertical
 * productivity meter on the right reflects executing-vs-idle ratio,
 * a live clock sits top-left, and the status bar at the bottom
 * reports executing / thinking / idle counts.
 *
 * All state is derived from `useMissionStore` — no mock data.
 */

// ─── Layout constants ───────────────────────────────────────────────
const FLOOR_HEIGHT = 500;
const DESK_ROWS = 2;
const DESKS_PER_ROW = 6; // up to 12 desks total (2 × 6)
const DESK_W = 56;
const DESK_H = 38;
const ROW_GAP = 28;
const COL_GAP = 14;
const FLOOR_LEFT_PAD = 60; // leave room for clock column on the left
const FLOOR_RIGHT_PAD = 96; // leave room for productivity meter on the right
const FLOOR_TOP_PAD = 64; // leave room for title bar
const DESK_TOP_OFFSET = 110; // first row y position

// Avatar color palette — variety of accent colors for "different employees".
const AVATAR_COLORS = [
  "#22d3ee", // cyan-400
  "#a78bfa", // violet-400
  "#34d399", // emerald-400
  "#f472b6", // pink-400
  "#fbbf24", // amber-400
  "#60a5fa", // blue-400 (used sparingly)
  "#4ade80", // green-400
  "#f87171", // red-400
  "#c084fc", // purple-400
  "#2dd4bf", // teal-400
  "#fb923c", // orange-400
  "#a3e635", // lime-400
];

// Speech bubble texts — sampled 3-at-a-time every 5s.
const SPEECH_TEXTS = [
  "deploying v2.1",
  "reviewing PR",
  "calling client",
  "writing docs",
  "shipping fix",
  "merging main",
  "QA passing",
  "sprint sync",
  "scoping Q4",
  "patching bug",
  "estimating task",
  "drafting RFC",
];

// Status → activity class mapping. Each entry drives the per-desk animation.
type ActivityKind = "typing" | "phone" | "meeting" | "walking" | "sitting" | "error";

function statusToActivity(status: AgentStatus): ActivityKind {
  switch (status) {
    case "executing":
      return "typing";
    case "thinking":
      return "phone";
    case "streaming":
      return "meeting";
    case "waiting":
      return "walking";
    case "error":
      return "error";
    case "idle":
    case "offline":
    default:
      return "sitting";
  }
}

// ─── Sub-components ─────────────────────────────────────────────────

/** A small typing tick dot that appears above the desk every ~0.5s. */
function TypingDots({ color }: { color: string }) {
  return (
    <div className="pointer-events-none absolute -top-3 left-1/2 flex -translate-x-1/2 gap-[2px]">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block h-[3px] w-[3px] rounded-full"
          style={{ background: color, boxShadow: `0 0 4px 1px ${color}` }}
          initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0], y: [0, -2, 0] }}
          transition={{
            duration: 0.6,
            delay: i * 0.18,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

/** Phone icon that pulses next to the desk. */
function PhonePulse({ color }: { color: string }) {
  return (
    <div className="pointer-events-none absolute -right-2 -top-2">
      <motion.div
        className="flex h-3.5 w-3.5 items-center justify-center rounded-full border"
        style={{ borderColor: color, background: `${color}22` }}
        animate={{
          scale: [1, 1.25, 1],
          boxShadow: [`0 0 0 0 ${color}88`, `0 0 0 4px ${color}00`, `0 0 0 0 ${color}00`],
        }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
      >
        <Phone className="h-2 w-2" style={{ color }} strokeWidth={2.5} />
      </motion.div>
    </div>
  );
}

/** Error red ring around the avatar. */
function ErrorRing() {
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 rounded-full border-2 border-rose-500"
      initial={{ opacity: 1 }} animate={{ opacity: [1, 0.3, 1], scale: [1, 1.1, 1] }}
      transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

/** Top-down "person" — a 30px head circle + small body square below. */
function PersonAvatar({
  color,
  activity,
  isMeeting,
}: {
  color: string;
  activity: ActivityKind;
  isMeeting: boolean;
}) {
  return (
    <div className="relative flex flex-col items-center">
      {/* Head */}
      <motion.div
        className="relative flex h-[18px] w-[18px] items-center justify-center rounded-full border"
        style={{
          background: `${color}22`,
          borderColor: color,
          boxShadow: `0 0 8px -1px ${color}aa`,
        }}
        animate={
          activity === "typing"
            ? { y: [0, -1, 0] }
            : activity === "sitting"
            ? { y: [0, 0.5, 0] }
            : { y: 0 }
        }
        transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
      >
        {/* Eyes dot for a "from above" feel */}
        <span
          className="block h-[3px] w-[3px] rounded-full"
          style={{ background: color }}
        />
        {activity === "error" && <ErrorRing />}
      </motion.div>
      {/* Shoulders / body — a smaller rounded square below */}
      <motion.div
        className="-mt-[1px] h-[7px] w-[12px] rounded-b-[6px] rounded-t-[2px]"
        style={{ background: `${color}44`, border: `1px solid ${color}55` }}
        animate={activity === "typing" ? { scaleX: [1, 0.96, 1] } : { scaleX: 1 }}
        transition={{ duration: 0.5, repeat: Infinity, ease: "easeInOut" }}
      />
      {isMeeting && (
        <motion.div
          className="absolute -top-2.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full"
          style={{ background: color, boxShadow: `0 0 4px 1px ${color}` }}
          initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
    </div>
  );
}

/** A single desk + avatar + per-activity animation overlay. */
function Desk({
  agent,
  color,
  deskIndex,
  isMeetingParticipant,
  meetingSlot,
}: {
  agent: Agent | null;
  color: string;
  deskIndex: number;
  isMeetingParticipant: boolean;
  meetingSlot: { x: number; y: number } | null;
}) {
  // Position desks in a 2-row grid.
  const row = Math.floor(deskIndex / DESKS_PER_ROW);
  const col = deskIndex % DESKS_PER_ROW;
  const baseX = FLOOR_LEFT_PAD + col * (DESK_W + COL_GAP);
  const baseY = DESK_TOP_OFFSET + row * (DESK_H + ROW_GAP + 24);

  const activity = agent ? statusToActivity(agent.status) : "sitting";

  // Walking agents drift to a neighboring desk briefly.
  const walking = activity === "walking";
  const targetX = walking ? baseX + (col % 2 === 0 ? 70 : -70) : baseX;
  const targetY = walking ? baseY + 6 : baseY;

  // Meeting participants relocate to the center meeting table.
  const inMeeting = isMeetingParticipant && activity === "meeting";
  const finalX = inMeeting && meetingSlot ? meetingSlot.x : targetX;
  const finalY = inMeeting && meetingSlot ? meetingSlot.y : targetY;

  const displayName = agent?.name ?? `Desk ${deskIndex + 1}`;

  return (
    <motion.div
      className="absolute"
      style={{ width: DESK_W, height: DESK_H, left: baseX, top: baseY }}
      animate={
        inMeeting || walking
          ? { x: finalX - baseX, y: finalY - baseY }
          : { x: 0, y: 0 }
      }
      transition={{ duration: walking || inMeeting ? 2 : 0.4, ease: "easeInOut" }}
    >
      {/* Desk surface (top-down rect) */}
      <div
        className="absolute inset-0 rounded-[3px] border"
        style={{
          background: activity === "error"
            ? "linear-gradient(135deg, rgba(244,63,94,0.12), rgba(15,23,42,0.85))"
            : "linear-gradient(135deg, rgba(30,41,59,0.7), rgba(15,23,42,0.85))",
          borderColor: activity === "error" ? "rgba(244,63,94,0.5)" : "rgba(71,85,105,0.5)",
          boxShadow: `inset 0 0 0 1px ${color}22`,
        }}
      >
        {/* Desk label */}
        <div className="absolute left-1 top-[2px] font-mono text-[6px] leading-none text-slate-500 truncate max-w-[48px]">
          {displayName.split("-")[0]}
        </div>
        {/* Keyboard hint */}
        <div
          className="absolute bottom-1 left-1/2 h-[2px] w-10 -translate-x-1/2 rounded-[1px]"
          style={{ background: `${color}33` }}
        />
      </div>

      {/* Avatar centered on desk */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <PersonAvatar
          color={color}
          activity={activity}
          isMeeting={inMeeting}
        />
      </div>

      {/* Activity overlays */}
      {activity === "typing" && <TypingDots color={color} />}
      {activity === "phone" && <PhonePulse color={color} />}
      {activity === "walking" && (
        <motion.div
          className="pointer-events-none absolute -bottom-3 left-1/2 -translate-x-1/2"
          initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0], x: [-6, 6] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        >
          <Footprints className="h-2.5 w-2.5 text-violet-300" />
        </motion.div>
      )}
    </motion.div>
  );
}

/** Center meeting table with speech bubbles for participants. */
function MeetingTable({ visible }: { visible: boolean }) {
  if (!visible) return null;
  const cx = FLOOR_LEFT_PAD + (DESKS_PER_ROW * (DESK_W + COL_GAP)) / 2 - 10;
  const cy = DESK_TOP_OFFSET + (DESK_H + ROW_GAP + 24) + 6;

  return (
    <motion.div
      className="absolute z-[2] flex items-center justify-center rounded-[6px] border border-violet-500/40 bg-violet-500/10"
      style={{ left: cx - 28, top: cy - 14, width: 56, height: 28 }}
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
    >
      <UsersIcon className="h-3 w-3 text-violet-300" />
      <motion.div
        className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full border border-violet-500/40 bg-black/70 px-1 py-[1px] font-mono text-[6px] text-violet-300"
        initial={{ opacity: 0.5 }} animate={{ opacity: [0.5, 1, 0.5], y: [0, -2, 0] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      >
        meeting
      </motion.div>
    </motion.div>
  );
}

/** Vertical productivity meter (right side). */
function ProductivityMeter({
  executing,
  total,
}: {
  executing: number;
  total: number;
}) {
  const ratio = total > 0 ? Math.min(1, executing / total) : 0;
  const pct = Math.round(ratio * 100);

  // Segment-based meter: 12 segments light up from bottom to top.
  const SEGMENTS = 12;
  const litCount = Math.round(ratio * SEGMENTS);

  return (
    <div className="absolute right-3 top-1/2 z-10 -translate-y-1/2 flex flex-col items-center">
      <div className="mb-1 font-mono text-[8px] tracking-[0.15em] text-slate-400">
        PROD
      </div>
      <div
        className="relative flex flex-col-reverse gap-[2px] rounded-[3px] border border-slate-700 bg-black/60 p-[3px]"
        style={{ height: 180, width: 14 }}
      >
        {Array.from({ length: SEGMENTS }).map((_, i) => {
          const lit = i < litCount;
          const tier = i < 4 ? "#34d399" : i < 8 ? "#fbbf24" : "#f43f5e";
          return (
            <motion.div
              key={i}
              className="rounded-[1px]"
              style={{
                background: lit ? tier : "rgba(71,85,105,0.3)",
                boxShadow: lit ? `0 0 6px -1px ${tier}` : "none",
                height: 11,
              }}
              animate={lit ? { opacity: [0.7, 1, 0.7] } : { opacity: 0.4 }}
              transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
            />
          );
        })}
      </div>
      <div className="mt-1 font-mono text-[10px] font-bold tabular-nums text-emerald-300">
        {pct}%
      </div>
      <div className="font-mono text-[7px] text-slate-500">capacity</div>
    </div>
  );
}

/** Speech bubble overlay — cycles every 5s, 3 visible at a time. */
function SpeechBubbleLayer({
  desksWithAgents,
  cycleKey,
}: {
  desksWithAgents: { x: number; y: number; color: string; name: string }[];
  cycleKey: number;
}) {
  // Pick 3 random desks each cycle, mapped to a random speech text.
  const bubbles = useMemo(() => {
    if (desksWithAgents.length === 0) return [];
    const shuffled = [...desksWithAgents].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, Math.min(3, shuffled.length));
    return picked.map((d, i) => ({
      ...d,
      text: SPEECH_TEXTS[(cycleKey * 3 + i) % SPEECH_TEXTS.length],
      id: `${cycleKey}-${i}`,
    }));
    // Re-derive only when cycleKey changes.
  }, [cycleKey, desksWithAgents.length]);

  return (
    <div className="pointer-events-none absolute inset-0 z-[6]">
      <AnimatePresence>
        {bubbles.map((b) => (
          <motion.div
            key={b.id}
            className="absolute flex items-center gap-1 whitespace-nowrap rounded-md border bg-black/85 px-1.5 py-[2px] font-mono text-[7px]"
            style={{
              left: b.x + 24,
              top: b.y - 4,
              borderColor: `${b.color}66`,
              color: b.color,
              boxShadow: `0 0 8px -2px ${b.color}88`,
            }}
            initial={{ opacity: 0, scale: 0.6, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.6, y: -4 }}
            transition={{ duration: 0.3 }}
          >
            <MessageSquare className="h-2 w-2" style={{ color: b.color }} />
            {b.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Live HH:MM:SS clock display. */
function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  // SSR-safe guard: render a placeholder until mounted.
  const timeStr = now
    ? now.toLocaleTimeString("en-US", { hour12: false })
    : "--:--:--";
  return (
    <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-black/60 px-2 py-1">
      <Clock className="h-3 w-3 text-violet-400" />
      <span className="font-mono text-[11px] tabular-nums text-violet-200">
        {timeStr}
      </span>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────

export function EmployeesAnimation() {
  const agents = useMissionStore((s) => s.agents);

  // Pull a stable sorted agent list (up to 12 desks).
  const agentList = useMemo(() => {
    const list = Object.values(agents).sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [agents]);

  const visibleAgents = agentList.slice(0, DESK_ROWS * DESKS_PER_ROW);

  // Status distribution — drives the status bar + productivity meter.
  const dist = useMemo(() => {
    const d: Record<AgentStatus, number> = {
      idle: 0,
      thinking: 0,
      executing: 0,
      streaming: 0,
      waiting: 0,
      error: 0,
      offline: 0,
    };
    for (const a of agentList) d[a.status] += 1;
    return d;
  }, [agentList]);

  const executingCount = dist.executing + dist.streaming;
  const thinkingCount = dist.thinking;
  const idleCount = dist.idle + dist.waiting;

  // Pick meeting participants (status=streaming) — up to 3 sit at center table.
  const meetingParticipants = useMemo(() => {
    return agentList.filter((a) => a.status === "streaming").slice(0, 3);
  }, [agentList]);
  const meetingVisible = meetingParticipants.length > 0;

  // Compute meeting table slot positions (3 chairs around the center table).
  const meetingSlots = useMemo(() => {
    const cx = FLOOR_LEFT_PAD + (DESKS_PER_ROW * (DESK_W + COL_GAP)) / 2 - 10;
    const cy = DESK_TOP_OFFSET + (DESK_H + ROW_GAP + 24) + 6;
    return [
      { x: cx - 22, y: cy - 4 },
      { x: cx, y: cy - 4 },
      { x: cx + 22, y: cy - 4 },
    ];
  }, []);

  // Map agent IDs → meeting slot index.
  const meetingSlotByAgentId = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    meetingParticipants.forEach((a, i) => {
      if (meetingSlots[i]) m.set(a.id, meetingSlots[i]);
    });
    return m;
  }, [meetingParticipants, meetingSlots]);

  // Speech bubble cycling — every 5s, new set of 3.
  const [cycleKey, setCycleKey] = useState(0);
  const cycleRef = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      cycleRef.current += 1;
      setCycleKey(cycleRef.current);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // Build the speech-bubble layer's desk list (only desks with real agents).
  const desksWithAgents = useMemo(() => {
    return visibleAgents.map((a, i) => {
      const row = Math.floor(i / DESKS_PER_ROW);
      const col = i % DESKS_PER_ROW;
      const baseX = FLOOR_LEFT_PAD + col * (DESK_W + COL_GAP);
      const baseY = DESK_TOP_OFFSET + row * (DESK_H + ROW_GAP + 24);
      const color = AVATAR_COLORS[i % AVATAR_COLORS.length];
      return { x: baseX, y: baseY, color, name: a.name };
    });
  }, [visibleAgents]);

  return (
    <section
      className="relative w-full overflow-hidden rounded-lg border border-slate-800/60 bg-[#070710] font-mono"
      style={{ height: FLOOR_HEIGHT }}
      role="img"
      aria-label={`Office floor visualization with ${visibleAgents.length} employees working`}
    >
      {/* Office floor background grid (subtle tile feel) */}
      <div
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.05) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />
      {/* Ambient violet/cyan glows */}
      <div
        className="pointer-events-none absolute -left-20 top-0 h-48 w-48 rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(167,139,250,0.5), transparent 70%)" }}
      />
      <div
        className="pointer-events-none absolute -right-20 bottom-0 h-48 w-48 rounded-full opacity-25 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(34,211,238,0.5), transparent 70%)" }}
      />

      {/* Floor area outline */}
      <div
        className="pointer-events-none absolute border border-slate-800/60 rounded-md"
        style={{
          left: FLOOR_LEFT_PAD - 12,
          top: FLOOR_TOP_PAD,
          right: FLOOR_RIGHT_PAD,
          bottom: 40,
          background:
            "linear-gradient(180deg, rgba(15,23,42,0.4), rgba(2,6,23,0.6))",
        }}
      />
      {/* Row divider */}
      <div
        className="pointer-events-none absolute border-t border-dashed border-slate-800/60"
        style={{
          left: FLOOR_LEFT_PAD - 12,
          right: FLOOR_RIGHT_PAD,
          top: DESK_TOP_OFFSET + DESK_H + ROW_GAP / 2 + 8,
        }}
      />

      {/* Live clock (top-left) */}
      <LiveClock />

      {/* Title (top-center) */}
      <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2">
        <div className="flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-black/60 px-3 py-1">
          <Keyboard className="h-3 w-3 text-cyan-400" />
          <span className="text-[10px] font-semibold tracking-[0.16em] text-slate-200">
            OFFICE FLOOR
          </span>
          <span className="text-slate-600">·</span>
          <span className="text-[10px] font-semibold tabular-nums text-violet-300">
            {visibleAgents.length}
          </span>
          <span className="text-[10px] tracking-tight text-slate-400">
            EMPLOYEES WORKING
          </span>
        </div>
      </div>

      {/* Top-right total badge */}
      <div className="absolute right-3 top-3 z-10 rounded-md border border-slate-800 bg-black/60 px-2 py-1">
        <span className="text-[9px] tracking-tight text-slate-400">
          fleet: <span className="text-cyan-300 tabular-nums">{agentList.length}</span>
        </span>
      </div>

      {/* Desks */}
      <div className="absolute inset-0 z-[3]">
        {Array.from({ length: DESK_ROWS * DESKS_PER_ROW }).map((_, i) => {
          const agent = visibleAgents[i] ?? null;
          const color = AVATAR_COLORS[i % AVATAR_COLORS.length];
          const meetingSlot = agent ? meetingSlotByAgentId.get(agent.id) ?? null : null;
          return (
            <Desk
              key={agent?.id ?? `empty-${i}`}
              agent={agent}
              color={color}
              deskIndex={i}
              isMeetingParticipant={!!meetingSlot}
              meetingSlot={meetingSlot}
            />
          );
        })}
      </div>

      {/* Meeting table (center) — visible only when someone is streaming */}
      <MeetingTable visible={meetingVisible} />

      {/* Speech bubble layer */}
      <SpeechBubbleLayer desksWithAgents={desksWithAgents} cycleKey={cycleKey} />

      {/* Productivity meter (right side) */}
      <ProductivityMeter executing={executingCount} total={agentList.length} />

      {/* Status bar (bottom) */}
      <div className="absolute inset-x-0 bottom-3 z-10 flex items-center justify-center gap-3 font-mono text-[9px]">
        <span className="flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          <span className="tabular-nums text-amber-300">{executingCount}</span>
          <span className="text-slate-500">executing</span>
        </span>
        <span className="flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/5 px-2 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
          <span className="tabular-nums text-cyan-300">{thinkingCount}</span>
          <span className="text-slate-500">thinking</span>
        </span>
        <span className="flex items-center gap-1 rounded-md border border-slate-700/60 bg-slate-700/10 px-2 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
          <span className="tabular-nums text-slate-300">{idleCount}</span>
          <span className="text-slate-500">idle</span>
        </span>
        {dist.error > 0 && (
          <span className="flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
            <span className="tabular-nums text-rose-300">{dist.error}</span>
            <span className="text-slate-500">error</span>
          </span>
        )}
      </div>
    </section>
  );
}

export default EmployeesAnimation;
