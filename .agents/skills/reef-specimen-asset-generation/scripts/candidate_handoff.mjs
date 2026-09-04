#!/usr/bin/env node
// Read-only handoff check for one visual-catalog candidate. Verifies that the package is internally
// coherent (hashes, receipts, state), that the accepted Ocellaris and the acceptance records are
// untouched, that the candidate is not formally excluded, and that no acceptance/promotion path is
// dirty in the worktree. Prints the handoff block; exits 1 on any FAIL. Never writes.
//
//   node candidate_handoff.mjs --asset <species_id> --candidate <name> [--root <realistic_light_transport>]
//                              [--base <git ref>] [--json]

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(here, "..", "..", "..", "..", "realistic_light_transport");
const RECEIPT_SCHEMA = "pocket-aquarium.specimen-validation/v2";
const AWAITING = "awaiting_user_acceptance";
const ACCEPTED_OCELLARIS_GLB = path.join("src", "assets", "specimens", "ocellaris", "v1", "lod1.glb");
const SPEC_FILES = new Set(["asset.source.json", "source-references.json"]);
const REQUIRED_FILES = [
  "candidate.manifest.json", "validation-receipt.json", "validation-source.json", "validation-runtime.json",
  "geometry-digest.json", "validation.contract.json", "build-receipt.json", "lod1.glb", "source.blend",
  "renders/author-preview.png", "renders/three-view.png",
];
const LEGACY_SCRIPTS = ["build_ocellaris.sh", "author_specimen.py", "author_ocellaris.py", "validate_specimen.py",
  "validate_ocellaris.py", "promote_specimen.mjs", "compile_profiles.mjs"];

const args = process.argv.slice(2);
let asset = null;
let candidate = null;
let root = DEFAULT_ROOT;
let base = null;
let json = false;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--asset") asset = args[++index];
  else if (arg === "--candidate") candidate = args[++index];
  else if (arg === "--root") root = path.resolve(args[++index]);
  else if (arg === "--base") base = args[++index];
  else if (arg === "--json") json = true;
  else throw new Error(`Unknown argument ${arg}`);
}
if (!asset || !candidate) throw new Error("Pass --asset <species_id> and --candidate <name>");
if (!/^[a-z0-9_]+$/.test(asset) || !/^[a-z0-9_.-]+$/.test(candidate)) throw new Error("Unsafe asset or candidate name");

const findings = [];
const fail = (code, message) => findings.push({ level: "FAIL", code, message });
const warn = (code, message) => findings.push({ level: "WARN", code, message });

const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return undefined; }
};
const short = (hash) => (typeof hash === "string" ? hash.slice(0, 12) : "n/a");

// Mirrors Python json.dumps(value, separators=(",", ":"), sort_keys=True) for the receipt identity
// (strings and nested objects only; ensure_ascii escaping applied to strings).
function canonical(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${canonical(key)}:${canonical(value[key])}`).join(",")}}`;
}
const sha256Json = (value) => createHash("sha256").update(canonical(value), "utf8").digest("hex");

function expectEqual(code, label, actual, expected) {
  if (actual !== expected) fail(code, `${label}: ${actual ?? "missing"} != ${expected ?? "missing"}`);
}

// ----------------------------------------------------------------- package
const speciesDir = path.join(root, "art", "specimens", asset);
const candidateDir = path.join(speciesDir, "candidates", candidate);
if (!fs.existsSync(path.join(speciesDir, "asset.source.json"))) fail("missing_spec", `${asset}/asset.source.json not found under ${root}`);
if (!fs.existsSync(candidateDir)) fail("missing_candidate", `${candidateDir} does not exist`);

const acceptance = readJson(path.join(root, "art", "specimens", "user-acceptance.v1.json"));
const runtime = readJson(path.join(root, "src", "assets", "specimens", "runtime-acceptance.v1.json"));
const toolchain = readJson(path.join(root, "art", "toolchain.json"));
const ocellarisPackage = readJson(path.join(root, "art", "specimens", "ocellaris", "specimen.package.json"));
const key = `${asset}/${candidate}`;

