/* Pocket Aquarium — renderer PHOTO DRAW-PATH contract test (PAIOS-BF2).
   Dependency-free: run with `node tests/render-drawpath.test.js`. No real browser.

   PAIOS-R2 proved the numbers are right but the opaque habitat plate was still painted
   across the WHOLE canvas, so a 0 L / evaporated tank still looked submerged. This test
   drives PA.createRenderer with a RECORDING 2D context and a stub Image, then inspects the
   actual canvas ops on the photographic path — not just normalized values — asserting the
   plate is CLIPPED to the wet region below waterlineY and a glass/air band is painted above:
     - level 0  -> waterline at SUB_TOP; the plate clip starts at SUB_TOP (no underwater
                   photo above the substrate) and the air band fills everything above it,
     - partial  -> the clip starts proportionally lower, exposing a proportional air band,
     - the plate drawImage is always immediately preceded by clip() (never unclipped). */
"use strict";

/* -------- stub Image: loads synchronously so the plate is "ready" before draw -------- */
function MockImage() { this.onload = null; this.onerror = null; this.naturalWidth = 1536; this.naturalHeight = 1024; this.width = 1536; this.height = 1024; this.decoding = ""; this._src = ""; }
Object.defineProperty(MockImage.prototype, "src", {
  set: function (v) { this._src = v; if (typeof this.onload === "function") this.onload(); },
  get: function () { return this._src; }
});
global.Image = MockImage;

require("../js/data.js");
require("../js/render.js");
var PA = global.PA || (typeof globalThis !== "undefined" ? globalThis.PA : null);

/* -------- recording 2D context (Proxy): logs every op; create* return a gradient stub -------- */
function makeCtx(log) {
  var props = { globalAlpha: 1, lineWidth: 1, shadowBlur: 0 };
  var grad = { addColorStop: function () {} };
  return new Proxy({}, {
    get: function (t, k) {
      if (typeof k === "symbol") return undefined;
      if (k in props) return props[k];
      return function () {
        var a = Array.prototype.slice.call(arguments);
        log.push({ op: String(k), args: a });
        if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createPattern") return grad;
        if (k === "measureText") return { width: 0 };
        return undefined;
      };
    },
    set: function (t, k, v) { props[k] = v; return true; }
  });
}
var CW = 600, CH = 400;
function makeCanvas(ctx) {
  return {
    getContext: function () { return ctx; },
    getBoundingClientRect: function () { return { width: CW, height: CH, left: 0, top: 0 }; },
    width: 0, height: 0, clientWidth: CW, clientHeight: CH,
    style: {}, addEventListener: function () {}, removeEventListener: function () {}
  };
}

/* -------- tiny harness -------- */
var passed = 0, failed = 0, failures = [], curr = "";
function group(name) { curr = name; }
function ok(cond, msg) { if (cond) { passed++; } else { failed++; failures.push(curr + " :: " + msg); } }
function near(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 0.75 : eps); }

// Contract geometry (documented, matches waterlineY in js/render.js): the waterline spans
// from the rim (0.035) at full to SUB_TOP (dry) at empty; level 0 => wl at SUB_TOP.
var SUB_TOP = 0.83, RIM = 0.035;
function expectedWlPx(level) { return (RIM + (1 - level) * (SUB_TOP - RIM)) * CH; }

var PLATE = /reef-lagoon-v1\.png$/; // js/render.js maps reef -> marine -> this plate

function runFrame(levelFrac) {
  var VOL = PA.DATA.TIERS.nano20.volumeL;
  var state = { habitat: "reef", tier: "nano20", time: { days: 5.57 }, water: { levelL: VOL * levelFrac, par: 0, flow: 0 } };
  var log = [];
  var r = PA.createRenderer(makeCanvas(makeCtx(log)), function () { return state; }, function () {});
  r.draw(1000);
  r.destroy();
  return log;
}

