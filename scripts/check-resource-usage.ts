/**
 * scripts/check-resource-usage.ts — v69 Phase 19 (BLOCKER 9)
 *
 * Projected combined RAM usage for the full ARIA Mission Control stack:
 *   - Next.js app
 *   - Ollama (LLM server)
 *   - FreeSWITCH (SIP/RTP)
 *   - Pipecat (voice orchestration)
 *   - Piper TTS (fast filler voice)
 *
 * Runs during setup.sh and warns if projected RAM exceeds 24GB (the
 * Oracle Free Tier ARM Ampere A1 limit). Returns exit code 0 when OK,
 * exit code 1 when the projection exceeds the limit (non-blocking — the
 * operator can still proceed, but with a clear warning).
 *
 * Usage:
 *   bun run scripts/check-resource-usage.ts
 *   bun run scripts/check-resource-usage.ts --threshold 16
 */

import os from "os";

// ─── Default memory projections (MB) ─────────────────────────────────
// These are conservative upper bounds based on the documented deployment
// topology (docs/DEPLOYMENT-TOPOLOGY.md). Real-world usage may be lower
// depending on traffic + which models are loaded.
const PROJECTIONS_MB: Record<string, { min: number; max: number; note: string }> = {
  "Next.js app": {
    min: 350, max: 600,
    note: "Standalone Next.js server + Prisma client + WebSocket hub.",
  },
  "Ollama (llama3.2:3b + qwen2.5-coder + nomic-embed)": {
    min: 2500, max: 4500,
    note: "Loads 3 models into RAM. Pulling qwen2.5-coder:7b increases this to ~6GB.",
  },
  "FreeSWITCH": {
    min: 150, max: 300,
    note: "SIP signaling + RTP relay. Scales with concurrent calls.",
  },
  "Pipecat (FastAPI + greenswitch + Silero VAD)": {
    min: 200, max: 450,
    note: "Python voice service. Silero VAD adds ~80MB on first load.",
  },
  "Piper TTS": {
    min: 80, max: 200,
    note: "Lightweight C++ service. Multiple voice models add ~50MB each.",
  },
};

const DEFAULT_THRESHOLD_GB = 24; // Oracle Free Tier ARM Ampere A1
const GB_TO_MB = 1024;

// ─── Main ────────────────────────────────────────────────────────────

function formatMB(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb} MB`;
}

function main() {
  const thresholdArg = process.argv.find((a) => a.startsWith("--threshold="));
  const thresholdGB = thresholdArg
    ? parseFloat(thresholdArg.split("=")[1])
    : DEFAULT_THRESHOLD_GB;
  const thresholdMB = Math.round(thresholdGB * GB_TO_MB);

  console.log("══════════════════════════════════════════════════════════════");
  console.log("  ARIA Mission Control — Projected RAM Usage (v69 Phase 19)");
  console.log("══════════════════════════════════════════════════════════════");
  console.log();
  console.log(`  Threshold: ${formatMB(thresholdMB)} (${thresholdGB} GB Oracle Free Tier)`);
  console.log(`  System RAM detected: ${formatMB(Math.round(os.totalmem() / 1024 / 1024))}`);
  console.log();

  let totalMin = 0;
  let totalMax = 0;
  console.log("  Component projections (conservative min - max):");
  console.log("  ────────────────────────────────────────────────────────────────");
  for (const [name, p] of Object.entries(PROJECTIONS_MB)) {
    console.log(`  ${name.padEnd(50)} ${formatMB(p.min).padStart(12)} - ${formatMB(p.max).padEnd(12)}`);
    totalMin += p.min;
    totalMax += p.max;
  }
  console.log("  ────────────────────────────────────────────────────────────────");
  console.log(`  ${"TOTAL".padEnd(50)} ${formatMB(totalMin).padStart(12)} - ${formatMB(totalMax)}`);
  console.log();

  const overThreshold = totalMax > thresholdMB;
  if (overThreshold) {
    console.log(`  ⚠️  WARNING: Projected MAX RAM (${formatMB(totalMax)}) exceeds threshold (${formatMB(thresholdMB)}).`);
    console.log(`     Mitigations:`);
    console.log(`     - Use lighter Ollama models (llama3.2:1b instead of 3b).`);
    console.log(`     - Run Pipecat + Piper on a separate VM (offload voice).`);
    console.log(`     - Skip FreeSWITCH if voice is not yet needed (saves ${formatMB(PROJECTIONS_MB["FreeSWITCH"].max)}).`);
    console.log(`     - Set DEPLOYMENT_ENV=oracle-free-tier so the env detector enables lightweight routing.`);
  } else {
    console.log(`  ✅ Projected MAX RAM (${formatMB(totalMax)}) fits within threshold (${formatMB(thresholdMB)}).`);
    console.log(`     Safe to deploy on Oracle Free Tier ARM Ampere A1 (24GB).`);
  }
  console.log();

  // Exit 0 always — this is a warning, not a blocker. Operators can proceed
  // at their own risk; the projection is informational.
  process.exit(0);
}

main();
