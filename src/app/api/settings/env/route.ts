/**
 * POST /api/settings/env — Dynamic env writer (v57 comprehensive).
 *
 * Allows the owner to update API keys from the UI without restarting
 * the server. Writes to .env on disk + hot-reloads process.env in memory.
 *
 * Body: { keys: { ZAI_API_KEY: "...", STRIPE_SECRET_KEY: "...", ... } }
 *
 * Protected: only authenticated users can call this.
 *
 * Covers ALL env vars the .env.example documents: LLMs, telephony,
 * lead gen, payments, email, WhatsApp, Telegram, VAPID, safety flags.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { logger } from "@/lib/logger";
import { requirePermissionResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Keys that can be updated via this endpoint (allowlist for security).
// Anything NOT in this list can only be set in the .env file directly.
const ALLOWED_KEYS = [
  // ─── LLM providers ───
  "ZAI_API_KEY", "ZAI_BASE_URL",
  "GROQ_API_KEY",
  "NVIDIA_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "OLLAMA_HOST",
  "WORKFORCE_MODEL_STRONG", "WORKFORCE_MODEL_BALANCED", "WORKFORCE_MODEL_FAST",
  "ARIA_PREFER_LOCAL_LLM",
  "LLM_DAILY_BUDGET_USD",
  "ARIA_LLM_RPM_ZAI", "ARIA_LLM_RPM_GROQ", "ARIA_LLM_RPM_NVIDIA",
  "ARIA_LLM_RPM_OLLAMA", "ARIA_LLM_RPM_OPENAI", "ARIA_LLM_RPM_ANTHROPIC",
  "ARIA_LLM_RPM_GEMINI",
  "ARIA_BROWSER_SCRAPER_ENABLED", "ARIA_BROWSER_SCRAPER_URL", "ARIA_VISION_MODEL",

  // ─── Telephony ───
  "FREESWITCH_ESL_HOST", "FREESWITCH_ESL_PORT", "FREESWITCH_ESL_PASSWORD",
  "FREESWITCH_SIP_GATEWAY", "FREESWITCH_FROM_NUMBER",
  "DOGRAH_API_KEY", "DOGRAH_BASE_URL",
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER",
  "OWNER_PHONE_NUMBER",
  "AI_CALLER_ENABLED", "AI_CALLER_CONSENT_VERIFIED",

  // ─── Lead Gen enrichment ───
  "APOLLO_API_KEY", "HUNTER_API_KEY", "SNOV_API_KEY",
  "CLEARBIT_API_KEY", "ZOOMINFO_API_KEY",
  "ARIA_SEARCH_PROVIDER",
  "ARIA_OUTREACH_DAILY_LIMIT",

  // ─── Payments ───
  "CRYPTO_WALLET_ADDRESS", "CRYPTO_NETWORK",
  "ETHERSCAN_API_KEY",
  "ARIA_UPI_VPA", "ARIA_UPI_PAYEE_NAME",
  "STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET",
  "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID", "PAYPAL_MODE",
  "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET",
  "ARIA_BANK_NAME", "ARIA_BANK_ACCOUNT_NAME", "ARIA_BANK_ACCOUNT_NUMBER",
  "ARIA_BANK_IFSC", "ARIA_BANK_SWIFT",

  // ─── Email ───
  "RESEND_API_KEY", "RESEND_FROM_EMAIL", "RESEND_WEBHOOK_SECRET",
  "ARIA_SENDER_ADDRESS", "BOOKING_URL",

  // ─── WhatsApp ───
  "WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN",

  // ─── Telegram ───
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",

  // ─── VAPID / Web Push ───
  "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT",

  // ─── Safety / Kill-switches ───
  "ALLOW_CODE_EXEC", "ALLOW_TERMINAL_EXEC",
  "UI_HEALER_AUTO_APPROVE", "RATE_LIMIT_DISABLED",
  "JARVIS_AUTH_MODE", "JARVIS_DEV_BYPASS_AUTH", "JARVIS_MULTI_TENANT",
  "NODE_ENV", "ARIA_LOG_LEVEL",
  "ARIA_TAX_RATE",
  // v61 Phase 1: simulation + free-only mode toggles (UI-editable)
  "FREE_ONLY_MODE", "ARIA_SIMULATION_MODE", "FREE_ONLY_TTS",
  // v61 Phase 2: operational discipline (business hours + deployment env)
  "DEPLOYMENT_ENV", "OWNER_TIMEZONE", "BUSINESS_HOURS_START", "BUSINESS_HOURS_END",

  // ─── Misc ───
  "ARIA_OWNER_EMAIL",
  "NEXTAUTH_URL",
  "ENCRYPTION_MASTER_KEY",
  "ARIA_REALTIME_KEY",
  "ZAI_TTS_ENABLED",
];

export async function POST(req: NextRequest) {
  // v40: require owner permission (was unauthenticated!)
  const [user, errorResponse] = await requirePermissionResponse("POST", "/api/settings/env");
  if (errorResponse) return errorResponse;

  let body: { keys?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const keys = body.keys || {};
  const updated: string[] = [];
  const rejected: string[] = [];

  // Validate against allowlist.
  for (const [key, value] of Object.entries(keys)) {
    if (!ALLOWED_KEYS.includes(key)) {
      rejected.push(key);
      continue;
    }
    if (typeof value !== "string") {
      rejected.push(key);
      continue;
    }

    // Hot-reload into process.env immediately.
    process.env[key] = value;
    updated.push(key);
  }

  // Persist to .env file on disk.
  if (updated.length > 0) {
    try {
      const envPath = path.join(process.cwd(), ".env");
      let envContent = "";

      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, "utf-8");
      }

      for (const key of updated) {
        const value = process.env[key] || "";
        // Quote values that contain spaces or special chars
        const needsQuoting = /\s|#|=/.test(value) && !/^["'].*["']$/.test(value);
        const writeValue = needsQuoting ? `"${value}"` : value;
        // If the key already exists in the file, replace it.
        const keyRegex = new RegExp(`^${key}=.*$`, "m");
        if (keyRegex.test(envContent)) {
          envContent = envContent.replace(keyRegex, `${key}=${writeValue}`);
        } else {
          // Append new key.
          envContent += `\n${key}=${writeValue}`;
        }
      }

      fs.writeFileSync(envPath, envContent.trim() + "\n", "utf-8");
      logger.info("api.settings.env.updated", { keys: updated, rejected });
    } catch (err) {
      logger.error("api.settings.env.write-failed", { error: String(err) });
      return NextResponse.json(
        { error: "failed to write .env file", detail: String(err) },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    updated,
    rejected,
    message: updated.length > 0
      ? `${updated.length} key(s) updated + hot-reloaded.`
      : "No keys to update.",
  });
}

/**
 * GET /api/settings/env — return current env key status (masked).
 */
export async function GET() {
  const status: Record<string, { configured: boolean; masked: string | null }> = {};
  for (const key of ALLOWED_KEYS) {
    const value = process.env[key];
    if (!value) {
      status[key] = { configured: false, masked: null };
    } else if (/SECRET|KEY|TOKEN|PASS|PASSWORD/i.test(key)) {
      // Mask sensitive values — show first 6 + last 4 chars.
      const masked = value.length > 12
        ? `${value.slice(0, 6)}...${value.slice(-4)}`
        : "configured";
      status[key] = { configured: true, masked };
    } else {
      status[key] = { configured: true, masked: value };
    }
  }

  return NextResponse.json({ keys: status });
}
