/**
 * src/lib/health-sim.ts — Daily Health Simulation (v45)
 *
 * Runs at 6:00 AM (before the founder-briefing at 8am) via the `daily-health-sim`
 * cron job. Performs a lightweight version of simulate-full-loop.ts:
 *
 *   1. Probes the Z-AI LLM API with a tiny prompt (1 call)
 *   2. Probes the blockchain APIs (blockchain.info + etherscan + solana RPC)
 *   3. Probes CoinGecko price feeds
 *   4. Probes the forex API (USD→INR)
 *   5. Reads the last 24h of quality-gate results from ServiceOrder rows
 *   6. Reads the last 24h of LlmCall rows for failure rate
 *
 * If ANY of the following conditions are detected, creates a CRITICAL SystemAlert
 * + sets the `outreach.paused` Setting to "true" (which OutreachExecutor checks
 * before sending any email):
 *   - Z-AI LLM API unreachable or rate-limited
 *   - All blockchain APIs unreachable
 *   - CoinGecko + Binance + CryptoCompare all unreachable (no price feed)
 *   - Quality gate failure rate > 50% in last 24h
 *   - LLM call failure rate > 50% in last 24h
 *
 * The owner un-pauses outreach by setting `outreach.paused` to "false" via the
 * dashboard (or by fixing the underlying issue + clicking "Resume Outreach").
 */
import "server-only";

import { db } from "./db";
import { logger } from "./logger";
import { emit } from "./event-bus";

export interface HealthSimResult {
  ok: boolean;
  checks: Array<{
    name: string;
    ok: boolean;
    latencyMs?: number;
    error?: string;
    detail?: string;
  }>;
  criticalAlerts: string[];
  outreachPaused: boolean;
}

