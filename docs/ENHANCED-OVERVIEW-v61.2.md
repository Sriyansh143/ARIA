# ARIA Mission Control v61.2-bugfixed — Enhanced Complete Overview

> **The definitive architectural + operational reference for ARIA Mission Control.**
> This document supersedes all prior overviews. It is the single enhanced
> reference that consolidates architecture, safety controls, cognitive patterns,
> operational discipline, and the full audit history.

**Version:** v61.2-bugfixed · **Status:** READY FOR PRODUCTION · **Audited:** 2026-08-17
**Verification:** `bunx tsc --noEmit` → 0 errors · `bun test` → 130/130 pass · `bun run scripts/chaos-test.ts` → 8/8 pass

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [The Permanent Goal + 8 Non-Negotiable Rules](#2-the-permanent-goal--8-non-negotiable-rules)
3. [Complete Architecture (Layered)](#3-complete-architecture-layered)
4. [The 6 Agent Archetypes + 57-Agent Fleet](#4-the-6-agent-archetypes--57-agent-fleet)
5. [Autonomy Stack (Top → Bottom)](#5-autonomy-stack-top--bottom)
6. [Safety & Governance Controls (12-Layer Defense)](#6-safety--governance-controls-12-layer-defense)
7. [Advanced Cognitive Patterns (500-AI-Agents Inspired)](#7-advanced-cognitive-patterns-500-ai-agents-inspired)
8. [Skill Patterns Approach (Embedded, Not External)](#8-skill-patterns-approach-embedded-not-external)
9. [Operational Discipline](#9-operational-discipline)
10. [Oracle Cloud Free Tier Optimization](#10-oracle-cloud-free-tier-optimization)
11. [Self-Improvement Loop](#11-self-improvement-loop)
12. [Complete Data Model (50 Prisma Models)](#12-complete-data-model-50-prisma-models)
13. [Complete API Surface (78+ Routes)](#13-complete-api-surface-78-routes)
14. [Complete Cron Job Inventory (30+ Jobs)](#14-complete-cron-job-inventory-30-jobs)
15. [Complete Test Inventory (130 Tests)](#15-complete-test-inventory-130-tests)
16. [Audit History + Bug-Fix Log](#16-audit-history--bug-fix-log)
17. [Known Limitations (Honest)](#17-known-limitations-honest)
18. [Production Deployment Checklist](#18-production-deployment-checklist)
19. [File Layout (Complete)](#19-file-layout-complete)

---

## 1. Executive Summary

ARIA Mission Control is a **complete autonomous AI company platform** — it
simulates a real MNC (Multi-National Corporation) with policies, hierarchy,
revenue operations, and autonomous workflows. The owner is the sole human
decision-maker; everything else is automated by a fleet of 57 AI agents across
15 departments.

**What it does (autonomously):**
- Discovers leads (web search + LLM scoring)
- Sends CAN-SPAM-compliant outreach emails (business-hours-aware)
- Verifies crypto + UPI + Stripe payments on-chain
- Builds deliverables (LLM-generated + sandbox-tested)
- Handles customer support (6 intent categories + WhatsApp inbound)
- Manages finances (revenue recognition, invoicing, KPIs)
- Self-improves (rules-auditor analyzes failures + proposes code changes)

**v61.2-bugfixed** is the result of:
1. **v61** — 6 phases of deep intelligence wiring (Council, Step-Debate,
   AgentEval, Zero-Assumption Guard, Production Gate, Agent Blackboard,
   Oracle Free-Tier, Rules-Auditor).
2. **v61.1** — 2 critical dead-code fixes (Production Gate wiring + Agent
   Blackboard enforcement) found by an independent audit.
3. **v61.2** — 8 bug fixes (3 CRITICAL + 3 MAJOR + 2 MINOR) found by a
   follow-up bug hunt on the v61.1 fixes.

---

## 2. The Permanent Goal + 8 Non-Negotiable Rules

> **THE GOAL (never deviate):** Simulate a real MNC company — its policies,
> system architecture, hierarchy, and everything it has to earn, manage, and
> automate — by using smart, creative, and intelligent logic.

### 8 Non-Negotiable Rules (from GOAL.md)

1. **Real MNC structure first** — every feature maps to a real business function.
2. **Hardening before features** — never add new until existing are production-grade.
3. **Daily owner standup mandatory** — forward-looking planning artifact.
4. **Owner approval with Q&A** — can ask/clarify/suggest before approving. Payments isolated (60s cooldown).
5. **$0 spend by default** — all models free (local Ollama, free-tier APIs). Paid models OFF by default + behind UI toggle.
6. **Business hours discipline** — owner + customer interactions only 9 AM – 6 PM in recipient's timezone.
7. **Never sit idle** — if an approval is deferred, agents pivot to the next available task.
8. **Inject prior results** — every implementation step injects the verified result of the prior step.

---

## 3. Complete Architecture (Layered)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    OWNER (sole human decision-maker)                 │
│   Telegram bot (/approve /deny /discuss /pay-approve /pause /resume) │
│   Dashboard (/dashboard — 9 tabs)                                    │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────┐
│              AUTONOMOUS BUSINESS ENGINE (top of stack)              │
│   8-stage lifecycle: FIND→QUALIFY→PLAN→EXECUTE→DELIVER→INVOICE→     │
│   TRACK→OPTIMIZE · 12 industry playbooks · runAutonomousCycle()     │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────┐
│                    CONDUCTOR (Orchestration)                         │
│   router.ts (AutonomyTag gate) + council.ts (3-4 agents) +          │
│   dispatcher.ts (blackboard + pivot)                                │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────┐
│                  WORKFLOW ENGINE (Execution)                         │
│   executeWorkflow() → step-debate.ts (Proposer→Critic→Refiner) +    │
│   production-gate.ts (verifyProductionReadiness) + zero-assumption   │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────┐
│                    HERMES (Agent Skills + Tools)                     │
│   skills.ts (12 embedded patterns) + memory.ts + toolsets.ts (vm) + │
│   learning.ts + earning-researcher.ts                                │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────┐
│                  LLM ROUTER (7-Provider Failover)                    │
│   routeLLM() → Z-AI → Groq → NVIDIA → Ollama (local) → [OpenAI/     │
│   Anthropic/Gemini available but skipped in free-tier mode]         │
│   Oracle Free-Tier: qwen2.5-coder:7b / llama3.2:3b / 1.5b           │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────┐
│                    DATABASE + EXTERNAL SERVICES                      │
│   Prisma (SQLite dev / PostgreSQL prod) · 50 models                  │
│   Resend (email) · Stripe · crypto-verifier · FreeSWITCH · WhatsApp  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. The 6 Agent Archetypes + 57-Agent Fleet

### 6 Archetypes (Notion "AI Company Map" compliance)

The 6 archetypes are an **emergent grouping by capability tag** in
`src/lib/simulation/fleet.ts` — they are NOT explicit enum values in code
(documented limitation, see §17).

| Archetype | Role | Representatives (file:line) |
|---|---|---|
| **Scouts** | Discover leads, research markets | Nova-ResearchLead `fleet.ts:59`, Hunter-SDRLead `:82`, Buzz-SocialLead `:96` |
| **Analysts** | Analyze data, assess feasibility | Prism-SrDataAnalyst `:62`, Quant-DataScientist `:64`, Ledger-Fin `:73`, Apex-Architect `:57` |
| **Builders** | Write code, build deliverables | Forge-Eng `:51`, Forge-SrEng `:50`, Aria-CTO `:49`, Shield-QA `:56` |
| **Publishers** | Create content, marketing | Quill-Content `:99`, Pixel-AdCreative `:100`, Spark-MarketingLead `:93` |
| **Groundskeepers** | Ops, compliance, finance | Pulse-Ops `:67`, Stack-DevOps `:54`, Guard-Compliance `:71`, Balance-Accountant `:76` |
| **Conductor** | Orchestrate the fleet | Maestro-Conductor `:124`, Aria-CEO `:45`, Sage-COO `:46` |

### 15 Departments
Executive, Engineering, Research, Operations, Finance, Sales, Support,
Marketing, Legal, Ethics, Communications, Community, Linguist, Clients,
Conductor.

---

## 5. Autonomy Stack (Top → Bottom)

| Layer | Component | File | Role |
|---|---|---|---|
| 7 | Autonomous Business Engine | `autonomous-business-engine.ts` | 8-stage lifecycle + 12 playbooks |
| 6 | Conductor | `conductor/router.ts` + `council.ts` + `dispatcher.ts` | Route by AutonomyTag + convene council + dispatch |
| 5 | Workflow Engine | `workflow-engine.ts` | Execute steps + inject prior results |
| 4 | Step Debate | `step-debate.ts` | Proposer → Critic → Refiner (high complexity) |
| 3 | Production Gate | `production-gate.ts` | Block TODO/FIXME/secrets (3-retry + halt) |
| 2 | Hermes | `hermes/skills.ts` + `toolsets.ts` + `memory.ts` | Skill patterns + vm sandbox + memory |
| 1 | LLM Router | `llm-router.ts` | 7-provider failover + Oracle free-tier |

---

## 6. Safety & Governance Controls (12-Layer Defense)

| # | Control | What it does | Enforced at (file:line) |
|---|---|---|---|
| 1 | **AutonomyTag enum** | HUMAN_LED → owner triggers; HUMAN_ASSISTED → Telegram approval; FULLY_AUTONOMOUS → runs | `conductor/router.ts:95-122` (workflows) + `:140-157` (skills); called at `workflow-engine.ts:340` + `hermes/skills.ts:93,156` |
| 2 | **Kill Switch** | `isAutonomyPaused()` halts all autonomous actions immediately | `autonomy-control.ts:49`; wired in `cron-scheduler.ts:909-911` + `workflow-engine.ts:300-312` |
| 3 | **Zero-Assumption Guard** | Halts + Telegram `/answer` if required context missing | `zero-assumption-guard.ts:41-96`; invoked at `workflow-engine.ts:607-644` |
| 4 | **Production Gate (v61.1+ v61.2)** | Blocks TODO/FIXME/DRAFT/secrets; 3-retry Refiner; escalates to NEEDS_CONTEXT | `production-gate.ts:37-107`; invoked at `step-debate.ts:101,166,169` + `workflow-engine.ts:591,606-627,588` |
| 5 | **Agent Blackboard (v61.1+ v61.2)** | Prevents 2 agents claiming same resource; blocks + pivots on conflict | `agent-blackboard.ts:54-179`; invoked at `dispatcher.ts:97-140` + `outreach-executor.ts:283-328` |
| 6 | **Payment Isolation** | Spend excluded from auto-decider; `/pay-approve` only; 60s cooldown | `approval-decision.ts:344-351` + `telegram-bot.ts:335-355,527-619` |
| 7 | **Business Hours** | Defers customer outreach to 9-18 in recipient tz | `business-hours.ts:29-54` + `outreach-executor.ts:213-240` |
| 8 | **Quality Supervisor** | Execution-based trajectory validation (stdout/exit); MAX_RETRIES=2 | `quality-supervisor.ts:37,133-240,378-428`; invoked at `services/builder.ts:420` |
| 9 | **Council Pattern** | Convenes 3-4 agents for high-complexity tasks | `council.ts:76-99,114-163`; invoked at `router.ts:69-90` |
| 10 | **Step-Debate** | Proposer → Critic → Refiner + previous-step injection | `step-debate.ts:113-134,79-84`; invoked at `workflow-engine.ts:544-563` |
| 11 | **2-Hour Deferral & Pivot** | Marks stalled approvals deferred; fleet pivots to non-blocked | `cron-scheduler.ts:566-627` + `simulation/engine.ts:441-470` + `dispatcher.ts:329 promoteNextNonBlockedTask` |
| 12 | **Rules-Auditor** | Self-improvement: analyzes failed traces, proposes code changes | `cron-scheduler.ts:633-755` + `execution-trace.ts:80-121` |

---

## 7. Advanced Cognitive Patterns (500-AI-Agents Inspired)

### 7.1 Council Pattern
- **What:** Before complex tasks, convene 3-4 relevant agents for perspectives, risks, resources.
- **Where:** `src/lib/conductor/council.ts`
- **Flow:** `conveneCouncil(taskContext)` → select 4 agents by domain → parallel LLM calls → aggregate risks/resources → Conductor synthesis.
- **Triggered:** `router.ts:69-90` when stepCount > 6 (high complexity).
- **Domain map:** `DOMAIN_COUNCIL` at `council.ts:76-84` (marketing/code/finance/sales/research/operations/general).

### 7.2 Step-Debate (Proposer → Critic → Refiner)
- **What:** For high-complexity/critical steps, run a 3-role micro-debate before committing.
- **Where:** `src/lib/step-debate.ts`
- **Flow:** Proposer generates → Critic reviews (bugs/secrets/constitution) → if not APPROVED, Refiner fixes → Production Gate validates → retry up to 3× → halt if still failing.
- **Previous-step injection:** `step-debate.ts:79-84` injects prior results into the prompt.
- **Triggered:** `workflow-engine.ts:544-563` when `stepComplexity === "high" || isCritical`.

### 7.3 AgentEval Trajectory Validation
- **What:** Execution-based validation (runs the code, checks stdout/exit codes) — not just syntax.
- **Where:** `src/lib/supervisors/quality-supervisor.ts`
- **Hard cap:** `MAX_RETRIES = 2` (line 37).
- **Flow:** `runTrajectoryValidation()` writes to temp dir → strips TS types → `execFileSync("node", [execPath])` → checks `expectExitCode`/`expectStdoutContains`/`forbidStdoutContains`.
- **Loop:** `reviewWithTrajectoryCap()` retries up to MAX_RETRIES, then escalates to owner.

---

## 8. Skill Patterns Approach (Embedded, Not External)

> **KEY DECISION (v61.2):** The app uses **embedded skill patterns** in
> `src/lib/skill-patterns.ts` — NOT the full 69-skill (40MB) ClawHub folder.
> This mirrors the "500-AI-Agents patterns" approach: the patterns/logics
> are in the code, not loaded from external files.

### 12 Embedded Skill Patterns

Defined in `src/lib/skill-patterns.ts:57-242`. Each pattern is self-contained
with: `slug`, `name`, `description`, `systemPrompt` (the core logic, ~1KB),
`fullContextPath` (optional pointer to the full SKILL.md, loaded only for
high-complexity tasks).

| # | Slug | System prompt | Full context (optional) |
|---|---|---|---|
| 1 | `llm` | `skill-patterns.ts:63` | `LLM/SKILL.md` |
| 2 | `vlm` | `:79` | `VLM/SKILL.md` |
| 3 | `tts` | `:95` | `TTS/SKILL.md` |
| 4 | `asr` | `:110` | `ASR/SKILL.md` |
| 5 | `image-gen` | `:125` | `image-generation/SKILL.md` |
| 6 | `video-gen` | `:140` | `video-generation/SKILL.md` |
| 7 | `web-search` | `:155` | `web-search/SKILL.md` |
| 8 | `page-reader` | `:170` | `web-reader/SKILL.md` |
| 9 | `docx` | `:186` | `docx/SKILL.md` |
| 10 | `pptx` | `:201` | `pptx/SKILL.md` |
| 11 | `xlsx` | `:216` | `xlsx/SKILL.md` |
| 12 | `pdf` | `:231` | `pdf/SKILL.md` |

### loadFullSkillContext() — Graceful Fallback

`skill-patterns.ts:283` — tries to load the full SKILL.md from the `skills/`
directory; if absent (production zip without the 40MB folder), **falls back
to `pattern.systemPrompt`** (line 309). The app runs fully self-contained.

### Why patterns, not the full folder?

1. **Size:** 40MB skills folder vs. 30KB embedded patterns.
2. **Maintainability:** Patterns are version-controlled code; external files drift.
3. **Deployability:** Single zip, no "mandatory 40MB folder" caveat.
4. **Sufficiency:** The 12 embedded systemPrompts cover all core capabilities
   (LLM, VLM, TTS, ASR, image/video-gen, web-search, page-reader, docx/pptx/
   xlsx/pdf). The full SKILL.md files add depth but are not required for
   production operation.

---

## 9. Operational Discipline

### 9.1 Business Hours
- `business-hours.ts:29-54` — `isWithinBusinessHours(tz, 9, 18)`.
- Uses `Intl.DateTimeFormat` with the recipient's timezone.
- `outreach-executor.ts:213-240` — defers to next 9 AM if outside hours.

### 9.2 2-Hour Deferral & Pivot
- `cron-scheduler.ts:566-627` — approval-reminder cron marks approvals
  pending > 2h as `deferredUntil = now + 2h`.
- `simulation/engine.ts:441-470` + `dispatcher.ts:329 promoteNextNonBlockedTask`
  — skips blocked tasks, promotes next non-blocked pending task.

### 9.3 Agent Blackboard (resource conflict prevention)
- `agent-blackboard.ts:54-112` — `postToBlackboard()` claims a resource;
  `isResourceClaimed()` checks before granting.
- `dispatcher.ts:97-140` — on conflict: marks task `status="blocked"`,
  calls `promoteNextNonBlockedTask()`, emits "🔄 Pivot triggered" SSE.
- `outreach-executor.ts:283-328` — claims `email:<addr>` before sending;
  on conflict → block + pivot. Releases on success AND failure (v61.2 fix).

---

## 10. Oracle Cloud Free Tier Optimization

### environment-detector.ts
- `:40-50` — detects `DEPLOYMENT_ENV` (`oracle-free-tier` / `cloud-restricted`).
- `:55-61` — detects RAM via `os.totalmem()` (cloud-restricted if < 16GB).
- `:79-101` — `getEnvironmentStatus()` returns structured constraint object.

### llm-router.ts (free-tier routing)
- `:856` — `FREE_ONLY_MODE=true` filters out paid providers (Z-AI, Groq, NVIDIA).
- `:868-878` — `DEPLOYMENT_ENV=oracle-free-tier` triggers free-tier mode.
- `:883-887` — `ORACLE_LIGHTWEIGHT_MODELS`: `qwen2.5-coder:7b` (STRONG),
  `llama3.2:3b` (BALANCED), `qwen2.5-coder:1.5b` (FAST).
- `:894-901` — provider ordering puts `ollama` first.

### ollama-client.ts
- `:48` — `http://127.0.0.1:11434` (local Ollama).
- `:377-385` — `POST /api/chat` with `{model, messages, stream:false}`.
- `:267` — auto-pull via `ollama pull <model>` (execFile, no shell).

---

## 11. Self-Improvement Loop

### Rules-Auditor Cron
- **Cron:** `cron-scheduler.ts:633` (registered at `:39`, runs every 6h).
- **Analyze:** `:635-636` → `execution-trace.ts:80-121` — fetches failed
  traces (`meta.retries > 1 || !meta.success`).
- **Group:** `:643-648` — groups by skill; only skills with ≥2 failures analyzed.
- **Propose:** `:661-672` — LLM prompt demands `RULE:`, `PROBLEM:`,
  `SUGGESTION:`, `PROPOSED_CODE_CHANGE:` (copy-pasteable TypeScript),
  `TARGET_FILE:`, `CONFIDENCE:`.
- **Parse + gate:** `:678-694` — regex parse; low-confidence (<0.6) dropped.
- **Approve:** `:697-718` — creates a pending Approval row (HUMAN_ASSISTED).
- **Notify:** `:722-739` — Telegram brief with the proposed change.

---

## 12. Complete Data Model (50 Prisma Models)

**Core (27):** Agent, Task, AgentLog, Event, MetricPoint, Approval, CronJob,
CronRun, LlmCall, SystemAlert, Skill, SubAgentTask, EarningOpportunity,
LearnedInsight, RevenueEvent, Deal, AgentMessage, MemoryItem, User, Account,
Session, VerificationToken, Personnel, CompanyProfile,
CompanyEarningOpportunity, SimulationRun, SimulationIteration.

**Intelligence (10):** SupervisorReview, Escalation, ABTest, CustomerFeedback,
KnowledgeBaseEntry, CompetitorAnalysis, ServiceOpportunity, EarningMethod,
SimulationReport, BusinessReview.

**Capabilities (12):** Credential, SystemAccessSession, SystemAccessApproval,
SystemAccessAction, Note, MilestoneEvent, KpiSnapshot,
AgentMarketplaceTemplate, ResearchLog, EcosystemRepo, Voicemail,
SupportTicket, Setting.

**Autonomy:** WorkflowDefinition (with `autonomyTag` enum + indexed),
Skill (with `autonomyTag` enum + indexed, default `HUMAN_ASSISTED`).

**Provider auto-switch:** `file:./...` → SQLite, `postgresql://...` → Postgres.

---

## 13. Complete API Surface (78+ Routes)

| Prefix | Routes | Purpose |
|---|---|---|
| `/api/auth/*` | NextAuth | Signup, signin, 2FA |
| `/api/settings/*` | GET, /env, /upi, /payment-qr | Runtime config (no secrets exposed) |
| `/api/conductor` | POST | Manual workflow dispatch |
| `/api/tasks` | GET, POST | Task management |
| `/api/approvals/*` | GET, /[id], /[id]/decision, /[id]/discuss, /[id]/oral-confirm | Approval queue |
| `/api/telegram/webhook` | POST | Telegram bot webhook |
| `/api/business-lifecycle/*` | /, /find, /qualify, /plan, /status | Autonomous business engine |
| `/api/industry-playbooks` | GET, POST | 12 industry playbooks |
| `/api/workflows` | GET, POST | Workflow definitions |
| `/api/debate/*` | /, /[id] | Multi-model debate |
| `/api/hermes/*` | /execute, /memory | Hermes skill execution |
| `/api/leads`, `/api/crm/*` | GET | Lead discovery + CRM |
| `/api/services/*` | catalog, checkout, upi, refund, preview | Service marketplace |
| `/api/webhooks/*` | resend, stripe, whatsapp | External webhooks (HMAC verified) |
| `/api/supervisors/reviews` | GET | Quality supervisor reviews |
| `/api/expansion/*` | service-opportunities, earning-methods | Expansion research |
| `/api/costs`, `/api/cost-dashboard` | GET | Cost tracking |
| `/api/kpis`, `/api/milestones` | GET, POST | KPIs + milestones |
| `/api/notes/*` | /, /[id] | Notes |
| `/api/image-gen`, `/api/computer-use` | POST | AI capabilities |
| `/api/export`, `/api/audit-log` | GET | Export + audit |
| `/api/autonomy/pause|resume` | POST | Kill switch |
| ... 50+ more | | |

---

## 14. Complete Cron Job Inventory (30+ Jobs)

| Job | Frequency | Purpose |
|---|---|---|
| `lead-finder-daily` | 6am | Web search + LLM scoring → EarningOpportunity |
| `outreach-executor` | 30min | Sends approved outreach emails |
| `crypto-verifier-poll` | 5min | Checks pending crypto payments on-chain |
| `service-builder-queue` | 1min | Builds pending paid orders |
| `support-agent-sweep` | 5min | Auto-resolves support tickets |
| `approval-reminder` | hourly | Marks >2h approvals deferred + pivots |
| `rules-auditor` | 6h | Analyzes failed traces, proposes code changes |
| `cash-claw-sweep` | 6h | Evolutionary agent survival classifier |
| `feasibility-rescore` | 6h | Monte Carlo P10/P50/P90 rescore |
| `failure-alchemy-sweep` | 30min | Antibody/vaccine/catalyst artifacts |
| `kpi-snapshot` | 6h | Aggregates revenue/tasks/agents/payments |
| `revenue-cycle` | 4h | 6-stage revenue pipeline |
| `milestone-check` | 10min | Records MilestoneEvent for achievements |
| `backup-service-daily` | 3am | SQLite dump → gzip → retention |
| `weekly-business-review` | Sun 8pm | LLM-generated weekly summary |
| `executive-supervisor-daily` | 11pm | Daily metrics + escalation |
| `health-sim-daily` | 6am | Probes 7 external APIs, auto-pause on failure |
| `competitor-analyzer-weekly` | Mon 9am | Web search → CompetitorAnalysis |
| `service-researcher-weekly` | Mon 10am | Discovers new service opportunities |
| `earning-method-researcher-weekly` | Mon 11am | Discovers new earning methods |
| `workflow-simulator-daily` | 6am | 10-point workflow health check |
| ... 10+ more | | |

All handlers in `src/lib/cron-scheduler.ts` (`JOB_HANDLERS` map). The 30s poll
loop in `runDueJobs` short-circuits on `isAutonomyPaused()` (line 909).

---

## 15. Complete Test Inventory (130 Tests)

| File | Tests | Covers |
|---|---|---|
| `tests/conductor-router.test.ts` | 25 | AutonomyTag routing + trajectory validation + quality supervisor (MAX_RETRIES=2) |
| `tests/production-gate.test.ts` | 16 | verifyProductionReadiness (TODO/FIXME/DRAFT/secrets/ellipsis/error-strings) + runStepDebate wiring + BUG-1/BUG-10 fixes |
| `tests/agent-blackboard.test.ts` | 7 | Core lock/conflict/release + dispatcher enforcement + pivot logic |
| `tests/cash-claw.test.ts` | 12 | Evolutionary agent survival classifier |
| `tests/two-factor.test.ts` | 13 | TOTP + backup codes (4 require bcryptjs) |
| `tests/rate-limiter.test.ts` | 7 | Rate limiting + IP extraction |
| `tests/rbac.test.ts` | 8 | RBAC permission matrix (owner/admin/viewer) |
| `tests/secure-crypto.test.ts` | 8 | AES-256-GCM + PBKDF2 + SHA-512 |
| `tests/feasibility.test.ts` | 2 | Monte Carlo P10/P50/P90 |
| `tests/api/openapi.test.ts` | 12 | OpenAPI spec generation |
| `tests/api/pagination.test.ts` | 8 | Pagination parsing + response shape |
| `tests/api/cache.test.ts` | 6 | In-memory cache TTL + eviction |
| `tests/api/tracing.test.ts` | 6 | Span tracing + stats |
| **Total** | **130** | **All pass** |

---

## 16. Audit History + Bug-Fix Log

### v61 — 6 Phases of Intelligence Wiring
- Phase 1: Payment isolation + approval briefs
- Phase 2: Customer timezone awareness + 2-hour deferral + pivot
- Phase 3: Zero-Assumption Guard
- Phase 4: Council Pattern + Agent Blackboard
- Phase 5: Production Gate + Step-Debate
- Phase 6: Oracle Free-Tier + Rules-Auditor

### v61.1 — 2 Critical Dead-Code Fixes (Independent Audit)
- **Fix 4b:** Production Gate wired into `step-debate.ts` + `workflow-engine.ts`.
- **Fix 5c:** Agent Blackboard wired into `dispatcher.ts` + `outreach-executor.ts`.
- 20 new tests added (107 → 127).

### v61.2 — 8 Bug Fixes (Follow-up Bug Hunt)
| # | Severity | File:line | Fix |
|---|---|---|---|
| 1 | CRITICAL | `step-debate.ts:169` | Off-by-one: `< MAX-1` → `< MAX` (shouldHalt now reached) |
| 2 | CRITICAL | `workflow-engine.ts:568` | `success=true` → `success=debateResult.productionReady` |
| 3 | CRITICAL | `workflow-engine.ts:583-598` | Debate-fallback catch now runs the gate |
| 4 | MAJOR | `outreach-executor.ts:338-347` | Blackboard release on "LLM drafting failed" |
| 5 | MAJOR | `outreach-executor.ts:405-413` | Blackboard release on "send failed" |
| 6 | MAJOR | `outreach-executor.ts:314-328` | `postToBlackboard` return checked (race condition) |
| 7 | MINOR | `dispatcher.ts:120-133` | Emit only when taskId defined |
| 10 | MINOR | `production-gate.ts:59` | Added `/(error:.*)/i` pattern |
| — | — | 3 new tests | BUG-1 + BUG-10 (2 tests) verification (127 → 130) |

---

## 17. Known Limitations (Honest)

⚠️ **6-archetype representation is doc-only** — no `archetype` column in Prisma
or field on the TS `Agent` type. Recoverable via capability inspection but not
compile-time enforced.

⚠️ **Council brief is logged but not consumed downstream** — `conveneCouncil()`
runs fire-and-forget; the brief is logged to `AgentLog` but not injected into
the workflow execution context.

⚠️ **Quality Supervisor coverage gap** — trajectory validation fires only on
the service-builder path (`services/builder.ts:420`), NOT on workflow-engine
LLM-call steps. Workflow steps go through step-debate + production gate instead.

⚠️ **Kill-switch fail-open** — both `cron-scheduler.ts:913` and
`workflow-engine.ts:314` swallow errors and continue if `autonomy-control.ts`
throws. Consider fail-CLOSED for `executeWorkflow()` in future hardening.

⚠️ **environment-detector.ts blind to `FREE_ONLY_MODE`** — only detects
`DEPLOYMENT_ENV`. `FREE_ONLY_MODE` is checked directly in `llm-router.ts:856`.
No CPU/ARM detection (memory only).

⚠️ **`promoteNextNonBlockedTask` `take: 10` cap** — if >10 pending tasks and
the oldest 10 are all blocked by deferred approvals, the fleet stalls despite
available work. Paginate or filter in the Prisma `where` clause.

---

## 18. Production Deployment Checklist

- [ ] `NODE_ENV=production`
- [ ] `JARVIS_DEV_BYPASS_AUTH=0`
- [ ] `NEXTAUTH_SECRET`, `ENCRYPTION_MASTER_KEY`, `ARIA_REALTIME_KEY` rotated
- [ ] `DATABASE_URL` → PostgreSQL for multi-instance
- [ ] `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` set (for approvals + halts)
- [ ] `bunx tsc --noEmit` → 0 errors
- [ ] `bun test` → 130/130 pass
- [ ] `bun run build` succeeds
- [ ] Production Gate verified (feed TODO → confirm NEEDS_CONTEXT halt)
- [ ] Agent Blackboard verified (2 agents same email → second blocked + pivoted)
- [ ] Kill Switch verified (`POST /api/autonomy/pause` → all crons halt)
- [ ] Security headers verified (`curl -I`)
- [ ] `/api/settings` returns NO secrets

---

## 19. File Layout (Complete)

```
ARIA Mission Control v61.2-bugfixed/
├── src/
│   ├── app/                          # Next.js 16 App Router
│   │   ├── api/                      # 78+ route handlers
│   │   ├── dashboard/                # /dashboard (9 tabs)
│   │   └── ...
│   ├── components/
│   │   ├── ui/                       # 65 shadcn/ui components
│   │   ├── mission/                  # 75+ dashboard panels
│   │   └── landing/                  # public landing page
│   ├── lib/                          # server-only modules (60+ files)
│   │   ├── conductor/                # router + council + dispatcher
│   │   ├── hermes/                   # skills + memory + toolsets
│   │   ├── supervisors/              # quality-supervisor
│   │   ├── intelligence/             # sandbox + ab-testing + feedback
│   │   ├── expansion/                # service-researcher + designer
│   │   ├── services/                 # catalog + builder + crypto-checkout
│   │   ├── stripe-checkout/          # Stripe Checkout
│   │   ├── simulation/               # fleet + engine + seed
│   │   ├── production-gate.ts        # ✅ v61.1 fix (actively invoked)
│   │   ├── agent-blackboard.ts       # ✅ v61.1 fix (actively invoked)
│   │   ├── step-debate.ts            # ✅ v61.1 fix + v61.2 BUG-1 fix
│   │   ├── workflow-engine.ts        # ✅ v61.1 fix + v61.2 BUG-2/3 fix
│   │   ├── conductor/dispatcher.ts   # ✅ v61.1 fix + v61.2 BUG-7 fix
│   │   ├── outreach-executor.ts      # ✅ v61.1 fix + v61.2 BUG-4/5/6 fix
│   │   ├── skill-patterns.ts         # ✅ 12 embedded patterns (no external skills/ needed)
│   │   └── ...
│   ├── stores/                       # Zustand (8 capped collections)
│   └── proxy.ts                      # Next.js 16 middleware (JWT gate)
├── prisma/schema.prisma              # 50 models + AutonomyTag enum
├── tests/                            # 130 tests (13 files)
│   ├── production-gate.test.ts       # ✅ 16 tests (v61.1 + v61.2)
│   ├── agent-blackboard.test.ts      # ✅ 7 tests (v61.1)
│   └── ...
├── docs/
│   ├── ENHANCED-OVERVIEW-v61.2.md    # ✅ THIS FILE (the definitive overview)
│   ├── BUILD-RULES-v61.md            # Build rules (v61.1 + v61.2 notes)
│   ├── AUDIT-REPORT.md               # Independent audit report
│   ├── AGENT-OPERATOR-MANUAL.md      # Agent + operator manual
│   ├── MASTER-GUIDE.md               # Architecture guide
│   ├── ULTIMATE-MASTER-OVERVIEW.md   # Prior overview (superseded)
│   └── CHANGELOG-v61.2.md            # ✅ v61.2 changelog
├── mini-services/realtime/           # socket.io sidecar (port 3003)
├── setup.sh                          # ✅ v61.2 setup (Linux/macOS)
├── setup.ps1                         # ✅ v61.2 setup (Windows)
├── README.md                         # ✅ v61.2 README
├── GOAL.md                           # Permanent north star
├── package.json                      # Bun + Next.js 16 + Prisma 6
└── prisma/schema.prisma              # 50 models
```

**Note:** The `skills/` folder (69 ClawHub skills, 40MB) is **NOT included** —
the app uses the 12 embedded patterns in `src/lib/skill-patterns.ts` instead
(see §8). `loadFullSkillContext()` falls back to `pattern.systemPrompt` when
the folder is absent.

---

*End of Enhanced Overview v61.2-bugfixed.*
