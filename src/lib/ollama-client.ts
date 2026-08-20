/**
 * src/lib/ollama-client.ts — Ollama LLM Client (fallback provider)
 *
 * v39 fixes (Principal Backend Engineer refactor):
 *   - All per-tick logs demoted to `trace`/`debug` — the terminal is
 *     now silent when Ollama is not running or a model is missing.
 *     Only boot events (auto-detect, auto-pull start/complete) log
 *     at `info`; everything else is invisible unless
 *     ARIA_LOG_LEVEL=trace.
 *   - `isOllamaRunning()` no longer warns on every 30s cache refresh
 *     when Ollama is down — was the #1 source of log spam.
 *   - `markOllamaUnreachable()` + `call.failed` demoted to `debug`.
 *
 * v32 fixes (retained):
 *   - AbortController + setTimeout pattern (universal runtime support).
 *   - `isOllamaRunning()` liveness probe with 30s cache.
 *   - `ensureOllamaModel()` auto-pull with dedup.
 *   - 10s unreachable cooldown (was 30s).
 */
import { logger } from "./logger";
import { exec, execFile } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
// AUDIT-C-4: use execFile (no shell) for ollama pull — model names can contain
// shell metacharacters if a compromised local Ollama returns a malicious name
// or an operator sets WORKFORCE_MODEL_* via command substitution.
const execFileAsync = promisify(execFile);

export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaResult {
  completion: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  model: string;
  provider: "ollama";
  success: boolean;
  error?: string;
}

function getOllamaHost(): string {
  // Strip trailing slash for consistent URL joining.
  const host = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
  return host.replace(/\/$/, "");
}

function getModelForTier(tier: "strong" | "balanced" | "fast"): string {
  const envVar = `WORKFORCE_MODEL_${tier.toUpperCase()}`;
  return process.env[envVar] || "qwen2.5:7b";
}

/**
 * Fetch with timeout — works in ALL Node.js runtimes (no AbortSignal.timeout).
 * Returns `{ok, data, status}` or `{ok:false, error}` on timeout/failure.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number,
): Promise<{ ok: boolean; data?: unknown; status?: number; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, data, status: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Distinguish "aborted" (timeout) from "fetch failed" (connection refused)
    if (msg.includes("aborted") || msg.includes("AbortError")) {
      return { ok: false, error: `timeout after ${timeoutMs}ms` };
    }
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check if Ollama is reachable + responding.
 * Uses a 3-second timeout so this doesn't block if Ollama isn't running.
 *
 * This is the CORRECT liveness check — the old `isOllamaAvailable()` used
 * `AbortController` correctly but the router was ignoring its result. Now
 * the router calls this directly before each Ollama attempt.
 */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const host = getOllamaHost();
    const result = await fetchWithTimeout(`${host}/api/tags`, {}, 3_000);
    return result.ok;
  } catch {
    return false;
  }
}

/**
 * Check if Ollama is running — cached for 30 seconds so we don't
 * probe on every single LLM call. This is the function the router
 * should call to decide whether to try Ollama.
 */
let ollamaRunningCache: { value: boolean; checkedAt: number } | null = null;
const OLLAMA_CHECK_CACHE_MS = 30_000;

export async function isOllamaRunning(): Promise<boolean> {
  // Return cached result if fresh
  if (ollamaRunningCache && Date.now() - ollamaRunningCache.checkedAt < OLLAMA_CHECK_CACHE_MS) {
    return ollamaRunningCache.value;
  }
  const running = await isOllamaAvailable();
  ollamaRunningCache = { value: running, checkedAt: Date.now() };
  // Fix 5: Demoted from `warn` to `debug` — was spamming every 30s cache
  // refresh when Ollama isn't installed. The router handles the skip silently.
  if (!running) {
    logger.debug("ollama.not-running", { host: getOllamaHost() });
  }
  return running;
}

/**
 * List available Ollama models.
 */
