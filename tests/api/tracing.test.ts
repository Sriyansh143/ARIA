/**
 * tests/api/tracing.test.ts — Unit tests for the tracing abstraction.
 *
 * Tests `startSpan` returns a handle with `end`, `traceAsync` returns
 * the wrapped result + propagates errors, and `getTraceStats` aggregates
 * completed spans correctly.
 *
 * Uses `bun:test`. Each test clears the globalThis-backed ring buffer in
 * `beforeEach` so stats don't leak across tests.
 */
import { describe, test, expect, beforeEach } from "bun:test";

const GLOBAL_SPANS_KEY = "__aria_trace_spans__";

beforeEach(() => {
  // Wipe the HMR-safe ring buffer so each test starts from zero spans.
  (globalThis as Record<string, unknown>)[GLOBAL_SPANS_KEY] = [];
});

describe("startSpan", () => {
  test("returns a handle with end(), addAttribute(), addEvent()", async () => {
    const { startSpan } = await import("../../src/lib/tracing");
    const span = startSpan("test.span");
    expect(typeof span.end).toBe("function");
    expect(typeof span.addAttribute).toBe("function");
    expect(typeof span.addEvent).toBe("function");
    span.end();
  });

  test("end() is idempotent (calling twice doesn't crash)", async () => {
    const { startSpan } = await import("../../src/lib/tracing");
    const span = startSpan("idempotent");
    span.end();
    expect(() => span.end()).not.toThrow();
  });

  test("addAttribute + addEvent do not throw", async () => {
    const { startSpan } = await import("../../src/lib/tracing");
    const span = startSpan("attrs");
    span.addAttribute("key", "value");
    span.addAttribute("count", 42);
    span.addEvent("did-something");
    span.end();
  });
});

describe("traceAsync", () => {
  test("returns the wrapped function's result", async () => {
    const { traceAsync } = await import("../../src/lib/tracing");
    const result = await traceAsync("add", async () => 1 + 2);
    expect(result).toBe(3);
  });

  test("propagates errors from the wrapped function", async () => {
    const { traceAsync } = await import("../../src/lib/tracing");
    await expect(
      traceAsync("boom", async () => {
        throw new Error("kaboom");
      })
    ).rejects.toThrow("kaboom");
  });

  test("ends the span even on rejection (stats reflect it)", async () => {
    const { traceAsync, getTraceStats } = await import("../../src/lib/tracing");
    try {
      await traceAsync("reject.span", async () => {
        throw new Error("nope");
      });
    } catch {
      // expected
    }
    const stats = getTraceStats();
    expect(stats.totalSpans).toBeGreaterThanOrEqual(1);
  });
});

describe("getTraceStats", () => {
  test("returns zeros when no spans exist", async () => {
    const { getTraceStats } = await import("../../src/lib/tracing");
    const stats = getTraceStats();
    expect(stats.totalSpans).toBe(0);
    expect(stats.avgDurationMs).toBe(0);
    expect(stats.slowestSpan).toBeNull();
  });

  test("accumulates stats after spans complete", async () => {
    const { startSpan, getTraceStats } = await import("../../src/lib/tracing");
    const s1 = startSpan("fast");
    s1.end();
    // Small delay so the second span has a measurably larger duration.
    await new Promise((r) => setTimeout(r, 10));
    const s2 = startSpan("slow");
    await new Promise((r) => setTimeout(r, 20));
    s2.end();

    const stats = getTraceStats();
    expect(stats.totalSpans).toBe(2);
    expect(stats.avgDurationMs).toBeGreaterThan(0);
    expect(stats.slowestSpan).not.toBeNull();
    expect(stats.slowestSpan!.name).toBe("slow");
    expect(stats.slowestSpan!.durationMs).toBeGreaterThanOrEqual(
      stats.avgDurationMs
    );
  });

  test("slowestSpan is null if no spans have completed", async () => {
    const { startSpan, getTraceStats } = await import("../../src/lib/tracing");
    // Start but don't end a span — it's in-flight, not in stats.
    startSpan("in-flight");
    const stats = getTraceStats();
    expect(stats.totalSpans).toBe(0);
    expect(stats.slowestSpan).toBeNull();
  });
});
