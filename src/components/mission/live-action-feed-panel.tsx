"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  Search,
  Mail,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Zap,
  Clock,
  Filter,
} from "lucide-react";

interface FeedEvent {
  id: string;
  ts: string;
  type: "lead" | "outreach" | "payment" | "build" | "system" | "alert";
  level: "info" | "success" | "warn" | "error";
  message: string;
  meta?: Record<string, unknown>;
}

const TYPE_ICONS: Record<FeedEvent["type"], React.ElementType> = {
  lead: Search,
  outreach: Mail,
  payment: CheckCircle2,
  build: Zap,
  system: Activity,
  alert: AlertTriangle,
};

const TYPE_COLORS: Record<FeedEvent["type"], string> = {
  lead: "text-cyan-300 border-cyan-500/30 bg-cyan-500/5",
  outreach: "text-violet-300 border-violet-500/30 bg-violet-500/5",
  payment: "text-emerald-300 border-emerald-500/30 bg-emerald-500/5",
  build: "text-amber-300 border-amber-500/30 bg-amber-500/5",
  system: "text-zinc-300 border-zinc-500/30 bg-zinc-500/5",
  alert: "text-rose-300 border-rose-500/30 bg-rose-500/5",
};

const LEVEL_COLORS: Record<FeedEvent["level"], string> = {
  info: "text-zinc-400",
  success: "text-emerald-400",
  warn: "text-amber-400",
  error: "text-rose-400",
};

