# Phase 29 Roadmap — ARIA Mission Control

## Items Scoring Below 9/10 (Must Fix in Phase 29)

### 1. UI Migration (Score: 6.5/10)
**Target: 9/10**
- Integrate `AppSidebar` component into `dashboard/layout.tsx`
- Replace 15-tab horizontal layout with collapsible sidebar (240px → 64px)
- Integrate `SkeletonLoader` into all async data fetches
- Integrate `ErrorBoundary` around all dashboard panels
- Apply centralized `z-index.ts` scale to all components
- Create Bento Grid layout for overview dashboard

### 2. Dark Mode Theme Provider (Score: 0/10)
**Target: 9/10**
- Create `ThemeProvider` component using `next-themes`
- Implement warm dark palette:
  - Background: `#09090B` (warm dark gray, NOT pure black)
  - Surface: `#18181B`
  - Text: `#F4F4F5` (light gray, NOT pure white)
- Add theme toggle button in top bar
- Test all 15 tabs in both light + dark mode

### 3. Mobile Responsive (Score: 3/10)
**Target: 9/10**
- Test all 15 dashboard tabs at 375px (iPhone), 768px (iPad), 1280px (desktop)
- Sidebar collapses to hamburger menu on mobile
- Tables get horizontal scroll on mobile
- Cards stack vertically on mobile
- Forms use full-width inputs on mobile

### 4. Remaining 3 Z-AI Calls (Score: 7/10)
**Target: 9/10**
- Patch `src/lib/intelligence/competitor-analyzer.ts` to use `webSearchWithFallback`
- Patch `src/lib/expansion/service-researcher.ts` to use `webSearchWithFallback`
- Patch `src/lib/expansion/earning-method-researcher.ts` to use `webSearchWithFallback`

### 5. Memory Watchdog Cron (Score: 5/10)
**Target: 9/10**
- Create `memory-watchdog` cron (every 5 min)
- Checks RSS of Next.js + Ollama + FreeSWITCH + Pipecat
- If total > 20GB → kill non-essential processes
- If Ollama > 10GB → restart Ollama
- Sends Telegram alert

### 6. 1-Hour Soak Test (Score: N/A)
- Deploy to Oracle VM
- Run for 1 hour with all crons active
- Monitor RSS, CPU, disk usage
- Verify no OOM, no crash, no memory leak

### 7. Live Voice Call Test (Score: 6/10)
**Target: 9/10**
- Deploy `docker-compose up -d` on Oracle VM
- Verify FreeSWITCH SIP trunk connectivity
- Test inbound call → Pipecat → Dual-TTS → caller hears response
- Test barge-in (customer interrupting AI audio)

---

## MNC Capability Gaps (from Phase 28 comparison)

### Service Delivery Gaps
| Capability | Status | Phase |
|---|---|---|
| Build mobile apps (React Native/PWA) | NOT implemented | Phase 30 |
| Build e-commerce stores | Partially (Stripe wired, no store builder) | Phase 30 |
| Build marketing funnels (A/B testing) | NOT implemented | Phase 30 |
| Design logos (AI-generated) | Partially (image-gen skill exists) | Phase 30 |
| Video production | Partially (video-gen skill exists) | Phase 30 |
| Podcast production | NOT implemented | Phase 30 |

### Client Management Gaps
| Capability | Status | Phase |
|---|---|---|
| Revision management | NOT implemented | Phase 30 |
| Upsell automation | NOT implemented | Phase 30 |
| Referral tracking | NOT implemented | Phase 30 |
| Churn prevention | NOT implemented | Phase 30 |
| NPS surveys | NOT implemented | Phase 30 |

### Business Operations Gaps
| Capability | Status | Phase |
|---|---|---|
| Multi-currency support | Partially (ledger supports it, UI doesn't) | Phase 30 |
| Payroll (contractor payments) | Partially (ledger entry exists, no UI) | Phase 30 |
| Insurance/liability docs | NOT implemented | Phase 30 |
| IP assignment agreements | NOT implemented | Phase 30 |
| NDA generation | NOT implemented | Phase 30 |

---

## Open-Source AI Tool Gaps

| Tool | ARIA Gap | Phase |
|---|---|---|
| AutoGPT | UI polish | Phase 29 |
| CrewAI | Voice calls (needs Docker) | Phase 29 |
| Dify | Visual builder (drag-and-drop workflow) | Phase 30 |
| n8n | Template library (pre-built workflows) | Phase 30 |
| MetaGPT | Research focus (academic papers) | Phase 30 |

---

## Priority Order for Phase 29

1. **UI Migration** (highest user impact — 6.5 → 9/10)
2. **Dark Mode** (user explicitly requested — 0 → 9/10)
3. **Mobile Responsive** (accessibility — 3 → 9/10)
4. **3 remaining Z-AI calls** (completeness — 7 → 9/10)
5. **Memory Watchdog** (OOM prevention — 5 → 9/10)
6. **1-hour soak test** (deployment validation)
7. **Live voice test** (feature completeness — 6 → 9/10)

---

*Created: 2026-08-19 (Phase 28)*
*Target completion: Phase 29*
