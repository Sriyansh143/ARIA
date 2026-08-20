"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Workflow,
  RefreshCw,
  Loader2,
  Play,
  ChevronDown,
  ChevronRight,
  Brain,
  Wrench,
  Bell,
  Database,
  GitBranch,
  Clock,
  CheckCircle2,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import { FullScreenPanel } from "./full-screen-panel";
import { Badge } from "@/components/ui/badge";

/**
 * WorkflowTemplatesPanel — the cross-functional workflow library.
 *
 * Sections:
 *   1. Grid of workflow template cards (fetched from
 *      /api/workflow-templates). Each card shows name, description,
 *      step count, trigger badge, and category accent color.
 *   2. Clicking a card expands an inline step list (id, name, type icon).
 *   3. "Run Workflow" button — POSTs the workflowId to /api/workflows.
 *
 * Empty state: "No workflow templates available".
 * All API calls wrapped in try/catch with sonner toast feedback.
 *
 * Task ID: FEATURES-MULTICOMPANY-WORKFLOWS-CONNECTORS (Task 4).
 */

// ─── Types ───────────────────────────────────────────────────────────
type Trigger = "manual" | "schedule" | "event" | "approval";

interface StepSummary {
  id: string;
  name: string;
  type: string;
}

interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  trigger: Trigger;
  status: string;
  stepCount: number;
  steps: StepSummary[];
}

interface RunResponse {
  ok: boolean;
  status?: string;
  run?: { id: string; status: string; workflowName: string; steps: unknown[] };
  message?: string;
  error?: string;
}

// ─── Step type → icon/tone mapping ──────────────────────────────────
const STEP_META: Record<string, { icon: LucideIcon; tone: string; label: string }> = {
  llm_call: { icon: Brain, tone: "text-violet-300", label: "LLM" },
  tool_call: { icon: Wrench, tone: "text-amber-300", label: "Tool" },
  notification: { icon: Bell, tone: "text-cyan-300", label: "Notify" },
  data_fetch: { icon: Database, tone: "text-emerald-300", label: "Fetch" },
  condition: { icon: GitBranch, tone: "text-fuchsia-300", label: "Branch" },
  delay: { icon: Clock, tone: "text-sky-300", label: "Delay" },
  approval: { icon: CheckCircle2, tone: "text-rose-300", label: "Approve" },
  transform: { icon: Workflow, tone: "text-teal-300", label: "Transform" },
  loop: { icon: RefreshCw, tone: "text-sky-300", label: "Loop" },
  end: { icon: CheckCircle2, tone: "text-emerald-300", label: "End" },
};

function stepMeta(type: string) {
  return (
    STEP_META[type] ?? {
      icon: Workflow,
      tone: "text-muted-foreground",
      label: type,
    }
  );
}

// ─── Trigger metadata ───────────────────────────────────────────────
const TRIGGER_META: Record<Trigger, { tone: string; label: string }> = {
  manual: { tone: "text-violet-300 border-violet-500/30 bg-violet-500/10", label: "Manual" },
  schedule: { tone: "text-amber-300 border-amber-500/30 bg-amber-500/10", label: "Schedule" },
  event: { tone: "text-cyan-300 border-cyan-500/30 bg-cyan-500/10", label: "Event" },
  approval: { tone: "text-rose-300 border-rose-500/30 bg-rose-500/10", label: "Approval" },
};

