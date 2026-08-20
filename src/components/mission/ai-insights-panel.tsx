"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Lightbulb,
  RefreshCw,
  Loader2,
  Sparkles,
  Inbox,
  ExternalLink,
  Zap,
  Repeat,
  type LucideIcon,
} from "lucide-react";
import { FullScreenPanel } from "./full-screen-panel";
import { Badge } from "@/components/ui/badge";

// ─── Types ───────────────────────────────────────────────────────────
type Priority = "high" | "medium" | "low";
type Category = "revenue" | "operations" | "security" | "agents" | "growth";

interface Insight {
  priority: Priority;
  category: Category;
  title: string;
  description: string;
  action: string;
}

interface InsightsResponse {
  insights: Insight[];
  generatedAt: string;
  source: "llm" | "fallback";
  error?: string;
}

// ─── Style maps ──────────────────────────────────────────────────────
const PRIORITY_TONE: Record<Priority, string> = {
  high: "text-rose-300 border-rose-500/30 bg-rose-500/10",
  medium: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  low: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
};

const CATEGORY_TONE: Record<Category, string> = {
  revenue: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  operations: "text-cyan-300 border-cyan-500/30 bg-cyan-500/10",
  security: "text-rose-300 border-rose-500/30 bg-rose-500/10",
  agents: "text-violet-300 border-violet-500/30 bg-violet-500/10",
  growth: "text-amber-300 border-amber-500/30 bg-amber-500/10",
};

const CATEGORY_ICON: Record<Category, LucideIcon> = {
  revenue: Zap,
  operations: Lightbulb,
  security: Sparkles,
  agents: Lightbulb,
  growth: Sparkles,
};

