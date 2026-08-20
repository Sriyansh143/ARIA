/**
 * src/lib/llm-router.ts — Multi-Provider LLM Routing Engine (v39 hardened)
// TECH-DEBT: This file is 1026 lines (over the 400-line RULE-43 limit). Planned split: llm-providers.ts (provider configs) + llm-fallback.ts (circuit breaker + fallback chain). Deadline: 7 days from 2026-08-17. Tracked in worklog per RULE-47.
 *
 * v39 fixes (Principal Backend Engineer refactor):
 *
 *   Fix 1 — TIER CIRCUIT BREAKER:
 *     If ALL providers fail for a specific complexity tier, the ENTIRE tier
 *     is put on a 5-minute cooldown. During cooldown, routeLLM instantly
 *     returns a graceful "All LLM providers currently unavailable" response
 *     without touching any provider. This eliminates the infinite retry
 *     loop that hammered dead APIs every 15-second agent tick.
 *
 *   Fix 2 — SILENT SKIP for disabled / cooldown providers:
 *     Z-AI is marked `disabled` once on boot if no API key is set — the
 *     router never attempts it, never logs a warning. Providers on cooldown
 *     are skipped with zero log output. The terminal is silent.
 *
 *   Fix 3 — NVIDIA model fix:
 *     `meta/llama-3.1-405b-instruct` (dead/deprecated) replaced with
 *     `nvidia/llama-3.1-nemotron-70b-instruct` (active free-tier).
 *
 *   Fix 4 — Dynamic Ollama model selection:
 *     `autoDetectOllamaModels()` is called on boot; the router reads
 *     `WORKFORCE_MODEL_{STRONG,BALANCED,FAST}` env vars that are set
 *     dynamically from the actual installed models. On 404, a silent
 *     background `ollama pull` is triggered once + the router falls back
 *     to the next available local model.
 *
 *   Fix 5 — Clean logging:
 *     `llm-router.trying` and `llm-router.fallback` logs removed entirely
 *     (were `debug`/`warn` — caused terminal spam). The terminal now only
 *     shows: `success` when a call routes, `error` when the circuit
 *     breaker trips. Everything else is `trace` (invisible unless
 *     ARIA_LOG_LEVEL=trace).
 *
 * Provider priority (task-complexity-aware, re-computed per call):
 *
 *   HIGH (CEO/CTO/strategy):  Z-AI → Groq → NVIDIA → Ollama(strong)
 *   MEDIUM (eng/research):    Z-AI → Groq → NVIDIA → Ollama(balanced)
 *   LOW (status/heartbeat):   Z-AI → Groq → Ollama(fast)
 *
 *   When ARIA_PREFER_LOCAL_LLM=1 (default), Ollama is tried FIRST.
 *
 * Cooldowns:
 *   - HTTP 401/403 → 5 min (auth failure)
 *   - HTTP 429     → 60s  (rate limit)
 *   - Scrape fail  → 2 min (browser-scraper)
 *   - Conn refused → 10s  (ollama)
 *
 * Circuit breaker:
 *   - All providers fail for a tier → tier tripped for 5 min
 *   - Any success on a tier → breaker reset
 *   - During trip: instant graceful fallback, no provider calls
 */

import { logger } from "./logger";
import { callOllama, shouldSkipOllama, probeOllamaReachable, type OllamaMessage } from "./ollama-client";

// ─── v58 Resilience: HTML-Response-Aware JSON Parser ─────────────────
/**
 * v58 Phase 1 — HTML-Resilient JSON parser.
 *
 * Some LLM providers (notably Z-AI on overload) return an HTML error page
 * (Cloudflare 502, nginx 500, "Service Unavailable") with HTTP 200 + a
 * text/html Content-Type. Calling res.json() on this throws a cryptic
 * "Unexpected token < in JSON" SyntaxError that the router would log as
 * a generic failure — without setting a cooldown, so the next tick would
 * hammer the dead endpoint again.
 *
 * This helper:
 *   1. Reads the response body ONCE as text.
 *   2. Tries JSON.parse — if it works, return the parsed object.
 *   3. If JSON.parse fails, throws a typed `ProviderHtmlError` that
 *      includes the first 200 chars of the HTML body so the router
 *      can set a 10-minute cooldown + skip this provider.
 *
 * Usage:
 *   const data = await safeJsonParse(res);  // throws ProviderHtmlError on HTML
 */
export class ProviderHtmlError extends Error {
  readonly isHtml: true = true;
  readonly htmlPreview: string;
  readonly statusCode: number;
  constructor(message: string, htmlPreview: string, statusCode: number) {
    super(message);
    this.name = "ProviderHtmlError";
    this.htmlPreview = htmlPreview;
    this.statusCode = statusCode;
  }
}

export async function safeJsonParse<T = unknown>(res: Response): Promise<T> {
  const contentType = res.headers.get("content-type") || "";
  const rawText = await res.text();

  // If the server explicitly says HTML, don't even try JSON.parse.
  if (contentType.includes("text/html") || /^<!DOCTYPE html/i.test(rawText.trim()) || /^<html/i.test(rawText.trim())) {
    throw new ProviderHtmlError(
      `Provider returned HTML (not JSON) — endpoint likely down`,
      rawText.slice(0, 200),
      res.status,
    );
  }

  try {
    return JSON.parse(rawText) as T;
  } catch (err) {
    // Body looked like JSON but wasn't — also a ProviderHtmlError for cooldown purposes.
    throw new ProviderHtmlError(
      `Provider returned non-JSON body: ${err instanceof Error ? err.message : String(err)}`,
      rawText.slice(0, 200),
      res.status,
    );
  }
}

