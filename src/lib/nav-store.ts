'use client';

/**
 * Global tab-navigation store (Zustand).
 *
 * Why a store instead of prop-drilling `onNavigate` through every tab?
 *  - Lets ANY component (StatCard, Orion Shell voice command, agent
 *    monitoring alerts, notification toasts, …) jump to a tab without
 *    touching the parent shell.
 *  - Avoids merge conflicts when multiple agents work on different tabs
 *    in parallel — they all just call `navigate('fleet')`.
 *  - Carries an optional `context` payload (e.g. which agent id to focus,
 *    which task to highlight) so deep-linked tabs can pre-select an item.
 */

import { create } from 'zustand';

export type TabNavContext = Record<string, string | number | boolean | undefined>;

interface NavState {
  /** The currently-active tab key. The shell subscribes to this. */
  tab: string;
  /** Optional context carried with the last navigation (e.g. { agentId: '…' }). */
  context: TabNavContext;
  /** Monotonic counter — bumps on every navigate() call so subscribers can react even when re-navigating to the same tab. */
  nonce: number;
  /** Navigate to a tab with optional context. */
  navigate: (tab: string, context?: TabNavContext) => void;
  /** Update only the context without changing the tab. */
  setContext: (ctx: TabNavContext) => void;
}

export const useNavStore = create<NavState>((set) => ({
  tab: 'overview',
  context: {},
  nonce: 0,
  navigate: (tab, context = {}) =>
    set((s) => ({
      tab,
      context,
      nonce: s.nonce + 1,
    })),
  setContext: (ctx) =>
    set((s) => ({ context: { ...s.context, ...ctx }, nonce: s.nonce + 1 })),
}));

/**
 * Convenience hook for components that only need the `navigate` function.
 * Returns a stable callback.
 */
export function useTabNav() {
  return useNavStore((s) => s.navigate);
}

/**
 * Hook for components that want to react to navigation context changes
 * (e.g. a tab that pre-selects an item when deep-linked).
 */
export function useNavContext(): TabNavContext {
  return useNavStore((s) => s.context);
}

/**
 * Hook that returns the current nonce — useful as a `key` to force a
 * re-fetch when re-navigating to the same tab.
 */
export function useNavNonce(): number {
  return useNavStore((s) => s.nonce);
}
