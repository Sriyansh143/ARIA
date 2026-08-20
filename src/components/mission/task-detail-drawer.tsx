"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import {
  PRIORITY_META,
  type Task,
  type TaskStatus,
  type TaskPriority,
  type TaskKind,
} from "@/lib/types";
import { relTime, formatTime } from "@/hooks/use-clock";
import {
  X,
  ListTree,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Lock,
  GitBranch,
  ScrollText,
  Link2,
  AlertCircle,
} from "lucide-react";

interface TaskDetailDrawerProps {
  taskId: string | null;
  onClose: () => void;
}

const STATUS_META: Record<TaskStatus, { label: string; icon: typeof Clock; tone: string }> = {
  pending: { label: "Pending", icon: Clock, tone: "text-slate-300" },
  running: { label: "Running", icon: Loader2, tone: "text-amber-300" },
  completed: { label: "Completed", icon: CheckCircle2, tone: "text-emerald-300" },
  failed: { label: "Failed", icon: XCircle, tone: "text-rose-300" },
  blocked: { label: "Blocked", icon: Lock, tone: "text-violet-300" },
};

const KIND_TONE: Record<string, string> = {
  work: "text-slate-300",
  tool_call: "text-amber-300",
  research: "text-cyan-300",
  review: "text-violet-300",
  decision: "text-emerald-300",
};

/**
 * TaskDetailDrawer — full task detail panel with logs + dependency chain.
 *
 * Slides in from the right when a task is selected (via the task pipeline
 * or global search). Shows: task identity header with status + progress,
 * key facts grid (priority, kind, assignee, created, completed), dependency
 * chain (dependsOn tasks + tasks that depend on this one), and a filtered
 * log stream for this specific task.
 */
