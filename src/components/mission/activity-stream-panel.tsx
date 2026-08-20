"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  Send,
  ShieldCheck,
  AlertTriangle,
  Cpu,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import { FullScreenPanel } from "./full-screen-panel";
import { Badge } from "@/components/ui/badge";
import { useMissionStore } from "@/stores/mission-store";
import { useClock, relTime } from "@/hooks/use-clock";
import type {
  AgentMessage,
  Approval,
  SystemAlert,
  LlmCall,
  AgentLog,
} from "@/lib/types";

// ─── Types ───────────────────────────────────────────────────────────

type EntryType = "message" | "approval" | "alert" | "llm" | "log";

interface ActivityEntry {
  id: string;
  type: EntryType;
  timestamp: string;
  title: string;
  subtitle?: string;
  agentName?: string;
  severity?: string;
}

// ─── Style maps ──────────────────────────────────────────────────────

const TYPE_DOT: Record<EntryType, string> = {
  message: "bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]",
  approval: "bg-violet-400 shadow-[0_0_8px_rgba(139,92,246,0.6)]",
  alert: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]",
  llm: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]",
  log: "bg-zinc-500 shadow-[0_0_6px_rgba(113,113,122,0.5)]",
};

const TYPE_BADGE: Record<EntryType, string> = {
  message: "text-cyan-300 border-cyan-500/30 bg-cyan-500/10",
  approval: "text-violet-300 border-violet-500/30 bg-violet-500/10",
  alert: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  llm: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  log: "text-muted-foreground border-border/60 bg-surface-2/60",
};

const TYPE_LABEL: Record<EntryType, string> = {
  message: "Message",
  approval: "Approval",
  alert: "Alert",
  llm: "LLM",
  log: "Log",
};

const TYPE_ICON: Record<EntryType, LucideIcon> = {
  message: Send,
  approval: ShieldCheck,
  alert: AlertTriangle,
  llm: Cpu,
  log: ScrollText,
};

const ALL_TYPES: EntryType[] = ["message", "approval", "alert", "llm", "log"];

const MAX_ENTRIES = 100;

// ─── Component ───────────────────────────────────────────────────────

