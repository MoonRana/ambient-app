#!/usr/bin/env bash
# Capture App Store screenshots on the booted iOS Simulator (demo data, no login).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW="$ROOT/store-screenshots/raw"
OUT_65="$ROOT/store-screenshots/ios-6.5"
OUT_67="$ROOT/store-screenshots/ios-6.7"

# Auto-detect running Metro, else default 8085
PORT="${EXPO_PORT:-}"
if [ -z "$PORT" ]; then
  for p in 8085 8084 8083 8081; do
    if curl -sf "http://127.0.0.1:${p}/status" >/dev/null 2>&1; then PORT=$p; break; fi
  done
  PORT="${PORT:-8085}"
fi

EXP_HOST="${EXPO_HOST:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")}"
EXP_BASE="exp://${EXP_HOST}:${PORT}"

mkdir -p "$RAW" "$OUT_65" "$OUT_67"
rm -f "$RAW"/*.png "$OUT_65"/*.png "$OUT_67"/*.png 2>/dev/null || true

booted="$(xcrun simctl list devices booted | grep -oE '[A-F0-9-]{36}' | head -1 || true)"
if [ -z "$booted" ]; then
  echo "Boot iPhone 16 Pro Max in Simulator first."
  exit 1
fi

export EXPO_PUBLIC_SCREENSHOT_DEMO=1

if ! curl -sf "http://127.0.0.1:${PORT}/status" >/dev/null 2>&1; then
  echo "Starting Expo on port ${PORT} (screenshot demo mode)..."
  (cd "$ROOT" && CI=1 EXPO_PUBLIC_SCREENSHOT_DEMO=1 npx expo start --port "$PORT" >/tmp/expo-screenshots.log 2>&1) &
  for _ in $(seq 1 90); do
    if curl -sf "http://127.0.0.1:${PORT}/status" >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi

EXPO_GO_BUNDLE="host.exp.Exponent"

open_app() {
  xcrun simctl terminate booted "$EXPO_GO_BUNDLE" 2>/dev/null || true
  sleep 1
  xcrun simctl openurl booted "$1"
  sleep 8
}

capture_named() {
  local name="$1"
  xcrun simctl io booted screenshot "$RAW/${name}.png"
  echo "✓ ${name}.png"
}

echo "Using Metro port ${PORT}"
echo "Opening app: ${EXP_BASE}"
open_app "$EXP_BASE"
sleep 6

R="$EXP_BASE/--"
# Core features first (Guideline 2.3.3). No login/splash/settings in primary set.
declare -a ROUTES=(
  "01-home|${R}/(tabs)"
  "02-record|${R}/(recording)/record"
  "03-session-detail|${R}/session-detail?id=demo-completed-1"
  "04-review|${R}/(recording)/review"
  "05-freestyle|${R}/(tabs)/freestyle"
  "06-consult|${R}/(tabs)/consult"
  "07-history|${R}/(tabs)/history"
  "08-patient-info|${R}/(recording)/patient-info"
)

for entry in "${ROUTES[@]}"; do
  name="${entry%%|*}"
  url="${entry#*|}"
  open_app "$url"
  capture_named "$name"
done

cd "$ROOT"
npm run screenshots:resize

echo ""
echo "Upload to App Store Connect → iPhone 6.5\" Display:"
echo "  $OUT_65"
ls -la "$OUT_65"
