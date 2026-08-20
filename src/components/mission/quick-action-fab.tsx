"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Plus,
  ListPlus,
  DollarSign,
  Gauge,
  HandCoins,
  Command,
  X,
  Loader2,
  type LucideIcon,
} from "lucide-react";

/**
 * QuickActionFAB — floating action button fixed bottom-right.
 *
 * Collapsed: a single circular violet button with a Plus icon.
 * Expanded: a staggered column of quick actions (New Task, Run Revenue
 * Cycle, Capture KPI, Run Cash-Claw Sweep, Open Command Palette).
 *
 * Hidden on mobile (`hidden sm:flex`) — mobile users get the bottom nav.
 * Positioned at `bottom-20 right-4 z-40` so it sits above the footer and
 * the mobile bottom nav without overlapping either.
 *
 * Task ID: FEATURES-TICKER-FAB (Task 2).
 */

interface QuickAction {
  id: string;
  label: string;
  icon: LucideIcon;
  run: () => void | Promise<void>;
}

interface QuickActionFABProps {
  onCreateTask: () => void;
}

export function QuickActionFAB({ onCreateTask }: QuickActionFABProps) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const callApi = useCallback(
    async (url: string, method: string, label: string, id: string) => {
      setBusyId(id);
      const tid = toast.loading(`Running: ${label}…`);
      try {
        const res = await fetch(url, { method, headers: { "Content-Type": "application/json" } });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}${txt ? ` — ${txt.slice(0, 120)}` : ""}`);
        }
        const data = await res.json().catch(() => ({}));
        toast.success(`${label} succeeded`, {
          id: tid,
          description: (data && (data.message || data.summary)) || undefined,
        });
      } catch (err) {
        toast.error(`${label} failed`, {
          id: tid,
          description: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        setBusyId(null);
      }
    },
    []
  );

  const actions: QuickAction[] = [
    {
      id: "new-task",
      label: "New Task",
      icon: ListPlus,
      run: () => {
        setOpen(false);
        onCreateTask();
      },
    },
    {
      id: "revenue-cycle",
      label: "Run Revenue Cycle",
      icon: DollarSign,
      run: () => callApi("/api/revenue-engine", "POST", "Revenue cycle", "revenue-cycle"),
    },
    {
      id: "capture-kpi",
      label: "Capture KPI",
      icon: Gauge,
      run: () => callApi("/api/kpis", "POST", "KPI capture", "capture-kpi"),
    },
    {
      id: "cash-claw",
      label: "Run Cash-Claw Sweep",
      icon: HandCoins,
      run: () => callApi("/api/cash-claw", "POST", "Cash-Claw sweep", "cash-claw"),
    },
    {
      id: "cmd-palette",
      label: "Open Command Palette",
      icon: Command,
      run: () => {
        setOpen(false);
        // Trigger the existing cmd+k listener on the CommandPalette.
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "k", metaKey: true })
        );
      },
    },
  ];

  return (
    <div
      className="z-40 flex flex-col items-end gap-2"
      style={{ position: "fixed", bottom: "8rem", right: "1rem", display: window.innerWidth < 640 ? "none" : "flex" }}
    >
      {/* Expanded action stack — rendered above the FAB */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="flex flex-col items-end gap-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {actions.map((action, i) => {
              const Icon = action.icon;
              const isBusy = busyId === action.id;
              return (
                <motion.button
                  key={action.id}
                  type="button"
                  onClick={() => action.run()}
                  disabled={isBusy}
                  className="group flex items-center gap-2 rounded-lg border border-border/70 bg-card/95 px-3 py-2 shadow-lg backdrop-blur-xl transition-colors hover:border-violet-500/40 hover:bg-violet-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                  initial={{ opacity: 0, y: 12, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.95 }}
                  transition={{
                    duration: 0.18,
                    delay: i * 0.04,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  {isBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin text-violet-300" />
                  ) : (
                    <Icon className="h-4 w-4 text-violet-300 transition-colors group-hover:text-violet-200" />
                  )}
                  <span className="font-mono text-[11px] font-medium text-foreground">
                    {action.label}
                  </span>
                </motion.button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main FAB */}
      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close quick actions" : "Open quick actions"}
        aria-expanded={open}
        className="relative flex h-12 w-12 items-center justify-center rounded-full border border-violet-500/40 bg-violet-500/20 text-violet-200 shadow-[0_8px_24px_-8px_rgba(139,92,246,0.6)] backdrop-blur-xl transition-colors hover:bg-violet-500/30 hover:text-violet-100"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        <motion.span
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{ boxShadow: "0 0 24px -6px rgba(139, 92, 246, 0.6)" }}
          initial={{ opacity: 0.5 }}
          animate={{ opacity: open ? 0.8 : [0.5, 0.9, 0.5] }}
          transition={
            open
              ? { duration: 0.2 }
              : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
          }
        />
        <AnimatePresence mode="wait" initial={false}>
          {open ? (
            <motion.span
              key="x"
              initial={{ opacity: 0, rotate: -90 }}
              animate={{ opacity: 1, rotate: 0 }}
              exit={{ opacity: 0, rotate: 90 }}
              transition={{ duration: 0.15 }}
              className="relative"
            >
              <X className="h-5 w-5" />
            </motion.span>
          ) : (
            <motion.span
              key="plus"
              initial={{ opacity: 0, rotate: 90 }}
              animate={{ opacity: 1, rotate: 0 }}
              exit={{ opacity: 0, rotate: -90 }}
              transition={{ duration: 0.15 }}
              className="relative"
            >
              <Plus className="h-5 w-5" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
}

export default QuickActionFAB;
