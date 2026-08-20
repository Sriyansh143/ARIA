# ARIA Mission Control — Build Rules (v61.1-audited)

> **Single source of truth** for all architectural, security, and operational
> rules governing the ARIA Mission Control codebase. Every contributor, agent,
> and subagent MUST follow these rules. Violations cause build failures, CPU
> overheating, or security holes.

**Version:** v61.1-audited · **Last Updated:** 2026-08-17 · **Status:** Active · **Audited:** READY FOR PRODUCTION

This release supersedes the two prior rule documents (`v57` Build Rules and
`v28.0-hermes-autonomous` Build Rules) and merges them into a single coherent
v61 document. It incorporates the **two critical fixes** applied after the
independent production-readiness audit (Finding 4b: Production Gate wiring;
Finding 5c: Agent Blackboard enforcement).

---

## 0. Audit Status & Critical Fixes (v61.1)

An independent Principal Architect audit verified the codebase against a
7-area checklist (MNC structure, cognitive patterns, safety/governance,
operational discipline, Oracle free-tier optimization, self-improvement).
Result: **9 PASS, 3 PARTIAL, 2 FAIL (dead code), 1 FAIL (doc-only)**.

The 2 FAIL items were dead-code safety controls — fully implemented but never
invoked. Both are now **fixed and test-covered** in v61.1:

### Fix 4b — Production Gate is now actively enforced

**Before:** `verifyProductionReadiness()` in `src/lib/production-gate.ts` was
fully implemented (detects TODO/FIXME/DRAFT/TBD/PLACEHOLDER/lorem-ipsum/
ellipsis, hardcoded secrets `sk_live_`/`sk_test_`/`AKIA`/`ghp_`/`gho_`,
missing error handling on `fetch`/`await`, unbalanced braces, `console.log`
in prod code, missing CAN-SPAM unsubscribe links, missing deploy rollback
plans) but had **zero invocations** — outputs shipped unchecked.

**After (v61.1):**
- `src/lib/step-debate.ts:31,92-119,157-200` — the gate now runs on every
  step-debate output (single-pass AND debate paths). On failure: a Refiner
  retry loop (`MAX_GATE_ATTEMPTS=3`) re-prompts the LLM with the gate's
  specific issues. After 3 failures: the output is replaced with a
  `NEEDS_CONTEXT:` marker + `productionReady=false`.
- `src/lib/workflow-engine.ts:585-627` — the workflow engine detects the
  `NEEDS_CONTEXT:` prefix, halts the step (`success=false`), sets
  `run.status="awaiting_approval"`, sends a Telegram **"🚫 PRODUCTION GATE
  HALT"** message, and logs to `AgentLog`. The flawed output is **not**
  returned to the workflow context.

**Hard rule (NEW):** Every LLM-generated output (debate OR single-pass) MUST
pass through `verifyProductionReadiness()` before being committed to the
workflow context. No output containing TODO/FIXME/DRAFT/hardcoded secrets/
missing error-handling may ship to production. CI should fail the build if
`verifyProductionReadiness` is removed from `step-debate.ts` or
`workflow-engine.ts`.

### Fix 5c — Agent Blackboard is now enforced on the real execution path

**Before:** `src/lib/agent-blackboard.ts` (lock + conflict-check) was correct,
and `dispatchToAgent()` in `src/lib/conductor/dispatcher.ts` called it — but
`dispatchToAgent()` had **zero call sites** in `src/`. The real email path
(`outreach-executor.ts` → `email-service.ts`) bypassed the blackboard
entirely, so two concurrent cron ticks could email the same lead. On
conflict, the dispatcher only returned an error string — no task status
update, no pivot.

**After (v61.1):**
- `src/lib/conductor/dispatcher.ts:100-138` — on resource conflict, the
  dispatcher now actively: (1) marks the Task as `status="blocked"` with
  `result="CONFLICT: ..."`, (2) calls `promoteNextNonBlockedTask(req.taskId)`
  to pivot the fleet, (3) emits a "🔄 Pivot triggered" SSE event, (4) returns
  the CONFLICT error.
- `src/lib/conductor/dispatcher.ts:313-386` — new exported
  `promoteNextNonBlockedTask(excludeTaskId?)`: finds the oldest pending task
  (excluding the blocked one + tasks blocked by deferred approvals), promotes
  it to `status="running"`, emits `task.update`. Production-safe pivot logic
  (mirrors `simulation/engine.ts:441-470` but not coupled to the simulation
  tick loop).
- `src/lib/outreach-executor.ts:147-150,283-314,447-468` — the real email
  path now claims `email:<addr>` on the blackboard BEFORE drafting/sending;
  if already claimed → marks task `status="blocked"`, calls
  `promoteNextNonBlockedTask(taskId)`, returns `{ status: "blocked" }`.
  Releases the claim on both success and failure.

