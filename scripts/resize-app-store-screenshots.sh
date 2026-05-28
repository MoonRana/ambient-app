#!/usr/bin/env bash
# Resize raw iOS simulator screenshots to App Store Connect dimensions.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW="$ROOT/store-screenshots/raw"
OUT_67="$ROOT/store-screenshots/ios-6.7"
OUT_65="$ROOT/store-screenshots/ios-6.5"

# App Store Connect accepted sizes (portrait: height x width for sips -z)
H_67=2778
W_67=1284
H_65=2688
W_65=1242

mkdir -p "$RAW" "$OUT_67" "$OUT_65"

shopt -s nullglob
files=("$RAW"/*.png "$RAW"/*.PNG)
if [ ${#files[@]} -eq 0 ]; then
  echo "No PNG files in $RAW"
  echo "Capture screenshots first (Simulator ⌘S or: npm run screenshots:capture -- my-screen)"
  exit 1
fi

for src in "${files[@]}"; do
  base="$(basename "$src")"
  name="${base%.*}"

  dest67="$OUT_67/$name.png"
  dest65="$OUT_65/$name.png"

  cp "$src" "$dest67"
  sips -z "$H_67" "$W_67" "$dest67" >/dev/null

  cp "$src" "$dest65"
  sips -z "$H_65" "$W_65" "$dest65" >/dev/null

  w67=$(sips -g pixelWidth "$dest67" | awk '/pixelWidth/{print $2}')
  h67=$(sips -g pixelHeight "$dest67" | awk '/pixelHeight/{print $2}')
  echo "✓ $name → ios-6.7/${name}.png (${w67}×${h67})"
done

echo ""
echo "Upload PNGs from: $OUT_67"
echo "Optional 6.5\" set: $OUT_65"
