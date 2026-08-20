/**
 * src/lib/lead-hunter/service-matcher.ts — v71 Phase 21 (Autonomous Lead Hunter)
 *
 * Matches discovered social-media leads to the most relevant services
 * the app offers. Uses local Ollama (llama3.2:3b) for the matching
 * analysis per the Multi-Tier Context Manager strategy (Tier 3 local).
 *
 * Flow:
 *   1. Load all published services from ServiceOpportunity table.
 *   2. Build a prompt: lead buying signal + lead profile + service catalog.
 *   3. Call Ollama to rank the top 3 services + estimate conversion probability.
 *   4. Parse the structured response into ServiceMatch[].
 *
 * The output is consumed by the qualification-debate module to inform
 * the Scout/Risk/Sales council's verdict.
 */

import "server-only";
import { db } from "../db";
import { logger } from "../logger";
import { callLLM } from "../llm-client";
import type { DiscoveredLead } from "./social-scout";

// ─── Types ────────────────────────────────────────────────────────────

export interface ServiceMatch {
  serviceName: string;
  serviceId: string;
  reason: string;
  conversionProbability: number; // 0-100
  priceCents: number;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Match a lead's buying signal to the top 3 services from the catalog.
 * Routes to local Ollama (free, unlimited) per the Multi-Tier strategy.
 *
 * @param buyingSignal The lead's post content (their buying intent text).
 * @param leadProfile Additional profile context (username, platform, follower count).
 * @returns Up to 3 ServiceMatch objects, ranked by conversion probability descending.
 */
export async function matchServiceToLead(
  buyingSignal: string,
  leadProfile: { username: string; platform: string; followerCount?: number; matchedServiceCategory?: string },
): Promise<ServiceMatch[]> {
  // Load all published services from the catalog.
  const services = await db.serviceOpportunity.findMany({
    where: { status: "launched" },
    take: 50,
    orderBy: { compositeScore: "desc" },
  });

  // Fallback: if no launched services exist, use the seed catalog.
  const catalog = services.length > 0 ? services : SEED_CATALOG.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    estimatedPrice: s.priceCents.toString(),
    category: s.category,
  }));

  if (catalog.length === 0) {
    logger.warn("service-matcher.empty-catalog", { hint: "No published services + SEED_CATALOG empty" });
    return [];
  }

  // Build the LLM prompt.
  const serviceLines = catalog
    .map((s) => {
      const priceCents = Math.round(Number(s.estimatedPrice || 0));
      return `- ${s.name} (id: ${s.id}, category: ${s.category}): ${s.description} — $${(priceCents / 100).toFixed(2)}`;
    })
    .join("\n");

  const prompt = `
LEAD BUYING SIGNAL: "${buyingSignal.slice(0, 500)}"

LEAD PROFILE:
  - Username: ${leadProfile.username}
  - Platform: ${leadProfile.platform}
  - Follower count: ${leadProfile.followerCount ?? "unknown"}
  - Pre-matched category hint: ${leadProfile.matchedServiceCategory ?? "none"}

AVAILABLE SERVICES:
${serviceLines}

Rank the top 3 services this lead is most likely to buy based on their buying signal. For each, output a JSON object:
{ "serviceName": "<name>", "serviceId": "<id>", "reason": "<one sentence why>", "conversionProbability": <0-100 integer> }

Respond with ONLY a JSON array of 3 objects. No markdown fences, no preamble.
`.trim();

  try {
    // Route to LOCAL Ollama (Tier 3) per the Multi-Tier Context Manager strategy.
    const result = await callLLM("ServiceMatcher", "research", prompt, {
      maxRetries: 1,
      model: process.env.WORKFLOW_PROPOSER_MODEL || "llama3.2:3b",
      preferLocal: true,
    } as any);

    if (!result.success || !result.completion) {
      logger.warn("service-matcher.llm-failed", {
        error: result.error,
        lead: leadProfile.username,
      });
      // Fallback: use the pre-matched category hint to pick a service.
      return fallbackByCategory(leadProfile.matchedServiceCategory, catalog);
    }

    const parsed = parseServiceMatches(result.completion, catalog);
    if (parsed.length === 0) {
      logger.warn("service-matcher.parse-empty", {
        completionPreview: result.completion.slice(0, 200),
      });
      return fallbackByCategory(leadProfile.matchedServiceCategory, catalog);
    }

    logger.info("service-matcher.matched", {
      lead: leadProfile.username,
      topMatch: parsed[0]?.serviceName,
      topProbability: parsed[0]?.conversionProbability,
    });

    return parsed;
  } catch (err) {
    logger.warn("service-matcher.error", { error: String(err).slice(0, 100) });
    return fallbackByCategory(leadProfile.matchedServiceCategory, catalog);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Parse the LLM's text response into ServiceMatch[].
 * Tolerates markdown code fences + extra prose around the JSON.
 */
function parseServiceMatches(text: string, catalog: any[]): ServiceMatch[] {
  try {
    // Strip markdown code fences if present.
    const cleaned = text
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    // Find the first [...] block.
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start === -1 || end === -1) return [];
    const jsonStr = cleaned.slice(start, end + 1);
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];

    const matches: ServiceMatch[] = [];
    for (const m of parsed) {
      if (!m?.serviceName) continue;
      // Look up the service in the catalog to get the price.
      const catalogEntry = catalog.find(
        (c) => c.name === m.serviceName || c.id === m.serviceId,
      );
      const priceCents = catalogEntry
        ? Math.round(Number(catalogEntry.estimatedPrice || 0))
        : 0;
      matches.push({
        serviceName: m.serviceName,
        serviceId: m.serviceId ?? catalogEntry?.id ?? "",
        reason: String(m.reason ?? "").slice(0, 200),
        conversionProbability: Math.max(0, Math.min(100, Math.round(Number(m.conversionProbability ?? 0)))),
        priceCents,
      });
    }
    // Sort by conversion probability descending.
    matches.sort((a, b) => b.conversionProbability - a.conversionProbability);
    return matches.slice(0, 3);
  } catch {
    return [];
  }
}

