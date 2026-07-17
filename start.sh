#!/bin/bash
# ============================================================
# Black Mic Studio — Smart Launcher
# ============================================================
# Handles: server lifecycle, ADB tunnel, notifications,
# build check, and browser open. Safe to run multiple times.
# ============================================================

set -uo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVER_PORT="${PORT:-3001}"
LOG_FILE="$APP_DIR/.server.log"
PID_FILE="$APP_DIR/.server.pid"
ICON="$APP_DIR/icon.png"

cd "$APP_DIR"

PROTOCOL="http"
CURL_TLS_ARGS=()
if [ -f "$APP_DIR/server.key" ] && [ -f "$APP_DIR/server.cert" ]; then
  PROTOCOL="https"
  CURL_TLS_ARGS=(-k)
fi
SERVER_URL="$PROTOCOL://localhost:$SERVER_PORT"

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

# ---- Clean up old virtual sinks if any ---------------------
echo "[BMS] Cleaning up old virtual audio sinks..."
pactl list short modules 2>/dev/null | grep "BMS_" | awk '{print $1}' | while read -r mod_id; do
  pactl unload-module "$mod_id" 2>/dev/null || true
done


# ---- Build client if dist is missing or any src file is newer ------
NEEDS_BUILD=false
if [ ! -d "$APP_DIR/client/dist" ]; then
  NEEDS_BUILD=true
elif find "$APP_DIR/client/src" "$APP_DIR/client/public" -newer "$APP_DIR/client/dist/index.html" -print -quit 2>/dev/null | grep -q .; then
  NEEDS_BUILD=true
fi
if [ "$NEEDS_BUILD" = true ]; then
  echo "[BMS] Building client (source changed)..."
  notify "Building client bundle..."
  cd "$APP_DIR/client" && npm run build --silent 2>>"$LOG_FILE"
  cd "$APP_DIR"
fi

# ---- Start Node.js server ---------------------------------
SERVER_PID=""
if curl "${CURL_TLS_ARGS[@]}" -sf "$SERVER_URL" > /dev/null 2>&1; then
  echo "[BMS] Server already responding on port $SERVER_PORT; reusing it."
else
  echo "[BMS] Starting server on port $SERVER_PORT..."
  setsid node "$APP_DIR/server.js" >> "$LOG_FILE" 2>&1 < /dev/null &
  SERVER_PID=$!
  echo $SERVER_PID > "$PID_FILE"
fi

# ---- Wait for server to be ready (max 3s) -----------------
READY=false
for i in {1..10}; do
  if curl "${CURL_TLS_ARGS[@]}" -sf "$SERVER_URL" > /dev/null 2>&1; then
    READY=true
    break
  fi
  if [ -n "$SERVER_PID" ] && ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break
  fi
  sleep 0.3
done

if [ "$READY" = false ]; then
  rm -f "$PID_FILE"
  notify "❌ Server failed to start — check $LOG_FILE"
  echo "[BMS] Server did not respond in time. Logs: $LOG_FILE"
  exit 1
fi

if [ -n "$SERVER_PID" ] && ! kill -0 "$SERVER_PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "[BMS] Server is ready on port $SERVER_PORT, but it was not started by this launcher."
fi

echo "[BMS] Server ready on $SERVER_URL"

# ---- ADB reverse tunnel -----------------------------------
if adb get-state 2>/dev/null | grep -q "device"; then
  if adb reverse tcp:$SERVER_PORT tcp:$SERVER_PORT 2>/dev/null; then
    echo "[BMS] ADB tunnel active — phone can reach server"
    notify "📱 Phone connected! Open $SERVER_URL on phone"
  else
    echo "[BMS] ADB reverse failed"
    notify "⚠️ ADB tunnel failed — replug cable and retry"
  fi
else
  echo "[BMS] No ADB device found — connect phone via USB for mic"
  notify "📡 Server running — connect phone via USB for mic\n$SERVER_URL"
fi

# ---- Open browser on PC -----------------------------------
xdg-open "$SERVER_URL" &

echo "[BMS] Launcher done. Logs: $LOG_FILE"
