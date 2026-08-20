#!/usr/bin/env bash
# start-services.sh — launch both the Next.js app and the realtime sidecar
# for Docker / production deployments. Uses Bun runtime for both.
#
# Env vars (all optional):
#   PORT                  — app HTTP port (default 3000)
#   REALTIME_PORT         — sidecar port (default 3003)
#   BUN_INSTALL_BOOTSTRAP — "1" to bun install realtime deps on first boot
set -e

PORT="${PORT:-3000}"
REALTIME_PORT="${REALTIME_PORT:-3003}"
APP_DIR="${APP_DIR:-/app}"

# ─── 1. Realtime sidecar ───────────────────────────────────────────
echo "[start-services] launching realtime sidecar on port $REALTIME_PORT..."
cd "$APP_DIR/mini-services/realtime"

# Install deps if missing (Docker COPY may have skipped node_modules)
if [ ! -d node_modules ] && [ "${BUN_INSTALL_BOOTSTRAP:-1}" = "1" ]; then
  bun install --production 2>&1 | tail -3 || true
fi

# Sidecar uses its own port; the env var is read at startup.
REALTIME_PORT="$REALTIME_PORT" bun run start > "$APP_DIR/logs/realtime.log" 2>&1 &
REALTIME_PID=$!
echo "[start-services] realtime PID=$REALTIME_PID"

cd "$APP_DIR"

# Give the sidecar 1.5s to bind before the app starts hitting it.
sleep 1.5

# ─── 2. Next.js app ────────────────────────────────────────────────
echo "[start-services] launching ARIA Mission Control on port $PORT..."
if [ -f "$APP_DIR/.next/standalone/server.js" ]; then
  PORT="$PORT" exec bun "$APP_DIR/.next/standalone/server.js"
else
  echo "[start-services] standalone build missing — falling back to `bun run dev`"
  PORT="$PORT" exec bun run dev
fi
