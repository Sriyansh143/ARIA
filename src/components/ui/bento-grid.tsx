/**
 * src/components/ui/bento-grid.tsx — Phase 32
 *
 * Bento Grid layout primitives for the Aria Command Center dashboard.
 * Inspired by Apple's Bento Grid + Vercel's dashboard cards.
 *
 * USAGE
 * -----
 *   <BentoGrid>
 *     <BentoCard title="KPIs" className="md:col-span-2">
 *       <KpiContent />
 *     </BentoCard>
 *     <BentoCard title="Alerts" className="md:row-span-2">
 *       <AlertsContent />
 *     </BentoCard>
 *     <BentoCard title="Revenue" className="md:col-span-3">
 *       <RevenueChart />
 *     </BentoCard>
 *   </BentoGrid>
 *
 * DESIGN
 * ------
 * - Mobile-first: 1 column by default
 * - md (768px+): 2 columns
 * - lg (1024px+): 3 columns
 * - xl (1280px+): 4 columns
 * - Cards use the existing `glass-card.tsx` aesthetic (Glassmorphism)
 * - Each card has an optional title, icon, action button, + loading skeleton
 */

import { cn } from "@/lib/utils";
import { SkeletonLoader } from "./skeleton-loader";
import { AlertCircle, Loader2 } from "lucide-react";
import * as React from "react";

// ─── BentoGrid ──────────────────────────────────────────────────────

interface BentoGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Number of columns at the largest breakpoint. Default: 4. */
  columns?: 2 | 3 | 4;
  /** Gap between cards. Default: "default" (1rem). */
  gap?: "compact" | "default" | "spacious";
}

export function BentoGrid({
  className,
  columns = 4,
  gap = "default",
  ...props
}: BentoGridProps) {
  const gapClass = gap === "compact" ? "gap-2" : gap === "spacious" ? "gap-6" : "gap-4";
  const colsClass = columns === 2 ? "lg:grid-cols-2" : columns === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4 xl:grid-cols-4";

  return (
    <div
      className={cn(
        "grid grid-cols-1 md:grid-cols-2",
        colsClass,
        gapClass,
        className,
      )}
      {...props}
    />
  );
}

// ─── BentoCard ──────────────────────────────────────────────────────

interface BentoCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  /** Span N columns at the largest breakpoint. Default: 1. */
  colSpan?: 1 | 2 | 3 | 4;
  /** Span N rows at the largest breakpoint. Default: 1. */
  rowSpan?: 1 | 2 | 3;
  /** Loading state — shows skeleton instead of children. */
  loading?: boolean;
  /** Error state — shows error message instead of children. */
  error?: string | null;
  /** Compact padding. Default: false. */
  compact?: boolean;
}

export function BentoCard({
  className,
  title,
  subtitle,
  icon,
  action,
  colSpan = 1,
  rowSpan = 1,
  loading = false,
  error = null,
  compact = false,
  children,
  ...props
}: BentoCardProps) {
  const colSpanClass = {
    1: "lg:col-span-1",
    2: "lg:col-span-2",
    3: "lg:col-span-3",
    4: "lg:col-span-4",
  }[colSpan];
  const rowSpanClass = {
    1: "lg:row-span-1",
    2: "lg:row-span-2",
    3: "lg:row-span-3",
  }[rowSpan];

  return (
    <div
      className={cn(
        "aria-glass rounded-2xl border border-white/5 overflow-hidden flex flex-col",
        colSpanClass,
        rowSpanClass,
        className,
      )}
      {...props}
    >
      {(title || icon || action) && (
        <div className={cn("flex items-center justify-between gap-3 border-b border-white/5", compact ? "px-3 py-2" : "px-4 py-3")}>
          <div className="flex items-center gap-2 min-w-0">
            {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
            <div className="min-w-0">
              {title && <h3 className="text-sm font-medium text-foreground truncate">{title}</h3>}
              {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={cn("flex-1 min-w-0", compact ? "p-3" : "p-4", (loading || error) && "flex items-center justify-center")}>
        {loading ? (
          <SkeletonLoader variant="card" lines={4} className="w-full" />
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-2 text-center py-6">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <p className="text-xs text-muted-foreground max-w-[200px]">{error}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

// ─── BentoCardLarge (full-width hero card) ──────────────────────────

export function BentoCardLarge({
  className,
  children,
  loading,
  error,
  ...props
}: BentoCardProps) {
  return (
    <BentoCard
      colSpan={4}
      className={cn("min-h-[200px]", className)}
      loading={loading}
      error={error}
      {...props}
    >
      {children}
    </BentoCard>
  );
}

// ─── BentoCardWide (spans 2 columns) ───────────────────────────────

export function BentoCardWide({
  className,
  children,
  loading,
  error,
  ...props
}: BentoCardProps) {
  return (
    <BentoCard
      colSpan={2}
      className={className}
      loading={loading}
      error={error}
      {...props}
    >
      {children}
    </BentoCard>
  );
}

// ─── BentoCardTall (spans 2 rows) ──────────────────────────────────

export function BentoCardTall({
  className,
  children,
  loading,
  error,
  ...props
}: BentoCardProps) {
  return (
    <BentoCard
      rowSpan={2}
      className={cn("min-h-[300px]", className)}
      loading={loading}
      error={error}
      {...props}
    >
      {children}
    </BentoCard>
  );
}

// ─── LoadingSpinner (small inline spinner) ──────────────────────────

export function LoadingSpinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-muted-foreground", className)} />;
}
