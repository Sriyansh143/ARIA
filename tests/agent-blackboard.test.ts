/**
 * tests/agent-blackboard.test.ts — v61 FIX (Finding 5c) tests
 *
 * Verifies that when two agents try to claim the same resource (e.g.
 * email:same@address.com), the dispatcher:
 *   1. Allows the first agent to claim it (postToBlackboard succeeds).
 *   2. BLOCKS the second agent (isResourceClaimed returns true).
 *   3. Marks the second agent's Task as "blocked".
 *   4. Triggers the pivot logic (promoteNextNonBlockedTask) which promotes
 *      the next non-conflicting pending task to "running".
 *
 * Also verifies the blackboard's core lock/conflict semantics directly.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { db } from "../src/lib/db";
import {
  postToBlackboard,
  readBlackboard,
  releaseFromBlackboard,
  isResourceClaimed,
} from "../src/lib/agent-blackboard";
import { dispatchToAgent, promoteNextNonBlockedTask } from "../src/lib/conductor/dispatcher";

beforeEach(async () => {
  // Clear the blackboard + any test tasks/agents/subagent tasks.
  await db.setting.deleteMany({ where: { key: "agent-blackboard.active" } });
  await db.subAgentTask.deleteMany({ where: { task: { contains: "same@address.com" } } });
  await db.subAgentTask.deleteMany({ where: { task: { contains: "test-dispatch" } } });
  await db.task.deleteMany({ where: { title: { contains: "test-blackboard" } } });
  await db.agent.deleteMany({ where: { name: { startsWith: "Test-Dispatcher-" } } });
});

afterEach(async () => {
  await db.setting.deleteMany({ where: { key: "agent-blackboard.active" } });
  await db.subAgentTask.deleteMany({ where: { task: { contains: "same@address.com" } } });
  await db.subAgentTask.deleteMany({ where: { task: { contains: "test-dispatch" } } });
  await db.task.deleteMany({ where: { title: { contains: "test-blackboard" } } });
  await db.agent.deleteMany({ where: { name: { startsWith: "Test-Dispatcher-" } } });
});

// ────────────────────────────────────────────────────────────────────────
// 1. CORE BLACKBOARD SEMANTICS
// ────────────────────────────────────────────────────────────────────────

describe("Agent Blackboard — core lock/conflict semantics (Finding 5c)", () => {
  it("postToBlackboard claims a resource so isResourceClaimed returns true", async () => {
    const resource = "email:alice@example.com";
    expect(await isResourceClaimed(resource)).toBe(false);

    const posted = await postToBlackboard({
      agentName: "Agent-A",
      action: "emailing Alice",
      resourceClaim: resource,
      postedAt: new Date().toISOString(),
    });
    expect(posted).toBe(true);
    expect(await isResourceClaimed(resource)).toBe(true);

    const snapshot = await readBlackboard();
    expect(snapshot.claimedResources).toContain(resource);
  });

  it("postToBlackboard refuses to double-claim the same resource (conflict)", async () => {
    const resource = "email:bob@example.com";
    // First agent claims it.
    const first = await postToBlackboard({
      agentName: "Agent-A",
      action: "emailing Bob",
      resourceClaim: resource,
      postedAt: new Date().toISOString(),
    });
    expect(first).toBe(true);

    // Second agent tries to claim the same resource — must be refused.
    const second = await postToBlackboard({
      agentName: "Agent-B",
      action: "emailing Bob",
      resourceClaim: resource,
      postedAt: new Date().toISOString(),
    });
    expect(second).toBe(false);
    expect(await isResourceClaimed(resource)).toBe(true);
  });

  it("releaseFromBlackboard frees the resource so it can be re-claimed", async () => {
    const resource = "email:carol@example.com";
    await postToBlackboard({
      agentName: "Agent-A",
      action: "emailing Carol",
      resourceClaim: resource,
      postedAt: new Date().toISOString(),
    });
    expect(await isResourceClaimed(resource)).toBe(true);

    await releaseFromBlackboard("Agent-A", resource);
    expect(await isResourceClaimed(resource)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. DISPATCHER ENFORCEMENT — two agents, same email, second is blocked + pivoted
// ────────────────────────────────────────────────────────────────────────

describe("Dispatcher Blackboard Enforcement (Finding 5c) — two agents, same email", () => {
  it("blocks the second agent + marks the task blocked + pivots to the next task", async () => {
    // Seed an agent in the Sales department so findAgent() succeeds.
    const agent = await db.agent.create({
      data: {
        name: "Test-Dispatcher-SDR",
        role: "Sales",
        department: "Sales",
        tier: "balanced",
        status: "idle",
        capabilities: '["outreach"]',
      },
    });

    // Pre-claim the email resource (simulating Agent A already working on it).
    const emailResource = "email:same@address.com";
    await postToBlackboard({
      agentName: "Agent-A",
      action: "emailing same@address.com",
      resourceClaim: emailResource,
      postedAt: new Date().toISOString(),
    });

    // Create the blocked task (the one Agent B tries to dispatch) + a
    // pending pivot candidate task.
    const blockedTask = await db.task.create({
      data: {
        title: "test-blackboard-blocked",
        description: "Send outreach email to same@address.com",
        status: "pending",
        priority: "high",
        kind: "work",
      },
    });
    const pivotTask = await db.task.create({
      data: {
        title: "test-blackboard-pivot",
        description: "Email a different lead other@address.com",
        status: "pending",
        priority: "medium",
        kind: "work",
      },
    });

    // Agent B tries to dispatch to the SAME email — must be blocked.
    const result = await dispatchToAgent({
      department: "Sales",
      role: "Sales",
      task: "Send outreach email to same@address.com",
      parentId: "agent-b",
      taskId: blockedTask.id,
    });

    // Assert the dispatch was rejected with a CONFLICT error.
    expect(result.ok).toBe(false);
    expect(result.error).toContain("CONFLICT");
    expect(result.error).toContain(emailResource);

    // Assert the blocked task's status was updated to "blocked".
    const refreshedBlocked = await db.task.findUnique({ where: { id: blockedTask.id } });
    expect(refreshedBlocked?.status).toBe("blocked");
    expect(refreshedBlocked?.result).toContain("CONFLICT");

    // Assert the pivot logic promoted the next non-blocked pending task.
    const refreshedPivot = await db.task.findUnique({ where: { id: pivotTask.id } });
    expect(refreshedPivot?.status).toBe("running");
    expect(refreshedPivot?.startedAt).toBeTruthy();
  });

  it("allows a dispatch when the resource is NOT claimed (no false positives)", async () => {
    // Seed an agent.
    await db.agent.create({
      data: {
        name: "Test-Dispatcher-SDR-2",
        role: "Sales",
        department: "Sales",
        tier: "balanced",
        status: "idle",
        capabilities: '["outreach"]',
      },
    });

    // No pre-claim — the resource is free. The dispatch should proceed past
    // the blackboard check (it will then try to call the LLM, which may fail
    // in the test env, but the blackboard check itself must NOT block).
    // We only assert that the blackboard check did not produce a CONFLICT.
    const result = await dispatchToAgent({
      department: "Sales",
      role: "Sales",
      task: "Send outreach email to unique-lead@example.com",
      parentId: "agent-c",
    });

    // The dispatch either succeeds (if LLM is available) or fails for an
    // LLM-related reason — but it must NOT be a CONFLICT.
    if (!result.ok) {
      expect(result.error).not.toContain("CONFLICT");
    }
    // The resource should now be claimed on the blackboard.
    expect(await isResourceClaimed("email:unique-lead@example.com")).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. PIVOT LOGIC — promoteNextNonBlockedTask
// ────────────────────────────────────────────────────────────────────────

describe("promoteNextNonBlockedTask (Finding 5c pivot)", () => {
  it("promotes the oldest pending task to running (excluding the blocked one)", async () => {
    const t1 = await db.task.create({
      data: { title: "test-blackboard-pivot-1", status: "pending", priority: "medium" },
    });
    const t2 = await db.task.create({
      data: { title: "test-blackboard-pivot-2", status: "pending", priority: "low" },
    });

    const promotedId = await promoteNextNonBlockedTask(t1.id);
    expect(promotedId).toBe(t2.id); // t1 excluded, t2 is next oldest

    const refreshed = await db.task.findUnique({ where: { id: t2.id } });
    expect(refreshed?.status).toBe("running");
  });

  it("returns null when no non-blocked pending task exists", async () => {
    const onlyTask = await db.task.create({
      data: { title: "test-blackboard-pivot-only", status: "pending", priority: "medium" },
    });
    const promotedId = await promoteNextNonBlockedTask(onlyTask.id);
    expect(promotedId).toBeNull();
  });
});
