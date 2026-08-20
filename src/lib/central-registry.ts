/**
 * src/lib/central-registry.ts — Centralized System Registry
 *
 * Single source of truth for what the app does, what agents exist,
 * what tools are available, what API routes exist, and what models
 * are configured. Every page/component reads from here so there's
 * no inconsistency.
 *
 * This prevents the "page shows wrong info" problem by being the
 * canonical registry that all UI components import from.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { cacheGet, cacheSet } from "@/lib/cache";
import { traceAsync } from "@/lib/tracing";

export interface SystemSnapshot {
  agents: {
    total: number;
    active: number;
    byDepartment: Record<string, number>;
    byStatus: Record<string, number>;
  };
  tasks: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
  };
  approvals: {
    total: number;
    pending: number;
    approved: number;
    denied: number;
  };
  opportunities: {
    total: number;
    today: number;
    qualified: number;
    inPipeline: number;
    totalEstimatedRevenue: number;
  };
  companies: {
    total: number;
    active: number;
  };
  memories: {
    total: number;
    pinned: number;
  };
  skills: {
    total: number;
    learned: number;  // source = "learned"
    invocations: number;
  };
  simulations: {
    total: number;
    running: number;
    completed: number;
  };
  llmCalls: {
    total: number;
    today: number;
    byProvider: Record<string, number>;
  };
  revenue: {
    total: number;
    today: number;
    month: number;
  };
  alerts: {
    total: number;
    unacked: number;
    critical: number;
  };
  cronJobs: {
    total: number;
    active: number;
  };
  lastUpdated: string;
}

/**
 * Get a complete snapshot of the system state.
 * This is the canonical source of truth for all dashboard panels.
 */
