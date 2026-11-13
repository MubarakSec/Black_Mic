#!/bin/bash
# ============================================================
# Black Mic Studio — USB-first Smart Launcher
# ============================================================
# Default mode: USB. The server binds localhost only, and the
# phone reaches it through `adb reverse` — the phone browser then
# treats the page as localhost (secure context), so the mic works
# without HTTPS certificates. Pass --lan to expose on the network.
#
# Usage:
#   ./start.sh              USB mode (localhost + adb reverse)
#   ./start.sh --lan        expose on LAN (HTTPS strongly recommended)
#   ./start.sh --unreverse  remove the adb reverse tunnel and exit
#   ./start.sh --help       show this help
#
# Env: PORT (default 3001), BMS_HOST (explicit bind address override)
# ============================================================

set -uo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVER_PORT="${PORT:-3001}"
LOG_FILE="$APP_DIR/.server.log"
PID_FILE="$APP_DIR/.server.pid"
ICON="$APP_DIR/icon.png"

# ---- Flags -------------------------------------------------
USB_MODE=true
UNREVERSE=false
usage() {
  sed -n '2,18p' "${BASH_SOURCE[0]}"
  exit 0
}
while [ $# -gt 0 ]; do
  case "$1" in
    --lan) USB_MODE=false ;;
    --unreverse) UNREVERSE=true ;;
    -h|--help) usage ;;
    *) echo "[BMS] Unknown option: $1 (try --help)"; exit 2 ;;
  esac
  shift
done

# ---- Health log rotation (keep last ~1 MB) ------------------
if [ -f "$LOG_FILE" ] && [ "$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)" -gt 1048576 ]; then
  tail -c 1048576 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
  echo "[BMS] Rotated .server.log to last 1 MB."
fi

# ---- ADB reverse removal (standalone mode) ------------------
if [ "$UNREVERSE" = true ]; then
  if ! command -v adb > /dev/null 2>&1; then
    echo "[BMS] adb not found — nothing to reverse."
    exit 0
  fi
  adb devices | awk 'NR>1 && $2=="device" {print $1}' | while read -r serial; do
    adb -s "$serial" reverse --remove "tcp:$SERVER_PORT" 2>/dev/null \
      && echo "[BMS] Removed reverse tunnel on $serial (tcp:$SERVER_PORT)" \
      || echo "[BMS] No reverse tunnel to remove on $serial"
  done
  exit 0
fi

cd "$APP_DIR"

# ---- Bind address: localhost-only in USB mode ----------------
if [ "$USB_MODE" = true ]; then
  export BMS_HOST="${BMS_HOST:-127.0.0.1}"
else
  export BMS_HOST="${BMS_HOST:-0.0.0.0}"
fi

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

is_black_mic_pid() {
  local candidate_pid="$1"
  [[ "$candidate_pid" =~ ^[0-9]+$ ]] || return 1
  [ -r "/proc/$candidate_pid/cmdline" ] || return 1
  tr '\0' ' ' < "/proc/$candidate_pid/cmdline" | grep -Fq "$APP_DIR/server.js"
}

# ---- Kill old server if running ---------------------------
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null && is_black_mic_pid "$OLD_PID"; then
    echo "[BMS] Stopping old server (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 0.8
  fi
  if kill -0 "$OLD_PID" 2>/dev/null && ! is_black_mic_pid "$OLD_PID"; then
    echo "[BMS] Ignoring stale PID file; PID $OLD_PID belongs to another process."
  fi
  rm -f "$PID_FILE"
fi

# ---- Preflight dependency check ----------------------------
if ! command -v node > /dev/null 2>&1; then
  echo "[BMS] ERROR: node is not installed or not on PATH."
  notify "❌ Node.js is required — https://nodejs.org"
  exit 1
fi
if ! command -v pactl > /dev/null 2>&1; then
  echo "[BMS] ERROR: pactl not found. Install PulseAudio/PipeWire-pulse utilities (e.g. 'sudo apt install pulseaudio-utils')."
  notify "❌ pactl missing — install pulseaudio-utils"
  exit 1
fi
if ! command -v pw-link > /dev/null 2>&1; then
  echo "[BMS] Warning: pw-link not found — EasyEffects auto-routing will be unavailable."
