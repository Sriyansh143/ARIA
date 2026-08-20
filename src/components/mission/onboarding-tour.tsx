"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  ChevronRight,
  ChevronLeft,
  X,
  Check,
  Rocket,
  Keyboard,
  MousePointerClick,
  Bell,
  Palette,
} from "lucide-react";

interface TourStep {
  title: string;
  description: string;
  icon: typeof Sparkles;
  highlight?: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to ARIA Mission Control",
    description: "Your autonomous AI company operations center. This tour will guide you through the key features in under 60 seconds.",
    icon: Rocket,
  },
  {
    title: "Command Palette (⌘K)",
    description: "Press ⌘K or Ctrl+K to open the command palette. Jump to any of the 25+ panels, trigger actions, or search across all entities instantly.",
    icon: Keyboard,
    highlight: "Try pressing ⌘K now",
  },
  {
    title: "Global Search (F key)",
    description: "Press F to search across agents, tasks, deals, skills, and logs simultaneously. Results are grouped by category with keyboard navigation.",
    icon: MousePointerClick,
    highlight: "Press F to try it",
  },
  {
    title: "Interactive Panels",
    description: "Click any agent card to open its detail drawer. Click a deal in the financial kanban. Click a task row for its full history. Every entity is drill-down-able.",
    icon: MousePointerClick,
  },
  {
    title: "Notification Preferences",
    description: "Configure alert severity filters, sound alerts, haptic feedback, desktop notifications, auto-ack thresholds, and quiet hours. Preferences persist across sessions.",
    icon: Bell,
  },
  {
    title: "Theme Toggle",
    description: "Switch between dark (default) and light modes using the sun/moon icon in the header. Your preference is remembered.",
    icon: Palette,
  },
  {
    title: "You're All Set",
    description: "The dashboard is live and streaming real-time data. Explore the 25+ panels, use the command palette to navigate, and press ? anytime for the keyboard shortcuts reference.",
    icon: Check,
  },
];

const STORAGE_KEY = "aria-onboarding-completed";

/**
 * OnboardingTour — first-run guided walkthrough.
 *
 * Renders a centered modal carousel that walks new operators through the
 * dashboard's key features. Shows on first visit (detected via localStorage)
 * and can be re-triggered from the command palette. Each step has an icon,
 * title, description, and optional action hint.
 */
export function OnboardingTour() {
  // `completed` starts null (SSR-safe). Set after mount from localStorage.
  // If the tour has already been completed, we render nothing at all so it
  // cannot block panel action buttons.
  const [completed, setCompleted] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Check if first run (no localStorage flag).
  useEffect(() => {
    try {
      const done = localStorage.getItem(STORAGE_KEY);
      setCompleted(!!done);
      if (!done) {
        // Small delay so the dashboard loads first.
        const timer = setTimeout(() => setOpen(true), 1200);
        return () => clearTimeout(timer);
      }
    } catch {
      setCompleted(false);
    }
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
  }, []);

  const next = useCallback(() => {
    if (step < TOUR_STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      close();
    }
  }, [step, close]);

  const prev = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  // Keyboard navigation.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, next, prev, close]);

  // Don't render anything (not even an empty AnimatePresence wrapper) if
  // the tour has been completed — keeps the DOM clean and ensures tour
  // highlights can never block panel buttons once dismissed. (Placed
  // AFTER all hooks so the rules-of-hooks are satisfied.)
  if (completed) return null;

  const current = TOUR_STEPS[step];
  const Icon = current.icon;
  const isLast = step === TOUR_STEPS.length - 1;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={close}
            className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-md"
          />
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 12 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              className="mc-surface-elevated w-full max-w-md overflow-hidden"
              role="dialog"
              aria-label="Onboarding tour"
            >
              {/* Header with step indicator */}
              <div className="relative border-b border-border/60 px-5 py-3">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px mc-sweep-line opacity-60" />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md border border-violet-500/40 bg-violet-500/10">
                      <Sparkles className="h-3.5 w-3.5 text-violet-300" />
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Onboarding · {step + 1}/{TOUR_STEPS.length}
                    </span>
                  </div>
                  <button
                    onClick={close}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-rose-500/40 hover:text-rose-300"
                    aria-label="Skip tour"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {/* Progress bar */}
                <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-border/30">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-400"
                    initial={{ width: 0 }}
                    animate={{ width: `${((step + 1) / TOUR_STEPS.length) * 100}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </div>

              {/* Step content */}
              <div className="p-6">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  {/* Icon */}
                  <div className="mb-4 flex justify-center">
                    <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-violet-500/30 bg-violet-500/10">
                      <motion.span
                        className="absolute inset-0 rounded-2xl"
                        animate={{ opacity: [0.3, 0.6, 0.3] }}
                        transition={{ duration: 2.5, repeat: Infinity }}
                        style={{ boxShadow: "0 0 24px -4px oklch(0.7 0.18 300 / 0.5)" }}
                      />
                      <Icon className="relative h-8 w-8 text-violet-300" />
                    </div>
                  </div>

                  <h3 className="text-center font-mono text-base font-semibold text-foreground">
                    {current.title}
                  </h3>
                  <p className="mt-2 text-center text-sm leading-relaxed text-muted-foreground">
                    {current.description}
                  </p>

                  {current.highlight && (
                    <div className="mt-3 flex items-center justify-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/5 px-3 py-1.5">
                      <Keyboard className="h-3 w-3 text-cyan-300" />
                      <span className="font-mono text-[11px] text-cyan-300">{current.highlight}</span>
                    </div>
                  )}
                </motion.div>
              </div>

              {/* Footer navigation */}
              <div className="flex items-center justify-between border-t border-border/60 px-5 py-3">
                <button
                  onClick={prev}
                  disabled={step === 0}
                  className="flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Back
                </button>

                {/* Step dots */}
                <div className="flex items-center gap-1">
                  {TOUR_STEPS.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setStep(i)}
                      className={`h-1.5 rounded-full transition-all ${
                        i === step
                          ? "w-4 bg-violet-400"
                          : i < step
                            ? "w-1.5 bg-violet-400/40"
                            : "w-1.5 bg-border/50"
                      }`}
                      aria-label={`Go to step ${i + 1}`}
                    />
                  ))}
                </div>

                <button
                  onClick={next}
                  className="flex items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-violet-300 transition-colors hover:bg-violet-500/20"
                >
                  {isLast ? "Finish" : "Next"}
                  {isLast ? <Check className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Re-trigger the tour (called from the command palette). */
export function restartTour() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  // Reload to re-trigger the tour.
  window.location.reload();
}