/**
 * Convenience wrapper: detect ProviderHtmlError in a catch block + apply cooldown.
 * Returns true if the error was handled (cooldown set).
 */
function handleProviderError(provider: LLMProvider, err: unknown): boolean {
  if (err instanceof ProviderHtmlError) {
    // HTML response = endpoint is degraded (Cloudflare 5xx, nginx overload).
    // Cool down for 10 minutes so the router falls through to the next provider.
    setProviderCooldown(provider, 600_000, `HTML response (HTTP ${err.statusCode})`);
    logger.warn("llm-router.html-response-detected", {
      provider,
      statusCode: err.statusCode,
      preview: err.htmlPreview,
      cooldownMin: 10,
    });
    return true;
  }
  return false;
}

// ─── Types ──────────────────────────────────────────────────────────

export type TaskComplexity = "high" | "medium" | "low";
export type LLMProvider = "zai" | "groq" | "nvidia" | "browser-scraper" | "ollama";

export interface RoutedLLMResult {
  completion: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  model: string;
  provider: LLMProvider;
  success: boolean;
  error?: string;
  fallbackUsed: boolean;
  /** True when the tier circuit breaker returned an instant fallback. */
  circuitBreakerTripped?: boolean;
}

export interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

// ─── Provider cooldown tracking ─────────────────────────────────────

interface ProviderCooldown {
  until: number;
  reason: string;
}

const providerCooldowns = new Map<LLMProvider, ProviderCooldown>();

function isProviderAvailable(provider: LLMProvider): boolean {
  const cd = providerCooldowns.get(provider);
  if (cd && Date.now() < cd.until) return false;
  if (cd && Date.now() >= cd.until) providerCooldowns.delete(provider);
  return true;
}

// ─── v44 fix: Per-provider token bucket (RPM limiter) ────────────────
// Prevents the 66-agent tick loop from hammering Z-AI's 5 RPM free tier.
// Each provider has its own bucket. If empty, routeLLM sets a 60s cooldown.

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  capacity: number;       // max tokens (= RPM)
  refillRatePerMs: number; // capacity / 60000
}

const providerBuckets = new Map<LLMProvider, TokenBucket>();

function getProviderRpmLimit(): Record<LLMProvider, number> {
  // AUDIT-C-16: guard against NaN. If an operator sets ARIA_LLM_RPM_ZAI=abc,
  // parseInt returns NaN, NaN propagates through the token bucket, and the
  // provider is silently disabled forever with no diagnostic. Validate + fall back.
  const parseRpm = (raw: string | undefined, def: number): number => {
    const n = parseInt(raw || String(def), 10);
    return Number.isFinite(n) && n > 0 ? n : def;
  };
  return {
    zai: parseRpm(process.env.ARIA_LLM_RPM_ZAI, 5),
    groq: parseRpm(process.env.ARIA_LLM_RPM_GROQ, 30),
    nvidia: parseRpm(process.env.ARIA_LLM_RPM_NVIDIA, 20),
    ollama: parseRpm(process.env.ARIA_LLM_RPM_OLLAMA, 60),
    "browser-scraper": parseRpm(process.env.ARIA_LLM_RPM_SCRAPER, 10),
  };
}

function tryConsumeProviderToken(provider: LLMProvider): boolean {
  const rpm = getProviderRpmLimit();
  const capacity = rpm[provider] || 10;
  let bucket = providerBuckets.get(provider);
  if (!bucket) {
    bucket = {
      tokens: capacity,
      lastRefill: Date.now(),
      capacity,
      refillRatePerMs: capacity / 60_000,
    };
    providerBuckets.set(provider, bucket);
  }
  // Refill based on elapsed time
  const now = Date.now();
  const elapsed = now - bucket.lastRefill;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillRatePerMs);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }
  return false;
}

/**
 * Set a provider cooldown. Logged at `debug` (one-time event, not spam).
 * The router skips cooled-down providers silently — no per-tick warning.
 */
function setProviderCooldown(provider: LLMProvider, durationMs: number, reason: string): void {
  providerCooldowns.set(provider, {
    until: Date.now() + durationMs,
    reason,
  });
  logger.debug("llm-router.provider-cooldown", { provider, durationMs, reason });
}

// ─── Tier circuit breaker (Fix 1) ───────────────────────────────────

interface TierBreaker {
  trippedAt: number;
  resetAt: number;
  failures: number;
}

const TIER_BREAKER_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const tierBreakers = new Map<TaskComplexity, TierBreaker>();

/**
 * Check if a tier is currently tripped. If expired, auto-reset.
 */
function isTierTripped(complexity: TaskComplexity): boolean {
  const breaker = tierBreakers.get(complexity);
  if (!breaker) return false;
  if (Date.now() >= breaker.resetAt) {
    tierBreakers.delete(complexity);
    return false;
  }
  return true;
}

