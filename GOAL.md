# ARIA Mission Control — Permanent North Star

> **THE GOAL (never deviate from this):**
>
> Simulate a **real MNC company** — its policies, system architecture,
> hierarchy, and everything it has to earn, manage, and automate — by using
> smart, creative, and intelligent logic.
>
> The app must operate like a real company that earns income, manages its
> operations, and automates its workflows autonomously, with the owner as the
> sole human decision-maker.

## Non-Negotiable Rules (owner-mandated)

1. **Real MNC structure first.** Every feature must map to how a real
   company operates (board → CEO → C-suite → departments → ICs). No theater,
   no decoration that doesn't serve a real business function.

2. **Hardening before features.** Never add a new feature until all
   existing ones are production-grade. Fix the broken/stubbed/unwired code
   before building anything new.

3. **Daily owner standup is mandatory.** The owner must receive a
   forward-looking planning artifact every day (not a metrics dump) that
   states today's top 3 goals, blockers, decision queue, and recommended
   actions.

4. **Owner approval with Q&A.** Before any approval, the owner MUST be
   able to ask questions, clarify, and suggest improvements. Payment
   approvals are isolated from routine approvals and require a 60s cooldown.

5. **$0 spend by default.** All models are free (local Ollama, no-login
   playgrounds, free-tier APIs). Paid models are OFF by default + behind a
   UI toggle. Never make a payment without explicit, isolated approval.

6. **Business hours discipline.** Owner + customer interactions happen
   only 9 AM – 6 PM in the recipient's timezone. Critical alerts bypass.

7. **Never sit idle.** If an approval is deferred, agents pivot to the
   next available task. The fleet always has work to do.

8. **Inject prior results.** Every implementation step injects the
   verified result of the prior step before proceeding. No blind jumps.

## Reference Architecture

A real MNC at $1M–$10M ARR has:
- **Revenue**: 70-90% MRR (subscriptions), not one-shot sales.
- **Sales**: Lead → MQL → SQL → Opportunity → Closed-Won (CRM-backed).
- **Finance**: Stripe Billing, ASC 606 revenue recognition, Stripe Tax,
  monthly close, annual audit.
- **Support**: Tier 1 docs, Tier 2 chat, Tier 3 engineering. CSAT ≥ 90%.
- **Legal**: GDPR DPA, cookie consent, KYC for payments, 72h breach disclosure.
- **Engineering**: CI/CD, Sentry, OpenTelemetry, PagerDuty, SLOs, postmortems.
- **Security**: SOC 2, pen tests, secrets manager, quarterly access reviews.
- **GTM**: SEO, paid, outbound, content, partnerships.
- **Daily ops**: Standup (15 min), WBR (weekly), MBR (monthly), OKRs (quarterly).

ARIA must close every gap against this reference, one phase at a time.

---

*This file is the permanent north star. Every phase, every commit, every
decision must be checked against it. If a change doesn't serve this goal,
it doesn't ship.*

---

## Build Rules (v61.3 — MANDATORY, extracted from docs/BUILD-RULES-v61.md)

> These rules are the NON-NEGOTIABLE enforcement layer. They are saved here
> (the permanent north star) so they cannot be lost or bypassed. The full
> rules live in `docs/BUILD-RULES-v61.md` — this is the condensed critical set.

### Stack (non-negotiable)
- **Runtime:** Bun 1.3+ (Node 22+ fallback). `bun install` only.
- **Framework:** Next.js 16 (App Router, Turbopack). Port 3000 only.
- **Language:** TypeScript 5 strict. 0 typecheck errors enforced.
- **Database:** Prisma v6 + SQLite (dev) / PostgreSQL (prod).
- **Styling:** Tailwind CSS 4 + shadcn/ui (New York).
- **LLM SDK:** `z-ai-web-dev-sdk` — server-only, default export, via `routeLLM()`.

