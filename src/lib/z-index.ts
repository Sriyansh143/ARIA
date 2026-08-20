/**
 * src/lib/z-index.ts — v76.2 Phase 26.1 (Stability Patch)
 *
 * Centralized z-index scale to fix overlay conflicts.
 * Every component that uses z-index MUST import from here — no arbitrary values.
 *
 * Usage:
 *   import { Z } from "@/lib/z-index";
 *   <div style={{ zIndex: Z.modal }} />
 *   <div className={`z-[${Z.toast}]`} />
 */

export const Z = {
  /** Base content layer — normal page flow */
  base: 0,
  /** Dropdown menus, select popovers */
  dropdown: 1000,
  /** Sticky headers, sticky table rows */
  sticky: 1100,
  /** Fixed navigation bars, sidebars */
  fixed: 1200,
  /** Modal/dialog backdrop (the dim overlay behind the modal) */
  modalBackdrop: 1300,
  /** Modal/dialog content (above the backdrop) */
  modal: 1400,
  /** Popovers, floating panels (above modals so they can appear inside) */
  popover: 1500,
  /** Tooltips (above everything except toasts) */
  tooltip: 1600,
  /** Toast notifications (highest — always visible) */
  toast: 1700,
  /** DevTools / debug overlays (above toasts — dev only) */
  devtools: 9999,
} as const;

export type ZIndex = typeof Z[keyof typeof Z];
