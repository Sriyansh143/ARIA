"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import {
  AGENT_STATUS_META,
  PRIORITY_META,
  DEAL_STAGE_META,
  type Agent,
  type Task,
  type Deal,
  type AgentStatus,
  type TaskPriority,
  type DealStage,
} from "@/lib/types";
import { compact, relTime } from "@/hooks/use-clock";
import {
  Search,
  X,
  Cpu,
  ListTree,
  Briefcase,
  Puzzle,
  ScrollText,
  CornerDownLeft,
  Hash,
} from "lucide-react";

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenAgent: (agentId: string) => void;
  onOpenDeal: (dealId: string) => void;
  onOpenTask: (taskId: string) => void;
}

type ResultCategory = "agents" | "tasks" | "deals" | "skills" | "logs";

interface SearchResult {
  id: string;
  category: ResultCategory;
  title: string;
  subtitle: string;
  meta: string;
  onSelect: () => void;
}

/**
 * GlobalSearch — unified fuzzy search across all mission entities.
 *
 * Triggered by `Shift+/` (or the `/` key when not typing), this overlay
 * searches across agents, tasks, deals, skills, and logs simultaneously.
 * Results are grouped by category with counts; arrow-key navigation +
 * Enter selects. Clicking a result opens the appropriate detail drawer
 * or scrolls to the target panel.
 *
 * This is the "find anything" affordance — critical for operators
 * navigating a 19-panel dashboard.
 */
