/**
 * tests/api/cache.test.ts — Unit tests for the in-memory cache adapter.
 *
 * Tests set/get round-trip, TTL expiry, delete, invalidate-by-prefix,
 * and stats (hit/miss counters).
 *
 * Uses `bun:test`. Each test clears the cache in `beforeEach` so the
 * globalThis-backed store doesn't leak state between tests.
 */
import { describe, test, expect, beforeEach } from "bun:test";

beforeEach(async () => {
  const { cache } = await import("../../src/lib/cache");
  cache.clear();
});

describe("cache.get + cache.set round-trip", () => {
  test("stores + retrieves a value", async () => {
    const { cache } = await import("../../src/lib/cache");
    cache.set("k1", { hello: "world" });
    const got = cache.get<{ hello: string }>("k1");
    expect(got).toEqual({ hello: "world" });
  });

  test("returns null for a missing key (and bumps misses)", async () => {
    const { cache } = await import("../../src/lib/cache");
    const got = cache.get("does-not-exist");
    expect(got).toBeNull();
    const stats = cache.stats();
    expect(stats.misses).toBeGreaterThanOrEqual(1);
  });

  test("overwrites a prior value on re-set", async () => {
    const { cache } = await import("../../src/lib/cache");
    cache.set("k", "v1");
    cache.set("k", "v2");
    expect(cache.get<string>("k")).toBe("v2");
  });
});

describe("cache TTL expiry", () => {
  test("entry expires after the TTL elapses", async () => {
    const { cache } = await import("../../src/lib/cache");
    cache.set("ttl-key", "value", 100); // 100ms TTL
    expect(cache.get<string>("ttl-key")).toBe("value"); // immediate — hit
    // Wait 150ms so the TTL has elapsed.
    await new Promise((r) => setTimeout(r, 150));
    expect(cache.get<string>("ttl-key")).toBeNull(); // expired — miss
  });

  test("entry without TTL lives forever (until explicitly deleted)", async () => {
    const { cache } = await import("../../src/lib/cache");
    cache.set("no-ttl", "persist");
    await new Promise((r) => setTimeout(r, 60));
    expect(cache.get<string>("no-ttl")).toBe("persist");
  });
});

describe("cache.delete", () => {
  test("removes a single key", async () => {
    const { cache } = await import("../../src/lib/cache");
    cache.set("a", 1);
    cache.set("b", 2);
    cache.delete("a");
    expect(cache.get<number>("a")).toBeNull();
    expect(cache.get<number>("b")).toBe(2);
  });

  test("is a no-op for a missing key (no throw)", async () => {
    const { cache } = await import("../../src/lib/cache");
    expect(() => cache.delete("never-existed")).not.toThrow();
  });
});

describe("cache.invalidate (by prefix)", () => {
  test("deletes all keys starting with the prefix", async () => {
    const { cache } = await import("../../src/lib/cache");
    cache.set("user:1", "alice");
    cache.set("user:2", "bob");
    cache.set("session:1", "xyz");
    cache.invalidate("user:");
    expect(cache.get<string>("user:1")).toBeNull();
    expect(cache.get<string>("user:2")).toBeNull();
    expect(cache.get<string>("session:1")).toBe("xyz");
  });

  test("empty prefix is a no-op (would otherwise wipe everything)", async () => {
    const { cache } = await import("../../src/lib/cache");
    cache.set("keep", "me");
    cache.invalidate("");
    expect(cache.get<string>("keep")).toBe("me");
  });
});

describe("cache.stats", () => {
  test("records hits + misses correctly", async () => {
    const { cache } = await import("../../src/lib/cache");
    cache.set("hit-key", "v");
    cache.get("hit-key"); // hit
    cache.get("hit-key"); // hit
    cache.get("miss-key"); // miss
    const stats = cache.stats();
    expect(stats.hits).toBeGreaterThanOrEqual(2);
    expect(stats.misses).toBeGreaterThanOrEqual(1);
    expect(stats.size).toBeGreaterThanOrEqual(1);
    expect(stats.hitRate).toBeGreaterThan(0);
    expect(stats.hitRate).toBeLessThanOrEqual(1);
  });

  test("hitRate is 0 when there are no hits", async () => {
    const { cache } = await import("../../src/lib/cache");
    cache.get("nothing"); // miss
    const stats = cache.stats();
    expect(stats.hits).toBe(0);
    expect(stats.hitRate).toBe(0);
  });
});
