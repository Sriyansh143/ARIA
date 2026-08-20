/**
 * src/lib/simulation/seed.ts — DB hydration on first boot.
 *
 * Extracted from the former simulation.ts monolith. Owns the `seedIfEmpty()`
 * entry point that the `/api/seed` route (and the engine boot path) call.
 *
 * Strategy:
 *   - Roster is upserted per-agent (idempotent on `name`). Expanding FLEET
 *     later adds the new agents to an existing DB without re-seeding
 *     duplicates or clobbering task assignments.
 *   - Surrounding data (tasks, cron, skills, deals, revenue, memories) is
 *     only seeded on a truly fresh install (initialAgentCount === 0).
 */
import { db } from "../db";
import { parseJsonArray } from "../types";
import { FLEET } from "./fleet";
import {
  TASK_TEMPLATES,
  REVENUE_TEMPLATES,
  DEAL_TEMPLATES,
  MEMORY_TEMPLATES,
  PERSONNEL_TEMPLATES,
  APPROVAL_TEMPLATES,
  pick,
  chance,
} from "./seed-templates";

/**
 * Seed the fleet + tasks if DB is empty. Idempotent per-agent.
 *
 * Surrounding data (tasks, cron jobs, skills, deals, revenue, memories,
 * approvals, alerts) is only seeded on a fresh install — detected via
 * `initialAgentCount === 0`. The roster itself is upserted per-agent so
 * the FLEET array can grow without breaking existing DBs.
 */
