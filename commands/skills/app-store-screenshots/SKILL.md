---
name: app-store-screenshots
description: Generate App Store / Google Play marketing screenshots for a Flutter app. Auto-detects the app's concept and color palette from the code, captures key screens on a simulator/emulator at exact store dimensions, frames each in a device mockup with a headline caption, and validates the output. Trigger when the user wants store screenshots, app preview images, marketing screenshots, or 스토어 소개 이미지 / 앱 스크린샷.
---

# App Store Screenshot Generator

Produce store-ready marketing screenshots for a Flutter app, sized exactly to App Store and
Google Play specs.

Visual style (decided for this skill):
- **iOS (iPhone & iPad)** → screenshot composed inside a **CSS-drawn modern device frame**
  (iPhone = Dynamic Island + thin uniform bezel; iPad = uniform bezel + front camera) on a
  brand-colored background with a headline. No image assets needed; renders pixel-exact.
- **Android** → **not captured separately.** Reuse the iOS iPhone captures and just reformat
  them to the Android store size (1080×1920) — raw screenshot + headline, no device frame
  (Google recommends unframed screenshots for Play Store listings). The android manifest block
  omits each slide's `screenshot`, inheriting the matching iOS capture by `out` filename (else by
  index). A Pixel-style CSS frame is also available — set `"frame": "android"` on the android block.
  Only set an explicit `screenshot` if you want a different image than the iOS capture.

This skill splits work between **scripts** (deterministic: capture, compose, validate) and
**you, the agent** (adaptive: understand the app, write captions, drive navigation).

## Output layout

```
deploy/screenshots/
├── raw/ios/        # native iPhone-simulator captures
├── raw/ipad/       # native iPad-simulator captures
├── ios/            # final framed App Store iPhone images (1320×2868)
├── ipad/           # final framed App Store iPad images (2064×2752)
└── android/        # final Play images (1080×1920, reformatted from the iPhone captures) + feature-graphic 1024×500
```

> **Android is not captured.** There is no `raw/android/` — the android images are generated from
> the iPhone captures in `raw/ios/`, just resized to the Play Store spec. No Android emulator needed.

> **Include the `ipad` block only if the app targets iPad.** Check `ios/Runner.xcodeproj` for
> `TARGETED_DEVICE_FAMILY`: `1` = iPhone only (skip iPad), `1,2` = universal (capture iPad too).

---

## Phase 1 — Analyze the app (you do this)

Read the codebase to derive concept, palette, screens, and captions. Do **not** hardcode;
read it fresh each run so the skill works on any Flutter app.

1. **Identity** — read `pubspec.yaml` → `name`, `description`, `version`.
2. **Palette + typography** — find the theme file (`lib/theme/*.dart`, or grep for
   `ColorScheme`, `seedColor`, `Color(0x`). Extract:
   - background, surface, primary/brand, accent, text colors → use for slide backgrounds & text.
   - font family (grep `fontFamily`, `google_fonts`, or `pubspec.yaml > fonts:`). If a custom
     TTF is bundled, note its path so captions can match the in-app font.
3. **Features → screens (do this feature-first, not screen-first)** — read the router
   (grep `GoRoute`, `MaterialPageRoute`, `routes:`) and `lib/pages/*` (or `screens/*`) and list
   the app's **distinct user-facing features**, not just whatever the home screen leads to.
   - Enumerate every route/flow and group them into features. A good signal: separate top-level
     flows or distinct verbs (e.g. a pet-diary app might have: 일기쓰기, 음성번역, 사진분석, 교환일기, 캘린더, 리포트).
   - **One hero slide per major feature** — make sure each headline feature is represented; don't
     over-index on one area (e.g. several "view your records" screens while voice/photo/exchange
     features are missing). Add 홈/overview as one slide, then one slide per feature.
   - For features whose payoff is on a *result* screen (voice translation result, photo analysis
     result), capture the result route with seeded data (e.g. `/voice/result?id=<seededActivityId>`),
     not just the empty entry screen — that's the "wow" the listing should sell.
   - Aim for ~5–7 slides covering the breadth of features.
4. **Captions** — for each hero slide write ONE short marketing headline (≤ ~14 chars in
   Korean, ≤ ~30 in English — longer wraps to two lines) in the app's language, plus an optional
   one-line subcaption. Captions name the *feature benefit*, not the UI ("쿠키 목소리 번역", not "음성 화면").
5. Write your findings into `deploy/screenshots/manifest.json` using
   `reference/manifest.example.json` as the shape. Blocks: `ios`, `ipad`, `android` (include
   only what the app targets). The compose script picks the frame per block automatically
   (`ios`→iphone, `ipad`→ipad, `android`→none); override per slide with a `"frame"` field.
   In the `android` block, **omit each slide's `screenshot`** and give it the same `out` filename
   as the iOS slide you want it to reuse — it inherits that iPhone capture, reformatted to 1080×1920.

Confirm the chosen screens, palette, and captions with the user before capturing.

## Phase 2 — Capture native screenshots (you drive, scripts help)

Goal: a clean PNG per hero screen at the device's **native** resolution. Seed believable
demo data first (a few realistic records / items / a profile name) so screens don't look empty.

