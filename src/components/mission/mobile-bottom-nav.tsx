"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutGrid,
  Cpu,
  ListTree,
  DollarSign,
  Activity,
  Menu,
  X,
} from "lucide-react";

interface MobileNavProps {
  onJumpTo: (target: string) => void;
}

/**
 * MobileBottomNav — responsive navigation for touch devices.
 *
 * Renders a fixed bottom navigation bar on mobile/tablet (visible only
 * on screens < lg). Provides quick-jump buttons to the 5 most important
 * panels, plus a "more" button that opens a full sheet listing all 25
 * sections. Designed for thumb-friendly 44px touch targets.
 */
export function MobileBottomNav({ onJumpTo }: MobileNavProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Don't render on desktop.
  if (!isMobile) return null;

  const primaryNav = [
    { id: "agent-fleet", label: "Fleet", icon: Cpu },
    { id: "task-pipeline", label: "Tasks", icon: ListTree },
    { id: "financial", label: "Finance", icon: DollarSign },
    { id: "system-health", label: "Health", icon: Activity },
  ];

  const allSections = [
    { id: "agent-fleet", label: "Agent Fleet" },
    { id: "task-dag", label: "Task DAG" },
    { id: "task-pipeline", label: "Task Pipeline" },
    { id: "approval-queue", label: "Approvals" },
    { id: "system-health", label: "System Health" },
    { id: "telemetry", label: "Telemetry" },
    { id: "financial", label: "Financial Ops" },
    { id: "revenue-forecast", label: "Revenue Forecast" },
    { id: "cost-profit", label: "Cost/Profit" },
    { id: "task-velocity", label: "Task Velocity" },
    { id: "capability-matrix", label: "Capability Matrix" },
    { id: "activity-heatmap", label: "Activity Heatmap" },
    { id: "live-log-stream", label: "Live Logs" },
    { id: "agent-comm", label: "Agent Comm" },
    { id: "agent-network", label: "Network Graph" },
    { id: "collaboration-graph", label: "Collaboration" },
    { id: "system-alerts", label: "System Alerts" },
    { id: "llm-gateway-audit", label: "LLM Audit" },
    { id: "cron-registry", label: "Cron Registry" },
    { id: "skills-registry", label: "Skills" },
    { id: "leaderboard", label: "Leaderboard" },
    { id: "task-optimizer", label: "Optimizer" },
    { id: "export", label: "Export" },
    { id: "mission-timeline", label: "Timeline" },
    { id: "notification-prefs", label: "Preferences" },
  ];

  const jump = (id: string) => {
    onJumpTo(id);
    setSheetOpen(false);
  };

  return (
    <>
      {/* Bottom nav bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t border-border/70 bg-background/90 backdrop-blur-xl lg:hidden">
        {/* Safe area padding for iOS */}
        <div className="flex w-full max-w-[1600px] items-center justify-around pb-[env(safe-area-inset-bottom)] pt-1">
          {primaryNav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => jump(item.id)}
                className="flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 px-2 py-1 text-muted-foreground transition-colors active:text-primary"
              >
                <Icon className="h-4 w-4" />
                <span className="font-mono text-[8px] uppercase tracking-wider">{item.label}</span>
              </button>
            );
          })}
          <button
            onClick={() => setSheetOpen(true)}
            className="flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 px-2 py-1 text-muted-foreground transition-colors active:text-primary"
          >
            <LayoutGrid className="h-4 w-4" />
            <span className="font-mono text-[8px] uppercase tracking-wider">More</span>
          </button>
        </div>
      </nav>

      {/* Full section sheet */}
      <AnimatePresence>
        {sheetOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSheetOpen(false)}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              className="mc-surface-elevated fixed bottom-0 left-0 right-0 z-40 max-h-[70vh] overflow-hidden rounded-t-xl border-t border-border/70 bg-card lg:hidden"
            >
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Menu className="h-4 w-4 text-cyan-300" />
                  <h3 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
                    All Panels
                  </h3>
                </div>
                <button
                  onClick={() => setSheetOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mc-scroll grid max-h-[55vh] grid-cols-2 gap-1.5 overflow-y-auto p-3 sm:grid-cols-3">
                {allSections.map((section) => (
                  <button
                    key={section.id}
                    onClick={() => jump(section.id)}
                    className="rounded-lg border border-border/40 bg-background/40 px-2.5 py-2 text-left font-mono text-[11px] text-foreground transition-colors active:border-primary/40 active:bg-primary/10"
                  >
                    {section.label}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Spacer to prevent content from being hidden behind the nav */}
      <div className="h-14 lg:hidden" />
    </>
  );
}
