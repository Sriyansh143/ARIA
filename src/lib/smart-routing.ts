/**
 * ARIA Mission Control — Smart Chat Routing.
 *
 * Routes operator queries to the best-suited agent based on the query
 * content. Uses keyword matching + LLM classification to determine
 * which agent should handle the request.
 *
 * Routing logic:
 *  1. Keyword match (fast): "revenue" → Finance, "deploy" → CTO, etc.
 *  2. LLM classification (smart): if no keyword match, ask the LLM to
 *     classify the query and route to the appropriate agent
 *  3. Fallback: Conductor (general purpose)
 */
import { callLLM } from "./llm-client";

export type AgentRole =
  | "CEO" | "CTO" | "Engineering" | "Research"
  | "Ops" | "Finance" | "Sales" | "Support" | "Conductor";

export interface RoutingResult {
  agent: string;
  role: AgentRole;
  confidence: number;
  reason: string;
  method: "keyword" | "llm" | "fallback";
}

const KEYWORD_MAP: Record<string, { agent: string; role: AgentRole; keywords: string[] }> = {
  finance: {
    agent: "Ledger-Fin",
    role: "Finance",
    keywords: ["revenue", "cost", "profit", "margin", "invoice", "payment", "budget", "mrr", "arr", "pricing", "financial", "earn", "spend"],
  },
  cto: {
    agent: "Aria-CTO",
    role: "CTO",
    keywords: ["deploy", "architecture", "code", "technical", "infrastructure", "api", "database", "bug", "fix", "refactor", "security", "performance"],
  },
  engineering: {
    agent: "Forge-Eng",
    role: "Engineering",
    keywords: ["build", "implement", "feature", "develop", "test", "ci", "cd", "pipeline", "code review", "pr", "merge"],
  },
  research: {
    agent: "Nova-Research",
    role: "Research",
    keywords: ["research", "analyze", "trend", "market", "competitor", "study", "investigate", "scan", "ecosystem", "benchmark"],
  },
  ops: {
    agent: "Pulse-Ops",
    role: "Ops",
    keywords: ["monitor", "alert", "health", "uptime", "cron", "schedule", "backup", "system", "status", "operational", "incident"],
  },
  sales: {
    agent: "Vector-Sales",
    role: "Sales",
    keywords: ["lead", "deal", "outreach", "prospect", "qualify", "pipeline", "crm", "customer", "client", "conversion"],
  },
  support: {
    agent: "Echo-Support",
    role: "Support",
    keywords: ["ticket", "support", "help", "issue", "problem", "csat", "refund", "complaint", "sla", "response"],
  },
  ceo: {
    agent: "Aria-CEO",
    role: "CEO",
    keywords: ["strategy", "priority", "decision", "approve", "roadmap", "vision", "goal", "objective", "plan", "direction"],
  },
};

/**
 * Route a query to the best agent.
 * First tries keyword matching (fast), then falls back to LLM classification.
 */
export async function routeQuery(query: string): Promise<RoutingResult> {
  const queryLower = query.toLowerCase();

  // Step 1: Keyword matching (fast path).
  for (const [key, config] of Object.entries(KEYWORD_MAP)) {
    for (const keyword of config.keywords) {
      if (queryLower.includes(keyword)) {
        return {
          agent: config.agent,
          role: config.role,
          confidence: 0.85,
          reason: `Keyword "${keyword}" matched → ${config.role}`,
          method: "keyword",
        };
      }
    }
  }

  // Step 2: LLM classification (smart path).
  try {
    const prompt = `Classify this query to the best agent role. Respond with ONLY one of: CEO, CTO, Engineering, Research, Ops, Finance, Sales, Support, Conductor.

Query: "${query}"

Rules:
- CEO: strategy, decisions, priorities, roadmaps
- CTO: technical architecture, deploys, security
- Engineering: building, implementing, testing
- Research: analyzing, scanning, benchmarking
- Ops: monitoring, alerts, system health
- Finance: revenue, costs, budgets, payments
- Sales: leads, deals, outreach, CRM
- Support: tickets, help, issues, SLA
- Conductor: general questions, dashboard help

Respond with ONLY the role name (one word).`;

    const result = await callLLM("Conductor", "CEO", prompt, { model: "glm-4.5-air" });
    if (result.success && result.completion) {
      const role = result.completion.trim() as AgentRole;
      const config = Object.values(KEYWORD_MAP).find((c) => c.role === role);
      if (config) {
        return {
          agent: config.agent,
          role: config.role,
          confidence: 0.75,
          reason: `LLM classified as ${role}`,
          method: "llm",
        };
      }
    }
  } catch {
    // LLM classification failed — fall through to fallback.
  }

  // Step 3: Fallback to Conductor.
  return {
    agent: "Conductor",
    role: "Conductor",
    confidence: 0.50,
    reason: "No keyword match, LLM unavailable — routing to Conductor",
    method: "fallback",
  };
}

/**
 * Process a query through the full smart routing pipeline:
 *  1. Route to best agent
 *  2. Call that agent's LLM with the query
 *  3. Return the response + routing metadata
 */
export async function processQuery(
  query: string,
  context?: { agentCount?: number; activeAgents?: number; totalRevenue?: number; unackedAlerts?: number }
): Promise<{ response: string; routing: RoutingResult; latencyMs: number }> {
  const startTime = Date.now();

  // Route the query.
  const routing = await routeQuery(query);

  // Build context-aware prompt.
  const contextStr = context
    ? `\n\nDashboard context: ${context.activeAgents ?? 0}/${context.agentCount ?? 0} agents active, $${(context.totalRevenue ?? 0).toLocaleString()} revenue, ${context.unackedAlerts ?? 0} alerts.`
    : "";

  // Call the routed agent.
  const prompt = `You are ${routing.agent} (${routing.role}). An operator asked: "${query}"${contextStr}\n\nRespond concisely (2-3 sentences) with actionable advice relevant to your role.`;

  const result = await callLLM(routing.agent, routing.role, prompt, { model: "glm-4.5-air" });

  return {
    response: result.success
      ? result.completion
      : `[LLM unavailable — ${result.error?.slice(0, 100) ?? "unknown error"}. Routed to ${routing.agent} but no completion was generated.]`,
    routing,
    latencyMs: Date.now() - startTime,
  };
}
