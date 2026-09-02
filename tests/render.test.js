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
