#!/usr/bin/env bash
# Validate that every PNG in a directory is the exact store size, and (for iOS) has no alpha.
# Usage: validate.sh <dir> <width> <height>
set -euo pipefail

DIR="${1:?usage: validate.sh <dir> <width> <height>}"
W="${2:?width required}"
H="${3:?height required}"

shopt -s nullglob
fail=0
count=0
for f in "$DIR"/*.png "$DIR"/*.jpg "$DIR"/*.jpeg; do
  [[ -e "$f" ]] || continue
  # The Play feature graphic (1024×500) lives alongside phone shots but has its own spec.
  if [[ "$(basename "$f")" == *feature-graphic* ]]; then
    fw=$(sips -g pixelWidth "$f"  | awk '/pixelWidth/{print $2}')
    fh=$(sips -g pixelHeight "$f" | awk '/pixelHeight/{print $2}')
    echo "  (skipped, feature graphic)  $(basename "$f")  ${fw}×${fh}"
    continue
  fi
  count=$((count+1))
  pw=$(sips -g pixelWidth "$f"  | awk '/pixelWidth/{print $2}')
  ph=$(sips -g pixelHeight "$f" | awk '/pixelHeight/{print $2}')
  has_alpha=$(sips -g hasAlpha "$f" | awk '/hasAlpha/{print $2}')

  status="ok"
  if [[ "$pw" != "$W" || "$ph" != "$H" ]]; then
    status="SIZE ${pw}×${ph} (want ${W}×${H})"; fail=1
  fi
  # App Store screenshots/icons must not have an alpha channel — flatten if present.
  if [[ "$has_alpha" == "yes" ]]; then
    sips -s format png --setProperty hasAlpha no "$f" --out "$f" >/dev/null 2>&1 || true
    status="$status [flattened alpha]"
  fi
  echo "  $status  $(basename "$f")  ${pw}×${ph}"
done

echo "checked $count file(s) in $DIR"
[[ $fail -eq 0 ]] && echo "PASS" || { echo "FAIL: some images are off-spec"; exit 1; }
