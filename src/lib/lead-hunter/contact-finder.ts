/**
 * src/lib/lead-hunter/contact-finder.ts — v72 Phase 22 (RULE-70)
 *
 * Given a company name (or individual name + domain), find their email +
 * phone + social handles via Z-AI web search.
 *
 * Useful for:
 *   - Looking up contact details for a Google Maps business (often only
 *     phone is listed — email is buried on their Facebook page or in
 *     a directory listing).
 *   - Finding the founder of a target company on LinkedIn.
 *   - Discovering the support@ / info@ / hello@ email pattern for a domain.
 *
 * Returns structured ContactDetails with a confidence score (0-100)
 * indicating how reliable the discovered contact info is.
 */

import "server-only";
import { logger } from "../logger";

// ─── Types ────────────────────────────────────────────────────────────

export interface ContactDetails {
  company: string;
  emails: string[]; // ranked by confidence
  phones: string[];
  socialHandles: Array<{ platform: string; handle: string; url: string }>;
  websites: string[];
  confidence: number; // 0-100
  sources: string[]; // URLs where the info was found
  discoveredAt: string;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Find contact details for a company or individual.
 *
 * @param query The company name or "Founder Name + Company" (e.g. "Acme Corp" or "Jane Doe Acme Corp").
 * @param domain Optional domain hint (e.g. "acme.com") — improves email pattern detection.
 */
export async function findContactDetails(
  query: string,
  domain?: string,
): Promise<ContactDetails | null> {
  logger.info("contact-finder.start", { query, domain });

  try {
    // v78 Phase 28: Use unified webSearchWithFallback for all 3 searches.
    const { webSearchWithFallback } = await import("../utils/web-search-fallback");

    // ─── Search 1: company contact info ───
    const contactQuery = `"${query}" contact email phone OR "contact us"`;
    const contactResults = await webSearchWithFallback(contactQuery, 10);

    // ─── Search 2: LinkedIn founder / key people ───
    const linkedinQuery = `site:linkedin.com "${query}" founder OR CEO OR "managing director"`;
    const linkedinResults = await webSearchWithFallback(linkedinQuery, 5);

    // ─── Search 3: social handles (Instagram, Facebook, X) ───
    const socialQuery = `site:instagram.com OR site:facebook.com OR site:x.com "${query}"`;
    const socialResults = await webSearchWithFallback(socialQuery, 10);

    // Extract emails + phones from the contact results.
    const emails = new Set<string>();
    const phones = new Set<string>();
    const sources: string[] = [];
    const websites = new Set<string>();

    for (const r of contactResults) {
      const text = `${r?.title ?? ""} ${r?.snippet ?? ""} ${r?.url ?? ""}`;
      // Email regex — tolerates common variations.
      const emailMatches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
      if (emailMatches) for (const e of emailMatches) emails.add(e.toLowerCase());

      // Phone regex — international + Indian formats.
      const phoneMatches = text.match(/\+?\d[\d\s\-()]{8,}/g);
      if (phoneMatches) {
        for (const p of phoneMatches) {
          const clean = p.replace(/[\s\-()]/g, "");
          if (clean.length >= 10 && clean.length <= 15) phones.add(p.trim());
        }
      }

      if (r?.url) {
        sources.push(r.url);
        // Extract domain for the websites list.
        try {
          const url = new URL(r.url);
          if (!url.hostname.includes("google.com")) {
            websites.add(`${url.protocol}//${url.hostname}`);
          }
        } catch {}
      }
    }

    // Extract social handles from the social search results.
    const socialHandles: Array<{ platform: string; handle: string; url: string }> = [];
    for (const r of socialResults) {
      const url: string = r?.url ?? "";
      let platform = "";
      let handle = "";
      if (url.includes("instagram.com")) {
        platform = "instagram";
        handle = url.match(/instagram\.com\/([^/?]+)/)?.[1] ?? "";
      } else if (url.includes("facebook.com")) {
        platform = "facebook";
        handle = url.match(/facebook\.com\/([^/?]+)/)?.[1] ?? "";
      } else if (url.includes("x.com") || url.includes("twitter.com")) {
        platform = "x";
        handle = url.match(/(?:x|twitter)\.com\/([^/?]+)/)?.[1] ?? "";
      } else if (url.includes("linkedin.com")) {
        platform = "linkedin";
        handle = url.match(/linkedin\.com\/(?:in|company)\/([^/?]+)/)?.[1] ?? "";
      }
      if (platform && handle) {
        socialHandles.push({ platform, handle: handle.replace(/^@/, ""), url });
      }
    }

    // Extract LinkedIn people from the linkedin search results.
    for (const r of linkedinResults) {
      const url: string = r?.url ?? "";
      const handle = url.match(/linkedin\.com\/(?:in|company)\/([^/?]+)/)?.[1];
      if (handle) {
        socialHandles.push({ platform: "linkedin", handle, url });
      }
    }

    // ─── Domain-based email pattern inference ───
    // If the owner provided a domain, try common email patterns.
    if (domain) {
      const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
      const commonPrefixes = ["info", "contact", "hello", "support", "admin", "sales", "team"];
      for (const prefix of commonPrefixes) {
        emails.add(`${prefix}@${cleanDomain}`);
      }
    }

    // ─── Confidence score ───
    let confidence = 0;
    if (emails.size > 0) confidence += 30;
    if (phones.size > 0) confidence += 30;
    if (socialHandles.length > 0) confidence += 20;
    if (websites.size > 0) confidence += 10;
    if (sources.length >= 3) confidence += 10;
    confidence = Math.min(100, confidence);

    if (emails.size === 0 && phones.size === 0 && socialHandles.length === 0) {
      logger.info("contact-finder.empty", { query });
      return null;
    }

    const details: ContactDetails = {
      company: query,
      emails: [...emails].slice(0, 10),
      phones: [...phones].slice(0, 5),
      socialHandles: socialHandles.slice(0, 10),
      websites: [...websites].slice(0, 5),
      confidence,
      sources: sources.slice(0, 10),
      discoveredAt: new Date().toISOString(),
    };

    logger.info("contact-finder.complete", {
      query,
      emails: details.emails.length,
      phones: details.phones.length,
      social: details.socialHandles.length,
      confidence,
    });

    return details;
  } catch (err) {
    logger.warn("contact-finder.error", { query, error: String(err).slice(0, 100) });
    return null;
  }
}
