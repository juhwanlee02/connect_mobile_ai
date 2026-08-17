#!/usr/bin/env bash
# Capture a native screenshot from the booted simulator/emulator.
# Usage: shot.sh <ios|android> <output.png> [udid]
#   udid (ios only) targets a specific simulator when several are booted
#   (e.g. iPhone + iPad). Defaults to "booted" (most recently booted).
set -euo pipefail

PLATFORM="${1:?usage: shot.sh <ios|android> <output.png> [udid]}"
OUT="${2:?output path required}"
TARGET="${3:-booted}"
mkdir -p "$(dirname "$OUT")"

case "$PLATFORM" in
  ios)
    # Warp the host cursor off-screen so iOS/iPadOS doesn't render its pointer into the capture.
    xcrun swift -e 'import CoreGraphics; CGWarpMouseCursorPosition(CGPoint(x: 5000, y: 5000))' 2>/dev/null || true
    sleep 1
    xcrun simctl io "$TARGET" screenshot "$OUT"
    ;;
  android)
    adb exec-out screencap -p > "$OUT"
    ;;
  *)
    echo "unknown platform: $PLATFORM (use ios or android)" >&2
    exit 1
    ;;
esac

# Report dimensions.
if command -v sips >/dev/null 2>&1; then
  W=$(sips -g pixelWidth "$OUT" | awk '/pixelWidth/{print $2}')
  H=$(sips -g pixelHeight "$OUT" | awk '/pixelHeight/{print $2}')
  echo "saved $OUT  (${W}×${H})"
else
  echo "saved $OUT"
fi
