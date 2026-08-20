/**
 * ARIA Mission Control — strict domain contracts.
 *
 * Single source of truth for all runtime types crossing the client/server
 * boundary. Every union is a `as const` tuple + derived type + zod schema,
 * so drift between DB strings, API payloads, and UI state is impossible.
 *
 * "ponytail" pattern: typed event envelopes drive the entire state machine;
 * no `any`, no unvalidated `JSON.parse`, no loose stringly-typed flags.
 */
import { z } from "zod";

// ─── Agent unions ────────────────────────────────────────────────────
// 30+ agent roles spanning 14 departments, inspired by FounderOS-DEMO's
// 30-agent roster. The original 8 roles are preserved; new roles are
// appended under each department.
export const AGENT_ROLES = [
  // Executive
  "CEO", "COO", "CFO",
  // Engineering
  "CTO", "Engineering", "DevOps", "QA", "Architect",
  // Research
  "Research", "DataAnalyst", "DataScientist",
  // Operations
  "Ops", "ProjectManager", "Compliance",
  // Finance
  "Finance", "Accountant", "PaymentsProcessor",
  // Sales
  "Sales", "SalesDevelopment", "AccountExecutive", "CRM",
  // Support
  "Support", "SuccessManager",
  // Marketing
  "Marketer", "SocialMedia", "ContentCreator", "AdCreative",
  // Legal
  "LegalAnalyst",
  // Ethics
  "Ethicist",
  // Communications
  "CommsAgent", "EmailWorker", "VoiceAgent",
  // Community
  "CommunityManager",
  // Linguist
  "Linguist",
  // Clients
  "ClientOnboarding", "ClientSuccess",
  // Conductor (routing)
  "Conductor",
  // Service Builder (v30 — generates real deliverables for paying customers)
  "ServiceBuilder",
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/**
 * Canonical list of 14 departments (used for graph clustering + filters).
 * The Conductor role is intentionally its own department because it
 * routes messages rather than owning a function.
 */
export const DEPARTMENTS = [
  "Executive",
  "Engineering",
  "Research",
  "Operations",
  "Finance",
  "Sales",
  "Support",
  "Marketing",
  "Legal",
  "Ethics",
  "Communications",
  "Community",
  "Linguist",
  "Clients",
  "Conductor",
] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const AGENT_TIERS = ["strong", "balanced", "fast"] as const;
export type AgentTier = (typeof AGENT_TIERS)[number];

/**
 * Agent lifecycle state machine. The simulation engine transitions agents
 * along this graph; the UI renders a distinct visual treatment per state.
 *
 *   idle ─▶ thinking ─▶ executing ─▶ streaming ─▶ waiting ─▶ idle
 *                  └────── error ◀─────── (self-heal) ────┘
 */
export const AGENT_STATUSES = [
  "idle",
  "thinking",
  "executing",
  "streaming",
  "waiting",
  "error",
  "offline",
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(AGENT_ROLES),
  tier: z.enum(AGENT_TIERS),
  status: z.enum(AGENT_STATUSES),
  model: z.string().nullable(),
  department: z.string().nullable(),
  capabilities: z.array(z.string()).default([]),
  currentTask: z.string().nullable(),
  tokensUsed: z.number().int().nonnegative(),
  tasksDone: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  lastBeatAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Agent = z.infer<typeof AgentSchema>;

// ─── Task unions ─────────────────────────────────────────────────────
export const TASK_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "blocked",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_KINDS = ["work", "tool_call", "research", "review", "decision"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  assignedToId: z.string().nullable(),
  dependsOn: z.array(z.string()).default([]),
  result: z.string().nullable(),
  progress: z.number().int().min(0).max(100),
  kind: z.enum(TASK_KINDS),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
  assignedTo: AgentSchema.nullable().optional(),
});
export type Task = z.infer<typeof TaskSchema>;

// ─── Log unions ──────────────────────────────────────────────────────
export const LOG_LEVELS = ["debug", "info", "warn", "error", "success"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const AgentLogSchema = z.object({
  id: z.string(),
  agentId: z.string().nullable(),
  taskId: z.string().nullable(),
  level: z.enum(LOG_LEVELS),
  message: z.string(),
  meta: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AgentLog = z.infer<typeof AgentLogSchema>;

// ─── Metric ──────────────────────────────────────────────────────────
export const METRIC_NAMES = [
  "tokens",
  "latency_ms",
  "tasks_done",
  "revenue",
  "errors",
  "throughput",
] as const;
export type MetricName = (typeof METRIC_NAMES)[number];

export const MetricPointSchema = z.object({
  id: z.string(),
  agentId: z.string().nullable(),
  name: z.enum(METRIC_NAMES),
  value: z.number(),
  unit: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type MetricPoint = z.infer<typeof MetricPointSchema>;

// ─── Approval ────────────────────────────────────────────────────────
export const APPROVAL_RISKS = ["low", "medium", "high", "critical"] as const;
export type ApprovalRisk = (typeof APPROVAL_RISKS)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "denied", "expired"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

// ─── Owner brief (Task 23) ───────────────────────────────────────────
// Structured LLM-generated brief attached to every approval so the owner
// can scan WHY / RISKS / IF APPROVED / IF NOT APPROVED / CLARIFICATIONS
// before deciding. Stored as JSON in `Approval.brief`.
export const ApprovalBriefSchema = z.object({
  why: z.string(),
  risks: z.array(z.string()),
  ifApproved: z.string(),
  ifNotApproved: z.string(),
  clarifications: z.array(z.object({ q: z.string(), a: z.string() })),
});
export type ApprovalBrief = z.infer<typeof ApprovalBriefSchema>;

export const APPROVAL_DISCUSSION_ROLES = ["owner", "agent", "system"] as const;
export type ApprovalDiscussionRole = (typeof APPROVAL_DISCUSSION_ROLES)[number];

export const ApprovalDiscussionEntrySchema = z.object({
  role: z.enum(APPROVAL_DISCUSSION_ROLES),
  message: z.string(),
  timestamp: z.string().datetime(),
});
export type ApprovalDiscussionEntry = z.infer<typeof ApprovalDiscussionEntrySchema>;

export const ApprovalSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  risk: z.enum(APPROVAL_RISKS),
  status: z.enum(APPROVAL_STATUSES),
  requester: z.string().nullable(),
  agentId: z.string().nullable(),
  action: z.string().nullable(),
  amount: z.number().nullable(),
  payload: z.string().nullable(),
  brief: z.string().nullable(),
  discussionLog: z.string().nullable(),
  oralConfirmed: z.boolean(),
  voiceCallId: z.string().nullable(),
  createdAt: z.string().datetime(),
  decidedAt: z.string().datetime().nullable(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

// ─── Cron job + run ──────────────────────────────────────────────────
export const CRON_STATUSES = ["active", "paused", "error"] as const;
export type CronStatus = (typeof CRON_STATUSES)[number];

export const CronJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  schedule: z.string(),
  description: z.string().nullable(),
  status: z.enum(CRON_STATUSES),
  lastRunAt: z.string().datetime().nullable(),
  nextRunAt: z.string().datetime().nullable(),
  lastResult: z.string().nullable(),
  runCount: z.number().int().nonnegative(),
  failCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CronJob = z.infer<typeof CronJobSchema>;

// ─── LLM call ────────────────────────────────────────────────────────
export const LLM_PROVIDERS = [
  "zai",
  "ollama",
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "deepseek",
] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const LlmCallSchema = z.object({
  id: z.string(),
  agentId: z.string().nullable(),
  provider: z.enum(LLM_PROVIDERS),
  model: z.string(),
  prompt: z.string(),
  completion: z.string().nullable(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  status: z.enum(["ok", "rate_limited", "error", "fallback"]),
  fallback: z.boolean(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type LlmCall = z.infer<typeof LlmCallSchema>;

// ─── System alert ────────────────────────────────────────────────────
export const ALERT_SEVERITIES = ["info", "warn", "error", "critical"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const SystemAlertSchema = z.object({
  id: z.string(),
  severity: z.enum(ALERT_SEVERITIES),
  source: z.string(),
  message: z.string(),
  ack: z.boolean(),
  createdAt: z.string().datetime(),
});
export type SystemAlert = z.infer<typeof SystemAlertSchema>;

// ─── Skill ───────────────────────────────────────────────────────────
export const SKILL_CATEGORIES = ["llm", "media", "doc", "data", "web"] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const SkillSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  category: z.enum(SKILL_CATEGORIES),
  description: z.string().nullable(),
  source: z.string(),
  status: z.enum(["active", "deprecated", "disabled"]),
  invocations: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Skill = z.infer<typeof SkillSchema>;

// ─── Revenue Event ───────────────────────────────────────────────────
export const REVENUE_SOURCES = [
  "subscription",
  "services",
  "api_usage",
  "affiliate",
  "marketplace",
] as const;
export type RevenueSource = (typeof REVENUE_SOURCES)[number];

export const RevenueEventSchema = z.object({
  id: z.string(),
  source: z.enum(REVENUE_SOURCES),
  amount: z.number(),
  currency: z.string().default("USD"),
  agentId: z.string().nullable(),
  dealId: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type RevenueEvent = z.infer<typeof RevenueEventSchema>;

// ─── Deal (pipeline) ─────────────────────────────────────────────────
export const DEAL_STAGES = [
  "lead",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const DealSchema = z.object({
  id: z.string(),
  title: z.string(),
  value: z.number(),
  currency: z.string().default("USD"),
  stage: z.enum(DEAL_STAGES),
  probability: z.number().int().min(0).max(100),
  source: z.string(),
  agentId: z.string().nullable(),
  counterparty: z.string().nullable(),
  expectedClose: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Deal = z.infer<typeof DealSchema>;

// ─── Agent Message (inter-agent comm) ────────────────────────────────
export const MESSAGE_CHANNELS = [
  "task",
  "approval",
  "alert",
  "coordination",
  "broadcast",
] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export const MESSAGE_TYPES = [
  "request",
  "response",
  "delegate",
  "inform",
  "escalate",
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const AgentMessageSchema = z.object({
  id: z.string(),
  fromAgentId: z.string().nullable(),
  toAgentId: z.string().nullable(),
  channel: z.enum(MESSAGE_CHANNELS),
  messageType: z.enum(MESSAGE_TYPES),
  subject: z.string(),
  body: z.string().nullable(),
  taskId: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

// ─── Color tokens for new unions ────────────────────────────────────
export const REVENUE_SOURCE_META: Record<RevenueSource, { label: string; tone: string; dot: string }> = {
  subscription: { label: "Subscription", tone: "text-cyan-300", dot: "bg-cyan-400" },
  services: { label: "Services", tone: "text-emerald-300", dot: "bg-emerald-400" },
  api_usage: { label: "API Usage", tone: "text-violet-300", dot: "bg-violet-400" },
  affiliate: { label: "Affiliate", tone: "text-amber-300", dot: "bg-amber-400" },
  marketplace: { label: "Marketplace", tone: "text-rose-300", dot: "bg-rose-400" },
};

export const DEAL_STAGE_META: Record<
  DealStage,
  { label: string; tone: string; bg: string; order: number }
> = {
  lead: { label: "Lead", tone: "text-slate-300", bg: "bg-slate-500/15", order: 0 },
  qualified: { label: "Qualified", tone: "text-sky-300", bg: "bg-sky-500/15", order: 1 },
  proposal: { label: "Proposal", tone: "text-amber-300", bg: "bg-amber-500/15", order: 2 },
  negotiation: { label: "Negotiation", tone: "text-violet-300", bg: "bg-violet-500/15", order: 3 },
  won: { label: "Won", tone: "text-emerald-300", bg: "bg-emerald-500/15", order: 4 },
  lost: { label: "Lost", tone: "text-rose-300", bg: "bg-rose-500/15", order: 5 },
};

export const MESSAGE_TYPE_META: Record<MessageType, { label: string; tone: string; icon: string }> = {
  request: { label: "Request", tone: "text-cyan-300", icon: "→" },
  response: { label: "Response", tone: "text-emerald-300", icon: "←" },
  delegate: { label: "Delegate", tone: "text-violet-300", icon: "↦" },
  inform: { label: "Inform", tone: "text-amber-300", icon: "•" },
  escalate: { label: "Escalate", tone: "text-rose-300", icon: "↑" },
};

// ─── Memory Item (connected knowledge graph) ─────────────────────────
export const MEMORY_SCOPES = [
  "config",
  "branding",
  "agent",
  "system",
  "strategy",
  "knowledge",
] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const MemoryItemSchema = z.object({
  id: z.string(),
  key: z.string(),
  scope: z.enum(MEMORY_SCOPES),
  value: z.string(),
  tags: z.array(z.string()).default([]),
  pinned: z.boolean().default(false),
  linkedTo: z.array(z.string()).default([]),
  strength: z.number().min(0).max(1).default(0.5),
  agentId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MemoryItem = z.infer<typeof MemoryItemSchema>;

export const MEMORY_SCOPE_META: Record<
  MemoryScope,
  { label: string; tone: string; dot: string; color: string }
> = {
  config: { label: "Config", tone: "text-cyan-300", dot: "bg-cyan-400", color: "oklch(0.78 0.16 195)" },
  branding: { label: "Branding", tone: "text-violet-300", dot: "bg-violet-400", color: "oklch(0.7 0.18 300)" },
  agent: { label: "Agent", tone: "text-amber-300", dot: "bg-amber-400", color: "oklch(0.78 0.15 80)" },
  system: { label: "System", tone: "text-emerald-300", dot: "bg-emerald-400", color: "oklch(0.75 0.16 150)" },
  strategy: { label: "Strategy", tone: "text-rose-300", dot: "bg-rose-400", color: "oklch(0.68 0.22 18)" },
  knowledge: { label: "Knowledge", tone: "text-sky-300", dot: "bg-sky-400", color: "oklch(0.75 0.15 200)" },
};

// ─── Event envelope (SSE backbone) ───────────────────────────────────
/**
 * The discriminated union that powers the entire mission-control state
 * pipeline. Every server→client message is one of these variants; the
 * Zustand reducer switches on `type` and updates exactly one slice.
 */
export const EVENT_TYPES = [
  "agent.status",
  "task.update",
  "log",
  "metric",
  "approval",
  "llm",
  "alert",
  "cron.update",
  "revenue",
  "deal.update",
  "agent.message",
  "memory.update",
  "system",
  "heartbeat",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const MissionEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("agent.status"),
    ts: z.string().datetime(),
    agent: AgentSchema,
  }),
  z.object({
    type: z.literal("task.update"),
    ts: z.string().datetime(),
    task: TaskSchema,
  }),
  z.object({
    type: z.literal("log"),
    ts: z.string().datetime(),
    log: AgentLogSchema,
  }),
  z.object({
    type: z.literal("metric"),
    ts: z.string().datetime(),
    metric: MetricPointSchema,
  }),
  z.object({
    type: z.literal("approval"),
    ts: z.string().datetime(),
    approval: ApprovalSchema,
  }),
  z.object({
    type: z.literal("llm"),
    ts: z.string().datetime(),
    call: LlmCallSchema,
  }),
  z.object({
    type: z.literal("alert"),
    ts: z.string().datetime(),
    alert: SystemAlertSchema,
  }),
  z.object({
    type: z.literal("cron.update"),
    ts: z.string().datetime(),
    job: CronJobSchema,
  }),
  z.object({
    type: z.literal("revenue"),
    ts: z.string().datetime(),
    event: RevenueEventSchema,
  }),
  z.object({
    type: z.literal("deal.update"),
    ts: z.string().datetime(),
    deal: DealSchema,
  }),
  z.object({
    type: z.literal("agent.message"),
    ts: z.string().datetime(),
    message: AgentMessageSchema,
  }),
  z.object({
    type: z.literal("memory.update"),
    ts: z.string().datetime(),
    memory: MemoryItemSchema,
  }),
  z.object({
    type: z.literal("system"),
    ts: z.string().datetime(),
    message: z.string(),
    level: z.enum(LOG_LEVELS),
  }),
  z.object({
    type: z.literal("heartbeat"),
    ts: z.string().datetime(),
    uptime: z.number(),
    connectedAgents: z.number(),
    activeTasks: z.number(),
  }),
]);
export type MissionEvent = z.infer<typeof MissionEventSchema>;

// ─── Serialization helpers (DB row → API payload) ───────────────────
/** Convert a Date to an ISO string, preserving null. */
export function toIso(d: Date | string | null): string | null {
  if (d === null) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

/** Safe JSON array parse with a typed fallback — never throws. */
export function parseJsonArray<T>(raw: string | null, fallback: T[]): T[] {
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

/** Safe JSON object parse with a typed fallback — never throws. */
export function parseJsonObject<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ─── Color tokens per union (kept here so UI + logic share one map) ─
export const AGENT_STATUS_META: Record<
  AgentStatus,
  { label: string; tone: string; glow: string; dot: string }
> = {
  idle: { label: "Idle", tone: "text-slate-400", glow: "shadow-[0_0_0_0_rgba(148,163,184,0)]", dot: "bg-slate-500" },
  thinking: { label: "Thinking", tone: "text-cyan-300", glow: "shadow-[0_0_16px_-2px_rgba(34,211,238,0.55)]", dot: "bg-cyan-400" },
  executing: { label: "Executing Tool", tone: "text-amber-300", glow: "shadow-[0_0_16px_-2px_rgba(251,191,36,0.6)]", dot: "bg-amber-400" },
  streaming: { label: "Streaming", tone: "text-emerald-300", glow: "shadow-[0_0_16px_-2px_rgba(52,211,153,0.6)]", dot: "bg-emerald-400" },
  waiting: { label: "Waiting for Input", tone: "text-violet-300", glow: "shadow-[0_0_16px_-2px_rgba(167,139,250,0.6)]", dot: "bg-violet-400" },
  error: { label: "Error", tone: "text-rose-300", glow: "shadow-[0_0_16px_-2px_rgba(251,113,133,0.65)]", dot: "bg-rose-400" },
  offline: { label: "Offline", tone: "text-slate-600", glow: "shadow-[0_0_0_0_rgba(0,0,0,0)]", dot: "bg-slate-700" },
};

export const PRIORITY_META: Record<TaskPriority, { label: string; tone: string; ring: string }> = {
  low: { label: "Low", tone: "text-slate-400", ring: "border-slate-700" },
  medium: { label: "Medium", tone: "text-sky-300", ring: "border-sky-700/60" },
  high: { label: "High", tone: "text-amber-300", ring: "border-amber-700/60" },
  critical: { label: "Critical", tone: "text-rose-300", ring: "border-rose-700/70" },
};

export const RISK_META: Record<ApprovalRisk, { label: string; tone: string; badge: string }> = {
  low: { label: "Low Risk", tone: "text-emerald-300", badge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" },
  medium: { label: "Medium Risk", tone: "text-sky-300", badge: "bg-sky-500/10 text-sky-300 border-sky-500/30" },
  high: { label: "High Risk", tone: "text-amber-300", badge: "bg-amber-500/10 text-amber-300 border-amber-500/30" },
  critical: { label: "Critical Risk", tone: "text-rose-300", badge: "bg-rose-500/10 text-rose-300 border-rose-500/30" },
};

export const SEVERITY_META: Record<AlertSeverity, { label: string; tone: string; dot: string }> = {
  info: { label: "Info", tone: "text-sky-300", dot: "bg-sky-400" },
  warn: { label: "Warn", tone: "text-amber-300", dot: "bg-amber-400" },
  error: { label: "Error", tone: "text-rose-300", dot: "bg-rose-400" },
  critical: { label: "Critical", tone: "text-rose-200", dot: "bg-rose-500" },
};

// ─── Department + role color tokens (shared by UI + routing) ────────
/**
 * Per-department color palette. Each department gets a distinct oklch-
 * backed Tailwind text/dot class so the network graph and roster chips
 * stay internally consistent. The palette deliberately avoids indigo
 * (reserved) and uses saturated mid-tones that read well on dark UIs.
 */
export const DEPARTMENT_META: Record<Department, { label: string; tone: string; dot: string; color: string }> = {
  Executive:      { label: "Executive",      tone: "text-amber-300",    dot: "bg-amber-400",    color: "oklch(0.78 0.15 80)" },
  Engineering:    { label: "Engineering",    tone: "text-cyan-300",     dot: "bg-cyan-400",     color: "oklch(0.78 0.16 195)" },
  Research:       { label: "Research",       tone: "text-violet-300",   dot: "bg-violet-400",   color: "oklch(0.7 0.18 300)" },
  Operations:     { label: "Operations",     tone: "text-emerald-300",  dot: "bg-emerald-400",  color: "oklch(0.75 0.16 150)" },
  Finance:        { label: "Finance",        tone: "text-lime-300",     dot: "bg-lime-400",     color: "oklch(0.78 0.17 130)" },
  Sales:          { label: "Sales",          tone: "text-rose-300",     dot: "bg-rose-400",     color: "oklch(0.68 0.22 18)" },
  Support:        { label: "Support",        tone: "text-teal-300",     dot: "bg-teal-400",     color: "oklch(0.72 0.13 180)" },
  Marketing:      { label: "Marketing",      tone: "text-pink-300",     dot: "bg-pink-400",     color: "oklch(0.72 0.18 0)" },
  Legal:          { label: "Legal",          tone: "text-indigo-300",   dot: "bg-indigo-400",   color: "oklch(0.65 0.16 265)" },
  Ethics:         { label: "Ethics",         tone: "text-orange-300",   dot: "bg-orange-400",   color: "oklch(0.74 0.17 55)" },
  Communications: { label: "Communications", tone: "text-fuchsia-300",  dot: "bg-fuchsia-400",  color: "oklch(0.7 0.2 320)" },
  Community:      { label: "Community",      tone: "text-purple-300",   dot: "bg-purple-400",   color: "oklch(0.65 0.21 305)" },
  Linguist:       { label: "Linguist",       tone: "text-sky-300",      dot: "bg-sky-400",      color: "oklch(0.75 0.15 230)" },
  Clients:        { label: "Clients",        tone: "text-blue-300",     dot: "bg-blue-400",     color: "oklch(0.68 0.16 240)" },
  Conductor:      { label: "Conductor",      tone: "text-slate-300",    dot: "bg-slate-400",    color: "oklch(0.7 0.02 250)" },
};

/**
 * Per-role metadata. `department` drives network-graph clustering,
 * roster filtering, and routing context. `tone` + `dot` are tailwind
 * classes mirrored from the owning department so chips always match
 * their parent cluster.
 */
export const AGENT_ROLE_META: Record<AgentRole, { label: string; tone: string; dot: string; department: Department }> = {
  // Executive
  CEO:  { label: "Chief Executive",       tone: "text-amber-300",   dot: "bg-amber-400",   department: "Executive" },
  COO:  { label: "Chief Operating",       tone: "text-amber-300",   dot: "bg-amber-400",   department: "Executive" },
  CFO:  { label: "Chief Financial",       tone: "text-amber-300",   dot: "bg-amber-400",   department: "Executive" },
  // Engineering
  CTO:         { label: "Chief Technology",  tone: "text-cyan-300",    dot: "bg-cyan-400",    department: "Engineering" },
  Engineering: { label: "Software Engineer", tone: "text-cyan-300",    dot: "bg-cyan-400",    department: "Engineering" },
  DevOps:      { label: "DevOps",            tone: "text-cyan-300",    dot: "bg-cyan-400",    department: "Engineering" },
  QA:          { label: "Quality Assurance", tone: "text-cyan-300",    dot: "bg-cyan-400",    department: "Engineering" },
  Architect:   { label: "Architect",         tone: "text-cyan-300",    dot: "bg-cyan-400",    department: "Engineering" },
  // Research
  Research:      { label: "Researcher",       tone: "text-violet-300", dot: "bg-violet-400", department: "Research" },
  DataAnalyst:   { label: "Data Analyst",     tone: "text-violet-300", dot: "bg-violet-400", department: "Research" },
  DataScientist: { label: "Data Scientist",   tone: "text-violet-300", dot: "bg-violet-400", department: "Research" },
  // Operations
  Ops:            { label: "Operations",      tone: "text-emerald-300", dot: "bg-emerald-400", department: "Operations" },
  ProjectManager: { label: "Project Manager", tone: "text-emerald-300", dot: "bg-emerald-400", department: "Operations" },
  Compliance:     { label: "Compliance",      tone: "text-emerald-300", dot: "bg-emerald-400", department: "Operations" },
  // Finance
  Finance:           { label: "Finance",              tone: "text-lime-300", dot: "bg-lime-400", department: "Finance" },
  Accountant:        { label: "Accountant",           tone: "text-lime-300", dot: "bg-lime-400", department: "Finance" },
  PaymentsProcessor: { label: "Payments Processor",   tone: "text-lime-300", dot: "bg-lime-400", department: "Finance" },
  // Sales
  Sales:             { label: "Sales",              tone: "text-rose-300", dot: "bg-rose-400", department: "Sales" },
  SalesDevelopment:  { label: "Sales Development",  tone: "text-rose-300", dot: "bg-rose-400", department: "Sales" },
  AccountExecutive:  { label: "Account Executive",  tone: "text-rose-300", dot: "bg-rose-400", department: "Sales" },
  CRM:               { label: "CRM",                tone: "text-rose-300", dot: "bg-rose-400", department: "Sales" },
  // Support
  Support:        { label: "Support",         tone: "text-teal-300", dot: "bg-teal-400", department: "Support" },
  SuccessManager: { label: "Success Manager", tone: "text-teal-300", dot: "bg-teal-400", department: "Support" },
  // Marketing
  Marketer:        { label: "Marketer",         tone: "text-pink-300", dot: "bg-pink-400", department: "Marketing" },
  SocialMedia:     { label: "Social Media",     tone: "text-pink-300", dot: "bg-pink-400", department: "Marketing" },
  ContentCreator:  { label: "Content Creator",  tone: "text-pink-300", dot: "bg-pink-400", department: "Marketing" },
  AdCreative:      { label: "Ad Creative",      tone: "text-pink-300", dot: "bg-pink-400", department: "Marketing" },
  // Legal
  LegalAnalyst: { label: "Legal Analyst", tone: "text-indigo-300", dot: "bg-indigo-400", department: "Legal" },
  // Ethics
  Ethicist: { label: "Ethicist", tone: "text-orange-300", dot: "bg-orange-400", department: "Ethics" },
  // Communications
  CommsAgent:  { label: "Comms Agent",  tone: "text-fuchsia-300", dot: "bg-fuchsia-400", department: "Communications" },
  EmailWorker: { label: "Email Worker", tone: "text-fuchsia-300", dot: "bg-fuchsia-400", department: "Communications" },
  VoiceAgent:  { label: "Voice Agent",  tone: "text-fuchsia-300", dot: "bg-fuchsia-400", department: "Communications" },
  // Community
  CommunityManager: { label: "Community Manager", tone: "text-purple-300", dot: "bg-purple-400", department: "Community" },
  // Linguist
  Linguist: { label: "Linguist", tone: "text-sky-300", dot: "bg-sky-400", department: "Linguist" },
  // Clients
  ClientOnboarding: { label: "Client Onboarding", tone: "text-blue-300", dot: "bg-blue-400", department: "Clients" },
  ClientSuccess:    { label: "Client Success",    tone: "text-blue-300", dot: "bg-blue-400", department: "Clients" },
  // Conductor
  Conductor: { label: "Conductor", tone: "text-slate-300", dot: "bg-slate-400", department: "Conductor" },
  // Service Builder
  ServiceBuilder: { label: "Build-Bot", tone: "text-violet-300", dot: "bg-violet-400", department: "Engineering" },
};

/** Personnel (human staff) — mirrors the FounderOS human roster. */
export const PERSONNEL_SCHEMA = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  departmentId: z.string(),
  tools: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Personnel = z.infer<typeof PERSONNEL_SCHEMA>;

// ─── Company Profile (multi-company, Task 23) ────────────────────────
// An ARIA master account (`parentAccountId`) can own multiple
// CompanyProfile rows — one per company the autonomous fleet operates.
// `isActive=false` is soft-delete; switchCompany() writes the active id
// to a cookie so the dashboard can scope by company.
export const CompanyProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  tagline: z.string().nullable(),
  industry: z.string().nullable(),
  website: z.string().nullable(),
  email: z.string().nullable(),
  currency: z.string(),
  timezone: z.string(),
  parentAccountId: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CompanyProfile = z.infer<typeof CompanyProfileSchema>;
