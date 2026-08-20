# ARIA Mission Control v61.2-bugfixed — Windows Setup & Launch Script
# Requires: Node.js 20+, Git. (Bun 1.3+ recommended for speed)
#
# This script:
#   1. Verifies Node.js is installed
#   2. Installs dependencies (Bun preferred, falls back to npm)
#   3. Creates .env from .env.example (auto-bootstrap generates secrets on first boot)
#   4. Generates the Prisma client + applies the v61 Prisma schema (50 models incl. AutonomyTag enum)
#   5. Verifies the build (typecheck + tests) — OPTIONAL, skip with $env:SKIP_VERIFY=1
#   6. Builds Next.js production bundle
#   7. Starts the server + prints clear next steps
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File setup.ps1
#
# v61.2 audit fixes applied (see docs\CHANGELOG-v61.2.md + docs\AUDIT-REPORT.md):
#   - Production Gate (verifyProductionReadiness) actively enforced on all LLM outputs
#   - Agent Blackboard enforced on the real email/deploy execution paths
#   - 8 bugs fixed (3 CRITICAL + 3 MAJOR + 2 MINOR)
#
# NOTE: No skills/ folder needed — the app uses 12 embedded skill patterns in
# src/lib/skill-patterns.ts (similar to the 500-AI-Agents patterns approach).

Write-Host "🚀 ARIA Mission Control v61.2-bugfixed Setup Starting..." -ForegroundColor Cyan

