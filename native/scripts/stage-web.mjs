#!/usr/bin/env node
/* Pocket Aquarium — native web staging boundary.
 *
 * Pages and Capacitor both ship the compiled `realistic_light_transport/dist` tree. Vite
 * owns hashed filenames, so this boundary discovers the complete built artifact rather than
 * maintaining a second hand-written runtime list that can silently keep packaging the old app.
 * The destination is rebuilt from scratch, paths are confined to native/www, symlinks are
 * rejected, and a content receipt proves byte identity with the Pages input artifact.
 */
"use strict";

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SRC = path.resolve(HERE, "..", "..", "realistic_light_transport", "dist");
const DEFAULT_DEST = path.resolve(HERE, "..", "www");

export function isSafeRelative(rel) {
  if (typeof rel !== "string" || rel.length === 0) return false;
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return false;
  return !rel.split(/[\\/]/).some((segment) => segment === ".." || segment === "");
}

function isInside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep);
}

function removeWithin(root, target) {
  if (!isInside(root, target)) throw new Error("refusing to remove path outside destination root: " + target);
  fs.rmSync(target, { recursive: true, force: true });
}

/** Return every regular file in the compiled 3D artifact in stable POSIX order. */
export function manifestFor(srcRoot) {
  const root = path.resolve(srcRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error("missing built 3D runtime: " + root + " (run the realistic_light_transport build first)");
  }
  const files = [];
  function walk(directory, base) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = base ? base + "/" + entry.name : entry.name;
      if (!isSafeRelative(relative)) throw new Error("unsafe runtime path: " + relative);
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("runtime artifact may not contain symlinks: " + relative);
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile()) files.push(relative);
      else throw new Error("unsupported runtime entry: " + relative);
    }
  }
  walk(root, "");
  files.sort();
  if (!files.includes("index.html")) throw new Error("missing built runtime entry: index.html");
  if (!files.some((file) => /^assets\/index-[^/]+\.js$/.test(file))) throw new Error("missing compiled JavaScript bundle");
  if (!files.some((file) => /^assets\/index-[^/]+\.css$/.test(file))) throw new Error("missing compiled stylesheet bundle");
  return files;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--src") result.src = argv[++index];
    else if (argv[index] === "--dest") result.dest = argv[++index];
  }
  return result;
}

export function stage(options = {}) {
  const srcRoot = path.resolve(options.src || process.env.STAGE_SRC_ROOT || DEFAULT_SRC);
  const destRoot = path.resolve(options.dest || process.env.STAGE_DEST_ROOT || DEFAULT_DEST);
  const log = options.log || ((message) => process.stderr.write(message + "\n"));
  const manifest = manifestFor(srcRoot);

  removeWithin(destRoot, destRoot);
  fs.mkdirSync(destRoot, { recursive: true });

  const entries = [];
  for (const relative of manifest) {
    const from = path.join(srcRoot, relative);
    const to = path.join(destRoot, relative);
    if (!isInside(srcRoot, from) || !isInside(destRoot, to)) throw new Error("computed path escapes staging boundary: " + relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const bytes = fs.readFileSync(from);
    fs.writeFileSync(to, bytes);
    entries.push({ path: relative, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
    log("staged " + relative + " (" + bytes.length + " bytes)");
  }

  const checksum = crypto.createHash("sha256")
    .update(entries.map((entry) => entry.path + ":" + entry.sha256).sort().join("\n"))
    .digest("hex");
  return { srcRoot, destRoot, count: entries.length, checksum, files: entries };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const receipt = stage(parseArgs(process.argv.slice(2)));
    process.stderr.write("staged " + receipt.count + " files -> " + receipt.destRoot + " (checksum " + receipt.checksum.slice(0, 12) + ")\n");
    process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
  } catch (error) {
    process.stderr.write("stage-web failed: " + error.message + "\n");
    process.exit(1);
  }
}
