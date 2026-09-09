/* Pocket Aquarium native iOS and Android Capacitor host contract tests.
   Dependency-free: run with `node tests/native.test.js`. No test framework, no network,
   no package install — only Node built-ins. These are STATIC + deterministic checks that
   read bytes on disk and drive the real staging boundary against a disposable fixture.

   They assert the isolated `native/` Capacitor host is reproducible and safe:
     - exact Capacitor 8.5.1 pins and app identity/config (no remote server),
     - the staged tree matches the compiled Three.js Pages artifact exactly,
     - path safety, stale cleanup, missing-file failure, and checksum repeatability,
     - forbidden bytes (icon master, invalid sprite, docs/tests/labs/reef) are never staged,
     - generated iOS/SPM and Android projects preserve the app identity and host boundary,
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
var WEB_DIST = path.join(ROOT, "realistic_light_transport", "dist");

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

function listFiles(root) {
  var files = [];
  (function walk(dir, base) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
      var rel = base ? base + "/" + entry.name : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else files.push(rel);
    });
  })(root, "");
  return files.sort();
}

function main(mod) {
  /* ------------------ 1. package + version pins ------------------ */
  group("native package pins");
  var pkg = JSON.parse(readText(path.join(NATIVE, "package.json")));
  ok(pkg.dependencies["@capacitor/core"] === "8.5.1", "@capacitor/core pinned exactly to 8.5.1");
  ok(pkg.dependencies["@capacitor/ios"] === "8.5.1", "@capacitor/ios pinned exactly to 8.5.1");
  ok(pkg.dependencies["@capacitor/android"] === "8.5.1", "@capacitor/android pinned exactly to 8.5.1");
  ok(pkg.devDependencies["@capacitor/cli"] === "8.5.1", "@capacitor/cli pinned exactly to 8.5.1");
  ok(pkg.type === "module", "native package is an ESM module");
  ok(/realistic_light_transport/.test(pkg.scripts["build:web"] || ""), "build:web compiles the Three.js product source");
  ok(/build:web/.test(pkg.scripts["sync:fresh"] || "") && /sync/.test(pkg.scripts["sync:fresh"] || ""), "sync:fresh builds then syncs one accepted runtime");
  ok(exists(path.join(NATIVE, "package-lock.json")), "committed package-lock.json exists");
  var lock = JSON.parse(readText(path.join(NATIVE, "package-lock.json")));
  ok(lock.lockfileVersion >= 2, "lockfile is v2+ (reproducible npm ci)");
  ok(lock.packages[""].dependencies["@capacitor/android"] === "8.5.1", "lockfile root pins @capacitor/android exactly to 8.5.1");
  ok(/^node scripts\/stage-web\.mjs && cap sync android$/.test(pkg.scripts["sync:android"] || ""), "sync:android stages then syncs Android");
  ok(/^npm run build:web && npm run sync:android$/.test(pkg.scripts["sync:fresh:android"] || ""), "sync:fresh:android builds web before Android sync");
  ok(/^cap open android$/.test(pkg.scripts["open:android"] || ""), "open:android opens Android");
  ok(/cap sync ios$/.test(pkg.scripts.sync || ""), "sync continues to target iOS");
  ok(/build:web/.test(pkg.scripts["sync:fresh"] || "") && /npm run sync$/.test(pkg.scripts["sync:fresh"] || ""), "sync:fresh continues to build then sync iOS");
  ok(/^cap open ios$/.test(pkg.scripts.open || ""), "open continues to target iOS");

  /* ------------------ 2. capacitor config (no remote server) ------------------ */
  group("capacitor config");
  var cfg = JSON.parse(readText(path.join(NATIVE, "capacitor.config.json")));
  ok(cfg.appName === "Pocket Aquarium", "appName is 'Pocket Aquarium'");
  ok(cfg.appId === "com.kajamsica.pocketaquarium", "appId is com.kajamsica.pocketaquarium");
  ok(cfg.webDir === "www", "webDir is www");
  ok(!("server" in cfg), "config declares NO server block (no remote runtime URL)");

  /* ------------------ 3. exact compiled artifact manifest ------------------ */
  group("staging manifest");
  ok(typeof mod.manifestFor === "function", "stage-web exports compiled-artifact discovery");
  ok(exists(WEB_DIST), "Three.js dist exists before native packaging tests");
  var expectedManifest = mod.manifestFor(WEB_DIST);
  ok(eqArrays(expectedManifest, listFiles(WEB_DIST)), "manifest is every and only file produced by Vite");
  ok(expectedManifest.indexOf("index.html") >= 0, "compiled entrypoint is staged");
  ok(expectedManifest.some(function (rel) { return /^assets\/index-[^/]+\.js$/.test(rel); }), "hashed Three.js JavaScript bundle is staged");
  ok(expectedManifest.some(function (rel) { return /^assets\/index-[^/]+\.css$/.test(rel); }), "hashed player HUD stylesheet is staged");
  ok(expectedManifest.some(function (rel) { return /\.glb$/.test(rel); }), "accepted rigged fish asset is staged");

  /* ------------------ 4. path safety ------------------ */
  group("path safety");
  ok(typeof mod.isSafeRelative === "function", "stage-web exports isSafeRelative");
  ok(mod.isSafeRelative("assets/icons/icon-192.png") === true, "accepts a normal relative path");
  ok(mod.isSafeRelative("/etc/passwd") === false, "rejects an absolute path");
  ok(mod.isSafeRelative("../secret") === false, "rejects a parent-escaping path");
  ok(mod.isSafeRelative("js/../../x") === false, "rejects an embedded .. segment");
  ok(mod.isSafeRelative("") === false, "rejects an empty path");
  ok(expectedManifest.every(mod.isSafeRelative), "every compiled artifact path is safe and relative");

  /* ------------------ 5. deterministic staging + repeatability ------------------ */
  group("staging determinism");
  var dest1 = fs.mkdtempSync(path.join(os.tmpdir(), "pa-stage-"));
  var r1 = mod.stage({ src: WEB_DIST, dest: dest1, log: function () {} });
  var r2 = mod.stage({ src: WEB_DIST, dest: dest1, log: function () {} });
  ok(r1.count === expectedManifest.length, "stage reports every Vite artifact file");
  ok(/^[0-9a-f]{64}$/.test(r1.checksum), "stage returns a sha256 checksum receipt");
  ok(r1.checksum === r2.checksum, "checksum is stable across repeated staging (deterministic)");
  // Staged bytes are byte-identical to the root runtime.
  var byteFail = null;
  expectedManifest.forEach(function (rel) {
    var a = sha256(read(path.join(WEB_DIST, rel)));
    var b = sha256(read(path.join(dest1, rel)));
    if (a !== b) byteFail = rel;
  });
  ok(byteFail === null, "staged bytes are identical to the root runtime" + (byteFail ? " (mismatch: " + byteFail + ")" : ""));
  // Every receipt entry carries a matching checksum for tests to pin.
  ok(r1.files.length === expectedManifest.length && r1.files.every(function (f) { return /^[0-9a-f]{64}$/.test(f.sha256); }),
    "receipt lists a per-file checksum for every compiled file");

  /* ------------------ 6. stale cleanup ------------------ */
  group("stale cleanup");
  fs.writeFileSync(path.join(dest1, "stale-sentinel.txt"), "STALE");
  fs.mkdirSync(path.join(dest1, "assets", "orphan"), { recursive: true });
  fs.writeFileSync(path.join(dest1, "assets", "orphan", "old.js"), "x");
  mod.stage({ src: WEB_DIST, dest: dest1, log: function () {} });
  ok(!exists(path.join(dest1, "stale-sentinel.txt")), "stale top-level file is removed on restage");
  ok(!exists(path.join(dest1, "assets", "orphan")), "stale orphan directory is removed on restage");

  /* ------------------ 7. forbidden files never staged ------------------ */
  group("forbidden exclusions");
  // Source and repository-only directories never appear in the Vite release artifact.
  ["docs", "tests", "labs", "reef", "src", "js", ".git", ".github"].forEach(function (d) {
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
  ok(eqArrays(stagedFiles.sort(), expectedManifest.slice().sort()), "native tree is byte-for-byte the Pages input artifact, nothing extra");

  /* ------------------ 8. missing-file failure (disposable fixture) ------------------ */
  group("missing-file failure");
  var fixSrc = fs.mkdtempSync(path.join(os.tmpdir(), "pa-fixsrc-"));
  var fixDest = fs.mkdtempSync(path.join(os.tmpdir(), "pa-fixdest-"));
  fs.writeFileSync(path.join(fixSrc, "index.html"), "stub");
  fs.writeFileSync(path.join(fixDest, "previous-good-build.txt"), "keep until input validates");
  var failedAsExpected = false, stderr = "";
  try {
    childProcess.execFileSync("node", [STAGE_SCRIPT, "--src", fixSrc, "--dest", fixDest],
      { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    failedAsExpected = true;
    stderr = (e.stderr || "").toString();
  }
  ok(failedAsExpected, "staging exits non-zero when an allowlisted file is missing");
  ok(/missing compiled/.test(stderr), "failure names the missing compiled bundle");
  // Invalid input is checked before the previous staged app is removed.
  ok(exists(path.join(fixDest, "previous-good-build.txt")), "failed input does not destroy the previous good native bundle");

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

  /* ------------------ 10. generated Android project wiring ------------------ */
  group("generated Android project");
  var trackedFiles = childProcess.execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n");
  var androidMain = "native/android/app/src/main/java/com/kajamsica/pocketaquarium/MainActivity.java";
  [
    "native/android/settings.gradle",
    "native/android/app/build.gradle",
    "native/android/app/src/main/AndroidManifest.xml",
    androidMain
  ].forEach(function (rel) { ok(trackedFiles.indexOf(rel) >= 0, rel + " is committed"); });
  var androidSettings = readText(path.join(NATIVE, "android", "settings.gradle"));
  var androidGradle = readText(path.join(NATIVE, "android", "app", "build.gradle"));
  var androidManifest = readText(path.join(NATIVE, "android", "app", "src", "main", "AndroidManifest.xml"));
  var mainActivity = readText(path.join(ROOT, androidMain));
  ok(/include\s+['"]:app['"]/.test(androidSettings), "Android settings include the app project");
  ok(/namespace\s*=\s*["']com\.kajamsica\.pocketaquarium["']/.test(androidGradle), "Android namespace matches the Capacitor app ID");
  ok(/applicationId\s+["']com\.kajamsica\.pocketaquarium["']/.test(androidGradle), "Android application ID matches the Capacitor app ID");
  ok(/android:name=["']\.MainActivity["']/.test(androidManifest), "manifest resolves .MainActivity within the app package");
  ok(/^package com\.kajamsica\.pocketaquarium;/m.test(mainActivity), "MainActivity package matches its committed Java path");
  ok(/import com\.getcapacitor\.BridgeActivity;/.test(mainActivity), "MainActivity imports Capacitor BridgeActivity");
  ok(/public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{\s*\}/.test(mainActivity), "MainActivity is an empty Capacitor BridgeActivity host");

  /* ------------------ 11. ignore boundary: no committed generated web / secrets ------------------ */
  group("ignore boundary");
  var iosIgnore = readText(path.join(NATIVE, "ios", ".gitignore"));
  ok(/App\/App\/public/.test(iosIgnore), "ios/.gitignore excludes the copied web assets (App/App/public)");
  ok(/capacitor\.config\.json/.test(iosIgnore), "ios/.gitignore excludes the generated capacitor.config.json copy");
  ok(/DerivedData/.test(iosIgnore), "ios/.gitignore excludes DerivedData/builds");
  var nativeIgnore = readText(path.join(NATIVE, ".gitignore"));
  ok(/node_modules/.test(nativeIgnore), "native/.gitignore excludes node_modules");
  ok(/^www\/?$/m.test(nativeIgnore), "native/.gitignore excludes the staged www");
  ok(/mobileprovision/.test(nativeIgnore) && /\*\.p12/.test(nativeIgnore), "native/.gitignore excludes signing material");
  var androidIgnore = readText(path.join(NATIVE, "android", ".gitignore"));
  ok(/app\/src\/main\/assets\/public/.test(androidIgnore), "android/.gitignore excludes copied web assets");
  ok(/^build\/$/m.test(androidIgnore) && /^\.gradle\/$/m.test(androidIgnore), "android/.gitignore excludes build and Gradle output");
  ok(/^local\.properties$/m.test(androidIgnore), "android/.gitignore excludes the local Android SDK path");
  ok(/android\/\*\*\/\*\.jks/.test(nativeIgnore) && /android\/\*\*\/\*\.keystore/.test(nativeIgnore), "native/.gitignore excludes Android keystores");
  ok(/keystore\.properties/.test(nativeIgnore) && /signing\.properties/.test(nativeIgnore), "native/.gitignore excludes Android signing properties");
  [
    "native/android/local.properties",
    "native/android/app/build/output.apk",
    "native/android/app/release-key.jks",
    "native/android/app/release-key.keystore",
    "native/android/keystore.properties",
    "native/android/signing.properties",
    "native/android/app/src/main/assets/public/index.html"
  ].forEach(function (rel) { ok(childProcessIgnored(path.join(ROOT, rel)), rel + " is git-ignored"); });
  ok(!trackedFiles.some(function (rel) { return /^native\/android\/(?:.*\/)?(?:local\.properties|keystore(?:\.[^/]+)?|[^/]+\.(?:jks|keystore)|signing\.properties)$/.test(rel); }),
    "no Android SDK or signing material is committed");
  ok(!trackedFiles.some(function (rel) { return rel === "native/www" || /^native\/www\//.test(rel) || /^native\/android\/app\/src\/main\/assets\/public\//.test(rel); }),
    "no staged native or Android public runtime bytes are committed");
  ok(trackedFiles.indexOf("native/android/app/src/main/assets/capacitor.config.json") < 0 && !("server" in cfg),
    "no generated or remote Capacitor server configuration is committed");
  // The generated public copy must NOT be committed alongside the source runtime.
  ok(!fs.existsSync(path.join(iosApp, "App", "public")) ||
     childProcessIgnored(path.join(NATIVE, "ios", "App", "App", "public")),
    "copied web assets (ios/App/App/public) are git-ignored, not committed");

  /* ------------------ 12. protected TestFlight release contract ------------------ */
  group("TestFlight release workflow");
  var workflow = readText(path.join(ROOT, ".github", "workflows", "ios.yml"));
  var testflight = workflow.split(/\n  testflight:\s*\n/)[1] || "";
  ok(/\n  workflow_dispatch:\s*(?:\n|$)/.test(workflow), "native workflow supports deliberate manual dispatch");
  ok(/if:\s*\$\{\{\s*github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'\s*\}\}/.test(testflight),
    "TestFlight upload runs only for a manual dispatch on main");
  ok(/environment:\s*apple-testflight/.test(testflight), "TestFlight job uses the protected apple-testflight environment");
  [
    "APPLE_TEAM_ID", "APP_STORE_CONNECT_KEY_ID", "APP_STORE_CONNECT_ISSUER_ID",
    "APP_STORE_CONNECT_API_KEY_P8_BASE64", "IOS_DISTRIBUTION_CERTIFICATE_BASE64",
    "IOS_DISTRIBUTION_CERTIFICATE_PASSWORD", "IOS_APP_STORE_PROVISIONING_PROFILE_BASE64"
  ].forEach(function (name) {
    ok(testflight.indexOf(name + ": ${{ secrets." + name + " }}") >= 0, "TestFlight job requires protected " + name);
  });
  ok(/PRODUCT_BUNDLE_IDENTIFIER=com\.kajamsica\.pocketaquarium/.test(testflight), "signed archive uses the exact app bundle ID");
  ok(/working-directory:\s*native\s*\n\s*run:\s*npm run sync(?:\s|$)/.test(testflight), "TestFlight stages through the same local iOS sync path");
  ok(/xcodebuild[\s\S]*?archive[\s\S]*?xcodebuild -exportArchive/.test(testflight), "TestFlight job archives and exports the App Store build");
  ok(/altool --validate-app/.test(testflight) && /altool --upload-app/.test(testflight), "TestFlight job validates then uploads the IPA");
  ok(/CURRENT_PROJECT_VERSION="\$\{\{ github\.run_number \}\}"/.test(testflight), "each upload uses the unique GitHub run number as its build number");
  ok(/RUNNER_TEMP\/pocket-aquarium-testflight\.keychain-db/.test(testflight) && /security create-keychain/.test(testflight),
    "signing certificate is imported into an ephemeral runner keychain");
  ok(/IOS_PROFILE_PATH=.*profile_path/.test(testflight) && /install -m 600.*mobileprovision/.test(testflight),
    "provisioning profile is validated and installed ephemerally");
  ok(/IOS_API_KEY_PATH=.*api_key_path/.test(testflight) && /install -m 600.*AuthKey\.p8/.test(testflight),
    "App Store Connect API key is installed ephemerally");
  ok(/Remove signing credentials and release outputs[\s\S]*?if:\s*always\(\)[\s\S]*?delete-keychain[\s\S]*?rm -rf/.test(testflight),
    "signing credentials and release outputs are always removed");
  ok(!/actions\/upload-artifact/.test(testflight), "signed IPA is never uploaded as a GitHub artifact");
  ok(/\n  build:\s*\n[\s\S]*?name:\s*Build unsigned iOS simulator app/.test(workflow), "unsigned iOS Simulator job remains present");
  ok(/\n  android:\s*\n[\s\S]*?name:\s*Build installable Android debug APK/.test(workflow), "Android debug APK job remains present");

  group("TestFlight deployment documentation");
  var iosDocs = readText(path.join(ROOT, "docs", "IOS_DEPLOYMENT.md"));
  ok(/protected GitHub environment \*\*`apple-testflight`\*\*/.test(iosDocs), "deployment guide names the protected environment");
  ok(/No signed IPA or TestFlight build exists yet/i.test(iosDocs), "deployment guide explicitly says no signed/TestFlight build exists yet");

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