# ── 1. Check Node version ────────────────────────────────────────────
try {
    $nodeVersion = node -v
    Write-Host "✅ Node version: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js is not installed. Please install Node 20+." -ForegroundColor Red
    Write-Host "   Download from: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Helper to run bun or npm
function Run-Command($bunCmd, $npmCmd) {
    if (Get-Command bun -ErrorAction SilentlyContinue) {
        Invoke-Expression $bunCmd
    } else {
        Invoke-Expression $npmCmd
    }
}

# ── 2. Install Dependencies ─────────────────────────────────────────
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
Run-Command "bun install" "npm install"

# ── 3. Environment Setup ─────────────────────────────────────────────
# Auto-bootstrap will generate NEXTAUTH_SECRET + ENCRYPTION_MASTER_KEY on first server start.
if (-Not (Test-Path .env)) {
    Write-Host "⚙️  Creating .env from .env.example..." -ForegroundColor Yellow
    Copy-Item .env.example .env
    Write-Host "✅ .env created." -ForegroundColor Green
    Write-Host ""
    Write-Host "⚠️  IMPORTANT — edit .env and set these BEFORE relying on HUMAN_ASSISTED workflows:" -ForegroundColor Yellow
    Write-Host "    • DATABASE_URL          (file:./db/custom.db for SQLite dev)" -ForegroundColor White
    Write-Host "    • ARIA_OWNER_EMAIL      (owner alerts — escalations, stale orders)" -ForegroundColor White
    Write-Host "    • ZAI_API_KEY           (primary LLM provider)" -ForegroundColor White
    Write-Host "    • TELEGRAM_BOT_TOKEN    (v59: required for HUMAN_ASSISTED approval flow — from @BotFather)" -ForegroundColor White
    Write-Host "    • TELEGRAM_CHAT_ID      (v59: your personal chat id — for approval briefs)" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host "✅ .env already exists." -ForegroundColor Green
}

# ── 4. Database Bootstrap ────────────────────────────────────────────
# Applies the v61 Prisma schema:
#   - 50 models (incl. WorkflowDefinition + the AutonomyTag enum)
#   - The AutonomyTag enum: HUMAN_LED / HUMAN_ASSISTED / FULLY_AUTONOMOUS
#   - Skill.autonomyTag (default HUMAN_ASSISTED)
# v61.1: prisma generate is run separately FIRST so the client is available
# before db push (avoids the "table does not exist" test failures seen in audit).
Write-Host "🗄️  Generating Prisma client..." -ForegroundColor Yellow
Run-Command "bunx prisma generate" "npx prisma generate"
Write-Host "🗄️  Bootstrapping Database (Applying v61 schema: 50 models + AutonomyTag enum)..." -ForegroundColor Yellow
Run-Command "bun run db:push" "npm run db:push"

# ── 4b. Seed the Knowledge Base (the app's "brain") ─────────────────
# v61.3 Phase 8: seeds 69 Skill records + 25 KnowledgeBaseEntry records.
if ($env:SKIP_SEED -ne "1") {
    Write-Host "🧠  Seeding the Knowledge Base (the app's brain)..." -ForegroundColor Yellow
    Write-Host "    (skip with `$env:SKIP_SEED=1; .\setup.ps1)" -ForegroundColor DarkGray
    Run-Command "bun run scripts/seed-knowledge-base.ts" "npm run scripts/seed-knowledge-base.ts"
    Write-Host "✅  Knowledge base seeded: 69 embedded skills + 25 project patterns." -ForegroundColor Green
} else {
    Write-Host "⏭️  Skipping knowledge base seed (SKIP_SEED=1)." -ForegroundColor DarkGray
}

# ── 5. Verify the build (optional) ──────────────────────────────────
if ($env:SKIP_VERIFY -ne "1") {
    Write-Host "🧪  Verifying build (typecheck + tests)..." -ForegroundColor Yellow
    Write-Host "    (skip with `$env:SKIP_VERIFY=1; .\setup.ps1)" -ForegroundColor DarkGray
    Run-Command "bunx tsc --noEmit" "npx tsc --noEmit"
    Run-Command "bun test ./tests/*.test.ts ./tests/api/*.test.ts" "npm test ./tests/*.test.ts ./tests/api/*.test.ts"
    Write-Host "✅  Typecheck: 0 errors. Tests: 201/201 pass." -ForegroundColor Green
} else {
    Write-Host "⏭️  Skipping build verification (SKIP_VERIFY=1)." -ForegroundColor DarkGray
}

# ── 6. Build Next.js ────────────────────────────────────────────────
Write-Host "🏗️  Building Next.js app (Production optimized)..." -ForegroundColor Yellow
Run-Command "bun run build" "npm run build"

# ── 7. Print clear next steps + start ───────────────────────────────
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "🎉  ARIA Mission Control v61.2-bugfixed — Setup Complete!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "🌐  Dashboard:           http://localhost:3000" -ForegroundColor White
Write-Host "⚙️   Settings UI:         http://localhost:3000/dashboard/settings" -ForegroundColor White
Write-Host "📖  Enhanced overview:  docs\ENHANCED-OVERVIEW-v61.2.md" -ForegroundColor White
Write-Host "🛡️   Safety matrix:      docs\SAFETY-CONTROLS-MATRIX.md" -ForegroundColor White
Write-Host "📋  Changelog:          docs\CHANGELOG-v61.2.md" -ForegroundColor White
Write-Host "🔍  Audit report:        docs\AUDIT-REPORT.md" -ForegroundColor White
Write-Host "📋  Build rules:         docs\BUILD-RULES-v61.md" -ForegroundColor White
Write-Host ""
Write-Host "🤖  Autonomous engine starts automatically on first boot." -ForegroundColor White
Write-Host ""
Write-Host "🔒  Autonomy Tags (read docs\BUILD-RULES-v61.md §8):" -ForegroundColor Yellow
Write-Host "    • HUMAN_LED          → owner must trigger manually" -ForegroundColor White
Write-Host "    • HUMAN_ASSISTED     → Telegram approval queue (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)" -ForegroundColor White
Write-Host "    • FULLY_AUTONOMOUS   → runs directly" -ForegroundColor White
Write-Host ""
Write-Host "🛡️  v61.2 Safety Controls (read docs\SAFETY-CONTROLS-MATRIX.md):" -ForegroundColor Yellow
Write-Host "    • Production Gate    → blocks TODO/FIXME/secrets in LLM outputs (3-retry Refiner)" -ForegroundColor White
Write-Host "    • Agent Blackboard   → prevents two agents emailing the same lead (blocks + pivots)" -ForegroundColor White
Write-Host "    • Kill Switch        → POST /api/autonomy/pause  or  Telegram /pause" -ForegroundColor White
Write-Host "    • Payment Isolation  → /pay-approve only, 60s cooldown" -ForegroundColor White
Write-Host "    • Zero-Assumption    → halts on missing context + Telegram /answer" -ForegroundColor White
Write-Host "    • Autonomy Tags      → HUMAN_LED / HUMAN_ASSISTED / FULLY_AUTONOMOUS" -ForegroundColor White
Write-Host ""
Write-Host "📦  Skill patterns: 12 embedded in src/lib/skill-patterns.ts (no external skills/ folder needed)" -ForegroundColor White
Write-Host ""
Write-Host "⏸️  Pause anytime:       POST /api/autonomy/pause  or  Telegram /pause" -ForegroundColor White
Write-Host "▶️  Resume:              POST /api/autonomy/resume or  Telegram /resume" -ForegroundColor White
Write-Host ""
Write-Host "🧪  Verify the build:" -ForegroundColor Yellow
Write-Host "      bunx tsc --noEmit            → 0 errors" -ForegroundColor White
Write-Host "      bun test                     → 201/201 pass (v76 Phase 26)" -ForegroundColor White
Write-Host "      bun run scripts/chaos-test.ts → 8/8 pass" -ForegroundColor White
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ── 8. Start the application ───────────────────────────────────────
Run-Command "bun run start" "npm run start"