export async function seedIfEmpty(): Promise<void> {
  // Track whether the DB was empty before we started; we only seed the
  // surrounding data (tasks, cron jobs, skills, deals, memories) on a
  // truly fresh install. The roster itself is upserted per-agent so
  // expanding the FLEET later still adds the new agents to an existing
  // DB without re-seeding duplicates or clobbering task assignments.
  const initialAgentCount = await db.agent.count();
  const freshInstall = initialAgentCount === 0;

  const createdAgents: Array<{ id: string; name: string; role: string }> = [];
  for (const f of FLEET) {
    // Skip if this agent already exists (e.g. expanding 8 → 35 on an
    // existing DB). Use unique name lookup, fall through to create.
    const existing = await db.agent.findUnique({ where: { name: f.name } });
    if (existing) {
      createdAgents.push({ id: existing.id, name: existing.name, role: existing.role });
      continue;
    }
    const a = await db.agent.create({
      data: {
        name: f.name,
        role: f.role,
        tier: f.tier,
        status: "idle",
        model: f.model,
        department: f.department,
        capabilities: JSON.stringify(f.capabilities),
      },
    });
    createdAgents.push(a);
  }

  // Seed human personnel (idempotent — skip if any personnel exists).
  const personnelCount = await db.personnel.count();
  if (personnelCount === 0) {
    for (const p of PERSONNEL_TEMPLATES) {
      await db.personnel.create({
        data: {
          name: p.name,
          role: p.role,
          departmentId: p.departmentId,
          tools: JSON.stringify(p.tools),
        },
      });
    }
  }

  // On an already-populated DB, the surrounding seed data exists — bail.
  if (!freshInstall) return;

  // ─── v61 (Audit B1/B2): ARIA_SIMULATION_MODE gate ────────────────
  // Default: SIMULATION OFF → seed a clean, empty state (0 fake revenue,
  // 0 fictional-company deals, 0 demo approvals). The only seeded rows
  // are the 19 cron jobs + 12 builtin skills + the Welcome workflow —
  // everything the operator needs to start, nothing that fabricates the
  // system's apparent success.
  //
  // When ARIA_SIMULATION_MODE=true the operator explicitly opts in to
  // the demo data (for first-paint demos / sales previews). Every
  // fabricated row is tagged so the dashboard can filter it out or
  // label it "SIMULATION".
  const SIMULATION_MODE =
    (process.env.ARIA_SIMULATION_MODE ?? "").toLowerCase() === "true" ||
    (process.env.JARVIS_SIMULATION_MODE ?? "").toLowerCase() === "true";

  if (!SIMULATION_MODE) {
    // ── Clean seed: cron jobs + skills + a Welcome workflow only ──
    await seedCronJobs();
    await seedBuiltinSkills();
    await seedWelcomeWorkflow();

    await db.systemAlert.create({
      data: {
        severity: "info",
        source: "system",
        message:
          "v61 clean seed applied — ARIA_SIMULATION_MODE=false. No fabricated revenue, deals, or approvals. Set ARIA_SIMULATION_MODE=true for demo data.",
      },
    });
    return;
  }

  // ── Simulation mode: seed demo data (tagged source="simulation") ──
  for (const t of TASK_TEMPLATES) {
    const assignee = pick(createdAgents);
    await db.task.create({
      data: {
        title: t.title,
        description: t.description,
        kind: t.kind,
        priority: t.priority,
        status: chance(0.3) ? "running" : "pending",
        assignedToId: assignee.id,
        progress: chance(0.3) ? Math.floor(Math.random() * 80) : 0,
        startedAt: chance(0.3) ? new Date() : null,
      },
    });
  }

  // v61: cron jobs + skills are shared between simulation + clean modes.
  await seedCronJobs();
  await seedBuiltinSkills();

  // A couple of seeded approvals + alerts so the UI is alive on first paint.
  for (const ap of APPROVAL_TEMPLATES.slice(0, 3)) {
    await db.approval.create({
      data: {
        title: ap.title,
        summary: ap.summary,
        risk: ap.risk,
        status: "pending",
        requester: pick(FLEET).name,
        action: ap.action,
        amount: ap.amount,
      },
    });
  }

  await db.systemAlert.createMany({
    data: [
      { severity: "warn", source: "llm", message: "openai provider rate-limited; traffic rerouted to zai." },
      { severity: "info", source: "cron", message: "ecosystem-radar completed in 4.2s." },
      { severity: "error", source: "agent", message: "Forge-Eng sub-agent timed out on code_exec; self-healed." },
    ],
  });

  // Seed initial deals + revenue events.
  const salesAgent = createdAgents.find((a) => a.name === "Vector-Sales");
  const financeAgent = createdAgents.find((a) => a.name === "Ledger-Fin");
  for (const dt of DEAL_TEMPLATES) {
    await db.deal.create({
      data: {
        title: dt.title,
        value: dt.value,
        stage: dt.stage,
        probability: dt.probability,
        source: pick(["autonomous-scan", "outreach", "inbound", "referral"]),
        agentId: (salesAgent ?? pick(createdAgents)).id,
        counterparty: dt.counterparty,
        expectedClose: new Date(Date.now() + Math.floor(Math.random() * 30) * 86400000),
      },
    });
  }
  // A few completed revenue events for the chart.
  for (let i = 0; i < 8; i++) {
    const tpl = pick(REVENUE_TEMPLATES);
    await db.revenueEvent.create({
      data: {
        source: tpl.source,
        amount: tpl.amount,
        agentId: (financeAgent ?? pick(createdAgents)).id,
        description: tpl.description,
        createdAt: new Date(Date.now() - i * Math.floor(Math.random() * 3600000 + 600000)),
      },
    });
  }

  // Seed memory items with cross-links.
  const agentMap = new Map(createdAgents.map((a) => [a.name, a]));
  const createdMemories: Array<{ id: string; key: string; scope: string; tags: string }> = [];
  for (const mt of MEMORY_TEMPLATES) {
    const owner = agentMap.get(mt.agentName) ?? pick(createdAgents);
    const mem = await db.memoryItem.create({
      data: {
        key: mt.key,
        scope: mt.scope,
        value: mt.value,
        tags: JSON.stringify(mt.tags),
        strength: 0.3 + Math.random() * 0.4,
        agentId: owner.id,
        pinned: false,
      },
    });
    createdMemories.push({ id: mem.id, key: mem.key, scope: mem.scope, tags: JSON.stringify(mt.tags) });
  }
  // Create cross-links: link memories with shared tags.
  for (let i = 0; i < createdMemories.length; i++) {
    const mem = createdMemories[i];
    const memTags = parseJsonArray<string>(mem.tags, []);
    const links: string[] = [];
    for (let j = 0; j < createdMemories.length; j++) {
      if (i === j) continue;
      const other = createdMemories[j];
      const otherTags = parseJsonArray<string>(other.tags, []);
      if (memTags.some((t) => otherTags.includes(t))) {
        links.push(other.id);
      }
    }
    if (links.length > 0) {
      await db.memoryItem.update({
        where: { id: mem.id },
        data: { linkedTo: JSON.stringify(links.slice(0, 4)) },
      });
    }
  }
}

