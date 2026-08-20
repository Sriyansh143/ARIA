/**
 * src/lib/knowledge-base.ts — In-app Knowledge Base.
 *
 * Static catalogue of help articles covering every major ARIA Mission
 * Control feature. Articles reference real API routes, dashboard tabs,
 * and Prisma models — they are NOT lorem-ipsum placeholders. Used by
 * the Knowledge Base panel (search + browse) and surfaced by the
 * Command Palette as well.
 *
 * Task ID: FEATURES-INSIGHTS-KB-AUDIT (Task 2).
 */

// ─── Types ───────────────────────────────────────────────────────────

export type KbCategory =
  | "Getting Started"
  | "Agents"
  | "Operations"
  | "Advanced"
  | "Security";

export interface KbArticle {
  id: string;
  title: string;
  category: KbCategory;
  /** Multi-paragraph content. Paragraphs separated by \n\n. */
  content: string;
  tags: string[];
  lastUpdated: string;
}

export interface KbArticleSummary {
  id: string;
  title: string;
  category: KbCategory;
  tags: string[];
  summary: string;
  lastUpdated: string;
}

export interface KbSearchResult {
  id: string;
  title: string;
  category: KbCategory;
  relevance: number; // 0..1
}

// ─── Catalogue (14 articles) ─────────────────────────────────────────

