/* Pocket Aquarium — native iOS host contract tests (IOS-1).
   Dependency-free: run with `node tests/native.test.js`. No test framework, no network,
   no package install — only Node built-ins. These are STATIC + deterministic checks that
   read bytes on disk and drive the real staging boundary against a disposable fixture.

   They assert the isolated `native/` Capacitor host is reproducible and safe:
     - exact Capacitor 8.5.1 pins and app identity/config (no remote server),
     - the staging allowlist matches the accepted Pages runtime artifact exactly,
     - path safety, stale cleanup, missing-file failure, and checksum repeatability,
     - forbidden bytes (icon master, invalid sprite, docs/tests/labs/reef) are never staged,
     - the generated iOS/SPM project is wired to capacitor-swift-pm 8.5.1,
     - no signing material or remote-server config is committed. */
"use strict";
var fs = require("fs");
var os = require("os");
var path = require("path");
var crypto = require("crypto");
var childProcess = require("child_process");
var pathToFileURL = require("url").pathToFileURL;

var ROOT = path.resolve(__dirname, "..");
var NATIVE = path.join(ROOT, "native");
var STAGE_SCRIPT = path.join(NATIVE, "scripts", "stage-web.mjs");

/* ------------------------------ tiny harness ------------------------------ */
var passed = 0, failed = 0, failures = [], curr = "";
function group(name) { curr = name; }
function ok(cond, msg) { if (cond) { passed++; } else { failed++; failures.push(curr + " :: " + msg); } }
function read(abs) { return fs.readFileSync(abs); }
function readText(abs) { return read(abs).toString("utf8"); }
function exists(abs) { try { fs.accessSync(abs); return true; } catch (e) { return false; } }
function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }
function pngSize(buf) {
  if (buf.length < 24) return null;
  if (buf.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
function eqArrays(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) return false; }
  return true;
}

/* The single source-of-truth allowlist the staging boundary must reproduce. It must
   equal the GitHub Pages runtime artifact: root shell + js/ + validated assets/. */
var EXPECTED_MANIFEST = [
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
];

