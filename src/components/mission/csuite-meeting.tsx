"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import {
  RISK_META,
  AGENT_STATUS_META,
  type Agent,
  type AgentStatus,
  type Approval,
  type ApprovalBrief,
  type ApprovalStatus,
} from "@/lib/types";
import {
  Crown,
  Settings,
  DollarSign,
  Code2,
  Network,
  Users,
  Radio,
  ChevronDown,
  ChevronUp,
  Gavel,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { FullScreenPanel } from "./full-screen-panel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * CsuiteMeeting — animated C-suite boardroom visualization cycling through
 * REAL decisions from the mission store's `approvals` slice.
 *
 * Five executives sit around a glowing oval table. Every 5 seconds the
 * next most recent decision is shown at the table center (title, status
 * badge, risk level, requester agent). The current speaker highlights +
 * a speech bubble shows a one-line summary, and a data-flow line pulses
 * from speaker → table center.
 *
 * If no approvals exist, the table shows "Awaiting first decision…" — no
 * fabrication. Clicking the table opens a Dialog with the full decision
 * history, each row expandable to show its parsed brief (why / risks /
 * ifApproved / ifNotApproved).
 *
 * Task ID: ANIM-REDESIGN (Task 4).
 */

interface SeatConfig {
  id: "CEO" | "COO" | "CTO" | "CFO" | "ROTATING";
  name: string; // agent name in store (for ROTATING, the requester agent's name)
  role: string;
  icon: typeof Crown;
  color: string;
  rgb: string;
  pos: { xPct: number; yPx: number };
}

const FIXED_SEATS: Omit<SeatConfig, "name">[] = [
  { id: "CEO", role: "CEO", icon: Crown, color: "#a78bfa", rgb: "167, 139, 250", pos: { xPct: 25, yPx: 70 } },
  { id: "COO", role: "COO", icon: Settings, color: "#fbbf24", rgb: "251, 191, 36", pos: { xPct: 50, yPx: 70 } },
  { id: "CFO", role: "CFO", icon: DollarSign, color: "#34d399", rgb: "52, 211, 153", pos: { xPct: 75, yPx: 70 } },
  { id: "CTO", role: "CTO", icon: Code2, color: "#22d3ee", rgb: "34, 211, 238", pos: { xPct: 25, yPx: 310 } },
  // 5th seat is "rotating" — shows the current decision's requester
  { id: "ROTATING", role: "Guest", icon: Network, color: "#fb7185", rgb: "251, 113, 133", pos: { xPct: 75, yPx: 310 } },
];

const SECTION_H = 420;
const TABLE_W = 280;
const TABLE_H = 100;
const TABLE_CY = 200;
const AVATAR_SIZE = 52;

const STATUS_BADGE: Record<ApprovalStatus, { label: string; tone: string; bg: string; ring: string; hex: string }> = {
  approved: { label: "Approved", tone: "text-emerald-300", bg: "bg-emerald-500/10", ring: "border-emerald-500/40", hex: "#10b981" },
  denied: { label: "Denied", tone: "text-rose-300", bg: "bg-rose-500/10", ring: "border-rose-500/40", hex: "#f43f5e" },
  pending: { label: "Pending", tone: "text-amber-300", bg: "bg-amber-500/10", ring: "border-amber-500/40", hex: "#f59e0b" },
  expired: { label: "Expired", tone: "text-slate-300", bg: "bg-slate-500/10", ring: "border-slate-500/40", hex: "#64748b" },
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function oneLineSummary(approval: Approval): string {
  if (approval.summary && approval.summary.trim().length > 0) {
    const s = approval.summary.trim();
    return s.length > 80 ? s.slice(0, 78) + "…" : s;
  }
  return approval.title.length > 80 ? approval.title.slice(0, 78) + "…" : approval.title;
}

function parseBrief(raw: string | null): ApprovalBrief | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof (parsed as ApprovalBrief).why === "string") {
      return parsed as ApprovalBrief;
    }
    return null;
  } catch {
    return null;
  }
}

