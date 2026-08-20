/**
 * src/lib/telephony.ts — Unified Telephony Integration
 *
 * Makes phone calls and sends SMS via two providers:
 *   1. FreeSWITCH (native, via ESL protocol on port 8021) — primary
 *   2. Dograh API (cloud telephony, REST) — fallback
 *
 * Provider selection:
 *   - "auto" (default): try FreeSWITCH first, fall back to Dograh
 *   - "freeswitch": use FreeSWITCH only
 *   - "dograh": use Dograh only
 *
 * Env vars (hot-reloaded every 5s by env-loader.ts):
 *   FREESWITCH_ESL_HOST, FREESWITCH_ESL_PORT, FREESWITCH_ESL_PASSWORD
 *   FREESWITCH_SIP_GATEWAY, FREESWITCH_FROM_NUMBER
 *   DOGRAH_API_KEY, DOGRAH_BASE_URL
 *   OWNER_PHONE_NUMBER (for notifications)
 *   AI_CALLER_ENABLED, AI_CALLER_CONSENT_VERIFIED (safety gates)
 *
 * Safety: if AI_CALLER_ENABLED != "true" OR AI_CALLER_CONSENT_VERIFIED
 * != "true", makeCall() and sendSms() return an error. This enforces
 * legal compliance (consent verification) before any outbound call.
 */
import net from "net";
import { logger } from "./logger";
import { emit } from "./event-bus";

// ─── Types ──────────────────────────────────────────────────────────
export interface CallRequest {
  to: string; // phone number (E.164: +91...)
  from?: string; // caller ID (defaults to FREESWITCH_FROM_NUMBER)
  message?: string; // TTS message to play on answer
  provider?: "auto" | "freeswitch" | "dograh" | "twilio";
}

export interface CallResult {
  ok: boolean;
  callId?: string;
  provider: "freeswitch" | "dograh" | "twilio";
  status: "initiated" | "failed" | "unsupported" | "blocked";
  error?: string;
}

export interface SmsRequest {
  to: string;
  message: string;
  provider?: "auto" | "dograh" | "twilio";
}

export interface SmsResult {
  ok: boolean;
  messageId?: string;
  provider: "dograh" | "twilio";
  status: "sent" | "failed" | "blocked";
  error?: string;
}

export interface TelephonyStatus {
  aiCallerEnabled: boolean;
  consentVerified: boolean;
  freeswitch: { configured: boolean; host: string; port: number };
  dograh: { configured: boolean; baseUrl: string };
  twilio: { configured: boolean; accountSid: string | null; fromNumber: string | null };
  ownerPhone: string | null;
}

// ─── Safety gate ────────────────────────────────────────────────────
/**
 * AI Caller safety check. Both AI_CALLER_ENABLED and
 * AI_CALLER_CONSENT_VERIFIED must be "true" for any outbound call/SMS.
 * This is a legal compliance requirement — do not bypass.
 */
function isAiCallerAllowed(): { allowed: boolean; reason?: string } {
  const enabled = process.env.AI_CALLER_ENABLED === "true";
  const consent = process.env.AI_CALLER_CONSENT_VERIFIED === "true";
  if (!enabled) return { allowed: false, reason: "AI_CALLER_ENABLED is not 'true'" };
  if (!consent) return { allowed: false, reason: "AI_CALLER_CONSENT_VERIFIED is not 'true'" };
  return { allowed: true };
}

// ─── FreeSWITCH ESL Client ──────────────────────────────────────────
function getFreeswitchConfig() {
  return {
    host: process.env.FREESWITCH_ESL_HOST || "127.0.0.1",
    port: parseInt(process.env.FREESWITCH_ESL_PORT || "8021", 10),
    password: process.env.FREESWITCH_ESL_PASSWORD || "ClueCon",
    gateway: process.env.FREESWITCH_SIP_GATEWAY || "local-pstn",
    fromNumber: process.env.FREESWITCH_FROM_NUMBER || "",
  };
}

function isFreeswitchConfigured(): boolean {
  return !!(process.env.FREESWITCH_ESL_HOST && process.env.FREESWITCH_ESL_PASSWORD);
}

/**
 * Send an ESL command to FreeSWITCH and wait for the response.
 * Uses Node's net module to connect to the ESL socket (port 8021).
 *
 * Protocol:
 *   1. Connect → FreeSWITCH sends "Content-Type: auth/request"
 *   2. Send "auth <password>\n\n"
 *   3. FreeSWITCH sends "+OK" on success
 *   4. Send "api <command>\n\n"
 *   5. FreeSWITCH sends "Content-Type: command/reply" with result
 */