function main(mod) {
  /* ------------------ 1. package + version pins ------------------ */
  group("native package pins");
  var pkg = JSON.parse(readText(path.join(NATIVE, "package.json")));
  ok(pkg.dependencies["@capacitor/core"] === "8.5.1", "@capacitor/core pinned exactly to 8.5.1");
  ok(pkg.dependencies["@capacitor/ios"] === "8.5.1", "@capacitor/ios pinned exactly to 8.5.1");
  ok(pkg.devDependencies["@capacitor/cli"] === "8.5.1", "@capacitor/cli pinned exactly to 8.5.1");
  ok(pkg.type === "module", "native package is an ESM module");
  ok(exists(path.join(NATIVE, "package-lock.json")), "committed package-lock.json exists");
  var lock = JSON.parse(readText(path.join(NATIVE, "package-lock.json")));
  ok(lock.lockfileVersion >= 2, "lockfile is v2+ (reproducible npm ci)");

  /* ------------------ 2. capacitor config (no remote server) ------------------ */
  group("capacitor config");
  var cfg = JSON.parse(readText(path.join(NATIVE, "capacitor.config.json")));
  ok(cfg.appName === "Pocket Aquarium", "appName is 'Pocket Aquarium'");
  ok(cfg.appId === "com.kajamsica.pocketaquarium", "appId is com.kajamsica.pocketaquarium");
  ok(cfg.webDir === "www", "webDir is www");
  ok(!("server" in cfg), "config declares NO server block (no remote runtime URL)");

  /* ------------------ 3. exact staging manifest ------------------ */
  group("staging manifest");
  ok(Array.isArray(mod.MANIFEST), "stage-web exports a MANIFEST array");
  ok(eqArrays(mod.MANIFEST.slice(), EXPECTED_MANIFEST), "MANIFEST equals the 16-file Pages runtime allowlist exactly");
  ok(mod.MANIFEST.length === 16, "MANIFEST has exactly 16 entries");
  // Every allowlisted source must exist at the repo root.
  EXPECTED_MANIFEST.forEach(function (rel) { ok(exists(path.join(ROOT, rel)), "root source exists: " + rel); });

  /* ------------------ 4. path safety ------------------ */
  group("path safety");
  ok(typeof mod.isSafeRelative === "function", "stage-web exports isSafeRelative");
  ok(mod.isSafeRelative("assets/icons/icon-192.png") === true, "accepts a normal relative path");
  ok(mod.isSafeRelative("/etc/passwd") === false, "rejects an absolute path");
  ok(mod.isSafeRelative("../secret") === false, "rejects a parent-escaping path");
  ok(mod.isSafeRelative("js/../../x") === false, "rejects an embedded .. segment");
  ok(mod.isSafeRelative("") === false, "rejects an empty path");
  ok(EXPECTED_MANIFEST.every(mod.isSafeRelative), "every manifest entry is a safe relative path");

  /* ------------------ 5. deterministic staging + repeatability ------------------ */
  group("staging determinism");
  var dest1 = fs.mkdtempSync(path.join(os.tmpdir(), "pa-stage-"));
  var r1 = mod.stage({ src: ROOT, dest: dest1, log: function () {} });
  var r2 = mod.stage({ src: ROOT, dest: dest1, log: function () {} });
  ok(r1.count === 16, "stage reports 16 files");
  ok(/^[0-9a-f]{64}$/.test(r1.checksum), "stage returns a sha256 checksum receipt");
  ok(r1.checksum === r2.checksum, "checksum is stable across repeated staging (deterministic)");
  // Staged bytes are byte-identical to the root runtime.
  var byteFail = null;
  EXPECTED_MANIFEST.forEach(function (rel) {
    var a = sha256(read(path.join(ROOT, rel)));
    var b = sha256(read(path.join(dest1, rel)));
    if (a !== b) byteFail = rel;
  });
  ok(byteFail === null, "staged bytes are identical to the root runtime" + (byteFail ? " (mismatch: " + byteFail + ")" : ""));
  // Every receipt entry carries a matching checksum for tests to pin.
  ok(r1.files.length === 16 && r1.files.every(function (f) { return /^[0-9a-f]{64}$/.test(f.sha256); }),
    "receipt lists a per-file checksum for all 16 files");

  /* ------------------ 6. stale cleanup ------------------ */
  group("stale cleanup");
  fs.writeFileSync(path.join(dest1, "stale-sentinel.txt"), "STALE");
  fs.mkdirSync(path.join(dest1, "js", "orphan"), { recursive: true });
  fs.writeFileSync(path.join(dest1, "js", "orphan", "old.js"), "x");
  mod.stage({ src: ROOT, dest: dest1, log: function () {} });
  ok(!exists(path.join(dest1, "stale-sentinel.txt")), "stale top-level file is removed on restage");
  ok(!exists(path.join(dest1, "js", "orphan")), "stale orphan directory is removed on restage");

  /* ------------------ 7. forbidden files never staged ------------------ */
  group("forbidden exclusions");
  var FORBIDDEN = [
    "assets/icons/app-icon-master-v1.png",
    "assets/animals/ocellaris-clownfish-v1.png"
  ];
  FORBIDDEN.forEach(function (rel) {
    ok(EXPECTED_MANIFEST.indexOf(rel) < 0, "manifest excludes forbidden " + rel);
    ok(!exists(path.join(dest1, rel)), "forbidden file not staged: " + rel);
  });
  // Whole-directory exclusions: docs/tests/labs/reef and git metadata never appear.
  ["docs", "tests", "labs", "reef", ".git", ".github"].forEach(function (d) {
    ok(!exists(path.join(dest1, d)), "no '" + d + "' directory staged");
  });
  // The staged tree contains EXACTLY the allowlist and nothing else.
  var stagedFiles = [];
  (function walk(dir, base) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      var rel = base ? base + "/" + e.name : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel);
      else stagedFiles.push(rel);
    });
  })(dest1, "");
  ok(eqArrays(stagedFiles.sort(), EXPECTED_MANIFEST.slice().sort()), "staged tree is exactly the allowlist, nothing extra");

  /* ------------------ 8. missing-file failure (disposable fixture) ------------------ */
  group("missing-file failure");
  var fixSrc = fs.mkdtempSync(path.join(os.tmpdir(), "pa-fixsrc-"));
  var fixDest = fs.mkdtempSync(path.join(os.tmpdir(), "pa-fixdest-"));
  // Populate all-but-one allowlisted files so the run must fail loudly on the gap.
  EXPECTED_MANIFEST.slice(1).forEach(function (rel) {
    var to = path.join(fixSrc, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, "stub");
  });
  var failedAsExpected = false, stderr = "";
  try {
    childProcess.execFileSync("node", [STAGE_SCRIPT, "--src", fixSrc, "--dest", fixDest],
      { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    failedAsExpected = true;
    stderr = (e.stderr || "").toString();
  }
  ok(failedAsExpected, "staging exits non-zero when an allowlisted file is missing");
  ok(/missing allowlisted/.test(stderr), "failure message names the missing allowlisted file");
  // A failed run must not leave a half-built destination behind.
  ok(!exists(path.join(fixDest, "styles.css")), "no partial destination is written on failure");

  /* ------------------ 9. generated iOS / SPM project wiring ------------------ */
  group("generated iOS project");
  var iosApp = path.join(NATIVE, "ios", "App");
  ok(exists(path.join(iosApp, "App.xcodeproj", "project.pbxproj")), "Xcode project.pbxproj is committed");
  ok(exists(path.join(iosApp, "App", "AppDelegate.swift")), "App sources are committed (AppDelegate.swift)");
  var pkgSwift = readText(path.join(iosApp, "CapApp-SPM", "Package.swift"));
  ok(/capacitor-swift-pm/.test(pkgSwift), "Package.swift wires the capacitor-swift-pm SPM package");
  ok(/exact:\s*"8\.5\.1"/.test(pkgSwift), "Package.swift pins capacitor-swift-pm exactly to 8.5.1");
  ok(/product\(name:\s*"Capacitor"/.test(pkgSwift), "Package.swift depends on the Capacitor product");
  // App icon is a derivative of the preserved master: 1024x1024, no runtime web bytes duplicated.
  var iconPath = path.join(iosApp, "App", "Assets.xcassets", "AppIcon.appiconset", "AppIcon-512@2x.png");
  ok(exists(iconPath), "generated AppIcon exists");
  var iconSize = pngSize(read(iconPath));
  ok(iconSize && iconSize.width === 1024 && iconSize.height === 1024, "AppIcon is 1024x1024");
  // It must differ from the untouched master (a real derivative) while the master is preserved.
  var master = read(path.join(ROOT, "assets", "icons", "app-icon-master-v1.png"));
  ok(sha256(read(iconPath)) !== sha256(master), "AppIcon is a resized derivative, not a byte copy of the master");
  var masterSize = pngSize(master);
  ok(masterSize && masterSize.width === 1254 && masterSize.height === 1254, "root icon master is preserved at 1254x1254");

  /* ------------------ 10. ignore boundary: no committed generated web / secrets ------------------ */
  group("ignore boundary");
  var iosIgnore = readText(path.join(NATIVE, "ios", ".gitignore"));
  ok(/App\/App\/public/.test(iosIgnore), "ios/.gitignore excludes the copied web assets (App/App/public)");
  ok(/capacitor\.config\.json/.test(iosIgnore), "ios/.gitignore excludes the generated capacitor.config.json copy");
  ok(/DerivedData/.test(iosIgnore), "ios/.gitignore excludes DerivedData/builds");
  var nativeIgnore = readText(path.join(NATIVE, ".gitignore"));
  ok(/node_modules/.test(nativeIgnore), "native/.gitignore excludes node_modules");
  ok(/^www\/?$/m.test(nativeIgnore), "native/.gitignore excludes the staged www");
  ok(/mobileprovision/.test(nativeIgnore) && /\*\.p12/.test(nativeIgnore), "native/.gitignore excludes signing material");
  // The generated public copy must NOT be committed alongside the source runtime.
  ok(!fs.existsSync(path.join(iosApp, "App", "public")) ||
     childProcessIgnored(path.join(NATIVE, "ios", "App", "App", "public")),
    "copied web assets (ios/App/App/public) are git-ignored, not committed");

  /* cleanup temp dirs */
  [dest1, fixSrc, fixDest].forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
}

/* Ask git whether a path is ignored; treat a git failure as "not committed" is unsafe,
   so only return true on an explicit ignore result. */
function childProcessIgnored(abs) {
  try {
    childProcess.execFileSync("git", ["check-ignore", "-q", abs], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch (e) {
    return false;
  }
}

/* ------------------------------ run (ESM import bridge) ------------------------------ */
import(pathToFileURL(STAGE_SCRIPT).href).then(function (mod) {
  main(mod);
  console.log("\n=================== Pocket Aquarium native tests ===================");
  console.log("passed: " + passed + "   failed: " + failed + "   total: " + (passed + failed));
  if (failed) {
    console.log("\nFAILURES:");
    failures.forEach(function (f, i) { console.log("  " + (i + 1) + ". " + f); });
    process.exit(1);
  } else {
    console.log("ALL PASSED");
    process.exit(0);
  }
}).catch(function (err) {
  console.error("native.test.js failed to load staging module: " + (err && err.stack || err));
  process.exit(1);
});