export function CsuiteMeeting() {
  const approvals = useMissionStore((s) => s.approvals);
  const agents = useMissionStore((s) => s.agents);
  const [decisionIdx, setDecisionIdx] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Sorted decisions (decidedAt desc, fallback to createdAt desc).
  const decisions = useMemo(() => {
    const list = Object.values(approvals);
    list.sort((a, b) => {
      const aT = a.decidedAt ?? a.createdAt;
      const bT = b.decidedAt ?? b.createdAt;
      return new Date(bT).getTime() - new Date(aT).getTime();
    });
    return list;
  }, [approvals]);

  // Cycle to the next decision every 5 seconds.
  useEffect(() => {
    if (decisions.length === 0) return;
    const id = window.setInterval(() => {
      setDecisionIdx((i) => (i + 1) % decisions.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, [decisions.length]);

  // Clamp index if decisions shrink.
  useEffect(() => {
    if (decisionIdx >= decisions.length) setDecisionIdx(0);
  }, [decisionIdx, decisions.length]);

  const currentDecision = decisions.length > 0 ? decisions[decisionIdx] : null;

  // Determine the speaking seat for the current decision.
  // Match by requester name (case-insensitive contains) or agentId.
  const { seats, speakerSeatId } = useMemo(() => {
    const agentByName = new Map<string, Agent>();
    for (const a of Object.values(agents)) agentByName.set(a.name, a);
    const built: SeatConfig[] = FIXED_SEATS.map((s) => {
      let name = "";
      if (s.id === "CEO") name = "Aria-CEO";
      else if (s.id === "COO") name = "Sage-COO";
      else if (s.id === "CFO") name = "Ledger-CFO";
      else if (s.id === "CTO") name = "Aria-CTO";
      else if (s.id === "ROTATING") name = "Maestro-Conductor";
      return { ...s, name };
    });

    let speakerId: SeatConfig["id"] | null = null;
    if (currentDecision) {
      const requester = currentDecision.requester?.toLowerCase().trim() ?? "";
      const agent = currentDecision.agentId ? agents[currentDecision.agentId] : null;
      const agentName = agent?.name?.toLowerCase() ?? "";
      // Match against the fixed seat's store-name.
      const matchByName = (seatName: string) => {
        const sn = seatName.toLowerCase();
        return (
          (requester && sn.includes(requester)) ||
          (requester && requester.includes(sn.replace(/^(aria|sage|ledger|maestro)-/, ""))) ||
          (agentName && sn === agentName)
        );
      };
      const matched = built.find((s) => matchByName(s.name));
      if (matched) speakerId = matched.id;
      else {
        // The rotating seat mirrors the current requester.
        const rot = built.find((s) => s.id === "ROTATING");
        if (rot && (requester || agent)) {
          rot.name = agent?.name ?? currentDecision.requester ?? "Guest";
          rot.role = agent?.role ?? "Guest";
          speakerId = "ROTATING";
        } else {
          speakerId = "CEO"; // fallback
        }
      }
    }
    return { seats: built, speakerSeatId: speakerId };
  }, [currentDecision, agents]);

  const speakerSeat = seats.find((s) => s.id === speakerSeatId) ?? null;
  const hasDecision = !!currentDecision;

  // Status badge tone for current decision.
  const statusMeta = currentDecision
    ? STATUS_BADGE[currentDecision.status as ApprovalStatus]
    : STATUS_BADGE.pending;
  const riskMeta = currentDecision
    ? RISK_META[currentDecision.risk as keyof typeof RISK_META]
    : null;

  return (
    <>
      <FullScreenPanel
        title="Board Meeting"
        icon={<Users className="h-4 w-4 text-violet-300" />}
        actions={
          decisions.length > 0 ? (
            <div className="hidden items-center gap-2 font-mono text-[10px] text-muted-foreground sm:flex">
              <Gavel className="h-3 w-3 text-amber-300" />
              <span>{decisions.length}</span>
              <span>decisions</span>
            </div>
          ) : undefined
        }
      >
        <section
          className="relative w-full overflow-hidden bg-[#0a0a0f] font-mono"
          style={{ height: SECTION_H }}
          aria-label="C-suite board meeting visualization"
        >
          <style>{`
            @keyframes cm-think {
              0%, 100% { opacity: 0.3; transform: translateY(0); }
              50%      { opacity: 1;   transform: translateY(-2px); }
            }
          `}</style>

          {/* ─── SVG layer: table glow + data-flow line ─── */}
          <svg
            className="pointer-events-none absolute inset-0"
            width="100%"
            height={SECTION_H}
            viewBox={`0 0 1000 ${SECTION_H}`}
            preserveAspectRatio="none"
            aria-hidden
          >
            <defs>
              <radialGradient id="cm-table-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.18} />
                <stop offset="70%" stopColor="#7c3aed" stopOpacity={0.05} />
                <stop offset="100%" stopColor="#0a0a0f" stopOpacity={0} />
              </radialGradient>
            </defs>

            {/* Table ambient glow */}
            <ellipse
              cx={500}
              cy={TABLE_CY}
              rx={TABLE_W / 2 + 70}
              ry={TABLE_H / 2 + 55}
              fill="url(#cm-table-glow)"
            />

            {/* Data-flow line: speaker → table center (only when a decision is shown) */}
            {hasDecision && speakerSeat && (
              <motion.line
                key={`flow-${speakerSeat.id}-${decisionIdx}`}
                x1={(speakerSeat.pos.xPct / 100) * 1000}
                y1={speakerSeat.pos.yPx < TABLE_CY ? speakerSeat.pos.yPx + AVATAR_SIZE : speakerSeat.pos.yPx}
                x2={500}
                y2={TABLE_CY}
                stroke={speakerSeat.color}
                strokeWidth={1.5}
                strokeDasharray="5 5"
                initial={{ opacity: 0, strokeDashoffset: 0 }}
                animate={{ opacity: [0, 0.9, 0.65], strokeDashoffset: [0, -20] }}
                transition={{
                  opacity: { duration: 0.4 },
                  strokeDashoffset: { duration: 1, repeat: Infinity, ease: "linear" },
                }}
                style={{ filter: `drop-shadow(0 0 4px ${speakerSeat.color})` }}
              />
            )}
          </svg>

          {/* ─── Boardroom table (clickable → opens history dialog) ─── */}
          <motion.button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="group absolute rounded-full border-2"
            style={{
              left: "50%",
              top: TABLE_CY,
              width: TABLE_W,
              height: TABLE_H,
              marginLeft: -TABLE_W / 2,
              marginTop: -TABLE_H / 2,
              background:
                "radial-gradient(ellipse at center, rgba(30, 27, 46, 0.9) 0%, rgba(15, 15, 23, 0.95) 100%)",
              borderColor: hasDecision
                ? statusMeta.hex
                : "rgba(139, 92, 246, 0.4)",
            }}
            animate={{
              boxShadow: hasDecision
                ? [
                    `0 0 60px 0 rgba(124, 58, 237, 0.35), inset 0 0 30px 0 rgba(167, 139, 250, 0.10)`,
                    `0 0 85px 4px rgba(124, 58, 237, 0.55), inset 0 0 40px 0 rgba(167, 139, 250, 0.20)`,
                    `0 0 60px 0 rgba(124, 58, 237, 0.35), inset 0 0 30px 0 rgba(167, 139, 250, 0.10)`,
                  ]
                : "0 0 20px 0 rgba(100, 116, 139, 0.2)",
            }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            aria-label={hasDecision ? "Open decision history" : "Awaiting decisions"}
          >
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center">
              {hasDecision && currentDecision ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${statusMeta.bg} ${statusMeta.tone} ${statusMeta.ring}`}
                    >
                      {statusMeta.label}
                    </span>
                    {riskMeta && (
                      <span className={`rounded border px-1.5 py-0.5 text-[9px] uppercase ${riskMeta.badge}`}>
                        {riskMeta.label}
                      </span>
                    )}
                  </div>
                  <div className="line-clamp-2 px-2 text-[11px] font-semibold leading-tight text-foreground">
                    {currentDecision.title}
                  </div>
                  <div className="font-mono text-[9px] text-muted-foreground">
                    {currentDecision.requester ?? "system"}
                    {currentDecision.amount ? ` · $${currentDecision.amount.toLocaleString()}` : ""}
                  </div>
                  <div className="mt-0.5 hidden items-center gap-1 text-[8px] uppercase tracking-wider text-cyan-300/70 opacity-0 transition-opacity group-hover:opacity-100 sm:flex">
                    <ChevronDown className="h-2.5 w-2.5" /> click for history
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-1.5 px-3 text-center">
                  <Clock className="h-4 w-4 text-slate-500" />
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Awaiting first decision…
                  </div>
                  <div className="text-[9px] text-slate-600">
                    board will convene when approvals arrive
                  </div>
                </div>
              )}
            </div>
          </motion.button>

          {/* ─── C-suite seats ─── */}
          {seats.map((seat, idx) => {
            const agent = agents[Object.values(agents).find((a) => a.name === seat.name)?.id ?? ""];
            const isSpeaking = hasDecision && seat.id === speakerSeatId;
            const Icon = seat.icon;
            const isError = agent?.status === "error";
            const isThinking = agent?.status === "thinking";
            const statusLabel = agent
              ? AGENT_STATUS_META[agent.status as AgentStatus]?.label?.toLowerCase() ?? "offline"
              : "offline";
            const speakerLabel = isSpeaking ? oneLineSummary(currentDecision!) : "";
            return (
              <div
                key={seat.id}
                className="absolute"
                style={{
                  left: `${seat.pos.xPct}%`,
                  top: seat.pos.yPx,
                  transform: "translate(-50%, 0)",
                }}
              >
                <motion.div
                  className="relative flex flex-col items-center"
                  initial={{ opacity: 0 }} animate={{
                    scale: isSpeaking ? [1, 1.06, 1] : 1,
                    opacity: isSpeaking || !hasDecision ? 1 : 0.65,
                  }}
                  transition={{
                    scale: { duration: 1.5, repeat: isSpeaking ? Infinity : 0, ease: "easeInOut" },
                    opacity: { duration: 0.4 },
                  }}
                  style={{
                    filter: isSpeaking ? "none" : "saturate(0.6) brightness(0.85)",
                  }}
                >
                  {/* Speech bubble (current speaker only, when a decision is active) */}
                  <AnimatePresence>
                    {isSpeaking && speakerLabel ? (
                      <motion.div
                        key={`bubble-${seat.id}-${decisionIdx}`}
                        initial={{ opacity: 0, y: 8, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.9 }}
                        transition={{ duration: 0.3 }}
                        className="absolute -top-10 left-1/2 w-44 -translate-x-1/2 whitespace-normal rounded-lg border bg-[#13131c]/95 px-2.5 py-1.5 text-center text-[10px] leading-tight shadow-xl z-10"
                        style={{
                          borderColor: `rgba(${seat.rgb}, 0.5)`,
                          boxShadow: `0 0 16px 0 rgba(${seat.rgb}, 0.3)`,
                          color: seat.color,
                        }}
                      >
                        &ldquo;{speakerLabel}&rdquo;
                        <span
                          className="absolute left-1/2 -bottom-1 -translate-x-1/2 h-2 w-2 rotate-45 border-r border-b"
                          style={{ background: "#13131c", borderColor: `rgba(${seat.rgb}, 0.5)` }}
                        />
                      </motion.div>
                    ) : null}
                  </AnimatePresence>

                  {/* Avatar */}
                  <motion.div
                    className="relative flex items-center justify-center rounded-full border-2"
                    style={{
                      width: AVATAR_SIZE,
                      height: AVATAR_SIZE,
                      background: `radial-gradient(circle at 35% 35%, rgba(${seat.rgb}, 0.28), rgba(${seat.rgb}, 0.06) 60%, rgba(10,10,15,0.9))`,
                      borderColor: isError
                        ? "#fb7185"
                        : `rgba(${seat.rgb}, ${isSpeaking ? 0.9 : 0.5})`,
                      boxShadow: isSpeaking
                        ? `0 0 22px 4px rgba(${seat.rgb}, 0.6), inset 0 0 12px 0 rgba(${seat.rgb}, 0.22)`
                        : `0 0 8px 0 rgba(${seat.rgb}, 0.2)`,
                    }}
                    animate={isError ? { borderColor: ["#fb7185", "#f43f5e", "#fb7185"] } : {}}
                    transition={{ duration: 1, repeat: isError ? Infinity : 0 }}
                  >
                    <Icon className="h-5 w-5" style={{ color: seat.color }} strokeWidth={1.75} />

                    {/* Thinking dots */}
                    {isThinking ? (
                      <div className="absolute -bottom-1.5 left-1/2 flex -translate-x-1/2 gap-0.5">
                        {[0, 1, 2].map((d) => (
                          <span
                            key={d}
                            className="h-1 w-1 rounded-full bg-cyan-300"
                            style={{ animation: `cm-think 1s ease-in-out ${d * 0.15}s infinite` }}
                          />
                        ))}
                      </div>
                    ) : null}

                    {/* Error ring pulse */}
                    {isError ? (
                      <motion.div
                        className="absolute inset-0 rounded-full border-2 border-rose-500"
                        initial={{ opacity: 0.8 }} animate={{ scale: [1, 1.35], opacity: [0.8, 0] }}
                        transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
                      />
                    ) : null}
                  </motion.div>

                  {/* Name + status label */}
                  <div className="mt-1.5 text-center">
                    <div className="text-[10px] font-bold leading-tight" style={{ color: seat.color }}>
                      {seat.id === "ROTATING" && seat.name !== "Maestro-Conductor"
                        ? seat.name
                        : seat.name}
                    </div>
                    <div className="mt-0.5 text-[8px] uppercase tracking-[0.15em] leading-tight text-slate-500">
                      {seat.role} · {statusLabel}
                    </div>
                  </div>
                </motion.div>
              </div>
            );
          })}

          {/* ─── Title overlay (top) ─── */}
          <div className="absolute top-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 text-[10px]">
            <motion.span
              className="h-1.5 w-1.5 rounded-full bg-rose-500"
              initial={{ opacity: 1 }} animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
            <span className="font-bold tracking-[0.3em] text-violet-200">
              {hasDecision ? "DECISION IN REVIEW" : "BOARD STANDBY"}
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-cyan-300">
              {hasDecision ? `${decisionIdx + 1}/${decisions.length}` : "0/0"}
            </span>
          </div>

          {/* ─── Status bar (bottom) ─── */}
          <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 text-[10px] text-slate-400">
            <span className="text-violet-200">5 executives</span>
            <span className="text-slate-600">·</span>
            <motion.span
              className="flex items-center gap-1 text-emerald-300"
              initial={{ opacity: 1 }} animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Radio className="h-2.5 w-2.5" />
              live
            </motion.span>
            {hasDecision && (
              <>
                <span className="text-slate-600">·</span>
                <span>
                  cycle: <span className="text-cyan-300">5s</span>
                </span>
              </>
            )}
          </div>
        </section>
      </FullScreenPanel>

      {/* Decision history dialog */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[88vh] w-[92vw] max-w-3xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border/60 px-5 py-3">
            <DialogTitle className="flex items-center gap-2 font-mono text-sm uppercase tracking-wider">
              <Gavel className="h-4 w-4 text-amber-300" />
              Decision History
              <span className="rounded border border-border/60 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                {decisions.length}
              </span>
            </DialogTitle>
            <DialogDescription className="font-mono text-[10px] text-muted-foreground">
              Full chronological log of every approval/decision. Click a row to expand its brief.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            {decisions.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12">
                <AlertTriangle className="h-6 w-6 text-slate-500" />
                <div className="font-mono text-xs text-muted-foreground">No decisions recorded yet</div>
              </div>
            ) : (
              <ul className="divide-y divide-border/40">
                {decisions.map((d) => (
                  <DecisionRow key={d.id} approval={d} />
                ))}
              </ul>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DecisionRow({ approval }: { approval: Approval }) {
  const [expanded, setExpanded] = useState(false);
  const brief = useMemo(() => parseBrief(approval.brief), [approval.brief]);
  const statusMeta = STATUS_BADGE[approval.status as ApprovalStatus];
  const riskMeta = RISK_META[approval.risk as keyof typeof RISK_META];

  return (
    <li className="border-b border-border/30">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-card/40"
      >
        <div className="mt-0.5 shrink-0">
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${statusMeta.bg} ${statusMeta.tone} ${statusMeta.ring}`}
            >
              {statusMeta.label}
            </span>
            {riskMeta && (
              <span className={`rounded border px-1.5 py-0.5 text-[9px] uppercase ${riskMeta.badge}`}>
                {riskMeta.label}
              </span>
            )}
            <span className="text-[9px] text-muted-foreground">
              <Clock className="mr-0.5 inline h-2.5 w-2.5" />
              {fmtTime(approval.decidedAt ?? approval.createdAt)}
            </span>
          </div>
          <div className="mt-1 truncate text-xs font-medium text-foreground">{approval.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[9px] text-muted-foreground">
            <span>
              requester: <span className="text-violet-300">{approval.requester ?? "—"}</span>
            </span>
            {approval.action && (
              <span>
                action: <span className="text-cyan-300">{approval.action}</span>
              </span>
            )}
            {approval.amount != null && approval.amount !== 0 && (
              <span>
                amount: <span className="text-emerald-300">${approval.amount.toLocaleString()}</span>
              </span>
            )}
          </div>
        </div>
      </button>
      <AnimatePresence>
        {expanded && brief && (
          <motion.div
            key="brief"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 border-t border-border/30 bg-background/40 px-4 py-3 pl-10 font-mono text-[10px]">
              <BriefSection label="Why" body={brief.why} tone="text-cyan-300" />
              {brief.risks.length > 0 && (
                <BriefSection label="Risks" list={brief.risks} tone="text-amber-300" />
              )}
              <BriefSection label="If Approved" body={brief.ifApproved} tone="text-emerald-300" />
              <BriefSection label="If Not Approved" body={brief.ifNotApproved} tone="text-rose-300" />
              {brief.clarifications.length > 0 && (
                <div>
                  <div className="mb-1 text-[9px] uppercase tracking-wider text-violet-300">Clarifications</div>
                  <ul className="space-y-1">
                    {brief.clarifications.map((c, i) => (
                      <li key={i} className="text-[10px] text-muted-foreground">
                        <span className="text-violet-300">Q:</span> {c.q}
                        <br />
                        <span className="text-violet-300">A:</span> {c.a}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </motion.div>
        )}
        {expanded && !brief && (
          <motion.div
            key="no-brief"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border/30 bg-background/40 px-4 py-2 pl-10 font-mono text-[10px] text-muted-foreground"
          >
            No structured brief attached.
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function BriefSection({
  label,
  body,
  list,
  tone,
}: {
  label: string;
  body?: string;
  list?: string[];
  tone: string;
}) {
  return (
    <div>
      <div className={`mb-0.5 text-[9px] uppercase tracking-wider ${tone}`}>{label}</div>
      {body ? <div className="text-[10px] leading-relaxed text-muted-foreground">{body}</div> : null}
      {list && list.length > 0 ? (
        <ul className="ml-3 list-disc text-[10px] leading-relaxed text-muted-foreground">
          {list.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default CsuiteMeeting;
