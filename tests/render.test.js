/* Pocket Aquarium — renderer normalization contract tests (PAIOS-BF1).
   Dependency-free: run with `node tests/render.test.js`. No DOM, no canvas.

   Loads the AUTHORITATIVE catalog (js/data.js -> PA.DATA.TIERS) BEFORE the renderer
   (js/render.js) and exercises PA._render.normalizeView against REAL sim-schema state
   objects — `tier:'nano20'` + `water:{levelL:<litres>}`, exactly what js/sim.js stores —
   NOT a pre-divided `water.level` fraction. This proves the four projection defects
   PAIOS-R found are fixed against the schema the app actually produces:
     - midnight renders darker than midday (daylight from state.time.days),
     - water level is derived from water.levelL / the tier's catalog volumeL, so an
       unfilled tank is level 0, a full tank is level 1, and evaporation (fewer litres)
       lowers the rendered level — with true zero preserved and defensive fallbacks,
     - equipment "none" reads OFF while an installed tier reads ON. */
"use strict";
require("../js/data.js");    // must load first: sets PA.DATA (TIERS[tier].volumeL)
require("../js/render.js");  // extends the same global PA with _render.normalizeView
var PA = global.PA || (typeof globalThis !== "undefined" ? globalThis.PA : null);

/* ------------------------------ tiny harness ------------------------------ */
var passed = 0, failed = 0, failures = [], curr = "";
function group(name) { curr = name; }
function ok(cond, msg) { if (cond) { passed++; } else { failed++; failures.push(curr + " :: " + msg); } }
function near(a, b) { return Math.abs(a - b) < 1e-9; }
function angDiff2(from, to) { var d = (to - from) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2; return d; }

group("test surface present");
ok(PA && PA._render && typeof PA._render.normalizeView === "function", "render.js exposes PA._render.normalizeView");
ok(PA && PA.DATA && PA.DATA.TIERS && typeof PA.DATA.TIERS.nano20 === "object", "data.js loaded first: PA.DATA.TIERS.nano20 present");
var nv = PA && PA._render ? PA._render.normalizeView : function () { return {}; };
var VOL = (PA && PA.DATA && PA.DATA.TIERS.nano20) ? PA.DATA.TIERS.nano20.volumeL : 75; // authoritative catalog volume (litres)
ok(VOL > 0, "nano20 catalog volumeL is a positive number (" + VOL + " L)");

// Real first-run reef state, exactly as js/sim.js constructs it: authoritative LITRES in
// water.levelL, a tier id, sponge filter + basic light installed, everything else "none".
function stateAt(days, levelL, equip) {
  return {
    habitat: "reef",
    tier: "nano20",
    time: { days: days },
    water: { levelL: levelL, tempC: 25, pH: 8.1, salinity: 35, par: 0, flow: 0 },
    equipment: equip || { filter: "sponge", heater: "none", circulation: "none", light: "basic", skimmer: "none", refugium: "none", ato: "none" }
  };
}

/* ------------------------------ 1. photoperiod ------------------------------ */
group("photoperiod tracks state.time.days");
var midnight = nv(stateAt(5.0, VOL, null));   // frac 0.00 -> outside the daylight window
var midday   = nv(stateAt(5.57, VOL, null));  // frac 0.57 -> peak of the daylight window
ok(midnight.daylight < 0.05, "midnight is dark (daylight " + midnight.daylight + ")");
ok(midday.daylight > 0.95, "midday is lit (daylight " + midday.daylight + ")");
ok(midday.daylight > midnight.daylight, "midday is brighter than midnight");
ok(near(nv(stateAt(12.57, VOL, null)).daylight, midday.daylight), "daylight depends on the day FRACTION, not the day count");

