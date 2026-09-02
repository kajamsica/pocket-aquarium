#!/usr/bin/env node
/* Pocket Aquarium — native web staging boundary (IOS-1).
 *
 * This is the ONE compatibility seam between the accepted root PWA runtime and the
 * Capacitor iOS host. It rebuilds `native/www` from an explicit allowlist that MUST
 * match the GitHub Pages runtime artifact byte-for-byte:
 *   - root shell:   index.html, styles.css, manifest.webmanifest, sw.js
 *   - runtime JS:   js/{data,sim,render,app}.js
 *   - habitat art:  assets/habitats/{amazon-blackwater,reef-lagoon}-v1.png
 *   - species art:  assets/animals/{ocellaris-clownfish-v2,neon-tetra,yellow-watchman-goby}-v1|v2.png
 *   - runtime icons:assets/icons/{apple-touch-icon,icon-192,icon-512}.png
 *
 * It deliberately NEVER copies: the app-icon master, the invalid clownfish v1 cutout,
 * docs/, tests/, labs/, reef/, .git, package/config files, or any other repo bytes.
 *
 * Design rules:
 *   - Deterministic: same inputs -> same staged bytes -> same checksum receipt.
 *   - Fail loud: a missing allowlisted source is a hard error (never a silent skip).
 *   - Stale-safe: the destination is rebuilt from scratch, and every filesystem removal
 *     is asserted to live strictly inside the resolved destination root. The script can
 *     never delete or write outside `native/www` (or an injected test dest).
 *   - Injectable roots: `--src` / `--dest` (or STAGE_SRC_ROOT / STAGE_DEST_ROOT) let the
 *     contract test drive the exact same code against a disposable fixture.
 *   - Receipt: a stable JSON manifest+checksum is printed to STDOUT; human logs go to STDERR.
 */
"use strict";

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

/* The accepted root runtime allowlist — this list IS the contract with the Pages artifact.
 * Every entry is a repo-relative POSIX path. Order is stable so the receipt is stable. */
export const MANIFEST = Object.freeze([
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "sw.js",
  "js/data.js",
  "js/sim.js",
  "js/render.js",
  "js/app.js",
  "assets/habitats/amazon-blackwater-v1.png",
  "assets/habitats/reef-lagoon-v1.png",
  "assets/animals/ocellaris-clownfish-v2.png",
  "assets/animals/neon-tetra-v1.png",
  "assets/animals/yellow-watchman-goby-v1.png",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png"
]);

/* Bytes that must NEVER be staged even though they live under tracked runtime dirs. */
export const FORBIDDEN = Object.freeze([
  "assets/icons/app-icon-master-v1.png",
  "assets/animals/ocellaris-clownfish-v1.png"
]);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SRC = path.resolve(HERE, "..", "..");        // repo root
const DEFAULT_DEST = path.resolve(HERE, "..", "www");      // native/www

/* --- path safety -------------------------------------------------------------- */

/* Reject anything that could escape a root: absolute paths, drive letters, or `..`. */
export function isSafeRelative(rel) {
  if (typeof rel !== "string" || rel.length === 0) return false;
  if (path.isAbsolute(rel)) return false;
  if (/^[a-zA-Z]:/.test(rel)) return false;
  return !rel.split(/[\\/]/).some((seg) => seg === ".." || seg === "");
}

/* True only when `target` resolves to `root` itself or something strictly beneath it. */
function isInside(root, target) {
  const r = path.resolve(root);
  const t = path.resolve(target);
  return t === r || t.startsWith(r + path.sep);
}

/* Recursive remove that refuses to touch anything outside `root`. */
function removeWithin(root, target) {
  if (!isInside(root, target)) {
    throw new Error("refusing to remove path outside destination root: " + target);
  }
  fs.rmSync(target, { recursive: true, force: true });
}

/* --- staging ------------------------------------------------------------------ */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--src") out.src = argv[++i];
    else if (a === "--dest") out.dest = argv[++i];
  }
  return out;
}

export function stage(opts = {}) {
  const srcRoot = path.resolve(opts.src || process.env.STAGE_SRC_ROOT || DEFAULT_SRC);
  const destRoot = path.resolve(opts.dest || process.env.STAGE_DEST_ROOT || DEFAULT_DEST);
  const log = opts.log || ((m) => process.stderr.write(m + "\n"));

  // Guard the allowlist itself before any filesystem mutation.
  for (const rel of MANIFEST) {
    if (!isSafeRelative(rel)) throw new Error("unsafe manifest entry: " + rel);
  }

  // Verify every allowlisted source exists BEFORE we destroy the destination, so a
  // missing runtime file fails loudly without leaving a half-built www behind.
  const missing = MANIFEST.filter((rel) => !fs.existsSync(path.join(srcRoot, rel)));
  if (missing.length) {
    throw new Error("missing allowlisted runtime file(s): " + missing.join(", "));
  }

  // Rebuild the destination from scratch (stale-safe, guarded to stay inside destRoot).
  removeWithin(destRoot, destRoot);
  fs.mkdirSync(destRoot, { recursive: true });

  const entries = [];
  for (const rel of MANIFEST) {
    const from = path.join(srcRoot, rel);
    const to = path.join(destRoot, rel);
    if (!isInside(destRoot, to)) throw new Error("computed dest escapes root: " + rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const bytes = fs.readFileSync(from);
    fs.writeFileSync(to, bytes);
    entries.push({
      path: rel,
      bytes: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex")
    });
    log("staged " + rel + " (" + bytes.length + " bytes)");
  }

  // A single order-independent checksum over "path:sha256" lines: the staging fingerprint.
  const digestLines = entries
    .map((e) => e.path + ":" + e.sha256)
    .sort()
    .join("\n");
  const checksum = crypto.createHash("sha256").update(digestLines).digest("hex");

  return {
    srcRoot,
    destRoot,
    count: entries.length,
    checksum,
    files: entries
  };
}

/* --- CLI ---------------------------------------------------------------------- */

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    const receipt = stage(parseArgs(process.argv.slice(2)));
    process.stderr.write(
      "staged " + receipt.count + " files -> " + receipt.destRoot +
      " (checksum " + receipt.checksum.slice(0, 12) + ")\n"
    );
    process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
  } catch (err) {
    process.stderr.write("stage-web failed: " + err.message + "\n");
    process.exit(1);
  }
}