fi
if [ "$USB_MODE" = true ] && ! command -v adb > /dev/null 2>&1; then
  echo "[BMS] ERROR: USB mode needs adb (Android Debug Bridge)."
  echo "[BMS]        Install it (e.g. 'sudo apt install android-tools-adb'), or run './start.sh --lan' to expose on your network instead."
  notify "❌ adb missing — install android-tools-adb"
  exit 1
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
  if ! (cd "$APP_DIR/client" && npm run build --silent 2>>"$LOG_FILE"); then
    notify "❌ Client build failed — check $LOG_FILE"
    echo "[BMS] Client build failed. Logs: $LOG_FILE"
    exit 1
  fi
  cd "$APP_DIR"
fi

# ---- Start Node.js server ---------------------------------
SERVER_PID=""
if curl "${CURL_TLS_ARGS[@]}" -sf "$SERVER_URL" > /dev/null 2>&1; then
  echo "[BMS] Server already responding on port $SERVER_PORT; reusing it."
else
  echo "[BMS] Starting server on $BMS_HOST:$SERVER_PORT ($([ "$USB_MODE" = true ] && echo 'USB/localhost-only' || echo 'LAN-exposed'))..."
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
if [ "$USB_MODE" = false ]; then
  LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo "[BMS] Phone URL on your network: $PROTOCOL://${LAN_IP:-<lan-ip>}:$SERVER_PORT"
  if [ "$PROTOCOL" = "http" ]; then
    echo "[BMS] WARNING: LAN mode over plain HTTP — phone microphone requires HTTPS or localhost."
    echo "[BMS]          The phone will not get mic permission. Use USB mode or install server.key/server.cert."
    notify "⚠️ LAN mode without HTTPS — phone mic will fail. Prefer USB."
  fi
fi

# ---- ADB reverse tunnel (USB mode) -------------------------
adb_reverse_for_each_device() {
  local count_ok=0
  local count_fail=0
  while read -r serial; do
    [ -z "$serial" ] && continue
    if adb -s "$serial" reverse "tcp:$SERVER_PORT" "tcp:$SERVER_PORT" > /dev/null 2>&1; then
      count_ok=$((count_ok + 1))
      echo "[BMS] ADB reverse active: $serial tcp:$SERVER_PORT -> tcp:$SERVER_PORT"
    else
      count_fail=$((count_fail + 1))
      echo "[BMS] ADB reverse failed for $serial — is USB debugging authorized?"
    fi
  done < <(adb devices | awk 'NR>1 && $2=="device" {print $1}')
  if [ "$count_ok" -gt 0 ]; then
    notify "📱 Phone ready! Open $SERVER_URL on your phone"
  elif [ "$count_fail" -gt 0 ]; then
    notify "⚠️ USB attached but reverse failed — accept the USB debugging prompt"
  else
    unauthorized=$(adb devices | awk 'NR>1 && $2=="unauthorized" {print $1}')
    if [ -n "$unauthorized" ]; then
      echo "[BMS] Phone connected but UNAUTHORIZED. Check the phone and tap 'Allow USB debugging'."
      notify "⚠️ Unauthorized device — accept the USB debugging prompt on the phone"
    else
      echo "[BMS] No phone detected over USB."
      echo "[BMS]   1. Plug the phone in via USB"
      echo "[BMS]   2. Enable Developer Options → USB debugging"
      echo "[BMS]   3. Accept the 'Allow USB debugging' popup on the phone"
      echo "[BMS]   4. Re-run ./start.sh (or just: adb reverse tcp:$SERVER_PORT tcp:$SERVER_PORT)"
      notify "📡 No phone — plug in, enable USB debugging, re-run ./start.sh"
    fi
  fi
}

if [ "$USB_MODE" = true ]; then
  adb_reverse_for_each_device
else
  if adb get-state 2>/dev/null | grep -q "device"; then
    if adb reverse "tcp:$SERVER_PORT" "tcp:$SERVER_PORT" 2>/dev/null; then
      echo "[BMS] ADB tunnel active — phone can also reach the server over USB"
    fi
  fi
fi

# ---- Open browser on PC -----------------------------------
xdg-open "$SERVER_URL" &

echo "[BMS] Launcher done. Logs: $LOG_FILE"
echo "[BMS] Phone (USB): open $SERVER_URL in the phone's browser after plugging in."
echo "[BMS] Remove tunnel later with: ./start.sh --unreverse"