export function GlobalSearch({
  open,
  onOpenChange,
  onOpenAgent,
  onOpenDeal,
  onOpenTask,
}: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);

  const agents = useMissionStore((s) => s.agents);
  const tasks = useMissionStore((s) => s.tasks);
  const deals = useMissionStore((s) => s.deals);
  const skills = useMissionStore((s) => s.skills);
  const logs = useMissionStore((s) => s.logs);

  const close = useCallback(() => {
    onOpenChange(false);
    setQuery("");
    setSelectedIdx(0);
  }, [onOpenChange]);

  const results = useMemo<SearchResult[]>(() => {
    if (query.trim().length < 1) return [];
    const q = query.toLowerCase();

    const agentResults: SearchResult[] = Object.values(agents)
      .filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.role.toLowerCase().includes(q) ||
          a.capabilities.some((c) => c.toLowerCase().includes(q))
      )
      .slice(0, 5)
      .map((a) => ({
        id: a.id,
        category: "agents" as const,
        title: a.name,
        subtitle: `${a.role} · ${a.model ?? "—"}`,
        meta: AGENT_STATUS_META[a.status as AgentStatus]?.label ?? a.status,
        onSelect: () => onOpenAgent(a.id),
      }));

    const taskResults: SearchResult[] = Object.values(tasks)
      .filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.description?.toLowerCase().includes(q) ?? false) ||
          t.kind.toLowerCase().includes(q) ||
          t.priority.toLowerCase().includes(q)
      )
      .slice(0, 6)
      .map((t) => ({
        id: t.id,
        category: "tasks" as const,
        title: t.title,
        subtitle: t.description ?? t.kind,
        meta: `${PRIORITY_META[t.priority as TaskPriority]?.label ?? t.priority} · ${t.status} · ${t.progress}%`,
        onSelect: () => onOpenTask(t.id),
      }));

    const dealResults: SearchResult[] = Object.values(deals)
      .filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          (d.counterparty?.toLowerCase().includes(q) ?? false) ||
          d.stage.toLowerCase().includes(q)
      )
      .slice(0, 5)
      .map((d) => ({
        id: d.id,
        category: "deals" as const,
        title: d.title,
        subtitle: d.counterparty ?? "—",
        meta: `$${compact(d.value)} · ${DEAL_STAGE_META[d.stage as DealStage]?.label ?? d.stage} · ${d.probability}%`,
        onSelect: () => onOpenDeal(d.id),
      }));

    const skillResults: SearchResult[] = skills
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.slug.toLowerCase().includes(q) ||
          (s.description?.toLowerCase().includes(q) ?? false)
      )
      .slice(0, 4)
      .map((s) => ({
        id: s.id,
        category: "skills" as const,
        title: s.name,
        subtitle: `/${s.slug}`,
        meta: `${s.invocations.toLocaleString()} calls · ${Math.round(s.successRate * 100)}%`,
        onSelect: () => {},
      }));

    const logResults: SearchResult[] = logs
      .filter((l) => l.message.toLowerCase().includes(q))
      .slice(0, 6)
      .map((l) => ({
        id: l.id,
        category: "logs" as const,
        title: l.message,
        subtitle: l.agentId ?? "system",
        meta: `${l.level} · ${relTime(l.createdAt)}`,
        onSelect: () => {},
      }));

    return [...agentResults, ...taskResults, ...dealResults, ...skillResults, ...logResults];
  }, [query, agents, tasks, deals, skills, logs, onOpenAgent, onOpenDeal, onOpenTask]);

  // Keyboard navigation (declared after `results` so it's in scope).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const result = results[selectedIdx];
        if (result) {
          result.onSelect();
          close();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const allResults = results;
  const grouped = useMemo(() => {
    const g: Record<ResultCategory, SearchResult[]> = {
      agents: [],
      tasks: [],
      deals: [],
      skills: [],
      logs: [],
    };
    for (const r of results) g[r.category].push(r);
    return g;
  }, [results]);

  const categoryMeta: Record<ResultCategory, { label: string; icon: typeof Cpu; tone: string }> = {
    agents: { label: "Agents", icon: Cpu, tone: "text-cyan-300" },
    tasks: { label: "Tasks", icon: ListTree, tone: "text-amber-300" },
    deals: { label: "Deals", icon: Briefcase, tone: "text-emerald-300" },
    skills: { label: "Skills", icon: Puzzle, tone: "text-violet-300" },
    logs: { label: "Logs", icon: ScrollText, tone: "text-slate-300" },
  };

  const order: ResultCategory[] = ["agents", "tasks", "deals", "skills", "logs"];

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={close}
            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm"
          />
          <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[10vh]">
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: -8 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="mc-surface-elevated mx-auto w-full max-w-2xl overflow-hidden"
              role="dialog"
              aria-label="Global search"
            >
              {/* Search input */}
              <div className="flex items-center gap-2.5 border-b border-border/60 px-4 py-3">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelectedIdx(0);
                  }}
                  placeholder="Search agents, tasks, deals, skills, logs…"
                  className="flex-1 bg-transparent font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                <kbd className="shrink-0 rounded border border-border/60 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                  ESC
                </kbd>
              </div>

              {/* Results */}
              <div className="mc-scroll max-h-[56vh] overflow-y-auto p-2">
                {query.trim().length === 0 ? (
                  <div className="py-12 text-center">
                    <Hash className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
                    <p className="font-mono text-xs text-muted-foreground">
                      Type to search across all mission entities
                    </p>
                    <div className="mt-3 flex flex-wrap justify-center gap-2 font-mono text-[9px] text-muted-foreground/60">
                      <span className="rounded border border-border/40 px-1.5 py-0.5">agents</span>
                      <span className="rounded border border-border/40 px-1.5 py-0.5">tasks</span>
                      <span className="rounded border border-border/40 px-1.5 py-0.5">deals</span>
                      <span className="rounded border border-border/40 px-1.5 py-0.5">skills</span>
                      <span className="rounded border border-border/40 px-1.5 py-0.5">logs</span>
                    </div>
                  </div>
                ) : allResults.length === 0 ? (
                  <div className="py-12 text-center font-mono text-xs text-muted-foreground">
                    No matches for &ldquo;{query}&rdquo;
                  </div>
                ) : (
                  order.map((cat) => {
                    const items = grouped[cat];
                    if (items.length === 0) return null;
                    const meta = categoryMeta[cat];
                    const Icon = meta.icon;
                    return (
                      <div key={cat} className="mb-1">
                        <div className="flex items-center gap-1.5 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                          <Icon className={`h-2.5 w-2.5 ${meta.tone}`} />
                          {meta.label}
                          <span className="opacity-50">{items.length}</span>
                        </div>
                        {items.map((result) => {
                          const idx = allResults.indexOf(result);
                          const isSelected = idx === selectedIdx;
                          return (
                            <button
                              key={`${cat}-${result.id}`}
                              onMouseEnter={() => setSelectedIdx(idx)}
                              onClick={() => {
                                result.onSelect();
                                close();
                              }}
                              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                                isSelected ? "bg-primary/10" : "hover:bg-card/40"
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className={`truncate font-mono text-xs ${isSelected ? "text-primary" : "text-foreground"}`}>
                                  {result.title}
                                </div>
                                <div className="truncate font-mono text-[10px] text-muted-foreground">
                                  {result.subtitle}
                                </div>
                              </div>
                              <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                                {result.meta}
                              </span>
                              {isSelected && (
                                <CornerDownLeft className="h-3 w-3 shrink-0 text-primary" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between border-t border-border/60 px-3 py-2 font-mono text-[9px] text-muted-foreground">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <kbd className="rounded border border-border/60 px-1 py-0.5">↑↓</kbd> navigate
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="rounded border border-border/60 px-1 py-0.5">↵</kbd> select
                  </span>
                </div>
                <span>{allResults.length} results</span>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

export { X };