export function ActivityStreamPanel() {
  // Subscribe to the 5 store slices + the agents lookup map (for names)
  // and the connection state (drives the live indicator).
  const agents = useMissionStore((s) => s.agents);
  const agentMessages = useMissionStore((s) => s.agentMessages);
  const approvals = useMissionStore((s) => s.approvals);
  const alerts = useMissionStore((s) => s.alerts);
  const llmCalls = useMissionStore((s) => s.llmCalls);
  const logs = useMissionStore((s) => s.logs);
  const connection = useMissionStore((s) => s.connection);
  // useClock ticks every 1s — forces relTime() re-render.
  useClock();

  // ── Filter state — all on by default ──────────────────────────────
  const [enabledTypes, setEnabledTypes] = useState<Set<EntryType>>(
    () => new Set(ALL_TYPES),
  );

  const toggleType = useCallback((t: EntryType) => {
    setEnabledTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) {
        // Don't allow disabling the last enabled type — keep at least one
        // so the timeline never shows "everything off".
        if (next.size > 1) next.delete(t);
      } else {
        next.add(t);
      }
      return next;
    });
  }, []);

  // ── Normalize entries ─────────────────────────────────────────────
  // Build a unified timeline (newest first) capped at MAX_ENTRIES.
  const allEntries = useMemo<ActivityEntry[]>(() => {
    const messages: ActivityEntry[] = (agentMessages as AgentMessage[]).map(
      (m) => {
        const fromName = m.fromAgentId
          ? agents[m.fromAgentId]?.name ?? "system"
          : "system";
        const toName = m.toAgentId
          ? agents[m.toAgentId]?.name ?? "fleet"
          : "fleet";
        return {
          id: `msg:${m.id}`,
          type: "message",
          timestamp: m.createdAt,
          title: m.subject,
          subtitle: m.body ?? undefined,
          agentName: fromName !== "system" ? fromName : undefined,
          severity: `${fromName} → ${toName}`,
        };
      },
    );

    const approvalEntries: ActivityEntry[] = (
      Object.values(approvals) as Approval[]
    ).map((a) => ({
      id: `approval:${a.id}`,
      type: "approval",
      timestamp: a.createdAt,
      title: a.title,
      subtitle:
        a.summary ?? `${a.status} · risk: ${a.risk}${a.action ? ` · ${a.action}` : ""}`,
      agentName:
        a.agentId != null
          ? (agents[a.agentId]?.name ?? undefined)
          : (a.requester ?? undefined),
      severity: a.status,
    }));

    const alertEntries: ActivityEntry[] = (alerts as SystemAlert[]).map(
      (al) => ({
        id: `alert:${al.id}`,
        type: "alert",
        timestamp: al.createdAt,
        title: al.message,
        subtitle: `source: ${al.source}${al.ack ? " · acked" : " · unacked"}`,
        severity: al.severity,
      }),
    );

    const llmEntries: ActivityEntry[] = (llmCalls as LlmCall[]).map((l) => ({
      id: `llm:${l.id}`,
      type: "llm",
      timestamp: l.createdAt,
      title: `${l.provider}/${l.model}`,
      subtitle: `${l.status}${l.fallback ? " · fallback" : ""} · ${l.latencyMs}ms · ${l.tokensIn + l.tokensOut} tok`,
      agentName:
        l.agentId != null
          ? (agents[l.agentId]?.name ?? undefined)
          : undefined,
      severity: l.status,
    }));

    const logEntries: ActivityEntry[] = (logs as AgentLog[]).map((lg) => ({
      id: `log:${lg.id}`,
      type: "log",
      timestamp: lg.createdAt,
      title: lg.message,
      subtitle: lg.meta ?? undefined,
      agentName:
        lg.agentId != null
          ? (agents[lg.agentId]?.name ?? undefined)
          : undefined,
      severity: lg.level,
    }));

    const merged = [
      ...messages,
      ...approvalEntries,
      ...alertEntries,
      ...llmEntries,
      ...logEntries,
    ];
    merged.sort((a, b) => {
      // Use localeCompare for ISO timestamps — fastest string compare.
      // Sort newest first.
      if (a.timestamp > b.timestamp) return -1;
      if (a.timestamp < b.timestamp) return 1;
      return 0;
    });
    return merged.slice(0, MAX_ENTRIES);
  }, [agentMessages, approvals, alerts, llmCalls, logs, agents]);

  // ── Apply filter ──────────────────────────────────────────────────
  const filtered = useMemo(
    () => allEntries.filter((e) => enabledTypes.has(e.type)),
    [allEntries, enabledTypes],
  );

  // ── Auto-scroll (top-of-list follow) with pause-on-user-scroll ─────
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  // Track the latest entry id so we know when something new arrives.
  const latestId = filtered[0]?.id ?? null;

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // "Near the top" = within 16px of scrollTop=0. New entries prepend
    // at top, so following the live edge means staying at scrollTop=0.
    const nearTop = el.scrollTop <= 16;
    setAutoFollow(nearTop);
  }, []);

  // When a new entry arrives AND we're auto-following, snap to top.
  useEffect(() => {
    if (!autoFollow) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
  }, [latestId, autoFollow]);

  // ── Live indicator (pulsing emerald dot when connection === "open")
  const isLive = connection === "open";

  return (
    <FullScreenPanel
      title="Activity Stream"
      icon={<Activity className="h-3.5 w-3.5 text-emerald-300" />}
      actions={
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <span className="hidden sm:inline">{filtered.length} events</span>
        </div>
      }
    >
      <div className="flex flex-col gap-2 p-3">
        {/* ── Filter bar ───────────────────────────────────────────── */}
        <div className="mc-surface flex flex-wrap items-center gap-1.5 rounded-lg border border-border/60 bg-surface-2/30 p-2">
          {/* Live indicator */}
          <span className="flex items-center gap-1.5 pr-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <span className="relative flex h-2 w-2">
              {isLive && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  isLive ? "bg-emerald-400" : "bg-zinc-500"
                }`}
              />
            </span>
            <span className={isLive ? "text-emerald-300" : "text-muted-foreground/70"}>
              {isLive ? "live" : connection}
            </span>
          </span>
          <span className="hidden h-3 w-px bg-border/60 sm:inline-block" />
          {/* Type toggle chips */}
          {ALL_TYPES.map((t) => {
            const Icon = TYPE_ICON[t];
            const enabled = enabledTypes.has(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                aria-pressed={enabled}
                title={`${enabled ? "Hide" : "Show"} ${TYPE_LABEL[t]} events`}
                className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wider transition-colors ${
                  enabled
                    ? TYPE_BADGE[t]
                    : "border-border/40 bg-surface-2/40 text-muted-foreground/40 hover:text-muted-foreground"
                }`}
              >
                <Icon className="h-2.5 w-2.5" />
                {TYPE_LABEL[t]}
              </button>
            );
          })}
        </div>

        {/* ── Timeline ────────────────────────────────────────────── */}
        {filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="mc-scroll relative max-h-[60vh] overflow-y-auto pr-1"
            role="log"
            aria-live="polite"
            aria-label="Unified activity stream"
          >
            <ol className="relative space-y-1">
              {/* Vertical timeline rail */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-2 left-[7px] top-2 w-px bg-border/40"
              />
              <AnimatePresence initial={false}>
                {filtered.map((entry) => (
                  <TimelineRow key={entry.id} entry={entry} />
                ))}
              </AnimatePresence>
            </ol>
            {/* Pause-on-scroll indicator */}
            {!autoFollow && (
              <button
                type="button"
                onClick={() => {
                  setAutoFollow(true);
                  const el = scrollRef.current;
                  if (el) el.scrollTop = 0;
                }}
                className="sticky bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border/60 bg-background/90 px-3 py-1 font-mono text-[10px] text-muted-foreground shadow-lg backdrop-blur transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <Activity className="h-3 w-3 text-emerald-300" />
                jump to latest
              </button>
            )}
          </div>
        )}
      </div>
    </FullScreenPanel>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