export async function getSystemSnapshot(): Promise<SystemSnapshot> {
  // Cache the snapshot for 5 seconds — the dashboard polls /api/system
  // frequently and this prevents 12 parallel DB queries on every request.
  const cached = cacheGet<SystemSnapshot>("system:snapshot");
  if (cached) return cached;

  return traceAsync("getSystemSnapshot", async () => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Run all queries in parallel for speed
    const [
      agents,
      tasks,
      approvals,
      opportunities,
      companies,
      memories,
      skills,
      simulations,
      llmCalls,
      revenueEvents,
      alerts,
      cronJobs,
    ] = await Promise.all([
      db.agent.findMany(),
      db.task.findMany(),
      db.approval.findMany(),
      db.earningOpportunity.findMany(),
      db.companyProfile.findMany(),
      db.memoryItem.findMany(),
      db.skill.findMany(),
      db.simulationRun.findMany(),
      db.llmCall.findMany({ take: 1000, orderBy: { createdAt: "desc" } }),
      db.revenueEvent.findMany(),
      db.systemAlert.findMany(),
      db.cronJob.findMany(),
    ]);

    // Aggregate agents by department + status
    const byDepartment: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let activeAgents = 0;
    for (const a of agents) {
      const dept = a.department ?? "Unassigned";
      byDepartment[dept] = (byDepartment[dept] ?? 0) + 1;
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
      if (a.status !== "offline" && a.status !== "idle") activeAgents++;
    }

    // Aggregate tasks by status
    const taskStatus = { pending: 0, running: 0, completed: 0, failed: 0 };
    for (const t of tasks) {
      if (t.status in taskStatus) {
        (taskStatus as Record<string, number>)[t.status]++;
      }
    }

    // Aggregate approvals
    const approvalStatus = { pending: 0, approved: 0, denied: 0 };
    for (const a of approvals) {
      if (a.status in approvalStatus) {
        (approvalStatus as Record<string, number>)[a.status]++;
      }
    }

    // Aggregate opportunities
    const todayOpps = opportunities.filter((o) => o.discoveredAt >= todayStart);
    const qualifiedOpps = opportunities.filter((o) => o.status === "qualified" || o.status === "pipeline");
    const pipelineOpps = opportunities.filter((o) => o.status === "pipeline" || o.status === "executing");
    const totalEstRevenue = opportunities.reduce((sum, o) => sum + o.estimatedRevenue, 0);

    // Aggregate LLM calls by provider
    const byProvider: Record<string, number> = {};
    let llmCallsToday = 0;
    for (const c of llmCalls) {
      byProvider[c.provider] = (byProvider[c.provider] ?? 0) + 1;
      if (c.createdAt >= todayStart) llmCallsToday++;
    }

    // Aggregate revenue
    const revenueToday = revenueEvents.filter((r) => r.createdAt >= todayStart).reduce((s, r) => s + r.amount, 0);
    const revenueMonth = revenueEvents.filter((r) => r.createdAt >= monthStart).reduce((s, r) => s + r.amount, 0);
    const revenueTotal = revenueEvents.reduce((s, r) => s + r.amount, 0);

    // Aggregate alerts
    const unacked = alerts.filter((a) => !a.ack).length;
    const critical = alerts.filter((a) => !a.ack && a.severity === "critical").length;

    const result = {
      agents: {
        total: agents.length,
        active: activeAgents,
        byDepartment,
        byStatus,
      },
      tasks: {
        total: tasks.length,
        ...taskStatus,
      },
      approvals: {
        total: approvals.length,
        ...approvalStatus,
      },
      opportunities: {
        total: opportunities.length,
        today: todayOpps.length,
        qualified: qualifiedOpps.length,
        inPipeline: pipelineOpps.length,
        totalEstimatedRevenue: totalEstRevenue,
      },
      companies: {
        total: companies.length,
        active: companies.filter((c) => c.isActive ?? true).length,
      },
      memories: {
        total: memories.length,
        pinned: memories.filter((m) => m.pinned).length,
      },
      skills: {
        total: skills.length,
        learned: skills.filter((s) => s.source === "learned").length,
        invocations: skills.reduce((s, skill) => s + skill.invocations, 0),
      },
      simulations: {
        total: simulations.length,
        running: simulations.filter((s) => s.status === "running").length,
        completed: simulations.filter((s) => s.status === "completed").length,
      },
      llmCalls: {
        total: llmCalls.length,
        today: llmCallsToday,
        byProvider,
      },
      revenue: {
        total: revenueTotal,
        today: revenueToday,
        month: revenueMonth,
      },
      alerts: {
        total: alerts.length,
        unacked,
        critical,
      },
      cronJobs: {
        total: cronJobs.length,
        active: cronJobs.filter((c) => c.status === "active").length,
      },
      lastUpdated: new Date().toISOString(),
    };
    // Cache for 5 seconds to prevent redundant DB queries on rapid polls
    cacheSet("system:snapshot", result, 5000);
    return result;
  } catch (err) {
    logger.error("central-registry.snapshot.error", { error: String(err) });
    // Return empty snapshot on error — never crash the dashboard
    return {
      agents: { total: 0, active: 0, byDepartment: {}, byStatus: {} },
      tasks: { total: 0, pending: 0, running: 0, completed: 0, failed: 0 },
      approvals: { total: 0, pending: 0, approved: 0, denied: 0 },
      opportunities: { total: 0, today: 0, qualified: 0, inPipeline: 0, totalEstimatedRevenue: 0 },
      companies: { total: 0, active: 0 },
      memories: { total: 0, pinned: 0 },
      skills: { total: 0, learned: 0, invocations: 0 },
      simulations: { total: 0, running: 0, completed: 0 },
      llmCalls: { total: 0, today: 0, byProvider: {} },
      revenue: { total: 0, today: 0, month: 0 },
      alerts: { total: 0, unacked: 0, critical: 0 },
      cronJobs: { total: 0, active: 0 },
      lastUpdated: new Date().toISOString(),
    };
  }
  });
}

/**
 * Get the canonical list of all features the app has.
 * Used by the dashboard to show consistent information across all panels.
 */
export const APP_FEATURES = [
  { id: "agent-fleet", name: "Agent Fleet", count: 37, category: "Core", tab: "#roster" },
  { id: "department-network", name: "Department Network", count: 15, category: "Core", tab: "#department-network" },
  { id: "task-pipeline", name: "Task Pipeline", count: null, category: "Core", tab: "#task-pipeline" },
  { id: "approvals", name: "Approval System", count: null, category: "Governance", tab: "#approval-queue" },
  { id: "debate", name: "Debate Engine", count: null, category: "Core", tab: "#debate" },
  { id: "simulation", name: "100x Simulator", count: null, category: "Core", tab: "#simulation" },
  { id: "earning-research", name: "Earning Researcher", count: null, category: "Revenue", tab: "#financial" },
  { id: "financial", name: "Financial Dashboard", count: null, category: "Revenue", tab: "#financial" },
  { id: "investors", name: "Investor System", count: null, category: "Revenue", tab: "#financial" },
  { id: "marketing", name: "Marketing Queue", count: null, category: "Growth", tab: "#marketing" },
  { id: "polls", name: "Polling System", count: null, category: "Governance", tab: "#polls" },
  { id: "briefs", name: "Owner Briefs", count: null, category: "Governance", tab: "#briefs" },
  { id: "memory", name: "Memory Network", count: null, category: "Intelligence", tab: "#memory-network" },
  { id: "skills", name: "Skills Registry", count: null, category: "Intelligence", tab: "#skills" },
  { id: "code-sandbox", name: "Code Sandbox", count: null, category: "Tools", tab: "#code" },
  { id: "metrics", name: "Metrics Dashboard", count: null, category: "System", tab: "#telemetry" },
  { id: "monitor", name: "System Monitor", count: null, category: "System", tab: "#system-health" },
  { id: "live-chat", name: "Live Voice Chat", count: null, category: "Interaction", tab: "#live-chat" },
  { id: "screen-vision", name: "Screen Vision", count: null, category: "Interaction", tab: "#screen-vision" },
  { id: "companies", name: "Multi-Company", count: null, category: "Core", tab: "#companies" },
] as const;