/**
 * Trip the circuit breaker for a tier. Logged ONCE at `error` level —
 * this is the only error log the router produces during normal operation.
 *
 * v45 fix I11: Also create a SystemAlert row + emit an SSE event so the
 * dashboard surfaces the trip. Without this, the owner has no idea the
 * LLM has been down for 5 minutes (or 5 hours).
 */
function tripTierBreaker(complexity: TaskComplexity, lastError: string): void {
  const existing = tierBreakers.get(complexity);
  const failures = (existing?.failures ?? 0) + 1;
  const resetAt = Date.now() + TIER_BREAKER_COOLDOWN_MS;
  tierBreakers.set(complexity, { trippedAt: Date.now(), resetAt, failures });

  // Only log the error on the FIRST trip (failures === 1). Subsequent
  // calls while tripped return instantly without hitting providers,
  // so they don't re-trip. When the breaker expires and trips again,
  // failures increments and we log once more.
  if (failures === 1 || failures % 10 === 0) {
    logger.error("llm-router.circuit-breaker-tripped", {
      complexity,
      failures,
      cooldownMs: TIER_BREAKER_COOLDOWN_MS,
      lastError: lastError.slice(0, 200),
      hint: `All providers failed for '${complexity}' tier. Skipping routing for 5 minutes.`,
    });

    // v45 fix I11: Surface the trip as a SystemAlert + SSE event.
    // Fire-and-forget — don't block the router on DB writes.
    void (async () => {
      try {
        const { db } = await import("./db");
        const { emit } = await import("./event-bus");
        await db.systemAlert.create({
          data: {
            severity: failures > 5 ? "error" : "warn",
            source: "llm",
            message: `LLM circuit breaker tripped for '${complexity}' tier (failure #${failures}). All providers failed. Cooldown: 5 min. Last error: ${lastError.slice(0, 150)}`,
          },
        });
        emit({
          type: "system",
          ts: new Date().toISOString(),
          message: `⚠️ LLM circuit breaker tripped (${complexity} tier, failure #${failures}). Autonomous LLM-dependent tasks paused for 5 min.`,
          level: "error",
        });
      } catch {
        // non-fatal — the log + tierBreaker map are the source of truth
      }
    })();
  }
}

/**
 * Reset the breaker for a tier on success.
 */
function resetTierBreaker(complexity: TaskComplexity): void {
  if (tierBreakers.has(complexity)) {
    tierBreakers.delete(complexity);
    logger.info("llm-router.circuit-breaker-reset", { complexity });
  }
}

// ─── Provider config ────────────────────────────────────────────────

interface ProviderConfig {
  name: LLMProvider;
  /** Returns false if provider is unconfigured (Z-AI no key, Groq no key, etc.) — skipped silently. */
  available: () => boolean;
  /** Returns true if provider is on cooldown — skipped silently. */
  cooldownSkip: () => boolean;
  model: (complexity: TaskComplexity) => string;
  call: (messages: ChatMsg[], model: string) => Promise<RoutedLLMResult>;
}

const PROVIDERS: ProviderConfig[] = [
  {
    name: "zai",
    // Phase 32 Fix: Z-AI is available if EITHER ZAI_API_KEY env var is set
    // OR .z-ai-config file exists (which the SDK auto-loads).
    available: () => {
      const key = process.env.ZAI_API_KEY;
      if (key && key !== "replace-with-your-zai-api-key") return true;
      // Check .z-ai-config (the SDK auto-loads this for functions.invoke)
      try {
        const fs = require("fs");
        const path = require("path");
        const configPath = path.join(process.cwd(), ".z-ai-config");
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
          return !!(config.token || config.apiKey);
        }
      } catch {
        // .z-ai-config doesn't exist or is malformed
      }
      return false;
    },
    cooldownSkip: () => !isProviderAvailable("zai"),
    model: (c) => (c === "high" ? "glm-4.6" : c === "medium" ? "glm-4.5-air" : "glm-4.5-flash"),
    call: (messages, model) => callZAI(messages, model),
  },
  {
    name: "groq",
    available: () => {
      const key = process.env.GROQ_API_KEY;
      return !!key && key !== "your_groq_api_key_here";
    },
    cooldownSkip: () => !isProviderAvailable("groq"),
    model: (c) => (c === "high" ? "llama-3.3-70b-versatile" : "llama-3.1-8b-instant"),
    call: (messages, model) => callGroq(messages, model),
  },
  {
    name: "nvidia",
    available: () => {
      const key = process.env.NVIDIA_API_KEY;
      return !!key && key !== "your_nvidia_api_key_here";
    },
    cooldownSkip: () => !isProviderAvailable("nvidia"),
    // Fix 3: llama-3.1-405b-instruct is DEAD on NVIDIA NIM.
    // Using nemotron-70b (active free-tier) for high, llama-3.1-8b for medium/low.
    model: (c) =>
      c === "high"
        ? "nvidia/llama-3.1-nemotron-70b-instruct"
        : "meta/llama-3.1-8b-instruct",
    call: (messages, model) => callNvidia(messages, model),
  },
  {
    name: "browser-scraper",
    available: () => process.env.ARIA_BROWSER_SCRAPER_ENABLED === "1",
    cooldownSkip: () => !isProviderAvailable("browser-scraper"),
    model: () => "web-ui-scrape",
    call: (messages, model) => callBrowserScraper(messages, model),
  },
  {
    name: "ollama",
    available: () => true, // always try as final fallback
    cooldownSkip: () => shouldSkipOllama(),
    // Fix 4: reads dynamically-detected models from env vars set by autoDetectOllamaModels()
    model: (c) => {
      const tier = c === "high" ? "STRONG" : c === "medium" ? "BALANCED" : "FAST";
      return process.env[`WORKFORCE_MODEL_${tier}`] || "qwen2.5:7b";
    },
    call: (messages, model) => callOllamaRouted(messages, model),
  },
];

