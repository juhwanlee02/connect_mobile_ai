#!/usr/bin/env node
// Render a plain HTML file (e.g. an inline-SVG app icon wrapper) to an
// exact-size PNG with headless Chrome/Chromium — the same engine and flags as
// compose.mjs, but without the manifest layer (icons and the feature graphic
// are single files, not slide sets). Used by /pipeline-release for the
// Play 512 / App Store 1024 icons and the 1024×500 feature graphic.
//
// Usage: node render-icon.mjs <in.html> <out.png> <width> [height]
//   (height defaults to width — square icon)
// Exit codes: 0 = ok (prints "OK <w>x<h> colorType=<n> <out.png>")
//             1 = usage / render / size-verification error
//             2 = no Chromium found (caller falls back to placeholder icon)
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const [inHtml, outPng, wArg, hArg] = process.argv.slice(2);
const w = Number(wArg);
const h = Number(hArg ?? wArg);
if (!inHtml || !outPng || !Number.isInteger(w) || w <= 0 || !Number.isInteger(h) || h <= 0) {
  console.error("usage: node render-icon.mjs <in.html> <out.png> <width> [height]");
  process.exit(1);
}
if (!existsSync(resolve(inHtml))) {
  console.error(`input html not found: ${inHtml}`);
  process.exit(1);
}

// Same candidate list as compose.mjs findChrome() — cross-OS, no macOS-only
// tools (sips is deliberately not used anywhere in this pipeline).
const chrome = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
]
  .filter(Boolean)
  .find((c) => {
    try {
      return existsSync(c);
    } catch {
      return false;
    }
  });
if (!chrome) {
  console.error("NO_CHROMIUM: install Google Chrome/Chromium or set CHROME_PATH");
  process.exit(2);
}

execFileSync(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${w},${h}`,
    `--screenshot=${resolve(outPng)}`,
    `file://${resolve(inHtml)}`,
  ],
  { stdio: "ignore" }
);

// Verify the PNG header so the caller gets a machine-checkable confirmation
// (store specs are exact-size: 512×512 / 1024×1024 / 1024×500).
const buf = readFileSync(resolve(outPng));
const isPng =
  buf.length > 25 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a;
if (!isPng) {
  console.error(`not a PNG: ${outPng}`);
  process.exit(1);
}
const width = buf.readUInt32BE(16);
const height = buf.readUInt32BE(20);
const colorType = buf.readUInt8(25); // 2 = RGB (no alpha channel), 6 = RGBA
if (width !== w || height !== h) {
  console.error(`SIZE_MISMATCH: expected ${w}x${h}, got ${width}x${height}`);
  process.exit(1);
}
console.log(`OK ${width}x${height} colorType=${colorType} ${outPng}`);
