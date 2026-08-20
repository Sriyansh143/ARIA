"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import { formatTime } from "@/hooks/use-clock";
import {
  History,
  Cpu,
  ListTree,
  DollarSign,
  MessageSquare,
  Bell,
  ScrollText,
  Activity,
  Filter,
} from "lucide-react";

type EventCategory = "agent" | "task" | "revenue" | "message" | "alert" | "log" | "metric";

interface TimelineEntry {
  id: string;
  ts: string;
  category: EventCategory;
  title: string;
  subtitle: string;
  tone: string;
  dot: string;
}

const CATEGORY_META: Record<EventCategory, { icon: typeof Cpu; tone: string; dot: string; label: string }> = {
  agent: { icon: Cpu, tone: "text-cyan-300", dot: "bg-cyan-400", label: "Agent" },
  task: { icon: ListTree, tone: "text-amber-300", dot: "bg-amber-400", label: "Task" },
  revenue: { icon: DollarSign, tone: "text-emerald-300", dot: "bg-emerald-400", label: "Revenue" },
  message: { icon: MessageSquare, tone: "text-violet-300", dot: "bg-violet-400", label: "Message" },
  alert: { icon: Bell, tone: "text-rose-300", dot: "bg-rose-400", label: "Alert" },
  log: { icon: ScrollText, tone: "text-sky-300", dot: "bg-sky-400", label: "Log" },
  metric: { icon: Activity, tone: "text-slate-300", dot: "bg-slate-400", label: "Metric" },
};

/**
 * MissionTimeline — unified chronological event scrubber.
 *
 * Merges all event types (agent status changes, task updates, revenue
 * events, inter-agent messages, alerts, logs, metrics) into a single
 * reverse-chronological timeline. Filter chips let operators isolate
 * specific categories. This is the "master feed" — the single pane
 * that shows everything happening across the autonomous company in
 * the order it happened.
 */