### iOS — iPhone (required) and iPad (only if the app targets iPad)
- iPhone: `scripts/ios-boot.sh "iPhone 17 Pro Max"` — captures at exactly **1320×2868** (6.9").
- iPad:   `scripts/ios-boot.sh "iPad Pro 13-inch (M4)"` — captures at exactly **2064×2752**.
  (Each `ios-boot.sh` call prints the simulator UDID on its last line.)
- `flutter run -d <udid>` to launch the app on that simulator.
- Navigate to each hero screen, then capture (pass the UDID so the right sim is shot when both
  are booted): `scripts/shot.sh ios deploy/screenshots/raw/ios/01-home.png <iphone-udid>`
  and `scripts/shot.sh ios deploy/screenshots/raw/ipad/01-home.png <ipad-udid>`.
- **Navigation options**, best first:
  1. Deep links if the app supports them: `xcrun simctl openurl <udid> "<scheme>://<path>"`.
  2. Coordinate taps via `idb` (`brew install idb-companion && pipx install fb-idb`):
     `idb ui tap <x> <y>`. Read a fresh `shot.sh` capture to find tap targets.
  3. If neither is available, ask the user to tap through and tell you when each screen is ready.

### Android — do NOT capture
Skip the Android emulator entirely. The Android Play Store images are generated from the iPhone
captures (`raw/ios/*.png`), reformatted to 1080×1920 by the compose step. Booting an emulator and
rebuilding the app for Android is slow and unnecessary — the marketing slides only show the
screenshot inside a caption/card, so the iOS capture serves both stores.

After capturing, `raw/ios` files should be 1320×2868 and `raw/ipad` files 2064×2752. The compose
step reads the iPhone captures for the android block and rescales them to 1080×1920.

> If you ever *do* want genuine Android UI (e.g. to show Material chrome), boot an AVD
> (`scripts/android-boot.sh`), `flutter run -d emulator-5554`, capture with
> `scripts/shot.sh android <out>` (taps via `adb shell input tap <x> <y>`), and set an explicit
> `screenshot` on the android slides. This is opt-in, not the default.

**Free resources as you go.** Simulators/emulators are heavy (CPU/RAM). The moment a device's
captures are saved, shut it down before moving on — don't leave several booted at once:
- iOS: `xcrun simctl shutdown <udid>` (capture iPhone → shut it down → capture iPad → shut it down).
- Android: `adb -s emulator-5554 emu kill`.
Tip: a clean status bar makes nicer shots — `xcrun simctl status_bar <udid> override --time "9:41"
--batteryState charged --batteryLevel 100 --wifiBars 3` before capturing.

**Remove the mouse cursor (iOS/iPad).** When the host pointer is over the Simulator, iOS/iPadOS
renders its own pointer into the framebuffer, so `simctl screenshot` captures it. Before every iOS
screenshot, warp the host cursor far off the Simulator window so the on-device pointer disappears:
`xcrun swift -e 'import CoreGraphics; CGWarpMouseCursorPosition(CGPoint(x: 5000, y: 5000))'`
(`scripts/shot.sh ios` does this automatically). Android `adb screencap` does not include the host
cursor, so no action is needed there.

## Phase 3 — Compose framed marketing images (script)

```
node scripts/compose.mjs deploy/screenshots/manifest.json
```

For each slide the script renders the matching template at the **exact** store pixel size with a
headless browser, writing PNGs to `ios/`, `ipad/`, `android/`:
- `templates/device.html` — iPhone/iPad CSS frame + caption (frame `iphone` / `ipad`).
- `templates/flat.html` — raw screenshot + caption, no frame (frame `none`, used for Android).
- `templates/feature-graphic.html` — the 1024×500 Play feature graphic.

- Needs only Node + a Chromium engine. The script auto-detects: it uses Playwright if installed,
  otherwise falls back to **system Google Chrome / Chromium / Edge** in headless mode (no install
  needed). Set `CHROME_PATH` to override the browser. Output is identical (both are Chromium).
- For Google Play, also produce the **feature graphic** (1024×500): add a `featureGraphic` block
  to the `android` manifest block.
- Tip: keep headlines short or they wrap to two lines — verify a sample render and adjust copy.

## Phase 4 — Validate (script)

```
scripts/validate.sh deploy/screenshots/ios     1320 2868
scripts/validate.sh deploy/screenshots/ipad    2064 2752
scripts/validate.sh deploy/screenshots/android 1080 1920
```

Confirms every PNG is the exact pixel size (App Store rejects 1px-off images), RGB, and that
iOS images have **no alpha channel**. The script flattens alpha if found. Report the final
list of files and their sizes to the user.

## Phase 5 — Clean up (always do this at the end)

Compose runs in a headless browser, so **no simulator/emulator needs to stay open** for it.
Once captures are done (or if anything fails), release resources and undo temporary changes:

1. Shut down every device you booted:
   - `xcrun simctl shutdown all` (or each `<udid>`). (No Android emulator is booted by default.)
   - Kill any lingering `flutter run` you started.
2. Revert the screenshot shim: if you added a `--dart-define=SEED` block / route injection or any
   demo-seed edit to `lib/`, remove it so the app builds normally. Restore the original
   `initialLocation` and delete the seed constant.
3. Reset the simulator status bar override if you set one: `xcrun simctl status_bar <udid> clear`.

---

## Specs quick reference
See `reference/store-specs.md`. Key numbers:
- **iOS** iPhone 6.9": 1320×2868 (required). iPad 13": 2064×2752 (if iPad supported). 1–10 per device, PNG/JPEG, **no alpha**.
- **Android** phone: 1080×1920, 2–8 shots. Feature graphic 1024×500 (required). Icon 512×512.

## Notes
- Keep captions in the app's own language and tone; match the in-app font when possible.
- `.claude/skills/...` may be a protected path; if writes are blocked, that's a sandbox
  restriction — rerun the write without the sandbox.
- This skill modifies nothing in `lib/` except optional temporary demo-data seeding; revert any
  seed changes when done.
