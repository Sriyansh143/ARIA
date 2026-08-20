"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Radio,
  Activity,
  AlertTriangle,
  Shield,
  DollarSign,
  Zap,
  GraduationCap,
  Send,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { toast } from "sonner";
import { CollapsibleList, CollapsibleItem, EmptyState } from "@/components/mission/collapsible-list";

interface BlackboxEntry {
  id: string;
  type: string;
  source: string;
  message: string;
  data: Record<string, unknown>;
  severity: string;
  timestamp: number;
}

interface BlackboxStats {
  bufferSize: number;
  capacity: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
}

const TYPE_ICONS: Record<string, typeof Activity> = {
  decision: Activity,
  "token-spend": DollarSign,
  outbound: Zap,
  error: AlertTriangle,
  "autonomous-action": Zap,
  approval: Shield,
  system: Radio,
  security: Shield,
};

const SEVERITY_COLORS: Record<string, string> = {
  info: "text-cyan-400",
  warn: "text-amber-400",
  error: "text-rose-400",
  critical: "text-rose-500",
};

/**
 * BlackboxTrainingPanel — combined Blackbox + Agent Training UI.
 *
 * Two sections:
 *   1. Blackbox Flight Recorder — recent decisions, errors, token spend
 *   2. Agent Training — teach an agent from a source, view training history
 *
 * Includes feedback injection (thumbs up/down) for reinforcement learning.
 */