export const KB_ARTICLES: KbArticle[] = [
  // ── Getting Started ──
  {
    id: "quick-start-guide",
    title: "Quick Start Guide",
    category: "Getting Started",
    tags: ["onboarding", "setup", "first-run", "seed"],
    lastUpdated: "2025-01-15",
    content: `Welcome to ARIA Mission Control — the autonomous agent fleet dashboard. On first boot, the app seeds a default fleet of ~37 agents spanning Engineering, Sales, Marketing, Finance, Support, and C-Suite roles. The seed runs automatically when you visit "/" and the onboarding gate confirms your company profile.

The dashboard is organized into 9 tabs (Overview, Operations, Agents, Comms, Intelligence, Finance, System, Training, Advanced). Press keys 1-9 to jump between tabs. The Command Palette (Ctrl/Cmd+K) lets you search across agents, tasks, and API routes from anywhere.

To kick off autonomous activity, hit the "Run Autonomous Cycle" button on the Advanced tab (Autonomous Business Engine panel). This triggers the 8-stage lifecycle: FIND → QUALIFY → PLAN → EXECUTE → TRACK → OPTIMIZE → REPORT. Each stage writes rows to the EarningOpportunity, Task, Deal, and RevenueEvent tables.

If the fleet appears empty, hit the "Seed Database" button on the System tab (Sample Data Manager) or call GET /api/seed directly. This populates agents, tasks, skills, memories, and cron jobs from the seed scripts in src/lib/seed/.`,
  },
  {
    id: "onboarding-your-company",
    title: "Onboarding Your Company",
    category: "Getting Started",
    tags: ["company", "onboarding", "industry", "playbook"],
    lastUpdated: "2025-01-12",
    content: `Each company in ARIA Mission Control is a self-contained business unit with its own agents, tasks, and revenue pipeline. To onboard a new company, open the Advanced tab → Multi-Company Cycles panel, or POST /api/companies with a payload like { "name": "Acme Inc.", "industry": "saas", "domain": "acme.com" }.

Pick an industry playbook from the 12 available (SaaS, E-commerce, Marketplace, Media, Education, Healthcare, FinTech, Real Estate, Logistics, Hospitality, Consulting, Agency). Each playbook defines default agents, cron schedules, and revenue models. Playbooks are listed at GET /api/industry-playbooks (metadata only) and POST /api/industry-playbooks returns the full playbook body.

Once onboarded, switch between companies using the Company Switcher (top-left in the header) or the keyboard shortcut "c". The active company filters tasks, deals, opportunities, and revenue events across all tabs.

To run an autonomous cycle for one company, POST /api/multi-company-cycles. This loops through every active company and runs the business lifecycle once per company in parallel (bounded by the agent concurrency limit).`,
  },
  {
    id: "understanding-the-dashboard",
    title: "Understanding the Dashboard",
    category: "Getting Started",
    tags: ["dashboard", "tabs", "navigation", "ui"],
    lastUpdated: "2025-01-10",
    content: `The dashboard is split into 9 tabs accessible via the sticky top nav or keys 1-9. Each tab groups related panels (each panel is a self-contained card with a fullscreen toggle in its header).

Overview (1): Neural Core Memory graph, C-Suite meeting panel, Research Animation, Employees Animation. This is the "command center" view where you watch the fleet think and work in real time.

Operations (2): Agent Command Console, Workflow Panel, Task DAG, Task Pipeline, Approvals Queue. This is where autonomous work gets queued, dispatched, and approved.

Agents (3): Agent Roster, Network Graph, Performance Leaderboard, Agent Analytics. Filter, search, and inspect individual agent state.

Intelligence (5): AI Insights, Research & Learning, Memory Network, Metrics Dashboard, System Health Gauge, Knowledge Base. Where the fleet learns and where you can ask the LLM for recommendations.

System (7): Settings, Sample Data Manager, System Metrics, Audit Log, Alerts, LLM Call Inspector, Cron Registry. Operational telemetry and infrastructure controls.

The Agent Activity Ticker strip runs persistently across all tabs at the top of the content area, showing the latest agent status changes. The Mobile Bottom Nav (visible on small screens) mirrors the tab bar for touch navigation.`,
  },

  // ── Agents ──
  {
    id: "agent-fleet-overview",
    title: "Agent Fleet Overview",
    category: "Agents",
    tags: ["agent", "fleet", "roster", "role", "tier"],
    lastUpdated: "2025-01-14",
    content: `The ARIA fleet comprises 37+ agents organized into departments: Engineering, DevOps, QA, Research, Sales, Marketing, Finance, Support, Compliance, and C-Suite (CEO, COO, CFO, CTO). Each agent has a role, tier (strong/balanced/fast), status (idle/thinking/executing/streaming/waiting/error/offline), and a JSON capabilities array.

Agent records are stored in the Agent Prisma model. The Agent Roster panel (Agents tab) shows every agent as a card with its current task, error count, and last heartbeat. Click any agent to open the Agent Detail Drawer (right-side) showing full state, recent logs, tokens used, and task history.

Each agent's tier determines which LLM model it routes to: "strong" → glm-4.6 / llama-3.3-70b (HIGH complexity), "balanced" → glm-4.5-air / llama-3.1-8b (MEDIUM), "fast" → glm-4.5-flash (LOW). The LLM Router (src/lib/llm-router.ts) classifies each prompt by complexity and falls back through Z-AI → Groq → NVIDIA → Ollama.

To inspect individual LLM calls per agent, open the LLM Call Inspector (System tab). Every call is recorded in the LlmCall table with provider, model, tokens in/out, latency, and status (ok/rate_limited/error/fallback).`,
  },
  {
    id: "how-llm-failover-works",
    title: "How LLM Failover Works",
    category: "Agents",
    tags: ["llm", "failover", "router", "ollama", "provider"],
    lastUpdated: "2025-01-13",
    content: `ARIA's LLM Router (src/lib/llm-router.ts) routes every agent prompt through a 4-provider failover chain: Z-AI → Groq → NVIDIA NIM → Ollama. The first successful response wins; failed providers are placed on cooldown.

Cooldowns are triggered by HTTP status codes: 401/403 (auth failure) → 5 minute cooldown; 429 (rate limit) → 60 second cooldown; 5xx or network timeout → fail immediately to the next provider. The cooldown map is in-memory and clears on process restart.

Ollama is ALWAYS tried last as the guaranteed fallback — even when every cloud provider is down, agent operations continue locally via Ollama (default model: qwen2.5:7b or whatever WORKFORCE_MODEL_STRONG/BALANCED/FAST env vars are set). This means the fleet never goes fully offline.

Task complexity is classified by the agent role + prompt content: HIGH for CEO/CTO/CFO/Architect + strategy/architecture/compliance keywords; MEDIUM for general engineering/research; LOW for short prompts, status checks, and heartbeats. Complexity decides the model tier within each provider.

Check current provider status at GET /api/llm-router/status — it returns each provider's availability flag and any active cooldown reasons. The System tab also shows this in the LLM Call Inspector.`,
  },
  {
    id: "agent-communication-network",
    title: "Agent Communication Network",
    category: "Agents",
    tags: ["network", "communication", "message", "conductor"],
    lastUpdated: "2025-01-11",
    content: `Agents communicate via three mechanisms: (1) the SSE event bus (src/lib/event-bus.ts), (2) agent-to-agent messages persisted in the AgentMessage table, and (3) the Conductor (POST /api/conductor) which routes a natural-language message to the best-suited agent.

The Agent Network Graph (Agents tab) visualizes inter-agent messages as edges on a force-directed graph. Each edge represents a message sent between two agents in the last 24h. Click an edge to see the message payloads.

The Conductor uses the LLM to interpret an incoming message and decide which agent should handle it based on role, current load, and capabilities. For example, "we need a deployment plan for v2.1" routes to the DevOps agent; "draft a Q1 sales forecast" routes to the Sales or CFO agent.

Agent messages flow through the SSE event stream (GET /api/events) and are also stored in the AgentMessage table. The Mission Store (Zustand) keeps the latest 100 messages in memory for the UI. The Activity Ticker (top of every tab) shows a live feed of recent messages.

To send a direct message to a specific agent, use POST /api/hermes/execute with the target agent's id and a "send_message" tool call. The recipient agent will receive the message in its next tick cycle.`,
  },

  // ── Operations ──
  {
    id: "creating-tasks",
    title: "Creating Tasks",
    category: "Operations",
    tags: ["task", "create", "priority", "assign"],
    lastUpdated: "2025-01-09",
    content: `Tasks are the atomic unit of work in ARIA Mission Control. Each task has a title, description, status (pending/running/completed/failed/blocked), priority (low/medium/high/critical), an assigned agent, dependencies (DAG), and a kind (work/tool_call/research/review/decision).

To create a task manually, click the Quick Action FAB (bottom-right) or the "New Task" button in the Task Pipeline panel. The Task Composer modal opens with fields for title, description, priority, assignee, kind, and dependencies. Submitting POSTs to /api/tasks.

Tasks can also be auto-generated by the autonomous engine (POST /api/business-lifecycle/plan) which turns a qualified EarningOpportunity into a multi-step execution plan with task dependencies pre-wired.

The Task DAG view (Operations tab) renders tasks as nodes with directed edges for dependencies. Drag nodes to rearrange; click to inspect. Tasks in "blocked" state mean their dependencies haven't completed yet — the engine will pick them up automatically once the deps are done.

To retry a failed task, PATCH /api/tasks/[id] with { "status": "pending" }. The dispatcher will pick it up on the next tick. To cancel, set status to "failed" with a result payload describing why.`,
  },
  {
    id: "approval-workflows",
    title: "Approval Workflows",
    category: "Operations",
    tags: ["approval", "workflow", "governance", "brief"],
    lastUpdated: "2025-01-08",
    content: `The Approval gate prevents autonomous agents from taking irreversible actions (deploys, spend over threshold, contract signing, email blasts) without operator sign-off. Approvals are stored in the Approval table and surfaced in the Approvals Queue (Operations tab).

Every approval carries an LLM-generated "owner brief" (JSON in Approval.brief) with five fields: why, risks[], ifApproved, ifNotApproved, clarifications[]. The brief is produced by src/lib/approval-brief.ts:generateApprovalBrief() and persisted when the approval is created.

You can ask follow-up questions before deciding — POST /api/approvals/[id]/discuss with a message body. The discussion LLM answers based on the brief context, and the exchange is appended to Approval.discussionLog (a JSON array of {role, message, timestamp} entries).

Decide with PATCH /api/approvals/[id] { "status": "approved"|"denied" }. Oral confirmation is also supported: POST /api/approvals/[id]/oral-confirm with a voice-call transcript; if the LLM detects an affirmative phrase ("yes", "approved", "go ahead"), the approval auto-flips to approved.

The Approval Brief panel (Operations tab) renders the brief as a structured card. Critical-severity approvals (deploy + spend > $10k + sign_contract) are pinned to the top. Approvals expire after 7 days if undecided — expired approvals are marked as "expired" and the requesting agent is notified.`,
  },
  {
    id: "cron-job-management",
    title: "Cron Job Management",
    category: "Operations",
    tags: ["cron", "schedule", "automation", "daemon"],
    lastUpdated: "2025-01-07",
    content: `Cron Jobs are recurring background tasks executed by the autonomous engine. They are registered in the CronJob table with a schedule (cron expression or interval label), description, status (active/paused/error), and run history.

Default cron jobs include: daily-earning-research (runs /api/earning/research), monitor-tick (heartbeats every agent), failure-alchemy-sweep (synthesizes learning artifacts from recent errors), memory-compaction (compresses old memories), and connector-health-check.

View all cron jobs at GET /api/cron or in the Cron Registry panel (System tab). Each row shows the next run time, last run result, run count, and fail count. To manually trigger a job, POST /api/cron/[id]/run — this bypasses the schedule and runs immediately.

Cron runs are audited in the CronRun table with the result, latency, and ok/fail flag. The Audit Log panel (System tab) joins cron-related AgentLog entries with CronRun records for a unified view.

To pause a cron job, PATCH /api/cron/[id] { "status": "paused" }. The engine skips paused jobs on the next tick. To permanently disable, set status to "error" — this alerts the operator via a SystemAlert.`,
  },

  // ── Advanced ──
  {
    id: "autonomous-business-engine",
    title: "Autonomous Business Engine",
    category: "Advanced",
    tags: ["autonomous", "business", "lifecycle", "playbook"],
    lastUpdated: "2025-01-16",
    content: `The Autonomous Business Engine runs an 8-stage lifecycle for each industry playbook: FIND → QUALIFY → PLAN → EXECUTE → TRACK → OPTIMIZE → REPORT. Each stage writes to specific Prisma tables and emits events on the SSE bus.

Trigger a full cycle with POST /api/business-lifecycle { "industry": "saas" } or click "Run Cycle" in the Autonomous Business panel (Advanced tab). The cycle runs asynchronously and updates the BusinessLifecycle status endpoint (GET /api/business-lifecycle/status) with stage counts and recent deals.

Individual stages can be triggered on their own: POST /api/business-lifecycle/find discovers new EarningOpportunity rows; POST /api/business-lifecycle/qualify scores them; POST /api/business-lifecycle/plan turns a qualified opportunity into a multi-step execution plan; the EXECUTE stage spawns Tasks and dispatches them to agents.

Industry playbooks are JSON documents in src/lib/industry-playbooks.ts covering 12 verticals. Each playbook defines target customer profiles, discovery sources (Twitter, LinkedIn, GitHub, RSS), qualification criteria, pricing models, and operational templates.

The Cash-Claw Sweep (POST /api/cash-claw) runs in parallel with the lifecycle — it ranks every agent by revenue contribution and flags "free rider" agents that have produced zero revenue in the last 7 days. Low-tier agents are demoted or terminated based on the survival score.`,
  },
  {
    id: "industry-playbooks",
    title: "Industry Playbooks",
    category: "Advanced",
    tags: ["playbook", "industry", "template", "vertical"],
    lastUpdated: "2025-01-06",
    content: `Industry Playbooks are pre-configured business templates that encode ARIA's domain expertise for 12 verticals: SaaS, E-commerce, Marketplace, Media, Education, Healthcare, FinTech, Real Estate, Logistics, Hospitality, Consulting, Agency. Each playbook contains customer profiles, discovery sources, qualification criteria, and revenue models.

List playbooks with GET /api/industry-playbooks (metadata only: id, name, industry, agentCount, targetRevenue). Get the full playbook body with POST /api/industry-playbooks { "id": "saas" } — returns the complete JSON including discovery prompts, qualification rules, and execution templates.

Each playbook defines a default agent roster (e.g. SaaS playbook deploys 6 engineers + 2 sales + 1 marketer + 1 success manager + CEO/CTO). When you onboard a new company, the playbook is used as the seed template — you can customize it before activation.

The qualification criteria are evaluated by the LLM against discovered opportunities. For example, the SaaS playbook's criteria include "ARR > $50k", "B2B", "active product", "team > 3". Each criterion produces a 0-1 score; the weighted average becomes the opportunity's feasibilityScore.

To create a custom playbook, add a JSON file to src/lib/industry-playbooks/ and register it in the playbooks registry. The lifecycle engine will pick it up automatically on the next run.`,
  },
  {
    id: "deal-pipeline-management",
    title: "Deal Pipeline Management",
    category: "Advanced",
    tags: ["deal", "pipeline", "kanban", "crm"],
    lastUpdated: "2025-01-05",
    content: `Deals are the revenue-bearing entities in ARIA's CRM. Each Deal has a title, value, stage (lead/qualified/proposal/negotiation/closed-won/closed-lost), probability, expected close date, and a linked company. Deals are stored in the Deal Prisma model and surfaced in two UIs: the Financial Dashboard (Finance tab) and the Deal Kanban (Finance tab, top of page).

The Deal Kanban is a drag-and-drop board — drag deal cards between stage columns to update the stage. Each drop PATCHes /api/deals/[id]/stage with the new stage. The board supports filtering by company, value range, and assigned agent.

Pipeline value is computed as sum(deal.value * deal.probability) across all open deals. This is shown in the Primary Stats Bar (top of dashboard) and the Financial Dashboard. The Revenue Forecast panel uses historical close rates to project the next 30/60/90 days of realized revenue.

Deals are linked to EarningOpportunities (dealId field) — when an opportunity is qualified and enters the pipeline, the lifecycle engine creates a Deal row automatically. The Deal can also be created manually via POST /api/deals.

The CRM Leads panel (Comms tab) is a lighter-weight view focused on lead-stage contacts. PATCH /api/crm/leads/[id]/stage moves a lead through the early funnel; once qualified, the lead is promoted to a full Deal via the lifecycle.`,
  },

  // ── Security ──
  {
    id: "credential-vault",
    title: "Credential Vault",
    category: "Security",
    tags: ["credential", "vault", "encryption", "aes-gcm"],
    lastUpdated: "2025-01-04",
    content: `The Credential Vault encrypts third-party API keys, OAuth tokens, and database credentials at rest using AES-256-GCM. Credentials are stored in the Setting table under keys prefixed with "vault:" — the value column holds the ciphertext + IV + auth tag as a single base64 string.

Add a credential via POST /api/credential-vault { "key": "RESEND_API_KEY", "value": "re_..." }. The route encrypts with the master key (process.env.CREDENTIAL_VAULT_KEY) and persists only the ciphertext. The plaintext is never logged or persisted.

Retrieve a decrypted credential with GET /api/credential-vault/[key] — this returns the plaintext value (use sparingly; the call is audited in the AgentLog table). Most internal modules use the in-process helper getCredential(key) from src/lib/credential-vault.ts which caches the plaintext in memory for 5 minutes.

Delete a credential with DELETE /api/credential-vault/[key] — this removes the row entirely. Deletion is irreversible; if you need to rotate, POST a new value to the same key (it overwrites the ciphertext).

The Credential Vault panel (Advanced tab) lists all stored credential keys with masked values (first 4 + last 4 chars only). It also shows the encryption algorithm, key derivation, and last-rotated timestamp. Critical security events (failed decryption attempts, key rotations, deletions) are written to the Audit Log.`,
  },
  {
    id: "rate-limiting",
    title: "Rate Limiting",
    category: "Security",
    tags: ["rate-limit", "throttle", "abuse", "api"],
    lastUpdated: "2025-01-03",
    content: `API rate limiting is enforced via an in-memory token-bucket per IP address (src/lib/rate-limit.ts). The default limit is 100 requests per minute for unauthenticated calls and 1000 per minute for authenticated calls. Burst capacity is 20 requests per second.

Rate-limited responses return HTTP 429 with a Retry-After header. The LLM Router also enforces provider-specific rate limits via the cooldown mechanism (60s cooldown after a 429 from Z-AI/Groq/NVIDIA). Ollama has no rate limit (it's local).

To inspect current rate-limit state, GET /api/llm-router/status shows each provider's cooldown status. The Audit Log (System tab) records 429 responses as warn-level entries, allowing you to spot abusive clients or runaway agents.

Custom rate limits can be set per route via the Setting table (key: "ratelimit:<route>", value: "<max>/<window-seconds>"). For example, "ratelimit:/api/insights": "10/60" would limit insight generation to 10 calls per minute.

The SSE event stream (/api/events) is not rate-limited (it's a long-lived connection). However, if a client reconnects more than 5 times in 10 seconds, they are temporarily blocked for 30 seconds (anti-abuse measure).`,
  },
  {
    id: "csrf-protection",
    title: "CSRF Protection",
    category: "Security",
    tags: ["csrf", "security", "cookie", "origin"],
    lastUpdated: "2025-01-02",
    content: `ARIA Mission Control enforces CSRF protection on all state-changing routes (POST/PUT/PATCH/DELETE) via the Origin/Referer header check. The middleware (src/middleware.ts) rejects any request whose Origin header does not match the configured ALLOWED_ORIGINS env var (defaults to the same host).

For same-origin browser requests, the Origin header is set automatically by the browser — no special client-side token is needed. For server-to-server calls, the caller must set Origin: <allowed-origin> explicitly. Missing Origin headers (e.g. curl without -H) are rejected with HTTP 403.

The Caddy gateway (Caddyfile) terminates TLS and forwards the Origin header intact. Internal mini-services (e.g. the socket.io sidecar on port 3003) are exempt from CSRF checks because they're not browser-accessible — they use the XTransformPort query param to route through Caddy.

To audit CSRF rejections, query the Audit Log with level=error — middleware rejections are logged with the message "csrf.origin.mismatch" and the offending Origin header value. Repeated mismatches from the same IP trigger an abuse alert.

For WebSocket connections (socket.io), the same-origin policy is enforced by the browser's built-in Origin check on the initial HTTP upgrade — no additional CSRF token is required. The socket.io server (mini-services/ws-relay) verifies the Origin header on the handshake.`,
  },
];