### Safety Controls (12-layer defense — all MANDATORY)
1. **AutonomyTag enum** — HUMAN_LED / HUMAN_ASSISTED / FULLY_AUTONOMOUS. Enforced in `conductor/router.ts` BEFORE execution.
2. **Kill Switch** — `isAutonomyPaused()` wired into BOTH `cron-scheduler.ts` AND `workflow-engine.ts`.
3. **Zero-Assumption Guard** — halts + Telegram `/answer` if required context is missing.
4. **Production Gate (v61.1+v61.2)** — `verifyProductionReadiness()` blocks TODO/FIXME/DRAFT/secrets/`(error:...)`. 3-retry Refiner loop. Escalates to `NEEDS_CONTEXT:` halt.
5. **Agent Blackboard (v61.1+v61.2)** — prevents 2 agents claiming same resource. Blocks + defers + pivots on conflict.
6. **Payment Isolation** — spend excluded from auto-decider. `/pay-approve` only. 60s cooldown.
7. **Business Hours** — customer outreach only 9-18 in recipient tz.
8. **Quality Supervisor** — execution-based trajectory validation. `MAX_RETRIES=2`.
9. **Council Pattern** — 3-4 agents convened for high-complexity tasks.
10. **Step-Debate** — Proposer → Critic → Refiner + previous-step injection.
11. **2-Hour Deferral & Pivot** — stalled approvals marked deferred; fleet pivots.
12. **Rules-Auditor** — self-improvement: analyzes failed traces, proposes code changes.

### Knowledge Ingestion (v61.3 Phase 8 — NO LAZY SUMMARIES)
- **Skill patterns come from the DB** — `scripts/extract-all-skill-patterns.ts` parses EVERY SKILL.md (69 files) and seeds the Skill table with full instructions (not 1-line summaries). `loadFullSkillContext()` queries the DB first.
- **500-Projects patterns come from the DB** — `scripts/ingest-500-projects.ts` fetches the real repo, extracts coreLogic + systemPromptTemplate + toolsRequired from each agent.py, and seeds KnowledgeBaseEntry.
- **The Conductor queries the DB** — `enhancePromptWithResearch()` calls `queryKnowledgeBase(tags)` to find real extracted patterns matching the task.
- **The raw `skills/` folder is NOT needed at runtime** — the DB is the brain.

