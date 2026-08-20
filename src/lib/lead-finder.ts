/**
 * src/lib/lead-finder.ts — Autonomous Lead Finder (v40)
 *
 * Daily autonomous flow that discovers potential customers, scores them
 * against the service catalog, and queues high-confidence leads for
 * owner-approved outreach.
 *
 * Flow:
 *   1. Fetch the service catalog (what ARIA sells)
 *   2. For each service, run a web search for businesses that might need it
 *   3. LLM analyzes each search result + scores confidence (0-100) based on:
 *      - How well the business matches the service
 *      - Whether they have a website (digital maturity)
 *      - Industry relevance
 *      - Signs of budget/need
 *   4. High-confidence leads (>=70) are stored as EarningOpportunity rows
 *      (status="discovered") + a follow-up Task is created
 *   5. The owner reviews discovered leads in the dashboard and approves
 *      outreach (human-in-the-loop — no autonomous emailing)
 *
 * Confidence score breakdown (0-100):
 *   - Service match (0-40): how well the business needs this service
 *   - Digital maturity (0-20): do they have a website? Is it modern?
 *   - Budget signals (0-20): company size, revenue indicators
 *   - Contactability (0-20): is there a public email/contact form?
 *
 * Runs daily via the cron scheduler (job name: "lead-finder-daily").
 */

import "server-only"

import { db } from "./db"
import { logger } from "./logger"
import { emit } from "./event-bus"

export interface DiscoveredLead {
  businessName: string
  website: string
  industry: string
  serviceMatched: string
  confidenceScore: number
  reasoning: string
  suggestedOutreach: string
  contactEmail?: string
}

export interface LeadFinderResult {
  searched: number
  discovered: number
  qualified: number
  insertedToPipeline: number
  leads: DiscoveredLead[]
}

/**
 * Run the daily lead finder.
 * Discovers potential customers via web search + LLM scoring.
 */