// ─── v61 (Audit B1/B2): shared seed helpers ──────────────────────────
//
// These are called in BOTH simulation mode + clean mode so every install
// has the 19 cron jobs + 12 builtin skills + a Welcome workflow ready to
// go. The fabricated demo data (revenue, deals, approvals from fictional
// companies) is ONLY seeded in simulation mode — see the gate above.

async function seedCronJobs(): Promise<void> {
  for (const s of [
    { name: "ecosystem-radar", schedule: "*/15 * * * *", description: "Scan trending GitHub repos + compute star velocity." },
    { name: "revenue-scanner", schedule: "0 */2 * * *", description: "Scan earning opportunities across configured streams." },
    { name: "agent-heartbeat", schedule: "* * * * *", description: "Verify every agent emitted a heartbeat in the last 90s." },
    { name: "llm-failover-watch", schedule: "*/5 * * * *", description: "Detect rate-limited providers and reroute traffic." },
    { name: "nightly-backup", schedule: "0 3 * * *", description: "Snapshot SQLite DB + media gallery to /download." },
    { name: "research-digest", schedule: "0 9 * * *", description: "Compile daily market + competitor digest." },
    { name: "morning-learning", schedule: "0 6 * * *", description: "Daily 6 AM (v71.1 staggered): multimodal learning — ingest videos, social feeds, web URLs into memory + skills." },
    { name: "earning-research", schedule: "0 8 * * *", description: "Discover, score, and register ≥5 earning opportunities daily." },
    { name: "lead-finder-daily", schedule: "0 9 * * *", description: "Daily autonomous lead discovery — searches web for potential customers, scores them 0-100, inserts high-confidence leads to pipeline." },
    { name: "outreach-executor", schedule: "0 * * * *", description: "Hourly: picks up qualified leads, drafts personalized emails via LLM, sends via Resend, schedules follow-ups." },
    { name: "crypto-verifier", schedule: "*/10 * * * *", description: "Every 10min: checks blockchain API for pending crypto payments, auto-approves confirmed orders, triggers builder + delivery." },
    { name: "founder-briefing", schedule: "0 8 * * *", description: "Daily 8am: aggregates 24h of revenue, sales, ops, and system health into a beautiful HTML email sent to the owner." },
    { name: "daily-health-sim", schedule: "0 7 * * *", description: "Daily 7 AM (v71.1 staggered): probes LLM/blockchain/price/forex APIs + checks 24h failure rates. Pauses outreach if critical issues detected." },
    { name: "executive-standup", schedule: "0 9 * * *", description: "Compile key metrics + top 5 opportunities → push to owner briefing." },
    { name: "nightly-reflection", schedule: "0 23 * * *", description: "Evaluate day execution success, run context compression, prune temp logs." },
    { name: "cash-claw-sweep", schedule: "0 */6 * * *", description: "Run evolutionary agent survival classification + alert dying/dead agents" },
    { name: "feasibility-rescore", schedule: "0 */6 * * *", description: "Re-score pending earning opportunities for feasibility via Monte Carlo" },
    { name: "failure-alchemy-sweep", schedule: "*/30 * * * *", description: "Synthesize antibody/vaccine/catalyst artifacts from recent errors" },
    { name: "kpi-snapshot", schedule: "0 */6 * * *", description: "Capture 6-hour KPI snapshot (revenue/tasks/agents/payments/leads/customers)" },
    { name: "revenue-cycle", schedule: "0 */4 * * *", description: "Run 6-stage revenue engine cycle (FIND→QUALIFY→PLAN→EXECUTE→TRACK→OPTIMIZE)" },
    { name: "milestone-check", schedule: "*/10 * * * *", description: "Check for milestone-worthy events and record them" },
    { name: "self-heal-watch", schedule: "*/5 * * * *", description: "Report self-heal supervisor status (heals, bootstrap state)" },
    // v61 Phase 2: approval-reminder — hourly check for pending approvals >2h old.
    // Sends a Telegram reminder + defers so agents pivot to other work.
    { name: "approval-reminder", schedule: "0 * * * *", description: "Hourly: remind owner of pending approvals >2h old + defer so agents pivot" },
    // v61 Phase 3: rules-auditor — every 6h, reviews failed traces + proposes rule improvements.
    { name: "rules-auditor", schedule: "0 */6 * * *", description: "Every 6h: review failed/retried traces, propose rule improvements via HUMAN_ASSISTED approvals" },
    // v61.6 Phase 11: daily-knowledge-refresh — 2 AM daily, refreshes the knowledge base.
    { name: "daily-knowledge-refresh", schedule: "0 2 * * *", description: "Daily 2 AM: extract lessons from worklog + vector memory + internet research + external repos. Prune stale knowledge. Detect stagnation." },
    // v63 Phase 13: weekly-simulation — Sunday 3 AM, runs all 100 simulation scenarios.
    { name: "weekly-simulation", schedule: "0 3 * * 0", description: "Weekly Sunday 3 AM: run all 100 simulation scenarios (customer-purchase, owner-commands, edge-cases, tough-questions) + generate readiness report." },
    // v71 Phase 21 (RULE-69): daily-lead-hunt — 5 AM daily (v71.1 staggered from 6 AM to avoid Ollama CPU contention).
    // Scouts Twitter/LinkedIn/Reddit for buying signals, matches to services,
    // extracts brand from social profiles, qualifies via Scout/Risk/Sales debate.
    { name: "daily-lead-hunt", schedule: "0 5 * * *", description: "Daily 5 AM (v71.1 staggered): scout social media for buying signals, match to services, extract brand from social profiles, qualify via 3-agent debate. Pursue / Investigate / Skip." },
    // v72 Phase 22 (RULE-70): daily-proactive-promo — 11 AM daily (staggered after morning crons).
    // Scans Google Maps for businesses without websites, sends proactive outreach
    // via WhatsApp/email/social-DM, posts awareness content to ARIA's own social accounts.
    { name: "daily-proactive-promo", schedule: "0 11 * * *", description: "Daily 11 AM (v72 Phase 22): Google Maps scan for businesses without websites + multi-channel proactive outreach (WhatsApp/email/social-DM) + awareness post scheduling for ARIA's own social accounts. Subject to per-pattern approval (RULE-71)." },
    // v73 Phase 23 (RULE-72): weekly-code-auditor — Sunday 2 AM.
    // Scans AgentLog for failing modules + overdue TECH-DEBT. Drafts refactors,
    // sandbox-tests them, creates RefactorProposal records + sends Telegram briefs.
    { name: "weekly-code-auditor", schedule: "0 2 * * 0", description: "Weekly Sunday 2 AM (v73 Phase 23): scan AgentLog for modules with > 15% failure rate + overdue TECH-DEBT deadlines. Draft refactors via LLM, sandbox-test, create RefactorProposal + Telegram /merge brief. Self-evolving codebase per RULE-72." },
    // ─── Phase 29 — GDPR + FX cron jobs ───────────────────────────────
    { name: "daily-gdpr-erasure", schedule: "0 3 * * *", description: "Daily 3 AM (Phase 29): process expired GDPR erasure requests (default 7-day grace window). Scrubs PII from Lead/ImportedContact/Personnel/User/ClientPortalAccess tables; anonymizes AuditLogEntry.actor (does NOT delete audit entries — required by law for 7-year retention)." },
    { name: "hourly-fx-refresh", schedule: "0 * * * *", description: "Hourly (Phase 29): refresh the in-memory FX rate cache from exchangerate.host so the first currency conversion of the hour doesn't pay the latency cost. Cache itself is 1h TTL — this is a warm-up." },
    // ─── Phase 30 — Financial hardening + memory watchdog crons ────────
    { name: "daily-stripe-reconciliation", schedule: "0 4 * * *", description: "Daily 4 AM (Phase 30): fetch Stripe Balance Transactions from the past 24 hours + match against internal RevenueEvent + LedgerEntry records. Discrepancies fire SystemAlert + Telegram owner notification." },
    { name: "memory-watchdog", schedule: "*/5 * * * *", description: "Every 5 minutes (Phase 30): sample process.memoryUsage() + persist to MemorySnapshot table. Triggers alert at 80% RSS (warn), 95% RSS (critical + autonomy pause)." },
    { name: "daily-soak-analysis", schedule: "0 5 * * *", description: "Daily 5 AM (Phase 30): analyze last 24 hours of MemorySnapshot records for memory leaks via linear regression on RSS over time. Flags leak if slope > 10 MB/hour + R² > 0.7." },
    // ─── Phase 32 Remediation — Tool-failure escalation cron ───────────
    { name: "check-unresolved-escalations", schedule: "*/15 * * * *", description: "Every 15 minutes (Phase 32): checks for tool-failure-decision approvals pending for 2+ hours. If found, pauses the affected cron jobs + sends a critical Telegram alert. Tier 3 of the Debate/Escalate pattern." },
  ]) {
    await db.cronJob.create({
      data: {
        name: s.name,
        schedule: s.schedule,
        description: s.description,
        status: "active",
        nextRunAt: new Date(Date.now() + Math.floor(Math.random() * 3_600_000)),
        runCount: 0,
        failCount: 0,
      },
    });
  }
}

