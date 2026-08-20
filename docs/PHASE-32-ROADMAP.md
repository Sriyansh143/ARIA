# ARIA Mission Control — Phase 32 Roadmap

**Previous:** Phase 31 (Vision + Streaming + Search + Swarm) → v81.0.0 — 9.8/10
**Current Target:** Phase 32 → v82.0.0

---

## Phase 32 Strategic Goals

Phase 31 brought the platform to 9.8/10 production readiness with multimodal vision, SSE streaming, 4-provider search, and multi-agent swarm. The critical remaining gap is **UI/UX polish** (6.5/10 — the only domain below 8/10). Phase 32 closes this gap + adds the next-gen features needed to beat ChatGPT, Gemini, and Perplexity in head-to-head comparisons.

### Scoring Targets

| Category | Current (v81) | Target (v82) |
|---|---|---|
| Owner Approval UX | 9.6/10 | 9.8/10 (mobile app + conversation rendering in dashboard) |
| Conversational & Context | 8.5/10 | 9.5/10 (interactive canvas + native LLM streaming) |
| Vision & Multimodal | 8.0/10 | 9.0/10 (video + PDF ingestion) |
| UI/UX Polish | 6.5/10 | 9.0/10 (sidebar + bento grid + dark mode + mobile + all Phase 29-31 backend rendered) |
| Multi-Agent Collaboration | 9.3/10 | 9.6/10 (agent specialization + visual swarm topology) |
| Overall Production Readiness | 9.8/10 | 9.9+/10 |

---

## Priority 1: Dashboard UI Migration (The "Aria Command Center")

### Goal
Migrate the dashboard from the legacy 15-tab layout to a modern sidebar + bento grid design. Render ALL Phase 29/30/31 backend capabilities in the dashboard. This is the single highest-impact Phase 32 work — it moves the UI/UX score from 6.5/10 to 9.0/10.

### Tasks

#### 1.1 Sidebar + BentoGrid Migration
- Replace top tab nav with collapsible `AppSidebar` (already in `src/components/dashboard/`)
- Migrate Overview tab to responsive `BentoGrid` (KPI cards, alerts, recent approvals, revenue chart, system health)
- Wire `SkeletonLoader` to all async data fetches
- Wrap each tab in `ErrorBoundary` so one tab's crash doesn't kill the dashboard
- Mobile breakpoint (375px) — test + fix all 15 tabs without horizontal scroll

#### 1.2 Vision Upload UI
- New "Vision" tab with drag-and-drop image upload zone
- Provider selector (Z-AI / OpenAI / Ollama / Mock)
- Prompt input with presets ("Generate React code", "Describe this image", "Extract text")
- Result panel showing: description, extracted text, suggested code (with syntax highlighting)
- History of past vision analyses (from AgentLog)

#### 1.3 Chat with SSE Streaming UI
- New "Chat" tab using `/api/chat/stream` SSE endpoint
- Token-by-token rendering (like ChatGPT)
- Stop button to abort streaming mid-response
- Conversation history persisted to DB
- Markdown rendering + code syntax highlighting

#### 1.4 Approval Conversation Panel
- Side panel that opens when an approval card is clicked
- Renders the conversation thread (questions, answers, suggestions, revisions) from `/api/approvals/[id]/conversation`
- Lets the owner type a new message directly
- Shows the inline keyboard state (Approve / Deny / Ask / Suggest buttons)

#### 1.5 Contract E-Sign UI
- New "Contracts" tab with:
  - List of contracts (status, client, amount, esign provider, esign status)
  - "Send for E-Signature" button (POST to `/api/contracts` with `esignProvider` + `sendNow: true`)
  - Per-contract detail view showing the esign events timeline
  - "Resend" / "Void" actions

#### 1.6 Audit Log Viewer
- New "Audit Log" tab with:
  - Filterable table (actor, resource, action, date range)
  - Read-only — no edit/delete
  - CSV export button
  - Search by resource id

#### 1.7 Memory + Reconciliation Dashboard
- New "System Health" tab with:
  - Live RSS chart (from `/api/system-memory`)
  - Heap chart (heapUsed / heapTotal over time)
  - Leak analysis widget (current slope + R²)
  - Stripe reconciliation summary (matched / discrepancies / total)
  - Discrepancy list with "Investigate" links
  - Search provider status (4 providers with health badges)

#### 1.8 Swarm Topology Visualizer
- New "Agent Fleet" tab showing:
  - Active agents (nodes in a graph)
  - Message flow (edges showing recent messages between agents)
  - Per-agent stats (messages sent, received, unread)
  - Click an agent to see its message history