export async function runDailyHealthSim(): Promise<HealthSimResult> {
  logger.info("health-sim.start", {});
  const checks: HealthSimResult["checks"] = [];
  const criticalAlerts: string[] = [];

  // ── 1. Probe Z-AI LLM API ──────────────────────────────────────────
  let llmOk = false;
  let llmLatency: number | undefined;
  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const start = Date.now();
    await zai.chat.completions.create({
      messages: [{ role: "user", content: "Reply with the single word: OK" }],
    });
    llmLatency = Date.now() - start;
    llmOk = true;
    checks.push({ name: "zai-llm", ok: true, latencyMs: llmLatency });
  } catch (err) {
    const errStr = String(err).slice(0, 150);
    checks.push({ name: "zai-llm", ok: false, error: errStr });
    criticalAlerts.push(`Z-AI LLM API unreachable: ${errStr}`);
  }

  // ── 2. Probe blockchain APIs ───────────────────────────────────────
  let blockchainOk = 0;
  let blockchainTotal = 0;

  // BTC: blockchain.info
  blockchainTotal++;
  try {
    const res = await fetch("https://blockchain.info/rawaddr/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", {
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      blockchainOk++;
      checks.push({ name: "blockchain.info (BTC)", ok: true });
    } else {
      checks.push({ name: "blockchain.info (BTC)", ok: false, error: `HTTP ${res.status}` });
    }
  } catch (err) {
    checks.push({ name: "blockchain.info (BTC)", ok: false, error: String(err).slice(0, 80) });
  }

  // ETH: etherscan (with key if available)
  blockchainTotal++;
  try {
    const apiKey = process.env.ETHERSCAN_API_KEY || "";
    const url = apiKey
      ? `https://api.etherscan.io/api?module=account&action=txlist&address=0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe&startblock=0&sort=desc&apikey=${apiKey}`
      : "https://api.blockcypher.com/v1/eth/main";
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      blockchainOk++;
      checks.push({ name: apiKey ? "etherscan (ETH)" : "blockcypher (ETH fallback)", ok: true });
    } else {
      checks.push({ name: apiKey ? "etherscan (ETH)" : "blockcypher (ETH fallback)", ok: false, error: `HTTP ${res.status}` });
    }
  } catch (err) {
    checks.push({ name: "etherscan/blockcypher (ETH)", ok: false, error: String(err).slice(0, 80) });
  }

  // SOL: Solana RPC
  blockchainTotal++;
  try {
    const res = await fetch("https://api.mainnet-beta.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      blockchainOk++;
      checks.push({ name: "solana-rpc (SOL)", ok: true });
    } else {
      checks.push({ name: "solana-rpc (SOL)", ok: false, error: `HTTP ${res.status}` });
    }
  } catch (err) {
    checks.push({ name: "solana-rpc (SOL)", ok: false, error: String(err).slice(0, 80) });
  }

  if (blockchainOk === 0) {
    criticalAlerts.push(`All ${blockchainTotal} blockchain APIs unreachable — crypto payment verification will fail.`);
  }

  // ── 3. Probe price feeds (CoinGecko + Binance) ─────────────────────
  let priceOk = 0;
  let priceTotal = 0;

  priceTotal++;
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", {
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      priceOk++;
      checks.push({ name: "coingecko", ok: true });
    } else {
      checks.push({ name: "coingecko", ok: false, error: `HTTP ${res.status}` });
    }
  } catch (err) {
    checks.push({ name: "coingecko", ok: false, error: String(err).slice(0, 80) });
  }

  priceTotal++;
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", {
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      priceOk++;
      checks.push({ name: "binance", ok: true });
    } else {
      checks.push({ name: "binance", ok: false, error: `HTTP ${res.status}` });
    }
  } catch (err) {
    checks.push({ name: "binance", ok: false, error: String(err).slice(0, 80) });
  }

  if (priceOk === 0) {
    criticalAlerts.push(`All ${priceTotal} price feed APIs unreachable — crypto amount verification will fail.`);
  }

  // ── 4. Probe forex API (USD→INR) ───────────────────────────────────
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: AbortSignal.timeout(5_000),
    });
    const data = await res.json();
    if (res.ok && data?.rates?.INR) {
      checks.push({ name: "forex (USD→INR)", ok: true, detail: `₹${data.rates.INR}` });
    } else {
      checks.push({ name: "forex (USD→INR)", ok: false, error: "no INR rate in response" });
      criticalAlerts.push("Forex API unreachable — UPI payment amount conversion will fail.");
    }
  } catch (err) {
    checks.push({ name: "forex (USD→INR)", ok: false, error: String(err).slice(0, 80) });
    criticalAlerts.push("Forex API unreachable — UPI payment amount conversion will fail.");
  }

  // ── 5. Quality gate failure rate (last 24h) ────────────────────────
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [total, failed] = await Promise.all([
      db.serviceOrder.count({ where: { createdAt: { gte: since }, status: { in: ["delivered", "failed"] } } }),
      db.serviceOrder.count({ where: { createdAt: { gte: since }, status: "failed" } }),
    ]);
    const failRate = total > 0 ? (failed / total) * 100 : 0;
    checks.push({
      name: "quality-gate-24h",
      ok: failRate < 50,
      detail: `${failed}/${total} failed (${failRate.toFixed(1)}%)`,
    });
    if (failRate >= 50 && total >= 3) {
      criticalAlerts.push(`Quality gate failure rate ${failRate.toFixed(0)}% in last 24h (${failed}/${total}). Builder may be broken.`);
    }
  } catch (err) {
    checks.push({ name: "quality-gate-24h", ok: false, error: String(err).slice(0, 80) });
  }

  // ── 6. LLM call failure rate (last 24h) ────────────────────────────
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [total, failed] = await Promise.all([
      db.llmCall.count({ where: { createdAt: { gte: since } } }),
      db.llmCall.count({ where: { createdAt: { gte: since }, status: { in: ["error", "rate_limited", "fallback"] } } }),
    ]);
    const failRate = total > 0 ? (failed / total) * 100 : 0;
    checks.push({
      name: "llm-calls-24h",
      ok: failRate < 50,
      detail: `${failed}/${total} failed (${failRate.toFixed(1)}%)`,
    });
    if (failRate >= 50 && total >= 10) {
      criticalAlerts.push(`LLM call failure rate ${failRate.toFixed(0)}% in last 24h (${failed}/${total}). Providers may be down or rate-limited.`);
    }
  } catch (err) {
    checks.push({ name: "llm-calls-24h", ok: false, error: String(err).slice(0, 80) });
  }

  // ── Decide: pause outreach? ────────────────────────────────────────
  const shouldPause = criticalAlerts.length > 0;
  if (shouldPause) {
    try {
      await db.setting.upsert({
        where: { key: "outreach.paused" },
        create: {
          key: "outreach.paused",
          value: "true",
          category: "outreach",
        },
        update: { value: "true" },
      });
      logger.error("health-sim.paused-outreach", { criticalAlerts });
    } catch {
      // non-fatal
    }
  }

  // ── Create SystemAlerts for each critical finding ──────────────────
  for (const alert of criticalAlerts) {
    try {
      await db.systemAlert.create({
        data: {
          severity: "error",
          source: "health-sim",
          message: `[HEALTH-SIM] ${alert}`,
        },
      });
    } catch {
      // non-fatal
    }
  }

  // ── Emit SSE event ─────────────────────────────────────────────────
  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: shouldPause
      ? `⚠️ Daily health sim detected ${criticalAlerts.length} critical issue(s). Outreach PAUSED until owner review.`
      : `✓ Daily health sim passed (${checks.filter((c) => c.ok).length}/${checks.length} checks OK).`,
    level: shouldPause ? "error" : "success",
  });

  const result: HealthSimResult = {
    ok: criticalAlerts.length === 0,
    checks,
    criticalAlerts,
    outreachPaused: shouldPause,
  };

  logger.info("health-sim.complete", {
    ok: result.ok,
    checksOk: checks.filter((c) => c.ok).length,
    checksTotal: checks.length,
    criticalAlerts: criticalAlerts.length,
    outreachPaused: result.outreachPaused,
  });

  return result;
}

/**
 * Check whether outreach is currently paused (called by OutreachExecutor before sending).
 */
export async function isOutreachPaused(): Promise<boolean> {
  try {
    const setting = await db.setting.findUnique({
      where: { key: "outreach.paused" },
    });
    return setting?.value === "true";
  } catch {
    return false;
  }
}

/**
 * Owner manually resumes outreach after reviewing the alerts.
 */
export async function resumeOutreach(): Promise<void> {
  try {
    await db.setting.upsert({
      where: { key: "outreach.paused" },
      create: { key: "outreach.paused", value: "false", category: "outreach" },
      update: { value: "false" },
    });
    emit({
      type: "system",
      ts: new Date().toISOString(),
      message: "Outreach resumed by owner.",
      level: "success",
    });
  } catch (err) {
    logger.error("health-sim.resume-failed", { error: String(err) });
  }
}
