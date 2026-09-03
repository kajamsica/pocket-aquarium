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
require("../js/sim.js");
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
function makeCanvas(ctx, listeners) {
  return {
    getContext: function () { return ctx; },
    getBoundingClientRect: function () { return { width: CW, height: CH, left: 0, top: 0 }; },
    width: 0, height: 0, clientWidth: CW, clientHeight: CH,
    style: {}, addEventListener: function (type, fn) { if (listeners) listeners[type] = fn; }, removeEventListener: function () {}
  };
}

/* -------- tiny harness -------- */
var passed = 0, failed = 0, failures = [], curr = "";
function group(name) { curr = name; }
function ok(cond, msg) { if (cond) { passed++; } else { failed++; failures.push(curr + " :: " + msg); } }
function eq(a, b, msg) { ok(a === b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }
function lt(a, b, msg) { ok(a < b, msg + " (got " + a + " < " + b + "?)"); }
function near(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 0.75 : eps); }

// Contract geometry (documented, matches waterlineY in js/render.js): the waterline spans
// from the rim (0.035) at full to SUB_TOP (dry) at empty; level 0 => wl at SUB_TOP.
var SUB_TOP = 0.83, RIM = 0.035;
function expectedWlPx(level) { return (RIM + (1 - level) * (SUB_TOP - RIM)) * CH; }

var PLATE = /reef-lagoon-v1\.png$/; // js/render.js maps reef -> marine -> this plate