**Hard rule (NEW):** Every resource-claiming action (email outreach, deploy,
order build, payment) MUST acquire a blackboard lock before executing. On
conflict, the action MUST be blocked + the fleet pivoted via
`promoteNextNonBlockedTask()`. The blackboard is no longer optional — it is
the single conflict-prevention mechanism for the agent fleet.

---

## 1. Non-Negotiable Rules

1. **Never commit `.env`.** Add to `.gitignore`. The `.env` file contains real
   secrets. `auto-bootstrap.ts` generates `NEXTAUTH_SECRET` +
   `ENCRYPTION_MASTER_KEY` on first boot if missing.
2. **AI_CALLER_ENABLED + AI_CALLER_CONSENT_VERIFIED must both be `"true"`**
   for any outbound call/SMS. There is no override. See §5 (Telephony Safety
   Gate).
3. **Crypto payment verification uses real on-chain data.** Etherscan +
   BlockCypher + Solana RPC + TronGrid. No mocks in prod.
4. **Outreach requires CAN-SPAM compliance.** Unsubscribe link + sender
   address + sender identification. Enforced by `email-service.ts` + the
   Production Gate's `checkEmailOutput()`.
5. **All owner-only routes use `requireAuthOrResponse()`.** Public routes are
   explicitly listed in `src/proxy.ts`. See §5.9.
6. **Daily outreach limit defaults to 10.** Increase to 50 after warmup
   (day 15+). Enforced in `outreach-executor.ts`.
7. **Resend webhook signature verification is fail-closed.** Missing secret =
   no inbound replies processed.
8. **Credential Vault uses AES-256-GCM.** Master key must be set via
   `ENCRYPTION_MASTER_KEY` in production (32+ chars). Dev fallback warns but
   does not block.
9. **The `skills/` folder is MANDATORY.** Never exclude it from the zip / git
   repo / deployment. The 69 ClawHub skills are loaded by `skill-loader.ts`
   at runtime — without them, agents cannot invoke specialized tools.
10. **Auto-bootstrap generates critical secrets on first start.** If
    `NEXTAUTH_SECRET` or `ENCRYPTION_MASTER_KEY` is missing, the app generates
    them automatically + writes to `.env`.
11. **Autonomy Kill Switch is always available.** `POST /api/autonomy/pause`
    instantly freezes all 30+ cron jobs + `executeWorkflow()`. Telegram
    supports `/pause` and `/resume`. The server stays up — only autonomous
    operations are paused. Wired in BOTH `cron-scheduler.ts:909-911` AND
    `workflow-engine.ts:300-312`.
12. **Mini-services must enforce `X-JARVIS-Key` auth.** All HTTP requests to
    internal mini-services (realtime, future services) must include the
    `X-JARVIS-Key` header. The `JARVIS_SHARED_KEY` env var is verified using
    constant-time comparison.
13. **Production Gate is MANDATORY on all LLM outputs (NEW v61.1).** No
    TODO/FIXME/DRAFT/secret-laden output may ship. See Fix 4b above.
14. **Agent Blackboard is MANDATORY on all resource-claiming actions (NEW
    v61.1).** Two agents may never claim the same email/deploy/order/payment
    resource. See Fix 5c above.
15. **Payment approvals are isolated.** Spend/payment approvals are excluded
    from the auto-decider (`approval-decision.ts:344-351`), require
    `/pay-approve` (NOT `/approve`), and enforce a 60s cooldown
    (`telegram-bot.ts:527-619`, `COOLDOWN_MS=60_000`).
16. **Business hours discipline.** Customer-facing outreach only 9 AM – 6 PM
    in the recipient's timezone (`business-hours.ts:29-54` +
    `outreach-executor.ts:213-240` defers to next 9 AM).
17. **Never sit idle.** If an approval is deferred (>2h), the fleet pivots to
    the next non-blocked task (`cron-scheduler.ts:566-627` +
    `simulation/engine.ts:441-470` + new `dispatcher.ts:329`
    `promoteNextNonBlockedTask`).

---

## 2. Stack (non-negotiable)

