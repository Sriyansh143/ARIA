#!/usr/bin/env bun
/**
 * scripts/generate-code-index.ts — v61.5 Phase 10 (Code Index & Manifest System)
 *
 * Builds a smart indexing system so future AI sessions can understand the
 * codebase structure WITHOUT re-reading 1000+ files from scratch.
 *
 * Output structure (.code-index/):
 *   manifest.json     — master index of all files with metadata
 *   summaries/        — one markdown summary per source file
 *   dependencies.json — file dependency graph (which files import which)
 *   change-log.json   — what changed in each run
 *
 * Usage: bun run scripts/generate-code-index.ts
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();
const INDEX_DIR = path.join(ROOT, ".code-index");
const SUMMARIES_DIR = path.join(INDEX_DIR, "summaries");
const SCAN_DIRS = ["src", "scripts", "mini-services"];

interface FileManifestEntry {
  path: string;
  purpose: string;
  keyFunctions: string[];
  dependencies: string[];
  lineCount: number;
  lastModified: string;
  indexedAt: string;
  category: string; // v61.6 Phase 11: domain category for efficient lookup
}

interface Manifest {
  generatedAt: string;
  totalFiles: number;
  totalLines: number;
  files: FileManifestEntry[];
}

interface ChangeLogEntry {
  timestamp: string;
  added: string[];
  modified: string[];
  removed: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

function walkDir(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules, .next, .git, .code-index
      if (["node_modules", ".next", ".git", ".code-index", "tool-results"].includes(entry.name)) continue;
      results.push(...walkDir(fullPath, exts));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (exts.includes(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function extractPurpose(content: string): string {
  // Extract the first JSDoc comment block (the file header).
  const jsdocMatch = content.match(/^\/\*\*\s*\n([\s\S]*?)\*\//);
  if (jsdocMatch) {
    const block = jsdocMatch[1];
    // Get the first non-empty, non-tag line.
    const lines = block
      .split("\n")
      .map((l) => l.replace(/^\s*\*\s?/, "").trim())
      .filter((l) => l.length > 0 && !l.startsWith("@"));
    if (lines.length > 0) return lines[0];
  }
  // Fallback: first non-empty comment line.
  const commentMatch = content.match(/^\/\/\s*(.+)/m);
  if (commentMatch) return commentMatch[1].trim();
  return "(no purpose documented — add a JSDoc header)";
}

function extractKeyFunctions(content: string): string[] {
  const funcs: string[] = [];
  // Match: export async function name, export function name, export const name = async
  const patterns = [
    /export\s+async\s+function\s+(\w+)/g,
    /export\s+function\s+(\w+)/g,
    /export\s+const\s+(\w+)\s*=\s*async/g,
    /export\s+const\s+(\w+)\s*=\s*\(/g,
  ];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(content)) !== null) {
      if (!funcs.includes(m[1])) funcs.push(m[1]);
    }
  }
  return funcs.slice(0, 15); // cap at 15 to keep manifest readable
}

function extractDependencies(content: string): string[] {
  const deps: string[] = [];
  // Match: import ... from "..."  and  import "..."  and  await import("...")
  const patterns = [
    /import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    /await\s+import\(["']([^"']+)["']\)/g,
  ];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(content)) !== null) {
      if (!deps.includes(m[1])) deps.push(m[1]);
    }
  }
  return deps.slice(0, 20); // cap at 20
}

function extractCoreLogicPatterns(content: string): string[] {
  const patterns: string[] = [];
  // Look for common algorithm/pattern keywords.
  if (/cosine|embedding|nomic-embed|vector\s+sim/i.test(content)) patterns.push("vector-similarity");
  if (/Math\.random|faker|generateFake|mockData/i.test(content)) patterns.push("simulation (verify gating)");
  if (/fetch\(|axios|http\.get/i.test(content)) patterns.push("network-fetch");
  if (/prisma\.|db\.\w+\.(findMany|create|update|delete)/i.test(content)) patterns.push("database-access");
  if (/AbortSignal\.timeout|setTimeout/i.test(content)) patterns.push("timeout-handling");
  if (/try\s*\{|\.catch\s*\(/i.test(content)) patterns.push("error-handling");
  if (/emit\s*\(|EventEmitter|event-bus/i.test(content)) patterns.push("event-emission");
  if (/AES|encrypt|decrypt|crypto\./i.test(content)) patterns.push("cryptography");
  if (/Stripe|stripe\./i.test(content)) patterns.push("stripe-integration");
  if (/Resend|resend\./i.test(content)) patterns.push("resend-email");
  if (/Telegram|sendTelegram/i.test(content)) patterns.push("telegram-integration");
  if (/Ollama|ollama/i.test(content)) patterns.push("ollama-llm");
  if (/process\.env\.[A-Z_]+/i.test(content)) patterns.push("env-config");
  return patterns;
}

/**
 * v61.6 Phase 11: Derive a domain category from the file path + content.
 * Categories: conductor, workflow, safety, integration, memory, cron, ui, infra, scripts.
 */