function runFrame(levelFrac, effectsOn) {
  var VOL = PA.DATA.TIERS.nano20.volumeL;
  // time.days 5.57 => day-fraction 0.57 => peak daylight (see render.test.js). effectsOn
  // adds nonzero PAR/flow and a saturated microfauna population so BOTH water-only passes
  // (caustics + suspended motes) are strongly visible; ordinary calls keep the dark/still defaults.
  var water = { levelL: VOL * levelFrac, par: effectsOn ? 0.6 : 0, flow: effectsOn ? 0.5 : 0 };
  var state = { habitat: "reef", tier: "nano20", time: { days: 5.57 }, water: water };
  if (effectsOn) state.microfauna = { population: 100, capacity: 100 };
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

/* ----- water-only effects clipped to the wet column; suppressed in a dry tank (PAR5-01F item 2) ----- */
// Behavioral proof over the recording context. Only drawHabitatPlate, drawCaustics and
// drawLightMotes call ctx.rect(); the plate rect spans the whole wet region (height CH - wl)
// while both effect passes clip to the WATER COLUMN (waterline -> SUB_TOP, height SUB_TOP*CH - wl).
// So a rect matching the water-column geometry, immediately followed by clip(), is an effect
// scope — and its top==waterline / bottom==SUB_TOP proves neither pass can paint above the
// waterline or into dry air. A dry tank has zero water column, so both passes must draw nothing.
var SUB_PX = SUB_TOP * CH;
function effectClips(log, wl) {
  // indices of rect ops equal to the exact water-column rect [0, wl, CW, SUB_PX - wl], clip-followed
  var out = [];
  for (var i = 0; i < log.length; i++) {
    var e = log[i];
    if (e.op === "rect" && e.args[0] === 0 && near(e.args[1], wl) && e.args[2] === CW &&
        near(e.args[3], SUB_PX - wl) && log[i + 1] && log[i + 1].op === "clip") out.push(i);
  }
  return out;
}
function opsUntilRestore(log, rectIdx) {
  // drawing ops recorded from the clip() (rectIdx+1) up to the matching restore()
  var ops = [];
  for (var i = rectIdx + 2; i < log.length; i++) {
    if (log[i].op === "restore") break;
    ops.push(log[i].op);
  }
  return ops;
}
function count(ops, name) { var c = 0; for (var i = 0; i < ops.length; i++) if (ops[i] === name) c++; return c; }

group("water-only effects (caustics + motes) clip to the wet column and never paint above the waterline");
var wlE = expectedWlPx(0.5);
var wetLog = runFrame(0.5, true);
var wetClips = effectClips(wetLog, wlE);
ok(wetClips.length === 2, "an effects-on partial tank emits exactly two water-column effect clips (caustics + motes), got " + wetClips.length);
ok(wetClips.every(function (ri) { return near(wetLog[ri].args[1], wlE); }),
   "each effect clip top sits exactly at the waterline (" + Math.round(wlE) + "px) — nothing can paint above it");
ok(wetClips.every(function (ri) { return near(wetLog[ri].args[1] + wetLog[ri].args[3], SUB_PX); }),
   "each effect clip bottom sits exactly at SUB_TOP (" + Math.round(SUB_PX) + "px) — confined to the water column, not dry air");
var causticOps = opsUntilRestore(wetLog, wetClips[0]);
var moteOps = opsUntilRestore(wetLog, wetClips[1]);
ok(count(causticOps, "stroke") === 5, "the first effect scope draws the five caustic strokes INSIDE the clip (got " + count(causticOps, "stroke") + ")");
ok(count(moteOps, "arc") > 0 && count(moteOps, "fill") > 0, "the second effect scope draws mote arc/fill ops INSIDE the clip (arcs " + count(moteOps, "arc") + ", fills " + count(moteOps, "fill") + ")");
ok(count(causticOps, "arc") === 0 && count(moteOps, "stroke") === 0, "the two effect scopes are distinct passes: caustics stroke only, motes arc/fill only");

group("water-only effects are suppressed entirely in a dry tank (no water column)");
var wlD = expectedWlPx(0); // waterline pinned at SUB_TOP => zero water column
var dryLog = runFrame(0, true);
ok(effectClips(dryLog, wlD).length === 0, "an effects-on dry tank emits ZERO effect clips: both passes early-return before drawing");
var dryPlate = analyze(dryLog);
ok(dryPlate.pIdx >= 0 && dryPlate.before === "clip", "the photographic-plate clip (height CH - wl, not the water column) is unaffected and still present when dry");

/* ----- live locomotion: a sprite fish moves between frames and stays in-bounds ----- */
// Drives the full motion+draw pipeline through the PUBLIC api across advancing real-time
// frames (spaced wider than MAX_DT to simulate fast transport / slow frames): the fish
// must visibly change position (frame-driven locomotion) yet never escape the tank bounds.
group("live locomotion: sprite fish moves across frames, stays inside the tank");
function spriteTranslateX(log, srcPattern) {
  var di = -1;
  for (var i = 0; i < log.length; i++) {
    var e = log[i];
    if (e.op === "drawImage" && e.args[0] && srcPattern.test(String(e.args[0]._src || ""))) di = i;
  }
  if (di < 0) return null;
  for (var j = di - 1; j >= 0; j--) if (log[j].op === "translate") return log[j].args[0]; // fish x in px
  return null;
}
function clownTranslateX(log) { return spriteTranslateX(log, /ocellaris|clownfish/); }
(function () {
  var VOL = PA.DATA.TIERS.nano20.volumeL;
  var state = {
    habitat: "reef", tier: "nano20", time: { days: 5.57 },
    water: { levelL: VOL, par: 0.6, flow: 0.5 },
    livestock: [{ id: "clown1", species: "ocellaris clownfish", x: 0.5, y: 0.5, hunger: 0.4, health: 1 }]
  };
  var log = [];
  var r = PA.createRenderer(makeCanvas(makeCtx(log)), function () { return state; }, function () {});
  var xs = [];
  for (var t = 0; t < 24; t++) {
    log.length = 0;
    r.draw(1000 + t * 160);                    // 160ms/frame wall-time (clamps internally)
    var tx = clownTranslateX(log);
    if (tx != null) xs.push(tx);
  }
  r.destroy();
  ok(xs.length > 3, "the clownfish sprite is drawn across frames (captured " + xs.length + " positions)");
  var moved = false, inBounds = true;
  for (var i = 1; i < xs.length; i++) {
    if (Math.abs(xs[i] - xs[i - 1]) > 0.5) moved = true;
    if (xs[i] < -2 || xs[i] > CW + 2) inBounds = false;
  }
  ok(moved, "the fish visibly changes position between frames (live, frame-driven locomotion)");
  ok(inBounds, "the fish stays within the tank bounds — no glass-edge escape at any frame");
})();

/* ----- feeding emphasis lifecycle: no false flash on first frame / recreate; real feeds retrigger ----- */
// The first-delight feed response (drawFood) must baseline existing pellets silently on the first
// ready frame and on renderer recreation, and only flash when the food COUNT rises. Detected on the
// real draw path: pellets and their emphasis halo are both arcs centered on the pellet pixel, so the
// number of arcs at that center is (pellets) with no flash and (2 x pellets) during a flash.
group("feeding emphasis lifecycle (createRenderer draw path)");
var VOLF = PA.DATA.TIERS.nano20.volumeL;
var FPX = 0.5 * CW, FPY = 0.4 * CH; // pellet pixel center (cssW==CW, cssH==CH; see waterline geometry)
function foodStateAt(n) {
  var food = []; for (var i = 0; i < n; i++) food.push({ id: i + 1, x: 0.5, y: 0.4, amount: 1, ageDays: 0, sunk: false });
  return { habitat: "reef", tier: "nano20", time: { days: 5.57 }, water: { levelL: VOLF, par: 0, flow: 0 }, food: food };
}
function arcsAt(log, x, y) {
  var n = 0; for (var i = 0; i < log.length; i++) { var e = log[i]; if (e.op === "arc" && near(e.args[0], x, 1.5) && near(e.args[1], y, 1.5)) n++; }
  return n;
}
(function () {
  var st = foodStateAt(1);            // a save already holding one pellet
  var flog = [];
  var r = PA.createRenderer(makeCanvas(makeCtx(flog)), function () { return st; }, function () {});
  r.draw(1000);
  ok(arcsAt(flog, FPX, FPY) === 1, "first ready frame with existing food draws the pellet only — no false flash");
  flog.length = 0; st.food.push({ id: 2, x: 0.5, y: 0.4, amount: 1 }); // a real feed: 1 -> 2
  r.draw(1100);
  ok(arcsAt(flog, FPX, FPY) === 3, "a later feed flashes only its new stable pellet id");
  flog.length = 0; st.food.push({ id: 3, x: 0.5, y: 0.4, amount: 1 }); // a second real feed: 2 -> 3
  r.draw(1200);
  ok(arcsAt(flog, FPX, FPY) === 5, "a second stable pellet id retriggers its own flash");
  flog.length = 0; r.draw(1200 + 2 * 1100); // well past the emphasis window
  ok(arcsAt(flog, FPX, FPY) === 3, "the emphasis expires: three pellets drawn without halos");
  flog.length = 0; r.resize(); r.draw(1200 + 2 * 1100 + 1); // resize must not fabricate a feed
  ok(arcsAt(flog, FPX, FPY) === 3, "resize does not retrigger the flash (still three plain pellets)");
  flog.length = 0; st.food.shift(); st.food.push({ id: 4, x: 0.5, y: 0.4, amount: 1 });
  r.draw(1200 + 2 * 1100 + 100);
  ok(arcsAt(flog, FPX, FPY) === 4, "a new id flashes even when total pellet count is unchanged");
  r.destroy();

  var rlog = []; // a recreated renderer over a save that already has pellets
  var r2 = PA.createRenderer(makeCanvas(makeCtx(rlog)), function () { return foodStateAt(2); }, function () {});
  r2.draw(1000);
  ok(arcsAt(rlog, FPX, FPY) === 2, "a recreated renderer with existing food draws pellets only — no false flash on its first frame");
  r2.destroy();
})();

/* ----- real feeding loop: input -> fall -> pursuit -> visual contact -> nutrition ----- */
group("feeding physics: every empty-water tap drops; starter fish pursues and eats on contact");
(function () {
  var s = PA.createState({ habitat: "amazon", seed: 77 });
  PA.dispatch(s, { type: "SETUP_FILL" });
  var fish = { id: s.nextId++, species: "neon_tetra", kind: "fish", ageDays: 8, stage: "juvenile", sex: "unknown",
    hunger: 0.2, condition: 1, health: 1, alive: true, causeOfDeath: null, decayDays: 0, lastFedDay: 0, x: 0.18, y: 0.35 };
  s.livestock.push(fish);
  var sent = [], listeners = {}, log = [];
  var r = PA.createRenderer(makeCanvas(makeCtx(log), listeners), function () { return s; }, function (a) { sent.push(a); PA.dispatch(s, a); });
  r.draw(1000); // establish an empty renderer baseline before feeding
  listeners.pointerdown({ clientX: CW * 0.82, clientY: CH * 0.2 });
  eq(sent[0].type, "FEED_AT", "empty-water pointer dispatches FEED_AT");
  eq(s.food.length, 1, "the valid pointer creates one visible pellet");
  var foodId = s.food[0].id, h0 = fish.hunger, firstX = null, towardX = null, consumedAt = null;
  for (var i = 1; i <= 180 && s.food.length; i++) {
    PA.step(s, 0.05);
    log.length = 0; r.draw(1000 + i * 50);
    var tx = spriteTranslateX(log, /neon|tetra/);
    if (tx != null && firstX == null) firstX = tx;
    if (tx != null && i === 20) towardX = tx;
    if (sent.some(function (a) { return a.type === "CONSUME_FOOD"; })) consumedAt = 1000 + i * 50;
  }
  r.destroy();
  ok(consumedAt == null || consumedAt >= 1600, "contact cannot consume before the 600ms acknowledgement floor");
  ok(towardX != null && firstX != null && towardX > firstX, "a starter-hunger fish visibly pursues the pellet");
  var eats = sent.filter(function (a) { return a.type === "CONSUME_FOOD"; });
  eq(eats.length, 1, "visual contact emits exactly one consume action");
  eq(eats.length ? eats[0].foodId : null, String(foodId), "contact names the stable pellet id");
  eq(s.food.length, 0, "contact removes the pellet from the next authoritative frame");
  lt(fish.hunger, h0, "hunger drops only when contact nutrition is applied");
})();
(function () {
  var s = PA.createState({ habitat: "reef", seed: 78 }); PA.dispatch(s, { type: "SETUP_FILL" });
  var sent = [], listeners = {}, r = PA.createRenderer(makeCanvas(makeCtx([]), listeners), function () { return s; }, function (a) { sent.push(a); PA.dispatch(s, a); });
  r.draw(1000);
  for (var i = 0; i < 3; i++) listeners.pointerdown({ clientX: 80 + i * 90, clientY: 70 });
  r.draw(1050); r.destroy();
  eq(sent.filter(function (a) { return a.type === "FEED_AT"; }).length, 3, "three valid empty-water taps dispatch three drops");
  eq(s.food.length, 3, "no valid rapid tap is silently lost before paint");
})();
(function () {
  var VOL = PA.DATA.TIERS.nano20.volumeL, sent = [];
  var s = { habitat: "reef", tier: "nano20", time: { days: 5.57 }, water: { levelL: VOL, par: 0, flow: 0 }, food: [],
    livestock: [{ id: 9, species: "ocellaris", x: 0.5, y: 0.4, hunger: 0.2, health: 1 }] };
  var r = PA.createRenderer(makeCanvas(makeCtx([])), function () { return s; }, function (a) { sent.push(a); });
  r.draw(1000); s.food.push({ id: 10, x: 0.5, y: 0.4, amount: 1, ageDays: 0, sunk: false });
  r.draw(1050); r.draw(1599);
  eq(sent.filter(function (a) { return a.type === "CONSUME_FOOD"; }).length, 0, "even immediate overlap remains visible for the full acknowledgement floor");
  r.draw(1650); r.destroy();
  eq(sent.filter(function (a) { return a.type === "CONSUME_FOOD"; }).length, 1, "overlap emits contact once the acknowledgement floor passes");
})();

/* Clownfish host affinity must yield to a feeding target, then resume when food is absent. */
group("reef clownfish: food outranks host pull across identities and simulation speeds");
[11, 17, 23, 29, 37, 47, 59, 71, 83, 97].forEach(function (id) {
  [1, 4, 8].forEach(function (speed) {
    var s = PA.createState({ habitat: "reef", seed: id }); PA.dispatch(s, { type: "SETUP_FILL" }); s.speed = speed;
    var fish = { id: id, species: "ocellaris", kind: "fish", ageDays: 12, stage: "juvenile", sex: "unknown",
      hunger: 0.2, condition: 1, health: 1, alive: true, causeOfDeath: null, decayDays: 0, lastFedDay: 0, x: 0.72, y: 0.72 };
    s.livestock.push(fish); s.nextId = 100;
    PA.dispatch(s, { type: "FEED_AT", x: 0.16 });
    var sent = [], r = PA.createRenderer(makeCanvas(makeCtx([])), function () { return s; }, function (a) { sent.push(a); PA.dispatch(s, a); });
    r.draw(1000);
    for (var frame = 1; frame <= 220 && s.food.length; frame++) { PA.step(s, 0.05); r.draw(1000 + frame * 50); }
    r.destroy();
    var eats = sent.filter(function (a) { return a.type === "CONSUME_FOOD"; });
    eq(eats.length, 1, "clown " + id + " eats before decay at " + speed + "x");
    ok(fish.hunger < 0.2, "clown " + id + " receives contact nutrition at " + speed + "x");
  });
});
(function () {
  var VOL = PA.DATA.TIERS.nano20.volumeL, log = [];
  var s = { habitat: "reef", tier: "nano20", time: { days: 5.57 }, water: { levelL: VOL, par: 0, flow: 0 }, food: [],
    livestock: [{ id: 97, species: "ocellaris", x: 0.18, y: 0.35, hunger: 0.2, health: 1 }] };
  var r = PA.createRenderer(makeCanvas(makeCtx(log)), function () { return s; }, function () {}), first = null, last = null;
  for (var frame = 0; frame < 160; frame++) {
    log.length = 0; r.draw(1000 + frame * 50);
    var x = clownTranslateX(log); if (x != null) { if (first == null) first = x; last = x; }
  }
  r.destroy();
  ok(first != null && last > first + 20, "without food, clownfish still returns toward its host territory");
})();

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
