#!/usr/bin/env bash
# Capture one screenshot from the booted iOS Simulator (or named device).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW="$ROOT/store-screenshots/raw"
mkdir -p "$RAW"

label="${1:-screenshot}"
# safe filename: lowercase, spaces → dashes
slug="$(echo "$label" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-_')"
stamp="$(date +%Y%m%d-%H%M%S)"
out="$RAW/${slug}-${stamp}.png"

booted="$(xcrun simctl list devices booted | grep -oE '[A-F0-9-]{36}' | head -1 || true)"
if [ -z "$booted" ]; then
  echo "No booted simulator. Open Simulator and boot iPhone 16 Pro Max (or run: open -a Simulator)"
  exit 1
fi

xcrun simctl io "$booted" screenshot "$out"
w=$(sips -g pixelWidth "$out" | awk '/pixelWidth/{print $2}')
h=$(sips -g pixelHeight "$out" | awk '/pixelHeight/{print $2}')
echo "Saved $out (${w}×${h})"
echo "Run: npm run screenshots:resize"
