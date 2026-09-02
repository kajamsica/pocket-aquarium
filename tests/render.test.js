/* Pocket Aquarium — renderer normalization contract tests (PAIOS-BF1).
   Dependency-free: run with `node tests/render.test.js`. No DOM, no canvas — this loads
   js/render.js (which attaches to globalThis.PA) and exercises ONLY the pure sim->view
   normalization (PA._render.normalizeView) that decides the Canvas's photoperiod, water
   level, and equipment cues. It proves the four defects PAIOS-R found in that projection
   are fixed and stay fixed:
     - midnight renders darker than midday (daylight derived from state.time.days),
     - an unfilled tank normalizes to level 0 (no forced mid-tank waterline),
     - evaporation (a falling level fraction) lowers the rendered level,
     - equipment "none" reads as OFF while an installed tier reads as ON. */
"use strict";
require("../js/render.js");
var PA = global.PA || (typeof globalThis !== "undefined" ? globalThis.PA : null);

/* ------------------------------ tiny harness ------------------------------ */
var passed = 0, failed = 0, failures = [], curr = "";
function group(name) { curr = name; }
function ok(cond, msg) { if (cond) { passed++; } else { failed++; failures.push(curr + " :: " + msg); } }

group("test surface present");
ok(PA && PA._render && typeof PA._render.normalizeView === "function", "render.js exposes PA._render.normalizeView");
var nv = PA && PA._render ? PA._render.normalizeView : function () { return {}; };

// A realistic first-run reef exactly as js/sim.js constructs it: empty water, sponge filter
// and a basic light installed, everything else "none".
function stateAt(days, level, equip) {
  return {
    habitat: "reef",
    time: { days: days },
    water: { level: level, flow: 0, par: 0 },
    equipment: equip || { filter: "sponge", heater: "none", circulation: "none", light: "basic", skimmer: "none", refugium: "none", ato: "none" }
  };
}

/* ------------------------------ 1. photoperiod ------------------------------ */
group("photoperiod tracks state.time.days");
var midnight = nv(stateAt(5.0, 1, null));   // frac 0.00 -> outside the daylight window
var midday   = nv(stateAt(5.57, 1, null));  // frac 0.57 -> peak of the daylight window
ok(midnight.daylight < 0.05, "midnight is dark (daylight " + midnight.daylight + ")");
ok(midday.daylight > 0.95, "midday is lit (daylight " + midday.daylight + ")");
ok(midday.daylight > midnight.daylight, "midday is brighter than midnight");
// The whole-day integer must not matter — only the fractional time of day.
ok(Math.abs(nv(stateAt(12.57, 1, null)).daylight - midday.daylight) < 1e-9, "daylight depends on the day FRACTION, not the day count");

/* ------------------------------ 2. water level ------------------------------ */
group("water level preserves empty and evaporation");
ok(nv(stateAt(5.57, 0, null)).level === 0, "an unfilled tank normalizes to level 0 (no mid-tank clamp)");
ok(nv(stateAt(5.57, 1, null)).level === 1, "a full tank normalizes to level 1");
ok(nv(stateAt(5.57, 0.9, null)).level > nv(stateAt(5.57, 0.4, null)).level, "evaporation (a lower level fraction) lowers the rendered level");

/* ------------------------------ 3. equipment on/off ------------------------------ */
group("equipment none is off, installed is on");
var eq = nv(stateAt(5.57, 1, null)).equipment;
ok(eq.heater === 0, "heater 'none' reads OFF (was treated as ON)");
ok(eq.circulation === 0, "circulation 'none' reads OFF");
ok(eq.skimmer === 0 && eq.refugium === 0 && eq.ato === 0, "skimmer/refugium/ato 'none' read OFF");
ok(eq.filter > 0, "an installed 'sponge' filter reads ON");
ok(eq.light > 0, "an installed 'basic' light reads ON");
// And a later-installed circulation tier flips it on.
var eqPowered = nv(stateAt(5.57, 1, { filter: "sponge", heater: "basic", circulation: "powerhead", light: "reef-led", skimmer: "none", refugium: "none", ato: "none" })).equipment;
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
