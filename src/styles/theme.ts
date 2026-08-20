/**
 * src/styles/theme.ts — ARIA Mission Control Design System (v48)
 *
 * Single source of truth for the professional UI overhaul.
 * Extends (does NOT replace) the existing CSS-variable-based theming in
 * globals.css so all existing shadcn/ui components keep working.
 *
 * Usage:
 *   import { colors, gradients, glass, shadows, animations } from "@/styles/theme"
 *   <div className={glass.md} style={{ boxShadow: shadows.glow.emerald }}>
 *
 * All values are also exported as Tailwind-friendly class strings where possible.
 */

// ─── Color Palette ───────────────────────────────────────────────────
// Mirrors globals.css CSS vars + adds gradient stops.
export const colors = {
  // Primary brand — Emerald → Teal (growth, money, "go")
  primary: {
    50: "#ecfdf5",
    100: "#d1fae5",
    200: "#a7f3d0",
    300: "#6ee7b7",
    400: "#34d399",
    500: "#10b981", // --accent
    600: "#059669",
    700: "#047857",
    800: "#065f46",
    900: "#064e3b",
  },
  teal: {
    400: "#2dd4bf",
    500: "#14b8a6",
    600: "#0d9488",
  },

  // Secondary — Indigo → Purple (intelligence, AI, "premium")
  secondary: {
    50: "#eef2ff",
    100: "#e0e7ff",
    400: "#818cf8",
    500: "#6366f1", // indigo-500
    600: "#4f46e5",
  },
  purple: {
    400: "#a78bfa",
    500: "#8b5cf6",
    600: "#7c3aed",
  },

  // Accent — Amber (warnings/pending) + Rose (errors/critical)
  amber: {
    400: "#fbbf24",
    500: "#f59e0b",
  },
  rose: {
    400: "#fb7185",
    500: "#f43f5e",
    600: "#e11d48",
  },

  // Surface — Dark slate with teal tint (matches globals.css --bg)
  surface: {
    bg: "#0a0e0f",       // --bg
    bgAlt: "#0f1416",    // --bg-2
    card: "#141a1d",     // --surface
    cardAlt: "#1a2125",  // --surface-2
    elevated: "#232b30", // --surface-3
    border: "#2a3338",   // --border
    borderStrong: "#3a4248",
  },

  // Text
  text: {
    primary: "#f0f4f3",   // --text (warm white)
    secondary: "#9ca3a3", // --text-2 (zinc-400)
    tertiary: "#6b7280",  // --text-3 (zinc-500)
    inverse: "#0a0e0f",   // --accent-ink (text on emerald bg)
  },

  // Semantic
  success: "#34d399",  // --ok (emerald-400)
  warning: "#fbbf24",  // --warn (amber-400)
  error: "#f87171",    // --err (red-400)
  info: "#22d3ee",     // --cyan (cyan-400)
} as const;

// ─── Gradients ───────────────────────────────────────────────────────
export const gradients = {
  // Primary brand gradient (emerald → teal) — buttons, CTAs, active nav
  primary: "linear-gradient(135deg, #10b981 0%, #14b8a6 100%)",
  // Secondary gradient (indigo → purple) — AI/intelligence elements
  secondary: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
  // Text gradient for headlines
  textPrimary: "linear-gradient(135deg, #34d399 0%, #2dd4bf 100%)",
  textSecondary: "linear-gradient(135deg, #818cf8 0%, #a78bfa 100%)",
  // Background ambient (subtle radial for hero sections)
  ambient: "radial-gradient(ellipse at top, rgba(16, 185, 129, 0.08) 0%, transparent 60%)",
  ambientSecondary: "radial-gradient(ellipse at bottom right, rgba(99, 102, 241, 0.06) 0%, transparent 60%)",
  // Chart fills (for Recharts area charts)
  chartEmerald: "linear-gradient(180deg, rgba(16, 185, 129, 0.3) 0%, rgba(16, 185, 129, 0) 100%)",
  chartIndigo: "linear-gradient(180deg, rgba(99, 102, 241, 0.3) 0%, rgba(99, 102, 241, 0) 100%)",
} as const;

// ─── Glassmorphism ───────────────────────────────────────────────────
// Pre-computed class strings for the glass effect.
// backdrop-blur-xl + semi-transparent bg + subtle border.
export const glass = {
  // Standard card — used everywhere
  md: "backdrop-blur-xl bg-white/[0.03] border border-white/[0.08] rounded-xl",
  // Stronger opacity — for modals, dropdowns
  lg: "backdrop-blur-2xl bg-white/[0.06] border border-white/[0.12] rounded-xl",
  // Subtle — for inline elements, badges
  sm: "backdrop-blur-md bg-white/[0.02] border border-white/[0.06] rounded-lg",
  // Hover state — adds a glow border
  hover: "hover:bg-white/[0.05] hover:border-emerald-500/30 transition-colors duration-300",
} as const;

// ─── Shadows ─────────────────────────────────────────────────────────
export const shadows = {
  // Soft elevation for cards
  card: "0 4px 24px rgba(0, 0, 0, 0.3)",
  cardHover: "0 8px 32px rgba(0, 0, 0, 0.4)",
  // Glow effects (for interactive elements)
  glow: {
    emerald: "0 0 24px rgba(16, 185, 129, 0.25)",
    emeraldStrong: "0 0 32px rgba(16, 185, 129, 0.4)",
    indigo: "0 0 24px rgba(99, 102, 241, 0.25)",
    amber: "0 0 24px rgba(245, 158, 11, 0.25)",
    rose: "0 0 24px rgba(244, 63, 94, 0.25)",
  },
  // Inset (for inputs, pressed states)
  inset: "inset 0 2px 4px rgba(0, 0, 0, 0.2)",
} as const;

