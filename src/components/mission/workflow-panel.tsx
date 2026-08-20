"use client";

import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Workflow, Play, Loader2, CheckCircle2, XCircle, ArrowRight, Zap } from "lucide-react";

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  trigger: string;
  status: string;
  steps: Array<{ id: string; type: string; name: string }>;
}

interface StepResult {
  stepId: string;
  stepName: string;
  type: string;
  success: boolean;
  output: unknown;
  error?: string;
  latencyMs: number;
  ts: string;
}

interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  status: string;
  steps: StepResult[];
  totalLatencyMs: number;
}

/**
 * WorkflowPanel — n8n-style automation trigger + monitoring UI.
 *
 * Shows available workflow templates. Click "Run" to trigger a workflow.
 * Expanded view shows step-by-step execution results with success/failure
 * indicators and latency per step.
 */
export function WorkflowPanel() {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [activeRun, setActiveRun] = useState<WorkflowRun | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Load templates on mount.
  useEffect(() => {
    if (loaded) return;
    let cancelled = false;
    fetch("/api/workflows")
      .then((r) => r.json())
      .then((data: { templates: WorkflowTemplate[] }) => {
        if (!cancelled) {
          setTemplates(data.templates ?? []);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loaded]);

  const runWorkflow = useCallback(async (id: string, name: string) => {
    setRunning(id);
    setActiveRun(null);
    try {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: id }),
      });
      const data = (await res.json()) as { ok?: boolean; run?: WorkflowRun; status?: string; message?: string };

      if (data.ok && data.run) {
        setActiveRun(data.run);
        toast.success(`Workflow "${name}" completed`, {
          description: `${data.run.steps.length} steps in ${data.run.totalLatencyMs}ms`,
        });
      } else if (data.ok && data.status === "running") {
        toast.info(`Workflow "${name}" is running in background`, {
          description: data.message,
        });
      } else {
        toast.error(`Workflow "${name}" failed`);
      }
    } catch {
      toast.error(`Failed to trigger "${name}"`);
    } finally {
      setRunning(null);
    }
  }, []);

  return (
    <section className="mc-surface flex flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Workflow className="h-4 w-4 text-violet-300" />
          <h2 className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-foreground">
            Automation Workflows
          </h2>
          <span className="border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-violet-300" style={{ borderRadius: 0 }}>
            n8n-style
          </span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">{templates.length} workflows</span>
      </div>

      <div className="space-y-2 p-3">
        {templates.length === 0 && (
          <div className="flex h-20 items-center justify-center font-mono text-xs text-muted-foreground">
            loading workflows…
          </div>
        )}

        {templates.map((wf) => {
          const isExpanded = expanded === wf.id;
          const isRunning = running === wf.id;
          return (
            <div key={wf.id} className="border border-border/40 bg-background/40" style={{ borderRadius: 0 }}>
              {/* Workflow header */}
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <button
                  onClick={() => setExpanded(isExpanded ? null : wf.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <Zap className="h-3.5 w-3.5 shrink-0 text-violet-300" />
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs font-medium text-foreground">{wf.name}</div>
                    <div className="truncate font-mono text-[9px] text-muted-foreground">
                      {wf.steps.length} steps · {wf.trigger}
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => runWorkflow(wf.id, wf.name)}
                  disabled={isRunning}
                  className="flex shrink-0 items-center gap-1 border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-violet-300 transition-colors hover:bg-violet-500/20 disabled:opacity-40"
                  style={{ borderRadius: 0 }}
                >
                  {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  {isRunning ? "running…" : "run"}
                </button>
              </div>

              {/* Expanded: show steps + results */}
              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden border-t border-border/40"
                  >
                    <div className="p-3">
                      <p className="mb-2 font-mono text-[10px] text-muted-foreground">{wf.description}</p>

                      {/* Step list */}
                      <div className="space-y-1">
                        {wf.steps.map((step, i) => {
                          const result = activeRun?.steps.find((r) => r.stepId === step.id);
                          const isActive = running === wf.id && !result;
                          return (
                            <div
                              key={step.id}
                              className="flex items-center gap-2 border border-border/30 bg-card/30 px-2 py-1.5"
                              style={{ borderRadius: 0 }}
                            >
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center border border-border/60 font-mono text-[9px] text-muted-foreground" style={{ borderRadius: 0 }}>
                                {i + 1}
                              </span>
                              {result?.success ? (
                                <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-300" />
                              ) : result && !result.success ? (
                                <XCircle className="h-3 w-3 shrink-0 text-rose-300" />
                              ) : isActive ? (
                                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-amber-300" />
                              ) : (
                                <div className="h-3 w-3 shrink-0 border border-border/40" style={{ borderRadius: 0 }} />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-mono text-[10px] text-foreground">{step.name}</div>
                                <div className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground">{step.type}</div>
                              </div>
                              {result && (
                                <span className="shrink-0 font-mono text-[8px] tabular-nums text-muted-foreground">
                                  {result.latencyMs}ms
                                </span>
                              )}
                              {i < wf.steps.length - 1 && (
                                <ArrowRight className="hidden h-2.5 w-2.5 text-muted-foreground/30 sm:block" />
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Run summary */}
                      {activeRun && activeRun.workflowId === wf.id && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="mt-2 flex items-center justify-between border border-border/40 bg-card/40 px-3 py-1.5"
                          style={{ borderRadius: 0 }}
                        >
                          <span className={`font-mono text-[10px] uppercase ${activeRun.status === "completed" ? "text-emerald-300" : "text-rose-300"}`}>
                            {activeRun.status}
                          </span>
                          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                            {activeRun.steps.length} steps · {activeRun.totalLatencyMs}ms
                          </span>
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}
