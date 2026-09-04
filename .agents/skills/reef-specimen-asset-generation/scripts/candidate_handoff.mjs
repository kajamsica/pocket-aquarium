#!/usr/bin/env node
// Read-only handoff check for one visual-catalog candidate. Verifies that the package is internally
// coherent (hashes, receipts, state, determinism), that the requested name is bound to the package's
// own identity, that the accepted Ocellaris and the acceptance records are untouched, that the
// candidate is not formally excluded or relabeled, and that no acceptance/promotion path is dirty in
// the worktree. Prints the handoff block; exits 1 on any FAIL, 2 on usage errors. Never writes.
//
//   node candidate_handoff.mjs --asset <species_id> --candidate <name> [--root <realistic_light_transport>]
//                              [--base <git ref>] [--scope <species_id>]... [--json]

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(here, "..", "..", "..", "..", "realistic_light_transport");
const SPEC_SCHEMA = "pocket-aquarium.asset-source/v1";
const RECEIPT_SCHEMA = "pocket-aquarium.specimen-validation/v2";
const AWAITING = "awaiting_user_acceptance";
const ACCEPTED_OCELLARIS_GLB = "src/assets/specimens/ocellaris/v1/lod1.glb";
const SPEC_FILES = new Set(["asset.source.json", "source-references.json"]);
const BINARY_FILES = ["lod1.glb", "source.blend", "renders/author-preview.png", "renders/three-view.png"];
const LEGACY_SCRIPTS = ["build_ocellaris.sh", "author_specimen.py", "author_ocellaris.py", "validate_specimen.py",
  "validate_ocellaris.py", "promote_specimen.mjs", "compile_profiles.mjs"];
const RUNTIME_RESOLUTION = ["src/scene/specimens/assetRegistry.ts", "src/scene/specimens/assetRegistry.test.ts",
  "src/scene/SpecimenFish.tsx", "src/scene/SpecimenFish.test.ts"];
// Same segment rule as src/workbench/candidateCatalogService.ts: no dots, slashes, or leading dash.
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HEX64 = /^[0-9a-f]{64}$/;

function usage(message) {
  process.stderr.write(`candidate_handoff: ${message}\n`);
  process.exit(2);
}

const args = process.argv.slice(2);
let asset = null;
let candidate = null;
let root = DEFAULT_ROOT;
let base = null;
let json = false;
const scope = new Set();
const value = (flag, index) => {
  const raw = args[index];
  if (raw === undefined || raw.startsWith("-")) usage(`${flag} needs a value that does not start with '-'`);
  return raw;
};
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--asset") asset = value(arg, ++index);
  else if (arg === "--candidate") candidate = value(arg, ++index);
  else if (arg === "--root") root = path.resolve(value(arg, ++index));
  else if (arg === "--base") base = value(arg, ++index);
  else if (arg === "--scope") scope.add(value(arg, ++index));
  else if (arg === "--json") json = true;
  else usage(`unknown argument ${arg}`);
}
if (!asset || !candidate) usage("pass --asset <species_id> and --candidate <name>");
if (!SAFE_SEGMENT.test(asset)) usage(`unsafe asset name ${JSON.stringify(asset)} (expected ${SAFE_SEGMENT})`);
if (!SAFE_SEGMENT.test(candidate)) usage(`unsafe candidate name ${JSON.stringify(candidate)} (expected ${SAFE_SEGMENT})`);
for (const item of scope) if (!SAFE_SEGMENT.test(item)) usage(`unsafe --scope value ${JSON.stringify(item)}`);
if (base !== null && !/^[A-Za-z0-9_.\/@^~{}-]{1,200}$/.test(base)) usage(`unsafe --base value ${JSON.stringify(base)}`);
scope.add(asset);

const findings = [];
const fail = (code, message) => findings.push({ level: "FAIL", code, message });
const warn = (code, message) => findings.push({ level: "WARN", code, message });

const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const short = (hash) => (typeof hash === "string" ? hash.slice(0, 12) : "n/a");
const isObj = (item) => item !== null && typeof item === "object" && !Array.isArray(item);
const isStr = (item) => typeof item === "string" && item.length > 0;
const isHex = (item) => typeof item === "string" && HEX64.test(item);
const isNum = (item) => typeof item === "number" && Number.isFinite(item);
const isBool = (item) => typeof item === "boolean";
const isArr = Array.isArray;
const strOrNull = (item) => item === null || isStr(item);

