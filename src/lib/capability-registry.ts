/**
 * src/lib/capability-registry.ts — v74 Phase 24 (RULE-77)
 *
 * Dynamic Capability Registry. On startup + after every Auto-Refactor merge,
 * scans src/app/api/, src/lib/, and cron handlers to build a live JSON manifest
 * of every endpoint, module, and capability.
 *
 * Uses local Ollama to summarize new capabilities + auto-update docs/CAPABILITIES.md.
 * Exposes via /api/capabilities so external agents or the dashboard can query
 * "What can the app do regarding lead generation?"
 *
 * Documentation must self-update based on code changes so meta-agents + owners
 * always know the app's true potential — never outdated, never stale.
 */

import "server-only";
import { db } from "./db";
import { logger } from "./logger";
import { emit } from "./event-bus";
import { callLLM } from "./llm-client";
import * as fs from "fs";
import * as path from "path";

// ─── Types ────────────────────────────────────────────────────────────

export interface ApiEndpoint {
  path: string; // e.g. "/api/lead-hunt/run"
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  file: string; // src/app/api/lead-hunt/run/route.ts
  exportedFunctions: string[]; // e.g. ["GET", "POST"]
}

export interface LibModule {
  path: string; // src/lib/lead-hunter/social-scout.ts
  exports: string[]; // exported function names
  lines: number;
  purpose: string; // one-line summary (from the top docstring)
}

export interface CronJobDef {
  name: string;
  schedule: string;
  description: string;
}

export interface ConstitutionRuleDef {
  id: string;
  rule: string;
  priority: string;
}

export interface CapabilityManifest {
  version: string;
  generatedAt: string;
  apiEndpoints: ApiEndpoint[];
  libModules: LibModule[];
  cronJobs: CronJobDef[];
  constitutionRules: ConstitutionRuleDef[];
  summary: string; // LLM-generated overview
  stats: {
    apiCount: number;
    moduleCount: number;
    cronCount: number;
    ruleCount: number;
    totalLinesOfCode: number;
  };
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Generate the capability manifest by scanning the codebase.
 * Persists to the CapabilityManifest table + writes docs/CAPABILITIES.md.
 */
export async function generateCapabilityManifest(): Promise<CapabilityManifest> {
  logger.info("capability-registry.generate.start");
  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: "📋 Phase 24 Capability Registry: scanning codebase for capabilities...",
    level: "info",
  });

  // Scan each surface area in parallel.
  const [apiEndpoints, libModules, cronJobs, constitutionRules] = await Promise.all([
    scanApiEndpoints(),
    scanLibModules(),
    scanCronJobs(),
    scanConstitutionRules(),
  ]);

  const totalLinesOfCode = libModules.reduce((s, m) => s + m.lines, 0);

  // Build the manifest.
  const manifest: CapabilityManifest = {
    version: "v74",
    generatedAt: new Date().toISOString(),
    apiEndpoints,
    libModules,
    cronJobs,
    constitutionRules,
    summary: "", // filled in below by the LLM
    stats: {
      apiCount: apiEndpoints.length,
      moduleCount: libModules.length,
      cronCount: cronJobs.length,
      ruleCount: constitutionRules.length,
      totalLinesOfCode,
    },
  };

  // Use local Ollama to generate a summary.
  manifest.summary = await generateSummary(manifest);

  // Persist to the DB.
  try {
    await db.capabilityManifest.create({
      data: {
        manifestJson: JSON.stringify(manifest, null, 2),
        apiCount: manifest.stats.apiCount,
        moduleCount: manifest.stats.moduleCount,
        cronCount: manifest.stats.cronCount,
        ruleCount: manifest.stats.ruleCount,
        version: manifest.version,
      },
    });
  } catch (err) {
    logger.warn("capability-registry.persist-failed", { error: String(err).slice(0, 80) });
  }

  // Write docs/CAPABILITIES.md.
  await writeCapabilitiesDoc(manifest);

  logger.info("capability-registry.generate.complete", {
    apiCount: manifest.stats.apiCount,
    moduleCount: manifest.stats.moduleCount,
    cronCount: manifest.stats.cronCount,
    ruleCount: manifest.stats.ruleCount,
  });
  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: `📋 Capability manifest generated: ${manifest.stats.apiCount} APIs, ${manifest.stats.moduleCount} modules, ${manifest.stats.cronCount} crons, ${manifest.stats.ruleCount} rules, ${manifest.stats.totalLinesOfCode} LOC. docs/CAPABILITIES.md updated.`,
    level: "success",
  });

  return manifest;
}

