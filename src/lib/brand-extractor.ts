/**
 * src/lib/brand-extractor.ts — v65 Phase 15 (Personalized Brand Previews)
 *
 * RULE-52: SHOW, DON'T JUST TELL.
 *
 * Extracts brand assets (colors, logo, typography, tone) from a lead's
 * website using the Z-AI vision model (glm-4.6v). The extracted brand
 * profile is used to generate personalized service previews that dramatically
 * increase outreach conversion rates.
 *
 * Flow:
 *   1. Fetch the lead's website HTML (from their email domain)
 *   2. Extract meta tags (og:image, theme-color, etc.)
 *   3. Use Z-AI vision model to analyze a screenshot (if available)
 *   4. Return a LeadBrandProfile with colors, logo URL, typography, tone
 */

import "server-only";
import { logger } from "./logger";

export interface LeadBrandProfile {
  domain: string;
  websiteUrl: string;
  primaryColor: string | null;       // hex, e.g. "#2563eb"
  secondaryColor: string | null;     // hex
  accentColor: string | null;        // hex
  logoUrl: string | null;            // URL to the logo image
  faviconUrl: string | null;         // URL to the favicon
  typography: string | null;         // e.g. "Modern sans-serif"
  brandTone: string | null;          // e.g. "Professional", "Playful", "Luxury"
  description: string | null;        // VLM-generated description of the brand
  extractedAt: string;
}

/**
 * Extract brand assets from a lead's website.
 * @param emailOrDomain The lead's email address or domain (e.g. "acme.com")
 * @returns A LeadBrandProfile, or null if extraction fails.
 */
