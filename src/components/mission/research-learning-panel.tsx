"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Brain,
  Globe,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Database,
  Cpu,
  Video,
  MessageSquare,
  Link2,
  Inbox,
} from "lucide-react";
import { FullScreenPanel } from "./full-screen-panel";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useClock, relTime } from "@/hooks/use-clock";

/**
 * ResearchLearningPanel — the Hermes learning engine's command surface.
 *
 * Three sections in a responsive grid:
 *
 *  1. INGEST URL — submit a single URL for immediate insight extraction
 *     (POST /api/learning/ingest {url}). Shows the last 5 ingested
 *     knowledge memories fetched from /api/hermes/memory.
 *
 *  2. DAILY LEARNING — kick off the full daily learning pipeline
 *     (POST /api/learning/ingest {runDaily:true}) and display the
 *     returned stats (memories/skills created, URLs/videos/posts
 *     processed). "No learning run today" empty state.
 *
 *  3. EARNING OPPORTUNITIES — scrollable list of today's opportunities
 *     discovered by the earning researcher (GET /api/earning/research).
 *     "Run Research" button triggers a fresh scan
 *     (POST /api/earning/research {run:true}).
 *
 * All API calls are wrapped in try/catch with sonner toast feedback and
 * explicit loading + error states. No mock data — every number comes
 * from a real API response.
 *
 * Task ID: FEATURES-LEARN-NOTIFY-RT (Task 1).
 */

// ─── Types ───────────────────────────────────────────────────────────
interface KnowledgeMemory {
  id: string;
  key: string;
  scope: string;
  value: string;
  tags: string[];
  pinned: boolean;
  strength: number;
  agentId: string | null;
  createdAt: string;
}

interface GroupedInsight {
  title: string;
  insights: number;
  latestTs: string;
  sample: string;
}

interface Opportunity {
  id?: string;
  title: string;
  description?: string | null;
  source?: string;
  estimatedRevenue: number;
  timeToExecuteHours?: number;
  department: string;
  feasibilityScore: number;
  discoveredAt?: string;
}

interface DailyLearningStats {
  memoriesCreated: number;
  skillsCreated: number;
  urlsProcessed: number;
  videosProcessed: number;
  postsProcessed: number;
}

const EMPTY_STATS: DailyLearningStats = {
  memoriesCreated: 0,
  skillsCreated: 0,
  urlsProcessed: 0,
  videosProcessed: 0,
  postsProcessed: 0,
};