export function BlackboxTrainingPanel() {
  const [entries, setEntries] = useState<BlackboxEntry[]>([]);
  const [stats, setStats] = useState<BlackboxStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>("all");

  // Training form state
  const [agentId, setAgentId] = useState("");
  const [source, setSource] = useState("");
  const [instructions, setInstructions] = useState("");
  const [teaching, setTeaching] = useState(false);
  const [lastResult, setLastResult] = useState<{ summary: string; skills: string[]; confidence: number } | null>(null);

  // Inject training state (v33 — "Inject Training" button per blackbox entry)
  const [injectEntryId, setInjectEntryId] = useState<string | null>(null);
  const [injectNote, setInjectNote] = useState("");
  const [injectCreateSkill, setInjectCreateSkill] = useState(true);
  const [injecting, setInjecting] = useState(false);

  const fetchBlackbox = useCallback(async () => {
    try {
      const params = filterType !== "all" ? `?type=${filterType}&limit=50` : "?limit=50";
      const res = await fetch(`/api/blackbox${params}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
        setStats(data.stats || null);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [filterType]);

  useEffect(() => {
    void fetchBlackbox();
    const interval = setInterval(() => void fetchBlackbox(), 5000);
    return () => clearInterval(interval);
  }, [fetchBlackbox]);

  const handleTeach = useCallback(async () => {
    if (!agentId.trim() || !source.trim()) {
      toast.error("Agent ID and source are required");
      return;
    }
    setTeaching(true);
    setLastResult(null);
    try {
      const res = await fetch("/api/training/teach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, source, instructions }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`Trained ${data.agentName}: ${data.skills.length} skills identified`);
        setLastResult({
          summary: data.summary,
          skills: data.skills,
          confidence: data.confidence,
        });
      } else {
        toast.error(`Training failed: ${data.error || "unknown"}`);
      }
    } catch {
      toast.error("Network error during training");
    } finally {
      setTeaching(false);
    }
  }, [agentId, source, instructions]);

  const handleFeedback = useCallback(async (entryId: string, feedback: "positive" | "negative") => {
    try {
      const res = await fetch("/api/training/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, feedback }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok) {
          toast.success(`Feedback recorded: ${feedback}`);
        }
      }
    } catch {
      // silent
    }
  }, []);

  // v33: Inject training — stores feedback as MemoryItem + optionally
  // creates a Skill via the Hermes engine (createSkillFromExecution).
  const handleInject = useCallback(async (entryId: string, feedback: "positive" | "negative") => {
    if (!injectNote.trim()) {
      toast.error("Please enter feedback text before injecting");
      return;
    }
    setInjecting(true);
    try {
      const res = await fetch("/api/training/inject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId,
          feedback,
          note: injectNote.trim(),
          createSkill: injectCreateSkill,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(
          `Training injected! Memory stored${data.skillCreated ? " + skill created" : ""}`,
        );
        setInjectEntryId(null);
        setInjectNote("");
        void fetchBlackbox(); // refresh to show the feedback in the entry
      } else {
        toast.error(`Injection failed: ${data.error || "unknown"}`);
      }
    } catch {
      toast.error("Network error during injection");
    } finally {
      setInjecting(false);
    }
  }, [injectNote, injectCreateSkill, fetchBlackbox]);

  return (
    <div className="space-y-3">
      {/* Stats overview */}
      {stats && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard label="Buffer" value={`${stats.bufferSize}/${stats.capacity}`} icon={Radio} color="text-violet-400" />
          {Object.entries(stats.byType).slice(0, 3).map(([type, count]) => {
            const Icon = TYPE_ICONS[type] || Activity;
            return (
              <StatCard key={type} label={type} value={String(count)} icon={Icon} color="text-cyan-400" />
            );
          })}
        </div>
      )}

      {/* Blackbox entries */}
      <CollapsibleList
        title="Blackbox Flight Recorder"
        icon={<Radio className="h-4 w-4 text-violet-400" />}
        count={entries.length}
        badge={stats ? `${stats.bySeverity.error || 0} errors` : undefined}
        badgeColor={stats && (stats.bySeverity.error || 0) > 0 ? "text-rose-400" : "text-emerald-400"}
        maxHeight="20rem"
        actions={
          <button
            onClick={() => void fetchBlackbox()}
            className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        }
      >
        {/* Filter */}
        <div className="mb-2 flex items-center gap-2">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded border border-border bg-surface-2 px-2 py-1 text-[11px] text-foreground"
          >
            <option value="all">All Types</option>
            <option value="decision">Decisions</option>
            <option value="token-spend">Token Spend</option>
            <option value="error">Errors</option>
            <option value="approval">Approvals</option>
            <option value="security">Security</option>
          </select>
        </div>

        {loading ? (
          <EmptyState message="Loading…" />
        ) : entries.length === 0 ? (
          <EmptyState message="No events recorded yet" />
        ) : (
          <div className="space-y-1.5">
            {entries.slice(0, 20).map((entry) => {
              const Icon = TYPE_ICONS[entry.type] || Activity;
              const isInjectingThis = injectEntryId === entry.id;
              return (
                <CollapsibleItem key={entry.id}>
                  <div className="flex items-start gap-2">
                    <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${SEVERITY_COLORS[entry.severity] || "text-muted-foreground"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </span>
                        <span className="rounded border border-border px-1 py-0.5 text-[9px] uppercase text-muted-foreground">
                          {entry.type}
                        </span>
                        <span className={`text-[9px] uppercase font-medium ${SEVERITY_COLORS[entry.severity] || "text-muted-foreground"}`}>
                          {entry.severity}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-foreground">{entry.message}</p>
                      <div className="mt-0.5 font-mono text-[9px] text-muted-foreground">{entry.source}</div>

                      {/* v33: Inject Training form — expands when the user clicks "Inject" */}
                      {isInjectingThis && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          className="mt-2 space-y-2 rounded border border-violet-500/30 bg-violet-500/5 p-2"
                        >
                          <textarea
                            value={injectNote}
                            onChange={(e) => setInjectNote(e.target.value)}
                            placeholder="Enter human feedback for this decision… e.g., 'Should have asked for approval before spending >$1000. Always check the budget first.'"
                            rows={3}
                            className="mc-scroll w-full resize-none rounded border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground"
                          />
                          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={injectCreateSkill}
                              onChange={(e) => setInjectCreateSkill(e.target.checked)}
                              className="h-3 w-3"
                            />
                            Create reusable Skill from this feedback (positive only)
                          </label>
                          <div className="flex gap-2">
                            <button
                              onClick={() => void handleInject(entry.id, "positive")}
                              disabled={injecting}
                              className="flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                            >
                              {injecting ? <RefreshCw className="h-3 w-3 animate-spin" /> : <ThumbsUp className="h-3 w-3" />}
                              Inject Positive
                            </button>
                            <button
                              onClick={() => void handleInject(entry.id, "negative")}
                              disabled={injecting}
                              className="flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[10px] uppercase tracking-wider text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                            >
                              {injecting ? <RefreshCw className="h-3 w-3 animate-spin" /> : <ThumbsDown className="h-3 w-3" />}
                              Inject Negative
                            </button>
                            <button
                              onClick={() => { setInjectEntryId(null); setInjectNote(""); }}
                              className="ml-auto rounded px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                            >
                              Cancel
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </div>
                    {/* Feedback buttons */}
                    <div className="flex shrink-0 gap-0.5">
                      <button
                        onClick={() => handleFeedback(entry.id, "positive")}
                        className="rounded p-1 text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-400"
                        title="Mark as good decision"
                      >
                        <ThumbsUp className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => handleFeedback(entry.id, "negative")}
                        className="rounded p-1 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400"
                        title="Mark as bad decision"
                      >
                        <ThumbsDown className="h-3 w-3" />
                      </button>
                      {/* v33: Inject Training toggle */}
                      <button
                        onClick={() => {
                          setInjectEntryId(isInjectingThis ? null : entry.id);
                          setInjectNote("");
                        }}
                        className={`rounded p-1 ${isInjectingThis ? "bg-violet-500/20 text-violet-300" : "text-muted-foreground hover:bg-violet-500/10 hover:text-violet-400"}`}
                        title="Inject Training (store as memory + create skill)"
                      >
                        <GraduationCap className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </CollapsibleItem>
              );
            })}
          </div>
        )}
      </CollapsibleList>

      {/* Agent Training */}
      <CollapsibleList
        title="Agent Training (Blackbox Teaching)"
        icon={<GraduationCap className="h-4 w-4 text-cyan-400" />}
        defaultOpen={false}
        maxHeight="30rem"
      >
        <div className="space-y-3 p-2">
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
              Agent ID
            </label>
            <input
              type="text"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              placeholder="e.g. cmsqgd1420002us2b324j2j7l"
              className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
              Teaching Source (text or URL)
            </label>
            <textarea
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Paste knowledge, instructions, or a URL for the agent to learn from…"
              rows={4}
              className="mc-scroll w-full resize-none rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
              Instructions (optional)
            </label>
            <input
              type="text"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Focus on customer support best practices"
              className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <button
            onClick={handleTeach}
            disabled={teaching}
            className="flex w-full items-center justify-center gap-2 rounded border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-violet-300 transition-colors hover:bg-violet-500/20 disabled:opacity-50"
          >
            {teaching ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Training…
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5" /> Teach Agent
              </>
            )}
          </button>

          {/* Training result */}
          {lastResult && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3"
            >
              <div className="mb-2 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span className="text-xs font-semibold text-emerald-400">Training Complete</span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  Confidence: {Math.round(lastResult.confidence * 100)}%
                </span>
              </div>
              <p className="mb-2 text-[11px] text-foreground">{lastResult.summary}</p>
              {lastResult.skills.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {lastResult.skills.map((skill) => (
                    <span key={skill} className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-violet-300">
                      {skill}
                    </span>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </div>
      </CollapsibleList>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: typeof Activity; color: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card/40 p-2.5">
      <Icon className={`h-4 w-4 ${color}`} />
      <div className="leading-tight">
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-sm font-bold tabular-nums text-foreground">{value}</div>
      </div>
    </div>
  );
}