export async function extractBrandFromEmail(emailOrDomain: string): Promise<LeadBrandProfile | null> {
  // Extract domain from email or use as-is.
  const domain = emailOrDomain.includes("@")
    ? emailOrDomain.split("@")[1]
    : emailOrDomain;
  if (!domain || domain.length < 3) return null;

  const websiteUrl = `https://${domain}`;
  logger.info("brand-extractor.start", { domain, websiteUrl });

  try {
    // Step 1: Fetch the website HTML (with timeout).
    const html = await fetchText(websiteUrl, 10000);
    if (!html) {
      logger.warn("brand-extractor.fetch-failed", { websiteUrl });
      return null;
    }

    // Step 2: Extract brand assets from HTML meta tags + inline styles.
    const themeColor = extractMetaTag(html, "theme-color") ?? extractCssColor(html, "--primary") ?? extractCssColor(html, "--brand");
    const ogImage = extractMetaTag(html, "og:image");
    const faviconUrl = extractFavicon(html, domain);
    const title = extractMetaTag(html, "og:title") ?? extractTitle(html);
    const description = extractMetaTag(html, "og:description") ?? extractMetaTag(html, "description");

    // Step 3: Try to extract colors from the HTML (inline styles, CSS vars).
    const colors = extractColorsFromHtml(html);
    let primaryColor = themeColor ?? colors[0] ?? null;
    const secondaryColor = colors[1] ?? null;
    const accentColor = colors[2] ?? null;

    // Step 4: Use Z-AI vision model to analyze the website (if og:image exists).
    let brandTone: string | null = null;
    let typography: string | null = null;
    let vlmDescription: string | null = null;
    if (ogImage) {
      try {
        const vlmResult = await analyzeImageWithVlm(ogImage, `Analyze this brand image from ${domain}. Extract: (1) primary brand color (hex), (2) typography style (e.g. "modern sans-serif", "classic serif"), (3) brand tone (e.g. "professional", "playful", "luxury", "minimalist"). Respond in format: COLOR: #hex | TYPOGRAPHY: description | TONE: description`);
        if (vlmResult) {
          const colorMatch = vlmResult.match(/COLOR:\s*(#?[0-9a-fA-F]{6})/);
          const typoMatch = vlmResult.match(/TYPOGRAPHY:\s*([^|]+)/);
          const toneMatch = vlmResult.match(/TONE:\s*([^|]+)/);
          if (colorMatch && !primaryColor) {
            const hex = colorMatch[1].startsWith("#") ? colorMatch[1] : `#${colorMatch[1]}`;
            primaryColor = hex;
          }
          typography = typoMatch ? typoMatch[1].trim() : null;
          brandTone = toneMatch ? toneMatch[1].trim() : null;
          vlmDescription = vlmResult.slice(0, 500);
        }
      } catch (err) {
        logger.warn("brand-extractor.vlm-failed", { error: String(err).slice(0, 80) });
      }
    }

    const profile: LeadBrandProfile = {
      domain,
      websiteUrl,
      primaryColor,
      secondaryColor,
      accentColor,
      logoUrl: ogImage ?? null,
      faviconUrl,
      typography,
      brandTone,
      description: vlmDescription ?? description ?? title ?? null,
      extractedAt: new Date().toISOString(),
    };

    logger.info("brand-extractor.complete", {
      domain,
      primaryColor,
      hasLogo: !!profile.logoUrl,
      tone: brandTone,
    });

    return profile;
  } catch (err) {
    logger.warn("brand-extractor.error", { domain, error: String(err).slice(0, 100) });
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "ARIA-Bot/1.0 (+https://aria.ai)" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractMetaTag(html: string, name: string): string | null {
  // Try property="name" (og: tags) then name="name".
  const patterns = [
    new RegExp(`<meta[^>]*property=["']${name}["'][^>]*content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${name}["']`, "i"),
    new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${name}["']`, "i"),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : null;
}

function extractFavicon(html: string, domain: string): string | null {
  const patterns = [
    /<link[^>]*rel=["']icon["'][^>]*href=["']([^"']+)["']/i,
    /<link[^>]*rel=["]shortcut icon["'][^>]*href=["']([^"']+)["']/i,
    /<link[^>]*rel=["]apple-touch-icon["'][^>]*href=["']([^"']+)["']/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) {
      const href = m[1];
      if (href.startsWith("http")) return href;
      if (href.startsWith("//")) return `https:${href}`;
      if (href.startsWith("/")) return `https://${domain}${href}`;
      return `https://${domain}/${href}`;
    }
  }
  return `https://${domain}/favicon.ico`;
}

function extractCssColor(html: string, varName: string): string | null {
  const m = html.match(new RegExp(`${varName}\\s*:\\s*(#[0-9a-fA-F]{3,8})`, "i"));
  return m ? m[1] : null;
}

function extractColorsFromHtml(html: string): string[] {
  const colors: string[] = [];
  // Find all hex colors in the HTML.
  const matches = html.matchAll(/#([0-9a-fA-F]{6})\b/g);
  const seen = new Set<string>();
  for (const m of matches) {
    const hex = `#${m[1]}`;
    if (!seen.has(hex) && !isNeutralColor(hex)) {
      seen.add(hex);
      colors.push(hex);
    }
    if (colors.length >= 5) break;
  }
  return colors;
}

function isNeutralColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Skip near-white, near-black, and near-gray colors.
  if (r > 240 && g > 240 && b > 240) return true;
  if (r < 20 && g < 20 && b < 20) return true;
  if (Math.abs(r - g) < 15 && Math.abs(g - b) < 15 && Math.abs(r - b) < 15) return true;
  return false;
}

/**
 * Analyze an image with the Z-AI vision model (glm-4.6v).
 */
async function analyzeImageWithVlm(imageUrl: string, prompt: string): Promise<string | null> {
  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    // Use the ZAI SDK's vision capability. The content includes both text
    // and image_url in the message — the SDK forwards this to the vision model.
    const response = await zai.chat.completions.create({
      model: "glm-4.6v",
      messages: [
        {
          role: "user",
          content: `${prompt}\n\nImage URL: ${imageUrl}`,
        },
      ],
    } as any);
    return response.choices[0]?.message?.content ?? null;
  } catch (err) {
    logger.warn("brand-extractor.vlm-call-failed", { error: String(err).slice(0, 80) });
    return null;
  }
}
