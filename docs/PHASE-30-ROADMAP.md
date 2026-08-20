# ARIA Mission Control — Phase 30 Roadmap

**Previous:** Phase 29 (Telegram-FIRST Owner Approval + MNC Gap Fixes) → v79.0.0 — 9.2/10
**Current Target:** Phase 30 → v80.0.0

---

## Phase 30 Strategic Goals

Phase 29 brought the platform to 9.2/10 production readiness with Telegram-first owner approval, comprehensive audit logging, multi-currency support, and GDPR compliance. Phase 30 closes the remaining gaps to reach true 9.5+/10 MNC equivalence.

### Scoring Targets

| Category | Current (v79) | Target (v80) |
|---|---|---|
| Owner Approval UX | 9.6/10 | 9.8/10 (UI migration + conversation rendering in dashboard) |
| MNC Capability Gaps | 8.0/10 | 9.0/10 (contract e-sign + payment reconciliation + tax) |
| Audit + Compliance | 9.7/10 | 10/10 (memory watchdog + load testing) |
| UI/UX Polish | 6.5/10 | 8.5/10 (sidebar + bento grid + dark mode + mobile) |
| Overall Production Readiness | 9.2/10 | 9.5+/10 |

---

## Priority 1: UI Migration + Conversation Rendering

### Goal
Migrate the dashboard from the legacy 15-tab layout to a modern sidebar + bento grid design. Render the new ApprovalConversation thread in the dashboard approval panel.

### Tasks
1. **AppSidebar integration** — Replace the top tab nav with a collapsible left sidebar (already created in `src/components/dashboard/`). Wire to existing routes.
2. **BentoGrid layout** — Migrate the Overview tab to a responsive bento grid (cards for KPIs, alerts, recent approvals, revenue chart, system health).
3. **SkeletonLoader** — Add loading skeletons for all async data fetches (currently shows nothing during load).
4. **ErrorBoundary** — Wrap each tab in an ErrorBoundary so one tab's crash doesn't kill the dashboard.
5. **Dark Mode** — Theme provider + warm dark palette (dark navy + amber accent).
6. **Mobile Responsive** — Test + fix all 15 tabs at mobile breakpoints.
7. **ApprovalConversation Panel** — New side panel that opens when an approval card is clicked. Shows the conversation thread (questions, answers, suggestions, revisions) + lets the owner type a new message directly.
8. **Audit Log Viewer** — New tab showing the AuditLogEntry table with filters (actor, resource, action, date range). Read-only.

### Acceptance Criteria
- All 15 tabs render correctly in the new layout
- Dark mode toggles persist in localStorage
- Mobile breakpoint (375px) renders all tabs without horizontal scroll
- Approval conversation panel renders the thread + accepts new messages
- Audit log viewer shows the last 100 entries with filters
- 0 TypeScript errors, all existing tests pass

### Effort: ~3 days

---

## Priority 2: MNC Capability Gaps (Remaining)

### 2.1 Contract E-Signature (DocuSign/HelloSign)

**Current:** Reply-to-sign only — client replies "I agree" to the contract email + the system marks it signed.

**Target:** Add real e-signature integration via DocuSign or HelloSign. The owner picks the provider in `.env` (`DOCUSIGN_API_KEY` or `HELLOSIGN_API_KEY`), and contracts are sent for signature with a legally binding audit trail.

**Tasks:**
1. Add `EsignProvider` abstraction in `src/lib/legal/esign-provider.ts`
2. Implement `DocuSignProvider` + `HelloSignProvider` (both have free tiers)
3. Add `Contract.signedAt` + `Contract.signatureProvider` + `Contract.signatureId` fields
4. Wire `/api/contracts/[id]/send-for-signature` endpoint
5. Add webhook handler for signature status callbacks
6. Update the contract generator to optionally send for signature after PDF generation
7. Tests: mock both providers + verify the contract status transitions

**Acceptance Criteria:**
- Owner can configure either DocuSign or HelloSign via `.env`
- Contracts can be sent for signature with one click
- Signature status updates flow back to the dashboard via webhook
- Audit log entry created when contract is sent + when signed
- Fallback: reply-to-sign still works if neither provider is configured

**Effort: ~2 days**

### 2.2 Payment Reconciliation (Stripe Webhook)

**Current:** Stripe webhooks are acknowledged but not reconciled against ledger entries.

**Target:** Automated reconciliation — every Stripe `payment_intent.succeeded` webhook creates a matching `LedgerEntry` row + verifies the amount matches the related `ServiceOrder.amount`.

