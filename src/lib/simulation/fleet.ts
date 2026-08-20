/**
 * src/lib/simulation/fleet.ts — 37-agent roster + serializer.
 *
 * Extracted from the former simulation.ts monolith. Owns the static fleet
 * definition (name/role/tier/model/department/capabilities), the provider→model
 * catalog, the per-status log-message pool, and the DB→API serializer.
 *
 * Re-exports AGENT_STATUSES from `@/lib/types` so callers can keep importing
 * it via `@/lib/simulation` (the barrel).
 */
import {
  AGENT_ROLES,
  AGENT_STATUSES,
  AGENT_TIERS,
  type Agent,
  type AgentStatus,
  toIso,
  parseJsonArray,
} from "../types";

// Re-export so the barrel can surface AGENT_STATUSES without coupling callers
// to the underlying types module.
export { AGENT_STATUSES };

/**
 * The full agent roster (v36: expanded from 37 to 80+ agents with proper
 * organizational hierarchy — Lead, Senior, Junior, Manager tiers per dept).
 *
 * Hierarchy model (inspired by real agency structures):
 *   - Lead    (strong tier)   — senior decision-maker, owns the department
 *   - Senior  (balanced tier) — experienced individual contributor
 *   - Junior  (fast tier)     — entry-level, handles routine tasks
 *
 * Each department now has 3-9 agents covering the full hierarchy.
 */