async function eslCommand(command: string): Promise<{ ok: boolean; response: string }> {
  const config = getFreeswitchConfig();

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buffer = "";
    let authenticated = false;
    let commandSent = false;
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve({ ok: false, response: "ESL timeout (10s)" });
      }
    }, 10_000);

    socket.connect(config.port, config.host, () => {
      logger.debug("telephony.esl.connected", { host: config.host, port: config.port });
    });

    socket.on("data", (data) => {
      buffer += data.toString();

      // Step 1: auth request
      if (!authenticated && buffer.includes("Content-Type: auth/request")) {
        socket.write(`auth ${config.password}\n\n`);
        authenticated = true;
        buffer = "";
        return;
      }

      // Step 2: auth response
      if (authenticated && !commandSent && buffer.includes("Content-Type: command/reply")) {
        if (buffer.includes("+OK")) {
          // Authenticated — send the actual command
          socket.write(`${command}\n\n`);
          commandSent = true;
          buffer = "";
        } else {
          clearTimeout(timeout);
          if (!resolved) {
            resolved = true;
            socket.destroy();
            resolve({ ok: false, response: "ESL auth failed" });
          }
        }
        return;
      }

      // Step 3: command response
      if (commandSent && buffer.includes("Content-Type: command/reply")) {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          const ok = buffer.includes("+OK");
          socket.destroy();
          resolve({ ok, response: buffer });
        }
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        resolve({ ok: false, response: err.message });
      }
    });
  });
}

/**
 * Make a call via FreeSWITCH.
 * Uses the originate command:
 *   api originate sofia/gateway/{gateway}/{to} &{app}({data})
 *
 * If a message is provided, uses the "say" TTS app to speak it.
 * Otherwise uses "echo" (plays back audio for testing).
 */
export async function makeFreeswitchCall(req: CallRequest): Promise<CallResult> {
  if (!isFreeswitchConfigured()) {
    return { ok: false, provider: "freeswitch", status: "unsupported", error: "FreeSWITCH not configured" };
  }

  const config = getFreeswitchConfig();
  const to = req.to.replace(/\s+/g, "");

  // Build the originate command.
  // &say() uses FreeSWITCH's built-in TTS to speak the message.
  // &echo() is a test app that plays back audio.
  const app = req.message ? "say" : "echo";
  const data = req.message || "";
  const cmd = `api originate sofia/gateway/${config.gateway}/${to} &${app}(${data})`;

  logger.info("telephony.freeswitch.call", { to, gateway: config.gateway });
  const result = await eslCommand(cmd);

  if (result.ok) {
    // Extract the call UUID from the response (format: +OK <uuid>)
    const uuidMatch = result.response.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
    );
    const callId = uuidMatch?.[1] || `fs-${Date.now()}`;
    logger.success("telephony.freeswitch.call.initiated", { callId, to });
    return { ok: true, callId, provider: "freeswitch", status: "initiated" };
  }

  logger.error("telephony.freeswitch.call.failed", { to, error: result.response.slice(0, 200) });
  return { ok: false, provider: "freeswitch", status: "failed", error: result.response.slice(0, 200) };
}

// ─── Dograh API Client ──────────────────────────────────────────────
function getDograhConfig() {
  return {
    apiKey: process.env.DOGRAH_API_KEY || "",
    baseUrl: process.env.DOGRAH_BASE_URL || "https://api.dograh.com",
  };
}

function isDograhConfigured(): boolean {
  return !!process.env.DOGRAH_API_KEY;
}

/**
 * Make a call via Dograh cloud telephony API.
 * POST /v1/calls with { to, from, message }
 *
 * NOTE: The exact Dograh API endpoints may differ — this follows
 * common REST telephony API patterns. Adjust the paths if needed
 * based on Dograh's API documentation.
 */
export async function makeDograhCall(req: CallRequest): Promise<CallResult> {
  if (!isDograhConfigured()) {
    return { ok: false, provider: "dograh", status: "unsupported", error: "Dograh not configured" };
  }

  const config = getDograhConfig();
  const from = req.from || process.env.FREESWITCH_FROM_NUMBER || "";

  try {
    const res = await fetch(`${config.baseUrl}/v1/calls`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        to: req.to,
        from,
        message: req.message,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "unknown");
      logger.error("telephony.dograh.call.failed", { status: res.status, error: errorText.slice(0, 200) });
      return { ok: false, provider: "dograh", status: "failed", error: `Dograh HTTP ${res.status}: ${errorText.slice(0, 200)}` };
    }

    const data = (await res.json()) as { callId?: string; id?: string };
    const callId = data.callId || data.id || `dograh-${Date.now()}`;
    logger.success("telephony.dograh.call.initiated", { callId, to: req.to });
    return { ok: true, callId, provider: "dograh", status: "initiated" };
  } catch (err) {
    logger.error("telephony.dograh.call.error", { error: String(err) });
    return { ok: false, provider: "dograh", status: "failed", error: err instanceof Error ? err.message : "unknown error" };
  }
}