| Layer | Tech | Notes |
|-------|------|-------|
| **Runtime** | Bun 1.3+ (Node 22+ fallback) | `bun install` only for primary dev |
| **Framework** | Next.js 16 (App Router, Turbopack) | Port 3000 only |
| **Language** | TypeScript 5 (strict) | 0 typecheck errors enforced |
| **Database / ORM** | Prisma v6 + SQLite (dev) / PostgreSQL (prod) | 50 models |
| **Styling** | Tailwind CSS 4 + shadcn/ui (Radix primitives, New York) | 65+ components |
| **State (client)** | Zustand (single store, 8 capped collections) | `src/stores/mission-store.ts` |
| **Server state** | TanStack Query v5 + Prisma | `src/app/api/**` |
| **Animation** | Framer Motion v12 | mission components |
| **LLM SDK** | `z-ai-web-dev-sdk` (default export, server-only) | `src/lib/llm-router.ts` |
| **Auth** | NextAuth v4 + bcryptjs(12) + 2FA TOTP | RBAC: owner/admin/operator/viewer |
| **Crypto** | Node `crypto` (AES-256-GCM, PBKDF2 600k, SHA-512) | `src/lib/secure-crypto.ts` |
| **Email** | nodemailer v9 + Resend | `src/lib/email.ts` + `email-service.ts` |
| **Realtime** | socket.io-client v4.8 (client) + `socket.io` (sidecar :3003) | `mini-services/realtime/` |
| **Charts** | recharts v2 | `kpi-panel.tsx` |
| **Validation** | Zod v4 | `src/lib/types.ts` |
| **Date** | date-fns v4 (no moment, no lodash) | lib + components |
| **System metrics** | systeminformation v5 | `src/lib/monitor.ts` |

**Hard rule:** `bun install` only — never `npm install` for primary dev (npm
is only a fallback for environments without Bun). Dev: `bun run dev`. Build:
`bun run build`. Lint: `bun run lint`. Typecheck: `bunx tsc --noEmit`.

---

## 3. Architecture

```
Next.js 16 (Turbopack) app on port 3000
├─ Dashboard (/dashboard) — 9 tabs
│   Overview / Operations / Agents / Comms / Intelligence /
│   Finance / System / Training / Advanced
├─ 57-agent fleet across 15 departments (6 archetypes: Scouts, Analysts,
│   Builders, Publishers, Groundskeepers, Conductor — emergent grouping
│   by capability tag in src/lib/simulation/fleet.ts)
├─ Autonomy stack (top→bottom):
│   Autonomous Business Engine (8-stage lifecycle, 12 industry playbooks)
│     ↓
│   Conductor (router + council + dispatcher)
│     ↓ routeWorkflowByAutonomy() / routeSkillByAutonomy()
│   Workflow Engine (executeWorkflow — steps + step-debate)
│     ↓
│   Hermes (skills + memory + toolsets + learning)
│     ↓ routeLLM()
│   LLM Router (7-provider failover + Oracle free-tier routing)
│     ↓
│   Ollama (local) / Z-AI / Groq / NVIDIA / OpenAI / Anthropic / Gemini
├─ Safety controls (layered):
│   1. AutonomyTag enum (HUMAN_LED / HUMAN_ASSISTED / FULLY_AUTONOMOUS)
│   2. Kill Switch (isAutonomyPaused — wired into cron + executeWorkflow)
│   3. Zero-Assumption Guard (halts on missing context → Telegram /answer)
│   4. Production Gate (v61.1 — blocks TODO/FIXME/secrets, 3-retry Refiner)
│   5. Agent Blackboard (v61.1 — prevents resource conflicts + pivots)
│   6. Payment Isolation (60s cooldown, /pay-approve only)
│   7. Business Hours (defers customer outreach to 9-18 recipient tz)
│   8. Quality Supervisor (execution-based trajectory validation, MAX_RETRIES=2)
├─ SSE event bus (primary) + socket.io sidecar (port 3003, optional)
├─ proxy.ts (Next.js 16 middleware equivalent) — multi-tenant JWT gate
└─ Capped Zustand stores (8 collections, see §5.3)

Realtime socket.io mini-service on port 3003 (separate bun project)
└─ REST /health, /emit, /buffer + socket.io path "/"
```

### 3.1 Prisma models — 50 total

**Core (27):** Agent, Task, AgentLog, Event, MetricPoint, Approval, CronJob,
CronRun, LlmCall, SystemAlert, Skill, SubAgentTask, EarningOpportunity,
LearnedInsight, RevenueEvent, Deal, AgentMessage, MemoryItem, User, Account,
Session, VerificationToken, Personnel, CompanyProfile,
CompanyEarningOpportunity, SimulationRun, SimulationIteration.

**Intelligence layer (10):** SupervisorReview, Escalation, ABTest,
CustomerFeedback, KnowledgeBaseEntry, CompetitorAnalysis, ServiceOpportunity,
EarningMethod, SimulationReport, BusinessReview.

**Capabilities (13):** Credential, SystemAccessSession, SystemAccessApproval,
SystemAccessAction, Note, MilestoneEvent, KpiSnapshot,
AgentMarketplaceTemplate, ResearchLog, EcosystemRepo, Voicemail,
SupportTicket, Setting.

**Autonomy layer:** WorkflowDefinition (with `autonomyTag` enum + indexed),
Skill (with `autonomyTag` enum + indexed, default `HUMAN_ASSISTED`).

