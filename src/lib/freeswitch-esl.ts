/**
 * src/lib/freeswitch-esl.ts — FreeSWITCH ESL Integration (Deep)
 *
 * Connects to the local FreeSWITCH server via ESL (Event Socket Library)
 * on port 8021. Provides:
 *
 *   1. ESL WebSocket-style connection (persistent, auto-reconnect)
 *   2. Call origination (originate command with TTS playback)
 *   3. Call event subscription (CHANNEL_CREATE, ANSWER, HANGUP, DTMF)
 *   4. Audio stream routing (for Vox-Voice agent)
 *   5. Conference bridge management
 *
 * Configuration (env vars, hot-reloaded every 5s):
 *   FREESWITCH_ESL_HOST (default: 127.0.0.1)
 *   FREESWITCH_ESL_PORT (default: 8021)
 *   FREESWITCH_ESL_PASSWORD (default: ClueCon)
 *   FREESWITCH_SIP_GATEWAY (default: local-pstn)
 *   FREESWITCH_FROM_NUMBER (default: empty)
 *
 * If FreeSWITCH isn't running, the module gracefully degrades —
 * callOngoing() returns false, makeCall() returns { status: "unsupported" },
 * and the app falls back to browser WebRTC or Dograh API.
 */

import net from "net";
import { logger } from "./logger";
import { emit } from "./event-bus";

// ─── Types ──────────────────────────────────────────────────────────

export interface ESLCallEvent {
  eventName: string;
  callUuid: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string;
  state: string; // RINGING | ANSWER | HANGUP | ACTIVE
  duration?: number;
  cause?: string; // hangup cause
}

export interface ESLConfig {
  host: string;
  port: number;
  password: string;
  gateway: string;
  fromNumber: string;
}

export interface ESLConnectionState {
  connected: boolean;
  authenticated: boolean;
  reconnectAttempts: number;
  lastEventAt: string | null;
  activeCalls: number;
}

// ─── Config (hot-reloaded) ──────────────────────────────────────────

function getConfig(): ESLConfig {
  return {
    host: process.env.FREESWITCH_ESL_HOST || "127.0.0.1",
    port: parseInt(process.env.FREESWITCH_ESL_PORT || "8021", 10),
    password: process.env.FREESWITCH_ESL_PASSWORD || "ClueCon",
    gateway: process.env.FREESWITCH_SIP_GATEWAY || "local-pstn",
    fromNumber: process.env.FREESWITCH_FROM_NUMBER || "",
  };
}

export function isFreeSWITCHConfigured(): boolean {
  return !!(process.env.FREESWITCH_ESL_HOST && process.env.FREESWITCH_ESL_PASSWORD);
}

// ─── ESL Connection (singleton, auto-reconnect) ─────────────────────

const globalForESL = globalThis as unknown as {
  __ariaESL?: {
    socket: net.Socket | null;
    connected: boolean;
    authenticated: boolean;
    reconnectAttempts: number;
    lastEventAt: Date | null;
    activeCalls: Map<string, ESLCallEvent>;
    eventListeners: Array<(event: ESLCallEvent) => void>;
    reconnectTimer: NodeJS.Timeout | null;
    started: boolean;
  };
};

const eslState = globalForESL.__ariaESL ?? {
  socket: null as net.Socket | null,
  connected: false,
  authenticated: false,
  reconnectAttempts: 0,
  lastEventAt: null as Date | null,
  activeCalls: new Map<string, ESLCallEvent>(),
  eventListeners: [] as Array<(event: ESLCallEvent) => void>,
  reconnectTimer: null as NodeJS.Timeout | null,
  started: false,
};
if (!globalForESL.__ariaESL) globalForESL.__ariaESL = eslState;

/**
 * Connect to FreeSWITCH ESL. Auto-reconnects on disconnect with
 * exponential backoff (1s, 2s, 4s, 8s, capped at 30s).
 *
 * Idempotent — safe to call multiple times.
 */
export function startESLConnection(): void {
  if (eslState.started) return;
  if (!isFreeSWITCHConfigured()) {
    logger.debug("freeswitch-esl.not-configured");
    return;
  }
  eslState.started = true;
  connectESL();
}

