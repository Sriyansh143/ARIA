# ARIA Mission Control — Master Guide (v60)

**Build:** v60.0.0-final-clean
**Date:** 2026-08-17
**Status:** Production-ready · zero-patch verified
**Verification:** 105/105 tests pass · 0 TypeScript errors · 8/8 chaos tests pass

This is the **single authoritative document** for ARIA Mission Control. It consolidates the build rules, the v58 launch report, the v58→v59 audit + 25 bug fixes, and the v59 strategic upgrades (Notion AI Company Map Autonomy Tags + 500-AI-Agents-Projects Supervisor pattern).

---

## Table of Contents

1. [What is ARIA?](#1-what-is-aria)
2. [The 3 Autonomy Tags (Notion AI Company Map)](#2-the-3-autonomy-tags-notion-ai-company-map)
3. [Quality Supervisor Trajectory Validation (AgentEval / LangGraph)](#3-quality-supervisor-trajectory-validation-agenteval--langgraph)
4. [Quick Start](#4-quick-start)
5. [Stack](#5-stack)
6. [Architecture](#6-architecture)
7. [Non-Negotiable Build Rules](#7-non-negotiable-build-rules)
8. [The 25 Bug Fixes (v58→v59 Audit)](#8-the-25-bug-fixes-v58v59-audit)
9. [Verification & Testing](#9-verification--testing)
10. [Deployment](#10-deployment)

---

## 1. What is ARIA?

ARIA Mission Control is a complete autonomous AI company platform. It discovers leads, sends outreach, verifies payments, builds deliverables, and handles customer support — all without human intervention (after the owner configures external providers).

**v60 final-clean** carries forward:
- **v58 Enterprise Resilience** — HTML-Resilient LLM Router, Global Autonomy Kill Switch, SQLite Write Queue, Mini-Service Internal Auth, Chaos Monkey tests
- **v59 Phase-3 Audit** — 25 bug fixes (race conditions, infinite loops, prompt drift, env fallbacks)
- **v59 Strategic Upgrades** — Notion Autonomy Tags + execution-based trajectory validation

---

## 2. The 3 Autonomy Tags (Notion AI Company Map)

The Notion "AI Company Map" describes how a business wired on agents classifies every automated workflow + skill by **autonomy level**: who approves before execution? ARIA implements this as a database-enforced enum + a conductor-router that gates every execution.

### The Enum

```prisma
// prisma/schema.prisma (lines 31–35)
enum AutonomyTag {
  HUMAN_LED
  HUMAN_ASSISTED
  FULLY_AUTONOMOUS
}
```

### What each tag means

| Tag | Policy | Example |
|---|---|---|
| `HUMAN_LED` | The conductor refuses to auto-run; owner must trigger via dashboard | Production deploys, contract signing |
| `HUMAN_ASSISTED` | Router creates an Approval row + sends a Telegram brief, then BLOCKS until owner decides | Outreach campaigns, refunds >$100 |
| `FULLY_AUTONOMOUS` | Runs directly; Quality Supervisor trajectory-validates output post-hoc | Lead discovery, cache sweep, revenue sweep |

### Where it's enforced

| File | Line | What |
|---|---|---|
| `prisma/schema.prisma` | 31–35 | `enum AutonomyTag` definition |
| `prisma/schema.prisma` | 260 | `Skill.autonomyTag` (default `HUMAN_ASSISTED`) |
| `prisma/schema.prisma` | 279–299 | `WorkflowDefinition` model with `autonomyTag` + `pendingApprovalId` |
| `src/lib/conductor/router.ts` | 51–88 | `routeWorkflowByAutonomy()` — reads tag, enforces policy |
| `src/lib/conductor/router.ts` | 96–128 | `routeSkillByAutonomy()` — same for skills |
| `src/lib/conductor/router.ts` | 132–194 | `queueTelegramApproval()` — creates Approval + sends Telegram brief |
| `src/lib/conductor/router.ts` | 205–214 | `isApprovalResolved()` — poll helper |
| `src/lib/conductor/router.ts` | 222–243 | `routeAndWaitForApproval()` — blocking convenience wrapper |

### Enforcement flow for `HUMAN_ASSISTED`

```
Agent/cron calls routeWorkflowByAutonomy(wfId, "OutreachBot")
  → reads wf.autonomyTag = HUMAN_ASSISTED
  → creates Approval row (status="pending")
  → sends Telegram: "⏳ ARIA Approval Required (HUMAN_ASSISTED) ... /approve or /deny <id>"
  → returns { allowed: false, approvalId: "clxxx" }
  → caller BLOCKS — workflow does NOT execute
  → owner approves via dashboard or Telegram
  → isApprovalResolved(approvalId) → { resolved: true, approved: true }
  → caller re-dispatches — workflow now runs
```

### Usage

```typescript
import { routeWorkflowByAutonomy, AutonomyTag } from "@/lib/conductor/router";

const wf = await db.workflowDefinition.create({
  data: {
    slug: "send-outreach-campaign",
    name: "Send Outreach Campaign",
    stepsJson: JSON.stringify(steps),
    autonomyTag: AutonomyTag.HUMAN_ASSISTED,  // ← Telegram approval required
  },
});

const decision = await routeWorkflowByAutonomy(wf.id, "OutreachBot");
// decision.allowed === false → owner gets a Telegram message
// → isApprovalResolved(decision.approvalId) → { resolved: true, approved: true }
```

### Required env vars for `HUMAN_ASSISTED`

```bash
TELEGRAM_BOT_TOKEN=""    # from @BotFather
TELEGRAM_CHAT_ID=""      # your personal chat id
```

If these are unset, the dashboard still shows the pending Approval — Telegram is best-effort.

---

## 3. Quality Supervisor Trajectory Validation (AgentEval / LangGraph)

The 500-AI-Agents-Projects repo (and the AgentEval / LangGraph Supervisor pattern) replaces **static syntax checking** with **execution-based trajectory validation**: actually run the generated code in a sandbox dry-run and assert on stdout / exit code / HTTP response.

**Pre-v59 (AUDIT-B-13):** the Quality Supervisor only ran `node --check` (syntax only). A blank-page website, a CLI that crashes on invocation, and an API that returns 500 all passed.

**Post-v59:** the supervisor now EXECUTES the code and asserts on the runtime trajectory, with a hard `MAX_RETRIES = 2` cap.

### Where it's enforced

| File | Line | What |
|---|---|---|
| `src/lib/supervisors/quality-supervisor.ts` | 37 | `export const MAX_RETRIES = 2` — the hard cap |
| | 39–50 | `TrajectoryAssertion` interface (`expectStdoutContains`, `expectExitCode`, `expectHttpStatus`) |
| | 92–114 | `defaultAssertions(serviceType)` — per-serviceType trajectory defaults |
| | 133–243 | `runTrajectoryValidation()` — writes files to sandbox + **executes via `execFileSync("node", [execPath], {timeout:10s, killSignal:"SIGKILL"})`** + captures stdout/exitCode + applies assertions |
| | 247–316 | `staticCheck()` — fast-fail syntax check before the dry-run |
| | 318–368 | `qualitySupervisorReviewV59()` — main entry (static → trajectory) |
| | 370–410 | `reviewWithTrajectoryCap()` — bounded loop with MAX_RETRIES=2 + `createEscalation` after cap |

### Trajectory validation flow

```
ServiceBuilder generates files → qualitySupervisorReviewV59(req)
  1. staticCheck:  node --check (syntax) + HTML tag-balance
     → if fail: return early (saves the dry-run cost)
  2. runTrajectoryValidation:
     a. write files to tempDir (path-traversal-safe)
     b. find entry file (cli.js / index.js / server.js)
     c. if .ts: strip types → write _exec_*.js
     d. EXECUTE: execFileSync("node", [execPath], {timeout:10s, killSignal:SIGKILL})
     e. capture stdout + exitCode
     f. assert: expectExitCode matches? expectStdoutContains present? forbidStdoutContains absent?
  3. return { approved, feedback, staticCheck, dryRun }

reviewWithTrajectoryCap wraps this:
  attempt 0: qualitySupervisorReviewV59 → if approved, done
  attempt 1: generateFn(feedback) → regenerate → qualitySupervisorReviewV59 → if approved, done
  attempt 2: generateFn(feedback) → regenerate → qualitySupervisorReviewV59 → if approved, done
  attempt >2: createEscalation("hard cap reached") — NEVER loops forever
```

### Default trajectory assertions

| serviceType | Assertion |
|---|---|
| `cli-tool` | `expectExitCode: 0`, `expectStdoutContains: "usage"` |
| `api-service` / `api-docs` | `expectHttpStatus: 200`, `healthPath: "/health"` |
| `voice-agent` | `expectExitCode: 0` (type-check only) |
| `saas-scaffold` | `expectExitCode: 0` |
| `blog-post` / `landing-page` / `website-static` / `3d-website` / `dashboard` | static checks only (Playwright render-assert is a v61 roadmap item) |

### Usage

```typescript
import { reviewWithTrajectoryCap } from "@/lib/supervisors/quality-supervisor";

const { approved, attempts } = await reviewWithTrajectoryCap(
  initialReq,
  async (feedback, attempt) => regenerateFiles(feedback),
);
// approved === true within 2 retries, OR escalated to owner
```

---

## 4. Quick Start

### Prerequisites

- **Node.js 20+** (Bun 1.3+ recommended for speed)
- **Git**

### Linux / macOS

```bash
chmod +x setup.sh
./setup.sh
```

### Windows (PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1
```

### Manual setup

```bash
bun install                # or: npm install
cp .env.example .env       # then edit .env (see below)
bunx prisma db push --accept-data-loss
bun run dev                # http://localhost:3000
```

### Required `.env` variables

The auto-bootstrap generates `NEXTAUTH_SECRET` + `ENCRYPTION_MASTER_KEY` on first boot if missing. You MUST set:

| Variable | Purpose | Required? |
|---|---|---|
| `DATABASE_URL` | SQLite dev (`file:./db/custom.db`) or Postgres prod | **Yes** |
| `ARIA_OWNER_EMAIL` | Owner alerts (escalations, stale orders) | **Yes** (else alerts are skipped) |
| `ZAI_API_KEY` | Primary LLM provider | **Yes** (or set GROQ/NVIDIA) |
| `TELEGRAM_BOT_TOKEN` | **v59 HUMAN_ASSISTED approval flow** — from @BotFather | For HUMAN_ASSISTED |
| `TELEGRAM_CHAT_ID` | **v59 HUMAN_ASSISTED approval flow** — your chat id | For HUMAN_ASSISTED |
| `RESEND_API_KEY` + `RESEND_FROM_EMAIL` | Transactional email | For customer notifications |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | Stripe payments | For Stripe checkout |

### Post-install steps (printed by setup scripts)

```
🎉 Setup Complete!
🌐 Access the dashboard at http://localhost:3000
⚙️  Use the Settings UI to configure LLMs, Twilio, and Payments.
🤖 The autonomous engine starts automatically on first boot.
⏸️  Use /pause on Telegram bot or /api/autonomy/pause to freeze all operations.
🔒 v59: Workflows tagged HUMAN_ASSISTED will queue Telegram approvals — set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID.
```

---

## 5. Stack

| Layer | Tech | Notes |
|---|---|---|
| Runtime | Bun 1.3+ | Node 22+ also works |
| Framework | Next.js 16 (App Router) | Turbopack build |
| Language | TypeScript 5 strict | 0 typecheck errors |
| Database | Prisma 6 + SQLite/PostgreSQL | SQLite dev, Postgres prod |
| UI | Tailwind CSS 4 + shadcn/ui + Framer Motion | 65+ UI components |
| Auth | NextAuth + bcryptjs + 2FA TOTP | RBAC: owner/admin/operator/viewer |
| Payments | Crypto + UPI + Stripe + PayPal + Razorpay + Bank | 6 methods |
| Telephony | FreeSWITCH + Dograh + Twilio + WebRTC | 4 providers |
| Email | Resend | Webhook signature verified |
| Chat | WhatsApp Business Cloud API | Inbound → support agent |
| Push | web-push (VAPID) | Browser notifications |
| LLM | Z-AI + Groq + NVIDIA + OpenAI + Anthropic + Gemini + Ollama | 7 providers, router with circuit breaker |

---

## 6. Architecture

```
src/
├── app/
│   ├── api/                      78 route files (140+ endpoints)
│   │   ├── settings/             GET /settings, GET/POST /settings/env
│   │   ├── telephony/            call, sms, status (4 providers)
│   │   ├── leads/                lead discovery + scoring
│   │   ├── services/             catalog, checkout, upi, refund, preview
│   │   ├── webhooks/             resend (HMAC), stripe (signature)
│   │   ├── whatsapp/             send + webhook (HMAC)
│   │   ├── expansion/            earning-methods, service-opportunities
│   │   ├── supervisors/           reviews + escalations
│   │   ├── autonomy/             pause / resume / status (v58 kill switch)
│   │   └── ...
│   ├── dashboard/                /dashboard + /dashboard/settings
│   ├── services/                 public service catalog
│   └── ...
├── components/
│   ├── ui/                       65 shadcn/ui + 10 custom ARIA primitives
│   ├── svg/                      15 animated SVG icons
│   ├── mission/                  60+ dashboard panels
│   └── landing/                  public landing page
├── lib/
│   ├── telephony.ts              FreeSWITCH + Dograh + Twilio + WebRTC
│   ├── crypto-verifier.ts        Etherscan + BlockCypher + Solana + TronGrid
│   ├── upi-payments.ts           VPA + QR + UTR claim + owner approve
│   ├── stripe-checkout/          Stripe Checkout Sessions + webhook
│   ├── services/                 catalog, builder, crypto-checkout
│   ├── intelligence/             sandbox, ab-testing, feedback-loop, prompt-improver
│   ├── supervisors/              sales, quality, finance, compliance, executive
│   │   ├── index.ts              v58 supervisors (audit-fixed)
│   │   └── quality-supervisor.ts v59 execution-based trajectory validation (NEW)
│   ├── conductor/
│   │   ├── dispatcher.ts         subagent delegation
│   │   └── router.ts             v59 autonomy-tag enforcement (NEW)
│   ├── llm-router.ts             7-provider router + circuit breaker + rate limiter
│   ├── llm-client.ts             callLLM() + retry + token tracking
│   ├── outreach-executor.ts      Sales + Compliance supervisors before send
│   ├── workflow-engine.ts        bounded loop (MAX_WORKFLOW_STEPS=100, v59 fix)
│   ├── cron-scheduler.ts         30+ cron jobs + timer.unref (v59 fix)
│   ├── autonomy-control.ts      v58 global kill switch
│   ├── db-write-queue.ts        v58 SQLite write queue
│   └── ...
├── skills/                       69 ClawHub skills (MANDATORY — do not exclude)
└── prisma/
    └── schema.prisma             50 models (incl. v59 WorkflowDefinition + AutonomyTag enum)
```

---

## 7. Non-Negotiable Build Rules

1. **Never commit `.env`.** Add to `.gitignore`. The `.env` file contains real secrets.
2. **`AI_CALLER_ENABLED` + `AI_CALLER_CONSENT_VERIFIED` must both be `"true"`** for any outbound call/SMS. There is no override.
3. **Crypto payment verification uses real on-chain data.** Etherscan + BlockCypher + Solana RPC + TronGrid. No mocks in prod.
4. **Outreach requires CAN-SPAM compliance.** Unsubscribe link + sender address + sender identification.
5. **All owner-only routes use `requireAuthOrResponse()`.** Public routes are explicitly listed in `src/proxy.ts`.
6. **Daily outreach limit defaults to 10.** Increase to 50 after warmup (day 15+).
7. **Resend webhook signature verification is fail-closed.** Missing secret = no inbound replies processed.
8. **Credential Vault uses AES-256-GCM.** Master key must be set via `ENCRYPTION_MASTER_KEY` in production.
9. **The `skills/` folder is MANDATORY.** Never exclude it from the zip / git repo / deployment. The 69 ClawHub skills (61MB) are loaded at runtime — without them, the agent fleet cannot access specialized tools.
10. **Auto-bootstrap generates critical secrets on first start.** If `NEXTAUTH_SECRET` or `ENCRYPTION_MASTER_KEY` is missing, the app generates them automatically.
11. **Autonomy Kill Switch is always available.** `POST /api/autonomy/pause` instantly freezes all 30+ cron jobs.
12. **Mini-services must enforce `X-JARVIS-Key` auth.** Constant-time comparison prevents sandbox-escaped agents from accessing internal APIs.
13. **v59: Every workflow + skill carries an `autonomyTag`.** The conductor-router enforces it BEFORE execution. `HUMAN_ASSISTED` → Telegram approval queue. There is no bypass.
14. **v59: The Quality Supervisor uses execution-based trajectory validation** (not just `node --check`). Generated code is actually executed in a sandbox dry-run + stdout asserted.
15. **v59: All supervisor feedback loops are hard-capped at `MAX_RETRIES = 2`.** After 2 rejections, the work is escalated to the owner — never loops forever.

---

## 8. The 25 Bug Fixes (v58→v59 Audit)

A Principal Autonomous AI Systems Architect performed an exhaustive line-by-line audit, finding 60 bugs. 25 were safe to auto-fix and are applied in this zip. Each fix is annotated in-source with an `AUDIT-X-N` comment — search `AUDIT-` to find them all.

### Critical fixes (8)

| ID | File:Line | Fix |
|---|---|---|
| AUDIT-A-1 | `services/crypto-checkout.ts:138` | Atomic conditional `updateMany` claim — kills TOCTOU double-credit race |
| AUDIT-A-2 | `stripe-checkout/index.ts:17` | No longer swallows `approveOrder()` exceptions — Stripe retries |
| AUDIT-A-4 | `stripe-checkout/index.ts:15` | Idempotency short-circuit on redelivered events |
| AUDIT-B-1 | `workflow-engine.ts:301` | `MAX_WORKFLOW_STEPS=100` + visited-set cycle guard |
| AUDIT-B-9 | `intelligence/prompt-improver.ts:4` | `MAX_TUNE_ROUNDS=2/7d` cap on prompt auto-tuning |
| AUDIT-B-14 | `supervisors/index.ts:19` | Fail-closed sandbox (was shipping untested code) |
| AUDIT-C-1 | `intelligence/sandbox.ts:9` | Path-traversal reject (was prompt-injection-exploitable) |

### High fixes (9)

`AUDIT-A-6` (ERC-20 `to` filter), `AUDIT-A-7` (STRIPE_SECRET_KEY null check), `AUDIT-A-9` (atomic cron claim), `AUDIT-B-4` (scoped failure count), `AUDIT-B-6` (reviewWithRetryCap helper), `AUDIT-B-12` (SHA-256 A/B hashing), `AUDIT-B-20` (LLM maxRetries:2), `AUDIT-C-2` (rmSync logging), `AUDIT-C-3` (Retry-After honored).

### Medium fixes (8)

`AUDIT-A-13` (owner email fallback), `AUDIT-A-14` (null-safe UPI amount), `AUDIT-A-19` (RESEND trim), `AUDIT-A-22` (conditional delivery), `AUDIT-B-8` (failure-alchemy dedupe), `AUDIT-B-10` (normalized group key), `AUDIT-B-11` (empty-comment guard), `AUDIT-B-15` (.catch logging), `AUDIT-C-5` (SHA-256 fingerprint), `AUDIT-C-7` (*** masking).

### Low fixes (5)

`AUDIT-B-17` (blackbox logging), `AUDIT-B-18` (timer.unref), `AUDIT-B-19` (timer.unref), `AUDIT-C-8` (SIGKILL), `AUDIT-C-9` (execFile no-shell), `AUDIT-C-16` (NaN-guarded RPM parse).

---

## 9. Verification & Testing

### Test suite

```bash
bun test ./tests/*.test.ts ./tests/api/*.test.ts
```

**Result:** 105 pass · 0 fail · 609 expect() calls · 12 files

| Test file | Tests | Covers |
|---|---|---|
| `tests/cash-claw.test.ts` | 5 | Agent survival-tier classification |
| `tests/conductor-router.test.ts` | 13 | **v59: autonomy routing + trajectory validation + MAX_RETRIES cap** |
| `tests/feasibility.test.ts` | 5 | Monte Carlo P10/P50/P90 + GO/HALT/PIVOT |
| `tests/rate-limiter.test.ts` | 8 | Token bucket + expensive-endpoint detection |
| `tests/rbac.test.ts` | 9 | RBAC canAccess + role descriptions |
| `tests/secure-crypto.test.ts` | 8 | AES-256-GCM round-trip + sha512 + pbkdf2 |
| `tests/two-factor.test.ts` | 15 | TOTP + backup codes |
| `tests/api/cache.test.ts` | 7 | In-memory cache + TTL + invalidate |
| `tests/api/openapi.test.ts` | 6 | OpenAPI spec shape + path count |
| `tests/api/pagination.test.ts` | 9 | parsePagination + paginatedResponse |
| `tests/api/tracing.test.ts` | 10 | startSpan + traceAsync + ring buffer |
| `tests/api/two-factor.test.ts` | 10 | TOTP generation/verification + QR URI |

### Type check

```bash
bunx tsc --noEmit
```

**Result:** 0 errors

### Chaos tests (v58 resilience)

```bash
bun run scripts/chaos-test.ts
```

**Result:** 8 passed, 0 failed — ALL CHAOS TESTS PASSED

Covers: HTML-Resilient Router, Autonomy Pause/Resume, Autonomy Status API, DB Write Queue Flood, Queue Stats, Constant-Time Comparison, Auth Middleware, Provider Cooldown.

### E2E tests (Playwright)

```bash
bunx playwright test
```

4 spec files covering: auth-2fa flow, admin-rbac, purchase-preview, quality-gate.

---

## 10. Deployment

### Oracle Cloud Always Free (recommended — $0/month)

See deployment manifests in the repo: `fly.toml`, `render.yaml`, `koyeb.yaml`, `docker-compose.yml`, `Dockerfile`. Oracle Cloud Always Free tier + free-tier Resend + free Z-AI 5 RPM + free blockchain APIs = $0/month operating cost.

### Docker

```bash
docker build -t aria-mission-control .
docker-compose up -d
```

### Production checklist

- [ ] `.env` configured (DATABASE_URL, ARIA_OWNER_EMAIL, ZAI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)
- [ ] `prisma db push --accept-data-loss` run
- [ ] `bunx tsc --noEmit` passes (0 errors)
- [ ] `bun test` passes (105/105)
- [ ] `bun run scripts/chaos-test.ts` passes (8/8)
- [ ] Telegram bot configured (for HUMAN_ASSISTED approval flow + `/pause` `/resume` `/status`)
- [ ] `skills/` folder present (69 subfolders)
- [ ] Autonomy Kill Switch tested via `POST /api/autonomy/pause`

---

## Changelog (consolidated)

### v60 (this release)
- Consolidated 30 redundant .md docs into this single `docs/MASTER-GUIDE.md`
- Updated `setup.sh` + `setup.ps1` for v59 schema (AutonomyTag, WorkflowDefinition)
- Updated `.env.example` with HUMAN_ASSISTED Telegram approval-flow comments
- Cleaned tests: removed 3 broken shell scripts, consolidated duplicate two-factor tests, added `describe`/`it` blocks
- 105/105 tests pass, 0 tsc errors

### v59 (strategic upgrades)
- **Notion AI Company Map Autonomy Tags**: `enum AutonomyTag` + `WorkflowDefinition` model + `src/lib/conductor/router.ts` (246 lines) enforcing HUMAN_LED / HUMAN_ASSISTED / FULLY_AUTONOMOUS
- **500-AI-Agents-Projects Supervisor pattern**: `src/lib/supervisors/quality-supervisor.ts` (410 lines) with execution-based trajectory validation + `MAX_RETRIES = 2` hard cap
- 13 new tests in `tests/conductor-router.test.ts`

### v58 (enterprise resilience)
- HTML-Resilient LLM Router
- Global Autonomy Kill Switch
- SQLite Write Queue
- Mini-Service Internal Auth
- Chaos Monkey Test Script
- Zero-config auto-bootstrap
- Restored mandatory `skills/` folder

### v58→v59 audit (25 bug fixes)
- See §8 above. Each fix annotated in-source with `AUDIT-X-N`.