// Mirrors Python json.dumps(value, separators=(",", ":"), sort_keys=True) for the receipt identity
// (strings and nested objects only; ensure_ascii escaping applied to strings).
function canonical(item) {
  if (item === null || item === undefined) return "null";
  if (typeof item === "string") return JSON.stringify(item).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  if (typeof item === "number" || typeof item === "boolean") return JSON.stringify(item);
  if (isArr(item)) return `[${item.map(canonical).join(",")}]`;
  return `{${Object.keys(item).sort().map((key) => `${canonical(key)}:${canonical(item[key])}`).join(",")}}`;
}
const sha256Json = (item) => createHash("sha256").update(canonical(item), "utf8").digest("hex");

function expectEqual(code, label, actual, expected) {
  if (actual !== expected) fail(code, `${label}: ${actual ?? "missing"} != ${expected ?? "missing"}`);
}

// Every required document is loaded through here: missing, unparsable, or shape-invalid documents
// each produce their own FAIL, so a later check that has to skip a null document never hides one.
function loadDoc(label, file, shape, code) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { fail(code ?? "missing_file", `${label} is missing`); return null; }
  let data;
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { fail(code ?? "malformed_json", `${label}: ${error.message}`); return null; }
  const problems = [];
  const need = (condition, description) => { if (!condition) problems.push(description); };
  if (!isObj(data)) problems.push("top level is not an object");
  else shape(data, need);
  if (problems.length) { fail(code ?? "schema", `${label}: ${problems.join("; ")}`); return null; }
  return data;
}

function readGlbJson(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 20 || buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2) throw new Error("not a glTF 2.0 binary");
  const length = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a || 20 + length > buffer.length) throw new Error("first chunk is not JSON");
  return JSON.parse(buffer.subarray(20, 20 + length).toString("utf8"));
}

// ----------------------------------------------------------------- paths
const speciesDir = path.join(root, "art", "specimens", asset);
const candidatesRoot = path.join(speciesDir, "candidates");
const candidateDir = path.join(candidatesRoot, candidate);
const key = `${asset}/${candidate}`;
const expectedCandidateDir = ["art", "specimens", asset, "candidates", candidate].join("/");

let packagePresent = false;
if (!fs.existsSync(candidateDir)) fail("missing_candidate", `${candidateDir} does not exist`);
else if (fs.lstatSync(candidateDir).isSymbolicLink() || !fs.statSync(candidateDir).isDirectory()) fail("unsafe_path", `${candidateDir} is not a plain directory`);
else {
  const real = fs.realpathSync(candidateDir);
  const realRoot = fs.existsSync(candidatesRoot) ? fs.realpathSync(candidatesRoot) : null;
  if (!realRoot || path.dirname(real) !== realRoot) fail("unsafe_path", `${candidateDir} resolves outside ${candidatesRoot}`);
  else packagePresent = true;
}

// ----------------------------------------------------------------- control documents
const acceptance = loadDoc("art/specimens/user-acceptance.v1.json", path.join(root, "art", "specimens", "user-acceptance.v1.json"), (data, need) => {
  need(isStr(data.schemaVersion), "schemaVersion missing");
  need(isArr(data.entries) && data.entries.every((item) => isObj(item) && isStr(item.speciesId) && isStr(item.candidate) && isStr(item.status)), "entries[] malformed");
  need(isArr(data.excluded) && data.excluded.every(isStr), "excluded[] malformed");
}, "control_record");
const runtime = loadDoc("src/assets/specimens/runtime-acceptance.v1.json", path.join(root, "src", "assets", "specimens", "runtime-acceptance.v1.json"), (data, need) => {
  need(isStr(data.schemaVersion), "schemaVersion missing");
  need(isArr(data.assets) && data.assets.every((item) => isObj(item) && isStr(item.speciesId) && isStr(item.sourceCandidate) && isHex(item.sha256)), "assets[] malformed");
}, "control_record");
const toolchain = loadDoc("art/toolchain.json", path.join(root, "art", "toolchain.json"), (data, need) => {
  need(isObj(data.blender) && isStr(data.blender.version), "blender.version missing");
}, "control_record");
const ocellarisPackage = loadDoc("art/specimens/ocellaris/specimen.package.json", path.join(root, "art", "specimens", "ocellaris", "specimen.package.json"), (data, need) => {
  need(isObj(data.promotion) && isHex(data.promotion.acceptedHash), "promotion.acceptedHash missing");
}, "control_record");