/* ------------------------------ 2. water level from litres + tier volume ------------------------------ */
group("water level from water.levelL / tier volume");
ok(nv(stateAt(5.57, 0, null)).level === 0, "an unfilled tank (levelL 0) normalizes to level 0 — no mid-tank clamp");
ok(near(nv(stateAt(5.57, VOL, null)).level, 1), "a full tank (levelL == volumeL " + VOL + ") normalizes to level 1");
ok(near(nv(stateAt(5.57, VOL * 0.5, null)).level, 0.5), "a half-full tank (levelL == volumeL/2) normalizes to level 0.5");
ok(nv(stateAt(5.57, VOL * 0.9, null)).level > nv(stateAt(5.57, VOL * 0.4, null)).level, "evaporation (fewer litres) lowers the rendered level");
ok(near(nv(stateAt(5.57, VOL * 0.9, null)).level, 0.9) && near(nv(stateAt(5.57, VOL * 0.4, null)).level, 0.4), "level equals the litres/volume ratio (0.9 and 0.4)");
ok(nv(stateAt(5.57, VOL * 1.5, null)).level === 1, "an over-target level clamps to 1, never above");
// Defensive alternate schema: a pre-divided fraction with no levelL/tier still works.
ok(near(nv({ habitat: "reef", time: { days: 5.57 }, water: { level: 0.3 } }).level, 0.3), "defensive: a pre-divided water.level fraction is still honored");

/* ------------------------------ 3. equipment on/off ------------------------------ */
group("equipment none is off, installed is on");
var eq = nv(stateAt(5.57, VOL, null)).equipment;
ok(eq.heater === 0, "heater 'none' reads OFF (was treated as ON)");
ok(eq.circulation === 0, "circulation 'none' reads OFF");
ok(eq.skimmer === 0 && eq.refugium === 0 && eq.ato === 0, "skimmer/refugium/ato 'none' read OFF");
ok(eq.filter > 0, "an installed 'sponge' filter reads ON");
ok(eq.light > 0, "an installed 'basic' light reads ON");
var eqPowered = nv(stateAt(5.57, VOL, { filter: "sponge", heater: "basic", circulation: "powerhead", light: "reef-led", skimmer: "none", refugium: "none", ato: "none" })).equipment;
ok(eqPowered.circulation > 0 && eqPowered.heater > 0, "installed circulation/heater tiers read ON");

/* ------------------------------ 4. smooth photoperiod light ------------------------------ */
// computeLight must drive the tank's light from the sim's SMOOTH daylight curve so
// day<->night is continuous (no stepwise hour-window jumps that flicker the scene).
group("photoperiod light is smooth and continuous (computeLight)");
var cl = PA && PA._render ? PA._render.computeLight : null;
ok(typeof cl === "function", "render.js exposes PA._render.computeLight");
if (typeof cl === "function") {
  var prevI = null, maxJump = 0, N = 200;
  for (var s = 0; s <= N; s++) {
    var frac = s / N;                                  // 0..1 across one game-day (light on)
    var li = cl(nv(stateAt(10 + frac, VOL, null))).surfaceI;
    if (prevI != null) maxJump = Math.max(maxJump, Math.abs(li - prevI));
    prevI = li;
  }
  ok(maxJump < 0.02, "surface irradiance changes smoothly across the day (max step " + maxJump.toFixed(4) + ")");
  var noonI = cl(nv(stateAt(10.57, VOL, null))).surfaceI;   // peak of the daylight window
  var duskI = cl(nv(stateAt(10.80, VOL, null))).surfaceI;   // descending limb
  var nightI = cl(nv(stateAt(10.00, VOL, null))).surfaceI;  // outside the window
  ok(noonI > duskI && duskI > nightI, "irradiance falls monotonically noon>dusk>night (" + noonI.toFixed(2) + ">" + duskI.toFixed(2) + ">" + nightI.toFixed(2) + ")");
  var offEquip = { filter: "sponge", heater: "none", circulation: "none", light: "none", skimmer: "none", refugium: "none", ato: "none" };
  var nightOff = cl(nv(stateAt(10.00, VOL, offEquip))).surfaceI;
  ok(nightI > nightOff, "an installed light lifts the night irradiance floor (" + nightI.toFixed(2) + " > " + nightOff.toFixed(2) + ")");
}

