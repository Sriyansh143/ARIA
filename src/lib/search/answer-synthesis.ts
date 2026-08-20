/**
 * src/lib/search/answer-synthesis.ts — Phase 32 Feature #5
 *
 * Inline answer synthesis with citations (Perplexity gap).
 *
 * A unified `searchAndSynthesize(query)` primitive that:
 *   1. Runs the 4-provider search (Tavily → Serper → Z-AI → DuckDuckGo)
 *   2. Runs an LLM call with the search results as context
 *   3. Returns a synthesized answer with inline [1], [2] citations linked
 *      to the source URLs — all in one call
 *
 * VS PERPLEXITY
 * -------------
 * Perplexity returns raw answers with citations in one call. Aria's current
 * search returns raw SearchResult[] + the caller does a SEPARATE LLM call
 * to synthesize. This means: (a) 2x latency, (b) no citation linking,
 * (c) the synthesis LLM doesn't see provider metadata.
 *
 * This module closes that gap with a single `searchAndSynthesize()` call.
 *
 * USAGE
 * -----
 *   const result = await searchAndSynthesize("best AI website builders 2026");
 *   // result.answer = "The top AI website builders include Wix ADI [1],
 *   //   Framer [2], and Durable [3]..."
 *   // result.citations = [
 *   //   { number: 1, url: "https://wix.com", title: "Wix ADI" },
 *   //   { number: 2, url: "https://framer.com", title: "Framer" },
 *   //   ...
 *   // ]
 */

import "server-only";
import { logger } from "@/lib/logger";
import { searchWithFallback, type SearchResult } from "./search-provider";

// ─── Types ───────────────────────────────────────────────────────────

export interface Citation {
  number: number; // [1], [2], [3]
  url: string;
  title: string;
  snippet: string;
  source: string; // provider name
}

export interface SynthesisResult {
  ok: boolean;
  query: string;
  answer: string; // synthesized answer with inline [1], [2] citations
  citations: Citation[]; // ordered list of cited sources
  provider: string; // which search provider returned the results
  latencyMs: number;
  error?: string;
}

// ─── Public: searchAndSynthesize ─────────────────────────────────────

/**
 * Search + synthesize in one call. The LLM receives the search results as
 * context + is instructed to cite sources using [1], [2], [3] notation.
 */
export async function searchAndSynthesize(
  query: string,
  opts?: {
    numResults?: number;
    systemPrompt?: string;
  },
): Promise<SynthesisResult> {
  const startTime = Date.now();
  const num = opts?.numResults ?? 5;

  // 1. Run the 4-provider search
  const searchResult = await searchWithFallback(query, { num });
  const results = searchResult.results;

  if (results.length === 0) {
    return {
      ok: false,
      query,
      answer: "",
      citations: [],
      provider: searchResult.provider,
      latencyMs: Date.now() - startTime,
      error: "No search results found",
    };
  }

  // 2. Build the citation map
  const citations: Citation[] = results.map((r, i) => ({
    number: i + 1,
    url: r.url,
    title: r.title,
    snippet: r.snippet,
    source: r.source ?? searchResult.provider,
  }));

  // 3. Build the LLM prompt with search results as context
  const contextBlock = results
    .map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`)
    .join("\n\n");

  const defaultSystemPrompt =
    `You are ARIA's research synthesis engine. Given a query and search results, ` +
    `synthesize a comprehensive answer with inline citations using [1], [2], [3] notation. ` +
    `Each citation number maps to the numbered source below. Be concise but thorough. ` +
    `Always cite your sources. If the results don't fully answer the query, say so.\n\n` +
    `Sources:\n${contextBlock}`;

  // 4. Call the LLM (with constitution injected via callLLM)
  try {
    const { callLLM } = await import("../llm-client");
    const llmResult = await callLLM("AnswerSynthesis", "Research", query, {
      systemOverride: opts?.systemPrompt ?? defaultSystemPrompt,
    });

    if (!llmResult.success) {
      return {
        ok: false,
        query,
        answer: "",
        citations,
        provider: searchResult.provider,
        latencyMs: Date.now() - startTime,
        error: llmResult.error ?? "LLM synthesis failed",
      };
    }

    return {
      ok: true,
      query,
      answer: llmResult.completion,
      citations,
      provider: searchResult.provider,
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    logger.warn("answer-synthesis.llm-failed", { error: String(err) });
    return {
      ok: false,
      query,
      answer: "",
      citations,
      provider: searchResult.provider,
      latencyMs: Date.now() - startTime,
      error: String(err),
    };
  }
}

// ─── Public: formatSynthesisForDisplay ──────────────────────────────

/**
 * Format a SynthesisResult for display in the dashboard or Telegram.
 * Converts [1], [2] citations to markdown links.
 */
export function formatSynthesisForDisplay(result: SynthesisResult): string {
  if (!result.ok) {
    return `❌ Synthesis failed: ${result.error}`;
  }

  let formatted = result.answer;

  // Replace [1], [2], etc. with markdown links
  for (const citation of result.citations) {
    const pattern = new RegExp(`\\[${citation.number}\\]`, "g");
    formatted = formatted.replace(pattern, `[[${citation.number}](${citation.url})]`);
  }

  // Append the sources list at the end
  formatted += "\n\n**Sources:**\n";
  for (const c of result.citations) {
    formatted += `${c.number}. [${c.title}](${c.url}) (${c.source})\n`;
  }

  return formatted;
}
