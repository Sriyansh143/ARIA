'use client';

// =====================================================================
// action-tracker.ts — Client-side USER action telemetry.
// =====================================================================
// The existing Blackbox (src/lib/blackbox.ts) records AGENT decisions.
// This module is the dual: it records OPERATOR (human) clicks, navigations,
// submits, toggles, errors, searches, and command-palette invocations so
// monitor agents (see src/lib/agent-monitors.ts) can detect UX friction,
// broken buttons, slow submits, recurring errors, and unused tabs.
//
// All tracking is FIRE-AND-FORGET — we never block UI, never surface errors
// to the user, and never retry. If the POST fails it fails silently.
// =====================================================================

import { useEffect, useRef } from 'react';
import { useNavStore } from '@/lib/nav-store';

export type UserActionType =
  | 'navigate'
  | 'click'
  | 'submit'
  | 'toggle'
  | 'create'
  | 'delete'
  | 'error'
  | 'search'
  | 'command';

export type UserActionSeverity = 'info' | 'warn' | 'error' | 'critical';

export interface TrackActionOpts {
  /** Element identifier, e.g. "stat-card:fleet", "button:spawn-agent". */
  target?: string;
  /** Human-readable label. */
  label?: string;
  /** Tab context (auto-filled from the nav store if omitted). */
  tab?: string;
  /** Free-form JSON metadata (will be JSON.stringified). */
  meta?: Record<string, unknown>;
  /** Severity — defaults to 'info'. Use 'error'/'critical' for failed actions. */
  severity?: UserActionSeverity;
  /** Duration in ms (e.g. for slow submits). */
  duration?: number;
  /** Override the actor (defaults to 'operator'). */
  actor?: string;
  /** Override the session id (defaults to 'default'). */
  sessionId?: string;
}

// Per-tab throttling — don't spam the same navigate event 100x if a tab
// polls or re-renders. We dedupe within a 1.5s window per (type, target, tab).
const DEDUPE_WINDOW_MS = 1500;
const recentEvents: Array<{ key: string; ts: number }> = [];

function shouldDedupe(key: string): boolean {
  const now = Date.now();
  // Trim old entries.
  while (recentEvents.length > 0 && now - recentEvents[0]!.ts > DEDUPE_WINDOW_MS) {
    recentEvents.shift();
  }
  const exists = recentEvents.some((e) => e.key === key);
  if (exists) return true;
  recentEvents.push({ key, ts: now });
  return false;
}

/**
 * Fire-and-forget POST to /api/user-actions. NEVER throws, NEVER retries.
 * Safe to call from any client component or ad-hoc via `window.__track`.
 */
export function trackAction(type: UserActionType, opts: TrackActionOpts = {}): void {
  // Skip if server-side render.
  if (typeof window === 'undefined') return;

  // Throttle identical events.
  const dedupeKey = `${type}|${opts.target ?? ''}|${opts.tab ?? ''}|${opts.label ?? ''}`;
  if (shouldDedupe(dedupeKey)) return;

  const payload = {
    type,
    target: opts.target ?? null,
    label: opts.label ?? null,
    tab: opts.tab ?? null,
    meta: JSON.stringify(opts.meta ?? {}),
    severity: opts.severity ?? 'info',
    duration: opts.duration ?? null,
    actor: opts.actor ?? 'operator',
    sessionId: opts.sessionId ?? 'default',
  };

  // Fire-and-forget — use sendBeacon if available (survives page unload),
  // otherwise fall back to fetch with keepalive.
  try {
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      // sendBeacon returns false if queued — best-effort, ignore.
      navigator.sendBeacon('/api/user-actions', blob);
      return;
    }
    void fetch('/api/user-actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      // No await — fire-and-forget.
    }).catch(() => undefined);
  } catch {
    // swallow — telemetry must never break the UI
  }
}

/**
 * React hook returning a stable `track` callback pre-bound to the current
 * tab (read from the global nav store). Components using this hook will
 * automatically tag actions with the active tab without needing to pass it
 * every call.
 *
 * Usage:
 *   const { track } = useActionTracker();
 *   track('click', { target: 'button:spawn-agent', label: 'Spawn Agent' });
 */
export function useActionTracker() {
  const tab = useNavStore((s) => s.tab);
  const tabRef = useRef(tab);
  // Update the ref in an effect (not during render) to satisfy the
  // react-hooks/refs rule. The track() closure still sees the latest
  // tab via tabRef.current.
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  function track(type: UserActionType, opts: TrackActionOpts = {}) {
    trackAction(type, {
      ...opts,
      tab: opts.tab ?? tabRef.current,
    });
  }

  return { track, currentTab: tab };
}

/**
 * Convenience: track a navigation event. Called automatically by the
 * ActionTrackerProvider on nav-store nonce changes, but can also be invoked
 * manually for deep-link navigations triggered by code.
 */
export function trackNavigation(toTab: string, context?: Record<string, unknown>): void {
  trackAction('navigate', {
    target: `tab:${toTab}`,
    label: `Navigate to ${toTab}`,
    tab: toTab,
    meta: context,
  });
}

/**
 * Convenience: track a JS error (window.onerror / unhandledrejection).
 * Auto-wired by ActionTrackerProvider. Severity is 'error' for uncaught
 * errors, 'critical' for those marked fatal.
 */
export function trackError(error: Error | string, opts: { fatal?: boolean; source?: string } = {}): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  trackAction('error', {
    target: opts.source ?? 'window',
    label: message.slice(0, 200),
    severity: opts.fatal ? 'critical' : 'error',
    meta: { message, stack: stack?.slice(0, 2000), source: opts.source },
  });
}

// Augment window so any component (even non-React) can call __track.
declare global {
  interface Window {
    __track?: (type: UserActionType, opts?: TrackActionOpts) => void;
    __trackNav?: (toTab: string, context?: Record<string, unknown>) => void;
    __trackErr?: (error: Error | string, opts?: { fatal?: boolean; source?: string }) => void;
  }
}

/**
 * Install `window.__track*` helpers. Called once by ActionTrackerProvider.
 * After this, ANY code (DevTools console, non-React utils, agent scripts)
 * can call e.g. `window.__track('click', { target: 'foo' })`.
 */
export function installGlobalTrackers(): void {
  if (typeof window === 'undefined') return;
  if (window.__track) return; // already installed
  window.__track = trackAction;
  window.__trackNav = trackNavigation;
  window.__trackErr = trackError;
}

/**
 * React hook: subscribe to the global nav store and auto-track navigations.
 * Returns nothing — used for side-effects only. Auto-installed by
 * ActionTrackerProvider; safe to call multiple times (dedupes internally).
 */
export function useAutoTrackNavigations(): void {
  const nonce = useNavStore((s) => s.nonce);
  const tab = useNavStore((s) => s.tab);
  const context = useNavStore((s) => s.context);
  const lastNonceRef = useRef<number>(-1);

  useEffect(() => {
    // Skip the very first run (initial mount) — we don't want to record
    // "navigate to overview" on every page load. Only record actual
    // navigation changes after mount.
    if (lastNonceRef.current === -1) {
      lastNonceRef.current = nonce;
      return;
    }
    if (lastNonceRef.current === nonce) return;
    lastNonceRef.current = nonce;
    trackNavigation(tab, context);
  }, [nonce, tab, context]);
}
