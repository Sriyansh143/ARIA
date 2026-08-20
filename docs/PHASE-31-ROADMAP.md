# ARIA Mission Control — Phase 31 Roadmap

**Previous:** Phase 30 (Enterprise Hardening: E-Sign + Stripe + Memory) → v80.0.0 — 9.5/10
**Current Target:** Phase 31 → v81.0.0

---

## Phase 31 Strategic Goals

Phase 30 brought the platform to 9.5/10 production readiness with contract e-signatures, Stripe reconciliation, tax calculation, and memory observability. Phase 31 closes the remaining gaps to reach 9.7+/10 — primarily UI/UX polish + dashboard integration of the new Phase 29/30 backend capabilities.

### Scoring Targets

| Category | Current (v80) | Target (v81) |
|---|---|---|
| Owner Approval UX | 9.6/10 | 9.8/10 (conversation rendering in dashboard) |
| MNC Capability Gaps | 9.0/10 | 9.5/10 (3 remaining Z-AI calls + 1-hour soak) |
| Audit + Compliance | 9.8/10 | 10/10 (audit log viewer UI) |
| UI/UX Polish | 6.5/10 | 8.5/10 (sidebar + bento grid + dark mode + mobile) |
| Operational Hardening | 9.5/10 | 9.8/10 (live voice test + production soak) |
| Overall Production Readiness | 9.5/10 | 9.7+/10 |

---

## Priority 1: Dashboard UI Migration

### Goal
Migrate the dashboard from the legacy 15-tab layout to a modern sidebar + bento grid design. Render all Phase 29/30 backend capabilities (approval conversations, audit log, contract e-sign status, memory chart, reconciliation) in the dashboard.

### Tasks

#### 1.1 Sidebar + BentoGrid Migration
- Replace top tab nav with collapsible `AppSidebar` (already in `src/components/dashboard/`)
- Migrate Overview tab to responsive `BentoGrid` (KPI cards, alerts, recent approvals, revenue chart, system health)
- Wire `SkeletonLoader` to all async data fetches
- Wrap each tab in `ErrorBoundary` so one tab's crash doesn't kill the dashboard
- Mobile breakpoint (375px) — test + fix all 15 tabs without horizontal scroll

#### 1.2 Approval Conversation Panel
- New side panel that opens when an approval card is clicked
- Renders the conversation thread (questions, answers, suggestions, revisions) from `/api/approvals/[id]/conversation`
- Lets the owner type a new message directly (POST to `/api/approvals/[id]/discuss`)
- Shows the inline keyboard state (Approve / Deny / Ask / Suggest buttons)

#### 1.3 Contract E-Sign Status Panel
- New tab "Contracts" with:
  - List of contracts (status, client, amount, esign provider, esign status)
  - "Send for E-Signature" button (POST to `/api/contracts` with `esignProvider` + `sendNow: true`)
  - Per-contract detail view showing the esign events timeline (from `esignEventsJson`)
  - "Resend" / "Void" actions (PATCH to `/api/contracts/[id]`)

#### 1.4 Audit Log Viewer
- New tab "Audit Log" with:
  - Filterable table (actor, resource, action, date range)
  - Read-only — no edit/delete
  - CSV export button
  - Search by resource id

#### 1.5 Memory + Reconciliation Dashboard
- New "System Health" tab with:
  - Live RSS chart (from `/api/system-memory`)
  - Heap chart (heapUsed / heapTotal over time)
  - Leak analysis widget (current slope + R²)
  - Stripe reconciliation summary (matched / discrepancies / total)
  - Discrepancy list with "Investigate" links