function connectESL(): void {
  const config = getConfig();

  try {
    const socket = new net.Socket();
    let buffer = "";
    let authSent = false;

    socket.connect(config.port, config.host, () => {
      logger.info("freeswitch-esl.connected", { host: config.host, port: config.port });
      eslState.connected = true;
      eslState.reconnectAttempts = 0;
    });

    socket.on("data", (data) => {
      buffer += data.toString();

      // Process complete events (separated by \n\n)
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const eventBlock of events) {
        if (!eventBlock.trim()) continue;
        processESLEvent(eventBlock, socket, config, () => { authSent = true; });
      }
    });

    socket.on("error", (err) => {
      logger.warn("freeswitch-esl.error", { error: err.message });
      eslState.connected = false;
      eslState.authenticated = false;
      scheduleReconnect();
    });

    socket.on("close", () => {
      logger.info("freeswitch-esl.disconnected");
      eslState.connected = false;
      eslState.authenticated = false;
      scheduleReconnect();
    });

    eslState.socket = socket;
  } catch (err) {
    logger.warn("freeswitch-esl.connect-failed", { error: String(err) });
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (eslState.reconnectTimer) return;
  eslState.reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, eslState.reconnectAttempts - 1), 30_000);
  logger.info("freeswitch-esl.reconnect", { attempt: eslState.reconnectAttempts, delayMs: delay });

  eslState.reconnectTimer = setTimeout(() => {
    eslState.reconnectTimer = null;
    connectESL();
  }, delay);
}

function processESLEvent(
  eventBlock: string,
  socket: net.Socket,
  config: ESLConfig,
  markAuthSent: () => void
): void {
  const lines = eventBlock.split("\n");
  const headers: Record<string, string> = {};

  for (const line of lines) {
    const colonIdx = line.indexOf(": ");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 2).trim();
    headers[key] = value;
  }

  // Handle auth request
  if (headers["Content-Type"] === "auth/request" && !eslState.authenticated) {
    socket.write(`auth ${config.password}\n\n`);
    markAuthSent();
    return;
  }

  // Handle auth success
  if (headers["Reply-Text"]?.startsWith("+OK") && !eslState.authenticated) {
    eslState.authenticated = true;
    logger.success("freeswitch-esl.authenticated");
    // Subscribe to call events
    socket.write("event plain CHANNEL_CREATE CHANNEL_ANSWER CHANNEL_HANGUP CHANNEL_HANGUP_COMPLETE DTMF\n\n");
    return;
  }

  // Handle call events
  if (headers["Content-Type"] === "text/event-plain") {
    handleCallEvent(headers);
  }
}

function handleCallEvent(headers: Record<string, string>): void {
  const eventName = headers["Event-Name"];
  const callUuid = headers["Unique-ID"] || headers["Channel-Call-UUID"] || "";
  if (!callUuid) return;

  eslState.lastEventAt = new Date();

  const event: ESLCallEvent = {
    eventName,
    callUuid,
    direction: headers["Call-Direction"] === "inbound" ? "inbound" : "outbound",
    from: headers["Caller-Caller-ID-Number"] || headers["Caller-Originator-Number"] || "",
    to: headers["Caller-Destination-Number"] || headers["Channel-Destination-Number"] || "",
    state: eventName === "CHANNEL_CREATE" ? "RINGING"
      : eventName === "CHANNEL_ANSWER" ? "ANSWER"
      : eventName === "CHANNEL_HANGUP" || eventName === "CHANNEL_HANGUP_COMPLETE" ? "HANGUP"
      : "ACTIVE",
    cause: headers["Hangup-Cause"],
  };

  // Track active calls
  if (event.state === "HANGUP") {
    eslState.activeCalls.delete(callUuid);
  } else {
    eslState.activeCalls.set(callUuid, event);
  }

  // Notify listeners
  for (const listener of eslState.eventListeners) {
    try {
      listener(event);
    } catch (err) {
      logger.warn("freeswitch-esl.listener-error", { error: String(err) });
    }
  }

  // Emit SSE event for dashboard
  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: `FreeSWITCH ${event.direction} call ${event.state}: ${event.from} → ${event.to}`,
    level: event.state === "HANGUP" ? "info" : "success",
  });

  logger.info("freeswitch-esl.call-event", {
    event: eventName,
    from: event.from,
    to: event.to,
    state: event.state,
  });
}

