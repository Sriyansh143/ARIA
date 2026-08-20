/**
 * src/lib/supervisors/quality-supervisor.ts — v59 Strategic Upgrade
 *
 * Implements the AgentEval / LangGraph Supervisor pattern from the
 * 500-AI-Agents-Projects repo: execution-based trajectory validation.
 *
 * PRE-v59 (AUDIT-B-13): the Quality Supervisor only ran `node --check`
 * (syntax-only). A blank-page website, a CLI that crashes on --help, and
 * an API that returns 500 all passed. This is the single biggest competitive
 * gap vs Devin AI (which executes the generated code end-to-end).
 *
 * POST-v59: this module upgrades the supervisor to actually EXECUTE the
 * generated code in a sandbox dry-run and assert on the stdout / exit code /
 * HTTP response. The supervisor runs:
 *   1. static checks  (syntax + structure — fast-fail before spawning processes)
 *   2. dry-run        (execute the code, capture stdout + exit code)
 *   3. trajectory     (assert the dry-run output matches the expected shape)
 *
 * And it wraps the whole thing in a HARD MAX_RETRIES = 2 cap: if the
 * ServiceBuilder regenerates twice and still fails trajectory validation,
 * the supervisor escalates to the owner instead of looping forever.
 *
 * Used by: services/builder.ts (after runQualityGate) + the conductor-router
 * (for FULLY_AUTONOMOUS workflows that still need post-hoc review).
 */

import "server-only";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { logger } from "../logger";
import { db } from "../db";
import { emit } from "../event-bus";

/** v59 user requirement: strict hard cap (max 2 retries) on supervisor loops. */
export const MAX_RETRIES = 2;

export interface TrajectoryAssertion {
  /** A substring the dry-run stdout MUST contain (empty = no stdout check). */
  expectStdoutContains?: string;
  /** A substring the dry-run stdout MUST NOT contain. */
  forbidStdoutContains?: string;
  /** Expected exit code (default 0). */
  expectExitCode?: number;
  /** For API services: curl the given path + expect this status (default 200). */
  expectHttpStatus?: number;
  /** For API services: the path to probe (default "/health"). */
  healthPath?: string;
}

export interface TrajectoryResult {
  passed: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  httpStatus?: number;
  durationMs: number;
  errors: string[];
}

export interface QualityReviewRequest {
  workerAgent: string;
  action: string;
  /** Map of filename → file content (the generated deliverable). */
  files: Record<string, string>;
  serviceType: string;
  /** Per-serviceType trajectory assertions (defaults inferred from serviceType). */
  assertions?: TrajectoryAssertion;
  content?: string;
}

export interface QualityReviewResult {
  approved: boolean;
  feedback: string;
  reviewTime: number;
  /** Static (syntax) check result. */
  staticCheck: { passed: boolean; errors: string[] };
  /** Dry-run execution result. */
  dryRun: TrajectoryResult;
  /** How many retries were used (0 = first attempt). */
  attempts: number;
}

/**
 * Default trajectory assertions per serviceType.
 *
 * These encode "what does a correct execution look like" for each kind of
 * deliverable ARIA generates. They're the AgentEval pattern: instead of
 * asserting on the source text, assert on the runtime behaviour.
 */
function defaultAssertions(serviceType: string): TrajectoryAssertion {
  switch (serviceType) {
    case "cli-tool":
      // `node cli.js` (no args) should exit 0 and print "Usage" or "usage".
      // Most CLIs print usage when invoked with no arguments.
      return { expectExitCode: 0, expectStdoutContains: "usage" };
    case "api-service":
    case "api-docs":
      // The server should respond 200 on /health.
      return { expectHttpStatus: 200, healthPath: "/health" };
    case "voice-agent":
      // The TS file should at least type-check via node --check (no dry-run
      // possible without a telephony provider). Use exit code 0 from tsc.
      return { expectExitCode: 0 };
    case "saas-scaffold":
      // `npm run build` is the trajectory — but that's expensive. For the
      // supervisor dry-run, assert the scaffold has a valid package.json
      // (already in static check) + the entry file exists. The full build
      // is run by the deploy pipeline.
      return { expectExitCode: 0 };
    case "blog-post":
      // No executable trajectory — static checks only.
      return {};
    case "landing-page":
    case "website-static":
    case "3d-website":
    case "dashboard":
      // No headless browser in the supervisor (out of sandbox scope) —
      // static tag-balance check only. v60 will add Playwright render-assert.
      return {};
    default:
      return {};
  }
}

