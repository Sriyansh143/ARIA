/**
 * tests/production-gate.test.ts — v61 FIX (Finding 4b) tests
 *
 * Verifies that verifyProductionReadiness() actively rejects outputs containing
 * placeholders (TODO/FIXME/DRAFT), hardcoded secrets, and missing error
 * handling — and that the gate is now WIRED into step-debate.ts so rejected
 * outputs are halted (NEEDS_CONTEXT) instead of shipped to production.
 */
import { verifyProductionReadiness } from "../src/lib/production-gate";
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { db } from "../src/lib/db";


// ─── Mock the LLM client so runStepDebate can be tested without network ───
// The mock uses a mutable flag `refinerAlwaysFails` to switch between:
//   - false (default): Refiner returns clean output (gate passes after 1 retry)
//   - true: Refiner ALWAYS returns TODO (gate fails 3× → shouldHalt → NEEDS_CONTEXT)
let refinerAlwaysFails = false;
mock.module("../src/lib/llm-client", () => ({
  callLLM: mock(async (_agent: string, _role: string, prompt: string) => {
    // If this is a Refiner call prompted by the production gate (to fix gate
    // issues), return clean output OR always-bad depending on the flag.
    if (/PRODUCTION GATE found these specific issues/i.test(prompt)) {
      if (refinerAlwaysFails) {
        const stillBad = "function add(a, b) { /* TODO: still not implemented */ return null; }\n";
        return { success: true, completion: stillBad, content: stillBad, error: undefined };
      }
      const clean = "export function add(a: number, b: number): number {\n  return a + b;\n}\n";
      return { success: true, completion: clean, content: clean, error: undefined };
    }
    // If this is a generic Refiner call (Critic feedback), return clean output.
    if (/You are the REFINER/i.test(prompt)) {
      const clean = "export function add(a: number, b: number): number {\n  return a + b;\n}\n";
      return { success: true, completion: clean, content: clean, error: undefined };
    }
    // If this is a Critic call, approve the output.
    if (/You are the CRITIC/i.test(prompt)) {
      return { success: true, completion: "APPROVED", content: "APPROVED", error: undefined };
    }
    // Default (Proposer): return a TODO-containing output.
    const bad = "function add(a, b) {\n  // TODO: implement addition\n  return null;\n}\n";
    return { success: true, completion: bad, content: bad, error: undefined };
  }),
}));

// Mock internet-research to avoid network calls during the debate.
mock.module("../src/lib/internet-research", () => ({
  enhancePromptWithResearch: mock(async (ctx: string) => ctx),
}));

beforeEach(async () => {
  refinerAlwaysFails = false; // reset before each test
  // Clean any blackboard / approval state that might interfere.
  await db.setting.deleteMany({ where: { key: "agent-blackboard.active" } });
});

afterEach(async () => {
  await db.setting.deleteMany({ where: { key: "agent-blackboard.active" } });
});

// ────────────────────────────────────────────────────────────────────────
// 1. PURE-FUNCTION TESTS — verifyProductionReadiness()
// ────────────────────────────────────────────────────────────────────────

