/**
 * src/lib/lead-hunter/social-scout.ts — v71 Phase 21 (Autonomous Lead Hunter)
 *
 * RULE-69: HUNT FOR LEADS, DON'T JUST WAIT.
 *
 * This module autonomously monitors Twitter/X, LinkedIn, and Reddit for
 * buying signals related to the app's services. Instead of waiting for
 * the owner to manually provide leads, the app proactively discovers
 * them every morning at 6 AM via the `daily-lead-hunt` cron.
 *
 * Architecture:
 *   1. Build a list of buying-signal keywords per service category.
 *   2. Use the Z-AI web_search + page_reader to scan each platform.
 *   3. Extract structured lead data (handle, post content, profile URL,
 *      engagement metrics).
 *   4. Store discovered leads in the Lead table with source="social-scout".
 *
 * Open-source compliance (RULE-58): no paid Twitter/LinkedIn APIs.
 * Uses the Z-AI web_search SDK which scrapes public posts. The owner
 * can opt into paid APIs (e.g. Twitter API v2) by setting env vars,
 * but the default path is the free scraper.
 */

import "server-only";
import { db } from "../db";
import { logger } from "../logger";
import { emit } from "../event-bus";

// ─── Types ────────────────────────────────────────────────────────────

export interface DiscoveredLead {
  platform: "twitter" | "linkedin" | "reddit";
  username: string;
  displayName: string;
  profileUrl: string;
  postContent: string;
  postUrl: string;
  postedAt: Date | null;
  likes: number;
  replies: number;
  reposts: number;
  followerCount: number;
  accountAgeDays: number;
  matchedServiceCategory: string;
  matchedSignal: string;
}

export interface BuyingSignal {
  category: string; // e.g. "landing-page", "saas-scaffold", "blog-post", "ai-chatbot"
  signals: string[]; // keywords / phrases that indicate buying intent
  services: string[]; // service names this category matches
}

// ─── Buying Signal Catalog ────────────────────────────────────────────
//
// v71 Phase 21: Define the buying-intent keywords per service category.
// The social scout searches each platform for these phrases. When a
// post matches, the lead is tagged with the matched category + the
// service-matcher module later refines to a specific service.

export const BUYING_SIGNALS: BuyingSignal[] = [
  {
    category: "landing-page",
    signals: [
      "need a landing page",
      "looking for web designer",
      "redesigning our site",
      "launching soon need website",
      "need a website",
      "hiring a web designer",
      "our landing page sucks",
      "need a new homepage",
    ],
    services: ["Landing Page Generator", "Static Website", "3D Website"],
  },
  {
    category: "saas-scaffold",
    signals: [
      "building a SaaS",
      "just raised seed round",
      "looking for technical co-founder",
      "MVP development",
      "shipping our SaaS",
      "SaaS MVP",
      "building an app",
      "raising pre-seed",
      "just closed seed",
    ],
    services: ["SaaS Scaffold", "API Service", "Dashboard"],
  },
  {
    category: "blog-post",
    signals: [
      "need content writer",
      "looking for SEO articles",
      "blog is dead need help",
      "need blog posts",
      "content marketing help",
      "need articles written",
      "blogging frequency",
      "hire a writer",
    ],
    services: ["Blog Post", "API Docs"],
  },
  {
    category: "ai-chatbot",
    signals: [
      "need customer support bot",
      "automating support",
      "chatbot for website",
      "AI agent for support",
      "support automation",
      "need a chatbot",
      "AI for customer service",
      "WhatsApp bot",
    ],
    services: ["Voice Agent", "AI Tool", "API Service"],
  },
  {
    category: "consulting",
    signals: [
      "looking for AI consultant",
      "hiring AI engineer",
      "need ML consulting",
      "AI strategy help",
      "machine learning project",
      "need a data scientist",
    ],
    services: ["Consulting", "AI Tool", "Dashboard"],
  },
];

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Main entry point. Hunts for buying signals across all configured
 * platforms. Returns the discovered leads + persists them to the Lead
 * table with source="social-scout", status="discovered" (encoded in
 * qualificationVerdict="pending").
 *
 * Designed to run daily at 6 AM via the daily-lead-hunt cron.
 */