**Tasks:**
1. Add `StripeReconciliation` model (records webhook event_id + matched ledger_entry_id + service_order_id)
2. Extend the existing Stripe webhook handler at `/api/stripe/webhook`
3. Idempotency: skip if event_id already reconciled
4. Auto-create `RevenueEvent` + `LedgerEntry` (credit to Revenue, debit to Cash)
5. If amounts don't match, create a `SystemAlert` for manual review
6. Tests: simulate webhook events + verify ledger stays balanced

**Acceptance Criteria:**
- Every successful Stripe payment creates matching ledger entries
- Duplicate webhook events are deduplicated (idempotency key = event_id)
- Amount mismatches fire SystemAlert
- Ledger remains balanced after reconciliation

**Effort: ~1.5 days**

### 2.3 Tax Calculation (Stripe Tax API)

**Current:** No tax calculation. The `amount` field on ServiceOrder/Approval is pre-tax.

**Target:** Add Stripe Tax integration to calculate tax based on the customer's location. The tax line item appears on the contract + is collected via Stripe.

**Tasks:**
1. Add `TaxCalculation` model (records tax_amount, tax_rate, jurisdiction, stripe_calculation_id)
2. Add `src/lib/finance/tax-calculator.ts` with `calculateTax(amount, customerLocation)` function
3. Wire into contract generation: contract shows subtotal + tax + total
4. Wire into approval flow: spend approvals show pre-tax + tax + total
5. Wire into Stripe checkout: tax is collected at payment time
6. Tests: mock Stripe Tax API + verify tax is calculated correctly for US/EU/IN jurisdictions

**Acceptance Criteria:**
- Tax calculated automatically based on customer's billing address
- Contract PDF shows subtotal, tax line, and total
- Stripe checkout includes tax
- Tax records persisted for accounting

**Effort: ~1.5 days**

---

## Priority 3: Operational Hardening

### 3.1 Memory Watchdog Cron

**Current:** `scripts/check-resource-usage.ts` runs once during setup. No ongoing monitoring.

**Target:** 5-minute cron job that checks RSS + sends a Telegram alert if RSS > 80% of the threshold (19.2 GB on the 24 GB Oracle VM).

**Tasks:**
1. Add `memory-watchdog` cron job (every 5 minutes)
2. Uses `process.memoryUsage().rss` to check current usage
3. If RSS > 80% threshold, sends Telegram alert with current usage + top 5 modules by memory
4. If RSS > 95% threshold, triggers `setAutonomyPausedWithReason("memory-pressure")` (kill switch)
5. Logs to AgentLog for historical analysis
6. Tests: mock memory usage + verify alert + kill switch behavior

**Effort: ~0.5 days**

### 3.2 Remaining Z-AI Calls

**Current:** 3 modules still call Z-AI directly instead of going through the unified `webSearchWithFallback` wrapper:
- `competitor-analyzer.ts`
- `service-researcher.ts`
- `earning-method-researcher.ts`

**Tasks:**
1. Replace direct Z-AI calls with `webSearchWithFallback` (already exists)
2. Add owner notification on failure (already in the wrapper)
3. Update tests to verify the fallback path

**Effort: ~0.5 days**

### 3.3 Live Voice Call Test

**Current:** Voice/Pipecat pipeline is code-complete but untested with a real SIP trunk.

**Target:** Deploy Docker + FreeSWITCH on Oracle VM + run a 30-minute live call test.

**Tasks:**
1. Deploy the existing `docker-compose.free.yml` on Oracle VM
2. Configure SIP trunk (Twilio/Bandwidth/Vonage)
3. Run a 30-minute test call — verify TTS, STT, LLM, and DTMF all work
4. Record call metrics: latency, drop rate, audio quality
5. Update `docs/DEPLOYMENT-GUIDE.md` with the working config

**Effort: ~2 days (mostly ops, not code)**

### 3.4 1-Hour Soak Test

**Current:** No soak testing done. Memory leaks + long-running stability unverified.

**Target:** Run the app for 1 hour under simulated load (100 concurrent users, 1000 API calls) + verify no memory leaks, no error rate increase.

**Tasks:**
1. Use `scripts/chaos-test.ts` as a starting point — extend with a 1-hour mode
2. Monitor RSS every 5 minutes — must stay below 8 GB
3. Monitor error rate — must stay below 1%
4. Monitor p95 latency — must stay below 500ms
5. Report findings in `docs/SOAK-TEST-RESULTS.md`

**Effort: ~1 day**

### 3.5 Multi-Tenant Load Testing

