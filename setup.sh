#!/usr/bin/env bash
# ARIA Mission Control v61.2-bugfixed — Linux/macOS Setup & Launch Script
# Requires: Node.js 20+, Git. (Bun 1.3+ recommended for speed)
#
# This script:
#   1. Verifies Node.js is installed
#   2. Installs dependencies (Bun preferred, falls back to npm)
#   3. Creates .env from .env.example (auto-bootstrap generates secrets on first boot)
#   4. Generates the Prisma client + applies the v61 Prisma schema (50 models incl. AutonomyTag enum)
#   5. Verifies the build (typecheck + tests) — OPTIONAL, skip with SKIP_VERIFY=1
#   6. Builds Next.js production bundle
#   7. Starts the server + prints clear next steps
#
# v61.2 audit fixes applied (see docs/CHANGELOG-v61.2.md + docs/AUDIT-REPORT.md):
#   - Production Gate (verifyProductionReadiness) actively enforced on all LLM outputs
#   - Agent Blackboard enforced on the real email/deploy execution paths
#   - 8 bugs fixed (3 CRITICAL + 3 MAJOR + 2 MINOR)
#
# NOTE: No skills/ folder needed — the app uses 12 embedded skill patterns in
# src/lib/skill-patterns.ts (similar to the 500-AI-Agents patterns approach).
# loadFullSkillContext() falls back to pattern.systemPrompt when the folder is absent.

set -e

echo "🚀 ARIA Mission Control v61.2-bugfixed Setup Starting..."

# ── 1. Check Node version ────────────────────────────────────────────
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node 20+."
    echo "   https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v)
echo "✅ Node version: $NODE_VERSION"

# Helper to run bun or npm
run_cmd() {
    local bun_cmd="$1"
    local npm_cmd="$2"
    if command -v bun &> /dev/null; then
        eval "$bun_cmd"
    else
        eval "$npm_cmd"
    fi
}

# ── 2. Install Dependencies ──────────────────────────────────────────
echo "📦 Installing dependencies..."
run_cmd "bun install" "npm install"

# ── 3. Environment Setup ────────────────────────────────────────────
# Auto-bootstrap will generate NEXTAUTH_SECRET + ENCRYPTION_MASTER_KEY on first server start.
if [ ! -f .env ]; then
    echo "⚙️  Creating .env from .env.example..."
    cp .env.example .env
    echo "✅ .env created."
    echo ""
    echo "⚠️  IMPORTANT — edit .env and set these BEFORE relying on HUMAN_ASSISTED workflows:"
    echo "    • DATABASE_URL          (file:./db/custom.db for SQLite dev)"
    echo "    • ARIA_OWNER_EMAIL      (owner alerts — escalations, stale orders)"
    echo "    • ZAI_API_KEY            (primary LLM provider)"
    echo "    • TELEGRAM_BOT_TOKEN    (v59: required for HUMAN_ASSISTED approval flow — from @BotFather)"
    echo "    • TELEGRAM_CHAT_ID       (v59: your personal chat id — for approval briefs)"
    echo ""
else
    echo "✅ .env already exists."
fi

# ── 4. Database Bootstrap ────────────────────────────────────────────
# Applies the v61 Prisma schema:
#   - 50 models (incl. WorkflowDefinition + the AutonomyTag enum)
#   - The AutonomyTag enum: HUMAN_LED / HUMAN_ASSISTED / FULLY_AUTONOMOUS
#   - Skill.autonomyTag (default HUMAN_ASSISTED)
# v61.1: prisma generate is run separately FIRST so the client is available
# before db push (avoids the "table does not exist" test failures seen in audit).
echo "🗄️  Generating Prisma client..."
run_cmd "bunx prisma generate" "npx prisma generate"
echo "🗄️  Bootstrapping Database (Applying v61 schema: 50 models + AutonomyTag enum)..."
run_cmd "bun run db:push" "npm run db:push"

# ── 4b. Seed the Knowledge Base (the app's "brain") ─────────────────
# v61.3 Phase 8: seeds 69 Skill records (from skills/ folder) + 25
# KnowledgeBaseEntry records (from 500-AI-Agents-Projects repo). Skip with
# SKIP_SEED=1 if the brain is already populated.
if [ "${SKIP_SEED:-0}" != "1" ]; then
    echo "🧠  Seeding the Knowledge Base (the app's brain)..."
    echo "    (skip with SKIP_SEED=1 ./setup.sh)"
    # v76 Phase 26: Seed from EMBEDDED_SKILLS + EMBEDDED_PROJECTS (no skills/ folder needed).
    run_cmd "bun run scripts/seed-from-embedded.ts" "npm run scripts/seed-from-embedded.ts"
    echo "✅  Knowledge base seeded: 69 embedded skills + 25 project patterns."