Provider auto-switch: `file:./...` → SQLite, `postgresql://...` → Postgres.
Run `bun run db:bootstrap` to apply schema + generate client.

### 3.2 Cron jobs — 30+ total

Handlers live in `src/lib/cron-scheduler.ts` (`JOB_HANDLERS` map). The 30s
poll loop in `runDueJobs` short-circuits on `isAutonomyPaused()` (line 909).
Key jobs: `lead-finder-daily`, `outreach-executor` (30min),
`crypto-verifier-poll` (5min), `service-builder-queue` (1min),
`approval-reminder` (marks stalled >2h approvals as deferred + pivots),
`rules-auditor` (6h — analyzes failed traces, proposes specific code/rule
changes via HUMAN_ASSISTED approval), `cash-claw-sweep` (6h),
`feasibility-rescore` (6h), `failure-alchemy-sweep` (30min),
`kpi-snapshot` (6h), `revenue-cycle` (4h), `milestone-check` (10min),
`backup-service-daily` (3am), `weekly-business-review` (Sun 8pm),
`executive-supervisor-daily` (11pm), `health-sim-daily` (6am), + others.

---

## 4. Zero-dep rules (forbidden packages)

| Forbidden | Use instead | Why |
|---|---|---|
| `axios` | `fetch()` + `AbortSignal.timeout(ms)` | Native, smaller bundle, no proxy bugs |
| `socket.io` inside Next.js app | SSE via `/api/events` (Next ResponseStream) | socket.io only in the **separate** mini-service |
| `ioredis` / `redis` (dev) | in-process Map + globalThis cache | single-instance dev; PostgreSQL + external broker for prod |
| `moment` | `date-fns` v4 | tree-shakable, immutable |
| `lodash` | native TS spread / Array methods | bundle bloat |
| CSS frameworks other than Tailwind | Tailwind 4 + shadcn/ui | design system coherence |
| `node-fetch` | global `fetch` (Node 20+ has it native) | always available |
| `winston` / `pino` | `src/lib/logger.ts` (custom) | already wired to SSE + DB |

**Hard rule:** every `fetch()` call MUST set a timeout via
`AbortSignal.timeout(ms)` or an `AbortController` — no unbounded hangs.

---

## 5. z-ai SDK rule

- Default export only: `import ZAI from "z-ai-web-dev-sdk";`
- **Server-only.** Never import in client components. Use `await import()`
  inside function bodies for routes that need it (`/api/image-gen`,
  `computer-use.ts`, `screen-vision.ts`).
- Config file: `.z-ai-config` at project root (JSON). If absent, generated
  from `ZAI_API_KEY` env var on boot.
- Env-loader (`src/lib/env-loader.ts`) hot-reloads `.env` every 5s. When
  `ZAI_API_KEY` changes, the loader rewrites `.z-ai-config` so the next SDK
  instantiation picks up the new key — no restart needed.
- LLM calls go through `routeLLM()` in `src/lib/llm-router.ts`, NEVER direct
  to the SDK. This is the single chokepoint for failover + cost tracking +
  Oracle free-tier routing.

---

## 6. Hardening (MANDATORY)

### 6.1 API routes — try/catch on every handler

Every DB-touching API route in `src/app/api/**` MUST:

```ts
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  try {
    // ... read from db ...
    return NextResponse.json({ /* ... */ });
  } catch (err) {
    logger.error("route.<name>.failed", { error: String(err) });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
```

No exceptions. No `throw` from route handlers — always catch + log + 500.

### 6.2 SSE exponential backoff

The `/api/events` SSE stream and the socket.io client both use exponential
backoff on disconnect: 1s → 2s → 4s → 8s → 16s (capped at 16s).

### 6.3 Capped stores (Zustand)

| Collection | Cap | Constant |
|---|---|---|
| Logs | 200 | `LOG_CAP` |
| Metric points | 240 | `METRIC_CAP` |
| LLM calls | 80 | `LLM_CAP` |
| Alerts | 60 | `ALERT_CAP` |
| Revenue events | 120 | `REVENUE_CAP` |
| Deals | 60 | `DEAL_CAP` |
| Agent messages | 100 | `MESSAGE_CAP` |

Hard rule: when a collection reaches its cap, the oldest entry is dropped
(FIFO). Never raise these caps without explicit owner approval.

### 6.4 Stable selectors (Zustand)

Zustand selectors MUST return stable refs. Forbidden:

```ts
// BAD — fresh array every render, causes infinite re-renders
const logs = useMissionStore(s => s.logs.map(l => l.message));
```

Use `useShallow` (from `zustand/react/shallow`) or select the raw array and
map in a `useMemo`.

### 6.5 No mock LLM