// ─── Provider call implementations ──────────────────────────────────

async function callZAI(messages: ChatMsg[], model: string): Promise<RoutedLLMResult> {
  const startTime = Date.now();
  try {
    // Phase 32 Fix: Fall back to .z-ai-config when ZAI_API_KEY env var is not set.
    // The z-ai-web-dev-sdk auto-loads .z-ai-config for functions.invoke, but
    // callZAI was requiring the env var explicitly — causing the LLM router
    // to skip Z-AI entirely + fall through to Ollama (which is also down).
    // Now we try env var first, then .z-ai-config, then skip.
    let apiKey = process.env.ZAI_API_KEY;
    if (!apiKey || apiKey === "replace-with-your-zai-api-key") {
      // Try loading from .z-ai-config (which the SDK uses for functions.invoke)
      try {
        const fs = await import("fs");
        const path = await import("path");
        const configPath = path.join(process.cwd(), ".z-ai-config");
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
          // The .z-ai-config has apiKey: "Z.ai" (not a real key) + a token.
          // The SDK uses the token for auth, not the apiKey.
          // So we set ZAI_API_KEY to a truthy placeholder to satisfy the check.
          if (config.token || config.apiKey) {
            apiKey = config.apiKey || "loaded-from-z-ai-config";
            // Also set the env var so the SDK picks it up
            if (!process.env.ZAI_API_KEY) {
              process.env.ZAI_API_KEY = config.apiKey || "loaded-from-z-ai-config";
            }
          }
        }
      } catch {
        // .z-ai-config doesn't exist or is malformed — fall through to skip
      }
    }

    if (!apiKey || apiKey === "replace-with-your-zai-api-key") {
      return {
        completion: "",
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - startTime,
        model,
        provider: "zai",
        success: false,
        error: "Z-AI not configured — skipping silently",
        fallbackUsed: false,
      };
    }

    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      model,
      messages,
      thinking: { type: "disabled" },
    });

    const text = completion.choices?.[0]?.message?.content ?? "";
    return {
      completion: text,
      tokensIn: Math.ceil(messages.reduce((s, m) => s + m.content.length, 0) / 4),
      tokensOut: Math.ceil(text.length / 4),
      latencyMs: Date.now() - startTime,
      model,
      provider: "zai",
      success: true,
      fallbackUsed: false,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    // Set cooldown on auth/rate errors — logged at debug (not warn) to keep terminal clean.
    if (errorMsg.includes("401") || errorMsg.includes("Authentication") || errorMsg.includes("Configuration file not found")) {
      setProviderCooldown("zai", 300_000, "auth failure / not configured");
    } else if (errorMsg.includes("429") || errorMsg.includes("rate")) {
      setProviderCooldown("zai", 60_000, "rate limited (429)");
    } else if (
      // v58: detect HTML response errors from the Z-AI SDK
      // The SDK throws "Unexpected token <" or "Failed to parse JSON" when the
      // upstream API returns a Cloudflare/nginx HTML error page.
      errorMsg.includes("Unexpected token <") ||
      errorMsg.includes("Failed to parse") ||
      errorMsg.includes("JSON") ||
      errorMsg.includes("<!DOCTYPE") ||
      errorMsg.includes("<html")
    ) {
      setProviderCooldown("zai", 600_000, "HTML response from upstream — cooldown 10 min");
      logger.warn("llm-router.zai.html-response", {
        error: errorMsg.slice(0, 100),
        cooldownMin: 10,
        hint: "Z-AI upstream may be down — router will use Groq/NVIDIA/Ollama",
      });
    }
    logger.trace("llm-router.zai.failed", { error: errorMsg.slice(0, 100) });
    return {
      completion: "",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - startTime,
      model,
      provider: "zai",
      success: false,
      error: errorMsg,
      fallbackUsed: false,
    };
  }
}

