"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Send,
  ShieldCheck,
  AlertTriangle,
  Cpu,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import { useMissionStore } from "@/stores/mission-store";
import { useClock, relTime } from "@/hooks/use-clock";
import { FullScreenPanel } from "./full-screen-panel";

/**
 * AgentActivityTicker — a horizontally-scrolling "news ticker" of real
 * agent activity, sourced from the Zustand store.
 *
 * Diffing approach: subscribe to the relevant slices (agentMessages,
 * approvals, alerts, llmCalls, tasks) + the agents lookup map. On every
 * change, walk each slice's head looking for IDs not in a `seen-set`
 * (seeded once after hydration so the initial snapshot isn't pushed as
 * "new activity"). Prepend the fresh items to a capped (30) local list.
 *
 * Compact layout: marquee-style auto-scroll that pauses on hover.
 * Fullscreen layout (via FullScreenPanel Dialog): vertical list with
 * full timestamps — switched via CSS based on `data-slot="dialog-content"`
 * ancestor.
 *
 * Task ID: FEATURES-TICKER-FAB (Task 1).
 */

type ActivityKind = "message" | "approval" | "alert" | "llm" | "task";

interface ActivityItem {
  uid: string;
  kind: ActivityKind;
  text: string;
  ts: string; // ISO datetime
  tone: string;
  bg: string;
  border: string;
  icon: LucideIcon;
}

const KIND_META: Record<
  ActivityKind,
  { icon: LucideIcon; tone: string; bg: string; border: string }
> = {
  message: {
    icon: Send,
    tone: "text-cyan-300",
    bg: "bg-cyan-500/5",
    border: "border-cyan-500/20",
  },
  approval: {
    icon: ShieldCheck,
    tone: "text-violet-300",
    bg: "bg-violet-500/5",
    border: "border-violet-500/20",
  },
  alert: {
    icon: AlertTriangle,
    tone: "text-amber-300",
    bg: "bg-amber-500/5",
    border: "border-amber-500/20",
  },
  llm: {
    icon: Cpu,
    tone: "text-emerald-300",
    bg: "bg-emerald-500/5",
    border: "border-emerald-500/20",
  },
  task: {
    icon: CheckCircle2,
    tone: "text-rose-300",
    bg: "bg-rose-500/5",
    border: "border-rose-500/20",
  },
};

const MAX_ITEMS = 30;