export const FLEET: Array<{
  name: string;
  role: (typeof AGENT_ROLES)[number];
  tier: (typeof AGENT_TIERS)[number];
  model: string;
  department: string;
  capabilities: string[];
}> = [
  // ── Executive ──────────────────────────────────────────────────────
  { name: "Aria-CEO",     role: "CEO",  tier: "strong",   model: "tier:strong",     department: "Executive",     capabilities: ["strategy", "approval", "forecast", "board-comms"] },
  { name: "Sage-COO",     role: "COO",  tier: "strong",   model: "tier:strong",     department: "Executive",     capabilities: ["operations", "resource-allocation", "cross-dept-coordination"] },
  { name: "Ledger-CFO",   role: "CFO",  tier: "strong",   model: "tier:strong",     department: "Executive",     capabilities: ["capital-strategy", "investor-relations", "financial-planning"] },
  // ── Engineering ────────────────────────────────────────────────────
  { name: "Aria-CTO",         role: "CTO",         tier: "strong",   model: "tier:strong",     department: "Engineering", capabilities: ["architecture", "code-review", "tech-decisions"] },
  { name: "Forge-SrEng",      role: "Engineering", tier: "balanced", model: "tier:balanced", department: "Engineering", capabilities: ["codegen", "test", "deploy", "pr-review", "mentoring"] },
  { name: "Forge-Eng",        role: "Engineering", tier: "balanced", model: "tier:balanced", department: "Engineering", capabilities: ["codegen", "test", "deploy", "pr-review"] },
  { name: "Forge-JrEng",      role: "Engineering", tier: "fast",     model: "tier:fast", department: "Engineering", capabilities: ["codegen", "test", "bug-fixes"] },
  { name: "Stack-DevOpsLead", role: "DevOps",      tier: "strong",   model: "tier:strong", department: "Engineering", capabilities: ["ci-cd", "k8s", "infrastructure-as-code", "observability", "team-lead"] },
  { name: "Stack-DevOps",     role: "DevOps",      tier: "balanced", model: "tier:balanced", department: "Engineering", capabilities: ["ci-cd", "k8s", "infrastructure-as-code", "observability"] },
  { name: "Shield-QALead",    role: "QA",          tier: "balanced", model: "tier:balanced", department: "Engineering", capabilities: ["test-automation", "regression", "bug-triage", "test-strategy"] },
  { name: "Shield-QA",        role: "QA",          tier: "fast",     model: "tier:fast", department: "Engineering", capabilities: ["test-automation", "regression", "bug-triage"] },
  { name: "Apex-Architect",   role: "Architect",   tier: "strong",   model: "tier:strong",     department: "Engineering", capabilities: ["system-design", "tradeoff-analysis", "adr-authoring"] },
  // ── Research ───────────────────────────────────────────────────────
  { name: "Nova-ResearchLead",    role: "Research",      tier: "strong",   model: "tier:strong",     department: "Research", capabilities: ["web-search", "synthesis", "radar", "competitive-intel", "team-lead"] },
  { name: "Nova-Research",        role: "Research",      tier: "strong",   model: "tier:strong",     department: "Research", capabilities: ["web-search", "synthesis", "radar", "competitive-intel"] },
  { name: "Nova-JrResearch",      role: "Research",      tier: "fast",     model: "tier:fast", department: "Research", capabilities: ["web-search", "data-collection"] },
  { name: "Prism-SrDataAnalyst",  role: "DataAnalyst",   tier: "balanced", model: "tier:balanced",     department: "Research", capabilities: ["sql", "dashboarding", "anomaly-detection", "mentoring"] },
  { name: "Prism-DataAnalyst",    role: "DataAnalyst",   tier: "balanced", model: "tier:balanced",     department: "Research", capabilities: ["sql", "dashboarding", "anomaly-detection"] },
  { name: "Quant-DataScientist",  role: "DataScientist", tier: "strong",   model: "tier:strong",     department: "Research", capabilities: ["ml-modeling", "forecasting", "experimentation"] },
  // ── Operations ─────────────────────────────────────────────────────
  { name: "Pulse-OpsLead",  role: "Ops",            tier: "balanced", model: "tier:balanced", department: "Operations", capabilities: ["monitoring", "self-healing", "cron", "incident-response", "team-lead"] },
  { name: "Pulse-Ops",       role: "Ops",            tier: "fast",     model: "tier:fast", department: "Operations", capabilities: ["monitoring", "self-healing", "cron", "incident-response"] },
  { name: "Pulse-JrOps",     role: "Ops",            tier: "fast",     model: "tier:fast", department: "Operations", capabilities: ["monitoring", "alert-triage"] },
  { name: "Atlas-SrPM",      role: "ProjectManager", tier: "balanced", model: "tier:balanced", department: "Operations", capabilities: ["sprint-planning", "gantt", "stakeholder-updates", "risk-mgmt"] },
  { name: "Atlas-PM",        role: "ProjectManager", tier: "balanced", model: "tier:balanced", department: "Operations", capabilities: ["sprint-planning", "gantt", "stakeholder-updates"] },
  { name: "Guard-Compliance",role: "Compliance",     tier: "balanced", model: "tier:balanced",     department: "Operations", capabilities: ["policy-audit", "soc2", "data-retention"] },
  // ── Finance ────────────────────────────────────────────────────────
  { name: "Ledger-FinLead",       role: "Finance",           tier: "strong",   model: "tier:strong",     department: "Finance", capabilities: ["invoicing", "forecast", "revenue", "pricing", "team-lead"] },
  { name: "Ledger-Fin",           role: "Finance",           tier: "balanced", model: "tier:balanced",     department: "Finance", capabilities: ["invoicing", "forecast", "revenue", "pricing"] },
  { name: "Balance-SrAccountant", role: "Accountant",        tier: "balanced", model: "tier:balanced", department: "Finance", capabilities: ["bookkeeping", "reconciliation", "tax-prep", "mentoring"] },
  { name: "Balance-Accountant",   role: "Accountant",        tier: "fast",     model: "tier:fast", department: "Finance", capabilities: ["bookkeeping", "reconciliation", "tax-prep"] },
  { name: "Swift-Payments",     role: "PaymentsProcessor", tier: "fast",     model: "tier:fast", department: "Finance", capabilities: ["crypto", "upi", "payouts", "refund-processing", "fraud-check"] },
  // ── Sales ──────────────────────────────────────────────────────────
  { name: "Vector-SalesLead", role: "Sales",            tier: "strong",   model: "tier:strong",     department: "Sales", capabilities: ["lead-qualification", "closing", "pipeline-management", "team-lead"] },
  { name: "Closer-SrAE",     role: "AccountExecutive", tier: "balanced", model: "tier:balanced",     department: "Sales", capabilities: ["negotiation", "proposal-drafting", "contract-redline", "mentoring"] },
  { name: "Closer-AE",       role: "AccountExecutive", tier: "balanced", model: "tier:balanced",     department: "Sales", capabilities: ["negotiation", "proposal-drafting", "contract-redline"] },
  { name: "Hunter-SDRLead",  role: "SalesDevelopment", tier: "balanced", model: "tier:balanced", department: "Sales", capabilities: ["outbound", "cold-email", "discovery-calls", "team-lead"] },
  { name: "Hunter-SrSDR",    role: "SalesDevelopment", tier: "fast",     model: "tier:fast", department: "Sales", capabilities: ["outbound", "cold-email", "discovery-calls"] },
  { name: "Hunter-SDR",      role: "SalesDevelopment", tier: "fast",     model: "tier:fast", department: "Sales", capabilities: ["outbound", "cold-email"] },
  { name: "Nexus-CRM",      role: "CRM",              tier: "fast",     model: "tier:fast", department: "Sales", capabilities: ["crm-sync", "data-enrichment", "sequence-automation"] },
  // ── Support ────────────────────────────────────────────────────────
  { name: "Echo-SupportLead", role: "Support",        tier: "balanced", model: "tier:balanced", department: "Support", capabilities: ["triage", "reply", "csat", "knowledge-base", "team-lead"] },
  { name: "Echo-SrSupport",   role: "Support",        tier: "balanced", model: "tier:balanced", department: "Support", capabilities: ["triage", "reply", "csat", "knowledge-base"] },
  { name: "Echo-Support",      role: "Support",        tier: "fast",     model: "tier:fast", department: "Support", capabilities: ["triage", "reply", "csat"] },
  { name: "Care-SrSuccess",   role: "SuccessManager", tier: "balanced", model: "tier:balanced",     department: "Support", capabilities: ["onboarding", "qbr", "churn-prevention", "expansion", "mentoring"] },
  { name: "Care-Success",      role: "SuccessManager", tier: "balanced", model: "tier:balanced",     department: "Support", capabilities: ["onboarding", "qbr", "churn-prevention", "expansion"] },
  // ── Marketing ──────────────────────────────────────────────────────
  { name: "Spark-MarketingLead", role: "Marketer",       tier: "strong",   model: "tier:strong",     department: "Marketing", capabilities: ["positioning", "campaign-planning", "attribution", "team-lead"] },
  { name: "Spark-SrMarketer",   role: "Marketer",       tier: "balanced", model: "tier:balanced",     department: "Marketing", capabilities: ["positioning", "campaign-planning", "attribution"] },
  { name: "Spark-Marketer",     role: "Marketer",       tier: "balanced", model: "tier:balanced",     department: "Marketing", capabilities: ["positioning", "campaign-planning"] },
  { name: "Buzz-SocialLead",    role: "SocialMedia",    tier: "balanced", model: "tier:balanced", department: "Marketing", capabilities: ["social-scheduling", "community-engagement", "trend-spotting", "team-lead"] },
  { name: "Buzz-Social",        role: "SocialMedia",    tier: "fast",     model: "tier:fast", department: "Marketing", capabilities: ["social-scheduling", "community-engagement", "trend-spotting"] },
  { name: "Quill-SrContent",    role: "ContentCreator", tier: "balanced", model: "tier:balanced",     department: "Marketing", capabilities: ["blog-writing", "seo", "copy-editing", "mentoring"] },
  { name: "Quill-Content",      role: "ContentCreator", tier: "balanced", model: "tier:balanced",     department: "Marketing", capabilities: ["blog-writing", "seo", "copy-editing"] },
  { name: "Pixel-AdCreative", role: "AdCreative",     tier: "balanced", model: "tier:balanced", department: "Marketing", capabilities: ["ad-copy", "creative-testing", "audience-targeting"] },
  // ── Legal ──────────────────────────────────────────────────────────
  { name: "Gavel-LegalLead",  role: "LegalAnalyst", tier: "strong",   model: "tier:strong",     department: "Legal", capabilities: ["contract-review", "ip-analysis", "regulatory-research", "team-lead"] },
  { name: "Gavel-Legal",      role: "LegalAnalyst", tier: "balanced", model: "tier:balanced",     department: "Legal", capabilities: ["contract-review", "ip-analysis", "regulatory-research"] },
  // ── Ethics ─────────────────────────────────────────────────────────
  { name: "Sage-EthicistLead", role: "Ethicist", tier: "strong",   model: "tier:strong",     department: "Ethics", capabilities: ["ai-safety-audit", "bias-detection", "policy-review", "team-lead"] },
  { name: "Sage-Ethicist",     role: "Ethicist", tier: "balanced", model: "tier:balanced", department: "Ethics", capabilities: ["ai-safety-audit", "bias-detection", "policy-review"] },
  // ── Communications ─────────────────────────────────────────────────
  { name: "Relay-CommsLead", role: "CommsAgent",  tier: "strong",   model: "tier:strong",     department: "Communications", capabilities: ["pr-drafting", "stakeholder-messaging", "crisis-comms", "team-lead"] },
  { name: "Relay-SrComms",   role: "CommsAgent",  tier: "balanced", model: "tier:balanced", department: "Communications", capabilities: ["pr-drafting", "stakeholder-messaging", "crisis-comms"] },
  { name: "Relay-Comms",     role: "CommsAgent",  tier: "balanced", model: "tier:balanced", department: "Communications", capabilities: ["pr-drafting", "stakeholder-messaging"] },
  { name: "Inbox-Email", role: "EmailWorker", tier: "fast",     model: "tier:fast", department: "Communications", capabilities: ["imap", "smtp", "thread-triage", "auto-reply"] },
  { name: "Vox-Voice",   role: "VoiceAgent",  tier: "balanced", model: "tier:balanced", department: "Communications", capabilities: ["speech-synthesis", "voice-recognition", "call-routing"] },
  // ── Community ──────────────────────────────────────────────────────
  { name: "Thrive-CommunityLead", role: "CommunityManager", tier: "balanced", model: "tier:balanced", department: "Community", capabilities: ["discord-mod", "forum-curation", "ambassador-program", "team-lead"] },
  { name: "Thrive-Community",     role: "CommunityManager", tier: "fast",     model: "tier:fast", department: "Community", capabilities: ["discord-mod", "forum-curation", "ambassador-program"] },
  // ── Linguist ───────────────────────────────────────────────────────
  { name: "Polyglot-LinguistLead", role: "Linguist", tier: "balanced", model: "tier:balanced",     department: "Linguist", capabilities: ["translation", "localization", "tone-matching", "team-lead"] },
  { name: "Polyglot-Translator",   role: "Linguist", tier: "fast",     model: "tier:fast", department: "Linguist", capabilities: ["translation", "localization"] },
  // ── Clients ────────────────────────────────────────────────────────
  { name: "Welcome-OnboardingLead", role: "ClientOnboarding", tier: "balanced", model: "tier:balanced", department: "Clients", capabilities: ["kickoff-scheduling", "asset-collection", "first-value-delivery", "team-lead"] },
  { name: "Welcome-Onboarding",     role: "ClientOnboarding", tier: "fast",     model: "tier:fast", department: "Clients", capabilities: ["kickoff-scheduling", "asset-collection", "first-value-delivery"] },
  { name: "Retain-Success",     role: "ClientSuccess",    tier: "balanced", model: "tier:balanced",     department: "Clients", capabilities: ["qbr", "expansion-plays", "churn-risk-scoring"] },
  // ── Conductor (routing hub) ────────────────────────────────────────
  { name: "Maestro-Conductor", role: "Conductor", tier: "fast", model: "tier:fast", department: "Conductor", capabilities: ["query-routing", "context-aggregation", "fallback-handling"] },
];

