#!/usr/bin/env bash
# keeper.sh — 24/7 auto-restart supervisor for ARIA Mission Control.
#
# Designed for laptop / single-server deployments where you want the app
# to stay up "for free" with zero cloud dependencies. Restarts the Next.js
# process on crash, rotates logs, and runs Prisma bootstrap on first boot.
#
# Usage:
#   bash scripts/keeper.sh                # dev mode (with HMR)
#   NODE_ENV=production bash scripts/keeper.sh   # prod mode (standalone)
#   PORT=4000 bash scripts/keeper.sh      # custom port
#
# Logs:
#   logs/aria-stdout.log   — combined stdout+stderr (rotated at 50MB)
#   logs/aria-crashes.log  — one line per crash with timestamp + reason
#
# Stop:
#   pkill -f "keeper.sh" ; pkill -f "next dev" ; pkill -f "server.js"
#
# Env vars (all optional — defaults are zero-cost):
#   PORT                  — HTTP port (default 3000)
#   NODE_ENV              — development | production
#   JARVIS_DEV_BYPASS_AUTH — "1" to skip login (single-operator laptop mode)
#   DATABASE_URL          — Prisma DB URL (default: local SQLite file)
#   OLLAMA_HOST           — local Ollama URL (default http://127.0.0.1:11434)
#   ARIA_KEEPER_MIN_UPTIME — seconds below which a crash counts as a boot loop (default 10)
#   ARIA_KEEPER_MAX_RESTARTS — cap per hour before backoff (default 20)

set -u

# ─── Configuration ──────────────────────────────────────────────────
PORT="${PORT:-3000}"
NODE_ENV="${NODE_ENV:-development}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$APP_DIR/logs"
mkdir -p "$LOG_DIR"

STDOUT_LOG="$LOG_DIR/aria-stdout.log"
CRASH_LOG="$LOG_DIR/aria-crashes.log"
MIN_UPTIME="${ARIA_KEEPER_MIN_UPTIME:-10}"
MAX_RESTARTS_PER_HOUR="${ARIA_KEEPER_MAX_RESTARTS:-20}"

# ─── Default zero-cost env (only set if user has not) ──────────────
export DATABASE_URL="${DATABASE_URL:-file:$APP_DIR/db/custom.db}"
export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
# Single-operator laptop mode: skip login wall so the dashboard is
# immediately usable without signing up. Override by exporting =0.
export JARVIS_DEV_BYPASS_AUTH="${JARVIS_DEV_BYPASS_AUTH:-1}"
# Prefer Ollama as the only LLM provider if no cloud keys are present.
export ARIA_PREFER_LOCAL_LLM="${ARIA_PREFER_LOCAL_LLM:-1}"

cd "$APP_DIR"

# ─── One-time bootstrap ────────────────────────────────────────────
if [ ! -f "$APP_DIR/db/custom.db" ] && [ ! -f "$APP_DIR/db/.bootstrap-done" ]; then
  echo "[keeper] first boot — running prisma db push + generate"
  mkdir -p "$APP_DIR/db"
  bunx prisma db push --accept-data-loss --skip-generate 2>&1 | tee -a "$STDOUT_LOG"
  bunx prisma generate 2>&1 | tee -a "$STDOUT_LOG"
  touch "$APP_DIR/db/.bootstrap-done"
fi

# ─── Log rotation (50MB) ───────────────────────────────────────────
rotate_logs() {
  if [ -f "$STDOUT_LOG" ]; then
    local size
    size=$(stat -c%s "$STDOUT_LOG" 2>/dev/null || stat -f%z "$STDOUT_LOG" 2>/dev/null || echo 0)
    if [ "$size" -gt 52428800 ]; then
      mv "$STDOUT_LOG" "$STDOUT_LOG.$(date +%Y%m%d-%H%M%S).rolled"
      gzip -f "$STDOUT_LOG".*.rolled 2>/dev/null || true
      find "$LOG_DIR" -name "aria-stdout.log.*.rolled.gz" -mtime +14 -delete 2>/dev/null || true
    fi
  fi
}

# ─── Crash-loop detection ──────────────────────────────────────────
RESTART_TIMES=()
cleanup_old_restarts() {
  local now
  now=$(date +%s)
  RESTART_TIMES=("${RESTART_TIMES[@]/#$((now-3600)):}")
  # Drop entries older than 1h
  local fresh=()
  for t in "${RESTART_TIMES[@]}"; do
    [ -n "$t" ] && [ "$t" -gt "$((now-3600))" ] && fresh+=("$t")
  done
  RESTART_TIMES=("${fresh[@]}")
}

# ─── Choose start command based on NODE_ENV ────────────────────────
start_cmd() {
  if [ "$NODE_ENV" = "production" ]; then
    if [ ! -d "$APP_DIR/.next/standalone" ]; then
      echo "[keeper] production mode but no standalone build — running bun run build first"
      bun run build >> "$STDOUT_LOG" 2>&1
    fi
    echo "bun $APP_DIR/.next/standalone/server.js"
  else
    echo "bun run dev -- -p $PORT"
  fi
}

# ─── Main supervisor loop ──────────────────────────────────────────
echo "[keeper] starting ARIA supervisor (NODE_ENV=$NODE_ENV PORT=$PORT bypass_auth=$JARVIS_DEV_BYPASS_AUTH)"

trap 'echo "[keeper] received SIGINT/SIGTERM, exiting"; kill $PID 2>/dev/null; exit 0' INT TERM

while true; do
  rotate_logs
  START_TS=$(date +%s)

  CMD=$(start_cmd)
  echo "[keeper] $(date -Iseconds) starting: $CMD" >> "$STDOUT_LOG"
  # shellcheck disable=SC2086
  $CMD >> "$STDOUT_LOG" 2>&1 &
  PID=$!
  wait "$PID"
  EXIT_CODE=$?
  END_TS=$(date +%s)
  UPTIME=$((END_TS - START_TS))

  echo "$(date -Iseconds) exit=$EXIT_CODE uptime=${UPTIME}s" >> "$CRASH_LOG"

  # Boot-loop detection: if it crashed within MIN_UPTIME seconds, back off
  if [ "$UPTIME" -lt "$MIN_UPTIME" ]; then
    echo "[keeper] crash within ${UPTIME}s — backing off 30s"
    sleep 30
  fi

  # Rate-limit restarts to MAX_RESTARTS_PER_HOUR
  RESTART_TIMES+=("$END_TS")
  cleanup_old_restarts
  if [ "${#RESTART_TIMES[@]}" -ge "$MAX_RESTARTS_PER_HOUR" ]; then
    echo "[keeper] $MAX_RESTARTS_PER_HOUR restarts in the last hour — backing off 5 min"
    sleep 300
  fi

  # Brief pause before restart to avoid hammering
  sleep 2
done