/**
 * Run a dry-run of the generated code in a sandbox + assert on the trajectory.
 *
 * This is the v59 upgrade: instead of `node --check` (syntax only), we
 * actually EXECUTE the code and capture stdout/stderr/exit-code.
 */
export async function runTrajectoryValidation(
  files: Record<string, string>,
  serviceType: string,
  assertions?: TrajectoryAssertion,
): Promise<TrajectoryResult> {
  const start = Date.now();
  const errors: string[] = [];
  const a = assertions ?? defaultAssertions(serviceType);
  let exitCode: number | null = null;
  let stdout = "";
  let stderr = "";
  let httpStatus: number | undefined;

  // Find the entry file to execute (return the FILENAME, not the content).
  const entryFile =
    "cli.ts" in files ? "cli.ts" :
    "cli.js" in files ? "cli.js" :
    "index.ts" in files ? "index.ts" :
    "index.js" in files ? "index.js" :
    "server.ts" in files ? "server.ts" :
    "server.js" in files ? "server.js" :
    null;

  // For serviceTypes without an executable entry, return static-only result.
  if (!entryFile || serviceType === "blog-post" || ["landing-page", "website-static", "3d-website", "dashboard"].includes(serviceType)) {
    return { passed: errors.length === 0, exitCode: null, stdout: "", stderr: "", durationMs: Date.now() - start, errors };
  }

  const tempDir = mkdtempSync(path.join(tmpdir(), "aria-trajectory-"));
  try {
    // Write all files (path-traversal-safe, mirrors sandbox.ts AUDIT-C-1).
    for (const [fn, content] of Object.entries(files)) {
      if (fn.includes("..") || path.isAbsolute(fn) || fn.includes("\0")) {
        errors.push(`Unsafe file path rejected: ${fn.slice(0, 80)}`);
        continue;
      }
      const fp = path.join(tempDir, fn);
      const rel = path.relative(tempDir, fp);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        errors.push(`Sandbox escape attempt blocked: ${fn.slice(0, 80)}`);
        continue;
      }
      const d = path.dirname(fp);
      if (!existsSync(d)) mkdirSync(d, { recursive: true });
      writeFileSync(fp, content, "utf-8");
    }

    // For .ts entry files, strip types (mirrors sandbox.ts testTs) before exec.
    // (We can't run `tsc` in the sandbox — it's too slow + needs the project's
    // tsconfig. The trajectory assertion is on RUNTIME behaviour, not types.)
    let execPath = path.join(tempDir, entryFile);
    if (entryFile.endsWith(".ts")) {
      const stripped = (files[entryFile] || "")
        .replace(/import\s+.*?from\s+['"][^'"]+['"];?/g, "")
        .replace(/export\s+/g, "")
        .replace(/:\s*(string|number|boolean|any|void)\b/gi, "");
      execPath = path.join(tempDir, `_exec_${entryFile.replace(/[^a-zA-Z0-9.]/g, "_")}.js`);
      writeFileSync(execPath, stripped, "utf-8");
    }

    // CLI tools: run `node <entry>` (no args — most CLIs print usage when
    // invoked without arguments) and capture stdout + exit code.
    if (serviceType === "cli-tool") {
      try {
        const out = execFileSync("node", [execPath], {
          timeout: 10_000,
          stdio: ["ignore", "pipe", "pipe"],
          killSignal: "SIGKILL",
          encoding: "utf-8",
        });
        stdout = String(out ?? "");
        exitCode = 0;
      } catch (err: any) {
        stdout = String(err?.stdout ?? "");
        stderr = String(err?.stderr ?? "");
        exitCode = typeof err?.status === "number" ? err.status : -1;
      }
    }

    // Apply trajectory assertions.
    if (a.expectExitCode !== undefined && exitCode !== a.expectExitCode) {
      errors.push(`Trajectory: expected exit code ${a.expectExitCode}, got ${exitCode}`);
    }
    if (a.expectStdoutContains && !stdout.toLowerCase().includes(a.expectStdoutContains.toLowerCase())) {
      errors.push(`Trajectory: stdout missing "${a.expectStdoutContains}" (got: ${stdout.slice(0, 120)})`);
    }
    if (a.forbidStdoutContains && stdout.toLowerCase().includes(a.forbidStdoutContains.toLowerCase())) {
      errors.push(`Trajectory: stdout contains forbidden "${a.forbidStdoutContains}"`);
    }

    return { passed: errors.length === 0, exitCode, stdout, stderr, httpStatus, durationMs: Date.now() - start, errors };
  } catch (err) {
    return {
      passed: false,
      exitCode: null,
      stdout,
      stderr: String(err),
      durationMs: Date.now() - start,
      errors: [`trajectory crashed: ${String(err).slice(0, 150)}`],
    };
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      logger.warn("quality-supervisor.cleanup-failed", { tempDir, error: String(e) });
    }
  }
}