#### 1.6 Dark Mode + Theme Provider
- `next-themes` integration
- Warm dark palette (dark navy #0F172A + amber accent #F59E0B)
- Toggle persists in localStorage

### Acceptance Criteria
- All 15 tabs render correctly in the new layout
- Dark mode toggles persist
- Mobile breakpoint (375px) renders without horizontal scroll
- Approval conversation panel renders the thread + accepts new messages
- Audit log viewer shows the last 100 entries with filters
- Contract e-sign status visible + actionable from dashboard
- Memory chart renders 24h of data + leak analysis
- 0 TypeScript errors, all existing tests pass

### Effort: ~4 days

---

## Priority 2: Remaining Z-AI Calls Cleanup

### Goal
Replace 3 remaining direct Z-AI calls with the unified `webSearchWithFallback` wrapper (from Phase 28).

### Tasks
1. `src/lib/competitor-analyzer.ts` — replace direct Z-AI call
2. `src/lib/services/service-researcher.ts` — replace direct Z-AI call
3. `src/lib/services/earning-method-researcher.ts` — replace direct Z-AI call
4. Add owner notification on failure (already in the wrapper)
5. Update tests to verify the fallback path

### Acceptance Criteria
- 0 direct Z-AI calls remaining (grep `zai.webSearch` in `src/lib/` returns 0)
- All 3 modules use `webSearchWithFallback`
- Tests pass

### Effort: ~0.5 days

---

## Priority 3: Operational Hardening (Production)

### 3.1 Live Voice Call Test
**Current:** Voice/Pipecat pipeline is code-complete but untested with a real SIP trunk.

**Tasks:**
1. Deploy `docker-compose.free.yml` on Oracle VM
2. Configure SIP trunk (Twilio/Bandwidth/Vonage)
3. Run 30-minute test call — verify TTS, STT, LLM, DTMF all work
4. Record call metrics: latency, drop rate, audio quality
5. Update `docs/DEPLOYMENT-GUIDE.md` with working config

### Effort: ~2 days (mostly ops, not code)

### 3.2 1-Hour Soak Test (Production)
**Current:** The daily-soak-analysis cron is ready but no production data exists yet.

**Tasks:**
1. Use `scripts/multi-tenant-load-test.ts` as a starting point — extend with 1-hour mode
2. Monitor RSS every 5 minutes — must stay below 8 GB
3. Monitor error rate — must stay below 1%
4. Monitor p95 latency — must stay below 500ms
5. Report findings in `docs/SOAK-TEST-RESULTS.md`

### Effort: ~1 day

### 3.3 Memory Dashboard Widget
**Current:** Memory data is accessible via `/api/system-memory` but no UI exists.

**Tasks:**
1. Add a live RSS chart to the System Health tab (covered in P1.5)
2. Add a "Top 5 Modules by Memory" widget (when leak is detected)
3. Add a "Memory Threshold" config UI (let owner set warn/critical percentages)

### Effort: ~0.5 days

### 3.4 Multi-Tenant Load Test (Production)
**Current:** Script exists but untested on production.

**Tasks:**
1. Run `bun run scripts/multi-tenant-load-test.ts --owners=50 --workflows=20 --duration=300`
2. Verify p95 < 100ms, no leaks, no errors
3. Report findings in `docs/MULTI-TENANT-LOAD-TEST.md`

### Effort: ~0.5 days

---

## Priority 4: Polish + Documentation

### 4.1 Contract E-Sign UI Polish
- Add provider selector (DocuSign / HelloSign / Mock) to the contract creation form
- Show provider-specific signing URL (for HelloSign embedded signing)
- Add "Void Envelope" action (POST to provider's void API)

### 4.2 Tax Configuration UI
- Country/state selector with auto-tax-rate preview
- "Test Tax Calculation" button (dry-run on $100)
- Tax rate table editor (override static fallback rates)

### 4.3 Operator Runbook
- Step-by-step runbook for:
  - How to approve a high-risk spend via Telegram
  - How to handle a GDPR erasure request
  - How to roll back a bad deployment (CodeArchive)
  - How to add a new owner workspace
  - How to debug a failing cron job
  - How to investigate a Stripe reconciliation discrepancy
  - How to respond to a memory leak alert

### 4.4 API Documentation (OpenAPI)
- Auto-generate OpenAPI 3.1 spec from Next.js route handlers
- Serve Swagger UI at `/api/docs`
- Add request/response examples for critical endpoints

### Effort: ~2 days total

---

## Phase 31 Schedule

| Week | Priority | Deliverable |
|------|----------|--------------|
| 1 | P1.1-P1.3 | Sidebar + BentoGrid + Approval Conversation Panel + Contract E-Sign Status |
| 2 | P1.4-P1.6 + P2 | Audit Log Viewer + Memory Dashboard + Dark Mode + Z-AI cleanup |
| 3 | P3.1-P3.2 | Live Voice Test + 1-Hour Soak Test (production) |
| 4 | P3.3-P3.4 + P4 | Multi-Tenant Load Test + Runbook + OpenAPI |

**Total effort: ~4 weeks** (can be parallelized to ~3 weeks with 2 devs)

---

## Definition of Done (Phase 31)

1. ✅ UI migration complete — all 15 tabs in new layout, dark mode works, mobile responsive
2. ✅ Approval conversation panel renders in dashboard
3. ✅ Contract e-sign status visible + actionable from dashboard
4. ✅ Audit log viewer shows filterable entries
5. ✅ Memory chart + leak analysis widget in System Health tab
6. ✅ Stripe reconciliation summary + discrepancy list in dashboard
7. ✅ 3 remaining Z-AI calls routed through fallback wrapper
8. ✅ Live voice call test passes (30 min, no drops, audio quality > 4/5)
9. ✅ 1-hour soak test passes (RSS < 8 GB, errors < 1%, p95 < 500ms)
10. ✅ Multi-tenant load test passes (50 owners × 20 workflows, no leaks, p95 < 100ms)
11. ✅ Operator runbook complete
12. ✅ OpenAPI spec published at `/api/docs`
13. ✅ `bunx tsc --noEmit` → 0 errors
14. ✅ `bun test` → 290+ pass / 0 fail
15. ✅ `bun run build` → succeeds + verify-all-phases passes 70+/70+
16. ✅ Production Readiness Certificate updated → 9.7+/10

---

## Phase 31 → Phase 32 Transition

Once Phase 31 is complete, the platform is at true 9.7+/10 production readiness. Phase 32+ will focus on:

- **Vertical integrations** — Slack/Teams/WhatsApp Business for owner notifications beyond Telegram
- **Horizontal scaling** — Redis-backed cache, read replicas, multi-region deployment
- **AI upgrades** — GPT-5 / Claude 4 / Gemini 2 routing when released
- **Marketplace** — Public skill / agent / template marketplace (RULE-22 already supports this)
- **Franchisee onboarding** — Self-serve signup + billing for new owners
- **Mobile app** — React Native companion app for owner approvals on the go
- **Contract amendments** — Addendum flow (the schema supports `contractType: "addendum"` but no UI)
- **Subscription billing** — Stripe Subscriptions for recurring revenue (currently one-shot only)
- **Multi-currency storage** — Store amounts in their original currency (currently USD-only at the storage layer, even though the converter supports 10 currencies)
