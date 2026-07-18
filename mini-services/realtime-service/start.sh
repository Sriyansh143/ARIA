#!/usr/bin/env bash
# Launcher for the JARVIS realtime mini-service.
# Uses setsid + nohup to fully detach from the spawning shell so the
# service survives across bash tool invocations.
set -e
cd "$(dirname "$0")"

# Kill any previous instance bound to port 3003.
PREV_PID=$(pgrep -f "bun.*realtime-service/index.ts" || true)
if [ -n "$PREV_PID" ]; then
  echo "[start] killing previous instance: $PREV_PID"
  kill -TERM $PREV_PID 2>/dev/null || true
  sleep 1
fi

# Start detached.
setsid nohup bun run dev > realtime.log 2>&1 < /dev/null &
PID=$!
disown 2>/dev/null || true
echo "[start] launched realtime-service with PID $PID"
echo "[start] log: $(pwd)/realtime.log"

# Wait briefly and confirm it's alive.
sleep 3
if kill -0 $PID 2>/dev/null; then
  echo "[start] OK — process $PID still alive after 3s"
else
  echo "[start] FAIL — process $PID died within 3s"
  echo "---LOG---"
  cat realtime.log
  exit 1
fi