/**
 * Provider → models catalog. Surfaced for the settings panel and the
 * LLM router; the engine itself does not consult this at tick time, but
 * keeping it next to FLEET (which *does* reference model ids) keeps the
 * model namespace coherent.
 */
export const PROVIDER_MODELS: Record<string, string[]> = {
  zai: ["glm-4.6", "glm-4.5", "glm-4.5-air"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  anthropic: ["claude-sonnet-4", "claude-haiku-4"],
  gemini: ["gemini-2.5-pro"],
  groq: ["llama-3.3-70b"],
  deepseek: ["deepseek-v3"],
  ollama: ["qwen2.5:32b"],
};

/**
 * Per-status log message pool. The engine picks one of these whenever an
 * agent transitions into the corresponding state, providing varied but
 * deterministic-by-status log lines on the live stream.
 */
export const LOG_MESSAGES: Record<AgentStatus, string[]> = {
  idle: ["Entering standby.", "Awaiting next directive.", "Idle — heartbeat nominal."],
  thinking: ["Decomposing objective into sub-tasks.", "Evaluating tool selection.", "Reasoning over context window.", "Consulting long-term memory."],
  executing: ["Invoking tool: web_search.", "Invoking tool: code_exec.", "Invoking tool: db_query.", "Running sub-agent: Forge-Eng.", "Streaming tool output."],
  streaming: ["Streaming completion tokens.", "Composing final answer.", "Formatting structured output."],
  waiting: ["Awaiting human approval.", "Blocked on external API.", "Waiting for dependency task."],
  error: ["Tool call timed out.", "Rate limit hit — initiating failover.", "Schema validation failed.", "Sub-agent crashed; recovering."],
  offline: ["Agent deprovisioned.", "Connection lost."],
};

/**
 * Serialize a DB Agent row into a validated API payload.
 *
 * Coerces stringly-typed columns (status, role, tier) into the discriminated
 * union members defined in `@/lib/types`, parses the JSON-encoded
 * `capabilities` array, and ISO-formats all timestamps.
 */
export function serializeAgent(a: {
  id: string;
  name: string;
  role: string;
  tier: string;
  status: string;
  model: string | null;
  department: string | null;
  capabilities: string;
  currentTask: string | null;
  tokensUsed: number;
  tasksDone: number;
  errorCount: number;
  lastBeatAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Agent {
  return {
    id: a.id,
    name: a.name,
    role: a.role as Agent["role"],
    tier: a.tier as Agent["tier"],
    status: a.status as AgentStatus,
    model: a.model,
    department: a.department,
    capabilities: parseJsonArray<string>(a.capabilities, []),
    currentTask: a.currentTask,
    tokensUsed: a.tokensUsed,
    tasksDone: a.tasksDone,
    errorCount: a.errorCount,
    lastBeatAt: toIso(a.lastBeatAt),
    createdAt: toIso(a.createdAt)!,
    updatedAt: toIso(a.updatedAt)!,
  };
}
