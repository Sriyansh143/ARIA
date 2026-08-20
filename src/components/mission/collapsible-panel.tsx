"use client";

import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";

interface CollapsiblePanelProps {
  title: string;
  icon?: ReactNode;
  badge?: string;
  badgeColor?: "default" | "rose" | "amber" | "emerald" | "cyan" | "violet";
  count?: number;
  children: ReactNode;
  defaultOpen?: boolean;
  maxHeight?: string;
  actions?: ReactNode;
  className?: string;
}

const BADGE_COLORS: Record<string, string> = {
  default: "bg-muted text-muted-foreground border-border",
  rose: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  cyan: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
  violet: "bg-violet-500/10 text-violet-400 border-violet-500/30",
};

/**
 * CollapsiblePanel — reusable collapsible wrapper for data-heavy sections.
 *
 * Features:
 *   - Chevron toggle (click header to expand/collapse)
 *   - Constrained scroll area with custom sleek scrollbar (max-h-80 default)
 *   - Badge + count display
 *   - Optional actions (buttons) in the header
 *   - Smooth expand/collapse animation via Framer Motion
 *   - Theme-aware (uses CSS variables — works in both light + dark)
 *
 * Usage:
 *   <CollapsiblePanel title="Alerts" count={37} badge="5 critical" badgeColor="rose">
 *     {alerts.map(a => <AlertRow key={a.id} alert={a} />)}
 *   </CollapsiblePanel>
 */
export function CollapsiblePanel({
  title,
  icon,
  badge,
  badgeColor = "default",
  count,
  children,
  defaultOpen = true,
  maxHeight = "20rem", // max-h-80 = 20rem
  actions,
  className = "",
}: CollapsiblePanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`mc-surface ${className}`}>
      {/* Header — clickable to toggle */}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-muted/30"
      >
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
          <h3 className="truncate text-xs font-semibold uppercase tracking-wider text-foreground">
            {title}
          </h3>
          {count !== undefined && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
          {badge && (
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold ${BADGE_COLORS[badgeColor]}`}
            >
              {badge}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {actions && <div onClick={(e) => e.stopPropagation()}>{actions}</div>}
          <motion.span animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </motion.span>
        </div>
      </button>

      {/* Body — collapsible with constrained scroll */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div
              className="mc-scroll overflow-y-auto p-2"
              style={{ maxHeight }}
            >
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