function deriveCategory(filePath: string, content: string): string {
  const lower = filePath.toLowerCase();
  if (lower.includes("conductor/") || lower.includes("router.ts") || lower.includes("council.ts") || lower.includes("dispatcher.ts")) return "conductor";
  if (lower.includes("workflow-engine") || lower.includes("workflow-templates") || lower.includes("step-debate") || lower.includes("planner.ts")) return "workflow";
  if (lower.includes("production-gate") || lower.includes("agent-blackboard") || lower.includes("zero-assumption") || lower.includes("autonomy-control") || lower.includes("quality-supervisor") || lower.includes("constitution")) return "safety";
  if (lower.includes("stripe") || lower.includes("resend") || lower.includes("crypto-verifier") || lower.includes("upi-payments") || lower.includes("telephony") || lower.includes("telegram-bot") || lower.includes("email-service") || lower.includes("whatsapp")) return "integration";
  if (lower.includes("vector-memory") || lower.includes("hermes/memory") || lower.includes("knowledge-base") || lower.includes("skill-patterns") || lower.includes("skill-loader")) return "memory";
  if (lower.includes("cron-scheduler") || lower.includes("daily-knowledge-refresh") || lower.includes("ingest-500") || lower.includes("extract-all-skill") || lower.includes("generate-code-index") || lower.includes("seed-knowledge")) return "cron";
  if (lower.includes("components/") || lower.includes("app/dashboard") || lower.includes(".tsx")) return "ui";
  if (lower.includes("db.ts") || lower.includes("auth") || lower.includes("proxy.ts") || lower.includes("env-loader") || lower.includes("auto-bootstrap") || lower.includes("types.ts") || lower.includes("logger.ts") || lower.includes("monitor.ts")) return "infra";
  if (lower.includes("scripts/")) return "scripts";
  if (lower.includes("simulation/")) return "simulation";
  if (lower.includes("supervisors/")) return "safety";
  if (lower.includes("intelligence/")) return "intelligence";
  if (lower.includes("expansion/")) return "expansion";
  if (lower.includes("services/")) return "services";
  if (lower.includes("llm-router") || lower.includes("llm-client") || lower.includes("ollama-client")) return "llm";
  return "general";
}

function generateSummary(entry: FileManifestEntry, content: string): string {
  const corePatterns = extractCoreLogicPatterns(content);
  const funcs = entry.keyFunctions.length > 0 ? entry.keyFunctions.join(", ") : "(none exported)";
  const deps = entry.dependencies.length > 0 ? entry.dependencies.join(", ") : "(none)";
  return `# ${entry.path}

**Category:** ${entry.category}

**Purpose:** ${entry.purpose}

**Line count:** ${entry.lineCount}

**Core logic patterns:** ${corePatterns.length > 0 ? corePatterns.join(", ") : "(none detected)"}

**Key functions:** ${funcs}

**Dependencies:** ${deps}

**Last modified:** ${entry.lastModified}

**Indexed at:** ${entry.indexedAt}
`;
}

function loadPreviousManifest(): Manifest | null {
  const manifestPath = path.join(INDEX_DIR, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Manifest;
  } catch {
    return null;
  }
}