// ─── Scanners ────────────────────────────────────────────────────────

async function scanApiEndpoints(): Promise<ApiEndpoint[]> {
  const endpoints: ApiEndpoint[] = [];
  const apiDir = path.resolve(process.cwd(), "src/app/api");
  if (!fs.existsSync(apiDir)) return endpoints;

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name === "route.ts") {
        const relPath = path.relative(path.resolve(process.cwd(), "src/app"), fullPath).replace(/\/route\.ts$/, "");
        const content = fs.readFileSync(fullPath, "utf-8");
        const exportedFunctions: string[] = [];
        if (content.match(/export\s+async\s+function\s+GET/)) exportedFunctions.push("GET");
        if (content.match(/export\s+async\s+function\s+POST/)) exportedFunctions.push("POST");
        if (content.match(/export\s+async\s+function\s+PATCH/)) exportedFunctions.push("PATCH");
        if (content.match(/export\s+async\s+function\s+DELETE/)) exportedFunctions.push("DELETE");
        if (content.match(/export\s+async\s+function\s+PUT/)) exportedFunctions.push("PUT");
        endpoints.push({
          path: "/" + relPath,
          method: (exportedFunctions[0] ?? "GET") as ApiEndpoint["method"],
          file: path.relative(process.cwd(), fullPath),
          exportedFunctions,
        });
      }
    }
  }
  walk(apiDir);
  return endpoints.sort((a, b) => a.path.localeCompare(b.path));
}

async function scanLibModules(): Promise<LibModule[]> {
  const modules: LibModule[] = [];
  const libDir = path.resolve(process.cwd(), "src/lib");
  if (!fs.existsSync(libDir)) return modules;

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".ts")) {
        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n").length;
        const exportMatches = content.matchAll(/export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)/g);
        const exports: string[] = [];
        for (const m of exportMatches) exports.push(m[1] || m[2]);
        const firstCommentMatch = content.match(/\/\*\*([\s\S]*?)\*\//);
        const purpose = firstCommentMatch
          ? firstCommentMatch[1].split("\n").map((l) => l.replace(/^\s*\*\s?/, "")).join(" ").trim().slice(0, 200)
          : "";
        modules.push({
          path: path.relative(process.cwd(), fullPath),
          exports,
          lines,
          purpose,
        });
      }
    }
  }
  walk(libDir);
  return modules.sort((a, b) => a.path.localeCompare(b.path));
}

async function scanCronJobs(): Promise<CronJobDef[]> {
  try {
    // Read the seed.ts file + extract the cron job definitions.
    const seedPath = path.resolve(process.cwd(), "src/lib/simulation/seed.ts");
    if (!fs.existsSync(seedPath)) return [];
    const content = fs.readFileSync(seedPath, "utf-8");
    const cronMatches = content.matchAll(/\{\s*name:\s*"([^"]+)",\s*schedule:\s*"([^"]+)",\s*description:\s*"([^"]+)"/g);
    const crons: CronJobDef[] = [];
    for (const m of cronMatches) {
      crons.push({ name: m[1], schedule: m[2], description: m[3] });
    }
    return crons;
  } catch {
    return [];
  }
}

async function scanConstitutionRules(): Promise<ConstitutionRuleDef[]> {
  try {
    const { ALL_CONSTITUTION_RULES } = await import("./constitution");
    return ALL_CONSTITUTION_RULES.map((r) => ({
      id: r.id,
      rule: r.rule,
      priority: r.priority,
    }));
  } catch {
    return [];
  }
}

// ─── Summary generation ──────────────────────────────────────────────