const excludedLine = acceptance ? acceptance.excluded.find((line) => line.split(/[\s(]/)[0] === key) : undefined;
if (excludedLine) fail("excluded", `formally excluded: "${excludedLine}". Do not relabel; build a successor under a new candidate name.`);

// ----------------------------------------------------------------- candidate documents
const spec = loadDoc(`${asset}/asset.source.json`, path.join(speciesDir, "asset.source.json"), (data, need) => {
  need(data.schemaVersion === SPEC_SCHEMA, `schemaVersion is not ${SPEC_SCHEMA}`);
  need(data.id === asset, `id != ${asset}`);
  need(isObj(data.referenceSize) && isNum(data.referenceSize.meters) && isStr(data.referenceSize.kind), "referenceSize.meters/kind missing");
  need(isObj(data.clipRoles), "clipRoles missing");
  need(data.visualDebt === undefined || (isArr(data.visualDebt) && data.visualDebt.every(isStr)), "visualDebt malformed");
});
const references = loadDoc(`${asset}/source-references.json`, path.join(speciesDir, "source-references.json"), (data, need) => {
  need(isArr(data.sources) && data.sources.every(isObj), "sources[] malformed");
});

const candidateFile = (relative) => path.join(candidateDir, relative);
const manifest = packagePresent && loadDoc("candidate.manifest.json", candidateFile("candidate.manifest.json"), (data, need) => {
  need(isStr(data.speciesId), "speciesId missing");
  need(data.variantId === undefined || strOrNull(data.variantId), "variantId malformed");
  need(isObj(data.candidate) && isStr(data.candidate.state) && isHex(data.candidate.candidateHash) && isStr(data.candidate.determinism), "candidate.{state,candidateHash,determinism} missing");
  need(isObj(data.validator) && isStr(data.validator.status), "validator.status missing");
  need(isObj(data.runtimeGlbSha256) && isHex(data.runtimeGlbSha256.lod1), "runtimeGlbSha256.lod1 missing");
  need(isHex(data.sourceSha256) && isHex(data.sourceReferencesSha256) && isHex(data.sourceBlendSha256), "source hashes missing");
  need(isObj(data.builder), "builder missing");
  need(isArr(data.proceduralTextures) && data.proceduralTextures.every((item) => isObj(item) && isStr(item.path) && isHex(item.sha256)), "proceduralTextures[] malformed");
  need(isObj(data.clipRoles) && ["idle", "locomotion", "response"].every((role) => isStr(data.clipRoles[role])), "clipRoles incomplete");
  need(isObj(data.clipLoops) && Object.values(data.clipLoops).every(isBool), "clipLoops malformed");
  need(isObj(data.statistics), "statistics missing");
});
const receipt = packagePresent && loadDoc("validation-receipt.json", candidateFile("validation-receipt.json"), (data, need) => {
  need(data.schemaVersion === RECEIPT_SCHEMA, `schemaVersion ${data.schemaVersion} is not ${RECEIPT_SCHEMA} (legacy Ocellaris packages are not catalog candidates)`);
  need(isStr(data.speciesId) && strOrNull(data.variantId ?? null), "speciesId/variantId malformed");
  need(isStr(data.status) && isStr(data.state), "status/state missing");
  need(isHex(data.candidateHash) && isHex(data.sourceSha256) && isHex(data.sourceReferencesSha256) && isHex(data.candidateGlbHash) && isHex(data.geometryDigest) && isHex(data.acceptedOcellarisHash), "identity hashes missing");
  need(isObj(data.builder) && isStr(data.blenderVersion), "builder/blenderVersion missing");
  need(isObj(data.stages) && ["source", "runtime"].every((stage) => isObj(data.stages[stage]) && isStr(data.stages[stage].status) && isHex(data.stages[stage].sha256)) && isObj(data.stages.determinism) && isStr(data.stages.determinism.status), "stages malformed");
  need(isObj(data.acceptance) && isBool(data.acceptance.performed), "acceptance.performed missing");
});
const geometry = packagePresent && loadDoc("geometry-digest.json", candidateFile("geometry-digest.json"), (data, need) => {
  need(isHex(data.geometryDigest), "geometryDigest missing");
  need(isStr(data.speciesId) && isArr(data.objects) && isObj(data.rig), "speciesId/objects/rig missing");
});
const contract = packagePresent && loadDoc("validation.contract.json", candidateFile("validation.contract.json"), (data, need) => {
  need(isStr(data.speciesId) && isStr(data.rig) && isStr(data.root) && isArr(data.meshes), "speciesId/rig/root/meshes missing");
  need(isObj(data.size) && isStr(data.size.axis) && isNum(data.size.meters) && isNum(data.size.tolerance), "size malformed");
  need(isObj(data.clips) && isObj(data.clipRoles), "clips/clipRoles missing");
  need(isObj(data.restBounds) && isArr(data.restBounds.min) && isArr(data.restBounds.max) && data.restBounds.min.length === 3 && data.restBounds.max.length === 3, "restBounds malformed");
});
const buildReceipt = packagePresent && loadDoc("build-receipt.json", candidateFile("build-receipt.json"), (data, need) => {
  need(isStr(data.asset) && isStr(data.candidateDir) && isStr(data.status) && isArr(data.stages), "asset/candidateDir/status/stages missing");
  need(strOrNull(data.variant ?? null), "variant malformed");
});
const determinism = packagePresent && loadDoc("determinism.json", candidateFile("determinism.json"), (data, need) => {
  need(isStr(data.status), "status missing");
  need(isHex(data.geometryDigest) && isHex(data.rebuildGeometryDigest), "geometry digests missing");
  need(isBool(data.geometryDigestMatch) && isBool(data.textureHashMatch) && isBool(data.rigDigestMatch), "match flags missing");
  need(isObj(data.textures) && Object.values(data.textures).every(isHex), "textures malformed");
});
const reportShape = (data, need) => {
  need(isStr(data.status), "status missing");
  need(isArr(data.gates) && data.gates.every(isStr), "gates[] malformed");
};
const sourceReport = packagePresent && loadDoc("validation-source.json", candidateFile("validation-source.json"), reportShape);
const runtimeReport = packagePresent && loadDoc("validation-runtime.json", candidateFile("validation-runtime.json"), reportShape);

let textureFiles = [];
if (packagePresent) {
  for (const relative of BINARY_FILES) {
    const file = candidateFile(relative);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) fail("missing_file", `${relative} missing or empty`);
  }
  const texturesDir = candidateFile("textures");
  textureFiles = fs.existsSync(texturesDir) && fs.statSync(texturesDir).isDirectory()
    ? fs.readdirSync(texturesDir).filter((name) => name.endsWith(".png")).sort() : [];
  if (textureFiles.length === 0) fail("missing_file", "textures/*.png missing");
}