### Hard Rules
- Never commit `.env`. Auto-bootstrap generates secrets on first boot.
- `AI_CALLER_ENABLED + AI_CALLER_CONSENT_VERIFIED` both must be `"true"` for any call/SMS.
- Crypto verification uses real on-chain data (Etherscan + BlockCypher + Solana + TronGrid). No mocks.
- Outreach requires CAN-SPAM compliance (unsubscribe + sender address).
- Credential Vault uses AES-256-GCM. Master key via `ENCRYPTION_MASTER_KEY`.
- Every `fetch()` MUST set a timeout via `AbortSignal.timeout(ms)`.
- No secrets to the client — `/api/settings` returns booleans only.
- Security headers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(self), geolocation=()`.

### Verification Gates (before every release)
- `bunx tsc --noEmit` → 0 errors
- `bun test ./tests/*.test.ts ./tests/api/*.test.ts` → all pass
- `bun run scripts/chaos-test.ts` → 8/8 pass
- `bun run scripts/ingest-500-projects.ts` → seeds 25+ KnowledgeBaseEntry records
- `bun run scripts/extract-all-skill-patterns.ts` → seeds 69 Skill records

---

*This file is the permanent north star. Every phase, every commit, every
decision must be checked against it. If a change doesn't serve this goal,
it doesn't ship.*

---

## Phase 9 Rules (v61.4 — AI Mistakes Patterns + Mandatory Work Log)

> These rules are learned from the Phase 9 Truth-Seeker Audit, which found
> the AI taking shortcuts (facades, silent stubs, ungated simulations,
> manual-only seeding). They are MANDATORY for all future development.

### AI Mistakes Patterns (how AI takes shortcuts — and how to prevent them)

1. **No facade marketing.** Never claim a feature exists in docs if the code
   doesn't implement it. The vector memory facade existed because
   `AGENT-OPERATOR-MANUAL.md` said "vector recall" while
   `ULTIMATE-MASTER-OVERVIEW.md` admitted "LIKE search." **Rule: if the code
   says X, ALL docs must say X.** If you find a doc claiming something the
   code doesn't do, fix the doc (or implement the feature) — never let them
   diverge.

2. **No silent stubs.** If a module is a stub (not yet implemented), it MUST
   throw a graceful error in production when invoked without the required API
   key — NOT silently return mock data, NOT silently fall back to a different
   provider. The Apollo/Hunter/Snov facade existed because the settings UI
   collected keys that no code read, and `lead-finder.ts` silently used Z-AI
   regardless. **Rule: stubs must fail loudly, not silently.**

3. **No ungated simulation in production paths.** Every `Math.random()`,
   `faker`, `generateFake`, or fake-data generator in production code paths
   MUST be wrapped in `if (process.env.ARIA_SIMULATION_MODE === "true")`. The
   cron "Run Now" bug existed because `Math.random()` faked cron outcomes
   without any simulation-mode check — corrupting the audit table. **Rule:
   simulation is for demo mode only; production paths must call real handlers.**

4. **No manual-only seeding.** If a database table is critical for runtime,
   its seeding MUST be wired into `auto-bootstrap.ts` (auto-runs on first
   start), NOT a manual `bun run seed` step that operators might skip. The
   knowledge brain was a manual step, so fresh deploys got 12 generic stub
   prompts instead of 69 real skills. **Rule: critical data auto-populates
   on first boot.**

5. **No lazy ingestion.** When ingesting a data source (repo, API, folder),
   parse ALL of it — not just the first subfolder. The 500-projects ingestion
   initially scraped only `agents/` (25 entries) and ignored the framework
   tables + crewai_mcp_course. **Rule: if the source has 100 items, the DB
   must have 100 entries — not 25.**

### Mandatory Work Log + File Change Tracking

6. **Mandatory work log.** Every AI agent (and every developer) MUST append
   to `/home/z/my-project/worklog.md` after every work session. The log MUST
   include:
   - Task ID (e.g., `PHASE-9-v61.4`)
   - Agent name (e.g., `Principal Software Architect`)
   - Task description (what was asked)
   - Work Log (concrete steps taken, with file:line evidence)
   - Stage Summary (key results, verification, artifacts produced)
   - **Files changed** (see rule 7)

   This is non-negotiable — the work log is the project's memory. Without it,
   future agents can't know what was done, what was tried, or what failed.

7. **File change tracking.** Every work log entry MUST include a "Files
   changed" section listing every file created, updated, or deleted with the
   exact path. Format:
   ```
   Files changed:
   - CREATED: src/lib/vector-memory.ts (new — real semantic search)
   - UPDATED: src/lib/ollama-client.ts (added embedText + cosineSimilarity)
   - UPDATED: src/lib/cron-scheduler.ts (rules-auditor now uses vector memory)
   - DELETED: (none)
   ```
   This gives clarity on what the AI did and enables rollback if needed.

### Verification Gates (before every release — MANDATORY)

8. **Facade grep.** Before every release, grep the codebase for:
   - `Math.random()` in production paths (must be gated or removed)
   - `// TODO` / `// STUB` / `// FIXME` comments (must be tracked)
   - Doc claims that contradict code (e.g., "vector" when it's LIKE search)
   - Settings UI fields that no code reads (silent stubs)

9. **Real-call proof.** For every external API integration, the work log MUST
   include the exact `fetch()` / SDK call line that makes the real network
   request. No "it's wired" claims without file:line evidence.

10. **Seeding proof.** After any ingestion/seeding script runs, the work log
    MUST include the DB record count (e.g., "69 Skill records, 92
    KnowledgeBaseEntry records"). No "it's populated" claims without the
    count.

---

*This file is the permanent north star. Every phase, every commit, every
decision must be checked against it. If a change doesn't serve this goal,
it doesn't ship.*
