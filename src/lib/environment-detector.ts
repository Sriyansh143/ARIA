/**
 * src/lib/environment-detector.ts — v61 Phase 3 (Environment Awareness)
 *
 * The app must always know if it's running locally (unlimited resources)
 * or in the cloud (Oracle Free Tier, strict limits) and adjust behavior
 * automatically.
 *
 * Detection order:
 *   1. DEPLOYMENT_ENV env var (explicit override).
 *   2. Available system RAM (if < 16GB total, assume cloud/restricted).
 *   3. Oracle Cloud metadata service probe (optional fallback).
 *
 * The result is injected into the LLM router + the daily plan so the
 * operator always knows which routing profile is active.
 */

import "server-only";
import os from "os";

export type Environment = "local" | "cloud-restricted";

let cachedEnv: Environment | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // re-detect every 5 min

/**
 * Detect the runtime environment.
 *
 * @returns 'local' (unlimited resources) or 'cloud-restricted' (enforce
 * lightweight routing, skip heavy APIs, preserve RAM).
 */
export function getEnvironment(): Environment {
  // Cache for 5 minutes — environment doesn't change mid-process.
  const now = Date.now();
  if (cachedEnv !== null && now - cachedAt < CACHE_TTL_MS) {
    return cachedEnv;
  }

  // 1. Explicit override via DEPLOYMENT_ENV.
  const explicit = (process.env.DEPLOYMENT_ENV ?? "").toLowerCase();
  if (explicit === "oracle-free-tier" || explicit === "cloud-restricted") {
    cachedEnv = "cloud-restricted";
    cachedAt = now;
    return cachedEnv;
  }
  if (explicit === "local" || explicit === "default") {
    cachedEnv = "local";
    cachedAt = now;
    return cachedEnv;
  }

  // 2. Check available system RAM. If < 16GB total, assume cloud/restricted.
  //    Oracle Free Tier ARM instances have 24GB RAM; AMD micro instances have 1GB.
  //    A typical local dev machine has 16GB+.
  const totalRamBytes = os.totalmem();
  const totalRamGB = totalRamBytes / (1024 * 1024 * 1024);
  if (totalRamGB < 16) {
    cachedEnv = "cloud-restricted";
    cachedAt = now;
    return cachedEnv;
  }

  // 3. (Optional fallback) Oracle Cloud metadata service probe.
  //    Oracle instances have a metadata endpoint at 169.254.169.254 (like AWS/Azure).
  //    We don't block on this — if it times out, we default to 'local' since
  //    the RAM check above already caught the common cloud case.
  //    (Left as a TODO for production hardening — requires a sync HTTP probe
  //    which we avoid in the hot path.)

  cachedEnv = "local";
  cachedAt = now;
  return cachedEnv;
}

/**
 * Returns a human-readable description of the active environment + routing profile.
 * Used by the Daily Plan + the settings panel.
 */
export function getEnvironmentStatus(): {
  environment: Environment;
  totalRamGB: number;
  routingProfile: string;
  activeModels: string;
} {
  const env = getEnvironment();
  const totalRamGB = os.totalmem() / (1024 * 1024 * 1024);
  if (env === "cloud-restricted") {
    return {
      environment: "cloud-restricted",
      totalRamGB: Math.round(totalRamGB * 10) / 10,
      routingProfile: "Oracle Free Tier (lightweight models, RAM-safe)",
      activeModels: "llama3.2:3b + qwen2.5-coder:1.5b + no-login scrapers",
    };
  }
  return {
    environment: "local",
    totalRamGB: Math.round(totalRamGB * 10) / 10,
    routingProfile: "Full (unlimited resources, all providers available)",
    activeModels: "Configured WORKFORCE_MODEL_* (default qwen2.5:7b/3b)",
  };
}

/**
 * Returns true if the current environment is cloud-restricted (enforce
 * lightweight routing even if the user forgot to set the env var).
 */
export function isCloudRestricted(): boolean {
  return getEnvironment() === "cloud-restricted";
}
