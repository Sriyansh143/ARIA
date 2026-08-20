/**
 * src/lib/simulation/seed-templates.ts — static seed/mutation data.
 *
 * Extracted from the former simulation.ts monolith. Holds every template
 * array used to seed the DB on first boot AND every template the tick loop
 * samples from at runtime (approvals, deal stages). Also owns the two tiny
 * RNG helpers (`pick`, `chance`) that both the seed step and the engine use.
 *
 * Nothing in this file touches the DB or the event bus — it is pure data +
 * pure functions, so it can be imported by tests, the seed step, and the
 * engine without pulling in Prisma or the LLM client.
 */

/** Seed template for a Task row. */
export interface TaskTemplate {
  title: string;
  kind: string;
  priority: string;
  description: string;
}

/** Seed template for a RevenueEvent row. */
export interface RevenueTemplate {
  source: string;
  amount: number;
  description: string;
}

/** Seed template for a Deal row. */
export interface DealTemplate {
  title: string;
  value: number;
  stage: string;
  probability: number;
  counterparty: string;
}

/** Seed template for an AgentMessage row. */
export interface MessageTemplate {
  channel: string;
  messageType: string;
  subject: string;
  body: string;
}

/** Seed template for a MemoryItem row. */
export interface MemoryTemplate {
  key: string;
  scope: string;
  value: string;
  tags: string[];
  agentName: string;
}

/** Seed template for a Personnel (human staff) row. */
export interface PersonnelTemplate {
  name: string;
  role: string;
  departmentId: string;
  tools: string[];
}

/** Template for an Approval row (seeded + spawned at tick time). */
export interface ApprovalTemplate {
  title: string;
  action: string;
  risk: string;
  amount: number | null;
  summary: string;
}

/** Canonical deal-stage progression order (lead → won). */
export const DEAL_STAGES_PROGRESSION = ["lead", "qualified", "proposal", "negotiation", "won"];

export const TASK_TEMPLATES: Array<TaskTemplate> = [
  { title: "Draft Q3 strategic roadmap", kind: "decision", priority: "critical", description: "Synthesize market signals + revenue forecast into a board-ready roadmap." },
  { title: "Architecture review: agent isolation", kind: "review", priority: "high", description: "Audit sandbox boundaries between sub-agents and propose hardening." },
  { title: "Ship mission-control v25.9.8", kind: "work", priority: "high", description: "Bundle telemetry improvements + approval gate UX." },
  { title: "Research: MCP server ecosystem", kind: "research", priority: "medium", description: "Scan trending MCP repos; compute star velocity over 30d." },
  { title: "Auto-heal: rate-limited provider", kind: "tool_call", priority: "high", description: "Failover LLM traffic from openai → zai gateway." },
  { title: "Generate investor update deck", kind: "work", priority: "medium", description: "Compile weekly KPIs into a 6-slide deck." },
  { title: "Qualify inbound: Acme Corp", kind: "decision", priority: "medium", description: "Score lead, draft outreach, schedule follow-up." },
  { title: "Resolve ticket #4821", kind: "work", priority: "low", description: "Triage billing discrepancy; issue credit note." },
  { title: "Forecast monthly recurring revenue", kind: "research", priority: "medium", description: "Roll up pipeline + churn into MRR projection." },
  { title: "Approve $4.2k deploy budget", kind: "decision", priority: "critical", description: "Production deploy requires human sign-off." },
];

export const APPROVAL_TEMPLATES: ApprovalTemplate[] = [
  { title: "Deploy to production", action: "deploy", risk: "high", amount: 4200, summary: "Ship mission-control v25.9.8 to prod cluster." },
  { title: "Send investor update", action: "send_email", risk: "medium", amount: null, summary: "Distribute weekly KPI deck to 12 investors." },
  { title: "Sign Acme Corp contract", action: "sign_contract", risk: "critical", amount: 48000, summary: "Execute 12-month services agreement." },
  { title: "Provision new GPU node", action: "spend", risk: "medium", amount: 1800, summary: "Scale inference capacity for peak traffic." },
  { title: "Refund ticket #4821", action: "spend", risk: "low", amount: 240, summary: "Issue credit note for billing discrepancy." },
];

// ─── Revenue + Deal + Message data templates ────────────────────────
export const REVENUE_TEMPLATES: Array<RevenueTemplate> = [
  { source: "subscription", amount: 499, description: "Pro plan renewal — TechFlow Inc." },
  { source: "subscription", amount: 99, description: "Starter plan — indie dev signup." },
  { source: "services", amount: 8500, description: "Custom integration — Globex Corp." },
  { source: "api_usage", amount: 1240, description: "API overage billing — Initech." },
  { source: "affiliate", amount: 320, description: "Referral payout — partner network." },
  { source: "marketplace", amount: 75, description: "Skill template purchase — community." },
  { source: "subscription", amount: 1499, description: "Enterprise upgrade — Hooli." },
  { source: "services", amount: 12000, description: "Annual managed services — Pied Piper." },
];

export const DEAL_TEMPLATES: Array<DealTemplate> = [
  { title: "Enterprise MRR contract", value: 84000, stage: "negotiation", probability: 65, counterparty: "Globex Corp" },
  { title: "API platform license", value: 36000, stage: "proposal", probability: 45, counterparty: "Initech" },
  { title: "Custom AI agent build", value: 52000, stage: "qualified", probability: 30, counterparty: "Hooli" },
  { title: "Monthly SaaS subscription", value: 5988, stage: "lead", probability: 20, counterparty: "Pied Piper" },
  { title: "White-label deployment", value: 120000, stage: "negotiation", probability: 55, counterparty: "Stark Industries" },
  { title: "Support SLA upgrade", value: 18000, stage: "proposal", probability: 50, counterparty: "Wayne Enterprises" },
];