const excludedLine = (acceptance?.excluded ?? []).find((line) => String(line).split(/[\s(]/)[0] === key);
if (excludedLine) fail("excluded", `formally excluded: "${excludedLine}". Do not relabel; build a successor under a new candidate name.`);

for (const relative of REQUIRED_FILES) {
  const file = path.join(candidateDir, relative);
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) fail("missing_file", `${relative} missing or empty`);
}
const textureFiles = fs.existsSync(path.join(candidateDir, "textures"))
  ? fs.readdirSync(path.join(candidateDir, "textures")).filter((name) => name.endsWith(".png")).sort() : [];
if (textureFiles.length === 0) fail("missing_file", "textures/*.png missing");

const manifest = readJson(path.join(candidateDir, "candidate.manifest.json"));
const receipt = readJson(path.join(candidateDir, "validation-receipt.json"));
const sourceReport = readJson(path.join(candidateDir, "validation-source.json"));
const runtimeReport = readJson(path.join(candidateDir, "validation-runtime.json"));
const geometry = readJson(path.join(candidateDir, "geometry-digest.json"));
const contract = readJson(path.join(candidateDir, "validation.contract.json"));
const buildReceipt = readJson(path.join(candidateDir, "build-receipt.json"));
const determinism = readJson(path.join(candidateDir, "determinism.json"));
const spec = readJson(path.join(speciesDir, "asset.source.json"));
const references = readJson(path.join(speciesDir, "source-references.json"));

if (manifest && receipt && geometry && contract) {
  expectEqual("identity", "manifest.speciesId", manifest.speciesId, asset);
  expectEqual("identity", "receipt.speciesId", receipt.speciesId, asset);
  expectEqual("identity", "variantId", manifest.variantId ?? null, receipt.variantId ?? null);
  expectEqual("state", "manifest.candidate.state", manifest.candidate?.state, AWAITING);
  expectEqual("state", "manifest.validator.status", manifest.validator?.status, "passed");
  if (receipt.schemaVersion !== RECEIPT_SCHEMA) fail("receipt_schema", `receipt schema ${receipt.schemaVersion} is not ${RECEIPT_SCHEMA} (legacy Ocellaris packages are not catalog candidates)`);
  expectEqual("state", "receipt.status", receipt.status, "passed");
  expectEqual("state", "receipt.state", receipt.state, AWAITING);
  if (receipt.acceptance?.performed !== false) fail("state", "receipt.acceptance.performed is not false");
  expectEqual("gates", "receipt.stages.source.status", receipt.stages?.source?.status, "passed");
  expectEqual("gates", "receipt.stages.runtime.status", receipt.stages?.runtime?.status, "passed");
  const determinismStatus = receipt.stages?.determinism?.status;
  if (determinismStatus === "not_run") warn("determinism", "determinism stage was skipped; a handoff build runs every stage");
  else expectEqual("gates", "receipt.stages.determinism.status", determinismStatus, "passed");
  if (determinism && determinism.geometryDigest !== geometry.geometryDigest) fail("determinism", "determinism.json refers to a different geometry digest (stale)");
  expectEqual("gates", "validation-source.json status", sourceReport?.status, "passed");
  expectEqual("gates", "validation-runtime.json status", runtimeReport?.status, "passed");
  expectEqual("gates", "build-receipt.json status", buildReceipt?.status, "passed");

  const glbPath = path.join(candidateDir, "lod1.glb");
  if (fs.existsSync(glbPath)) {
    const glbHash = sha256(glbPath);
    expectEqual("hash", "lod1.glb vs manifest.runtimeGlbSha256.lod1", glbHash, manifest.runtimeGlbSha256?.lod1);
    expectEqual("hash", "lod1.glb vs receipt.candidateGlbHash", glbHash, receipt.candidateGlbHash);
  }
  expectEqual("hash", "geometry-digest vs receipt.geometryDigest", geometry.geometryDigest, receipt.geometryDigest);
  if (fs.existsSync(path.join(candidateDir, "source.blend"))) expectEqual("hash", "source.blend vs manifest.sourceBlendSha256", sha256(path.join(candidateDir, "source.blend")), manifest.sourceBlendSha256);
  if (spec) {
    const specHash = sha256(path.join(speciesDir, "asset.source.json"));
    if (specHash !== manifest.sourceSha256 || specHash !== receipt.sourceSha256) fail("stale_source", "asset.source.json changed after this build; rebuild before handoff");
  }
  if (references) expectEqual("stale_source", "source-references.json vs manifest.sourceReferencesSha256", sha256(path.join(speciesDir, "source-references.json")), manifest.sourceReferencesSha256);
  const listed = new Map((manifest.proceduralTextures ?? []).map((entry) => [entry.path, entry.sha256]));
  for (const name of textureFiles) {
    const relative = `textures/${name}`;
    if (!listed.has(relative)) fail("hash", `${relative} is not listed in manifest.proceduralTextures`);
    else expectEqual("hash", relative, sha256(path.join(candidateDir, relative)), listed.get(relative));
  }
  for (const stage of ["source", "runtime"]) {
    const report = path.join(candidateDir, `validation-${stage}.json`);
    if (fs.existsSync(report)) expectEqual("hash", `receipt.stages.${stage}.sha256`, sha256(report), receipt.stages?.[stage]?.sha256);
  }
  const identity = {
    sourceSha256: receipt.sourceSha256, sourceReferencesSha256: receipt.sourceReferencesSha256,
    candidateGlbHash: receipt.candidateGlbHash, geometryDigest: receipt.geometryDigest,
    builder: receipt.builder, blenderVersion: receipt.blenderVersion, acceptedOcellarisHash: receipt.acceptedOcellarisHash,
  };
  expectEqual("hash", "recomputed candidateHash", sha256Json(identity), receipt.candidateHash);
  expectEqual("hash", "manifest.candidate.candidateHash", manifest.candidate?.candidateHash, receipt.candidateHash);
  if (toolchain?.blender?.version) expectEqual("toolchain", "receipt.blenderVersion", receipt.blenderVersion, toolchain.blender.version);
}

