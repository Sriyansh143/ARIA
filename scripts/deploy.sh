#!/usr/bin/env bash
#
# ARIA Mission Control v41 — Production Deploy Script
#
# Automates the go-live checklist:
#   1. bun install
#   2. prisma db push
#   3. bun run build
#   4. Restart the server (PM2 or Docker)
#
# Usage:
#   ./scripts/deploy.sh              # full deploy
#   ./scripts/deploy.sh --skip-build # skip the build step (for hot-reload deploys)
#   ./scripts/deploy.sh --docker     # deploy via Docker instead of PM2
#
set -euo pipefail

# ─── Colors ─────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"; }
ok()   { echo -e "${GREEN}[$(date +%H:%M:%S)] ✓${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠${NC} $1"; }
err()  { echo -e "${RED}[$(date +%H:%M:%S)] ✗${NC} $1"; }

# ─── Args ───────────────────────────────────────────────────────────
SKIP_BUILD=false
USE_DOCKER=false
for arg in "$@"; do
  case $arg in
    --skip-build) SKIP_BUILD=true ;;
    --docker)     USE_DOCKER=true ;;
  esac
done

cd "$(dirname "$0")/.."

log "ARIA Mission Control v41 — Production Deploy"
log "Working directory: $(pwd)"
echo ""

# ─── Step 0: Environment validation ─────────────────────────────────
log "Step 0: Validating environment..."
bun run check-env || {
  err "Environment validation failed. Fix the missing vars above."
  exit 1
}
ok "Environment OK"
echo ""

# ─── Step 1: Install dependencies ───────────────────────────────────
log "Step 1: Installing dependencies..."
bun install --frozen-lockfile
ok "Dependencies installed"
echo ""

# ─── Step 2: Database ───────────────────────────────────────────────
log "Step 2: Pushing Prisma schema to database..."
bunx prisma db push --accept-data-loss
bunx prisma generate
ok "Database synced"
echo ""

# ─── Step 3: Build (optional) ───────────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  log "Step 3: Building production bundle..."
  if bun run build; then
    ok "Build complete"
  else
    err "Build failed"
    exit 1
  fi
  echo ""
else
  warn "Step 3: Skipping build (--skip-build)"
  echo ""
fi

# ─── Step 4: Restart server ─────────────────────────────────────────
log "Step 4: Restarting server..."

if [ "$USE_DOCKER" = true ]; then
  # Docker deployment
  if command -v docker &> /dev/null; then
    docker compose -f docker-compose.free.yml down
    docker compose -f docker-compose.free.yml up -d --build
    ok "Docker container restarted"
  else
    err "Docker not installed. Install Docker or use PM2 (remove --docker flag)."
    exit 1
  fi
else
  # PM2 deployment
  if command -v pm2 &> /dev/null; then
    pm2 restart aria-mission-control --update-env || {
      log "PM2 process not found — starting new one..."
      pm2 start "bun run start" --name aria-mission-control
    }
    pm2 save
    ok "PM2 process restarted"
  else
    warn "PM2 not installed — using bun directly (no process manager)"
    warn "Install PM2 for production: npm install -g pm2"
    # Kill existing process on port 3000 + start new one
    (lsof -t -i:3000 | xargs kill -9 2>/dev/null) || true
    nohup bun run start > server.log 2>&1 &
    ok "Server started (PID: $!) — logs: server.log"
  fi
fi
echo ""

# ─── Step 5: Health check ───────────────────────────────────────────
log "Step 5: Health check..."
sleep 5
for i in 1 2 3 4 5; do
  if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
    ok "Server is healthy (attempt $i)"
    curl -s http://localhost:3000/api/health
    echo ""
    echo ""
    log "${GREEN}════════════════════════════════════════════════════${NC}"
    log "${GREEN}  ARIA Mission Control v41 is LIVE!  ${NC}"
    log "${GREEN}  → http://localhost:3000${NC}"
    log "${GREEN}  → Health: http://localhost:3000/api/health${NC}"
    log "${GREEN}════════════════════════════════════════════════════${NC}"
    exit 0
  fi
  warn "Health check attempt $i failed — retrying in 3s..."
  sleep 3
done

err "Server did not become healthy within 15 seconds"
err "Check logs: tail -100 server.log"
exit 1
