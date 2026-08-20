/**
 * src/lib/lead-hunter/google-maps-scout.ts — v72 Phase 22 (RULE-70)
 *
 * Scans Google Maps (via Z-AI web_search) for businesses that LACK a website.
 * These are the perfect targets for our website-builder services (Landing Page,
 * Static Website, 3D Website). A business with no online presence is a business
 * that needs us most.
 *
 * Strategy:
 *   1. Search Google Maps for business categories in target cities:
 *        "restaurants in {city}", "salons in {city}", "plumbers in {city}"
 *   2. For each result, check the "Website" field. If missing → target.
 *   3. Persist to GoogleMapsBusiness table with hasWebsite=false.
 *   4. Promote high-confidence ones to the Lead table for the qualification
 *      debate (uses the same Scout/Risk/Sales council from Phase 21).
 *
 * The default code path uses Z-AI web_search (free, open-source compliant).
 * For production use, the owner can configure the Google Places API by setting
 * GOOGLE_PLACES_API_KEY — but that's behind an explicit opt-in env var.
 */

import "server-only";
import { db } from "../db";
import { logger } from "../logger";
import { emit } from "../event-bus";

// ─── Types ────────────────────────────────────────────────────────────

export interface GoogleMapsBusiness {
  businessName: string;
  address: string;
  city: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  website: string | null; // null = NO WEBSITE (target!)
  googleMapsUrl: string;
  googlePlaceId: string | null;
  category: string;
  rating: number;
  reviewCount: number;
}

export interface ScoutConfig {
  cities: string[]; // e.g. ["Mumbai", "Delhi", "Bangalore"]
  categories: string[]; // e.g. ["restaurant", "salon", "plumber", "dentist"]
  maxPerCategory: number; // cap per category per city (default 20)
  onlyWithoutWebsite: boolean; // default true — only return businesses without a website
}

// ─── Default config ──────────────────────────────────────────────────
//
// The owner can override these via the dashboard. The defaults target
// Indian Tier-1 cities (where the owner is based per OWNER_TIMEZONE=Asia/Kolkata)
// + the highest-value categories for website-builder services.

export const DEFAULT_SCOUT_CONFIG: ScoutConfig = {
  cities: ["Mumbai", "Delhi", "Bangalore", "Hyderabad", "Pune", "Chennai"],
  categories: [
    "restaurant",
    "salon",
    "spa",
    "gym",
    "dentist",
    "plumber",
    "electrician",
    "interior designer",
    "real estate agent",
    "boutique",
    "bakery",
    "cafe",
    "fitness trainer",
    "lawyer",
    "chartered accountant",
    "tutor",
    "photographer",
    "event planner",
    "catering service",
    "car repair",
  ],
  maxPerCategory: 20,
  onlyWithoutWebsite: true,
};

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Scan Google Maps for businesses without websites.
 * Returns the discovered businesses + persists them to the GoogleMapsBusiness table.
 *
 * Designed to run daily via the daily-proactive-promo cron (different time slot
 * from daily-lead-hunt to avoid Ollama contention).
 */