// ----------------------------------------------------------------- accepted boundary
const acceptedGlb = path.join(root, ACCEPTED_OCELLARIS_GLB);
const pinnedAccepted = ocellarisPackage?.promotion?.acceptedHash;
let acceptedHash = null;
if (!fs.existsSync(acceptedGlb)) fail("accepted_ocellaris", `${ACCEPTED_OCELLARIS_GLB} is missing`);
else {
  acceptedHash = sha256(acceptedGlb);
  if (pinnedAccepted) expectEqual("accepted_ocellaris", "bundled Ocellaris GLB vs specimen.package.json#promotion.acceptedHash", acceptedHash, pinnedAccepted);
  else warn("accepted_ocellaris", "specimen.package.json#promotion.acceptedHash not readable; bundled GLB hash unverified against the package");
  if (receipt) expectEqual("receipt_accepted_hash", "receipt.acceptedOcellarisHash vs bundled Ocellaris GLB", receipt.acceptedOcellarisHash, acceptedHash);
}

let acceptanceState = "not recorded (awaiting human look review)";
const entry = (acceptance?.entries ?? []).find((item) => item.speciesId === asset && item.candidate === candidate);
if (!acceptance) warn("acceptance_record", "user-acceptance.v1.json not readable");
else if (entry) {
  const matches = entry.candidateHash === receipt?.candidateHash && entry.glbSha256 === receipt?.candidateGlbHash && entry.geometryDigest === receipt?.geometryDigest;
  acceptanceState = `${entry.status} (userApprovedLook ${entry.userApprovedLook}), hashes ${matches ? "match" : "DIFFER"}`;
  if (!matches) fail("acceptance_hash_mismatch", "acceptance entry refers to a different build; do not edit the record, build a successor candidate or ask the human to re-accept");
}

let runtimeState = "not promoted";
const promoted = (runtime?.assets ?? []).find((item) => item.speciesId === asset && item.sourceCandidate === candidate);
if (promoted) {
  runtimeState = `promoted as ${promoted.key} (${promoted.bundledGlbPath})`;
  if (receipt && promoted.sha256 !== receipt.candidateGlbHash) fail("runtime_hash_mismatch", "runtime-acceptance entry sha256 differs from this candidate's GLB");
}

