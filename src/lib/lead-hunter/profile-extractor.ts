/**
 * src/lib/lead-hunter/profile-extractor.ts — v71 Phase 21 (Autonomous Lead Hunter)
 *
 * Extracts a LeadBrandProfile from a social-media lead's profile (avatar,
 * banner, bio, recent posts). This solves the "no website" problem —
 * many social-first leads (especially on Twitter/LinkedIn) don't have
 * a website, so the existing brand-extractor.ts (which requires a URL)
 * cannot help them.
 *
 * Flow:
 *   1. Fetch the lead's profile page HTML via Z-AI page_reader.
 *   2. Extract og:image (avatar/banner), bio, recent posts.
 *   3. Use Z-AI vision model (glm-4.6v) to analyze the avatar + banner:
 *        - Primary + secondary brand colors (hex)
 *        - Brand tone (professional / playful / luxury / minimalist)
 *        - Industry / niche
 *   4. If vision model fails, fall back to text-only analysis of bio +
 *      recent posts.
 *   5. Return a LeadBrandProfile compatible with preview-generator.ts.
 */

import "server-only";
import { logger } from "../logger";
import type { DiscoveredLead } from "./social-scout";

// ─── Types ────────────────────────────────────────────────────────────

export interface LeadBrandProfile {
  primaryColor: string | null;       // hex e.g. "#2563eb"
  secondaryColor: string | null;    // hex
  accentColor: string | null;       // hex
  logoUrl: string | null;           // avatar URL
  faviconUrl: string | null;        // usually same as avatar for social
  typography: string | null;        // inferred from tone
  brandTone: "professional" | "playful" | "luxury" | "minimalist" | "friendly" | null;
  industry: string | null;          // inferred from bio + posts
  description: string | null;       // VLM-generated description
  source: "social-profile";        // always social-profile (vs. "website")
  domain: string;                  // platform handle e.g. "twitter.com/@username"
  websiteUrl: string;              // profile URL
  extractedAt: string;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Extract a LeadBrandProfile from a social-media lead's profile.
 * Falls back to text-only analysis if the vision model is unavailable.
 */
export async function extractFromSocialProfile(
  lead: DiscoveredLead,
): Promise<LeadBrandProfile | null> {
  const profileUrl = lead.profileUrl;
  if (!profileUrl) {
    logger.warn("profile-extractor.no-profile-url", { lead: lead.username });
    return null;
  }

  logger.info("profile-extractor.start", {
    platform: lead.platform,
    username: lead.username,
    profileUrl,
  });

  try {
    // v78 Phase 28: Use unified pageReaderWithFallback.
    const { pageReaderWithFallback } = await import("../utils/page-reader-fallback");
    const pageData = await pageReaderWithFallback(profileUrl);
    const html: string = pageData?.html || "";
    const title: string = pageData?.title || "";
    const text: string = pageData?.text || "";

    if (!html && !text) {
      logger.warn("profile-extractor.fetch-failed", { profileUrl });
      // Fall back to a minimal profile from the lead's postContent.
      return textOnlyProfile(lead, title || lead.displayName, lead.postContent);
    }

    // Step 2: Extract og:image (avatar/banner) + bio.
    const ogImage = extractMetaTag(html, "og:image") ?? extractMetaTag(html, "twitter:image");
    const bio = extractMetaTag(html, "description") ?? text.slice(0, 500);
    const industry = inferIndustryFromText(`${title} ${bio} ${lead.postContent}`);

    // Step 3: Use the vision model to analyze the profile image (if available).
    let brandTone: LeadBrandProfile["brandTone"] = null;
    let primaryColor: string | null = null;
    let secondaryColor: string | null = null;
    let accentColor: string | null = null;
    let typography: string | null = null;
    let vlmDescription: string | null = null;

    if (ogImage) {
      try {
        const vlmResult = await analyzeProfileImageWithVlm(ogImage, lead, bio);
        if (vlmResult) {
          brandTone = vlmResult.brandTone;
          primaryColor = vlmResult.primaryColor;
          secondaryColor = vlmResult.secondaryColor;
          accentColor = vlmResult.accentColor;
          typography = vlmResult.typography;
          vlmDescription = vlmResult.description;
        }
      } catch (vlmErr) {
        logger.warn("profile-extractor.vlm-failed", {
          error: String(vlmErr).slice(0, 80),
          hint: "Falling back to text-only tone inference",
        });
      }
    }

    // Step 4: If vision model didn't return a tone, fall back to text-based inference.
    if (!brandTone) {
      brandTone = inferToneFromText(`${bio} ${lead.postContent}`);
    }
    if (!primaryColor) {
      // Fallback: pick a default color based on the tone.
      primaryColor = defaultColorForTone(brandTone);
      secondaryColor = defaultSecondaryColorForTone(brandTone);
      accentColor = primaryColor;
    }

    const profile: LeadBrandProfile = {
      primaryColor,
      secondaryColor,
      accentColor,
      logoUrl: ogImage,
      faviconUrl: ogImage,
      typography: typography ?? defaultTypographyForTone(brandTone),
      brandTone,
      industry,
      description: vlmDescription ?? `${lead.displayName} on ${lead.platform}: ${bio.slice(0, 100)}`,
      source: "social-profile",
      domain: `${lead.platform}.com/${lead.username ? "@" + lead.username : lead.displayName}`,
      websiteUrl: profileUrl,
      extractedAt: new Date().toISOString(),
    };

    logger.info("profile-extractor.complete", {
      username: lead.username,
      tone: brandTone,
      primaryColor,
      industry,
      hasAvatar: !!ogImage,
    });

    return profile;
  } catch (err) {
    logger.warn("profile-extractor.error", {
      error: String(err).slice(0, 100),
      profileUrl,
    });
    return null;
  }
}

// ─── VLM analysis ────────────────────────────────────────────────────

async function analyzeProfileImageWithVlm(
  imageUrl: string,
  lead: DiscoveredLead,
  bio: string,
): Promise<{
  brandTone: LeadBrandProfile["brandTone"];
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  typography: string | null;
  description: string | null;
} | null> {
  const ZAI = (await import("z-ai-web-dev-sdk")).default;
  const zai = await ZAI.create();

  const prompt = `Analyze this social media profile image from ${lead.platform} user @${lead.username} (bio: ${bio.slice(0, 150)}). Extract: (1) primary brand color (hex), (2) secondary brand color (hex), (3) accent color (hex), (4) typography style (e.g. "modern sans-serif", "classic serif"), (5) brand tone (one of: professional, playful, luxury, minimalist, friendly), (6) one-sentence description of the brand aesthetic. Respond in format: COLOR:#hex | SECONDARY:#hex | ACCENT:#hex | TYPOGRAPHY:description | TONE:one-word | DESCRIPTION:sentence`;

  const response = await zai.chat.completions.create({
    model: "glm-4.6v",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  } as any);

  const result = response.choices[0]?.message?.content ?? "";

  const colorMatch = result.match(/COLOR:\s*(#?[0-9a-fA-F]{6})/);
  const secondaryMatch = result.match(/SECONDARY:\s*(#?[0-9a-fA-F]{6})/);
  const accentMatch = result.match(/ACCENT:\s*(#?[0-9a-fA-F]{6})/);
  const typoMatch = result.match(/TYPOGRAPHY:\s*([^|]+)/);
  const toneMatch = result.match(/TONE:\s*(professional|playful|luxury|minimalist|friendly)/i);
  const descMatch = result.match(/DESCRIPTION:\s*([^|]+)/);

  const tone = (toneMatch?.[1]?.toLowerCase() ?? null) as LeadBrandProfile["brandTone"];

  return {
    brandTone: tone,
    primaryColor: colorMatch ? normalizeHex(colorMatch[1]) : null,
    secondaryColor: secondaryMatch ? normalizeHex(secondaryMatch[1]) : null,
    accentColor: accentMatch ? normalizeHex(accentMatch[1]) : null,
    typography: typoMatch ? typoMatch[1].trim() : null,
    description: descMatch ? descMatch[1].trim() : null,
  };
}

// ─── Text-only fallback ──────────────────────────────────────────────

function textOnlyProfile(lead: DiscoveredLead, title: string, postContent: string): LeadBrandProfile {
  const tone = inferToneFromText(postContent);
  const industry = inferIndustryFromText(`${title} ${postContent}`);
  return {
    primaryColor: defaultColorForTone(tone),
    secondaryColor: defaultSecondaryColorForTone(tone),
    accentColor: defaultColorForTone(tone),
    logoUrl: null,
    faviconUrl: null,
    typography: defaultTypographyForTone(tone),
    brandTone: tone,
    industry,
    description: `${lead.displayName} on ${lead.platform} (text-only fallback). Bio: ${postContent.slice(0, 100)}`,
    source: "social-profile",
    domain: `${lead.platform}.com/${lead.username}`,
    websiteUrl: lead.profileUrl,
    extractedAt: new Date().toISOString(),
  };
}

// ─── HTML parsing helpers ────────────────────────────────────────────

function extractMetaTag(html: string, property: string): string | null {
  // Try both property="..." and name="..." attributes.
  const patterns = [
    new RegExp(`<meta[^>]+property=["'](?:og:)?${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property=["'](?:og:)?${property}["']|name=["']${property}["'])`, "i"),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

// ─── Tone / industry inference from text ─────────────────────────────

function inferToneFromText(text: string): LeadBrandProfile["brandTone"] {
  const lower = text.toLowerCase();
  if (/luxury|premium|elegant|exclusive|boutique/i.test(lower)) return "luxury";
  if (/playful|fun|casual|emoji|😎|🎉|lol/i.test(lower)) return "playful";
  if (/minimal|clean|simple|minimalist|less is more/i.test(lower)) return "minimalist";
  if (/friendly|warm|community|hey there|hi y'all/i.test(lower)) return "friendly";
  return "professional"; // default
}

function inferIndustryFromText(text: string): string | null {
  const lower = text.toLowerCase();
  const industries: Record<string, RegExp> = {
    "SaaS / B2B": /saas|b2b|enterprise|startup|product|platform/i,
    "E-commerce": /shop|store|ecommerce|product|buy|cart/i,
    "Marketing / Agency": /agency|marketing|seo|content|brand/i,
    "Finance / Fintech": /fintech|finance|banking|invest|crypto|trading/i,
    "Healthcare": /health|medical|clinic|patient|doctor/i,
    "Education": /education|course|learn|teach|student|school/i,
    "Real Estate": /real estate|property|realtor|housing/i,
    "Food / Restaurant": /restaurant|food|recipe|chef|menu/i,
    "Travel": /travel|tourism|hotel|vacation|trip/i,
    "Tech / AI": /ai|machine learning|ml|data|engineer|developer|code/i,
  };
  for (const [industry, pattern] of Object.entries(industries)) {
    if (pattern.test(lower)) return industry;
  }
  return null;
}

function normalizeHex(hex: string): string {
  let h = hex.trim();
  if (!h.startsWith("#")) h = "#" + h;
  return h.toLowerCase();
}

function defaultColorForTone(tone: LeadBrandProfile["brandTone"]): string {
  switch (tone) {
    case "playful": return "#f59e0b";     // amber-500
    case "luxury": return "#1a1a1a";      // near-black
    case "minimalist": return "#000000";  // pure black
    case "friendly": return "#3b82f6";    // blue-500
    default: return "#2563eb";            // blue-600 (professional)
  }
}

function defaultSecondaryColorForTone(tone: LeadBrandProfile["brandTone"]): string {
  switch (tone) {
    case "playful": return "#ef4444";     // red-500
    case "luxury": return "#d4af37";      // gold
    case "minimalist": return "#ffffff";  // white
    case "friendly": return "#10b981";    // emerald-500
    default: return "#1e40af";            // blue-800
  }
}

function defaultTypographyForTone(tone: LeadBrandProfile["brandTone"]): string {
  switch (tone) {
    case "luxury": return "Classic serif (Playfair Display)";
    case "minimalist": return "Light sans-serif (Inter Light)";
    case "playful": return "Rounded sans-serif (Nunito)";
    case "friendly": return "Humanist sans-serif (Source Sans Pro)";
    default: return "Modern sans-serif (Inter)";
  }
}
