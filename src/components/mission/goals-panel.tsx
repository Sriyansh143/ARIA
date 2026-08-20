"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Target,
  RefreshCw,
  Loader2,
  Plus,
  CalendarClock,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  X,
  type LucideIcon,
} from "lucide-react";
import { FullScreenPanel } from "./full-screen-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Types ───────────────────────────────────────────────────────────

type GoalCategory =
  | "revenue"
  | "growth"
  | "operations"
  | "security"
  | "innovation";

type GoalStatus = "on_track" | "at_risk" | "behind" | "completed";

interface Goal {
  id: string;
  title: string;
  description?: string;
  category: GoalCategory;
  target: number;
  current: number;
  unit: string;
  deadline?: string;
  status: GoalStatus;
  owner: string;
}

interface GoalsResponse {
  goals: Goal[];
  ok: boolean;
  error?: string;
}

// ─── Style maps ──────────────────────────────────────────────────────

const CATEGORY_TONE: Record<GoalCategory, string> = {
  revenue: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  growth: "text-cyan-300 border-cyan-500/30 bg-cyan-500/10",
  operations: "text-violet-300 border-violet-500/30 bg-violet-500/10",
  security: "text-rose-300 border-rose-500/30 bg-rose-500/10",
  innovation: "text-amber-300 border-amber-500/30 bg-amber-500/10",
};

const STATUS_META: Record<
  GoalStatus,
  { tone: string; icon: LucideIcon; label: string }
> = {
  on_track: {
    tone: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
    icon: CheckCircle2,
    label: "On Track",
  },
  at_risk: {
    tone: "text-amber-300 border-amber-500/30 bg-amber-500/10",
    icon: AlertTriangle,
    label: "At Risk",
  },
  behind: {
    tone: "text-rose-300 border-rose-500/30 bg-rose-500/10",
    icon: AlertOctagon,
    label: "Behind",
  },
  completed: {
    tone: "text-violet-300 border-violet-500/30 bg-violet-500/10",
    icon: CheckCircle2,
    label: "Completed",
  },
};

const STATUS_DOT: Record<GoalStatus, string> = {
  on_track: "bg-emerald-400",
  at_risk: "bg-amber-400",
  behind: "bg-rose-400",
  completed: "bg-violet-400",
};

const CATEGORY_OPTIONS: { value: GoalCategory; label: string }[] = [
  { value: "revenue", label: "Revenue" },
  { value: "growth", label: "Growth" },
  { value: "operations", label: "Operations" },
  { value: "security", label: "Security" },
  { value: "innovation", label: "Innovation" },
];

// ─── Helpers ─────────────────────────────────────────────────────────

function progressPct(goal: Goal): number {
  if (goal.target <= 0) {
    // Target-zero goal: 100% when current is 0, else 0.
    return goal.current <= 0 ? 100 : 0;
  }
  return Math.max(0, Math.min(100, Math.round((goal.current / goal.target) * 100)));
}

function daysRemaining(deadline?: string): number | null {
  if (!deadline) return null;
  const t = Date.parse(deadline);
  if (!Number.isFinite(t)) return null;
  const diff = t - Date.now();
  return Math.ceil(diff / 86_400_000);
}