export function TaskDetailDrawer({ taskId, onClose }: TaskDetailDrawerProps) {
  const tasks = useMissionStore((s) => s.tasks);
  const logs = useMissionStore((s) => s.logs);
  const agents = useMissionStore((s) => s.agents);

  const task = taskId ? (tasks[taskId] ?? null) : null;

  const taskLogs = useMemo(
    () => (task ? logs.filter((l) => l.taskId === task.id).slice(0, 30) : []),
    [task, logs]
  );

  const dependencies = useMemo(() => {
    if (!task) return [];
    return (task.dependsOn ?? [])
      .map((id) => tasks[id])
      .filter((t): t is Task => t != null);
  }, [task, tasks]);

  const dependents = useMemo(() => {
    if (!task) return [];
    return Object.values(tasks).filter((t) => t.dependsOn?.includes(task.id));
  }, [task, tasks]);

  return (
    <AnimatePresence>
      {task && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className="mc-surface-elevated fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border/70 bg-card"
            role="dialog"
            aria-label={`Task detail: ${task.title}`}
          >
            <TaskHeader task={task} onClose={onClose} agents={agents} />

            <div className="mc-scroll flex-1 overflow-y-auto p-4">
              {/* Progress bar */}
              <Section title="Progress" icon={Loader2}>
                <div className="flex items-center gap-3">
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-border/30">
                    <motion.div
                      className={`h-full rounded-full ${
                        task.status === "completed"
                          ? "bg-emerald-400"
                          : task.status === "failed"
                            ? "bg-rose-400"
                            : "bg-gradient-to-r from-cyan-400 to-violet-400"
                      }`}
                      initial={{ width: 0 }}
                      animate={{ width: `${task.progress}%` }}
                      transition={{ duration: 0.4 }}
                    />
                  </div>
                  <span className="font-mono text-lg font-bold tabular-nums text-foreground">
                    {task.progress}%
                  </span>
                </div>
                {task.result && (
                  <div className="mt-2 rounded-md border border-border/40 bg-background/40 px-3 py-2">
                    <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Result</div>
                    <div className="mt-0.5 font-mono text-xs text-foreground">{task.result}</div>
                  </div>
                )}
              </Section>

              {/* Key facts */}
              <Section title="Task Facts" icon={ListTree}>
                <div className="grid grid-cols-2 gap-2">
                  <FactTile label="Priority" value={PRIORITY_META[task.priority as TaskPriority]?.label ?? task.priority} tone={PRIORITY_META[task.priority as TaskPriority]?.tone ?? "text-slate-300"} />
                  <FactTile label="Kind" value={task.kind} tone={KIND_TONE[task.kind as TaskKind] ?? "text-slate-300"} />
                  <FactTile label="Assignee" value={task.assignedTo?.name ?? "unassigned"} tone="text-cyan-300" />
                  <FactTile label="Created" value={relTime(task.createdAt)} tone="text-slate-300" />
                  {task.startedAt && <FactTile label="Started" value={relTime(task.startedAt)} tone="text-amber-300" />}
                  {task.completedAt && <FactTile label="Completed" value={relTime(task.completedAt)} tone="text-emerald-300" />}
                </div>
                {task.description && (
                  <div className="mt-2 rounded-md border border-border/40 bg-background/40 px-3 py-2">
                    <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Description</div>
                    <div className="mt-0.5 font-mono text-xs text-foreground/80">{task.description}</div>
                  </div>
                )}
              </Section>

              {/* Dependency chain */}
              <Section title="Dependencies" icon={Link2} subtitle={`${dependencies.length} deps · ${dependents.length} dependents`}>
                {dependencies.length === 0 && dependents.length === 0 ? (
                  <div className="font-mono text-[11px] text-muted-foreground">no dependencies</div>
                ) : (
                  <div className="space-y-2">
                    {dependencies.length > 0 && (
                      <div>
                        <div className="mb-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-violet-300">
                          <Lock className="h-2.5 w-2.5" /> Depends on
                        </div>
                        <div className="space-y-1">
                          {dependencies.map((dep) => (
                            <DepRow key={dep.id} task={dep} />
                          ))}
                        </div>
                      </div>
                    )}
                    {dependents.length > 0 && (
                      <div>
                        <div className="mb-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-cyan-300">
                          <GitBranch className="h-2.5 w-2.5" /> Blocks
                        </div>
                        <div className="space-y-1">
                          {dependents.map((dep) => (
                            <DepRow key={dep.id} task={dep} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Section>

              {/* Task log */}
              <Section title="Task Log" icon={ScrollText} subtitle={`${taskLogs.length} entries`}>
                {taskLogs.length === 0 ? (
                  <div className="font-mono text-[11px] text-muted-foreground">no logs for this task</div>
                ) : (
                  <div className="mc-scroll max-h-64 space-y-px overflow-y-auto rounded-md border border-border/40 bg-background/60 font-mono text-[11px]">
                    {taskLogs.map((l) => {
                      const tone =
                        l.level === "error" ? "text-rose-300" : l.level === "success" ? "text-emerald-300" : l.level === "warn" ? "text-amber-300" : "text-sky-300";
                      return (
                        <div key={l.id} className="flex items-start gap-2 border-b border-border/20 px-2 py-1 last:border-0 hover:bg-card/40">
                          <span className="shrink-0 text-muted-foreground/70 tabular-nums">{formatTime(l.createdAt)}</span>
                          <span className={`shrink-0 text-[9px] font-semibold uppercase ${tone}`}>{l.level}</span>
                          <span className="text-foreground/90">{l.message}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Section>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function TaskHeader({ task, onClose, agents }: { task: Task; onClose: () => void; agents: Record<string, { name: string }> }) {
  const status = STATUS_META[task.status as TaskStatus] ?? STATUS_META.pending;
  const StatusIcon = status.icon;
  const isActive = task.status === "running";

  return (
    <div className={`relative overflow-hidden border-b border-border/60 px-4 py-4 ${isActive ? "shadow-[0_0_20px_-4px_oklch(0.78_0.15_80_/_0.4)]" : ""}`}>
      {isActive && <div className="pointer-events-none absolute inset-x-0 top-0 h-px mc-sweep-line opacity-60" />}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10">
            <StatusIcon className={`h-5 w-5 ${status.tone} ${isActive ? "animate-spin" : ""}`} />
          </div>
          <div>
            <h2 className="font-mono text-base font-semibold text-foreground">{task.title}</h2>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
              <span className={`uppercase ${status.tone}`}>{status.label}</span>
              <span>·</span>
              <span className={KIND_TONE[task.kind as TaskKind] ?? "text-slate-400"}>{task.kind}</span>
              <span>·</span>
              <span>{task.assignedTo?.name ?? "unassigned"}</span>
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-rose-500/40 hover:text-rose-300"
          aria-label="Close task detail"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  icon: Icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: typeof ListTree;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3 w-3 text-cyan-300" />
          <h3 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground">{title}</h3>
        </div>
        {subtitle && <span className="font-mono text-[9px] text-muted-foreground">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

function FactTile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/40 p-2.5">
      <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 truncate font-mono text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function DepRow({ task }: { task: Task }) {
  const status = STATUS_META[task.status as TaskStatus] ?? STATUS_META.pending;
  const Icon = status.icon;
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/40 bg-background/40 px-2.5 py-1.5">
      <Icon className={`h-3 w-3 shrink-0 ${status.tone} ${task.status === "running" ? "animate-spin" : ""}`} />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{task.title}</span>
      <span className="shrink-0 font-mono text-[9px] text-muted-foreground">{task.progress}%</span>
    </div>
  );
}

export { AlertCircle };
