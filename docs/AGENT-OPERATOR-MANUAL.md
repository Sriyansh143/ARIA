# ARIA Mission Control — Agent Operator Manual & System Constitution (v60)

> **Single source of truth for both humans and AI agents.**
> Build: `v60.0.0-final-clean + Patch 1` · 107/107 tests pass · 0 TypeScript errors · 8/8 chaos tests pass · 0 build warnings.
> Last updated: 2026-08-17. File path: `docs/AGENT-OPERATOR-MANUAL.md`.

This document is the **operator manual** that AI agents (Echo-Support, Atlas-PM, Nova-Research, Forge-Eng, etc.) ingest into their Vector Memory before being granted autonomous control of the platform. It is also the **owner-facing reference** that a human operator reads to understand what the system can and cannot do, where every capability lives in the codebase, and which guardrails can never be crossed.

If a fact is not in this manual, the agent must treat it as unknown and escalate. Agents are forbidden from inventing APIs, env vars, or tabs that are not enumerated here.

---

## Table of Contents

1. [Executive Summary & Industry Benchmark](#1-executive-summary--industry-benchmark)
2. [Complete Capability Matrix](#2-complete-capability-matrix)
3. [Hard Limitations & Boundaries](#3-hard-limitations--boundaries)
4. [UI/UX Navigation Guide](#4-uiux-navigation-guide)
5. [Autonomy Tag Enforcement Protocol](#5-autonomy-tag-enforcement-protocol)
6. [Direct API Integration Map](#6-direct-api-integration-map)
7. [Agent Operating Rules (The Constitution)](#7-agent-operating-rules-the-constitution)

---

## 1. Executive Summary & Industry Benchmark

ARIA Mission Control is an **autonomous, multi-agent MNC operating system** — a single Bun + Next.js 16 application that boots an entire company of 66 AI agents across 15 departments and lets them discover leads, send outreach, verify payments, build software, deliver invoices, and handle customer support without human intervention. The owner only intervenes via the dashboard, Telegram bot, or autonomous approval queue.

### What makes ARIA different

ARIA is not a chatbot framework, not a workflow runner, and not a single-agent dev tool. It is a vertical company-OS that combines:

- An **agent fleet** (66 named agents with roles, tiers, departments, system prompts, capabilities) — see `src/lib/simulation/fleet.ts`
- A **workflow + skill router** that enforces a 3-level autonomy policy (`HUMAN_LED` / `HUMAN_ASSISTED` / `FULLY_AUTONOMOUS`) on every execution — `src/lib/conductor/router.ts`
- A **quality supervisor** that actually executes the generated code in a sandbox and asserts on stdout / exit code / HTTP response (not just `node --check`) — `src/lib/supervisors/quality-supervisor.ts`
- A **payment + delivery pipeline** that accepts crypto / UPI / Stripe and ships real zipped deliverables to the buyer — `src/lib/services/builder.ts`, `src/lib/crypto-verifier.ts`, `src/lib/upi-payments.ts`, `src/lib/stripe-checkout/index.ts`
- A **resilience layer** with HTML-resilient LLM routing, global autonomy kill switch, SQLite write queue, and constant-time mini-service auth — `src/lib/llm-router.ts`, `src/lib/autonomy-control.ts`, `src/lib/db-write-queue.ts`, `mini-services/lib/auth-middleware.ts`
- A **zero-config bootstrap** so the app runs from a fresh clone with no manual secret generation — `src/lib/auto-bootstrap.ts`, `src/lib/db-schema-ensure.ts`

### Comparison Matrix — ARIA vs Industry

| Capability | ARIA v60 | Devin AI | CrewAI | AutoGen | Salesforce Agentforce | LangChain / LangGraph |
|---|---|---|---|---|---|---|
| **Agent fleet size** | 66 named agents, 15 depts | 1 cloud SWE | User-defined (no fixed roster) | User-defined | Pre-built CRM agents | User-defined |
| **Autonomy policy** | DB enum + DB-enforced router with Telegram approval queue | None (single-agent) | None | None | CRM-specific approval flows | None (developer builds it) |
| **Execution-based trajectory validation** | YES — runs the code + asserts on stdout/exit-code/HTTP | YES (private impl) | NO (LLM judge only) | NO | NO | Optional (LangGraph Graph) |
| **Hard retry cap (MAX_RETRIES=2)** | YES — escalates to owner instead of looping | Unknown | NO (unbounded) | NO | NO | NO |
| **HTML-resilient LLM router** | YES — detects HTML responses + 10-min cooldown | Unknown | NO | NO | NO | NO |
| **Global autonomy kill switch** | YES — API + Telegram `/pause` + dashboard | NO | NO | NO | NO | NO |
| **SQLite write queue (no SQLITE_BUSY)** | YES — 100ms flush + 3 retries | N/A | N/A | N/A | N/A | N/A |
| **Constant-time mini-service auth** | YES — `X-JARVIS-Key` | N/A | N/A | N/A | N/A | N/A |
| **Real payment verification** | YES — Etherscan + BlockCypher + Solana RPC + TronGrid + UPI + Stripe | NO | NO | NO | NO | NO |
| **Zero-config auto-bootstrap** | YES — generates secrets + schema + seeds fleet on first boot | NO | NO | NO | NO | NO |
| **Outreach with CAN-SPAM** | YES — Sales + Compliance supervisors, suppression list, A/B testing | NO | NO | NO | NO | NO |
| **Free local LLM** | YES — Ollama (qwen2.5:3b/7b/14b) | NO | NO | NO | NO | NO |

### Where ARIA exceeds the field

1. **Execution-based trajectory validation** — Devin AI is the only commercial competitor that actually runs generated code. ARIA v59+ closes this gap and is open-source-able.
2. **Strict autonomy tags** — No other framework enforces a DB-level enum that gates every execution. CrewAI and AutoGen let agents do anything; ARIA blocks by default.
3. **Zero-config resilience** — HTML-resilient router + SQLite write queue + global kill switch + chaos tests are not bundled in any competitor.

### Where ARIA differs (intentionally)

- ARIA is **company-first**, not agent-first. The agent exists to serve the company's revenue + support mission, not to demonstrate general intelligence.
- ARIA is **owner-gated for money**. No HUMAN_LED or HUMAN_ASSISTED workflow can be auto-executed by a cron job — even if the agent thinks it's safe.
- ARIA **doesn't ship a public SDK** for third-party agents. The fleet is closed; agents are seeded by `src/lib/simulation/seed.ts`.

---

## 2. Complete Capability Matrix

Every row references the exact file or directory that powers it. Agents must consult this matrix before assuming a feature exists.

### 2.1 Agent Orchestration

| Capability | Module / File | Notes |
|---|---|---|
| 66-agent fleet (15 departments) | `src/lib/simulation/fleet.ts` | Hierarchy: Lead/Senior/Junior per dept. Named agents: Aria-CEO, Sage-COO, Ledger-CFO, Aria-CTO, Forge-Eng, Stack-DevOps, Shield-QA, Apex-Architect, Nova-Research, Prism-DataAnalyst, Quant-DataScientist, Pulse-Ops, Atlas-PM, Guard-Compliance, Ledger-Fin, Balance-Accountant, Swift-Payments, Vector-SalesLead, Closer-AE, Hunter-SDR, Nexus-CRM, Echo-Support, Care-Success, Spark-Marketing, Buzz-Social, Quill-Content, Pixel-AdCreative, etc. |
| Tier-based model selection | `src/lib/llm-router.ts` → `classifyComplexity()` | Strong / Balanced / Fast tiers map to per-provider model IDs (e.g., `qwen2.5:14b` for strong, `:7b` for balanced, `:3b` for fast) |
| Subagent delegation | `src/lib/conductor/dispatcher.ts` | `spawn_subagent({ department, role, task })` finds best-fit agent, creates `SubAgentTask`, runs isolated loop, returns concise summary |
| Agent tick loop (15s default) | `src/lib/simulation/engine.ts` → `tick()` | Sequential per agent (avoids LLM rate-limit spikes). Honors autonomy pause. |
| Approval workflow | `src/lib/approval-brief.ts`, `src/lib/approval-decision.ts`, `prisma/schema.prisma` → `Approval` model | HUMAN_ASSISTED tasks create a pending Approval row + send a Telegram brief; agent polls `isApprovalResolved()` |
| 107 passing tests | `tests/*.test.ts`, `tests/api/*.test.ts` | Run `bun test ./tests/*.test.ts ./tests/api/*.test.ts`. Playwright e2e tests are excluded — run via `bunx playwright test`. |

#### Agent archetypes (functional grouping — agents self-classify by capability set)

ARIA does not literally call these "Scouts/Analysts/Builders/Publishers/Groundskeepers/Conductor" in code — they are an emergent grouping by capability tag in `fleet.ts`. Agents reading this manual should map their role to the archetype that matches their capabilities:

| Archetype | Representative Agents | Department | What they do |
|---|---|---|---|
| **Scouts** | Nova-Research, Hunter-SDR, Buzz-Social | Research / Sales / Marketing | Discover leads, scan competitors, monitor social trends. Use `web_search` tool + Z-AI SDK. |
| **Analysts** | Prism-DataAnalyst, Quant-DataScientist, Ledger-Fin, Apex-Architect | Research / Finance / Engineering | Score leads, forecast revenue, design architecture. Use `execute_code` + `search_memory`. |
| **Builders** | Forge-Eng, Forge-SrEng, Aria-CTO, Shield-QA | Engineering | Generate code, run quality gate, sandbox-test, ship deliverable. Use `execute_code` + `execute_skill`. |
| **Publishers** | Quill-Content, Pixel-AdCreative, Spark-Marketing | Marketing | Draft blog posts, ad copy, social posts. Use `execute_skill` (blog-writer, seo-content-writer). |
| **Groundskeepers** | Pulse-Ops, Stack-DevOps, Guard-Compliance, Balance-Accountant | Operations / Finance | Monitor health, run cron jobs, audit compliance, reconcile books. Use `cron` + `monitor` APIs. |
| **Conductor** | Aria-CEO, Sage-COO | Executive | Route work, approve escalations, set strategy. Uses `routeWorkflowByAutonomy()` + `dispatchToAgent()`. |

### 2.2 Workflow Execution

| Capability | Module / File | Notes |
|---|---|---|
| Claude-level planner (asks clarifying questions before planning) | `src/lib/planner.ts` → `analyzeTask()`, `generatePlan()`, `questionBeforeExecution()` | Mock mode when `ARIA_LLM_DISABLED=1`. |
| DAG planner | `src/lib/planner.ts` → `ExecutionPlan` interface | Steps with risks + approval gating per step. |
| Skill execution | `src/lib/hermes/skills.ts` → `discoverSkills()`, `loadSkillInstructions()`, `executeSkill()` | 69 ClawHub skills loaded from `skills/` directory. |
| Hermes tool calling | `src/lib/hermes/toolsets.ts` → `TOOL_DEFINITIONS`, `executeToolCall()` | 7 tools: `execute_code`, `web_search`, `spawn_subagent`, `create_memory`, `search_memory`, `create_skill`, `execute_skill`. |
| Browser automation (Playwright) | `src/lib/supervisors/quality-supervisor.ts:120` (TODO marker) | Currently NOT wired — Playwright render-assert is a roadmap item. The supervisor runs static + dry-run trajectory only. |
| Memory network | `src/lib/hermes/memory.ts` → `searchMemory()`, `storeMemory()` | Vector-style recall via `MemoryItem` Prisma model. |
| Workflow engine | `src/lib/workflow-engine.ts`, `src/lib/workflow-templates.ts` | Executes `WorkflowDefinition` rows. |
| Workflow templates | `src/lib/workflow-templates.ts` | Pre-built templates for common flows. |

### 2.3 Business Operations

| Capability | Module / File | Notes |
|---|---|---|
| CRM 6-stage pipeline | `src/lib/crm.ts` → `Lead.stage` enum | Stages: `new → qualified → proposal → negotiation → won → lost`. Stored as `Deal` rows. |
| Revenue tracking | `prisma/schema.prisma` → `RevenueEvent`, `ServiceOrder` | Single source of truth. `ServiceOrder.status`: `pending_payment → paid_verified → building → delivered → failed → refunded`. |
| Crypto payments (BTC/ETH/SOL/USDT/USDC) | `src/lib/crypto-verifier.ts` | Verifies on-chain via Etherscan + BlockCypher + Solana RPC + TronGrid. Confirmation thresholds: BTC=3, ETH=12, SOL=32, USDT=12, USDC=12. |
| UPI payments (India) | `src/lib/upi-payments.ts` | VPA validation, QR image upload, UTR claim, owner approve/reject. |
| Stripe Checkout | `src/lib/stripe-checkout/index.ts` | Checkout Sessions + webhook with signature verification. |
| Service catalog (10 services, $9-$99) | `src/lib/services/catalog.ts` | Static catalog: blog-post $9, landing-page $19, cli-tool $24, voice-agent $39, dashboard $39, api-docs $34, website-static $29, 3d-website $49, api-service $49, saas-scaffold $99. |
| Service builder | `src/lib/services/builder.ts` → `buildService()`, `runQualityGate()` | Multi-file LLM output + quality gate + sandbox retry. |
| Invoice generator | `src/lib/invoice-generator.ts` | HTML invoices printable to PDF. |
| Earning-method researcher | `src/lib/expansion/earning-method-researcher.ts` | Daily discovery of 8 earning method categories (SaaS, content, services, affiliate, data, automation, marketplace, whitelabel). |
| Service-researcher | `src/lib/expansion/service-researcher.ts` | Weekly discovery of new service opportunities via web search + LLM. |
| Workflow simulator | `src/lib/expansion/workflow-simulator.ts` | 10-point daily health check. |

### 2.4 Resilience & Safety

| Capability | Module / File | Notes |
|---|---|---|
| HTML-resilient LLM router | `src/lib/llm-router.ts` → `safeJsonParse()`, `ProviderHtmlError`, `handleProviderError()` | Detects HTML responses (Cloudflare 502, nginx overload). Cools down provider 10 min. Falls back to next provider. |
| Global autonomy kill switch | `src/lib/autonomy-control.ts` → `isAutonomyPaused()`, `setAutonomyPausedWithReason()` | Stored in `Setting.key="autonomy.paused"`. Honored by `cron-scheduler.runDueJobs()` + `outreach-executor.runOutreachExecutor()`. |
| SQLite write queue | `src/lib/db-write-queue.ts` → `safeWrite()`, `safeWriteBatch()`, `getQueueStats()` | 100ms flush, 3 retries with exponential backoff on `SQLITE_BUSY`, max queue depth 1000. |
| Quality supervisor hard cap | `src/lib/supervisors/quality-supervisor.ts` → `MAX_RETRIES = 2` | If 2 retries fail, escalate to owner — never loop forever. |
| Mini-service internal auth | `mini-services/lib/auth-middleware.ts` | Constant-time `X-JARVIS-Key` verification. Applied to `mini-services/realtime/`. |
| Chaos monkey tests | `scripts/chaos-test.ts` | 8 tests: HTML-resilient router, autonomy pause/resume, DB write queue flood, constant-time comparison, auth middleware, ProviderHtmlError. |
| Health-sim (daily 6am) | `src/lib/health-sim.ts` | Probes 7 external APIs, auto-pauses outreach on failure. |
| Backup service | `src/lib/backup-service.ts` | SQLite dump → gzip → retention (daily 3am). |
| Pre-launch smoke test | `scripts/pre-launch-smoke-test.sh`, `.ps1` | 9 security checks before going live. |
| Auto-bootstrap (zero-config) | `src/lib/auto-bootstrap.ts`, `src/lib/db-schema-ensure.ts` | Generates NEXTAUTH_SECRET + ENCRYPTION_MASTER_KEY, copies .env.example → .env, applies Prisma schema, seeds fleet, starts engine — on first boot. |

### 2.5 External Integrations

| Capability | Module / File | Notes |
|---|---|---|
| LLM providers (7) | `src/lib/llm-router.ts` | Z-AI (default), Groq, NVIDIA NIM, OpenAI, Anthropic, Gemini, Ollama. Per-provider RPM limits + circuit breaker. |
| Telephony (4) | `src/lib/telephony.ts` | FreeSWITCH (ESL), Dograh (REST, India), Twilio (REST with TwiML), WebRTC (browser). Safety gate: `AI_CALLER_ENABLED=true` + `AI_CALLER_CONSENT_VERIFIED=true`. |
| Email (Resend) | `src/lib/email-service.ts` | CAN-SPAM compliant, refuses sandbox address, web-push on success only. |
| WhatsApp Business Cloud API | `src/lib/whatsapp/business.ts` | HMAC signature verification. |
| Telegram bot | `src/lib/telegram-bot.ts`, `src/app/api/telegram/webhook/route.ts` | 5 commands: `/status`, `/pause`, `/resume`, `/health`, `/help`. |
| Web Push (VAPID) | `src/lib/notifications.ts` | Browser push for delivery + refund events. |
| Lead gen enrichment (5 APIs) | `src/lib/lead-finder.ts` | Apollo, Hunter, Snov, Clearbit, ZoomInfo — selectable via `ARIA_SEARCH_PROVIDER` env var. Default: `zai` (free web_search). |
| Credential Vault | `src/lib/credential-vault.ts`, `src/lib/secure-crypto.ts` | AES-256-GCM encrypted. Master key: `ENCRYPTION_MASTER_KEY` env var. |
| Public APIs repo integration | Pattern, not hard-coded | Agents can dynamically add data-fetching skills by writing a new entry in `prisma Skill` table with `autonomyTag=FULLY_AUTONOMOUS` and a script that calls a public API (e.g., OpenExchangeRates, OpenWeatherMap, Nominatim geocoding, REST Countries, Wikipedia). See Section 6 for the integration pattern. |

#### How to add a new Public-API-powered skill (no code changes needed)

Agents can extend ARIA's data-fetching capabilities without modifying source code:

1. Pick a free public API from the [Public APIs repository](https://github.com/public-apis/public-apis) (e.g., ExchangeRate, OpenWeatherMap, REST Countries, Nominatim, Wikipedia).
2. Insert a `Skill` row in the database:
   ```sql
   INSERT INTO Skill (id, name, slug, description, autonomyTag, script, isActive, createdAt, updatedAt)
   VALUES (
     'skill-fx-rates',
     'FX Rates Fetch',
     'fx-rates-fetch',
     'Fetches USD→INR/GBP/EUR exchange rates from open.er-api.com',
     'FULLY_AUTONOMOUS',
     'await fetch("https://open.er-api.com/v6/latest/USD").then(r=>r.json())',
     1,
     datetime('now'), datetime('now')
   );
   ```
3. The agent invokes `execute_skill({ skillId: 'skill-fx-rates' })` via the Hermes toolset.
4. The conductor router checks `autonomyTag` — if `FULLY_AUTONOMOUS`, the skill runs directly (Quality Supervisor trajectory-validates post-hoc).

This is how ARIA dynamically grows its data-fetching surface area without code changes.

---

## 3. Hard Limitations & Boundaries

These guardrails cannot be bypassed by any agent, including the Conductor.

### 3.1 Technical Limits

| Limit | Reason | Where enforced |
|---|---|---|
| No multi-tenant SaaS mode | App is single-operator by default. Multi-tenant is opt-in via `JARVIS_MULTI_TENANT=true` but is NOT production-hardened. | `src/lib/auth.ts`, `src/lib/rbac.ts` |
| Local video generation requires ComfyUI | Video-gen skills call a local ComfyUI endpoint; no cloud fallback. | `skills/video-generation/` |
| Z-AI free tier: 5 RPM | Hard cap. Router cools down for 60s on 429. | `src/lib/llm-router.ts` → `ARIA_LLM_RPM_ZAI` |
| Groq free tier: 30 RPM, 14400/day | Hard cap. | `ARIA_LLM_RPM_GROQ` |
| NVIDIA NIM free tier: 1000 req/day | Hard cap. | `ARIA_LLM_RPM_NVIDIA` |
| SQLite single-writer | Concurrent writes can throw `SQLITE_BUSY`. Mitigated by `db-write-queue.ts` (100ms flush). | `src/lib/db-write-queue.ts` |
| Playwright browser automation NOT wired | The quality supervisor runs static + dry-run trajectory only. Playwright render-assert is a roadmap item. | `src/lib/supervisors/quality-supervisor.ts:120` |
| Daily outreach limit defaults to 10 | Warmup protection. Increase to 50 after day 15+. | `ARIA_OUTREACH_DAILY_LIMIT` env var |
| LLM daily budget defaults to $1.00 | Hard ceiling on cloud LLM spend. | `LLM_DAILY_BUDGET_USD` env var |
| Max queue depth 1000 (write queue) | Safety valve — drops oldest if exceeded. | `src/lib/db-write-queue.ts` |
| Chaos test for "kill + restart mini-service" not implemented | Would need a real running mini-service to test. | `scripts/chaos-test.ts` |

### 3.2 Security Limits

| Limit | Reason | Where enforced |
|---|---|---|
| Sandbox escape prevention | Code execution runs in `node:vm` context with NO `require`, NO `process`, NO `global`, NO `fetch`, NO `fs`. Hard 5-second timeout. | `src/lib/hermes/toolsets.ts` → `executeCode()` |
| Credential Vault isolation | Master key (`ENCRYPTION_MASTER_KEY`) is read from env, never written to DB. AES-256-GCM. | `src/lib/credential-vault.ts`, `src/lib/secure-crypto.ts` |
| Forbidden shell commands | `ALLOW_TERMINAL_EXEC=false` by default. Even when true, only allowlisted commands run. | `src/lib/computer-use.ts` |
| Mini-service auth required | All internal HTTP requests to mini-services must include `X-JARVIS-Key` header (constant-time comparison). | `mini-services/lib/auth-middleware.ts` |
| Webhook signature verification fail-closed | Resend + Stripe + WhatsApp webhooks refuse to process if signature secret is missing or invalid. | `src/app/api/webhooks/resend/route.ts`, `src/app/api/webhooks/stripe/route.ts`, `src/app/api/whatsapp/webhook/route.ts` |
| Public routes explicitly allowlisted | `src/proxy.ts` has a fail-closed auth gate. Only listed prefixes are public. | `src/proxy.ts` → `PUBLIC_API_PREFIXES` |
| 2FA TOTP required for owner | Owner account must enroll in 2FA on first login. | `src/lib/two-factor.ts`, `src/app/api/2fa/` |

### 3.3 Autonomy Limits

| Limit | Reason | Where enforced |
|---|---|---|
| HUMAN_LED workflows cannot be auto-run | The owner must trigger them manually via the dashboard. Cron + agents refuse. | `src/lib/conductor/router.ts` → `routeWorkflowByAutonomy()` |
| HUMAN_ASSISTED workflows must wait for `isApprovalResolved()` | Agent drafts + queues Telegram brief, then BLOCKS until owner decides. | `src/lib/conductor/router.ts` → `queueTelegramApproval()` |
| Agents cannot auto-approve financial transactions | All `ServiceOrder` refunds, owner-approve UPI claims, and Stripe refunds require owner action. | `src/app/api/services/refund/route.ts`, `src/app/api/services/upi/approve/route.ts` |
| Agents cannot bypass the Telegram approval queue | The `Approval` row is the single source of truth. Agents can only poll. | `src/lib/conductor/router.ts` → `isApprovalResolved()` |
| Global autonomy kill switch cannot be bypassed | When `autonomy.paused=true`, ALL cron jobs + tick loop short-circuit. | `src/lib/autonomy-control.ts`, `src/lib/cron-scheduler.ts`, `src/lib/outreach-executor.ts` |
| AI caller safety gate | Both `AI_CALLER_ENABLED=true` AND `AI_CALLER_CONSENT_VERIFIED=true` (literal strings) required for any outbound call/SMS. | `src/lib/telephony.ts` → `isAiCallerAllowed()` |
| Outreach requires CAN-SPAM compliance | Unsubscribe link + sender address + sender identification in every email. | `src/lib/email-service.ts`, `src/lib/outreach-executor.ts` |
| No agent may modify `prisma/schema.prisma` at runtime | Schema changes require owner intervention + `bunx prisma db push`. | N/A — schema is read-only at runtime |

---

## 4. UI/UX Navigation Guide

This section maps the dashboard tabs to their URL paths, key UI elements, and expected agent actions. Agents using the browser-agent skill should reference these exact labels.

The dashboard is a single-page app at `/dashboard`. There is **no per-tab URL** (state is in React `useState`, not the URL). To switch tabs programmatically, an agent must click the tab button by its label.

### 4.1 Tab Bar (sticky, top of dashboard)

The tab bar is sticky at `top: 14` (below the `MissionHeader`). Tabs are rendered as buttons in this exact order (left-to-right):

| # | Tab Label | Tab ID | Icon | Shortcut |
|---|---|---|---|---|
| 1 | Overview | `overview` | Layout | `1` |
| 2 | Live Screen | `screen` | Monitor | `2` |
| 3 | Operations | `operations` | Activity | `3` |
| 4 | Agents | `agents` | Network | `4` |
| 5 | Intel | `intel` | Brain | `5` |
| 6 | Leads | `leads` | Target | `6` |
| 7 | Revenue | `revenue` | DollarSign | `7` |
| 8 | Finance | `finance` | TrendingUp | `8` |
| 9 | Supervisors | `supervisors` | Shield | `9` |
| 10 | Training | `training` | GraduationCap | `10` |
| 11 | Market Intel | `market` | TrendingUp | `11` |
| 12 | Security | `security` | Shield | `12` |
| 13 | More | `more` | MoreHorizontal | `13` |

Keyboard shortcuts: press `1`-`13` to jump to a tab (must not be in an input/textarea/select).

### 4.2 Per-Tab Detail

#### Tab 1 — Overview (`overview`)
- **Key UI Elements:**
  - `OptimalEngine` panel (left 2/3) — shows the agent network graph + C-suite meeting summary
  - `CsuiteMeeting` panel (right 1/3) — recent executive decisions
  - `SpeakingAssistant` — voice-driven assistant (top)
  - `ResearchAnimation` — research lab animation (LazyMount)
  - `EmployeesAnimation` — office floor animation (LazyMount)
- **Expected Agent Action:** Monitor the live agent network for stalled agents. Click any agent node to open the `AgentDetailDrawer` and inspect its current task + LLM call history.

#### Tab 2 — Live Screen (`screen`)
- **Key UI Elements:**
  - `LiveScreenPanel` — Gemini-style screen sharing + VLM analysis
  - "Start Sharing" button (top-right)
  - VLM analysis output panel (bottom)
- **Expected Agent Action:** Use this tab to share the owner's screen with the VLM agent for visual debugging. Not used by autonomous agents.

#### Tab 3 — Operations (`operations`)
- **Key UI Elements:**
  - `AgentCommandConsole` — free-text command input (top)
  - `ActivityStreamPanel` — real-time SSE event feed
  - `WorkflowPanel` — list of running workflows
  - `TaskDagView` — DAG visualization (LazyMount)
  - `TaskPipeline` (left, id=`task-pipeline`) — task list with "Create Task" button
  - `ApprovalsQueue` (right, id=`approval-queue`) — pending approvals with "Open Brief" button
- **Expected Agent Action:** Monitor the Activity Stream for cron completion events. Use the Command Console to dispatch one-off tasks. Approve / deny pending approvals from the Approvals Queue.

#### Tab 4 — Agents (`agents`)
- **Key UI Elements:**
  - `AgentAnalyticsPanel` — top-level KPIs (top)
  - `AgentRoster` (id=`agent-fleet`) — full agent list with "Spawn Sub-Agent" button (in the Roster sub-view)
  - `AgentNetworkGraph` — interactive network visualization
  - `AgentCapabilityMatrix` — capability × agent heatmap (LazyMount)
  - `AgentPerformanceLeaderboard` — top performers (LazyMount)
- **Expected Agent Action:** Click any agent row in the Roster to open `AgentDetailDrawer`. Use "Spawn Sub-Agent" to delegate a task to a new sub-agent (creates `SubAgentTask` row).

#### Tab 5 — Intel (`intel`)
- **Key UI Elements:**
  - `AiInsightsPanel` — LLM-generated insights
  - `ResearchLearningPanel` — research lab output
  - `MemoryNetworkGraph` (id=`memory-network`, LazyMount) — vector memory visualization
  - `MetricsDashboard` (LazyMount) — system metrics
  - `SystemHealthGauge` (LazyMount) — health indicator
  - `KnowledgeBasePanel` — KB entries (failure patterns, code patterns, FAQs)
- **Expected Agent Action:** Consult the Knowledge Base before executing a novel task — failure patterns from prior attempts are recorded here.

#### Tab 6 — Leads (`leads`)
- **Key UI Elements:**
  - `LeadFinderPanel` — autonomous lead discovery results
  - "Run Lead Finder Now" button
  - Lead list with confidence scores (0-100)
- **Expected Agent Action:** Trigger lead discovery on demand. Review high-confidence leads (≥70) and queue them for outreach.

#### Tab 7 — Revenue (`revenue`)
- **Key UI Elements:**
  - `RevenueLoopPanel` — autonomous outreach funnel + analytics
  - Funnel stages: Discovered → Qualified → Contacted → Replied → Paid → Delivered
  - Conversion rate sparkline chart
- **Expected Agent Action:** Monitor conversion rates. If reply rate drops below 5%, pause outreach and investigate email copy.

#### Tab 8 — Finance (`finance`)
- **Key UI Elements:**
  - `CostDashboardPanel` — LLM cost breakdown (top)
  - `DealKanbanPanel` — deal pipeline kanban
  - `FinancialDashboard` (id=`financial`) — revenue + expenses
  - `RevenueForecast` (LazyMount)
  - `CostProfitAnalysis` (LazyMount)
- **Expected Agent Action:** Monitor daily LLM spend against `LLM_DAILY_BUDGET_USD`. If spend exceeds 80% of budget, switch to Ollama (set `ARIA_PREFER_LOCAL_LLM=1`).

#### Tab 9 — Supervisors (`supervisors`)
- **Key UI Elements:**
  - `SupervisorsPanel` — 5 supervisor cards (sales, quality, finance, compliance, executive)
  - Per-supervisor review history
  - Active escalations list
- **Expected Agent Action:** Review escalations. If an escalation is `severity=critical`, notify the owner immediately via Telegram.

#### Tab 10 — Training (`training`)
- **Key UI Elements:**
  - `BlackboxTrainingPanel` — blackbox training data
  - `TrainingPanel` — A/B test results + customer feedback + KB
- **Expected Agent Action:** Review A/B test winners and adopt the winning variant for future outreach.

#### Tab 11 — Market Intel (`market`)
- **Key UI Elements:**
  - `MarketIntelligencePanel` — service opportunities + competitor analysis
  - Service opportunity list with composite scores
  - Competitor list with strengths/weaknesses
- **Expected Agent Action:** Review high-composite-score (>60) service opportunities. If approved, they appear in the public `/services` catalog automatically.

#### Tab 12 — Security (`security`)
- **Key UI Elements:**
  - `SecurityPanel` — 2FA enrollment + auth stats
  - `RbacPanel` — RBAC role matrix (owner / admin / viewer)
- **Expected Agent Action:** Ensure 2FA is enrolled for the owner account. Review RBAC role assignments quarterly.

#### Tab 13 — More (`more`)
- **Key UI Elements:**
  - `SettingsPanel` — system configuration (top)
  - `SampleDataManager` — seed/reset sample data
  - `SystemMetricsPanel` — system metrics
  - `AuditLogPanel` — audit log
  - `NotificationPreferences` (LazyMount)
  - `AlertsPanel` (LazyMount)
  - `LlmCallInspector` + `CronRegistry` (side-by-side, LazyMount)
  - `SystemHealthGauge` (LazyMount)
  - `ActivityHeatmap` (LazyMount)
  - `ApiDocsPanel` (LazyMount) — OpenAPI spec browser
  - **Advanced Capabilities section:**
    - `GoalsPanel` — goal tracking
    - `AutonomousBusinessPanel` (id=`autonomous-business`) — autonomous business engine
    - `MultiCompanyCyclesPanel` — multi-company simulations
    - `WorkflowTemplatesPanel` — workflow template library
    - `ConnectorMarketplacePanel` — connector marketplace
    - `RevenueEnginePanel` + `CashClawPanel` (side-by-side)
    - `DebatePanel` + `FailureAlchemyPanel` (side-by-side)
    - `CredentialVaultPanel` + `SystemAccessPanel` (side-by-side)
    - `NotesPanel` + `KpiPanel` (side-by-side)
- **Expected Agent Action:** Use this tab for system administration. Most agents never need to visit here.

### 4.3 Global Overlays

These overlays are always present (regardless of active tab):

| Overlay | Trigger | Action |
|---|---|---|
| `QuickActionFAB` | Floating "+" button (bottom-right) | Opens `TaskComposer` |
| `CommandPalette` | `Cmd+K` / `Ctrl+K` | Quick search + jump-to-agent + create-task |
| `AgentDetailDrawer` | Click any agent row/node | Slide-out drawer with agent detail + LLM call history |
| `TaskComposer` | FAB click or "Create Task" button | Compose a new task with assignee + kind |
| `KeyboardShortcutsHelp` | `?` key | Show all keyboard shortcuts |
| `OnboardingTour` | First-run only | Guided tour of the dashboard |
| `LiveVoiceChat` | Microphone icon (top-right) | Voice-driven chat with the assistant |
| `MobileBottomNav` | Mobile viewport only | Bottom nav for mobile |

### 4.4 Standalone Pages (not part of `/dashboard`)

| Path | Page | Purpose |
|---|---|---|
| `/` | Landing page | Public marketing site |
| `/login` | Login | Email + password + 2FA |
| `/signup` | Signup | Create owner account (first-run only) |
| `/services` | Services catalog | Public service catalog + checkout |
| `/playground` | LLM playground | Test LLM prompts interactively |
| `/legal/terms` | Terms of Service | 12 sections |
| `/legal/privacy` | Privacy Policy | GDPR + CCPA compliant |
| `/legal/refund` | Refund Policy | 7-day window |
| `/dashboard/settings` | Settings UI | 9-section env editor (hot-reload) |

---

## 5. Autonomy Tag Enforcement Protocol

This section details the exact logic from `src/lib/conductor/router.ts` that every agent must follow. The router is the single chokepoint — there is no way to bypass it.

### 5.1 The Enum

```prisma
// prisma/schema.prisma (lines 31-35)
enum AutonomyTag {
  HUMAN_LED
  HUMAN_ASSISTED
  FULLY_AUTONOMOUS
}
```

This enum is applied to two Prisma models:
- `WorkflowDefinition.autonomyTag` (default: `HUMAN_ASSISTED` — safe default)
- `Skill.autonomyTag` (default: `HUMAN_ASSISTED`)

### 5.2 The Three Tags — Exact Behavior

#### `HUMAN_LED`
- **Agent can:** Draft the workflow inputs, prepare the payload, log to `AgentLog`.
- **Agent cannot:** Execute. The conductor refuses and emits a `system` warn event.
- **Owner must:** Trigger the workflow manually via the dashboard.
- **Code path:** `routeWorkflowByAutonomy()` returns `{ allowed: false, autonomyTag: HUMAN_LED, reason: "HUMAN_LED workflow — owner must trigger manually via the dashboard" }`.
- **Telegram:** No brief sent (owner is expected to act in the dashboard).

#### `HUMAN_ASSISTED`
- **Agent can:** Draft the workflow, queue a Telegram brief, and then BLOCK.
- **Agent must:** Wait for `isApprovalResolved(approvalId)` to return `{ resolved: true, approved: true }` before re-dispatching.
- **Conductor does:** Creates an `Approval` row with `status="pending"`, sends a Telegram brief to the owner with the title + risk + requester.
- **Owner decides via:** Dashboard (Approvals Queue → Approve/Deny), OR Telegram bot (`/approve <last-8-of-id>` or `/deny <last-8-of-id>`).
- **Code path:** `queueTelegramApproval()` returns `{ allowed: false, autonomyTag: HUMAN_ASSISTED, approvalId, telegramSent }`.
- **Polling helper:** `routeAndWaitForApproval(workflowId, requester, { pollMs, timeoutMs })` — polls every 5s (default), times out after 5min (default).
- **SSE event:** `approval.decided` is emitted when the owner decides — agents can subscribe instead of polling.

#### `FULLY_AUTONOMOUS`
- **Agent can:** Execute end-to-end without owner approval.
- **Conductor does:** Returns `{ allowed: true, autonomyTag: FULLY_AUTONOMOUS }` immediately.
- **Quality Supervisor:** Still runs post-hoc trajectory validation. If it fails 2 retries, the supervisor escalates to the owner via `createEscalation()`.
- **Black Box:** Every action is logged to `AutonomousAction` + Black Box for audit.

### 5.3 The Router Function Signatures

```typescript
// src/lib/conductor/router.ts

export async function routeWorkflowByAutonomy(
  workflowId: string,
  requester: string,
): Promise<RouteDecision>

export async function routeSkillByAutonomy(
  skillId: string,
  requester: string,
): Promise<RouteDecision>

export async function isApprovalResolved(
  approvalId: string,
): Promise<{ resolved: boolean; approved?: boolean; reason?: string }>

export async function routeAndWaitForApproval(
  workflowId: string,
  requester: string,
  opts?: { pollMs?: number; timeoutMs?: number },
): Promise<RouteDecision & { approved?: boolean }>
```

### 5.4 Agent Decision Tree

When an agent wants to execute a workflow or skill:

1. **Call the router:** `const decision = await routeWorkflowByAutonomy(workflowId, agentName);`
2. **Branch on `decision.allowed`:**
   - `true` → execute the workflow. Log to `AutonomousAction`. Quality Supervisor will review post-hoc.
   - `false` → branch on `decision.autonomyTag`:
     - `HUMAN_LED` → stop. Log to `AgentLog` with `level=warn`. Do not retry.
     - `HUMAN_ASSISTED` → save `decision.approvalId`. Subscribe to SSE `approval.decided` event OR poll `isApprovalResolved()`. When resolved:
       - `approved=true` → re-dispatch via `routeWorkflowByAutonomy()` (now returns `allowed=true` because the approval is already decided — but the agent must re-check in case the workflow was changed).
       - `approved=false` → stop. Log to `AgentLog` with `level=warn`. Do not retry.
3. **Never bypass the router.** Even if the agent has `executeWorkflow()` imported directly, doing so violates the Constitution (Rule #1 below).

---

## 6. Direct API Integration Map

Agents should call these APIs directly via `fetch()` instead of using browser automation. All APIs are JSON, all require auth (except where noted), and all return the standard envelope `{ ok, data?, error? }`.

### 6.1 Critical API Routes

| Endpoint | Method | Auth | Payload | Returns | Use Case |
|---|---|---|---|---|---|
| `/api/health` | GET | Public | — | `{ ok, db, uptime, version }` | Liveness check |
| `/api/health/services` | GET | Owner | — | `{ services: [{ name, ok, latencyMs }] }` | Subsystem health (DB, LLM, email, telephony) |
| `/api/dispatch` | POST | Owner | `{ department, role, task, parentId }` | `{ ok, subAgentId, summary }` | Dispatch a sub-agent task |
| `/api/tasks` | GET | Owner | `?status=pending&assigneeId=X` | `{ tasks: Task[] }` | List tasks |
| `/api/tasks` | POST | Owner | `{ title, description, kind, assignedToId, priority }` | `{ ok, taskId }` | Create a task |
| `/api/tasks/[id]` | GET | Owner | — | `{ task: Task }` | Get task detail |
| `/api/approvals` | GET | Owner | `?status=pending` | `{ approvals: Approval[] }` | List pending approvals |
| `/api/approvals/[id]` | POST | Owner | `{ decision: "approved" \| "denied", note? }` | `{ ok }` | Decide an approval |
| `/api/autonomy/status` | GET | Public | — | `{ paused, reason, timestamp }` | Check kill switch |
| `/api/autonomy/pause` | POST | Owner | `{ reason? }` | `{ ok, paused }` | Pause all autonomy |
| `/api/autonomy/resume` | POST | Owner | — | `{ ok, paused: false }` | Resume autonomy |
| `/api/telegram/webhook` | POST | Public* | Telegram update object | `{ ok }` | Inbound Telegram command (*verified via `TELEGRAM_VERIFY_TOKEN`) |
| `/api/telemetry` | GET | Owner | `?since=ISO8601` | `{ events: MetricPoint[] }` | Time-series metrics |
| `/api/llm-router/status` | GET | Public | — | `{ providers, freeswitch, ollama }` | LLM provider state |
| `/api/services/catalog` | GET | Public | — | `{ services, categories, crypto, stripe }` | Public service catalog |
| `/api/services/checkout` | POST | Public | `{ serviceId, spec, customerEmail }` | `{ ok, orderId, walletAddress, amountUsd }` | Create a crypto order |
| `/api/services/upi/checkout` | POST | Public | `{ serviceId, spec, customerEmail }` | `{ ok, orderId, amountInr, vpa, qrImageB64 }` | Create a UPI order |
| `/api/settings` | GET | Public | — | `{ flags, telephony, ollama, database }` | System config status |
| `/api/settings/env` | GET | Owner | — | `{ keys: { KEY: { configured, masked } } }` | Get env key status (masked) |
| `/api/settings/env` | POST | Owner | `{ keys: { KEY: value, ... } }` | `{ ok, updated, rejected }` | Update env keys (hot-reload) |
| `/api/webhooks/resend` | POST | Public** | Resend event + signature | `{ ok }` | Inbound email reply (**HMAC verified) |
| `/api/webhooks/stripe` | POST | Public** | Stripe event + signature | `{ ok }` | Stripe payment webhook (**signature verified) |
| `/api/whatsapp/webhook` | POST | Public** | WhatsApp event + signature | `{ ok }` | Inbound WhatsApp message (**HMAC verified) |
| `/api/unsubscribe/[token]` | GET | Public | — | 302 redirect | CAN-SPAM unsubscribe link |

### 6.2 Extending Internal APIs with Public-API Data Sources

Agents can extend ARIA's data-fetching surface area by adding new `Skill` rows that call public APIs. Here's the pattern, referencing the [Public APIs repository](https://github.com/public-apis/public-apis):

#### Example: Add a Currency Exchange Rates skill

1. Find the API in the Public APIs repo (e.g., `Open Exchange Rates` → `https://open.er-api.com/v6/latest/USD`).
2. Insert a Skill row via the dashboard's API:
   ```bash
   curl -X POST http://localhost:3000/api/skills \
     -H "Authorization: Bearer <OWNER_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "FX Rates Fetch",
       "slug": "fx-rates-fetch",
       "description": "Fetches USD→INR/GBP/EUR exchange rates from open.er-api.com (free, no auth)",
       "autonomyTag": "FULLY_AUTONOMOUS",
       "script": "const r = await fetch(\"https://open.er-api.com/v6/latest/USD\"); const j = await r.json(); return { usdInr: j.rates.INR, usdGbp: j.rates.GBP, usdEur: j.rates.EUR, ts: j.time_last_update_utc };",
       "isActive": true
     }'
   ```
3. The agent invokes it via `execute_skill({ skillId: 'skill-fx-rates' })`.
4. The conductor router checks `autonomyTag=FULLY_AUTONOMOUS` → runs directly.
5. The Quality Supervisor trajectory-validates: asserts the script returns an object with `usdInr` key.

#### Recommended Public APIs to integrate

| Category | API | Endpoint | Auth |
|---|---|---|---|
| Finance | Open Exchange Rates | `https://open.er-api.com/v6/latest/USD` | None |
| Weather | OpenWeatherMap | `https://api.openweathermap.org/data/2.5/weather?q=London` | API key (free) |
| Geocoding | Nominatim | `https://nominatim.openstreetmap.org/search?q=Berlin&format=json` | None (rate-limited) |
| Countries | REST Countries | `https://restcountries.com/v3.1/all` | None |
| Wikipedia | MediaWiki API | `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=...` | None |
| News | NewsAPI | `https://newsapi.org/v2/top-headlines?country=us` | API key (free) |
| Books | Open Library | `https://openlibrary.org/search.json?q=...` | None |
| GitHub | GitHub API | `https://api.github.com/users/{user}` | None (rate-limited) |

Each skill added this way appears in `discoverSkills()` and is automatically surfaced in the agent's system prompt via `SKILL_SYSTEM_PROMPT_SECTION` in `src/lib/hermes/skills.ts`.

---

## 7. Agent Operating Rules (The Constitution)

These are the **10 immutable rules** every agent must follow when operating this system. Violations are logged to `AutonomousAction` with `severity=critical` and trigger an immediate escalation.

### Rule 1: Always check the autonomy tag before executing
Before running ANY workflow or skill, call `routeWorkflowByAutonomy()` or `routeSkillByAutonomy()`. Never call `executeWorkflow()` or `executeSkill()` directly. The router is the single chokepoint — bypassing it violates the system's core safety model.

### Rule 2: Never hardcode API keys, secrets, or tokens
All credentials live in the Credential Vault (`src/lib/credential-vault.ts`, encrypted with `ENCRYPTION_MASTER_KEY`) OR in the `.env` file (hot-reloaded by `env-loader.ts`). Agents read credentials via `process.env.KEY_NAME` or `credentialVault.get(key)`. Hardcoded secrets in agent code are a critical violation.

### Rule 3: If a task fails 2 times, escalate to the owner — do not loop infinitely
The Quality Supervisor enforces `MAX_RETRIES = 2` (in `src/lib/supervisors/quality-supervisor.ts`). After 2 failed retries, the supervisor calls `createEscalation()` and the work is queued for owner review. Agents must respect this — never wrap a failing task in a `while(true)` loop hoping it will eventually succeed.

### Rule 4: Use `safeWrite()` for high-frequency DB writes
Direct `db.agentLog.create()` calls can throw `SQLITE_BUSY` when 30+ cron jobs run concurrently. Always use `safeWrite(() => db.agentLog.create({...}))` from `src/lib/db-write-queue.ts`. For reads, direct `db.X.findMany()` is fine (reads don't lock).

### Rule 5: Detect HTML responses from LLM providers
When calling an LLM provider's REST API directly (not via the router), use `safeJsonParse()` from `src/lib/llm-router.ts`. If it throws `ProviderHtmlError`, cool down the provider for 10 minutes and fall back to the next provider. Never let an HTML response crash the autonomous loop.

### Rule 6: Respect the global autonomy kill switch
Before starting any cron job, tick, or autonomous action, check `await isAutonomyPaused()`. If true, short-circuit and return immediately. The owner may have paused the system for maintenance or investigation — do not attempt to "help" by running anyway.

### Rule 7: Wait for `isApprovalResolved()` on HUMAN_ASSISTED tasks
When the conductor returns `{ allowed: false, autonomyTag: HUMAN_ASSISTED, approvalId }`, the agent must NOT proceed. Subscribe to the `approval.decided` SSE event OR poll `isApprovalResolved(approvalId)` every 5 seconds. After 5 minutes with no decision, log a warning and move on to the next task.

### Rule 8: Log every autonomous action to the Black Box
Every `FULLY_AUTONOMOUS` execution must write a row to the `AutonomousAction` table (or `AgentLog` with `level=info`) describing: what was done, why, what the inputs were, what the outputs were, and how long it took. The Black Box is the audit trail — without it, the owner cannot debug escalations.

### Rule 9: Never modify the Prisma schema at runtime
The schema (`prisma/schema.prisma`) is read-only at runtime. Schema changes require owner intervention + `bunx prisma db push --accept-data-loss`. Agents must never attempt `ALTER TABLE` or `db.$executeRaw` against the schema.

### Rule 10: If in doubt, escalate
When an agent encounters an unknown situation ( unfamiliar API, ambiguous user input, unexpected error, missing data), it must create an `Escalation` row via `createEscalation(source, supervisor, issue, context, severity)` from `src/lib/supervisors/index.ts`. The owner will review and decide. Escalating is never punished — silently doing the wrong thing is.

---

### Enforcement

These rules are enforced by:
- **Code-level guards** in `src/lib/conductor/router.ts`, `src/lib/supervisors/quality-supervisor.ts`, `src/lib/db-write-queue.ts`, `src/lib/autonomy-control.ts`, `src/lib/credential-vault.ts`, `src/proxy.ts`.
- **Test coverage** in `tests/conductor-router.test.ts` (25 tests), `tests/quality-supervisor.test.ts`, `tests/secure-crypto.test.ts` (8 tests), `tests/rbac.test.ts` (8 tests), `tests/cash-claw.test.ts` (5 tests).
- **Chaos tests** in `scripts/chaos-test.ts` (8 tests).
- **Pre-launch smoke tests** in `scripts/pre-launch-smoke-test.sh` / `.ps1` (9 security checks).

If an agent violates a rule, the system:
1. Logs the violation to `AgentLog` with `level=error` and `severity=critical`.
2. Creates an `Escalation` row with `severity=critical`.
3. Sends a Telegram alert to the owner.
4. (If `severity=critical`) Triggers the global autonomy kill switch — ALL autonomous operations halt until the owner resumes.

---

## Appendix A: File Inventory

```
aria-mission-control-v60-final-clean/
├── README.md                         Lean pointer to docs/MASTER-GUIDE.md + this manual
├── docs/
│   ├── MASTER-GUIDE.md               The 464-line authoritative guide (architecture + 25 bug fixes)
│   ├── AGENT-OPERATOR-MANUAL.md      This file (operator manual for AI agents)
│   └── v60-PATCH-1-ENV-PARSER-FIX.md Patch 1: env parser fix + Turbopack warning silencing
├── setup.sh / setup.ps1              v60 setup (Bun preferred, npm fallback, auto-bootstrap)
├── .env.example                       100+ env vars across 9 categories (clean: no inline comments)
├── package.json
├── prisma/schema.prisma              60 models + AutonomyTag enum
├── src/
│   ├── app/
│   │   ├── api/                       79 route directories, 140+ endpoints
│   │   │   ├── autonomy/              v58 kill switch (pause/resume/status)
│   │   │   ├── telegram/              v58 inbound webhook (5 commands)
│   │   │   ├── conductor/             Autonomy router + dispatcher
│   │   │   ├── settings/              GET /settings, GET/POST /settings/env
│   │   │   ├── telephony/             call, sms, status (4 providers)
│   │   │   ├── services/              catalog, checkout, upi, refund, preview, approve, pending, orders
│   │   │   ├── webhooks/              resend (HMAC), stripe (signature)
│   │   │   ├── whatsapp/              send + webhook (HMAC)
│   │   │   ├── expansion/             earning-methods, service-opportunities
│   │   │   ├── supervisors/           reviews + escalations
│   │   │   ├── approvals/             [id] decision endpoint
│   │   │   └── ... 60+ more route dirs
│   │   ├── dashboard/                 /dashboard + /dashboard/settings
│   │   ├── services/                  Public service catalog + checkout
│   │   ├── legal/                     terms, privacy, refund
│   │   ├── login/ /signup/            Auth pages
│   │   ├── playground/                LLM playground
│   │   └── page.tsx                   Landing page
│   ├── components/
│   │   ├── ui/                        75 components (shadcn + custom)
│   │   ├── svg/                       15 animated SVG icons
│   │   ├── mission/                   80+ dashboard panels
│   │   └── legal/                     LegalPage shared layout
│   ├── lib/
│   │   ├── conductor/                 router.ts + dispatcher.ts
│   │   ├── supervisors/               index.ts + quality-supervisor.ts
│   │   ├── intelligence/              sandbox, ab-testing, feedback-loop, competitor-analyzer, prompt-improver
│   │   ├── expansion/                 service-researcher, service-designer, service-simulator, earning-method-researcher, workflow-simulator
│   │   ├── hermes/                    skills, toolsets, memory, learning, earning-researcher
│   │   ├── services/                  catalog, builder, crypto-checkout
│   │   ├── stripe-checkout/           Stripe integration
│   │   ├── whatsapp/                  WhatsApp Business Cloud API
│   │   ├── simulation/                fleet, seed, engine, seed-templates
│   │   ├── autonomy-control.ts        Global kill switch
│   │   ├── db-write-queue.ts          SQLite write queue
│   │   ├── db-schema-ensure.ts        Auto-apply Prisma schema
│   │   ├── auto-bootstrap.ts         Zero-config secrets + .env
│   │   ├── telegram-bot.ts            Inbound command handler
│   │   ├── llm-router.ts              7-provider router + HTML resilience
│   │   ├── llm-client.ts              callLLM() + retry + token tracking
│   │   ├── outreach-executor.ts       Sales + Compliance supervisors + kill switch
│   │   ├── email-service.ts           Resend + CAN-SPAM + sandbox refusal
│   │   ├── crypto-verifier.ts         Etherscan + BlockCypher + Solana + TronGrid
│   │   ├── upi-payments.ts            VPA + QR + UTR + owner approve
│   │   ├── telephony.ts               FreeSWITCH + Dograh + Twilio + WebRTC
│   │   ├── auth.ts                    requirePermission + requireAuthOrResponse
│   │   ├── proxy.ts                   Fail-closed auth gate
│   │   ├── env-loader.ts              v60 fix: handles quoted values with inline comments
│   │   └── ... 90+ more lib modules
│   ├── hooks/                         10+ React hooks
│   ├── stores/                        Zustand stores (mission-store, etc.)
│   ├── styles/                        theme.ts + globals.css
│   ├── instrumentation.ts             Edge-safe boot hook
│   ├── instrumentation-node.ts        Node-only boot (auto-bootstrap + self-heal + queue + schema + seed + engine)
│   └── proxy.ts                       Auth middleware
├── mini-services/
│   ├── lib/auth-middleware.ts         v58 X-JARVIS-Key auth (constant-time)
│   └── realtime/                      socket.io fan-out (port 3003)
├── prisma/schema.prisma               60 models
├── skills/                             ⭐ MANDATORY — 69 ClawHub skills (61MB)
│   ├── ASR/LLM/TTS/VLM/
│   ├── docx/pdf/xlsx/pptx/
│   ├── web-search/web-reader/agent-browser/
│   ├── image-generation/image-edit/image-search/video-generation/video-understand/
│   ├── charts/coding-agent/fullstack-dev/
│   ├── blog-writer/content-strategy/seo-content-writer/
│   ├── market-research-reports/qingyan-research/literature-survey/
│   └── ... 60+ more skills
├── scripts/
│   ├── check-env.ts                   Startup validator
│   ├── simulate-full-loop.ts          9-sim end-to-end test
│   ├── chaos-test.ts                  8-test chaos monkey
│   ├── pre-launch-smoke-test.*       9-check security gate
│   ├── deploy.sh                      One-shot prod deploy
│   └── keeper.sh                      Auto-restart on crash
├── tests/                              11 test files, 107 tests
│   ├── conductor-router.test.ts       25 autonomy-tag tests
│   ├── quality-supervisor.test.ts     trajectory validation tests
│   ├── cash-claw.test.ts              survival classifier
│   ├── feasibility.test.ts            Monte Carlo
│   ├── rate-limiter.test.ts
│   ├── rbac.test.ts
│   ├── secure-crypto.test.ts
│   ├── two-factor.test.ts
│   ├── setup.ts
│   ├── api/                           cache, openapi, pagination, tracing, two-factor
│   └── e2e/                           Playwright (run via `bunx playwright test`)
└── .env.example                       100+ env vars (clean: no inline comments on values)
```

## Appendix B: Verification Commands

```bash
# Type check (must be 0 errors)
bunx tsc --noEmit

# Unit + integration tests (must be 107 pass, 0 fail)
bun test ./tests/*.test.ts ./tests/api/*.test.ts

# E2E tests (separate runner, excluded from `bun test`)
bunx playwright test

# Build (must succeed with 0 warnings)
bun run build

# Chaos monkey tests (must be 8/8 pass)
bun run scripts/chaos-test.ts

# End-to-end simulation (9 sims, 65+ checks)
bun run scripts/simulate-full-loop.ts

# Pre-launch security smoke test
bash scripts/pre-launch-smoke-test.sh          # Linux/Mac
powershell -File scripts/pre-launch-smoke-test.ps1   # Windows

# Env check
bun run check-env
```

---

**End of Agent Operator Manual & System Constitution v60.**
