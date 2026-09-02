/* Pocket Aquarium — installable-PWA static contract tests (PAIOS-02).
   Dependency-free: run with `node tests/pwa.test.js`. No test framework, no network,
   no package install — only Node's built-in fs/path to read the shipped files and
   assert the manifest, service worker, icon derivatives, subpath-safety, index wiring,
   and the iPhone safe-area / accessibility hooks are all present and internally consistent.

   These are STATIC checks: they read bytes on disk. They deliberately do NOT execute the
   browser app (that needs a DOM) — the deterministic model is covered by tests/sim.test.js. */
"use strict";
var fs = require("fs");
var path = require("path");
var ROOT = path.resolve(__dirname, "..");

/* ------------------------------ tiny harness ------------------------------ */
var passed = 0, failed = 0, failures = [], curr = "";
function group(name) { curr = name; }
function ok(cond, msg) { if (cond) { passed++; } else { failed++; failures.push(curr + " :: " + msg); } }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel)); }
function readText(rel) { return read(rel).toString("utf8"); }
function exists(rel) { try { fs.accessSync(path.join(ROOT, rel)); return true; } catch (e) { return false; } }
function pngSize(buf) {
  // PNG = 8-byte signature, then IHDR: length(4) + "IHDR"(4) + width(4)@16 + height(4)@20.
  if (buf.length < 24) return null;
  if (buf.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
function relative(u) { return typeof u === "string" && u.charAt(0) !== "/" && !/^https?:/i.test(u); }

/* ------------------------------ 1. required files ------------------------------ */
group("files present");
var REQUIRED = [
  "index.html", "styles.css", "js/app.js", "sw.js", "manifest.webmanifest",
  "assets/icons/app-icon-master-v1.png",
  "assets/icons/icon-192.png", "assets/icons/icon-512.png", "assets/icons/apple-touch-icon.png"
];
REQUIRED.forEach(function (f) { ok(exists(f), f + " exists"); });

/* ------------------------------ 2. manifest ------------------------------ */
group("manifest");
var manifest = null;
try { manifest = JSON.parse(readText("manifest.webmanifest")); ok(true, "manifest.webmanifest is valid JSON"); }
catch (e) { ok(false, "manifest.webmanifest is valid JSON (" + e.message + ")"); }
if (manifest) {
  ok(typeof manifest.name === "string" && manifest.name.length > 0, "manifest has a name");
  ok(manifest.display === "standalone", "manifest display is standalone");
  ok(relative(manifest.start_url), "start_url is relative (subpath-safe under /pocket-aquarium/)");
  ok(relative(manifest.scope), "scope is relative (subpath-safe)");
  ok(typeof manifest.theme_color === "string" && manifest.theme_color.length > 0, "manifest has a theme_color");
  ok(typeof manifest.background_color === "string" && manifest.background_color.length > 0, "manifest has a background_color");
  ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2, "manifest declares at least two icons");
  var sizes = (manifest.icons || []).map(function (i) { return i.sizes; });
  ok(sizes.indexOf("192x192") >= 0, "manifest declares a 192x192 icon");
  ok(sizes.indexOf("512x512") >= 0, "manifest declares a 512x512 icon");
  (manifest.icons || []).forEach(function (i) { ok(relative(i.src), "manifest icon src is relative: " + i.src); });
}

/* ------------------------------ 3. icon derivatives ------------------------------ */
group("icon dimensions");
[["assets/icons/icon-192.png", 192], ["assets/icons/icon-512.png", 512], ["assets/icons/apple-touch-icon.png", 180]]
  .forEach(function (pair) {
    var rel = pair[0], n = pair[1];
    if (!exists(rel)) { ok(false, rel + " exists for dimension check"); return; }
    var s = pngSize(read(rel));
    ok(s !== null, rel + " is a real PNG");
    if (s) ok(s.width === n && s.height === n, rel + " is " + n + "x" + n + " (got " + s.width + "x" + s.height + ")");
  });
// The RGB master must be preserved, not overwritten by a derivative.
if (exists("assets/icons/app-icon-master-v1.png")) {
  var master = pngSize(read("assets/icons/app-icon-master-v1.png"));
  ok(master && master.width > 512 && master.height > 512, "app-icon master is preserved at full resolution (" + (master ? master.width + "x" + master.height : "?") + ")");
}

/* ------------------------------ 4. service worker ------------------------------ */
group("service worker");
var sw = readText("sw.js");
ok(/CACHE_VERSION\s*=/.test(sw), "sw.js defines an explicit CACHE_VERSION");
ok(/pocket-aquarium-shell-/.test(sw), "sw.js cache name is namespaced and versioned");
ok(/addEventListener\(\s*["']install["']/.test(sw), "sw.js has an install handler");
ok(/addEventListener\(\s*["']activate["']/.test(sw), "sw.js has an activate handler");
ok(/addEventListener\(\s*["']fetch["']/.test(sw), "sw.js has a fetch handler");
ok(/url\.origin\s*!==\s*self\.location\.origin/.test(sw), "sw.js restricts handling to same-origin requests");
ok(/request\.mode\s*===\s*["']navigate["']/.test(sw) && /["']\.\/index\.html["']/.test(sw), "sw.js falls back to the cached ./index.html on navigation");
ok(/caches\.delete/.test(sw) && /activate/.test(sw), "sw.js prunes old caches on activate (no stale shell)");
ok(!/\.register\s*\(/.test(sw), "sw.js does not register itself (the browser owns updates)");
// Renderer-critical art the Canvas draws (js/render.js): two habitat plates + three
// validated species sprites. These MUST be precached so the "hyper-real" look survives
// a cold offline launch / HTTP-cache eviction. Removing any of them from the allowlist
// (or from disk) must fail this test.
var RENDER_CRITICAL_ASSETS = [
  "./assets/habitats/reef-lagoon-v1.png",
  "./assets/habitats/amazon-blackwater-v1.png",
  "./assets/animals/ocellaris-clownfish-v2.png",
  "./assets/animals/neon-tetra-v1.png",
  "./assets/animals/yellow-watchman-goby-v1.png"
];
var m = sw.match(/PRECACHE_URLS\s*=\s*\[([\s\S]*?)\]/);
ok(m !== null, "sw.js declares a PRECACHE_URLS allowlist");
if (m) {
  var listMatches = m[1].match(/["'][^"']+["']/g) || [];
  var list = listMatches.map(function (s) { return s.slice(1, -1); });
  ["./index.html", "./styles.css", "./manifest.webmanifest",
   "./js/data.js", "./js/sim.js", "./js/render.js", "./js/app.js",
   "./assets/icons/icon-192.png", "./assets/icons/icon-512.png", "./assets/icons/apple-touch-icon.png"]
    .concat(RENDER_CRITICAL_ASSETS)
    .forEach(function (u) { ok(list.indexOf(u) >= 0, "allowlist includes " + u); });
  ok(list.length > 0 && list.every(relative), "every allowlisted URL is relative (base-path safe)");
  // The invalid clownfish v1 must never be precached (it is stripped from the Pages artifact).
  ok(list.indexOf("./assets/animals/ocellaris-clownfish-v1.png") < 0, "invalid clownfish v1 is NOT precached");
}
// Each renderer-critical asset must also exist on disk as a real PNG so cache.addAll() can't 404.
group("renderer-critical offline art");
RENDER_CRITICAL_ASSETS.forEach(function (rel) {
  var d = rel.replace(/^\.\//, "");
  if (!exists(d)) { ok(false, d + " exists on disk for precache"); return; }
  ok(pngSize(read(d)) !== null, d + " is a real PNG");
});

/* ------------------------------ 5. index.html wiring ------------------------------ */
group("index wiring");
var html = readText("index.html");
ok(/rel="manifest"\s+href="manifest\.webmanifest"/.test(html), "index links the manifest with a relative href");
ok(/rel="apple-touch-icon"\s+href="assets\/icons\/apple-touch-icon\.png"/.test(html), "index links a relative apple-touch-icon");
ok(/name="theme-color"/.test(html), "index has a theme-color meta");
ok(/name="apple-mobile-web-app-capable"\s+content="yes"/.test(html), "index declares apple-mobile-web-app-capable");
ok(/name="apple-mobile-web-app-status-bar-style"/.test(html), "index sets the apple status-bar style");
ok(/id="commandSurface"/.test(html), "index has the always-visible command surface element");
ok(/src="js\/app\.js"/.test(html), "index loads js/app.js");
ok(!/href="\/(manifest\.webmanifest|assets\/icons)/.test(html), "index PWA asset hrefs are not absolute (subpath-safe)");

/* ------------------------------ 6. registration guarded off file:// ------------------------------ */
group("service worker registration");
var app = readText("js/app.js");
ok(/serviceWorker/.test(app) && /register\(\s*["']sw\.js["']\s*\)/.test(app), "app.js registers the relative sw.js");
ok(/\.protocol/.test(app) && /https\?:/.test(app), "app.js guards registration to http(s) so it never runs on file://");

/* ------------------------------ 7. responsive + accessibility hooks ------------------------------ */
group("iphone safe-area & accessibility");
ok(/viewport-fit=cover/.test(html), "index viewport opts into safe-area insets (viewport-fit=cover)");
var css = readText("styles.css");
ok(/env\(safe-area-inset-/.test(css), "styles honour the iPhone safe-area insets");
ok(/touch-action:\s*none/.test(css), "canvas disables accidental scroll/zoom (touch-action:none)");
ok(/min-height:44px/.test(css), "styles provide 44px touch targets");
// The 44px contract must hold at the BASE rule, not only inside a mobile media query, and
// must not be undercut by sub-44px inline overrides. These guard the exact defects PAIOS-R found.
ok(/\.tbtn\s*\{[^}]*min-height:44px/.test(css), "transport .tbtn base min-height is 44px");
ok(!/\.tbtn\s*\{[^}]*min-height:3\dpx/.test(css), "transport .tbtn base is not a sub-44px height");
ok(/\.offer-cta\s*\{[^}]*min-height:44px/.test(css), "offer-cta base min-height is 44px");
ok(!/\.offer-cta\s*\{[^}]*min-height:40px/.test(css), "offer-cta base is not the old 40px height");
ok(!/min-height:38px/.test(app) && !/min-height:40px/.test(app), "app.js has no inline min-height that defeats the 44px rule");
ok(/prefers-reduced-motion/.test(css), "styles respect prefers-reduced-motion");
ok(/id="commandSurface"[^>]*role="status"[^>]*aria-live="polite"/.test(html), "command surface is an accessible polite live region");
ok(/id="canvasSummary"/.test(html) && /aria-describedby="canvasSummary"/.test(html), "canvas keeps a described-by text alternative");

/* ------------------------------ report ------------------------------ */
console.log("\n=================== Pocket Aquarium PWA tests ===================");
console.log("passed: " + passed + "   failed: " + failed + "   total: " + (passed + failed));
if (failed) {
  console.log("\nFAILURES:");
  failures.forEach(function (f, i) { console.log("  " + (i + 1) + ". " + f); });
  process.exit(1);
} else {
  console.log("ALL PASSED");
  process.exit(0);
}
