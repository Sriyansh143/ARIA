/**
 * scripts/post-build.mjs — Cross-platform post-build copy.
 *
 * Replaces the Unix-only `cp -r` in the build script so the build
 * works identically on Windows (PowerShell), macOS, and Linux.
 *
 * Copies:
 *   .next/static → .next/standalone/.next/static
 *   public       → .next/standalone/public
 *
 * Usage:  node scripts/post-build.mjs
 * Exit:   0 on success (or if standalone dir is missing — non-fatal)
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const standaloneDir = join(cwd, ".next", "standalone");
const staticSrc = join(cwd, ".next", "static");
const publicSrc = join(cwd, "public");

// If standalone doesn't exist, Next.js didn't produce a standalone build.
// This is non-fatal — the dev server doesn't need standalone.
if (!existsSync(standaloneDir)) {
  console.log("[post-build] .next/standalone not found — skipping copy (dev mode)");
  process.exit(0);
}

let copied = 0;

// Copy .next/static → .next/standalone/.next/static
if (existsSync(staticSrc)) {
  const target = join(standaloneDir, ".next", "static");
  mkdirSync(join(standaloneDir, ".next"), { recursive: true });
  cpSync(staticSrc, target, { recursive: true });
  copied++;
  console.log("[post-build] ✓ .next/static → standalone/.next/static");
}

// Copy public → .next/standalone/public
if (existsSync(publicSrc)) {
  const target = join(standaloneDir, "public");
  cpSync(publicSrc, target, { recursive: true });
  copied++;
  console.log("[post-build] ✓ public → standalone/public");
}

if (copied === 0) {
  console.log("[post-build] nothing to copy (no static or public dir found)");
} else {
  console.log(`[post-build] done — ${copied} director${copied === 1 ? "y" : "ies"} copied`);
}

// v74 Phase 24 (RULE-76): Master Continuity Verification.
// After every build, verify that all features from Phases 1-24 are present +
// wired. If any are missing, fail the build (exit 1) — no shipping broken code.
import { spawnSync } from "node:child_process";
console.log("[post-build] v74 Phase 24: running master continuity verification (verify-all-phases.ts)...");
const verifyResult = spawnSync("bun", ["run", "scripts/verify-all-phases.ts"], {
  cwd: process.cwd(),
  stdio: "inherit",
  encoding: "utf-8",
});
if (verifyResult.status !== 0) {
  console.error("[post-build] ❌ Continuity verification FAILED — refusing to ship.");
  process.exit(1);
}
console.log("[post-build] ✓ Continuity verification PASSED.");

process.exit(0);