/* ------------------------------ 5. bounded, frame-rate-independent motion ------------------------------ */
// The steering integrators must stay bounded for ANY dt so visible locomotion never
// inflates at 4x/8x transport or a slow frame, and turns never snap.
group("motion is bounded and frame-rate independent (stepTurn/stepSpeed)");
var stepTurn = PA && PA._render ? PA._render.stepTurn : null;
var stepSpeed = PA && PA._render ? PA._render.stepSpeed : null;
var MAX_DT = PA && PA._render ? PA._render.MAX_DT : 0;
ok(typeof stepTurn === "function" && typeof stepSpeed === "function", "render.js exposes stepTurn/stepSpeed");
ok(MAX_DT > 0 && MAX_DT <= 100, "render.js exposes a bounded MAX_DT frame cap (" + MAX_DT + "ms)");
if (typeof stepTurn === "function") {
  var maxRate = 0.011, angAccel = maxRate * 0.02;
  var hd = 0, av = 0, peakAv = 0, turnOk = true;
  for (var i = 0; i < 400; i++) {
    var dt = [16, 33, 50][i % 3];
    var r = stepTurn(hd, av, Math.PI, maxRate, angAccel, dt);   // steer toward a 180-degree target
    if (Math.abs(angDiff2(hd, r.hd)) > maxRate * dt + 1e-9) turnOk = false; // per-step change bounded
    hd = r.hd; av = r.av; peakAv = Math.max(peakAv, Math.abs(av));
  }
  ok(peakAv <= maxRate + 1e-9, "angular velocity stays within the species cap (peak " + peakAv.toFixed(5) + " <= " + maxRate + ")");
  ok(turnOk, "no snap: each heading step is bounded by maxRate*dt (turn continuity)");
  ok(Math.abs(angDiff2(hd, Math.PI)) < 0.1, "heading still converges onto the target (settled, no runaway ringing)");
}
if (typeof stepSpeed === "function") {
  var cruise = 2.9e-4, accel = 2.2e-6, noInflate = true;
  [16, 50, 1000, 100000].forEach(function (dt) {
    var sp = 0;
    for (var k = 0; k < 6; k++) sp = stepSpeed(sp, cruise, accel, Math.min(dt, MAX_DT));
    if (sp > cruise + 1e-12) noInflate = false;                 // approaching from below never overshoots
  });
  ok(noInflate, "speed never inflates above the species target for any dt (bounded at 4x/8x)");
  var spCap = stepSpeed(cruise, cruise * 1.6, accel, MAX_DT);   // fastest sustainable frame
  ok(spCap * MAX_DT <= cruise * 1.6 * MAX_DT + 1e-9, "per-frame displacement is hard-capped by the clamped dt");
}

/* ------------------------------ 6. transient feeding emphasis ------------------------------ */
// The first-delight feeding beat shows a brief, runtime-only emphasis when a pellet drops
// (drawFood keys its halo off feedFlash). Proving the intensity curve here proves the emphasis
// is transient and unsaved: it is full at the drop, decays to zero across the window, never
// re-fires afterward, and clamps to [0,1] — with no persisted or biology field involved.
group("feeding emphasis is brief and runtime-only (feedFlash)");
var ff = PA && PA._render ? PA._render.feedFlash : null;
ok(typeof ff === "function", "render.js exposes PA._render.feedFlash");
if (typeof ff === "function") {
  var DUR = 1100, T = 1000, UNTIL = T + DUR; // a pellet dropped at T opens the window to UNTIL
  ok(ff(T, 0, DUR) === 0, "no emphasis when no feed window is open (until 0)");
  ok(near(ff(T, UNTIL, DUR), 1), "emphasis is full the instant a pellet drops");
  ok(ff(UNTIL, UNTIL, DUR) === 0, "emphasis has fully decayed by the end of the window");
  var mid = ff(T + DUR / 2, UNTIL, DUR);
  ok(mid > 0 && mid < 1, "emphasis eases through the window (mid " + mid.toFixed(2) + ")");
  ok(ff(UNTIL + 5000, UNTIL, DUR) === 0, "emphasis never re-fires once the window has closed (transient)");
  ok(ff(T, T + 2 * DUR, DUR) === 1, "emphasis clamps to 1 and never exceeds it");
  ok(ff(T, UNTIL, 0) === 0, "a zero-length window yields no emphasis (guarded)");
}

/* ------------------------------ report ------------------------------ */
console.log("\n=================== Pocket Aquarium renderer tests ===================");
console.log("passed: " + passed + "   failed: " + failed + "   total: " + (passed + failed));
if (failed) {
  console.log("\nFAILURES:");
  failures.forEach(function (f, i) { console.log("  " + (i + 1) + ". " + f); });
  process.exit(1);
} else {
  console.log("ALL PASSED");
  process.exit(0);
}
