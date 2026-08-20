/**
 * src/lib/ai-insights.ts — AI Insights & Recommendations Engine.
 *
 * Server-only module that analyses the live system snapshot (agents, tasks,
 * approvals, opportunities, revenue, alerts, LLM call history, etc.) and
 * produces 3-5 actionable recommendations. When an LLM provider is
 * available, the analysis is delegated to `routeLLM` for richer insight
 * quality. If all providers fail (or the snapshot is empty), a deterministic
 * rule-based fallback derives insights directly from the snapshot numbers.
 *
 * Task ID: FEATURES-INSIGHTS-KB-AUDIT (Task 1).
 */
import "server-only";

import { db } from "./db";
import { getSystemSnapshot, type SystemSnapshot } from "./central-registry";
import { routeLLM, type ChatMsg } from "./llm-router";
import { logger } from "./logger";

// ─── Types ───────────────────────────────────────────────────────────

export type InsightPriority = "high" | "medium" | "low";
export type InsightCategory =
  | "revenue"
  | "operations"
  | "security"
  | "agents"
  | "growth";

export interface Insight {
  priority: InsightPriority;
  category: InsightCategory;
  title: string;
  description: string;
  /** Suggested next step. May be a URL (actionable) or free text. */
  action: string;
}

export interface InsightResult {
  insights: Insight[];
  source: "llm" | "fallback";
  generatedAt: string;
}

// ─── LLM prompt construction ────────────────────────────────────────

/**
 * Build a concise state summary to feed the LLM. We include the most
 * decision-relevant numbers — agent counts by status, pending approvals,
 * recent alerts, revenue totals, pipeline value, LLM call success rate —
 * so the model can reason about the fleet's current posture without
 * dumping thousands of records into the prompt.
 */