The mock LLM tier has been **removed**. The env var `ARIA_LLM_DISABLED` is no
longer honored. If all providers fail, the call returns an `error` field —
never a fake response. Tests that need determinism must stub `routeLLM()` at
the module boundary (`mock.module()` in `bun:test`).

### 6.6 Hermes sandbox

Toolset execution in `src/lib/hermes/toolsets.ts` runs inside `node:vm` with
a **5s wall-clock timeout** (configurable via `SANDBOX_TIMEOUT_MS`). The
sandbox has no access to `process`, `require`, `fs`, or `child_process`.

### 6.7 Optional deps graceful degradation

Optional dependencies (nut-js, screenshot-desktop, playwright) are
dynamic-imported inside the function body. When the import fails, the
function returns `{status: "unsupported", error: "<module> not installed"}`
rather than throwing.

### 6.8 Security headers (next.config.ts)

Every response MUST carry these 4 security headers:

| Header | Value |
|---|---|
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(self), geolocation=()` |

Hard rule: never weaken or remove these headers without owner review.

### 6.9 Proxy (Next.js 16 middleware) — multi-tenant auth

Next.js 16 renamed `middleware.ts` to `proxy.ts`. Hard rules:

1. Every route not in the public allow-list MUST require a valid NextAuth JWT.
2. Public routes are an allow-list, never a deny-list.
3. `JARVIS_DEV_BYPASS_AUTH=1` short-circuits the gate for local dev. MUST be
   `0` (unset) in production.
4. Unauthenticated requests redirect to `/login?callbackUrl=<original-path>`.
5. Static assets (`/_next/*`, `/favicon.ico`, `*.svg`, `*.ico`, `*.txt`) are
   passed through without auth.

### 6.10 No secrets to the client

API responses MUST NEVER serialize secrets. The `/api/settings` route is the
canonical pattern: it returns ONLY boolean flags + non-secret operational
state. The Credential Vault endpoints return `Credential` as a count only —
ciphertext never leaves the server.

### 6.11 Telephony safety gate

```ts
function isAiCallerAllowed() {
  const enabled = process.env.AI_CALLER_ENABLED === "true";
  const consent = process.env.AI_CALLER_CONSENT_VERIFIED === "true";
  if (!enabled) return { allowed: false, reason: "AI_CALLER_ENABLED is not 'true'" };
  if (!consent) return { allowed: false, reason: "AI_CALLER_CONSENT_VERIFIED is not 'true'" };
  return { allowed: true };
}
```

Both flags must be literally `"true"` (string) for `makeCall()` and
`sendSms()` to proceed. Intentional legal compliance.

---

## 7. LLM concurrency & routing

| Constraint | Value | Where |
|---|---|---|
| Max concurrent LLM calls | 3 | `src/lib/llm-router.ts` semaphore |
| Retries per provider | 1 | `routeLLM` |
| Backoff between retries | 1s | exponential, capped |
| Ollama timeout | 10s | `AbortSignal.timeout(10000)` |
| Agents per tick | 5 | conductor dispatcher |
| Tick interval | 15s | `src/lib/conductor/dispatcher.ts` |

**Complexity-aware routing:**
- HIGH complexity: Z-AI `glm-4.6` → Groq `llama-3.3-70b` → NVIDIA
  `llama-3.1-405b` → Ollama `qwen2.5:14b`
- LOW complexity: Z-AI `glm-4.5-flash` → Groq fast → Ollama `qwen2.5:3b`

**Oracle Free Tier optimization** (`environment-detector.ts` +
`llm-router.ts:856-901`): When `DEPLOYMENT_ENV="oracle-free-tier"` OR
`FREE_ONLY_MODE="true"`, the router routes to local Ollama lightweight models
(`qwen2.5-coder:7b`, `llama3.2:3b`, `qwen2.5-coder:1.5b`) and skips paid
providers (Z-AI, Groq, NVIDIA). OpenAI/Anthropic are never in the provider
list at all.

**Cooldowns:** 5min on auth failure, 60s on rate limit. Provider status
surfaced at `/api/llm-router/status`.

---

## 8. Safety & Governance Controls (the layered defense)

| Control | What it does | Where enforced |
|---|---|---|
| **AutonomyTag enum** | HUMAN_LED → owner triggers; HUMAN_ASSISTED → Telegram approval queue; FULLY_AUTONOMOUS → runs directly | `conductor/router.ts:95-122` (workflows) + `:140-157` (skills); called BEFORE `executeWorkflow` at `workflow-engine.ts:340` + BEFORE skill exec at `hermes/skills.ts:93,156` |
| **Kill Switch** | `isAutonomyPaused()` halts all autonomous actions immediately | `autonomy-control.ts:49`; wired into `cron-scheduler.ts:909-911` AND `workflow-engine.ts:300-312` |
| **Zero-Assumption Guard** | Halts execution + Telegram `/answer` prompt if required context is missing | `zero-assumption-guard.ts:41-96`; invoked at `workflow-engine.ts:607-644` (tool_call steps) |
| **Production Gate (v61.1)** | Blocks outputs with TODO/FIXME/DRAFT/secrets/missing error-handling; 3-retry Refiner loop; escalates to NEEDS_CONTEXT | `production-gate.ts:37-107`; invoked at `step-debate.ts:101,166,175` + `workflow-engine.ts:591,606-627` |
| **Agent Blackboard (v61.1)** | Prevents two agents claiming the same resource; blocks + pivots on conflict | `agent-blackboard.ts:54-179`; invoked at `dispatcher.ts:97-138` + `outreach-executor.ts:283-314` |
| **Payment Isolation** | Spend/payment approvals excluded from auto-decider; `/pay-approve` only; 60s cooldown | `approval-decision.ts:344-351` (exclusion) + `telegram-bot.ts:335-355` (/approve refusal) + `:527-619` (60s cooldown) |
| **Business Hours** | Defers customer outreach to 9-18 in recipient tz | `business-hours.ts:29-54` + `outreach-executor.ts:213-240` |
| **Quality Supervisor** | Execution-based trajectory validation (stdout/exit codes, not just syntax); MAX_RETRIES=2 hard cap | `quality-supervisor.ts:37` (constant) + `:133-240` (execution) + `:370-428` (loop); invoked at `services/builder.ts:420` |
| **Council Pattern** | Convenes 3-4 agents for high-complexity tasks before execution | `conductor/council.ts:76-99` (4 members) + `:114-163` (parallel LLM) + invoked at `conductor/router.ts:69-90` |
| **Step-Debate** | Proposer → Critic → Refiner loop for high-complexity steps; injects previous step results | `step-debate.ts:113-134` (3 roles) + `:79-84` (previous injection); invoked at `workflow-engine.ts:544-563` |
| **2-Hour Deferral & Pivot** | Marks stalled approvals as deferred; fleet pivots to non-blocked tasks | `cron-scheduler.ts:566-627` (deferral) + `simulation/engine.ts:441-470` + `dispatcher.ts:329` `promoteNextNonBlockedTask` |
| **Rules-Auditor** | Self-improvement: analyzes failed traces, proposes specific code/rule changes via HUMAN_ASSISTED approval | `cron-scheduler.ts:633-755` (cron + LLM + confidence gate ≥0.6) + `execution-trace.ts:80-121` (trace fetch) |

---

## 9. Autonomous Business Engine Rules

The autonomous business engine (`src/lib/autonomous-business-engine.ts` +
`src/lib/industry-playbooks.ts`) is the top of the autonomy stack. Rules:

1. **Each lifecycle stage is independently try/caught.** The 8 stages (FIND,
   QUALIFY, PLAN, EXECUTE, DELIVER, INVOICE, TRACK, OPTIMIZE) each wrap their
   body in try/catch. A failure in one stage MUST NOT abort the cycle.
2. **LLM calls go through `routeLLM`, no mocks.** Each call individually
   try/caught.
3. **Industry playbooks are the single source of truth.** 12 industries
   defined in `industry-playbooks.ts`. To add a 13th, add an entry to
   `INDUSTRY_PLAYBOOKS` only; do not branch the engine code.
4. **The cycle creates real DB records.** Persistence contract: see §8.4 of
   the prior v28 rules (carried forward).
5. **`runAutonomousCycle()` is the only orchestrator.** No parallel stage
   execution.
6. **Pipeline snapshot is read-only.** `getLifecyclePipeline()` is a pure DB
   read.

---

## 10. Gateway rules

- **Only port 3000 is exposed** to the public internet (via Caddy / nginx /
  Cloudflare).
- The realtime sidecar on port 3003 is accessed through the gateway via the
  `XTransformPort=3003` query parameter. Caddy rewrites `/?XTransformPort=3003`
  → `:3003/?...`.
- All `fetch()` URLs in client code MUST be relative. socket.io client
  connection string: `io("/?XTransformPort=3003")` — never hardcode
  `http://localhost:3003`.
- No CORS `*` — the sidecar reflects the `Origin` header with `Vary: Origin`
  + credentials.

---

## 11. Testing

```bash
# Type check (must be 0 errors)
bunx tsc --noEmit

# Unit + integration tests (127 tests, must all pass — v61.1)
bun test ./tests/*.test.ts ./tests/api/*.test.ts

# End-to-end simulation (9 sims, 33+ verification checks)
bun run scripts/simulate-full-loop.ts

# Pre-launch smoke test (9 security checks)
bash scripts/pre-launch-smoke-test.sh      # Linux/Mac
powershell -ExecutionPolicy Bypass -File scripts/pre-launch-smoke-test.ps1  # Windows

# Chaos test (8 chaos scenarios)
bun run scripts/chaos-test.ts
```

**v61.1 test inventory (127 tests):**
- `tests/conductor-router.test.ts` — 25 tests (autonomy tag routing +
  trajectory validation + quality supervisor with MAX_RETRIES=2)
- `tests/production-gate.test.ts` — **13 tests (NEW v61.1)**: 11
  pure-function tests of `verifyProductionReadiness` (TODO/FIXME/DRAFT/
  sk_live_/ghp_/empty/ellipsis/fetch-without-try-catch/shouldHalt-at-3/
  shouldRetry-below-3/clean-passes) + 2 wiring tests of `runStepDebate`
- `tests/agent-blackboard.test.ts` — **7 tests (NEW v61.1)**: 3 core
  blackboard tests (claim/double-claim/release) + 2 dispatcher tests (two
  agents same email → second blocked + task marked "blocked" + pivot task
  promoted) + 2 pivot tests
- `tests/cash-claw.test.ts` — 12 tests (evolutionary agent survival)
- `tests/two-factor.test.ts` — 13 tests (TOTP + backup codes; 4 require
  `bcryptjs` installed)
- `tests/rate-limiter.test.ts` — 7 tests
- `tests/rbac.test.ts` — 8 tests
- `tests/secure-crypto.test.ts` — 8 tests
- `tests/feasibility.test.ts` — 2 tests (Monte Carlo)
- `tests/api/*.test.ts` — 34 tests (openapi, pagination, cache, tracing)

---

## 12. Production Readiness Checklist

Before deploying to production, verify EVERY item:

- [ ] `NODE_ENV=production`
- [ ] `JARVIS_DEV_BYPASS_AUTH=0` (no bypass)
- [ ] `JARVIS_AUTH_MODE=multi-tenant` (or `single-operator` for self-host)
- [ ] `NEXTAUTH_SECRET`, `AUTH_SECRET`, `ENCRYPTION_MASTER_KEY`,
      `ARIA_REALTIME_KEY` rotated (never reuse dev secrets)
- [ ] `ALLOW_TERMINAL_EXEC=false`, `ALLOW_CODE_EXEC=false`
- [ ] `AI_CALLER_ENABLED=false` (unless legally cleared)
- [ ] `DATABASE_URL` points to PostgreSQL (not SQLite) for multi-instance
- [ ] `ARIA_REALTIME_KEY` set on BOTH the Next.js app env AND the sidecar env
- [ ] HTTPS terminated at Caddy (see `Caddyfile`)
- [ ] `NEXTAUTH_URL` set to the public HTTPS URL
- [ ] Realtime sidecar started (`mini-services/realtime` running on :3003)
- [ ] `RATE_LIMIT_DISABLED=false` (re-enable rate limiting)
- [ ] `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` set (for HUMAN_ASSISTED
      approval flow + Production Gate halt notifications)
- [ ] All optional deps installed where features are used
- [ ] `bunx tsc --noEmit` passes (0 errors)
- [ ] `bun test` all pass (127/127)
- [ ] `bun run build` succeeds
- [ ] `bun run scripts/simulate-full-loop.ts` all 9 sims pass
- [ ] `bash scripts/pre-launch-smoke-test.sh` all 9 checks pass
- [ ] Security headers verified (curl -I)
- [ ] `/api/settings` returns NO secrets (grep for `*_KEY`/`*_SECRET`/`password`
      → 0 matches)
- [ ] Autonomous business engine — `POST /api/business-lifecycle` completes a
      full 8-stage cycle
- [ ] **Production Gate verified (NEW v61.1)** — feed a TODO-containing
      prompt to a workflow step; confirm the step halts with `NEEDS_CONTEXT:`
      and a Telegram "🚫 PRODUCTION GATE HALT" message is sent
- [ ] **Agent Blackboard verified (NEW v61.1)** — trigger two concurrent
      outreach emails to the same lead; confirm the second is blocked
      (`status="blocked"`) and the fleet pivots to the next task

---

## 13. File layout (key files)

```
src/lib/                          # server-only modules
├─ db.ts                          # PrismaClient singleton (globalThis cache)
├─ logger.ts                      # createLogger / emit / levels
├─ types.ts                       # AGENT_ROLES, DEPARTMENTS, MissionEvent union, parseJsonArray
├─ llm-router.ts                  # routeLLM (7-provider failover, Oracle free-tier routing)
├─ llm-client.ts, ollama-client.ts
├─ env-loader.ts                  # 5s hot-reload of .env
├─ event-bus.ts                   # SSE event stream
├─ cron-scheduler.ts              # JOB_HANDLERS map (30+ entries) + approval-reminder + rules-auditor
├─ simulation/{fleet,engine,seed,seed-templates}.ts  # 57-agent fleet + tick loop + pivot
├─ conductor/
│  ├─ router.ts                   # routeWorkflowByAutonomy + routeSkillByAutonomy (AutonomyTag gate)
│  ├─ council.ts                  # conveneCouncil (3-4 agents, parallel LLM)
│  └─ dispatcher.ts               # dispatchToAgent + promoteNextNonBlockedTask (blackboard + pivot)
├─ hermes/                        # 5-file Hermes engine
│  ├─ skills.ts, memory.ts, toolsets.ts, learning.ts, earning-researcher.ts
├─ production-gate.ts             # verifyProductionReadiness (v61.1 — actively invoked)
├─ agent-blackboard.ts            # postToBlackboard + isResourceClaimed + releaseFromBlackboard (v61.1 — actively invoked)
├─ zero-assumption-guard.ts       # checkContextCompleteness (halts on missing context)
├─ autonomy-control.ts            # isAutonomyPaused (kill switch)
├─ business-hours.ts              # isWithinBusinessHours (9-18 recipient tz)
├─ approval-decision.ts           # auto-decider (excludes spend/high-risk)
├─ approval-executor.ts           # approval side-effects (spend → Setting record)
├─ telegram-bot.ts                # /approve, /deny, /discuss, /pay-approve (60s cooldown), /pause, /resume, /answer
├─ workflow-engine.ts             # executeWorkflow (autonomy + kill switch + zero-assumption + production gate)
├─ step-debate.ts                 # runStepDebate (Proposer→Critic→Refiner + production gate retry loop)
├─ supervisors/quality-supervisor.ts  # runTrajectoryValidation + reviewWithTrajectoryCap (MAX_RETRIES=2)
├─ skill-patterns.ts              # 12 skill patterns + loadFullSkillContext
├─ outreach-executor.ts           # email path (business hours + blackboard + CAN-SPAM)
├─ email-service.ts, email.ts     # Resend + nodemailer
├─ environment-detector.ts        # Oracle free-tier detection
├─ secure-crypto.ts               # AES-256-GCM + PBKDF2 + SHA-512
├─ credential-vault.ts            # upsert by key, decrypt in-memory
├─ autonomous-business-engine.ts  # 8-stage lifecycle + runAutonomousCycle()
├─ industry-playbooks.ts          # 12 industry playbooks
└─ ... (60+ other lib modules)

src/app/api/                      # 78+ route handlers
src/components/mission/           # 75+ mission components
src/proxy.ts                      # Next.js 16 middleware — multi-tenant JWT gate
next.config.ts                    # security headers + prod TS/ESLint gates
mini-services/realtime/           # INDEPENDENT bun project (socket.io sidecar)
skills/                           # 69 ClawHub skills (MANDATORY — do not exclude)
prisma/schema.prisma              # 50 models + AutonomyTag enum
docs/                             # ULTIMATE-MASTER-OVERVIEW, AGENT-OPERATOR-MANUAL, BUILD-RULES-v61, AUDIT-REPORT
```

---

## 14. Known Limitations (honest)

⚠️ **Real phone calls require external setup:** FreeSWITCH + SIP trunk, OR
Twilio + phone number, OR Dograh API key. AI Caller safety gate enforced.

⚠️ **Real lead gen uses free Z-AI web_search:** 5-10 leads per query, capped
daily. For higher volume, add Apollo/Hunter/Snov/Clearbit/ZoomInfo API key.

⚠️ **Crypto payments need real wallet:** Set `CRYPTO_WALLET_ADDRESS`. BTC
works out of the box; ETH/USDT/USDC need Etherscan API key (free).

⚠️ **6-archetype representation is doc-only:** The 6 agent archetypes
(Scouts, Analysts, Builders, Publishers, Groundskeepers, Conductor) are an
emergent grouping by capability tag — there is no `archetype` column in
Prisma or field on the TS `Agent` type. Recoverable via capability inspection
but not compile-time enforced. (Audit Finding 1a — partial pass.)

⚠️ **Council brief is logged but not consumed downstream:** `conveneCouncil()`
runs in parallel (fire-and-forget) and logs to `AgentLog`, but the brief is
not injected into the workflow execution context. (Audit Finding 2a caveat.)

⚠️ **Quality Supervisor coverage gap:** Trajectory validation fires only on
the service-builder path (`services/builder.ts:420`), NOT on workflow-engine
LLM-call steps. Workflow steps go through step-debate + production gate
instead. (Audit Finding 2c caveat.)

⚠️ **Kill-switch fail-open:** Both `cron-scheduler.ts:913` and
`workflow-engine.ts:314` swallow errors and continue if `autonomy-control.ts`
throws (DB outage). Consider fail-CLOSED for `executeWorkflow()` in future
hardening.

---

**End of Build Rules v61.1-audited.**