#### 1.9 Dark Mode + Theme Provider
- `next-themes` integration
- Warm dark palette (dark navy #0F172A + amber accent #F59E0B)
- Toggle persists in localStorage

### Acceptance Criteria
- All 15 tabs render correctly in the new layout
- Dark mode toggles persist
- Mobile breakpoint (375px) renders without horizontal scroll
- Vision upload UI accepts images + returns analysis
- Chat tab streams tokens via SSE
- Approval conversation panel renders the thread
- Audit log viewer shows filterable entries
- Memory chart renders 24h of data + leak analysis
- Swarm topology shows active agents + message flow
- 0 TypeScript errors, all existing tests pass

### Effort: ~5 days

---

## Priority 2: Next-Gen Multimodal (Beat Gemini)

### 2.1 Video Ingestion Pipeline
**Current:** Vision provider accepts images only (PNG/JPEG via base64).
**Target:** Accept video files (MP4, WebM) — extract key frames + analyze each.

**Tasks:**
1. Add `ffmpeg` as a dependency (or use `fluent-ffmpeg` Node binding)
2. Extend `/api/vision/ingest` to accept video files (max 100MB)
3. Extract 1 frame per second (configurable) → analyze each frame
4. Synthesize a summary: "What happened in this video"
5. Store frame analyses + summary in AgentLog

**Effort: ~2 days**

### 2.2 PDF Ingestion Pipeline
**Current:** No PDF support.
**Target:** Accept PDF files → extract text + images → analyze each page.

**Tasks:**
1. Add `pdf-parse` (text extraction) + `pdf-lib` (page rendering) dependencies
2. Extend `/api/vision/ingest` to accept PDF files
3. Extract text per page → run through LLM for summarization
4. Extract images per page → run through vision provider
5. Return combined analysis: { textSummary, imageAnalyses[], fullText }

**Effort: ~1.5 days**

### 2.3 Native LLM Streaming (Beat ChatGPT)
**Current:** SSE streaming is simulated (we get the full response, then chunk it client-side).
**Target:** Native token streaming from Z-AI / Groq / Ollama (all support `stream: true`).

**Tasks:**
1. Upgrade `callLLM` in `src/lib/llm-client.ts` to accept a `stream: true` option
2. For Z-AI: use `zai.chat.completions.create({ stream: true })` → returns an async iterator
3. For Groq: use OpenAI SDK with `stream: true`
4. For Ollama: use `ollama.generate({ stream: true })` → NDJSON stream
5. Update `/api/chat/stream` to pipe the native stream directly to the SSE response
6. True token-by-token streaming (no simulation)

**Effort: ~2 days**

---

## Priority 3: Next-Gen Multi-Agent (Beat AutoGen/CrewAI)

### 3.1 Agent Specialization
**Current:** All agents share the same LLM + system prompt base.
**Target:** Each agent role (Marketer, Coder, Sales, Researcher) has a specialized model + fine-tuned system prompt.

**Tasks:**
1. Add `AgentRole` enum to the Agent model
2. Add per-role system prompt templates (in `src/lib/agent-roles/`)
3. Configure the LLM router to use different models per role:
   - Marketer: GLM-4 (creative)
   - Coder: DeepSeek-Coder (specialized for code)
   - Sales: Qwen-Max (multilingual)
   - Researcher: GLM-4-Flash (fast)
4. Add per-role token budgets + cost tracking

**Effort: ~2 days**

### 3.2 Visual Swarm Topology
**Current:** Swarm stats are JSON only.
**Target:** Interactive graph visualization showing agents + message flow.

**Tasks:**
1. Use `react-flow` or `d3.js` for the graph
2. Nodes = active agents (sized by message count)
3. Edges = recent messages (animated when a new message flows)
4. Click a node → see that agent's recent messages
5. Real-time updates via SSE (`/api/swarm/stream`)

**Effort: ~2 days**

### 3.3 Dynamic API Synthesizer (Beat Zapier)
**Current:** When an API fails, the agent gives up or asks the owner.
**Target:** When an API fails, the agent autonomously writes a Puppeteer scraper to extract the same data from the website.

**Tasks:**
1. New module `src/lib/dynamic-api-synthesizer.ts`
2. Input: failed API endpoint URL + expected response shape
3. Output: a Puppeteer script that scrapes the same data from the website
4. Cache the synthesized scraper for future use (in `CodeArchive`)
5. Fall back to the scraper when the API is down

**Effort: ~3 days**

---

## Priority 4: Financial & Compliance Polish

### 4.1 Automated Dunning & Predictive Churn
**Current:** Failed payments are logged but no autonomous action is taken.
**Target:** AI detects failed payments + autonomously negotiates payment plans via email/SMS.

**Tasks:**
1. New cron `daily-dunning` — scans ServiceOrder for `failed` payments
2. For each failed payment: LLM generates a personalized dunning email offering a payment plan
3. Send via Resend (email) + Twilio (SMS)
4. Track response → if customer agrees, create a new ServiceOrder with the negotiated amount
5. If no response in 7 days: mark as churned + update KPIs

**Effort: ~2 days**

### 4.2 SOC 2 Type II Preparation
**Current:** Audit log infrastructure exists but no formal certification.
**Target:** Prepare the documentation + controls for SOC 2 Type II audit.

**Tasks:**
1. Document all 12+ audit log call sites
2. Document data retention policies (7-year audit, 30-day contract, GDPR erasure)
3. Document access controls (RBAC matrix)
4. Document encryption (AES-256-GCM credential vault)
5. Document incident response (Telegram alerts + autonomy pause)
6. Engage a SOC 2 auditor (external — not code)

**Effort: ~1 day (code) + 4-8 weeks (audit)**

---

## Priority 5: Mobile + Voice

### 5.1 React Native Mobile App
**Current:** Owner approvals are Telegram-only.
**Target:** Native iOS + Android app for on-the-go approvals.

**Tasks:**
1. Initialize React Native (Expo) project
2. Push notifications (FCM + APNs)
3. Approval list view + swipe-to-approve/deny
4. Chat interface (using the SSE streaming endpoint)
5. Vision upload (camera + photo library)

**Effort: ~5 days**

### 5.2 WebRTC Voice Bridge
**Current:** SSE streaming is one-way (server → client).
**Target:** WebSocket full-duplex for real-time voice calls.

**Tasks:**
1. Set up WebSocket server (separate from Next.js — `ws` library)
2. Client-side WebRTC for microphone access
3. Speech-to-Text (Whisper API or local Vosk)
4. Text-to-Speech (existing TTS module)
5. Voice activity detection (VAD) to know when the user stops talking

**Effort: ~3 days**

---

## Phase 32 Schedule

| Week | Priority | Deliverable |
|------|----------|--------------|
| 1 | P1.1-P1.4 | Sidebar + BentoGrid + Vision UI + Chat SSE UI + Approval Panel |
| 2 | P1.5-P1.9 | Contract E-Sign UI + Audit Log Viewer + Memory Dashboard + Swarm Topology + Dark Mode |
| 3 | P2.1-P2.3 | Video + PDF Ingestion + Native LLM Streaming |
| 4 | P3.1-P3.2 | Agent Specialization + Visual Swarm Topology |
| 5 | P3.3 + P4.1 | Dynamic API Synthesizer + Automated Dunning |
| 6 | P5.1-P5.2 | React Native Mobile App + WebRTC Voice Bridge |

**Total effort: ~6 weeks** (can be parallelized to ~4 weeks with 2 devs)

---

## Definition of Done (Phase 32)

1. ✅ UI migration complete — all 15 tabs in new layout, dark mode works, mobile responsive
2. ✅ Vision upload UI accepts images + returns analysis with code generation
3. ✅ Chat tab streams tokens via native LLM streaming (not simulated)
4. ✅ Approval conversation panel renders in dashboard
5. ✅ Contract e-sign status visible + actionable from dashboard
6. ✅ Audit log viewer shows filterable entries + CSV export
7. ✅ Memory chart + leak analysis widget in System Health tab
8. ✅ Swarm topology visualizer shows agents + message flow
9. ✅ Video ingestion accepts MP4/WebM + analyzes key frames
10. ✅ PDF ingestion extracts text + images per page
11. ✅ Native LLM streaming (Z-AI + Groq + Ollama `stream: true`)
12. ✅ Agent specialization (per-role models + system prompts)
13. ✅ Dynamic API Synthesizer writes Puppeteer scrapers on API failure
14. ✅ Automated dunning sends payment plan offers via email/SMS
15. ✅ React Native mobile app for on-the-go approvals
16. ✅ WebRTC voice bridge for real-time voice calls
17. ✅ `bunx tsc --noEmit` → 0 errors
18. ✅ `bun test` → 320+ pass / 0 fail
19. ✅ `bun run build` → succeeds + verify-all-phases passes 80+/80+
20. ✅ Production Readiness Certificate updated → 9.9+/10

---

## Phase 32 → Phase 33 Transition

Once Phase 32 is complete, the platform is at true 9.9+/10 production readiness — matching or beating ChatGPT (UI + streaming), Gemini (multimodal), Perplexity (search), AutoGen (multi-agent), and Stripe Billing (financial compliance). Phase 33+ will focus on:

- **Marketplace launch** — public skill / agent / template marketplace (RULE-22 already supports this)
- **Franchisee onboarding** — self-serve signup + billing for new owners
- **Vertical integrations** — Slack/Teams/WhatsApp Business for owner notifications
- **Horizontal scaling** — Redis-backed cache, read replicas, multi-region deployment
- **AI upgrades** — GPT-5 / Claude 4 / Gemini 2 routing when released
- **Predictive OOM prevention** — ML model predicts OOM 5 min before it happens
- **Interactive Code/Document Canvas** — real-time collaborative editing (to beat ChatGPT Canvas)