describe("Production Gate — verifyProductionReadiness (Finding 4b)", () => {
  it("rejects output containing a TODO placeholder", () => {
    const result = verifyProductionReadiness(
      "function foo() { /* TODO: implement this */ }",
      "code",
      0,
    );
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => /TODO/i.test(i))).toBe(true);
    expect(result.shouldRetry).toBe(true);
    expect(result.shouldHalt).toBe(false);
  });

  it("rejects output containing a FIXME placeholder", () => {
    const result = verifyProductionReadiness("const x = FIXME;", "code", 0);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => /FIXME/i.test(i))).toBe(true);
  });

  it("rejects output containing a DRAFT marker", () => {
    const result = verifyProductionReadiness("This is a DRAFT of the report.", "general", 0);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => /DRAFT/i.test(i))).toBe(true);
  });

  it("rejects output containing a hardcoded API key (sk_live_)", () => {
    const result = verifyProductionReadiness(
      "const stripeKey = 'sk_live_abc123secret';",
      "code",
      0,
    );
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => /secret/i.test(i))).toBe(true);
  });

  it("rejects output containing a hardcoded GitHub token (ghp_)", () => {
    const result = verifyProductionReadiness(
      "const token = 'ghp_abcdef123456';",
      "code",
      0,
    );
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => /secret/i.test(i))).toBe(true);
  });

  it("rejects empty output", () => {
    const result = verifyProductionReadiness("   ", "general", 0);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => /empty/i.test(i))).toBe(true);
  });

  it("shouldHalt becomes true after 3 failures (failureCount >= 3)", () => {
    const result = verifyProductionReadiness("TODO", "code", 3);
    expect(result.passed).toBe(false);
    expect(result.shouldHalt).toBe(true);
    expect(result.shouldRetry).toBe(false);
  });

  it("shouldRetry is true when failureCount < 3", () => {
    const result = verifyProductionReadiness("TODO", "code", 1);
    expect(result.passed).toBe(false);
    expect(result.shouldRetry).toBe(true);
    expect(result.shouldHalt).toBe(false);
  });

  it("passes clean production-ready code output", () => {
    const clean = "export function add(a: number, b: number): number {\n  return a + b;\n}\n";
    const result = verifyProductionReadiness(clean, "code", 0);
    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("flags code with fetch/await but no try/catch error handling", () => {
    const risky = "const data = await fetch('https://api.example.com');\nreturn data;";
    const result = verifyProductionReadiness(risky, "code", 0);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => /error handling/i.test(i))).toBe(true);
  });

  it("rejects output ending with an ellipsis (incomplete)", () => {
    const result = verifyProductionReadiness("This function does...", "general", 0);
    expect(result.passed).toBe(false);
    // The ellipsis regex /\.\.\.\s*$/ is one of the PLACEHOLDER_PATTERNS, so
    // the issue string says "placeholder/draft marker".
    expect(result.issues.some((i) => /placeholder\/draft marker/i.test(i))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. WIRING TEST — runStepDebate respects the production gate
// ────────────────────────────────────────────────────────────────────────

describe("Production Gate Wiring — runStepDebate (Finding 4b)", () => {
  it("re-refines a TODO-containing output via the gate loop and returns productionReady=true once fixed", async () => {
    // The mock Proposer returns a TODO output; the gate detects it + triggers
    // a Refiner call (which the mock returns clean). So the final output must
    // be clean + productionReady=true.
    const { runStepDebate } = await import("../src/lib/step-debate");
    const result = await runStepDebate({
      description: "Write an add function",
      stepType: "code",
      context: "You are a code generator.",
      complexity: "high",
    });
    // The gate loop should have re-refined the TODO output into a clean one.
    expect(result.productionReady).toBe(true);
    expect(result.finalOutput).not.toContain("TODO");
    expect(result.rounds).toBeGreaterThanOrEqual(2); // at least 1 Proposer + 1 Refiner
  });

  it("marks a single-pass (low-complexity) output as NOT production-ready when it contains TODO", async () => {
    // Low complexity → single-pass → mock returns TODO → gate rejects →
    // productionReady=false + finalOutput prefixed with NEEDS_CONTEXT.
    const { runStepDebate } = await import("../src/lib/step-debate");
    const result = await runStepDebate({
      description: "Write a stub",
      stepType: "code",
      context: "You are a code generator.",
      complexity: "low",
    });
    expect(result.productionReady).toBe(false);
    expect(result.finalOutput.startsWith("NEEDS_CONTEXT:")).toBe(true);
    expect(result.finalOutput).toContain("TODO");
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. BUG-FIX TESTS — verify the 3 critical bugs found by the bug hunt
// ────────────────────────────────────────────────────────────────────────

describe("BUG-1 FIX — debate path 3 gate failures → NEEDS_CONTEXT halt", () => {
  it("halts with NEEDS_CONTEXT after 3 gate failures (shouldHalt reached)", async () => {
    // Set the mock to always return TODO (simulating an LLM that can't fix it).
    refinerAlwaysFails = true;
    // With the bug, shouldHalt was never true (off-by-one). After the fix,
    // the loop iterates 3×, failureCount reaches 3, shouldHalt=true, and
    // the output is prefixed with NEEDS_CONTEXT.
    const { runStepDebate } = await import("../src/lib/step-debate");
    const result = await runStepDebate({
      description: "Write a function",
      stepType: "code",
      context: "You are a code generator.",
      complexity: "high",
    });
    // The gate should have failed 3 times → shouldHalt → NEEDS_CONTEXT.
    expect(result.productionReady).toBe(false);
    expect(result.finalOutput.startsWith("NEEDS_CONTEXT:")).toBe(true);
    expect(result.finalOutput).toContain("Production Gate rejected");
    expect(result.rounds).toBeGreaterThanOrEqual(3); // 1 Proposer + 2+ Gate Refiner retries
    refinerAlwaysFails = false; // reset for subsequent tests
  });
});

describe("BUG-10 FIX — gate rejects (error: ...) fallback strings", () => {
  it("rejects output containing an (error: ...) LLM-fallback string", () => {
  
    const result = verifyProductionReadiness("(error: request timed out after 10000ms)", "code", 0);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i: string) => /error:/i.test(i))).toBe(true);
  });

  it("rejects output containing (error: rate limit exceeded)", () => {
    
    const result = verifyProductionReadiness("(error: rate limit exceeded)", "general", 0);
    expect(result.passed).toBe(false);
  });
});
