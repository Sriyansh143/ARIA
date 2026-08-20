"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { useMissionStore } from "@/stores/mission-store";
import { AGENT_STATUS_META, type Agent, type Task } from "@/lib/types";
import { toast } from "sonner";
import {
  Search,
  Cpu,
  ListTree,
  Puzzle,
  Bell,
  Activity,
  CornerDownLeft,
  Command,
  ShieldCheck,
  Plus,
  Radio,
  Zap,
  Workflow,
  DollarSign,
  MessageSquare,
  Scale,
  Network,
  HeartPulse,
  Sparkles,
  Trophy,
  TrendingDown,
  Grid3x3,
  CalendarDays,
  Brain,
  FileDown,
  History,
  Share2,
} from "lucide-react";

interface CommandPaletteProps {
  /** When an agent is selected, open its detail drawer. */
  onOpenAgent: (agentId: string) => void;
  /** When a "jump to" action fires, scroll the target into view. */
  onJumpTo: (target: string) => void;
  /** When "create task" is selected, open the task composer. */
  onCreateTask?: () => void;
}

/**
 * CommandPalette — Cmd+K / Ctrl+K quick-action launcher.
 *
 * Fuzzy-searchable across the live fleet, task pipeline, and skills
 * registry, plus one-shot operator actions (ack all alerts, force
 * heartbeat, jump-to-section navigation). Built on cmdk for keyboard
 * ergonomics; blends into the mission-control dark aesthetic.
 */
