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
// PAR5-01C release gate: the shell (index.html/styles.css/app.js/render.js) changed, so the
// cache MUST be bumped to v3 — v2 would let an already-controlled client pin the pre-fix app.
ok(/CACHE_VERSION\s*=\s*["']v3["']/.test(sw), "sw.js ships the v3 release cache (bumped from v2 so the redesigned shell can't be pinned)");
ok(!/CACHE_VERSION\s*=\s*["']v2["']/.test(sw), "sw.js no longer ships the superseded v2 cache version");
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
// PAR5-01F: the narrow-phone (<=380px) override must not undercut the base .tbtn 44px
// transport touch-WIDTH contract. Scope the check to that media block so the cascade guard
// fails against the old min-width:40px override and passes once it is corrected to 44px.
var narrow380 = (css.match(/@media \(max-width:380px\)\s*\{[\s\S]*?\n\}/) || [""])[0];
ok(/\.tbtn\s*\{[^}]*min-width:44px/.test(narrow380), "narrow-phone override keeps the transport .tbtn min-width at 44px");
ok(/prefers-reduced-motion/.test(css), "styles respect prefers-reduced-motion");
ok(/id="commandSurface"[^>]*role="status"[^>]*aria-live="polite"/.test(html), "command surface is an accessible polite live region");
ok(/id="canvasSummary"/.test(html) && /aria-describedby="canvasSummary"/.test(html), "canvas keeps a described-by text alternative");

/* --------------- 8. dark aquarium-instrument shell (PAR5-01A) --------------- */
// Structural redesign contract: the warm paper/pop/toy substrate is gone and a restrained
// dark instrument language + truthful single-care hierarchy are in place. These are byte
// checks on the shipped shell — no DOM, no screenshots.
group("dark instrument shell — legacy substrate removed");
ok(!/PostHog/i.test(css), "no 'PostHog-inspired console' substrate note remains");
ok(!/#f5f1e6/.test(css), "cream --chrome paper colour is removed from styles");
ok(!/#f5f1e6/.test(html), "index theme-color is no longer the cream paper colour");
ok(!/--line:\s*2px solid/.test(css), "2px ink outline token replaced by a hairline");
ok(!/4px 4px 0 var\(--ink\)/.test(css), "hard offset pop-shadow token is removed");
ok(!/box-shadow:\d+px \d+px 0 var\(--ink\)/.test(css), "no hard offset pop-shadows remain in styles");
ok(!/ui-rounded/.test(css), "rounded toy UI font is replaced with native system type");

group("dark instrument shell — new language present");
ok(/color-scheme:\s*dark/.test(css), "styles declare a dark color-scheme");
ok(/name="color-scheme"\s+content="dark"/.test(html), "index opts into a dark color-scheme");
ok(/--line:\s*1px/.test(css), "borders use a restrained hairline token");
ok(/backdrop-filter/.test(css), "secondary tool surfaces use a translucent backdrop blur");

group("truthful single-care hierarchy");
// One dominant care surface stays the single live-region contract; the Guide's duplicate
// next-action CALL-TO-ACTION is demoted while #nextAction survives as a compatible target.
ok(/id="commandSurface"[^>]*role="status"[^>]*aria-live="polite"/.test(html), "command surface stays the single polite care contract");
ok(/id="nextAction"/.test(html), "#nextAction preserved as a compatible Guide target");
ok(!/next-cta/.test(app), "Guide no longer renders a duplicate next-action call-to-action");
ok(/water-verdict/.test(css) && /water-verdict/.test(app), "Water panel leads with a compact current verdict");
ok(/wtool.{0,3}is-rec/.test(css) && /is-rec/.test(app), "Water tools emphasise the one contextually-correct operation");
// The truthful-priority fix: the empty-tank READY branch is evaluated AFTER environment and
// staleness, so an empty cycled tank with bad salinity/level fixes the environment first.
var careAdviceSrc = (app.match(/function careAdvice[\s\S]*?\n  \}/) || [""])[0];
var idxEnv = careAdviceSrc.indexOf("environmentIssue(snap)");
var idxReady = careAdviceSrc.indexOf('"READY"');
ok(idxEnv > -1 && idxReady > -1 && idxEnv < idxReady, "careAdvice checks environment before recommending stocking an empty tank");

group("water panel: exactly one care-matched recommendation");
// Regression guard (PAR5-01A browser finding): a reef fishless cycle badged Test + water
// change + top-off all at once because each tool computed its own recommendation. The badge
// must instead come from the SINGLE careAdvice action, so at most one tool can be emphasised.
// The tool source: emphasis is gated on the tool's own action matching one recommended action.
var waterToolSrc = (app.match(/function waterTool\([\s\S]*?\n  \}/) || [""])[0];
ok(/act\s*===\s*recAct/.test(waterToolSrc), "waterTool emphasises a tool only when its own action equals the single recommended action");
ok(/wtool-rec/.test(waterToolSrc) && /is-rec/.test(waterToolSrc) &&
   waterToolSrc.split("isRec").length >= 3, "the RECOMMENDED NOW badge and is-rec class share one isRec decision (no second independent flag)");
// The builder feeds tools the one careAdvice action, not per-tool booleans.
var waterToolsSrc = (app.match(/function waterToolsHTML\([\s\S]*?\n  \}/) || [""])[0];
ok(/recAct\s*=\s*m\.action\.act/.test(waterToolsSrc), "waterToolsHTML derives the recommendation from careAdvice(snap).action.act");
ok(!/\brecTest\b/.test(app) && !/\brecWC\b/.test(app) && !/\brecTop\b/.test(app),
   "no independent per-tool recommendation booleans remain (single source of truth)");

group("guide + canvas summary are orientation-only");
// Regression guard (PAR5-01A browser finding): the Guide card and the canvas accessibility
// summary read snap.nextAction ("Stock your first community") which contradicted the command
// surface's real careAdvice ("Review water"). Only the command surface may state the action.
var renderGuideSrc = (app.match(/function renderGuide\([\s\S]*?\n  \}/) || [""])[0];
ok(renderGuideSrc.length > 0, "renderGuide located for the orientation-only contract check");
ok(!/snap\.nextAction/.test(renderGuideSrc), "renderGuide does not consume snap.nextAction");
ok(!/careAdvice/.test(renderGuideSrc), "renderGuide does not read careAdvice's action either");
ok(/STAGE_NOTES/.test(renderGuideSrc), "renderGuide shows the educational stage meaning (STAGE_NOTES)");
ok(/snap\.cycle\.(stage|index)/.test(renderGuideSrc), "renderGuide titles the current cycle/maturity stage");
ok(/id="nextAction"/.test(html) && /nextActionEl/.test(renderGuideSrc), "#nextAction target/DOM compatibility is preserved");
var summaryTextSrc = (app.match(/function summaryText\([\s\S]*?\n  \}/) || [""])[0];
ok(summaryTextSrc.length > 0, "summaryText located for the orientation-only contract check");
ok(!/snap\.nextAction/.test(summaryTextSrc), "canvas summary no longer consumes snap.nextAction");
ok(!/["']Next:/.test(summaryTextSrc), "canvas summary emits no competing 'Next:' action clause");
// Belt-and-suspenders: nothing outside the command surface renders snap.nextAction anymore.
ok(!/snap\.nextAction/.test(app), "no surface other than the command bar consumes snap.nextAction");

group("meter value never contradicts its own target band (PAR5-01E)");
// Live proof found the command surface saying "Temperature outside the safe band" while the
// Water meter showed "24 °C" inside a "24–28 °C" target — fmtVal rounded 23.6 up into the band.
// Deterministically exercise the SHIPPED formatting helpers (extracted + evaluated in isolation,
// no DOM) so a below-low/above-high value can never render as in-band.
ok(/var val = known \? \(meterValueLabel\(m\) \+ unit\)/.test(app), "meterHTML formats the value through meterValueLabel");
var fmtValSrc = (app.match(/function fmtVal\([\s\S]*?\n  \}/) || [""])[0];
var labelSrc = (app.match(/function meterValueLabel\([\s\S]*?\n  \}/) || [""])[0];
ok(fmtValSrc.length > 0 && labelSrc.length > 0, "fmtVal + meterValueLabel helpers are present in js/app.js");
var fmtMeter = null;
try { fmtMeter = new Function(fmtValSrc + "\n" + labelSrc + "\nreturn meterValueLabel;")(); } catch (e) { fmtMeter = null; }
ok(typeof fmtMeter === "function", "shipped meterValueLabel evaluates in isolation");
if (typeof fmtMeter === "function") {
  // below-low rounding: 23.6 would fmtVal to "24" and read inside 24–28 -> must qualify.
  ok(fmtMeter({ value: 23.6, good: [24, 28] }) === "<24", "below-low value rounding into band is qualified (<24)");
  // above-high rounding: 28.4 would fmtVal to "28" and read inside 24–28 -> must qualify.
  ok(fmtMeter({ value: 28.4, good: [24, 28] }) === ">28", "above-high value rounding into band is qualified (>28)");
  // normal in-band value: unchanged and readable.
  ok(fmtMeter({ value: 26, good: [24, 28] }) === "26", "ordinary in-band value is unchanged (26)");
  // inclusive boundary is in-band, not qualified.
  ok(fmtMeter({ value: 24, good: [24, 28] }) === "24", "inclusive low boundary stays in-band (24)");
  // already-out-of-band displays: no spurious qualifier, plain rounded value.
  ok(fmtMeter({ value: 23.4, good: [24, 28] }) === "23", "value that already reads below band is not qualified (23)");
  ok(fmtMeter({ value: 29, good: [24, 28] }) === "29", "value that already reads above band is not qualified (29)");
  // one-decimal precision (e.g. pH): qualifier matches the band's own precision.
  ok(fmtMeter({ value: 5.98, good: [6, 7.5] }) === "<6.0", "one-decimal below-low value is qualified at band precision (<6.0)");
}

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
