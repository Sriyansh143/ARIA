"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import { LOG_LEVELS, type AgentLog, type LogLevel } from "@/lib/types";
import { formatTime } from "@/hooks/use-clock";
import { ScrollText, Pause, Play, ChevronDown } from "lucide-react";

const LEVEL_TONE: Record<LogLevel, string> = {
  debug: "text-slate-500",
  info: "text-sky-300",
  warn: "text-amber-300",
  error: "text-rose-300",
  success: "text-emerald-300",
};

const LEVEL_BG: Record<LogLevel, string> = {
  debug: "bg-slate-500/10",
  info: "bg-sky-500/10",
  warn: "bg-amber-500/10",
  error: "bg-rose-500/10",
  success: "bg-emerald-500/10",
};

const ROW_HEIGHT = 30; // px — must match rendered row height for windowing math
const OVERSCAN = 8;

/**
 * LiveLogStream — virtualized, self-scrolling agent log terminal.
 *
 * Memory-safe: only renders the visible window (~container/ROW_HEIGHT rows
 * + overscan) regardless of how many thousands of logs the store holds.
 * Auto-scrolls to top (newest) unless the operator pauses or scrolls up
 * to inspect history — classic "tail -f" ergonomics.
 */
export function LiveLogStream() {
  const logs = useMissionStore((s) => s.logs);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<LogLevel | "all">("all");
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(360);

  const filtered = useMemo(
    () => (filter === "all" ? logs : logs.filter((l) => l.level === filter)),
    [logs, filter]
  );

  // Track viewport height for windowing.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setViewportH(e.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-scroll to top when new logs arrive (unless paused).
  useEffect(() => {
    if (paused) return;
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, [filtered, paused]);

  const total = filtered.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewportH / ROW_HEIGHT) + OVERSCAN * 2;
  const end = Math.min(total, start + visibleCount);
  const window = filtered.slice(start, end);

  const levelCounts = useMemo(() => {
    const c: Record<string, number> = { debug: 0, info: 0, warn: 0, error: 0, success: 0 };
    for (const l of logs) c[l.level] = (c[l.level] ?? 0) + 1;
    return c;
  }, [logs]);

  return (
    <section className="mc-surface flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-emerald-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Live Log Stream
          </h2>
          <span className="font-mono text-[10px] text-muted-foreground">{total} lines</span>
        </div>
        <div className="flex items-center gap-1">
          {(["all", ...LOG_LEVELS] as const).map((lv) => (
            <button
              key={lv}
              onClick={() => setFilter(lv)}
              className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors ${
                filter === lv
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:text-foreground"
              }`}
            >
              {lv}
              {lv !== "all" && (
                <span className="opacity-60">{levelCounts[lv] ?? 0}</span>
              )}
            </button>
          ))}
          <button
            onClick={() => setPaused((p) => !p)}
            className={`ml-1 flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors ${
              paused
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            }`}
            title={paused ? "Resume auto-scroll" : "Pause auto-scroll"}
          >
            {paused ? <Play className="h-2.5 w-2.5" /> : <Pause className="h-2.5 w-2.5" />}
            {paused ? "paused" : "live"}
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="mc-scroll relative max-h-[26rem] min-h-[260px] flex-1 overflow-y-auto bg-background/60 font-mono text-[11px]"
      >
        {/* Spacer to give the windowed rows correct scroll height. */}
        <div style={{ height: total * ROW_HEIGHT }} className="relative">
          <div style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
            <AnimatePresence initial={false}>
              {window.map((log) => (
                <LogRow key={log.id} log={log} />
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* Scroll-to-top hint when paused & scrolled down */}
        {paused && scrollTop > 200 && (
          <button
            onClick={() => {
              if (containerRef.current) containerRef.current.scrollTop = 0;
            }}
            className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card/90 px-2.5 py-1 font-mono text-[10px] text-foreground shadow-lg backdrop-blur"
          >
            <ChevronDown className="h-3 w-3 rotate-180" /> jump to latest
          </button>
        )}
      </div>
    </section>
  );
}

function LogRow({ log }: { log: AgentLog }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, backgroundColor: "rgba(34,211,238,0.10)" }}
      animate={{ opacity: 1, backgroundColor: "rgba(0,0,0,0)" }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      style={{ height: ROW_HEIGHT }}
      className="flex items-center gap-2 border-b border-border/20 px-3 hover:bg-card/40"
    >
      <span className="shrink-0 text-muted-foreground/70 tabular-nums">{formatTime(log.createdAt)}</span>
      <span className={`shrink-0 rounded px-1 text-[9px] font-semibold uppercase ${LEVEL_TONE[log.level]} ${LEVEL_BG[log.level]}`}>
        {log.level}
      </span>
      {log.agentId && (
        <span className="shrink-0 text-cyan-300/80">[{log.agentId.slice(-6)}]</span>
      )}
      <span className="truncate text-foreground/90">{log.message}</span>
    </motion.div>
  );
}
