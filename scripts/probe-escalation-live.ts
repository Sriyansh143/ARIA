/**
 * scripts/probe-escalation-live.ts — Phase 32 Remediation
 *
 * Simulates a tool failure + shows the Debate/Escalate pattern working.
 * This produces VISUAL PROOF that:
 *   1. The Council Debate triggers (Tier 1)
 *   2. If no consensus, an Approval row is created (Tier 2)
 *   3. The Approval row is visible in the DB
 */

import { mock } from "bun:test";
mock.module("server-only", () => ({}));

import { db } from "../src/lib/db";

async function main() {
  console.log("=== TOOL FAILURE ESCALATION LIVE PROBE ===");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log();

  // Clean up any existing tool-failure approvals.
  await db.approval.deleteMany({
    where: { action: "tool-failure-decision" },
  });
  console.log("[setup] Cleaned up existing tool-failure approvals");
  console.log();

  // 1. Call escalateToolFailure with a simulated error
  console.log("[1] Calling escalateToolFailure with simulated 'web_search 404' error...");
  try {
    const { escalateToolFailure } = await import("../src/lib/tool-failure-escalation");
    const result = await escalateToolFailure({
      tool: "web_search",
      error: "Function invoke failed with status 404: {\"status\":404,\"error\":\"Not Found\",\"path\":\"/v4/functions/invoke\"}",
      module: "google-maps-scout",
      context: "Searching for restaurants in Chennai (simulated failure for escalation test)",
      attempts: 1,
      lastTriedAt: new Date(),
    });

    console.log(`    escalated: ${result.escalated}`);
    console.log(`    strategy: ${result.strategy ?? "none"}`);
    console.log(`    approvalId: ${result.approvalId ?? "none"}`);
    console.log(`    debateId: ${result.debateId ?? "none"}`);
    console.log(`    reason: ${result.reason}`);
  } catch (err) {
    console.log(`    ✗ escalation failed: ${err}`);
  }
  console.log();

  // 2. Check the DB for the created Approval row
  console.log("[2] Checking DB for tool-failure-decision Approval rows...");
  try {
    const approvals = await db.approval.findMany({
      where: { action: "tool-failure-decision" },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    console.log(`    Found ${approvals.length} tool-failure approval(s):`);
    for (const a of approvals) {
      console.log(`      • ID: ${a.id}`);
      console.log(`        Title: ${a.title}`);
      console.log(`        Risk: ${a.risk}`);
      console.log(`        Status: ${a.status}`);
      console.log(`        Requester: ${a.requester}`);
      console.log(`        Action: ${a.action}`);
      console.log(`        Payload: ${a.payload?.slice(0, 200) ?? "null"}`);
      console.log(`        Created: ${a.createdAt.toISOString()}`);
      console.log();
    }
  } catch (err) {
    console.log(`    ✗ DB query failed: ${err}`);
  }

  // 3. Check for DebateSession rows (the council debate)
  console.log("[3] Checking DB for DebateSession rows...");
  try {
    const debates = await db.debateSession.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
    });
    console.log(`    Found ${debates.length} recent debate(s):`);
    for (const d of debates) {
      console.log(`      • ID: ${d.id}`);
      console.log(`        Topic: ${d.topic.slice(0, 100)}...`);
      console.log(`        Consensus: ${d.consensus?.slice(0, 100) ?? "none"}`);
      console.log(`        Confidence: ${d.confidence}`);
      console.log(`        Status: ${d.status}`);
      console.log();
    }
  } catch (err) {
    console.log(`    ✗ DB query failed: ${err}`);
  }

  // 4. Verify deduplication — calling again should NOT create a new approval
  console.log("[4] Testing deduplication — calling escalateToolFailure again...");
  try {
    const { escalateToolFailure } = await import("../src/lib/tool-failure-escalation");
    const result2 = await escalateToolFailure({
      tool: "web_search",
      error: "same 404 error",
      module: "google-maps-scout",
      context: "same query",
      attempts: 2,
      lastTriedAt: new Date(),
    });
    console.log(`    escalated: ${result2.escalated}`);
    console.log(`    reason: ${result2.reason}`);
    console.log(`    → Should be "escalation already pending (deduped within 1 hour)"`);

    const count = await db.approval.count({ where: { action: "tool-failure-decision" } });
    console.log(`    Total tool-failure approvals in DB: ${count} (should be 1 — deduped)`);
  } catch (err) {
    console.log(`    ✗ dedup test failed: ${err}`);
  }

  console.log();
  console.log("=== PROBE COMPLETE ===");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
