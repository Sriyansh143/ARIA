"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import {
  TASK_PRIORITIES,
  TASK_KINDS,
  PRIORITY_META,
  type TaskPriority,
  type TaskKind,
} from "@/lib/types";
import { toast } from "sonner";
import {
  Plus,
  X,
  Loader2,
  Send,
  Flag,
  Tag,
  User,
  Type,
  AlignLeft,
} from "lucide-react";

interface TaskComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill the assignee + kind (e.g., from the Task Optimizer). */
  prefillAssigneeId?: string | null;
  prefillKind?: TaskKind | null;
}

/**
 * TaskComposer — modal dialog for injecting new work into the autonomous
 * pipeline.
 *
 * Operators specify title, description, priority, kind, and assignee.
 * The form is validated client-side, POSTed to /api/tasks, and the
 * returned task arrives via the SSE stream (the API also emits a
 * task.update event) so every connected client renders it.
 *
 * Supports pre-filling the assignee + kind (used by the Task Optimizer's
 * "Assign" action so operators can dispatch to the recommended agent
 * with one click).
 *
 * Keyboard: Escape closes, Cmd/Ctrl+Enter submits.
 */
export function TaskComposer({ open, onOpenChange, prefillAssigneeId, prefillKind }: TaskComposerProps) {
  const agents = useMissionStore((s) => s.agents);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [kind, setKind] = useState<TaskKind>("work");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const agentList = useMemo(
    () => Object.values(agents).sort((a, b) => a.name.localeCompare(b.name)),
    [agents]
  );

  // Reset form when opened, applying any pre-fill values from the optimizer.
  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setPriority("medium");
      setKind(prefillKind ?? "work");
      setAssigneeId(prefillAssigneeId ?? "");
      setSubmitting(false);
    }
  }, [open]);

  // Global hotkey: Cmd/Ctrl+Enter submits, Escape closes (when open).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (title.trim() && !submitting) void submit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, title, description, priority, kind, assigneeId, submitting]);

  async function submit() {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          priority,
          kind,
          assignedToId: assigneeId || null,
          dependsOn: [],
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast.success("Task injected into pipeline", {
        description: `"${title.trim()}" → ${assigneeId ? agentList.find((a) => a.id === assigneeId)?.name : "unassigned"}`,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error("Failed to create task", {
        description: err instanceof Error ? err.message : "unknown error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => onOpenChange(false)}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="mc-surface-elevated w-full max-w-lg overflow-hidden"
              role="dialog"
              aria-label="Create new task"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onOpenChange(false);
                }
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md border border-cyan-500/40 bg-cyan-500/10">
                    <Plus className="h-3.5 w-3.5 text-cyan-300" />
                  </div>
                  <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
                    Inject Task
                  </h2>
                </div>
                <button
                  onClick={() => onOpenChange(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-rose-500/40 hover:text-rose-300"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Form */}
              <div className="space-y-3 p-4">
                {/* Title */}
                <Field label="Title" icon={Type} required>
                  <input
                    autoFocus
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Refactor approval gate UX"
                    maxLength={200}
                    className="w-full rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </Field>

                {/* Description */}
                <Field label="Description" icon={AlignLeft}>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional context for the assigned agent…"
                    maxLength={2000}
                    rows={2}
                    className="mc-scroll w-full resize-none rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </Field>

                {/* Priority + Kind */}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Priority" icon={Flag}>
                    <div className="flex flex-wrap gap-1">
                      {TASK_PRIORITIES.map((p) => {
                        const pm = PRIORITY_META[p];
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setPriority(p)}
                            className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                              priority === p
                                ? `border-current ${pm.tone} bg-current/10`
                                : "border-border/60 text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {pm.label}
                          </button>
                        );
                      })}
                    </div>
                  </Field>

                  <Field label="Kind" icon={Tag}>
                    <select
                      value={kind}
                      onChange={(e) => setKind(e.target.value as TaskKind)}
                      className="w-full rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5 font-mono text-xs text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                    >
                      {TASK_KINDS.map((k) => (
                        <option key={k} value={k} className="bg-card">
                          {k}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                {/* Assignee */}
                <Field label="Assignee" icon={User}>
                  <select
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                    className="w-full rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5 font-mono text-xs text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  >
                    <option value="" className="bg-card">
                      unassigned (auto-dispatch)
                    </option>
                    {agentList.map((a) => (
                      <option key={a.id} value={a.id} className="bg-card">
                        {a.name} · {a.role}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between border-t border-border/60 px-4 py-3">
                <span className="font-mono text-[9px] text-muted-foreground">
                  <kbd className="rounded border border-border/60 px-1 py-0.5">⌘↵</kbd> submit ·{" "}
                  <kbd className="rounded border border-border/60 px-1 py-0.5">esc</kbd> cancel
                </span>
                <button
                  onClick={() => void submit()}
                  disabled={!title.trim() || submitting}
                  className="flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-cyan-300 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {submitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  {submitting ? "injecting…" : "inject task"}
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

function Field({
  label,
  icon: Icon,
  required,
  children,
}: {
  label: string;
  icon: typeof Type;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-2.5 w-2.5" />
        {label}
        {required && <span className="text-rose-300">*</span>}
      </label>
      {children}
    </div>
  );
}