function computeChanges(prev: Manifest | null, currentFiles: Map<string, FileManifestEntry>): ChangeLogEntry {
  const entry: ChangeLogEntry = {
    timestamp: new Date().toISOString(),
    added: [],
    modified: [],
    removed: [],
  };
  if (!prev) {
    // First run — everything is "added".
    for (const fp of currentFiles.keys()) entry.added.push(fp);
    return entry;
  }
  const prevPaths = new Set(prev.files.map((f) => f.path));
  const currPaths = new Set(currentFiles.keys());
  for (const fp of currPaths) {
    if (!prevPaths.has(fp)) {
      entry.added.push(fp);
    } else {
      const prevEntry = prev.files.find((f) => f.path === fp);
      const currEntry = currentFiles.get(fp)!;
      if (prevEntry && prevEntry.lastModified !== currEntry.lastModified) {
        entry.modified.push(fp);
      }
    }
  }
  for (const fp of prevPaths) {
    if (!currPaths.has(fp)) entry.removed.push(fp);
  }
  return entry;
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 v61.5 Phase 10 — Generating Code Index...");
  console.log(`   Root: ${ROOT}`);
  console.log("");

  // Create the .code-index/ directory structure.
  fs.mkdirSync(SUMMARIES_DIR, { recursive: true });

  // Scan all .ts files in src/, scripts/, mini-services/.
  console.log("📥 Scanning source directories...");
  const allFiles: string[] = [];
  for (const dir of SCAN_DIRS) {
    const fullDir = path.join(ROOT, dir);
    const files = walkDir(fullDir, [".ts"]);
    allFiles.push(...files);
    console.log(`   • ${dir}/: ${files.length} files`);
  }
  console.log(`   Total: ${allFiles.length} TypeScript files.`);
  console.log("");

  // Build the manifest entries.
  console.log("📋 Building manifest entries...");
  const currentFiles = new Map<string, FileManifestEntry>();
  const dependencyGraph: Record<string, string[]> = {};
  let totalLines = 0;

  for (const filePath of allFiles) {
    const relPath = path.relative(ROOT, filePath);
    const content = fs.readFileSync(filePath, "utf-8");
    const stat = fs.statSync(filePath);
    const entry: FileManifestEntry = {
      path: relPath,
      purpose: extractPurpose(content),
      keyFunctions: extractKeyFunctions(content),
      dependencies: extractDependencies(content),
      lineCount: content.split("\n").length,
      lastModified: stat.mtime.toISOString(),
      indexedAt: new Date().toISOString(),
      category: deriveCategory(relPath, content),
    };
    currentFiles.set(relPath, entry);
    dependencyGraph[relPath] = entry.dependencies;
    totalLines += entry.lineCount;

    // Generate the per-file summary markdown.
    const summaryPath = path.join(SUMMARIES_DIR, relPath.replace(/\//g, "__") + ".md");
    fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
    fs.writeFileSync(summaryPath, generateSummary(entry, content), "utf-8");
  }

  // Compute changes vs previous manifest.
  const prevManifest = loadPreviousManifest();
  const changes = computeChanges(prevManifest, currentFiles);

  // Write the manifest.
  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    totalFiles: currentFiles.size,
    totalLines,
    files: Array.from(currentFiles.values()).sort((a, b) => a.path.localeCompare(b.path)),
  };
  fs.writeFileSync(path.join(INDEX_DIR, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

  // Write the dependency graph.
  fs.writeFileSync(path.join(INDEX_DIR, "dependencies.json"), JSON.stringify(dependencyGraph, null, 2), "utf-8");

  // Append to the change log.
  const changeLogPath = path.join(INDEX_DIR, "change-log.json");
  let changeLog: ChangeLogEntry[] = [];
  if (fs.existsSync(changeLogPath)) {
    try {
      changeLog = JSON.parse(fs.readFileSync(changeLogPath, "utf-8"));
    } catch {
      changeLog = [];
    }
  }
  changeLog.push(changes);
  // Keep only the last 50 runs.
  if (changeLog.length > 50) changeLog = changeLog.slice(-50);
  fs.writeFileSync(changeLogPath, JSON.stringify(changeLog, null, 2), "utf-8");

  // Summary.
  console.log("");
  console.log("📊 Code Index Generation Complete:");
  console.log(`   Total files indexed: ${manifest.totalFiles}`);
  console.log(`   Total lines: ${manifest.totalLines.toLocaleString()}`);
  console.log(`   Summaries written: ${manifest.totalFiles} files in .code-index/summaries/`);
  console.log(`   Dependencies tracked: ${Object.keys(dependencyGraph).length} files`);
  console.log("");
  console.log("   Change log (this run):");
  console.log(`     Added: ${changes.added.length} files`);
  console.log(`     Modified: ${changes.modified.length} files`);
  console.log(`     Removed: ${changes.removed.length} files`);
  console.log("");
  console.log("📁 Output location: .code-index/");
  console.log("   ├── manifest.json     (master index — read this first)");
  console.log("   ├── summaries/        (per-file markdown summaries)");
  console.log("   ├── dependencies.json (import graph)");
  console.log("   └── change-log.json   (what changed in each run)");
  console.log("");
  console.log("════════════════════════════════════════════════════════════════");
  console.log("🎉  Code Index generated! Future AI sessions should read");
  console.log("   .code-index/manifest.json FIRST to understand the codebase.");
  console.log("════════════════════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Code index generation failed:", err);
    process.exit(1);
  });
