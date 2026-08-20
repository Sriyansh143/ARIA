// mini-services/lib/auth-middleware.ts — Shared internal auth for mini-services (v58 Phase 4)
//
// All mini-services (realtime, future: credential-vault, vector-memory, etc.)
// MUST verify the X-JARVIS-Key header on every incoming HTTP request using
// constant-time comparison against JARVIS_SHARED_KEY.
//
// This prevents a sandbox-escaped agent from accessing internal APIs even
// if it can make HTTP requests to localhost:3003.
//
// Usage (in a Bun mini-service):
//
//   import { verifyJarvisKey } from "../lib/auth-middleware";
//
//   if (!verifyJarvisKey(req)) {
//     res.statusCode = 401;
//     res.end(JSON.stringify({ error: "unauthorized" }));
//     return;
//   }
//
// Or as a wrapper:
//
//   import { withAuth } from "../lib/auth-middleware";
//   const handler = withAuth((req, res) => { /* ... */ });

import type { IncomingMessage } from "http";

/**
 * The shared key. Read from process.env at request time so it can be
 * hot-reloaded without restarting the mini-service.
 *
 * Set JARVIS_SHARED_KEY to a 32-byte hex string (openssl rand -hex 32).
 * If unset, requests are accepted with a console.warn (dev mode only).
 */
function getSharedKey(): string | undefined {
  return process.env.JARVIS_SHARED_KEY || process.env.ARIA_REALTIME_KEY;
}

/**
 * Constant-time string comparison. Prevents timing attacks where an
 * attacker could brute-force the key by measuring response time.
 *
 * Both strings are compared byte-by-byte, accumulating XOR of each pair.
 * The result is true only if ALL bytes match AND lengths are equal.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to keep timing constant
    let dummy = 0;
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i++) {
      dummy |= (a.charCodeAt(i % a.length) ^ b.charCodeAt(i % b.length));
    }
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Extract the X-JARVIS-Key header from an incoming request.
 * Falls back to Authorization: Bearer <key> for clients that can't set
 * custom headers (rare, but some HTTP clients restrict custom headers).
 */
export function extractJarvisKey(req: IncomingMessage): string | undefined {
  const headerValue = req.headers["x-jarvis-key"] as string | undefined;
  if (headerValue) return headerValue;

  const auth = req.headers["authorization"] as string | undefined;
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7);
  }

  return undefined;
}

/**
 * Verify that the incoming request has a valid X-JARVIS-Key header.
 * Returns true if authorized, false otherwise.
 *
 * In dev mode (JARVIS_SHARED_KEY unset), returns true with a one-time warning.
 */
export function verifyJarvisKey(req: IncomingMessage): boolean {
  const sharedKey = getSharedKey();
  if (!sharedKey) {
    // Dev mode — no key set. Warn once per process.
    if (!verifyJarvisKey._warned) {
      console.warn("[auth-middleware] WARNING: JARVIS_SHARED_KEY is not set. Mini-service is open in dev mode.");
      console.warn("[auth-middleware] Set JARVIS_SHARED_KEY=openssl-rand-hex-32 in production.");
      verifyJarvisKey._warned = true;
    }
    return true;
  }

  const providedKey = extractJarvisKey(req);
  if (!providedKey) return false;

  return constantTimeEqual(providedKey, sharedKey);
}
// Module-level state for the one-time dev warning
// (declared on the function to avoid polluting the module namespace)
verifyJarvisKey._warned = false as boolean;

/**
 * Higher-order wrapper: apply auth to any HTTP request handler.
 *
 *   const secureHandler = withAuth((req, res) => { ... });
 *   http.createServer(secureHandler).listen(3003);
 *
 * Returns 401 + JSON error body if auth fails.
 */
export function withAuth(
  handler: (req: IncomingMessage, res: any) => void | Promise<void>,
): (req: IncomingMessage, res: any) => void | Promise<void> {
  return async (req: IncomingMessage, res: any) => {
    if (!verifyJarvisKey(req)) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "unauthorized", hint: "X-JARVIS-Key header required" }));
      return;
    }
    return handler(req, res);
  };
}
