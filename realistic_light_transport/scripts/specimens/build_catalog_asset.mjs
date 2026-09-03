#!/usr/bin/env node
// Build + validate visual-catalog candidates with the pinned Blender, running independent
// assets concurrently. Never touches accepted assets; every output is a candidate package.
//
//   BLENDER_BIN=... node scripts/specimens/build_catalog_asset.mjs --asset blue_hippo_tang [--asset zoanthid:blue_green ...]
//        [--candidate fable-v1] [--jobs 4] [--skip-determinism] [--no-render] [--stages author,source,export,runtime,determinism,receipt]
//
// Each asset pipeline: author -> source gate -> export -> runtime gate (fresh process) ->
// determinism rebuild in a scratch dir (author --no-render, digest compare) -> receipt.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const rltRoot = path.resolve(here, "..", "..");
const toolchain = JSON.parse(fs.readFileSync(path.join(rltRoot, "art", "toolchain.json"), "utf8"));
const blender = process.env.BLENDER_BIN || toolchain.blender.taskScopedBinary;
const args = process.argv.slice(2);
const assets = [];
let candidateName = "fable-v1";
let jobs = Math.max(1, Math.min(os.cpus().length - 2, 6));
let skipDeterminism = false;
let noRender = false;
let stages = null;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--asset") assets.push(args[++index]);
  else if (arg === "--candidate") candidateName = args[++index];
  else if (arg === "--jobs") jobs = Number(args[++index]);
  else if (arg === "--skip-determinism") skipDeterminism = true;
  else if (arg === "--no-render") noRender = true;
  else if (arg === "--stages") stages = new Set(args[++index].split(","));
  else throw new Error(`Unknown argument ${arg}`);
}
if (assets.length === 0) throw new Error("Pass at least one --asset <id[:variant]>");
if (!fs.existsSync(blender)) throw new Error(`Blender binary not found at ${blender}`);

function run(command, commandArgs, logPath) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, commandArgs, { cwd: rltRoot, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.on("close", (code) => {
      const output = Buffer.concat(chunks).toString("utf8");
      fs.appendFileSync(logPath, `\n$ ${command} ${commandArgs.join(" ")}\n${output}\n[exit ${code}]\n`);
      resolve({ code, output, durationMs: Date.now() - started });
    });
  });
}

function wants(stage) {
  return stages === null || stages.has(stage);
}

async function buildAsset(entry) {
  const [assetId, variant] = entry.split(":");
  const suffix = variant ? `${candidateName}-${variant}` : candidateName;
  const candidateDir = path.join("art", "specimens", assetId, "candidates", suffix);
  const absCandidate = path.join(rltRoot, candidateDir);
  fs.mkdirSync(absCandidate, { recursive: true });
  const logPath = path.join(absCandidate, "build.log");
  fs.writeFileSync(logPath, `# build ${entry} ${new Date().toISOString()} pid ${process.pid}\n`);
  const blend = path.join(candidateDir, "source.blend");
  const variantArgs = variant ? ["--variant", variant] : [];
  const author = ["--background", "--factory-startup", "--python", "scripts/specimens/catalog/author.py", "--", "--asset", assetId, "--candidate-dir", candidateDir, "--mode", "author", ...variantArgs];
  if (noRender) author.push("--no-render");
  const plan = [
    ["author", author],
    ["source", [blend, "--background", "--python", "scripts/specimens/catalog/validate.py", "--", "--asset", assetId, "--candidate-dir", candidateDir, "--stage", "source"]],
    ["export", [blend, "--background", "--python", "scripts/specimens/catalog/author.py", "--", "--asset", assetId, "--candidate-dir", candidateDir, "--mode", "export", ...variantArgs]],
    ["runtime", ["--background", "--factory-startup", "--python", "scripts/specimens/catalog/validate.py", "--", "--asset", assetId, "--candidate-dir", candidateDir, "--stage", "runtime"]],
  ];
  const receipt = { asset: assetId, variant: variant || null, candidateDir, startedAt: new Date().toISOString(), pid: process.pid, stages: [] };
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `pa-rebuild-${assetId}-`));
  if (!skipDeterminism) {
    plan.push(["determinism", ["--background", "--factory-startup", "--python", "scripts/specimens/catalog/author.py", "--", "--asset", assetId, "--candidate-dir", scratch, "--mode", "author", "--no-render", "--allow-scratch", ...variantArgs]]);
    plan.push(["determinism-compare", ["--background", "--factory-startup", "--python", "scripts/specimens/catalog/validate.py", "--", "--asset", assetId, "--candidate-dir", candidateDir, "--stage", "determinism", "--rebuild-dir", scratch]]);
  }
  plan.push(["receipt", ["--background", "--factory-startup", "--python", "scripts/specimens/catalog/validate.py", "--", "--asset", assetId, "--candidate-dir", candidateDir, "--stage", "receipt", ...variantArgs]]);
  let failed = null;
  for (const [stage, stageArgs] of plan) {
    if (!wants(stage.startsWith("determinism") ? "determinism" : stage)) continue;
    const result = await run(blender, stageArgs, logPath);
    const lastLine = result.output.trim().split("\n").filter((line) => line.trim()).slice(-1)[0] || "";
    receipt.stages.push({ stage, exitCode: result.code, durationMs: result.durationMs, tail: lastLine.slice(0, 300) });
    process.stdout.write(`[${entry}] ${stage}: exit ${result.code} (${(result.durationMs / 1000).toFixed(1)}s)\n`);
    if (result.code !== 0) {
      failed = { stage, tail: result.output.trim().split("\n").slice(-12).join("\n") };
      break;
    }
  }
  fs.rmSync(scratch, { recursive: true, force: true });
  receipt.finishedAt = new Date().toISOString();
  receipt.status = failed ? "failed" : "passed";
  receipt.failure = failed;
  fs.writeFileSync(path.join(absCandidate, "build-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

const queue = [...assets];
const results = [];
const startedAt = Date.now();
process.stdout.write(`Building ${assets.length} candidate(s) with ${Math.min(jobs, assets.length)} parallel lane(s) using ${blender}\n`);
await Promise.all(Array.from({ length: Math.min(jobs, assets.length) }, async () => {
  while (queue.length) {
    const entry = queue.shift();
    results.push(await buildAsset(entry));
  }
}));
const summary = {
  startedAt: new Date(startedAt).toISOString(),
  elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
  jobs: Math.min(jobs, assets.length),
  results: results.map((r) => ({ asset: r.asset, variant: r.variant, status: r.status, failedStage: r.failure?.stage || null, candidateDir: r.candidateDir })),
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
for (const result of results) {
  if (result.failure) process.stdout.write(`\n--- ${result.asset}${result.variant ? `:${result.variant}` : ""} failed at ${result.failure.stage}:\n${result.failure.tail}\n`);
}
process.exit(results.some((r) => r.status !== "passed") ? 1 : 0);