export function AgentActivityTicker() {
  const agents = useMissionStore((s) => s.agents);
  const agentMessages = useMissionStore((s) => s.agentMessages);
  const approvals = useMissionStore((s) => s.approvals);
  const alerts = useMissionStore((s) => s.alerts);
  const llmCalls = useMissionStore((s) => s.llmCalls);
  const tasks = useMissionStore((s) => s.tasks);
  const hydratedAt = useMissionStore((s) => s.hydratedAt);
  // useClock ticks every 1s — drives relTime re-computation.
  const now = useClock();

  const [items, setItems] = useState<ActivityItem[]>([]);
  const mountedRef = useRef(false);
  const seenMsgIds = useRef<Set<string>>(new Set());
  const seenAlertIds = useRef<Set<string>>(new Set());
  const seenLlmIds = useRef<Set<string>>(new Set());
  const prevApprovals = useRef<Map<string, string>>(new Map()); // id -> title
  const prevTaskStatus = useRef<Map<string, string>>(new Map()); // id -> status

  useEffect(() => {
    // Don't diff until the store has hydrated — otherwise the initial
    // snapshot would flood the ticker as "new activity".
    if (!hydratedAt) return;

    if (!mountedRef.current) {
      // Seed seen-sets with the current snapshot so we only surface
      // activity that arrives AFTER mount.
      seenMsgIds.current = new Set(agentMessages.map((m) => m.id));
      seenAlertIds.current = new Set(alerts.map((a) => a.id));
      seenLlmIds.current = new Set(llmCalls.map((l) => l.id));
      prevApprovals.current = new Map(
        Object.values(approvals).map((a) => [a.id, a.title])
      );
      prevTaskStatus.current = new Map(
        Object.values(tasks).map((t) => [t.id, t.status])
      );
      mountedRef.current = true;
      return;
    }

    const fresh: ActivityItem[] = [];

    // ─── Agent messages (prependCapped array — new items at head) ────
    for (const m of agentMessages) {
      if (!seenMsgIds.current.has(m.id)) {
        const fromName = m.fromAgentId
          ? agents[m.fromAgentId]?.name ?? "system"
          : "system";
        const toName = m.toAgentId
          ? agents[m.toAgentId]?.name ?? "fleet"
          : "fleet";
        fresh.push({
          uid: `msg:${m.id}`,
          kind: "message",
          text: `${fromName} → ${toName}: ${m.subject}`,
          ts: m.createdAt,
          ...KIND_META.message,
        });
      } else {
        break; // hit a seen id — everything past is also seen
      }
    }
    seenMsgIds.current = new Set(agentMessages.map((m) => m.id));

    // ─── Alerts (prependCapped — new alerts at head) ────────────────
    for (const a of alerts) {
      if (!seenAlertIds.current.has(a.id)) {
        fresh.push({
          uid: `alert:${a.id}`,
          kind: "alert",
          text: a.message,
          ts: a.createdAt,
          ...KIND_META.alert,
        });
      } else {
        break;
      }
    }
    seenAlertIds.current = new Set(alerts.map((a) => a.id));

    // ─── LLM calls (prependCapped — new calls at head) ──────────────
    for (const l of llmCalls) {
      if (!seenLlmIds.current.has(l.id)) {
        fresh.push({
          uid: `llm:${l.id}`,
          kind: "llm",
          text: `LLM ${l.provider}/${l.model} ${l.status}`,
          ts: l.createdAt,
          ...KIND_META.llm,
        });
      } else {
        break;
      }
    }
    seenLlmIds.current = new Set(llmCalls.map((l) => l.id));

    // ─── Approvals (upsert Record — detect NEW ids) ─────────────────
    for (const a of Object.values(approvals)) {
      if (!prevApprovals.current.has(a.id)) {
        fresh.push({
          uid: `approval:${a.id}`,
          kind: "approval",
          text: `Approval: ${a.title} [${a.risk}]`,
          ts: a.createdAt,
          ...KIND_META.approval,
        });
      }
    }
    prevApprovals.current = new Map(
      Object.values(approvals).map((a) => [a.id, a.title])
    );

    // ─── Tasks (upsert Record — detect status changes + new tasks) ──
    for (const t of Object.values(tasks)) {
      const prev = prevTaskStatus.current.get(t.id);
      if (prev === undefined || prev !== t.status) {
        fresh.push({
          uid: `task:${t.id}:${t.status}:${t.updatedAt}`,
          kind: "task",
          text: `Task ${t.title} → ${t.status}`,
          ts: t.updatedAt,
          ...KIND_META.task,
        });
      }
    }
    prevTaskStatus.current = new Map(
      Object.values(tasks).map((t) => [t.id, t.status])
    );

    if (fresh.length > 0) {
      // Newest first
      fresh.sort(
        (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()
      );
      setItems((prev) => {
        const merged = [...fresh, ...prev];
        const seen = new Set<string>();
        return merged
          .filter((it) => {
            if (seen.has(it.uid)) return false;
            seen.add(it.uid);
            return true;
          })
          .slice(0, MAX_ITEMS);
      });
    }
  }, [hydratedAt, agentMessages, approvals, alerts, llmCalls, tasks, agents]);

  // Reference `now` so the hook's re-render triggers relTime refresh.
  const nowIso = now?.toISOString() ?? "";

  return (
    <FullScreenPanel
      title="Live Agent Activity"
      icon={<Activity className="h-3.5 w-3.5 text-violet-400" />}
    >
      <div className="relative">
        {/* ─── Compact horizontal marquee (dashboard height ~64px) ─── */}
        <div className="ticker-compact group relative h-16 overflow-hidden border-b border-border/60 bg-surface-2/40">
          {items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="flex h-full items-center">
              <div className="mc-anim-marquee flex shrink-0 items-center gap-2 px-3 group-hover:[animation-play-state:paused]">
                {(items.length < 5
                  ? [...items, ...items, ...items]
                  : [...items, ...items]
                ).map((it, i) => (
                  <TickerPill key={`${it.uid}-${i}`} item={it} nowIso={nowIso} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ─── Fullscreen vertical list with timestamps ─── */}
        <div className="ticker-fullscreen flex-col gap-1.5 p-3">
          {items.length === 0 ? (
            <EmptyState fullscreen />
          ) : (
            items.map((it) => (
              <FullRow key={it.uid} item={it} nowIso={nowIso} />
            ))
          )}
        </div>
      </div>
    </FullScreenPanel>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────

function TickerPill({ item, nowIso }: { item: ActivityItem; nowIso: string }) {
  const Icon = item.icon;
  return (
    <div
      className={`flex shrink-0 items-center gap-1.5 rounded-md border ${item.border} ${item.bg} px-2 py-1`}
      title={`${item.text} · ${relTime(item.ts)}`}
    >
      <Icon className={`h-3 w-3 ${item.tone}`} />
      <span className="max-w-[280px] truncate font-mono text-[10px] text-foreground">
        {item.text}
      </span>
      <span className="font-mono text-[9px] text-muted-foreground/70">
        {relTime(item.ts)}
      </span>
      {/* Hidden ref to nowIso so the prop is "used" for re-render triggers */}
      <span className="sr-only" aria-hidden>{nowIso}</span>
    </div>
  );
}

function FullRow({ item, nowIso }: { item: ActivityItem; nowIso: string }) {
  const Icon = item.icon;
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex items-center gap-2.5 rounded-md border ${item.border} ${item.bg} px-3 py-2`}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${item.tone}`} />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
        {item.text}
      </span>
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        {relTime(item.ts)}
      </span>
      <span className="sr-only" aria-hidden>{nowIso}</span>
    </motion.div>
  );
}

function EmptyState({ fullscreen = false }: { fullscreen?: boolean }) {
  return (
    <div
      className={`flex h-full items-center justify-center gap-2 text-muted-foreground ${
        fullscreen ? "py-12" : ""
      }`}
    >
      <motion.span
        className="h-1.5 w-1.5 rounded-full bg-violet-400"
        initial={{ opacity: 0.4 }}
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      />
      <span className="font-mono text-[11px] tracking-wide">
        Awaiting agent activity…
      </span>
    </div>
  );
}

export default AgentActivityTicker;