// ─── Component ───────────────────────────────────────────────────────
export function WorkflowTemplatesPanel() {
  const [templates, setTemplates] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workflow-templates", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json().catch(() => ({}))) as {
        templates?: WorkflowSummary[];
      };
      setTemplates(Array.isArray(data.templates) ? data.templates : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates]);

  const runWorkflow = useCallback(async (wf: WorkflowSummary) => {
    setRunningId(wf.id);
    const tid = toast.loading(`Triggering workflow: ${wf.name}…`, {
      description: `${wf.stepCount} steps · ${wf.trigger} trigger`,
    });
    try {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: wf.id }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` — ${txt.slice(0, 120)}` : ""}`);
      }
      const data = (await res.json().catch(() => ({}))) as RunResponse;
      if (data.ok) {
        if (data.status === "completed" && data.run) {
          const stepCount = Array.isArray(data.run.steps) ? data.run.steps.length : 0;
          toast.success(`Workflow "${wf.name}" completed`, {
            id: tid,
            description: `${stepCount} steps executed`,
          });
        } else {
          toast.success(`Workflow "${wf.name}" running in background`, {
            id: tid,
            description: data.message ?? "Check live log for progress",
          });
        }
      } else {
        toast.error(`Workflow "${wf.name}" failed`, {
          id: tid,
          description: data.error ?? "unknown error",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Workflow "${wf.name}" failed`, { id: tid, description: msg });
    } finally {
      setRunningId(null);
    }
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  return (
    <FullScreenPanel
      title="Workflow Templates"
      icon={<Workflow className="h-3.5 w-3.5 text-violet-300" />}
      actions={
        <button
          type="button"
          onClick={() => void fetchTemplates()}
          disabled={loading}
          aria-label="Refresh workflow templates"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      }
    >
      <div className="space-y-3 p-3">
        <Header
          count={templates.length}
          loading={loading}
        />
        {error ? (
          <div className="rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 font-mono text-[10px] text-rose-300">
            load failed: {error}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-1.5 py-8 font-mono text-[10px] text-muted-foreground/60">
            <Loader2 className="h-3 w-3 animate-spin" />
            loading workflow templates…
          </div>
        ) : templates.length === 0 ? (
          <EmptyState
            icon={Inbox}
            label="No workflow templates available"
            hint="Workflow templates are auto-discovered from the engine registry."
          />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {templates.map((wf) => (
              <WorkflowCard
                key={wf.id}
                workflow={wf}
                expanded={expandedId === wf.id}
                onToggle={() => toggleExpand(wf.id)}
                onRun={() => void runWorkflow(wf)}
                running={runningId === wf.id}
              />
            ))}
          </div>
        )}
      </div>
    </FullScreenPanel>
  );
}

// ─── Header ─────────────────────────────────────────────────────────
function Header({ count, loading }: { count: number; loading: boolean }) {
  return (
    <div className="mc-surface flex items-center justify-between rounded-lg border border-border/60 bg-surface-2/30 p-3">
      <div className="flex items-center gap-1.5">
        <Workflow className="h-3.5 w-3.5 text-violet-300" />
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
          Cross-Functional Workflow Library
        </h3>
      </div>
      <Badge
        variant="outline"
        className="border-violet-500/30 bg-violet-500/10 px-1.5 py-0 text-[9px] font-bold text-violet-300"
      >
        {loading ? "…" : `${count} templates`}
      </Badge>
    </div>
  );
}

// ─── Workflow Card ──────────────────────────────────────────────────
function WorkflowCard({
  workflow,
  expanded,
  onToggle,
  onRun,
  running,
}: {
  workflow: WorkflowSummary;
  expanded: boolean;
  onToggle: () => void;
  onRun: () => void;
  running: boolean;
}) {
  const trigger = TRIGGER_META[workflow.trigger] ?? TRIGGER_META.manual;

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col gap-2 rounded-md border border-border/60 bg-background/40 p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold text-foreground">
            {workflow.name}
          </div>
          <div className="mt-0.5 line-clamp-2 font-mono text-[9px] text-muted-foreground/70">
            {workflow.description}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Badge
          variant="outline"
          className={`shrink-0 px-1.5 py-0 text-[9px] font-bold ${trigger.tone}`}
        >
          {trigger.label}
        </Badge>
        <Badge
          variant="outline"
          className="shrink-0 border-border/60 bg-surface-2/40 px-1.5 py-0 text-[9px] font-bold text-muted-foreground"
        >
          {workflow.stepCount} steps
        </Badge>
        {workflow.status !== "active" && (
          <Badge
            variant="outline"
            className="shrink-0 border-border/60 bg-surface-2/40 px-1.5 py-0 text-[9px] font-bold text-muted-foreground/70"
          >
            {workflow.status}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? "Collapse step list" : "Expand step list"}
          aria-expanded={expanded}
          className="flex h-7 items-center gap-1 rounded border border-border/60 bg-surface-2/60 px-2 font-mono text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          {expanded ? "Hide Steps" : "Show Steps"}
        </button>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-violet-500/40 bg-violet-500/10 px-2 font-mono text-[10px] font-medium text-violet-200 transition-colors hover:bg-violet-500/20 disabled:opacity-50"
        >
          {running ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          {running ? "Running…" : "Run Workflow"}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <ol className="space-y-1 border-t border-border/40 pt-2">
              {workflow.steps.map((step, idx) => {
                const meta = stepMeta(step.type);
                const Icon = meta.icon;
                return (
                  <li
                    key={step.id}
                    className="flex items-start gap-1.5 rounded border border-border/30 bg-surface-2/30 px-2 py-1"
                  >
                    <span className="mt-0.5 font-mono text-[9px] font-bold text-muted-foreground/50">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <Icon className={`mt-0.5 h-3 w-3 shrink-0 ${meta.tone}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-medium text-foreground">
                        {step.name}
                      </div>
                      <div className={`font-mono text-[8px] uppercase tracking-wider ${meta.tone}`}>
                        {meta.label}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
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