export async function runLeadFinder(): Promise<LeadFinderResult> {
  logger.info("lead-finder.start", { timestamp: new Date().toISOString() })

  // v61.4 Phase 9 FIX: guard against stub providers. If the operator selected
  // a provider that isn't wired (apollo/hunter/snov/clearbit/zoominfo), throw
  // a graceful error instead of silently falling back to Z-AI (which would
  // hide the misconfiguration). Only 'zai' is currently wired.
  const provider = process.env.ARIA_SEARCH_PROVIDER ?? "zai";
  if (provider !== "zai") {
    const msg = `STUB: ARIA_SEARCH_PROVIDER="${provider}" is not yet wired. Only "zai" (Z-AI web_search) is implemented. Set ARIA_SEARCH_PROVIDER=zai or implement the ${provider} integration in src/lib/lead-finder.ts.`;
    logger.error("lead-finder.stub-provider", { provider });
    throw new Error(msg);
  }

  try {
    // 1. Fetch the service catalog
    const { SERVICE_CATALOG } = await import("./services/catalog")
    const catalog = SERVICE_CATALOG
    if (catalog.length === 0) {
      logger.warn("lead-finder.no-catalog", {})
      return { searched: 0, discovered: 0, qualified: 0, insertedToPipeline: 0, leads: [] }
    }

    const allLeads: DiscoveredLead[] = []
    let totalSearched = 0

    // 2. For each service, search for potential customers
    // Limit to first 3 services to keep the search volume reasonable
    for (const service of catalog.slice(0, 3)) {
      const searchQuery = buildSearchQuery(service)
      logger.debug("lead-finder.searching", { service: service.name, query: searchQuery })

      try {
        // Phase 32: Use the 4-provider searchWithFallback (Tavily → Serper → Z-AI → DuckDuckGo).
        const { searchWithFallback } = await import("./search/search-provider")
        const searchResult = await searchWithFallback(searchQuery, { num: 5 })
        const searchResults = searchResult.results
        totalSearched += searchResults.length

        // 3. Score each result with the LLM
        for (const result of searchResults as any[]) {
          const lead = await scoreLead(result, service.name)
          if (lead) {
            allLeads.push(lead)
          }
        }
      } catch (err) {
        logger.warn("lead-finder.search-failed", {
          service: service.name,
          error: String(err).slice(0, 100),
        })
      }
    }

    // 4. Deduplicate by website
    const seen = new Set<string>()
    const uniqueLeads = allLeads.filter((lead) => {
      const key = lead.website.toLowerCase().replace(/\/$/, "")
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // 5. Store high-confidence leads (>=50) as EarningOpportunity rows
    let inserted = 0
    for (const lead of uniqueLeads) {
      if (lead.confidenceScore >= 50) {
        try {
          await db.earningOpportunity.create({
            data: {
              title: `${lead.businessName} — ${lead.serviceMatched}`,
              description: JSON.stringify({
                businessName: lead.businessName,
                website: lead.website,
                industry: lead.industry,
                serviceMatched: lead.serviceMatched,
                confidenceScore: lead.confidenceScore,
                reasoning: lead.reasoning,
                suggestedOutreach: lead.suggestedOutreach,
                contactEmail: lead.contactEmail,
              }),
              source: "lead-finder",
              estimatedRevenue: 500, // default estimate, owner adjusts
              department: "Sales",
              feasibilityScore: lead.confidenceScore / 100, // 0-1 scale
              status: "discovered",
              discoveredAt: new Date(),
            },
          })
          inserted++
        } catch (err) {
          logger.warn("lead-finder.insert-failed", {
            business: lead.businessName,
            error: String(err).slice(0, 100),
          })
        }
      }
    }

    const qualified = uniqueLeads.filter((l) => l.confidenceScore >= 70).length

    logger.success("lead-finder.complete", {
      searched: totalSearched,
      discovered: uniqueLeads.length,
      qualified,
      insertedToPipeline: inserted,
    })

    // Emit an event for the dashboard
    emit({
      type: "system",
      ts: new Date().toISOString(),
      message: `Lead Finder: discovered ${uniqueLeads.length} leads, ${qualified} high-confidence, ${inserted} added to pipeline`,
      level: "success",
    })

    return {
      searched: totalSearched,
      discovered: uniqueLeads.length,
      qualified,
      insertedToPipeline: inserted,
      leads: uniqueLeads,
    }
  } catch (err) {
    logger.error("lead-finder.failed", { error: String(err) })
    return { searched: 0, discovered: 0, qualified: 0, insertedToPipeline: 0, leads: [] }
  }
}

/**
 * Build a web search query for a service.
 *
 * v44 fix C8: The previous query ("small businesses needing X ... looking for help")
 * returned articles and blog posts about the topic, not actual businesses.
 * New strategy: search business directories (Yelp, LinkedIn, Google Maps)
 * which return real business listings with names + websites.
 */
function buildSearchQuery(service: { name: string; description: string }): string {
  // Pick a directory to search based on service category
  // Yelp for local businesses, LinkedIn for B2B, Google Maps for both
  const directoryPicks = [
    `site:yelp.com "${service.name}" small business`,
    `site:linkedin.com/company "${service.name}" services`,
    `site:maps.google.com "${service.name}" business`,
    `"${service.name}" services "contact us" small business`,
    `"${service.name}" agency directory`,
  ]
  // Rotate through the directory picks based on day so we don't always hit the same one
  const dayIndex = Math.floor(Date.now() / (24 * 60 * 60 * 1000)) % directoryPicks.length
  return directoryPicks[dayIndex]
}

/**
 * Score a search result against the service catalog using the LLM.
 * Returns a DiscoveredLead with a 0-100 confidence score.
 */
async function scoreLead(
  result: { url: string; name: string; snippet: string; host_name: string },
  serviceName: string,
): Promise<DiscoveredLead | null> {
  try {
    const { callLLM } = await import("./llm-client")

    const prompt = `You are a business development analyst. Analyze this search result and determine if it represents a REAL BUSINESS that could be a customer for our "${serviceName}" service.

Search Result:
- Title: ${result.name}
- URL: ${result.url}
- Snippet: ${result.snippet}

IMPORTANT: First determine if this is a REAL BUSINESS (a company with a website that sells products/services) or a NON-BUSINESS (article, blog post, video, directory listing, social media profile). If it's NOT a real business, return confidenceScore: 0 and isRealBusiness: false.

If it IS a real business, score it on these criteria (0-100 total):
- Service match (0-40): How well does this business need "${serviceName}"?
- Digital maturity (0-20): Do they have a website? Is it modern?
- Budget signals (0-20): Company size, revenue indicators
- Contactability (0-20): Is there a public email or contact form?

CRITICAL: Do NOT invent a contact email. Only return an email if it's explicitly visible in the snippet (e.g. "contact@business.com"). If no email is visible, return null — do not guess.

Respond with ONLY valid JSON, no markdown:
{
  "isRealBusiness": true|false,
  "businessName": "extracted company name (null if not a real business)",
  "website": "${result.url}",
  "industry": "extracted industry (null if not a real business)",
  "confidenceScore": <0-100 integer>,
  "reasoning": "1-2 sentence explanation of the score",
  "suggestedOutreach": "draft a personalized 1-sentence outreach message (empty if not a real business)",
  "contactEmail": "extracted email IF visible in snippet, otherwise null"
}`

    const llmResult = await callLLM("LeadFinder", "Sales", prompt)

    if (!llmResult.success) {
      logger.debug("lead-finder.llm-failed", { url: result.url, error: llmResult.error })
      return null
    }

    const content = llmResult.completion

    // Parse the JSON response (LLMs sometimes wrap in markdown)
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0]) as Partial<DiscoveredLead> & { isRealBusiness?: boolean; contactEmail?: string | null }

    // v44 fix C8: Skip non-business results (articles, videos, blog posts, social media)
    if (parsed.isRealBusiness === false) {
      logger.debug("lead-finder.skipped-non-business", { url: result.url, name: result.name?.slice(0, 60) })
      return null
    }

    // v44 fix C8: Skip if businessName is missing (the LLM couldn't identify a real business)
    if (!parsed.businessName || parsed.businessName === "null") {
      logger.debug("lead-finder.skipped-no-name", { url: result.url })
      return null
    }

    // v44 fix: Validate contact email format if present (LLMs sometimes hallucinate)
    let contactEmail: string | undefined
    if (parsed.contactEmail && typeof parsed.contactEmail === "string") {
      const email = parsed.contactEmail.trim().toLowerCase()
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        contactEmail = email
      }
    }

    return {
      businessName: parsed.businessName,
      website: result.url,
      industry: parsed.industry || "unknown",
      serviceMatched: serviceName,
      confidenceScore: Math.max(0, Math.min(100, Number(parsed.confidenceScore) || 0)),
      reasoning: parsed.reasoning || "No reasoning provided",
      suggestedOutreach: parsed.suggestedOutreach || "",
      contactEmail,
    }
  } catch (err) {
    logger.debug("lead-finder.score-failed", {
      url: result.url,
      error: String(err).slice(0, 80),
    })
    return null
  }
}

/**
 * Get discovered leads for the dashboard.
 */
export async function getDiscoveredLeads(limit: number = 50) {
  return db.earningOpportunity.findMany({
    where: { source: "lead-finder", status: "discovered" },
    orderBy: { discoveredAt: "desc" },
    take: limit,
  })
}
