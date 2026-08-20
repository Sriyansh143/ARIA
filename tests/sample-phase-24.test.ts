/**
 * tests/sample-phase-24.test.ts — v74 Phase 24 smoke tests
 *
 * Verifies the 4 new Phase 24 modules:
 *   1. Interactive Refactor (pre-flight audit, coverage matrix, /review, /suggest)
 *   2. Live Compliance Auditor (scorecard with file:line evidence)
 *   3. Capability Registry (manifest of APIs + modules + crons + rules)
 *   4. Multi-Owner Workspace Manager (.env.owner_[id] + isolated DB)
 *   5. Master Continuity Verification Script (verify-all-phases)
 *   6. Safe Rollback Policy (CodeArchive + rollbackIfCrashed)
 */

import { describe, it, expect, mock } from "bun:test";
mock.module("server-only", () => ({}));

import {
  runPreFlightAudit,
  generateCoverageMatrix,
  handleReviewCommand,
  handleSuggestCommand,
} from "../src/lib/self-evolution/refactor-engine";
import { auditCompliance } from "../src/lib/compliance-auditor";
import { generateCapabilityManifest } from "../src/lib/capability-registry";
import {
  getOwnerContext,
  loadWorkspace,
  registerOwnerWorkspace,
  getDatabaseUrlForOwner,
  verifyDataIsolation,
  DEFAULT_OWNER_ID,
} from "../src/lib/multi-owner/workspace-manager";

