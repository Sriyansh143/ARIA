/**
 * tests/conductor-router.test.ts — v59 Strategic Upgrade Tests
 *
 * Comprehensive coverage of the two Phase-59 architectural upgrades:
 *   1. Notion "AI Company Map" Autonomy Tags (conductor/router.ts)
 *   2. 500-AI-Agents-Projects Supervisor pattern (quality-supervisor.ts)
 *
 * Organized into 4 describe blocks for readable test output:
 *   describe("Autonomy Tag Routing — Workflows")
 *   describe("Autonomy Tag Routing — Skills")
 *   describe("Trajectory Validation — runTrajectoryValidation")
 *   describe("Quality Supervisor v59 — reviewWithTrajectoryCap")
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { db } from "../src/lib/db";
import {
  routeWorkflowByAutonomy,
  routeSkillByAutonomy,
  isApprovalResolved,
  routeAndWaitForApproval,
  AutonomyTag,
} from "../src/lib/conductor/router";
import {
  runTrajectoryValidation,
  qualitySupervisorReviewV59,
  reviewWithTrajectoryCap,
  MAX_RETRIES,
  type QualityReviewRequest,
} from "../src/lib/supervisors/quality-supervisor";

// Silence telegram sends in tests by leaving the env unset.
beforeEach(async () => {
  await db.workflowDefinition.deleteMany({});
  await db.skill.deleteMany({ where: { slug: { startsWith: "test-" } } });
  await db.approval.deleteMany({ where: { action: "execute_workflow_or_skill" } });
  await db.supervisorReview.deleteMany({ where: { supervisor: "quality-v59" } });
  await db.escalation.deleteMany({ where: { supervisor: "quality-v59" } });
});

afterEach(async () => {
  await db.workflowDefinition.deleteMany({});
  await db.skill.deleteMany({ where: { slug: { startsWith: "test-" } } });
  await db.approval.deleteMany({ where: { action: "execute_workflow_or_skill" } });
  await db.supervisorReview.deleteMany({ where: { supervisor: "quality-v59" } });
  await db.escalation.deleteMany({ where: { supervisor: "quality-v59" } });
});

// ────────────────────────────────────────────────────────────────────────
// 1. AUTONOMY TAG ROUTING — WORKFLOWS
// ────────────────────────────────────────────────────────────────────────

describe("Autonomy Tag Routing — Workflows", () => {
  it("refuses a HUMAN_LED workflow (owner must trigger manually)", async () => {
    const wf = await db.workflowDefinition.create({
      data: {
        slug: "test-human-led",
        name: "Manual Deploy",
        stepsJson: "[]",
        autonomyTag: AutonomyTag.HUMAN_LED,
      },
    });
    const d = await routeWorkflowByAutonomy(wf.id, "test-cron");
    expect(d.allowed).toBe(false);
    expect(d.autonomyTag).toBe(AutonomyTag.HUMAN_LED);
    expect(d.reason).toContain("HUMAN_LED");
    expect(d.approvalId).toBeUndefined();
  });

  it("allows a FULLY_AUTONOMOUS workflow (runs directly)", async () => {
    const wf = await db.workflowDefinition.create({
      data: {
        slug: "test-auto",
        name: "Auto Revenue Sweep",
        stepsJson: "[]",
        autonomyTag: AutonomyTag.FULLY_AUTONOMOUS,
      },
    });
    const d = await routeWorkflowByAutonomy(wf.id, "test-cron");
    expect(d.allowed).toBe(true);
    expect(d.autonomyTag).toBe(AutonomyTag.FULLY_AUTONOMOUS);
    expect(d.approvalId).toBeUndefined();
  });

  it("blocks a HUMAN_ASSISTED workflow + creates a pending Approval row", async () => {
    const wf = await db.workflowDefinition.create({
      data: {
        slug: "test-assisted",
        name: "Send Outreach Email",
        stepsJson: "[]",
        autonomyTag: AutonomyTag.HUMAN_ASSISTED,
      },
    });
    const d = await routeWorkflowByAutonomy(wf.id, "OutreachBot");
    expect(d.allowed).toBe(false);
    expect(d.autonomyTag).toBe(AutonomyTag.HUMAN_ASSISTED);
    expect(d.approvalId).toBeTruthy();

    const r = await isApprovalResolved(d.approvalId!);
    expect(r.resolved).toBe(false);
  });

  it("resolves the Approval to approved after the owner decides 'approved'", async () => {
    const wf = await db.workflowDefinition.create({
      data: {
        slug: "test-approve",
        name: "Approve Me",
        stepsJson: "[]",
        autonomyTag: AutonomyTag.HUMAN_ASSISTED,
      },
    });
    const d = await routeWorkflowByAutonomy(wf.id, "OutreachBot");
    await db.approval.update({
      where: { id: d.approvalId! },
      data: { status: "approved", decidedAt: new Date() },
    });
    const r = await isApprovalResolved(d.approvalId!);
    expect(r.resolved).toBe(true);
    expect(r.approved).toBe(true);
  });

  it("resolves the Approval to denied after the owner decides 'denied'", async () => {
    const wf = await db.workflowDefinition.create({
      data: {
        slug: "test-deny",
        name: "Deny Me",
        stepsJson: "[]",
        autonomyTag: AutonomyTag.HUMAN_ASSISTED,
      },
    });
    const d = await routeWorkflowByAutonomy(wf.id, "OutreachBot");
    await db.approval.update({
      where: { id: d.approvalId! },
      data: { status: "denied", decidedAt: new Date() },
    });
    const r = await isApprovalResolved(d.approvalId!);
    expect(r.resolved).toBe(true);
    expect(r.approved).toBe(false);
    expect(r.reason).toBe("denied");
  });

  it("returns 'not found' for an unknown workflow id", async () => {
    const d = await routeWorkflowByAutonomy("nonexistent-id", "test");
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("not found");
  });

  it("default autonomyTag is HUMAN_ASSISTED (safe default)", async () => {
    const wf = await db.workflowDefinition.create({
      data: {
        slug: "test-default",
        name: "Default Tag",
        stepsJson: "[]",
        // autonomyTag omitted — should default to HUMAN_ASSISTED
      },
    });
    expect(wf.autonomyTag).toBe(AutonomyTag.HUMAN_ASSISTED);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. AUTONOMY TAG ROUTING — SKILLS
// ────────────────────────────────────────────────────────────────────────

describe("Autonomy Tag Routing — Skills", () => {
  it("refuses a HUMAN_LED skill", async () => {
    const skill = await db.skill.create({
      data: {
        slug: "test-skill-human-led",
        name: "Manual Refund",
        category: "data",
        autonomyTag: AutonomyTag.HUMAN_LED,
      },
    });
    const d = await routeSkillByAutonomy(skill.id, "test-cron");
    expect(d.allowed).toBe(false);
    expect(d.autonomyTag).toBe(AutonomyTag.HUMAN_LED);
  });

  it("allows a FULLY_AUTONOMOUS skill", async () => {
    const skill = await db.skill.create({
      data: {
        slug: "test-skill-auto",
        name: "Auto Cache Sweep",
        category: "data",
        autonomyTag: AutonomyTag.FULLY_AUTONOMOUS,
      },
    });
    const d = await routeSkillByAutonomy(skill.id, "test-cron");
    expect(d.allowed).toBe(true);
    expect(d.autonomyTag).toBe(AutonomyTag.FULLY_AUTONOMOUS);
  });

  it("blocks a HUMAN_ASSISTED skill + creates an Approval row", async () => {
    const skill = await db.skill.create({
      data: {
        slug: "test-skill-assisted",
        name: "Send Newsletter",
        category: "media",
        autonomyTag: AutonomyTag.HUMAN_ASSISTED,
      },
    });
    const d = await routeSkillByAutonomy(skill.id, "test-cron");
    expect(d.allowed).toBe(false);
    expect(d.autonomyTag).toBe(AutonomyTag.HUMAN_ASSISTED);
    expect(d.approvalId).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. TRAJECTORY VALIDATION — runTrajectoryValidation
// ────────────────────────────────────────────────────────────────────────

describe("Trajectory Validation — runTrajectoryValidation", () => {
  it("passes a valid CLI tool that prints usage + exits 0", async () => {
    const files = {
      "cli.js": 'console.log("Usage: mycli <command>\\n  run      run the tool");',
    };
    const r = await runTrajectoryValidation(files, "cli-tool", {
      expectExitCode: 0,
      expectStdoutContains: "usage",
    });
    expect(r.passed).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toLowerCase()).toContain("usage");
  });

  it("fails a CLI that crashes with a non-zero exit code", async () => {
    const files = {
      "cli.js": 'console.log("starting..."); undefinedFunction();',
    };
    const r = await runTrajectoryValidation(files, "cli-tool", { expectExitCode: 0 });
    expect(r.passed).toBe(false);
    expect(r.exitCode).not.toBe(0);
  });

  it("fails when the expected stdout substring is missing", async () => {
    const files = {
      "cli.js": 'console.log("hello world");',
    };
    const r = await runTrajectoryValidation(files, "cli-tool", {
      expectExitCode: 0,
      expectStdoutContains: "usage",
    });
    expect(r.passed).toBe(false);
    expect(r.errors.some((e) => e.includes("stdout missing"))).toBe(true);
  });

  it("fails when forbidden stdout substring IS present", async () => {
    const files = {
      "cli.js": 'console.log("Usage: mycli\\nERROR: secret key leaked");',
    };
    const r = await runTrajectoryValidation(files, "cli-tool", {
      expectExitCode: 0,
      expectStdoutContains: "usage",
      forbidStdoutContains: "secret key leaked",
    });
    expect(r.passed).toBe(false);
    expect(r.errors.some((e) => e.includes("forbidden"))).toBe(true);
  });

  it("passes a blog-post with no executable trajectory (static-only)", async () => {
    const files = { "blog-post.md": "# My Post\n\nThis is a long enough blog post body to pass the length check." + " x".repeat(500) };
    const r = await runTrajectoryValidation(files, "blog-post", {});
    expect(r.passed).toBe(true);
  });

  it("passes a landing-page with no dry-run (static HTML check only)", async () => {
    const files = {
      "index.html": '<!DOCTYPE html><html><head><title>T</title><meta name="viewport" content="width=device-width"></head><body><p>hi</p></body></html>',
    };
    const r = await runTrajectoryValidation(files, "landing-page", {});
    expect(r.passed).toBe(true);
  });

  it("uses defaultAssertions when no explicit assertions are passed", async () => {
    // cli-tool default: expectExitCode=0, expectStdoutContains="usage"
    const files = {
      "cli.js": 'console.log("Usage: mycli <command>");',
    };
    const r = await runTrajectoryValidation(files, "cli-tool");
    expect(r.passed).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. QUALITY SUPERVISOR v59 — reviewWithTrajectoryCap
// ────────────────────────────────────────────────────────────────────────

describe("Quality Supervisor v59 — single review (qualitySupervisorReviewV59)", () => {
  it("approves a clean CLI deliverable (static + trajectory both pass)", async () => {
    const r = await qualitySupervisorReviewV59({
      workerAgent: "Build-Bot",
      action: "build_service",
      files: {
        "cli.js": 'console.log("Usage: mycli <command>\\n  run      run the tool");',
        "README.md": "# mycli\nA test CLI.",
      },
      serviceType: "cli-tool",
    });
    expect(r.approved).toBe(true);
    expect(r.dryRun.passed).toBe(true);
    expect(r.staticCheck.passed).toBe(true);
  });

  it("rejects empty files (no deliverable)", async () => {
    const r = await qualitySupervisorReviewV59({
      workerAgent: "Build-Bot",
      action: "build_service",
      files: {},
      serviceType: "cli-tool",
    });
    expect(r.approved).toBe(false);
    expect(r.staticCheck.errors[0]).toContain("No files");
  });

  it("rejects a CLI that crashes on execution", async () => {
    const r = await qualitySupervisorReviewV59({
      workerAgent: "Build-Bot",
      action: "build_service",
      files: {
        "cli.js": 'undefinedFunction();',
      },
      serviceType: "cli-tool",
    });
    expect(r.approved).toBe(false);
    expect(r.dryRun.passed).toBe(false);
  });

  it("records a supervisorReview row in the DB", async () => {
    await qualitySupervisorReviewV59({
      workerAgent: "Build-Bot",
      action: "build_service",
      files: { "cli.js": 'console.log("Usage: x");' },
      serviceType: "cli-tool",
    });
    const reviews = await db.supervisorReview.findMany({ where: { supervisor: "quality-v59" } });
    expect(reviews.length).toBe(1);
    expect(reviews[0].workerAgent).toBe("Build-Bot");
  });
});

describe("Quality Supervisor v59 — bounded retry loop (reviewWithTrajectoryCap)", () => {
  it("MAX_RETRIES is exactly 2 (user requirement)", () => {
    expect(MAX_RETRIES).toBe(2);
  });

  it("escalates to the owner after MAX_RETRIES=2 failed attempts", async () => {
    let generationCalls = 0;
    const result = await reviewWithTrajectoryCap(
      {
        workerAgent: "Build-Bot",
        action: "build_service",
        files: {},
        serviceType: "cli-tool",
      },
      async (_feedback, _attempt): Promise<QualityReviewRequest> => {
        generationCalls++;
        return {
          workerAgent: "Build-Bot",
          action: "build_service",
          files: {},
          serviceType: "cli-tool",
        };
      },
    );
    expect(result.approved).toBe(false);
    expect(generationCalls).toBe(MAX_RETRIES);
    const esc = await db.escalation.findFirst({ where: { supervisor: "quality-v59" } });
    expect(esc).toBeTruthy();
    expect(esc!.issue).toContain("hard cap");
  });

  it("approves on the 2nd retry (within the cap)", async () => {
    let attempt = 0;
    const result = await reviewWithTrajectoryCap(
      {
        workerAgent: "Build-Bot",
        action: "build_service",
        files: {},
        serviceType: "cli-tool",
      },
      async (_feedback, n): Promise<QualityReviewRequest> => {
        attempt = n;
        if (n >= 2) {
          return {
            workerAgent: "Build-Bot",
            action: "build_service",
            files: {
              "cli.js": 'console.log("Usage: mycli <command>\\n  run      run the tool");',
              "README.md": "# mycli\nA test CLI.",
            },
            serviceType: "cli-tool",
          };
        }
        return {
          workerAgent: "Build-Bot",
          action: "build_service",
          files: {},
          serviceType: "cli-tool",
        };
      },
    );
    expect(result.approved).toBe(true);
    expect(attempt).toBe(2);
    const esc = await db.escalation.findFirst({ where: { supervisor: "quality-v59" } });
    expect(esc).toBeNull();
  });

  it("approves on the first attempt (no retries needed)", async () => {
    const result = await reviewWithTrajectoryCap(
      {
        workerAgent: "Build-Bot",
        action: "build_service",
        files: {
          "cli.js": 'console.log("Usage: mycli <command>\\n  run      run the tool");',
          "README.md": "# mycli",
        },
        serviceType: "cli-tool",
      },
      async (): Promise<QualityReviewRequest> => {
        throw new Error("generateFn should not be called on first-try approval");
      },
    );
    expect(result.approved).toBe(true);
    expect(result.attempts).toBe(0);
  });
});
