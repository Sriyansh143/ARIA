"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * LazyMount — defers mounting of children until they're near the viewport.
 *
 * Uses IntersectionObserver to detect when the wrapper is about to scroll
 * into view. Until then, renders a lightweight placeholder (or nothing).
 * This prevents the dashboard from mounting all 40+ panels at once on
 * initial load — only the above-the-fold components mount immediately.
 *
 * Usage:
 *   <LazyMount height={400}>
 *     <HeavyComponent />
 *   </LazyMount>
 *
 * Rules (see BUILD_RULES.md §8.3):
 *   - `height` prop reserves space to prevent layout shift
 *   - Once mounted, stays mounted (doesn't unmount on scroll-away)
 *   - rootMargin: "200px" — triggers when within 200px of viewport
 *   - Falls back to rendering children if IntersectionObserver is unavailable
 */
interface LazyMountProps {
  children: ReactNode;
  height?: number;
  placeholder?: ReactNode;
  rootMargin?: string;
}

export function LazyMount({
  children,
  height = 300,
  placeholder,
  rootMargin = "200px",
}: LazyMountProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [shouldMount, setShouldMount] = useState(false);

  useEffect(() => {
    // If IntersectionObserver isn't available (older browsers), just mount
    if (typeof IntersectionObserver === "undefined") {
      setShouldMount(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShouldMount(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [rootMargin]);

  if (shouldMount) {
    return <>{children}</>;
  }

  // Show placeholder (or empty div with height) while not in view
  if (placeholder) {
    return <>{placeholder}</>;
  }

  return (
    <div
      ref={ref}
      style={{ minHeight: height }}
      className="flex items-center justify-center"
    >
      <div className="font-mono text-[10px] text-muted-foreground/30">
        loading…
      </div>
    </div>
  );
}