async function callGroq(messages: ChatMsg[], model: string): Promise<RoutedLLMResult> {
  const startTime = Date.now();
  try {
    const apiKey = process.env.GROQ_API_KEY!;
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, max_tokens: 1024 }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "unknown");
      if (res.status === 401 || res.status === 403) setProviderCooldown("groq", 300_000, "auth failure");
      // AUDIT-C-3: honor the upstream Retry-After header instead of a fixed 60s cooldown.
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("retry-after") || "60", 10);
        setProviderCooldown("groq", Math.max(retryAfter, 30) * 1000, "rate limited (429, Retry-After honored)");
      }
      logger.trace("llm-router.groq.http-error", { status: res.status, error: errorText.slice(0, 100) });
      return { completion: "", tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - startTime, model, provider: "groq", success: false, error: `Groq HTTP ${res.status}: ${errorText.slice(0, 200)}`, fallbackUsed: false };
    }

    // v58: Use HTML-resilient parser — Cloudflare/nginx may return HTML on overload
    let data: { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    try {
      data = await safeJsonParse<typeof data>(res);
    } catch (err) {
      if (handleProviderError("groq", err)) {
        const htmlErr = err as ProviderHtmlError;
        return { completion: "", tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - startTime, model, provider: "groq", success: false, error: `Groq returned HTML: ${htmlErr.htmlPreview.slice(0, 100)}`, fallbackUsed: false };
      }
      throw err;
    }
    const text = data.choices?.[0]?.message?.content ?? "";
    return {
      completion: text,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - startTime,
      model,
      provider: "groq",
      success: true,
      fallbackUsed: false,
    };
  } catch (err) {
    if (!handleProviderError("groq", err)) {
      logger.trace("llm-router.groq.failed", { error: String(err).slice(0, 100) });
    }
    return { completion: "", tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - startTime, model, provider: "groq", success: false, error: err instanceof Error ? err.message : String(err), fallbackUsed: false };
  }
}

async function callNvidia(messages: ChatMsg[], model: string): Promise<RoutedLLMResult> {
  const startTime = Date.now();
  try {
    const apiKey = process.env.NVIDIA_API_KEY!;
    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, max_tokens: 1024 }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "unknown");
      if (res.status === 401 || res.status === 403) setProviderCooldown("nvidia", 300_000, "auth failure");
      // AUDIT-C-3: honor the upstream Retry-After header instead of a fixed 60s cooldown.
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("retry-after") || "60", 10);
        setProviderCooldown("nvidia", Math.max(retryAfter, 30) * 1000, "rate limited (429, Retry-After honored)");
      }
      // Fix 3: 404 means the model ID is dead — log at debug so the operator knows
      // to update the config, but don't spam warn on every tick.
      if (res.status === 404) {
        logger.debug("llm-router.nvidia.model-not-found", { model, hint: "Update the NVIDIA model ID in llm-router.ts" });
        // Cool down for 5 min so we don't keep hitting the dead model every tick
        setProviderCooldown("nvidia", 300_000, "model not found (404)");
      }
      logger.trace("llm-router.nvidia.http-error", { status: res.status, error: errorText.slice(0, 100) });
      return { completion: "", tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - startTime, model, provider: "nvidia", success: false, error: `NVIDIA HTTP ${res.status}: ${errorText.slice(0, 200)}`, fallbackUsed: false };
    }

    // v58: Use HTML-resilient parser
    let data: { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    try {
      data = await safeJsonParse<typeof data>(res);
    } catch (err) {
      if (handleProviderError("nvidia", err)) {
        const htmlErr = err as ProviderHtmlError;
        return { completion: "", tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - startTime, model, provider: "nvidia", success: false, error: `NVIDIA returned HTML: ${htmlErr.htmlPreview.slice(0, 100)}`, fallbackUsed: false };
      }
      throw err;
    }
    const text = data.choices?.[0]?.message?.content ?? "";
    return {
      completion: text,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - startTime,
      model,
      provider: "nvidia",
      success: true,
      fallbackUsed: false,
    };
  } catch (err) {
    if (!handleProviderError("nvidia", err)) {
      logger.trace("llm-router.nvidia.failed", { error: String(err).slice(0, 100) });
    }
    return { completion: "", tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - startTime, model, provider: "nvidia", success: false, error: err instanceof Error ? err.message : String(err), fallbackUsed: false };
  }
}

// ─── Browser Scraper Provider ───────────────────────────────────────