export function MissionTimeline() {
  const agents = useMissionStore((s) => s.agents);
  const tasks = useMissionStore((s) => s.tasks);
  const revenueEvents = useMissionStore((s) => s.revenueEvents);
  const agentMessages = useMissionStore((s) => s.agentMessages);
  const alerts = useMissionStore((s) => s.alerts);
  const logs = useMissionStore((s) => s.logs);
  const [filter, setFilter] = useState<EventCategory | "all">("all");

  const allEntries = useMemo<TimelineEntry[]>(() => {
    const entries: TimelineEntry[] = [];

    // Agent status changes (use updatedAt as the event time).
    for (const a of Object.values(agents)) {
      entries.push({
        id: `agent-${a.id}`,
        ts: a.updatedAt,
        category: "agent",
        title: a.name,
        subtitle: `status → ${a.status} · ${a.currentTask ?? "idle"}`,
        tone: CATEGORY_META.agent.tone,
        dot: CATEGORY_META.agent.dot,
      });
    }

    // Task updates.
    for (const t of Object.values(tasks)) {
      entries.push({
        id: `task-${t.id}`,
        ts: t.updatedAt,
        category: "task",
        title: t.title,
        subtitle: `${t.status} · ${t.progress}% · ${t.assignedTo?.name ?? "unassigned"}`,
        tone: CATEGORY_META.task.tone,
        dot: CATEGORY_META.task.dot,
      });
    }

    // Revenue events.
    for (const r of revenueEvents) {
      entries.push({
        id: `rev-${r.id}`,
        ts: r.createdAt,
        category: "revenue",
        title: `+$${r.amount.toLocaleString()}`,
        subtitle: `${r.source} · ${r.description ?? ""}`,
        tone: CATEGORY_META.revenue.tone,
        dot: CATEGORY_META.revenue.dot,
      });
    }

    // Agent messages.
    for (const m of agentMessages) {
      const fromName = m.fromAgentId ? agents[m.fromAgentId]?.name ?? "?" : "?";
      const toName = m.toAgentId ? agents[m.toAgentId]?.name ?? "?" : "?";
      entries.push({
        id: `msg-${m.id}`,
        ts: m.createdAt,
        category: "message",
        title: m.subject,
        subtitle: `${fromName} → ${toName} · ${m.messageType}`,
        tone: CATEGORY_META.message.tone,
        dot: CATEGORY_META.message.dot,
      });
    }

    // Alerts.
    for (const a of alerts) {
      entries.push({
        id: `alert-${a.id}`,
        ts: a.createdAt,
        category: "alert",
        title: a.message,
        subtitle: `${a.severity} · ${a.source}${a.ack ? " · acked" : ""}`,
        tone: CATEGORY_META.alert.tone,
        dot: CATEGORY_META.alert.dot,
      });
    }

    // Logs (take recent subset to avoid flooding).
    for (const l of logs.slice(0, 40)) {
      entries.push({
        id: `log-${l.id}`,
        ts: l.createdAt,
        category: "log",
        title: l.message,
        subtitle: `${l.level}${l.agentId ? ` · ${l.agentId.slice(-6)}` : ""}`,
        tone: CATEGORY_META.log.tone,
        dot: CATEGORY_META.log.dot,
      });
    }

    // Sort reverse-chronological.
    entries.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    return entries;
  }, [agents, tasks, revenueEvents, agentMessages, alerts, logs]);

  const filtered = useMemo(
    () => (filter === "all" ? allEntries : allEntries.filter((e) => e.category === filter)),
    [allEntries, filter]
  );

  const categoryCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of allEntries) c[e.category] = (c[e.category] ?? 0) + 1;
    return c;
  }, [allEntries]);

  const categories = Object.keys(CATEGORY_META) as EventCategory[];

  return (
    <section className="mc-surface flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-cyan-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Mission Timeline
          </h2>
          <span className="font-mono text-[10px] text-muted-foreground">{allEntries.length} events</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            all <span className="opacity-60">{allEntries.length}</span>
          </FilterChip>
          {categories.map((cat) => {
            const meta = CATEGORY_META[cat];
            return (
              <FilterChip
                key={cat}
                active={filter === cat}
                onClick={() => setFilter(cat)}
                tone={meta.tone}
              >
                {meta.label} <span className="opacity-60">{categoryCounts[cat] ?? 0}</span>
              </FilterChip>
            );
          })}
        </div>
      </div>

      <div className="mc-scroll max-h-[30rem] flex-1 overflow-y-auto p-3">
        {filtered.length === 0 ? (
          <div className="flex h-20 items-center justify-center font-mono text-xs text-muted-foreground">
            no events in this view
          </div>
        ) : (
          <div className="relative">
            {/* Timeline rail */}
            <div className="absolute bottom-2 left-[7px] top-2 w-px bg-gradient-to-b from-cyan-500/30 via-border/40 to-transparent" />
            <ul className="space-y-1.5">
              <AnimatePresence initial={false}>
                {filtered.slice(0, 80).map((entry) => {
                  const meta = CATEGORY_META[entry.category];
                  const Icon = meta.icon;
                  return (
                    <motion.li
                      key={entry.id}
                      layout
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                      className="relative flex gap-3 pl-0"
                    >
                      <div className="relative z-10 mt-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                        <span className={`h-2 w-2 rounded-full ${entry.dot}`} />
                        <span className={`absolute h-3 w-3 rounded-full ${entry.dot} opacity-20`} />
                      </div>
                      <div className="min-w-0 flex-1 rounded-md border border-border/40 bg-card/40 px-3 py-1.5 hover:bg-card/60">
                        <div className="flex items-center gap-2">
                          <Icon className={`h-3 w-3 shrink-0 ${entry.tone}`} />
                          <span className="truncate font-mono text-[11px] font-medium text-foreground">
                            {entry.title}
                          </span>
                          <span className="ml-auto shrink-0 font-mono text-[9px] text-muted-foreground">
                            {formatTime(entry.ts)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 font-mono text-[9px] text-muted-foreground">
                          <span className={`uppercase ${entry.tone}`}>{meta.label}</span>
                          <span className="truncate">{entry.subtitle}</span>
                        </div>
                      </div>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border/60 px-4 py-2 font-mono text-[9px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Filter className="h-2.5 w-2.5" /> {filter === "all" ? "all categories" : filter}
        </span>
        <span>{filtered.length} of {allEntries.length}</span>
      </div>
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors ${
        active
          ? tone ?? "border-primary/50 bg-primary/10 text-primary"
          : "border-border/60 text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