export function LiveActionFeedPanel() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState<FeedEvent["type"] | "all">("all");
  const [paused, setPaused] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    const es = new EventSource("/api/events");
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => {
      setConnected(false);
      es.close();
      // Reconnect after 3s
      setTimeout(() => {
        if (!pausedRef.current) connect();
      }, 3000);
    };
    es.onmessage = (e) => {
      if (pausedRef.current) return;
      try {
        const envelope = JSON.parse(e.data);
        // Map SSE event types to feed event types
        const evt = mapSseToFeedEvent(envelope);
        if (evt) {
          setEvents((prev) => [evt, ...prev].slice(0, 200));
        }
      } catch {
        // ignore malformed
      }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [connect]);

  // Also poll the recent system alerts + notification log for events that happened
  // before the SSE connection opened (last 50 events from the last hour)
  useEffect(() => {
    void (async () => {
      try {
        const [alertsRes, notifRes] = await Promise.all([
          fetch("/api/alerts?limit=20", { cache: "no-store" }).catch(() => null),
          fetch("/api/notifications?limit=30", { cache: "no-store" }).catch(() => null),
        ]);
        const historical: FeedEvent[] = [];
        if (alertsRes?.ok) {
          const data = await alertsRes.json();
          for (const a of data.alerts || []) {
            historical.push({
              id: a.id,
              ts: a.createdAt,
              type: "alert",
              level: a.severity === "error" ? "error" : a.severity === "warn" ? "warn" : "info",
              message: a.message,
              meta: { source: a.source },
            });
          }
        }
        if (notifRes?.ok) {
          const data = await notifRes.json();
          for (const n of data.notifications || []) {
            const type: FeedEvent["type"] = n.metadata?.type === "outreach" || n.subject?.includes("Outreach")
              ? "outreach"
              : n.subject?.includes("UPI") || n.subject?.includes("payment") || n.subject?.includes("Crypto")
              ? "payment"
              : n.subject?.includes("build") || n.subject?.includes("deliver")
              ? "build"
              : "system";
            historical.push({
              id: n.id,
              ts: n.createdAt,
              type,
              level: n.status === "failed" ? "error" : n.status === "pending" ? "warn" : "info",
              message: n.subject,
              meta: { recipient: n.recipient, status: n.status },
            });
          }
        }
        historical.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
        setEvents((prev) => {
          const existingIds = new Set(prev.map((e) => e.id));
          const newOnes = historical.filter((e) => !existingIds.has(e.id));
          return [...prev, ...newOnes].slice(0, 200);
        });
      } catch {
        // silent
      }
    })();
  }, []);

  const filtered = filter === "all" ? events : events.filter((e) => e.type === filter);
  const counts = {
    all: events.length,
    lead: events.filter((e) => e.type === "lead").length,
    outreach: events.filter((e) => e.type === "outreach").length,
    payment: events.filter((e) => e.type === "payment").length,
    build: events.filter((e) => e.type === "build").length,
    system: events.filter((e) => e.type === "system").length,
    alert: events.filter((e) => e.type === "alert").length,
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-rose-400"}`} />
          <span className="text-xs font-mono text-zinc-400">
            {connected ? "LIVE" : "RECONNECTING"}
          </span>
          <span className="text-xs text-zinc-500">·</span>
          <span className="text-xs text-zinc-400">{events.length} events buffered</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPaused((p) => !p)}
            className={`px-2 py-1 text-xs rounded border transition-colors ${
              paused
                ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                : "border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:bg-zinc-700/50"
            }`}
          >
            {paused ? "▶ Resume" : "⏸ Pause"}
          </button>
          <button
            onClick={() => setEvents([])}
            className="px-2 py-1 text-xs rounded border border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:bg-zinc-700/50"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-1 flex-wrap">
        <Filter className="w-3 h-3 text-zinc-500" />
        {(["all", "lead", "outreach", "payment", "build", "system", "alert"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`px-2 py-1 text-xs rounded border transition-colors ${
              filter === t
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                : "border-zinc-700 bg-zinc-800/30 text-zinc-400 hover:bg-zinc-700/30"
            }`}
          >
            {t} <span className="opacity-50">({counts[t]})</span>
          </button>
        ))}
      </div>

      {/* Event list */}
      <div className="space-y-1 max-h-[600px] overflow-y-auto pr-1">
        <AnimatePresence initial={false}>
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-zinc-500 text-sm">
              <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No events yet. Waiting for autonomous actions…
            </div>
          ) : (
            filtered.map((evt) => {
              const Icon = TYPE_ICONS[evt.type];
              const time = new Date(evt.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
              return (
                <motion.div
                  key={evt.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className={`flex items-start gap-2 p-2 rounded border text-xs ${TYPE_COLORS[evt.type]}`}
                >
                  <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className={`font-mono ${LEVEL_COLORS[evt.level]}`}>{evt.message}</div>
                    {evt.meta && Object.keys(evt.meta).length > 0 && (
                      <div className="text-[10px] text-zinc-500 mt-0.5 font-mono truncate">
                        {Object.entries(evt.meta)
                          .slice(0, 3)
                          .map(([k, v]) => `${k}=${typeof v === "string" ? v.slice(0, 40) : JSON.stringify(v)}`)
                          .join(" · ")}
                      </div>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-500 font-mono flex-shrink-0 flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {time}
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * Map the various SSE event envelope shapes from event-bus.ts into a unified FeedEvent.
 * The SSE bus emits events with `type` field: "system" | "agent.status" | "log" | "metric" |
 * "llm" | "agent.message" | "cron.update" | "alert".
 */
function mapSseToFeedEvent(envelope: any): FeedEvent | null {
  if (!envelope || !envelope.type || !envelope.ts) return null;
  const ts = envelope.ts;
  const id = `${envelope.type}-${ts}-${Math.random().toString(36).slice(2, 8)}`;

  switch (envelope.type) {
    case "system":
      return {
        id,
        ts,
        type: classifySystemMessage(envelope.message || ""),
        level: envelope.level || "info",
        message: envelope.message || "(no message)",
      };
    case "alert":
      return {
        id,
        ts,
        type: "alert",
        level: envelope.alert?.severity === "error" ? "error" : "warn",
        message: envelope.alert?.message || "Alert raised",
        meta: { source: envelope.alert?.source, severity: envelope.alert?.severity },
      };
    case "log":
      return {
        id,
        ts,
        type: "system",
        level: envelope.log?.level || "info",
        message: envelope.log?.message || "(log)",
        meta: { agentId: envelope.log?.agentId },
      };
    case "cron.update":
      return {
        id,
        ts,
        type: "system",
        level: envelope.job?.status === "error" ? "error" : "info",
        message: `cron "${envelope.job?.name}" ${envelope.job?.lastResult || "executed"}`,
        meta: { job: envelope.job?.name, status: envelope.job?.status },
      };
    default:
      return null;
  }
}

function classifySystemMessage(msg: string): FeedEvent["type"] {
  const lower = msg.toLowerCase();
  if (lower.includes("lead") || lower.includes("discovered")) return "lead";
  if (lower.includes("outreach") || lower.includes("email") || lower.includes("sent")) return "outreach";
  if (lower.includes("payment") || lower.includes("crypto") || lower.includes("upi") || lower.includes("verified")) return "payment";
  if (lower.includes("build") || lower.includes("deliver") || lower.includes("quality")) return "build";
  if (lower.includes("alert") || lower.includes("error") || lower.includes("failed")) return "alert";
  return "system";
}
