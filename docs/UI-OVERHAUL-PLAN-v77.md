# ARIA Mission Control v77 — UI Overhaul Plan

> **Status:** PLANNING ONLY — do NOT implement yet. v76.2 stability patch is the current production version.
> **Target:** v77.0 (after v76.2 is deployed + stable for 7 days)
> **Created:** 2026-08-19 (v76.2 Phase 26.1)

---

## Design Philosophy

1. **Warm, approachable, professional** — NOT harsh black/white. Use warm neutral tones (#F8F9FA background, #1F2937 text) that feel calm + readable, not stark.
2. **High information density** — Bloomberg Terminal style: lots of data, clean layout, no wasted whitespace.
3. **Clear visual hierarchy** — Important actions (Approve, Merge, Deploy) use the primary blue. Secondary actions are subtle gray. Danger actions are red.
4. **Accessible** — WCAG AA compliant contrast ratios (minimum 4.5:1 for body text, 3:1 for large text).
5. **Performance-first** — Lazy-load heavy panels (Lead Hunt, Proactive, Finance) with skeleton loaders. Pre-render the Overview tab.

---

## Color Palette (Proposed — Warm Neutral, NOT Black/White)

```
┌─────────────────────────────────────────────────────────┐
│  BACKGROUND    #F8F9FA  (warm light gray — not stark white)  │
│  SURFACE       #FFFFFF  (cards — white on warm gray)          │
│  SURFACE-2     #F1F3F5  (hover states, secondary surfaces)    │
│  PRIMARY       #2563EB  (professional blue — CTAs, links)     │
│  PRIMARY-DARK  #1E40AF  (hover, active states)                 │
│  SECONDARY     #7C3AED  (purple accent — highlights, badges)  │
│  SUCCESS       #059669  (green — pass states, revenue)         │
│  WARNING       #D97706  (amber — pending, caution)             │
│  ERROR         #DC2626  (red — fail states, danger)            │
│  TEXT-PRIMARY  #1F2937  (dark gray — NOT black, softer)        │
│  TEXT-SECOND   #6B7280  (medium gray — descriptions)           │
│  TEXT-MUTED    #9CA3AF  (light gray — timestamps, hints)       │
│  BORDER        #E5E7EB  (light gray — card borders)            │
│  BORDER-DARK   #D1D5DB  (darker border — inputs)               │
└─────────────────────────────────────────────────────────┘
```

### Why NOT Black/White
- Pure black (#000) on pure white (#FFF) creates harsh contrast that causes eye strain after 30+ minutes of use.
- The warm gray background (#F8F9FA) reduces blue light + creates a softer visual environment.
- Dark gray text (#1F2937) instead of pure black (#000) reduces contrast fatigue.
- The palette is inspired by Linear.app, Notion, and Stripe Dashboard — all known for excellent readability.

---

## Layout Architecture

### Sidebar Navigation (collapsible, 240px → 64px)
```
┌──────────────┬──────────────────────────────────────────────────┐
│  ◆ ARIA      │  Breadcrumb: Dashboard > Overview                 │
│              │──────────────────────────────────────────────────│
│  📊 Overview │                                                  │
│  🖥️ Live Scr │                                                  │
│  ⚙️ Ops      │              MAIN CONTENT AREA                   │
│  🤖 Agents   │                                                  │
│  🧠 Intel     │  (card-based, 24px spacing, sticky headers)     │
│  🎯 Lead Hnt │                                                  │
│  📢 Proactive│                                                  │
│  🎯 Leads     │                                                  │
│  💰 Revenue  │                                                  │
│  📈 Finance   │                                                  │
│  🛡️ Supervise│                                                  │
│  🎓 Training │                                                  │
│  📊 Market   │                                                  │
│  🔒 Security │                                                  │
│              │                                                  │
│  ─────────── │                                                  │
│  👤 Owner    │  [🔔 3]  [🌙/☀️]  [⌘K Search]  [Avatar ▾]      │
└──────────────┴──────────────────────────────────────────────────┘
```

### Top Bar (64px height)
- **Left:** Breadcrumb navigation (Dashboard > Lead Hunt > Details)
- **Center:** Global search (Cmd+K) — fuzzy search across leads, contracts, skills, settings
- **Right:** 
  - Notifications bell (red dot if pending approvals > 0)
  - Theme toggle (light/dark/system — default: light warm)
  - User avatar + dropdown (Profile, Settings, Logout)

### Main Content Area
- **Responsive grid:** 12-column grid, cards span 4/6/8/12 columns
- **Card design:** White surface, 1px border (#E5E7EB), 8px border radius, subtle shadow (0 1px 3px rgba(0,0,0,0.06))
- **Spacing:** 24px between cards, 16px between elements within a card
- **Sticky headers:** Tables + lists get sticky headers (position: sticky, top: 0, z-index: 1100)

---

## Component Improvements

### 1. Data Tables
- Sortable columns (click header → sort asc/desc)
- Filterable rows (search box per column)
- Bulk actions (checkbox select → "Approve All", "Export CSV")
- Pagination (25/50/100 per page, numbered)
- Row hover: light gray (#F1F3F5) background
- Row selected: light blue (#EFF6FF) background

### 2. Forms
- Inline validation (red border on invalid fields, green checkmark on valid)
- Auto-save drafts (debounced 2s, saved to localStorage)
- Clear error messages below each field (not in a toast)
- Loading state on submit button (spinner inside the button, not a separate spinner)

### 3. Modals (using centralized z-index from v76.2)
- Centered with backdrop blur (backdrop-filter: blur(4px))
- Backdrop: z-index 1300 (modalBackdrop)
- Content: z-index 1400 (modal)
- Escape key to close
- Click outside to close
- Focus trap (Tab cycles within the modal)
- Slide-in animation (200ms ease-out)

### 4. Toast Notifications
- Top-right positioning (z-index 1700)
- Stack vertically with 8px gap
- Auto-dismiss after 5s (hover pauses the timer)
- Manual dismiss button (✕)
- Colors: green (success), amber (warning), red (error), blue (info)
- Slide-in from right animation (200ms ease-out)

### 5. Loading States (using skeleton-loader.tsx from v76.2)
- Initial page load: `<PageSkeleton />` (card + grid + table skeleton)
- Table loading: `<SkeletonLoader variant="table" />`
- Chart loading: `<SkeletonLoader variant="chart" />`
- Card loading: `<SkeletonLoader variant="card" />`
- Button loading: inline spinner inside the button (not a separate spinner)
- No infinite spinners — all have a 30s timeout that shows an error + retry button

### 6. Error States (using error-boundary.tsx from v76.2)
- Wrap every dashboard panel in `<ErrorBoundary>`
- Show "Something went wrong" card with retry button
- Log errors to /api/blackbox for debugging
- Never show a blank screen — always show something

---

## Animations

### Page Transitions
- Fade-in (150ms ease-out) on route change
- No slide animations (they feel slow on ARM)

### Data Updates
- New table rows: slide-in from top (200ms)
- Updated values: pulse highlight (amber background → fade to normal, 500ms)
- Removed rows: fade-out (150ms)

### Interactive Elements
- Button hover: background darkens 10% (100ms)
- Card hover: shadow deepens (200ms)
- Tab switch: content fades in (150ms)
- Dropdown open: slide-down (150ms ease-out)
- Modal open: fade + scale from 0.95 to 1.0 (200ms)

### SVG Animations
- Loading: spinning circle (SVG `<animateTransform>`, 1s linear infinite)
- Success checkmark: SVG path draw animation (300ms ease-out)
- Revenue chart: bars grow from bottom (400ms staggered)
- Progress bar: width transition (300ms ease-out)
- No complex SVG animations — they're GPU-intensive on ARM

---

## Lazy Loading Strategy

### Route-level Lazy Loading
- Use Next.js `dynamic()` imports for heavy panels:
  ```typescript
  const LeadHuntPanel = dynamic(() => import("@/app/dashboard/lead-hunt/page"), {
    loading: () => <PageSkeleton />,
    ssr: false,
  });
  ```
- The Overview tab is pre-rendered (it's the first thing the user sees)
- All other tabs load on-demand when clicked

### Data-level Lazy Loading
- API endpoints use pagination (default 25 items per page)
- Tables fetch only the visible page
- Charts load summary data first, then drill-down on click
- Images use `loading="lazy"` + `next/image` for optimization

### Code Splitting
- `embedded-skills.ts` (947 KB) is dynamically imported only when skills are needed
- `pdfkit` is dynamically imported only when contract generation is triggered
- `xlsx` is dynamically imported only when Excel import is triggered
- `playwright` is dynamically imported only when browser automation is triggered

---

## Ponytail Repo Compliance (RULE-68)

The app follows the "ponytail repo" method:
- **Fork**: The app is forked from the original ARIA template
- **Adapt**: All modifications are made in-place, not as patches
- **Never patch**: No `git apply` or `.patch` files — all changes are committed directly

**Verified:** `grep -rn "\.patch\b" src/ scripts/` → 0 matches (no patch files used)

---

## Zero Patch Policy Compliance (RULE-45)

Every bug fix addresses the root cause:
- **Network access fix**: Added `allowedDevOrigins` to `next.config.ts` (root cause: Next.js blocks cross-origin)
- **Z-index fix**: Created centralized `z-index.ts` (root cause: arbitrary z-index values)
- **Loading states fix**: Created `skeleton-loader.tsx` + `error-boundary.tsx` (root cause: no loading UI)
- **Env fix**: Expanded `.env.example` (root cause: missing variables)

**No try/catch suppression:** All error handling uses proper error logging + user-facing error messages.

---

## Accessibility

- All interactive elements are keyboard accessible (Tab navigation, Enter/Space activation)
- ARIA labels on all icon-only buttons
- Focus indicators: 2px blue outline (#2563EB) on focused elements
- Screen reader: semantic HTML5 (`<nav>`, `<main>`, `<section>`, `<button>`)
- High contrast mode support (CSS `@media (prefers-contrast: high)`)
- Reduced motion support (CSS `@media (prefers-reduced-motion: reduce)` disables animations)

---

## Implementation Timeline (v77)

| Week | Focus | Deliverable |
|---|---|---|
| **Week 1** | Design system + component library | Color palette, typography scale, spacing system, base components (Button, Card, Input, Table, Modal, Toast, Skeleton, ErrorBoundary) |
| **Week 2** | Layout overhaul | Sidebar navigation (collapsible), top bar (breadcrumb + search + notifications), responsive grid |
| **Week 3** | Dashboard pages migration | Migrate all 15 tabs to new layout with lazy loading + skeleton states + error boundaries |
| **Week 4** | Testing + polish | Cross-browser testing, accessibility audit, performance optimization, animation tuning |

---

## What v76.2 Already Provides (Foundation for v77)

- ✅ `src/lib/z-index.ts` — centralized z-index scale (no more overlay conflicts)
- ✅ `src/components/ui/skeleton-loader.tsx` — 4 skeleton variants (text, card, chart, table)
- ✅ `src/components/error-boundary.tsx` — React error boundary with retry button
- ✅ `allowedDevOrigins` in next.config.ts — LAN access enabled
- ✅ Comprehensive `.env.example` (417 lines, 80+ variables)
- ✅ This planning document — ready for v77 implementation

v77 will build on this foundation to create the full visual overhaul.