// ----------------------------------------------------------------- identity binding
// The requested name must be the name the package was built under, not a directory it was copied into.
if (buildReceipt) {
  expectEqual("identity", "build-receipt.json#candidateDir", buildReceipt.candidateDir, expectedCandidateDir);
  expectEqual("identity", "build-receipt.json#asset", buildReceipt.asset, asset);
  expectEqual("gates", "build-receipt.json#status", buildReceipt.status, "passed");
}
if (manifest) {
  expectEqual("identity", "manifest.speciesId", manifest.speciesId, asset);
  const variantId = manifest.variantId ?? null;
  if (buildReceipt) expectEqual("identity", "build-receipt.json#variant", buildReceipt.variant ?? null, variantId);
  if (variantId !== null && !candidate.endsWith(`-${variantId}`)) fail("identity", `candidate ${candidate} does not carry variant suffix -${variantId} (build_catalog_asset.mjs names variant candidates <candidate>-<variantId>)`);
  if (receipt) expectEqual("identity", "receipt.variantId", receipt.variantId ?? null, variantId);
}
if (receipt) expectEqual("identity", "receipt.speciesId", receipt.speciesId, asset);
if (geometry) expectEqual("identity", "geometry-digest.json#speciesId", geometry.speciesId, asset);
if (contract) expectEqual("identity", "validation.contract.json#speciesId", contract.speciesId, asset);
if (packagePresent && fs.existsSync(candidateFile("lod1.glb"))) {
  try {
    const extras = readGlbJson(candidateFile("lod1.glb")).asset?.extras?.pocketAquarium;
    if (!isObj(extras)) fail("identity", "lod1.glb has no asset.extras.pocketAquarium metadata (lib/glb.py#inject_asset_metadata)");
    else {
      expectEqual("identity", "lod1.glb extras.speciesId", extras.speciesId, asset);
      if (manifest) expectEqual("identity", "lod1.glb extras.variantId", extras.variantId ?? null, manifest.variantId ?? null);
      expectEqual("identity", "lod1.glb extras.candidate", extras.candidate, true);
    }
  } catch (error) {
    fail("identity", `lod1.glb unreadable: ${error.message}`);
  }
}