// ─── Functions ───────────────────────────────────────────────────────

/**
 * Returns all articles WITHOUT the full content body — just metadata
 * + a short summary (first ~180 chars of the first paragraph).
 */
export function listArticles(category?: KbCategory): KbArticleSummary[] {
  const filtered = category
    ? KB_ARTICLES.filter((a) => a.category === category)
    : KB_ARTICLES;
  return filtered.map(toSummary);
}

/** Returns the full article (with content) for the given id. */
export function getArticle(id: string): KbArticle | null {
  return KB_ARTICLES.find((a) => a.id === id) ?? null;
}

/**
 * Simple text search across title + tags + content. Returns matching
 * article ids + a 0..1 relevance score (higher = better match).
 *
 * Matching algorithm:
 *   - title match:   +3 (substring) or +5 (exact word)
 *   - tag match:     +2 per matching tag
 *   - content match: +1 per unique query word found in content
 *   - Normalized to 0..1 by dividing by max possible score for the query.
 */
export function searchArticles(query: string): KbSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const words = q.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const maxPossible = 5 + words.length * 2 + words.length * 1;
  const results: KbSearchResult[] = [];

  for (const article of KB_ARTICLES) {
    const title = article.title.toLowerCase();
    const tags = article.tags.map((t) => t.toLowerCase());
    const content = article.content.toLowerCase();

    let score = 0;
    // Title match.
    if (title.includes(q)) score += 3;
    for (const w of words) {
      if (title.includes(w)) score += 1;
      if (title === w) score += 2;
    }
    // Tag match.
    for (const w of words) {
      if (tags.some((t) => t.includes(w))) score += 2;
    }
    // Content match.
    for (const w of words) {
      if (content.includes(w)) score += 1;
    }

    if (score > 0) {
      results.push({
        id: article.id,
        title: article.title,
        category: article.category,
        relevance: Math.min(1, score / maxPossible),
      });
    }
  }

  results.sort((a, b) => b.relevance - a.relevance);
  return results;
}

/** List all unique categories with article counts. */
export function listCategories(): { name: KbCategory; count: number }[] {
  const counts: Record<string, number> = {};
  for (const a of KB_ARTICLES) {
    counts[a.category] = (counts[a.category] ?? 0) + 1;
  }
  return Object.entries(counts).map(([name, count]) => ({
    name: name as KbCategory,
    count,
  }));
}

// ─── Helpers ─────────────────────────────────────────────────────────

function toSummary(article: KbArticle): KbArticleSummary {
  const firstPara = article.content.split("\n\n")[0] ?? "";
  const summary =
    firstPara.length > 180 ? firstPara.slice(0, 180).trimEnd() + "…" : firstPara;
  return {
    id: article.id,
    title: article.title,
    category: article.category,
    tags: article.tags,
    summary,
    lastUpdated: article.lastUpdated,
  };
}