export const MESSAGE_TEMPLATES: Array<MessageTemplate> = [
  { channel: "task", messageType: "delegate", subject: "Delegate code review to Forge-Eng", body: "Architecture spec ready for review." },
  { channel: "task", messageType: "request", subject: "Request revenue forecast", body: "Need Q3 MRR projection for board deck." },
  { channel: "approval", messageType: "escalate", subject: "Escalate: $48k contract sign-off", body: "Critical approval pending 2h+." },
  { channel: "coordination", messageType: "inform", subject: "Resource allocation update", body: "GPU node provisioned for Forge-Eng." },
  { channel: "alert", messageType: "inform", subject: "Rate-limit detected on openai", body: "Traffic rerouted to zai gateway." },
  { channel: "task", messageType: "response", subject: "Re: Architecture review complete", body: "Approved with 2 minor findings." },
  { channel: "broadcast", messageType: "inform", subject: "Daily standup summary", body: "All agents nominal. 14 tasks completed." },
  { channel: "coordination", messageType: "delegate", subject: "Delegate lead qualification to Vector-Sales", body: "New inbound from Acme Corp." },
];

// ─── Memory templates (connected knowledge graph) ───────────────────
export const MEMORY_TEMPLATES: Array<MemoryTemplate> = [
  { key: "brand-voice", scope: "branding", value: "Professional, technical, authoritative. No emojis in external comms.", tags: ["tone", "voice", "brand"], agentName: "Aria-CEO" },
  { key: "target-audience", scope: "branding", value: "Engineering leaders at B2B SaaS companies, 50-500 employees.", tags: ["audience", "icp"], agentName: "Vector-Sales" },
  { key: "q3-strategy", scope: "strategy", value: "Focus on enterprise expansion. 3 pillars: reliability, security, integration depth.", tags: ["strategy", "q3", "enterprise"], agentName: "Aria-CEO" },
  { key: "pricing-model", scope: "config", value: "Usage-based: $0.5/1k tokens in, $1.5/1k tokens out. Enterprise floor $2k/mo.", tags: ["pricing", "tokens", "enterprise"], agentName: "Ledger-Fin" },
  { key: "architecture-decisions", scope: "knowledge", value: "Event-driven pipeline (ponytail pattern). zod-validated discriminated union. SSE backbone.", tags: ["architecture", "events", "sse"], agentName: "Aria-CTO" },
  { key: "agent-roster", scope: "agent", value: "37 agents across 15 departments: Executive, Engineering, Research, Operations, Finance, Sales, Support, Marketing, Legal, Ethics, Communications, Community, Linguist, Clients, Conductor.", tags: ["agents", "fleet", "org"], agentName: "Pulse-Ops" },
  { key: "approval-gates", scope: "config", value: "Deploy >$2k requires approval. Contract sign requires critical-risk gate.", tags: ["approvals", "gates", "risk"], agentName: "Aria-CEO" },
  { key: "llm-failover", scope: "system", value: "Primary: zai (glm-4.6). Fallback: openai → anthropic. Rate-limit triggers auto-failover.", tags: ["llm", "failover", "routing"], agentName: "Pulse-Ops" },
  { key: "support-slas", scope: "config", value: "P1: 15min response. P2: 1hr. P3: 4hr. Business hours 9-5 ET.", tags: ["support", "sla", "response"], agentName: "Echo-Support" },
  { key: "research-focus", scope: "knowledge", value: "MCP server ecosystem, agent isolation patterns, star velocity as momentum signal.", tags: ["research", "mcp", "ecosystem"], agentName: "Nova-Research" },
  { key: "revenue-streams", scope: "strategy", value: "5 streams: subscription, services, API usage, affiliate, marketplace.", tags: ["revenue", "streams", "business"], agentName: "Ledger-Fin" },
  { key: "tech-stack", scope: "knowledge", value: "Next.js 16, TypeScript, Prisma/SQLite, Zustand, TanStack Query, Recharts, framer-motion.", tags: ["tech", "stack", "infra"], agentName: "Aria-CTO" },
  { key: "onboarding-flow", scope: "knowledge", value: "7-step tour: welcome → command palette → search → panels → prefs → theme → done.", tags: ["onboarding", "tour", "ux"], agentName: "Aria-CEO" },
  { key: "monitoring-rules", scope: "system", value: "Heartbeat every 90s. Rate-limit watch every 5min. Nightly backup at 3am.", tags: ["monitoring", "cron", "alerts"], agentName: "Pulse-Ops" },
];

// ─── Personnel templates (human staff alongside the agent fleet) ────
// Mirrors the FounderOS human roster (Marco, Nadia, Mia) — these are
// real people with their toolbelts. `departmentId` matches the same
// Department union the agents use so humans + agents cluster together
// in the network graph.
export const PERSONNEL_TEMPLATES: Array<PersonnelTemplate> = [
  { name: "Marco",      role: "Head of Sales",              departmentId: "Sales",          tools: ["fathom", "attio"] },
  { name: "Nadia",      role: "Head of Growth & Marketing", departmentId: "Marketing",      tools: ["zernio", "manychat"] },
  { name: "Mia Torres", role: "Executive Assistant",        departmentId: "Communications", tools: ["imap", "slack"] },
  { name: "Priya Anand",role: "General Counsel",            departmentId: "Legal",          tools: ["ironclad", "notion"] },
  { name: "Devon Hart", role: "VP of Engineering",          departmentId: "Engineering",    tools: ["github", "linear"] },
];

/** Pick a uniform random element from a non-empty readonly array. */
export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Return true with probability `p` (0..1). */
export function chance(p: number): boolean {
  return Math.random() < p;
}
