"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import { LLM_PROVIDERS, type LlmCall, type LlmProvider } from "@/lib/types";
import { formatTime, compact } from "@/hooks/use-clock";
import {
  Terminal,
  ChevronDown,
  ArrowDownRight,
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
} from "lucide-react";

const PROVIDER_TONE: Record<LlmProvider, string> = {
  zai: "text-cyan-300 border-cyan-500/30 bg-cyan-500/5",
  ollama: "text-emerald-300 border-emerald-500/30 bg-emerald-500/5",
  openai: "text-amber-300 border-amber-500/30 bg-amber-500/5",
  anthropic: "text-violet-300 border-violet-500/30 bg-violet-500/5",
  gemini: "text-rose-300 border-rose-500/30 bg-rose-500/5",
  groq: "text-sky-300 border-sky-500/30 bg-sky-500/5",
  deepseek: "text-violet-300 border-violet-500/30 bg-violet-500/5",
};

const STATUS_TONE: Record<string, { tone: string; icon: typeof CheckCircle2; label: string }> = {
  ok: { tone: "text-emerald-300", icon: CheckCircle2, label: "OK" },
  rate_limited: { tone: "text-amber-300", icon: AlertTriangle, label: "RATE-LIMITED" },
  error: { tone: "text-rose-300", icon: AlertTriangle, label: "ERROR" },
  fallback: { tone: "text-violet-300", icon: ArrowDownRight, label: "FALLBACK" },
};

/**
 * LlmCallInspector — auditable gateway log with expandable rows.
 *
 * Each row summarizes a provider/model call (tokens in/out, latency,
 * status). Expanding reveals the full prompt, completion, and — when a
 * fallback occurred — the recovery chain. Bounded to the store's
 * llmCalls collection (≤80) so the list stays snappy.
 */
export function LlmCallInspector() {
  const llmCalls = useMissionStore((s) => s.llmCalls);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [providerFilter, setProviderFilter] = useState<LlmProvider | "all">("all");

  const list = useMemo_filtered(llmCalls, providerFilter);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // KPI rollup for the header.
  const stats = useMemo_stats(llmCalls);
  const activeProviders = LLM_PROVIDERS.filter((p) => llmCalls.some((c) => c.provider === p));

  return (
    <section className="mc-surface flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-violet-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            LLM Gateway Audit
          </h2>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Layers className="h-3 w-3" /> {stats.calls}
          </span>
          <span className="text-border">·</span>
          <span>{compact(stats.tokensIn + stats.tokensOut)} tok</span>
          <span className="text-border">·</span>
          <span className={stats.errors > 0 ? "text-rose-300" : "text-emerald-300"}>
            {stats.errors > 0 ? `${stats.errors} err` : "clean"}
          </span>
        </div>
      </div>

      {/* Provider filter chips */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border/40 px-3 py-2">
        <FilterChip active={providerFilter === "all"} onClick={() => setProviderFilter("all")}>
          all
        </FilterChip>
        {activeProviders.map((p) => (
          <FilterChip key={p} active={providerFilter === p} onClick={() => setProviderFilter(p)} tone={PROVIDER_TONE[p]}>
            {p}
          </FilterChip>
        ))}
      </div>

      <div className="mc-scroll max-h-[24rem] flex-1 overflow-y-auto p-2">
        {list.length === 0 ? (
          <div className="flex h-20 items-center justify-center font-mono text-xs text-muted-foreground">
            no LLM calls recorded yet
          </div>
        ) : (
          <ul className="space-y-1">
            <AnimatePresence initial={false}>
              {list.map((call) => (
                <LlmCallRow
                  key={call.id}
                  call={call}
                  expanded={expanded.has(call.id)}
                  onToggle={() => toggle(call.id)}
                />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </section>
  );
}

function LlmCallRow({
  call,
  expanded,
  onToggle,
}: {
  call: LlmCall;
  expanded: boolean;
  onToggle: () => void;
}) {
  const providerTone = PROVIDER_TONE[call.provider] ?? PROVIDER_TONE.zai;
  const status = STATUS_TONE[call.status] ?? STATUS_TONE.ok;
  const StatusIcon = status.icon;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden rounded-md border border-border/50 bg-card/50"
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left"
        aria-expanded={expanded}
      >
        <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${status.tone}`} />
        <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${providerTone}`}>
          {call.provider}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{call.model}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/80">{call.prompt}</span>
        <span className="flex shrink-0 items-center gap-2 font-mono text-[9px] text-muted-foreground">
          <span className="flex items-center gap-0.5">
            <ArrowDownRight className="h-2.5 w-2.5 text-cyan-300" />
            {compact(call.tokensIn)}
          </span>
          <span className="flex items-center gap-0.5">
            <ArrowUpRight className="h-2.5 w-2.5 text-emerald-300" />
            {compact(call.tokensOut)}
          </span>
          <span className="flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5 text-amber-300" />
            {call.latencyMs}ms
          </span>
          <span>{formatTime(call.createdAt)}</span>
        </span>
        <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.18 }}>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-border/40"
          >
            <div className="space-y-2 p-3">
              {/* Status + fallback banner */}
              <div className="flex flex-wrap items-center gap-2">
                <span className={`font-mono text-[10px] font-semibold uppercase ${status.tone}`}>
                  {status.label}
                </span>
                {call.fallback && (
                  <span className="flex items-center gap-1 rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[9px] text-violet-300">
                    <ArrowDownRight className="h-2.5 w-2.5" /> failover triggered
                  </span>
                )}
                {call.error && (
                  <span className="font-mono text-[10px] text-rose-300">⚠ {call.error}</span>
                )}
              </div>

              {/* Prompt */}
              <div>
                <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-cyan-300">
                  Prompt
                </div>
                <pre className="mc-scroll overflow-x-auto rounded-md border border-border/40 bg-background/60 p-2 font-mono text-[10px] text-foreground/80">
                  {call.prompt}
                </pre>
              </div>

              {/* Completion */}
              <div>
                <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-emerald-300">
                  Completion
                </div>
                <pre className="mc-scroll overflow-x-auto rounded-md border border-border/40 bg-background/60 p-2 font-mono text-[10px] text-foreground/80">
                  {call.completion ?? "— (no completion returned)"}
                </pre>
              </div>

              {/* Token economics */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MiniStat label="Tokens In" value={String(call.tokensIn)} tone="text-cyan-300" />
                <MiniStat label="Tokens Out" value={String(call.tokensOut)} tone="text-emerald-300" />
                <MiniStat label="Latency" value={`${call.latencyMs}ms`} tone="text-amber-300" />
                <MiniStat label="Total Tok" value={String(call.tokensIn + call.tokensOut)} tone="text-violet-300" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
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
      className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors ${
        active
          ? tone ?? "border-primary/50 bg-primary/10 text-primary"
          : "border-border/60 text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded border border-border/40 bg-background/40 px-2 py-1.5">
      <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

// ─── Memoized helpers (kept module-local to avoid re-renders) ───────

function useMemo_filtered(calls: LlmCall[], provider: LlmProvider | "all") {
  return useMemo(
    () => (provider === "all" ? calls : calls.filter((c) => c.provider === provider)),
    [calls, provider]
  );
}

function useMemo_stats(calls: LlmCall[]) {
  return useMemo(() => {
    let tokensIn = 0;
    let tokensOut = 0;
    let errors = 0;
    for (const c of calls) {
      tokensIn += c.tokensIn;
      tokensOut += c.tokensOut;
      if (c.status !== "ok") errors += 1;
    }
    return { calls: calls.length, tokensIn, tokensOut, errors };
  }, [calls]);
}