export async function listOllamaModels(): Promise<string[]> {
  try {
    const host = getOllamaHost();
    const result = await fetchWithTimeout(`${host}/api/tags`, {}, 3_000);
    if (!result.ok || !result.data) return [];
    const data = result.data as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

/**
 * v38: Auto-detect the best model for each tier based on what's actually
 * installed on the system. Called once at boot by the self-heal supervisor.
 *
 * Logic:
 *   1. Query /api/tags to list installed models
 *   2. Parse parameter counts from model names (e.g., "qwen2.5:7b" → 7)
 *   3. For STRONG: pick the largest model available
 *   4. For BALANCED: pick a medium model
 *   5. For FAST: pick the smallest model
 *   6. If no models installed, return the env var fallback (or qwen2.5:7b)
 *
 * This ensures ARIA NEVER tries to call a model that isn't installed —
 * which was the root cause of the "model not found" 404 spam.
 *
 * Returns the detected model names + sets them in process.env so the
 * rest of the app picks them up immediately.
 */
export async function autoDetectOllamaModels(): Promise<{
  strong: string;
  balanced: string;
  fast: string;
  detected: boolean;
}> {
  const models = await listOllamaModels();

  if (models.length === 0) {
    // No models installed — return env fallbacks
    return {
      strong: process.env.WORKFORCE_MODEL_STRONG || "qwen2.5:14b",
      balanced: process.env.WORKFORCE_MODEL_BALANCED || "qwen2.5:7b",
      fast: process.env.WORKFORCE_MODEL_FAST || "qwen2.5:3b",
      detected: false,
    };
  }

  // Parse parameter counts from model names.
  // Ollama model names look like: "qwen2.5:7b", "llama3.2:3b", "mistral:7b"
  const parseSize = (name: string): number => {
    const match = name.match(/(\d+(?:\.\d+)?)b/i);
    return match ? parseFloat(match[1]) : 0;
  };

  // Sort by parameter count (descending)
  const sorted = [...models].sort((a, b) => parseSize(b) - parseSize(a));

  // Pick models for each tier
  // STRONG = largest, BALANCED = medium, FAST = smallest
  let strong = sorted[0]; // largest
  let fast = sorted[sorted.length - 1]; // smallest
  let balanced = sorted[Math.floor(sorted.length / 2)] || sorted[0]; // middle

  // If only 1 model, use it for all tiers
  if (sorted.length === 1) {
    strong = balanced = fast = sorted[0];
  } else if (sorted.length === 2) {
    balanced = sorted[0]; // use larger for balanced
  }

  // Only override env vars if they're not explicitly set in .env
  // (check if the current value is the .env.defaults fallback)
  const envStrong = process.env.WORKFORCE_MODEL_STRONG;
  const envBalanced = process.env.WORKFORCE_MODEL_BALANCED;
  const envFast = process.env.WORKFORCE_MODEL_FAST;

  // If env has the default fallback values (or is empty), override with detected
  if (!envStrong || envStrong === "qwen2.5:14b") {
    process.env.WORKFORCE_MODEL_STRONG = strong;
  }
  if (!envBalanced || envBalanced === "qwen2.5:7b") {
    process.env.WORKFORCE_MODEL_BALANCED = balanced;
  }
  if (!envFast || envFast === "qwen2.5:3b") {
    process.env.WORKFORCE_MODEL_FAST = fast;
  }

  logger.info("ollama.auto-detect", {
    installed: models.length,
    models: models.join(", "),
    strong: process.env.WORKFORCE_MODEL_STRONG,
    balanced: process.env.WORKFORCE_MODEL_BALANCED,
    fast: process.env.WORKFORCE_MODEL_FAST,
  });

  return {
    strong: process.env.WORKFORCE_MODEL_STRONG || "qwen2.5:14b",
    balanced: process.env.WORKFORCE_MODEL_BALANCED || "qwen2.5:7b",
    fast: process.env.WORKFORCE_MODEL_FAST || "qwen2.5:3b",
    detected: true,
  };
}

/**
 * Check if a specific model is available locally.
 * If not, auto-pull it via `ollama pull` (runs in the background).
 *
 * v35 fix: deduplicate pulls — only ONE pull per model per process.
 * Previously, every LLM call that hit a 404 would trigger a new `ollama pull`
 * spawn, causing log spam like "model-missing.auto-pull" × 100.
 */
const pullingModels = new Set<string>();
const availableModelsCache = new Map<string, boolean>();
let availableModelsCacheAt = 0;
const MODEL_CACHE_TTL_MS = 60_000; // 1 min — don't re-query /api/tags on every call

export async function ensureOllamaModel(model: string): Promise<boolean> {
  // Check the cache first (1 min TTL) to avoid hitting /api/tags on every call.
  if (Date.now() - availableModelsCacheAt < MODEL_CACHE_TTL_MS) {
    const cached = availableModelsCache.get(model);
    if (cached !== undefined) return cached;
  }

  try {
    const models = await listOllamaModels();
    availableModelsCacheAt = Date.now();
    const modelBase = model.split(":")[0];
    const isAvailable = models.some((m) => m === model || m.startsWith(modelBase + ":") || m === modelBase);
    availableModelsCache.set(model, isAvailable);

    if (isAvailable) {
      return true; // model already available
    }

    // Model missing — auto-pull ONCE per process (deduplicated via Set).
    if (!pullingModels.has(model)) {
      pullingModels.add(model);
      logger.info("ollama.auto-pull.start", { model, reason: "missing" });
      execFileAsync("ollama", ["pull", model], { timeout: 600_000 })
        .then(() => {
          logger.info("ollama.auto-pull.complete", { model });
          availableModelsCache.set(model, true); // update cache
          pullingModels.delete(model);
        })
        .catch((err) => {
          // Demoted to debug — a failed pull is retried on next 404, no need to spam.
          logger.debug("ollama.auto-pull.failed", { model, error: String(err).slice(0, 100) });
          pullingModels.delete(model);
        });
    } else {
      // Already pulling — don't log anything (prevents spam)
      logger.debug("ollama.auto-pull.already-pulling", { model });
    }

    return false; // not available yet, but pulling
  } catch {
    return false;
  }
}

let lastOllamaLatencyMs: number | null = null;
const OLLAMA_TIMEOUT_MS = 30_000; // 30s — was 120s (2 min). Large models on CPU can still complete in 30s.
const OLLAMA_PROBE_TIMEOUT_MS = 2_000; // 2s fast probe to detect unreachable Ollama

let ollamaUnreachable = false;
let ollamaUnreachableUntil = 0;
const OLLAMA_UNREACHABLE_COOLDOWN_MS = 60_000; // 60s — was 10s. If Ollama is down, it's usually down for a while.

export function shouldSkipOllama(): boolean {
  if (ollamaUnreachable && Date.now() < ollamaUnreachableUntil) {
    return true;
  }
  if (ollamaUnreachable && Date.now() >= ollamaUnreachableUntil) {
    ollamaUnreachable = false;
  }
  return false;
}

/**
 * Phase 32 Fix: Fast probe to check if Ollama is reachable BEFORE
 * attempting a full chat completion. This prevents the 2-minute timeout
 * spike that was occurring every ~130s when Ollama was down.
 *
 * The probe hits /api/tags (a lightweight endpoint that returns the list
 * of installed models) with a 2s timeout. If it fails, Ollama is marked
 * unreachable for 60s + the router skips to the next provider immediately.
 */
export async function probeOllamaReachable(): Promise<boolean> {
  if (shouldSkipOllama()) return false;

  const host = getOllamaHost();
  if (!host) return false;

  try {
    const res = await fetch(`${host}/api/tags`, {
      signal: AbortSignal.timeout(OLLAMA_PROBE_TIMEOUT_MS),
    });
    if (res.ok) {
      return true;
    }
    // Non-200 response — Ollama is reachable but errored.
    // Don't mark as unreachable (it might work for the next call).
    return true;
  } catch {
    // Probe failed (timeout / connection refused) — Ollama is down.
    markOllamaUnreachable();
    return false;
  }
}

export function getLastOllamaLatency(): number | null {
  return lastOllamaLatencyMs;
}

function markOllamaUnreachable(): void {
  ollamaUnreachable = true;
  ollamaUnreachableUntil = Date.now() + OLLAMA_UNREACHABLE_COOLDOWN_MS;
  // Fix 5: Demoted from `warn` to `debug` — the router skips silently.
  logger.debug("ollama.marked-unreachable", { cooldownMs: OLLAMA_UNREACHABLE_COOLDOWN_MS });
}

/**
 * Call Ollama for a chat completion.
 */
export async function callOllama(
  messages: OllamaMessage[],
  options?: { model?: string; tier?: "strong" | "balanced" | "fast" },
): Promise<OllamaResult> {
  if (shouldSkipOllama()) {
    return {
      completion: "",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
      model: options?.model || getModelForTier(options?.tier || "balanced"),
      provider: "ollama",
      success: false,
      error: "Ollama unreachable (in 60s cooldown after connection failure)",
    };
  }

  const host = getOllamaHost();
  const model = options?.model || getModelForTier(options?.tier || "balanced");
  const startTime = Date.now();

  // Pre-flight: verify Ollama is running before making the call.
  // This avoids the 2min timeout on a dead host.
  const running = await isOllamaRunning();
  if (!running) {
    markOllamaUnreachable();
    return {
      completion: "",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - startTime,
      model,
      provider: "ollama",
      success: false,
      error: `Ollama not reachable at ${host}. Is 'ollama serve' running?`,
    };
  }

  // v35: do NOT call ensureOllamaModel on every call — it caused log spam.
  // Instead, check the cache + auto-pull only on 404 (below).
  // Also: if the requested model is "strong" (qwen2.5:14b) but it's not
  // available, silently fall back to "balanced" (qwen2.5:7b) instead of
  // failing — the 7b model is good enough for most tasks.
  let effectiveModel = model;
  if (options?.tier === "strong" || model.includes("14b")) {
    const hasStrong = await ensureOllamaModel(model);
    if (!hasStrong) {
      const fallback = getModelForTier("balanced");
      const hasBalanced = await ensureOllamaModel(fallback);
      if (hasBalanced) {
        effectiveModel = fallback;
        logger.debug("ollama.strong-fallback", { requested: model, using: fallback });
      }
    }
  }

  try {
    const result = await fetchWithTimeout(
      `${host}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: effectiveModel, messages, stream: false }),
      },
      OLLAMA_TIMEOUT_MS,
    );

    const latencyMs = Date.now() - startTime;
    lastOllamaLatencyMs = latencyMs;

    if (!result.ok) {
      const errorText = typeof result.data === "string" ? result.data : JSON.stringify(result.data ?? {});
      // 404 = model not found — try pulling it ONCE (deduplicated) + log at debug
      if (result.status === 404) {
        logger.debug("ollama.model-missing", { model: effectiveModel });
        await ensureOllamaModel(effectiveModel);
      }
      return {
        completion: "",
        tokensIn: 0,
        tokensOut: 0,
        latencyMs,
        model: effectiveModel,
        provider: "ollama",
        success: false,
        error: `Ollama HTTP ${result.status}: ${errorText.slice(0, 200)}`,
      };
    }

    const data = result.data as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    const content = data.message?.content || "";
    const tokensIn =
      data.prompt_eval_count ||
      Math.ceil(messages.reduce((s, m) => s + m.content.length, 0) / 4);
    const tokensOut = data.eval_count || Math.ceil(content.length / 4);

    logger.debug("ollama.call.ok", { model: effectiveModel, tokensIn, tokensOut, latencyMs });

    return {
      completion: content,
      tokensIn,
      tokensOut,
      latencyMs,
      model: effectiveModel,
      provider: "ollama",
      success: true,
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    lastOllamaLatencyMs = latencyMs;
    const errorMsg = err instanceof Error ? err.message : "unknown error";
    // Fix 5: Demoted from `warn` to `debug` — per-call failures are expected
    // when Ollama is down; the router + circuit breaker handle the escalation.
    logger.debug("ollama.call.failed", { model: effectiveModel, error: errorMsg.slice(0, 100), latencyMs });

    if (
      errorMsg.includes("fetch failed") ||
      errorMsg.includes("ECONNREFUSED") ||
      errorMsg.includes("connect") ||
      errorMsg.includes("timeout")
    ) {
      markOllamaUnreachable();
    }

    return {
      completion: "",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs,
      model: effectiveModel,
      provider: "ollama",
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * v61.4 Phase 9: Generate an embedding for a text using Ollama's
 * nomic-embed-text model. Returns a Float32Array (768-dim for nomic-embed-text).
 *
 * This is the REAL vector embedding function — not keyword matching. Used by
 * the vector-memory module to enable semantic similarity search for the
 * Self-Improving Rules-Auditor (finding conceptually similar past failures).
 *
 * If Ollama is unavailable, returns null (the caller falls back to keyword
 * search — graceful degradation, not silent failure).
 *
 * @param text The text to embed (truncated to 8000 chars for context window).
 * @returns Float32Array of 768 dimensions, or null if Ollama is unavailable.
 */
export async function embedText(text: string): Promise<Float32Array | null> {
  if (shouldSkipOllama()) return null;
  const host = getOllamaHost();
  const model = "nomic-embed-text";
  const truncated = text.slice(0, 8000);

  try {
    const running = await isOllamaRunning();
    if (!running) return null;

    // Auto-pull nomic-embed-text if not present (it's ~270MB).
    await ensureOllamaModel(model);

    const res = await fetch(`${host}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: truncated }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return null;
    const data = await res.json() as { embedding?: number[] };
    if (!data.embedding || !Array.isArray(data.embedding)) return null;

    return new Float32Array(data.embedding);
  } catch {
    return null;
  }
}

/**
 * v61.4 Phase 9: Compute cosine similarity between two embedding vectors.
 * Returns a value in [-1, 1] where 1 = identical, 0 = orthogonal, -1 = opposite.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}