// ─── Typography ──────────────────────────────────────────────────────
export const typography = {
  // Font families (mirror globals.css --font-sans / --font-mono)
  fontSans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
  // Sizes (rem-based, responsive via clamp)
  sizes: {
    xs: "0.75rem",    // 12px
    sm: "0.875rem",   // 14px
    base: "1rem",     // 16px
    lg: "1.125rem",   // 18px
    xl: "1.25rem",    // 20px
    "2xl": "1.5rem",  // 24px
    "3xl": "1.875rem", // 30px
    "4xl": "2.25rem", // 36px
    "5xl": "3rem",    // 48px
    "6xl": "clamp(2.5rem, 5vw, 4rem)", // responsive hero (40-64px)
  },
  weights: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeights: {
    tight: 1.1,  // headlines
    snug: 1.3,   // subheadlines
    normal: 1.5, // body
    relaxed: 1.7, // long-form
  },
  // Gradient text helper (for headlines)
  gradientText: (from: string = "#34d399", to: string = "#2dd4bf") => ({
    background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
  }),
} as const;

// ─── Border Radius ───────────────────────────────────────────────────
export const radius = {
  sm: "0.5rem",   // 8px — inputs, small badges
  md: "0.75rem",  // 12px — cards (matches --radius)
  lg: "1rem",     // 16px — large cards, modals
  xl: "1.5rem",   // 24px — hero sections
  pill: "9999px", // pills, avatars
} as const;

// ─── Animation Tokens (Framer Motion variants) ───────────────────────
// Reusable across components for consistency.
export const animations = {
  // Page transitions — fade + slide
  pageTransition: {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -12 },
    transition: { duration: 0.3, ease: [0.32, 0.72, 0, 1] as const },
  },
  // Staggered children — for lists, grids
  staggerContainer: {
    animate: {
      transition: { staggerChildren: 0.05 },
    },
  },
  staggerItem: {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.4, ease: [0.32, 0.72, 0, 1] as const },
  },
  // Card hover — lift + glow
  cardHover: {
    rest: { y: 0, boxShadow: "0 4px 24px rgba(0, 0, 0, 0.3)" },
    hover: {
      y: -4,
      boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
      transition: { duration: 0.25, ease: "easeOut" },
    },
  },
  // Button press
  buttonPress: {
    rest: { scale: 1 },
    hover: { scale: 1.02 },
    tap: { scale: 0.97 },
  },
  // Modal — scale + fade
  modal: {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1, transition: { duration: 0.2, ease: "easeOut" } },
    exit: { opacity: 0, scale: 0.95, transition: { duration: 0.15, ease: "easeIn" } },
  },
  // Slide in from top (for toast notifications, feed items)
  slideInTop: {
    initial: { opacity: 0, y: -20, height: 0 },
    animate: { opacity: 1, y: 0, height: "auto", transition: { duration: 0.3, ease: "easeOut" } },
    exit: { opacity: 0, height: 0, transition: { duration: 0.2 } },
  },
  // Pulsing — for "active" status badges, live indicators
  pulse: {
    animate: {
      scale: [1, 1.05, 1],
      opacity: [1, 0.8, 1],
      transition: { duration: 2, repeat: Infinity, ease: "easeInOut" },
    },
  },
  // Count up — for AnimatedCounter (handled in component, but token here for duration)
  countUp: {
    duration: 0.8,
    ease: "easeOut",
  },
  // Draw — for SVG paths (stroke-dashoffset animation)
  drawPath: {
    initial: { pathLength: 0, opacity: 0 },
    animate: {
      pathLength: 1,
      opacity: 1,
      transition: { duration: 1.2, ease: "easeInOut" },
    },
  },
  // Continuous rotate — for gears, radar sweeps
  rotate: {
    animate: {
      rotate: 360,
      transition: { duration: 8, repeat: Infinity, ease: "linear" },
    },
  },
  // Continuous flow — for dots along a path
  flow: {
    animate: {
      offsetDistance: ["0%", "100%"],
      transition: { duration: 3, repeat: Infinity, ease: "linear" },
    },
  },
} as const;

// ─── Spacing (consistent with Tailwind defaults) ─────────────────────
export const spacing = {
  xs: "0.5rem",   // 8px
  sm: "1rem",     // 16px
  md: "1.5rem",   // 24px
  lg: "2rem",     // 32px
  xl: "3rem",     // 48px
  "2xl": "4rem",  // 64px
} as const;

// ─── Z-Index Scale ───────────────────────────────────────────────────
export const zIndex = {
  base: 0,
  dropdown: 10,
  sticky: 20,
  overlay: 30,
  modal: 40,
  toast: 50,
  tooltip: 60,
} as const;

// ─── Breakpoints (match Tailwind defaults) ───────────────────────────
export const breakpoints = {
  sm: "640px",
  md: "768px",
  lg: "1024px",
  xl: "1280px",
  "2xl": "1536px",
} as const;
