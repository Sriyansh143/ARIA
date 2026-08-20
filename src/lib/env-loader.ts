/**
 * src/lib/env-loader.ts — Hot-Reload Environment Configuration
 *
 * Re-reads the .env file every 5 seconds and updates process.env in place.
 * If any key changes, the new value is immediately available to all code
 * that reads process.env dynamically.
 *
 * Also updates .z-ai-config when ZAI_API_KEY or ZAI_BASE_URL change, and
 * invalidates the cached ZAI SDK instance so the next callLLM() picks up
 * the new key.
 *
 * This allows operators to rotate API keys, switch LLM providers, or
 * update Telegram tokens WITHOUT restarting the server — just edit .env
 * and within 5 seconds the new values are live.
 */
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { logger } from "./logger";

const ENV_DEFAULTS_FILE = path.join(process.cwd(), ".env.defaults");
const ENV_FILE = path.join(process.cwd(), ".env");
const ZAI_CONFIG_FILE = path.join(process.cwd(), ".z-ai-config");
const RELOAD_INTERVAL_MS = 5_000;

// ─── Idempotent singleton state ─────────────────────────────────────
const globalForEnv = globalThis as unknown as {
  __ariaEnvLoader?: { timer: NodeJS.Timeout | null; started: boolean; defaultsLoaded: boolean };
};
const envLoaderState =
  globalForEnv.__ariaEnvLoader ?? {
    timer: null as NodeJS.Timeout | null,
    started: false,
    defaultsLoaded: false,
  };
if (!globalForEnv.__ariaEnvLoader) globalForEnv.__ariaEnvLoader = envLoaderState;

/**
 * Load `.env.defaults` ONCE on first start. Values are only set if the
 * key is not already present in `process.env` (so explicit env vars
 * always win, and `.env` overrides `.env.defaults`). This guarantees
 * the app can boot with zero cloud keys and zero operator config.
 */
function loadEnvDefaultsOnce(): void {
  if (envLoaderState.defaultsLoaded) return;
  envLoaderState.defaultsLoaded = true;
  const defaults = parseEnvFile(ENV_DEFAULTS_FILE);
  let applied = 0;
  for (const [key, value] of Object.entries(defaults)) {
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
      applied++;
    }
  }
  if (applied > 0) {
    logger.info("env-loader.defaults.applied", { count: applied, file: ENV_DEFAULTS_FILE });
  }
}

/**
 * Parse a .env file into a key-value object.
 * Handles: comments (#), KEY=VALUE, quoted values, empty lines.
 */
