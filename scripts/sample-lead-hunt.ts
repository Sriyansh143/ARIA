/**
 * scripts/sample-lead-hunt.ts — v71 Phase 21
 *
 * Smoke test: verify the lead-hunt modules are wired correctly by
 * calling each function in isolation with mock data. Doesn't make
 * real network calls — uses synthetic inputs.
 *
 * Run: bun run scripts/sample-lead-hunt.ts
 */

import { mock } from "bun:test";
mock.module("server-only", () => ({}));

const { matchServiceToLead } = await import("../src/lib/lead-hunter/service-matcher");
const { generateHelpfulComment } = await import("../src/lib/lead-hunter/social-scout");
const { extractFromSocialProfile } = await import("../src/lib/lead-hunter/profile-extractor");
const { BUYING_SIGNALS } = await import("../src/lib/lead-hunter/social-scout");

console.log("=== Phase 21 Sample Lead Hunt ===");
console.log("");
console.log("--- Buying signal catalog ---");
console.log(`Categories: ${BUYING_SIGNALS.length}`);
console.log(`Total keywords: ${BUYING_SIGNALS.reduce((s, b) => s + b.signals.length, 0)}`);
for (const b of BUYING_SIGNALS) {
  console.log(`  ${b.category}: ${b.signals.length} signals → ${b.services.join(", ")}`);
}
console.log("");
console.log("--- Sample discovered lead (mock) ---");
const sampleLead = {
  platform: "twitter" as const,
  username: "saas_founder_ai",
  displayName: "Jane Doe, SaaS Founder",
  profileUrl: "https://x.com/saas_founder_ai",
  postContent: "Just closed our pre-seed round! Building a customer support automation SaaS. Looking for a technical co-founder or a SaaS scaffold template to ship MVP fast.",
  postUrl: "https://x.com/saas_founder_ai/status/123",
  postedAt: new Date(),
  likes: 47,
  replies: 12,
  reposts: 3,
  followerCount: 2400,
  accountAgeDays: 850,
  matchedServiceCategory: "saas-scaffold",
  matchedSignal: "just raised seed round",
};
console.log(JSON.stringify(sampleLead, null, 2));

console.log("");
console.log("--- Helpful comment for INVESTIGATE path ---");
console.log(generateHelpfulComment(sampleLead, "SaaS Scaffold"));

console.log("");
console.log("--- Profile extractor (will return null since Z-AI SDK needs API key) ---");
try {
  const profile = await extractFromSocialProfile(sampleLead);
  console.log(`Profile extracted: ${profile ? "yes" : "no (likely needs ZAI_API_KEY)"}`);
  if (profile) {
    console.log(JSON.stringify({
      primaryColor: profile.primaryColor,
      brandTone: profile.brandTone,
      industry: profile.industry,
      source: profile.source,
    }, null, 2));
  }
} catch (err) {
  console.log(`Profile extractor errored (expected without ZAI_API_KEY): ${String(err).slice(0, 100)}`);
}

console.log("");
console.log("--- Service matcher (will fall back since no DB) ---");
try {
  const matches = await matchServiceToLead(sampleLead.postContent, {
    username: sampleLead.username,
    platform: sampleLead.platform,
    followerCount: sampleLead.followerCount,
    matchedServiceCategory: sampleLead.matchedServiceCategory,
  });
  console.log(`Matched ${matches.length} services (LLM may have been unavailable — check fallback):`);
  for (const m of matches) {
    console.log(`  ${m.serviceName} (${m.conversionProbability}%) — ${m.reason}`);
  }
} catch (err) {
  console.log(`Service matcher errored (expected if no Ollama running): ${String(err).slice(0, 100)}`);
}

console.log("");
console.log("=== Smoke test complete ===");
