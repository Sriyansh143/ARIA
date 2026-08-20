/**
 * scripts/probe-zai-live.ts — Phase 32 Remediation
 *
 * LIVE probe of the Z-AI SDK to verify whether the 404 error is real.
 * This script calls the EXACT same code path that the scouts use:
 *   1. ZAI.create() — loads .z-ai-config
 *   2. zai.functions.invoke("web_search", { query, num }) — the call that logs show failing
 *
 * This is NOT code inspection — this is a runtime test that produces
 * visual proof of whether Z-AI is reachable right now.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

async function main() {
  console.log("=== Z-AI SDK LIVE PROBE ===");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log();

  // 1. Verify .z-ai-config exists
  const configPath = join(process.cwd(), ".z-ai-config");
  console.log(`[1] .z-ai-config path: ${configPath}`);
  console.log(`    exists: ${existsSync(configPath)}`);

  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      console.log(`    baseUrl: ${config.baseUrl}`);
      console.log(`    apiKey: ${config.apiKey}`);
      console.log(`    has token: ${!!config.token}`);
      console.log(`    chatId: ${config.chatId}`);
    } catch (err) {
      console.log(`    PARSE ERROR: ${err}`);
    }
  }
  console.log();

  // 2. Check env vars
  console.log("[2] Environment variables:");
  console.log(`    ZAI_API_KEY: ${process.env.ZAI_API_KEY ? "set (" + process.env.ZAI_API_KEY.slice(0, 10) + "...)" : "NOT SET"}`);
  console.log(`    OLLAMA_HOST: ${process.env.OLLAMA_HOST ?? "NOT SET"}`);
  console.log(`    TAVILY_API_KEY: ${process.env.TAVILY_API_KEY ? "set" : "NOT SET"}`);
  console.log(`    SERPER_API_KEY: ${process.env.SERPER_API_KEY ? "set" : "NOT SET"}`);
  console.log();

  // 3. Try to import + create the Z-AI SDK
  console.log("[3] Importing z-ai-web-dev-sdk...");
  let ZAI: any;
  try {
    ZAI = (await import("z-ai-web-dev-sdk")).default;
    console.log("    ✓ imported successfully");
  } catch (err) {
    console.log(`    ✗ import FAILED: ${err}`);
    process.exit(1);
  }

  console.log();
  console.log("[4] Calling ZAI.create()...");
  let zai: any;
  try {
    zai = await ZAI.create();
    console.log("    ✓ ZAI.create() succeeded");
    console.log(`    zai object keys: ${Object.keys(zai).join(", ")}`);
    if (zai.functions) {
      console.log(`    zai.functions keys: ${Object.keys(zai.functions).join(", ")}`);
    }
  } catch (err) {
    console.log(`    ✗ ZAI.create() FAILED: ${err}`);
    process.exit(1);
  }

  console.log();
  console.log("[5] Calling zai.functions.invoke('web_search', { query: 'hello world', num: 3 })...");
  const startTime = Date.now();
  try {
    const result = await Promise.race([
      zai.functions.invoke("web_search", { query: "hello world", num: 3 }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT after 15s")), 15_000),
      ),
    ]);
    const elapsed = Date.now() - startTime;
    console.log(`    ✓ invoke succeeded in ${elapsed}ms`);
    console.log(`    result type: ${typeof result}`);
    console.log(`    isArray: ${Array.isArray(result)}`);
    if (Array.isArray(result)) {
      console.log(`    result length: ${result.length}`);
      if (result.length > 0) {
        console.log(`    first result: ${JSON.stringify(result[0]).slice(0, 200)}`);
      }
    } else {
      console.log(`    result preview: ${JSON.stringify(result).slice(0, 300)}`);
    }
    console.log();
    console.log("=== VERDICT: Z-AI web_search is WORKING ===");
  } catch (err: any) {
    const elapsed = Date.now() - startTime;
    console.log(`    ✗ invoke FAILED after ${elapsed}ms`);
    console.log(`    error: ${err}`);
    console.log(`    error.message: ${err?.message}`);
    console.log(`    error.status: ${err?.status ?? "n/a"}`);
    console.log(`    error.statusCode: ${err?.statusCode ?? "n/a"}`);

    // Check if it's the 404 error the user reported
    const errStr = String(err);
    if (errStr.includes("404") || errStr.includes("Not Found") || errStr.includes("/v4/functions/invoke")) {
      console.log();
      console.log("=== VERDICT: 404 ERROR CONFIRMED — Z-AI web_search is BROKEN ===");
      console.log("    The user's claim is CORRECT. The 404 is happening RIGHT NOW.");
    } else if (errStr.includes("TIMEOUT")) {
      console.log();
      console.log("=== VERDICT: TIMEOUT — Z-AI is unreachable (network issue) ===");
    } else {
      console.log();
      console.log("=== VERDICT: Z-AI failed with a non-404 error ===");
    }

    // Also test page_reader to see if it's the same
    console.log();
    console.log("[6] Testing page_reader (different function)...");
    try {
      const pr = await zai.functions.invoke("page_reader", { url: "https://example.com" });
      console.log(`    ✓ page_reader succeeded: ${JSON.stringify(pr).slice(0, 100)}`);
    } catch (prErr) {
      console.log(`    ✗ page_reader also failed: ${prErr}`);
    }
  }

  console.log();
  console.log("=== PROBE COMPLETE ===");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