/**
 * Get the canonical list of all API routes.
 * Used for documentation and the command palette.
 */
export const API_ROUTES = [
  { method: "GET", path: "/api", desc: "Health check" },
  { method: "GET", path: "/api/health", desc: "Liveness + DB readiness probe (public)" },
  { method: "GET", path: "/api/seed", desc: "Seed database + start engines" },
  { method: "GET", path: "/api/events", desc: "SSE event stream" },
  { method: "GET", path: "/api/hermes/skills", desc: "List skills" },
  { method: "POST", path: "/api/hermes/skills", desc: "Create/load skill" },
  { method: "GET", path: "/api/hermes/memory", desc: "Search memory" },
  { method: "POST", path: "/api/hermes/memory", desc: "Store memory" },
  { method: "POST", path: "/api/hermes/execute", desc: "Execute Hermes tool call" },
  { method: "POST", path: "/api/learning/ingest", desc: "Ingest URL/social/video" },
  { method: "GET", path: "/api/earning/research", desc: "List earning opportunities" },
  { method: "POST", path: "/api/earning/research", desc: "Run daily earning research" },
  { method: "GET", path: "/api/companies", desc: "List companies" },
  { method: "POST", path: "/api/companies", desc: "Create company" },
  { method: "GET", path: "/api/companies/[id]", desc: "Get company" },
  { method: "PUT", path: "/api/companies/[id]", desc: "Update company" },
  { method: "DELETE", path: "/api/companies/[id]", desc: "Deactivate company" },
  { method: "GET", path: "/api/approvals", desc: "List approvals" },
  { method: "POST", path: "/api/approvals", desc: "Create approval" },
  { method: "PATCH", path: "/api/approvals/[id]", desc: "Approve/deny" },
  { method: "POST", path: "/api/approvals/[id]/discuss", desc: "Discuss approval" },
  { method: "POST", path: "/api/approvals/[id]/oral-confirm", desc: "Oral voice confirm" },
  { method: "GET", path: "/api/approvals/[id]/decision", desc: "Get centralized decision" },
  { method: "POST", path: "/api/approvals/[id]/decision", desc: "Trigger monitoring-agent decision" },
  { method: "GET", path: "/api/simulator", desc: "List simulation runs" },
  { method: "POST", path: "/api/simulator", desc: "Start 100x simulation" },
  { method: "GET", path: "/api/simulator/[id]", desc: "Get run + iterations" },
  { method: "DELETE", path: "/api/simulator/[id]", desc: "Delete simulation run" },
  { method: "GET", path: "/api/simulator/[id]/result", desc: "Get best iteration" },
  { method: "GET", path: "/api/planner", desc: "Planner metadata" },
  { method: "POST", path: "/api/planner", desc: "Analyze task + generate plan" },
  { method: "GET", path: "/api/monitor", desc: "App health check" },
  { method: "POST", path: "/api/monitor", desc: "Trigger fresh monitor check" },
  { method: "POST", path: "/api/monitor/heal", desc: "Heal specific agent" },
  { method: "POST", path: "/api/screen-vision", desc: "Analyze screenshot via VLM" },
  { method: "POST", path: "/api/conductor", desc: "Route message to best agent" },
  { method: "GET", path: "/api/costs", desc: "Agent cost breakdown" },
  { method: "GET", path: "/api/funnel", desc: "Lead staleness triage" },
  { method: "GET", path: "/api/tasks", desc: "List tasks" },
  { method: "POST", path: "/api/tasks", desc: "Create task" },
  { method: "GET", path: "/api/alerts", desc: "List system alerts" },
  { method: "PATCH", path: "/api/alerts/[id]/ack", desc: "Acknowledge alert" },
  { method: "POST", path: "/api/alerts/ack-all", desc: "Acknowledge all unacked alerts" },
  { method: "GET", path: "/api/cron", desc: "List cron jobs" },
  { method: "POST", path: "/api/cron/[id]/run", desc: "Manually trigger cron job" },
  { method: "GET", path: "/api/workflows", desc: "List workflows" },
  { method: "POST", path: "/api/workflows", desc: "Trigger workflow" },
  { method: "GET", path: "/api/chat", desc: "LLM chat completion" },
  { method: "GET", path: "/api/system", desc: "Centralized system snapshot" },
  { method: "POST", path: "/api/telephony/call", desc: "Initiate phone call (FreeSWITCH/Dograh)" },
  { method: "GET", path: "/api/telephony/call", desc: "Telephony config status" },
  { method: "POST", path: "/api/telephony/sms", desc: "Send SMS via Dograh" },
  { method: "GET", path: "/api/telephony/status", desc: "Combined telephony + LLM provider status" },
  { method: "GET", path: "/api/tts", desc: "TTS engine status (browser + Z-AI)" },
  { method: "GET", path: "/api/crm/leads", desc: "List CRM leads" },
  { method: "POST", path: "/api/crm/leads", desc: "Create CRM lead" },
  { method: "PATCH", path: "/api/crm/leads/[id]/stage", desc: "Update lead stage" },
  { method: "GET", path: "/api/crm/pipeline", desc: "Pipeline summary (counts + value by stage)" },
  { method: "GET", path: "/api/llm-router/status", desc: "Multi-provider LLM router status" },
  { method: "GET", path: "/api/blackbox", desc: "Blackbox flight recorder entries + stats" },
  { method: "GET", path: "/api/training", desc: "Training history" },
  { method: "POST", path: "/api/training/teach", desc: "Teach an agent from a source" },
  { method: "POST", path: "/api/training/feedback", desc: "Inject reinforcement feedback" },
  // ── MERGE-CORE: v25 capability ports ──
  { method: "GET", path: "/api/credential-vault", desc: "List encrypted credentials (masked)" },
  { method: "POST", path: "/api/credential-vault", desc: "Encrypt + store a credential (AES-256-GCM)" },
  { method: "GET", path: "/api/credential-vault/[key]", desc: "Decrypt a credential by key" },
  { method: "DELETE", path: "/api/credential-vault/[key]", desc: "Delete a credential" },
  { method: "POST", path: "/api/system-access/request", desc: "Request a system-access session (shell/browser/fs/computer-use)" },
  { method: "GET", path: "/api/system-access/approvals", desc: "List pending access approvals" },
  { method: "POST", path: "/api/system-access/approvals/[id]/decide", desc: "Approve/deny an access request" },
  { method: "GET", path: "/api/system-access/session", desc: "List system-access sessions" },
  { method: "POST", path: "/api/system-access/session/[id]/revoke", desc: "Revoke an approved session" },
  { method: "POST", path: "/api/computer-use", desc: "Screen capture / VLM analyze / GUI action (graceful degrade)" },
  { method: "GET", path: "/api/mcp-client", desc: "List registered MCP servers" },
  { method: "POST", path: "/api/mcp-client", desc: "Register or call an MCP server tool" },
  { method: "GET", path: "/api/cash-claw", desc: "Survival board (agent tier + score)" },
  { method: "POST", path: "/api/cash-claw", desc: "Run a cash-claw sweep across the fleet" },
  { method: "GET", path: "/api/debate", desc: "List multi-model debate sessions" },
  { method: "POST", path: "/api/debate", desc: "Start a new multi-model debate" },
  { method: "GET", path: "/api/debate/[id]", desc: "Get a single debate (with transcript)" },
  { method: "GET", path: "/api/failure-alchemy", desc: "List failure-alchemy artifacts" },
  { method: "POST", path: "/api/failure-alchemy", desc: "Synthesize new artifacts from recent errors" },
  { method: "GET", path: "/api/revenue-engine", desc: "6-stage revenue pipeline snapshot" },
  { method: "POST", path: "/api/revenue-engine", desc: "Run one FIND→QUALIFY→PLAN→EXECUTE→TRACK→OPTIMIZE cycle" },
  { method: "GET", path: "/api/notes", desc: "List owner/agent notes" },
  { method: "POST", path: "/api/notes", desc: "Create a note" },
  { method: "PUT", path: "/api/notes/[id]", desc: "Update a note" },
  { method: "DELETE", path: "/api/notes/[id]", desc: "Delete a note" },
  { method: "GET", path: "/api/milestones", desc: "List milestone events" },
  { method: "POST", path: "/api/milestones", desc: "Record a milestone event" },
  { method: "POST", path: "/api/milestones/[id]/viewed", desc: "Mark a milestone viewed" },
  { method: "GET", path: "/api/kpis", desc: "KPI summary (latest snapshot + 24h deltas)" },
  { method: "POST", path: "/api/kpis", desc: "Capture a fresh KPI snapshot" },
  { method: "POST", path: "/api/image-gen", desc: "Generate an image via z-ai-web-dev-sdk" },
  { method: "GET", path: "/api/export", desc: "JSON snapshot of all major tables (no secrets)" },
  // ── AUTONOMOUS-BUSINESS-ENGINE: industry playbooks + 8-stage lifecycle ──
  { method: "GET", path: "/api/industry-playbooks", desc: "List 12 industry playbooks (metadata only)" },
  { method: "POST", path: "/api/industry-playbooks", desc: "Get a single full playbook by id" },
  { method: "GET", path: "/api/business-lifecycle", desc: "8-stage lifecycle pipeline counts (FIND→OPTIMIZE)" },
  { method: "POST", path: "/api/business-lifecycle", desc: "Run a full autonomous cycle for an industry" },
  { method: "POST", path: "/api/business-lifecycle/find", desc: "Find opportunities for an industry playbook" },
  { method: "POST", path: "/api/business-lifecycle/qualify", desc: "Qualify a batch of FoundOpportunities" },
  { method: "POST", path: "/api/business-lifecycle/plan", desc: "Generate execution plan for one opportunity" },
  { method: "GET", path: "/api/business-lifecycle/status", desc: "Lifecycle pipeline status (deals/tasks/revenue + recent cycles)" },
  // ── FEATURES-ANALYTICS-METRICS: real system metrics ──
  { method: "GET", path: "/api/system-metrics", desc: "Real system metrics (CPU, memory, disk, network)" },
  // ── FEATURES-DEAL-KANBAN: drag-and-drop deal stage updates ──
  { method: "PATCH", path: "/api/deals/[id]/stage", desc: "Update deal stage (kanban drag)" },
  // ── FEATURES-MULTICOMPANY-WORKFLOWS-CONNECTORS: multi-company cycles, workflow templates, connectors ──
  { method: "GET", path: "/api/multi-company-cycles", desc: "Multi-company cycle status" },
  { method: "POST", path: "/api/multi-company-cycles", desc: "Run cycles for all companies" },
  { method: "GET", path: "/api/workflow-templates", desc: "List all workflow templates" },
  { method: "GET", path: "/api/connectors", desc: "List connectors" },
  { method: "POST", path: "/api/connectors", desc: "Install a connector" },
  // ── FEATURES-INSIGHTS-KB-AUDIT: AI insights, knowledge base, audit log ──
  { method: "GET", path: "/api/insights", desc: "AI-generated insights & recommendations" },
  { method: "POST", path: "/api/insights", desc: "Force regenerate insights" },
  { method: "GET", path: "/api/knowledge-base", desc: "KB articles (list/search/get)" },
  { method: "GET", path: "/api/audit-log", desc: "Audit trail (logs + approvals + alerts)" },
  // ── FEATURES-STREAM-GOALS-COST: activity stream, goals & OKRs, cost dashboard ──
  { method: "GET", path: "/api/goals", desc: "List goals & OKRs" },
  { method: "POST", path: "/api/goals", desc: "Save goals" },
  { method: "PATCH", path: "/api/goals", desc: "Update goal progress" },
  { method: "GET", path: "/api/cost-dashboard", desc: "LLM cost breakdown + budget" },
  // ── HARDEN-SCALE-DOCS: OpenAPI spec + documentation endpoint ──
  { method: "GET", path: "/api/openapi", desc: "OpenAPI 3.0 spec" },
  // ── HARDEN-OBSERVE-DEVOPS-SEC: tracing + 2FA/TOTP ──
  { method: "GET", path: "/api/tracing", desc: "Trace spans + stats" },
  { method: "POST", path: "/api/2fa/setup", desc: "Generate TOTP secret" },
  { method: "POST", path: "/api/2fa/verify", desc: "Verify TOTP + enable 2FA" },
  { method: "GET", path: "/api/2fa/status", desc: "Check 2FA status" },
] as const;