// ─── Helpers ────────────────────────────────────────────────────────
function isUrlAction(action: string): boolean {
  return action.startsWith("/") || action.startsWith("http");
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

// ─── Component ───────────────────────────────────────────────────────
export function AiInsightsPanel() {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchInsights = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading((p) => p || !data);
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/insights", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json().catch(() => ({}))) as InsightsResponse;
      if (json.error) {
        setError(json.error);
      }
      setData(json);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load insights";
      setError(msg);
      if (!opts?.silent) {
        toast.error("Failed to load insights", { description: msg });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [data]);

  useEffect(() => {
    void fetchInsights();
  }, []);

  // Auto-refresh every 60s when enabled.
  useEffect(() => {
    if (!autoRefresh) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    timerRef.current = setInterval(() => {
      void fetchInsights({ silent: true });
    }, 60_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [autoRefresh, fetchInsights]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetch("/api/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json().catch(() => ({}))) as InsightsResponse;
        setData(json);
        if (json.error) {
          toast.warning("Insights generated with warnings", { description: json.error });
        } else {
          toast.success("Insights regenerated", {
            description:
              json.source === "llm"
                ? `${json.insights.length} AI recommendations`
                : `${json.insights.length} rule-based recommendations`,
          });
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Refresh failed";
        toast.error("Refresh failed", { description: msg });
      })
      .finally(() => setRefreshing(false));
  }, []);

  const handleApply = useCallback((insight: Insight) => {
    if (isUrlAction(insight.action)) {
      toast.success("Opening action", { description: insight.action });
      // Open the in-app URL in a new tab (most are relative paths).
      try {
        window.open(insight.action, "_blank", "noopener,noreferrer");
      } catch {
        /* popup blocked — ignore */
      }
    } else {
      toast.info("Action noted", { description: insight.action });
    }
  }, []);

  const insights = data?.insights ?? [];
  const source = data?.source;

  const stats = useMemo(() => {
    const high = insights.filter((i) => i.priority === "high").length;
    const medium = insights.filter((i) => i.priority === "medium").length;
    const low = insights.filter((i) => i.priority === "low").length;
    return { high, medium, low, total: insights.length };
  }, [insights]);

  return (
    <FullScreenPanel
      title="AI Insights & Recommendations"
      icon={<Lightbulb className="h-3.5 w-3.5 text-amber-300" />}
      actions={
        <>
          <button
            type="button"
            onClick={() => setAutoRefresh((p) => !p)}
            aria-pressed={autoRefresh}
            title={autoRefresh ? "Auto-refresh every 60s (on)" : "Auto-refresh off"}
            className={`flex h-7 items-center gap-1 rounded-md border px-2 font-mono text-[10px] font-medium transition-colors ${
              autoRefresh
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : "border-border/60 bg-surface-2/60 text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
          >
            <Repeat className="h-3 w-3" />
            {autoRefresh ? "Auto" : "Manual"}
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Refresh insights"
            title="Regenerate insights"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </>
      }
    >
      <div className="space-y-3 p-3">
        {/* Header strip: source + stats */}
        <div className="mc-surface flex flex-col gap-2 rounded-lg border border-border/60 bg-surface-2/30 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            {source === "llm" ? (
              <Badge
                variant="outline"
                className="gap-1 border-violet-500/40 bg-violet-500/10 px-2 py-0.5 font-mono text-[9px] font-bold text-violet-200"
              >
                <Sparkles className="h-2.5 w-2.5" />
                AI-GENERATED
              </Badge>
            ) : source === "fallback" ? (
              <Badge
                variant="outline"
                className="gap-1 border-border/60 bg-surface-2/60 px-2 py-0.5 font-mono text-[9px] font-bold text-muted-foreground"
              >
                <Lightbulb className="h-2.5 w-2.5" />
                RULE-BASED FALLBACK
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="gap-1 border-border/60 bg-surface-2/60 px-2 py-0.5 font-mono text-[9px] text-muted-foreground"
              >
                —
              </Badge>
            )}
            {data?.generatedAt && (
              <span className="font-mono text-[9px] text-muted-foreground/70">
                updated {relativeTime(data.generatedAt)}
              </span>
            )}
          </div>
          {stats.total > 0 && (
            <div className="flex items-center gap-2 font-mono text-[9px]">
              <span className="flex items-center gap-1 text-rose-300">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                {stats.high} high
              </span>
              <span className="flex items-center gap-1 text-amber-300">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                {stats.medium} med
              </span>
              <span className="flex items-center gap-1 text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {stats.low} low
              </span>
            </div>
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div className="rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 font-mono text-[10px] text-rose-300">
            load failed: {error}
          </div>
        )}

        {/* Body */}
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0.4 }}
                animate={{ opacity: [0.4, 0.8, 0.4] }}
                transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.15 }}
                className="flex items-center gap-2 rounded-md border border-border/60 bg-surface-2/30 p-3"
              >
                <div className="h-7 w-16 animate-pulse rounded bg-border/30" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-1/3 animate-pulse rounded bg-border/30" />
                  <div className="h-2 w-full animate-pulse rounded bg-border/20" />
                </div>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/40" />
              </motion.div>
            ))}
          </div>
        ) : insights.length === 0 ? (
          <EmptyState
            icon={Inbox}
            label="No insights available"
            hint="Run the autonomous engine to generate data, then refresh."
          />
        ) : (
          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {insights.map((insight, idx) => (
                <InsightCard
                  key={`${insight.title.slice(0, 24)}-${idx}`}
                  insight={insight}
                  onApply={() => handleApply(insight)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </FullScreenPanel>
  );
}

// ─── Insight Card ───────────────────────────────────────────────────
function InsightCard({
  insight,
  onApply,
}: {
  insight: Insight;
  onApply: () => void;
}) {
  const CatIcon = CATEGORY_ICON[insight.category] ?? Lightbulb;
  const isUrl = isUrlAction(insight.action);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="mc-surface flex flex-col gap-2 rounded-md border border-border/60 bg-background/40 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={`shrink-0 px-1.5 py-0 font-mono text-[9px] font-bold uppercase ${PRIORITY_TONE[insight.priority]}`}
        >
          {insight.priority}
        </Badge>
        <Badge
          variant="outline"
          className={`shrink-0 gap-1 px-1.5 py-0 font-mono text-[9px] font-bold uppercase ${CATEGORY_TONE[insight.category]}`}
        >
          <CatIcon className="h-2.5 w-2.5" />
          {insight.category}
        </Badge>
        <div className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">
          {insight.title}
        </div>
        <button
          type="button"
          onClick={onApply}
          className="flex h-7 shrink-0 items-center gap-1 rounded border border-violet-500/40 bg-violet-500/10 px-2 font-mono text-[10px] font-medium text-violet-200 transition-colors hover:bg-violet-500/20"
        >
          {isUrl ? <ExternalLink className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
          Apply
        </button>
      </div>
      {insight.description && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {insight.description}
        </p>
      )}
      {insight.action && (
        <div className="font-mono text-[9px] text-muted-foreground/60">
          <span className="text-muted-foreground/40">→</span> {insight.action}
        </div>
      )}
    </motion.div>
  );
}

// ─── Empty State ────────────────────────────────────────────────────
function EmptyState({
  icon: Icon,
  label,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
      <Icon className="h-6 w-6 text-muted-foreground/40" />
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      {hint && (
        <div className="max-w-sm px-4 font-mono text-[9px] text-muted-foreground/60">
          {hint}
        </div>
      )}
    </div>
  );
}

export default AiInsightsPanel;