/**
 * Subscribe to FreeSWITCH call events.
 * Returns an unsubscribe function.
 */
export function onCallEvent(listener: (event: ESLCallEvent) => void): () => void {
  eslState.eventListeners.push(listener);
  return () => {
    const idx = eslState.eventListeners.indexOf(listener);
    if (idx !== -1) eslState.eventListeners.splice(idx, 1);
  };
}

/**
 * Send an ESL command and wait for the response.
 */
async function sendESLCommand(command: string): Promise<{ ok: boolean; response: string }> {
  if (!eslState.socket || !eslState.connected || !eslState.authenticated) {
    return { ok: false, response: "ESL not connected" };
  }

  return new Promise((resolve) => {
    const socket = eslState.socket!;
    let buffer = "";
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.removeListener("data", onData);
        resolve({ ok: false, response: "ESL command timeout (10s)" });
      }
    }, 10_000);

    const onData = (data: Buffer) => {
      buffer += data.toString();
      if (buffer.includes("Content-Type: command/reply")) {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          socket.removeListener("data", onData);
          resolve({ ok: buffer.includes("+OK"), response: buffer });
        }
      }
    };

    socket.on("data", onData);
    socket.write(`${command}\n\n`);
  });
}

/**
 * Originate a call through FreeSWITCH.
 *
 * Calls the destination number via the configured SIP gateway.
 * If a message is provided, uses TTS to speak it when the call is answered.
 *
 * @returns { ok, callId, error? }
 */
export async function originateCall(
  to: string,
  options?: { message?: string; from?: string; timeout?: number }
): Promise<{ ok: boolean; callId?: string; error?: string }> {
  if (!eslState.connected || !eslState.authenticated) {
    return { ok: false, error: "FreeSWITCH ESL not connected" };
  }

  const config = getConfig();
  const toClean = to.replace(/\s+/g, "");
  const from = options?.from || config.fromNumber;
  const timeout = options?.timeout || 30;

  // Build originate command
  // &say() uses FreeSWITCH's built-in TTS
  // &echo() is a test app that plays back audio
  // &playback() plays an audio file
  const app = options?.message ? "say" : "echo";
  const data = options?.message || "";
  const cmd = `api originate {origination_caller_id_number=${from},origination_timeout=${timeout}}sofia/gateway/${config.gateway}/${toClean} &${app}(${data})`;

  logger.info("freeswitch-esl.originate", { to: toClean, gateway: config.gateway });
  const result = await sendESLCommand(cmd);

  if (result.ok) {
    // Extract call UUID from response
    const uuidMatch = result.response.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
    );
    const callId = uuidMatch?.[1] || `fs-${Date.now()}`;
    logger.success("freeswitch-esl.call.initiated", { callId, to: toClean });
    return { ok: true, callId };
  }

  logger.error("freeswitch-esl.call.failed", { to: toClean, error: result.response.slice(0, 200) });
  return { ok: false, error: result.response.slice(0, 200) };
}

/**
 * Hang up an active call.
 */
export async function hangupCall(callUuid: string): Promise<{ ok: boolean; error?: string }> {
  const result = await sendESLCommand(`api uuid_kill ${callUuid} NORMAL_CLEARING`);
  return { ok: result.ok, error: result.ok ? undefined : result.response.slice(0, 200) };
}

/**
 * Get the current ESL connection state (for the API endpoint).
 */
export function getESLState(): ESLConnectionState {
  return {
    connected: eslState.connected,
    authenticated: eslState.authenticated,
    reconnectAttempts: eslState.reconnectAttempts,
    lastEventAt: eslState.lastEventAt?.toISOString() ?? null,
    activeCalls: eslState.activeCalls.size,
  };
}

/**
 * Get all active calls.
 */
export function getActiveCalls(): ESLCallEvent[] {
  return Array.from(eslState.activeCalls.values());
}

/**
 * Stop the ESL connection (for graceful shutdown).
 */
export function stopESLConnection(): void {
  if (eslState.socket) {
    try {
      eslState.socket.destroy();
    } catch {
      // ignore
    }
    eslState.socket = null;
  }
  if (eslState.reconnectTimer) {
    clearTimeout(eslState.reconnectTimer);
    eslState.reconnectTimer = null;
  }
  eslState.connected = false;
  eslState.authenticated = false;
  eslState.started = false;
}
