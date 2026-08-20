/**
 * src/lib/auto-bootstrap.ts — Zero-config first-run bootstrap (v58)
 *
 * On first server start (when .env is missing critical secrets), this
 * module AUTO-GENERATES them so the app can boot without manual setup.
 *
 * Generated values:
 *   - NEXTAUTH_SECRET       (32-byte base64 random)
 *   - ENCRYPTION_MASTER_KEY (32-byte hex random)
 *
 * These are written to .env on disk so they persist across restarts.
 * If the .env file is not writable (e.g., read-only deployment), the
 * values are still set in process.env for the current session — they
 * just won't survive a restart.
 *
 * Critical env vars that are NOT auto-generated (must be set by owner):
 *   - DATABASE_URL  (defaults to file:./db/custom.db)
 *   - ARIA_OWNER_EMAIL (defaults to owner@localhost)
 *   - NEXTAUTH_URL  (defaults to http://localhost:3000)
 *
 * This is invoked from src/instrumentation.ts on server boot, BEFORE
 * the Next.js app starts handling requests. So all env vars are
 * guaranteed to be set by the time any route handler runs.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { logger } from "./logger";

const AUTO_GENERATED_KEYS = [
  "NEXTAUTH_SECRET",
  "ENCRYPTION_MASTER_KEY",
] as const;

const CRITICAL_DEFAULTS: Record<string, string> = {
  DATABASE_URL: "file:./db/custom.db",
  ARIA_OWNER_EMAIL: "owner@localhost",
  NEXTAUTH_URL: "http://localhost:3000",
  JARVIS_AUTH_MODE: "single-operator",
  JARVIS_DEV_BYPASS_AUTH: "0",
  NODE_ENV: "development",
  ARIA_LOG_LEVEL: "info",
  CRYPTO_NETWORK: "BTC",
  ARIA_OUTREACH_DAILY_LIMIT: "10",
  AI_CALLER_ENABLED: "", // must be explicitly "true" to enable
  AI_CALLER_CONSENT_VERIFIED: "", // must be explicitly "true" to enable
  ALLOW_CODE_EXEC: "false",
  ALLOW_TERMINAL_EXEC: "false",
  RATE_LIMIT_DISABLED: "false",
  JARVIS_MULTI_TENANT: "false",
};

let bootstrapped = false;

/**
 * Run the bootstrap. Safe to call multiple times — only runs once.
 *
 * Order:
 *   1. If .env doesn't exist, copy from .env.example (if present)
 *   2. For each AUTO_GENERATED_KEYS key, if missing, generate + write
 *   3. For each CRITICAL_DEFAULTS key, if missing, set in process.env
 *   4. Create the db/ directory if it doesn't exist (for SQLite)
 *   5. If DATABASE_URL is sqlite + db file doesn't exist, run prisma db push
 *      (this is deferred to runtime — the first db query will trigger it)
 */