// ─── Component ───────────────────────────────────────────────────────
export function ResearchLearningPanel() {
  return (
    <FullScreenPanel title="Research & Learning" icon={<Brain className="h-3.5 w-3.5 text-violet-400" />}>
      <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
        <IngestUrlCard />
        <DailyLearningCard />
        <EarningOpportunitiesCard />
      </div>
    </FullScreenPanel>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 1. INGEST URL
// ═════════════════════════════════════════════════════════════════════
function IngestUrlCard() {
  const [url, setUrl] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [recent, setRecent] = useState<GroupedInsight[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [recentError, setRecentError] = useState<string | null>(null);
  // Re-render relative timestamps every second.
  useClock();

  const fetchRecent = useCallback(async () => {
    setLoadingRecent(true);
    setRecentError(null);
    try {
      const res = await fetch(
        "/api/hermes/memory?q=knowledge&scope=knowledge&limit=5",
        { cache: "no-store" },
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json().catch(() => ({}))) as {
        results?: KnowledgeMemory[];
        count?: number;
      };
      const items = Array.isArray(data.results) ? data.results : [];
      // Group by tags[0] (the source title) to compute insight counts.
      const groups = new Map<string, GroupedInsight>();
      for (const m of items) {
        const title = m.tags?.[0] ?? "untitled";
        const existing = groups.get(title);
        if (existing) {
          existing.insights += 1;
          if (new Date(m.createdAt).getTime() > new Date(existing.latestTs).getTime()) {
            existing.latestTs = m.createdAt;
            existing.sample = m.value.slice(0, 140);
          }
        } else {
          groups.set(title, {
            title,
            insights: 1,
            latestTs: m.createdAt,
            sample: m.value.slice(0, 140),
          });
        }
      }
      const sorted = [...groups.values()].sort(
        (a, b) => new Date(b.latestTs).getTime() - new Date(a.latestTs).getTime(),
      );
      setRecent(sorted.slice(0, 5));
    } catch (err) {
      setRecentError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    void fetchRecent();
  }, [fetchRecent]);

  const ingest = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      toast.error("Enter a URL to ingest");
      return;
    }
    // Basic URL validation — accept anything that parses after a protocol prepend.
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let isValid = false;
    try {
      // throws on invalid
      new URL(candidate);
      isValid = true;
    } catch {
      isValid = false;
    }
    if (!isValid) {
      toast.error("Invalid URL", { description: trimmed });
      return;
    }

    setIngesting(true);
    const tid = toast.loading("Ingesting URL…", { description: candidate });
    try {
      const res = await fetch("/api/learning/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: candidate }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` — ${txt.slice(0, 120)}` : ""}`);
      }
      const data = (await res.json().catch(() => ({}))) as {
        insights?: string[] | unknown;
        memoriesCreated?: number;
        skillsCreated?: number;
      };
      const insightCount = Array.isArray(data.insights)
        ? data.insights.length
        : data.memoriesCreated ?? 0;
      toast.success(`Ingested ${insightCount} insight${insightCount === 1 ? "" : "s"}`, {
        id: tid,
        description: `${candidate}${data.skillsCreated ? ` · ${data.skillsCreated} skill(s)` : ""}`,
      });
      setUrl("");
      // Refresh recent list so the new ingestion appears.
      void fetchRecent();
    } catch (err) {
      toast.error("Ingest failed", {
        id: tid,
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIngesting(false);
    }
  }, [url, fetchRecent]);

  return (
    <div className="mc-surface flex flex-col gap-2 rounded-lg border border-border/60 bg-surface-2/30 p-3">
      <SectionHeader icon={Globe} title="Ingest URL" tone="text-cyan-300" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ingest();
        }}
        className="flex gap-2"
      >
        <Input
          type="text"
          inputMode="url"
          placeholder="https://example.com/article"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={ingesting}
          className="h-8 font-mono text-[11px]"
        />
        <button
          type="submit"
          disabled={ingesting}
          className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/10 px-3 font-mono text-[11px] font-medium text-violet-200 transition-colors hover:bg-violet-500/20 disabled:opacity-50"
        >
          {ingesting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          Ingest
        </button>
      </form>

      <div className="mt-1 min-h-[5.5rem]">
        <div className="mb-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
          <span>Recent Ingestions</span>
          <button
            type="button"
            onClick={() => void fetchRecent()}
            className="text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Refresh recent ingestions"
          >
            <RefreshCw className={`h-3 w-3 ${loadingRecent ? "animate-spin" : ""}`} />
          </button>
        </div>
        {recentError ? (
          <div className="rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 font-mono text-[10px] text-rose-300">
            load failed: {recentError}
          </div>
        ) : recent.length === 0 ? (
          <EmptyHint icon={Inbox} label="No ingestions yet" />
        ) : (
          <div className="mc-scroll max-h-40 space-y-1 overflow-y-auto pr-1">
            {recent.map((r) => (
              <div
                key={r.title}
                className="rounded border border-border/40 bg-surface-2/40 px-2 py-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="line-clamp-1 text-[11px] font-medium text-foreground">
                    {r.title}
                  </span>
                  <Badge
                    variant="outline"
                    className="shrink-0 border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0 text-[9px] font-bold text-cyan-300"
                  >
                    {r.insights} insight{r.insights === 1 ? "" : "s"}
                  </Badge>
                </div>
                <div className="line-clamp-1 font-mono text-[10px] text-muted-foreground/70">
                  {r.sample}
                </div>
                <div className="mt-0.5 flex items-center gap-1 font-mono text-[9px] text-muted-foreground/60">
                  <Link2 className="h-2.5 w-2.5" />
                  {relTime(r.latestTs)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 2. DAILY LEARNING
// ═════════════════════════════════════════════════════════════════════
function DailyLearningCard() {
  const [stats, setStats] = useState<DailyLearningStats | null>(null);
  const [running, setRunning] = useState(false);
  const [ranToday, setRanToday] = useState(false);
  // useClock to keep "ran today" check fresh across day boundaries.
  useClock();

  const runDaily = useCallback(async () => {
    setRunning(true);
    const tid = toast.loading("Running daily learning pipeline…");
    try {
      const res = await fetch("/api/learning/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runDaily: true }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` — ${txt.slice(0, 120)}` : ""}`);
      }
      const data = (await res.json().catch(() => ({}))) as Partial<DailyLearningStats>;
      const next: DailyLearningStats = {
        memoriesCreated: data.memoriesCreated ?? 0,
        skillsCreated: data.skillsCreated ?? 0,
        urlsProcessed: data.urlsProcessed ?? 0,
        videosProcessed: data.videosProcessed ?? 0,
        postsProcessed: data.postsProcessed ?? 0,
      };
      setStats(next);
      setRanToday(true);
      const total = next.memoriesCreated + next.skillsCreated;
      toast.success(`Daily learning complete — ${total} item${total === 1 ? "" : "s"} created`, {
        id: tid,
        description: `${next.urlsProcessed} URL(s) · ${next.videosProcessed} video(s) · ${next.postsProcessed} post(s)`,
      });
    } catch (err) {
      toast.error("Daily learning failed", {
        id: tid,
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setRunning(false);
    }
  }, []);

  return (
    <div className="mc-surface flex flex-col gap-2 rounded-lg border border-border/60 bg-surface-2/30 p-3">
      <SectionHeader icon={TrendingUp} title="Daily Learning" tone="text-emerald-300" />
      <button
        type="button"
        onClick={() => void runDaily()}
        disabled={running}
        className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 font-mono text-[11px] font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
      >
        {running ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Play className="h-3 w-3" />
        )}
        Run Daily Learning
      </button>

      {stats ? (
        <div className="grid grid-cols-2 gap-1.5">
          <StatTile icon={Database} label="Memories" value={stats.memoriesCreated} tone="text-cyan-300" />
          <StatTile icon={Cpu} label="Skills" value={stats.skillsCreated} tone="text-violet-300" />
          <StatTile icon={Globe} label="URLs" value={stats.urlsProcessed} tone="text-emerald-300" />
          <StatTile icon={Video} label="Videos" value={stats.videosProcessed} tone="text-amber-300" />
          <StatTile icon={MessageSquare} label="Posts" value={stats.postsProcessed} tone="text-rose-300" />
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded border border-dashed border-border/40 bg-surface-2/20 px-2 py-6 text-center">
          <motion.div
            className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-500/10"
            initial={{ opacity: 0.5 }}
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          >
            <Sparkles className="h-3.5 w-3.5 text-violet-300" />
          </motion.div>
          <div className="text-[11px] font-medium text-muted-foreground">
            {ranToday ? "No insights extracted" : "No learning run today"}
          </div>
          <div className="font-mono text-[9px] text-muted-foreground/60">
            click "Run Daily Learning" to start
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Database;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded border border-border/40 bg-surface-2/40 px-2 py-1.5">
      <Icon className={`h-3.5 w-3.5 ${tone}`} />
      <div className="leading-none">
        <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
          {label}
        </div>
        <div className="text-sm font-bold tabular-nums text-foreground">{value}</div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 3. EARNING OPPORTUNITIES
// ═════════════════════════════════════════════════════════════════════
function EarningOpportunitiesCard() {
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const fetchOpps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/earning/research", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json().catch(() => ({}))) as {
        opportunities?: Opportunity[];
        count?: number;
      };
      setOpps(Array.isArray(data.opportunities) ? data.opportunities : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOpps();
  }, [fetchOpps]);

  const runResearch = useCallback(async () => {
    setRunning(true);
    const tid = toast.loading("Running earning research…");
    try {
      const res = await fetch("/api/earning/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run: true }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` — ${txt.slice(0, 120)}` : ""}`);
      }
      const data = (await res.json().catch(() => ({}))) as {
        discovered?: number;
        qualified?: number;
        insertedToPipeline?: number;
        opportunities?: Opportunity[];
      };
      const found = data.discovered ?? data.opportunities?.length ?? 0;
      toast.success(`Research complete — ${found} opportunit${found === 1 ? "y" : "ies"} discovered`, {
        id: tid,
        description: data.insertedToPipeline
          ? `${data.insertedToPipeline} added to pipeline`
          : undefined,
      });
      // Refresh the list.
      void fetchOpps();
    } catch (err) {
      toast.error("Research failed", {
        id: tid,
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setRunning(false);
    }
  }, [fetchOpps]);

  return (
    <div className="mc-surface flex flex-col gap-2 rounded-lg border border-border/60 bg-surface-2/30 p-3">
      <div className="flex items-center justify-between">
        <SectionHeader icon={TrendingUp} title="Earning Opportunities" tone="text-amber-300" inline />
        <button
          type="button"
          onClick={() => void runResearch()}
          disabled={running}
          className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 font-mono text-[10px] font-medium text-amber-200 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
        >
          {running ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Run Research
        </button>
      </div>

      <div className="mc-scroll max-h-64 space-y-1 overflow-y-auto pr-1">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 font-mono text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            loading opportunities…
          </div>
        ) : error ? (
          <div className="rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 font-mono text-[10px] text-rose-300">
            load failed: {error}
          </div>
        ) : opps.length === 0 ? (
          <EmptyHint icon={Inbox} label="No opportunities discovered yet" />
        ) : (
          opps.map((o, i) => {
            const feasible = o.feasibilityScore ?? 0;
            const feasTone =
              feasible >= 0.7
                ? "text-emerald-300"
                : feasible >= 0.4
                  ? "text-amber-300"
                  : "text-rose-300";
            const feasBar =
              feasible >= 0.7
                ? "bg-emerald-400"
                : feasible >= 0.4
                  ? "bg-amber-400"
                  : "bg-rose-400";
            return (
              <div
                key={o.id ?? `${o.title}-${i}`}
                className="rounded border border-border/40 bg-surface-2/40 px-2 py-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="line-clamp-2 text-[11px] font-medium text-foreground">
                    {o.title}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-emerald-300">
                    {formatCurrency(o.estimatedRevenue ?? 0)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                  <Badge
                    variant="outline"
                    className="border-border/40 bg-border/20 px-1.5 py-0 text-[9px] font-bold text-muted-foreground"
                  >
                    {o.department}
                  </Badge>
                  <div className="ml-auto flex items-center gap-1">
                    <span className={feasTone}>feasibility</span>
                    <div className="h-1 w-10 overflow-hidden rounded bg-border/40">
                      <div
                        className={`h-full ${feasBar}`}
                        style={{ width: `${Math.round(feasible * 100)}%` }}
                      />
                    </div>
                    <span className={`tabular-nums ${feasTone}`}>
                      {(feasible * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────
function SectionHeader({
  icon: Icon,
  title,
  tone,
  inline,
}: {
  icon: typeof Brain;
  title: string;
  tone: string;
  inline?: boolean;
}) {
  return (
    <div className={`flex items-center gap-1.5 ${inline ? "" : ""}`}>
      <Icon className={`h-3.5 w-3.5 ${tone}`} />
      <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
        {title}
      </h3>
    </div>
  );
}

function EmptyHint({ icon: Icon, label }: { icon: typeof Inbox; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-6 text-center">
      <Icon className="h-5 w-5 text-muted-foreground/40" />
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
    </div>
  );
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export default ResearchLearningPanel;