**Current:** Multi-owner isolation is unit-tested but not load-tested.

**Target:** Simulate 10 concurrent owners, each running 10 workflows, for 30 minutes. Verify no cross-owner data leaks + performance stays within SLO.

**Tasks:**
1. Create `scripts/multi-tenant-load-test.ts`
2. Spin up 10 simulated owners via `registerOwnerWorkspace`
3. Each owner runs 10 workflows concurrently
4. Verify data isolation: `verifyDataIsolation` returns true for every owner
5. Measure per-owner DB query latency — must stay below 100ms p95
6. Report findings in `docs/MULTI-TENANT-LOAD-TEST.md`

**Effort: ~1 day**

---

## Priority 4: Polish + Documentation

### 4.1 API Documentation (OpenAPI)

**Current:** API routes are documented in code comments but no OpenAPI spec exists.

**Target:** Auto-generate OpenAPI 3.1 spec from the Next.js route handlers + serve at `/api/docs`.

**Tasks:**
1. Use `nextjs-openapi` or similar to extract route metadata
2. Generate `openapi.json` during build
3. Serve Swagger UI at `/api/docs`
4. Add request/response examples for critical endpoints (approvals, contracts, payments)

**Effort: ~1 day**

### 4.2 Postman Collection

**Target:** Curated Postman collection covering all critical flows (lead → outreach → contract → payment → ledger).

**Effort: ~0.5 days**

### 4.3 Operator Runbook

**Target:** Step-by-step runbook for common operator tasks:
- How to approve a high-risk spend
- How to handle a GDPR erasure request
- How to roll back a bad deployment (CodeArchive)
- How to add a new owner workspace
- How to debug a failing cron job

**Effort: ~1 day**

---

## Phase 30 Schedule

| Week | Priority | Deliverable |
|------|----------|--------------|
| 1 | P1 (UI Migration) | Sidebar + BentoGrid + Dark Mode + Approval Conversation Panel |
| 2 | P2.1 (Contract E-Sign) + P2.2 (Payment Reconciliation) | DocuSign/HelloSign + Stripe webhook reconciliation |
| 3 | P2.3 (Tax Calculation) + P3.1 (Memory Watchdog) + P3.2 (Z-AI cleanup) | Stripe Tax + monitoring + Z-AI cleanup |
| 4 | P3.3 (Voice Test) + P3.4 (Soak Test) + P3.5 (Multi-Tenant) | Live voice + 1h soak + multi-tenant load |
| 5 | P4 (Docs + Polish) | OpenAPI + Postman + Runbook |

**Total effort: ~5 weeks** (can be parallelized to ~3 weeks with 2 devs)

---

## Definition of Done (Phase 30)

1. ✅ UI migration complete — all 15 tabs in new layout, dark mode works, mobile responsive
2. ✅ Approval conversation panel renders in dashboard
3. ✅ Contract e-signature works (DocuSign or HelloSign)
4. ✅ Stripe webhook reconciliation automated (ledger stays balanced)
5. ✅ Tax calculation works for US/EU/IN
6. ✅ Memory watchdog active (5-min cron + Telegram alerts)
7. ✅ All 3 remaining Z-AI calls routed through fallback wrapper
8. ✅ Live voice call test passes (30 min, no drops, audio quality > 4/5)
9. ✅ 1-hour soak test passes (RSS < 8 GB, errors < 1%, p95 < 500ms)
10. ✅ Multi-tenant load test passes (10 owners × 10 workflows, no leaks, p95 < 100ms)
11. ✅ OpenAPI spec published at `/api/docs`
12. ✅ Postman collection curated
13. ✅ Operator runbook complete
14. ✅ `bunx tsc --noEmit` → 0 errors
15. ✅ `bun test` → 240+ pass / 0 fail
16. ✅ `bun run build` → succeeds + verify-all-phases passes 60+/60+
17. ✅ Production Readiness Certificate updated → 9.5+/10

---

## Phase 30 → Phase 31 Transition

Once Phase 30 is complete, the platform is at true 9.5+/10 production readiness. Phase 31+ will focus on:

- **Vertical integrations** — Slack/Teams/WhatsApp Business for owner notifications beyond Telegram
- **Horizontal scaling** — Redis-backed cache, read replicas, multi-region deployment
- **AI upgrades** — GPT-5 / Claude 4 / Gemini 2 routing when released
- **Marketplace** — Public skill / agent / template marketplace (RULE-22 already supports this)
- **Franchisee onboarding** — Self-serve signup + billing for new owners (currently manual)
- **Mobile app** — React Native companion app for owner approvals on the go
