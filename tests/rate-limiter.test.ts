/**
 * tests/rate-limiter.test.ts — Unit tests for the token-bucket rate limiter.
 *
 * Tests the core checkRateLimit() logic without hitting the network.
 * Uses bun:test.
 */
import { describe, test, expect, beforeEach } from "bun:test";

// Ensure rate limiting is ENABLED for these tests (dev env has it disabled)
beforeEach(() => {
  process.env.RATE_LIMIT_DISABLED = "false";
});

describe("Rate Limiter", () => {
  test("checkRateLimit allows requests under the limit", async () => {
    const { checkRateLimit } = await import("../src/lib/rate-limiter");
    const result = checkRateLimit("192.168.1.1-test-allow", "global");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThanOrEqual(0);
    expect(result.limit).toBe(300);
  });

  test("checkRateLimit returns correct limit for expensive tier", async () => {
    const { checkRateLimit } = await import("../src/lib/rate-limiter");
    const result = checkRateLimit("10.0.0.1-test-expensive", "expensive");
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(10);
  });

  test("isExpensiveEndpoint identifies expensive routes", async () => {
    const { isExpensiveEndpoint } = await import("../src/lib/rate-limiter");
    expect(isExpensiveEndpoint("/api/business-lifecycle")).toBe(true);
    expect(isExpensiveEndpoint("/api/learning/ingest")).toBe(true);
    expect(isExpensiveEndpoint("/api/debate")).toBe(true);
    expect(isExpensiveEndpoint("/api/health")).toBe(false);
    expect(isExpensiveEndpoint("/api/agents")).toBe(false);
  });

  test("getClientIp extracts from X-Forwarded-For", async () => {
    const { getClientIp } = await import("../src/lib/rate-limiter");
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.5, 70.41.3.18",
    });
    expect(getClientIp(headers)).toBe("203.0.113.5");
  });

  test("getClientIp extracts from X-Real-IP when no XFF", async () => {
    const { getClientIp } = await import("../src/lib/rate-limiter");
    const headers = new Headers({
      "x-real-ip": "198.51.100.10",
    });
    expect(getClientIp(headers)).toBe("198.51.100.10");
  });

  test("getClientIp returns unknown when no headers", async () => {
    const { getClientIp } = await import("../src/lib/rate-limiter");
    const headers = new Headers();
    expect(getClientIp(headers)).toBe("unknown");
  });

  test("rate limiter is disabled when RATE_LIMIT_DISABLED=true", async () => {
    const original = process.env.RATE_LIMIT_DISABLED;
    process.env.RATE_LIMIT_DISABLED = "true";
    // Re-import to pick up the env change (module caches, but checkRateLimit reads env at call time)
    const { checkRateLimit } = await import("../src/lib/rate-limiter");
    const result = checkRateLimit("test-ip", "global");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(999);
    process.env.RATE_LIMIT_DISABLED = original;
  });
});
