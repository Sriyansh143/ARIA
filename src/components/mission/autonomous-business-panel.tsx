"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Rocket,
  Search,
  CheckCircle2,
  ListTodo,
  PlayCircle,
  PackageCheck,
  Receipt,
  LineChart,
  Sparkles,
  Loader2,
  Play,
  RefreshCw,
  ChevronDown,
  AlertCircle,
  Inbox,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { FullScreenPanel } from "./full-screen-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useClock, relTime } from "@/hooks/use-clock";

/**
 * AutonomousBusinessPanel — full autonomous business lifecycle surface.
 *
 * Sections:
 *   1. Industry Selector — shadcn Select of 12 industries, loads the
 *      chosen playbook into a collapsible info card.
 *   2. Lifecycle Pipeline — 8 horizontal stage cards (FIND → OPTIMIZE)
 *      showing live counts from /api/business-lifecycle.
 *   3. Run Autonomous Cycle — POSTs the selected industry to
 *      /api/business-lifecycle. Cycles progress messages every 3s.
 *   4. Recent Cycle Results — scrollable list of recent
 *      Deliverable/Invoice notes from /api/business-lifecycle/status.
 *   5. Quick Actions — Find Opportunities / Qualify Latest / Run Optimization.
 *
 * Task ID: AUTONOMOUS-BUSINESS-ENGINE.
 */

// ─── Types ───────────────────────────────────────────────────────────
interface PlaybookMeta {
  id: string;
  name: string;
  icon: string;
  revenueModels: { name: string; description: string; margin: number }[];
  keyMetrics: { name: string; target: string; unit: string }[];
  riskFactors: string[];
  complianceRequirements: string[];
  agentFocus: string[];
  operationalPlaybookPreview: string;
  operationalPlaybook?: string;
}

interface LifecycleStage {
  id: string;
  name: string;
  description: string;
  count: number;
}

interface CycleResult {
  industryPlaybookId: string;
  found: number;
  qualified: number;
  planned: number;
  executed: number;
  delivered: number;
  invoiced: number;
  tracked: number;
  optimized: number;
  revenueGenerated: number;
  errors: string[];
  startedAt: string;
  completedAt: string;
}

interface StatusResponse {
  deals: Record<string, number>;
  tasks: Record<string, number>;
  revenue: { total: number; events: number };
  recentCycles: Array<{
    kind: "deliverable" | "invoice";
    id: string;
    title: string;
    amount?: number;
    createdAt: string;
  }>;
  currentIndustryFocus: string | null;
  optimizationMemories: number;
  completedTasks: number;
}

// ─── Stage metadata ──────────────────────────────────────────────────
const STAGES: {
  id: string;
  name: string;
  icon: LucideIcon;
  tone: string;
  description: string;
}[] = [
  { id: "find", name: "FIND", icon: Search, tone: "text-cyan-300 border-cyan-500/30 bg-cyan-500/5", description: "Scan for fresh opportunities" },
  { id: "qualify", name: "QUALIFY", icon: CheckCircle2, tone: "text-emerald-300 border-emerald-500/30 bg-emerald-500/5", description: "LLM-score on demand + margin" },
  { id: "plan", name: "PLAN", icon: ListTodo, tone: "text-violet-300 border-violet-500/30 bg-violet-500/5", description: "Step-by-step execution plan" },
  { id: "execute", name: "EXECUTE", icon: PlayCircle, tone: "text-amber-300 border-amber-500/30 bg-amber-500/5", description: "Agents produce work products" },
  { id: "deliver", name: "DELIVER", icon: PackageCheck, tone: "text-teal-300 border-teal-500/30 bg-teal-500/5", description: "Compile client-ready package" },
  { id: "invoice", name: "INVOICE", icon: Receipt, tone: "text-rose-300 border-rose-500/30 bg-rose-500/5", description: "Generate invoice + 18% tax" },
  { id: "track", name: "TRACK", icon: LineChart, tone: "text-sky-300 border-sky-500/30 bg-sky-500/5", description: "Health score + KPI snapshot" },
  { id: "optimize", name: "OPTIMIZE", icon: Sparkles, tone: "text-fuchsia-300 border-fuchsia-500/30 bg-fuchsia-500/5", description: "LLM optimization recommendations" },
];

