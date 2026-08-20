"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * CollapsibleSection — section that collapses by default and expands on click.
 *
 * The section header is always visible (showing the title + count + icon).
 * The body (children) is hidden by default and expands on click.
 * Clicking outside the section (or clicking the header again) collapses it.
 *
 * This implements the user's request: "text information and text related
 * section should open when clicked only" and "when clicked outside section
 * popups clicks everything close and show default ui again."
 *
 * Uses a ref + document click listener for the click-outside behavior.
 * The `defaultOpen` prop can override the default collapsed state for
 * critical above-the-fold panels.
 */

interface CollapsibleSectionProps {
  id: string;
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  accent?: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function CollapsibleSection({
  id,
  title,
  icon: Icon,
  accent = "text-cyan-300",
  badge,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const sectionRef = useRef<HTMLDivElement>(null);

  // Click-outside-to-close: when the section is open and the user clicks
  // outside of it, collapse it.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (sectionRef.current && !sectionRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    // Use a small delay so the click that opened it doesn't immediately close it.
    const timer = setTimeout(() => {
      document.addEventListener("click", handler, { capture: true });
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handler, { capture: true });
    };
  }, [open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <div
      id={id}
      ref={sectionRef}
      className="mc-surface mc-anchor-target overflow-hidden"
    >
      {/* Header — always visible, clickable */}
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between border-b border-border/60 px-4 py-3 transition-colors hover:bg-card/40"
        aria-expanded={open}
        aria-controls={`section-body-${id}`}
      >
        <div className="flex items-center gap-2">
          {Icon && <Icon className={`h-4 w-4 ${accent}`} />}
          <h2 className="font-mono text-sm font-bold uppercase tracking-[0.18em] text-foreground">
            {title}
          </h2>
          {badge && (
            <span className="border border-border/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground" style={{ borderRadius: 0 }}>
              {badge}
            </span>
          )}
        </div>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="text-muted-foreground"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 5L7 9L11 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
          </svg>
        </motion.span>
      </button>

      {/* Body — hidden by default, expands on click */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`section-body-${id}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collapsed hint */}
      {!open && (
        <div className="px-4 py-1.5 font-mono text-[10px] text-muted-foreground/40">
          {"// click to expand"}
        </div>
      )}
    </div>
  );
}
