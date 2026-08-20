"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import {
  MESSAGE_TYPE_META,
  MESSAGE_CHANNELS,
  type MessageChannel,
  type MessageType,
} from "@/lib/types";
import { formatTime, relTime } from "@/hooks/use-clock";
import { MessageSquare, Radio, ArrowRight, Filter } from "lucide-react";

const CHANNEL_TONE: Record<MessageChannel, string> = {
  task: "text-cyan-300",
  approval: "text-violet-300",
  alert: "text-rose-300",
  coordination: "text-amber-300",
  broadcast: "text-emerald-300",
};

const CHANNEL_BG: Record<MessageChannel, string> = {
  task: "bg-cyan-500/5 border-cyan-500/20",
  approval: "bg-violet-500/5 border-violet-500/20",
  alert: "bg-rose-500/5 border-rose-500/20",
  coordination: "bg-amber-500/5 border-amber-500/20",
  broadcast: "bg-emerald-500/5 border-emerald-500/20",
};

/**
 * AgentCommTimeline — inter-agent communication stream.
 *
 * Renders a vertical timeline of agent-to-agent messages: delegation,
 * requests, responses, escalations, and broadcasts. Each entry shows the
 * sender → receiver flow, message type, channel, subject, and timestamp.
 * A left rail with colored dots + connecting lines creates the timeline
 * visual; channel filter chips let operators isolate a specific channel.
 *
 * Data is derived from the store's `agentMessages` slice (bounded to 100),
 * populated by the simulation engine's tickMessages function.
 */
export function AgentCommTimeline() {
  const agentMessages = useMissionStore((s) => s.agentMessages);
  const agents = useMissionStore((s) => s.agents);
  const [filter, setFilter] = useFilterState();

  const filtered = useMemo(
    () => (filter === "all" ? agentMessages : agentMessages.filter((m) => m.channel === filter)),
    [agentMessages, filter]
  );

  const agentName = (id: string | null) => (id ? agents[id]?.name ?? "unknown" : "system");

  const channelCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const ch of MESSAGE_CHANNELS) c[ch] = 0;
    for (const m of agentMessages) c[m.channel] = (c[m.channel] ?? 0) + 1;
    return c;
  }, [agentMessages]);

  return (
    <section className="mc-surface flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-cyan-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Agent Communication
          </h2>
          <span className="font-mono text-[10px] text-muted-foreground">{agentMessages.length} msgs</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            all
          </FilterChip>
          {MESSAGE_CHANNELS.map((ch) => (
            <FilterChip
              key={ch}
              active={filter === ch}
              onClick={() => setFilter(ch)}
              tone={CHANNEL_TONE[ch]}
            >
              {ch} <span className="opacity-60">{channelCounts[ch] ?? 0}</span>
            </FilterChip>
          ))}
        </div>
      </div>

      <div className="mc-scroll max-h-[26rem] flex-1 overflow-y-auto p-3">
        {filtered.length === 0 ? (
          <div className="flex h-24 items-center justify-center font-mono text-xs text-muted-foreground">
            no messages in this view
          </div>
        ) : (
          <div className="relative">
            {/* Timeline rail */}
            <div className="absolute bottom-2 left-[7px] top-2 w-px bg-gradient-to-b from-cyan-500/30 via-border/40 to-transparent" />
            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {filtered.map((msg) => {
                  const typeMeta = MESSAGE_TYPE_META[msg.messageType as MessageType] ?? MESSAGE_TYPE_META.inform;
                  const chanTone = CHANNEL_TONE[msg.channel as MessageChannel] ?? CHANNEL_TONE.task;
                  const chanBg = CHANNEL_BG[msg.channel as MessageChannel] ?? CHANNEL_BG.task;
                  const fromName = agentName(msg.fromAgentId);
                  const toName = agentName(msg.toAgentId);
                  return (
                    <motion.li
                      key={msg.id}
                      layout
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      className="relative flex gap-3 pl-0"
                    >
                      {/* Timeline dot */}
                      <div className="relative z-10 mt-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                        <span className={`h-2 w-2 rounded-full ${chanTone.replace("text-", "bg-")}`} />
                        <span className={`absolute h-3 w-3 rounded-full ${chanTone.replace("text-", "bg-")} opacity-20`} />
                      </div>

                      {/* Message card */}
                      <div className={`min-w-0 flex-1 rounded-md border px-3 py-2 ${chanBg}`}>
                        <div className="flex items-center gap-2">
                          <span className={`font-mono text-[10px] font-semibold uppercase ${typeMeta.tone}`}>
                            {typeMeta.icon} {typeMeta.label}
                          </span>
                          <span className={`font-mono text-[9px] uppercase ${chanTone}`}>
                            {msg.channel}
                          </span>
                          <span className="ml-auto shrink-0 font-mono text-[9px] text-muted-foreground">
                            {formatTime(msg.createdAt)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px]">
                          <span className="truncate font-medium text-foreground">{fromName}</span>
                          <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="truncate font-medium text-foreground">{toName}</span>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-foreground/80">
                          {msg.subject}
                        </div>
                        {msg.body && (
                          <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                            {msg.body}
                          </p>
                        )}
                      </div>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

import { useState, useCallback } from "react";

function useFilterState(): [MessageChannel | "all", (f: MessageChannel | "all") => void] {
  const [filter, setFilter] = useState<MessageChannel | "all">("all");
  const set = useCallback((f: MessageChannel | "all") => setFilter(f), []);
  return [filter, set];
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

export { Radio, Filter };
