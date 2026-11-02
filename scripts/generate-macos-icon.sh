#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
work=$(mktemp -d "${RUNNER_TEMP:-$HOME/scratch}/gyroid-icon.XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir "$work/gyroid.iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" src/Gyroid/assets/gyroid.png --out "$work/gyroid.iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" src/Gyroid/assets/gyroid.png --out "$work/gyroid.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$work/gyroid.iconset" -o src/Gyroid/assets/gyroid.icns
