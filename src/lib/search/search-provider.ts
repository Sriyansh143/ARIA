/**
 * src/lib/search/search-provider.ts — Phase 31
 *
 * Multi-provider search abstraction with intelligent fallback chain.
 *
 * PROVIDER CHAIN (in priority order):
 *   1. Tavily (TAVILY_API_KEY) — AI-optimized search, returns clean snippets.
 *      Best for: research, competitor analysis, earning methods.
 *   2. Serper (SERPER_API_KEY) — Google SERP API, fast + accurate.
 *      Best for: lead generation, Google Maps discovery.
 *   3. Z-AI (existing wrapper) — internal-api.z.ai/v1, already wired.
 *      Best for: when both Tavily + Serper are unavailable.
 *   4. DuckDuckGo HTML scraping (no API key required) — last-resort fallback.
 *      Best for: zero-cost searches, never fails (unless DDG is down).
 *
 * DESIGN NOTES
 * ------------
 * - Each provider implements the same `SearchProvider` interface.
 * - The `searchWithFallback()` function tries each provider in order until
 *   one returns results. Failures are logged but do not abort the chain.
 * - The active provider is recorded in the result so the caller knows
 *   which path was taken (useful for debugging + cost analysis).
 * - All results are normalized to a common `SearchResult` shape so callers
 *   don't need to handle provider-specific JSON.
 *
 * VS Z-AI SDK
 * -----------
 * The existing `webSearchWithFallback` (in src/lib/utils/web-search-fallback.ts)
 * only falls back to Ollama synthetic results + Telegram alert. It does NOT
 * try other real search providers. This new module adds REAL provider
 * fallbacks so the app continues returning fresh data even if Z-AI is down.
 */

import "server-only";
import { logger } from "@/lib/logger";

// ─── Types ───────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string; // provider name that returned this result
  rank?: number;
}

export interface SearchProvider {
  readonly name: string;
  isAvailable(): boolean;
  search(query: string, num: number): Promise<SearchResult[]>;
}

export interface SearchOptions {
  num?: number;
  skipZAI?: boolean;
  skipDDG?: boolean;
}

// ─── Provider 1: Tavily ─────────────────────────────────────────────

class TavilyProvider implements SearchProvider {
  readonly name = "tavily";

  isAvailable(): boolean {
    return !!process.env.TAVILY_API_KEY;
  }

  async search(query: string, num: number): Promise<SearchResult[]> {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) return [];

    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: num,
          include_answer: false,
          include_raw_content: false,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        logger.warn("search.tavily.http-error", { status: res.status, query: query.slice(0, 80) });
        return [];
      }

      const data = (await res.json()) as { results?: Array<{ title: string; url: string; content: string }> };
      if (!data.results) return [];

      return data.results.map((r, i) => ({
        title: r.title,
        url: r.url,
        snippet: r.content?.slice(0, 300) ?? "",
        source: "tavily",
        rank: i,
      }));
    } catch (err) {
      logger.warn("search.tavily.failed", { error: String(err), query: query.slice(0, 80) });
      return [];
    }
  }
}

// ─── Provider 2: Serper ─────────────────────────────────────────────

class SerperProvider implements SearchProvider {
  readonly name = "serper";

  isAvailable(): boolean {
    return !!process.env.SERPER_API_KEY;
  }

  async search(query: string, num: number): Promise<SearchResult[]> {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) return [];

    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify({ q: query, num }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        logger.warn("search.serper.http-error", { status: res.status, query: query.slice(0, 80) });
        return [];
      }

      const data = (await res.json()) as {
        organic?: Array<{ title: string; link: string; snippet: string; position?: number }>;
      };
      if (!data.organic) return [];

      return data.organic.map((r) => ({
        title: r.title,
        url: r.link,
        snippet: r.snippet ?? "",
        source: "serper",
        rank: r.position ?? 0,
      }));
    } catch (err) {
      logger.warn("search.serper.failed", { error: String(err), query: query.slice(0, 80) });
      return [];
    }
  }
}

// ─── Provider 3: Z-AI (via existing wrapper) ────────────────────────

class ZaiProvider implements SearchProvider {
  readonly name = "zai";

  isAvailable(): boolean {
    return true; // wrapper handles failures internally
  }

  async search(query: string, num: number): Promise<SearchResult[]> {
    try {
      const { webSearchWithFallback } = await import("../utils/web-search-fallback");
      const results = await webSearchWithFallback(query, num);
      // The wrapper's SearchResult has {title, url, snippet} only.
      // Our SearchResult adds {source, rank}. Map accordingly.
      return results.map((r, i) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        source: "zai",
        rank: i,
      }));
    } catch (err) {
      logger.warn("search.zai.failed", { error: String(err), query: query.slice(0, 80) });
      return [];
    }
  }
}

// ─── Provider 4: DuckDuckGo HTML scraping (last resort) ─────────────

class DuckDuckGoProvider implements SearchProvider {
  readonly name = "duckduckgo";

  isAvailable(): boolean {
    return true; // no API key required
  }

  async search(query: string, num: number): Promise<SearchResult[]> {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "ARIA-Mission-Control/1.0 (research bot; +https://aria.local)",
          "Accept": "text/html",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        logger.warn("search.duckduckgo.http-error", { status: res.status, query: query.slice(0, 80) });
        return [];
      }

