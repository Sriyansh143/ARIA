"use client";

import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight } from "lucide-react";

interface CollapsibleListProps {
  title: string;
  icon?: ReactNode;
  count?: number;
  badge?: string;
  badgeColor?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  maxHeight?: string;
  /** Show only the first N items by default, require scroll for the rest */
  defaultVisibleCount?: number;
  emptyMessage?: string;
  actions?: ReactNode;
}

/**
 * CollapsibleList — reusable wrapper for data-heavy panels.
 *
 * Features:
 *   - Collapsible header (click to expand/collapse)
 *   - Constrained scroll area with custom scrollbar (max-h-80 default)
 *   - Badge + count display
 *   - Optional actions (buttons) in the header
 *   - Smooth expand/collapse animation via Framer Motion
 *   - Empty state message
 *   - Theme-aware (uses CSS variables)
 *
 * Usage:
 *   <CollapsibleList title="Alerts" count={37} badge="5 critical" badgeColor="rose">
 *     {alerts.map(a => <AlertRow key={a.id} alert={a} />)}
 *   </CollapsibleList>
 */
export function CollapsibleList({
  title,
  icon,
  count,
  badge,
  badgeColor = "text-muted-foreground",
  children,
  defaultOpen = true,
  maxHeight = "20rem", // max-h-80 = 20rem
  emptyMessage = "No items",
  actions,
}: CollapsibleListProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className="mc-surface flex flex-col">
      {/* Header — clickable to toggle (div+role to allow nested action buttons) */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsOpen(!isOpen);
          }
        }}
        className="flex cursor-pointer items-center justify-between border-b border-border px-4 py-3 text-left transition-colors hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          {icon}
          <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
          {count !== undefined && (
            <span className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
          {badge && (
            <span className={`text-[10px] font-medium ${badgeColor}`}>{badge}</span>
          )}
        </div>
        {actions && (
          <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
            {actions}
          </div>
        )}
      </div>

      {/* Content — collapsible with constrained scroll */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
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

/**
 * CollapsibleItem — individual item row inside a CollapsibleList.
 * Provides consistent spacing + hover state.
 */
export function CollapsibleItem({
  children,
  onClick,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-md border border-border/50 bg-card/30 p-2.5 transition-colors hover:border-border hover:bg-surface-2 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * EmptyState — shown when a CollapsibleList has no items.
 */
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
      {message}
    </div>
  );
}
