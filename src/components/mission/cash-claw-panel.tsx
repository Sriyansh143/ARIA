"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Dna, Loader2, Play, TrendingUp, TrendingDown, Skull } from "lucide-react";

type Tier = "thriving" | "surviving" | "dying" | "dead";

interface BoardEntry {
  agent: {
    id: string;
    name: string;
    role: string;
    department: string | null;
    tasksDone: number;
    errorCount: number;
    tokensUsed: number;
    status: string;
  };
  tier: Tier;
  score: number;
  reason: string;
}

interface SweepResult {
  classified: { id: string; name: string }[];
  dying: number;
  dead: number;
  recommendedRetire: string[];
}

const TIER_META: Record<
  Tier,
  { tone: string; dot: string; icon: typeof TrendingUp }
> = {
  thriving: { tone: "text-emerald-300 border-emerald-500/30 bg-emerald-500/5", dot: "bg-emerald-400", icon: TrendingUp },
  surviving: { tone: "text-cyan-300 border-cyan-500/30 bg-cyan-500/5", dot: "bg-cyan-400", icon: TrendingUp },
  dying: { tone: "text-amber-300 border-amber-500/30 bg-amber-500/5", dot: "bg-amber-400", icon: TrendingDown },
  dead: { tone: "text-rose-300 border-rose-500/30 bg-rose-500/5", dot: "bg-rose-400", icon: Skull },
};

export function CashClawPanel() {
  const [board, setBoard] = useState<BoardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sweeping, setSweeping] = useState(false);
  const [lastSweep, setLastSweep] = useState<SweepResult | null>(null);

  const fetchBoard = useCallback(async () => {
    try {
      const res = await fetch("/api/cash-claw");
      if (!res.ok) throw new Error("fetch failed");
      const json = (await res.json()) as { board: BoardEntry[] };
      setBoard(json.board ?? []);
    } catch {
      setBoard([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBoard();
  }, [fetchBoard]);

  async function runSweep() {
    setSweeping(true);
    try {
      const res = await fetch("/api/cash-claw", { method: "POST" });
      if (!res.ok) throw new Error("sweep failed");
      const result = (await res.json()) as SweepResult;
      setLastSweep(result);
      toast.success("Cash-claw sweep complete", {
        description: `${result.dying} dying · ${result.dead} dead · ${result.recommendedRetire.length} to retire`,
      });
      await fetchBoard();
    } catch {
      toast.error("Cash-claw sweep failed");
    } finally {
      setSweeping(false);
    }
  }

  const counts = board.reduce(
    (acc, b) => {
      acc[b.tier] = (acc[b.tier] ?? 0) + 1;
      return acc;
    },
    {} as Record<Tier, number>
  );

  return (
    <section className="mc-surface flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Dna className="h-4 w-4 text-violet-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Cash-Claw Survival Board
          </h2>
        </div>
        <button
          onClick={() => void runSweep()}
          disabled={sweeping}
          className="flex items-center gap-1 rounded border border-violet-500/30 bg-violet-500/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-violet-300 transition-colors hover:bg-violet-500/15 disabled:opacity-50"
        >
          {sweeping ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Play className="h-2.5 w-2.5" />}
          {sweeping ? "sweeping…" : "run sweep"}
        </button>
      </div>

      <div className="mc-scroll max-h-96 flex-1 overflow-y-auto p-2.5">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-border/30" />
            ))}
          </div>
        ) : board.length === 0 ? (
          <div className="flex h-20 items-center justify-center font-mono text-xs text-muted-foreground">
            no agents — run a sweep to classify the fleet
          </div>
        ) : (
          <ul className="space-y-1.5">
            {/* Tier summary chips */}
            <li className="mb-2 flex flex-wrap items-center gap-1.5">
              {(Object.keys(TIER_META) as Tier[]).map((tier) => (
                <span
                  key={tier}
                  className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${TIER_META[tier].tone}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${TIER_META[tier].dot}`} />
                  {tier} · {counts[tier] ?? 0}
                </span>
              ))}
            </li>

            {board.map((entry) => {
              const meta = TIER_META[entry.tier];
              const Icon = meta.icon;
              return (
                <motion.li
                  key={entry.agent.id}
                  layout
                  className="rounded-md border border-border/50 bg-card/50 p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon className={`h-3 w-3 shrink-0 ${meta.tone.split(" ")[0]}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-mono text-xs font-medium text-foreground">
                            {entry.agent.name}
                          </span>
                          <span className="font-mono text-[9px] text-muted-foreground">
                            {entry.agent.role}
                          </span>
                        </div>
                        <div className="font-mono text-[9px] text-muted-foreground">
                          {entry.agent.tasksDone} tasks · {entry.agent.errorCount} err · {(entry.agent.tokensUsed / 1000).toFixed(1)}k tok
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${meta.tone}`}>
                        {entry.tier}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-foreground">
                        {entry.score}
                      </span>
                    </div>
                  </div>
                  {entry.tier !== "thriving" && (
                    <p className="mt-1 line-clamp-2 font-mono text-[10px] text-muted-foreground">
                      {entry.reason}
                    </p>
                  )}
                </motion.li>
              );
            })}
          </ul>
        )}
      </div>

      {lastSweep && lastSweep.recommendedRetire.length > 0 && (
        <div className="border-t border-rose-500/20 bg-rose-500/5 px-3 py-2">
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-rose-300">
            <Skull className="h-3 w-3" />
            <span className="font-semibold uppercase tracking-wider">Retire:</span>
            <span className="truncate">
              {lastSweep.recommendedRetire.join(", ")}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
