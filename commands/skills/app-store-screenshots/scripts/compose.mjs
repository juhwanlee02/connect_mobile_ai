#!/usr/bin/env node
// Compose framed marketing screenshots from a manifest.
// Usage: node compose.mjs <manifest.json>
// Renders templates/frame.html (and feature-graphic.html) at exact store pixel sizes.

import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(__dirname, "..");
const TEMPLATES = resolve(skillDir, "templates");

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error("usage: node compose.mjs <manifest.json>");
  process.exit(1);
}
// Resolve paths relative to the directory you run the command from (project root).
const cwd = process.cwd();
const abs = (p) => (isAbsolute(p) ? p : resolve(cwd, p));

const manifest = JSON.parse(readFileSync(abs(manifestPath), "utf8"));
const palette = manifest.palette ?? {};
const font = manifest.font ?? {};

function fontFace() {
  if (!font.src) return "";
  const src = abs(font.src);
  if (!existsSync(src)) {
    console.warn(`  ! font not found, skipping @font-face: ${src}`);
    return "";
  }
  return `@font-face { font-family: "${font.family}"; src: url("file://${src}"); }`;
}

function fill(tpl, slide) {
  const map = {
    "{{BG1}}": palette.bg1 ?? "#FFFFFF",
    "{{BG2}}": palette.bg2 ?? palette.bg1 ?? "#F2F2F2",
    "{{INK}}": palette.ink ?? "#222222",
    "{{SUB}}": palette.sub ?? "#888888",
    "{{ACCENT}}": palette.accent ?? palette.ink ?? "#222222",
    "{{FONT_FAMILY}}": font.family ? `"${font.family}"` : "sans-serif",
    "{{FONT_FACE}}": fontFace(),
    "{{HEADLINE}}": slide.headline ?? "",
    "{{DEVICE}}": slide.frame === "ipad" ? "ipad" : slide.frame === "android" ? "android" : "iphone",
    // {{SUB}} token in body is the subcaption text; palette sub color uses the same token in CSS,
    // so the body subcaption uses a distinct token:
    "{{SCREENSHOT}}": slide.screenshot ? `file://${abs(slide.screenshot)}` : "",
  };
  let out = tpl;
  // subcaption text token must be replaced before the CSS color {{SUB}} — use a dedicated token.
  out = out.replaceAll("{{SUBTEXT}}", slide.sub ?? "");
  for (const [k, v] of Object.entries(map)) out = out.replaceAll(k, v);
  return out;
}

// ---- Rendering engines -----------------------------------------------------
// Prefer Playwright if installed; otherwise fall back to a system Chrome/Chromium
// in headless mode (no npm install needed). Both use Chromium so output matches.

import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

async function tryPlaywright() {
  try {
    const { chromium } = await import("playwright");
    return chromium;
  } catch {
    try {
      const { chromium } = await import("playwright-core");
      return chromium;
    } catch {
      return null;
    }
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch {}
  }
  return null;
}

async function makeRenderer() {
  const chromium = await tryPlaywright();
  if (chromium) {
    const browser = await chromium.launch();
    return {
      async render(tpl, size, slide, outPath) {
        const page = await browser.newPage({
          viewport: { width: size.w, height: size.h },
          deviceScaleFactor: 1,
        });
        await page.setContent(fill(tpl, slide), { waitUntil: "networkidle" });
        await page.screenshot({
          path: outPath,
          clip: { x: 0, y: 0, width: size.w, height: size.h },
        });
        await page.close();
      },
      async close() {
        await browser.close();
      },
    };
  }

  const chrome = findChrome();
  if (!chrome) {
    console.error(
      "No renderer found. Install Playwright (npm i -D playwright && npx playwright install chromium)\n" +
        "or Google Chrome/Chromium, or set CHROME_PATH."
    );
    process.exit(1);
  }
  console.log(`(using system Chrome: ${chrome})`);
  return {
    async render(tpl, size, slide, outPath) {
      const htmlPath = resolve(tmpdir(), `compose-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
      writeFileSync(htmlPath, fill(tpl, slide));
      execFileSync(
        chrome,
        [
          "--headless=new",
          "--disable-gpu",
          "--hide-scrollbars",
          "--force-device-scale-factor=1",
          `--window-size=${size.w},${size.h}`,
          `--screenshot=${outPath}`,
          `file://${htmlPath}`,
        ],
        { stdio: "ignore" }
      );
    },
    async close() {},
  };
}

// Map a `frame` value to its template. iphone/ipad => CSS device mockup; otherwise a flat
// "raw screenshot + caption" card (the recommended style for Google Play listings).
const _tplCache = {};
function template(name) {
  if (!_tplCache[name]) _tplCache[name] = readFileSync(resolve(TEMPLATES, `${name}.html`), "utf8");
  return _tplCache[name];
}
function templateFor(frame) {
  return frame === "iphone" || frame === "ipad" || frame === "android"
    ? template("device")
    : template("flat");
}

async function renderBlock(renderer, size, slides, outDir, defaultFrame, inheritSlides) {
  mkdirSync(abs(outDir), { recursive: true });
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const frame = slide.frame ?? defaultFrame ?? "none";
    // Android reuses the iOS capture: if no screenshot is given, inherit the
    // matching iOS slide's screenshot (by `out` filename, else by index).
    let screenshot = slide.screenshot;
    if (!screenshot && inheritSlides) {
      const src =
        inheritSlides.find((x) => x.out === slide.out) ?? inheritSlides[i];
      screenshot = src?.screenshot;
      if (screenshot) console.log(`    ↳ reusing iOS capture: ${screenshot}`);
    }
    const s = { ...slide, frame, screenshot };
    const outPath = resolve(abs(outDir), slide.out);
    await renderer.render(templateFor(frame), size, s, outPath);
    console.log(`  ✓ ${outPath}  [${frame}]`);
  }
}

const renderer = await makeRenderer();

// Each block: { size, out, slides, frame? }. frame default per platform below.
const blocks = [
  { key: "ios", defaultFrame: "iphone" },
  { key: "ipad", defaultFrame: "ipad" },
  { key: "android", defaultFrame: "none" },
];

for (const { key, defaultFrame } of blocks) {
  const blk = manifest[key];
  if (!blk) continue;
  console.log(`\n${key}: ${blk.slides.length} slide(s) @ ${blk.size.w}×${blk.size.h}`);
  // Android is not captured separately — it reuses the iOS iPhone captures,
  // reformatted to the Android store size. Pass the iOS slides to inherit from.
  const inheritSlides = key === "android" ? manifest.ios?.slides : undefined;
  await renderBlock(renderer, blk.size, blk.slides, blk.out, blk.frame ?? defaultFrame, inheritSlides);

  if (blk.featureGraphic) {
    console.log(`${key}: feature graphic @ 1024×500`);
    const tpl = template("feature-graphic");
    mkdirSync(abs(blk.out), { recursive: true });
    const outPath = resolve(abs(blk.out), blk.featureGraphic.out);
    await renderer.render(tpl, { w: 1024, h: 500 }, blk.featureGraphic, outPath);
    console.log(`  ✓ ${outPath}  [feature-graphic]`);
  }
}

await renderer.close();
console.log("\nDone.");
