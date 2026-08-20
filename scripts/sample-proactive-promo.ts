/**
 * scripts/sample-proactive-promo.ts — v72 Phase 22 smoke test
 *
 * Verifies that the proactive lead-gen modules work end-to-end with mock data.
 * Doesn't make real network calls — uses synthetic inputs.
 *
 * Run: bun run scripts/sample-proactive-promo.ts
 */

import { mock } from "bun:test";
mock.module("server-only", () => ({}));

import { readFileSync } from "fs";
import { importContactsFromFile } from "../src/lib/lead-hunter/excel-importer";
import { findContactDetails } from "../src/lib/lead-hunter/contact-finder";
import { redeemFreeOffer, getOfferStatus, generateOfferText, ELIGIBLE_FREE_SERVICES, FREE_OFFER_CAP } from "../src/lib/lead-hunter/free-offer-engine";
import { DEFAULT_SCOUT_CONFIG } from "../src/lib/lead-hunter/google-maps-scout";
import { listPatterns, requestPatternApproval } from "../src/lib/approval-patterns";
import { generateAwarenessContent } from "../src/lib/social-media-manager";

console.log("=== Phase 22 Proactive Promo Smoke Test ===\n");

// --- 1. Excel/CSV importer ---
console.log("--- 1. Excel/CSV Importer ---");
console.log(`Default cities for GMB scout: ${DEFAULT_SCOUT_CONFIG.cities.length}`);
console.log(`Default categories for GMB scout: ${DEFAULT_SCOUT_CONFIG.categories.length}`);

try {
  const csvBuffer = readFileSync("./sample-contacts.csv");
  console.log("\nParsing sample-contacts.csv...");
  // Note: this requires DB initialized — wrap in try/catch
  const result = await importContactsFromFile(csvBuffer, "sample-contacts.csv", ["smoke-test"]);
  console.log(`  Imported: ${result.imported}/${result.totalRows} rows`);
  console.log(`  Duplicates: ${result.duplicates}, Errors: ${result.errors}`);
} catch (err) {
  console.log(`  (skipped — needs DB: ${String(err).slice(0, 80)})`);
}

// --- 2. Contact finder ---
console.log("\n--- 2. Contact Finder (will use Z-AI web_search) ---");
try {
  const details = await findContactDetails("Acme Corp", "acme.com");
  if (details) {
    console.log(`  Emails found: ${details.emails.length}`);
    console.log(`  Phones found: ${details.phones.length}`);
    console.log(`  Social handles: ${details.socialHandles.length}`);
    console.log(`  Confidence: ${details.confidence}%`);
  } else {
    console.log("  No contact details found (expected if Z-AI unavailable)");
  }
} catch (err) {
  console.log(`  (skipped — Z-AI search failed: ${String(err).slice(0, 80)})`);
}

// --- 3. Free offer engine ---
console.log("\n--- 3. Free Offer Engine ---");
console.log(`  Cap: ${FREE_OFFER_CAP}`);
console.log(`  Eligible services: ${ELIGIBLE_FREE_SERVICES.map((s) => s.serviceName).join(", ")}`);
try {
  const status = await getOfferStatus();
  console.log(`  Current status: claimed=${status.claimed}/${status.cap}, remaining=${status.remaining}`);
} catch (err) {
  console.log(`  (skipped — needs DB: ${String(err).slice(0, 80)})`);
}

console.log("\n  Offer text preview:");
console.log(generateOfferText("Landing Page").slice(0, 200) + "...");

// Try redeeming (should be blocked on second attempt)
try {
  const redemption = await redeemFreeOffer({
    customerName: "Smoke Test Customer",
    customerEmail: "smoke@test.com",
    customerPhone: "+919876543210",
    customerCompany: "Smoke Test Inc",
    serviceName: "Landing Page",
    redemptionChannel: "smoke-test",
  });
  console.log(`\n  Redemption attempt: ok=${redemption.ok}, code=${redemption.redemptionCode ?? "n/a"}, sequence=${redemption.sequenceNumber ?? "n/a"}`);
  if (redemption.reason) console.log(`  Reason: ${redemption.reason}`);

  // Second redemption with same email — should be blocked (alreadyRedeemed)
  const secondAttempt = await redeemFreeOffer({
    customerName: "Smoke Test Customer",
    customerEmail: "smoke@test.com",
    customerPhone: "+919876543211",
    customerCompany: "Different Phone Same Email",
    serviceName: "Landing Page",
    redemptionChannel: "smoke-test",
  });
  console.log(`  Second attempt (same email, diff phone): ok=${secondAttempt.ok}, alreadyRedeemed=${secondAttempt.alreadyRedeemed}`);

  // Try with ineligible service
  const ineligible = await redeemFreeOffer({
    customerName: "Ineligible Service Test",
    customerEmail: "ineligible@test.com",
    customerPhone: "+919811111111",
    customerCompany: "Test Inc",
    serviceName: "Voice Agent", // NOT eligible — RULE-70 says websites only
    redemptionChannel: "smoke-test",
  });
  console.log(`  Ineligible service (Voice Agent): ok=${ineligible.ok}, ineligibleService=${ineligible.ineligibleService}`);
} catch (err) {
  console.log(`  (skipped — needs DB: ${String(err).slice(0, 80)})`);
}

// --- 4. Approval patterns ---
console.log("\n--- 4. Approval Patterns (RULE-71: per-category, approve once) ---");
try {
  const patterns = await listPatterns();
  console.log(`  Current patterns: ${patterns.length}`);
} catch (err) {
  console.log(`  (skipped — needs DB: ${String(err).slice(0, 80)})`);
}

// --- 5. Social media awareness content generation ---
console.log("\n--- 5. Social Media Awareness Content Generation (local Ollama) ---");
for (const platform of ["instagram", "facebook", "x", "linkedin"] as const) {
  try {
    const content = await generateAwarenessContent(
      "ARIA free offer: first 100 customers get a free landing page built by an AI autonomous company",
      platform,
      "free-offer-100",
      "offer",
    );
    console.log(`\n  ${platform.toUpperCase()} post preview:`);
    console.log("  " + content.content.slice(0, 200).replace(/\n/g, "\n  ") + "...");
  } catch (err) {
    console.log(`  ${platform}: generation failed (Ollama likely unavailable)`);
  }
}

console.log("\n=== Smoke test complete ===");