function buildStateSummary(s: SystemSnapshot, llmStats: {
  total: number;
  ok: number;
  rate: number;
}): string {
  const lines: string[] = [
    `Agents: total=${s.agents.total} active=${s.agents.active} byStatus=${JSON.stringify(s.agents.byStatus)}`,
    `Tasks: total=${s.tasks.total} pending=${s.tasks.pending} running=${s.tasks.running} completed=${s.tasks.completed} failed=${s.tasks.failed}`,
    `Approvals: total=${s.approvals.total} pending=${s.approvals.pending} approved=${s.approvals.approved} denied=${s.approvals.denied}`,
    `Opportunities: total=${s.opportunities.total} today=${s.opportunities.today} qualified=${s.opportunities.qualified} inPipeline=${s.opportunities.inPipeline} totalEstimatedRevenue=${s.opportunities.totalEstimatedRevenue}`,
    `Companies: total=${s.companies.total} active=${s.companies.active}`,
    `Revenue: total=${s.revenue.total} today=${s.revenue.today} month=${s.revenue.month}`,
    `Alerts: total=${s.alerts.total} unacked=${s.alerts.unacked} critical=${s.alerts.critical}`,
    `LLM calls: total=${llmStats.total} ok=${llmStats.ok} successRate=${llmStats.rate}% today=${s.llmCalls.today} byProvider=${JSON.stringify(s.llmCalls.byProvider)}`,
    `Skills: total=${s.skills.total} learned=${s.skills.learned} invocations=${s.skills.invocations}`,
    `Simulations: total=${s.simulations.total} running=${s.simulations.running} completed=${s.simulations.completed}`,
    `Memories: total=${s.memories.total} pinned=${s.memories.pinned}`,
    `Cron jobs: total=${s.cronJobs.total} active=${s.cronJobs.active}`,
  ];
  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are ARIA Mission Control's analyst. Given a live snapshot of an autonomous agent fleet, produce 3-5 actionable recommendations for the operator.

Output rules:
- Respond with ONLY a JSON array (no markdown fences, no prose preamble).
- Each item MUST have: priority ("high"|"medium"|"low"), category ("revenue"|"operations"|"security"|"agents"|"growth"), title (<=90 chars), description (1-2 sentences), action (a concrete next step — either a URL path like "/api/approvals" or a short imperative phrase).
- Focus on actionable items the operator can act on within the dashboard.
- Do not invent numbers not present in the snapshot.`;

// ─── JSON extraction ──────────────────────────────────────────────

/**
 * Parse the LLM response into an Insight[]. Tries strict JSON first,
 * then a fenced ```json ...``` block, then a tolerant scan for the
 * first '[' ... ']' substring.
 */
function parseInsights(raw: string): Insight[] {
  const text = raw.trim();
  if (!text) return [];

  // 1. Strict JSON.
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return normalize(parsed);
  } catch {
    /* fall through */
  }

  // 2. Fenced ```json ... ``` block.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      const parsed = JSON.parse(fence[1].trim());
      if (Array.isArray(parsed)) return normalize(parsed);
    } catch {
      /* fall through */
    }
  }

  // 3. First '[' ... matching ']' substring.
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) return normalize(parsed);
    } catch {
      /* fall through */
    }
  }

  return [];
}

function normalize(items: unknown[]): Insight[] {
  const out: Insight[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const priority = String(item.priority ?? "medium").toLowerCase();
    const category = String(item.category ?? "operations").toLowerCase();
    const title = String(item.title ?? "").trim();
    const description = String(item.description ?? "").trim();
    const action = String(item.action ?? "").trim();
    if (!title) continue;
    out.push({
      priority: priority === "high" || priority === "low" ? priority : "medium",
      category: (["revenue", "operations", "security", "agents", "growth"].includes(
        category,
      )
        ? category
        : "operations") as InsightCategory,
      title: title.slice(0, 140),
      description: description.slice(0, 600),
      action: action.slice(0, 300) || "Review in dashboard",
    });
  }
  return out.slice(0, 8);
}

// ─── Rule-based fallback ───────────────────────────────────────────

/**
 * Deterministic insight generator derived from the snapshot. Used when
 * no LLM provider is reachable (offline mode) or when the LLM response
 * cannot be parsed. Always returns at least one insight if the system
 * has data; returns an empty array only if the snapshot is entirely
 * empty (no agents, no tasks, no approvals — i.e. freshly seeded).
 */
function fallbackInsights(s: SystemSnapshot): Insight[] {
  const out: Insight[] = [];

  if (s.approvals.pending > 0) {
    out.push({
      priority: "high",
      category: "operations",
      title: `${s.approvals.pending} pending approval${s.approvals.pending === 1 ? "" : "s"} awaiting decision`,
      description: `The fleet has ${s.approvals.pending} approval${s.approvals.pending === 1 ? "" : "s"} in pending state. Stalled approvals block downstream agent execution — review and decide now.`,
      action: "/api/approvals",
    });
  }

  if (s.alerts.critical > 0) {
    out.push({
      priority: "high",
      category: "security",
      title: `${s.alerts.critical} unacknowledged critical alert${s.alerts.critical === 1 ? "" : "s"}`,
      description: `${s.alerts.critical} critical alert${s.alerts.critical === 1 ? " is" : "s are"} unacknowledged. Critical-severity alerts typically indicate agent failures, LLM provider outages, or budget overruns — triage immediately.`,
      action: "/api/alerts",
    });
  } else if (s.alerts.unacked > 0) {
    out.push({
      priority: "medium",
      category: "operations",
      title: `${s.alerts.unacked} unacknowledged alert${s.alerts.unacked === 1 ? "" : "s"}`,
      description: `${s.alerts.unacked} alert${s.alerts.unacked === 1 ? "" : "s"} are waiting for acknowledgement. Clear them to keep the alert feed actionable.`,
      action: "/api/alerts",
    });
  }

  if (s.tasks.failed > 0) {
    out.push({
      priority: "high",
      category: "operations",
      title: `${s.tasks.failed} failed task${s.tasks.failed === 1 ? "" : "s"} need attention`,
      description: `${s.tasks.failed} task${s.tasks.failed === 1 ? " has" : "s have"} entered the failed state. Inspect error logs and either retry or cancel to free up agent capacity.`,
      action: "/api/tasks",
    });
  }

  if (s.opportunities.inPipeline > 0 && s.opportunities.totalEstimatedRevenue > 0) {
    const val = s.opportunities.totalEstimatedRevenue.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
    out.push({
      priority: "medium",
      category: "revenue",
      title: `${s.opportunities.inPipeline} opportunity${s.opportunities.inPipeline === 1 ? "" : "s"} worth ${val} in pipeline`,
      description: `The pipeline currently holds ${s.opportunities.inPipeline} qualified opportunity${s.opportunities.inPipeline === 1 ? "" : "s"} totalling ${val} in estimated revenue. Move stalled deals forward to convert pipeline value into realized revenue.`,
      action: "/api/crm/pipeline",
    });
  }

  const offlineAgents = s.agents.byStatus.offline ?? 0;
  const errorAgents = s.agents.byStatus.error ?? 0;
  if (offlineAgents > 0 || errorAgents > 0) {
    out.push({
      priority: "high",
      category: "agents",
      title: `${offlineAgents + errorAgents} agent${offlineAgents + errorAgents === 1 ? "" : "s"} offline or in error state`,
      description: `${offlineAgents} offline and ${errorAgents} in error state. Run the healer or restart affected agents to restore fleet capacity.`,
      action: "/api/monitor",
    });
  }

  if (s.companies.total > 0 && s.companies.active > 0) {
    const opps = s.opportunities.today;
    if (opps === 0) {
      out.push({
        priority: "low",
        category: "growth",
        title: "No new opportunities discovered today",
        description: `${s.companies.active} active compan${s.companies.active === 1 ? "y" : "ies"} but no fresh earning opportunities today. Consider triggering the autonomous research cycle to surface new leads.`,
        action: "/api/earning/research",
      });
    }
  }

  if (s.skills.learned > 0 && s.skills.invocations === 0) {
    out.push({
      priority: "low",
      category: "growth",
      title: `${s.skills.learned} learned skill${s.skills.learned === 1 ? "" : "s"} never invoked`,
      description: `The fleet has learned ${s.skills.learned} skill${s.skills.learned === 1 ? "" : "s"} but none have been invoked yet. Review the skills registry to confirm they are wired into the correct agents.`,
      action: "/api/hermes/skills",
    });
  }

  if (out.length === 0 && s.agents.total === 0) {
    // Truly empty system.
    return [];
  }

  // Guarantee at least one insight even when the snapshot is healthy.
  if (out.length === 0) {
    out.push({
      priority: "low",
      category: "operations",
      title: "System operating normally",
      description: `All metrics within expected ranges. ${s.agents.active} of ${s.agents.total} agents active, ${s.tasks.running} tasks running, ${s.alerts.unacked} unacked alerts.`,
      action: "/api/system",
    });
  }

  // Sort by priority: high → medium → low.
  const order: Record<InsightPriority, number> = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => order[a.priority] - order[b.priority]);
  return out.slice(0, 5);
}

// ─── Public entry point ────────────────────────────────────────────

/**
 * Generate insights. Tries the LLM first (routeLLM with multi-provider
 * failover). If the LLM fails, returns the rule-based fallback.
 *
 * The result's `source` field is `"llm"` when the LLM produced at least
 * one parseable insight, otherwise `"fallback"`.
 */
export async function generateInsights(): Promise<InsightResult> {
  const snapshot = await getSystemSnapshot();
  const generatedAt = new Date().toISOString();

  // Compute LLM call success rate directly from the LlmCall table —
  // the snapshot exposes total/today/byProvider but not status counts.
  let llmStats = { total: snapshot.llmCalls.total, ok: snapshot.llmCalls.total, rate: 100 };
  try {
    const [totalRows, okRows] = await Promise.all([
      db.llmCall.count(),
      db.llmCall.count({ where: { status: "ok" } }),
    ]);
    if (totalRows > 0) {
      llmStats = {
        total: totalRows,
        ok: okRows,
        rate: Math.round((okRows / totalRows) * 100),
      };
    }
  } catch (err) {
    logger.warn("ai-insights.llm-stats.error", { error: String(err) });
  }

  // If the system is completely empty, skip the LLM (no point burning
  // tokens on a snapshot with zero data).
  if (snapshot.agents.total === 0 && snapshot.tasks.total === 0) {
    return { insights: fallbackInsights(snapshot), source: "fallback", generatedAt };
  }

  try {
    const userPrompt = `System snapshot (live):\n\n${buildStateSummary(snapshot, llmStats)}\n\nGenerate 3-5 actionable recommendations as a JSON array.`;
    const messages: ChatMsg[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];

    const result = await routeLLM(messages, { complexity: "medium", agentRole: "CTO" });

    if (result.success && result.completion) {
      const insights = parseInsights(result.completion);
      if (insights.length > 0) {
        logger.info("ai-insights.generated", {
          source: "llm",
          provider: result.provider,
          count: insights.length,
          fallbackUsed: result.fallbackUsed,
        });
        return { insights, source: "llm", generatedAt };
      }
      logger.warn("ai-insights.llm.unparseable", {
        provider: result.provider,
        completionPreview: result.completion.slice(0, 200),
      });
    } else {
      logger.warn("ai-insights.llm.failed", {
        error: result.error?.slice(0, 200),
        provider: result.provider,
      });
    }
  } catch (err) {
    logger.error("ai-insights.exception", { error: String(err) });
  }

  return { insights: fallbackInsights(snapshot), source: "fallback", generatedAt };
}
