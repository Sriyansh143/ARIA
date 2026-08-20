/**
 * scripts/probe-answer-synthesis.ts — Phase 32 Feature #5
 *
 * VISUAL PROOF of the inline answer synthesis with citations.
 * This is the Perplexity gap feature.
 */

import { mock } from "bun:test";
mock.module("server-only", () => ({}));

async function main() {
  console.log("=== ANSWER SYNTHESIS VISUAL PROOF (Perplexity Gap) ===");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log();

  const query = "best AI website builders 2026";
  console.log(`[1] Searching + synthesizing: "${query}"...`);
  console.log();

  const { searchAndSynthesize, formatSynthesisForDisplay } = await import("../src/lib/search/answer-synthesis");
  const result = await searchAndSynthesize(query, { numResults: 5 });

  console.log(`    ok: ${result.ok}`);
  console.log(`    provider: ${result.provider}`);
  console.log(`    latencyMs: ${result.latencyMs}`);
  console.log(`    citations: ${result.citations.length}`);
  console.log();

  if (result.ok) {
    console.log("[2] Synthesized Answer:");
    console.log("    ┌──────────────────────────────────────────────────────────┐");
    for (const line of result.answer.split("\n").slice(0, 10)) {
      console.log(`    │ ${line.slice(0, 100)}`);
    }
    console.log("    │ ...");
    console.log("    └──────────────────────────────────────────────────────────┘");
    console.log();

    console.log("[3] Citations:");
    for (const c of result.citations) {
      console.log(`    [${c.number}] ${c.title}`);
      console.log(`        URL: ${c.url}`);
      console.log(`        Source: ${c.source}`);
      console.log(`        Snippet: ${c.snippet.slice(0, 100)}...`);
      console.log();
    }

    console.log("[4] Formatted for display (markdown with links):");
    const formatted = formatSynthesisForDisplay(result);
    console.log("    ┌──────────────────────────────────────────────────────────┐");
    for (const line of formatted.split("\n").slice(0, 15)) {
      console.log(`    │ ${line.slice(0, 100)}`);
    }
    console.log("    └──────────────────────────────────────────────────────────┘");
  } else {
    console.log(`    ✗ Synthesis failed: ${result.error}`);
  }

  console.log();
  console.log("=== PROOF COMPLETE ===");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