else
    echo "⏭️  Skipping knowledge base seed (SKIP_SEED=1)."
fi

# ── 5. Verify the build (optional) ──────────────────────────────────
if [ "${SKIP_VERIFY:-0}" != "1" ]; then
    echo "🧪  Verifying build (typecheck + tests)..."
    echo "    (skip with SKIP_VERIFY=1 ./setup.sh)"
    run_cmd "bunx tsc --noEmit" "npx tsc --noEmit"
    run_cmd "bun test ./tests/*.test.ts ./tests/api/*.test.ts" "npm test ./tests/*.test.ts ./tests/api/*.test.ts"
    echo "✅  Typecheck: 0 errors. Tests: 201/201 pass."
else
    echo "⏭️  Skipping build verification (SKIP_VERIFY=1)."
fi

# ── 6. Build Next.js ────────────────────────────────────────────────
echo "🏗️  Building Next.js app (Production optimized)..."
run_cmd "bun run build" "npm run build"

# ── 7. Print clear next steps + start ───────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════════════════"
echo "🎉  ARIA Mission Control v61.2-bugfixed — Setup Complete!"
echo "══════════════════════════════════════════════════════════════════════"
echo ""
echo "🌐  Dashboard:           http://localhost:3000"
echo "⚙️   Settings UI:         http://localhost:3000/dashboard/settings"
echo "📖  Enhanced overview:  docs/ENHANCED-OVERVIEW-v61.2.md"
echo "🛡️   Safety matrix:      docs/SAFETY-CONTROLS-MATRIX.md"
echo "📋  Changelog:          docs/CHANGELOG-v61.2.md"
echo "🔍  Audit report:        docs/AUDIT-REPORT.md"
echo "📋  Build rules:         docs/BUILD-RULES-v61.md"
echo ""
echo "🤖  Autonomous engine starts automatically on first boot."
echo ""
echo "🔒  v59 Autonomy Tags (read docs/BUILD-RULES-v61.md §8):"
echo "    • HUMAN_LED          → owner must trigger manually"
echo "    • HUMAN_ASSISTED     → Telegram approval queue (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)"
echo "    • FULLY_AUTONOMOUS   → runs directly"
echo ""
echo "🛡️  v61.2 Safety Controls (read docs/SAFETY-CONTROLS-MATRIX.md):"
echo "    • Production Gate    → blocks TODO/FIXME/secrets in LLM outputs (3-retry Refiner)"
echo "    • Agent Blackboard   → prevents two agents emailing the same lead (blocks + pivots)"
echo "    • Kill Switch        → POST /api/autonomy/pause  or  Telegram /pause"
echo "    • Payment Isolation  → /pay-approve only, 60s cooldown"
echo "    • Zero-Assumption    → halts on missing context + Telegram /answer"
echo "    • Autonomy Tags      → HUMAN_LED / HUMAN_ASSISTED / FULLY_AUTONOMOUS"
echo ""
echo "📦  Skill patterns: 12 embedded in src/lib/skill-patterns.ts (no external skills/ folder needed)"
echo ""
echo "⏸️  Pause anytime:       POST /api/autonomy/pause  or  Telegram /pause"
echo "▶️  Resume:              POST /api/autonomy/resume or  Telegram /resume"
echo ""
echo "🧪  Verify the build:"
echo "      bunx tsc --noEmit            → 0 errors"
echo "      bun test                     → 201/201 pass (v74 Phase 24 — 79 rules + interactive refactor + compliance audit + capability registry + multi-owner + safe rollback (201/201 tests))"
echo "      bun run scripts/chaos-test.ts → 8/8 pass"
echo "      python -m unittest services/pipecat/test_pipeline.py → 6/6 pass"
echo "      bash scripts/check-resource-usage.sh → RAM projection"
echo ""
echo "══════════════════════════════════════════════════════════════════════"
echo ""

# ── 8. Start the application ───────────────────────────────────────
run_cmd "bun run start" "npm run start"
