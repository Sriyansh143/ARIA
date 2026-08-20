/**
 * ARIA Mission Control — Credential management (env + JSON file fallback).
 *
 * Ported from FounderOS-DEMO/lib/creds.ts + lib/keys.ts, simplified for ARIA.
 *
 * The FounderOS original resolved keys from 4 different files
 * (`~/.config/social/.env`, `knowledge/.env.agents`, project `.env.local`,
 * `~/.config/mcp.json`) plus process.env plus an upsert flow. ARIA doesn't
 * have Alex's existing canonical key locations, so we collapse to the
 * simplest possible scheme:
 *
 *   1. `process.env` (read first; .env / .env.local already loaded by Next)
 *   2. `~/.config/aria/creds.json` fallback (for keys set via the UI that
 *      need to take effect without a restart — see `setCredential`)
 *
 * `setCredential` upserts to the JSON file. It does NOT touch process.env
 * (which is read-only at runtime in Node) or .env.local (which would
 * require a server restart to take effect). The JSON file is read fresh on
 * every `getCredential` call, so a just-pasted key connects immediately.
 *
 * No encryption (that's a future task — Task 19+). The file is created with
 * mode 0600 (owner read/write only) which is the same hygiene as
 * `~/.ssh/config`. Don't store production secrets in a sandbox preview.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─── Canonical credential keys ───────────────────────────────────────
/**
 * Every credential ARIA knows about. A key in this list is one the UI can
 * render a slot for and the backend can resolve. Keys outside this list
 * are still readable from env (process.env is open), but `listCredentials`
 * only reports the canonical set — that's what the Connections board needs.
 *
 * Grouped by provider to make the UI's groupings obvious from the source.
 */
export const CREDENTIAL_KEYS: readonly string[] = [
  // ── LLM providers ───────────────────────────────────────────────────
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ZAI_API_KEY",
  "GROQ_API_KEY",
  "DEEPSEEK_API_KEY",
  "GEMINI_API_KEY",
  "NVIDIA_API_KEY",
  "NVIDIA_BASE_URL",
  // ── Ollama (local) ──────────────────────────────────────────────────
  "OLLAMA_BASE_URL",
  "OLLAMA_MODEL",
  // ── CRM / Sales ─────────────────────────────────────────────────────
  "ATTIO_API_KEY",
  "HUBSPOT_API_KEY",
  "PIPEDRIVE_API_KEY",
  // ── Communications ──────────────────────────────────────────────────
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "SENDGRID_API_KEY",
  "POSTMARK_API_KEY",
  // ── Payments ────────────────────────────────────────────────────────
  // v47 fix 7: Stripe keys removed (app is 100% crypto/UPI now).
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  // ── Productivity / Knowledge ────────────────────────────────────────
  "NOTION_API_KEY",
  "LINEAR_API_KEY",
  "GITHUB_TOKEN",
  // ── Social / Marketing ──────────────────────────────────────────────
  "MANYCHAT_API_KEY",
  "META_ACCESS_TOKEN",
  "LINKEDIN_ACCESS_TOKEN",
  // ── ARIA infra ──────────────────────────────────────────────────────
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "ARIA_INTERNAL_SECRET",
  "NEXTAUTH_SECRET",
] as const;

// ─── File path ───────────────────────────────────────────────────────
const HOME = os.homedir();

/**
 * Path to the JSON credential file. Override via `ARIA_CREDS_FILE` env for
 * tests. Default: `~/.config/aria/creds.json`. Created on first write.
 */
export function credsFilePath(): string {
  return process.env.ARIA_CREDS_FILE ?? path.join(HOME, ".config", "aria", "creds.json");
}

/** Mask a secret for display: show last 4 chars only. */
export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

// ─── JSON file read/write ────────────────────────────────────────────
type CredsFile = Record<string, string>;

function readCredsFile(): CredsFile {
  try {
    const raw = fs.readFileSync(credsFilePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: CredsFile = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function writeCredsFile(creds: CredsFile): void {
  const file = credsFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // mode 0600 = owner read/write only (same hygiene as ~/.ssh/config).
  // writeFileSync with mode creates the file with these perms; if it already
  // exists, we keep its current perms (chmod would be a separate call).
  // For simplicity, always chmod after write so a pre-existing 0644 file
  // gets tightened on next upsert.
  fs.writeFileSync(file, JSON.stringify(creds, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Filesystem doesn't support chmod (e.g. Windows) — non-fatal.
  }
}

// ─── Public API ──────────────────────────────────────────────────────
/**
 * Resolve a credential by key. Reads `process.env` first (Next already
 * loaded .env / .env.local at boot), then falls back to the JSON file
 * (for keys set via the UI since the process started). Returns `undefined`
 * when the key is nowhere.
 *
 * Never throws — a missing key is a normal state ("not configured yet"),
 * not an exception. The caller decides whether undefined is fatal.
 */
export function getCredential(key: string): string | undefined {
  const fromEnv = process.env[key];
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  const fromFile = readCredsFile()[key];
  if (fromFile && fromFile.length > 0) return fromFile;

  return undefined;
}

/**
 * Upsert a credential to the JSON file. Does NOT touch process.env (which
 * is read-only at runtime in Node) — a server restart is required for the
 * new value to appear in `process.env`, but `getCredential` reads the JSON
 * file fresh every call so the value takes effect immediately for any code
 * path that goes through `getCredential`.
 *
 * Validates the key name (must be `^[A-Z_][A-Z0-9_]*$`) and rejects
 * newlines in the value — same hygiene as the FounderOS `upsertEnvLocal`.
 */
export function setCredential(key: string, value: string): void {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
    throw new Error(`invalid credential key: ${JSON.stringify(key)} (must match ^[A-Z_][A-Z0-9_]*$)`);
  }
  if (/[\n\r]/.test(value)) {
    throw new Error("credential value must be a single line");
  }

  const creds = readCredsFile();
  creds[key] = value;
  writeCredsFile(creds);
}

/** Remove a credential from the JSON file. No-op if absent. */
export function deleteCredential(key: string): void {
  const creds = readCredsFile();
  if (!(key in creds)) return;
  delete creds[key];
  writeCredsFile(creds);
}

export type CredentialStatus = {
  key: string;
  /** True when the key is resolvable from env OR the JSON file. */
  configured: boolean;
  /** Masked value for display (last 4 chars only). Empty when not configured. */
  masked: string;
  /** Where the value was resolved from: "env" | "file" | null. */
  source: "env" | "file" | null;
};

/**
 * List every canonical credential key with its configured status. Used by
 * the Connections board to render the slot grid. The order matches
 * `CREDENTIAL_KEYS` so the UI's grouping is stable.
 *
 * Reads env first (fresh every call — a server restart picks up new .env
 * values), then the JSON file. The `source` field tells the UI whether to
 * show "Restart required to apply" (env) or "Live" (file).
 */
export function listCredentials(): CredentialStatus[] {
  const fileCreds = readCredsFile();
  return CREDENTIAL_KEYS.map((key) => {
    const fromEnv = process.env[key];
    if (fromEnv && fromEnv.length > 0) {
      return { key, configured: true, masked: maskSecret(fromEnv), source: "env" as const };
    }
    const fromFile = fileCreds[key];
    if (fromFile && fromFile.length > 0) {
      return { key, configured: true, masked: maskSecret(fromFile), source: "file" as const };
    }
    return { key, configured: false, masked: "", source: null };
  });
}