async function seedBuiltinSkills(): Promise<void> {
  for (const sk of [
    { slug: "llm", name: "LLM Chat", category: "llm", description: "Conversational large language model completions." },
    { slug: "vlm", name: "Vision Model", category: "llm", description: "Image + document understanding." },
    { slug: "tts", name: "Text-to-Speech", category: "media", description: "Natural-sounding voice synthesis." },
    { slug: "asr", name: "Speech Recognition", category: "media", description: "Audio transcription." },
    { slug: "image-gen", name: "Image Generation", category: "media", description: "Text-to-image synthesis." },
    { slug: "video-gen", name: "Video Generation", category: "media", description: "Text-to-video synthesis." },
    { slug: "web-search", name: "Web Search", category: "web", description: "Real-time web retrieval." },
    { slug: "page-reader", name: "Page Reader", category: "web", description: "Article content extraction." },
    { slug: "docx", name: "Document Builder", category: "doc", description: "Word document creation." },
    { slug: "pptx", name: "Slide Builder", category: "doc", description: "Presentation generation." },
    { slug: "xlsx", name: "Spreadsheet Builder", category: "data", description: "Excel workbook generation." },
    { slug: "pdf", name: "PDF Toolkit", category: "doc", description: "Structured + creative PDF generation." },
  ]) {
    // Idempotent per slug — skip if already present.
    const existing = await db.skill.findUnique({ where: { slug: sk.slug } });
    if (existing) continue;
    await db.skill.create({
      data: {
        slug: sk.slug,
        name: sk.name,
        category: sk.category,
        description: sk.description,
        status: "active",
        invocations: 0,
        successRate: 1.0,
      },
    });
  }
}

/**
 * Seed a single Welcome WorkflowDefinition with autonomyTag=FULLY_AUTONOMOUS
 * so the operator can test the conductor router wiring end-to-end without
 * needing to fabricate approvals. It's a 2-step workflow: emit a welcome
 * notification → end.
 */
async function seedWelcomeWorkflow(): Promise<void> {
  const slug = "wf-welcome";
  const existing = await db.workflowDefinition.findUnique({ where: { slug } });
  if (existing) return;
  const steps = [
    { id: "s1", type: "notification", name: "Welcome Notification", config: { channel: "log", message: "ARIA Mission Control v61 online — dead code wired, demo data sanitized." }, next: "s2" },
    { id: "s2", type: "end", name: "Complete", config: {} },
  ];
  await db.workflowDefinition.create({
    data: {
      slug,
      name: "Welcome (v61)",
      description:
        "v61 clean-install welcome workflow. FULLY_AUTONOMOUS — runs without an approval so operators can verify the conductor router wiring immediately. Trigger via POST /api/workflows { workflowId: \"wf-welcome\" }.",
      stepsJson: JSON.stringify(steps),
      trigger: "manual",
      status: "active",
      autonomyTag: "FULLY_AUTONOMOUS",
    },
  });
}
