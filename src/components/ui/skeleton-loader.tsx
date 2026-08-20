/**
 * src/components/ui/skeleton-loader.tsx — v76.2 Phase 26.1
 *
 * Skeleton loading states to replace infinite spinners.
 * Shows the shape of the content that will appear, giving the user
 * visual feedback that data is loading — not a frozen screen.
 *
 * Usage:
 *   {loading ? <SkeletonLoader lines={4} /> : <ActualContent />}
 */

"use client";

import { cn } from "@/lib/utils";

interface SkeletonLoaderProps {
  /** Number of skeleton lines to show (default 3) */
  lines?: number;
  /** Additional className */
  className?: string;
  /** Variant: "text" (default), "card", "chart", "table" */
  variant?: "text" | "card" | "chart" | "table";
}

export function SkeletonLoader({ lines = 3, className = "", variant = "text" }: SkeletonLoaderProps) {
  if (variant === "card") {
    return (
      <div className={cn("animate-pulse space-y-4", className)}>
        <div className="h-32 bg-muted rounded-lg" />
        <div className="h-4 bg-muted rounded w-3/4" />
        <div className="h-4 bg-muted rounded w-1/2" />
      </div>
    );
  }

  if (variant === "chart") {
    return (
      <div className={cn("animate-pulse", className)}>
        <div className="h-64 bg-muted rounded-lg flex items-end gap-2 p-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 bg-muted-foreground/20 rounded-t"
              style={{ height: `${30 + Math.random() * 50}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (variant === "table") {
    return (
      <div className={cn("animate-pulse space-y-2", className)}>
        <div className="h-10 bg-muted rounded" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 bg-muted/50 rounded" />
        ))}
      </div>
    );
  }

  // Default: text variant
  return (
    <div className={cn("animate-pulse space-y-3", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 bg-muted rounded"
          style={{ width: i === lines - 1 ? "60%" : "100%" }}
        />
      ))}
    </div>
  );
}

/**
 * Full-page skeleton for initial dashboard load.
 */
export function PageSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <SkeletonLoader variant="card" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SkeletonLoader variant="card" />
        <SkeletonLoader variant="card" />
        <SkeletonLoader variant="card" />
      </div>
      <SkeletonLoader variant="table" />
    </div>
  );
}
