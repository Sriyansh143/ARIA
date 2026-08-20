"use client";

import { useSyncExternalStore } from "react";

/**
 * useClock — ticking wall-clock via useSyncExternalStore.
 *
 * This is the correct React 19 idiom for subscribing to an external
 * ticking source: no setState-in-effect, no hydration mismatch (the
 * server snapshot is null; the client snapshot is the live Date), and
 * the interval is shared across every consumer via a module-level
 * subscriber counter.
 */

const listeners = new Set<() => void>();
let cached: Date | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (timer === null) {
    cached = new Date();
    timer = setInterval(() => {
      cached = new Date();
      for (const fn of listeners) fn();
    }, 1000);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): Date {
  return cached ?? new Date(0);
}

function getServerSnapshot(): null {
  return null;
}

export function useClock(): Date | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Format an ISO string as a compact HH:MM:SS, tolerant of null. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "--:--:--";
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour12: false });
  } catch {
    return "--:--:--";
  }
}

/** Human relative time ("3s ago", "2m ago", "1h ago"). */
export function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 0) return "just now";
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  } catch {
    return "—";
  }
}

/** Compact integer formatting: 1234 → 1.2k, 1500000 → 1.5M. */
export function compact(n: number): string {
  if (Math.abs(n) < 1000) return String(n);
  if (Math.abs(n) < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