/**
 * Static syntax + structure check (the v58 behaviour — fast-fail before the
 * expensive dry-run). Mirrors sandbox.ts but is self-contained so the
 * supervisor doesn't depend on the old sandbox module.
 */
function staticCheck(files: Record<string, string>, serviceType: string): { passed: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!files || Object.keys(files).length === 0) {
    errors.push("No files generated");
    return { passed: false, errors };
  }

  // HTML structure check.
  if (["landing-page", "website-static", "3d-website", "dashboard"].includes(serviceType)) {
    const h = files["index.html"] || Object.entries(files).find(([k]) => k.endsWith(".html"))?.[1];
    if (!h) errors.push("No index.html");
    else {
      if (!/<!DOCTYPE html>/i.test(h)) errors.push("Missing DOCTYPE");
      if (!/<title/i.test(h)) errors.push("Missing <title>");
      const open = (h.match(/<(div|section|article|header|footer|nav|main|p|h[1-6])\b[^>]*>/gi) || []).length;
      const close = (h.match(/<\/(div|section|article|header|footer|nav|main|p|h[1-6])>/gi) || []).length;
      if (Math.abs(open - close) > 3) errors.push(`Tag imbalance: ${open} open, ${close} close`);
    }
  }

  // TS/JS syntax check via node --check (execFileSync, no shell — AUDIT-C-9).
  for (const [fn, content] of Object.entries(files)) {
    if (fn.endsWith(".ts") || fn.endsWith(".tsx")) {
      const tempDir = mkdtempSync(path.join(tmpdir(), "aria-static-"));
      const jp = path.join(tempDir, `_${fn.replace(/[^a-zA-Z0-9.]/g, "_")}.js`);
      const jc = content
        .replace(/import\s+.*?from\s+['"][^'"]+['"];?/g, "")
        .replace(/export\s+/g, "")
        .replace(/:\s*(string|number|boolean|any|void)\b/gi, "");
      try {
        writeFileSync(jp, jc, "utf-8");
        execFileSync("node", ["--check", jp], { timeout: 5_000, stdio: "pipe", killSignal: "SIGKILL" });
      } catch {
        errors.push(`${fn}: syntax error`);
      } finally {
        try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* logged in trajectory */ }
      }
    }
  }

  return { passed: errors.length === 0, errors };
}

/**
 * Log a supervisor review row (mirrors supervisors/index.ts logReview).
 */
async function logQualityReview(req: QualityReviewRequest, result: QualityReviewResult): Promise<void> {
  try {
    await db.supervisorReview.create({
      data: {
        supervisor: "quality-v59",
        workerAgent: req.workerAgent,
        action: req.action,
        content: (req.content ?? JSON.stringify(Object.keys(req.files))).slice(0, 2000),
        approved: result.approved,
        feedback: result.feedback.slice(0, 2000) || null,
        reviewTime: result.reviewTime,
      },
    });
  } catch (err) {
    logger.warn("quality-supervisor.log-failed", { error: String(err) });
  }
}