// ----------------------------------------------------------------- state and gates
if (manifest) {
  expectEqual("state", "manifest.candidate.state", manifest.candidate.state, AWAITING);
  expectEqual("state", "manifest.validator.status", manifest.validator.status, "passed");
  expectEqual("determinism", "manifest.candidate.determinism", manifest.candidate.determinism, "passed");
}
if (receipt) {
  expectEqual("state", "receipt.status", receipt.status, "passed");
  expectEqual("state", "receipt.state", receipt.state, AWAITING);
  expectEqual("state", "receipt.acceptance.performed", receipt.acceptance.performed, false);
  expectEqual("gates", "receipt.stages.source.status", receipt.stages.source.status, "passed");
  expectEqual("gates", "receipt.stages.runtime.status", receipt.stages.runtime.status, "passed");
  expectEqual("determinism", "receipt.stages.determinism.status", receipt.stages.determinism.status, "passed");
}
if (sourceReport) expectEqual("gates", "validation-source.json status", sourceReport.status, "passed");
if (runtimeReport) expectEqual("gates", "validation-runtime.json status", runtimeReport.status, "passed");
if (determinism) {
  expectEqual("determinism", "determinism.json status", determinism.status, "passed");
  expectEqual("determinism", "determinism.json match flags", determinism.geometryDigestMatch && determinism.textureHashMatch && determinism.rigDigestMatch, true);
  expectEqual("determinism", "determinism.rebuildGeometryDigest", determinism.rebuildGeometryDigest, determinism.geometryDigest);
  if (geometry) expectEqual("determinism", "determinism.geometryDigest vs geometry-digest.json", determinism.geometryDigest, geometry.geometryDigest);
  const names = Object.keys(determinism.textures).sort();
  if (names.join(",") !== textureFiles.join(",")) fail("determinism", `determinism.json textures [${names}] differ from textures/ [${textureFiles}]`);
  for (const name of textureFiles) if (names.includes(name)) expectEqual("determinism", `determinism.json textures.${name}`, sha256(candidateFile(`textures/${name}`)), determinism.textures[name]);
}