function parseEnvFile(filePath: string): Record<string, string> {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const result: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();

      // v60 fix: Handle quoted values with inline comments.
      //   KEY="value"          # comment  → "value"
      //   KEY='value'          # comment  → 'value'
      //   KEY=value            # comment  → value
      //   KEY="value with #"
      //
      // The old parser only stripped quotes if value started AND ended with
      // a quote — but a value like `"file:./db"  # comment` ends with the
      // comment text, not the closing quote, so the quotes were left in
      // place + the comment was appended to the value. This broke Prisma
      // (DATABASE_URL became `"file:./db"  # comment` — invalid format).
      if (value.startsWith('"')) {
        // Find the matching closing quote
        const closeIdx = value.indexOf('"', 1);
        if (closeIdx > 0) {
          value = value.slice(1, closeIdx);
        }
      } else if (value.startsWith("'")) {
        const closeIdx = value.indexOf("'", 1);
        if (closeIdx > 0) {
          value = value.slice(1, closeIdx);
        }
      } else {
        // Unquoted — strip inline comment (everything after the first `#`)
        const hashIdx = value.indexOf(" #");
        if (hashIdx > 0) {
          value = value.slice(0, hashIdx).trim();
        }
        // Also handle `KEY=value#comment` (no space before #)
        const hashIdx2 = value.indexOf("#");
        if (hashIdx2 > 0 && !value.startsWith("#")) {
          value = value.slice(0, hashIdx2).trim();
        }
      }
      result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Update .z-ai-config when ZAI keys change.
 * Also invalidate the cached ZAI SDK instance so the next getZAI() call
 * creates a fresh instance with the new key.
 */
function updateZaiConfig(env: Record<string, string>): void {
  const apiKey = env.ZAI_API_KEY;
  const baseUrl = env.ZAI_BASE_URL || "https://api.z.ai/api/paas/v4";
  if (!apiKey) return;

  const config = JSON.stringify({ baseUrl, apiKey }, null, 2);

  try {
    const existing = fs.existsSync(ZAI_CONFIG_FILE)
      ? fs.readFileSync(ZAI_CONFIG_FILE, "utf-8")
      : "";
    if (existing.trim() !== config.trim()) {
      fs.writeFileSync(ZAI_CONFIG_FILE, config, "utf-8");
      // AUDIT-C-5: never log raw key bytes — even the prefix can reveal the
      // provider/owner. Log only a SHA-256 fingerprint.
      const fingerprint = createHash("sha256").update(apiKey).digest("hex").slice(0, 8);
      logger.info("env-loader.zai-config.updated", { baseUrl, keyFingerprint: fingerprint });

      // Invalidate cached ZAI instance so next callLLM() creates a new one.
      const g = globalThis as unknown as { __zaiInstance?: unknown };
      g.__zaiInstance = undefined;
    }
  } catch (err) {
    logger.warn("env-loader.zai-config.write-failed", { error: String(err) });
  }
}

/**
 * Reload env vars from .env file. Updates process.env in place.
 * Returns the list of changed keys (empty if nothing changed).
 */
export function reloadEnv(): string[] {
  const parsed = parseEnvFile(ENV_FILE);
  const changed: string[] = [];

  for (const [key, value] of Object.entries(parsed)) {
    const prev = process.env[key];
    if (prev !== value) {
      process.env[key] = value;
      changed.push(key);
    }
  }

  if (changed.length > 0) {
    // Log the changed keys (mask sensitive values)
    const masked = changed.map((k) => {
      const v = process.env[k] ?? "";
      const isSensitive = /SECRET|KEY|TOKEN|PASSWORD|PASS|API/i.test(k);
      // AUDIT-C-7: log *** for sensitive values — never the prefix (6 chars is
      // enough to leak a key prefix or partial token into log aggregators).
      return `${k}=${isSensitive ? "***" : v}`;
    });
    logger.info("env-loader.changed", { count: changed.length, keys: masked });

    // Update .z-ai-config if ZAI keys changed
    if (changed.includes("ZAI_API_KEY") || changed.includes("ZAI_BASE_URL")) {
      updateZaiConfig(parsed);
    }
  }

  return changed;
}

/**
 * Start the env hot-reload loop. Checks every 5 seconds.
 * Idempotent — safe to call multiple times; only one timer runs.
 *
 * On each tick:
 *   1. Re-read .env file
 *   2. Compare with current process.env
 *   3. Update any changed keys in process.env
 *   4. If ZAI keys changed, rewrite .z-ai-config + invalidate ZAI cache
 *
 * Failures are logged but never crash the loop.
 */
export function startEnvLoader(intervalMs: number = RELOAD_INTERVAL_MS): void {
  if (envLoaderState.started) {
    logger.debug("env-loader.already-running");
    return;
  }
  envLoaderState.started = true;

  // Load `.env.defaults` first so subsequent .env values override them.
  loadEnvDefaultsOnce();
  // Initial load (synchronous — ensures env is fresh before first LLM call)
  reloadEnv();

  // Poll every 5 seconds
  envLoaderState.timer = setInterval(() => {
    try {
      reloadEnv();
    } catch (err) {
      logger.error("env-loader.error", { error: String(err) });
    }
  }, intervalMs);

  logger.info("env-loader.started", {
    intervalMs,
    file: ENV_FILE,
  });
}

/** Stop the env loader loop (mostly for tests). */
export function stopEnvLoader(): void {
  if (envLoaderState.timer) {
    clearInterval(envLoaderState.timer);
    envLoaderState.timer = null;
  }
  envLoaderState.started = false;
}

/** Returns the loader status (for the API). */
export function getEnvLoaderStatus(): {
  started: boolean;
  intervalMs: number;
  envFile: string;
} {
  return {
    started: envLoaderState.started,
    intervalMs: RELOAD_INTERVAL_MS,
    envFile: ENV_FILE,
  };
}
