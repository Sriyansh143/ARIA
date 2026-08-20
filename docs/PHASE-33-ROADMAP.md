# ARIA Mission Control — Phase 33 Roadmap

**Previous:** Phase 32 (UI Overhaul: Swarm Visualizer + Chat + Vision + Sidebar) → v82.0.0 — 9.9/10
**Current Target:** Phase 33 → v83.0.0

---

## Phase 33 Strategic Goals

Phase 32 brought the platform to 9.9/10 production readiness by closing the UI/UX gap (6.5 → 9.0). The only remaining gaps are next-gen multimodal (video/PDF), native LLM streaming, and mobile. Phase 33 closes these to reach true 10/10.

### Scoring Targets

| Category | Current (v82) | Target (v83) |
|---|---|---|
| Conversational & Context | 9.0/10 | 9.8/10 (native LLM streaming + interactive canvas) |
| Vision & Multimodal | 8.5/10 | 9.5/10 (video + PDF ingestion) |
| UI/UX Polish | 9.0/10 | 9.7/10 (mobile responsive + canvas + orphaned widget cleanup) |
| Owner Approval UX | 9.8/10 | 10/10 (mobile app) |
| Overall Production Readiness | 9.9/10 | 10/10 |

---

## Priority 1: Next-Gen Multimodal (Beat Gemini)

### 1.1 Video Ingestion Pipeline
- Add `ffmpeg` / `fluent-ffmpeg` for frame extraction
- Extend `/api/vision/ingest` to accept video files (max 100MB)
- Extract 1 frame per second → analyze each frame
- Synthesize a summary: "What happened in this video"
- Effort: ~2 days

### 1.2 PDF Ingestion Pipeline
- Add `pdf-parse` + `pdf-lib` dependencies
- Extend `/api/vision/ingest` to accept PDF files
- Extract text per page → LLM summarization
- Extract images per page → vision provider analysis
- Effort: ~1.5 days

### 1.3 Native LLM Streaming (Beat ChatGPT)
- Upgrade `callLLM` to accept `stream: true` option
- Z-AI: `zai.chat.completions.create({ stream: true })` → async iterator
- Groq: OpenAI SDK with `stream: true`
- Ollama: `ollama.generate({ stream: true })` → NDJSON stream
- Update `/api/chat/stream` to pipe native stream directly
- Effort: ~2 days

---

## Priority 2: Mobile + Voice

### 2.1 React Native Mobile App
- Initialize React Native (Expo) project
- Push notifications (FCM + APNs)
- Approval list view + swipe-to-approve/deny
- Chat interface (using SSE streaming endpoint)
- Vision upload (camera + photo library)
- Effort: ~5 days

### 2.2 WebRTC Voice Bridge
- WebSocket server (`ws` library, separate from Next.js)
- Client-side WebRTC for microphone access
- Speech-to-Text (Whisper API or local Vosk)
- Text-to-Speech (existing TTS module)
- Voice activity detection (VAD)
- Effort: ~3 days

---

## Priority 3: Financial & Agent Polish

### 3.1 Dynamic API Synthesizer (Beat Zapier)
- New module `src/lib/dynamic-api-synthesizer.ts`
- Input: failed API endpoint URL + expected response shape
- Output: Puppeteer scraper script
- Cache synthesized scrapers in `CodeArchive`
- Effort: ~3 days

### 3.2 Automated Dunning & Predictive Churn
- New cron `daily-dunning` — scans failed payments
- LLM generates personalized dunning email offering payment plan
- Send via Resend + Twilio
- Track response → if customer agrees, create new ServiceOrder
- Effort: ~2 days

### 3.3 Agent Specialization
- Per-role system prompt templates
- Configure LLM router per role (Marketer → GLM-4, Coder → DeepSeek-Coder, etc.)
- Per-role token budgets + cost tracking
- Effort: ~2 days

---

## Priority 4: UI Polish + Compliance

### 4.1 Mobile Responsive Testing
- Test all 15 tabs at 375px breakpoint
- Fix horizontal scroll issues
- Verify sidebar collapses to icons
- Effort: ~1 day

### 4.2 Wire Orphaned SystemHealthWidget
- Either delete `system-health-widget.tsx` or wire to real `/api/health`
- Create per-service routes if needed (`/api/health/{zai,ollama,...}`)
- Effort: ~0.5 days

### 4.3 SOC 2 Type II Preparation
- Document all audit log call sites
- Document data retention policies
- Document access controls (RBAC matrix)
- Engage external auditor
- Effort: ~1 day (code) + 4-8 weeks (audit)

### 4.4 Interactive Code/Document Canvas
- Real-time collaborative editing (like ChatGPT Canvas)
- Use Yjs or similar CRDT library
- Wire to contract + code generation flows
- Effort: ~5 days

---

## Phase 33 Schedule

| Week | Priority | Deliverable |
|------|----------|--------------|
| 1 | P1.1-P1.3 | Video + PDF Ingestion + Native LLM Streaming |
| 2 | P2.1 | React Native Mobile App (approval + chat) |
| 3 | P2.2 + P3.3 | WebRTC Voice Bridge + Agent Specialization |
| 4 | P3.1 + P3.2 | Dynamic API Synthesizer + Automated Dunning |
| 5 | P4.1-P4.3 | Mobile Testing + Widget Cleanup + SOC 2 Prep |
| 6 | P4.4 | Interactive Code/Document Canvas |

**Total effort: ~6 weeks**

---

## Definition of Done (Phase 33)

1. ✅ Video ingestion accepts MP4/WebM + analyzes key frames
2. ✅ PDF ingestion extracts text + images per page
3. ✅ Native LLM streaming (Z-AI + Groq + Ollama `stream: true`)
4. ✅ React Native mobile app for on-the-go approvals
5. ✅ WebRTC voice bridge for real-time voice calls
6. ✅ Dynamic API Synthesizer writes Puppeteer scrapers on API failure
7. ✅ Automated dunning sends payment plan offers via email/SMS
8. ✅ Agent specialization (per-role models + system prompts)
9. ✅ Mobile responsive at 375px breakpoint
10. ✅ Orphaned SystemHealthWidget wired or deleted
11. ✅ Interactive Code/Document Canvas
12. ✅ SOC 2 Type II documentation ready
13. ✅ `bunx tsc --noEmit` → 0 errors
14. ✅ `bun test` → 340+ pass / 0 fail
15. ✅ `bun run build` → succeeds + verify-all-phases passes 85+/85+
16. ✅ Production Readiness Certificate → 10/10

---

## Phase 33 → Phase 34 Transition

Once Phase 33 is complete, the platform is at true 10/10 production readiness. Phase 34+ will focus on:
- **Marketplace launch** — public skill/agent/template marketplace
- **Franchisee onboarding** — self-serve signup + billing
- **Vertical integrations** — Slack/Teams/WhatsApp Business
- **Horizontal scaling** — Redis cache, read replicas, multi-region
- **AI upgrades** — GPT-5 / Claude 4 / Gemini 2 routing
- **Predictive OOM prevention** — ML model predicts OOM 5 min before
