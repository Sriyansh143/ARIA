"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  FlaskConical,
  Loader2,
  Sparkles,
  Shield,
  Zap,
  Syringe,
  Atom,
} from "lucide-react";
import { relTime } from "@/hooks/use-clock";

type ArtifactType = "antibody" | "vaccine" | "catalyst";

interface Artifact {
  id: string;
  type: string;
  failureSignature: string;
  rootCause: string;
  remedy: string;
  sreActions: string;
  deployed: boolean;
  createdAt: string;
}

const TYPE_META: Record<
  ArtifactType,
  { tone: string; icon: typeof Shield; label: string }
> = {
  antibody: {
    tone: "text-violet-300 border-violet-500/30 bg-violet-500/5",
    icon: Shield,
    label: "Antibody",
  },
  vaccine: {
    tone: "text-cyan-300 border-cyan-500/30 bg-cyan-500/5",
    icon: Syringe,
    label: "Vaccine",
  },
  catalyst: {
    tone: "text-amber-300 border-amber-500/30 bg-amber-500/5",
    icon: Atom,
    label: "Catalyst",
  },
};

function getActions(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 4) : [];
  } catch {
    return [];
  }
}

export function FailureAlchemyPanel() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [synthesizing, setSynthesizing] = useState(false);

  const fetchArtifacts = useCallback(async () => {
    try {
      const res = await fetch("/api/failure-alchemy");
      if (!res.ok) throw new Error("fetch failed");
      const json = (await res.json()) as { artifacts: Artifact[] };
      setArtifacts(json.artifacts ?? []);
    } catch {
      setArtifacts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchArtifacts();
  }, [fetchArtifacts]);

  async function synthesize() {
    setSynthesizing(true);
    try {
      const res = await fetch("/api/failure-alchemy", { method: "POST" });
      if (!res.ok) throw new Error("synthesize failed");
      const result = (await res.json()) as { created: number };
      toast.success("Synthesis complete", {
        description: `${result.created} new artifacts distilled from recent errors`,
      });
      await fetchArtifacts();
    } catch {
      toast.error("Synthesis failed");
    } finally {
      setSynthesizing(false);
    }
  }

  return (
    <section className="mc-surface flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-violet-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Failure Alchemy
          </h2>
        </div>
        <button
          onClick={() => void synthesize()}
          disabled={synthesizing}
          className="flex items-center gap-1 rounded border border-violet-500/30 bg-violet-500/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-violet-300 transition-colors hover:bg-violet-500/15 disabled:opacity-50"
        >
          {synthesizing ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Sparkles className="h-2.5 w-2.5" />}
          {synthesizing ? "distilling…" : "synthesize"}
        </button>
      </div>

      <div className="mc-scroll max-h-96 flex-1 overflow-y-auto p-2.5">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded bg-border/30" />
            ))}
          </div>
        ) : artifacts.length === 0 ? (
          <div className="flex h-24 flex-col items-center justify-center gap-1 font-mono text-xs text-muted-foreground">
            <Zap className="h-4 w-4 text-muted-foreground/50" />
            <span>no artifacts yet</span>
            <span className="text-[10px]">click synthesize to distill recent errors</span>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {artifacts.map((a) => {
              const meta = TYPE_META[a.type as ArtifactType] ?? TYPE_META.antibody;
              const Icon = meta.icon;
              const actions = getActions(a.sreActions);
              return (
                <motion.li
                  key={a.id}
                  layout
                  className="rounded-md border border-border/50 bg-card/50 p-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Icon className={`h-3 w-3 shrink-0 ${meta.tone.split(" ")[0]}`} />
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${meta.tone}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                      {relTime(a.createdAt)}
                    </span>
                  </div>
                  <div className="mt-1.5 font-mono text-[10px]">
                    <div>
                      <span className="text-muted-foreground">signature: </span>
                      <span className="text-foreground">{a.failureSignature}</span>
                    </div>
                    <div className="mt-0.5">
                      <span className="text-muted-foreground">root cause: </span>
                      <span className="text-rose-300">{a.rootCause}</span>
                    </div>
                    <div className="mt-0.5">
                      <span className="text-muted-foreground">remedy: </span>
                      <span className="text-emerald-300">{a.remedy}</span>
                    </div>
                  </div>
                  {actions.length > 0 && (
                    <ul className="mt-1.5 border-l border-border/40 pl-2">
                      {actions.map((act, i) => (
                        <li key={i} className="font-mono text-[9px] text-muted-foreground">
                          ▸ {act}
                        </li>
                      ))}
                    </ul>
                  )}
                </motion.li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