      const html = await res.text();
      return this.parseDDGHtml(html, num);
    } catch (err) {
      logger.warn("search.duckduckgo.failed", { error: String(err), query: query.slice(0, 80) });
      return [];
    }
  }

  private parseDDGHtml(html: string, max: number): SearchResult[] {
    const results: SearchResult[] = [];
    const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

    const links: Array<{ url: string; title: string }> = [];
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(html)) !== null) {
      const rawUrl = match[1];
      const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
      const url = uddgMatch ? decodeURIComponent(uddgMatch[1]) : rawUrl;
      links.push({ url, title: this.stripHtml(match[2]) });
    }

    const snippets: string[] = [];
    while ((match = snippetRegex.exec(html)) !== null) {
      snippets.push(this.stripHtml(match[1]));
    }

    for (let i = 0; i < Math.min(links.length, max); i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] ?? "",
        source: "duckduckgo",
        rank: i,
      });
    }

    return results;
  }

  private stripHtml(s: string): string {
    return s
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }
}

// ─── Provider Registry ──────────────────────────────────────────────

let tavilyProvider: TavilyProvider | null = null;
let serperProvider: SerperProvider | null = null;
let zaiProvider: ZaiProvider | null = null;
let ddgProvider: DuckDuckGoProvider | null = null;

function getProviders(opts?: SearchOptions): SearchProvider[] {
  const providers: SearchProvider[] = [];

  if (!tavilyProvider) tavilyProvider = new TavilyProvider();
  if (!serperProvider) serperProvider = new SerperProvider();
  if (!zaiProvider) zaiProvider = new ZaiProvider();
  if (!ddgProvider) ddgProvider = new DuckDuckGoProvider();

  if (tavilyProvider.isAvailable()) providers.push(tavilyProvider);
  if (serperProvider.isAvailable()) providers.push(serperProvider);
  if (!opts?.skipZAI) providers.push(zaiProvider);
  if (!opts?.skipDDG) providers.push(ddgProvider);

  return providers;
}

// ─── Public: searchWithFallback ─────────────────────────────────────

export async function searchWithFallback(
  query: string,
  opts?: SearchOptions,
): Promise<{ results: SearchResult[]; provider: string }> {
  const num = opts?.num ?? 5;
  const providers = getProviders(opts);

  if (providers.length === 0) {
    logger.warn("search.no-providers", { query: query.slice(0, 80) });
    return { results: [], provider: "none" };
  }

  for (const provider of providers) {
    try {
      const results = await provider.search(query, num);
      if (results.length > 0) {
        logger.info("search.success", {
          provider: provider.name,
          query: query.slice(0, 80),
          count: results.length,
        });
        return { results, provider: provider.name };
      }
    } catch (err) {
      logger.warn("search.provider-threw", {
        provider: provider.name,
        error: String(err),
        query: query.slice(0, 80),
      });
    }
  }

  logger.warn("search.all-providers-empty", {
    query: query.slice(0, 80),
    providersTried: providers.map((p) => p.name).join(","),
  });

  // ─── Phase 32 Fix G1: Trigger Debate + Owner Escalation when ALL 4 providers fail.
  // The owner's mandate: "App should follow debate and owner approach when no clear
  // info or confusion." This was wired into the 2-provider webSearchWithFallback
  // but missing from the 4-provider searchWithFallback that the scouts now use.
  // Without this, scouts silently degrade when all of Tavily/Serper/Z-AI/DDG fail.
  try {
    const { escalateToolFailure } = await import("../tool-failure-escalation");
    await escalateToolFailure({
      tool: "web_search",
      error: `All ${providers.length} search providers exhausted (tried: ${providers.map((p) => p.name).join(", ")})`,
      module: "search-provider",
      context: `Query: "${query.slice(0, 100)}"`,
      attempts: providers.length,
      lastTriedAt: new Date(),
    });
  } catch (escalationErr) {
    // If the escalation itself fails, log + continue (don't crash the search).
    logger.warn("search-provider.escalation-failed", { error: String(escalationErr) });
  }

  return { results: [], provider: "exhausted" };
}

// ─── Public: searchAllProviders ─────────────────────────────────────

export async function searchAllProviders(
  query: string,
  num: number = 5,
): Promise<{ results: SearchResult[]; providers: string[] }> {
  const providers = getProviders();
  const allResults: SearchResult[] = [];
  const usedProviders: string[] = [];

  await Promise.all(
    providers.map(async (provider) => {
      try {
        const results = await provider.search(query, num);
        if (results.length > 0) {
          allResults.push(...results);
          usedProviders.push(provider.name);
        }
      } catch {
        // best-effort
      }
    }),
  );

  const seen = new Set<string>();
  const deduped = allResults.filter((r) => {
    const key = r.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { results: deduped, providers: usedProviders };
}

// ─── Public: getSearchProviderStatus ────────────────────────────────

export function getSearchProviderStatus(): Array<{
  name: string;
  available: boolean;
  configured: boolean;
}> {
  if (!tavilyProvider) tavilyProvider = new TavilyProvider();
  if (!serperProvider) serperProvider = new SerperProvider();
  if (!zaiProvider) zaiProvider = new ZaiProvider();
  if (!ddgProvider) ddgProvider = new DuckDuckGoProvider();

  return [
    { name: "tavily", available: tavilyProvider.isAvailable(), configured: tavilyProvider.isAvailable() },
    { name: "serper", available: serperProvider.isAvailable(), configured: serperProvider.isAvailable() },
    { name: "zai", available: zaiProvider.isAvailable(), configured: true },
    { name: "duckduckgo", available: ddgProvider.isAvailable(), configured: true },
  ];
}