// ----------------------------------------------------------------- dirty forbidden paths
let dirty = [];
let boundaryNote = "git status not available";
try {
  const top = fs.realpathSync(execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
  const rel = path.relative(top, fs.realpathSync(root)).split(path.sep).join("/");
  const prefix = rel ? `${rel}/` : "";
  const changed = new Set();
  const status = execFileSync("git", ["-C", top, "status", "--porcelain=v1", "-z", "--untracked-files=all"], { encoding: "utf8" });
  const entries = status.split("\0").filter(Boolean);
  for (let index = 0; index < entries.length; index += 1) {
    const code = entries[index].slice(0, 2);
    changed.add(entries[index].slice(3));
    if (code[0] === "R" || code[0] === "C") index += 1;
  }
  if (base) for (const file of execFileSync("git", ["-C", top, "diff", "--name-only", base, "HEAD"], { encoding: "utf8" }).split("\n")) if (file) changed.add(file);
  const forbidden = (file) => {
    if (file === "js/specimenProfiles.js") return "compiled specimen profiles";
    if (!file.startsWith(prefix)) return null;
    const inner = file.slice(prefix.length);
    if (inner.startsWith("src/assets/specimens/")) return "runtime promotion bundle/registry";
    if (inner === "art/specimens/user-acceptance.v1.json") return "human acceptance record";
    if (inner === "src/scene/specimens/assetRegistry.ts" || inner === "src/scene/specimens/assetRegistry.test.ts" || inner === "src/scene/SpecimenFish.tsx") return "runtime asset resolution";
    if (LEGACY_SCRIPTS.some((name) => inner === `scripts/specimens/${name}`)) return "accepted Ocellaris pipeline";
    const parts = inner.split("/");
    if (parts[0] === "art" && parts[1] === "specimens" && parts.length >= 4 && parts[3] !== "candidates" && !(parts.length === 4 && SPEC_FILES.has(parts[3]))) return `accepted package file of ${parts[2]}`;
    return null;
  };
  const shared = (file) => {
    if (!file.startsWith(prefix)) return null;
    const inner = file.slice(prefix.length);
    if (inner.startsWith("scripts/specimens/catalog/lib/") || inner.startsWith("scripts/specimens/catalog/plans/")) return "shared builder (rehashes every dependent candidate)";
    if (inner === "scripts/specimens/catalog/author.py" || inner === "scripts/specimens/catalog/validate.py") return "shared builder entrypoint";
    const parts = inner.split("/");
    if (parts[0] === "art" && parts[1] === "specimens" && parts[2] !== asset && parts[3] === "candidates") return `another species' candidate (${parts[2]})`;
    return null;
  };
  for (const file of [...changed].sort()) {
    const reason = forbidden(file);
    if (reason) { dirty.push(file); fail("boundary", `${file} is modified (${reason})`); continue; }
    const sharedReason = shared(file);
    if (sharedReason) warn("shared_change", `${file} is modified (${sharedReason})`);
  }
  boundaryNote = dirty.length ? `${dirty.length} forbidden path(s) dirty` : `no acceptance/promotion path dirty${base ? ` (worktree + commits since ${base})` : " (worktree)"}`;
} catch (error) {
  warn("no_git", `boundary check skipped: ${error.message.split("\n")[0]}`);
}

// ----------------------------------------------------------------- report
const failed = findings.filter((item) => item.level === "FAIL");
const roles = manifest?.clipRoles ?? spec?.clipRoles ?? {};
const clipLine = ["idle", "locomotion", "response"].map((role) => {
  const name = roles[role];
  const loop = manifest?.clipLoops?.[name];
  const frames = contract?.clips?.[name]?.frames;
  return `${role}=${name ?? "?"} ${loop === undefined ? "?" : loop ? "loop" : "one-shot"}${frames ? ` ${frames}f` : ""}`;
}).join(" | ");
const size = contract?.size;
const bounds = contract?.restBounds;
// Same axis semantics as validate.py#source_gate: x | y | z | xy (max of x, y) | max.
const measured = (() => {
  if (!bounds || !size) return null;
  const extent = bounds.max.map((value, index) => value - bounds.min[index]);
  const byAxis = { x: extent[0], y: extent[1], z: extent[2], xy: Math.max(extent[0], extent[1]), max: Math.max(...extent) };
  return byAxis[size.axis] ?? null;
})();
const evidence = {};
for (const source of references?.sources ?? []) evidence[source.evidenceClass ?? "unclassified"] = (evidence[source.evidenceClass ?? "unclassified"] || 0) + 1;
const gateCount = (report) => (Array.isArray(report?.gates) ? report.gates.length : 0);
const debt = spec?.visualDebt ?? [];

const summary = {
  candidate: key, variantId: manifest?.variantId ?? null, state: manifest?.candidate?.state ?? null,
  candidateHash: receipt?.candidateHash ?? null, glbSha256: receipt?.candidateGlbHash ?? null, geometryDigest: receipt?.geometryDigest ?? null,
  gates: { source: receipt?.stages?.source?.status ?? null, runtime: receipt?.stages?.runtime?.status ?? null, determinism: receipt?.stages?.determinism?.status ?? null },
  referenceSize: spec?.referenceSize ?? null, measured: measured === null ? null : { axis: size.axis, meters: Number(measured.toFixed(5)), tolerance: size.tolerance },
  clipRoles: roles, clipLoops: manifest?.clipLoops ?? null, statistics: manifest?.statistics ?? null,
  acceptedOcellarisHash: acceptedHash, acceptance: acceptanceState, runtime: runtimeState, dirtyForbiddenPaths: dirty,
  visualDebt: debt, provenance: evidence, findings, status: failed.length ? "failed" : "ready_for_human_review",
};

if (json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  const lines = [
    `candidate:        ${key} (variant ${manifest?.variantId ?? "none"})   state ${summary.state ?? "unknown"}`,
    `candidateHash:    ${summary.candidateHash ?? "n/a"}`,
    `lod1.glb sha256:  ${summary.glbSha256 ?? "n/a"}`,
    `geometryDigest:   ${summary.geometryDigest ?? "n/a"}`,
    `gates:            source ${summary.gates.source ?? "n/a"} (${gateCount(sourceReport)}) | runtime ${summary.gates.runtime ?? "n/a"} (${gateCount(runtimeReport)}) | determinism ${summary.gates.determinism ?? "n/a"}`,
    `size:             ${spec?.referenceSize ? `${spec.referenceSize.meters} m ${spec.referenceSize.kind}` : "n/a"}${measured === null ? "" : `; measured ${measured.toFixed(4)} m (axis ${size.axis}, tolerance ${Math.round(size.tolerance * 100)}%)`}`,
    `clips:            ${clipLine}`,
    `statistics:       triangles ${manifest?.statistics?.triangles ?? "?"} | deform bones ${manifest?.statistics?.bones ?? "?"} | runtime bytes ${manifest?.statistics?.runtimeBytes ?? "?"}`,
    `renders:          renders/three-view.png (side | top | front), renders/author-preview.png`,
    `workbench:        http://127.0.0.1:5173/?workbench=${asset}&candidate=${candidate}&scale=shared`,
    `provenance:       ${(references?.sources ?? []).length} sources${Object.keys(evidence).length ? ` (${Object.entries(evidence).map(([name, count]) => `${name} ${count}`).join(", ")})` : ""}`,
    `boundary:         accepted Ocellaris ${short(acceptedHash)} ${failed.some((item) => item.code === "accepted_ocellaris") ? "CHANGED" : "intact"}; acceptance record: ${acceptanceState}; runtime: ${runtimeState}; ${boundaryNote}`,
    `visual debt:      ${debt.length ? "" : "none declared"}`,
    ...debt.map((item) => `                  - ${item}`),
    `requested action: human look review -> entries[] in art/specimens/user-acceptance.v1.json -> promotion lane (not this skill)`,
    `status:           ${summary.status}${findings.length ? ` (${failed.length} FAIL, ${findings.length - failed.length} WARN)` : ""}`,
    ...findings.map((item) => `  ${item.level} ${item.code}: ${item.message}`),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}
process.exit(failed.length ? 1 : 0);
