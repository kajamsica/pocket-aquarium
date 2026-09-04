// Tests for candidate_handoff.mjs. Run: node --test .agents/skills/reef-specimen-asset-generation/scripts/
// Uses the committed catalog for positive cases and a throwaway git fixture under os.tmpdir() for
// mutations; never writes inside the repository.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "candidate_handoff.mjs");
const REAL_RLT = path.resolve(here, "..", "..", "..", "..", "realistic_light_transport");
const BRANCH_BASE = "9379fab4c7d35291d0bd29070440d96f7891c871";
const ASSET = "ocellaris";
const CANDIDATE = "fable-v2";
const LEGACY_SCRIPTS = ["build_ocellaris.sh", "author_specimen.py", "author_ocellaris.py", "validate_specimen.py",
  "validate_ocellaris.py", "promote_specimen.mjs", "compile_profiles.mjs"];
const REQUIRED_DOCS = ["candidate.manifest.json", "validation-receipt.json", "validation-source.json", "validation-runtime.json",
  "geometry-digest.json", "validation.contract.json", "build-receipt.json", "determinism.json"];

function run(extra, root = REAL_RLT) {
  const result = spawnSync(process.execPath, [SCRIPT, "--root", root, ...extra], { encoding: "utf8" });
  const codes = [...(result.stdout + result.stderr).matchAll(/^\s+(FAIL|WARN) ([a-z_]+):/gm)].map((m) => `${m[1]}:${m[2]}`);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, codes };
}
const forCandidate = (extra = [], root) => run(["--asset", ASSET, "--candidate", CANDIDATE, ...extra], root);
const has = (result, code) => result.codes.includes(code);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const editJson = (file, edit) => { const data = readJson(file); edit(data); fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`); };

// ---------------------------------------------------------------- real tree
test("real: ocellaris/fable-v2 is ready for human review", () => {
  const result = forCandidate(["--json"]);
  assert.equal(result.code, 0, result.stdout);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.status, "ready_for_human_review");
  assert.match(summary.candidateHash, /^[0-9a-f]{64}$/);
  assert.equal(summary.measured.axis, "x");
});

test("real: torch_coral variant is ready and measures the xy axis", () => {
  const result = run(["--asset", "torch_coral", "--candidate", "fable-v1-green_pink_tips", "--json"]);
  assert.equal(result.code, 0, result.stdout);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.variantId, "green_pink_tips");
  assert.equal(summary.measured.axis, "xy");
  assert.ok(Math.abs(summary.measured.meters - 0.12) <= 0.12 * 0.03);
});

test("real: every formally excluded candidate fails with excluded", () => {
  const acceptance = readJson(path.join(REAL_RLT, "art", "specimens", "user-acceptance.v1.json"));
  assert.ok(acceptance.excluded.length >= 4);
  for (const line of acceptance.excluded) {
    const [speciesId, candidate] = line.split(/[\s(]/)[0].split("/");
    const result = run(["--asset", speciesId, "--candidate", candidate]);
    assert.equal(result.code, 1, line);
    assert.ok(has(result, "FAIL:excluded"), `${line}: ${result.codes}`);
  }
});

test("real: --base with the branch base resolves and audits committed changes", () => {
  const result = forCandidate(["--base", BRANCH_BASE]);
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /commits since 9379fab4c7d3/);
});

test("base: nonexistent commit fails the boundary audit", () => {
  for (const base of ["deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", "no-such-branch", "HEAD..HEAD~1"]) {
    const result = forCandidate(["--base", base]);
    assert.equal(result.code, 1, base);
    assert.ok(has(result, "FAIL:boundary_audit"), `${base}: ${result.codes}`);
    assert.match(result.stdout, /boundary audit FAILED/);
  }
});

test("base: option-like or unsafe values are rejected before git runs", () => {
  for (const base of ["--output=/tmp/x", "-q", "HEAD HEAD", "HEAD;ls", "$(id)"]) {
    const result = forCandidate(["--base", base]);
    assert.equal(result.code, 2, base);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /candidate_handoff: /);
  }
});

test("names: dot segments, traversal, hidden and option-like names are rejected", () => {
  for (const name of ["..", ".", "../fable-v2", "fable-v2/..", "fable-v2/", ".fable", "fable.v2", "-fable", "fable v2", "FABLE-V2", ""]) {
    const result = run(["--asset", ASSET, "--candidate", name]);
    assert.equal(result.code, 2, JSON.stringify(name));
    assert.equal(result.stdout, "");
  }
  for (const name of ["../ocellaris", "ocellaris/..", ".ocellaris", "ocellaris.v1"]) {
    const result = run(["--asset", name, "--candidate", CANDIDATE]);
    assert.equal(result.code, 2, JSON.stringify(name));
  }
  assert.equal(run(["--asset", ASSET, "--candidate", CANDIDATE, "--scope", "../x"]).code, 2);
});

// ---------------------------------------------------------------- fixture
let work;
let rlt;
let cdir;
const git = (...gitArgs) => execFileSync("git", ["-C", work, "-c", "user.name=fixture", "-c", "user.email=fixture@test", ...gitArgs], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const inRlt = (...parts) => path.join(rlt, ...parts);
const write = (file, contents) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, contents); };
const copy = (relative) => { fs.mkdirSync(path.dirname(inRlt(relative)), { recursive: true }); fs.cpSync(path.join(REAL_RLT, relative), inRlt(relative), { recursive: true }); };
const reset = () => { git("checkout", "-q", "--", "."); git("clean", "-qfd"); };

before(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-fixture-"));
  rlt = path.join(work, "realistic_light_transport");
  cdir = inRlt("art", "specimens", ASSET, "candidates", CANDIDATE);
  for (const relative of [
    `art/specimens/${ASSET}/asset.source.json`, `art/specimens/${ASSET}/source-references.json`, `art/specimens/${ASSET}/specimen.package.json`,
    `art/specimens/${ASSET}/candidates/${CANDIDATE}`, "art/specimens/user-acceptance.v1.json", "art/toolchain.json",
    "src/assets/specimens/runtime-acceptance.v1.json", "src/assets/specimens/ocellaris/v1/lod1.glb",
  ]) copy(relative);
  fs.rmSync(path.join(cdir, "build.log"), { force: true });
  write(path.join(work, "js", "specimenProfiles.js"), "// fixture\n");
  write(inRlt("art", "specimens", ASSET, "ocellaris.asset.json"), "{}\n");
  write(inRlt("art", "specimens", ASSET, "textures", "body.png"), "png\n");
  write(inRlt("art", "specimens", "trochus_snail", "candidates", "fable-v1", "note.txt"), "fixture\n");
  for (const file of ["src/scene/specimens/assetRegistry.ts", "src/scene/specimens/assetRegistry.test.ts", "src/scene/SpecimenFish.tsx", "src/scene/SpecimenFish.test.ts",
    "scripts/specimens/catalog/lib/digest.py", "scripts/specimens/catalog/plans/fish.py", "scripts/specimens/catalog/author.py", "scripts/specimens/catalog/validate.py",
    "scripts/specimens/catalog/species/ocellaris.py", "src/catalog/visual-catalog.v1.json", ...LEGACY_SCRIPTS.map((name) => `scripts/specimens/${name}`)]) write(inRlt(file), "// fixture\n");
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture baseline");
});

after(() => {
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

function mutated(apply, extra = []) {
  try {
    apply();
    return forCandidate(extra, rlt);
  } finally {
    reset();
  }
}

test("fixture: baseline is ready", () => {
  const result = forCandidate([], rlt);
  assert.equal(result.code, 0, result.stdout);
});

test("fixture: missing, malformed, and shape-invalid required documents each fail explicitly", () => {
  for (const name of REQUIRED_DOCS) {
    const file = path.join(cdir, name);
    const missing = mutated(() => fs.rmSync(file));
    assert.equal(missing.code, 1, `${name} missing`);
    assert.ok(has(missing, "FAIL:missing_file"), `${name} missing: ${missing.codes}`);
    const malformed = mutated(() => fs.writeFileSync(file, "{"));
    assert.equal(malformed.code, 1, `${name} malformed`);
    assert.ok(has(malformed, "FAIL:malformed_json"), `${name} malformed: ${malformed.codes}`);
    for (const body of ["[]", "{}", "null", "\"text\""]) {
      const invalid = mutated(() => fs.writeFileSync(file, body));
      assert.equal(invalid.code, 1, `${name} ${body}`);
      assert.ok(has(invalid, "FAIL:schema"), `${name} ${body}: ${invalid.codes}`);
    }
  }
  for (const name of ["asset.source.json", "source-references.json"]) {
    const result = mutated(() => fs.writeFileSync(inRlt("art", "specimens", ASSET, name), "{"));
    assert.equal(result.code, 1, name);
    assert.ok(has(result, "FAIL:malformed_json"), `${name}: ${result.codes}`);
  }
});

test("fixture: malformed control records fail instead of downgrading", () => {
  const controls = [
    inRlt("art", "specimens", "user-acceptance.v1.json"), inRlt("src", "assets", "specimens", "runtime-acceptance.v1.json"),
    inRlt("art", "toolchain.json"), inRlt("art", "specimens", ASSET, "specimen.package.json"),
  ];
  for (const file of controls) {
    for (const body of ["{", "{}", "[]"]) {
      const result = mutated(() => fs.writeFileSync(file, body));
      assert.equal(result.code, 1, `${file} ${body}`);
      assert.ok(has(result, "FAIL:control_record"), `${file} ${body}: ${result.codes}`);
    }
    const missing = mutated(() => fs.rmSync(file));
    assert.ok(has(missing, "FAIL:control_record"), `${file} missing: ${missing.codes}`);
  }
  const shape = mutated(() => editJson(controls[0], (data) => { data.entries = "not-a-list"; }));
  assert.ok(has(shape, "FAIL:control_record"), shape.codes.join(" "));
  assert.match(shape.stdout, /acceptance record: unverifiable/);
  const runtimeShape = mutated(() => editJson(controls[1], (data) => { data.assets = [{ speciesId: "x" }]; }));
  assert.ok(has(runtimeShape, "FAIL:control_record"), runtimeShape.codes.join(" "));
  assert.match(runtimeShape.stdout, /runtime: unverifiable/);
});

test("fixture: an excluded package copied under a successor name fails", () => {
  const successor = "fable-v3";
  const copyPackage = () => fs.cpSync(cdir, path.join(path.dirname(cdir), successor), { recursive: true });
  const acceptanceFile = inRlt("art", "specimens", "user-acceptance.v1.json");
  // Relabel of a recorded candidate: identity binding and the acceptance record both catch it.
  const copyRun = (() => { try { copyPackage(); editJson(acceptanceFile, (data) => data.excluded.push(`${ASSET}/${CANDIDATE} (test exclusion)`)); return run(["--asset", ASSET, "--candidate", successor], rlt); } finally { reset(); } })();
  assert.equal(copyRun.code, 1, copyRun.stdout);
  assert.ok(has(copyRun, "FAIL:identity"), copyRun.codes.join(" "));
  assert.ok(has(copyRun, "FAIL:relabel"), copyRun.codes.join(" "));
  assert.match(copyRun.stdout, /build-receipt\.json#candidateDir/);
  // Relabel of an unrecorded candidate: identity binding alone must still catch it.
  const unrecorded = (() => {
    try {
      copyPackage();
      editJson(acceptanceFile, (data) => { data.entries = data.entries.filter((entry) => !(entry.speciesId === ASSET && entry.candidate === CANDIDATE)); });
      return run(["--asset", ASSET, "--candidate", successor], rlt);
    } finally { reset(); }
  })();
  assert.equal(unrecorded.code, 1, unrecorded.stdout);
  assert.ok(has(unrecorded, "FAIL:identity"), unrecorded.codes.join(" "));
  assert.ok(!has(unrecorded, "FAIL:relabel"));
});

test("fixture: a symlinked candidate directory fails", () => {
  const result = (() => {
    try { fs.symlinkSync(cdir, path.join(path.dirname(cdir), "fable-v9")); return run(["--asset", ASSET, "--candidate", "fable-v9"], rlt); } finally { reset(); }
  })();
  assert.equal(result.code, 1);
  assert.ok(has(result, "FAIL:unsafe_path"), result.codes.join(" "));
});

test("fixture: skipped or incoherent determinism fails", () => {
  const receiptFile = path.join(cdir, "validation-receipt.json");
  const manifestFile = path.join(cdir, "candidate.manifest.json");
  const determinismFile = path.join(cdir, "determinism.json");
  const skipped = mutated(() => {
    fs.rmSync(determinismFile);
    editJson(receiptFile, (data) => { data.stages.determinism.status = "not_run"; });
    editJson(manifestFile, (data) => { data.candidate.determinism = "not_run"; });
  });
  assert.equal(skipped.code, 1);
  assert.ok(has(skipped, "FAIL:missing_file") && has(skipped, "FAIL:determinism"), skipped.codes.join(" "));
  assert.ok(!skipped.codes.some((code) => code.startsWith("WARN:determinism")));
  const stale = mutated(() => editJson(determinismFile, (data) => { data.geometryDigest = "0".repeat(64); data.rebuildGeometryDigest = "0".repeat(64); }));
  assert.ok(has(stale, "FAIL:determinism"), stale.codes.join(" "));
  const flags = mutated(() => editJson(determinismFile, (data) => { data.textureHashMatch = false; }));
  assert.ok(has(flags, "FAIL:determinism"), flags.codes.join(" "));
  const failedStatus = mutated(() => editJson(determinismFile, (data) => { data.status = "failed"; }));
  assert.ok(has(failedStatus, "FAIL:determinism"), failedStatus.codes.join(" "));
  const textures = mutated(() => editJson(determinismFile, (data) => { delete data.textures["body-albedo.png"]; }));
  assert.ok(has(textures, "FAIL:determinism"), textures.codes.join(" "));
});

test("fixture: tampered package contents fail hash and state checks", () => {
  const glbFlip = mutated(() => { const file = path.join(cdir, "lod1.glb"); const bytes = fs.readFileSync(file); bytes[bytes.length - 1] ^= 0xff; fs.writeFileSync(file, bytes); });
  assert.ok(has(glbFlip, "FAIL:hash"), glbFlip.codes.join(" "));
  const staleSource = mutated(() => editJson(inRlt("art", "specimens", ASSET, "asset.source.json"), (data) => { data.visualDebt.push("edited after build"); }));
  assert.ok(has(staleSource, "FAIL:stale_source"), staleSource.codes.join(" "));
  const staleReferences = mutated(() => editJson(inRlt("art", "specimens", ASSET, "source-references.json"), (data) => { data.sources.push({ id: "X" }); }));
  assert.ok(has(staleReferences, "FAIL:stale_source"), staleReferences.codes.join(" "));
  const state = mutated(() => editJson(path.join(cdir, "candidate.manifest.json"), (data) => { data.candidate.state = "accepted"; }));
  assert.ok(has(state, "FAIL:state"), state.codes.join(" "));
  const performed = mutated(() => editJson(path.join(cdir, "validation-receipt.json"), (data) => { data.acceptance.performed = true; }));
  assert.ok(has(performed, "FAIL:state"), performed.codes.join(" "));
  const hash = mutated(() => editJson(path.join(cdir, "validation-receipt.json"), (data) => { data.candidateHash = "0".repeat(64); }));
  assert.ok(has(hash, "FAIL:hash"), hash.codes.join(" "));
  const texture = mutated(() => fs.writeFileSync(path.join(cdir, "textures", "extra.png"), "png"));
  assert.ok(has(texture, "FAIL:hash") && has(texture, "FAIL:determinism"), texture.codes.join(" "));
  const acceptance = mutated(() => editJson(inRlt("art", "specimens", "user-acceptance.v1.json"), (data) => {
    data.entries.find((entry) => entry.speciesId === ASSET && entry.candidate === CANDIDATE).glbSha256 = "1".repeat(64);
  }));
  assert.ok(has(acceptance, "FAIL:acceptance_hash_mismatch"), acceptance.codes.join(" "));
  const species = mutated(() => editJson(path.join(cdir, "build-receipt.json"), (data) => { data.asset = "other"; }));
  assert.ok(has(species, "FAIL:identity"), species.codes.join(" "));
  const accepted = mutated(() => fs.appendFileSync(inRlt("src", "assets", "specimens", "ocellaris", "v1", "lod1.glb"), Buffer.from([1])));
  assert.ok(has(accepted, "FAIL:accepted_ocellaris") && has(accepted, "FAIL:receipt_accepted_hash") && has(accepted, "FAIL:boundary"), accepted.codes.join(" "));
});

test("fixture: every protected path fails when dirty, including renames and untracked files", () => {
  const protectedFiles = [
    path.join(work, "js", "specimenProfiles.js"),
    inRlt("art", "specimens", "user-acceptance.v1.json"),
    inRlt("src", "assets", "specimens", "runtime-acceptance.v1.json"),
    inRlt("src", "assets", "specimens", "ocellaris", "v1", "lod1.glb"),
    inRlt("src", "scene", "specimens", "assetRegistry.ts"),
    inRlt("src", "scene", "specimens", "assetRegistry.test.ts"),
    inRlt("src", "scene", "SpecimenFish.tsx"),
    inRlt("src", "scene", "SpecimenFish.test.ts"),
    inRlt("art", "specimens", ASSET, "specimen.package.json"),
    inRlt("art", "specimens", ASSET, "ocellaris.asset.json"),
    inRlt("art", "specimens", ASSET, "textures", "body.png"),
    inRlt("art", "specimens", "trochus_snail", "candidates", "fable-v1", "note.txt"),
    ...LEGACY_SCRIPTS.map((name) => inRlt("scripts", "specimens", name)),
  ];
  assert.equal(protectedFiles.length, 19);
  for (const file of protectedFiles) {
    const result = mutated(() => fs.appendFileSync(file, "\n"));
    assert.equal(result.code, 1, file);
    assert.ok(has(result, "FAIL:boundary"), `${file}: ${result.codes}`);
    assert.match(result.stdout, /forbidden path\(s\) dirty/);
  }
  const untracked = mutated(() => write(inRlt("src", "assets", "specimens", "newfish", "v1", "lod1.glb"), "x"));
  assert.ok(has(untracked, "FAIL:boundary"), untracked.codes.join(" "));
  const renamedOut = mutated(() => git("mv", "realistic_light_transport/src/scene/SpecimenFish.test.ts", "realistic_light_transport/src/scene/Moved.test.ts"));
  assert.ok(has(renamedOut, "FAIL:boundary"), renamedOut.codes.join(" "));
  const renamedIn = mutated(() => git("mv", "-f", "realistic_light_transport/scripts/specimens/catalog/species/ocellaris.py", "realistic_light_transport/scripts/specimens/promote_specimen.mjs"));
  assert.ok(has(renamedIn, "FAIL:boundary"), renamedIn.codes.join(" "));
  const committed = (() => {
    try {
      fs.appendFileSync(inRlt("src", "scene", "SpecimenFish.test.ts"), "\n");
      git("commit", "-qam", "touch protected path");
      return forCandidate(["--base", "HEAD~1"], rlt);
    } finally { git("reset", "-q", "--hard", "HEAD~1"); reset(); }
  })();
  assert.ok(has(committed, "FAIL:boundary"), committed.codes.join(" "));
});

test("fixture: in-scope species, allowed paths and shared-library edits do not fail", () => {
  const scoped = mutated(() => fs.appendFileSync(inRlt("art", "specimens", "trochus_snail", "candidates", "fable-v1", "note.txt"), "\n"), ["--scope", "trochus_snail"]);
  assert.equal(scoped.code, 0, scoped.stdout);
  const allowed = mutated(() => {
    fs.appendFileSync(inRlt("scripts", "specimens", "catalog", "species", "ocellaris.py"), "\n");
    fs.appendFileSync(inRlt("src", "catalog", "visual-catalog.v1.json"), "\n");
  });
  assert.equal(allowed.code, 0, allowed.stdout);
  assert.equal(allowed.codes.length, 0);
  const shared = mutated(() => {
    fs.appendFileSync(inRlt("scripts", "specimens", "catalog", "lib", "digest.py"), "\n");
    fs.appendFileSync(inRlt("scripts", "specimens", "catalog", "author.py"), "\n");
  });
  assert.equal(shared.code, 0, shared.stdout);
  assert.deepEqual(shared.codes, ["WARN:shared_change", "WARN:shared_change"]);
});

test("fixture: a root outside any git worktree fails the boundary audit", () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-plain-"));
  try {
    fs.cpSync(rlt, path.join(plain, "realistic_light_transport"), { recursive: true });
    const result = forCandidate([], path.join(plain, "realistic_light_transport"));
    assert.equal(result.code, 1);
    assert.ok(has(result, "FAIL:boundary_audit"), result.codes.join(" "));
    assert.match(result.stdout, /boundary audit FAILED/);
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
  }
});