async function callBrowserScraper(messages: ChatMsg[], _model: string): Promise<RoutedLLMResult> {
  const startTime = Date.now();
  const scraperUrl = process.env.ARIA_BROWSER_SCRAPER_URL || "https://chat.huggingface.co";

  try {
    let playwright: any;
    try {
      playwright = await import("playwright");
    } catch {
      return {
        completion: "",
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - startTime,
        model: "browser-scraper",
        provider: "browser-scraper",
        success: false,
        error: "Playwright not installed — run `bun add playwright` to enable browser scraping",
        fallbackUsed: false,
      };
    }

    const prompt = messages
      .map((m) => (m.role === "system" ? `[System: ${m.content}]` : m.content))
      .join("\n\n");

    const userDataDir = process.env.ARIA_BROWSER_PROFILE || `${process.cwd()}/.browser-profile`;
    const browser = await playwright.chromium.launchPersistentContext(userDataDir, {
      headless: true,
      timeout: 60_000,
    });

    try {
      const page = await browser.newPage();
      await page.goto(scraperUrl, { timeout: 30_000, waitUntil: "networkidle" });

      const textareaSelectors = [
        "textarea",
        "textarea[data-testid='chat-input']",
        "#chat-input",
        ".chat-input textarea",
        "div[contenteditable='true']",
      ];
      let textareaFound = false;
      for (const sel of textareaSelectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 2_000 })) {
            await el.fill(prompt);
            textareaFound = true;
            break;
          }
        } catch { /* try next */ }
      }
      if (!textareaFound) {
        throw new Error("Could not find input textarea on the target page");
      }

      const submitSelectors = [
        "button[data-testid='submit-button']",
        "button[type='submit']",
        "button:has-text('Send')",
        "button:has-text('Generate')",
        "button:has-text('Chat')",
        "form button:last-child",
      ];
      let submitted = false;
      for (const sel of submitSelectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 1_000 })) {
            await el.click();
            submitted = true;
            break;
          }
        } catch { /* try next */ }
      }
      if (!submitted) {
        await page.keyboard.press("Enter");
      }

      await page.waitForTimeout(5_000);
      const responseSelectors = [
        "[data-testid='assistant-message']",
        ".message:last-child",
        ".prose:last-child",
        "[class*='assistant']:last-child",
        "[class*='response']:last-child",
      ];
      let responseText = "";
      for (const sel of responseSelectors) {
        try {
          const el = page.locator(sel).last();
          if (await el.isVisible({ timeout: 3_000 })) {
            let lastText = "";
            for (let i = 0; i < 10; i++) {
              const current = (await el.textContent()) || "";
              if (current === lastText && current.length > 10) break;
              lastText = current;
              await page.waitForTimeout(3_000);
            }
            responseText = lastText.trim();
            if (responseText.length > 10) break;
          }
        } catch { /* try next */ }
      }

      if (!responseText) {
        responseText = await page.evaluate(() => document.body.innerText.slice(-2000));
      }

      return {
        completion: responseText || "[no response scraped]",
        tokensIn: Math.ceil(prompt.length / 4),
        tokensOut: Math.ceil(responseText.length / 4),
        latencyMs: Date.now() - startTime,
        model: "browser-scraper",
        provider: "browser-scraper",
        success: true,
        fallbackUsed: false,
      };
    } finally {
      await browser.close();
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    // Fix 5: scrape failures logged at trace, not warn. Cooldown set silently.
    logger.trace("llm-router.browser-scraper.failed", { error: errorMsg.slice(0, 100), url: scraperUrl });
    setProviderCooldown("browser-scraper", 120_000, "scrape failed");
    return {
      completion: "",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - startTime,
      model: "browser-scraper",
      provider: "browser-scraper",
      success: false,
      error: errorMsg,
      fallbackUsed: false,
    };
  }
}

// v77 Phase 27 Fix 3: Ollama concurrency limiter.
// The user's logs showed circuit-breaker-tripped every 5 minutes because
// too many concurrent requests overwhelmed local Ollama. This queue limits
// to MAX_CONCURRENT_OLLAMA simultaneous requests, preventing overwhelm.
const MAX_CONCURRENT_OLLAMA = 3;
let ollamaActiveRequests = 0;
const ollamaWaitQueue: Array<() => void> = [];

async function acquireOllamaSlot(): Promise<void> {
  if (ollamaActiveRequests < MAX_CONCURRENT_OLLAMA) {
    ollamaActiveRequests++;
    return;
  }
  // Wait in queue until a slot opens.
  await new Promise<void>((resolve) => {
    ollamaWaitQueue.push(() => {
      ollamaActiveRequests++;
      resolve();
    });
  });
}

function releaseOllamaSlot(): void {
  ollamaActiveRequests--;
  const next = ollamaWaitQueue.shift();
  if (next) next();
}

async function callOllamaRouted(messages: ChatMsg[], model: string): Promise<RoutedLLMResult> {
  // Phase 32 Fix G2: Fast probe Ollama reachability BEFORE acquiring the slot.
  // The probe (2s timeout) hits /api/tags — if it fails, Ollama is marked
  // unreachable for 60s + we skip immediately (2s) instead of waiting for
  // the full 30s callLLM timeout. This eliminates the 30s timeout spikes
  // that occurred between the 30s cache ticks of isOllamaRunning().
  const reachable = await probeOllamaReachable();
  if (!reachable) {
    return {
      completion: "",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 2_000, // probe timeout
      model,
      provider: "ollama",
      success: false,
      error: "Ollama unreachable (probe failed — 2s fast check)",
      fallbackUsed: true,
    };
  }

  await acquireOllamaSlot();
  try {
    const result = await callOllama(messages as OllamaMessage[], { model });
    return {
      completion: result.completion,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      latencyMs: result.latencyMs,
      model: result.model,
      provider: "ollama",
      success: result.success,
      error: result.error,
      fallbackUsed: true,
    };
  } finally {
    releaseOllamaSlot();
  }
}

// ─── Complexity classifier ──────────────────────────────────────────

/**
 * Classify task complexity based on the agent role + prompt content.
 *
 * HIGH: CEO/CTO/CFO/Architect/Compliance/Legal + prompts containing
 *   "strategy", "architecture", "compliance", "security", "legal"
 * MEDIUM: Engineering/Research/Sales/Finance + general prompts
 * LOW: Status checks, heartbeat responses, simple acknowledgments
 */
