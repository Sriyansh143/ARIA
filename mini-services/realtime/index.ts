// aria-realtime — standalone socket.io mini-service for ARIA Mission Control.
//
// Acts as a real-time fan-out channel. The Next.js app's API routes push
// events into this layer via POST /emit (server-to-server, same host), and
// browser clients subscribe via socket.io:
//
//     io("/", { path: "/" })
//
// The Caddy gateway forwards requests to localhost:3003. The socket.io
// `path` MUST be `/` so the gateway can route correctly.
//
// Port 3003 is HARDCODED — do NOT change (Caddy is configured for it).
// This is an INDEPENDENT bun project — it must NOT import anything from
// the Next.js app.
//
// NOTE on co-hosting REST + socket.io on path "/":
// engine.io's default `attach()` wraps the httpServer's request handler
// with a `check()` that — for path "/" — matches EVERY URL (because every
// URL starts with "/"). That would intercept /health, /emit, and /buffer
// before our REST handler can run. To avoid this we do NOT auto-attach
// engine.io; instead we create the engine.io Server manually and forward
// non-REST requests to `engine.handleRequest` / `engine.handleUpgrade`
// ourselves. This keeps `path: "/"` for socket.io clients while letting
// REST endpoints work on the same port.

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { Server as EngineIOServer } from "engine.io";
import { Server as SocketIOServer, type Socket } from "socket.io";

// v58 Phase 4: Constant-time key comparison (timing-attack resistant)
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ─── Configuration ───────────────────────────────────────────────────────────
const PORT = 3003; // hardcoded — Caddy forwards to localhost:3003
const BUFFER_SIZE = 200; // in-memory ring buffer of recent aria:event messages
const STARTED_AT = Date.now();

// Optional shared secret for POST /emit. If unset, /emit is open (dev mode)
// and a warning is logged on boot. Set ARIA_REALTIME_KEY in production.
const REALTIME_KEY = process.env.ARIA_REALTIME_KEY;