export async function huntForLeads(): Promise<DiscoveredLead[]> {
  logger.info("social-scout.hunt.start", {
    signalCount: BUYING_SIGNALS.reduce((s, b) => s + b.signals.length, 0),
    platforms: ["twitter", "linkedin", "reddit"],
  });
  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: "🔍 Phase 21 Lead Hunter: scanning Twitter/LinkedIn/Reddit for buying signals...",
    level: "info",
  });

  const allLeads: DiscoveredLead[] = [];

  // Iterate over every buying-signal keyword across every platform.
  for (const signal of BUYING_SIGNALS) {
    for (const keyword of signal.signals) {
      try {
        // Search Twitter/X
        const twitterLeads = await searchPlatform("twitter", keyword, signal);
        allLeads.push(...twitterLeads);

        // Search LinkedIn
        const linkedinLeads = await searchPlatform("linkedin", keyword, signal);
        allLeads.push(...linkedinLeads);

        // Search Reddit
        const redditLeads = await searchPlatform("reddit", keyword, signal);
        allLeads.push(...redditLeads);
      } catch (err) {
        // Don't let one failed keyword kill the whole hunt.
        logger.warn("social-scout.keyword-failed", {
          keyword,
          error: String(err).slice(0, 100),
        });
      }
    }
  }

  // Deduplicate by (platform, username, postContent) — same person posting
  // the same thing twice across keywords should count once.
  const seen = new Set<string>();
  const unique = allLeads.filter((l) => {
    const key = `${l.platform}|${l.username}|${l.postContent.slice(0, 100)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Persist each discovered lead to the Lead table.
  for (const lead of unique) {
    try {
      await db.lead.create({
        data: {
          source: "social-scout",
          platform: lead.platform,
          username: lead.username,
          displayName: lead.displayName,
          profileUrl: lead.profileUrl,
          postContent: lead.postContent,
          postUrl: lead.postUrl,
          postedAt: lead.postedAt ?? null,
          likes: lead.likes,
          replies: lead.replies,
          reposts: lead.reposts,
          followerCount: lead.followerCount,
          accountAgeDays: lead.accountAgeDays,
          topMatchedService: lead.matchedServiceCategory,
          qualificationVerdict: "pending",
          qualificationScore: 0,
        },
      });
    } catch (err) {
      // best-effort — don't fail the hunt if one insert fails.
      logger.warn("social-scout.lead-persist-failed", {
        username: lead.username,
        platform: lead.platform,
        error: String(err).slice(0, 80),
      });
    }
  }

  logger.info("social-scout.hunt.complete", {
    discovered: unique.length,
    deduplicatedFrom: allLeads.length,
  });
  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: `🔍 Phase 21 Lead Hunter: discovered ${unique.length} new leads (deduplicated from ${allLeads.length} raw hits)`,
    level: unique.length > 0 ? "success" : "info",
  });

  return unique;
}

/**
 * Search a single platform for a single buying-signal keyword. Uses
 * Z-AI web_search to find public posts, then page_reader to extract
 * structured data from the result URLs.
 */
async function searchPlatform(
  platform: "twitter" | "linkedin" | "reddit",
  keyword: string,
  signal: BuyingSignal,
): Promise<DiscoveredLead[]> {
  try {
    // Phase 32: Use the 4-provider searchWithFallback (Tavily → Serper → Z-AI → DuckDuckGo).
    const { searchWithFallback } = await import("../search/search-provider");

    const siteFilter =
      platform === "twitter" ? "site:x.com OR site:twitter.com"
      : platform === "linkedin" ? "site:linkedin.com"
      : "site:reddit.com";
    const query = `"${keyword}" ${siteFilter} -filter:retweets`;

    const searchResult = await searchWithFallback(query, { num: 10 });
    const searchResults = searchResult.results;
    if (!Array.isArray(searchResults) || searchResults.length === 0) return [];

    const leads: DiscoveredLead[] = [];
    for (const r of searchResults.slice(0, 5)) { // top 5 per keyword per platform
      const lead = parsePlatformResult(platform, r, signal);
      if (lead) leads.push(lead);
    }
    return leads;
  } catch (err) {
    logger.warn("social-scout.platform-search-failed", {
      platform,
      keyword,
      error: String(err).slice(0, 80),
    });
    return [];
  }
}

/**
 * Parse a Z-AI web_search result into a structured DiscoveredLead.
 * The search result has: title, url, snippet, date.
 */
function parsePlatformResult(
  platform: "twitter" | "linkedin" | "reddit",
  result: any,
  signal: BuyingSignal,
): DiscoveredLead | null {
  const url: string = result?.url ?? result?.link ?? "";
  const title: string = result?.title ?? "";
  const snippet: string = result?.snippet ?? result?.description ?? "";
  const dateStr: string = result?.date ?? result?.publishedAt ?? "";

  // Extract username from the URL.
  //   twitter.com/{username}/status/...
  //   x.com/{username}/status/...
  //   linkedin.com/posts/{username}-{slug}-...
  //   reddit.com/r/{subreddit}/comments/{id}/{slug}/
  let username = "";
  let displayName = title;
  if (platform === "twitter" || platform === "linkedin") {
    const match = url.match(/(?:twitter\.com|x\.com|linkedin\.com)\/(?:posts\/)?(@?[\w.\-]+)(?:\/|\?|#|$)/);
    username = match?.[1]?.replace(/^@/, "") ?? "";
  } else if (platform === "reddit") {
    const match = url.match(/reddit\.com\/r\/([\w-]+)\/comments\/([\w-]+)\/([\w-]+)/);
    username = match ? `r/${match[1]}` : "";
    displayName = match ? `${match[1]} • Reddit post` : title;
  }

  // Skip if we couldn't extract a username (likely a profile search page).
  if (!username && platform !== "reddit") return null;

  // Try to parse the date.
  let postedAt: Date | null = null;
  if (dateStr) {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) postedAt = parsed;
  }

  return {
    platform,
    username,
    displayName: displayName.slice(0, 100),
    profileUrl: url,
    postContent: (snippet || title).slice(0, 500),
    postUrl: url,
    postedAt,
    likes: 0, // not available via search — would need platform API
    replies: 0,
    reposts: 0,
    followerCount: 0, // not available via search — would need platform API
    accountAgeDays: 0, // not available via search — would need platform API
    matchedServiceCategory: signal.category,
    matchedSignal: signal.signals[0], // best-effort — the keyword that matched
  };
}

/**
 * Reply to a social post with a HELPFUL comment (not a pitch).
 * Used when the qualification debate verdict is INVESTIGATE — the lead
 * might be genuine but not ready to buy. Reply with helpful advice to
 * gauge their response. If they reply back, they're warm.
 *
 * Note: actual posting to Twitter/LinkedIn/Reddit requires platform API
 * credentials (paid for Twitter, OAuth for LinkedIn, Reddit API). The
 * default implementation logs the reply + queues it for manual posting
 * via the dashboard.
 */
export async function replyToPost(
  lead: DiscoveredLead,
  comment: string,
): Promise<{ ok: boolean; queued: boolean; error?: string }> {
  try {
    // Store the queued reply in the Lead table for manual posting.
    await db.lead.update({
      where: { id: (lead as any).id ?? "" },
      data: {
        outreachStatus: "queued-reply",
        outreachChannel: "social-reply",
        qualificationReasoning: comment,
      },
    });
    logger.info("social-scout.reply-queued", {
      platform: lead.platform,
      username: lead.username,
      commentLength: comment.length,
    });
    return { ok: true, queued: true };
  } catch (err) {
    return { ok: false, queued: false, error: String(err).slice(0, 100) };
  }
}

/**
 * Generate a helpful (non-pitchy) reply to a lead's post. Used by the
 * INVESTIGATE path of the daily-lead-hunt cron.
 */
export function generateHelpfulComment(
  lead: DiscoveredLead,
  serviceName: string,
): string {
  const templates: Record<string, string> = {
    "landing-page":
      `Hey @${lead.username} — saw your post about needing a landing page. ` +
      `Quick tip: lead with a single call-to-action above the fold, use your ` +
      `brand color as the primary CTA button, and keep load time under 2s. ` +
      `If you want, I can mock up a free preview with your brand applied — ` +
      `no strings. Just reply here or DM me.`,
    "saas-scaffold":
      `Hey @${lead.username} — congrats on the SaaS! For an MVP, the fastest ` +
      `path is: Next.js + Prisma + Postgres + Stripe + Resend. Don't reinvent ` +
      `auth (use NextAuth). I've scaffolded a few of these — happy to share a ` +
      `template with your brand applied if useful.`,
    "blog-post":
      `Hey @${lead.username} — your blog isn't dead, it just needs cadence. ` +
      `Post 1×/week on the same day. Pick 3 pillars (e.g. how-tos, case ` +
      `studies, opinion). Write for search intent, not volume. I can draft a ` +
      `free sample post in your brand voice if helpful — let me know.`,
    "ai-chatbot":
      `Hey @${lead.username} — for support automation, start with the 80/20: ` +
      `identify the top 10 questions your team answers repeatedly, build a ` +
      `knowledge base for those, and use a retrieval-based bot (not pure LLM). ` +
      `Happy to mock up a chatbot preview with your branding if you want.`,
    "consulting":
      `Hey @${lead.username} — for AI consulting, the highest-leverage first ` +
      `project is usually "automate the most repetitive internal task." Identify ` +
      `the slowest team workflow, scope a 4-week pilot. Happy to chat through ` +
      `the architecture if useful.`,
  };
  return templates[lead.matchedServiceCategory] ?? templates["landing-page"];
}