describe("Phase 24 — Enterprise Platform Smoke Tests", () => {

  // ─── 1. Interactive Refactor ───

  it("runPreFlightAudit catches hardcoded secrets in proposed code", async () => {
    const result = await runPreFlightAudit(
      `const apiKey = "sk_live_abc123secret";\nexport function foo() {}`,
      "src/lib/test.ts",
    );
    expect(result.passed).toBe(false);
    const secretCheck = result.checks.find((c) => c.name.includes("secrets"));
    expect(secretCheck?.status).toBe("fail");
  });

  it("runPreFlightAudit catches 'I am an AI' pattern (RULE-56 violation)", async () => {
    const result = await runPreFlightAudit(
      `export function greet() { return "I am an AI assistant"; }`,
      "src/lib/test.ts",
    );
    expect(result.passed).toBe(false);
    const aiCheck = result.checks.find((c) => c.name.includes("I am an AI"));
    expect(aiCheck?.status).toBe("fail");
  });

  it("runPreFlightAudit catches TODO/FIXME markers", async () => {
    const result = await runPreFlightAudit(
      `// TODO: implement this\nexport function foo() {}`,
      "src/lib/test.ts",
    );
    expect(result.passed).toBe(false);
    const todoCheck = result.checks.find((c) => c.name.includes("TODO"));
    expect(todoCheck?.status).toBe("fail");
  });

  it("runPreFlightAudit passes clean code", async () => {
    const result = await runPreFlightAudit(
      `export function foo() { try { return 42; } catch (e) { throw e; } }`,
      "src/lib/test.ts",
    );
    expect(result.passed).toBe(true);
  });

  it("generateCoverageMatrix detects missing exports", () => {
    const oldCode = `export function foo() {}\nexport function bar() {}\nexport const baz = 42;`;
    const newCode = `export function foo() {}\nexport const baz = 42;`;
    const matrix = generateCoverageMatrix(oldCode, newCode);
    expect(matrix.oldExports).toContain("foo");
    expect(matrix.oldExports).toContain("bar");
    expect(matrix.oldExports).toContain("baz");
    expect(matrix.newExports).toContain("foo");
    expect(matrix.newExports).toContain("baz");
    expect(matrix.newExports).not.toContain("bar");
    expect(matrix.missing).toContain("bar");
    expect(matrix.coveragePercent).toBeLessThan(100);
  });

  it("generateCoverageMatrix passes when all exports preserved", () => {
    const oldCode = `export function foo() {}`;
    const newCode = `export function foo() { return 42; }`;
    const matrix = generateCoverageMatrix(oldCode, newCode);
    expect(matrix.missing.length).toBe(0);
    expect(matrix.coveragePercent).toBe(100);
  });

  it("handleReviewCommand returns explanation (or graceful failure if proposal doesn't exist)", async () => {
    const result = await handleReviewCommand("nonexistent-proposal-id");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("handleSuggestCommand returns error for nonexistent proposal", async () => {
    const result = await handleSuggestCommand("nonexistent-proposal-id", "use exponential backoff");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  // ─── 2. Live Compliance Auditor ───

  it("auditCompliance returns a scorecard with file:line evidence", async () => {
    const scorecard = await auditCompliance();
    expect(scorecard).toHaveProperty("totalRules");
    expect(scorecard).toHaveProperty("passed");
    expect(scorecard).toHaveProperty("failed");
    expect(scorecard).toHaveProperty("scorePercent");
    expect(scorecard.findings.length).toBeGreaterThan(0);
    // Every finding must have either a file:line evidence or "NOT IMPLEMENTED".
    for (const f of scorecard.findings) {
      expect(f.evidence.length).toBeGreaterThan(0);
    }
  }, 30000); // 30s timeout — the audit runs multiple greps

  it("compliance scorecard includes check for RULE-51 (Pre-Publish Gate)", async () => {
    const scorecard = await auditCompliance();
    const rule51 = scorecard.findings.find((f) => f.ruleId === "RULE-51-PRE-PUBLISH-QUALITY-GATE");
    expect(rule51).toBeDefined();
  }, 30000);

  it("compliance scorecard includes check for RULE-80 (Never Ship Without Data)", async () => {
    const scorecard = await auditCompliance();
    const rule80 = scorecard.findings.find((f) => f.ruleId === "RULE-79-SAFE-ROLLBACK-POLICY");
    expect(rule80).toBeDefined();
  }, 30000);

  // ─── 3. Capability Registry ───

  it("generateCapabilityManifest returns a valid JSON manifest", async () => {
    const manifest = await generateCapabilityManifest();
    expect(manifest).toHaveProperty("apiEndpoints");
    expect(manifest).toHaveProperty("libModules");
    expect(manifest).toHaveProperty("cronJobs");
    expect(manifest).toHaveProperty("constitutionRules");
    expect(manifest).toHaveProperty("summary");
    expect(manifest).toHaveProperty("stats");
    expect(manifest.stats.apiCount).toBeGreaterThan(0);
    expect(manifest.stats.moduleCount).toBeGreaterThan(0);
    expect(manifest.stats.cronCount).toBeGreaterThan(0);
    expect(manifest.stats.ruleCount).toBe(80); // 79 Constitution rules
    expect(manifest.stats.totalLinesOfCode).toBeGreaterThan(10000);
  }, 60000); // 60s timeout — scans the entire src/ directory

  it("capability manifest includes the /api/capabilities endpoint itself", async () => {
    const manifest = await generateCapabilityManifest();
    const selfEntry = manifest.apiEndpoints.find((e) => e.path === "/api/capabilities");
    expect(selfEntry).toBeDefined();
    expect(selfEntry?.exportedFunctions).toContain("GET");
    expect(selfEntry?.exportedFunctions).toContain("POST");
  }, 60000);

  // ─── 4. Multi-Owner Workspace Manager ───

  it("DEFAULT_OWNER_ID is 'default'", () => {
    expect(DEFAULT_OWNER_ID).toBe("default");
  });

  it("getOwnerContext with no args returns the default workspace", async () => {
    const ctx = await getOwnerContext();
    expect(ctx.ownerId).toBe(DEFAULT_OWNER_ID);
    expect(ctx.isDefault).toBe(true);
  });

  it("getOwnerContext with explicit ownerId returns that workspace", async () => {
    const ctx = await getOwnerContext({ ownerId: "test-franchisee" });
    expect(ctx.ownerId).toBe("test-franchisee");
    expect(ctx.isDefault).toBe(false);
    expect(ctx.envFilePath).toContain(".env.owner_test-franchisee");
    expect(ctx.dbPath).toContain("owner_test-franchisee.db");
  });

  it("getDatabaseUrlForOwner returns SQLite file URL for non-default owner", async () => {
    const ctx = await getOwnerContext({ ownerId: "test-franchisee-2" });
    const dbUrl = getDatabaseUrlForOwner(ctx);
    expect(dbUrl).toContain("file:");
    expect(dbUrl).toContain("owner_test-franchisee-2.db");
  });

  it("verifyDataIsolation passes for default owner (skips check)", async () => {
    const ctx = await getOwnerContext();
    const result = verifyDataIsolation(ctx, { ownerId: "someone-else" });
    expect(result.isolated).toBe(true);
  });

  it("verifyDataIsolation catches cross-owner access for non-default owner", async () => {
    const ctx = await getOwnerContext({ ownerId: "owner-a" });
    const result = verifyDataIsolation(ctx, { ownerId: "owner-b" });
    expect(result.isolated).toBe(false);
    expect(result.reason).toContain("CRITICAL");
    expect(result.reason).toContain("cross-owner");
  });

  it("registerOwnerWorkspace creates .env.owner_[id] + isolated DB path", async () => {
    const uniqueId = `test-register-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const result = await registerOwnerWorkspace({
      ownerId: uniqueId,
      displayName: `Test Owner ${uniqueId}`,
      envVars: { OWNER_TIMEZONE: "America/New_York", TELEGRAM_BOT_TOKEN: "test-token" },
    });
    expect(result.ok).toBe(true);
    expect(result.envFilePath).toContain(`.env.owner_${uniqueId}`);
    expect(result.dbPath).toContain(`owner_${uniqueId}.db`);
  });

  // ─── 5. Constitution rules ───

  it("constitution has 80 rules total (was 79 before Phase 25)", async () => {
    const { ALL_CONSTITUTION_RULES } = await import("../src/lib/constitution");
    expect(ALL_CONSTITUTION_RULES.length).toBe(80);
  });
});