export async function scanForBusinessesWithoutWebsites(
  config: ScoutConfig = DEFAULT_SCOUT_CONFIG,
): Promise<GoogleMapsBusiness[]> {
  logger.info("google-maps-scout.start", {
    cities: config.cities.length,
    categories: config.categories.length,
    maxPerCategory: config.maxPerCategory,
  });
  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: `🗺️ Phase 22 Google Maps Scout: scanning ${config.cities.length} cities × ${config.categories.length} categories for businesses without websites...`,
    level: "info",
  });

  const allBusinesses: GoogleMapsBusiness[] = [];

  for (const city of config.cities) {
    for (const category of config.categories) {
      try {
        const results = await searchGoogleMapsForCategory(category, city, config.maxPerCategory);
        for (const b of results) {
          if (config.onlyWithoutWebsite && b.website) continue;
          allBusinesses.push(b);
        }
      } catch (err) {
        logger.warn("google-maps-scout.category-failed", {
          city,
          category,
          error: String(err).slice(0, 80),
        });
      }
    }
  }

  // Deduplicate by businessName + city.
  const seen = new Set<string>();
  const unique = allBusinesses.filter((b) => {
    const key = `${b.businessName.toLowerCase()}|${b.city.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Persist to GoogleMapsBusiness table.
  for (const b of unique) {
    try {
      await db.googleMapsBusiness.create({
        data: {
          businessName: b.businessName.slice(0, 200),
          address: b.address,
          city: b.city,
          region: b.region,
          country: b.country,
          latitude: b.latitude,
          longitude: b.longitude,
          phone: b.phone,
          website: b.website,
          googleMapsUrl: b.googleMapsUrl,
          googlePlaceId: b.googlePlaceId,
          category: b.category,
          rating: b.rating,
          reviewCount: b.reviewCount,
          hasWebsite: !!b.website,
          matchedServiceCategory: inferServiceCategory(b.category),
          qualificationVerdict: "pending",
          qualificationScore: 0,
        },
      });
    } catch (err) {
      // best-effort
      logger.warn("google-maps-scout.persist-failed", {
        business: b.businessName,
        error: String(err).slice(0, 80),
      });
    }
  }

  logger.info("google-maps-scout.complete", {
    discovered: unique.length,
    deduplicatedFrom: allBusinesses.length,
    withoutWebsite: unique.filter((b) => !b.website).length,
  });
  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: `🗺️ Phase 22 Google Maps Scout: discovered ${unique.length} businesses (${unique.filter((b) => !b.website).length} without websites)`,
    level: unique.length > 0 ? "success" : "info",
  });

  return unique;
}

/**
 * Search Google Maps for businesses in a category + city.
 * Uses Z-AI web_search to find Google Maps result pages, then parses them.
 */
async function searchGoogleMapsForCategory(
  category: string,
  city: string,
  maxResults: number,
): Promise<GoogleMapsBusiness[]> {
  // Phase 32: Use the 4-provider searchWithFallback (Tavily → Serper → Z-AI → DuckDuckGo)
  // instead of the 2-provider webSearchWithFallback (Z-AI → Ollama).
  // This gives us 4x the resilience against API outages.
  const { searchWithFallback } = await import("../search/search-provider");
  const query = `site:google.com/maps "${category}" "${city}"`;
  const searchResult = await searchWithFallback(query, { num: maxResults });
  const searchResults = searchResult.results;

  const results: any[] = searchResults;
  if (!Array.isArray(results) || results.length === 0) return [];

  const businesses: GoogleMapsBusiness[] = [];
  for (const r of results.slice(0, maxResults)) {
    const b = parseGoogleMapsResult(r, category, city);
    if (b) businesses.push(b);
  }
  return businesses;
}

/**
 * Parse a Google Maps search result into a GoogleMapsBusiness.
 * The result has: title, url, snippet, date.
 *
 * Title format on Google Maps: "Business Name · Category · City"
 * Snippet format: "Rating stars · Review count · Address · Phone"
 */
function parseGoogleMapsResult(
  result: any,
  category: string,
  city: string,
): GoogleMapsBusiness | null {
  const title: string = result?.title ?? "";
  const url: string = result?.url ?? result?.link ?? "";
  const snippet: string = result?.snippet ?? result?.description ?? "";

  // Title is usually "Business Name - Category - City" or similar.
  // Extract the first part as the business name.
  const businessName = title.split(/\s*[·\-–|]\s*/)[0]?.trim() ?? title;
  if (!businessName) return null;

  // Extract phone from snippet (international or Indian format).
  const phoneMatch = snippet.match(/\+?[\d\s\-()]{10,}/);
  const phone = phoneMatch ? phoneMatch[0].trim() : null;

  // Extract rating (e.g. "4.5 stars" or "4.5").
  const ratingMatch = snippet.match(/(\d\.\d)\s*(?:stars?|★)?/i);
  const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;

  // Extract review count (e.g. "(123 reviews)" or "123 reviews").
  const reviewMatch = snippet.match(/(\d+)\s*reviews?/i);
  const reviewCount = reviewMatch ? parseInt(reviewMatch[1], 10) : 0;

  // Try to extract the place ID from the URL.
  const placeIdMatch = url.match(/place_id[:=]([A-Za-z0-9_-]+)/);
  const googlePlaceId = placeIdMatch?.[1] ?? null;

  // Extract address from snippet (best-effort).
  const address = snippet.split("·").pop()?.trim() ?? "";

  // Look for a website link in the snippet (if mentioned).
  const websiteMatch = snippet.match(/https?:\/\/(?!google\.com|maps\.app)[^\s)]+/i);
  const website = websiteMatch ? websiteMatch[0] : null; // null = no website = target!

  return {
    businessName: businessName.slice(0, 200),
    address,
    city,
    region: "",
    country: "India",
    latitude: 0,
    longitude: 0,
    phone,
    website,
    googleMapsUrl: url,
    googlePlaceId,
    category,
    rating,
    reviewCount,
  };
}

/**
 * Infer the best-matched ARIA service category from the Google Maps category.
 * Restaurants → landing-page (need a menu page).
 * Salons / spas / gyms → landing-page (need a booking page).
 * Plumbers / electricians / car repair → landing-page (need a contact page).
 * Dentists / lawyers / CAs → saas-scaffold (could use online booking SaaS).
 * Photographers / interior designers / boutiques → 3d (visual showcase).
 */
function inferServiceCategory(googleMapsCategory: string): string {
  const c = googleMapsCategory.toLowerCase();
  if (/photographer|interior|boutique|bakery|cafe/.test(c)) return "3d-website";
  if (/dentist|lawyer|chartered|tutor|fitness/.test(c)) return "saas-scaffold";
  return "landing-page"; // default
}

/**
 * Promote a GoogleMapsBusiness to the Lead table for qualification.
 * Called by the daily-proactive-promo cron for high-confidence targets.
 */
export async function promoteToLead(businessId: string): Promise<string | null> {
  const business = await db.googleMapsBusiness.findUnique({ where: { id: businessId } });
  if (!business) return null;

  // Don't re-promote.
  if (business.leadId) return business.leadId;

  const lead = await db.lead.create({
    data: {
      source: "google-maps-no-website",
      platform: "google-maps",
      username: business.businessName,
      displayName: business.businessName,
      profileUrl: business.googleMapsUrl,
      postContent: `Business: ${business.businessName} (${business.category}) in ${business.city}. No website found on Google Maps. Phone: ${business.phone ?? "unknown"}.`,
      postUrl: business.googleMapsUrl,
      postedAt: business.discoveredAt,
      likes: business.reviewCount,
      replies: 0,
      reposts: 0,
      followerCount: 0,
      accountAgeDays: 0,
      topMatchedService: business.matchedServiceCategory,
      qualificationVerdict: "pending",
      qualificationScore: 0,
    },
  });

  await db.googleMapsBusiness.update({
    where: { id: businessId },
    data: { leadId: lead.id },
  });

  return lead.id;
}
