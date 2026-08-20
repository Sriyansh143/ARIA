/**
 * tests/feasibility.test.ts — Unit tests for Monte Carlo feasibility engine.
 *
 * Tests runMonteCarlo() P10/P50/P90 logic + GO/HALT/PIVOT classification.
 */
import { describe, test, expect } from "bun:test";

describe("Feasibility Engine (Monte Carlo)", () => {
  test("runMonteCarlo returns P10/P50/P90 + GO/HALT/PIVOT", async () => {
    const { runMonteCarlo } = await import("../src/lib/feasibility");
    const result = runMonteCarlo({ baseEstimate: 10000, variance: 2000, iterations: 100 });
    expect(result.p10).toBeDefined();
    expect(result.p50).toBeDefined();
    expect(result.p90).toBeDefined();
    expect(["GO", "HALT", "PIVOT"]).toContain(result.goHaltPivot);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  test("runMonteCarlo P50 is roughly near the base estimate", async () => {
    const { runMonteCarlo } = await import("../src/lib/feasibility");
    const result = runMonteCarlo({ baseEstimate: 5000, variance: 500, iterations: 1000 });
    // P50 should be within ±50% of base estimate (generous tolerance for randomness)
    expect(result.p50).toBeGreaterThan(2500);
    expect(result.p50).toBeLessThan(7500);
  });

  test("runMonteCarlo P10 <= P50 <= P90", async () => {
    const { runMonteCarlo } = await import("../src/lib/feasibility");
    const result = runMonteCarlo({ baseEstimate: 1000, variance: 200, iterations: 500 });
    expect(result.p10).toBeLessThanOrEqual(result.p50);
    expect(result.p50).toBeLessThanOrEqual(result.p90);
  });

  test("high base estimate with low variance tends to GO", async () => {
    const { runMonteCarlo } = await import("../src/lib/feasibility");
    // baseEstimate=10000, variance=100 → P50 should be near 10000 → GO (p50 >= 0.6*base)
    const result = runMonteCarlo({ baseEstimate: 10000, variance: 100, iterations: 500 });
    expect(["GO", "PIVOT"]).toContain(result.goHaltPivot);
  });

  test("low base estimate with high variance tends to HALT or PIVOT", async () => {
    const { runMonteCarlo } = await import("../src/lib/feasibility");
    // AUDIT-fix (v46 flaky test): the original premise was mathematically wrong —
    // with a symmetric Gaussian centered on `base`, p50 ≈ base, so baseEstimate=100
    // never drops p50 below 0.6*base=60. The reliable way to produce HALT is to
    // push most samples below 0 (clamped to 0 by Math.max(0,...)): use a very low
    // base with a stddev that makes >50% of samples negative. baseEstimate=5,
    // stddev=sqrt(1000)≈31.6 → z=(0-5)/31.6≈-0.16 → ~56% of samples clamp to 0,
    // so the median is 0 < 0.3*base(1.5) → HALT deterministically.
    const results = Array.from({ length: 5 }, () =>
      runMonteCarlo({ baseEstimate: 5, variance: 1000, iterations: 500 })
    );
    const haltOrPivotCount = results.filter((r) => r.goHaltPivot === "HALT" || r.goHaltPivot === "PIVOT").length;
    expect(haltOrPivotCount).toBeGreaterThan(0);
  });
});