/**
 * Fallback when the LLM is unavailable or its response is unparseable.
 * Picks services from the catalog by matching the pre-matched category hint.
 */
function fallbackByCategory(category: string | undefined, catalog: any[]): ServiceMatch[] {
  if (!category) return [];
  // Map the social-scout category to a service category in the catalog.
  const categoryMap: Record<string, string> = {
    "landing-page": "web",
    "saas-scaffold": "saas",
    "blog-post": "content",
    "ai-chatbot": "ai-tool",
    "consulting": "consulting",
  };
  const targetCategory = categoryMap[category] ?? category;
  const matches = catalog
    .filter((s) => s.category?.toLowerCase().includes(targetCategory.toLowerCase()))
    .slice(0, 3)
    .map((s) => ({
      serviceName: s.name,
      serviceId: s.id,
      reason: `Pre-matched via category "${category}" (LLM unavailable)`,
      conversionProbability: 30, // conservative fallback
      priceCents: Math.round(Number(s.estimatedPrice || 0)),
    }));
  return matches;
}

// ─── Seed Catalog Fallback ────────────────────────────────────────────
//
// Used when no services are published in the ServiceOpportunity table
// (e.g. fresh install before any service has been launched). Mirrors
// the documented service catalog in GOAL.md.

const SEED_CATALOG = [
  { id: "seed-landing", name: "Landing Page Generator", description: "High-conversion landing page with your brand applied", priceCents: 1900, category: "web" },
  { id: "seed-static", name: "Static Website", description: "Multi-page static site with SEO optimization", priceCents: 2900, category: "web" },
  { id: "seed-3d", name: "3D Website", description: "Interactive 3D website with Three.js", priceCents: 4900, category: "web" },
  { id: "seed-blog", name: "Blog Post", description: "SEO-optimized blog post in your brand voice", priceCents: 900, category: "content" },
  { id: "seed-apidocs", name: "API Docs", description: "Interactive API documentation site", priceCents: 3400, category: "content" },
  { id: "seed-cli", name: "CLI Tool", description: "Custom command-line tool with full tests", priceCents: 2400, category: "code" },
  { id: "seed-voice", name: "Voice Agent", description: "Dual-TTS voice agent with Pipecat + Piper", priceCents: 3900, category: "ai-tool" },
  { id: "seed-saas", name: "SaaS Scaffold", description: "Next.js + Prisma + Stripe + auth starter", priceCents: 9900, category: "saas" },
  { id: "seed-dashboard", name: "Dashboard", description: "Real-time analytics dashboard with charts", priceCents: 3900, category: "saas" },
  { id: "seed-apiservice", name: "API Service", description: "Production REST API with OpenAPI spec", priceCents: 4900, category: "code" },
];
