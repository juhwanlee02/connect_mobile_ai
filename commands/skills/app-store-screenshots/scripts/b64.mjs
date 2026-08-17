#!/usr/bin/env node
// Base64-encode a file without shell redirection operators (`<`/`>`).
// Runtime approval can reject shell operators categorically before
// whitelist prefix-matching even runs (Phase 5 Task 4 smoke test —
// `.superpowers/sdd/task-4-report.md` confirmed a parenthesized subshell is
// rejected this way; plain `<`/`>` redirection carries the same "shell
// operators require approval" risk). Used by /pipeline-release step ⑦ to
// prepare release/privacy.b64 for the GitHub Contents API upload (step ⑧),
// replacing `base64 < in > out`.
//
// Usage: node b64.mjs <in> <out>
// Exit codes: 0 = ok (prints "OK <bytes> <out>")
//             1 = usage / read / write error
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error("usage: node b64.mjs <in> <out>");
  process.exit(1);
}
if (!existsSync(resolve(inPath))) {
  console.error(`input file not found: ${inPath}`);
  process.exit(1);
}

const buf = readFileSync(resolve(inPath));
const b64 = buf.toString("base64");
writeFileSync(resolve(outPath), b64);
console.log(`OK ${buf.length} ${outPath}`);
