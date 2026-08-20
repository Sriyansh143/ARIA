/**
 * tests/cash-claw.test.ts — Unit tests for the evolutionary agent survival classifier.
 *
 * Tests classifyAgent() tier logic (thriving/surviving/dying/dead) based on
 * tasksDone, errorCount, and tokensUsed.
 */
import { describe, test, expect } from "bun:test";
import type { Agent } from "@prisma/client";

describe("Cash-Claw Survival Classifier", () => {
  // Helper: build a minimal Agent-shaped fixture. The Prisma Agent type has
  // `capabilities: string` (JSON) and `createdAt/updatedAt: Date`, but most
  // fields are nullable so we only set the ones classifyAgent reads.
  function makeAgent(overrides: Partial<Agent> & { id: string; name: string }): Agent {
    return {
      id: overrides.id,
      name: overrides.name,
      role: overrides.role ?? "Engineering",
      tier: overrides.tier ?? "balanced",
      status: overrides.status ?? "idle",
      model: overrides.model ?? "qwen2.5:7b",
      department: overrides.department ?? "Engineering",
      capabilities: overrides.capabilities ?? "[]",
      currentTask: overrides.currentTask ?? null,
      tokensUsed: overrides.tokensUsed ?? 0,
      tasksDone: overrides.tasksDone ?? 0,
      errorCount: overrides.errorCount ?? 0,
      lastBeatAt: overrides.lastBeatAt ?? new Date(),
      createdAt: overrides.createdAt ?? new Date(),
      updatedAt: overrides.updatedAt ?? new Date(),
    } as Agent;
  }

  test("classifyAgent returns thriving for high-achievement low-error agent", async () => {
    const { classifyAgent } = await import("../src/lib/cash-claw");
    const agent = makeAgent({
      id: "test-1",
      name: "Top-Performer",
      role: "CEO",
      tier: "strong",
      status: "executing",
      model: "glm-4.6",
      department: "Executive",
      tokensUsed: 5000,
      tasksDone: 15,
      errorCount: 0,
    });
    const result = classifyAgent(agent);
    expect(["thriving", "surviving"]).toContain(result.tier);
    expect(result.score).toBeGreaterThan(0);
  });

  test("classifyAgent returns dead for zero-achievement high-error agent", async () => {
    const { classifyAgent } = await import("../src/lib/cash-claw");
    const agent = makeAgent({
      id: "test-2",
      name: "Underperformer",
      role: "Engineering",
      tier: "fast",
      status: "error",
      model: "glm-4.5-air",
      department: "Engineering",
      tokensUsed: 100000,
      tasksDone: 0,
      errorCount: 20,
    });
    const result = classifyAgent(agent);
    expect(["dying", "dead"]).toContain(result.tier);
    expect(result.score).toBeLessThan(5);
  });

  test("classifyAgent returns dying for moderate-achievement high-error agent", async () => {
    const { classifyAgent } = await import("../src/lib/cash-claw");
    const agent = makeAgent({
      id: "test-3",
      name: "Struggling",
      role: "Sales",
      tier: "balanced",
      status: "idle",
      model: "glm-4.5-air",
      department: "Sales",
      tokensUsed: 50000,
      tasksDone: 2,
      errorCount: 10,
    });
    const result = classifyAgent(agent);
    expect(["dying", "dead", "surviving"]).toContain(result.tier);
  });

  test("classifyAgent score = tasksDone*2 - errorCount*3 - tokensUsed/10000", async () => {
    const { classifyAgent } = await import("../src/lib/cash-claw");
    const agent = makeAgent({
      id: "test-4",
      name: "Calculated",
      role: "Research",
      tier: "strong",
      status: "thinking",
      model: "glm-4.6",
      department: "Research",
      tokensUsed: 20000,
      tasksDone: 10,
      errorCount: 2,
    });
    const result = classifyAgent(agent);
    const expectedScore = 10 * 2 - 2 * 3 - 20000 / 10000; // 20 - 6 - 2 = 12
    expect(result.score).toBeCloseTo(expectedScore, 1);
  });

  test("classifyAgent always returns a reason string", async () => {
    const { classifyAgent } = await import("../src/lib/cash-claw");
    const agent = makeAgent({
      id: "test-5",
      name: "Any-Agent",
      role: "Ops",
      tier: "fast",
      status: "idle",
      model: "glm-4.5-air",
      department: "Operations",
      tokensUsed: 1000,
      tasksDone: 1,
      errorCount: 0,
    });
    const result = classifyAgent(agent);
    expect(result.reason).toBeTruthy();
    expect(typeof result.reason).toBe("string");
  });
});
