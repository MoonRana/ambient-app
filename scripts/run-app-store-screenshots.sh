#!/usr/bin/env bash
# Capture App Store screenshots on the booted iOS Simulator (demo data, no login).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW="$ROOT/store-screenshots/raw"
OUT="$ROOT/store-screenshots/ios-6.7"
PORT="${EXPO_PORT:-8083}"
EXP_HOST="${EXPO_HOST:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")}"
EXP_BASE="exp://${EXP_HOST}:${PORT}"

mkdir -p "$RAW" "$OUT"
rm -f "$RAW"/*.png "$OUT"/*.png 2>/dev/null || true

booted="$(xcrun simctl list devices booted | grep -oE '[A-F0-9-]{36}' | head -1 || true)"
if [ -z "$booted" ]; then
  echo "Boot iPhone 16 Pro Max in Simulator first."
  exit 1
fi

export EXPO_PUBLIC_SCREENSHOT_DEMO=1

# Start Metro with demo data (separate port to avoid prompts)
if ! curl -sf "http://127.0.0.1:${PORT}/status" >/dev/null 2>&1; then
  echo "Starting Expo on port ${PORT} (screenshot demo mode)..."
  (cd "$ROOT" && CI=1 EXPO_PUBLIC_SCREENSHOT_DEMO=1 npx expo start --port "$PORT" >/tmp/expo-screenshots.log 2>&1) &
  EXPO_PID=$!
  for _ in $(seq 1 60); do
    if curl -sf "http://127.0.0.1:${PORT}/status" >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi

EXPO_GO_BUNDLE="host.exp.Exponent"

open_app() {
  # Force a fresh navigation stack for each deep link
  xcrun simctl terminate booted "$EXPO_GO_BUNDLE" 2>/dev/null || true
  sleep 1
  xcrun simctl openurl booted "$1"
  sleep 7
}

capture_named() {
  local name="$1"
  local out="$RAW/${name}.png"
  xcrun simctl io booted screenshot "$out"
  echo "✓ ${name}.png"
}

echo "Opening app: ${EXP_BASE}"
open_app "$EXP_BASE"
sleep 8

# Parentheses in group segments must be URL-encoded for simctl openurl
R="$EXP_BASE/--"
declare -a ROUTES=(
  "01-inbox|${R}/(tabs)"
  "02-record|${R}/%28recording%29/record"
  "03-review|${R}/%28recording%29/review"
  "04-session-detail|${R}/session-detail?id=demo-completed-1"
  "05-history|${R}/(tabs)/history"
  "06-consult|${R}/(tabs)/consult"
  "07-freestyle|${R}/(tabs)/freestyle"
  "08-jobs|${R}/(tabs)/jobs"
  "09-settings|${R}/(tabs)/settings"
  "10-patient-info|${R}/%28recording%29/patient-info"
)

for entry in "${ROUTES[@]}"; do
  name="${entry%%|*}"
  url="${entry#*|}"
  open_app "$url"
  capture_named "$name"
done

cd "$ROOT"
npm run screenshots:resize

# Copy resized files with clean names
for f in "$ROOT/store-screenshots/ios-6.7"/*.png; do
  base="$(basename "$f")"
  # strip timestamp suffix if present; keep 01-inbox style names
  clean="$(echo "$base" | sed -E 's/-[0-9]{8}-[0-9]{6}\.png$/.png/')"
  if [ "$base" != "$clean" ]; then
    mv "$f" "$OUT/$clean"
  fi
done

echo ""
echo "Ready to upload: $OUT"
ls -la "$OUT"