/**
 * Send SMS via Dograh API.
 * POST /v1/sms with { to, message }
 */
export async function sendDograhSms(req: SmsRequest): Promise<SmsResult> {
  if (!isDograhConfigured()) {
    return { ok: false, provider: "dograh", status: "failed", error: "Dograh not configured" };
  }

  const config = getDograhConfig();

  try {
    const res = await fetch(`${config.baseUrl}/v1/sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        to: req.to,
        message: req.message,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "unknown");
      logger.error("telephony.dograh.sms.failed", { status: res.status, error: errorText.slice(0, 200) });
      return { ok: false, provider: "dograh", status: "failed", error: `Dograh HTTP ${res.status}: ${errorText.slice(0, 200)}` };
    }

    const data = (await res.json()) as { messageId?: string; id?: string };
    const messageId = data.messageId || data.id || `dograh-sms-${Date.now()}`;
    logger.success("telephony.dograh.sms.sent", { messageId, to: req.to });
    return { ok: true, messageId, provider: "dograh", status: "sent" };
  } catch (err) {
    logger.error("telephony.dograh.sms.error", { error: String(err) });
    return { ok: false, provider: "dograh", status: "failed", error: err instanceof Error ? err.message : "unknown error" };
  }
}

// ─── Twilio Client ──────────────────────────────────────────────────
function getTwilioConfig() {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID || "",
    authToken: process.env.TWILIO_AUTH_TOKEN || "",
    fromNumber: process.env.TWILIO_FROM_NUMBER || "",
  };
}

function isTwilioConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

/**
 * Make a phone call via Twilio REST API.
 * POST https://api.twilio.com/2010-04-01/Accounts/<sid>/Calls.json
 * Body: To=...&From=...&Twiml=<Response><Say>...</Say></Response>
 */
export async function makeTwilioCall(req: CallRequest): Promise<CallResult> {
  if (!isTwilioConfigured()) {
    return { ok: false, provider: "twilio", status: "unsupported", error: "Twilio not configured" };
  }

  const config = getTwilioConfig();
  const from = req.from || config.fromNumber;
  if (!from) {
    return { ok: false, provider: "twilio", status: "failed", error: "TWILIO_FROM_NUMBER not set" };
  }

  const twiml = `<Response><Say voice="Polly.Joanna">${req.message || "Hello, this is ARIA calling."}</Say></Response>`;

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Calls.json`;
    const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
    const body = new URLSearchParams({
      To: req.to,
      From: from,
      Twiml: twiml,
    });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "unknown");
      logger.error("telephony.twilio.call.failed", { status: res.status, error: errorText.slice(0, 200) });
      return { ok: false, provider: "twilio", status: "failed", error: `Twilio HTTP ${res.status}: ${errorText.slice(0, 200)}` };
    }

    const data = (await res.json()) as { sid?: string };
    const callId = data.sid || `twilio-${Date.now()}`;
    logger.success("telephony.twilio.call.initiated", { callId, to: req.to });
    return { ok: true, callId, provider: "twilio", status: "initiated" };
  } catch (err) {
    logger.error("telephony.twilio.call.error", { error: String(err) });
    return { ok: false, provider: "twilio", status: "failed", error: err instanceof Error ? err.message : "unknown error" };
  }
}

/**
 * Send an SMS via Twilio REST API.
 * POST https://api.twilio.com/2010-04-01/Accounts/<sid>/Messages.json
 */
