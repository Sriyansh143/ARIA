# JARVIS Mission Control — Complete Application Documentation

**Version:** v9.0.0 (ARIA branding layer active)
**Owner:** Liafon Software Private Limited · Raviteja Voruganti
**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Prisma (SQLite) · z-ai-web-dev-sdk (GLM-4.6) · Zustand · Framer Motion · Recharts · Socket.io
**Repository root:** `/home/z/my-project/`
**Single-page SPA route:** `/` (SSR disabled — client-only dashboard)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tab Inventory (25 tabs)](#2-tab-inventory-25-tabs)
3. [API Reference (111 routes)](#3-api-reference-111-routes)
4. [Prisma Models (34 models)](#4-prisma-models-34-models)
5. [Lib Modules (99 files)](#5-lib-modules-99-files)
6. [Mini-Services — WebSocket Realtime Service](#6-mini-services--websocket-realtime-service)
7. [Agent Monitor System (8 monitors)](#7-agent-monitor-system-8-monitors)
8. [Orion Shell](#8-orion-shell)
9. [Keyboard Shortcuts](#9-keyboard-shortcuts)
10. [Feature Connectivity Map](#10-feature-connectivity-map)
11. [Security](#11-security)
12. [Cron Jobs (27+ jobs)](#12-cron-jobs-27-jobs)
13. [Pending / Future Work](#13-pending--future-work)
14. [Appendix: File Map](#14-appendix-file-map)

---

## 1. Project Overview

### 1.1 What is JARVIS Mission Control?

JARVIS Mission Control (branded at runtime as **ARIA — Autonomous Responsive Intelligence Assistant**) is a comprehensive autonomous-agent orchestration dashboard. It is a single-page web application that gives a human operator a real-time operations console over a fleet of 64+ AI agents (codenamed after mythological figures and stars — ORION, VEGA, ATLAS, NOVA, ECHO, SAGE, FORGE, PULSE, and 56 others) organized into 16 departments (Engineering, Research, Data, Design, Product, Marketing, Sales, Finance, Legal, HR, Operations, Security, Support, Content, QA, Infrastructure).

The dashboard exposes **25 tabs** (down from a previous high of 41 — a TAB-CONSOLIDATION pass merged similar tabs into "MergedTab" wrappers with sub-view toggles), **111 API routes**, **34 Prisma models**, **99 lib modules**, an **8-monitor agent observability system**, an **Orion voice shell** with 14 intent routings, a **WebSocket mini-service** for true real-time updates, a **27+ job cron scheduler** with real dispatchers, AES-256-GCM encrypted credential vaults, and an AI chat interface powered by GLM-4.6 via the `z-ai-web-dev-sdk`.

### 1.2 Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router) | SSR disabled; client-only SPA on `/`. `runtime='nodejs'`, `dynamic='force-dynamic'` on most APIs. |
| Language | TypeScript 5 | Strict typing throughout; ESLint clean (0 errors / 0 warnings). |
| Styling | Tailwind CSS 4 + custom CSS tokens | JARVIS cyberpunk dark theme + polished light theme. CSS variables: `--j-bg`, `--j-panel`, `--j-cyan`, `--j-green`, `--j-amber`, `--j-red`, `--j-violet`, `--j-text`, `--j-text-dim`, `--j-text-mute`, `--j-border`. |
| Database | SQLite via Prisma 6.11 | `db/custom.db`. Schema at `prisma/schema.prisma` (647 lines, 34 models). Singleton PrismaClient in `src/lib/db.ts`. |
| LLM | `z-ai-web-dev-sdk` (GLM-4.6) | Unified `chat()` / `quickChat()` / `extractJson()` in `src/lib/llm.ts`. Vision uses `chat.completions.createVision` with `glm-4.6v`. Image gen uses `images.generations.create`. |
| State | Zustand | `src/lib/nav-store.ts` exposes `useTabNav()` + `useNavStore()` for cross-component navigation without prop-drilling. |
| Animations | Framer Motion 12 | Tab transitions, modal/drawer entrance, activity ticker marquee, orb states. |
| Charts | Recharts 2.15 | Area/Bar/Line/Pie/Radar charts across Overview/Analytics/Models/Health/Reports. |
| Drag & Drop | @dnd-kit/core + @dnd-kit/sortable | Powers Kanban cross-column moves + intra-column reordering. |
| Realtime | Socket.io (server) + socket.io-client (browser) | `mini-services/realtime-service/` — independent bun project on port 3003. |
| UI primitives | shadcn/ui (Radix) | 39 components in `src/components/ui/`. |
| Markdown | `react-markdown` | Chat tab + Reports tab + AI Insights. |
| Voice | Web Speech API | `webkitSpeechRecognition` for STT, `speechSynthesis` for TTS — used by Orion Shell. |
| Notifications | Web Notifications API + Web Audio API | Desktop toasts + synthesized beep tones in NotificationsBell. |
| Scraping | cheerio | `src/lib/web-scraper.ts` replaces the original Crawlee dependency. |

### 1.3 Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Browser (Client SPA)                          │
│                                                                      │
│   src/app/page-client.tsx (2029 lines) — shell + header + sidebar    │
│     ├─ OverviewTab / ChatTab / TasksMergedTab / …  (25 tabs)         │
│     ├─ CommandPalette (Cmd+K)                                        │
│     ├─ GlobalSearch (Cmd+Shift+F) — 9 entity types                   │
│     ├─ NotificationsBell — type filters + sound + desktop notifs     │
│     ├─ ActivityTicker — scrolling marquee of recent events           │
│     ├─ ManageTabsModal — pin/hide/reorder                            │
│     ├─ ShortcutsOverlay — `?` overlay with `G`+letter navigation     │
│     └─ OrionShell overlay (Cmd+Shift+O) — voice + intent routing     │
│                                                                      │
│   src/lib/nav-store.ts — Zustand store (single source of truth)      │
│   src/lib/action-tracker.ts — fire-and-forget telemetry               │
│   src/components/jarvis/ActionTrackerProvider.tsx — wraps app        │
│   src/components/jarvis/ErrorBoundary.tsx — React class boundary     │
│   src/lib/use-realtime.ts — Socket.io hooks                          │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ HTTPS (Next.js API routes :3000)
                                │ + WebSocket (Socket.io :3003)
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          Next.js Server (:3000)                       │
│                                                                      │
│   src/app/api/**  (111 route.ts files)                               │
│     ├─ /api/dashboard     /api/agents          /api/tasks             │
│     ├─ /api/orion/command /api/orchestrate/parallel /api/reasoning   │
│     ├─ /api/agent-monitors (8 monitors)        /api/health            │
│     ├─ /api/payment-methods  /api/credentials  /api/branding          │
│     ├─ /api/reports/{daily,pdf,email,diff}    /api/search (9 types)  │
│     ├─ /api/admin/{data,backup}               /api/cron/{history}    │
│     └─ …                                                              │
│                                                                      │
│   src/lib/**  (99 lib modules)                                       │
│     ├─ llm.ts (GLM-4.6 client)        db.ts (Prisma singleton)        │
│     ├─ config.ts (AGENT_ROSTER 64 + SKILL_CATALOG + CRON_ROSTER)     │
│     ├─ agent-monitors.ts (8 monitors) cron-dispatcher.ts (27+)       │
│     ├─ credential-vault.ts (AES-256-GCM) branding.ts (DB-backed)     │
│     ├─ orion-intent.ts (14 intents)   nav-store.ts (Zustand)         │
│     ├─ agent-spawner.ts model-sync.ts earning-research.ts            │
│     ├─ parallel-orchestrator.ts dag-planner.ts task-decomposer.ts    │
│     ├─ state-bus.ts os-executor.ts guardrails.ts circuit-breaker.ts  │
│     ├─ image-generator.ts video-generator.ts audio-generator.ts      │
│     ├─ voice-agent.ts vision-agent.ts browser-agent.ts web-scraper.ts│
│     ├─ audit-log.ts blackbox.ts backup-rotate.ts cron-history.ts     │
│     ├─ claude-skills/ (10 reasoning patterns + pipeline + index)    │
│     └─ … (P-1..P-4 ported ~67 high-value lib files from jarvis zip) │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ Prisma 6.11 + SQLite
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   SQLite — db/custom.db (34 models)                   │
│                                                                      │
│   Agent, AgentLog, AgentHeartbeat, Skill, Task, TaskLink,            │
│   MemoryItem, Telemetry, CronJob, Payment, Artifact, ChatMessage,    │
│   Provider, Notification, FallbackEvent, AgentMessage, SkillRun,     │
│   Pipeline, ScheduledAutonomy, AutonomyRun, AutonomyTemplate,        │
│   ReportDiff, SpawnedAgent, SpawnedAgentLog, PlatformCredential,     │
│   EarningMethod, SkillLearning, Plugin, Rule, Department,            │
│   WorkforceAgent, Model, ModelKnowledge, OwnerPaymentMethod,         │
│   UserAction, AgentMonitorFinding, AuditLog, CronHistory, User       │
└──────────────────────────────────────────────────────────────────────┘
                                ▲
                                │ Socket.io (:3003) — independent bun process
┌──────────────────────────────────────────────────────────────────────┐
│          mini-services/realtime-service/index.ts (405 lines)          │
│   - state:snapshot burst on connect                                 │
│   - Every 5s: fleet:update / metrics:update / notifications:new      │
│              / activity:new                                          │
│   - Skips broadcast when clientCount()===0                           │
│   - Own PrismaClient (separate process from Next.js)                 │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.4 Application Information Architecture

The sidebar organizes 25 tabs into **8 intelligent groups** (researched against Datadog, Grafana, Vercel, Retool, Linear):

| Group | Accent | Tabs |
|---|---|---|
| **Command Center** | cyan | Overview · ARIA Chat · Activity Feed · AI Insights |
| **Agent Fleet** | cyan | Agent Fleet · Agent Comms |
| **Work & Tasks** | amber | Tasks · Goals |
| **Intelligence** | violet | Skills · Autonomy Loop · AI Models |
| **Knowledge Base** | violet | Memory · Learning · Rules & Plugins · Artifacts |
| **Monitoring & Ops** | red | Fleet Health · Monitoring · Scheduler |
| **Business & Revenue** | green | Payments · Earning Methods · Analytics & Reports · Services Hub |
| **System & Admin** | amber | Data Management · Branding · App Tree |

A "Pinned" group appears at the top dynamically when the operator pins tabs via the Command Palette (`Cmd+K` → click the pin icon) or Manage Tabs modal.

### 1.5 Build & Run

```bash
# Install dependencies
bun install

# Push Prisma schema to SQLite (idempotent)
bunx prisma db push --accept-data-loss
bunx prisma generate

# Seed all reference data (agents, cron, providers, models, rules, earning methods)
bunx tsx scripts/seed-agents.ts        # 64 agents + 16 departments + 64 workforce + 15 skillLearning
bunx tsx scripts/seed-cron.ts          # 27 cron jobs + 3 extra (agent-monitors, model-sync)
bunx tsx scripts/seed-providers-models.ts   # 23 providers + 446 catalog models
bunx tsx scripts/seed-rules.ts         # 33 operator rules
bunx tsx scripts/seed-earning-methods.ts    # 15 earning methods
bunx tsx scripts/seed-learning.ts      # 15 learning records
bunx tsx scripts/seed-add.ts           # 10 comms + ~17 payments

# Start the dev server (persistent double-fork daemon — survives across bash calls)
pkill -f "next dev" 2>/dev/null; sleep 1
( setsid bash -c 'exec bunx next dev -p 3000' </dev/null >>/home/z/my-project/dev.log 2>&1 & )
sleep 12
curl -s -m 15 -w "HTTP %{http_code}\n" http://localhost:3000/ -o /dev/null

# Start the WebSocket realtime mini-service (port 3003)
bash mini-services/realtime-service/start.sh

# Lint
bun run lint    # → 0 errors, 0 warnings
```

### 1.6 Loading Pattern

- `src/app/page.tsx` is a server component that lazy-loads `page-client.tsx` (the client SPA) via `next/dynamic` with `ssr: false` and a 15-second loading timeout. A loading screen with the JARVIS logo is shown until the client mounts.
- `src/app/layout.tsx` wraps children in `<ErrorBoundary><ActionTrackerProvider>{children}</ActionTrackerProvider></ErrorBoundary>` so React crashes are caught and tracked, and `generateMetadata()` fetches branding from `/api/branding` to set the document title, description, favicon, and authors dynamically.
- `src/app/error.tsx` is the Next.js route-level error boundary.
- `src/app/global-error.tsx` is the root-level boundary (catches errors thrown in `layout.tsx` itself); uses inline CSS (no Tailwind dependency) so it renders even if the layout crashed.

---

## 2. Tab Inventory (25 tabs)

The `TABS` array in `src/app/page-client.tsx` (lines 234–278) defines 25 tabs. Each tab has `key` (TabKey union), `label`, `icon` (lucide-react), `group`, and `accent` color (from `JARVIS.colors`). The `TAB_MAP` record (lines 89–121) maps each key to a React component. **11 of the 25 tabs are "MergedTab" wrappers** that combine 2–4 sub-views via a toggle (the `MergedTab` component in `src/components/jarvis/MergedTab.tsx`).

### 2.1 Overview — `overview`

- **Group:** Command · **Icon:** `LayoutDashboard` · **Accent:** cyan
- **Component:** `OverviewTab.tsx` (268 lines)
- **What it does:** The default landing tab. Renders a hero banner ("Welcome back, Operator"), 4 clickable stat cards (Agent Fleet, Tasks, Skills, Revenue), a live telemetry area chart (CPU + MEM series), a System Info panel with 6 clickable rows (Provider Latency, Tokens, Memory, Uptime, Artifacts, Cron Jobs), an Agent Fleet list (8 most recent agents with sparklines), a Recent Tasks list, and a Notifications panel. All cards/lists/rows navigate to the relevant tab via `useTabNav()` when clicked.
- **Sub-views:** None.
- **Key UI elements:** Hero banner with system-operational pulse dot, animated stat cards with delay-staggered entrance, `AreaChart` (recharts) for CPU+MEM, clickable system-info buttons that navigate to telemetry/health/providers/memory/scheduler, "View all N agents →" / "View all N tasks →" links.
- **API endpoints consumed:** `GET /api/dashboard` (10s poll — single aggregate call with stats, agents, tasks, notifications, memory, telemetry).
- **Use cases:**
  1. **Morning standup glance** — operator opens `/`, sees 67 agents active, 17 pending tasks, ₹38,290 confirmed revenue, and AI engine latency of 142ms at a glance, then clicks the Tasks stat card to deep-link into the Tasks tab.
  2. **Quick anomaly check** — operator notices the live telemetry area chart spiking red on CPU and clicks the CPU metric to deep-link into Telemetry.
  3. **Notification triage** — operator scans the notifications list, clicks an error-type notification, and is deep-linked to the agent-monitor tab.
- **Connects to:** Fleet (stat card), Tasks (stat card), Skills (stat card), Payments (stat card), Telemetry, Health, Providers, Memory, Artifacts, Scheduler, Agent Monitor (notifications).

### 2.2 ARIA Chat — `chat`

- **Group:** Command · **Icon:** `MessageSquare` · **Accent:** violet
- **Component:** `ChatTab.tsx` (192 lines) — label is dynamically driven by branding config (`chatTabLabel`, default "ARIA Chat")
- **What it does:** Full GLM-4.6 chat interface with persistent history (stored in `ChatMessage` table). Renders markdown responses, shows typing dots while the LLM is responding, displays latency badge per message, supports 4 quick-prompt chips, ⏎ to send, Shift+⏎ for newline. Persists every conversation server-side so refresh doesn't lose history.
- **Sub-views:** None.
- **Key UI elements:** SectionTitle with "AI Engine" pill, scrollable message list with user/assistant avatars, typing indicator, `Textarea` input with Send button, 4 quick-prompt chips ("Summarize the current fleet status", "Decompose a goal: ship a pricing page", "Write a Python function to dedupe a list", "What should I monitor for the ATLAS agent?"), refresh button.
- **API endpoints consumed:** `GET /api/chat?limit=30` (one-shot on mount), `POST /api/chat` (send).
- **Use cases:**
  1. **Ask JARVIS to plan** — operator types "Decompose a goal: ship a pricing page" and receives a structured plan as markdown.
  2. **Quick code generation** — operator clicks the Python dedupe quick prompt and receives a working function in a fenced code block.
  3. **Strategic Q&A** — operator asks "What should I monitor for the ATLAS agent?" and receives a tailored checklist referencing ATLAS's role as Code Engineer.
- **Connects to:** Activity Feed (every assistant response is logged), Memory (LLM uses JARVIS persona from `JARVIS_SYSTEM_PROMPT`).

### 2.3 Activity Feed — `activity`

- **Group:** Command · **Icon:** `History` · **Accent:** green
- **Component:** `ActivityTab.tsx` (76 lines)
- **What it does:** Unified timeline of every fleet event — agent log entries, task completions, comms sends, skill runs, notifications, spawned agents, errors. Each event has a type icon + colored level badge + relative timestamp. The ActivityTicker in the header also pulls from the same endpoint for the scrolling marquee.
- **Sub-views:** None.
- **Key UI elements:** Vertical timeline with type-specific icons (error=red AlertCircle, success=green CheckCircle, warn=amber AlertTriangle, comms=violet MessageSquare, task=amber ListTodo, agent=cyan Bot, spawn=green Copy, skill=cyan Sparkles, notification=Bell), relative timestamps.
- **API endpoints consumed:** `GET /api/activity?limit=15` (10s poll).
- **Use cases:**
  1. **Forensic review** — operator scans the activity feed after an incident to reconstruct the sequence of events.
  2. **Idle-time scan** — operator notices 0 entries in the last 5 min, suggesting the fleet has stalled, and switches to the Health tab to investigate.
  3. **Verification** — after triggering an autonomy loop, operator watches the Activity Feed for the "Autonomy Loop Complete" entry.
- **Connects to:** Notifications bell (also polls /api/activity), ActivityTicker marquee in header.

### 2.4 AI Insights — `insights`

- **Group:** Command · **Icon:** `Lightbulb` · **Accent:** cyan
- **Component:** `InsightsTab.tsx` (124 lines)
- **What it does:** Generates a proactive GLM-4.6 analysis of the fleet on demand. The LLM examines live fleet state (agent count, task distribution, recent errors, revenue) and produces a narrative insight with executive summary, observations, and recommended actions. Also shows snapshot stats + a list of overloaded agents.
- **Sub-views:** None.
- **Key UI elements:** "AI Analysis" hero panel with markdown-rendered insight, regenerate button, snapshot stats (agents/tasks/revenue/errors), overloaded agents list (load >80%).
- **API endpoints consumed:** `GET /api/insights` (one-shot, manual refresh).
- **Use cases:**
  1. **Daily intelligence briefing** — operator opens AI Insights first thing in the morning and reads the LLM-generated narrative about fleet anomalies and recommended actions.
  2. **Post-incident analysis** — after a fleet-wide issue, operator regenerates insights to get an AI summary of what happened.
  3. **Capacity planning** — operator uses the overloaded agents list to decide which agents need load redistribution or sub-agent spawning.
- **Connects to:** Fleet (overloaded agents), Activity Feed (LLM uses recent activity as context).

### 2.5 Agent Fleet — `fleet` (MERGED)

- **Group:** Fleet · **Icon:** `Bot` · **Accent:** cyan
- **Component:** `FleetMergedTab` (wrapper around 4 sub-views)
- **What it does:** The primary agent management surface, combining the roster grid, network topology, spawned sub-agents, and workforce org chart into a single tab with a 4-button toggle.

#### 2.5.1 Sub-view: Roster (`FleetTab.tsx`, 1612 lines)
- Search bar (codename/name/role) + 6 status filter chips with live counts.
- Agent cards with status accent bar, animated load bar (green<50% / amber<80% / red>80%), hover chevron, group-hover effects.
- 6-card loading skeleton.
- **Detail modal** with 3 tabs (animated indicator):
  - **Overview:** 4 stat mini-cards, animated load + success rate bars, status + model info cards, last-active timestamp, skills chips.
  - **Logs:** fetches `/api/logs?agent={codename}&limit=50`, scrollable list with level badges + timestamps.
  - **Actions:** 4 action panels — **Assign New Task** (title + priority select → POST /api/tasks), **Send Message** (subject + body + priority → POST /api/comms), **Spawn Sub-Agent** (description → POST /api/agents/spawn), **Model Configuration** (model input → PATCH /api/agents/{id}).
- Header buttons: **Export** (GET /api/agents/backup → JSON file), **Import** (drag-drop JSON + paste textarea + Upsert/Create mode), **Templates** (10 pre-built agent presets across 6 categories — Research Analyst, Code Reviewer, Content Writer, Data Analyst, Customer Support, Security Scanner, DevOps Engineer, Sales Rep, QA Tester, Social Media Manager — one-click spawn with auto-suffix codename), **Compare** (pick 2-5 agents → side-by-side metrics table + Capability Radar chart with 6 normalized dimensions + 14-day Activity Timeline with 4 metric filters), **Spawn Agent**.
- **APIs consumed:** `GET /api/agents` (8s), `GET /api/agents/templates`, `GET /api/agents/backup`, `POST /api/agents`, `POST /api/agents/{id}/assign`, `POST /api/comms`, `POST /api/agents/spawn`, `PATCH /api/agents/{id}`, `POST /api/agents/backup` (import), `GET /api/agents/compare?ids=...`, `GET /api/agents/compare/timeline?ids=...&days=14`, `GET /api/agents/{id}`.
- **Use cases:**
  1. **Onboard a new specialist** — operator opens Templates, picks "Research Analyst SAGE", one-click spawns `SAGE-1939` (auto-suffixed because SAGE already exists).
  2. **Investigate a stuck agent** — operator filters by status=error, opens detail modal → Logs tab to see 50 recent error entries, then Actions → Cycle Status to reset to idle.
  3. **Cross-agent performance review** — operator opens Compare, picks 3 agents (AEGIS, ANDROMEDA, ANTARES), views the side-by-side metrics table + radar chart + 14-day activity timeline, then exports the comparison as CSV.
  4. **Send a directive** — operator opens detail modal → Actions → Send Message, addresses a high-priority message to ATLAS, and watches it appear in the Comms tab.

#### 2.5.2 Sub-view: Topology (`FleetTopologyTab.tsx`, 125 lines)
- Force-directed SVG graph showing 8+ agent nodes (colored by status, sized by load) + comms edges (aggregated from recent AgentMessages, colored by frequency, width by count; broadcasts expand to all agents).
- Stat cards (agents/working/comms-edges/avg-load), roster grid with status dot + role + load% + link count, hub-highlight banner (most-connected agent — typically ORION).
- Uses the reusable `ForceGraph` component (`src/components/jarvis/ForceGraph.tsx`) — Verlet physics simulation (node repulsion via inverse-square Coulomb, spring forces along edges, centering gravity, velocity damping), ~400 frames via requestAnimationFrame, hover highlight, drag nodes, ResizeObserver.
- **APIs consumed:** `GET /api/fleet/topology`.
- **Use cases:**
  1. **Identify the fleet hub** — operator sees the hub-highlight banner naming ORION as the most-connected agent.
  2. **Spot orphaned agents** — operator notices nodes with 0 edges and assigns them tasks via the Roster sub-view.
  3. **Visualize communication hotspots** — operator sees a thick edge between ATLAS and SAGE indicating heavy collaboration.

#### 2.5.3 Sub-view: Spawned (`SpawnedAgentsTab.tsx`, 523 lines)
- 5 stat cards (Active/Retired/Respawnable/Total Earnings/Total Tasks).
- 2-column layout: active agents with Touch/Earn/Retire/Delete buttons on left, respawnable logs with Respawn button on right.
- Spawn-New dialog (parent + role selects, skills, reason, model).
- Run-Cleanup button (calls `/api/agents/spawn/cleanup`).
- **APIs consumed:** `GET /api/agents/spawn`, `POST /api/agents/spawn`, `POST /api/agents/spawn/{id}` (touch|retire|record-earnings), `DELETE /api/agents/spawn/{id}`, `POST /api/agents/spawn/cleanup`.
- **Use cases:**
  1. **Spawn on high load** — when ATLAS hits 90% load, operator spawns a sub-agent under ATLAS for code review, observes it in the active list, and tracks its earnings over time.
  2. **Respawn a retired agent** — operator finds a respawnable log entry from a previously-retired research sub-agent and clicks Respawn to reactivate it (spawnCount increments).
  3. **Periodic cleanup** — operator clicks Run-Cleanup to auto-delete spawned agents inactive for 30 days (logs preserved).

#### 2.5.4 Sub-view: Workforce (`WorkforceTab.tsx`, 363 lines)
- Org chart: 4 stat cards, department filter pills (16 departments), grouped agent cards with seniority + status badges.
- Click → modal with title, skills, personality, manager.
- **APIs consumed:** `GET /api/workforce`, `GET /api/workforce/{id}`.
- **Use cases:**
  1. **Department-level overview** — operator filters by Engineering and sees all 4 engineering agents with their seniority levels.
  2. **Reporting structure lookup** — operator opens a workforce agent card to see their manager (reportsTo field).
  3. **Capacity planning by department** — operator scans all departments and notices Sales has 3 working agents vs Legal's 0 working, suggesting rebalancing.

- **Connects to:** Comms (Send Message action), Tasks (Assign Task action), Spawned Agents (Spawn Sub-Agent action), Models (Edit Model action), Analytics & Reports (Compare feature exports to CSV/JSON), Fleet Health (per-agent health scores from /api/health), Agent Monitor (fleet-watchdog findings link back).

### 2.6 Agent Comms — `comms`

- **Group:** Fleet · **Icon:** `MessagesSquare` · **Accent:** violet
- **Component:** `CommsTab.tsx` (319 lines)
- **What it does:** Agent-to-agent messaging bus. Inbox list (left) + message detail pane (right), thread filter chips (engineering/research/standup/ops/analytics/sales/general) with per-thread colors, priority badges (normal/high/urgent), broadcast support (toAgent=BROADCAST), unread indicators (left accent bar + violet badge), compose modal with from/to/priority/thread selectors, mark-read-on-click, delete, reply.
- **Sub-views:** None.
- **Key UI elements:** Thread filter chips (7 threads), message list with unread violet accent bars, priority badges (normal=cyan, high=amber, urgent=red), reply form pre-filled with thread + recipient, **Auto-Reply (AI)** button (Sparkles icon) — has GLM-4.6 draft an in-character reply on behalf of the recipient agent (prompt includes the agent's role for persona context, ≤80 words).
- **API endpoints consumed:** `GET /api/comms` (15s poll), `POST /api/comms`, `POST /api/comms/reply` (AI auto-reply), `PATCH /api/comms/{id}` (mark read), `DELETE /api/comms/{id}`.
- **Use cases:**
  1. **Triage urgent messages** — operator opens comms, sees a red urgent badge, reads the message, clicks Auto-Reply (AI) to draft an in-character NOVA reply, reviews it, and sends.
  2. **Broadcast a standup call** — operator composes a message to BROADCAST in the standup thread notifying all agents.
  3. **Cross-team coordination** — operator sees a thread between VEGA→SAGE about memory handoff and forwards the conversation to ORION for orchestration.
- **Connects to:** Activity Feed (every comms send emits a log), Fleet (Auto-Reply uses the recipient agent's role for persona), sidebar (unread violet badge on the Agent Comms nav button).

### 2.7 Tasks — `tasks` (MERGED)

- **Group:** Work · **Icon:** `ListTodo` · **Accent:** amber
- **Component:** `TasksMergedTab` (wrapper around 3 sub-views)

#### 2.7.1 Sub-view: List (`TasksTab.tsx`, 363 lines)
- Stat cards (Total/Pending/In Progress/Completed).
- Status filter chips (all/pending/in_progress/completed/failed).
- **Bulk operations bar** (animated slide-down via AnimatePresence) appears when ≥1 task selected via checkbox — actions: Advance Status / Set Status / Set Priority / Reassign / Delete.
- Per-task hover actions: advance, reopen, delete.
- New-task modal (title + description + priority + assignee select).
- Search bar.
- **APIs consumed:** `GET /api/tasks?status=...` (8s), `POST /api/tasks`, `POST /api/tasks/{id}` (advance), `PATCH /api/tasks/{id}` (reopen), `DELETE /api/tasks/{id}`, `POST /api/tasks/bulk`.
- **Use cases:**
  1. **Triage morning queue** — operator selects all pending tasks via the bulk bar, reassigns them to idle agents in one action.
  2. **Bulk priority escalation** — operator selects 5 tasks, sets priority=critical in one click.
  3. **Spring cleaning** — operator filters by completed, selects all, deletes in bulk.

#### 2.7.2 Sub-view: Kanban (`KanbanTab.tsx`, 427 lines)
- 4-column drag-and-drop board (Backlog / In Progress / Done / Blocked) using `@dnd-kit/sortable`.
- Cards have priority-colored left border (critical=red, high=amber, medium=cyan, low=gray).
- **Stale task indicator:** tasks older than 3 days (non-completed) get a red left border + `{N}d` age badge.
- **Drag overlay:** scales 1.03, cyan border + ring, rotate(2.5deg), stronger shadow.
- **Hover shimmer:** subtle diagonal gradient sweep.
- **GripVertical icon** color transitions to cyan on group-hover.
- **Animated progress bar:** gradient fill (cyan→green) for in-progress tasks.
- **Empty column:** dashed border drop zone with LayoutGrid icon + "Drop here" (when dragging over) or "Empty — drag tasks here" (default).
- Same-column drag → POST /api/tasks/reorder (transactional sortOrder update). Cross-column drag → PATCH /api/tasks/{id} (status change + auto-progress).
- **APIs consumed:** `GET /api/tasks`, `PATCH /api/tasks/{id}`, `POST /api/tasks/reorder`.
- **Use cases:**
  1. **Standup workflow** — operator drags 3 cards from Backlog to In Progress to signal today's work.
  2. **Re-prioritize within a column** — operator drags a critical task to the top of In Progress, sortOrder persists to DB.
  3. **Visual stale-task detection** — operator scans the board for red-bordered cards with `{N}d` badges indicating stale work.

#### 2.7.3 Sub-view: DAG (`TaskDagTab.tsx`, 259 lines)
- Stat cards (tasks/dependencies/blocked/ready).
- Force-directed graph of task nodes (colored by status, sized by priority) + edges (blocker→blocked).
- Click a node → detail panel showing blocked-by + blocks lists with per-edge remove buttons.
- AddLinkModal (select task + blocker, with validation preventing self-deps and cycles via DFS).
- **APIs consumed:** `GET /api/tasks/graph`, `GET /api/tasks/links`, `POST /api/tasks/links`, `DELETE /api/tasks/links`.
- **Use cases:**
  1. **Dependency visualization** — operator opens DAG and immediately sees the critical path: Build → Test → Deploy.
  2. **Cycle prevention** — operator tries to add an edge A→B that would create a cycle (B→A→B) and gets a 400 "this dependency would create a cycle".
  3. **Auto-unblock on completion** — when a blocker task completes, `unblockDependents()` runs in `/api/tasks/{id}` PATCH, creates a "Task Unblocked" notification for each newly-unblocked task, and the DAG graph auto-updates.

- **Connects to:** Goals (related), Agent Monitor (task-watcher flags stale/blocked tasks), Fleet (assign task action from agent detail modal), Activity Feed (every task action emits a log).

### 2.8 Goals — `goals`

- **Group:** Work · **Icon:** `Target` · **Accent:** cyan
- **Component:** `GoalsTab.tsx` (325 lines)
- **What it does:** Manages strategic goals stored as `MemoryItem` rows with scope='goal'. Each goal has a title, status (planned/in_progress/completed/paused), progress (0-100), priority, and due date. Quick +10/-10 progress buttons let operators nudge progress without opening an edit modal.
- **Sub-views:** None.
- **Key UI elements:** 4 stat cards (Total/Active/Completed/At-Risk), status filter pills, goal cards with progress bars + quick-action buttons, pin/edit/delete buttons, create/edit modal.
- **API endpoints consumed:** `GET /api/goals`, `POST /api/goals`, `PATCH /api/goals/{id}`, `DELETE /api/goals/{id}`.
- **Use cases:**
  1. **Quarterly OKR tracking** — operator creates a goal "Reach ₹10L MRR by Q4" and updates progress weekly.
  2. **Quick progress nudge** — operator clicks the +10 button to bump a goal from 50% to 60%.
  3. **Pin important goals** — operator pins the company's #1 priority goal to keep it visible.
- **Connects to:** Memory (goals stored as MemoryItem scope=goal), Activity Feed.

### 2.9 Skills — `skills` (MERGED)

- **Group:** Intelligence · **Icon:** `Sparkles` · **Accent:** cyan
- **Component:** `SkillsMergedTab` (wrapper around 3 sub-views)

#### 2.9.1 Sub-view: Catalog (`SkillsTab.tsx`, 223 lines)
- **Reasoning Skills section** (top) — horizontal scroll of 10 cards for the ported claude-skills (Chain of Thought, Constitutional AI, ReAct, Tree of Thoughts, Step-Back, Few-Shot, Guardrails, Tool Use, Long Context, Self-Reflection), each with a per-skill lucide icon (Brain/Shield/RefreshCw/TreePine/ArrowLeft/Layers/Sparkles/Wrench/FileText/GitBranch) + accent color.
- 4 stat cards (Total/Enabled/Categories/Runs).
- Category filter pills (general/research/code/comms/data/security/media).
- Search input.
- Skill cards with toggle switches + run buttons (the run button deep-links to the Runner sub-view).
- FileUpload section at the bottom for uploading skill definitions (scope='skill').
- **APIs consumed:** `GET /api/skills`, `PATCH /api/skills/{key}`, `POST /api/skills/{key}` (run), `GET /api/reasoning` (one-shot for the Reasoning Skills section).
- **Use cases:**
  1. **Browse available skills** — operator opens Skills → Catalog, filters by 'code' category, sees Code Gen / Code Review / Refactor.
  2. **Enable a disabled skill** — operator toggles the 'crm' skill from disabled to enabled.
  3. **Inspect reasoning patterns** — operator scrolls through the 10 Reasoning Skills cards to understand which cognitive patterns are available to the agent loop.

#### 2.9.2 Sub-view: Runner (`SkillRunnerTab.tsx`, 247 lines)
- 6-skill selector grid (color-coded): web-search, web-reader, summarize, code-gen, code-review, forecast.
- Input textarea with per-skill placeholder + hint.
- Run button with ⌘+⏎ shortcut.
- Result panel with type-aware rendering:
  - **web-search results** → clickable link cards (host + date + title + snippet).
  - **web-reader results** → title/url/extracted plain text.
  - **LLM skills** (summarize/code-gen/code-review/forecast) → markdown.
- Recent-runs history list (click to reload a past run).
- Loading spinner + status/latency badges.
- **APIs consumed:** `POST /api/skills/run`, `GET /api/skills/history`.
- **Use cases:**
  1. **Live research** — operator runs web-search "Next.js 16 features", gets 8 real results, clicks one to open in a new tab.
  2. **Code review** — operator pastes a function and runs code-review, receives a markdown report with issues + suggestions.
  3. **Forecast** — operator pastes monthly revenue numbers and runs forecast for next quarter.

#### 2.9.3 Sub-view: Pipeline (`SkillChainTab.tsx`, 469 lines)
- 3 preset pipelines (Research: search→read→summarize; Code Analysis: gen→review; Deep Research: search→read→forecast).
- Visual pipeline builder (add/remove/reorder steps via ↑↓ buttons, per-step skill dropdown).
- Initial input textarea.
- Per-step live status (spinner while running, ✓/✗ on completion).
- Results panel showing each step's output (search → link cards, LLM → markdown, with latency badges).
- **Saved Templates section** — DB-backed pipeline templates with owner, run count, description, Load/Delete buttons, Share toggle (Share2 icon — community sharing).
- **Community Pipelines section** — fetches `/api/pipelines?community=true`, shows all shared templates with a "Use" button (green-tinted cards with "by {owner}" labels).
- SaveTemplateModal (name + description + step preview).
- **APIs consumed:** `POST /api/skills/chain`, `GET /api/pipelines`, `POST /api/pipelines`, `GET /api/pipelines/{id}`, `DELETE /api/pipelines/{id}`, `POST /api/pipelines/{id}` (increment run counter), `PATCH /api/pipelines/{id}` (toggle shared).
- **Use cases:**
  1. **Multi-step research** — operator runs the Research preset on "AI agent frameworks 2026", watches search→read→summarize execute step-by-step, gets a final summary.
  2. **Save a custom pipeline** — operator builds a 4-step pipeline (search→read→summarize→forecast), saves it as "Quarterly Trend Analysis", shares it to the community.
  3. **Reuse a community pipeline** — operator finds "Competitor Scan" by VEGA in the Community Pipelines section, clicks Use, runs it.

- **Connects to:** Autonomy Loop (autonomy uses skill execution internally), Memory (skill runs are persisted), Activity Feed, Learning (skill proficiency tracking).

### 2.10 Autonomy Loop — `autonomy`

- **Group:** Intelligence · **Icon:** `Rocket` · **Accent:** cyan
- **Component:** `AutonomyTab.tsx` (1044 lines)
- **What it does:** The headline feature — lets an agent autonomously research a topic and auto-create/assign tasks. The agent web-searches the topic via z-ai SDK, reads the top result via page_reader, has GLM-4.6 propose 3 actionable tasks as JSON (with title/priority/assignee), persists the proposed tasks, stores an episodic memory of the research, and creates a completion notification.
- **Sub-views:** None (single page with multiple sections).
- **Key UI elements:**
  - Hero explainer banner.
  - **Parallel Orchestrator mode toggle** (Network icon + ENABLED/OFF badge + animated switch, persisted to localStorage `jarvis-autonomy-parallel`) — when enabled, run button becomes "Run Parallel Orchestration" and posts to `/api/orchestrate/parallel` which decomposes the goal into a DAG, validates acyclic, executes in topological batches via Promise.allSettled (capped at maxParallel=4), State Bus blackboard for downstream enrichment.
  - Config panel (agent selector + topic textarea + quick-topic chips).
  - Running state (animated bot + spinner).
  - Results view with stat cards (agent/steps/tasks/time), execution trace timeline (web-search → read → GLM-plan → create-tasks with per-step status + latency), and auto-created tasks list.
  - **Autonomy History** component — scrollable list of past runs (agent/topic/source-badge/tasks-created/latency), click to expand and see full execution trace + created-task chips + "re-run" button, "clear all" button, compare-select checkboxes (toggle to select up to 2 runs, then "Compare" button opens a CompareModal with side-by-side summary + deltas + step-by-step diff table).
  - **Scheduled Loops section** — lists all schedules with agent/topic/interval/last-run/run-count/last-result + run/toggle/delete actions.
  - ScheduleModal (agent selector + topic + interval chips 15m/30m/1h/2h/6h).
  - **Autonomy Templates section** — "Save" button opens SaveTemplateModal (name + agent selector + topic + interval chips), templates list with Use/Delete actions.
- **API endpoints consumed:** `POST /api/agent/autonomy` (maxDuration=120s), `GET /api/agent/history`, `DELETE /api/agent/history`, `GET /api/agent/compare?a=...&b=...`, `GET /api/scheduled-autonomy`, `POST /api/scheduled-autonomy`, `PATCH /api/scheduled-autonomy/{id}`, `DELETE /api/scheduled-autonomy/{id}`, `POST /api/scheduled-autonomy/{id}` (trigger), `GET /api/autonomy-templates`, `POST /api/autonomy-templates`, `DELETE /api/autonomy-templates/{id}`, `POST /api/orchestrate/parallel`.
- **Use cases:**
  1. **Industry research** — operator selects VEGA, enters "AI agent frameworks 2026", runs the loop → VEGA searches (5 results), reads the top article, GLM-4.6 proposes 3 tasks, all 3 created and assigned to appropriate agents in ~9 seconds.
  2. **Daily scheduled research** — operator creates a Scheduled Autonomy for VEGA on "AI industry news" every 60 min, watches the runs accumulate in history.
  3. **Parallel orchestration** — operator enables Parallel Orchestrator mode, runs "Research autonomous agent orchestration frameworks, compare 3 popular ones, identify pros/cons of each, then write a recommendation report" — gets a 4-step DAG plan executed in topological batches with State Bus context passing.
  4. **Compare runs** — operator runs the loop twice with different topics, selects both in history, clicks Compare → sees side-by-side deltas with step-by-step latency diff.
- **Connects to:** Tasks (auto-created tasks appear in Tasks tab), Memory (episodic memory stored), Notifications ("Autonomy Loop Complete" created), Activity Feed, Skills (uses skill execution internally).

### 2.11 AI Models — `models` (MERGED)

- **Group:** Intelligence · **Icon:** `Cpu` · **Accent:** cyan
- **Component:** `ModelsMergedTab` (wrapper around 2 sub-views)

#### 2.11.1 Sub-view: Models (`ModelsTab.tsx`, 1127 lines)
- Header: title + 4 action buttons (**Sync All Providers**, **Detect Local Ollama**, **Health Check Sample**, **Purge Broken with count**).
- Sync status banner: last sync time, active count, broken count, rate-limited count (kept), auto-refresh indicator (30s).
- 6 clickable stat cards (Total/Active/Broken/Rate-Limited/Local/Provider-Sourced) — each filters the list when clicked.
- Status pie chart (recharts): active/broken/rate-limited/unknown distribution with color legend.
- Filter chips: status filter (all/active/broken/rate-limited/local/provider-sourced) + tier filter (all/fast/strong/vision/giant/local) + showing-N-of-M count.
- Provider accordion (shadcn Accordion) — each provider collapsible section with name + hasKey icon + broken-count badge + model count + last sync time + per-provider Sync button + Test Key button + enabled Switch + Set/Replace Key button. (Action buttons placed OUTSIDE the AccordionTrigger to avoid nested-button HTML validation errors.)
- Model grid within each provider: tier icon + modelId + context + latency, status badge (green/amber/red/gray), source badge (seed/provider/local), disabled indicator, capability chips, last-checked relative time. Click → detail dialog.
- Model detail dialog: full metadata grid (provider/tier/context/status/source/latency/pricing/last-checked), capabilities chips, enable/disable Switch, Run Health Check button, Delete button (AlertDialog confirm).
- API key dialog: password input, "Encrypt & Save" button, "Clear stored key" button. Encryption reminder text.
- Purge confirmation AlertDialog: shows count of broken to be deleted, notes rate-limited preserved.
- Activity log panel: scrollable list of last 20 sync/health-check/purge/local/sync-all events with severity color dots.
- **APIs consumed:** `GET /api/models`, `GET /api/providers`, `GET /api/models/sync` (30s banner poll), `POST /api/models/sync`, `POST /api/models/health-check`, `POST /api/models/purge`, `GET /api/models/{id}`, `PATCH /api/models/{id}`, `DELETE /api/models/{id}`, `PATCH /api/providers/{id}` (set apiKey), `POST /api/providers/{id}/test`.
- **Use cases:**
  1. **Discover new models** — operator clicks Sync All Providers, watches the activity log show "Synced 8 models from anthropic, 0 broken".
  2. **Detect local Ollama** — operator clicks Detect Local Ollama, sees a graceful error if Ollama isn't running.
  3. **Purge broken models** — operator clicks Purge Broken, sees the count decrease as broken (not rate-limited) models are deleted.
  4. **Set provider API key** — operator opens the Anthropic accordion, clicks Set Key, pastes `sk-ant-...`, clicks Encrypt & Save — the key is AES-256-GCM encrypted and stored; only `hasKey: true` is returned in subsequent GETs.

#### 2.11.2 Sub-view: Providers (`ProvidersTab.tsx`, 73 lines)
- Provider cards with token bars.
- Latency + tokens + enabled status per provider.
- **APIs consumed:** `GET /api/providers`.
- **Use cases:**
  1. **Provider overview** — operator scans all 23 providers, sees ZAI has 142ms latency and 1.2M tokens consumed.
  2. **Latency comparison** — operator compares provider latencies to decide which to route to.

- **Connects to:** Fleet Health (provider health rows + enable/disable buttons), Agent Monitor (model-watchdog flags broken models), Branding (no direct connection), Activity Feed.

### 2.12 Memory — `memory` (MERGED)

- **Group:** Knowledge · **Icon:** `Database` · **Accent:** violet
- **Component:** `MemoryMergedTab` (wrapper around 2 sub-views)

#### 2.12.1 Sub-view: Store (`MemoryTab.tsx`, 194 lines)
- Scope filters (semantic/episodic/working/conversation/config/learning/skill/plugin/knowledge/intelligence/goal/dag-checkpoint/state-bus/agent-session/agent-metric/voice-workflow/voice-call/email-outbox/revenue-client/etc.).
- Search input.
- Memory item cards with pin/delete buttons.
- Store-memory modal (scope + key + value + tags).
- **FileUpload section** at the bottom (scope='memory') for uploading documents.
- **APIs consumed:** `GET /api/memory`, `POST /api/memory`, `PATCH /api/memory/{id}`, `DELETE /api/memory/{id}`.
- **Use cases:**
  1. **Pin a frequently-referenced fact** — operator pins the "company mission" memory item so it always sorts to the top.
  2. **Store a meeting note** — operator creates an episodic memory with key `meeting-2026-07-18` and the notes as value.
  3. **Upload a knowledge document** — operator drags a PDF onto the FileUpload zone, it's stored as an Artifact + memory item.

#### 2.12.2 Sub-view: Graph (`MemoryGraphTab.tsx`, 326 lines)
- Stat cards (items/tags/edges/pinned).
- ForceGraph (height 460) showing memory item nodes (colored by scope) + tag nodes (sized by frequency) + edges (item→tag links + tag co-occurrence edges).
- Hover highlights a node + its neighbors (dims unconnected nodes).
- Drag nodes to reposition.
- Scope filter chips (all/semantic/episodic/working/conversation — color-coded).
- Tag filter dropdown.
- Search input (filters memory items by key+value — matched nodes get a pulsing highlight ring via `highlightIds` prop, non-matches dim out).
- NodeDetailPanel showing the selected node's type badge, pinned indicator, value (for memory items) or item count (for tags), and a "connected" list of all linked nodes.
- Scope-breakdown cards (clickable — toggle scope filter).
- **Top Connected Memory Items** panel at the bottom — top 6 items by edge count, ranked with gold star for #1, clickable to select in the detail panel.
- **APIs consumed:** `GET /api/memory/graph`.
- **Use cases:**
  1. **Visualize knowledge graph** — operator sees a cluster of episodic nodes around the `meeting` tag, indicating many meeting notes.
  2. **Search for a specific memory** — operator types "jarvis" in the search, sees 1 node pulse-ring highlighted while others dim.
  3. **Identify hub memories** — operator scrolls to the Top Connected panel, sees the most-tagged memory item, clicks it to view details.
- **Connects to:** Learning (auto-move uses MemoryItem scopes), Branding (config stored as MemoryItem scope=config), Audit Log, Activity Feed.

### 2.13 Learning — `learning` (MERGED, single sub-view)

- **Group:** Knowledge · **Icon:** `GraduationCap` · **Accent:** cyan
- **Component:** `LearningMergedTab` (wraps `LearningTab.tsx`, 579 lines, which itself embeds `TeachSourceCard.tsx`)
- **What it does:** Comprehensive learning management — ingest knowledge from 6 sources (Text/URL/Video/Document/Audio/Zip), auto-categorize content into 6 sections (skill/plugin/memory/knowledge/intelligence/learning), auto-move mis-categorized items, and track skill proficiency over time.
- **Sub-views:** Single sub-view "Learn & Earn".
- **Key UI elements:**
  - **TeachSourceCard** (773 lines, embedded at top) — 6 mode toggles (Text/URL/Video/Document/Audio/Zip), common Agent + Skill inputs, Target Section dropdown (Auto-categorize default + 6 explicit sections) with live preview showing effective section + confidence + reason, mode-specific inputs:
    - Text mode: Textarea for pasting content.
    - URL mode: single URL input.
    - Video mode: URL input + note that video-understand skill handles transcription out-of-band.
    - Document mode: drag-drop zone + click-to-pick, multi-file. Accepts .pdf/.docx/.txt/.md/.csv/.json. For text formats, reads file content client-side via FileReader and stores as text chunks. For PDF/DOCX, stores metadata with "extraction pending" note.
    - Audio mode: Record button using webkitSpeechRecognition (Chrome/Edge). Live transcript with interim results. Stop button. Editable transcript Textarea. Ingest Transcript button.
    - Zip mode: file picker (single .zip), redirects to /api/upload?scope=learning.
  - **Auto-Categorize & Move panel** — Auto-Categorize button (opens preview with Textarea, live client-side suggestion badge, Analyze button calls POST /api/learning/auto-categorize), Dry-Run button (POST /api/learning/auto-move {dryRun:true}), Auto-Move All button (POST /api/learning/auto-move), results panel with scanned/moved/skipped counts + scrollable list of move details.
  - 4 stat cards (Total Records/Mastered Skills/Avg Proficiency/Total Earnings).
  - Recharts BarCharts: earnings-by-agent + proficiency-by-skill.
  - Learning records table with mastered pill (proficiency >= 90).
  - **Learning Memories panel** — fetches /api/learning/teach, shows each MemoryItem with current section badge, suggested section badge (with → prefix and mismatch highlight), key, value (truncated to 240 chars), timestamp, reason, confidence.
- **API endpoints consumed:** `GET /api/learning`, `POST /api/learning/teach`, `GET /api/learning/teach` (30 most recent across all 6 sections), `GET /api/learning/auto-categorize` (rules), `POST /api/learning/auto-categorize`, `POST /api/learning/auto-move`.
- **Use cases:**
  1. **Ingest a code snippet** — operator pastes a TypeScript function, target section auto-suggests "skill" (3 code-like keywords detected), ingests with proficiency +5.
  2. **Record an audio memo** — operator clicks Record, speaks a meeting summary, edits the transcript, ingests as a memory.
  3. **Bulk re-categorize** — operator clicks Dry-Run to preview what would move, then clicks Auto-Move All to actually migrate items to their correct sections.
- **Connects to:** Memory (uses MemoryItem as persistence), Skills (bumps skill proficiency), Earning Methods (links to learning records).

### 2.14 Rules & Plugins — `rules-plugins` (MERGED)

- **Group:** Knowledge · **Icon:** `Gavel` · **Accent:** amber
- **Component:** `RulesPluginsMergedTab` (wrapper around 2 sub-views)

#### 2.14.1 Sub-view: Rules (`RulesTab.tsx`, 257 lines)
- 4 stat cards (Total/Enabled/Critical/High).
- Category filter pills (financial/operational/safety/legal/intelligence).
- Rule cards with toggle/priority/category badges + create/edit modal.
- 33 seeded rules across 5 categories and 3 priorities (critical=6, high=15, medium=12), including:
  - **Financial (11):** Non-Investment Only, Owner Approval for Pricing, Multi-Layered Income, Recurring Revenue Priority, Dynamic Pricing per Client, Budget Discovery Before Pricing, Country-Based Pricing, Free Trial Strategy, Problem-Solving Automation Pricing, Urgent Call for Approval, Liafon Branding Default.
  - **Operational (10):** Research Before Action, Multi-Agent Discussion, Always Update Worklog (critical), Complete Pending Works, Visualize Graphs + Text, Show Pending in Chat, No Building From Scratch, Work Persistence Resume, Code Once Fixed Undisturbed, Use Available Codes.
  - **Safety (6):** No Destructive Without Snapshot, PII Redaction, Never Remove Worklog (critical), Never Delete Important Files (critical), No Conflict Other Agents (critical), Double-Confirm Payments.
  - **Legal (2):** Contract Review Required, Data Export Audit.
  - **Intelligence (4):** Check Open-Source Repos, Learning Flexible Section, Don't Add Tabs for Everything, Transparent Failure.
- **APIs consumed:** `GET /api/rules`, `POST /api/rules`, `PATCH /api/rules/{id}`, `DELETE /api/rules/{id}`.
- **Use cases:**
  1. **Toggle a rule off** — operator disables "Outreach Followup" rule during a quiet period.
  2. **Add a custom rule** — operator creates a new operational rule "Always backup before schema push" with critical priority.
  3. **Audit safety rules** — operator filters by safety category, reviews all 6 critical-safety rules.

#### 2.14.2 Sub-view: Plugins (`PluginsTab.tsx`, 268 lines)
- 4 stat cards (Total/Enabled/Categories/Configured).
- Category filter + plugin cards with enable/disable toggle + version + cfg-count + create/edit modal.
- 8 seeded plugins: web-search, web-reader, code-sandbox, email-native, telegram-bot, calendar-sync, crm-sync, browser-agent.
- **APIs consumed:** `GET /api/plugins`, `POST /api/plugins`, `PATCH /api/plugins/{id}`, `DELETE /api/plugins/{id}`.
- **Use cases:**
  1. **Enable a plugin** — operator toggles the telegram-bot plugin from disabled to enabled.
  2. **Configure a plugin** — operator opens the email-native plugin edit modal, updates the SMTP host config.
  3. **Add a new plugin** — operator creates a new plugin "stripe-webhook" with key, name, description, category.
- **Connects to:** Activity Feed, Scheduler (plugin lifecycle emits logs).

### 2.15 Artifacts — `artifacts`

- **Group:** Knowledge · **Icon:** `FolderArchive` · **Accent:** amber
- **Component:** `ArtifactsTab.tsx` (73 lines)
- **What it does:** Type-colored grid of all uploaded/generated artifacts (files, reports, images, code, datasets). Each artifact card shows name, type badge, size, created timestamp.
- **Sub-views:** None.
- **Key UI elements:** Type-colored grid (file=cyan, report=violet, image=green, code=amber, dataset=red), size formatted (KB/MB), relative timestamps.
- **API endpoints consumed:** `GET /api/artifacts`.
- **Use cases:**
  1. **Browse uploaded files** — operator scans the artifacts grid to find a previously uploaded PDF.
  2. **Find generated images** — operator filters by type=image to see all AI-generated images.
  3. **Audit dataset artifacts** — operator checks dataset artifacts for data lineage.
- **Connects to:** Memory (FileUpload stores metadata as Artifact rows), Learning, Branding.

### 2.16 Fleet Health — `health` (MERGED)

- **Group:** Monitoring · **Icon:** `HeartPulse` · **Accent:** green
- **Component:** `HealthMergedTab` (wrapper around 2 sub-views)

#### 2.16.1 Sub-view: Health (`HealthTab.tsx`, 861 lines)
- Top hero: animated overall status badge (jarvis-blink), fleet health score RadialGauge (color-coded green≥70/cyan/amber/red), last-updated TimeAgo, "Run Health Check" button (re-fetches), "Auto-Remediate" button (runs all suggested actions sequentially with toast summary), counts strip (agents/errors/providers/incidents), status pie chart, avg success/load.
- **System resources row:** 4 mini ResourceMini cards (CPU/MEM/DISK/Uptime) — each clickable, navigates to 'telemetry' tab via useTabNav(). CPU/MEM/DISK show a colored progress bar; Uptime formatted as "1d 2h" / "3h 4m".
- **Health checks grid:** 3-col responsive grid of 6 checks (Agent Fleet, AI Provider, Memory Store, Cron Scheduler, Self-Heal, Fallback Recovery), each with icon, OK/WARN/FAIL pill, detail string, and a "Fix" button if fixAction available.
- **Per-agent health table** (sortable): columns Agent, Status, Score, Load%, Succ%, Errs, Active. Sortable by clicking any column header. Clicking a row navigates to 'fleet' tab with `{ agentId }` context. Scrollable with sticky header.
- **Incident timeline:** vertical timeline of last 20 warn/error logs with severity badge, agent codename, message (line-clamp-2), relative time.
- **Provider health row:** responsive grid of mini cards per provider — name, key+model, latency (green/amber/red), tokens, enable/disable Power button (POSTs to /api/health/remediate), warning if lastError. "Manage" link → 'models' tab.
- **Remediation panel:** animated list (AnimatePresence) of suggested actions with severity color, label, and one-click "Apply" button. Auto-Remediate button at top runs all sequentially.
- **Cron scheduler health:** 3 mini stats (Total/Enabled/Stale) + scrollable list of all cron jobs with status dot, schedule, last-run relative time, run count. "Open" link → 'scheduler' tab.
- **APIs consumed:** `GET /api/health` (12s poll), `POST /api/health/remediate`.
- **Use cases:**
  1. **Morning health check** — operator opens Fleet Health, sees health score 75/100 (amber), 2 critical findings, clicks Auto-Remediate to restart stuck agents and clear old error logs.
  2. **Drill into a failing agent** — operator clicks a row in the per-agent health table with score 32, navigates to Fleet tab with that agent pre-selected.
  3. **Monitor provider latency** — operator scans the provider health row, notices OpenAI latency is 850ms (red), clicks the Power button to disable it temporarily.

#### 2.16.2 Sub-view: Telemetry (`TelemetryTab.tsx`, 120 lines)
- Stat cards (CPU/MEM/DISK/NET/LAT/TOKENS).
- 3 radial gauges (CPU/MEM/DISK).
- CPU/MEM/DISK area chart, latency line chart, agent load bars.
- **APIs consumed:** `GET /api/metrics`.
- **Use cases:**
  1. **Spot CPU spike** — operator sees the CPU area chart spiking, switches to Health to investigate.
  2. **Disk capacity check** — operator checks the DISK radial gauge, sees 87% full, decides to prune logs.
  3. **Latency monitor** — operator watches the latency line chart for provider response time trends.
- **Connects to:** Fleet (per-agent health table deep-links), Models (provider "Manage" link), Scheduler (cron "Open" link), Agent Monitor.

### 2.17 Monitoring — `monitoring` (MERGED)

- **Group:** Monitoring · **Icon:** `ShieldCheck` · **Accent:** red
- **Component:** `MonitoringMergedTab` (wrapper around 4 sub-views)

#### 2.17.1 Sub-view: Monitors (`AgentMonitorTab.tsx`, 864 lines)
- Header: ShieldCheck icon + "Agent Monitors" title + summary counts (monitors / open / critical / 24h actions) + "Refresh" + red-accented "Run All Monitors" buttons.
- Summary stat cards: 4 StatCards (Monitors=8, Open Findings, Critical, User Actions 24h).
- Monitor Registry grid (1/2/4 cols responsive): per-monitor card with icon (Bot/Zap/Gauge/ListChecks/MessageSquare/CalendarClock/Wallet/Brain), name, key, description (line-clamp-3), interval, last-run TimeAgo, open-findings pill, "Run Now" button. Clicking a card sets the findings filter to that monitor.
- High-Priority Findings panel (max-h-28rem scrollable): open critical/error findings with severity/monitor/tab/category pills, title, detail (line-clamp-3), and 4 action buttons: "Take Action → {actionTab}" (navigates via useTabNav with actionMeta context), "Create Task" (disabled if linkedTaskId set), "Acknowledge", "Dismiss". Each card has a colored left-border matching severity.
- All Findings table: filter row (Status/Severity/Tab/Monitor/Reset) + sticky-header scrollable table with columns severity/monitor/tab/title (truncated, shows "task linked" badge)/age/status/actions. Per-row action buttons: take-action, create-task, acknowledge, resolve, dismiss.
- User Activity Stats panel (3-col grid): "Actions by Type" (icon + horizontal bar per type), "Top Visited Tabs" (top 5 with clickable navigation), "Error Profile" (error count + rate big numbers + per-severity bars).
- **APIs consumed:** `GET /api/agent-monitors` (15s), `GET /api/agent-monitors/findings?{filters}` (15s), `GET /api/user-actions/stats` (15s), `POST /api/agent-monitors` (Run All), `POST /api/agent-monitors/{key}` (Run single), `PATCH /api/agent-monitors/findings/{id}` (acknowledge/resolve/dismiss), `POST /api/agent-monitors/findings/{id}/create-task`.
- **Use cases:**
  1. **Morning monitor sweep** — operator opens Monitoring → Monitors, clicks "Run All Monitors", sees 3 new findings (1 critical error rate, 2 stale crons).
  2. **Convert finding to task** — operator sees a critical finding "2 agents stuck in error state", clicks "Create Task", a new Task is created with priority=critical, tags=[agent-monitor, bug, fleet, fleet-watchdog], the finding is auto-acknowledged, and a notification is emitted.
  3. **Take action on a finding** — operator sees a payment-monitor finding about pending payments, clicks "Take Action → payments tab", navigates directly to the Payments tab with the finding's actionMeta context.
  4. **Review user activity** — operator scrolls to the User Activity Stats panel, sees that "navigate" actions dominate (5 today), with 3 errors tracked (one was a real `ReferenceError: AgentMonitorTab is not defined` caught before the file existed).

#### 2.17.2 Sub-view: Logs (`LogsTab.tsx`, 90 lines)
- Terminal-style viewer.
- Level + agent filters.
- Scrollable log list with level-colored badges (info=cyan, success=green, warn=amber, error=red, debug=mute), agent codename, message, timestamp.
- **APIs consumed:** `GET /api/logs?agent=...&level=...`.
- **Use cases:**
  1. **Filter by error level** — operator selects error filter, sees only error-level logs across the fleet.
  2. **Per-agent log review** — operator selects ATLAS from the agent filter, sees only ATLAS's logs.
  3. **Real-time monitoring** — operator leaves the Logs tab open during an autonomy loop and watches new entries stream in.

#### 2.17.3 Sub-view: Black Box (`BlackboxTab.tsx`, 262 lines)
- 4 stat cards (Total Entries/Decisions/Errors/Autonomous Actions).
- 3 filters (category, severity, agent).
- Live buffer timeline (in-memory ring buffer of last 1000 entries — decisions, token spend, outbound actions, errors, autonomous actions, goals, tasks).
- Persisted logs panel (entries flushed to AgentLog table every 30s or 200 entries).
- **APIs consumed:** `GET /api/blackbox`.
- **Use cases:**
  1. **Audit an autonomous action** — operator filters by category=autonomous, sees what actions agents took without human intervention.
  2. **Token spend review** — operator filters by category=token_spend, sees how many tokens each action consumed.
  3. **Error forensics** — operator filters by severity=critical, sees the most severe blackbox entries.

#### 2.17.4 Sub-view: Audit Log (`AuditLogTab.tsx`, 323 lines)
- Filterable table of all admin/operator actions stored in the AuditLog Prisma model.
- Filters: actor datalist, action-prefix Select (12 buckets: auth/user/agent/task/skill/pipeline/data/backup/cron/settings/admin), target Input, since datetime-local, Load-more pagination (100/page).
- Color-coded action badges, JSON meta preview, IP column, sticky table header.
- **APIs consumed:** `GET /api/audit?actor=...&action=...&target=...&since=...&limit=100`.
- **Use cases:**
  1. **Compliance audit** — operator filters by action='agent.delete', sees who deleted which agents and when.
  2. **Settings change review** — operator filters by action='settings.update', reviews all settings changes in the last week.
  3. **Backup verification** — operator filters by action='backup.create', confirms the nightly backup ran.
- **Connects to:** Notifications bell (critical findings surface at the top), Tasks (create-task from finding), Fleet/Telemetry/Models/Scheduler (action buttons deep-link to relevant tabs), Data Management (backup actions also write AuditLog rows).

### 2.18 Scheduler — `scheduler`

- **Group:** Monitoring · **Icon:** `CalendarClock` · **Accent:** violet
- **Component:** `SchedulerTab.tsx` (249 lines)
- **What it does:** Manages the 27+ cron jobs registered in the system. Each job has a key, name, schedule (cron expression), description, enabled flag, last-run timestamp, run count. Operators can toggle jobs on/off, run them manually, and view execution history.
- **Sub-views:** None.
- **Key UI elements:**
  - Autopilot banner.
  - Cron job cards with toggle + run buttons + last-run relative time + run count.
  - **Execution History panel** (between jobs list and Scheduled Report section) — scrollable table of last 20 runs with time, cronKey+name+summary counts, detail, status pill (color-coded: success=green, error=red, timeout=amber, skipped=mute), duration, age.
  - **Scheduled Report section** with "Generate Now" button (triggers /api/reports/schedule with source=scheduled) + monospace preview panel showing the generated report.
- **API endpoints consumed:** `GET /api/cron`, `POST /api/cron`, `PATCH /api/cron/{id}` (toggle), `POST /api/cron/{id}/run` (manual run, calls `dispatchCronJob(key)` which performs the real work), `GET /api/cron/history?key=...&status=...&limit=20&summaries=1`, `POST /api/reports/schedule`.
- **Use cases:**
  1. **Manual health check** — operator clicks Run on the "Fleet Health Check" cron, sees "Rotated 66 stale agents; created 10 heartbeats" in the result.
  2. **Disable an optional job** — operator toggles off the "Outreach Followup" job during a quiet period.
  3. **Audit cron history** — operator scrolls the Execution History panel, sees that the agent-monitors sweep ran 10 min ago and created 1 new finding.
- **Connects to:** Cron Dispatcher (`src/lib/cron-dispatcher.ts` performs real work per cron key), Agent Monitor (cron-monitor flags stale jobs), Reports (Scheduled Report section), Activity Feed.

### 2.19 Payments — `payments` (MERGED)

- **Group:** Business · **Icon:** `Wallet` · **Accent:** green
- **Component:** `PaymentsMergedTab` (wrapper around 2 sub-views)

#### 2.19.1 Sub-view: Transactions (`PaymentsTab.tsx`, 306 lines)
- Revenue cards (Today/Week/Month/All-Time).
- Methods breakdown (UPI/Card/Netbanking/QR/Wallet).
- Transactions table with status badges + new-payment modal.
- **Revenue Trend section** with 3 view modes:
  - **daily:** composed area+line (revenue area + count line).
  - **stacked:** bar chart broken down by payment method (UPI/card/netbanking/QR/wallet).
  - **cumulative:** running-total area chart.
  - Summary stat row (14-day total, daily avg, best day).
- **APIs consumed:** `GET /api/payments`, `POST /api/payments`, `GET /api/payments/trend`.
- **Use cases:**
  1. **Daily revenue review** — operator opens Payments, sees ₹10,998 today, switches to "stacked" view to see UPI dominates.
  2. **Record a new payment** — operator clicks New Payment, enters ₹5,000 via UPI from "Acme Corp", marks as confirmed.
  3. **Trend analysis** — operator switches to "cumulative" view, sees the 14-day running total crossing ₹65,000.

#### 2.19.2 Sub-view: Payout Methods (`PaymentMethodsTab.tsx`, 865 lines)
- 4 stat cards (Total Methods/Verified/Default Method (masked)/Total Usage).
- Security notice banner when dev encryption key is in use.
- Methods grid (1/2/3 cols responsive) — each card shows method icon (UPI→Smartphone, Bank→Landmark, Card→CreditCard, Wallet→Wallet, PayPal→AtSign, Crypto→Bitcoin), label, masked preview with lock icon + currency pill, default/verified badges, enabled Switch, usage count + last-used, hover actions (Set Default / Verify / Edit / Delete).
- Delete uses shadcn AlertDialog for confirmation.
- Add/Edit modal — method selector (6 options with icons + descriptions), currency selector (INR/USD/EUR/GBP/AED/SGD), dynamic method-specific fields:
  - UPI: VPA field (validates @).
  - Bank: Account Number + IFSC + Holder Name.
  - Card: Card Number (extracts last4) + Expiry (MM/YY) + CVV (password) — stores `{ cardLast4, token: "fullNumber|expiry|cvv" }` all encrypted.
  - Wallet: Wallet ID/Phone.
  - PayPal: Email (validates @).
  - Crypto: Wallet Address + Chain.
- Edit mode: method selector locked, "Replace details" Switch toggles detail fields (since stored details can't be decrypted for display).
- Usage panel: fetches /api/payments, shows recent 8 transactions mapped to method types.
- **APIs consumed:** `GET /api/payment-methods` (15s), `POST /api/payment-methods`, `GET /api/payment-methods/{id}`, `PATCH /api/payment-methods/{id}`, `DELETE /api/payment-methods/{id}`, `POST /api/payment-methods/{id}/verify`, `GET /api/payments` (30s).
- **Use cases:**
  1. **Add a primary UPI** — operator clicks Add Payment Method, selects UPI, enters `ravi@oksbibank`, marks as default, sees the masked preview `ravi@oksb•••`.
  2. **Verify a bank account** — operator adds HDFC account `HDFC0000123 / Savings`, clicks Verify, the method is marked verified + a Notification is created.
  3. **Set a new default** — operator clicks Set Default on a Card method, the previous default is auto-un-defaulted.
- **Connects to:** Earning Methods (agents use payout methods to receive earnings), Credential Vault (uses the same AES-256-GCM encryption), Audit Log (payment method changes are audited).

### 2.20 Earning Methods — `earnings`

- **Group:** Business · **Icon:** `DollarSign` · **Accent:** green
- **Component:** `EarningMethodsTab.tsx` (926 lines)
- **What it does:** Catalog of 28+ earning methods across 9 categories (freelance, content, saas, consulting, automation, data, creative, support, affiliate). Each method has a name, description, category, estimated monthly revenue, skills required, risk level, workflow steps, memory feedback, intelligence chart, and associated platform credentials. Includes a **Research New** button that triggers GLM-4.6 to discover 3-5 new earning method candidates daily.
- **Sub-views:** None.
- **Key UI elements:**
  - 4 stat cards (Total/Approved/Active/Est Monthly).
  - Non-investment notice banner.
  - Category filter + search.
  - Method cards with Approve/Enable/Delete buttons + expandable Accordion details:
    - Workflow timeline.
    - Memory Feedback section with Add form.
    - Intelligence BarChart (recharts) showing feedback scores over time.
    - Skills required chips.
    - Risk meter.
  - **Research New button** (Lightbulb icon) — triggers POST /api/earning-methods/research with a loading spinner and toast summarizing discovered names or rejection counts.
  - **Platform Credentials section** at the bottom — Add dialog with platform/url/username/password/notes/methodKey, credential cards with masked password + reveal/copy/touch/delete buttons.
- **API endpoints consumed:** `GET /api/earning-methods`, `POST /api/earning-methods`, `PATCH /api/earning-methods/{id}`, `DELETE /api/earning-methods/{id}`, `POST /api/earning-methods/{id}/feedback`, `GET /api/earning-methods/{id}/feedback`, `POST /api/earning-methods/research`, `GET /api/credentials`, `POST /api/credentials`, `GET /api/credentials/{id}?reveal=1`, `PATCH /api/credentials/{id}`, `DELETE /api/credentials/{id}`, `POST /api/credentials/{id}` (touch).
- **Use cases:**
  1. **Discover new methods** — operator clicks Research New, GLM-4.6 proposes 4 new methods (e.g. "AI Voiceover Services", "Logo Design Marketplace"), all validated as non-investment/low-risk, added as unapproved.
  2. **Approve + enable** — operator reviews a discovered method, clicks Approve, then Enable, sees it counted in the Active stat.
  3. **Add platform credentials** — operator adds Upwork credentials (username + password, AES-256-GCM encrypted), links them to the freelance-1 method via methodKey.
  4. **Review feedback** — operator expands an earning method's Accordion, sees the Memory Feedback section with 3 past feedback entries, adds a new one ("Worked well, $500 in 2 weeks").
- **Connects to:** Payments (payout methods receive earnings), Learning (skill proficiency required for methods), Credential Vault, Scheduler (`earning-methods-research` cron runs daily at 9 AM).

### 2.21 Analytics & Reports — `analytics` (MERGED)

- **Group:** Business · **Icon:** `BarChart3` · **Accent:** cyan
- **Component:** `AnalyticsReportsMergedTab` (wrapper around 2 sub-views)

#### 2.21.1 Sub-view: Analytics (`AnalyticsTab.tsx`, 350 lines)
- Fleet stat cards (Completion Rate / Avg Success / Total Comms / Skill Runs).
- **Activity Trend line chart** (top, 4 colored series: tasks/logs/comms/skills over time) with legend + CartesianGrid.
- Range toggle buttons (7d / 30d / all) — switches refetch with new query param.
- Task status pie chart.
- Per-agent stacked task bar chart.
- Agent capability radar chart (load/success/completion/activity/comms per agent, 3 opacity-tinted series).
- 3 leaderboard columns (Top Performers / Most Active / Most Connected with rank badges, gold star for #1, **clickable rows** that navigate to fleet tab with `{ codename }` context).
- Skill execution stats table (count/successRate/avgLatency per skillKey, color-coded success-rate).
- **Revenue Trend panel** at the bottom — fetches /api/payments/trend (14-day series), area chart with green gradient fill, 3 summary stats (Total ₹38,290, Daily Avg ₹2,735, Best Day ₹10,998), entire panel clickable → navigates to Payments tab.
- **CSV export dropdown button** (hover to reveal 3 export options: Per-Agent / Skill Stats / Time Series) — opens `/api/agents/export?range=X&type=Y` in a new tab.
- **APIs consumed:** `GET /api/agents/analytics?range=7d|30d|all`, `GET /api/agents/export?range=X&type=Y`, `GET /api/payments/trend`.
- **Use cases:**
  1. **Weekly performance review** — operator opens Analytics, switches to 7d range, sees the trend chart showing comms spiked on Wednesday.
  2. **Identify top performer** — operator sees the Top Performers leaderboard with NOVA at #1 (gold star), clicks the row to deep-link to NOVA's fleet detail.
  3. **Export analytics** — operator clicks the CSV dropdown, selects Per-Agent, downloads a CSV with Codename,Role,Status,Load,SuccessRate,Tasks,Completed,CompletionRate,Logs,Errors,CommsSent,CommsReceived for all 67 agents.

#### 2.21.2 Sub-view: Reports (`ReportsTab.tsx`, 459 lines)
- **Daily Fleet Report section** — "Generate" button (GLM-4.6 generates a narrative report with executive summary / key metrics / priority tasks / issues & risks / recommendations), "PDF Report" button (opens /api/reports/pdf?print=1 in a new tab — print-friendly HTML with JARVIS branding, A4-optimized, dark theme, fleet snapshot, AI report, agent roster, tasks, logs), "Email" button (opens EmailReportDialog with email input + Generate & Send / Send Current buttons).
- Quick-stat cards (agents/tasks/revenue/comms/errors).
- Markdown-rendered report in a frosted scrollable panel.
- **CSV Exports grid** — 6 cards (tasks/payments/comms/logs/agents/memory) with per-type color + download icons.
- **Report Diffing section** — description, count of stored reports, "Compare Reports" button (disabled if <2 reports). Opens ReportDiffModal with two report selectors + Generate button → GLM-4.6 produces a structured diff (What Changed / Improved / Regressed / Net Assessment, <200 words) as markdown.
- **Diff History section** — expandable `<details>` rows showing the two compared report keys + timestamp, click to expand and re-view the full GLM-4.6 diff markdown. "clear all" button.
- **APIs consumed:** `GET /api/reports/daily`, `GET /api/reports/pdf`, `POST /api/reports/email`, `GET /api/export/{type}`, `GET /api/reports/diff` (list), `GET /api/reports/diff?a=...&b=...` (generate diff), `GET /api/reports/diffs` (history), `DELETE /api/reports/diffs`.
- **Use cases:**
  1. **Generate daily report** — operator clicks Generate, GLM-4.6 takes ~15s, produces a markdown report with executive summary + key metrics + priority tasks + issues + recommendations.
  2. **Print to PDF** — operator clicks PDF Report, a new tab opens with a print-friendly HTML document, operator presses Ctrl+P → "Save as PDF".
  3. **Compare two reports** — operator generates a report today, another tomorrow, opens Report Diffing, clicks Compare Reports, GLM-4.6 produces a structured diff showing what improved/regressed.
  4. **Export CSV** — operator clicks the agents CSV card, downloads a CSV with all agent fields.
  5. **Email a report** — operator clicks Email, enters `commander@jarvis.mil`, clicks Generate & Send, GLM-4.6 generates a fresh report and "emails" it (stub: console.log + Notification row with type='email').
- **Connects to:** Fleet (leaderboards deep-link), Payments (revenue trend panel deep-links), Memory (reports stored as episodic MemoryItem), Audit Log, Scheduler (daily-report cron).

### 2.22 Services Hub — `services`

- **Group:** Business · **Icon:** `Briefcase` · **Accent:** amber
- **Component:** `ServicesHubTab.tsx` (165 lines)
- **What it does:** Static catalog of 20 services offered by Liafon Software Private Limited, grouped by category (existing vs ai). Each service has name, description, lucide icon, price, category, and an optional `featured` flag.
- **Sub-views:** None.
- **Key UI elements:** Company card (Liafon Software Pvt Ltd info), 4 stat cards (Total Services / Featured / Existing / AI), service cards with icon/category/price/featured ribbon.
- **API endpoints consumed:** `GET /api/services`.
- **Use cases:**
  1. **Browse service catalog** — operator opens Services Hub, sees 20 services across existing + AI categories.
  2. **Highlight featured services** — operator scans for featured ribbons, sees "AI Software Development" and "3D Website Design" are featured.
  3. **Pricing reference** — operator checks the price of "AI Chatbot Deployment" ($599) when quoting a client.
- **Connects to:** Branding (company info comes from company-config.ts + branding), Earning Methods (services can be linked to earning methods).

### 2.23 Data Management — `data-mgmt`

- **Group:** System · **Icon:** `Database` · **Accent:** amber
- **Component:** `DataManagementTab.tsx` (1056 lines)
- **What it does:** In-app admin panel for seeding and clearing demo data. Replaces CLI-only seed scripts with a full UI. Includes gzip-compressed database backups with auto-pruning.
- **Sub-views:** None.
- **Key UI elements:**
  - Header with Refresh button + warning banner: "These actions modify the database directly. Use with caution in production."
  - Stats strip (4 tiles): Tables Tracked (25), Populated, Empty, Total Rows.
  - **Current Data Inventory:** grid of 25 cards, one per table, showing table name, row count, last-updated hint. Color-coded: green = has data, gray = empty.
  - **Seed Demo Data panel:** 8 buttons in a responsive grid (1/2/3 cols):
    - "Seed Everything" (primary amber, runs `all`).
    - "Seed Agents" (64 agents + 16 depts + 25 workforce).
    - "Seed Cron Jobs" (27 jobs).
    - "Seed Providers + Models" (23 providers + 453 models).
    - "Seed Rules" (33 rules).
    - "Seed Earning Methods" (15 methods).
    - "Seed Comms + Payment History" (10 messages + ~17 payments).
    - "Seed Learning Items" (15 records).
    - Each button shows: description, target tables, estimated row count, and a Wand2 icon. Clicking opens a confirm Dialog.
  - **Remove Demo Data panel:** 7 buttons (6 default + 1 danger):
    - "Clear Transactions", "Clear Logs", "Clear Comms", "Clear Telemetry", "Clear Notifications", "Clear Spawned Agents".
    - "Reset ALL Demo Data" (RED button, double-confirm with typed "RESET" required via AlertDialog).
  - **BackupsSection** (between Remove Demo Data and footer) — self-contained inline sub-component (separate state, 30s poll): lists backups in a scrollable table with filename/size/age/3 action buttons (Download .gz, Preview JSON, Delete with confirmation dialog). Total bytes + cap/maxAge shown in the section header. Create button posts to /api/admin/backup.
- **API endpoints consumed:** `GET /api/admin/data` (25-table counts + 8-entry seedScripts catalog), `GET /api/admin/data/counts` (lightweight polling, 20s), `POST /api/admin/data {script: 'all' | 'agents' | ...}`, `DELETE /api/admin/data {scope: 'all' | 'transactions' | ...}`, `GET /api/admin/backup` (list), `POST /api/admin/backup` (create), `GET /api/admin/backup?download=<fn>` (stream .gz), `GET /api/admin/backup?restore=<fn>` (decompress JSON), `DELETE /api/admin/backup?file=<fn>`.
- **Use cases:**
  1. **Fresh setup** — operator clicks "Seed Everything", all 7 seed scripts run inline (not subprocess) in ~682ms, 25 tables populated.
  2. **Reset demo data** — operator clicks "Reset ALL Demo Data", AlertDialog requires typing "RESET" to enable the confirm button, all transactions/comms/telemetry/notifications/spawned/logs cleared but reference data (agents, providers, models, rules) preserved.
  3. **Create a backup** — operator clicks Create in BackupsSection, a gzip-compressed JSON snapshot of 17 tables is written to `/backups/jarvis-backup-YYYYMMDD-HHMMSS.json.gz`, an AuditLog row is created.
  4. **Restore from backup** — operator clicks Preview JSON on a backup, sees the decompressed content; can manually restore by reading the JSON.
- **Connects to:** All tabs (seeds populate every table), Audit Log (backup create/delete writes audit entries), Branding (seed scripts reference branding config).

### 2.24 Branding — `branding`

- **Group:** System · **Icon:** `Palette` · **Accent:** violet
- **Component:** `BrandingTab.tsx` (373 lines)
- **What it does:** DB-backed configurable branding layer. All fields have safe DEFAULT_BRANDING fallbacks (ARIA identity, Liafon Software Private Limited owner). Persisted as a MemoryItem with scope='config', key='branding'. The header app-name, version, footer powered-by, chat-tab label, and document metadata (title, description, favicon, authors) all read from this config.
- **Sub-views:** None.
- **Key UI elements:**
  - 6 field-group cards (Identity / Taglines / Company / Visual / Chat & Metadata / Agent Prompt).
  - **Live preview panel** showing how the branding will appear.
  - Save / Reset buttons.
  - Uses patch-overlay pattern — local `edits` state overlays server data via useMemo (no setState-in-effect).
- **API endpoints consumed:** `GET /api/branding` (one-shot), `POST /api/branding` (alias of PUT), `PUT /api/branding` (whitelist update), `DELETE /api/branding` (reset to defaults).
- **Use cases:**
  1. **Rebrand the app** — operator changes appName from "ARIA" to "MyCorp AI", clicks Save, the header immediately updates, document title updates.
  2. **Update chat tab label** — operator changes chatTabLabel from "ARIA Chat" to "Ask AI", the sidebar + tab strip update.
  3. **Reset to defaults** — operator clicks Reset, all branding fields revert to DEFAULT_BRANDING (ARIA / Liafon).
- **Connects to:** Header (appName, version), Sidebar (chatTabLabel), Footer (poweredBy, company), layout.tsx (`generateMetadata()` fetches branding for SEO), Chat Tab (systemPromptPreamble injected into JARVIS_SYSTEM_PROMPT).

### 2.25 App Tree — `apptree`

- **Group:** System · **Icon:** `FolderArchive` · **Accent:** cyan
- **Component:** `AppTreeTab.tsx` (228 lines)
- **What it does:** File-system browser for the project itself. Walks the project tree (max depth 4, excludes node_modules/.next/.git/tool-results/etc). Recursive tree with auto-expand top-2 levels + file preview pane showing the first 20 lines of any file with line numbers.
- **Sub-views:** None.
- **Key UI elements:** Recursive tree view, click folder to expand/collapse, click file to load preview, file preview pane with line numbers + monospace font.
- **API endpoints consumed:** `GET /api/apptree` (tree), `POST /api/apptree` (file preview, returns first 20 lines).
- **Use cases:**
  1. **Code exploration** — operator opens App Tree, navigates to `src/components/tabs/FleetTab.tsx`, sees the first 20 lines to confirm the component structure.
  2. **Project audit** — operator browses the tree to inventory all tab components and lib modules.
  3. **Quick file preview** — operator previews `package.json` to verify dependencies without leaving the dashboard.
- **Connects to:** None directly (utility tab).

---

## 3. API Reference (111 routes)

All routes live under `/home/z/my-project/src/app/api/` as `route.ts` files. Most use `runtime='nodejs'` + `dynamic='force-dynamic'`. POST-only routes correctly return 405 on GET. **Input validation** is applied on 12 routes (tasks, agents, comms, skills, memory, payments, earning-methods, credentials, goals, plugins, notifications, cron).

### 3.1 Dashboard & Metrics

| Route | Method | Purpose |
|---|---|---|
| `/api/dashboard` | GET | Single aggregate powering Overview — agents, tasks, notifications, memory, telemetry, skills count, provider info, artifacts count, cron count, process mem + uptime. |
| `/api/metrics` | GET | Live OS metrics (CPU/MEM/DISK/NET/latency/tokens) + recent telemetry series + per-agent load. |
| `/api/activity` | GET | Unified activity feed — last N events (agent logs, comms, tasks, skill runs, notifications) sorted by time. Query: `?limit=15`. |
| `/api/insights` | GET | GLM-4.6 proactive insight — gathers fleet state, calls `quickChat()` with a strategic prompt, returns narrative analysis. |
| `/api/search` | GET | Unified global search across 9 entity types (agents, tasks, memory, comms, skills, models, earning methods, rules, payments). Returns ranked results + `byType` counts. Query: `?q=...&type=...`. |

### 3.2 Agents (Fleet)

| Route | Method | Purpose |
|---|---|---|
| `/api/agents` | GET / POST | List all agents (ordered by codename) / create new (validates name ≤200 + codename ≤64 + uppercase). |
| `/api/agents/[id]` | GET / PATCH / DELETE | Get / update (status, model, load, successRate) / delete one agent. |
| `/api/agents/[id]/assign` | POST | Assign a task to an agent (sets `assigneeId`). |
| `/api/agents/analytics` | GET | Per-agent stats + fleet totals + task status distribution + skill-run stats + leaderboards + `timeSeries`. Query: `?range=7d|30d|all`. |
| `/api/agents/backup` | GET / POST | GET: download all agent configs as JSON file. POST: import agent configs from JSON (`mode: 'upsert'|'create'`). |
| `/api/agents/compare` | GET | Side-by-side comparison of 2-5 agents — health scores, task/log/comms/skill stats, winners per metric. Query: `?ids=id1,id2,id3`. |
| `/api/agents/compare/timeline` | GET | 14-day daily activity timeline for 2-5 agents (tasks/logs/comms per day). Query: `?ids=...&days=14`. |
| `/api/agents/export` | GET | CSV export of analytics. Query: `?range=7d&type=perAgent|skillStats|timeSeries`. |
| `/api/agents/templates` | GET / POST | GET: 10 pre-built agent templates (Research Analyst, Code Reviewer, etc.). POST: spawn from template by key (auto-suffix codename on collision). |
| `/api/agents/spawn` | GET / POST | GET: active spawned agents + respawnable logs + stats. POST: spawn a sub-agent (also creates an Agent row). |
| `/api/agents/spawn/[id]` | GET / POST / DELETE | Get / touch|retire|record-earnings / delete a spawned agent. |
| `/api/agents/spawn/cleanup` | GET / POST | Cron entrypoint — auto-deletes spawned agents inactive for 30 days (logs preserved). |
| `/api/agent/autonomy` | POST | Run an autonomy loop — agent web-searches → reads top result → GLM-4.6 proposes 3 tasks → persists tasks + memory + notification. `maxDuration=120s`. |
| `/api/agent/history` | GET / DELETE | List past autonomy runs (with parsed trace + taskTitles) / clear all or by id. |
| `/api/agent/compare` | GET | Compare 2 autonomy runs — full data + deltas + stepDiff. Query: `?a=...&b=...`. |

### 3.3 Tasks

| Route | Method | Purpose |
|---|---|---|
| `/api/tasks` | GET / POST | List tasks (filter by `?status=...`) / create (validates title ≤500 + description ≤5000). |
| `/api/tasks/[id]` | GET / PATCH / POST / DELETE | Get / update (status, progress, priority, assigneeId) / advance status (auto-runs `unblockDependents()` on completion) / delete (cleans up TaskLink edges). |
| `/api/tasks/bulk` | POST | Bulk operations — `action: 'advance'|'delete'|'reassign'|'set-priority'|'set-status'` with `taskIds[]`. Returns `{ok, action, affected, errors[]}`. |
| `/api/tasks/links` | GET / POST / DELETE | List task dependency edges (enriched with task titles) / create edge (with DFS cycle detection) / delete edge. |
| `/api/tasks/graph` | GET | Returns nodes (colored by status, sized by priority) + edges + stats (tasks/links/blocked/ready/completed) for DAG visualization. |
| `/api/tasks/reorder` | POST | Transactional bulk sortOrder update. Body: `{items: [{id, sortOrder}]}`. |

### 3.4 Skills

| Route | Method | Purpose |
|---|---|---|
| `/api/skills` | GET / POST | List / create (validates key ≤128 + name ≤200). |
| `/api/skills/[key]` | PATCH / POST | Toggle enabled / run (delegates to `/api/skills/run` logic). |
| `/api/skills/run` | POST | Execute a skill for real via z-ai SDK. Supports: web-search (8 results), web-reader (extracts title/html/publishedTime), summarize, code-gen, code-review, forecast (all via `zai.chat.completions.create`). Persists SkillRun + bumps Skill.runs. |
| `/api/skills/history` | GET | Recent SkillRun history. |
| `/api/skills/chain` | POST | Execute a pipeline of skill steps sequentially (each output feeds the next). `maxDuration=120s`. |
| `/api/reasoning` | GET / POST | GET: lists 10 reasoning skills + pipeline (11 total). POST: invoke any of the 11 by key. Body: `{skill, prompt, options?}`. |

### 3.5 Memory

| Route | Method | Purpose |
|---|---|---|
| `/api/memory` | GET / POST | List (filter by `?scope=...`) / upsert (validates key ≤200 + value ≤50000). |
| `/api/memory/[id]` | PATCH / DELETE | Update (scope, value, tags, pinned) / delete. |
| `/api/memory/graph` | GET | Returns nodes (memory items colored by scope + tags sized by frequency) + edges (item→tag links + tag co-occurrence) for force-directed graph. |

### 3.6 Comms (Agent Messages)

| Route | Method | Purpose |
|---|---|---|
| `/api/comms` | GET / POST | List (with `unread` count) / send (validates fromAgent ≤64, toAgent ≤64, subject ≤500, body ≤10000). |
| `/api/comms/[id]` | PATCH / DELETE | Mark read/unread / delete. |
| `/api/comms/reply` | POST | Auto-reply via GLM-4.6 — looks up original message + recipient's role, drafts an in-character reply (≤80 words), persists as new AgentMessage. |

### 3.7 Models & Providers

| Route | Method | Purpose |
|---|---|---|
| `/api/models` | GET | List all 453 models with provider/tier/status/source/context/capabilities. |
| `/api/models/[id]` | GET / PATCH / DELETE | Get / update (enabled, status, latencyMs, pricingPer1k, tier, contextWindow, capabilities, name) / delete. |
| `/api/models/sync` | GET / POST | GET: summary + activity log. POST: sync from one provider (`?providerKey=...`) or all (`'all'`) or local Ollama (`'local'`). |
| `/api/models/health-check` | POST | Health-check one model (1-token completion) or sample 10 active + 5 local. HTTP 429 → `status='rate-limited'` (KEPT). 4xx/5xx → `status='broken'`. 200 → `status='active'`. Records `latencyMs` + `lastChecked`. |
| `/api/models/purge` | POST | `deleteMany({where:{status:'broken'}})` — rate-limited PRESERVED. |
| `/api/providers` | GET | List all 23 providers (sanitized — `apiKeyEnc/Iv/Tag` NEVER returned, only `hasKey` boolean). |
| `/api/providers/[id]` | GET / PATCH | Get / update scalar fields + `apiKey` (plaintext, encrypted via `encryptPassword` before storage) or `apiKey: null` (clears). |
| `/api/providers/[id]/test` | POST | Test the stored API key by listing models from the provider's list endpoint. Returns `{ok, modelCount, error?, note?}`. |
| `/api/fleet/topology` | GET | Returns 8+ agent nodes + comms edges (aggregated from recent AgentMessages) + hub detection. |

### 3.8 Payments

| Route | Method | Purpose |
|---|---|---|
| `/api/payments` | GET / POST | List / create (validates method ∈ [upi,card,netbanking,qr,wallet] + amount > 0). |
| `/api/payments/trend` | GET | 14-day confirmed-revenue series bucketed by day. |
| `/api/payment-methods` | GET / POST | List owner payout methods (decrypted details NEVER exposed, only `masked`) / create (validates per-method details, AES-256-GCM encrypts). |
| `/api/payment-methods/[id]` | GET / PATCH / DELETE | Get / update (label, currency, enabled, verified, isDefault, lastUsedAt, usageCount, optional details re-encryption) / delete (auto-promotes next default). |
| `/api/payment-methods/[id]/verify` | POST | Flips `verified=true` + creates a Notification. |

### 3.9 Earning Methods & Credentials

| Route | Method | Purpose |
|---|---|---|
| `/api/earning-methods` | GET / POST | List + stats / create (validates name ≤200, optional key ≤128). |
| `/api/earning-methods/[id]` | PATCH / DELETE | Update / delete. |
| `/api/earning-methods/[id]/feedback` | GET / POST | List / append feedback (JSON array). |
| `/api/earning-methods/research` | POST | GLM-4.6 discovers 3-5 new earning methods — strict-JSON prompt, validates non-investment + 9-category allowlist + risk ≤ medium, slug-keyed dedup. Returns `{ok, discovered, skipped, rejected, latencyMs, methods[]}`. |
| `/api/credentials` | GET / POST | List (masked) / create (validates platform ≤100, username ≤200, password non-empty; AES-256-GCM encrypts). |
| `/api/credentials/[id]` | GET / PATCH / DELETE / POST | Get (with optional `?reveal=1` to decrypt) / update / delete / touch (updates lastUsedAt). |

### 3.10 Notifications & User Actions

| Route | Method | Purpose |
|---|---|---|
| `/api/notifications` | GET / POST | List (with `unread` count) / create (validates title ≤500). |
| `/api/notifications/[id]` | PATCH / DELETE | Mark read/unread / delete. |
| `/api/user-actions` | GET / POST | List (filter by type/tab/severity, max 500) / create (validate type ∈ [navigate,click,submit,toggle,create,delete,error,search,command] + severity ∈ [info,warn,error,critical]). |
| `/api/user-actions/stats` | GET | Last-24h stats — byType, byTab, bySeverity, top 5 tabs by navigate count, error rate. |

### 3.11 Agent Monitors (8 monitors)

| Route | Method | Purpose |
|---|---|---|
| `/api/agent-monitors` | GET / POST | GET: monitor registry + last-run + open finding counts per monitor + summary. POST: run all monitors. |
| `/api/agent-monitors/[key]` | POST | Run single monitor by key (404 if unknown). |
| `/api/agent-monitors/findings` | GET | List findings with filters (`?status=&severity=&tab=&monitorKey=&limit=`). |
| `/api/agent-monitors/findings/[id]` | PATCH | Update status (acknowledged/resolved/dismissed). Optional `createTask: true` when resolving auto-creates a Task. |
| `/api/agent-monitors/findings/[id]/create-task` | POST | Creates a Task from a finding (title=finding.title, priority mapped from severity, tags=[agent-monitor, category, tab, monitorKey]). Links finding.linkedTaskId. Sets finding.status=acknowledged. Emits Notification. Idempotent. |

### 3.12 Health

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Comprehensive — overall status, fleet health score (0-100), per-agent health rows, incident timeline (last 20 warn/error logs + FallbackEvents), provider health, cron health, 6 REAL checks, suggested remediation actions. |
| `/api/health/remediate` | POST | 5 actions: `restart-agent`, `enable-provider`, `disable-provider`, `run-selfheal`, `clear-logs`. |

### 3.13 Cron

| Route | Method | Purpose |
|---|---|---|
| `/api/cron` | GET / POST | List / create (validates key ≤128, name ≤200, schedule ≤100). |
| `/api/cron/[id]/run` | PATCH / POST | PATCH: toggle enabled. POST: manual run — calls `dispatchCronJob(key)` which performs real work, bumps runCount + lastRun, creates a notification with the result. |
| `/api/cron/history` | GET | Filterable execution history. Query: `?key=&status=&limit=&summaries=1`. |

### 3.14 Logs, Blackbox, Audit

| Route | Method | Purpose |
|---|---|---|
| `/api/logs` | GET | List agent logs (filter by `?agent=&level=`). |
| `/api/blackbox` | GET | Live in-memory buffer (1000 entries) + recent AgentLog rows. Filters: category, severity, agent. |
| `/api/audit` | GET | List AuditLog entries. Filters: `?actor=&action=&target=&since=&limit=&offset=`. |

### 3.15 Reports

| Route | Method | Purpose |
|---|---|---|
| `/api/reports/daily` | GET | GLM-4.6 daily fleet report — gathers state, calls `quickChat()` with structured prompt, stores as episodic MemoryItem + creates Notification. |
| `/api/reports/pdf` | GET | Print-friendly HTML document (~33KB) with JARVIS branding, A4-optimized, dark theme. `?print=1` auto-triggers `window.print()`. Sections: print bar, JARVIS header, Fleet Snapshot (5 KPIs), AI Operations Report (markdown→HTML), Agent Fleet Roster table, Priority Tasks table, Recent Agent Logs table, footer. |
| `/api/reports/email` | POST | Stub email delivery. Body: `{email, reportContent}` OR `{email, generate: true}`. Validates email (≤254 chars, basic shape). Logs to console + persists as `Notification(type='email')`. Returns `{ok, message, emailLogId, recipient, subject, sentAt, contentLength}`. |
| `/api/reports/schedule` | POST | Generates + stores a scheduled fleet report (source: manual|scheduled). |
| `/api/reports/diff` | GET | No ids: returns list of stored reports. With `?a=&b=`: GLM-4.6 generates a structured diff (What Changed / Improved / Regressed / Net Assessment, <200 words), persists to ReportDiff table. |
| `/api/reports/diffs` | GET / DELETE | List / clear all or by id. |

### 3.16 Export

| Route | Method | Purpose |
|---|---|---|
| `/api/export/[type]` | GET | Generates CSV for tasks/payments/comms/logs/agents/memory with proper escaping + Content-Disposition header. `type` ∈ {tasks, payments, comms, logs, agents, memory}. |

### 3.17 Pipelines, Autonomy Templates, Scheduled Autonomy

| Route | Method | Purpose |
|---|---|---|
| `/api/pipelines` | GET / POST / PATCH | List (filter `?community=true` for shared only) / upsert by name / toggle shared + update sharedWith. |
| `/api/pipelines/[id]` | GET / DELETE / POST | Get / delete / increment run counter. |
| `/api/autonomy-templates` | GET / POST | List / create (validates agent exists). |
| `/api/autonomy-templates/[id]` | GET / DELETE | Get / delete. |
| `/api/scheduled-autonomy` | GET / POST | List all / create (validates agent + prevents duplicates). |
| `/api/scheduled-autonomy/[id]` | PATCH / DELETE / POST | Toggle enabled / update interval / remove / trigger the loop NOW (compact autonomy: search→read→GLM proposes 1 task→auto-assign→memory+notification). |

### 3.18 Orion Shell

| Route | Method | Purpose |
|---|---|---|
| `/api/orion/command` | POST | Unified Orion command endpoint. Body: `{text, sessionId?}`. Parses intent via `parseIntent()`, branches to one of 14 handlers (chat, navigate, create-task, create-agent, run-skill, send-comms, health-check, sync-models, query-fleet, query-revenue, query-tasks, set-theme, search, help). Returns `{intent, response, latencyMs, sessionId, confidence?, tab?, action?, params?, suggestions?, graph?, task?, agent?, message?, skillResult?, summary?, report?, error?}`. |

### 3.19 Orchestration

| Route | Method | Purpose |
|---|---|---|
| `/api/orchestrate/parallel` | POST | Parallel orchestrator. Body: `{goal, agentCodename?, maxParallel?, useDagPlanner?}`. Decomposes → validates DAG → executes in topological batches via Promise.allSettled (capped at maxParallel=4) → State Bus blackboard → persists run summary to MemoryItem(scope='episodic') + creates Notification + cleanup state-bus context. `maxDuration=120s`. Returns `{plan, trace, results, orchestration, batches, totalDurationMs}`. |

### 3.20 Admin & System

| Route | Method | Purpose |
|---|---|---|
| `/api/admin/data` | GET / POST / DELETE | GET: 25-table counts + 8-entry seedScripts catalog. POST: run a seed script inline (`script: 'all'|'agents'|'cron'|'providers-models'|'rules'|'earning-methods'|'comms-payments'|'learning'`). DELETE: clear demo data (`scope: 'all'|'transactions'|'logs'|'comms'|'telemetry'|'notifications'|'spawned'`). |
| `/api/admin/data/counts` | GET | Lightweight counts payload (20s polling). |
| `/api/admin/backup` | GET / POST / DELETE | GET: `?download=<fn>` streams .gz, `?restore=<fn>` returns decompressed JSON, default lists backups. POST: create new backup (gzip-compressed JSON of 17 tables, auto-prunes beyond MAX_BACKUPS=20 / MAX_AGE_DAYS=90, writes AuditLog). DELETE: delete one backup by filename. |
| `/api/branding` | GET / POST / PUT / DELETE | Get config + defaults / whitelist update / reset to defaults. |
| `/api/services` | GET | Static catalog of 20 Liafon services. |
| `/api/apptree` | GET / POST | GET: walk project tree (max depth 4, excludes node_modules/.next/.git/etc). POST: returns first 20 lines of a file. |
| `/api/rollback` | GET / POST | GET: list + stats, or load one by id. POST: `{action: 'create'|'rollback'|'discard'}`. Snapshots stored as JSON files under `/rollback-snapshots/`. |
| `/api/goals` | GET / POST | List / create (goals stored as MemoryItem scope='goal', validates title ≤500). |
| `/api/goals/[id]` | PATCH / DELETE | Update / delete. |
| `/api/rules` | GET / POST | List / create (validates key ≤128, name ≤200). |
| `/api/rules/[id]` | PATCH / DELETE | Update / delete. |
| `/api/plugins` | GET / POST | List / create (validates key ≤128, name ≤200). |
| `/api/plugins/[id]` | PATCH / DELETE | Update / delete. |
| `/api/workforce` | GET | List workforce agents (filter by `?department=...`). |
| `/api/workforce/[id]` | GET / PATCH | Get / update. |
| `/api/learning` | GET / POST | List SkillLearning records / create. |
| `/api/learning/teach` | GET / POST | GET: 30 most recent MemoryItems across all 6 sections (enriched with suggestedSection/confidence/reason). POST: ingest content `{type: text|url|video|document|audio|zip, content, agentCodename?, skillKey?, targetSection?}`. |
| `/api/learning/auto-categorize` | GET / POST | GET: rule catalog (6 sections + labels + descriptions). POST: analyze content, returns `{suggestedSection, confidence, reason, scores}`. |
| `/api/learning/auto-move` | GET / POST | GET: docs + confidenceThreshold. POST: scan all MemoryItem rows in 6 sections, run autoCategorize, move rows whose suggested section differs (confidence ≥ 0.35 to avoid churn). Body: `{dryRun?, sections?, limit?}`. Conflict handling: merges by appending values + unioning tags, then deletes source. Paired `__meta` rows moved alongside. |
| `/api/chat` | GET / POST | GET: history (limit). POST: send message + history, GLM-4.6 replies. |
| `/api/artifacts` | GET / POST | List / create. |

---

## 4. Prisma Models (34 models)

Schema at `/home/z/my-project/prisma/schema.prisma` (647 lines). SQLite provider. Composite unique on `MemoryItem(key, scope)` and `TaskLink(taskId, dependsOnId)` and `SkillLearning(agentCodename, skillKey)`.

### 4.1 Core Models (original v9 schema)

| Model | Key Fields | Purpose |
|---|---|---|
| **User** | id, email (unique), name?, role, avatar? | Reserved for multi-user auth (currently single-operator). |
| **Agent** | id, name, codename (unique), role, status (idle/thinking/working/error/offline), skills (JSON), model, taskCount, logCount, successRate, load, lastActive | The 64-agent roster. Relations: logs (AgentLog[]), heartbeats (AgentHeartbeat[]), tasks (Task[] via "TaskAssignee"). |
| **AgentLog** | id, agentId, level (info/warn/error/debug/success), message, meta? (JSON), createdAt | Per-agent log entries. Indexes on agentId + createdAt. Cascade delete with Agent. |
| **AgentHeartbeat** | id, agentId, cpu, mem, latency, createdAt | Periodic per-agent resource snapshots. |
| **Skill** | id, key (unique), name, description, category, icon, enabled, config (JSON), runs | The 20-skill catalog. |
| **Task** | id, title, description?, status (pending/in_progress/completed/failed/cancelled), priority (low/medium/high/critical), assigneeId?, progress, tags (JSON), sortOrder, createdAt, updatedAt | Work items. Relations: assignee (Agent?). Indexes on status + assigneeId. |
| **MemoryItem** | id, scope (semantic/episodic/working/conversation/config/learning/skill/plugin/knowledge/intelligence/goal/dag-checkpoint/state-bus/agent-session/agent-metric/voice-workflow/voice-call/email-outbox/revenue-client/etc.), key, value, tags (JSON), pinned, createdAt, updatedAt | Universal KV store. Composite unique on [key, scope]. Index on scope. Used for branding config, DAG checkpoints, state-bus persistence, agent metrics, revenue records, outreach, voice workflows, etc. |
| **Telemetry** | id, cpu, mem, disk, net, latency, tokens, createdAt | System-wide telemetry points. |
| **CronJob** | id, key (unique), name, schedule (cron expr), description?, enabled, lastRun?, runCount, createdAt, updatedAt | The 27+ scheduled jobs. |
| **Payment** | id, method (upi/card/netbanking/qr/wallet), amount, currency, status (pending/confirmed/failed/refunded), payer?, note?, createdAt, updatedAt | Revenue transactions. Index on status. |
| **Artifact** | id, name, type (file/report/image/code/dataset), size, meta (JSON), createdAt | Uploaded + generated files. |
| **ChatMessage** | id, role (user/assistant), content, latency, model, createdAt | GLM-4.6 chat history. |
| **Provider** | id, key (unique), name, model, enabled, latency, tokens, apiKeyEnc?, apiKeyIv?, apiKeyTag?, createdAt, updatedAt | AI providers (23 seeded). API key material AES-256-GCM encrypted. |
| **Notification** | id, type (info/success/warn/error), title, message, read, createdAt | Bell dropdown notifications. |
| **FallbackEvent** | id, provider, reason, recovered, createdAt | Provider failover events. |

### 4.2 Comms & Skills (CRON-1 + CRON-2)

| Model | Key Fields | Purpose |
|---|---|---|
| **AgentMessage** | id, fromAgent, toAgent (or "BROADCAST"), subject, body, priority (normal/high/urgent), read, thread, createdAt | Agent-to-agent comms bus. Indexes on toAgent, thread, createdAt. |
| **SkillRun** | id, skillKey, input, output, status (success/error), latencyMs, tokens, createdAt | Skill execution history. Indexes on skillKey, createdAt. |

### 4.3 Tasks (CRON-4) + Pipelines (CRON-5)

| Model | Key Fields | Purpose |
|---|---|---|
| **TaskLink** | id, taskId, dependsOnId, createdAt | Task dependency edges (blocks → blocked). Composite unique on [taskId, dependsOnId]. |
| **Pipeline** | id, name, description?, steps (JSON), owner, shared, sharedWith (JSON), runs, createdAt, updatedAt | Saved skill pipeline templates. Indexes on owner, shared. |

### 4.4 Autonomy (CRON-7, CRON-8, CRON-10)

| Model | Key Fields | Purpose |
|---|---|---|
| **ScheduledAutonomy** | id, agentCodename, topic, intervalMin, enabled, lastRun?, runCount, lastResult?, createdAt, updatedAt | Scheduled autonomy loops. Indexes on agentCodename, enabled. |
| **AutonomyRun** | id, agentCodename, topic, source (manual/scheduled), status, traceJson (JSON), tasksCreated, taskTitles (JSON), latencyMs, createdAt | History of autonomy loop runs. Indexes on agentCodename, createdAt, source. |
| **AutonomyTemplate** | id, name, agentCodename, topic, intervalMin, tags (JSON), createdAt, updatedAt | Saved autonomy configs. Index on agentCodename. |
| **ReportDiff** | id, reportAKey, reportBKey, diff, createdAt | History of generated report diffs. Index on createdAt. |

### 4.5 R-2 Additions (Agent Spawning + Credential Vault)

| Model | Key Fields | Purpose |
|---|---|---|
| **SpawnedAgent** | id, agentId (unique), codename (unique), name, parentId, parentAgentId?, role, skills (JSON), model, status (active/retired), taskCount, earnings, spawnedReason?, lastUsed, expiresAt?, createdAt, updatedAt | Active spawned sub-agents. Indexes on parentId, status, lastUsed. |
| **SpawnedAgentLog** | id, logId (unique), codename, name, parentId, role, skills (JSON), model, totalEarnings, totalTasks, spawnCount, firstSpawnedAt, lastActiveAt, createdAt, updatedAt | Respawn-able log entries (preserved 30+ days after retirement). Indexes on parentId, codename. |
| **PlatformCredential** | id, platform, platformUrl?, username, passwordEnc, passwordIv, passwordTag, notes?, methodKey?, status (active), registeredAt, lastUsedAt?, createdAt, updatedAt | Encrypted platform credentials (Upwork, GitHub, etc.). Indexes on platform, methodKey, status. |
| **EarningMethod** | id, key (unique), name, description, category, earningPotential, riskLevel, skillsRequired (JSON), method, approved, enabled, autoExecute, estimatedMonthly, lastResearched?, lastExecuted?, executionCount, totalEarnings, feedback (JSON), tags (JSON), createdAt, updatedAt | Catalog of 28+ earning methods. Indexes on category, enabled, approved. |
| **SkillLearning** | id, agentCodename, skillKey, proficiency, learnedFrom?, earnings, lastUsed?, createdAt, updatedAt | Per-agent skill proficiency tracking. Composite unique on [agentCodename, skillKey]. Indexes on agentCodename, skillKey. |
| **Plugin** | id, key (unique), name, description, category, version, enabled, config (JSON), createdAt, updatedAt | Plugin registry (8 seeded). |
| **Rule** | id, key (unique), title, description, category (operational/financial/safety/legal/intelligence), priority (low/medium/high/critical), enabled, createdAt, updatedAt | Operator rules (33 seeded). |
| **Department** | id, key (unique), name, mission, headAgent?, accent, createdAt, updatedAt | 16 departments. |
| **WorkforceAgent** | id, codename (unique), name, title, departmentKey, seniority (intern/junior/mid/senior/lead/director/vp/c-suite), modelTier, skills (JSON), personality (JSON), status, reportsTo?, createdAt, updatedAt | Org-chart workforce agents (64 seeded). Indexes on departmentKey, seniority. |
| **Model** | id, providerKey, modelId, contextWindow, capabilities (JSON), tier (fast/strong/vision/giant/local/reasoning), enabled, source (seed/provider/local), status (active/broken/rate-limited/unknown), lastChecked?, pricingPer1k?, latencyMs?, createdAt, updatedAt | Catalog of 453 AI models. Indexes on providerKey, tier, status, source. |
| **ModelKnowledge** | id, modelId (unique), displayName, provider, patterns (JSON), behaviorNotes, thinkingStyle, capabilities (JSON), contextWindow, tier, lastObserved?, observationCount, createdAt, updatedAt | Per-model behavioral knowledge. Indexes on provider, tier. |

### 4.6 R-3 Additions (Owner Payment Methods + User Action Tracking + Audit)

| Model | Key Fields | Purpose |
|---|---|---|
| **OwnerPaymentMethod** | id, label, method (upi/bank/card/wallet/paypal/crypto), detailsEnc, detailsIv, detailsTag, masked, currency, isDefault, enabled, verified, lastUsedAt?, usageCount, createdAt, updatedAt | Owner's payout instruments (AES-256-GCM encrypted details). Indexes on method, enabled. |
| **UserAction** | id, sessionId, actor, type (navigate/click/submit/toggle/create/delete/error/search/command), tab?, target?, label?, meta (JSON), severity (info/warn/error/critical), duration?, createdAt | OPERATOR (human) action telemetry. Indexes on createdAt, tab, type, severity. |
| **AgentMonitorFinding** | id, monitorKey, tab, severity, category (bug/performance/ux/security/opportunity/error-rate), title, detail, evidence (JSON), suggestedAction?, actionTab?, actionMeta (JSON), status (open/acknowledged/resolved/dismissed), linkedTaskId?, createdAt, updatedAt | Findings from the 8 server-side monitor agents. Indexes on monitorKey, tab, severity, status. |
| **AuditLog** | id, actor, action, target?, meta (JSON), ipAddress?, userAgent?, createdAt | Structured audit trail for admin/operator actions. Indexes on createdAt, actor, action. |
| **CronHistory** | id, cronKey, status (success/error/timeout/skipped), durationMs, detail, createdAt | Per-cron execution history. Indexes on cronKey, createdAt, status. |

---

## 5. Lib Modules (99 files)

All in `/home/z/my-project/src/lib/`. Categorized by function:

### 5.1 Foundation (config + DB + LLM + utils)

| File | Description |
|---|---|
| `config.ts` | JARVIS v9 config: cyberpunk color palette, 64-agent AGENT_ROSTER (16 departments × 4 agents), 20-skill SKILL_CATALOG, 27+ CRON_ROSTER, STATUS_COLORS, PRIORITY_COLORS, LEVEL_COLORS, timeAgo(), fmtTime() helpers. |
| `db.ts` | PrismaClient singleton (warn/error log level, dev-mode global cache). |
| `llm.ts` | Unified LLM client backed by z-ai-web-dev-sdk (GLM-4.6). Exports: `chat(userMessage, history?, systemPrompt?) → {content, latencyMs}`, `quickChat(prompt, system?)`, `extractJson<T>(raw)`, `JARVIS_SYSTEM_PROMPT`, `ChatTurn` type. SERVER-SIDE ONLY. |
| `utils.ts` | `cn()` className merger (clsx + tailwind-merge). |
| `logger.ts` | Dependency-free structured logger — pretty-prints in dev (ANSI colors + level padding + ts + msg + key=value), JSON in prod. `logger` + `Logger` interface with debug/info/warn/error/fatal/child. LOG_LEVEL env override. |
| `settings-store.ts` | Atomic .env read/write (tmp + rename + chmod), masks secrets, validates key types (url/number/boolean), multi-key backups (_2/_3 suffixes), `testConnectivity()` for Ollama/Telegram/DB/Redis, listOllamaModels / pullOllamaModel / generateSharedKey. |
| `nav-store.ts` | Zustand store for tab navigation — `useTabNav()`, `useNavStore()`, `useNavContext()`, `useNavNonce()` hooks. Carries optional `context` payload for deep-linking. |
| `hooks/use-api.ts` | `useApi(url, intervalMs)` polling hook (intervalMs ≤ 0 = one-shot), `postJson`, `patchJson`, `deleteJson` helpers. |
| `use-realtime.ts` | Socket.io client hooks: `useRealtimeFleet()`, `useRealtimeMetrics()`, `useRealtimeNotifications()`, `useRealtimeActivity()`, `useRealtimeSnapshot()`, `useRealtimeConnected()` (via useSyncExternalStore), `requestRealtimeSnapshot()`. Singleton client with refcounting + reconnect (Infinity attempts, 1s→10s backoff). Connects to `/?XTransformPort=3003`. |
| `company-config.ts` | Liafon Software Pvt Ltd company info + LIAFON_SERVICES catalog (20 services). |
| `branding.ts` | DB-backed branding config — `getBrandingConfig()`, `updateBrandingConfig(opts)`, `resetBrandingConfig()`. Persisted as MemoryItem(scope='config', key='branding'). DEFAULT_BRANDING = ARIA identity. |
| `catalog.ts` | Model catalogs for 23 providers (zai, openai, anthropic, google, groq, together, fireworks, mistral, cohere, nvidia-nim, openrouter, ollama, huggingface, deepseek, local, + 8 bonus). PROVIDER_SEEDS, MODEL_CATALOG (446 entries), LIAFON_SERVICES re-export. |

### 5.2 Agent Infrastructure

| File | Description |
|---|---|
| `agent-spawner.ts` | `spawnSubAgent()`, `touchSpawnedAgent()`, `recordSpawnedEarnings()`, `retireSpawnedAgent()`, `cleanupExpiredSpawnedAgents()` (30-day retention), `listSpawnedAgents()`, `listRespawnableLogs()`, `getSpawnedAgent()`, `deleteSpawnedAgent()`. |
| `agent-monitors.ts` | The 8 server-side monitor agents (fleet-watchdog, api-sentinel, health-monitor, task-watcher, comm-watcher, cron-monitor, payment-monitor, model-watchdog) + `runMonitor()`, `runAllMonitors()`, `listMonitors()`, `getAllLastRuns()`, `persistFinding()` (24h dedupe). |
| `agent-loop.ts` | `runAgentLoop(message, opts)` with optional `reasoningMode` (10 modes + pipeline + null). Dynamic imports `@/lib/claude-skills` to avoid circular deps. Falls back to plain `chat()` on skill failure. |
| `agent-session.ts` | Session management — `createSession()`, `getSession()`, `updateSession()`, `listSessions()`, `expireStaleSessions()`, `abortSession()`, `resumeSession()`. Backed by Task model (status='agent_session'). |
| `agent-memory.ts` | Per-agent memory store — `AgentMemory` class with load/save/remember/forget/correctFact/recordSession/buildContextString. DB-backed via MemoryItem(scope='agent-session'). In-process singleton cache. |
| `agent-lifecycle-manager.ts` | Manages agent birth/death/restart cycles — `spawnAgent()`, `processQueue()` (in-memory job queue), `reapIdleAgents()`, `startIdleReaper()`, `getAgentStats()`, `getActiveAgentCount()`. In-process Map for instance state. |
| `agent-analytics.ts` | Tracks agent performance metrics over time — `getAgentPerformance()`, `getBestAgentForRole()`, `getAnalyticsSummary()`, `recordMetric()`. Backed by MemoryItem(scope='agent-metric'). |
| `agent-collab.ts` | Capability discovery (`findBestAgent` by skill+status+load), task handoff (`delegateTask`/`serveHandoffs`/`autoDelegate`), knowledge sharing (`shareKnowledge`/`readKnowledge`/`listKnowledge`), supervisor orchestration (`runSupervisor`), shared-plan negotiation (`proposePlan`/`amendPlan`/`approvePlan`), conversation threading. |
| `agent-bus.ts` | In-memory agent event bus — direct messaging (`sendToAgent`/`onAgentMessage`), topic broadcast (`broadcast`/`onBroadcast`), shared blackboard (`post`/`read`/`readAll`/`delete`/`watch`). |
| `agent-protocol.ts` | Message protocol/types — `AgentAction` union, `parseAgentResponse()` (4-strategy JSON parser), `extractJsonObject()`, `buildSystemPrompt()`. Local `AgentTool` interface. |
| `agent-activity-stream.ts` | Real-time activity stream — `broadcastActivity()`, `onActivity()`, `onAgentUpdate()`, `getActivityStreamStatus()`. Backed by event-bus (replaces socket.io-client). |
| `action-tracker.ts` | Client-side USER action telemetry — `trackAction(type, opts)`, `useActionTracker()` hook, `useAutoTrackNavigations()` hook, `trackNavigation()`, `trackError()`, `installGlobalTrackers()` (window.__track, __trackNav, __trackErr). Fire-and-forget via sendBeacon/fetch keepalive. 1.5s dedupe. |

### 5.3 Memory & Intelligence

| File | Description |
|---|---|
| `episodic-memory.ts` | Event-based recall — `recordEpisode()`, `recallEpisodes()`, `listAgentEpisodes()`. DB-backed via MemoryItem(scope='episodic') with agentId encoded in tags. |
| `working-memory.ts` | Short-term scratchpad per task — `setWorking`, `getWorking`, `hasWorking`, `keysWorking`, `getAllWorking`, `clearWorking`, `workingMemoryStats`. Map-of-Maps with TTL eviction (MAX_TASKS=500, MAX_ENTRIES_PER_TASK=200). |
| `context-memory.ts` | Context window management for LLM calls — `logCommand`, `getRecentCommands`, `addContextEntry`, `getContextMessages`, `initDefaultPreferences`. Pure in-memory ring buffer (8K token budget). |
| `semantic-memory.ts` | In-memory concept+relation graph — BFS traversal, MAX_CONCEPTS=2000, MAX_RELATIONS=5000. |
| `memory-consolidation.ts` | LLM-summarizes working-memory entries → episodic episode. Never throws. Always clears working memory. |
| `prompt-enhancer.ts` | Auto-injects context (conventions/memory/tech stack/agent role) + clarifies ambiguous prompts via LLM. Never throws. |
| `proactive-assistant.ts` | `generateProactiveInsights()`, `generateDailySummary()`, `routeNotification()` (priority→channels). |
| `self-improve-engine.ts` | NL upgrade requests → ImprovementPlan + scaffoldCode. `parseImprovementIntent()`, `createProposal()`, `approveProposal()`, `rejectProposal()`, `listProposals()`, `generateAutoSuggestions()` (scans agents with <70% success rate). |
| `claude-level-intelligence.ts` | 5 reasoning patterns: `chainOfThought` (think→answer), `recommendTool`, `handleLongContext` (map-reduce), `assessConfidence` (0-100), `selfReflect` (CRITIQUE/VERDICT/REVISED). Master `claudeLevelReasoning()` pipeline. |
| `claude-skills/` | 12 files: 10 reasoning patterns (01-chain-of-thought, 02-constitutional-ai, 03-react-pattern, 04-tree-of-thoughts, 05-step-back-prompting, 06-few-shot-learning, 07-guardrails, 08-tool-use, 09-long-context, 10-self-reflection) + `pipeline.ts` (master pipeline: input-guard → step-back → CoT → self-reflection → output-guard) + `index.ts` (barrel export + `REASONING_SKILLS` registry). |

### 5.4 Orchestrator Stack

| File | Description |
|---|---|
| `parallel-orchestrator.ts` | Multi-agent parallel DAG execution — `buildExecutionBatches()` (topological sort with cycle-guard), `executePlanParallel()` (Promise.allSettled capped at maxParallel=4, State Bus blackboard). |
| `hierarchical-orchestrator.ts` (v1) | Decompose → topological parallel exec → assemble. |
| `hierarchical-orchestrator-v2.ts` | Fugu isolation overlay — when PHASE17_FUGU_ISOLATION=true, replaces v1's context-passing with isolated execution (sub-agents see only their atomic task + State Bus summaries). Falls through to v1 otherwise. |
| `task-decomposer.ts` | LLM → 1-7 sub-tasks with dependsOn edges. Validates IDs, strips dangling refs, caps per-subtask iterations to [1,10], fits total to 20. Never throws. |
| `dag-planner.ts` | Kahn's-algorithm cycle detection (`validateDAG`), `generateDAGPlan()` via `chat()`, SSE streaming executor (`executeDAGPlanStreaming`), saga checkpoint to MemoryItem(scope='dag-checkpoint'), `resumeDAGPlan()` for crash-recovery. Exponential backoff retries. Skip-aware. |
| `state-bus.ts` | In-memory Map + EventEmitter pub/sub with TTL. Optional best-effort persistence to MemoryItem(scope='state-bus'). 5-min periodic cleanup. |
| `os-executor.ts` | child_process.spawn-based shell executor — 30s default / 120s max timeout, 10K char output truncation, env allow-list (strips secrets), blocklist (rm -rf /, mkfs, dd to raw disk, fork-bombs, shutdown/reboot/halt), realpathSync-based path traversal protection. |
| `fugu-isolation.ts` | `buildIsolationContext()`, `executeSubTaskIsolated()` — sub-agent sees ONLY its role triple + atomic sub-task description + State Bus summaries from deps. |

### 5.5 Autonomous Execution & Safety

| File | Description |
|---|---|
| `autonomous-executor.ts` | Stripped 15 unavailable imports, rewired to `runAgentLoop` + `os-executor` + `guardrails` + `self-healing` + `output-verifier`. |
| `autonomous-loop.ts` | 5-min tick + kill-switch + budget-gate. |
| `autonomous-watchdog.ts` | `checkRisk()` / `killSwitch` / `isArmed`. |
| `error-recovery.ts` | Zero-dep error analysis. `analyzeError()`. |
| `graceful-shutdown.ts` | SIGTERM/SIGINT + hook system + db-disconnect. `registerGracefulShutdown()`. |
| `budget-controller.ts` | `recordTokenUsage()`, `isBudgetAvailable()`. In-memory Map<date>. Ollama-is-free heuristic. |
| `guardrails.ts` | Pure regex input/output filters. Detects private keys, AWS keys, OpenAI keys, Slack tokens, GitHub PATs, password=, api_key=, SSNs, credit cards, catastrophic rm, curl|sh. SEC-4-H3 fail-closed pattern tables. In-memory Map for HITL. |
| `self-healing.ts` | `executeWithSelfHealing()` — 3-retry + escalateToCTO. In-memory ring + Notification. |
| `self-healing-runtime.ts` | ERROR_PATTERNS table (Cannot find module → npm install, Prisma errors → prisma generate/db push, EADDRINUSE → kill port). `executeWithHealing()` retries with fixes. `selfHealCode()` patches source files. |
| `output-verifier.ts` | `verifyOutput()` — uses `extractJson` from llm. Fail-closed. Promise.race timeout. |
| `circuit-breaker.ts` | In-memory Map + rolling 60s window logic. `isAvailable()` / `recordSuccess()` / `recordFailure()`. |

### 5.6 Routers

| File | Description |
|---|---|
| `fast-router.ts` | Pure-TS regex classifier (<1ms). 6 prompt categories (greeting/code/reasoning/vision/tool-use/chat) with preferred model + fallback chain. |
| `smart-router.ts` | LLM classifier invoked only when regex confidence < 0.85. Single-word label validated against PromptCategory union. |
| `local-first-router.ts` | Probes Ollama at OLLAMA_BASE_URL (5s cache), routes to Ollama /api/chat if model "looks local" + Ollama up, otherwise falls back to cloud `chat()`. |

### 5.7 External Integrations (P-3)

| File | Description |
|---|---|
| `email-native.ts` | Native SMTP send (TLS) + IMAP inbox read. Queues outgoing as MemoryItem(scope='email-outbox') + Notification. |
| `freeswitch-bridge.ts` | ESL over raw TCP. `makeCall`/`hangupCall`/`playAudio`/`sendDtmf`/`getStatus` (+ back-compat aliases). |
| `bank-portal-bridge.ts` | Sandbox stub, env-gated. |
| `client-outreach.ts` | 3D website generation + preview + pitch + negotiate. Revenue-engine calls replaced with MemoryItem-backed stubs. |
| `crm-integration.ts` | Twenty CRM integration with local fallback (MemoryItem scope='client'). |
| `github-native.ts` | `createIssue`, `listIssues`, `getIssue`, `createPullRequest`, `listPullRequests`, `listRepos`. All via fetch. |
| `telegram-broadcaster.ts` | Direct Bot API calls (no local bot service dependency). All prisma.* calls replaced with MemoryItem queries. `startBroadcastSchedule` uses native `.unref()`. |
| `chatwoot-integration.ts` | Direct Chatwoot REST + Telegram notifications. Auto-reply uses `quickChat()`. |
| `calendar-native.ts` | `createCalendarEvent`, `createGoogleCalendarEvent`, `createICalEvent` (.ics generation, no external dep), `listGoogleCalendarEvents`. |
| `social-media-manager.ts` | SocialPost → MemoryItem(scope='social-post'). Browser-agent → stub Notification. `getSocialStats()`. |
| `customer-support.ts` | SupportConversation/SupportMessage → MemoryItem. `suggestReply()` uses `quickChat()`. `getSupportStats()`. |

### 5.8 Generators (z-ai SDK)

| File | Description |
|---|---|
| `image-generator.ts` | Uses `zai.images.generations.create({prompt, size})`. Saves base64 → `/uploads/images/{uuid}.png`. `detectImageGenerationRequest()` (regex triggers). `fetchImageBuffer()`, `generateImageAnyProvider()`, `getConfiguredImageProviders()`. |
| `video-generator.ts` | ComfyUI SVD img2vid workflow submit + poll + fetch output. Upload input image (data: URL / http URL / raw base64). Inlined SSRF guard. |
| `audio-generator.ts` | TTS via Sarvam AI (primary) or SiliconFlow CosyVoice2 (fallback). Saves MP3 → `/uploads/audio/{uuid}.mp3`. `detectAudioGenerationRequest()`. |
| `voice-agent.ts` | Full STT→LLM→TTS pipeline via Sarvam API. In-memory active calls map + persisted call records (MemoryItem scope='voice-call'). Hang-up intent detection. |
| `vision-agent.ts` | Uses `zai.chat.completions.createVision({model: 'glm-4.6v', messages, thinking: 'disabled'})`. `analyzeScreenshot()`, `planAction()`, `runVisionTask()` (multi-step loop). |
| `browser-agent.ts` | Playwright dynamic import (compiles without playwright installed). Stealth launch options + init scripts. `extractElements()`, `planBrowserAction()`, `executeBrowserAction()` (click/type/select/scroll/navigate/extract). |
| `web-scraper.ts` | `fetch()` + `cheerio` (replaces Crawlee). `scrapeUrl()`, `deepCrawl()` (BFS/DFS, max 50 pages/depth 5). `htmlToMarkdown()`, `fitMarkdownHeuristic()`. Inline SSRF guard. |
| `code-sandbox.ts` | spawn()-based execution for JS/Python/Shell with 30s timeout (max 120s), 256MB memory cap, 10K output truncation, 1MB code limit, bwrap/unshare OS-level isolation on Linux, Pyodide WASM fallback. |

### 5.9 Skills & Learning

| File | Description |
|---|---|
| `skill-manifest.ts` | LobeChat-style manifest schema (identifier/meta/type/systemRole/api/ui/autoExecute). `validateManifest()`, `parseManifest()`, `defaultConfigFromManifest()`. |
| `skill-wiring.ts` | `wireSkillsToAgents()` — upserts division-default skills onto Agent rows (idempotent). DEPARTMENT_SKILLS covers 13 departments. |
| `skill-auto-loader.ts` | Scans /skills/ for SKILL.md frontmatter, parses YAML minimally, upserts into `db.skill`. 6 category inference rules. |
| `teach-source.ts` | `ingestSource({type, content, agentCodename?, skillKey?, targetSection?, meta?})`. 6 source types (text/url/video/document/audio/zip). 500-char chunking for text. PROFICIENCY_PER_TYPE: text=5, url=5, video=3, zip=8, document=6, audio=4. |
| `categorize.ts` | Pure content categorization. `autoCategorize(content)` → suggests skill/plugin/memory/knowledge/intelligence/learning + confidence + reason + scores. 6 sections. Client+server safe. |
| `earning-research.ts` | `researchNewEarningMethods()` — calls `chat()` with strict-JSON prompt for 3-5 ideas, validates non-investment only, 9-category allowlist, risk ≤ medium, slug-keyed dedup. |

### 5.10 Audit, Blackbox, Backups, Rollback

| File | Description |
|---|---|
| `audit-log.ts` | `logAudit()` + `logAuditAsync()` + AuditActions constants. Fire-and-forget. Captures IP + user-agent. |
| `blackbox.ts` | Immutable in-memory audit trail of AGENT decisions, token spend, outbound actions, errors, autonomous actions, goals, tasks. 1000-entry buffer, 200-entry flush threshold, 30s flush interval. `recordDecision()`, `recordTokenSpend()`, `recordOutbound()`, `recordError()`, `recordAutonomous()`, `queryBlackBox()`, `getBlackBoxStats()`. |
| `backup-rotate.ts` | Gzip-compressed JSON backups to `/backups/jarvis-backup-YYYYMMDD-HHMMSS.json.gz`. Auto-prune beyond MAX_BACKUPS=20 / MAX_AGE_DAYS=90. Strict filename regex. `buildDbSnapshot()` exports 17 tables. |
| `rollback-system.ts` | `createSnapshot()`, `rollback()`, `listSnapshots()`, `loadSnapshot()`, `discardSnapshot()`, `snapshotStats()`, `withRollback()` (auto-rolls-back on failure). JSON files under `/rollback-snapshots/`. Supports db/files/env/mixed scopes. |
| `git-checkpoint.ts` | `createCheckpoint()`, `listCheckpoints()`, `revertToCheckpoint()`, `discardSnapshot()`. UUID validation guards against shell injection. |
| `cron-history.ts` | `saveCronRun(cronKey, result)` (prunes to last 100/cron), `getRecentRuns(cronKey, limit)`, `getGlobalHistory(limit)`, `getAllJobSummaries()`. Best-effort. |
| `cron-dispatcher.ts` | Maps each of 27+ cron keys to an async dispatcher function. `dispatchCronJob(key)` + `listCronKeys()`. Never throws. |

### 5.11 Misc

| File | Description |
|---|---|
| `artifact-helper.ts` | Wraps `db.artifact.create` in try/catch. |
| `event-bus.ts` | Global typed pub/sub — `emitEvent`, `onEvent`, `listEventNames`. Pure EventEmitter wrapper with '*' wildcard. |
| `genetic-optimizer.ts` | Mutates role prompts via LLM, records evolution entries, checks 7-day deltas. Sunday 11 PM schedule + daily delta check. |
| `daily-research-engine.ts` | 5 categories (opensource_repos/market_trends/competitor_analysis/tech_news/pricing_research) with scheduled hours. LLM-generated findings + action items. |
| `revenue-engine.ts` | 7/14/30-day follow-ups, auto-suspend on overdue >7d, owner-confirm payment reactivation, MRR calculation. MemoryItem KV store. |
| `workflow-engine.ts` | 4 templates (code-review/bug-fix/feature-dev/deploy). Conditional branching via `new Function()`. Parallel execution with batches + per-task timeout. Replay + debug logs. |
| `triggers.ts` | Trigger types: cron/webhook/file/event. `validateTriggerConfig()`, `isCronDue()`, `triggerIdentifier()`, `triggerKey()`. |
| `mcp-server.ts` | MCP JSON-RPC 2.0 spec over stdio + HTTP + SSE — initialize/ping/tools/list/tools/call/resources/list/resources/read. |
| `plugin-system.ts` | In-memory registry + BUILTIN_PLUGINS (GitHub/Jira/Slack/Email/Calendar). Plugin enable/disable persists to `db.plugin`. `executeHook()` fires handlers in try/catch sandbox. |

---

## 6. Mini-Services — WebSocket Realtime Service

**Location:** `/home/z/my-project/mini-services/realtime-service/`

An independent bun project (separate `package.json`, own PrismaClient) that runs alongside the Next.js app. Hardcoded port **3003** (per task rules — NEVER env). The browser connects via `io("/?XTransformPort=3003")` — the Caddy gateway reads `XTransformPort` from the query string and reverse-proxies to this port.

### 6.1 Files

| File | Purpose |
|---|---|
| `package.json` | `type: module`. Deps: socket.io@^4.8.1, @prisma/client@^6.11.1, prisma@^6.11.1. Scripts: `dev` → `bun --hot index.ts`, `start` → `bun index.ts`, `postinstall` → `prisma generate`. |
| `prisma/schema.prisma` | Copy of parent schema so this service is fully independent. |
| `.env` | `DATABASE_URL=file:/home/z/my-project/db/custom.db` (same SQLite file as the Next.js app). |
| `index.ts` (405 lines) | Socket.io server with `path: '/'`. |
| `start.sh` | Convenience launcher with `setsid + nohup` so the service survives across bash tool invocations. Kills any previous instance before relaunch. |

### 6.2 Behavior

1. **On client connect:** emits `state:snapshot` with all current data (instant hydration, no 5s wait).
2. **Every 5 seconds:** emits to all connected clients:
   - `fleet:update` — total, active, byStatus, avgLoad, agents array.
   - `metrics:update` — current CPU/mem/disk/net/latency/tokens + recent series.
   - `notifications:new` — unread count + total + latest 5.
   - `activity:new` — latest 5 unified activity events.
3. **Skips broadcast entirely** when `clientCount() === 0` (saves DB load).
4. **Listens for `request:snapshot`** client event for on-demand refresh.
5. **Heartbeat log once a minute:** `tick #N — clients=X fleet=Y unread=Z`.
6. **Graceful shutdown:** SIGTERM/SIGINT → clear interval, close io, close http, `prisma.$disconnect()`.
7. **Defensive handlers:** `unhandledRejection` + `uncaughtException` (log loudly, never silently die).

### 6.3 Client Hooks (`src/lib/use-realtime.ts`, 286 lines)

- `useRealtimeFleet()` — returns `FleetUpdate | null`.
- `useRealtimeMetrics()` — returns `MetricsUpdate | null`.
- `useRealtimeNotifications()` — returns `NotificationsUpdate | null`.
- `useRealtimeActivity()` — returns `ActivityUpdate | null`.
- `useRealtimeSnapshot()` — combines all four channels + initial snapshot burst.
- `useRealtimeConnected()` — boolean, implemented with `useSyncExternalStore` (React-blessed, no lint issues, SSR-safe).
- `requestRealtimeSnapshot()` — manual snapshot request helper + `useRequestRealtimeSnapshot()` hook wrapper.
- **Graceful fallback:** returns `null` until first message arrives — components can keep their existing TanStack Query polling as a fallback.
- **Reconnect:** `Infinity` attempts, 1s→10s backoff. `transports: ['websocket', 'polling']`.
- **Singleton per browser tab** with refcounting.

### 6.4 Starting the service

```bash
bash /home/z/my-project/mini-services/realtime-service/start.sh
# or manually:
cd /home/z/my-project/mini-services/realtime-service && setsid nohup bun run dev > realtime.log 2>&1 < /dev/null &
```

---

## 7. Agent Monitor System (8 monitors)

**Location:** `/home/z/my-project/src/lib/agent-monitors.ts` (759 lines)

A registry of 8 lightweight, self-contained monitor agents that scan the database for anomalies and persist findings to the `AgentMonitorFinding` table. Each monitor is **idempotent**, runs in **isolation**, and **dedupes its own findings within a 24h window** (no spam if the same condition persists).

### 7.1 Monitor Registry

| # | Key | Name | Interval | What it checks | Suggests |
|---|---|---|---|---|---|
| 1 | `fleet-watchdog` | Fleet Watchdog | 5 min | Agents stuck in error state >5 min, agents with 0% success rate, agents above 90% load. | `navigate:fleet` |
| 2 | `api-sentinel` | API Sentinel | 5 min | UserAction error rate (≥5 errors or ≥10% rate → critical at ≥25%) + slow submits (>2s duration). | `navigate:logs` |
| 3 | `health-monitor` | System Health Monitor | 2 min | Latest Telemetry row vs CPU>80% / MEM>85% / DISK>90% thresholds (critical at >95%). | `navigate:telemetry` |
| 4 | `task-watcher` | Task Watcher | 30 min | Tasks in_progress >3 days + blocked tasks (deps not completed). | `navigate:tasks` or `navigate:task-dag` |
| 5 | `comm-watcher` | Comms Watcher | 30 min | Unread high/urgent AgentMessages >24h old. | `navigate:comms` |
| 6 | `cron-monitor` | Cron Monitor | 15 min | Parses each cron schedule, flags jobs whose lastRun is older than 2x their interval. | `navigate:scheduler` |
| 7 | `payment-monitor` | Payment Monitor | 60 min | Payments pending >7 days. | `navigate:payments` |
| 8 | `model-watchdog` | Model Watchdog | 30 min | Models with status='broken'. | `navigate:models` |

### 7.2 Finding Lifecycle

1. Each monitor's `check()` function returns `MonitorFindingInput[]` (raw findings).
2. The runner (`runMonitor(key)`) calls `persistFinding(monitorKey, input)` for each raw finding.
3. `persistFinding()` dedupes by `(monitorKey, title, status='open')` within the last 24h. If an open finding with the same title exists, the new one is skipped.
4. Created findings have status='open', severity (info/warn/error/critical), category (bug/performance/ux/security/opportunity/error-rate), title, detail, evidence (JSON), suggestedAction, actionTab, actionMeta (JSON).
5. Findings are visible in:
   - The Agent Monitor tab's "High-Priority Findings" + "All Findings" table.
   - The Notifications bell (critical findings show at the top in a red "AGENT ALERTS · N" section).
6. Operators can:
   - **Take Action** → navigate to the finding's `actionTab` with `actionMeta` context.
   - **Create Task** → POST `/api/agent-monitors/findings/{id}/create-task` — creates a Task with title=finding.title, priority mapped from severity (critical→critical, error→high, warn→medium, info→low), tags=[agent-monitor, category, tab, monitorKey]. Links finding.linkedTaskId. Sets finding.status=acknowledged. Emits Notification. Idempotent.
   - **Acknowledge** → PATCH status=acknowledged.
   - **Resolve** → PATCH status=resolved (optional `createTask: true` to auto-create task).
   - **Dismiss** → PATCH status=dismissed.

### 7.3 Invocation

Monitors are invoked 3 ways:
1. **Manually** via `/api/agent-monitors` (Run All) or `/api/agent-monitors/[key]` (Run single).
2. **Automatically** by the `agent-monitors` cron job (every 10 min — `*/10 * * * *`). Registered in `EXTRA_CRON_ROSTER` in `scripts/seed-cron.ts`.
3. **Programmatically** via `runMonitor(key)` / `runAllMonitors()`.

### 7.4 In-Memory Cache

`lastRunByMonitor` records the last run info per monitor (ranAt, durationMs, findingsCreated, ok). Exposed via `getAllLastRuns()` for the Monitor Registry UI.

---

## 8. Orion Shell

**Location:** `/home/z/my-project/src/components/jarvis/OrionShell.tsx` (1567 lines) + `src/lib/orion-intent.ts` (787 lines) + `src/app/api/orion/command/route.ts` (829 lines)

A full-screen voice-first overlay that evolves JARVIS from a dashboard into an intelligent command center. Toggle via the floating bottom-right button (Radio icon) or `Ctrl/Cmd+Shift+O`.

### 8.1 Intent Taxonomy (14 intents)

Pure-TS, zero-dependency, sync parser. Runs in <1ms so the shell shows instant feedback (orb pulse + spoken ack) before the slow API endpoint does the real work.

| Intent | Trigger Examples | Action |
|---|---|---|
| `help` | "help", "what can you do", "commands" | Returns 14-intent catalog text + suggestions. Opens HelpPanel. |
| `set-theme` | "dark mode", "light mode", "switch theme" | Client toggles `document.documentElement` classList. |
| `search` | "search for X", "find X in agents" | Client dispatches `orion:search` window event. |
| `health-check` | "health check", "system status", "are we healthy" | Server queries DB directly — agent count, error logs, providers, fallback events, stale agents, cron jobs. Returns 3-bar graph. |
| `sync-models` | "sync models", "update model list" | Server dynamic-imports `@/lib/model-sync` with `.catch(() => null)`, calls `syncAll()`. Resilient — if model-sync has its own bug, error is caught + reported. |
| `create-task` | "create a task to ship the API", "add a critical task: fix login" | Server creates Task row (title trimmed from trigger words + priority words; tags=["orion","voice"]). Returns task object. |
| `create-agent` | "spawn agent under orion for research", "new sub-agent from vega" | Server calls `spawnSubAgent()` (dynamic import). Uppercases parentCodename. Returns agent object. |
| `run-skill` | "run skill summarize on <text>", "use web-search for AI agents" | Server executes skill inline (no self-fetch loop). Persists SkillRun + bumps Skill.runs. Returns skillResult. |
| `send-comms` | "send message to orion: deploy now", "tell vega the build passed", "broadcast: standup in 5" | Server inserts AgentMessage (fromAgent="ORION", toAgent uppercased). Returns message object. |
| `query-fleet` | "fleet status", "how are agents doing" | Server groups agents by status, computes avg load/success, picks top-5 loaded. Returns 4-bar graph. |
| `query-revenue` | "revenue today", "how much money did we make" | Server aggregates today's confirmed/pending/failed payments + all-time totals + currency breakdown. Returns 3-bar graph. |
| `query-tasks` | "what's pending", "task status", "blocked tasks" | Server groups tasks by status + priority + computes blocked (no update in 24h). Returns 4-bar graph + top-5 upcoming. |
| `navigate` | "show fleet", "open tasks", "go to payments" | Client calls `useTabNav()` to switch tabs. |
| `chat` (fallback) | Everything else | Server calls `chat()` from `@/lib/llm`. |

### 8.2 Tab Aliases

The `TAB_ALIASES` map (orion-intent.ts lines 75-116) covers all 39 old TabKeys + common synonyms: "agents"→fleet, "board"→kanban, "schedule"→scheduler, "data"→data-mgmt, "metrics"→telemetry, "cron"→scheduler, etc.

### 8.3 Voice Features (retained)

- **Wake word detection** via `webkitSpeechRecognition` (continuous + interimResults, lang en-US). Detects "orion"/"aria"/"hey orion"/"hey aria"; captures remainder as command.
- **Continuous listening toggle** + wake-word-required sub-toggle + push-to-talk single-shot (8s one-shot).
- **TTS via `speechSynthesis`** with US-English female voice preference, mute toggle persisted to `localStorage('jarvis-orion-muted')`.
- **Fallback amber notice** when webkitSpeechRecognition unavailable (quick commands still work).

### 8.4 6-State Orb

Framer-motion animated orb with 6 states:
- **idle** — slow cyan pulse.
- **listening** — fast pulse + 3 expanding rings.
- **processing** — violet rotate+glow.
- **speaking** — green waveform bars.
- **success** — green pulse + CheckCircle2 icon (1.8s flash, auto-reverts).
- **error** — red x-shake `[-4,4,-3,3,0]` + AlertCircle icon (2.4s flash, auto-reverts).

### 8.5 UI Elements

- **Command palette typeahead** — shows above text input when typing; `filterPalette(typed)` returns matches; ArrowUp/Down cycles index; Enter sends selected or typed; Tab autocompletes; mouse click sends fully-formed prompts or fills partial ones. 20 pre-filled prompts (`PALETTE_ENTRIES`).
- **Action visualizer** — success/error card with intent label, title, details, expandable payload `<details>` block. Auto-clears on next command, dismissible via X.
- **Help panel** — full-screen modal showing `INTENT_CATALOG` (14 intents × icon + label + 4-5 examples). Click any example to run it.
- **Shortcuts overlay** — full-screen modal listing 10 keyboard shortcuts.
- **Proactive prompts** — rotates through `PROACTIVE_PROMPTS` every 5s when idle > 30s. Shown in amber below the orb.
- **Multi-turn context chip** — `detectContext(text)` sets chip label ("fleet discussion", "revenue discussion", etc.) on every command. Rendered as violet pill in header.
- **Mini bar graph** — API returns `graph[]` for fleet/health/revenue/tasks → rendered via Recharts BarChart (4-color Cell rotation).
- **Quick commands** (8 chips) — Fleet Status, Revenue Today, Pending Tasks, Health Check, Sync Models, Create Task…, Open Fleet Tab, Help.
- **History + log toggle** — right rail switches between history view (clickable cards re-speak the response) and log view (terminal-style: timestamp, intent, ✓/✗, prompt, response preview, latency). Both persisted to localStorage (50/100 entries). Clear button wipes both.

### 8.6 Command History Persistence

- Last 50 commands persisted to `localStorage('jarvis-orion-history')`.
- Last 100 log entries persisted to `localStorage('jarvis-orion-log')`.
- Click any history card to re-speak the response.
- Click any log row to re-run the command.

### 8.7 Smoke-Tested Examples

All verified HTTP 200:
- `help` → 1ms, 14-intent catalog.
- `fleet status` → 6ms, 67 agents summary + 4-bar graph.
- `open tasks` → 2ms, `tab:"tasks"` returned for client nav.
- `health check` → 7ms, OPERATIONAL + 100% fleet + 96% providers + 3-bar graph.
- `what is pending?` → 6ms, 17 tasks summary + 4-bar graph + upcoming list.
- `revenue today` → 38ms, ₹10,998 today + ₹38,290 all-time + 3-bar graph.
- `dark mode` / `light mode` → 1ms, theme action returned.
- `search for orion` → 1ms, search action returned.
- `create a high priority task to review the API` → 3ms, Task created (priority=high).
- `send message to vega: deploy now` → 2ms, AgentMessage inserted (toAgent=VEGA).
- `broadcast: standup in 5` → 2ms, Broadcast inserted (toAgent=BROADCAST).
- `tell atlas the build passed` → 1ms, message to ATLAS.
- `spawn an agent under orion for research` → 13ms, SpawnedAgent created (codename="ORIO-RESE-3108").
- `run skill summarize on the quick brown fox...` → 1150ms, SkillRun persisted, summary returned.
- `summarize today` (chat fallback) → 3398ms, LLM responded with fleet operations summary.
- `sync models` → 38ms, gracefully handled (model-sync has its own Prisma schema bug; caught + reported).

---

## 9. Keyboard Shortcuts

Press `?` to open the shortcuts overlay. All shortcuts respect `isTypingTarget()` — they don't fire when the user is in an input/textarea/select/contentEditable.

### 9.1 Global Shortcuts

| Shortcut | Action |
|---|---|
| `⌘ K` (or `Ctrl K`) | Open Command Palette. |
| `⌘ ⇧ F` (or `Ctrl Shift F`) | Open Global Search overlay. |
| `⌘ ⇧ O` (or `Ctrl Shift O`) | Toggle Orion voice mode. |
| `?` (Shift+/) | Toggle this shortcuts overlay. |
| `Esc` | Close any overlay (palette, search, notif, shortcuts, Orion). |
| `T` | Toggle dark/light theme (no modifiers, not while typing). |

### 9.2 Navigation Shortcuts (G + letter)

Type `G` then a letter within 1.2s to jump to a tab. Shows "listening: G…" indicator in the overlay header.

| Combo | Tab |
|---|---|
| `G O` | Overview |
| `G F` | Agent Fleet |
| `G T` | Tasks |
| `G C` | ARIA Chat |
| `G H` | Fleet Health |
| `G M` | AI Models |
| `G P` | Payments |
| `G A` | Monitoring |
| `G S` | Scheduler |

### 9.3 In-Overlay Shortcuts

| Shortcut | Action |
|---|---|
| `↑` / `↓` | Navigate items in Command Palette / Global Search. |
| `⏎` (Enter) | Open selected item. |
| `Tab` (in Orion) | Autocomplete palette entry. |
| `Space` (in Orion) | Push-to-talk (when held). |
| `M` (in Orion) | Toggle mute. |
| `L` (in Orion) | Toggle log view. |

### 9.4 Tab Pinning / Hiding (via Command Palette)

- **Pin button** (Pin icon) — toggles pin state. Pinned tabs show at the top of the sidebar in a "Pinned" group. Filled amber when pinned.
- **Hide button** (EyeOff icon) — hides the tab from the sidebar. Appears on hover.
- **Unhide button** (Eye icon, green) — only in the "Hidden" section (toggled via footer "N hidden" button).
- **Recent tabs** — last 5 visited, most recent first, deduped. `localStorage('jarvis-recent-tabs')`.
- **Frequent tabs** — top 5 by visit count, sorted desc. `localStorage('jarvis-frequent-tabs')`. Shows `N×` usage count badge in amber.

### 9.5 Saved Searches

In Global Search overlay: a "Save" (Star icon) button appears next to the search input when there's a query — click to toggle save/unsaved. When no query is typed, the overlay shows saved-search chips (click to run, X to remove). Max 8 saved searches. `localStorage('jarvis-saved-searches')`.

### 9.6 Notifications Settings

In NotificationsBell: a settings gear button (Sliders icon) opens an animated settings panel:
- **Sound alerts** toggle — green when enabled. When enabled + new notification arrives, plays a synthesized beep (Web Audio API: error=220Hz, warn=440Hz, info/success=660Hz, sine wave, 0.3 gain, 0.5s exponential ramp).
- **Desktop notifications** toggle — auto-requests `Notification.permission`. When enabled + new notification arrives, shows a desktop toast (2s debounce batching — multiple notifications grouped into one with title "N notifications (M errors)" + bullet-point body).
- **Mute by type** chips — 4 chips (success/warn/error/info), each colored with its type color. Muted types are filtered from the badge count, filter chips, and notification list.

Desktop notification click-to-navigate:
- Single: error→logs, success→activity, warn→agent-monitor, info/default→activity.
- Grouped: always → activity.

---

## 10. Feature Connectivity Map

How features connect across the app:

### 10.1 Overview → All Tabs (Clickable Cards)

The OverviewTab makes every stat card, system info row, agent list item, task list item, and notification clickable via `useTabNav()`:

- **Stat cards:** Agent Fleet → `fleet`, Tasks → `tasks`, Skills → `skills`, Revenue → `payments`.
- **System info rows:** Provider Latency → `models`, Tokens → `telemetry`, Memory → `memory`, Uptime → `health`, Artifacts → `artifacts`, Cron Jobs → `scheduler`.
- **Agent fleet list items:** → `fleet` with `{ agentId, codename }` context.
- **Recent tasks list items:** → `tasks` with `{ taskId, status }` context.
- **Notifications:** → `agent-monitor` (for errors) or `activity`.

### 10.2 Fleet → Tasks (Assign Task from Agent Detail)

In FleetTab's detail modal → Actions tab → Assign New Task panel: operator enters title + priority, clicks Assign → POST `/api/tasks` with `assigneeId`. Task appears in Tasks tab assigned to that agent.

### 10.3 Fleet → Comms (Send Message from Agent Detail)

In FleetTab's detail modal → Actions tab → Send Message panel: operator enters subject + body + priority, clicks Send → POST `/api/comms` with `fromAgent=ORION`, `toAgent=agent.codename`. Message appears in Comms tab.

### 10.4 Fleet → Spawned Agents (Spawn Sub-Agent from Agent Detail)

In FleetTab's detail modal → Actions tab → Spawn Sub-Agent panel: operator enters description, clicks Spawn → POST `/api/agents/spawn` with `parentCodename`. Navigates to Spawned Agents tab on success.

### 10.5 Fleet → Models (Edit Model from Agent Detail)

In FleetTab's detail modal → Actions tab → Model Configuration panel: operator enters new model, clicks Save → PATCH `/api/agents/{id}` with new model.

### 10.6 Fleet → Compare (Side-by-Side)

In FleetTab header → Compare button → CompareModal: pick 2-5 agents → side-by-side metrics table + Capability Radar chart (6 normalized dimensions: Health/Success/Tasks/Activity/Comms/Skills) + 14-day Activity Timeline (4 metric filters: logs/errors/comms/tasks). Export as JSON or CSV.

### 10.7 Tasks → Kanban (Sub-view toggle)

TasksMergedTab provides 3 sub-views: List / Kanban / DAG. Toggle via the MergedTab button group at the top. All 3 views operate on the same `/api/tasks` data — changes in one are reflected in others.

### 10.8 Tasks → DAG (Dependency Graph)

TaskDagTab shows the task dependency graph. Click a node → detail panel showing blocked-by + blocks lists. AddLinkModal creates new edges with DFS cycle detection.

### 10.9 Agent Monitor → Tasks (Create Task from Finding)

In AgentMonitorTab's High-Priority Findings panel: click "Create Task" on a finding → POST `/api/agent-monitors/findings/{id}/create-task`. Creates a Task with title=finding.title, priority mapped from severity, tags=[agent-monitor, category, tab, monitorKey]. Links finding.linkedTaskId. Sets finding.status=acknowledged. Emits Notification.

### 10.10 Agent Monitor → Notifications (Critical findings in bell)

The NotificationsBell in the header polls `/api/agent-monitors/findings?severity=critical&status=open&limit=5` every 15s. Critical findings show at the TOP of the dropdown in a red "AGENT ALERTS · N" section. Each finding is clickable → navigates to the finding's `actionTab` with `actionMeta` context. Badge turns RED + pulses when there are critical findings.

### 10.11 Notifications → Relevant Tabs (Click to navigate)

- Single desktop notification click: error→logs, success→activity, warn→agent-monitor, info→activity.
- Grouped desktop notification click: always → activity.
- In-bell notification click: navigates based on finding.actionTab or notification type.

### 10.12 Command Palette → All Tabs (Recent / Frequent / Pin / Hide)

CommandPalette (Cmd+K) shows 3 sections when no query:
- **RECENT** — last 5 visited tabs.
- **FREQUENT** — top 5 by visit count (with `N×` badge).
- **ALL TABS** — full list (41 tabs).

Each item has pin (Pin icon) + hide (EyeOff icon) buttons. Pinned tabs appear in sidebar "Pinned" group. Hidden tabs go to a "Hidden" section (toggled via footer "N hidden" button).

### 10.13 Global Search → All Entities (9 types)

GlobalSearch (Cmd+Shift+F) searches across 9 entity types:
- **agents** (codename/name/role) → `fleet` tab
- **tasks** (title/description) → `tasks` tab
- **memory** (key/value/tags) → `memory` tab
- **comms** (subject/body) → `comms` tab
- **skills** (key/name/description) → `skills` tab
- **models** (modelId/providerKey/tier) → `models` tab
- **earning** (name/description/category) → `earnings` tab
- **rule** (name/description/category) → `rules-plugins` tab
- **payment** (payer/note/method) → `payments` tab

Type filter chips appear above results showing per-type counts. Click a chip to filter. Click a result to navigate to its tab.

### 10.14 Health → Fleet / Models / Scheduler / Telemetry

HealthTab has multiple cross-tab navigation points:
- **Per-agent health table row click** → `fleet` tab with `{ agentId }` context.
- **System resources row click** (CPU/MEM/DISK/Uptime) → `telemetry` tab.
- **Provider health row "Manage" link** → `models` tab.
- **Cron scheduler health "Open" link** → `scheduler` tab.
- **Fix button on a check** → POST `/api/health/remediate` with the check's `fixAction` + `fixTarget`.

### 10.15 Analytics → Fleet / Payments

AnalyticsTab:
- **Leaderboard rows** (Top Performers / Most Active / Most Connected) are clickable → `fleet` tab with `{ codename }` context.
- **Revenue Trend panel** is clickable → `payments` tab.

### 10.16 Orion Shell → All Tabs + Actions

OrionShell's `navigate` intent calls `useTabNav()` to switch tabs. Other intents perform real actions:
- `create-task` → creates Task in DB.
- `create-agent` → calls `spawnSubAgent()`.
- `run-skill` → executes skill inline + persists SkillRun.
- `send-comms` → inserts AgentMessage.
- `health-check` → queries DB directly.
- `sync-models` → calls `syncAll()`.
- `query-fleet` / `query-revenue` / `query-tasks` → aggregates DB data + returns graph.
- `set-theme` → client toggles document.documentElement classList.
- `search` → client dispatches `orion:search` window event.

### 10.17 Branding → Header / Sidebar / Footer / Layout

BrandingTab's config drives:
- Header `appName` + `appVersion`.
- Sidebar chat tab label (`chatTabLabel`).
- Footer `appCompany` + `appPoweredBy`.
- `src/app/layout.tsx`'s `generateMetadata()` fetches branding for document title, description, favicon, authors.
- ChatTab's systemPromptPreamble injected into JARVIS_SYSTEM_PROMPT.

### 10.18 Autonomy → Tasks / Memory / Notifications / Activity

When an autonomy loop runs:
1. Agent web-searches topic via z-ai SDK.
2. Reads top result via page_reader.
3. GLM-4.6 proposes 3 actionable tasks as JSON.
4. Tasks persisted (visible in Tasks tab).
5. Episodic memory stored (visible in Memory tab, scope=episodic).
6. "Autonomy Loop Complete" notification created (visible in Notifications bell).
7. Activity Feed entries created for each step.
8. AutonomyRun record persisted (visible in Autonomy History).

### 10.19 Cron → Real Work (Cron Dispatcher)

Each of the 27+ cron keys maps to a real dispatcher function in `src/lib/cron-dispatcher.ts`:
- `spawned-cleanup` → calls `cleanupExpiredSpawnedAgents()`.
- `health-check` → rotates stale agents to idle + creates heartbeats.
- `telemetry-prune` → deletes telemetry older than 7 days.
- `notification-cleanup` → deletes old read notifications.
- `log-rotation` → deletes agent logs older than 30 days.
- `agent-roster-sync` → upserts all 64 agents from AGENT_ROSTER config.
- `skill-proficiency-decay` → decays unused skill proficiency by 1%.
- `revenue-tracking` → aggregates revenue from earning methods.
- `rollback-snapshot-cleanup` → calls `discardSnapshot()` for snapshots >7 days old.
- `dag-checkpoint-cleanup` → removes stale DAG saga checkpoints.
- `proactive-insights` → generates insight notification from fleet data.
- `earning-methods-research` → calls `researchNewEarningMethods()` from earning-research.ts.
- `model-sync` → calls `syncAll()` + `purgeBrokenModels()`.
- `agent-monitors` → calls `runAllMonitors()`.
- All others create appropriate notifications/logs.
- Every dispatcher wrapped in try/catch — never throws, returns `{ok, detail, durationMs, recordsAffected}`.

### 10.20 Memory → Learning (Auto-Move)

The Learning tab's Auto-Move feature scans all MemoryItem rows in 6 sections (skill/plugin/memory/knowledge/intelligence/learning), runs `autoCategorize(content)` on each row's value, and if the suggested section differs from the current scope (confidence ≥ 0.35), moves the row (and its paired `__meta` row) to the new scope. Conflict handling: merges by appending values + unioning tags, then deletes source.

### 10.21 Activity Ticker → All Tabs

The ActivityTicker in the header (scrolling marquee) polls `/api/activity?limit=15` every 10s. Each event is clickable → navigates to the relevant tab via `useNavStore`:
- error → monitoring
- comms → comms
- task → tasks
- agent → fleet
- spawn → fleet
- skill → skills
- notification → activity
- info → activity

---

## 11. Security

### 11.1 Credential Vault (AES-256-GCM)

**Location:** `src/lib/credential-vault.ts`

- Uses `aes-256-gcm` with 12-byte IV (GCM standard nonce) + 32-byte key (256-bit).
- Key read from `CREDENTIAL_ENCRYPTION_KEY` env var (64-char hex string → 32 raw bytes).
- **Dev fallback key** (stable, 32-byte): used when env var is missing or invalid. One-time `console.warn` emitted. NEVER use in production.
- `isUsingProductionKey()` returns true when env key is set.
- `encryptPassword(plain)` → `{encrypted, iv, tag}` (all base64).
- `decryptPassword(encrypted, iv, tag)` → plaintext.
- `maskPassword(plain)` → `X•••••Y` format for display.

### 11.2 What's Encrypted

| Model | Fields Encrypted | What's Exposed in API |
|---|---|---|
| `PlatformCredential` | passwordEnc, passwordIv, passwordTag | All fields EXCEPT password (only `hasPassword` boolean via `?reveal=1` decrypts on demand) |
| `OwnerPaymentMethod` | detailsEnc, detailsIv, detailsTag (JSON: `{vpa}` / `{accountNo, ifsc, name}` / `{cardLast4, token}` / etc.) | `masked` field only (e.g. `ravi@oksb•••`, `•••• 4242`, `HDFC•••1234`) — decrypted details NEVER exposed in any GET response |
| `Provider` | apiKeyEnc, apiKeyIv, apiKeyTag | `hasKey` boolean only — verified empirically that `apiKeyEnc`/`apiKeyIv`/`apiKeyTag` NEVER appear in any GET response |

### 11.3 Input Validation

12 POST routes hardened with non-empty + max-length + format checks:

| Route | Validations |
|---|---|
| `POST /api/tasks` | title non-empty + ≤500 chars, description ≤5000 chars |
| `POST /api/agents` | name non-empty + ≤200 chars, codename non-empty + ≤64 chars + must be uppercase |
| `POST /api/comms` | fromAgent ≤64, toAgent ≤64, subject ≤500, body ≤10000 |
| `POST /api/skills` | key ≤128, name ≤200 |
| `POST /api/memory` | key ≤200, value ≤50000 |
| `POST /api/payments` | method ∈ [upi, card, netbanking, qr, wallet], amount > 0 finite number |
| `POST /api/earning-methods` | name ≤200, optional key ≤128 |
| `POST /api/credentials` | platform ≤100, username ≤200, password non-empty string |
| `POST /api/goals` | title non-empty + ≤500 |
| `POST /api/plugins` | key ≤128, name ≤200 |
| `POST /api/notifications` | title non-empty + ≤500 |
| `POST /api/cron` | key ≤128, name ≤200, schedule ≤100 |
| `POST /api/reports/email` | email non-empty + ≤254 chars (RFC 5321) + basic shape check (`@` present + not at start/end, domain has a dot not at start/end) |

Each failure returns a specific 400 error message.

### 11.4 OS Executor Blocklist

`src/lib/os-executor.ts` enforces:
- 30s default / 120s max timeout.
- 10K char output truncation.
- 1MB code limit.
- Env allow-list (strips secrets — only propagates safe env vars).
- Blocklist: `rm -rf /`, `mkfs`, `dd to raw disk`, fork-bombs, `shutdown`/`reboot`/`halt`.
- `realpathSync`-based path traversal protection for `readFile`/`writeFile`/`listDirectory`.

### 11.5 Guardrails (Regex Filters)

`src/lib/claude-skills/07-guardrails.ts` — pure regex input/output filters (no LLM call). Detects:
- Private keys (AWS, OpenAI, Slack, GitHub PATs).
- `password=`, `api_key=`.
- SSNs, credit cards.
- Catastrophic `rm`, `curl|sh`.

`src/lib/guardrails.ts` — SEC-4-H3 fail-closed pattern tables. In-memory Map for HITL (Human-In-The-The-Loop) approval.

### 11.6 SSRF Guard

`src/lib/web-scraper.ts` and `src/lib/browser-agent.ts` inline an SSRF guard (`assertSafeUrl` function) that blocks requests to private IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x, ::1, fc00::/7).

### 11.7 Path Traversal Protection

- `src/lib/backup-rotate.ts` — strict filename regex on read/delete. `resolveBackupPath()` / `deleteBackup()` helpers sanitize.
- `src/lib/git-checkpoint.ts` — UUID validation guards against shell injection.
- `src/lib/os-executor.ts` — `realpathSync`-based path traversal protection.

### 11.8 Error Boundaries (3-tier)

1. **`src/components/jarvis/ErrorBoundary.tsx`** — React class boundary. Catches render/lifecycle errors. Tracks via `trackAction('error', { severity: 'critical', target: 'react-error-boundary', meta: { message, stack, componentStack, source } })`. Shows fallback UI with Reload / Copy Error / Try Again buttons. Wraps the entire app in `layout.tsx` (OUTSIDE `ActionTrackerProvider`).
2. **`src/app/error.tsx`** — Next.js route-level boundary. Catches errors in route segments. `useEffect` logs to console + tracks via `trackAction('error', { target: 'route-error-boundary', ... })`. Full-page fallback with Try Again / Reload Page / Home buttons.
3. **`src/app/global-error.tsx`** — ROOT boundary. Catches errors thrown while rendering `layout.tsx` itself. Renders its own `<html>+<body>` (layout is NOT used). Inline CSS (no Tailwind dependency — critical because layout.css may not be present). No provider dependency (bypasses action-tracker.ts). Uses raw `fetch()` + `navigator.sendBeacon` for telemetry. Three actions: Try Again (`reset()`), Reload, Home (anchor to `/`).

### 11.9 User Action Tracking (Telemetry)

`src/lib/action-tracker.ts` — fire-and-forget POST to `/api/user-actions`. Uses `navigator.sendBeacon` when available (survives page unload), falls back to `fetch(..., {keepalive: true})`. NEVER throws, NEVER retries. 1.5s dedupe window per `(type, target, tab, label)`.

`src/components/jarvis/ActionTrackerProvider.tsx` wraps the app:
- Installs `window.__track`, `window.__trackNav`, `window.__trackErr` global helpers (idempotent).
- Subscribes to nav store → auto-tracks navigations on tab change (skips initial mount).
- Listens to `window.error` + `unhandledrejection` → auto-tracks errors.

### 11.10 Audit Log

`src/lib/audit-log.ts` — structured audit trail. `logAudit({actor, action, target, meta, req})` writes to AuditLog Prisma model with IP + user-agent. Fire-and-forget (errors swallowed). Used by `/api/admin/backup` POST/DELETE and other admin endpoints.

### 11.11 Blackbox (Agent Audit)

`src/lib/blackbox.ts` — immutable in-memory audit trail of AGENT decisions, token spend, outbound actions, errors, autonomous actions. 1000-entry ring buffer, 200-entry flush threshold, 30s flush interval to AgentLog table. Distinct from UserAction (which is operator-side).

---

## 12. Cron Jobs (27+ jobs)

The `CRON_ROSTER` in `src/lib/config.ts` (lines 204-250) defines 27 jobs. `scripts/seed-cron.ts` adds 3 extra (`agent-monitors`, `model-sync`, and a duplicate-safe version of `agent-roster-sync`) for a total of 30 in the DB. Each job has a real dispatcher in `src/lib/cron-dispatcher.ts`.

### 12.1 Core Operations (4)

| Key | Schedule | Description | Dispatcher Action |
|---|---|---|---|
| `webdev-review` | `*/15 * * * *` | Autonomous QA + feature improvement loop (agent-browser driven). | Handled by external cron tool; dispatcher records heartbeat. |
| `health-check` | `*/5 * * * *` | Heartbeat all agents and rotate stale status to offline. | `db.agent.updateMany` (status→idle for stale) + `db.agentHeartbeat.createMany` (10 heartbeats). |
| `telemetry-prune` | `0 2 * * *` | Trim telemetry older than 7 days. | `db.telemetry.deleteMany` (createdAt < cutoff). |
| `backup` | `0 3 * * *` | Snapshot the database and artifacts to /backups/. | Records a backup Notification (actual DB dump out of scope for SQLite in-proc). |

### 12.2 Memory & Intelligence (4)

| Key | Schedule | Description | Dispatcher Action |
|---|---|---|---|
| `memory-consolidation` | `0 */3 * * *` | Compress and deduplicate episodic memory every 3h. | Deduplicates episodic MemoryItems by key prefix (first 30 chars). |
| `memory-graph-rebuild` | `0 */6 * * *` | Rebuild the semantic memory graph from MemoryItem rows. | Placeholder — counts memory items. |
| `blackbox-flush` | `*/10 * * * *` | Flush in-memory blackbox audit buffer to AgentLog table. | Triggers in-memory buffer flush. |
| `dag-checkpoint-cleanup` | `0 4 * * *` | Remove completed DAG saga checkpoints older than 24h. | `db.memoryItem.deleteMany` (scope='dag-checkpoint', createdAt < 24h). |

### 12.3 Agent Lifecycle (3)

| Key | Schedule | Description | Dispatcher Action |
|---|---|---|---|
| `spawned-cleanup` | `0 3 * * *` | Auto-delete spawned agents inactive for 30 days (logs preserved for respawn). | Calls `cleanupExpiredSpawnedAgents()` from agent-spawner.ts. |
| `agent-load-balance` | `*/10 * * * *` | Check agent loads; auto-spawn sub-agent if load > 80%. (Disabled by default.) | `db.agent.findMany` (load > 80, status='working') — counts only. |
| `agent-roster-sync` | `0 5 * * *` | Sync DB agents with AGENT_ROSTER config (upsert new, update stale). | Upserts all 64 agents from AGENT_ROSTER. |

### 12.4 Learning & Skills (2)

| Key | Schedule | Description | Dispatcher Action |
|---|---|---|---|
| `skill-proficiency-decay` | `0 0 * * *` | Decay unused skill proficiency by 1% per day (lastUsed > 7 days). | `db.skillLearning.findMany` (lastUsed < 7d) → `db.skillLearning.update` (proficiency - 1). |
| `learning-review` | `0 8 * * *` | Review learning records and surface mastered skills for promotion. (Disabled by default.) | `db.skillLearning.findMany` (proficiency >= 90). |

### 12.5 Earning & Revenue (3)

| Key | Schedule | Description | Dispatcher Action |
|---|---|---|---|
| `earning-methods-research` | `0 9 * * *` | Research and discover new earning methods daily. | Calls `researchNewEarningMethods()` from earning-research.ts. Creates summary Notification. |
| `revenue-tracking` | `0 */4 * * *` | Aggregate revenue from earning methods + update totals. | `db.earningMethod.findMany` (enabled) → sums totalEarnings. |
| `credential-health-check` | `0 6 * * *` | Check platform credentials for expiring/suspended status. (Disabled by default.) | `db.platformCredential.findMany` (status='active') — counts only. |

### 12.6 Research & Outreach (3)

| Key | Schedule | Description | Dispatcher Action |
|---|---|---|---|
| `daily-research` | `0 7 * * *` | Run the daily research engine on trending topics. | Creates info Notification. |
| `outreach-followup` | `0 10 * * 1-5` | Send follow-up emails for pending outreach (weekdays only). (Disabled by default.) | `db.memoryItem.count` (scope='outreach', tags contains 'pending'). |
| `social-media-post` | `0 9,13,17 * * *` | Auto-post to social media 3x/day via marketing agents. (Disabled by default.) | Creates info Notification. |

### 12.7 System Health (5)

| Key | Schedule | Description | Dispatcher Action |
|---|---|---|---|
| `self-improve` | `0 */6 * * *` | Analyze logs and propose optimization patches. (Disabled by default.) | `db.agentLog.count` (level='error', last 6h). |
| `rollback-snapshot-cleanup` | `0 4 * * 0` | Remove rollback snapshots older than 7 days (weekly). | `listSnapshots()` + `discardSnapshot()` for snapshots > 7 days old. |
| `upload-cleanup` | `0 4 * * *` | Remove orphaned uploaded files not referenced by Artifact rows. (Disabled by default.) | `db.artifact.findMany` (type='file') — counts only. |
| `notification-cleanup` | `0 */12 * * *` | Mark old read notifications as archived (older than 7 days). | `db.notification.deleteMany` (read=true, createdAt < 7d). |
| `log-rotation` | `0 5 * * *` | Archive AgentLog entries older than 30 days to /backups/logs/. | `db.agentLog.deleteMany` (createdAt < 30d). |

### 12.8 Analytics & Reporting (3)

| Key | Schedule | Description | Dispatcher Action |
|---|---|---|---|
| `daily-report` | `0 8 * * *` | Generate the daily fleet report and store to memory. | Creates success Notification. |
| `weekly-summary` | `0 9 * * 1` | Generate weekly summary report every Monday 9 AM. | Creates success Notification. |
| `proactive-insights` | `0 */4 * * *` | Generate proactive LLM-driven insights from fleet data. | `db.agent.count` + `db.task.count` → creates info Notification. |

### 12.9 Extra Jobs (from EXTRA_CRON_ROSTER in seed-cron.ts)

| Key | Schedule | Description | Dispatcher Action |
|---|---|---|---|
| `model-sync` | `0 */6 * * *` | Sync models from providers + detect local + purge broken. | Calls `syncAll()` + `purgeBrokenModels()` from model-sync.ts. Creates warn/success Notification. |
| `agent-monitors` | `*/10 * * * *` | Run all 8 monitor agents. | Calls `runAllMonitors()` from agent-monitors.ts. Creates warn Notification if new findings. |

### 12.10 External Cron (webDevReview)

A separate external cron job (kind=webDevReview, fixed_rate=900s = 15 min, timezone=Asia/Calcutta, priority=10) runs the autonomous QA + feature improvement loop via agent-browser. This is the cron that drives continuous improvement of the app.

---

## 13. Pending / Future Work

Carried forward from worklog.md (TAB-CONSOLIDATION + PENDING-COMPLETE entry and earlier):

### 13.1 Still Missing (from user's conversation)

1. **89 Prisma models** — have 34, need 55 more (RBAC, tenant, compliance, eval, AgentInstance, AgentMetric, Client, Service, Revenue, Outreach, ResearchLog, VoiceWorkflow, VoiceCall, ImprovementProposal, SelfImprovementLog, WorkforcePerformance, AgentEvolution, etc. from the original jarvis zip — but zip is now removed, would need to re-download or use the aria-app-complete.zip backup).
2. **240+ API routes** — have 111, need 130+ more (mostly mini-service routes).
3. **78+ skills** — have 20 in DB, but skills/ dir has 65 ClawHub skills available.
4. **Video understanding** — wire video-understand skill for actual transcription.
5. **Wire rollback-system into destructive ops** — auto-snapshot before code/config changes.
6. **Spawn-on-high-load automation** — auto-spawn when Agent.load > 80%.
7. **Credential vault auto-fill** — agents auto-use linked credentials.
8. **Earning methods wire to tasks** — auto-create tasks when method enabled.
9. **Wire model knowledge to smart-router** — rate-limit fallback to local models.
10. **Branding Live Preview Frame** — mock chat with new preamble.

### 13.2 Future Enhancement Ideas

- **Custom sound upload** — currently fixed beep (Web Audio API).
- **Notification grouping improvements** — batch multiple into one desktop notification (partially done with 2s debounce).
- **Rate-limiting middleware** on auth-prone API routes.
- **More agent comparison dimensions** — charts, radar, timeline (radar + timeline DONE; could add more).
- **Tab pinning from command palette** (DONE).
- **Tab hiding from command palette** (DONE).
- **Memory graph force-directed visualization improvements** (DONE — Top Connected panel).
- **PDF export for reports** (DONE).
- **Scheduled email reports** (DONE — stub, no SMTP).
- **Drag-and-drop task reordering within Kanban columns** (DONE).
- **Agent comparison export** (DONE — JSON + CSV).
- **Notification click-to-navigate from desktop notifications** (DONE).
- **App hardening — ErrorBoundary + error.tsx + global-error.tsx + input validation** (DONE — 12 routes hardened).
- **WebSocket mini-service for true real-time updates** (DONE — port 3003).
- **Audit Log + Backup Rotate + Cron History** (DONE — imported from jarvis zip).
- **Tab consolidation** (DONE — 41 → 25 tabs via MergedTab wrappers).

### 13.3 Carry-Forward Pending (from earlier worklog entries)

- Port remaining ~75 lower-priority zip lib files (affiliate-tracking, api-client, auth, compliance, cron-jobs, design-system, etc.).
- Implement claude-mem 3-layer progressive-disclosure search in Memory tab.
- Implement claude-superpowers `using-superpowers` bootstrap preamble.
- Implement claude-superpowers 3-gate workflow (brainstorm → write-plan → execute-plan) in Orchestrator tab.
- Implement skill-behavior evals (drill harness + LLM verifier) for SkillLearning tab.
- Expand agent roster to seed full 64-agent roster (DONE — 64 + 2 spawned = 66 in DB).
- All-models-via-env-keys verification (15 providers — DONE: 23 providers seeded).
- Spawned-cleanup cron schedule verification (daily 3 AM — DONE).
- Spawn-on-High-Load automation (auto-spawn when Agent.load > 80% — partially done; cron job exists but disabled).
- Branding Live Preview Frame (mock chat with new preamble).
- OCR/transcription for video+image uploads.
- Logo auto-generation via Image-Generation skill.
- Credential vault auto-fill (agents auto-use linked credentials).
- Earning methods wire to tasks (auto-create tasks when method enabled).
- Wire model knowledge to smart-router (rate-limit fallback to local models).

---

## 14. Appendix: File Map

### 14.1 Project Root

```
/home/z/my-project/
├── package.json                    # 23 deps + 8 devDeps (Next 16, React 19, Prisma 6, z-ai-sdk, Zustand, Framer, Recharts, @dnd-kit, socket.io-client, cheerio)
├── prisma/schema.prisma            # 647 lines, 34 models
├── db/custom.db                    # SQLite database
├── next.config.ts                  # Next.js config
├── tsconfig.json                   # TypeScript config
├── tailwind.config.ts              # Tailwind config
├── postcss.config.mjs
├── eslint.config.mjs
├── components.json                 # shadcn/ui config
├── Caddyfile                       # Caddy reverse-proxy config (port 3003 → /?XTransformPort=3003)
├── RULES.md                        # 10-section rules documentation
├── worklog.md                      # 3780-line project worklog
├── APP_DOCUMENTATION.md            # THIS FILE
├── bun.lock
├── mini-services/
│   └── realtime-service/           # Socket.io mini-service (port 3003)
│       ├── package.json
│       ├── index.ts                # 405 lines
│       ├── prisma/schema.prisma    # Copy of parent schema
│       ├── start.sh                # Convenience launcher
│       └── bun.lock
├── scripts/
│   ├── seed.ts                     # Original 8-agent + 20-skill + 6-cron seed
│   ├── seed-agents.ts              # 64 agents + 16 departments + 64 workforce + 15 skillLearning
│   ├── seed-add.ts                 # 10 comms + ~17 payments
│   ├── seed-cron.ts                # 27 cron jobs + EXTRA_CRON_ROSTER (agent-monitors, model-sync)
│   ├── seed-earning-methods.ts     # 15 earning methods
│   ├── seed-providers-models.ts    # 23 providers + 446 catalog models
│   ├── seed-rules.ts               # 33 operator rules
│   └── seed-learning.ts            # 15 learning records
├── src/
│   ├── app/
│   │   ├── page.tsx                # Server component — lazy-loads page-client.tsx (ssr:false)
│   │   ├── page-client.tsx         # 2029 lines — main client SPA shell
│   │   ├── layout.tsx              # Root layout — wraps in ErrorBoundary + ActionTrackerProvider, generateMetadata() fetches branding
│   │   ├── error.tsx               # Route-level error boundary
│   │   ├── global-error.tsx        # Root error boundary (inline CSS, no Tailwind dep)
│   │   ├── not-found.tsx           # Custom 404
│   │   ├── globals.css             # JARVIS cyberpunk dark theme + light theme variant + 30+ utility classes
│   │   └── api/                    # 111 route.ts files (see API Reference §3)
│   ├── components/
│   │   ├── jarvis/
│   │   │   ├── MergedTab.tsx       # Generic wrapper with sub-view toggle
│   │   │   ├── OrionShell.tsx      # 1567 lines — voice + intent routing overlay
│   │   │   ├── ForceGraph.tsx      # Reusable SVG force-directed graph (Verlet physics)
│   │   │   ├── shared.tsx          # StatCard, RadialGauge, SectionTitle, StatusDot, PriorityBadge, LevelBadge, Pill, EmptyState, TimeAgo, Sparkline
│   │   │   ├── FileUpload.tsx      # Reusable drag-drop + click-to-browse upload component
│   │   │   ├── ActionTrackerProvider.tsx  # Wraps app — auto-tracks navigations + errors
│   │   │   └── ErrorBoundary.tsx   # React class error boundary
│   │   ├── tabs/                   # 41 tab components (25 active tabs, 16 merged into wrappers)
│   │   │   ├── OverviewTab.tsx
│   │   │   ├── ChatTab.tsx
│   │   │   ├── ActivityTab.tsx
│   │   │   ├── InsightsTab.tsx
│   │   │   ├── FleetTab.tsx        # 1612 lines — roster + detail modal + compare + templates
│   │   │   ├── FleetTopologyTab.tsx
│   │   │   ├── SpawnedAgentsTab.tsx
│   │   │   ├── WorkforceTab.tsx
│   │   │   ├── CommsTab.tsx
│   │   │   ├── TasksTab.tsx        # List + bulk operations
│   │   │   ├── KanbanTab.tsx       # @dnd-kit sortable + cross-column moves
│   │   │   ├── TaskDagTab.tsx      # ForceGraph DAG with cycle detection
│   │   │   ├── GoalsTab.tsx
│   │   │   ├── SkillsTab.tsx       # Reasoning Skills row + Catalog + FileUpload
│   │   │   ├── SkillRunnerTab.tsx  # 6 skills + type-aware result rendering
│   │   │   ├── SkillChainTab.tsx   # Pipeline builder + Saved Templates + Community
│   │   │   ├── AutonomyTab.tsx     # 1044 lines — autonomy loop + parallel orchestrator + history + compare + templates
│   │   │   ├── ModelsTab.tsx       # 1127 lines — sync + health-check + purge + API key dialog
│   │   │   ├── ProvidersTab.tsx
│   │   │   ├── MemoryTab.tsx       # Store + FileUpload
│   │   │   ├── MemoryGraphTab.tsx  # ForceGraph + filters + search + Top Connected
│   │   │   ├── LearningTab.tsx     # TeachSourceCard + Auto-Categorize + Auto-Move
│   │   │   ├── TeachSourceCard.tsx # 6 modes: Text/URL/Video/Document/Audio/Zip
│   │   │   ├── RulesTab.tsx
│   │   │   ├── PluginsTab.tsx
│   │   │   ├── ArtifactsTab.tsx
│   │   │   ├── HealthTab.tsx       # 861 lines — full fleet health command center
│   │   │   ├── TelemetryTab.tsx
│   │   │   ├── AgentMonitorTab.tsx # 864 lines — 8 monitors + findings + user activity stats
│   │   │   ├── LogsTab.tsx
│   │   │   ├── BlackboxTab.tsx
│   │   │   ├── AuditLogTab.tsx
│   │   │   ├── SchedulerTab.tsx    # Cron jobs + Execution History + Scheduled Report
│   │   │   ├── PaymentsTab.tsx     # Transactions + Revenue Trend (3 modes)
│   │   │   ├── PaymentMethodsTab.tsx # 865 lines — owner payout methods (AES-256-GCM)
│   │   │   ├── EarningMethodsTab.tsx # 926 lines — catalog + Research New + credential vault
│   │   │   ├── AnalyticsTab.tsx    # Charts + leaderboards + Revenue Trend + CSV export
│   │   │   ├── ReportsTab.tsx      # Daily + PDF + Email + Diffing + Diff History
│   │   │   ├── ServicesHubTab.tsx
│   │   │   ├── DataManagementTab.tsx # 1056 lines — seed/clear demo data + backups
│   │   │   ├── BrandingTab.tsx
│   │   │   └── AppTreeTab.tsx
│   │   └── ui/                     # 39 shadcn/ui primitives (Radix-based)
│   ├── lib/                        # 99 lib modules (see Lib Modules §5)
│   │   ├── config.ts
│   │   ├── db.ts
│   │   ├── llm.ts
│   │   ├── nav-store.ts
│   │   ├── agent-monitors.ts
│   │   ├── cron-dispatcher.ts
│   │   ├── credential-vault.ts
│   │   ├── branding.ts
│   │   ├── orion-intent.ts
│   │   ├── action-tracker.ts
│   │   ├── agent-spawner.ts
│   │   ├── model-sync.ts
│   │   ├── earning-research.ts
│   │   ├── parallel-orchestrator.ts
│   │   ├── dag-planner.ts
│   │   ├── task-decomposer.ts
│   │   ├── state-bus.ts
│   │   ├── os-executor.ts
│   │   ├── guardrails.ts
│   │   ├── circuit-breaker.ts
│   │   ├── audit-log.ts
│   │   ├── blackbox.ts
│   │   ├── backup-rotate.ts
│   │   ├── rollback-system.ts
│   │   ├── cron-history.ts
│   │   ├── categorize.ts
│   │   ├── teach-source.ts
│   │   ├── company-config.ts
│   │   ├── catalog.ts
│   │   ├── claude-skills/         # 12 files (10 reasoning patterns + pipeline + index)
│   │   ├── hooks/use-api.ts
│   │   ├── use-realtime.ts
│   │   └── ... (67 more lib files)
│   └── hooks/
│       ├── use-mobile.ts
│       └── use-toast.ts
├── public/
│   ├── logo.svg
│   └── robots.txt
├── examples/
│   └── websocket/
│       ├── frontend.tsx
│       └── server.ts
├── agent-ctx/                      # Subagent work records
│   ├── 7-parallel-c-demo-data.md
│   ├── 9-parallel-f-orion-shell.md
│   ├── 10-parallel-e-user-action-tracking.md
│   └── 12-parallel-d-model-sync.md
├── tool-results/                   # Cached tool outputs (read tool truncation workaround)
├── upload/                         # Original upload zips (jarvis-mission-control-final.zip was removed)
└── download/
    └── README.md
```

### 14.2 Key Stats

| Metric | Count |
|---|---|
| Tabs (sidebar entries) | 25 (down from 41) |
| Merged tabs (with sub-view toggles) | 11 |
| Total tab components in `src/components/tabs/` | 41 |
| API routes (`route.ts` files) | 111 |
| Prisma models | 34 |
| Lib modules in `src/lib/` | 99 |
| Agents in DB | 66 (64 roster + 2 spawned) |
| Departments | 16 |
| Skills in catalog | 20 |
| Cron jobs in DB | 30 (27 from CRON_ROSTER + 3 extra) |
| Providers seeded | 23 |
| Models in catalog | 446 (across 23 providers) |
| Rules seeded | 33 |
| Services in catalog | 20 |
| Earning methods | 28 (15 seeded + 13 LLM-discovered) |
| Reasoning skills (claude-skills) | 10 + pipeline |
| Agent monitors | 8 |
| Orion intents | 14 |
| WebSocket channels | 4 (fleet/metrics/notifications/activity) + snapshot |
| Keyboard shortcuts | 18+ (global + navigation + in-overlay) |
| Global search entity types | 9 |
| Error boundaries | 3-tier (ErrorBoundary + error.tsx + global-error.tsx) |
| API routes with input validation | 12 |
| AES-256-GCM encrypted credential stores | 3 (PlatformCredential, OwnerPaymentMethod, Provider.apiKey) |

---

**End of documentation.**

*Generated by Task ID DOC (documentation agent). For the full project history, see `/home/z/my-project/worklog.md` (3780 lines). For all permanent rules, see `/home/z/my-project/RULES.md`.*

---

## 15. Autonomous AI Tool Comparison & Gap Analysis

> **Authored by:** Task ID `RESEARCH` · Agent `research` · Purpose: benchmark JARVIS Mission Control against the open market of autonomous AI tools and surface a concrete improvement plan with priorities.

---

### 15.1 Background & Method

JARVIS Mission Control (runtime-branded **ARIA**) positions itself as an "autonomous-agent orchestration dashboard". The product's pitch is that a human operator speaks or types a directive, and a fleet of 64+ agents plus 27+ cron dispatchers carry it out — without further human intervention. To stress-test that pitch we surveyed the broader autonomous-AI tooling landscape (10 products spanning coding agents, browser agents, voice assistants, and workflow automation) and compared each capability dimension against what JARVIS currently ships.

**Method.** For every tool we recorded five attributes: (1) **capabilities** — what it can actually do end-to-end; (2) **input modality** — chat / voice / terminal / API / file upload / IDE event; (3) **action surface** — what it can touch on the host system (files, shell, browser DOM, HTTP endpoints, third-party SaaS); (4) **planning & decomposition** — how it breaks a vague goal into executable steps and verifies them; (5) **autonomy mechanism** — the loop or scaffolding that lets it operate without a human pressing Enter on each step. We then mapped each tool's strengths to JARVIS's existing surface area (smart-router intents, agent monitors, cron dispatchers, Orion shell) and produced the gap analysis in §15.5–§15.6 and the improvement plan in §15.7.

**Scope note.** This section is **research + writing only** — no code was modified. The improvement plan is a specification for future engineering tickets, not a working implementation.

---

### 15.2 Researched Autonomous AI Tools

#### 15.2.1 Claude Code (Anthropic)

- **What it can do.** A terminal-native agentic coding assistant. It reads the repo (`ls`, `rg`, `cat`-equivalents), edits files via an in-process patch tool, runs shell commands, executes tests, and answers questions grounded in the actual codebase. Supports multi-file refactors, git operations, MCP (Model Context Protocol) servers for external data, and sub-agent delegation.
- **Input modality.** Interactive REPL in the terminal (`claude` command), one-shot CLI flags (`claude -p "fix the failing test"`), headless mode for CI, and the Anthropic API for programmatic use. Slash commands (`/init`, `/review`, `/test`, `/commit`) act as shortcuts.
- **Action surface.** Local filesystem (read/write/edit with diff preview), shell command execution (with an allow-list and per-command approval prompt), git operations, network via MCP servers (Postgres, GitHub, Slack, Jira, Sentry, etc.), and HTTP via `fetch` through MCP.
- **Planning & decomposition.** Uses an explicit **TodoWrite** tool to break a vague goal ("ship the pricing page") into checkable sub-tasks before executing. Each sub-task is marked in_progress → completed. The plan is visible to the user and editable mid-flight. If a sub-task fails, the agent can re-plan rather than abort.
- **Autonomy mechanism.** Agentic loop: prompt → tool-call → observation → next tool-call, with a permission system (allow-listed commands run unattended, sensitive commands require Enter). Can run in `--dangerously-skip-permissions` mode for fully unattended CI execution.

#### 15.2.2 OpenHands / OpenClaw (AllHands AI, open-source)

- **What it can do.** The flagship open-source "AI software engineer" — opens a sandboxed container, clones a repo, runs code, browses the web, opens PRs, resolves GitHub issues end-to-end (the OpenHands SWE-bench leaderboard entries are famously strong). Can also act as a general-purpose browser agent.
- **Input modality.** Web UI chat (default), headless Python SDK (`from openhands import OpenHandsClient`), and REST API for embedding into other products. The "OpenClaw" rebrand is a community fork focused on the autonomous-deployment story.
- **Action surface.** Sandboxed Docker container with full root (file ops, arbitrary shell, network egress), a built-in web browser (Playwright-style), and a configurable set of "Bash + Browse + Edit + Read" tools. Can call external APIs via `curl` inside the container.
- **Planning & decomposition.** **Manager-Worker pattern** — a planning agent drafts a high-level plan (numbered steps), then delegates each step to a worker agent. Each step has explicit acceptance criteria. If a worker reports failure, the manager re-plans.
- **Autonomy mechanism.** Fully autonomous "Resolve Issue" mode: give it a GitHub URL and a `--auto` flag, it forks the repo, opens a branch, fixes the issue, runs tests, opens a PR, and posts the PR link back. Per-step budgets (max iterations, max tokens, max wall-clock) gate the loop.

#### 15.2.3 Devin (Cognition Labs)

- **What it can do.** The original commercial "AI software engineer" — given a natural-language task ("build me a Chrome extension that…"), it plans, writes the code, runs it in its own sandboxed VM, debugs failures, and ships. Includes a built-in editor + shell + browser, all visible to the operator as a streaming timeline.
- **Input modality.** Web app chat (with Slack integration for asynchronous task assignment). No voice, no terminal REPL — purely chat-driven.
- **Action surface.** A dedicated VM with full shell, code editor, and a Chromium browser the agent drives itself. Can read/write files, run any command, browse the web, and call arbitrary APIs. Integrates with GitHub, Linear, Slack for task intake.
- **Planning & decomposition.** Visible **"Plan" panel** that decomposes the task into a checklist and updates it in real time as steps complete or fail. The plan is editable — the operator can re-prioritize or remove steps mid-task, and Devin will adjust.
- **Autonomy mechanism.** Long-horizon autonomous mode — Devin can run for hours on a single task. Periodic checkpoints let the operator pause, review, and resume. Includes self-debugging (re-reads its own error logs and patches).

#### 15.2.4 Cursor & VS Code Copilot (AI-powered IDEs)

- **What it can do.** AI-assisted development inside the editor. Cursor: inline completion, Cmd+K inline edit, Chat side panel, @-mentions for files/symbols/docs, codebase-wide semantic search, multi-file edits, agent mode (Cursor will run terminal commands and apply edits across files). Copilot: inline ghost-text completion, Chat panel, Copilot Edits (multi-file), Copilot Workspace (cloud-side planning).
- **Input modality.** IDE keybindings (Tab to accept ghost text, Cmd+K for inline edit, Cmd+L for chat) + chat panel. Cursor agent mode accepts natural-language instructions and tool-use approvals.
- **Action surface.** Editor buffer (insert/replace across multiple files), integrated terminal (Cursor agent mode, with per-command approval), linters/test-runners via terminal, MCP servers (Cursor 0.45+ supports MCP for external data access).
- **Planning & decomposition.** Cursor's agent mode produces a tool-call plan visible in the chat panel ("I'll edit `a.ts`, run `npm test`, then edit `b.ts`"). Copilot Workspace generates an explicit plan + diff before any file is touched. Neither has a true checkpoint/resume loop yet — they're turn-based.
- **Autonomy mechanism.** Limited. Both are "agentic in small" — a single user turn triggers a multi-tool sequence, but the loop is bounded by the turn. No background long-horizon execution (yet).

#### 15.2.5 AutoGPT & BabyAGI (open-source autonomous agents)

- **What it can do.** AutoGPT: given a high-level goal ("research the top 5 competitors in the AI coding space and produce a comparison report"), autonomously plans, searches the web, writes intermediate files, and iterates until it judges the goal complete. BabyAGI: a minimal 3-task loop — create task → prioritize → execute → repeat, with the LLM generating each new task based on the result of the previous one.
- **Input modality.** CLI prompt ("What do you want AutoGPT to do?"). Config file for long-running projects. Optional web UI for some forks (AutoGPT Forge / Platform).
- **Action surface.** Web search + scrape, file read/write in a workspace directory, command execution (configurable), HTTP via `requests`. AutoGPT Platform adds "blocks" for Notion / Slack / GitHub / email.
- **Planning & decomposition.** AutoGPT uses an explicit **Thought → Reasoning → Plan → Criticism → Action** scaffold per turn — every step is verbalized in the output. BabyAGI uses a simpler task-list queue: the LLM appends new tasks derived from the last result.
- **Autonomy mechanism.** The original "truly autonomous" demos — the loop runs until the LLM itself decides to terminate, or a step-count / token budget is hit. In practice the loop often drifts, but the scaffold is the template every other agent borrows.

#### 15.2.6 Adept ACT-1

- **What it can do.** A model trained to operate any software UI via the browser — given a goal ("add this contact to my Salesforce"), it navigates the actual Salesforce web UI by clicking, typing, and reading the page like a human would. ACT-1 (Action Transformer) is the model; Adept's productized version is now "Orchestra".
- **Input modality.** Natural-language instruction via the Adept Chrome extension or Adept's own browser surface. No code, no API.
- **Action surface.** The live DOM of any website — clicks, keypresses, scrolls, form submissions, navigation. Reads screenshots and DOM state. Cannot execute shell commands or touch the local filesystem.
- **Planning & decomposition.** Implicit — the model emits one action at a time and re-plans based on the page state after each action. No visible plan panel.
- **Autonomy mechanism.** Per-task autonomy: a single instruction runs to completion (or to a confidence-floor). Long-horizon multi-task autonomy is limited.

#### 15.2.7 MultiOn

- **What it can do.** A browser-automation agent similar to Adept but with a stronger API story — ships a "MultiOn Agent Q" consumer product (a browser sidebar that logs into sites and books flights / fills forms for you) and a developer API (`client.retrieve`, `client.scroll`, `client.click`) for embedding browser automation into other apps.
- **Input modality.** Chat in the consumer product; Python/JS SDK + REST API for developers.
- **Action surface.** Any public website — DOM clicks, typing, scroll, screenshot capture, file download. Sessions are persistent (logged-in state survives across runs via a session-cookie store).
- **Planning & decomposition.** The developer API exposes the primitives; the consumer product wraps them with implicit planning. Recent "Q" model adds visible reasoning before each action.
- **Autonomy mechanism.** Each `client.task(goal)` call is autonomous until the goal is met or a step-count limit is hit. Sessions can be resumed.

#### 15.2.8 Zapier AI (Central + Agents)

- **What it can do.** The legacy Zapier (no-code trigger→action workflows) plus a new AI layer: **Zapier Central** (chat-with-your-data-tools), **AI Actions** (LLM tool-calling into 7,000+ app integrations), and **Zapier Agents** (autonomous agents that can be assigned goals and loop across tools).
- **Input modality.** Web UI chat (Central / Agents), natural-language Zap builder ("when I get an email from X, post to Slack"), REST API.
- **Action surface.** 7,000+ SaaS integrations (Gmail, Slack, Notion, HubSpot, Sheets, etc.) — read/write records, send messages, create calendar events, etc. Plus the central "AI Actions" tool-call interface that an LLM can invoke.
- **Planning & decomposition.** Zapier Agents are explicitly goal-driven — given a goal they generate a multi-step plan and execute it across integrations. The Zap builder uses LLM decomposition to translate a sentence into a multi-step Zap.
- **Autonomy mechanism.** Scheduled triggers (cron), webhook triggers, and agent loops. Each Zap step is atomic with retry/rollback semantics.

#### 15.2.9 Paperclip (AI task automation, indie)

- **What it can do.** A lightweight "AI task runner" — define a task in YAML/markdown with steps ("fetch URL → extract headings → summarize → post to Slack"), and Paperclip executes the chain with an LLM in between for any non-deterministic step. Positioned as a simpler alternative to Zapier for AI-flavored automations.
- **Input modality.** CLI (`paperclip run task.yaml`), file-based task definitions, optional web UI in some forks. No voice, no chat REPL.
- **Action surface.** HTTP fetch, file read/write in the working directory, subprocess execution (allow-listed), and a small set of built-in tools (summarize, extract-json, render-template).
- **Planning & decomposition.** The task definition **is** the plan — Paperclip is deterministic about step ordering, the LLM only fills in step parameters. No dynamic re-planning.
- **Autonomy mechanism.** Cron-scheduled or webhook-triggered. Each run is bounded by the YAML's step list. Closer to a "prompt chain runner" than a true agent.

#### 15.2.10 JARVIS / Jarvis variants (consumer voice assistants)

- **What it can do.** "JARVIS" is a popular name for community projects (and Marvel fan projects) — typically a Python-based voice assistant that listens for a wake word, transcribes speech, dispatches the text to an LLM, and optionally speaks the response back. Some variants add home-automation hooks (Philips Hue, smart plugs), calendar integration, or a chat fallback. None are autonomous agents in the AutoGPT sense — they're voice front-ends to a chat model + a handful of scripted skills.
- **Input modality.** Voice (wake word + command), optional text chat.
- **Action surface.** Whatever the developer wired up — typically: TTS, web search, weather API, music playback, smart-home commands, and a few "skills" (timer, reminder, note). No filesystem, no shell, no browser.
- **Planning & decomposition.** None — single-shot command → response. No multi-step planning.
- **Autonomy mechanism.** None — fully reactive. The assistant waits for a wake word and answers one question at a time.

> **Note on naming.** "JARVIS" is also the codename of the present application (JARVIS Mission Control, runtime "ARIA"). Throughout §15.3–§15.10, "JARVIS" refers to **this app** unless explicitly stated otherwise; references to external Jarvis-style voice assistants are labeled "Jarvis variants".

---

### 15.3 Capability Comparison Matrix

The table below scores each tool on 11 capability dimensions relevant to JARVIS's positioning. Legend: ✅ = first-class · ⚠️ = partial / requires setup · ❌ = absent.

| Capability | Claude Code | OpenHands | Devin | Cursor / Copilot | AutoGPT / BabyAGI | Adept ACT-1 | MultiOn | Zapier AI | Paperclip | Jarvis variants | **JARVIS (this app)** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Natural-language chat input | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ (YAML) | ✅ | ✅ (ChatTab + Orion) |
| Voice input | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ (Orion shell, wake word, TTS) |
| Filesystem read/write | ✅ | ✅ | ✅ | ✅ | ⚠️ (workspace dir) | ❌ | ❌ | ⚠️ (via SaaS) | ✅ (working dir) | ❌ | ❌ |
| Shell / terminal execution | ✅ | ✅ | ✅ | ⚠️ (Cursor agent) | ⚠️ (config) | ❌ | ❌ | ❌ | ⚠️ (allow-listed) | ❌ | ❌ |
| Browser automation (click/type/nav) | ⚠️ (via MCP) | ✅ | ✅ | ⚠️ (via MCP) | ✅ (scrape) | ✅ | ✅ | ❌ | ⚠️ (fetch only) | ❌ | ❌ |
| External API calls | ✅ (MCP) | ✅ (curl) | ✅ (curl) | ⚠️ (MCP) | ✅ | ❌ | ✅ (SDK) | ✅ (7000+ SaaS) | ✅ | ⚠️ | ✅ (111 internal routes, no external) |
| Multi-step task decomposition | ✅ (TodoWrite) | ✅ (Manager/Worker) | ✅ (Plan panel) | ⚠️ (per-turn) | ✅ (Thought/Plan/Criticism) | ❌ | ❌ | ✅ (Zap builder) | ⚠️ (static YAML) | ❌ | ❌ (single-intent router) |
| Plan visibility / editability | ✅ | ✅ | ✅ | ⚠️ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Verification / self-check after action | ✅ (test runner) | ✅ (test runner) | ✅ (self-debug) | ⚠️ | ⚠️ (criticism step) | ❌ | ❌ | ✅ (retry/rollback) | ❌ | ❌ | ❌ |
| Long-horizon autonomous execution | ⚠️ (CI mode) | ✅ (--auto) | ✅ (hours) | ❌ | ✅ (until budget) | ⚠️ (per-task) | ⚠️ (per-task) | ✅ (scheduled) | ⚠️ (scheduled) | ❌ | ⚠️ (cron fires, no agent loop) |
| External messaging integration (Slack/TG/email) | ⚠️ (MCP) | ⚠️ (MCP) | ✅ (Slack intake) | ❌ | ⚠️ (Platform) | ❌ | ❌ | ✅ (7000+ apps) | ⚠️ (webhook) | ⚠️ | ❌ (comms internal-only) |

**Reading the matrix.** JARVIS wins on **voice** (only Orion-class shell with wake-word + TTS + 14-intent smart router), ties on **natural-language chat** and **internal API surface**, and **loses on every execution dimension** — no filesystem, no shell, no browser, no external SaaS messaging, no plan visibility, no verification gate. The gap is structural: JARVIS is currently an **operations dashboard with an intelligent command parser**, not an **autonomous agent**.

---

### 15.4 JARVIS Capability Audit (What JARVIS CAN Do Today)

This section restates JARVIS's current capabilities (cross-referenced to §2–§14 of this document) so the gap analysis in §15.5–§15.6 is grounded in what already exists.

#### 15.4.1 Input surfaces
- **Chat tab** (`/api/orion/command` smart router) — text in, structured response with intent badge + action label out. 14 intents: navigate, create-task, create-agent, run-skill, send-comms, health-check, sync-models, query-fleet, query-revenue, query-tasks, set-theme, search, help, chat-fallback.
- **Orion shell overlay** (`Cmd+Shift+O`) — voice-first (wake word "orion"/"aria", continuous listening, TTS, 6-state orb), text fallback, command palette typeahead, history + log persistence, multi-turn context chip, mini bar graphs for fleet/health/revenue/tasks.
- **Command palette** (`Cmd+K`) — fuzzy navigation to any of 25 tabs + 50+ actions.
- **Global search** (`Cmd+Shift+F`) — 9 entity types (agent, task, memory, comms, skill, model, earning, rule, payment).
- **Direct UI** — 25 tabs, 41 underlying components, all interactive.

#### 15.4.2 Internal action surface (what the smart router / cron can actually do)
- Create / delete **Task** rows (and Orion's Undo deletes them).
- Create / delete **Agent** rows + spawn **SpawnedAgent** records under a parent.
- Send / delete **AgentMessage** records (internal comms bus, no external delivery).
- Run a **Skill** inline (20 skills in catalog; some are LLM-only wrappers).
- Toggle theme, navigate tabs, dispatch search event.
- Query fleet / revenue / tasks / health from the SQLite DB.

#### 15.4.3 Background execution
- **27+ cron dispatchers** (`src/lib/cron-dispatcher.ts`) fire on schedule — fleet-watchdog, payment-reconciler, model-sync, spawned-cleanup, branding-reconciler, etc. Each writes a `CronHistory` row and (where applicable) inserts findings into the agent-monitor system.
- **8 agent monitors** (`src/lib/agent-monitors.ts`) poll on intervals (30s–10min) and create findings + suggested tasks.
- **Autonomy Loop tab** — manually triggered "plan → act → reflect" loop. Currently a single LLM call with no actual sub-task dispatch.
- **Pipelines / Autonomy Templates / Scheduled Autonomy** — DB-backed templates exist; execution layer is partial.

#### 15.4.4 Memory & context
- 4 memory tables (`Memory`, `MemoryLink`, `Skill`, `SkillRun`) backed by Prisma.
- `JARVIS_SYSTEM_PROMPT` persona injected into chat completions.
- Memory graph visualization (force-directed).
- Learning auto-move (LLM-promote a memory from short-term to long-term based on usage).

#### 15.4.5 Observability & safety
- 3-tier error boundary (`ErrorBoundary` + `error.tsx` + `global-error.tsx`).
- Action tracker (fire-and-forget telemetry on every UI action).
- Audit log + blackbox + backup rotate + rollback-system (lib exists, not wired into destructive ops).
- Credential vault (AES-256-GCM) for 3 stores.
- OS executor blocklist + SSRF guard + path traversal protection + input validation on 12 routes.

---

### 15.5 Gap Analysis — Wired but Not Working

These features **exist in code** but do not produce the autonomous behavior they imply. Each is a quick win — the wiring is there, the binding is missing.

#### Gap 1 — Chat → smart router does not confirm side-effects to the user
- **Symptom.** `ChatTab` posts to `/api/orion/command`, the server creates a task / agent / comms row, the response includes the created object — but `ChatTab` only renders the response `text` and an `intent` badge. There is no "Task #142 created ✓ [open]" affordance like Orion's action visualizer provides.
- **Why it matters.** Users can't tell whether their directive had any effect without leaving Chat and navigating to the Tasks tab.
- **Fix surface.** `src/components/tabs/ChatTab.tsx` (192 lines) — add an `ActionCard` sub-component mirroring Orion's, with click-to-navigate.

#### Gap 2 — Autonomy Loop lacks a verification gate
- **Symptom.** The Autonomy Loop tab runs a single `plan → act → reflect` LLM call. The "act" step is a prompt, not a dispatched sub-task — the loop produces prose about what it would do, not actual fleet mutations.
- **Why it matters.** This is the single biggest "autonomy" gap — the feature's name promises closed-loop execution, the implementation delivers an essay.
- **Fix surface.** `src/components/tabs/AutonomyTab.tsx` + new `/api/autonomy/run` route that fans the plan out into Task rows + dispatches each to a worker agent.

#### Gap 3 — Cron dispatchers fire but skip rollback on failure
- **Symptom.** `cron-dispatcher.ts` writes a `CronHistory` row with status=success or status=error, but on error it does **not** invoke the existing `rollback-system.ts` lib to undo partial side-effects.
- **Why it matters.** Failed cron runs leave the system in an inconsistent state (e.g. half-synced models, half-cleaned spawned agents).
- **Fix surface.** `src/lib/cron-dispatcher.ts` — wrap each dispatcher body in a try/catch that calls `rollback()` on throw, with a per-dispatcher snapshot taken before execution.

#### Gap 4 — Model knowledge table not consulted by smart router
- **Symptom.** The `Model` table (446 models across 23 providers) records each model's context window, modality, cost, rate-limit, and capability tags. The smart router (`/api/orion/command`) and chat (`/api/chat`) hardcode `glm-4.6` and never consult this catalog — so when GLM-4.6 is rate-limited, the request simply fails instead of falling back to e.g. `gpt-4o` or `claude-3-5-sonnet`.
- **Why it matters.** The "all-models-via-env-keys" promise (15+ providers seeded with API keys) is unrealized value — the keys are present but unused.
- **Fix surface.** `src/lib/llm.ts` — add a `selectModel(taskKind)` helper that queries the Model table for available models matching the task kind and picks the cheapest non-rate-limited one; fall back to `glm-4.6` if the table is empty.

---

### 15.6 Gap Analysis — Completely Missing

These capabilities are **not present at all** in JARVIS today. They are the difference between "operations dashboard" and "autonomous agent".

#### Missing 1 — Task decomposition pipeline (plan → research → execute → verify)
- JARVIS's smart router is single-intent: "create a task" → 1 Task row. There is no "ship the pricing page" → 12-step plan with research, file edits, test runs, and verification.
- **Comparable to:** Claude Code's TodoWrite, OpenHands' Manager/Worker, Devin's Plan panel, AutoGPT's Thought/Plan/Criticism scaffold.
- **Required to ship:** a `Plan` table (id, goal, steps JSON, status, parent_plan_id for nested), a `PlanStep` table (id, plan_id, step_number, kind, args, status, result, verified_at), a `/api/plan/create` route that calls the LLM with a decomposition prompt, and a `/api/plan/{id}/execute` route that runs each step via the Action Bus (§15.8) and writes results back.

#### Missing 2 — Browser automation (click, type, navigate)
- JARVIS has `web-scraper.ts` (cheerio-based, fetch + parse) but **no DOM interaction** — cannot click a button, fill a form, or complete a login flow. Cannot book a flight, fill a Salesforce lead, or scrape a JS-rendered SPA.
- **Comparable to:** Adept ACT-1, MultiOn, OpenHands' built-in browser, Devin's Chromium.
- **Required to ship:** a `browser-action` API route that drives a headless Playwright instance (already installed as a transitive dep via `agent-browser` skill), exposes click/type/screenshot/extract primitives, and persists sessions to a `BrowserSession` table for resume.

#### Missing 3 — Terminal / command execution
- The app runs in a Next.js process and has no route that executes a shell command on the host. The Orion `run-skill` intent runs skills inline (LLM calls), not arbitrary shell.
- **Comparable to:** Claude Code, OpenHands, Devin, Cursor agent mode.
- **Required to ship:** an `os-exec` API route with an allow-list (block `rm -rf /`, `:(){:|:&};:`, `dd of=/dev/`), per-command timeout, stdout/stderr capture, and audit-log entry. Wire into Orion as a `run-command` intent.

#### Missing 4 — File system operations (read, write, edit)
- No API route reads, writes, or edits files outside the SQLite DB. The `web-scraper.ts` writes nothing to disk; `reports/pdf` writes to a tmp buffer; `admin/backup` exports JSON but doesn't accept inbound file edits.
- **Comparable to:** Claude Code, OpenHands, Devin, Cursor, Paperclip.
- **Required to ship:** a `file-op` API route with read/write/edit/append/list, sandboxed to a configured workspace directory (`/home/z/my-project/workspace/` or similar), with path-traversal protection (already have the guard in lib) and per-op audit-log entries.

#### Missing 5 — Telegram bot command integration
- Comms are internal-only (AgentMessage rows in SQLite). No external messaging integration — no Telegram, no Slack, no email egress.
- **Comparable to:** Devin (Slack intake), Zapier AI (7000+ SaaS), Jarvis variants (sometimes Telegram).
- **Required to ship:** a Telegram bot webhook route (`/api/integrations/telegram/webhook`), a long-polling bridge service (mini-service on port 3004 alongside the existing realtime-service on 3003), an `Integration` Prisma model for bot tokens + chat IDs, and an Orion intent `send-telegram` that mirrors `send-comms`.

#### Missing 6 — Orion as default shell on app open
- Orion is a manual overlay (`Cmd+Shift+O`). The user lands on the Overview tab. There is no setting to make Orion the default surface.
- **Comparable to:** Jarvis variants (voice-first by default), Adept (browser-overlay by default).
- **Required to ship:** a `settings` table (or a key in the existing branding JSON) flag `orionAsDefaultShell`, and a `useEffect` in `page-client.tsx` that opens the Orion overlay on mount when the flag is true. Should be opt-in (operator may prefer the dashboard view).

#### Missing 7 — Full memory / skills / plugins / knowledge in prompt context
- Chat uses `JARVIS_SYSTEM_PROMPT` (a static persona string). It does **not** inject: the user's pinned memories, the skills catalog, the rules-plugins catalog, the knowledge-base docs (none exist yet), or the agent roster relevant to the query.
- **Comparable to:** Claude Code (auto-loads `CLAUDE.md`, `AGENTS.md`, repo structure), Cursor (`@-mention` for files / docs / symbols), OpenHands (loads repo into context).
- **Required to ship:** a `buildContext(query)` helper in `src/lib/llm.ts` that (a) embeds the query, (b) retrieves top-k memories via similarity search, (c) loads skills/rules matching the query's entity tags, (d) loads the user's pinned memories + persona, (e) assembles a system prompt with all of it. Token-budget-aware truncation required.

#### Missing 8 — Multi-step plan execution with checkpoints & resume
- Even with a Plan table (Missing 1), there's no execution engine that (a) runs steps in dependency order, (b) pauses at checkpoints for operator approval, (c) resumes after a server restart, (d) retries failed steps with backoff.
- **Comparable to:** Devin (pause/resume), OpenHands (per-step budgets), Zapier (retry/rollback per step).
- **Required to ship:** a `plan-executor` worker (probably a mini-service on port 3005 alongside realtime 3003 + telegram 3004) that polls `PlanStep` rows where status=pending and parent dependencies are met, executes each via the Action Bus, and persists results. Checkpoints are `PlanStep` rows with `requires_approval=true` that block until the operator clicks Approve in a new `PlanTab`.

---

### 15.7 Improvement Plan (Priority 1–8)

Each priority below lists: **rationale** · **scope** · **success criteria** · **risks** · **file targets** · **dependency edges**.

#### Priority 1 — Make the unified chat panel actually execute tasks (not just return text)
- **Rationale.** ChatTab was rewired to `/api/orion/command` (worklog FIX-TEACH-CHAT-ORION) but the UI only renders the response text. Users cannot tell whether their directive had any effect. This is the cheapest, highest-leverage fix — the backend already does the work, the frontend just hides it.
- **Scope.** Add an `ActionCard` component (mirroring Orion's action visualizer) that renders below the assistant message when the response includes a non-chat intent. Card shows: intent badge, resource type + ID, action summary, click-to-navigate link, undo button for reversible actions (create-task / create-agent / send-comms — same DELETE routes Orion uses).
- **Success criteria.** Typing "create a high priority task to ship the API" in Chat produces a visible "Task #142 created — Open →" card with an Undo button, exactly as Orion does.
- **Risks.** Low — code is already 90% reusable from OrionShell.tsx's `ActionResult` component. Main risk is layout regression in the chat message list.
- **File targets.** `src/components/tabs/ChatTab.tsx`, new `src/components/jarvis/ChatActionCard.tsx`.
- **Dependencies.** None — can ship today.

#### Priority 2 — Add task decomposition pipeline (plan → research → execute → verify)
- **Rationale.** This is the heart of "autonomous". Without it, JARVIS is a fancy command parser, not an agent.
- **Scope.**
  1. New `Plan` + `PlanStep` Prisma models (`prisma/schema.prisma`).
  2. New `/api/plan/create` route — accepts a goal, calls LLM with a decomposition prompt, returns a plan with N steps.
  3. New `/api/plan/{id}/execute` route — dispatches each step to the Action Bus (§15.8), writes results.
  4. New `/api/plan/{id}/verify` route — after execution, calls LLM with the original goal + the step results, asks "did this achieve the goal?", writes verdict.
  5. New `PlanTab` UI — list plans, drill into steps, see real-time status, approve checkpoints.
  6. New Orion intent `make-plan` that calls `/api/plan/create` and renders the plan in the action visualizer.
- **Success criteria.** Saying "make a plan to ship the pricing page" produces a 6–10 step plan visible in the PlanTab, with each step having a status, result, and verify verdict. At least 3 step types work end-to-end (create-task, run-skill, send-comms).
- **Risks.** Medium — decomposition prompts drift; verification LLM is unreliable. Mitigate with strict JSON schemas + few-shot prompts.
- **File targets.** `prisma/schema.prisma`, `src/app/api/plan/**`, `src/components/tabs/PlanTab.tsx`, `src/lib/orion-intent.ts` (new `make-plan` intent), `src/lib/plan-executor.ts`.
- **Dependencies.** Action Bus (§15.8) for step execution; Priority 3–5 for non-LLM step types.

#### Priority 3 — Add browser automation capability (click, type, navigate)
- **Rationale.** Browser automation unlocks entire categories of use case (lead-gen scraping, form-filling, competitor monitoring, social posting) that JARVIS currently cannot touch.
- **Scope.**
  1. New `/api/browser/{navigate,click,type,screenshot,extract,close}` routes backed by Playwright (`playwright` is already a transitive dep via the `agent-browser` skill).
  2. New `BrowserSession` Prisma model (id, cookies JSON, localStorage JSON, last_url, created_at, expires_at).
  3. New `BrowserTab` UI showing a live screenshot + step log + manual-takeover button.
  4. New Orion intent `browse` ("go to github.com and find the latest release of next.js").
  5. Wire into Plan executor as a `browser-action` step kind.
- **Success criteria.** Saying "go to news.ycombinator.com and tell me the top 3 stories" returns the actual top 3 titles, with a screenshot visible in BrowserTab.
- **Risks.** High — Playwright in a Next.js process is heavy (Chromium download ~150 MB), can crash the dev server. Mitigate by running the browser in a separate mini-service (port 3006) like realtime-service (3003).
- **File targets.** `src/app/api/browser/**`, `mini-services/browser-service/**`, `src/components/tabs/BrowserTab.tsx`, `prisma/schema.prisma` (BrowserSession model).
- **Dependencies.** None for the route; Action Bus integration for plan-step use.

#### Priority 4 — Add terminal / command execution capability
- **Rationale.** Required for the "AI coding agent" use case (Claude Code / OpenHands / Devin parity). Also enables devops automations (deploy, restart, log-tail).
- **Scope.**
  1. New `/api/os/exec` route — accepts `{ command, cwd, timeoutMs, env }`, runs via `child_process.spawn` with allow-list + block-list + per-command timeout + stdout/stderr capture.
  2. Allow-list: `git`, `npm`, `bun`, `node`, `ls`, `cat`, `head`, `tail`, `rg`, `find`, `wc`, `mkdir`, `touch`, `echo`, `pwd`, `cd`, `curl`, `python3`.
  3. Block-list (regex): `rm -rf /`, `:(){:|:&};:`, `dd of=/dev/`, `mkfs`, `> /dev/sd`, `sudo`, `chmod 777`, `curl | sh`.
  4. New `TerminalTab` UI — xterm.js-backed interactive shell with the same allow/block-list enforcement.
  5. New Orion intent `run-command` ("run git status in /home/z/my-project").
  6. Wire into Plan executor as a `shell` step kind.
- **Success criteria.** Saying "run npm test in /home/z/my-project" returns the test output inline.
- **Risks.** Critical — shell execution is the highest-risk capability in any agent. Mitigate with allow-list (default-deny), per-command operator approval for non-allow-listed commands, full audit-log entry per exec, and an emergency kill-switch route.
- **File targets.** `src/app/api/os/exec/route.ts`, `src/lib/os-executor.ts` (expand existing blocklist), `src/components/tabs/TerminalTab.tsx`, `src/lib/orion-intent.ts` (`run-command` intent).
- **Dependencies.** Audit log (already exists); rollback-system (already exists) for snapshot-before-exec.

#### Priority 5 — Add file system operations (read, write, edit)
- **Rationale.** Companion to Priority 4 — without file ops, JARVIS can't edit code, write configs, or produce artifacts on disk.
- **Scope.**
  1. New `/api/file/{read,write,edit,append,list,stat,delete}` routes.
  2. Sandbox to a configured workspace dir (`WORKSPACE_DIR` env var, default `/home/z/my-project/workspace/`).
  3. Path-traversal protection (already have `src/lib/security/path-traversal.ts` — reuse).
  4. Diff-based edit API (pass `oldString` + `newString`, server applies atomic replace).
  5. New `FilesTab` UI — file tree + Monaco editor (already available via `@monaco-editor/react` if installed; otherwise a textarea fallback).
  6. New Orion intent `edit-file` ("change line 42 of src/lib/llm.ts to use gpt-4o").
  7. Wire into Plan executor as a `file-op` step kind.
- **Success criteria.** Saying "create a file /home/z/my-project/workspace/hello.txt with the content 'hi'" produces the file; saying "show me the first 50 lines of package.json" returns them.
- **Risks.** Medium — sandbox escape if path-traversal check is buggy. Mitigate with the existing guard + a chroot-style prefix check + audit-log per op.
- **File targets.** `src/app/api/file/**`, `src/lib/file-ops.ts`, `src/components/tabs/FilesTab.tsx`, `src/lib/orion-intent.ts` (`edit-file`, `read-file` intents).
- **Dependencies.** Audit log; rollback-system.

#### Priority 6 — Add Telegram bot command integration
- **Rationale.** External messaging turns JARVIS from a local dashboard into a reachable assistant — operator can fire directives from their phone, receive notifications anywhere.
- **Scope.**
  1. New `Integration` Prisma model (id, provider, bot_token, default_chat_id, config JSON).
  2. New `/api/integrations/telegram/webhook` route — receives Telegram updates, parses the message, dispatches to `/api/orion/command`, sends the response back via the Telegram Bot API.
  3. New mini-service `mini-services/telegram-bridge/` (port 3004) — long-polls Telegram if webhook isn't reachable (e.g. local dev).
  4. New Orion intent `send-telegram` ("send this to the ops channel: deploy starting").
  5. New `IntegrationsTab` UI — manage bot tokens, chat IDs, test messages.
  6. Wire notifications bell to optionally mirror to Telegram.
- **Success criteria.** Messaging the JARVIS Telegram bot "fleet status" returns the same fleet summary that Orion returns; an error notification in the app also posts to the configured Telegram chat.
- **Risks.** Low-medium — Telegram bot tokens are sensitive (encrypt via existing credential-vault). Rate-limit Telegram API (30 msg/sec global).
- **File targets.** `prisma/schema.prisma` (Integration model), `src/app/api/integrations/telegram/**`, `mini-services/telegram-bridge/**`, `src/components/tabs/IntegrationsTab.tsx`, `src/lib/orion-intent.ts` (`send-telegram` intent).
- **Dependencies.** Credential vault (already exists); Priority 1 ActionCard pattern for response rendering.

#### Priority 7 — Make Orion the default shell on app open
- **Rationale.** Operator who wants voice-first experience shouldn't have to press `Cmd+Shift+O` every page load.
- **Scope.**
  1. Add `orionAsDefaultShell: boolean` to the branding JSON (`Branding` model — already DB-backed).
  2. Add a Settings panel (could live in the existing Branding tab or a new Settings tab) to toggle the flag.
  3. `useEffect` in `page-client.tsx` checks the flag on mount and opens the Orion overlay if true.
  4. Persist the user's last-overlay-state in localStorage so closing Orion doesn't immediately reopen it.
- **Success criteria.** With the flag on, opening `http://localhost:3000/` lands in the Orion overlay (auto-listening) instead of the Overview tab. Closing Orion drops to the dashboard; reopening the page re-opens Orion.
- **Risks.** Low — pure UX. Main risk is annoying operators who don't want voice-first; mitigate with a "don't show on startup" checkbox in the overlay.
- **File targets.** `src/lib/branding.ts` (add flag to schema + default), `src/app/page-client.tsx` (mount effect), `src/components/jarvis/OrionShell.tsx` (accept `defaultOpen` prop), `src/components/tabs/BrandingTab.tsx` (settings toggle).
- **Dependencies.** None.

#### Priority 8 — Wire all memories / skills / plugins / knowledge into the prompt context
- **Rationale.** Without this, JARVIS's chat has no memory of past conversations, no awareness of the user's pinned notes, no knowledge of available skills. Every prompt is stateless.
- **Scope.**
  1. New `src/lib/context-builder.ts` — exports `buildSystemPrompt(query, userId)` that:
     - Loads `JARVIS_SYSTEM_PROMPT` (persona).
     - Loads top-k `Memory` rows by similarity (use a simple TF-IDF or embedding-based search; the LLM SDK exposes `chat.completions.createEmbeddings`).
     - Loads `Skill` rows whose tags match entities in the query.
     - Loads `Rule` + `Plugin` rows flagged `injectIntoPrompt=true`.
     - Loads the user's pinned memories (Memory rows where `pinned=true`).
     - Assembles into a single system prompt with clear section markers (`=== PERSONA ===`, `=== MEMORIES ===`, `=== SKILLS ===`, `=== RULES ===`).
     - Token-budget-aware truncation (reserve 4k tokens for the user query + 2k for the response; fill the rest with context).
  2. Modify `/api/chat` and `/api/orion/command` to call `buildSystemPrompt` instead of the static `JARVIS_SYSTEM_PROMPT`.
  3. Add a `ContextPreviewPanel` in the Chat tab header — click to expand and see exactly what was injected (debug aid).
- **Success criteria.** Telling chat "remember that I prefer concise responses" → next chat "summarize the fleet" returns a 2-sentence summary instead of a paragraph, because the memory was injected. Pinned memory "I'm building a SaaS called ARIA" appears in the ContextPreviewPanel.
- **Risks.** Medium — token-budget exhaustion if too many memories match; embedding API latency adds ~200ms per request. Mitigate with caching (memoize embeddings by query hash for 60s) and aggressive truncation.
- **File targets.** `src/lib/context-builder.ts` (new), `src/app/api/chat/route.ts`, `src/app/api/orion/command/route.ts`, `src/components/tabs/ChatTab.tsx` (preview panel).
- **Dependencies.** Embedding API (available via z-ai-web-dev-sdk); Memory table (exists).

---

### 15.8 Architecture Sketch — Unified Action Bus

Today JARVIS has **three separate execution paths**: (1) the smart router at `/api/orion/command`, (2) the cron dispatcher, (3) the autonomy loop. Each has its own intent parsing, its own error handling, its own audit-log writes. Adding Priorities 2–6 on top of this would create six more paths. The clean refactor is a **single Action Bus** that all entry points (chat, Orion, cron, autonomy, Telegram, plan-executor) call into.

```
                         ┌────────────────────────────────────────────┐
                         │              ACTION BUS                     │
Entry points             │  POST /api/action  { kind, args, userId }   │
─────────────────        │  - validates args against schema registry  │
 ChatTab  ──────────▶    │  - writes AuditLog row BEFORE exec          │
 OrionShell ─────────▶   │  - snapshots state for rollback             │
 CronDispatcher ──────▶   │  - dispatches to registered handler         │
 AutonomyLoop ─────────▶  │  - captures result + error                 │
 TelegramWebhook ──────▶  │  - writes AuditLog row AFTER exec           │
 PlanExecutor ──────────▶ │  - emits WebSocket event (realtime)        │
                         │  - returns { ok, result, auditId }          │
                         └────────────┬───────────────────────────────┘
                                      │
                                      ▼
                         ┌────────────────────────────────────────────┐
                         │           HANDLER REGISTRY                 │
                         │  kind → { schema, handler, reversible }    │
                         │                                            │
                         │  create-task      → tasks.ts               │
                         │  create-agent     → agents.ts              │
                         │  send-comms       → comms.ts               │
                         │  run-skill        → skills.ts              │
                         │  navigate         → (client-only, noop)    │
                         │  os-exec          → os-executor.ts (P4)    │
                         │  file-op          → file-ops.ts (P5)       │
                         │  browser-action   → browser-service (P3)   │
                         │  send-telegram    → telegram-bridge (P6)   │
                         │  llm-chat         → llm.ts                 │
                         │  plan-execute     → plan-executor.ts (P2)  │
                         └────────────────────────────────────────────┘
```

**Benefits.** (1) One audit-log shape for all actions. (2) One rollback hook. (3) One WebSocket event channel. (4) New capabilities (Priorities 3–6) plug in as new handlers, not new API routes. (5) The Plan executor (Priority 2) becomes trivially a loop that calls `/api/action` per step.

**Migration path.** Don't big-bang. Step 1: create `/api/action` route + registry, register existing smart-router intents as handlers. Step 2: re-point `/api/orion/command` to be a thin adapter that calls `/api/action`. Step 3: re-point `cron-dispatcher.ts` to call `/api/action`. Step 4: re-point AutonomyLoop. Step 5: add new handlers for Priorities 3–6.

---

### 15.9 Phased Roadmap

| Phase | Weeks | Scope | Ships |
|---|---|---|---|
| **Phase 0 — Stabilize** | 1 | Priority 1 (Chat ActionCard) + Gap 4 (model knowledge fallback) + Gap 3 (cron rollback). | Chat shows side-effects; cron is transactional; model fallback works. |
| **Phase 1 — Action Bus + Plan skeleton** | 2 | §15.8 Action Bus MVP (migrate smart router + cron + autonomy onto it) + Priority 2 Plan decomposition (Plan/PlanStep models, /api/plan/*, PlanTab, make-plan Orion intent). | Closed-loop "plan → execute → verify" for LLM-only step types. |
| **Phase 2 — Filesystem + Terminal** | 3 | Priority 5 (file ops) + Priority 4 (os-exec) + FilesTab + TerminalTab. | JARVIS can read/write/edit files and run allow-listed commands. |
| **Phase 3 — Browser + Telegram** | 3 | Priority 3 (browser automation, mini-service) + Priority 6 (Telegram bridge, mini-service) + BrowserTab + IntegrationsTab. | JARVIS can drive a browser and reach the operator via Telegram. |
| **Phase 4 — UX + Context** | 3 | Priority 7 (Orion-as-default-shell) + Priority 8 (context-builder with memory/skills/plugins/rules injection) + ContextPreviewPanel. | Voice-first mode + stateful chat with memory. |

**Total: ~12 weeks of engineering for full parity with the autonomous-AI leaders on the dimensions that matter for JARVIS's positioning.** Phases are independently shippable — each delivers value without depending on the next.

---

### 15.10 Tool-by-Tool Inspiration Index

Concrete features to steal from each researched tool, mapped to JARVIS priorities.

| Tool | Steal this | Maps to |
|---|---|---|
| Claude Code | TodoWrite-style visible plan + per-step approval prompt | Priority 2 |
| Claude Code | `CLAUDE.md` / `AGENTS.md` auto-loaded context files | Priority 8 |
| OpenHands | Manager-Worker agent pattern (planner delegates to workers) | Priority 2 |
| OpenHands | Per-step budgets (max iterations, max tokens, max wall-clock) | Priority 2 (plan executor) |
| Devin | Visible "Plan" panel with editable checklist | Priority 2 (PlanTab) |
| Devin | Pause / resume long-running tasks across server restarts | Missing 8 |
| Devin | Slack intake for async task assignment | Priority 6 (Telegram analog) |
| Cursor | `@-mention` for files / symbols / docs in chat | Priority 8 (context-builder) |
| Cursor | Per-tool-call approval (allow-list vs. ask-each-time) | Priority 4 (os-exec) |
| Copilot Workspace | Generate plan + diff before any file is touched | Priority 2 + 5 |
| AutoGPT | Thought → Reasoning → Plan → Criticism → Action scaffold | Priority 2 |
| BabyAGI | Minimal task-list queue (LLM appends new tasks from last result) | Priority 2 (simpler variant) |
| Adept ACT-1 | Screenshot + DOM dual-input for browser actions | Priority 3 |
| MultiOn | Persistent sessions (cookies/localStorage survive across runs) | Priority 3 (BrowserSession) |
| MultiOn | Developer SDK exposing primitives (`client.click`, `client.type`) | Priority 3 (browser API) |
| Zapier AI | 7000+ SaaS integrations via OAuth | Future (post-Phase 4) |
| Zapier AI | Per-step retry + rollback semantics | Gap 3 (cron) + Priority 2 (plan) |
| Paperclip | YAML/markdown task-definition format (deterministic plan) | Priority 2 (PlanTemplate) |
| Jarvis variants | Wake-word + TTS first-class UX (JARVIS already has this) | — (already shipped) |
| Jarvis variants | Smart-home / IoT hooks (out of scope for JARVIS's positioning) | — (won't ship) |

---

### 15.11 Pending Works — Full Backlog

Consolidated backlog of unimplemented features surfaced by this research. Items in **bold** are the highest-leverage (Priority 1–8 from §15.7); the rest are carry-forward from §13 and new ideas sparked by the comparison.

#### Execution Layer
- **[P1]** ChatTab ActionCard with intent badge + click-to-navigate + undo.
- **[P2]** Plan + PlanStep Prisma models + `/api/plan/{create,execute,verify}` routes + `PlanTab` UI.
- **[P4]** `/api/os/exec` route with allow-list + block-list + per-command approval + audit log + `TerminalTab` (xterm.js).
- **[P5]** `/api/file/{read,write,edit,append,list,stat,delete}` routes + sandbox + `FilesTab` (Monaco editor).
- **[P3]** `/api/browser/{navigate,click,type,screenshot,extract,close}` routes + `BrowserSession` model + `BrowserTab` + mini-service on port 3006.
- [Future] WebSocket-based live terminal streaming (vs. one-shot exec).
- [Future] Multi-file diff editor for Plan-step review (Copilot Workspace parity).

#### Planning Layer
- **[P2]** Decomposition prompt templates (per goal-kind: ship-feature, research, ops-task, content).
- **[P2]** Verify-step LLM call with strict JSON schema.
- **[P2]** Checkpoint approval flow (`PlanStep.requires_approval=true` blocks until approved).
- [Missing 8] Plan-executor mini-service (port 3005) — polls pending steps, respects dependencies, retries with backoff.
- [Missing 8] Plan pause/resume across server restart (persist in-progress step state to DB).
- [Future] Plan templating (Paperclip-style YAML plans stored as `PlanTemplate` rows).
- [Future] Plan sharing (export/import plan JSON).

#### Browser Layer
- **[P3]** Headless Playwright driver in mini-service.
- **[P3]** Session persistence (cookies + localStorage in `BrowserSession`).
- **[P3]** Screenshot capture + live view in `BrowserTab`.
- [Future] MultiOn-style developer SDK (`client.click`, `client.type`) as a public library.
- [Future] Adept-style screenshot+DOM dual-input for vision-model browser actions.
- [Future] Stealth mode (residential proxies, human-like typing delays) — ethical review required.

#### Terminal Layer
- **[P4]** Allow-list + block-list (regex) for commands.
- **[P4]** Per-command timeout + stdout/stderr capture.
- **[P4]** Audit-log entry per exec.
- [Future] Operator approval queue for non-allow-listed commands.
- [Future] Rollback-system snapshot before exec (auto-`git stash` if in a repo).
- [Future] `run-command` Orion intent.

#### Filesystem Layer
- **[P5]** Sandbox to `WORKSPACE_DIR`.
- **[P5]** Path-traversal protection (reuse `src/lib/security/path-traversal.ts`).
- **[P5]** Diff-based edit API (oldString + newString → atomic replace).
- [Future] File watcher (notify chat when a watched file changes).
- [Future] Git integration (commit / branch / PR via file-ops + os-exec).
- [Future] `edit-file` + `read-file` Orion intents.

#### Comms / Telegram Layer
- **[P6]** `Integration` Prisma model (provider, bot_token, default_chat_id).
- **[P6]** `/api/integrations/telegram/webhook` route.
- **[P6]** Mini-service `telegram-bridge` (port 3004) for long-polling fallback.
- **[P6]** `IntegrationsTab` UI.
- **[P6]** `send-telegram` Orion intent.
- [Future] Slack webhook integration (mirror of Telegram).
- [Future] Email egress (SMTP via credential-vault).
- [Future] Notifications bell mirror to Telegram/Slack.

#### UX Layer
- **[P7]** `orionAsDefaultShell` branding flag + `useEffect` in `page-client.tsx`.
- **[P7]** "Don't show on startup" checkbox in Orion overlay.
- [Future] Settings tab (consolidate branding + orion-default + notification prefs + cron enable/disable).
- [Future] Mobile-responsive Orion overlay (currently desktop-only).
- [Future] Multi-user / RBAC (currently single-operator).

#### Context Layer
- **[P8]** `src/lib/context-builder.ts` with persona + memories + skills + rules + plugins injection.
- **[P8]** Embedding-based memory retrieval (z-ai-web-dev-sdk `chat.completions.createEmbeddings`).
- **[P8]** Token-budget-aware truncation.
- **[P8]** `ContextPreviewPanel` in Chat header.
- [Future] `CLAUDE.md` / `AGENTS.md`-style project-context file auto-loaded from repo root.
- [Future] Conversation summarization (compress older turns into a summary memory).
- [Future] Per-agent context (each agent in the fleet has its own memory store).

#### Carry-forward from §13 (Pending / Future Work)
- 89 Prisma models target (have 34, need 55 more — RBAC, tenant, compliance, eval, AgentInstance, AgentMetric, Client, Service, Revenue, Outreach, ResearchLog, VoiceWorkflow, VoiceCall, ImprovementProposal, SelfImprovementLog, WorkforcePerformance, AgentEvolution).
- 240+ API routes target (have 111, need 130+ more — mostly mini-service routes).
- 78+ skills target (have 20 in DB; skills/ dir has 65 ClawHub skills available).
- Video understanding — wire video-understand skill for actual transcription.
- Wire rollback-system into destructive ops (auto-snapshot before code/config changes) — **partially addressed by Gap 3 fix**.
- Spawn-on-high-load automation — auto-spawn when Agent.load > 80%.
- Credential vault auto-fill — agents auto-use linked credentials.
- Earning methods wire to tasks — auto-create tasks when method enabled.
- Wire model knowledge to smart-router — **addressed by Gap 4 fix**.
- Branding Live Preview Frame — mock chat with new preamble.
- claude-mem 3-layer progressive-disclosure search in Memory tab.
- claude-superpowers `using-superpowers` bootstrap preamble.
- claude-superpowers 3-gate workflow (brainstorm → write-plan → execute-plan) in Orchestrator tab — **subsumed by Priority 2**.
- Skill-behavior evals (drill harness + LLM verifier) for SkillLearning tab.
- OCR/transcription for video+image uploads.
- Logo auto-generation via Image-Generation skill.
- Custom sound upload for notifications (currently fixed beep).
- Rate-limiting middleware on auth-prone API routes.
- SMTP wiring for scheduled email reports (stub exists, no SMTP).

---

### 15.12 Summary

JARVIS Mission Control is a **polished operations dashboard with an intelligent command parser** — it has voice, chat, 14 smart-router intents, a 64-agent fleet, 27+ cron dispatchers, 8 monitors, AES-256-GCM credential vaults, and 111 API routes. What it lacks, compared to the autonomous-AI leaders (Claude Code, OpenHands, Devin, AutoGPT, Adept, MultiOn, Zapier AI), is the **execution surface**: no filesystem, no shell, no browser, no external messaging, no plan decomposition, no verification gate, no stateful prompt context.

The improvement plan in §15.7 (Priorities 1–8) closes the gap in **~12 weeks of phased work** (§15.9). Priority 1 is a one-day fix; Priorities 2–8 are each 1–3 weeks of engineering. The unifying architectural refactor — a single **Action Bus** (§15.8) that all entry points (chat, Orion, cron, autonomy, Telegram, plan-executor) call into — is the structural change that turns JARVIS from "many parallel parsers" into "one autonomous agent with many front-ends".

The single highest-leverage next action is **Priority 2 (task decomposition pipeline)** — it is the feature that most directly delivers on the "autonomous" promise in the product's name. Priority 1 ships first because it's a one-day confidence-builder that proves the smart-router side-effects are real and visible.

---

*Appended by Task ID RESEARCH (research agent). For the full project history, see `/home/z/my-project/worklog.md`. For all permanent rules, see `/home/z/my-project/RULES.md`.*