// Locate the plate drawImage and the clip/rect that mask it, plus the air-glass band.
function analyze(log) {
  var pIdx = -1;
  for (var i = 0; i < log.length; i++) {
    var e = log[i];
    if (e.op === "drawImage" && e.args[0] && typeof e.args[0]._src === "string" && PLATE.test(e.args[0]._src)) { pIdx = i; break; }
  }
  var rectArgs = null, clipIdx = -1;
  if (pIdx > 0) {
    for (var j = pIdx - 1; j >= 0; j--) { if (log[j].op === "clip") { clipIdx = j; break; } if (log[j].op === "drawImage") break; }
    if (clipIdx > 0) for (var k = clipIdx - 1; k >= 0; k--) { if (log[k].op === "rect") { rectArgs = log[k].args; break; } if (log[k].op === "clip") break; }
  }
  var air = null;
  for (var m = 0; m < log.length; m++) { var f = log[m]; if (f.op === "fillRect" && f.args[0] === 0 && f.args[1] === 0 && f.args[2] === CW) { air = f.args; break; } }
  return { pIdx: pIdx, before: pIdx > 0 ? log[pIdx - 1].op : null, rect: rectArgs, air: air };
}

group("test surface");
ok(PA && typeof PA.createRenderer === "function", "PA.createRenderer present");
ok(PA && PA.DATA && PA.DATA.TIERS.nano20, "data.js catalog loaded");

/* ----- level 0: dry tank, plate clipped at SUB_TOP, air fills above ----- */
group("level 0 (unfilled): photo clipped to wet region, dry air above SUB_TOP");
var wl0 = expectedWlPx(0); // == SUB_TOP * CH
var a0 = analyze(runFrame(0));
ok(a0.pIdx >= 0, "the photographic plate IS drawn (photo path active)");
ok(a0.before === "clip", "plate drawImage is immediately preceded by clip() (never unclipped)");
ok(a0.rect && near(a0.rect[1], wl0) && near(a0.rect[3], CH - wl0), "plate clip rect is the wet region [0," + Math.round(wl0) + "," + CW + "," + Math.round(CH - wl0) + "]");
ok(a0.rect && near(a0.rect[1], SUB_TOP * CH), "at level 0 the plate starts at SUB_TOP — no underwater plate above the substrate");
ok(a0.air && near(a0.air[3], wl0), "glass/air band fills the whole region above the waterline (height " + Math.round(wl0) + ")");

/* ----- partial (0.5): proportional air exposed ----- */
group("level 0.5 (partial): proportional air band, clip lower than empty");
var wl5 = expectedWlPx(0.5);
var a5 = analyze(runFrame(0.5));
ok(a5.pIdx >= 0 && a5.before === "clip", "partial tank: plate is drawn and clipped");
ok(a5.rect && near(a5.rect[1], wl5), "partial clip rect starts at the proportional waterline (" + Math.round(wl5) + ")");
ok(a5.air && near(a5.air[3], wl5), "partial air band height equals the waterline (" + Math.round(wl5) + ")");
ok(wl5 < wl0, "a fuller tank exposes LESS air than an empty one (proportional): " + Math.round(wl5) + " < " + Math.round(wl0));

/* ----- full (1.0): composition effectively unchanged (waterline near the rim) ----- */
group("level 1 (full): composition effectively unchanged");
var wl1 = expectedWlPx(1);
var a1 = analyze(runFrame(1));
ok(a1.pIdx >= 0 && a1.before === "clip", "full tank: plate is drawn and clipped");
ok(a1.rect && near(a1.rect[1], wl1) && wl1 < 0.05 * CH, "full clip starts at the rim (" + Math.round(wl1) + "px, ~top), so the photo still fills essentially the whole tank");

/* -------- report -------- */
console.log("\n=============== Pocket Aquarium renderer draw-path tests ===============");
console.log("passed: " + passed + "   failed: " + failed + "   total: " + (passed + failed));
if (failed) {
  console.log("\nFAILURES:");
  failures.forEach(function (f, i) { console.log("  " + (i + 1) + ". " + f); });
  process.exit(1);
} else {
  console.log("ALL PASSED");
  process.exit(0);
}