async function generateSummary(manifest: CapabilityManifest): Promise<string> {
  try {
    const prompt = `Generate a 3-paragraph summary of ARIA Mission Control's capabilities based on this manifest. Focus on what the app can DO for customers + the owner.

Stats:
  - ${manifest.stats.apiCount} API endpoints
  - ${manifest.stats.moduleCount} lib modules
  - ${manifest.stats.cronCount} scheduled crons
  - ${manifest.stats.ruleCount} constitution rules
  - ${manifest.stats.totalLinesOfCode} lines of code

Sample endpoints: ${manifest.apiEndpoints.slice(0, 10).map((e) => e.path).join(", ")}

Sample modules: ${manifest.libModules.slice(0, 10).map((m) => m.path).join(", ")}

Sample crons: ${manifest.cronJobs.slice(0, 5).map((c) => c.name).join(", ")}

Respond with 3 paragraphs of plain English. No markdown. No preamble.`;

    const result = await callLLM("CapabilityRegistry", "research", prompt, {
      maxRetries: 1,
      model: process.env.WORKFLOW_PROPOSER_MODEL || "llama3.2:3b",
      preferLocal: true,
    } as any);
    return result.success ? result.completion : `ARIA Mission Control v74 — ${manifest.stats.apiCount} APIs, ${manifest.stats.moduleCount} modules, ${manifest.stats.cronCount} crons, ${manifest.stats.ruleCount} rules, ${manifest.stats.totalLinesOfCode} LOC.`;
  } catch (err) {
    return `ARIA Mission Control v74 — ${manifest.stats.apiCount} APIs, ${manifest.stats.moduleCount} modules, ${manifest.stats.cronCount} crons, ${manifest.stats.ruleCount} rules.`;
  }
}

// ─── Auto-update docs/CAPABILITIES.md ────────────────────────────────

async function writeCapabilitiesDoc(manifest: CapabilityManifest): Promise<void> {
  const docsDir = path.resolve(process.cwd(), "docs");
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  const docPath = path.join(docsDir, "CAPABILITIES.md");

  const lines: string[] = [
    `# ARIA Mission Control — Capability Registry`,
    ``,
    `> Auto-generated by \`src/lib/capability-registry.ts\` (v74 Phase 24, RULE-77).`,
    `> Last updated: ${manifest.generatedAt}`,
    `> NEVER edit manually — this file is overwritten on every Auto-Refactor merge + on app startup.`,
    ``,
    `## Summary`,
    ``,
    manifest.summary,
    ``,
    `## Stats`,
    ``,
    `- **API endpoints:** ${manifest.stats.apiCount}`,
    `- **Lib modules:** ${manifest.stats.moduleCount}`,
    `- **Cron jobs:** ${manifest.stats.cronCount}`,
    `- **Constitution rules:** ${manifest.stats.ruleCount}`,
    `- **Total lines of code:** ${manifest.stats.totalLinesOfCode}`,
    ``,
    `## API Endpoints`,
    ``,
    `| Path | Methods | File |`,
    `|---|---|---|`,
    ...manifest.apiEndpoints.map((e) => `| \`${e.path}\` | ${e.exportedFunctions.join(", ")} | ${e.file} |`),
    ``,
    `## Lib Modules`,
    ``,
    `| Path | Lines | Exports | Purpose |`,
    `|---|---|---|---|`,
    ...manifest.libModules.map((m) => `| ${m.path} | ${m.lines} | ${m.exports.slice(0, 5).join(", ")}${m.exports.length > 5 ? `, +${m.exports.length - 5} more` : ""} | ${m.purpose.slice(0, 80)} |`),
    ``,
    `## Cron Jobs`,
    ``,
    `| Name | Schedule | Description |`,
    `|---|---|---|`,
    ...manifest.cronJobs.map((c) => `| \`${c.name}\` | \`${c.schedule}\` | ${c.description.slice(0, 100)} |`),
    ``,
    `## Constitution Rules`,
    ``,
    `| ID | Rule | Priority |`,
    `|---|---|---|`,
    ...manifest.constitutionRules.map((r) => `| \`${r.id}\` | ${r.rule} | ${r.priority} |`),
    ``,
  ];

  fs.writeFileSync(docPath, lines.join("\n"), "utf-8");
  logger.info("capability-registry.doc-written", { path: docPath, lines: lines.length });
}
