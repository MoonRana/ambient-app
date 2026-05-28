#!/usr/bin/env bash
# Resize manual Simulator screenshots to App Store sizes and rename by screen.
# Does NOT delete source Simulator*.png files until copies succeed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW="$ROOT/store-screenshots/raw"
OUT_65="$ROOT/store-screenshots/ios-6.5"
OUT_67="$ROOT/store-screenshots/ios-6.7"
SRC_DIR="$ROOT/store-screenshots/ios-6.7"

mkdir -p "$RAW" "$OUT_65" "$OUT_67"

slug_for() {
  case "$1" in
    *01.56.14*) echo "02-freestyle" ;;
    *01.56.18*) echo "03-consult" ;;
    *01.56.21*) echo "04-settings" ;;
    *01.56.25*) echo "05-session-detail" ;;
    *01.56.28*) echo "06-record" ;;
    *01.57.30*) echo "" ;; # duplicate freestyle — skip
    *) echo "" ;;
  esac
}

shopt -s nullglob
sources=("$SRC_DIR"/Simulator*.png)
if [ ${#sources[@]} -eq 0 ]; then
  echo "Place Simulator screenshots in: $SRC_DIR"
  echo "  (File → Save Screen in Simulator, or drag PNGs into that folder)"
  exit 1
fi

rm -f "$RAW"/*.png "$OUT_65"/[0-9]*.png "$OUT_67"/[0-9]*.png 2>/dev/null || true

for f in "${sources[@]}"; do
  slug=$(slug_for "$(basename "$f")")
  [ -z "$slug" ] && { echo "skip $(basename "$f")"; continue; }
  cp "$f" "$RAW/${slug}.png"
  echo "copied → raw/${slug}.png"
done

H_67=2778; W_67=1284
H_65=2688; W_65=1242

for src in "$RAW"/[0-9]*.png; do
  [ -f "$src" ] || continue
  name=$(basename "$src")
  cp "$src" "$OUT_67/$name"
  sips -z "$H_67" "$W_67" "$OUT_67/$name" >/dev/null
  cp "$src" "$OUT_65/$name"
  sips -z "$H_65" "$W_65" "$OUT_65/$name" >/dev/null
  w=$(sips -g pixelWidth "$OUT_65/$name" | awk '/pixelWidth/{print $2}')
  h=$(sips -g pixelHeight "$OUT_65/$name" | awk '/pixelHeight/{print $2}')
  echo "✓ $name → 6.5: ${w}×${h}, 6.7: 1284×2778"
done

echo ""
echo "Upload ios-6.5/*.png → App Store Connect → iPhone 6.5\" Display"
echo "Upload ios-6.7/*.png → iPhone 6.7\" Display (optional if 6.5 filled)"
echo "Still need: 01-inbox.png (Home tab) — capture and add to $SRC_DIR, update slug_for in this script"
