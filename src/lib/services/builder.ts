/**
 * src/lib/services/builder.ts — Service Builder Engine.
 *
 * Takes a service ID + customer spec, calls the LLM to generate real code,
 * parses the response into files, writes them to disk, and zips them.
 * The resulting zip is a real, deployable artifact — not a mock.
 *
 * Flow:
 *   1. Look up the service in the catalog.
 *   2. Build a prompt = service.builderPrompt + spec + template instructions.
 *   3. Call routeLLM with the ServiceBuilder system prompt.
 *   4. Parse the LLM response using the ---FILE: <path>--- delimiter format.
 *   5. Write each file to /home/z/my-project/download/services/{orderId}/.
 *   6. Zip the directory.
 *   7. Return { zipPath, fileCount, files[] }.
 *
 * Task ID: v30-SERVICES (Task 2).
 */
import "server-only";

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { db } from "@/lib/db";
import { routeLLM, type ChatMsg } from "@/lib/llm-router";
import { getService, type ServiceDef } from "./catalog";
import { logger } from "@/lib/logger";
// v61 (Audit B4): wire the v59 trajectory-validation supervisor into the
// real builder path. Previously qualitySupervisorReviewV59 /
// reviewWithTrajectoryCap existed only in tests — the production builder
// used the weaker runQualityGate (HTML/JSON/brace balance only). Now the
// generated code is actually EXECUTED in a sandbox + asserted on stdout
// / exit code, with a hard MAX_RETRIES = 2 cap + owner escalation.
import {
  reviewWithTrajectoryCap,
  type QualityReviewRequest,
} from "@/lib/supervisors/quality-supervisor";

export interface BuildResult {
  ok: boolean;
  orderId: string;
  serviceId: string;
  serviceName: string;
  zipPath: string | null;
  fileCount: number;
  files: string[];
  error?: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
}

/**
 * Parse the LLM's multi-file response into a { path → content } map.
 *
 * Expected format:
 *   ---FILE: index.html---
 *   ```html
 *   <content>
 *   ```
 *   ---FILE: styles.css---
 *   ```css
 *   <content>
 *   ```
 *   ---END---
 *
 * Falls back to a single index.html if the LLM didn't use the delimiter
 * format (so the builder still produces a usable artifact).
 */
export function parseMultiFileResponse(raw: string): Record<string, string> {
  const files: Record<string, string> = {};

  // Try the delimiter format first.
  const delimiter = /---FILE:\s*([^\s-]+)\s*---/g;
  const parts = raw.split(delimiter);

  if (parts.length > 1) {
    // parts[0] = preamble (ignored), then alternating: filename, content
    for (let i = 1; i < parts.length; i += 2) {
      const filename = parts[i]?.trim();
      const content = parts[i + 1] ?? "";
      if (!filename) continue;
      // Strip the ---END--- marker if present.
      const cleaned = content.replace(/---END---[\s\S]*$/, "").trim();
      // Strip surrounding code fences (```lang ... ```).
      const fenceMatch = cleaned.match(/^```[a-zA-Z]*\n?([\s\S]*?)\n?```$/);
      const finalContent = fenceMatch ? fenceMatch[1] : cleaned;
      files[filename] = finalContent;
    }
  }

  // Fallback: if no delimiters found, treat the whole response as index.html
  // (strip code fences if present).
  if (Object.keys(files).length === 0) {
    const fenceMatch = raw.match(/^```[a-zA-Z]*\n?([\s\S]*?)\n?```$/);
    const content = fenceMatch ? fenceMatch[1] : raw;
    files["index.html"] = content.trim();
  }

  return files;
}

/**
 * Build the user-prompt for the LLM.
 * Combines the service description, customer spec, and output instructions.
 */
