/**
 * src/lib/hermes/earning-researcher.ts — Daily Earning & Business Opportunity Researcher
 *
 * Runs an automated daily scan to discover at least 5 high-yield commercial
 * opportunities every 24 hours. Each opportunity is scored for revenue,
 * time-to-execute, department, and feasibility.
 *
 * Qualified opportunities are auto-inserted into the Deal pipeline.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { emit } from "@/lib/event-bus";

export interface Opportunity {
  title: string;
  description: string;
  source: string;
  estimatedRevenue: number;
  timeToExecuteHours: number;
  department: string;
  feasibilityScore: number;
}

export interface ResearchResult {
  discovered: number;
  qualified: number;
  insertedToPipeline: number;
  opportunities: Opportunity[];
}

const SOURCES = [
  "web_trends",
  "api_marketplace",
  "freelance_feeds",
  "saas_gaps",
  "affiliate_channels",
];

const DEPARTMENTS = [
  "Sales",
  "Engineering",
  "Marketing",
  "Media",
  "Services",
  "Finance",
];

/**
 * Scan a source for earning opportunities using web search.
 */
async function scanSource(source: string): Promise<Opportunity[]> {
  try {
    const queries: Record<string, string> = {
      web_trends: "trending SaaS tools 2025 high revenue opportunities",
      api_marketplace: "RapidAPI marketplace new APIs monetization opportunities 2025",
      freelance_feeds: "high-paying freelance contracts AI automation 2025",
      saas_gaps: "underserved SaaS niches 2025 gap in market",
      affiliate_channels: "best high-commission affiliate programs 2025 software",
    };

    // Phase 32: Use the 4-provider searchWithFallback (Tavily → Serper → Z-AI → DuckDuckGo).
    const { searchWithFallback } = await import("../search/search-provider");
    const searchResult = await searchWithFallback(queries[source] ?? source, { num: 5 });
    const results = searchResult.results;

    if (!Array.isArray(results) || results.length === 0) return [];

    // Use LLM to synthesize opportunities from search results
    const { callLLM } = await import("@/lib/llm-client");
    const context = results
      .map((r) => `- ${r.title}: ${r.snippet} (${r.url})`)
      .join("\n");

    const prompt = `Based on these web search results from source "${source}", identify 1-2 concrete earning opportunities for an autonomous AI company.

Search Results:
${context}

Respond in EXACTLY this JSON format (no markdown, no code fences):
[
  {
    "title": "Short opportunity title",
    "description": "What the opportunity is and how to execute it",
    "source": "${source}",
    "estimatedRevenue": <number in USD>,
    "timeToExecuteHours": <number>,
    "department": "<one of: ${DEPARTMENTS.join(", ")}>",
    "feasibilityScore": <0-1>
  }
]`;

    const result = await callLLM("Earning-Researcher", "Sales", prompt, {
      maxRetries: 1,
    });

    try {
      const cleaned = result.content
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      const parsed = JSON.parse(cleaned);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  } catch (err) {
    logger.warn("hermes-earning.scan.error", { source, error: String(err) });
    return [];
  }
}

/**
 * Run the daily earning research — discovers, scores, and registers
 * at least 5 opportunities.
 */
export async function runDailyEarningResearch(): Promise<ResearchResult> {
  logger.info("hermes-earning.daily.start");

  const allOpportunities: Opportunity[] = [];

  // Scan all 5 sources
  for (const source of SOURCES) {
    const opps = await scanSource(source);
    allOpportunities.push(...opps);
    if (allOpportunities.length >= 10) break; // Don't need more than 10
  }

  // v44 fix C11: REMOVED the synthetic padding loop. If web search returns 0
  // opportunities, report 0 — do NOT invent fake "Opportunity 1", "Opportunity 2" rows.
  // The previous behavior polluted the EarningOpportunity table with placeholders
  // that looked real in the dashboard. Now: 0 results = 0 results.
  if (allOpportunities.length === 0) {
    logger.warn("hermes-earning.daily.no-results", {
      hint: "All 5 sources returned 0 opportunities. Check Z-AI API status + query phrasing.",
    });
    emit({
      type: "system",
      ts: new Date().toISOString(),
      message: "Earning Research: 0 opportunities discovered today (all sources returned nothing)",
      level: "warn",
    });
  }

  // Save to database
  let qualified = 0;
  let insertedToPipeline = 0;

  for (const opp of allOpportunities) {
    const record = await db.earningOpportunity.create({
      data: {
        title: opp.title,
        description: opp.description,
        source: opp.source,
        estimatedRevenue: opp.estimatedRevenue,
        timeToExecuteHours: opp.timeToExecuteHours,
        department: opp.department,
        feasibilityScore: opp.feasibilityScore,
        status: opp.feasibilityScore > 0.6 ? "qualified" : "discovered",
      },
    });

    if (opp.feasibilityScore > 0.7) {
      qualified++;
      // Auto-insert qualified opportunities into the Deal pipeline
      const deal = await db.deal.create({
        data: {
          title: opp.title,
          value: opp.estimatedRevenue,
          currency: "USD",
          stage: "lead",
          probability: Math.round(opp.feasibilityScore * 100),
          source: opp.source,
        },
      });

      await db.earningOpportunity.update({
        where: { id: record.id },
        data: { dealId: deal.id, status: "pipeline" },
      });
      insertedToPipeline++;

      // Emit SSE event
      emit({
        type: "system",
        ts: new Date().toISOString(),
        message: `New earning opportunity qualified: ${opp.title} ($${opp.estimatedRevenue})`,
        level: "success",
      });
    }
  }

  logger.info("hermes-earning.daily.complete", {
    discovered: allOpportunities.length,
    qualified,
    insertedToPipeline,
  });

  return {
    discovered: allOpportunities.length,
    qualified,
    insertedToPipeline,
    opportunities: allOpportunities,
  };
}

/**
 * Get today's earning opportunities.
 */
export async function getTodayOpportunities(limit = 20) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return db.earningOpportunity.findMany({
    where: { discoveredAt: { gte: today } },
    orderBy: [{ feasibilityScore: "desc" }, { estimatedRevenue: "desc" }],
    take: limit,
  });
}