if (!REALTIME_KEY) {
  console.warn(
    "[aria-realtime] WARNING: ARIA_REALTIME_KEY env var is not set. " +
      "POST /emit is UNAUTHENTICATED (dev mode). Set ARIA_REALTIME_KEY in production.",
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface BufferedEvent {
  id: string;
  channel: string;
  event: unknown;
  ts: number;
}

interface EmitRequestBody {
  channel?: unknown;
  event?: unknown;
}

interface SubscribePayload {
  channels?: unknown;
}

// ─── In-memory ring buffer ───────────────────────────────────────────────────
const buffer: BufferedEvent[] = [];
let _seq = 0;

function nextId(): string {
  _seq += 1;
  return `${Date.now().toString(36)}-${_seq.toString(36)}`;
}

function pushBuffer(entry: BufferedEvent): void {
  buffer.push(entry);
  if (buffer.length > BUFFER_SIZE) {
    buffer.splice(0, buffer.length - BUFFER_SIZE);
  }
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────
function readBody(req: IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer | string) => {
      data += chunk;
      if (data.length > maxBytes) {
        req.destroy();
        reject(new Error("body too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-ARIA-Realtime-Key");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  try {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  } catch (err) {
    console.error("[aria-realtime] sendJson failed:", err);
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
}

function extractChannels(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const raw = (data as SubscribePayload).channels;
  if (!Array.isArray(raw)) return [];
  return raw.filter((ch): ch is string => typeof ch === "string" && ch.length > 0);
}

// ─── Engine.io + Socket.io (manually wired; NOT auto-attached) ───────────────
// We create the engine.io Server directly so we can route REST endpoints
// ourselves before falling through to engine.handleRequest.
const engine = new EngineIOServer({
  // DO NOT change the path — Caddy uses it to forward to localhost:3003.
  path: "/",
  cors: {
    // Reflect the Origin header so credentials work; fall back to '*' when
    // no Origin is present (server-to-server / curl).
    origin: (
      origin: string | undefined,
      cb: (err: Error | null, origin?: string) => void,
    ) => {
      cb(null, origin || "*");
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
  // Heartbeat: drop a client if no pong within 60s, ping every 25s.
  pingTimeout: 60_000,
  pingInterval: 25_000,
  // Allow Engine.IO v3 clients (older socket.io clients).
  allowEIO3: true,
});

const io = new SocketIOServer();
// bind() wires socket.io's connection handling to engine.io's "connection"
// event and exposes `io.engine === engine`.
io.bind(engine);

// ─── HTTP server (REST + engine.io fallback) ─────────────────────────────────
const httpServer = createServer(async (req, res) => {
  try {
    applyCors(req, res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://localhost:${PORT}`);
    const path = url.pathname;

    // GET /health — liveness + stats
    if (req.method === "GET" && path === "/health") {
      sendJson(res, 200, {
        ok: true,
        clients: engine.clientsCount,
        buffer: buffer.length,
        uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
        pid: process.pid,
      });
      return;
    }

    // POST /emit — server-to-server event ingress (called by Next.js API routes)
    if (req.method === "POST" && path === "/emit") {
      // v58 Phase 4: Standardized internal auth via X-JARVIS-Key (or legacy X-ARIA-Realtime-Key)
      // Uses constant-time comparison to prevent timing attacks.
      const sharedKey = process.env.JARVIS_SHARED_KEY || REALTIME_KEY;
      if (sharedKey) {
        const provided = (req.headers["x-jarvis-key"] || req.headers["x-aria-realtime-key"]) as string | undefined;
        if (!provided || !constantTimeEqual(String(provided), String(sharedKey))) {
          sendJson(res, 401, {
            error: "unauthorized",
            reason: "invalid or missing X-JARVIS-Key (or X-ARIA-Realtime-Key)",
          });
          return;
        }
      }

      // Read + parse JSON body
      let parsed: EmitRequestBody;
      try {
        const body = await readBody(req);
        parsed = JSON.parse(body) as EmitRequestBody;
      } catch {
        sendJson(res, 400, { error: "invalid JSON body" });
        return;
      }

      const { channel, event } = parsed;
      if (typeof channel !== "string" || channel.length === 0) {
        sendJson(res, 400, { error: "missing required field: channel (string)" });
        return;
      }

      // Persist to ring buffer for /buffer replay
      const entry: BufferedEvent = {
        id: nextId(),
        channel,
        event: event ?? null,
        ts: Date.now(),
      };
      pushBuffer(entry);

      // Fan-out: broadcast to the channel room + the global room.
      // io.to(a).to(b).emit(...) sends to the UNION of both rooms.
      // All connected clients are auto-joined to 'global' on connect, so
      // every client receives every event by default. Channel-specific
      // subscriptions are additive.
      io.to(channel).to("global").emit("aria:event", event);

      sendJson(res, 200, { ok: true, clients: engine.clientsCount });
      return;
    }

    // GET /buffer — peek at recent 200 events (debugging aid)
    if (req.method === "GET" && path === "/buffer") {
      sendJson(res, 200, { count: buffer.length, events: buffer });
      return;
    }

    // Everything else (e.g. `GET /?EIO=4&transport=polling`) is forwarded
    // to engine.io. This is what makes socket.io clients work on path "/".
    engine.handleRequest(req, res);
  } catch (err) {
    console.error("[aria-realtime] http handler crashed:", err);
    // Only send a 500 if the response is still writable; engine.io may
    // have already taken ownership.
    try {
      if (!res.writableEnded) {
        sendJson(res, 500, { error: "internal error" });
      }
    } catch {
      /* ignore */
    }
  }
});

// Websocket upgrade requests — forward to engine.io.
httpServer.on("upgrade", (req, socket, head) => {
  try {
    engine.handleUpgrade(req, socket, head);
  } catch (err) {
    console.error("[aria-realtime] upgrade handler crashed:", err);
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
  }
});

// ─── Socket.io connection handling ───────────────────────────────────────────
io.on("connection", (socket: Socket) => {
  try {
    // Auto-join the 'global' room so every connected client receives every
    // event by default. This is what makes the service a true fan-out
    // channel: even a freshly-connected tab immediately starts receiving
    // live updates.
    socket.join("global");

    // Greet the new client with service metadata.
    socket.emit("hello", {
      service: "aria-realtime",
      pid: process.pid,
      uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
      socketId: socket.id,
      ts: Date.now(),
    });

    console.log(
      `[aria-realtime] + connect  ${socket.id}  (clients=${engine.clientsCount})`,
    );

    // subscribe { channels: string[] } — client joins the named rooms.
    socket.on("subscribe", (data: unknown) => {
      try {
        const channels = extractChannels(data);
        for (const ch of channels) socket.join(ch);
        socket.emit("subscribed", { channels, ts: Date.now() });
      } catch (err) {
        console.error(`[aria-realtime] subscribe handler crashed ${socket.id}:`, err);
      }
    });

    // unsubscribe { channels: string[] } — client leaves the named rooms.
    socket.on("unsubscribe", (data: unknown) => {
      try {
        const channels = extractChannels(data);
        for (const ch of channels) socket.leave(ch);
        socket.emit("unsubscribed", { channels, ts: Date.now() });
      } catch (err) {
        console.error(`[aria-realtime] unsubscribe handler crashed ${socket.id}:`, err);
      }
    });

    // ping → pong { ts } — latency probe.
    socket.on("ping", () => {
      try {
        socket.emit("pong", { ts: Date.now() });
      } catch (err) {
        console.error(`[aria-realtime] ping handler crashed ${socket.id}:`, err);
      }
    });

    // aria:event (client→server) — allow clients to also publish events.
    // Useful for collaborative UI state (e.g., one tab pins an agent card
    // and other tabs see it live). Goes through the same fan-out path.
    socket.on("aria:event", (data: unknown) => {
      try {
        if (!data || typeof data !== "object") return;
        const { channel, event } = data as EmitRequestBody;
        if (typeof channel !== "string" || channel.length === 0) return;
        const entry: BufferedEvent = {
          id: nextId(),
          channel,
          event: event ?? null,
          ts: Date.now(),
        };
        pushBuffer(entry);
        io.to(channel).to("global").emit("aria:event", event);
      } catch (err) {
        console.error(`[aria-realtime] aria:event handler crashed ${socket.id}:`, err);
      }
    });

    socket.on("disconnect", (reason: string) => {
      try {
        console.log(
          `[aria-realtime] - disconnect ${socket.id}  reason=${reason}  (clients=${engine.clientsCount})`,
        );
      } catch (err) {
        console.error(`[aria-realtime] disconnect handler crashed ${socket.id}:`, err);
      }
    });

    socket.on("error", (err: Error) => {
      console.error(`[aria-realtime] socket error ${socket.id}:`, err);
    });
  } catch (err) {
    // Never let a connection-handler bug crash the server.
    console.error("[aria-realtime] connection handler crashed:", err);
    try {
      socket.disconnect(true);
    } catch {
      /* ignore */
    }
  }
});

// ─── Periodic stats log ──────────────────────────────────────────────────────
setInterval(() => {
  try {
    console.log(
      `[aria-realtime] stats  clients=${engine.clientsCount}  buffer=${buffer.length}  ` +
        `uptime=${Math.floor((Date.now() - STARTED_AT) / 1000)}s`,
    );
  } catch (err) {
    console.error("[aria-realtime] stats log crashed:", err);
  }
}, 60_000);

// ─── Start ───────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`[aria-realtime] listening on port ${PORT}  (socket.io path='/')`);
  console.log(
    `[aria-realtime] POST /emit auth: ${REALTIME_KEY ? "ENABLED (X-ARIA-Realtime-Key)" : "DISABLED (dev mode)"}`,
  );
  console.log("[aria-realtime] endpoints: GET /health  POST /emit  GET /buffer");
});

// ─── Graceful shutdown ───────────────────────────────────────────────────────
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[aria-realtime] received ${signal}, shutting down...`);
  try {
    // Tell all clients we're going away.
    io.emit("server:shutdown", { reason: signal, ts: Date.now() });
    io.close(() => {
      httpServer.close(() => {
        console.log("[aria-realtime] closed");
        process.exit(0);
      });
    });
  } catch (err) {
    console.error("[aria-realtime] shutdown crashed:", err);
    process.exit(1);
  }
  // Force-exit after 5s if graceful close hangs.
  setTimeout(() => {
    console.error("[aria-realtime] graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, 5_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  console.error("[aria-realtime] uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[aria-realtime] unhandledRejection:", reason);
});