function TimelineRow({ entry }: { entry: ActivityEntry }) {
  const Icon = TYPE_ICON[entry.type];
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="relative flex gap-2.5 pl-0"
    >
      {/* Dot — sits on the rail (rail is at left:7px; dot is 8px wide, centered at 7px) */}
      <span className="relative z-10 mt-1.5 flex h-2 w-2 shrink-0 items-center justify-center">
        <span
          aria-hidden="true"
          className={`absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${TYPE_DOT[entry.type]}`}
        />
      </span>
      {/* Body */}
      <div className="min-w-0 flex-1 rounded-md border border-border/40 bg-surface-2/30 px-2.5 py-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Icon className="h-3 w-3 shrink-0 text-muted-foreground/70" />
          <span
            className="font-mono text-[9px] text-muted-foreground/70"
            title={entry.timestamp}
          >
            {relTime(entry.timestamp)}
          </span>
          <Badge
            variant="outline"
            className={`px-1 py-0 font-mono text-[8px] font-bold uppercase ${TYPE_BADGE[entry.type]}`}
          >
            {TYPE_LABEL[entry.type]}
          </Badge>
          {entry.severity && (
            <span className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground/60">
              {entry.severity}
            </span>
          )}
          {entry.agentName && (
            <span className="font-mono text-[9px] text-violet-300/80">
              {entry.agentName}
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate font-mono text-[10px] text-foreground/90">
          {entry.title}
        </div>
        {entry.subtitle && (
          <div className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground/70">
            {entry.subtitle}
          </div>
        )}
      </div>
    </motion.li>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <Activity className="h-7 w-7 text-muted-foreground/30" />
      <div className="font-mono text-[11px] font-medium text-muted-foreground">
        No activity yet — the agent fleet is warming up
      </div>
      <div className="max-w-sm px-4 font-mono text-[9px] text-muted-foreground/60">
        Events from messages, approvals, alerts, LLM calls, and logs will
        appear here in real time as agents start working.
      </div>
    </div>
  );
}

export default ActivityStreamPanel;