function formatCurrent(value: number, unit: string): string {
  if (unit === "$") {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1000).toFixed(1)}k`;
    return `$${value}`;
  }
  if (unit === "%") return `${value}%`;
  return `${value} ${unit}`;
}

// ─── Component ───────────────────────────────────────────────────────

export function GoalsPanel() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchGoals = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading((p) => p || true);
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/goals", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json().catch(() => ({}))) as GoalsResponse;
      if (data.error) {
        setError(data.error);
      }
      setGoals(data.goals ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load goals";
      setError(msg);
      if (!opts?.silent) {
        toast.error("Failed to load goals", { description: msg });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchGoals();
  }, [fetchGoals]);

  // ── Summary stats ─────────────────────────────────────────────────
  const summary = useMemo(() => {
    const counts: Record<GoalStatus, number> = {
      on_track: 0,
      at_risk: 0,
      behind: 0,
      completed: 0,
    };
    for (const g of goals) {
      counts[g.status] += 1;
    }
    return { total: goals.length, ...counts };
  }, [goals]);

  const handleCreated = useCallback(
    (newGoal: Goal) => {
      // Prepend the new goal; the server already assigned a status.
      setGoals((prev) => {
        // Avoid dupes if the server already returned it.
        if (prev.some((g) => g.id === newGoal.id)) return prev;
        return [newGoal, ...prev];
      });
    },
    [],
  );

  return (
    <FullScreenPanel
      title="Goals & OKRs"
      icon={<Target className="h-3.5 w-3.5 text-violet-300" />}
      actions={
        <>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            aria-label="Add a new goal"
            title="Add Goal"
            className="flex h-7 items-center gap-1 rounded-md border border-border/60 bg-surface-2/60 px-2 font-mono text-[10px] font-medium text-muted-foreground transition-colors hover:border-violet-500/40 hover:text-violet-200"
          >
            <Plus className="h-3 w-3" />
            Add Goal
          </button>
          <button
            type="button"
            onClick={() => void fetchGoals()}
            disabled={refreshing}
            aria-label="Refresh goals"
            title="Refresh"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </>
      }
    >
      <div className="space-y-3 p-3 sm:p-4">
        {/* ── Summary bar ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <SummaryStat
            icon={<Target className="h-3 w-3" />}
            label="Total"
            value={summary.total}
            tone="text-foreground"
          />
          <SummaryStat
            icon={<CheckCircle2 className="h-3 w-3" />}
            label="On Track"
            value={summary.on_track}
            tone="text-emerald-300"
          />
          <SummaryStat
            icon={<AlertTriangle className="h-3 w-3" />}
            label="At Risk"
            value={summary.at_risk}
            tone="text-amber-300"
          />
          <SummaryStat
            icon={<AlertOctagon className="h-3 w-3" />}
            label="Behind"
            value={summary.behind}
            tone="text-rose-300"
          />
          <SummaryStat
            icon={<CheckCircle2 className="h-3 w-3" />}
            label="Completed"
            value={summary.completed}
            tone="text-violet-300"
          />
        </div>

        {/* ── Error banner ────────────────────────────────────────── */}
        {error && (
          <div className="rounded border border-rose-500/30 bg-rose-500/5 px-3 py-1.5 font-mono text-[10px] text-rose-300">
            load failed: {error}
          </div>
        )}

        {/* ── Body ────────────────────────────────────────────────── */}
        {loading ? (
          <GoalsSkeleton />
        ) : goals.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            {goals.map((goal) => (
              <GoalCard key={goal.id} goal={goal} />
            ))}
          </div>
        )}
      </div>

      {/* ── Add Goal Dialog ─────────────────────────────────────── */}
      <AddGoalDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={handleCreated}
      />
    </FullScreenPanel>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

function SummaryStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-surface-2/40 p-2.5">
      <div className="flex items-center gap-1.5">
        <span className={tone}>{icon}</span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className={`mt-1 font-mono text-xl font-semibold tabular-nums ${tone}`}>
        {value}
      </div>
    </div>
  );
}

function GoalCard({ goal }: { goal: Goal }) {
  const pct = progressPct(goal);
  const status = STATUS_META[goal.status];
  const StatusIcon = status.icon;
  const days = daysRemaining(goal.deadline);
  const overBudget = days !== null && days < 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mc-glow-card relative flex flex-col gap-2 rounded-lg border border-border/60 bg-surface-2/40 p-3"
    >
      {/* Header: title + category badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-mono text-[12px] font-semibold text-foreground">
            {goal.title}
          </h3>
          {goal.description && (
            <p className="mt-0.5 line-clamp-2 font-mono text-[9px] text-muted-foreground/80">
              {goal.description}
            </p>
          )}
        </div>
        <Badge
          variant="outline"
          className={`shrink-0 px-1.5 py-0 font-mono text-[8px] font-bold uppercase ${CATEGORY_TONE[goal.category]}`}
        >
          {goal.category}
        </Badge>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-[10px] tabular-nums text-foreground">
            {formatCurrent(goal.current, goal.unit)}
          </span>
          <span className="font-mono text-[9px] text-muted-foreground">
            / {formatCurrent(goal.target, goal.unit)}
          </span>
        </div>
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-border/30">
          <motion.div
            className={`h-full rounded-full ${STATUS_DOT[goal.status]}`}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>
        <div className="flex items-center justify-between font-mono text-[9px] text-muted-foreground">
          <span>{pct}% complete</span>
          {goal.deadline && (
            <span
              className={`flex items-center gap-1 ${
                overBudget ? "text-rose-300" : days !== null && days <= 7 ? "text-amber-300" : ""
              }`}
            >
              <CalendarClock className="h-2.5 w-2.5" />
              {overBudget
                ? `${Math.abs(days!)}d overdue`
                : days !== null
                  ? `${days}d left`
                  : ""}
            </span>
          )}
        </div>
      </div>

      {/* Footer: status + owner */}
      <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-1.5">
        <Badge
          variant="outline"
          className={`flex items-center gap-1 px-1.5 py-0 font-mono text-[8px] font-bold uppercase ${status.tone}`}
        >
          <StatusIcon className="h-2.5 w-2.5" />
          {status.label}
        </Badge>
        <span className="font-mono text-[9px] text-muted-foreground">
          owner: <span className="text-violet-300/80">{goal.owner}</span>
        </span>
      </div>
    </motion.div>
  );
}

function AddGoalDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (g: Goal) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<GoalCategory>("operations");
  const [target, setTarget] = useState("100");
  const [unit, setUnit] = useState("tasks");
  const [deadline, setDeadline] = useState("");
  const [owner, setOwner] = useState("Ops");
  const [saving, setSaving] = useState(false);

  const reset = useCallback(() => {
    setTitle("");
    setDescription("");
    setCategory("operations");
    setTarget("100");
    setUnit("tasks");
    setDeadline("");
    setOwner("Ops");
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!title.trim()) {
        toast.error("Title is required");
        return;
      }
      const targetNum = parseFloat(target);
      if (!Number.isFinite(targetNum) || targetNum < 0) {
        toast.error("Target must be a non-negative number");
        return;
      }
      setSaving(true);
      try {
        // Build the new goal locally, derive status with the same rules
        // the server uses (current=0 initially, so status = behind
        // unless target is 0).
        const id = `g-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 6)}`;
        const newGoal: Goal = {
          id,
          title: title.trim(),
          description: description.trim() || undefined,
          category,
          target: targetNum,
          current: 0,
          unit: unit.trim() || "items",
          deadline: deadline || undefined,
          status:
            targetNum === 0
              ? "completed"
              : "behind",
          owner: owner.trim() || "Unassigned",
        };
        // POST the full array (existing + new) — the API replaces.
        // We need the existing goals to merge; fetch them first.
        const existingRes = await fetch("/api/goals", { cache: "no-store" });
        const existing = (await existingRes.json().catch(() => ({
          goals: [],
        }))) as GoalsResponse;
        const merged = [...(existing.goals ?? []), newGoal];
        const res = await fetch("/api/goals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goals: merged }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json().catch(() => ({}))) as { ok: boolean };
        if (!data.ok) throw new Error("server rejected goal");
        toast.success("Goal created", { description: newGoal.title });
        onCreated(newGoal);
        reset();
        onOpenChange(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to create goal";
        toast.error("Failed to create goal", { description: msg });
      } finally {
        setSaving(false);
      }
    },
    [title, description, category, target, unit, deadline, owner, onCreated, reset, onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] border-border/60 bg-background">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-wider text-foreground">
            <Target className="h-3.5 w-3.5 text-violet-300" />
            New Strategic Goal
          </DialogTitle>
          <DialogDescription className="font-mono text-[10px] text-muted-foreground">
            Define a measurable objective. Status is auto-derived from progress.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="goal-title" className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Title
            </Label>
            <Input
              id="goal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Reach 10k MAU"
              maxLength={120}
              required
              className="font-mono text-[11px]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="goal-desc" className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Description (optional)
            </Label>
            <Input
              id="goal-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief context"
              maxLength={240}
              className="font-mono text-[11px]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="goal-category" className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Category
              </Label>
              <Select value={category} onValueChange={(v) => setCategory(v as GoalCategory)}>
                <SelectTrigger id="goal-category" className="font-mono text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="font-mono text-[11px]">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="goal-owner" className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Owner
              </Label>
              <Input
                id="goal-owner"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="e.g. CFO"
                maxLength={60}
                className="font-mono text-[11px]"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="goal-target" className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Target
              </Label>
              <Input
                id="goal-target"
                type="number"
                min="0"
                step="any"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                required
                className="font-mono text-[11px]"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="goal-unit" className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Unit
              </Label>
              <Input
                id="goal-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="$, %, deals, agents…"
                maxLength={20}
                className="font-mono text-[11px]"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="goal-deadline" className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Deadline (optional)
            </Label>
            <Input
              id="goal-deadline"
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="font-mono text-[11px]"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="font-mono text-[10px]"
            >
              <X className="h-3 w-3" />
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={saving || !title.trim()}
              className="font-mono text-[10px]"
            >
              {saving ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Plus className="h-3 w-3" />
                  Create Goal
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GoalsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="space-y-2 rounded-lg border border-border/40 bg-surface-2/30 p-3"
        >
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-2 w-1/2" />
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <Target className="h-7 w-7 text-muted-foreground/30" />
      <div className="font-mono text-[11px] font-medium text-muted-foreground">
        No goals set — create your first strategic objective
      </div>
      <div className="max-w-sm px-4 font-mono text-[9px] text-muted-foreground/60">
        Click &quot;Add Goal&quot; above to define a measurable OKR. Default
        goals will also be auto-derived from the live system state.
      </div>
    </div>
  );
}

export default GoalsPanel;
