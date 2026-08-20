"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import {
  PRIORITY_META,
  RISK_META,
  type Task,
  type TaskStatus,
  type TaskPriority,
  type ApprovalRisk,
  type ApprovalStatus,
} from "@/lib/types";
import { relTime } from "@/hooks/use-clock";
import { toast } from "sonner";
import {
  ListTree,
  Loader2,
  CheckCircle2,
  XCircle,
  Lock,
  Clock,
  GitBranch,
  CheckSquare,
  Plus,
} from "lucide-react";

const STATUS_META: Record<TaskStatus, { label: string; icon: typeof ListTree; tone: string }> = {
  pending: { label: "Pending", icon: Clock, tone: "text-slate-400" },
  running: { label: "Running", icon: Loader2, tone: "text-amber-300" },
  completed: { label: "Done", icon: CheckCircle2, tone: "text-emerald-300" },
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

type Filter = "all" | TaskStatus;

/**
 * TaskPipeline — the task execution board.
 *
 * Filterable by status, each row animates in on update. Progress bars
 * use a deterministic gradient keyed off priority so the eye can scan
 * urgency at a glance.
 */
export function TaskPipeline({ onCreateTask, onOpenTask }: { onCreateTask?: () => void; onOpenTask?: (taskId: string) => void }) {
  const tasks = useMissionStore((s) => s.tasks);
  const [filter, setFilter] = useState<Filter>("all");

  const list = Object.values(tasks).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const filtered = filter === "all" ? list : list.filter((t) => t.status === filter);

  const counts: Record<Filter, number> = {
    all: list.length,
    pending: list.filter((t) => t.status === "pending").length,
    running: list.filter((t) => t.status === "running").length,
    completed: list.filter((t) => t.status === "completed").length,
    failed: list.filter((t) => t.status === "failed").length,
    blocked: list.filter((t) => t.status === "blocked").length,
  };

  return (
    <section className="mc-surface flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <ListTree className="h-4 w-4 text-cyan-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Task Pipeline
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(["all", "running", "pending", "completed", "failed", "blocked"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                filter === f
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:text-foreground"
              }`}
            >
              {f} <span className="opacity-60">{counts[f]}</span>
            </button>
          ))}
          {onCreateTask && (
            <button
              onClick={onCreateTask}
              className="ml-1 flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-cyan-300 transition-colors hover:bg-cyan-500/20"
              title="Inject a new task (N)"
            >
              <Plus className="h-2.5 w-2.5" /> new
            </button>
          )}
        </div>
      </div>
      <div className="mc-scroll max-h-[28rem] flex-1 overflow-y-auto p-2.5">
        {filtered.length === 0 ? (
          <div className="flex h-32 items-center justify-center font-mono text-xs text-muted-foreground">
            no tasks in this view
          </div>
        ) : (
          <ul className="space-y-1.5">
            <AnimatePresence initial={false}>
              {filtered.map((task) => (
                <TaskRow key={task.id} task={task} onOpenTask={onOpenTask} />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </section>
  );
}

function TaskRow({ task, onOpenTask }: { task: Task; onOpenTask?: (taskId: string) => void }) {
  const status = STATUS_META[task.status];
  const priority = PRIORITY_META[task.priority as TaskPriority] ?? PRIORITY_META.medium;
  const StatusIcon = status.icon;
  const running = task.status === "running";
  const agentName = task.assignedTo?.name ?? "unassigned";

  return (
    <motion.li
      id={`task-row-${task.id}`}
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => onOpenTask?.(task.id)}
      className={`rounded-md border ${priority.ring} bg-card/60 ${onOpenTask ? "cursor-pointer transition-colors hover:bg-card/80" : ""}`}
    >
      <div className="flex items-start gap-2.5 px-3 py-2">
        <StatusIcon
          className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${status.tone} ${running ? "animate-spin" : ""}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{task.title}</span>
            <span className={`font-mono text-[9px] uppercase ${KIND_TONE[task.kind] ?? "text-slate-400"}`}>
              {task.kind}
            </span>
          </div>
          {task.description && (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{task.description}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
            <span className={`uppercase ${priority.tone}`}>{priority.label}</span>
            <span className="flex items-center gap-1">
              <GitBranch className="h-2.5 w-2.5" /> {agentName}
            </span>
            <span>{relTime(task.createdAt)}</span>
            {task.dependsOn.length > 0 && (
              <span className="flex items-center gap-1 text-violet-300">
                <Lock className="h-2.5 w-2.5" /> {task.dependsOn.length} dep
              </span>
            )}
          </div>
        </div>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{task.progress}%</span>
      </div>
      <div className="h-0.5 w-full overflow-hidden bg-border/40">
        <motion.div
          className={`h-full ${
            task.status === "completed"
              ? "bg-emerald-400"
              : task.status === "failed"
                ? "bg-rose-400"
                : "bg-gradient-to-r from-cyan-400 to-violet-400"
          }`}
          initial={{ width: 0 }}
          animate={{ width: `${task.progress}%` }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        />
      </div>
    </motion.li>
  );
}

/** ApprovalsQueue — risk-gated human-in-the-loop decisions. */
export function ApprovalsQueue({
  onOpenBrief,
}: {
  onOpenBrief?: (approvalId: string) => void;
}) {
  const approvals = useMissionStore((s) => s.approvals);
  const pending = Object.values(approvals)
    .filter((a) => a.status === "pending")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const decided = Object.values(approvals)
    .filter((a) => a.status !== "pending")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 3);

  return (
    <section className="mc-surface flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <CheckSquare className="h-4 w-4 text-violet-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Approval Queue
          </h2>
        </div>
        <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[10px] text-violet-300">
          {pending.length} PENDING
        </span>
      </div>
      <div className="mc-scroll max-h-[28rem] flex-1 space-y-2 overflow-y-auto p-2.5">
        {pending.length === 0 && decided.length === 0 ? (
          <div className="flex h-24 items-center justify-center font-mono text-xs text-muted-foreground">
            no approvals
          </div>
        ) : null}
        {pending.map((a) => (
          <ApprovalCard key={a.id} id={a.id} title={a.title} summary={a.summary} risk={a.risk as TaskPriority} requester={a.requester} action={a.action} amount={a.amount} status="pending" createdAt={a.createdAt} decidedAt={null} onOpenBrief={onOpenBrief} />
        ))}
        {decided.length > 0 && (
          <div className="pt-1">
            <div className="px-1 pb-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              Recently decided
            </div>
            {decided.map((a) => (
              <ApprovalCard key={a.id} id={a.id} title={a.title} summary={a.summary} risk={a.risk as TaskPriority} requester={a.requester} action={a.action} amount={a.amount} status={a.status} createdAt={a.createdAt} decidedAt={a.decidedAt} onOpenBrief={onOpenBrief} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ApprovalCard({
  id,
  title,
  summary,
  risk,
  requester,
  action,
  amount,
  status,
  createdAt,
  decidedAt,
  onOpenBrief,
}: {
  id: string;
  title: string;
  summary: string | null;
  risk: TaskPriority;
  requester: string | null;
  action: string | null;
  amount: number | null;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt: string | null;
  onOpenBrief?: (approvalId: string) => void;
}) {
  const riskMeta = RISK_META[(risk as ApprovalRisk) ?? "medium"] ?? RISK_META.medium;
  const [busy, setBusy] = useState(false);

  async function decide(decision: "approved" | "denied") {
    setBusy(true);
    try {
      const res = await fetch(`/api/approvals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) throw new Error("decision failed");
      toast.success(`Approval ${decision}`, { description: title });
    } catch {
      toast.error("Failed to record decision");
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-md border bg-card/60 p-2.5 ${status === "pending" ? riskMeta.badge.split(" ").find((c) => c.startsWith("border")) ?? "border-border" : "border-border/50 opacity-60"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className={`min-w-0 ${onOpenBrief ? "cursor-pointer" : ""}`}
          onClick={() => onOpenBrief?.(id)}
          role={onOpenBrief ? "button" : undefined}
          tabIndex={onOpenBrief ? 0 : undefined}
          onKeyDown={(e) => {
            if (onOpenBrief && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              onOpenBrief(id);
            }
          }}
        >
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground hover:underline">{title}</span>
            <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${riskMeta.badge}`}>
              {riskMeta.label}
            </span>
          </div>
          {summary && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{summary}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 font-mono text-[10px] text-muted-foreground">
            {action && <span className="text-amber-300">▸ {action}</span>}
            {amount != null && <span>${amount.toLocaleString()}</span>}
            <span>by {requester ?? "—"}</span>
            <span>{relTime(createdAt)}</span>
            {decidedAt && <span className="text-emerald-300">· {relTime(decidedAt)}</span>}
          </div>
        </div>
      </div>
      {status === "pending" && (
        <div className="mt-2 flex items-center gap-1.5">
          <button
            onClick={() => decide("approved")}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
          >
            <CheckCircle2 className="h-3 w-3" /> Approve
          </button>
          <button
            onClick={() => decide("denied")}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-rose-300 transition-colors hover:bg-rose-500/20 disabled:opacity-50"
          >
            <XCircle className="h-3 w-3" /> Deny
          </button>
          {onOpenBrief && (
            <button
              onClick={() => onOpenBrief(id)}
              className="flex items-center justify-center gap-1 rounded border border-violet-500/40 bg-violet-500/10 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-violet-300 transition-colors hover:bg-violet-500/20"
              title="Open full brief + ask questions"
            >
              Brief →
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