export async function autoBootstrap(): Promise<{ generated: string[]; defaulted: string[]; envFileCreated: boolean }> {
  if (bootstrapped) return { generated: [], defaulted: [], envFileCreated: false };
  bootstrapped = true;

  const cwd = process.cwd();
  const envPath = path.join(cwd, ".env");
  const envExamplePath = path.join(cwd, ".env.example");
  const generated: string[] = [];
  const defaulted: string[] = [];
  let envFileCreated = false;

  // Step 1: If .env doesn't exist, copy from .env.example
  if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
    try {
      fs.copyFileSync(envExamplePath, envPath);
      envFileCreated = true;
      logger.info("auto-bootstrap.env-copied-from-example", { path: envPath });
    } catch (err) {
      logger.warn("auto-bootstrap.env-copy-failed", { error: String(err) });
    }
  }

  // Load .env file into process.env (basic dotenv-style implementation)
  const envVars = parseEnvFile(envPath);
  for (const [key, value] of Object.entries(envVars)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  // Step 2: Auto-generate critical secrets
  let envContent = "";
  try {
    envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
  } catch {
    // ignore
  }

  for (const key of AUTO_GENERATED_KEYS) {
    if (process.env[key] && process.env[key] !== "replace-with-your-secret") continue;

    const value = key === "ENCRYPTION_MASTER_KEY"
      ? crypto.randomBytes(32).toString("hex")
      : crypto.randomBytes(32).toString("base64");

    process.env[key] = value;
    generated.push(key);

    // Persist to .env file
    const keyRegex = new RegExp(`^${key}=.*$`, "m");
    if (keyRegex.test(envContent)) {
      envContent = envContent.replace(keyRegex, `${key}=${value}`);
    } else {
      envContent += `\n${key}=${value}`;
    }
  }

  // Step 3: Apply critical defaults
  for (const [key, defaultValue] of Object.entries(CRITICAL_DEFAULTS)) {
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = defaultValue;
      defaulted.push(key);
    }
  }

  // Step 4: Write the .env file back (only if we changed something)
  if (generated.length > 0) {
    try {
      fs.writeFileSync(envPath, envContent.trim() + "\n", "utf-8");
      logger.info("auto-bootstrap.secrets-generated", {
        keys: generated,
        path: envPath,
        hint: "These are auto-generated for first-run. Replace with your own values if you want to share the .env file.",
      });
    } catch (err) {
      logger.warn("auto-bootstrap.env-write-failed", { error: String(err), hint: "Secrets are in memory only — they won't survive a restart" });
    }
  }

  // Step 5: Ensure db/ directory exists for SQLite
  const dbDir = path.join(cwd, "db");
  if (!fs.existsSync(dbDir)) {
    try {
      fs.mkdirSync(dbDir, { recursive: true });
      logger.info("auto-bootstrap.db-dir-created", { path: dbDir });
    } catch (err) {
      logger.warn("auto-bootstrap.db-dir-failed", { error: String(err) });
    }
  }

  // Step 6: Ensure logs/ directory exists (for keeper.sh + server logs)
  const logsDir = path.join(cwd, "logs");
  if (!fs.existsSync(logsDir)) {
    try {
      fs.mkdirSync(logsDir, { recursive: true });
    } catch {
      // ignore — logs fall back to stdout
    }
  }

  // v61.4 Phase 9: Auto-seed the knowledge base (the "brain") on first start.
  // If the KnowledgeBaseEntry table is empty AND the skills/ folder is present,
  // run the ingestion scripts automatically so the operator doesn't need to
  // manually run `bun run scripts/seed-knowledge-base.ts`. This fixes the
  // "seed script drop-off" risk — the app is now truly zero-config.
  try {
    const { db } = await import("./db");
    const kbCount = await db.knowledgeBaseEntry.count();
    const skillCount = await db.skill.count();
    if (kbCount === 0 || skillCount === 0) {
      logger.info("auto-bootstrap.knowledge-base-empty", {
        kbCount,
        skillCount,
        hint: "Auto-seeding the knowledge brain from skills/ folder + 500-projects repo...",
      });
      // Run the ingestion scripts (best-effort — don't block boot on failure).
      const skillsDir = path.join(cwd, "skills");
      if (fs.existsSync(skillsDir)) {
        try {
          // v61.4 Phase 9: dynamically require the script. The scripts/ dir is
          // at the project root, so we use a relative path from cwd.
          // v69 Phase 19 BLOCKER 1: Add /* webpackIgnore: true */ magic comment so
          // Webpack does NOT statically resolve these dynamic imports at build time.
          const scriptPath = path.join(cwd, "scripts", "extract-all-skill-patterns.ts");
          if (fs.existsSync(scriptPath)) {
            await import(/* webpackIgnore: true */ scriptPath);
          }
        } catch (err) {
          logger.warn("auto-bootstrap.skill-extraction-failed", { error: String(err) });
        }
      } else {
        logger.warn("auto-bootstrap.skills-folder-absent", {
          hint: "The skills/ folder is not present. The app will use the 12 hardcoded fallback patterns in skill-patterns.ts. For the full brain, run `bun run scripts/seed-knowledge-base.ts` after cloning the skills repo.",
        });
      }
      // Always try the 500-projects ingestion (it fetches from GitHub, no local folder needed).
      try {
        // v69 Phase 19 BLOCKER 1: webpackIgnore prevents build-time resolution.
        const scriptPath = path.join(cwd, "scripts", "ingest-500-projects.ts");
        if (fs.existsSync(scriptPath)) {
          await import(/* webpackIgnore: true */ scriptPath);
        }
      } catch (err) {
        logger.warn("auto-bootstrap.500-projects-ingestion-failed", { error: String(err) });
      }
    } else {
      logger.info("auto-bootstrap.knowledge-base-populated", { kbCount, skillCount });
    }
  } catch (err) {
    logger.warn("auto-bootstrap.knowledge-base-check-failed", { error: String(err) });
  }

  // v61.5 Phase 10: Auto-generate the Code Index if it doesn't exist or is stale.
  // This creates .code-index/manifest.json + summaries/ so future AI sessions
  // can understand the codebase without re-reading every file.
  try {
    const indexPath = path.join(cwd, ".code-index", "manifest.json");
    const scriptPath = path.join(cwd, "scripts", "generate-code-index.ts");
    let needsRegen = false;
    if (!fs.existsSync(indexPath)) {
      needsRegen = true;
      logger.info("auto-bootstrap.code-index-absent", { hint: "Generating code index..." });
    } else {
      // Check if any source file is newer than the manifest.
      const manifestStat = fs.statSync(indexPath);
      const srcDir = path.join(cwd, "src");
      if (fs.existsSync(srcDir)) {
        const checkDir = (dir: string): boolean => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
              if (checkDir(path.join(dir, entry.name))) return true;
            } else if (entry.isFile() && entry.name.endsWith(".ts")) {
              const fileStat = fs.statSync(path.join(dir, entry.name));
              if (fileStat.mtime > manifestStat.mtime) return true;
            }
          }
          return false;
        };
        if (checkDir(srcDir)) {
          needsRegen = true;
          logger.info("auto-bootstrap.code-index-stale", { hint: "Source files changed — regenerating code index..." });
        }
      }
    }
    if (needsRegen && fs.existsSync(scriptPath)) {
      try {
        // v69 Phase 19 BLOCKER 1: webpackIgnore prevents build-time resolution.
        await import(/* webpackIgnore: true */ scriptPath);
      } catch (err) {
        logger.warn("auto-bootstrap.code-index-generation-failed", { error: String(err) });
      }
    }
  } catch (err) {
    logger.warn("auto-bootstrap.code-index-check-failed", { error: String(err) });
  }

  if (defaulted.length > 0) {
    logger.info("auto-bootstrap.defaults-applied", {
      keys: defaulted,
      hint: "Some env vars were missing — sensible dev defaults applied. Update via /dashboard/settings.",
    });
  }

  // v69 Phase 19 BLOCKER 6: Voice service environment assertions.
  // If the operator is enabling AI_CALLER_ENABLED, we MUST have the voice
  // service vars set (PIPER_URL, FISH_AUDIO_MODE, LATENCY_THRESHOLD,
  // FREESWITCH_*). Log a clear warning if any are missing so the operator
  // knows exactly what to add to .env before voice calls will work.
  const aiCallerOn = process.env.AI_CALLER_ENABLED === "true";
  if (aiCallerOn) {
    const requiredVoiceVars = [
      "PIPER_URL",
      "FISH_AUDIO_MODE",
      "LATENCY_THRESHOLD",
      "FREESWITCH_ESL_HOST",
      "FREESWITCH_ESL_PORT",
      "FREESWITCH_ESL_PASSWORD",
    ];
    const missingVoice = requiredVoiceVars.filter((k) => !process.env[k]);
    if (missingVoice.length > 0) {
      logger.warn("auto-bootstrap.voice-vars-missing", {
        missing: missingVoice,
        hint: `AI_CALLER_ENABLED=true but these voice-service env vars are not set: ${missingVoice.join(", ")}. Voice calls will fail until they are added to .env (see .env.example §VOICE / DUAL-TTS SERVICE VARIABLES).`,
      });
    }
  }

  return { generated, defaulted, envFileCreated };
}

/**
 * Parse a .env file into a key-value object.
 * (Same logic as env-loader.ts — duplicated here to avoid circular imports.)
 */
function parseEnvFile(filePath: string): Record<string, string> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const content = fs.readFileSync(filePath, "utf-8");
    const result: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();

      // v60 fix: Handle quoted values with inline comments (same as env-loader.ts)
      if (value.startsWith('"')) {
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
        // Unquoted — strip inline comment
        const hashIdx = value.indexOf(" #");
        if (hashIdx > 0) {
          value = value.slice(0, hashIdx).trim();
        }
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
