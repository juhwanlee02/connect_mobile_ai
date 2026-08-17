#!/usr/bin/env bash
# Boot an iOS simulator for screenshots. Default: iPhone 17 Pro Max (captures at 1320×2868).
# Usage: ios-boot.sh ["Device Name"]
set -euo pipefail

DEVICE="${1:-iPhone 17 Pro Max}"

# Find an existing device with this name; create one if none exists.
UDID="$(xcrun simctl list devices available | grep -F "$DEVICE (" | head -1 | sed -E 's/.*\(([0-9A-F-]+)\).*/\1/' || true)"

if [[ -z "$UDID" ]]; then
  echo "No '$DEVICE' simulator found. Available iPhone runtimes/types:"
  xcrun simctl list devicetypes | grep -i iphone || true
  echo "Create one in Xcode > Window > Devices, or via 'xcrun simctl create'." >&2
  exit 1
fi

echo "Device: $DEVICE  UDID: $UDID"
STATE="$(xcrun simctl list devices | grep "$UDID" | grep -o 'Booted' || true)"
if [[ "$STATE" != "Booted" ]]; then
  xcrun simctl boot "$UDID"
fi
open -a Simulator
xcrun simctl bootstatus "$UDID" -b || true
echo "Booted. Run the app with:  flutter run -d $UDID"
echo "$UDID"
