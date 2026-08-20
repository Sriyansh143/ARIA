/**
 * src/lib/rate-limiter.ts — Token-bucket rate limiter (in-memory, per-IP).
 *
 * Production-grade rate limiting for API routes. Uses a sliding-window
 * token-bucket algorithm: each IP gets a bucket of N tokens that refill
 * at R tokens/second. Each request costs 1 token. When the bucket is
 * empty, the request is rejected with HTTP 429.
 *
 * Two tiers:
 *  - Global: 300 req/min per IP (general API)
 *  - Expensive: 10 req/min per IP (business-lifecycle POST, learning/ingest POST)
 *
 * Disabled when RATE_LIMIT_DISABLED=true (dev only). In production,
 * the limiter runs on every API request via proxy.ts.
 *
 * Buckets are stored in a Map on globalThis (survives HMR). A periodic
 * sweeper (every 5 min) evicts stale buckets older than 10 min to
 * prevent memory growth from one-off clients.
 */

const GLOBAL_CAPACITY = 300; // tokens
const GLOBAL_REFILL_PER_SEC = 5; // 300/min
const EXPENSIVE_CAPACITY = 10; // tokens
const EXPENSIVE_REFILL_PER_SEC = 0.17; // ~10/min
// v42: auth tier — strict anti-brute-force limits
const AUTH_CAPACITY = 5; // tokens
const AUTH_REFILL_PER_SEC = 0.083; // ~5/min (1 per 12s)
const PREVIEW_CAPACITY = 3; // tokens
const PREVIEW_REFILL_PER_SEC = 0.000833; // ~3/hour (1 per 20min)
// v47 fix 2: public tier — strict 10/min for unauthenticated public API routes
// (checkout, UPI checkout/claim, unsubscribe). Prevents LLM-budget drain + spam.
const PUBLIC_CAPACITY = 10; // tokens
const PUBLIC_REFILL_PER_SEC = 0.17; // ~10/min
const EVICT_AFTER_MS = 10 * 60 * 1000; // 10 min

interface Bucket {
  tokens: number;
  lastRefill: number; // ms timestamp
}

interface BucketStore {
  global: Map<string, Bucket>;
  expensive: Map<string, Bucket>;
  auth: Map<string, Bucket>;
  preview: Map<string, Bucket>;
  public: Map<string, Bucket>; // v47 fix 2
  lastSweep: number;
}

const globalForLimiter = globalThis as unknown as {
  __ariaLimiter?: BucketStore;
};

const store: BucketStore = globalForLimiter.__ariaLimiter ?? {
  global: new Map(),
  expensive: new Map(),
  auth: new Map(),
  preview: new Map(),
  public: new Map(),
  lastSweep: Date.now(),
};
if (!globalForLimiter.__ariaLimiter) globalForLimiter.__ariaLimiter = store;

function refill(bucket: Bucket, capacity: number, refillPerSec: number): Bucket {
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000;
  const refilled = Math.min(capacity, bucket.tokens + elapsed * refillPerSec);
  return { tokens: refilled, lastRefill: now };
}

function sweep(): void {
  const now = Date.now();
  if (now - store.lastSweep < EVICT_AFTER_MS) return;
  const cutoff = now - EVICT_AFTER_MS;
  for (const map of [store.global, store.expensive, store.auth, store.preview, store.public]) {
    for (const [ip, bucket] of map) {
      if (bucket.lastRefill < cutoff) map.delete(ip);
    }
  }
  store.lastSweep = now;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
  limit: number;
}

/**
 * Check if a request from the given IP is allowed under the given tier.
 * Returns `{allowed, remaining, resetInMs, limit}`. If allowed, consumes
 * 1 token from the bucket.
 */
export function checkRateLimit(
  ip: string,
  tier: "global" | "expensive" | "auth" | "preview" | "public" = "global"
): RateLimitResult {
  // Disabled in dev
  if (process.env.RATE_LIMIT_DISABLED === "true") {
    return { allowed: true, remaining: 999, resetInMs: 0, limit: 999 };
  }

  let capacity: number;
  let refillPerSec: number;
  let map: Map<string, Bucket>;

  switch (tier) {
    case "expensive":
      capacity = EXPENSIVE_CAPACITY;
      refillPerSec = EXPENSIVE_REFILL_PER_SEC;
      map = store.expensive;
      break;
    case "auth":
      capacity = AUTH_CAPACITY;
      refillPerSec = AUTH_REFILL_PER_SEC;
      map = store.auth;
      break;
    case "preview":
      capacity = PREVIEW_CAPACITY;
      refillPerSec = PREVIEW_REFILL_PER_SEC;
      map = store.preview;
      break;
    case "public":
      capacity = PUBLIC_CAPACITY;
      refillPerSec = PUBLIC_REFILL_PER_SEC;
      map = store.public;
      break;
    default:
      capacity = GLOBAL_CAPACITY;
      refillPerSec = GLOBAL_REFILL_PER_SEC;
      map = store.global;
  }

  sweep();

  let bucket = map.get(ip);
  if (!bucket) {
    bucket = { tokens: capacity, lastRefill: Date.now() };
    map.set(ip, bucket);
  }

  bucket = refill(bucket, capacity, refillPerSec);
  map.set(ip, bucket);

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    map.set(ip, bucket);
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      resetInMs: Math.ceil((1 - bucket.tokens) / refillPerSec * 1000),
      limit: capacity,
    };
  }

  return {
    allowed: false,
    remaining: 0,
    resetInMs: Math.ceil((1 - bucket.tokens) / refillPerSec * 1000),
    limit: capacity,
  };
}

/**
 * Get the client IP from a NextRequest. Handles X-Forwarded-For and
 * X-Real-IP headers (set by Caddy reverse proxy).
 */
export function getClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

/**
 * Expensive endpoints that get the stricter rate limit tier.
 * Matched by pathname startsWith.
 */
export const EXPENSIVE_ENDPOINTS = [
  "/api/business-lifecycle",
  "/api/learning/ingest",
  "/api/autonomous-executor",
  "/api/hermes/execute",
  "/api/simulator",
  "/api/debate",
  "/api/failure-alchemy",
];

// v42: Auth endpoints — strict 5/min anti-brute-force limit
export const AUTH_ENDPOINTS = [
  "/api/auth/callback/credentials",
  "/api/auth/signup",
  "/api/2fa/verify",
  "/api/2fa/disable",
];

// v42: Preview endpoints — 3/hour (free preview abuse prevention)
export const PREVIEW_ENDPOINTS = [
  "/api/services/preview",
  "/api/playground/chat",
];

export function isExpensiveEndpoint(pathname: string): boolean {
  return EXPENSIVE_ENDPOINTS.some((p) => pathname.startsWith(p));
}

export function isAuthEndpoint(pathname: string): boolean {
  return AUTH_ENDPOINTS.some((p) => pathname.startsWith(p));
}

export function isPreviewEndpoint(pathname: string): boolean {
  return PREVIEW_ENDPOINTS.some((p) => pathname.startsWith(p));
}

/**
 * Get the appropriate rate-limit tier for a pathname.
 */
export function getRateLimitTier(pathname: string): "auth" | "preview" | "expensive" | "global" | "public" {
  if (isAuthEndpoint(pathname)) return "auth";
  if (isPreviewEndpoint(pathname)) return "preview";
  if (isExpensiveEndpoint(pathname)) return "expensive";
  return "global";
}
