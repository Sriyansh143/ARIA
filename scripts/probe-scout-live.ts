/**
 * scripts/probe-scout-live.ts — Phase 32 Remediation (v2)
 *
 * Runs the ACTUAL google-maps-scout searchGoogleMapsForCategory function
 * to verify the result-parsing fix.
 */

// Mock server-only so we can import server-only modules in a script context
import { mock } from "bun:test";
mock.module("server-only", () => ({}));

async function main() {
  console.log("=== GOOGLE-MAPS-SCOUT LIVE PROBE (v2 — after fix) ===");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log();

  // 1. Test the legacy webSearchWithFallback (now with fixed parsing)
  console.log("[1] Testing webSearchWithFallback (fixed parsing)...");
  try {
    const { webSearchWithFallback } = await import("../src/lib/utils/web-search-fallback");
    const results = await webSearchWithFallback("restaurants in Chennai", 3);
    console.log(`    ✓ returned ${results.length} results`);
    if (results.length > 0) {
      for (const r of results.slice(0, 3)) {
        console.log(`      • ${r.title} — ${r.url}`);
      }
    } else {
      console.log(`    ✗ still returning 0 results — fix didn't work`);
    }
  } catch (err) {
    console.log(`    ✗ failed: ${err}`);
  }
  console.log();

  // 2. Test the 4-provider searchWithFallback
  console.log("[2] Testing searchWithFallback (4-provider)...");
  try {
    const { searchWithFallback, getSearchProviderStatus } = await import("../src/lib/search/search-provider");

    console.log("    Provider status:");
    for (const p of getSearchProviderStatus()) {
      console.log(`      ${p.name}: available=${p.available}`);
    }
    console.log();

    const result = await searchWithFallback("restaurants in Chennai", { num: 3 });
    console.log(`    ✓ returned ${result.results.length} results via ${result.provider}`);
    for (const r of result.results.slice(0, 3)) {
      console.log(`      • ${r.title} — ${r.url}`);
    }
  } catch (err) {
    console.log(`    ✗ failed: ${err}`);
  }
  console.log();

  // 3. Test the ACTUAL scout function
  console.log("[3] Testing the ACTUAL google-maps-scout.searchGoogleMapsForCategory...");
  try {
    const scout = await import("../src/lib/lead-hunter/google-maps-scout");
    const fn = (scout as any).searchGoogleMapsForCategory;
    if (typeof fn === "function") {
      const businesses = await fn("restaurant", "Chennai", 3);
      console.log(`    ✓ scout returned ${businesses.length} businesses`);
      if (businesses.length > 0) {
        for (const b of businesses.slice(0, 3)) {
          console.log(`      • ${b.name ?? b.businessName ?? "unknown"} — ${b.address ?? b.website ?? "no address"}`);
        }
      } else {
        console.log(`    ✗ scout returned 0 businesses — the scout may have its own parsing issue`);
      }
    } else {
      console.log(`    ✗ searchGoogleMapsForCategory is not exported (exports: ${Object.keys(scout).join(", ")})`);
    }
  } catch (err) {
    console.log(`    ✗ scout failed: ${err}`);
  }
  console.log();

  console.log("=== PROBE COMPLETE ===");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