export async function sendTwilioSms(req: SmsRequest): Promise<SmsResult> {
  if (!isTwilioConfigured()) {
    return { ok: false, provider: "twilio", status: "failed", error: "Twilio not configured" };
  }

  const config = getTwilioConfig();
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
    const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
    const body = new URLSearchParams({
      To: req.to,
      From: config.fromNumber,
      Body: req.message.slice(0, 1600),
    });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "unknown");
      logger.error("telephony.twilio.sms.failed", { status: res.status, error: errorText.slice(0, 200) });
      return { ok: false, provider: "twilio", status: "failed", error: `Twilio HTTP ${res.status}: ${errorText.slice(0, 200)}` };
    }

    const data = (await res.json()) as { sid?: string };
    const messageId = data.sid || `twilio-sms-${Date.now()}`;
    logger.success("telephony.twilio.sms.sent", { messageId, to: req.to });
    return { ok: true, messageId, provider: "twilio", status: "sent" };
  } catch (err) {
    logger.error("telephony.twilio.sms.error", { error: String(err) });
    return { ok: false, provider: "twilio", status: "failed", error: err instanceof Error ? err.message : "unknown error" };
  }
}

// ─── Unified Telephony Interface ────────────────────────────────────
/**
 * Make a phone call. Tries providers in order: FreeSWITCH → Twilio → Dograh.
 * Returns the first successful result, or the last error if all fail.
 *
 * Safety: blocked if AI_CALLER_ENABLED != "true" OR
 * AI_CALLER_CONSENT_VERIFIED != "true".
 */
export async function makeCall(req: CallRequest): Promise<CallResult> {
  // Safety gate
  const gate = isAiCallerAllowed();
  if (!gate.allowed) {
    logger.warn("telephony.call.blocked", { reason: gate.reason, to: req.to });
    return { ok: false, provider: "freeswitch", status: "blocked", error: gate.reason };
  }

  const provider = req.provider || "auto";
  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: `Telephony: initiating call to ${req.to}`,
    level: "info",
  });

  // Try FreeSWITCH first (if auto or freeswitch)
  if (provider === "freeswitch" || (provider === "auto" && isFreeswitchConfigured())) {
    const result = await makeFreeswitchCall(req);
    if (result.ok) return result;
    if (result.status === "unsupported" && provider === "auto") {
      // FreeSWITCH not configured — fall through to next provider
    } else if (provider === "freeswitch") {
      return result; // explicit freeswitch — don't fall back
    }
  }

  // Try Twilio (if auto or twilio)
  if (provider === "twilio" || (provider === "auto" && isTwilioConfigured())) {
    const result = await makeTwilioCall(req);
    if (result.ok) return result;
    if (result.status === "unsupported" && provider === "auto") {
      // Twilio not configured — fall through to Dograh
    } else if (provider === "twilio") {
      return result;
    }
  }

  // Try Dograh (if auto or dograh)
  if (provider === "dograh" || provider === "auto") {
    return makeDograhCall(req);
  }

  return { ok: false, provider: "freeswitch", status: "unsupported", error: "No telephony provider configured" };
}

/**
 * Send an SMS. Tries Twilio first, falls back to Dograh.
 *
 * Safety: blocked if AI_CALLER_ENABLED != "true" OR
 * AI_CALLER_CONSENT_VERIFIED != "true".
 */
export async function sendSms(req: SmsRequest): Promise<SmsResult> {
  const gate = isAiCallerAllowed();
  if (!gate.allowed) {
    logger.warn("telephony.sms.blocked", { reason: gate.reason, to: req.to });
    return { ok: false, provider: "dograh", status: "blocked", error: gate.reason };
  }

  const provider = req.provider || "auto";
  // Try Twilio first (if auto or twilio)
  if (provider === "twilio" || (provider === "auto" && isTwilioConfigured())) {
    const result = await sendTwilioSms(req);
    if (result.ok || provider === "twilio") return result;
  }

  // Fall back to Dograh
  return sendDograhSms(req);
}

/**
 * Get the current telephony configuration status (for the API endpoint).
 * Reads env vars dynamically (hot-reloaded).
 */
export function getTelephonyStatus(): TelephonyStatus {
  const gate = isAiCallerAllowed();
  const fsConfig = getFreeswitchConfig();
  const dograhConfig = getDograhConfig();
  const twilioConfig = getTwilioConfig();
  return {
    aiCallerEnabled: gate.allowed,
    consentVerified: process.env.AI_CALLER_CONSENT_VERIFIED === "true",
    freeswitch: {
      configured: isFreeswitchConfigured(),
      host: fsConfig.host,
      port: fsConfig.port,
    },
    dograh: {
      configured: isDograhConfigured(),
      baseUrl: dograhConfig.baseUrl,
    },
    twilio: {
      configured: isTwilioConfigured(),
      accountSid: twilioConfig.accountSid || null,
      fromNumber: twilioConfig.fromNumber || null,
    },
    ownerPhone: process.env.OWNER_PHONE_NUMBER || null,
  };
}
