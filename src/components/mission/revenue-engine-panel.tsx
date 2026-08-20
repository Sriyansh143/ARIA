"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Rocket,
  Search,
  CheckCircle2,
  ListTodo,
  PlayCircle,
  LineChart,
  Sparkles,
  Loader2,
  Play,
  ArrowRight,
} from "lucide-react";
import { relTime } from "@/hooks/use-clock";

interface PipelineStage {
  name: string;
  count: number;
  value: number;
}

interface PipelineData {
  stages: PipelineStage[];
}

interface CycleResult {
  found: number;
  qualified: number;
  planned: number;
  executed: number;
  tracked: number;
  optimized: number;
}

const STAGE_META: Record<
  string,
  { label: string; icon: typeof Search; tone: string }
> = {
  FIND: { label: "Find", icon: Search, tone: "text-cyan-300 border-cyan-500/30 bg-cyan-500/5" },
  QUALIFY: { label: "Qualify", icon: CheckCircle2, tone: "text-emerald-300 border-emerald-500/30 bg-emerald-500/5" },
  PLAN: { label: "Plan", icon: ListTodo, tone: "text-violet-300 border-violet-500/30 bg-violet-500/5" },
  EXECUTE: { label: "Execute", icon: PlayCircle, tone: "text-amber-300 border-amber-500/30 bg-amber-500/5" },
  TRACK: { label: "Track", icon: LineChart, tone: "text-sky-300 border-sky-500/30 bg-sky-500/5" },
  OPTIMIZE: { label: "Optimize", icon: Sparkles, tone: "text-rose-300 border-rose-500/30 bg-rose-500/5" },
};

const fmtMoney = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;

export function RevenueEnginePanel() {
  const [data, setData] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [lastCycle, setLastCycle] = useState<CycleResult | null>(null);

  const fetchPipeline = useCallback(async () => {
    try {
      const res = await fetch("/api/revenue-engine");
      if (!res.ok) throw new Error("fetch failed");
      const json = (await res.json()) as PipelineData;
      setData(json);
    } catch {
      setData({ stages: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPipeline();
  }, [fetchPipeline]);

  async function runCycle() {
    setRunning(true);
    try {
      const res = await fetch("/api/revenue-engine", { method: "POST" });
      if (!res.ok) throw new Error("cycle failed");
      const result = (await res.json()) as CycleResult;
      setLastCycle(result);
      toast.success("Revenue cycle complete", {
        description: `Found ${result.found} · Qualified ${result.qualified} · Executed ${result.executed}`,
      });
      await fetchPipeline();
    } catch {
      toast.error("Revenue cycle failed");
    } finally {
      setRunning(false);
    }
  }

  const stages = data?.stages ?? [];
  const totalFound = stages.reduce((s, st) => s + st.count, 0);

  return (
    <section className="mc-surface flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-rose-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Revenue Engine
          </h2>
        </div>
        <button
          onClick={() => void runCycle()}
          disabled={running}
          className="flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-rose-300 transition-colors hover:bg-rose-500/15 disabled:opacity-50"
        >
          {running ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Play className="h-2.5 w-2.5" />}
          {running ? "running…" : "run cycle"}
        </button>
      </div>

      <div className="mc-scroll max-h-96 flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-border/30" />
            ))}
          </div>
        ) : (
          <>
            {/* Pipeline as horizontal flow */}
            <div className="mb-3 flex items-center gap-1 overflow-x-auto pb-1">
              {stages.map((stage, idx) => {
                const meta = STAGE_META[stage.name] ?? STAGE_META.FIND;
                const Icon = meta.icon;
                return (
                  <div key={stage.name} className="flex items-center gap-1">
                    <motion.div
                      layout
                      className={`flex min-w-[88px] flex-col rounded-md border p-2 ${meta.tone}`}
                    >
                      <div className="flex items-center gap-1">
                        <Icon className="h-3 w-3" />
                        <span className="font-mono text-[9px] uppercase tracking-wider">
                          {meta.label}
                        </span>
                      </div>
                      <span className="mt-0.5 font-mono text-base font-bold tabular-nums text-foreground">
                        {stage.count}
                      </span>
                      {stage.value > 0 && (
                        <span className="font-mono text-[9px] text-muted-foreground">
                          {fmtMoney(stage.value)}
                        </span>
                      )}
                    </motion.div>
                    {idx < stages.length - 1 && (
                      <ArrowRight className="h-3 w-3 shrink-0 text-border" />
                    )}
                  </div>
                );
              })}
            </div>

            {lastCycle && (
              <div className="mb-3 rounded-md border border-border/50 bg-card/40 p-2.5">
                <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  Last cycle result
                </div>
                <div className="mt-1 grid grid-cols-3 gap-1.5 font-mono text-[10px]">
                  <div>Found: <span className="text-cyan-300">{lastCycle.found}</span></div>
                  <div>Qualified: <span className="text-emerald-300">{lastCycle.qualified}</span></div>
                  <div>Planned: <span className="text-violet-300">{lastCycle.planned}</span></div>
                  <div>Executed: <span className="text-amber-300">{lastCycle.executed}</span></div>
                  <div>Tracked: <span className="text-sky-300">{lastCycle.tracked}</span></div>
                  <div>Optimized: <span className="text-rose-300">{lastCycle.optimized}</span></div>
                </div>
              </div>
            )}

            <div className="px-1 font-mono text-[10px] text-muted-foreground">
              <span className="text-border">▸ </span>
              {totalFound} active items across the 6-stage pipeline.
              Each cycle re-scans discovered opportunities, scores them
              via Monte Carlo, and promotes qualified ones into tasks.
            </div>
          </>
        )}
      </div>
    </section>
  );
}