const PROGRESS_MESSAGES = [
  "Finding opportunities…",
  "Qualifying opportunities…",
  "Planning execution steps…",
  "Executing plan via agents…",
  "Compiling deliverable…",
  "Generating invoice…",
  "Tracking progress…",
  "Optimizing performance…",
];

const fmtMoney = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `$${(n / 1_000).toFixed(1)}k`
      : `$${n.toFixed(0)}`;

// ─── Component ───────────────────────────────────────────────────────
export function AutonomousBusinessPanel() {
  return (
    <FullScreenPanel
      title="Autonomous Business Engine"
      icon={<Rocket className="h-3.5 w-3.5 text-fuchsia-300" />}
    >
      <div className="space-y-3 p-3">
        <IndustrySelector />
        <LifecyclePipelineSection />
        <RunCycleSection />
        <RecentCyclesSection />
        <QuickActionsSection />
      </div>
    </FullScreenPanel>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 1. INDUSTRY SELECTOR
// ═════════════════════════════════════════════════════════════════════
function IndustrySelector() {
  const [playbooks, setPlaybooks] = useState<PlaybookMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [fullPlaybook, setFullPlaybook] = useState<PlaybookMeta | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [loadingFull, setLoadingFull] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/industry-playbooks", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { playbooks?: PlaybookMeta[] };
        if (cancelled) return;
        const list = Array.isArray(data.playbooks) ? data.playbooks : [];
        setPlaybooks(list);
        if (list.length > 0 && !selectedId) {
          setSelectedId(list[0].id);
          setFullPlaybook(list[0]);
          // Broadcast the initial selection so other sections (RunCycle,
          // QuickActions) get a default industry without waiting for a
          // user interaction.
          window.dispatchEvent(
            new CustomEvent("aria:industry-select", { detail: { id: list[0].id } }),
          );
        }
      } catch {
        // silent — empty state will render
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadFull = useCallback(async (id: string) => {
    setLoadingFull(true);
    try {
      const res = await fetch("/api/industry-playbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
        cache: "no-store",
      });
      if (!res.ok) {
        const meta = playbooks.find((p) => p.id === id) ?? null;
        setFullPlaybook(meta);
        return;
      }
      const data = (await res.json()) as { playbook?: PlaybookMeta };
      setFullPlaybook(data.playbook ?? playbooks.find((p) => p.id === id) ?? null);
    } catch {
      const meta = playbooks.find((p) => p.id === id) ?? null;
      setFullPlaybook(meta);
    } finally {
      setLoadingFull(false);
    }
  }, [playbooks]);

  const onSelectChange = useCallback(
    (id: string) => {
      setSelectedId(id);
      void loadFull(id);
      // Broadcast selection to other sections.
      window.dispatchEvent(
        new CustomEvent("aria:industry-select", { detail: { id } }),
      );
    },
    [loadFull],
  );

  return (
    <div className="mc-surface rounded-lg border border-border/60 bg-surface-2/30 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1.5">
          <Rocket className="h-3.5 w-3.5 text-fuchsia-300" />
          <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
            Industry Playbook
          </h3>
          {fullPlaybook && (
            <Badge
              variant="outline"
              className="ml-1 border-fuchsia-500/30 bg-fuchsia-500/10 px-1.5 py-0 text-[9px] font-bold text-fuchsia-300"
            >
              {fullPlaybook.name}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedId} onValueChange={onSelectChange}>
            <SelectTrigger
              size="sm"
              className="h-8 w-full min-w-[200px] font-mono text-[11px] sm:w-[260px]"
              aria-label="Select industry playbook"
            >
              <SelectValue placeholder={playbooks.length === 0 ? "Loading industries…" : "Select an industry"} />
            </SelectTrigger>
            <SelectContent>
              {playbooks.map((p) => (
                <SelectItem key={p.id} value={p.id} className="font-mono text-[11px]">
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Collapse playbook details" : "Expand playbook details"}
            title={expanded ? "Collapse" : "Expand"}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`}
            />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && fullPlaybook && (
          <motion.div
            key="playbook-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {/* Revenue models */}
              <div className="rounded-md border border-border/40 bg-surface-2/40 p-2.5">
                <div className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                  Revenue Models
                </div>
                <ul className="space-y-1.5">
                  {fullPlaybook.revenueModels.map((m) => (
                    <li key={m.name} className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium text-foreground">{m.name}</div>
                        <div className="line-clamp-1 font-mono text-[9px] text-muted-foreground/70">
                          {m.description}
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className="shrink-0 border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0 text-[9px] font-bold text-emerald-300"
                      >
                        {(m.margin * 100).toFixed(0)}%
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Key metrics */}
              <div className="rounded-md border border-border/40 bg-surface-2/40 p-2.5">
                <div className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                  Key Metrics
                </div>
                <ul className="space-y-1">
                  {fullPlaybook.keyMetrics.map((k) => (
                    <li
                      key={k.name}
                      className="flex items-center justify-between gap-2 font-mono text-[10px]"
                    >
                      <span className="text-muted-foreground">{k.name}</span>
                      <span className="font-medium text-foreground">
                        {k.target}
                        <span className="ml-1 text-[9px] text-muted-foreground/60">{k.unit}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Risks + compliance */}
              <div className="rounded-md border border-border/40 bg-surface-2/40 p-2.5">
                <div className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                  Risks & Compliance
                </div>
                <div className="mb-2 flex flex-wrap gap-1">
                  {fullPlaybook.riskFactors.slice(0, 4).map((r) => (
                    <span
                      key={r}
                      className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0 font-mono text-[9px] text-amber-300"
                    >
                      {r}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1">
                  {fullPlaybook.complianceRequirements.slice(0, 4).map((c) => (
                    <span
                      key={c}
                      className="rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0 font-mono text-[9px] text-rose-300"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Operational playbook text */}
            {fullPlaybook.operationalPlaybook && (
              <div className="mt-2 rounded-md border border-border/40 bg-surface-2/40 p-2.5">
                <div className="mb-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                  <span>Operational Playbook</span>
                  {loadingFull && <Loader2 className="h-3 w-3 animate-spin" />}
                </div>
                <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
                  {fullPlaybook.operationalPlaybook}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span className="font-mono text-[9px] text-muted-foreground/60">Focus:</span>
                  {fullPlaybook.agentFocus.map((d) => (
                    <span
                      key={d}
                      className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0 font-mono text-[9px] text-violet-300"
                    >
                      {d}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 2. LIFECYCLE PIPELINE
// ═════════════════════════════════════════════════════════════════════
function LifecyclePipelineSection() {
  const [stages, setStages] = useState<LifecycleStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPipeline = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/business-lifecycle", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { stages?: LifecycleStage[] };
      setStages(Array.isArray(data.stages) ? data.stages : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pipeline");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPipeline();
  }, [fetchPipeline]);

  const stageMap = new Map(stages.map((s) => [s.id, s.count]));
  const totalActive = stages.reduce((s, st) => s + st.count, 0);

  return (
    <div className="mc-surface rounded-lg border border-border/60 bg-surface-2/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <LineChart className="h-3.5 w-3.5 text-sky-300" />
          <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
            Lifecycle Pipeline
          </h3>
          <span className="ml-1 font-mono text-[9px] text-muted-foreground/60">
            {totalActive} active
          </span>
        </div>
        <button
          type="button"
          onClick={() => void fetchPipeline()}
          aria-label="Refresh lifecycle pipeline"
          title="Refresh"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error ? (
        <div className="rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 font-mono text-[10px] text-rose-300">
          load failed: {error}
        </div>
      ) : (
        <div className="mc-scroll flex items-stretch gap-1 overflow-x-auto pb-1">
          {STAGES.map((stage, idx) => {
            const count = stageMap.get(stage.id) ?? 0;
            const Icon = stage.icon;
            const isActive = count > 0;
            return (
              <div key={stage.id} className="flex items-center gap-1">
                <motion.div
                  layout
                  initial={{ opacity: 0.4 }}
                  animate={{
                    opacity: 1,
                    boxShadow: isActive
                      ? "0 0 16px -4px rgba(139,92,246,0.35)"
                      : "0 0 0px rgba(0,0,0,0)",
                  }}
                  transition={{ duration: 0.3 }}
                  className={`relative flex min-w-[88px] flex-col rounded-md border p-2 ${stage.tone} ${isActive ? "ring-1 ring-inset ring-violet-500/20" : "opacity-70"}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <Icon className="h-3 w-3" />
                    {count > 0 && (
                      <span className="font-mono text-[8px] text-emerald-300">●</span>
                    )}
                  </div>
                  <span className="mt-0.5 font-mono text-[9px] uppercase tracking-wider">
                    {stage.name}
                  </span>
                  <span className="mt-1 font-mono text-base font-bold tabular-nums text-foreground">
                    {count}
                  </span>
                  <span className="mt-0.5 line-clamp-1 font-mono text-[8px] text-muted-foreground/60">
                    {stage.description}
                  </span>
                </motion.div>
                {idx < STAGES.length - 1 && (
                  <ArrowRight className="h-3 w-3 shrink-0 text-border" />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 3. RUN AUTONOMOUS CYCLE
// ═════════════════════════════════════════════════════════════════════
function RunCycleSection() {
  const [selectedId, setSelectedId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [progressMsgIdx, setProgressMsgIdx] = useState(0);

  // Poll the select element via a tiny shared state hack: read the value
  // from the document's active Select. Simpler: keep this section's own
  // dropdown so the user can pick the industry right here.
  // For shared state, we listen to a window CustomEvent dispatched by
  // IndustrySelector. This avoids a parent context.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ id: string }>;
      if (ce.detail?.id) setSelectedId(ce.detail.id);
    };
    window.addEventListener("aria:industry-select", handler as EventListener);
    return () =>
      window.removeEventListener("aria:industry-select", handler as EventListener);
  }, []);

  // Cycle progress messages every 3s while loading.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setProgressMsgIdx((i) => (i + 1) % PROGRESS_MESSAGES.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [running]);

  const runCycle = useCallback(async () => {
    if (!selectedId) {
      toast.error("Select an industry first");
      return;
    }
    setRunning(true);
    setProgressMsgIdx(0);
    const tid = toast.loading("Starting autonomous cycle…", {
      description: "FIND → QUALIFY → PLAN → EXECUTE → DELIVER → INVOICE → TRACK → OPTIMIZE",
    });
    try {
      const res = await fetch("/api/business-lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industryPlaybookId: selectedId }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` — ${txt.slice(0, 120)}` : ""}`);
      }
      const result = (await res.json()) as CycleResult;
      const errs = result.errors?.length ?? 0;
      toast.success("Autonomous cycle complete", {
        id: tid,
        description:
          `Found ${result.found} · Qualified ${result.qualified} · Executed ${result.executed} · ` +
          `Revenue ${fmtMoney(result.revenueGenerated)}${errs ? ` · ${errs} error(s)` : ""}`,
      });
      // Tell the pipeline + recent sections to refresh.
      window.dispatchEvent(new CustomEvent("aria:autonomous-cycle-complete"));
    } catch (err) {
      toast.error("Autonomous cycle failed", {
        id: tid,
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setRunning(false);
    }
  }, [selectedId]);

  return (
    <div className="mc-surface flex flex-col gap-2 rounded-lg border border-border/60 bg-surface-2/30 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-fuchsia-300" />
        <div>
          <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
            Run Autonomous Cycle
          </h3>
          <p className="font-mono text-[9px] text-muted-foreground/70">
            {running
              ? PROGRESS_MESSAGES[progressMsgIdx]
              : selectedId
                ? `Selected industry: ${selectedId}`
                : "Pick an industry above to enable the cycle"}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void runCycle()}
        disabled={running || !selectedId}
        className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 px-4 font-mono text-[11px] font-medium text-fuchsia-200 transition-colors hover:bg-fuchsia-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            running…
          </>
        ) : (
          <>
            <Play className="h-3.5 w-3.5" />
            run cycle
          </>
        )}
      </button>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 4. RECENT CYCLE RESULTS
// ═════════════════════════════════════════════════════════════════════
function RecentCyclesSection() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Re-render relative timestamps every second.
  useClock();

  const fetchStatus = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/business-lifecycle/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as StatusResponse;
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    // Refresh whenever an autonomous cycle completes.
    const handler = () => void fetchStatus();
    window.addEventListener("aria:autonomous-cycle-complete", handler);
    return () => window.removeEventListener("aria:autonomous-cycle-complete", handler);
  }, [fetchStatus]);

  const recent = status?.recentCycles ?? [];

  return (
    <div className="mc-surface rounded-lg border border-border/60 bg-surface-2/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Receipt className="h-3.5 w-3.5 text-rose-300" />
          <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
            Recent Cycle Results
          </h3>
          {status && (
            <span className="ml-1 font-mono text-[9px] text-muted-foreground/60">
              revenue {fmtMoney(status.revenue.total)} · {status.revenue.events} event(s)
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void fetchStatus()}
          aria-label="Refresh recent cycles"
          title="Refresh"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="mc-scroll max-h-64 space-y-1 overflow-y-auto pr-1">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 font-mono text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            loading recent cycles…
          </div>
        ) : error ? (
          <div className="rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 font-mono text-[10px] text-rose-300">
            load failed: {error}
          </div>
        ) : recent.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 py-6 text-center">
            <Inbox className="h-5 w-5 text-muted-foreground/40" />
            <div className="font-mono text-[10px] text-muted-foreground">
              No autonomous cycles run yet
            </div>
            <div className="font-mono text-[9px] text-muted-foreground/60">
              select an industry and click “run cycle”
            </div>
          </div>
        ) : (
          recent.map((c) => {
            const isInvoice = c.kind === "invoice";
            const Icon = isInvoice ? Receipt : PackageCheck;
            const tone = isInvoice
              ? "text-rose-300 border-rose-500/30 bg-rose-500/5"
              : "text-teal-300 border-teal-500/30 bg-teal-500/5";
            return (
              <div
                key={c.id}
                className={`flex items-start justify-between gap-2 rounded border ${tone} px-2 py-1.5`}
              >
                <div className="flex min-w-0 items-start gap-1.5">
                  <Icon className="mt-0.5 h-3 w-3 shrink-0" />
                  <div className="min-w-0">
                    <div className="line-clamp-1 font-mono text-[10px] font-medium text-foreground">
                      {c.title}
                    </div>
                    <div className="font-mono text-[9px] text-muted-foreground/70">
                      {relTime(c.createdAt)}
                    </div>
                  </div>
                </div>
                {isInvoice && typeof c.amount === "number" && c.amount > 0 && (
                  <Badge
                    variant="outline"
                    className="shrink-0 border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0 text-[9px] font-bold text-emerald-300"
                  >
                    {fmtMoney(c.amount)}
                  </Badge>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 5. QUICK ACTIONS
// ═════════════════════════════════════════════════════════════════════
function QuickActionsSection() {
  const [selectedId, setSelectedId] = useState<string>("");
  const [finding, setFinding] = useState(false);
  const [qualifying, setQualifying] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [lastFound, setLastFound] = useState<unknown[] | null>(null);

  // Mirror the industry select from IndustrySelector.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ id: string }>;
      if (ce.detail?.id) setSelectedId(ce.detail.id);
    };
    window.addEventListener("aria:industry-select", handler as EventListener);
    return () =>
      window.removeEventListener("aria:industry-select", handler as EventListener);
  }, []);

  const findOpps = useCallback(async () => {
    if (!selectedId) {
      toast.error("Select an industry first");
      return;
    }
    setFinding(true);
    const tid = toast.loading("Finding opportunities…");
    try {
      const res = await fetch("/api/business-lifecycle/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industryPlaybookId: selectedId }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` — ${txt.slice(0, 120)}` : ""}`);
      }
      const data = (await res.json()) as { found?: number; opportunities?: unknown[] };
      setLastFound(Array.isArray(data.opportunities) ? data.opportunities : []);
      toast.success(`Found ${data.found ?? 0} opportunities`, {
        id: tid,
        description: "Run Qualify to filter and promote to deals",
      });
    } catch (err) {
      toast.error("Find failed", {
        id: tid,
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setFinding(false);
    }
  }, [selectedId]);

  const qualifyLatest = useCallback(async () => {
    if (!lastFound || lastFound.length === 0) {
      toast.error("Run Find Opportunities first");
      return;
    }
    setQualifying(true);
    const tid = toast.loading("Qualifying latest batch…");
    try {
      const res = await fetch("/api/business-lifecycle/qualify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunities: lastFound }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` — ${txt.slice(0, 120)}` : ""}`);
      }
      const data = (await res.json()) as {
        qualified?: unknown[];
        rejected?: unknown[];
      };
      const q = data.qualified?.length ?? 0;
      const r = data.rejected?.length ?? 0;
      toast.success(`Qualified ${q} · Rejected ${r}`, { id: tid });
    } catch (err) {
      toast.error("Qualify failed", {
        id: tid,
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setQualifying(false);
    }
  }, [lastFound]);

  const runOptimization = useCallback(async () => {
    setOptimizing(true);
    const tid = toast.loading("Fetching optimization recommendations…");
    try {
      const res = await fetch("/api/business-lifecycle/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as StatusResponse;
      toast.success(
        `${data.optimizationMemories} optimization memory item(s)`,
        {
          id: tid,
          description: `Completed tasks: ${data.completedTasks} · Revenue: ${fmtMoney(data.revenue.total)}`,
        },
      );
    } catch (err) {
      toast.error("Optimization check failed", {
        id: tid,
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setOptimizing(false);
    }
  }, []);

  return (
    <div className="mc-surface rounded-lg border border-border/60 bg-surface-2/30 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <PlayCircle className="h-3.5 w-3.5 text-amber-300" />
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
          Quick Actions
        </h3>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <QuickActionButton
          icon={Search}
          label="Find Opportunities"
          tone="border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20"
          loading={finding}
          onClick={findOpps}
        />
        <QuickActionButton
          icon={CheckCircle2}
          label="Qualify Latest"
          tone="border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
          loading={qualifying}
          onClick={qualifyLatest}
        />
        <QuickActionButton
          icon={Sparkles}
          label="Run Optimization"
          tone="border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200 hover:bg-fuchsia-500/20"
          loading={optimizing}
          onClick={runOptimization}
        />
      </div>
    </div>
  );
}

function QuickActionButton({
  icon: Icon,
  label,
  tone,
  loading,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  tone: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={`flex h-9 items-center justify-center gap-1.5 rounded-md border px-3 font-mono text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Icon className="h-3.5 w-3.5" />
      )}
      {loading ? "running…" : label}
    </button>
  );
}

export default AutonomousBusinessPanel;