// ----------------------------------------------------------------- hash coherence
if (packagePresent && fs.existsSync(candidateFile("lod1.glb"))) {
  const glbHash = sha256(candidateFile("lod1.glb"));
  if (manifest) expectEqual("hash", "lod1.glb vs manifest.runtimeGlbSha256.lod1", glbHash, manifest.runtimeGlbSha256.lod1);
  if (receipt) expectEqual("hash", "lod1.glb vs receipt.candidateGlbHash", glbHash, receipt.candidateGlbHash);
}
if (manifest && packagePresent && fs.existsSync(candidateFile("source.blend"))) expectEqual("hash", "source.blend vs manifest.sourceBlendSha256", sha256(candidateFile("source.blend")), manifest.sourceBlendSha256);
if (geometry && receipt) expectEqual("hash", "geometry-digest vs receipt.geometryDigest", geometry.geometryDigest, receipt.geometryDigest);
if (spec && manifest && receipt) {
  const specHash = sha256(path.join(speciesDir, "asset.source.json"));
  if (specHash !== manifest.sourceSha256 || specHash !== receipt.sourceSha256) fail("stale_source", "asset.source.json changed after this build; rebuild before handoff");
}
if (references && manifest && receipt) {
  const referencesHash = sha256(path.join(speciesDir, "source-references.json"));
  if (referencesHash !== manifest.sourceReferencesSha256 || referencesHash !== receipt.sourceReferencesSha256) fail("stale_source", "source-references.json changed after this build; rebuild before handoff");
}
if (manifest) {
  const listed = new Map(manifest.proceduralTextures.map((item) => [item.path, item.sha256]));
  for (const name of textureFiles) {
    const relative = `textures/${name}`;
    if (!listed.has(relative)) fail("hash", `${relative} is not listed in manifest.proceduralTextures`);
    else expectEqual("hash", relative, sha256(candidateFile(relative)), listed.get(relative));
  }
  for (const listedPath of listed.keys()) if (!textureFiles.includes(listedPath.replace(/^textures\//, ""))) fail("hash", `${listedPath} listed in manifest but missing on disk`);
}
if (receipt) {
  for (const stage of ["source", "runtime"]) {
    const report = candidateFile(`validation-${stage}.json`);
    if (fs.existsSync(report)) expectEqual("hash", `receipt.stages.${stage}.sha256`, sha256(report), receipt.stages[stage].sha256);
  }
  const identity = {
    sourceSha256: receipt.sourceSha256, sourceReferencesSha256: receipt.sourceReferencesSha256,
    candidateGlbHash: receipt.candidateGlbHash, geometryDigest: receipt.geometryDigest,
    builder: receipt.builder, blenderVersion: receipt.blenderVersion, acceptedOcellarisHash: receipt.acceptedOcellarisHash,
  };
  expectEqual("hash", "recomputed candidateHash", sha256Json(identity), receipt.candidateHash);
  if (manifest) expectEqual("hash", "manifest.candidate.candidateHash", manifest.candidate.candidateHash, receipt.candidateHash);
  if (toolchain) expectEqual("toolchain", "receipt.blenderVersion", receipt.blenderVersion, toolchain.blender.version);
}

// ----------------------------------------------------------------- accepted boundary and records
const acceptedGlb = path.join(root, ACCEPTED_OCELLARIS_GLB);
let acceptedHash = null;
if (!fs.existsSync(acceptedGlb)) fail("accepted_ocellaris", `${ACCEPTED_OCELLARIS_GLB} is missing`);
else {
  acceptedHash = sha256(acceptedGlb);
  if (ocellarisPackage) expectEqual("accepted_ocellaris", "bundled Ocellaris GLB vs specimen.package.json#promotion.acceptedHash", acceptedHash, ocellarisPackage.promotion.acceptedHash);
  if (receipt) expectEqual("receipt_accepted_hash", "receipt.acceptedOcellarisHash vs bundled Ocellaris GLB", receipt.acceptedOcellarisHash, acceptedHash);
}

let acceptanceState = "unverifiable (acceptance record invalid)";
if (acceptance) {
  acceptanceState = "not recorded (awaiting human look review)";
  const entry = acceptance.entries.find((item) => item.speciesId === asset && item.candidate === candidate);
  if (entry) {
    const matches = receipt && entry.candidateHash === receipt.candidateHash && entry.glbSha256 === receipt.candidateGlbHash && entry.geometryDigest === receipt.geometryDigest;
    acceptanceState = `${entry.status} (userApprovedLook ${entry.userApprovedLook}), hashes ${matches ? "match" : "DIFFER"}`;
    if (!matches) fail("acceptance_hash_mismatch", "acceptance entry refers to a different build; do not edit the record, build a successor candidate or ask the human to re-accept");
  }
  if (receipt) {
    for (const other of acceptance.entries) {
      if (other.speciesId === asset && other.candidate === candidate) continue;
      // geometryDigest alone is not identity: paint-only refinements legitimately keep it.
      if (other.candidateHash === receipt.candidateHash || other.glbSha256 === receipt.candidateGlbHash) {
        fail("relabel", `package identity matches acceptance entry ${other.speciesId}/${other.candidate}; a recorded candidate cannot be handed off under another name`);
      }
    }
  }
}

let runtimeState = "unverifiable (runtime record invalid)";
if (runtime) {
  runtimeState = "not promoted";
  const promoted = runtime.assets.find((item) => item.speciesId === asset && item.sourceCandidate === candidate);
  if (promoted) {
    runtimeState = `promoted as ${promoted.key} (${promoted.bundledGlbPath})`;
    if (receipt) expectEqual("runtime_hash_mismatch", "runtime-acceptance entry sha256 vs candidate GLB", promoted.sha256, receipt.candidateGlbHash);
  }
  if (receipt) {
    for (const other of runtime.assets) {
      if (other.speciesId === asset && other.sourceCandidate === candidate) continue;
      if (other.sha256 === receipt.candidateGlbHash) fail("relabel", `GLB is already promoted as ${other.speciesId}/${other.sourceCandidate}; a promoted candidate cannot be handed off under another name`);
    }
  }
}

// ----------------------------------------------------------------- relabel against on-disk packages
// build-receipt.json#candidateDir is outside candidateHash and can be rewritten, so the hash-covered
// identity (lod1.glb bytes, candidateHash) is compared with every formally excluded package that
// still exists and with every sibling candidate: an identical package under another name is a relabel.
const currentGlbHash = packagePresent && fs.existsSync(candidateFile("lod1.glb")) && fs.statSync(candidateFile("lod1.glb")).isFile() ? sha256(candidateFile("lod1.glb")) : null;
const currentCandidateHash = receipt ? receipt.candidateHash : null;
function packageIdentity(dir) {
  const glb = path.join(dir, "lod1.glb");
  let candidateHash = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, "validation-receipt.json"), "utf8"));
    if (isObj(parsed) && isHex(parsed.candidateHash)) candidateHash = parsed.candidateHash;
  } catch { /* legacy or unreadable receipt: the GLB bytes still bind */ }
  return { glbHash: fs.existsSync(glb) && fs.statSync(glb).isFile() ? sha256(glb) : null, candidateHash };
}
const compared = new Set([key]);
function compareIdentity(otherKey, dir, what, remedy) {
  if (compared.has(otherKey) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
  compared.add(otherKey);
  const other = packageIdentity(dir);
  const sameGlb = currentGlbHash !== null && other.glbHash === currentGlbHash;
  const sameHash = currentCandidateHash !== null && other.candidateHash === currentCandidateHash;
  if (sameGlb || sameHash) fail("relabel", `${sameGlb && sameHash ? "lod1.glb and candidateHash" : sameGlb ? "lod1.glb" : "candidateHash"} identical to ${what} ${otherKey}; ${remedy}`);
}
if (acceptance) {
  for (const line of acceptance.excluded) {
    const otherKey = line.split(/[\s(]/)[0];
    const [otherSpecies, otherName] = otherKey.split("/");
    if (!SAFE_SEGMENT.test(otherSpecies ?? "") || !SAFE_SEGMENT.test(otherName ?? "")) continue;
    compareIdentity(otherKey, path.join(root, "art", "specimens", otherSpecies, "candidates", otherName), "excluded package", "a formally excluded build cannot be handed off under another name");
  }
}
if (fs.existsSync(candidatesRoot) && fs.statSync(candidatesRoot).isDirectory()) {
  for (const sibling of fs.readdirSync(candidatesRoot).sort()) {
    if (!SAFE_SEGMENT.test(sibling)) continue;
    compareIdentity(`${asset}/${sibling}`, path.join(candidatesRoot, sibling), "sibling candidate", "a successor must be a different build, and an existing build is handed off under its original name");
  }
}

// ----------------------------------------------------------------- dirty forbidden paths
const dirty = [];
let boundaryNote = "boundary audit FAILED";
const git = (cwd, gitArgs) => execFileSync("git", ["-C", cwd, ...gitArgs], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
try {
  const top = fs.realpathSync(git(root, ["rev-parse", "--show-toplevel"]).trim());
  const rel = path.relative(top, fs.realpathSync(root)).split(path.sep).join("/");
  if (rel.startsWith("..")) throw new Error(`${root} is outside the git worktree ${top}`);
  const prefix = rel ? `${rel}/` : "";
  const changed = new Set();
  const status = git(top, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]);
  const entries = status.split("\0").filter(Boolean);
  for (let index = 0; index < entries.length; index += 1) {
    const code = entries[index].slice(0, 2);
    changed.add(entries[index].slice(3));
    if (code[0] === "R" || code[0] === "C") changed.add(entries[++index]);
  }
  let baseSha = null;
  if (base !== null) {
    try {
      baseSha = git(top, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${base}^{commit}`]).trim();
    } catch {
      throw new Error(`--base ${base} does not resolve to a commit`);
    }
    if (!/^[0-9a-f]{40,64}$/.test(baseSha)) throw new Error(`--base resolved to an unexpected object ${baseSha}`);
    for (const file of git(top, ["diff", "--name-only", "--no-renames", baseSha, "HEAD", "--"]).split("\n")) if (file) changed.add(file);
  }
  const forbidden = (file) => {
    if (file === "js/specimenProfiles.js") return "compiled specimen profiles";
    if (!file.startsWith(prefix)) return null;
    const inner = file.slice(prefix.length);
    if (inner.startsWith("src/assets/specimens/")) return "runtime promotion bundle/registry";
    if (inner === "art/specimens/user-acceptance.v1.json") return "human acceptance record";
    if (RUNTIME_RESOLUTION.includes(inner)) return "runtime asset resolution";
    if (LEGACY_SCRIPTS.some((name) => inner === `scripts/specimens/${name}`)) return "accepted Ocellaris pipeline";
    const parts = inner.split("/");
    if (parts[0] === "art" && parts[1] === "specimens" && parts.length >= 4) {
      if (parts[3] === "candidates") return scope.has(parts[2]) ? null : `another species' candidate (${parts[2]}); pass --scope ${parts[2]} if it is in scope`;
      if (!(parts.length === 4 && SPEC_FILES.has(parts[3]))) return `accepted package file of ${parts[2]}`;
    }
    return null;
  };
  const shared = (file) => {
    if (!file.startsWith(prefix)) return null;
    const inner = file.slice(prefix.length);
    if (inner.startsWith("scripts/specimens/catalog/lib/") || inner.startsWith("scripts/specimens/catalog/plans/")) return "shared builder (rehashes every dependent candidate)";
    if (inner === "scripts/specimens/catalog/author.py" || inner === "scripts/specimens/catalog/validate.py") return "shared builder entrypoint";
    return null;
  };
  for (const file of [...changed].sort()) {
    const reason = forbidden(file);
    if (reason) { dirty.push(file); fail("boundary", `${file} is modified (${reason})`); continue; }
    const sharedReason = shared(file);
    if (sharedReason) warn("shared_change", `${file} is modified (${sharedReason})`);
  }
  boundaryNote = dirty.length ? `${dirty.length} forbidden path(s) dirty` : `no acceptance/promotion path dirty${baseSha ? ` (worktree + commits since ${baseSha.slice(0, 12)})` : " (worktree)"}`;
} catch (error) {
  fail("boundary_audit", `boundary audit could not complete: ${String(error.message).split("\n")[0]}`);
}

// ----------------------------------------------------------------- report
const failed = findings.filter((item) => item.level === "FAIL");
const roles = manifest ? manifest.clipRoles : (spec ? spec.clipRoles : {});
const clipLine = ["idle", "locomotion", "response"].map((role) => {
  const name = roles[role];
  const loop = manifest ? manifest.clipLoops[name] : undefined;
  const frames = contract ? contract.clips[name]?.frames : undefined;
  return `${role}=${name ?? "?"} ${loop === undefined ? "?" : loop ? "loop" : "one-shot"}${frames ? ` ${frames}f` : ""}`;
}).join(" | ");
// Same axis semantics as validate.py#source_gate: x | y | z | xy (max of x, y) | max.
const measured = (() => {
  if (!contract) return null;
  const extent = contract.restBounds.max.map((item, index) => item - contract.restBounds.min[index]);
  const byAxis = { x: extent[0], y: extent[1], z: extent[2], xy: Math.max(extent[0], extent[1]), max: Math.max(...extent) };
  return byAxis[contract.size.axis] ?? null;
})();
const evidence = {};
for (const source of references ? references.sources : []) evidence[source.evidenceClass ?? "unclassified"] = (evidence[source.evidenceClass ?? "unclassified"] || 0) + 1;
const gateCount = (report) => (report ? report.gates.length : 0);
const debt = spec?.visualDebt ?? [];

const summary = {
  candidate: key, variantId: manifest ? manifest.variantId ?? null : null, state: manifest ? manifest.candidate.state : null,
  candidateHash: receipt ? receipt.candidateHash : null, glbSha256: receipt ? receipt.candidateGlbHash : null, geometryDigest: receipt ? receipt.geometryDigest : null,
  gates: { source: receipt ? receipt.stages.source.status : null, runtime: receipt ? receipt.stages.runtime.status : null, determinism: receipt ? receipt.stages.determinism.status : null },
  referenceSize: spec ? spec.referenceSize : null, measured: measured === null ? null : { axis: contract.size.axis, meters: Number(measured.toFixed(5)), tolerance: contract.size.tolerance },
  clipRoles: roles, clipLoops: manifest ? manifest.clipLoops : null, statistics: manifest ? manifest.statistics : null,
  acceptedOcellarisHash: acceptedHash, acceptance: acceptanceState, runtime: runtimeState, dirtyForbiddenPaths: dirty,
  visualDebt: debt, provenance: evidence, findings, status: failed.length ? "failed" : "ready_for_human_review",
};

if (json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  const lines = [
    `candidate:        ${key} (variant ${summary.variantId ?? "none"})   state ${summary.state ?? "unknown"}`,
    `candidateHash:    ${summary.candidateHash ?? "n/a"}`,
    `lod1.glb sha256:  ${summary.glbSha256 ?? "n/a"}`,
    `geometryDigest:   ${summary.geometryDigest ?? "n/a"}`,
    `gates:            source ${summary.gates.source ?? "n/a"} (${gateCount(sourceReport)}) | runtime ${summary.gates.runtime ?? "n/a"} (${gateCount(runtimeReport)}) | determinism ${summary.gates.determinism ?? "n/a"}`,
    `size:             ${spec ? `${spec.referenceSize.meters} m ${spec.referenceSize.kind}` : "n/a"}${measured === null ? "" : `; measured ${measured.toFixed(4)} m (axis ${contract.size.axis}, tolerance ${Math.round(contract.size.tolerance * 100)}%)`}`,
    `clips:            ${clipLine}`,
    `statistics:       triangles ${manifest ? manifest.statistics.triangles ?? "?" : "?"} | deform bones ${manifest ? manifest.statistics.bones ?? "?" : "?"} | runtime bytes ${manifest ? manifest.statistics.runtimeBytes ?? "?" : "?"}`,
    `renders:          renders/three-view.png (side | top | front), renders/author-preview.png`,
    `workbench:        http://127.0.0.1:5173/?workbench=${asset}&candidate=${candidate}&scale=shared`,
    `provenance:       ${references ? references.sources.length : 0} sources${Object.keys(evidence).length ? ` (${Object.entries(evidence).map(([name, count]) => `${name} ${count}`).join(", ")})` : ""}`,
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