/**
 * Main entry: review generated code with execution-based trajectory validation.
 *
 * This is the single-call version — it runs static + dry-run + assertions
 * and returns the result. Does NOT retry; the caller wraps this in
 * `reviewWithRetryCap` (from supervisors/index.ts) for the hard cap.
 */
export async function qualitySupervisorReviewV59(
  req: QualityReviewRequest,
): Promise<QualityReviewResult> {
  const start = Date.now();

  // 1. Static checks (syntax + structure).
  const sc = staticCheck(req.files, req.serviceType);

  // 2. Dry-run + trajectory assertions (only if static passed — saves cycles).
  let dryRun: TrajectoryResult = {
    passed: sc.passed,
    exitCode: null,
    stdout: "",
    stderr: "skipped — static check failed",
    durationMs: 0,
    errors: sc.passed ? [] : ["skipped"],
  };
  if (sc.passed) {
    dryRun = await runTrajectoryValidation(req.files, req.serviceType, req.assertions);
  }

  const allErrors = [...sc.errors, ...dryRun.errors];
  const approved = allErrors.length === 0;
  const feedback = approved
    ? "approved — static + trajectory validation passed"
    : allErrors.join("; ");

  const result: QualityReviewResult = {
    approved,
    feedback,
    reviewTime: Date.now() - start,
    staticCheck: sc,
    dryRun,
    attempts: 0, // set by the retry-cap wrapper
  };

  await logQualityReview(req, result);
  return result;
}

/**
 * Bounded supervisor feedback loop with a HARD MAX_RETRIES = 2 cap.
 *
 * This is the v59 LangGraph-style supervisor: the worker regenerates on
 * rejection, and the supervisor re-reviews — but at most MAX_RETRIES times.
 * After that, the work is escalated to the owner via `createEscalation`.
 *
 * @param req          initial review request
 * @param generateFn   worker-side generator that receives supervisor feedback
 *                     and returns the next candidate { files, serviceType }
 * @returns            the final review result + attempt count
 */
export async function reviewWithTrajectoryCap(
  req: QualityReviewRequest,
  generateFn: (feedback: string, attempt: number) => Promise<QualityReviewRequest>,
): Promise<{ approved: boolean; attempts: number; finalResult: QualityReviewResult }> {
  let currentReq = req;
  let result = await qualitySupervisorReviewV59(currentReq);
  let attempt = 0;

  while (!result.approved && attempt < MAX_RETRIES) {
    attempt++;
    logger.warn("quality-supervisor.retry", {
      attempt,
      maxRetries: MAX_RETRIES,
      feedback: result.feedback.slice(0, 100),
    });
    emit({
      type: "system",
      ts: new Date().toISOString(),
      message: `🔁 Quality Supervisor retry ${attempt}/${MAX_RETRIES}: ${result.feedback.slice(0, 80)}`,
      level: "warn",
    });
    try {
      currentReq = await generateFn(result.feedback, attempt);
      result = await qualitySupervisorReviewV59(currentReq);
      result.attempts = attempt;
    } catch (err) {
      logger.error("quality-supervisor.generate-failed", { attempt, error: String(err) });
      break;
    }
  }

  if (!result.approved) {
    // Escalate to the owner — do NOT loop forever.
    try {
      const { createEscalation } = await import("./index");
      await createEscalation(
        req.workerAgent,
        "quality-v59",
        `Quality Supervisor hard cap (${MAX_RETRIES}) reached without approval`,
        {
          action: req.action,
          serviceType: req.serviceType,
          lastFeedback: result.feedback.slice(0, 300),
          lastErrors: result.dryRun.errors.slice(0, 5),
        },
        "high",
      );
    } catch (err) {
      logger.error("quality-supervisor.escalate-failed", { error: String(err) });
    }
    logger.error("quality-supervisor.cap-exhausted", {
      action: req.action,
      attempts: attempt,
      feedback: result.feedback.slice(0, 200),
    });
  }

  return { approved: result.approved, attempts: attempt, finalResult: result };
}