export function CommandPalette({ onOpenAgent, onJumpTo, onCreateTask }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const agents = useMissionStore((s) => s.agents);
  const tasks = useMissionStore((s) => s.tasks);
  const skills = useMissionStore((s) => s.skills);
  const alerts = useMissionStore((s) => s.alerts);

  // Global hotkey: Cmd+K (mac) / Ctrl+K (others). Also `/` when not typing.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "/" && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const agentList = useMemo(() => Object.values(agents), [agents]);
  const taskList = useMemo(
    () => Object.values(tasks).filter((t) => t.status !== "completed").slice(0, 12),
    [tasks]
  );
  const unackedCount = useMemo(() => alerts.filter((a) => !a.ack).length, [alerts]);

  const ackAll = useCallback(async () => {
    const targets = alerts.filter((a) => !a.ack);
    if (targets.length === 0) {
      toast.info("No alerts to acknowledge");
      return;
    }
    await Promise.all(
      targets.map((a) =>
        fetch(`/api/alerts/${a.id}/ack`, { method: "PATCH" }).catch(() => {})
      )
    );
    toast.success(`Acknowledged ${targets.length} alert${targets.length === 1 ? "" : "s"}`);
    setOpen(false);
  }, [alerts]);

  const sections = [
    { id: "agent-fleet", label: "Agent Fleet", icon: Cpu },
    { id: "agent-fleet-network", label: "Agent Fleet Network (Live Flows)", icon: Radio },
    { id: "task-dag", label: "Task Dependency Graph", icon: Workflow },
    { id: "task-pipeline", label: "Task Pipeline", icon: ListTree },
    { id: "approval-queue", label: "Approval Queue", icon: ShieldCheck },
    { id: "system-health", label: "System Health", icon: HeartPulse },
    { id: "telemetry", label: "Telemetry", icon: Activity },
    { id: "financial", label: "Financial Operations", icon: DollarSign },
    { id: "revenue-forecast", label: "Revenue Forecast", icon: Sparkles },
    { id: "cost-profit", label: "Cost / Profit Analysis", icon: Scale },
    { id: "task-velocity", label: "Task Velocity & Burndown", icon: TrendingDown },
    { id: "capability-matrix", label: "Agent Capability Matrix", icon: Grid3x3 },
    { id: "activity-heatmap", label: "Activity Heatmap", icon: CalendarDays },
    { id: "live-log-stream", label: "Live Log Stream", icon: Radio },
    { id: "agent-comm", label: "Agent Communication", icon: MessageSquare },
    { id: "agent-network", label: "Agent Network Graph", icon: Network },
    { id: "system-alerts", label: "System Alerts", icon: Bell },
    { id: "cron-registry", label: "Cron Registry", icon: Zap },
    { id: "skills-registry", label: "Skills Registry", icon: Puzzle },
    { id: "leaderboard", label: "Agent Leaderboard", icon: Trophy },
    { id: "task-optimizer", label: "Task Assignment Optimizer", icon: Brain },
    { id: "export", label: "Export & Reports", icon: FileDown },
    { id: "mission-timeline", label: "Mission Timeline", icon: History },
    { id: "collaboration-graph", label: "Agent Collaboration Graph", icon: Share2 },
    { id: "notification-prefs", label: "Notification Preferences", icon: Bell },
    { id: "department-network", label: "Department Network", icon: Network },
    { id: "memory-network", label: "Memory Network", icon: Brain },
  ];

  const jump = (id: string) => {
    onJumpTo(id);
    setOpen(false);
  };

  if (!open) {
    // Render a subtle hint chip so operators discover the shortcut.
    return (
      <button
        onClick={() => setOpen(true)}
        className="hidden items-center gap-1.5 rounded-md border border-border/60 bg-card/40 px-2 py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground lg:flex"
        title="Open command palette (Cmd+K)"
      >
        <Command className="h-3 w-3" />
        <span>K</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 backdrop-blur-sm p-4 pt-[12vh]">
      <CommandPrimitive
        label="Mission Command Palette"
        className="mc-surface-elevated mx-auto w-full max-w-xl overflow-hidden rounded-xl border-border"
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          }
        }}
      >
        {/* Search input */}
        <div className="flex items-center gap-2.5 border-b border-border/60 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <CommandPrimitive.Input
            autoFocus
            placeholder="Search agents, tasks, skills, or run a command…"
            value={query}
            onValueChange={setQuery}
            className="flex-1 bg-transparent font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="shrink-0 rounded border border-border/60 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <CommandPrimitive.List className="mc-scroll max-h-[52vh] overflow-y-auto p-2">
          <CommandPrimitive.Empty className="py-8 text-center font-mono text-xs text-muted-foreground">
            No matches for "{query}"
          </CommandPrimitive.Empty>

          {/* Quick actions */}
          <CommandPrimitive.Group heading="Actions" className="mb-1">
            <CommandPrimitive.Item
              onSelect={ackAll}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 font-mono text-xs text-foreground aria-selected:bg-primary/10 aria-selected:text-primary"
            >
              <Bell className="h-3.5 w-3.5 text-rose-300" />
              <span>Ack all alerts</span>
              {unackedCount > 0 && (
                <span className="ml-auto rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[9px] text-rose-300">
                  {unackedCount} pending
                </span>
              )}
            </CommandPrimitive.Item>
            {onCreateTask && (
              <CommandPrimitive.Item
                onSelect={() => {
                  onCreateTask();
                  setOpen(false);
                }}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 font-mono text-xs text-foreground aria-selected:bg-primary/10 aria-selected:text-primary"
              >
                <Plus className="h-3.5 w-3.5 text-cyan-300" />
                <span>Inject new task</span>
                <kbd className="ml-auto rounded border border-border/60 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                  N
                </kbd>
              </CommandPrimitive.Item>
            )}
            <CommandPrimitive.Item
              onSelect={() => {
                try {
                  localStorage.removeItem("aria-onboarding-completed");
                } catch {
                  /* ignore */
                }
                window.location.reload();
              }}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 font-mono text-xs text-foreground aria-selected:bg-primary/10 aria-selected:text-primary"
            >
              <Sparkles className="h-3.5 w-3.5 text-violet-300" />
              <span>Restart onboarding tour</span>
            </CommandPrimitive.Item>
          </CommandPrimitive.Group>

          {/* Jump to section */}
          {query === "" || sections.some((s) => s.label.toLowerCase().includes(query.toLowerCase())) ? (
            <CommandPrimitive.Group heading="Jump to" className="mb-1">
              {sections
                .filter((s) => query === "" || s.label.toLowerCase().includes(query.toLowerCase()))
                .map((s) => {
                  const Icon = s.icon;
                  return (
                    <CommandPrimitive.Item
                      key={s.id}
                      onSelect={() => jump(s.id)}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 font-mono text-xs text-foreground aria-selected:bg-primary/10 aria-selected:text-primary"
                    >
                      <Icon className="h-3.5 w-3.5 text-cyan-300" />
                      <span>{s.label}</span>
                      <CornerDownLeft className="ml-auto h-3 w-3 text-muted-foreground/50" />
                    </CommandPrimitive.Item>
                  );
                })}
            </CommandPrimitive.Group>
          ) : null}

          {/* Agents */}
          {(query === "" || agentList.some((a) => matches(a, query)))
            ? filteredGroup({
                heading: "Agents",
                query,
                items: agentList,
                matches: (a, q) => matches(a, q),
                render: (a: Agent) => (
                  <AgentResult key={a.id} agent={a} onOpen={() => { onOpenAgent(a.id); setOpen(false); }} />
                ),
              })
            : null}

          {/* Active tasks */}
          {(query === "" || taskList.some((t) => matches(t, query)))
            ? filteredGroup({
                heading: "Active Tasks",
                query,
                items: taskList,
                matches: (t, q) => matches(t, q),
                render: (t: Task) => (
                  <CommandPrimitive.Item
                    key={t.id}
                    onSelect={() => jump("task-pipeline")}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 font-mono text-xs text-foreground aria-selected:bg-primary/10 aria-selected:text-primary"
                  >
                    <ListTree className="h-3.5 w-3.5 text-amber-300" />
                    <span className="truncate">{t.title}</span>
                    <span className="ml-auto shrink-0 text-[9px] text-muted-foreground">{t.progress}%</span>
                  </CommandPrimitive.Item>
                ),
              })
            : null}

          {/* Skills */}
          {(query === "" || skills.some((s) => matches(s, query)))
            ? filteredGroup({
                heading: "Skills",
                query,
                items: skills,
                matches: (s, q) => matches(s, q),
                render: (s) => (
                  <CommandPrimitive.Item
                    key={s.id}
                    onSelect={() => jump("skills-registry")}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 font-mono text-xs text-foreground aria-selected:bg-primary/10 aria-selected:text-primary"
                  >
                    <Puzzle className="h-3.5 w-3.5 text-violet-300" />
                    <span className="truncate">{s.name}</span>
                    <span className="ml-auto shrink-0 text-[9px] text-muted-foreground">/{s.slug}</span>
                  </CommandPrimitive.Item>
                ),
              })
            : null}
        </CommandPrimitive.List>

        {/* Footer hint */}
        <div className="flex items-center justify-between border-t border-border/60 px-3 py-2 font-mono text-[9px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <CornerDownLeft className="h-2.5 w-2.5" /> select
          </span>
          <span>ARIA·command palette</span>
        </div>
      </CommandPrimitive>
    </div>
  );
}

