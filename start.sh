#!/bin/bash
# ============================================================
# Black Mic Studio — Smart Launcher
# ============================================================
# Handles: server lifecycle, ADB tunnel, notifications,
# build check, and browser open. Safe to run multiple times.
# ============================================================

set -uo pipefail

APP_DIR="/home/mobta/Black_Mic"
SERVER_PORT=3001
LOG_FILE="$APP_DIR/.server.log"
PID_FILE="$APP_DIR/.server.pid"
ICON="$APP_DIR/icon.png"

cd "$APP_DIR"

# ---- Notification helper -----------------------------------
notify() {
  notify-send "Black Mic Studio" "$1" --icon="$ICON" --app-name="Black Mic Studio" 2>/dev/null || true
}

# ---- Kill old server if running ---------------------------
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[BMS] Stopping old server (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 0.8
  fi
  rm -f "$PID_FILE"
fi

# ---- Build client if dist is missing ----------------------
if [ ! -d "$APP_DIR/client/dist" ] || [ "$APP_DIR/client/src/App.jsx" -nt "$APP_DIR/client/dist/index.html" ]; then
  echo "[BMS] Building client..."
  notify "Building client bundle..."
  cd "$APP_DIR/client" && npm run build --silent 2>>"$LOG_FILE"
  cd "$APP_DIR"
fi

# ---- Start Node.js server ---------------------------------
echo "[BMS] Starting server on port $SERVER_PORT..."
node "$APP_DIR/server.js" >> "$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > "$PID_FILE"

# ---- Wait for server to be ready (max 3s) -----------------
READY=false
for i in {1..10}; do
  if curl -sf "http://localhost:$SERVER_PORT" > /dev/null 2>&1; then
    READY=true
    break
  fi
  sleep 0.3
done

if [ "$READY" = false ]; then
  notify "❌ Server failed to start — check $LOG_FILE"
  echo "[BMS] Server did not respond in time. Logs: $LOG_FILE"
  exit 1
fi

echo "[BMS] Server ready on http://localhost:$SERVER_PORT"

# ---- ADB reverse tunnel -----------------------------------
if adb get-state 2>/dev/null | grep -q "device"; then
  if adb reverse tcp:$SERVER_PORT tcp:$SERVER_PORT 2>/dev/null; then
    echo "[BMS] ADB tunnel active — phone can reach server"
    notify "📱 Phone connected! Open http://localhost:$SERVER_PORT on phone"
  else
    echo "[BMS] ADB reverse failed"
    notify "⚠️ ADB tunnel failed — replug cable and retry"
  fi
else
  echo "[BMS] No ADB device found — connect phone via USB for mic"
  notify "📡 Server running — connect phone via USB for mic\nhttp://localhost:$SERVER_PORT"
fi

# ---- Open browser on PC -----------------------------------
xdg-open "http://localhost:$SERVER_PORT" &

echo "[BMS] Launcher done. Logs: $LOG_FILE"
