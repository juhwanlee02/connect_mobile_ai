#!/usr/bin/env bash
# Boot an Android emulator and wait until it is ready.
# Usage: android-boot.sh [avd_name]
set -euo pipefail

AVD="${1:-}"
if [[ -z "$AVD" ]]; then
  AVD="$(emulator -list-avds | head -1 || true)"
fi
if [[ -z "$AVD" ]]; then
  echo "No AVD found. Create one in Android Studio > Device Manager." >&2
  echo "Available:"; emulator -list-avds || true
  exit 1
fi

echo "Starting AVD: $AVD"
# Launch detached if not already running.
if ! adb devices | grep -q emulator; then
  nohup emulator -avd "$AVD" -netdelay none -netspeed full >/dev/null 2>&1 &
fi

echo "Waiting for device..."
adb wait-for-device
# Wait for full boot.
until [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; do
  sleep 2
done
adb shell input keyevent 82 >/dev/null 2>&1 || true   # dismiss lock screen
echo "Emulator ready. Run the app with:  flutter run -d emulator-5554"