function AgentResult({ agent, onOpen }: { agent: Agent; onOpen: () => void }) {
  const meta = AGENT_STATUS_META[agent.status] ?? AGENT_STATUS_META.idle;
  return (
    <CommandPrimitive.Item
      onSelect={onOpen}
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 font-mono text-xs text-foreground aria-selected:bg-primary/10 aria-selected:text-primary"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
      <span className="truncate">{agent.name}</span>
      <span className="shrink-0 text-[9px] uppercase text-muted-foreground">{agent.role}</span>
      <span className={`ml-auto shrink-0 text-[9px] uppercase ${meta.tone}`}>{meta.label}</span>
    </CommandPrimitive.Item>
  );
}

/** Generic filtered group renderer — keeps the result list DRY. */
function filteredGroup<T>({
  heading,
  query,
  items,
  matches: matchFn,
  render,
}: {
  heading: string;
  query: string;
  items: T[];
  matches: (item: T, q: string) => boolean;
  render: (item: T) => React.ReactNode;
}) {
  const filtered = query === "" ? items : items.filter((it) => matchFn(it, query));
  if (filtered.length === 0) return null;
  return (
    <CommandPrimitive.Group heading={heading} className="mb-1">
      {filtered.slice(0, 8).map(render)}
    </CommandPrimitive.Group>
  );
}

/** Lightweight fuzzy match — checks name/title/slug/role/description. */
function matches(obj: Record<string, unknown>, q: string): boolean {
  const ql = q.toLowerCase();
  const haystack = [obj.name, obj.title, obj.slug, obj.role, obj.description, obj.label]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(ql);
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || t.isContentEditable;
}