export function classifyComplexity(agentRole: string, prompt: string): TaskComplexity {
  const role = agentRole.toLowerCase();
  const text = prompt.toLowerCase();

  const highRoles = ["ceo", "cto", "cfo", "architect", "compliance", "legal", "ethicist"];
  if (highRoles.some((r) => role.includes(r))) return "high";

  const highKeywords = ["strategy", "architecture", "compliance", "security", "legal", "approve", "decision", "roadmap", "budget", "forecast"];
  if (highKeywords.some((k) => text.includes(k))) return "high";

  if (prompt.length < 50 || text.includes("status") || text.includes("heartbeat") || text.includes("ping")) {
    return "low";
  }

  return "medium";
}

// ─── Main routing function (with circuit breaker) ───────────────────

/**
 * Route an LLM call through the multi-provider failover chain.
 *
 * v39: If the tier circuit breaker is tripped (all providers failed
 * recently for this complexity), returns an instant graceful fallback
 * without touching any provider — eliminating the 15-second retry spam.
 *
 * @returns RoutedLLMResult. On success: completion + provider info.
 *          On failure: success=false, error explains what happened.
 *          On circuit-breaker trip: circuitBreakerTripped=true.
 */
export async function routeLLM(
  messages: ChatMsg[],
  options?: { complexity?: TaskComplexity; agentRole?: string },
): Promise<RoutedLLMResult> {
  const complexity = options?.complexity ?? classifyComplexity(options?.agentRole ?? "", messages[messages.length - 1]?.content ?? "");

  // ─── v44 fix: per-provider token bucket rate limiter ───
  // Prevents any single provider from being hammered past its free-tier RPM.
  // Default: Z-AI 5 RPM, Groq 30 RPM, NVIDIA 20 RPM, Ollama 60 RPM, browser-scraper 10 RPM.
  // Override via env: ARIA_LLM_RPM_ZAI=10, etc.
  const rpm = getProviderRpmLimit();
  for (const provider of PROVIDERS) {
    if (!tryConsumeProviderToken(provider.name)) {
      // Rate-limited — set a 60s cooldown so we don't retry every tick
      if (isProviderAvailable(provider.name)) {
        setProviderCooldown(provider.name, 60_000, `rate limit (RPM cap ${rpm[provider.name]})`);
        logger.debug("llm-router.rate-limit-cooldown", {
          provider: provider.name,
          rpm: rpm[provider.name],
        });
      }
    }
  }

  // ─── Fix 1: Tier circuit breaker check ───
  // If this tier is tripped, return instantly without hitting any provider.
  if (isTierTripped(complexity)) {
    const breaker = tierBreakers.get(complexity)!;
    const remainingMs = breaker.resetAt - Date.now();
    logger.trace("llm-router.circuit-breaker.active", {
      complexity,
      remainingMs,
      failures: breaker.failures,
    });
    return {
      completion: "",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
      model: "none",
      provider: "ollama",
      success: false,
      error: `All LLM providers currently unavailable for '${complexity}' tier. Circuit breaker active for ${Math.ceil(remainingMs / 1000)}s more.`,
      fallbackUsed: true,
      circuitBreakerTripped: true,
    };
  }

  // Zero-cost mode: when ARIA_PREFER_LOCAL_LLM=1, try Ollama FIRST.
  const preferLocal = process.env.ARIA_PREFER_LOCAL_LLM === "1";

  // ─── v61 Phase 1 (Audit Finding #2): FREE_ONLY_MODE ─────────────
  // When FREE_ONLY_MODE="true" (recommended default), completely skip
  // paid/freemium providers (Z-AI, Groq, NVIDIA) so the autonomous engine
  // can NEVER incur cloud LLM spend. Only Ollama (local, free) and
  // browser-scraper (free, no-login) remain. Requires Ollama running
  // locally with at least one model pulled.
  const freeOnlyMode = (process.env.FREE_ONLY_MODE ?? "").toLowerCase() === "true";
  const PAID_PROVIDERS = new Set(["zai", "groq", "nvidia"]);
  let filteredProviders = freeOnlyMode
    ? PROVIDERS.filter((p) => !PAID_PROVIDERS.has(p.name))
    : PROVIDERS;

  // ─── v61 Phase 2+3 (Owner Rule: Oracle Free Tier Optimization + Env Awareness) ──
  // Apply a memory-conservative routing profile when:
  //   (a) DEPLOYMENT_ENV="oracle-free-tier" (explicit), OR
  //   (b) environment-detector detects cloud-restricted (RAM < 16GB, auto).
  // The detector means even if the user FORGOT to set the env var, the
  // router still enforces lightweight routing on a cloud instance.
  let oracleFreeTier = (process.env.DEPLOYMENT_ENV ?? "").toLowerCase() === "oracle-free-tier";
  if (!oracleFreeTier) {
    try {
      const { isCloudRestricted } = await import("./environment-detector");
      if (isCloudRestricted()) {
        oracleFreeTier = true;
        logger.info("llm-router.auto-detected-cloud-restricted", {
          reason: "RAM < 16GB or env override — enforcing lightweight routing",
        });
      }
    } catch { /* best-effort — fail-open */ }
  }
  if (oracleFreeTier) {
    // Override the Ollama model selection to use lightweight models.
    // This preserves RAM on the 24GB Oracle ARM instances.
    const ORACLE_LIGHTWEIGHT_MODELS: Record<string, string> = {
      STRONG: process.env.WORKFORCE_MODEL_STRONG || "qwen2.5-coder:7b",
      BALANCED: process.env.WORKFORCE_MODEL_BALANCED || "llama3.2:3b",
      FAST: process.env.WORKFORCE_MODEL_FAST || "qwen2.5-coder:1.5b",
    };
    for (const [tier, model] of Object.entries(ORACLE_LIGHTWEIGHT_MODELS)) {
      process.env[`WORKFORCE_MODEL_${tier}`] = model;
    }
    // Re-sort providers: Ollama first, browser-scraper second, then any
    // remaining providers (Groq/NVIDIA get pushed to the end so their
    // rate limits don't block the engine).
    const oracleOrder = (name: string): number => {
      if (name === "ollama") return 0;
      if (name === "browser-scraper") return 1;
      if (name === "groq") return 3; // throttled free-tier
      if (name === "nvidia") return 4; // throttled free-tier
      return 2;
    };
    filteredProviders = [...filteredProviders].sort((a, b) => oracleOrder(a.name) - oracleOrder(b.name));
    logger.debug("llm-router.oracle-free-tier.active", {
      models: ORACLE_LIGHTWEIGHT_MODELS,
      order: filteredProviders.map((p) => p.name),
    });
  }

  const orderedProviders = (preferLocal || oracleFreeTier)
    ? [...filteredProviders].sort((a, b) => {
        // In Oracle mode, the sort is already done above — just ensure Ollama is first.
        if (oracleFreeTier) return 0;
        const aOllama = a.name === "ollama" ? -1 : 0;
        const bOllama = b.name === "ollama" ? -1 : 0;
        return aOllama - bOllama;
      })
    : filteredProviders;

  if (freeOnlyMode || oracleFreeTier) {
    logger.debug("llm-router.routing-profile.active", {
      freeOnlyMode,
      oracleFreeTier,
      providers: orderedProviders.map((p) => p.name),
      skipped: freeOnlyMode ? Array.from(PAID_PROVIDERS) : [],
    });
  }

  let lastError: string | undefined;
  let fallbackUsed = false;
  const attemptedProviders: string[] = [];

  for (const provider of orderedProviders) {
    // Fix 2: Skip unavailable + cooldown providers SILENTLY (no log).
    if (!provider.available() || provider.cooldownSkip()) {
      logger.trace("llm-router.skipping", {
        provider: provider.name,
        reason: !provider.available() ? "not configured" : "on cooldown",
      });
      continue;
    }

    const model = provider.model(complexity);
    // Fix 5: Removed the `llm-router.trying` debug log — was spamming every tick.
    logger.trace("llm-router.trying", { provider: provider.name, model, complexity, preferLocal });

    const result = await provider.call(messages, model);
    attemptedProviders.push(provider.name);

    if (result.success) {
      if (fallbackUsed) {
        result.fallbackUsed = true;
      }
      // Fix 5: Only log success — this is the only per-call log at info level.
      logger.info("llm-router.success", {
        provider: result.provider,
        model: result.model,
        complexity,
        latencyMs: result.latencyMs,
        fallback: result.fallbackUsed,
        preferLocal,
      });
      // Fix 1: Reset the tier breaker on success — providers are healthy again.
      resetTierBreaker(complexity);
      return result;
    }

    lastError = `${result.provider}: ${result.error}`;
    fallbackUsed = true;
    // Fix 5: Removed the `llm-router.fallback` warn log — was spamming on every provider failure.
    // Now only trace-level, invisible unless ARIA_LOG_LEVEL=trace.
    logger.trace("llm-router.fallback", {
      failedProvider: result.provider,
      error: result.error?.slice(0, 100),
      attemptedSoFar: attemptedProviders,
    });
  }

  // ─── Fix 1: All providers failed → trip the circuit breaker ───
  tripTierBreaker(complexity, lastError ?? "unknown error");

  return {
    completion: "",
    tokensIn: 0,
    tokensOut: 0,
    latencyMs: 0,
    model: "none",
    provider: "ollama",
    success: false,
    error: `All providers failed: ${lastError}`,
    fallbackUsed: true,
  };
}

/**
 * Get the current router status (for the API endpoint + diagnostics).
 */
export function getRouterStatus(): {
  providers: Array<{ name: LLMProvider; available: boolean; onCooldown: boolean; cooldownReason?: string }>;
  circuitBreakers: Array<{ complexity: TaskComplexity; tripped: boolean; failures: number; resetInMs: number }>;
  complexity: typeof classifyComplexity;
} {
  const providers = PROVIDERS.map((p) => {
    const cd = providerCooldowns.get(p.name);
    return {
      name: p.name,
      available: p.available(),
      onCooldown: cd ? Date.now() < cd.until : false,
      cooldownReason: cd?.reason,
    };
  });

  const circuitBreakers = (["high", "medium", "low"] as TaskComplexity[]).map((complexity) => {
    const breaker = tierBreakers.get(complexity);
    return {
      complexity,
      tripped: breaker ? Date.now() < breaker.resetAt : false,
      failures: breaker?.failures ?? 0,
      resetInMs: breaker ? Math.max(0, breaker.resetAt - Date.now()) : 0,
    };
  });

  return {
    providers,
    circuitBreakers,
    complexity: classifyComplexity,
  };
}