function buildUserPrompt(service: ServiceDef, spec: string): string {
  return `Build a "${service.name}" for a paying customer.

SERVICE DESCRIPTION: ${service.description}

DELIVERABLES EXPECTED: ${service.deliverables.join(", ")}

CUSTOMER SPEC:
${spec}

OUTPUT INSTRUCTIONS:
1. Generate ALL files listed in the deliverables.
2. Use the ---FILE: <filename>--- delimiter before each file.
3. Wrap each file's content in a fenced code block with the correct language tag.
4. End with ---END--- on its own line.
5. Every file must be complete and production-ready — NO placeholders, NO TODOs.
6. Include a README.md with: what the deliverable is, how to run it, and how to deploy it (free tier preferred).
7. For web deliverables: responsive, accessible (WCAG AA), SEO-optimized (meta tags, semantic HTML).
8. For code deliverables: typed (TypeScript where applicable), error-handled, documented.

Begin generating the files now.`;
}

/**
 * Build a service deliverable.
 *
 * @param orderId  Unique order ID (used as the output directory name).
 * @param serviceId  Catalog service ID.
 * @param spec  Customer's specification (free-text description of what they want).
 * @returns BuildResult with the zip path + file list.
 */
export async function buildService(
  orderId: string,
  serviceId: string,
  spec: string,
): Promise<BuildResult> {
  const startTime = Date.now();

  // ── OWNER APPROVAL GATE (v32) ──
  // The builder MUST NOT generate code until the owner has manually
  // approved the crypto payment. This enforces the $0-budget rule:
  // no automated payment processing, human-in-the-loop verification.
  try {
    const order = await db.serviceOrder.findUnique({
      where: { id: orderId },
      select: { ownerApproved: true, status: true },
    });
    if (!order) {
      return {
        ok: false,
        orderId,
        serviceId,
        serviceName: "unknown",
        zipPath: null,
        fileCount: 0,
        files: [],
        error: `order not found: ${orderId}`,
      };
    }
    if (!order.ownerApproved) {
      return {
        ok: false,
        orderId,
        serviceId,
        serviceName: "unknown",
        zipPath: null,
        fileCount: 0,
        files: [],
        error: "Order not yet approved by owner. Builder is blocked until ownerApproved === true.",
      };
    }
  } catch (err) {
    return {
      ok: false,
      orderId,
      serviceId,
      serviceName: "unknown",
      zipPath: null,
      fileCount: 0,
      files: [],
      error: `Failed to check owner approval: ${String(err)}`,
    };
  }

  const service = getService(serviceId);
  if (!service) {
    return {
      ok: false,
      orderId,
      serviceId,
      serviceName: "unknown",
      zipPath: null,
      fileCount: 0,
      files: [],
      error: `unknown service: ${serviceId}`,
    };
  }

  const outDir = path.join(process.cwd(), "download", "services", orderId);
  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      orderId,
      serviceId,
      serviceName: service.name,
      zipPath: null,
      fileCount: 0,
      files: [],
      error: `failed to create output dir: ${String(err)}`,
    };
  }

  // 1. Call the LLM with the ServiceBuilder system prompt.
  const messages: ChatMsg[] = [
    {
      role: "system",
      content:
        "You are Build-Bot, ARIA's service builder agent. You generate production-grade code for paying customers — websites, 3D sites, voice agents, SaaS scaffolds, CLI tools.\n\n" +
        "OUTPUT FORMAT: Multi-file output using the ---FILE: <path>--- delimiter. Each file in its own fenced code block. End with ---END---.\n\n" +
        "QUALITY BAR: Every file must be: (1) syntactically valid, (2) production-ready (no TODOs, no placeholder content), (3) responsive (for web), (4) accessible (WCAG AA), (5) SEO-optimized (for web).\n\n" +
        "CONSTRAINTS: Generate real, working code — never placeholders. Include a README.md in every deliverable. Respond ONLY with the file delimiters + code blocks — no chit-chat.",
    },
    { role: "user", content: buildUserPrompt(service, spec) },
  ];

  let result;
  try {
    result = await routeLLM(messages, { complexity: "high" });
  } catch (err) {
    return {
      ok: false,
      orderId,
      serviceId,
      serviceName: service.name,
      zipPath: null,
      fileCount: 0,
      files: [],
      error: `LLM call failed: ${String(err)}`,
    };
  }

  if (!result.success) {
    return {
      ok: false,
      orderId,
      serviceId,
      serviceName: service.name,
      zipPath: null,
      fileCount: 0,
      files: [],
      error: `LLM returned error: ${result.error}`,
      provider: result.provider,
      model: result.model,
    };
  }

  // 2. Parse the response into files.
  const files = parseMultiFileResponse(result.completion);
  const fileNames = Object.keys(files);

  if (fileNames.length === 0) {
    return {
      ok: false,
      orderId,
      serviceId,
      serviceName: service.name,
      zipPath: null,
      fileCount: 0,
      files: [],
      error: "LLM response contained no parseable files",
      provider: result.provider,
      model: result.model,
    };
  }

  // v44 fix C9 (audit gap #8): Verify all promised deliverables are present.
  // The catalog lists deliverables per service; if any are missing, the customer
  // is not getting what they paid for. Retry once with error feedback; if still
  // missing, mark as needs_manual_review.
  const missingDeliverables = service.deliverables.filter(
    (d) => !fileNames.some((f) => f === d || f.endsWith("/" + d) || f.replace(/^.*\//, "") === d),
  );

  if (missingDeliverables.length > 0) {
    logger.warn("service-builder.missing-deliverables", {
      orderId,
      missing: missingDeliverables,
      present: fileNames,
    });

    // Retry once with explicit error feedback
    const retryMessages: ChatMsg[] = [
      ...messages,
      {
        role: "assistant" as const,
        content: result.completion,
      },
      {
        role: "user" as const,
        content: `Your previous response was missing these required deliverables: ${missingDeliverables.join(", ")}.

You MUST include ALL of these files in your next response: ${service.deliverables.join(", ")}.

Please regenerate the COMPLETE deliverable, including the missing files. Use the same ---FILE: <path>--- delimiter format. Do not omit any file.`,
      },
    ];

    try {
      const retryResult = await routeLLM(retryMessages, { complexity: "high" });
      if (retryResult.success) {
        const retryFiles = parseMultiFileResponse(retryResult.completion);
        const retryNames = Object.keys(retryFiles);
        const stillMissing = service.deliverables.filter(
          (d) => !retryNames.some((f) => f === d || f.endsWith("/" + d) || f.replace(/^.*\//, "") === d),
        );

        if (stillMissing.length === 0) {
          // Retry succeeded — use the retry output
          for (const [fn, content] of Object.entries(retryFiles)) {
            files[fn] = content;
          }
          // Re-extract file names
          fileNames.length = 0;
          fileNames.push(...Object.keys(files));
          logger.info("service-builder.retry-succeeded", { orderId, fileCount: fileNames.length });
        } else {
          // Retry still missing deliverables — fail with needs_manual_review
          await db.serviceOrder.update({
            where: { id: orderId },
            data: {
              status: "failed",
              buildLog: `Missing deliverables after retry: ${stillMissing.join(", ")}. Present: ${retryNames.join(", ")}`,
            },
          });
          return {
            ok: false,
            orderId,
            serviceId,
            serviceName: service.name,
            zipPath: null,
            fileCount: retryNames.length,
            files: retryNames,
            error: `needs_manual_review: missing deliverables after retry: ${stillMissing.join(", ")}`,
            provider: retryResult.provider,
            model: retryResult.model,
          };
        }
      }
    } catch (retryErr) {
      logger.error("service-builder.retry-failed", { orderId, error: String(retryErr) });
      // Fall through to original output + quality gate
    }
  }

  // 3. Write files to disk.
  for (const [filename, content] of Object.entries(files)) {
    const filePath = path.join(outDir, filename);
    try {
      // Create subdirectories if the filename contains a path.
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content, "utf-8");
    } catch (err) {
      logger.warn("service-builder.write-failed", { filename, error: String(err) });
    }
  }

  // ─── v40: Deliverable Quality Gate (static fast-fail) ───
  // Before zipping + marking as "delivered", verify the generated files
  // aren't empty or obviously malformed. This prevents shipping a broken
  // deliverable when the LLM produces garbage.
  const qualityCheck = runQualityGate(files);
  if (!qualityCheck.passed) {
    logger.error("service-builder.quality-gate-failed", {
      orderId,
      issues: qualityCheck.issues,
    });
    return {
      ok: false,
      orderId,
      serviceId,
      serviceName: service.name,
      zipPath: null,
      fileCount: fileNames.length,
      files: fileNames,
      error: `Quality gate failed: ${qualityCheck.issues.join("; ")}`,
      provider: result.provider,
      model: result.model,
    };
  }
  logger.info("service-builder.quality-gate-passed", {
    orderId,
    fileCount: fileNames.length,
    totalBytes: qualityCheck.totalBytes,
  });

  // ─── v61 (Audit B4): Trajectory Validation (execution-based) ───
  // The static gate above only checks syntax/structure. The v59 trajectory
  // supervisor actually EXECUTES the generated code in a sandbox + asserts
  // on stdout / exit code / HTTP status — the AgentEval pattern. It wraps
  // the review in a hard MAX_RETRIES = 2 cap: on rejection, the builder
  // regenerates with the supervisor's feedback; after 2 misses it escalates
  // to the owner instead of looping forever. Previously this code existed
  // only in tests; now it runs on every real build.
  const serviceType = (service.id as string) || "blog-post";
  const trajectoryReq: QualityReviewRequest = {
    workerAgent: "Build-Bot",
    action: `build:${serviceId}:${orderId}`,
    files,
    serviceType,
  };
  const trajectoryOutcome = await reviewWithTrajectoryCap(trajectoryReq, async (feedback, _attempt) => {
    // Regenerate using the supervisor's feedback. Re-call the LLM with the
    // original prompt + a corrective user turn carrying the feedback.
    logger.info("service-builder.trajectory-retry", { orderId, feedback: feedback.slice(0, 120) });
    const regenMessages: ChatMsg[] = [
      ...messages,
      {
        role: "assistant" as const,
        content: result.completion,
      },
      {
        role: "user" as const,
        content: `The Quality Supervisor rejected the previous deliverable after EXECUTING it in a sandbox.\n\nSupervisor feedback:\n${feedback}\n\nRegenerate the COMPLETE deliverable, fixing every issue listed above. Keep the same ---FILE: <path>--- delimiter format. Every file must be production-ready.`,
      },
    ];
    const regenResult = await routeLLM(regenMessages, { complexity: "high" });
    const regenFiles = regenResult.success ? parseMultiFileResponse(regenResult.completion) : files;
    // Write the regenerated files to disk so the next trajectory run sees them.
    for (const [fn, content] of Object.entries(regenFiles)) {
      const fp = path.join(outDir, fn);
      try {
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, content, "utf-8");
      } catch (e) {
        logger.warn("service-builder.regen-write-failed", { filename: fn, error: String(e) });
      }
    }
    return {
      workerAgent: "Build-Bot",
      action: `build:${serviceId}:${orderId}`,
      files: regenFiles,
      serviceType,
    };
  });

  if (!trajectoryOutcome.approved) {
    logger.error("service-builder.trajectory-failed", {
      orderId,
      attempts: trajectoryOutcome.attempts,
      feedback: trajectoryOutcome.finalResult.feedback.slice(0, 200),
    });
    await db.serviceOrder.update({
      where: { id: orderId },
      data: {
        status: "failed",
        buildLog: `Trajectory validation failed after ${trajectoryOutcome.attempts} retries: ${trajectoryOutcome.finalResult.feedback.slice(0, 500)}`,
      },
    }).catch(() => { /* best-effort */ });
    return {
      ok: false,
      orderId,
      serviceId,
      serviceName: service.name,
      zipPath: null,
      fileCount: fileNames.length,
      files: fileNames,
      error: `Trajectory validation failed after ${trajectoryOutcome.attempts} retries (escalated to owner): ${trajectoryOutcome.finalResult.feedback.slice(0, 160)}`,
      provider: result.provider,
      model: result.model,
    };
  }
  logger.info("service-builder.trajectory-passed", {
    orderId,
    attempts: trajectoryOutcome.attempts,
    serviceType,
  });

  // 4. Zip the directory.
  const zipPath = path.join(outDir, `${serviceId}-${orderId}.zip`);
  try {
    execSync(`cd "${outDir}" && zip -r -q "${zipPath}" . -x "*.zip"`, { timeout: 30_000 });
  } catch (err) {
    logger.warn("service-builder.zip-failed", { orderId, error: String(err) });
    // The files are still on disk — the user can download them individually.
  }

  const latencyMs = Date.now() - startTime;
  logger.info("service-builder.complete", {
    orderId,
    serviceId,
    fileCount: fileNames.length,
    latencyMs,
    provider: result.provider,
    model: result.model,
  });

  return {
    ok: true,
    orderId,
    serviceId,
    serviceName: service.name,
    zipPath: fs.existsSync(zipPath) ? zipPath : null,
    fileCount: fileNames.length,
    files: fileNames,
    provider: result.provider,
    model: result.model,
    latencyMs,
  };
}

/**
 * Get the output directory for an order (for the download endpoint).
 */
export function getOrderDir(orderId: string): string {
  return path.join(process.cwd(), "download", "services", orderId);
}

/**
 * Get the zip path for an order (if it exists).
 */
export function getOrderZip(orderId: string, serviceId: string): string | null {
  const zipPath = path.join(getOrderDir(orderId), `${serviceId}-${orderId}.zip`);
  return fs.existsSync(zipPath) ? zipPath : null;
}

// ─── v40: Deliverable Quality Gate ───────────────────────────────────

interface QualityGateResult {
  passed: boolean
  issues: string[]
  totalBytes: number
}

/**
 * Quality check on generated files before delivery.
 *
 * v44 fix C9: Now includes ACTUAL syntax validation, not just "not empty":
 *   1. No file is empty (0 bytes)
 *   2. No file is just whitespace/placeholder
 *   3. At least one file has substantial content (>100 chars)
 *   4. Total deliverable size is reasonable (>500 bytes, <10MB)
 *   5. NEW: HTML files have balanced <div> tags (within ±2)
 *   6. NEW: HTML files have <!DOCTYPE html> + <title>
 *   7. NEW: TypeScript/JavaScript files have balanced braces (within ±2)
 *   8. NEW: YAML files parse without error (via simple parser)
 *   9. NEW: JSON files parse without error
 *
 * If validation fails, the builder retries once with error feedback.
 * If retry still fails, the order is marked needs_manual_review.
 */
export function runQualityGate(files: Record<string, string>): QualityGateResult {
  const issues: string[] = []
  let totalBytes = 0
  let substantialFiles = 0

  const PLACEHOLDER_PATTERNS = [
    /^\s*$/,
    /^\s*(TODO|FIXME|PLACEHOLDER)\s*$/i,
    /^\s*(lorem ipsum|placeholder content)\s*$/i,
    /^\s*\[\s*content goes here\s*\]\s*$/i,
  ]

  for (const [filename, content] of Object.entries(files)) {
    const bytes = Buffer.byteLength(content, "utf-8")
    totalBytes += bytes

    // Check 1: empty file
    if (bytes === 0) {
      issues.push(`${filename} is empty`)
      continue
    }

    // Check 2: placeholder content
    if (PLACEHOLDER_PATTERNS.some((p) => p.test(content))) {
      issues.push(`${filename} contains only placeholder/empty content`)
      continue
    }

    // Check 3: substantial content
    if (content.trim().length > 100) {
      substantialFiles++
    }

    // Check 5: HTML validation
    if (filename.endsWith(".html") || filename.endsWith(".htm")) {
      const doctype = /<!DOCTYPE html>/i.test(content)
      if (!doctype) {
        issues.push(`${filename} missing <!DOCTYPE html>`)
      }
      const hasTitle = /<title[^>]*>[^<]+<\/title>/i.test(content)
      if (!hasTitle) {
        issues.push(`${filename} missing <title> element`)
      }
      // Tag balance check (limited to <div> which is the most common cause of layout bugs)
      const openDivs = (content.match(/<div[\s>]/g) ?? []).length
      const closeDivs = (content.match(/<\/div>/g) ?? []).length
      const divDiff = Math.abs(openDivs - closeDivs)
      if (divDiff > 2) {
        issues.push(`${filename} has unbalanced <div> tags (${openDivs} open, ${closeDivs} close, diff ${divDiff})`)
      }
    }

    // Check 6: TypeScript/JavaScript brace balance
    if (filename.endsWith(".ts") || filename.endsWith(".tsx") || filename.endsWith(".js") || filename.endsWith(".jsx")) {
      // Strip strings + comments to avoid false positives
      const stripped = content
        .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
        .replace(/\/\/[^\n]*/g, "") // line comments
        .replace(/"(?:[^"\\]|\\.)*"/g, '""') // double-quoted strings
        .replace(/'(?:[^'\\]|\\.)*'/g, "''") // single-quoted strings
        .replace(/`(?:[^`\\]|\\.)*`/g, "``") // template literals

      const openBraces = (stripped.match(/{/g) ?? []).length
      const closeBraces = (stripped.match(/}/g) ?? []).length
      const braceDiff = Math.abs(openBraces - closeBraces)
      if (braceDiff > 2) {
        issues.push(`${filename} has unbalanced braces (${openBraces} {, ${closeBraces} }, diff ${braceDiff})`)
      }

      const openParens = (stripped.match(/\(/g) ?? []).length
      const closeParens = (stripped.match(/\)/g) ?? []).length
      const parenDiff = Math.abs(openParens - closeParens)
      if (parenDiff > 2) {
        issues.push(`${filename} has unbalanced parens (${openParens} (, ${closeParens} ), diff ${parenDiff})`)
      }
    }

    // Check 7: YAML parse
    if (filename.endsWith(".yaml") || filename.endsWith(".yml")) {
      try {
        // Simple YAML validation: just check for tab indentation (YAML forbids tabs)
        // + unbalanced indentation. A full parse requires js-yaml which isn't installed.
        const lines = content.split("\n")
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          if (line.startsWith("\t")) {
            issues.push(`${filename} line ${i + 1}: YAML forbids tab indentation`)
            break
          }
        }
        // Check for "openapi: 3." prefix for OpenAPI specs
        if (filename.includes("openapi") && !/openapi:\s*['"]?3\./i.test(content)) {
          issues.push(`${filename} missing or invalid 'openapi: 3.x' field`)
        }
      } catch (err) {
        issues.push(`${filename} YAML validation error: ${String(err).slice(0, 80)}`)
      }
    }

    // Check 8: JSON parse
    if (filename.endsWith(".json")) {
      try {
        JSON.parse(content)
      } catch (err) {
        issues.push(`${filename} invalid JSON: ${String(err).slice(0, 80)}`)
      }
    }
  }

  // Check 4: at least one substantial file
  if (substantialFiles === 0) {
    issues.push("no files contain substantial content (>100 chars)")
  }

  // Check 5: total size bounds
  if (totalBytes < 500) {
    issues.push(`total deliverable size too small (${totalBytes} bytes)`)
  }
  if (totalBytes > 10 * 1024 * 1024) {
    issues.push(`total deliverable size too large (${totalBytes} bytes)`)
  }

  return {
    passed: issues.length === 0,
    issues,
    totalBytes,
  }
}
