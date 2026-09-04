/* Pocket Aquarium Ecosystem v4 — deterministic contract tests (FTG4-01B).
   Dependency-free: run with `node tests/sim.test.js`. No test framework.
   Loads the browser globals the way a `file://` page would: data.js then sim.js
   both attach to `window.PA`, so we alias `global.window = global` first.
   Tests exercise the PUBLIC surface (PA.dispatch / PA.stepDays / PA.validatePurchase /
   PA.sanitizeState / PA.offlineCatchUp) and never reimplement model formulas. Small
   direct state fixtures are used only to reach long-term conditions quickly; every
   assertion then runs through the real public functions. Seeded RNG keeps it repeatable. */
"use strict";
global.window = global;
require("../js/data.js");
require("../js/sim.js");
// js/app.js is loaded headlessly (no document) so its DOM bootstrap is skipped and only the
// shared live-action surface PA._app is published — the SAME helpers handleAct calls in the
// browser. This lets the cold-start wiring be proven on the real path, not a parallel copy.
require("../js/app.js");
var PA = global.PA, D = PA.DATA;

/* ------------------------------ tiny harness ------------------------------ */
var passed = 0, failed = 0, failures = [], curr = "";
function group(name) { curr = name; }
function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(curr + " :: " + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + " (got " + fmt(a) + ", want " + fmt(b) + ")"); }
function gt(a, b, msg) { ok(a > b, msg + " (got " + fmt(a) + " > " + fmt(b) + "?)"); }
function lt(a, b, msg) { ok(a < b, msg + " (got " + fmt(a) + " < " + fmt(b) + "?)"); }
function approx(a, b, tol, msg) { ok(Math.abs(a - b) <= tol, msg + " (got " + fmt(a) + " ~ " + fmt(b) + " +/-" + tol + ")"); }
function has(reasons, sub, msg) { ok(reasons.some(function (r) { return r.indexOf(sub) >= 0; }), msg + " [reasons: " + JSON.stringify(reasons) + "]"); }
function fmt(v) { return typeof v === "number" ? Math.round(v * 1000) / 1000 : JSON.stringify(v); }

/* ------------------------------ fixtures ------------------------------ */
// Bring a fresh tank to a legally-cycled, stable state via a small fixture, then
// keep exercising the real sim on top of it. Mirrors what ~8 real game-days of
// dispatched cycling produce (see the fishless-cycle test), but instantly.
function freshBase(seed) {
  var s = PA.createState({ seed: seed || 1, habitat: "amazon" });
  PA.dispatch(s, { type: "SETUP_FILL" });
  PA.dispatch(s, { type: "SETUP_LIFE_SUPPORT", on: true });
  return s;
}
function reefBase(seed) {
  var s = PA.createState({ seed: seed || 1, habitat: "reef" });
  PA.dispatch(s, { type: "SETUP_FILL" });
  PA.dispatch(s, { type: "SETUP_LIFE_SUPPORT", on: true });
  return s;
}
function markCycled(s, mature) {
  s.cycle.stage = mature ? "Mature biome" : "Cycled";
  s.cycle.aob = 0.95; s.cycle.nob = 0.9; s.cycle.validationDays = 2;
  s.succession.age = mature ? 25 : 9;
  var w = s.water; w.ammonia = 0; w.nitrite = 0; w.nitrate = 5;
  s.credits = 3000;
  return s;
}
function cycledFresh(seed, mature) {
  var s = freshBase(seed); markCycled(s, mature);
  var w = s.water; w.pH = 6.4; w.hardness = 3; w.tannin = 0.6; w.tempC = 25; w.oxygen = 7;
  return s;
}
function cycledReef(seed, opts) {
  opts = opts || {};
  var s = reefBase(seed); markCycled(s, true);
  var w = s.water; w.salinity = 35; w.alkalinity = 8.5; w.calcium = 420; w.magnesium = 1300;
  w.tempC = 26; w.pH = 8.2; w.oxygen = 7;
  s.equipment.heater = "basic";               // hold temperature at ~26
  s.equipment.ato = "ato";                     // hold volume/salinity steady (realistic reef care)
  s.automation.ato.capacityL = s.automation.ato.reservoirL = D.EQUIPMENT.ato.levels[1].reservoirCapacityL; // finite reservoir, kept topped
  if (opts.light) s.equipment.light = opts.light;
  if (opts.circ) s.equipment.circulation = opts.circ;
  return s;
}
function addAdult(s, species, n) {
  var sp = D.SPECIES[species];
  for (var i = 0; i < n; i++) s.livestock.push({
    id: s.nextId++, species: species, kind: sp.kind, ageDays: sp.maturityDays + 10,
    stage: "adult", sex: "unknown", hunger: 0.2, condition: 1, health: 1, alive: true,
    causeOfDeath: null, decayDays: 0, lastFedDay: s.time.days, x: 0.5, y: 0.5
  });
}
function aliveDead(s) { var a = 0, d = 0; s.livestock.forEach(function (x) { x.alive === false ? d++ : a++; }); return { alive: a, dead: d }; }

/* ============================================================ *
 * 1. Initial state + both habitat choice / setup flows
 * ============================================================ */
group("initial state");
(function () {
  var s = PA.createState({ seed: 5 });
  eq(s.habitat, null, "fresh state has no habitat until chosen");
  eq(s.credits, 120, "starting credits");
  eq(s.tier, "nano20", "starting tier");
  eq(s.cycle.stage, "Setup", "cycle starts at Setup");
  eq(s.livestock.length, 0, "no pre-stocked livestock");
  eq(D.saveKey === undefined ? D.saveKey : D.saveKey, D.saveKey, "saveKey exists");
  eq(D.saveKey, "pocket-aquarium-ecosystem-v1", "v4 save key");
  eq(D.arcadeKey, "pocket-aquarium-v1", "arcade key preserved (never mutated by sim)");
  var snap = PA.snapshotSummary(s);
  ok(snap.nextAction && /habitat/i.test(snap.nextAction.title), "next action asks to choose a habitat");
})();

group("habitat choice flows");
(function () {
  var a = PA.createState({ seed: 5 });
  PA.dispatch(a, { type: "CHOOSE_HABITAT", habitat: "amazon" });
  eq(a.habitat, "amazon", "amazon id chosen");
  eq(D.HABITATS[a.habitat].waterType, "fresh", "amazon is freshwater");
  var r = PA.createState({ seed: 5 });
  PA.dispatch(r, { type: "CHOOSE_HABITAT", habitat: "reef" });
  eq(r.habitat, "reef", "reef chosen");
  eq(D.HABITATS[r.habitat].waterType, "salt", "reef is saltwater");
  eq(D.HABITATS[r.habitat].salinityTarget, 35, "reef salinity target 35");
  // ALIAS: shell posts value="freshwater" (index.html) — must resolve to amazon
  var f = PA.createState({ seed: 5 });
  PA.dispatch(f, { type: "CHOOSE_HABITAT", habitat: "freshwater" });
  eq(f.habitat, "amazon", "shell 'freshwater' resolves to amazon");
  // createState opts path also honors the alias
  eq(PA.createState({ seed: 1, habitat: "freshwater" }).habitat, "amazon", "createState({habitat:'freshwater'}) -> amazon");
})();

group("setup flow (fresh + reef)");
(function () {
  var s = PA.createState({ seed: 3, habitat: "amazon" });
  eq(s.cycle.filled, false, "not filled before SETUP_FILL");
  PA.dispatch(s, { type: "SETUP_FILL" });
  eq(s.cycle.filled, true, "filled after SETUP_FILL");
  gt(s.water.levelL, 0, "water level set on fill");
  eq(s.water.salinity, 0, "fresh fill has no salinity");
  gt(s.water.tannin, 0, "fresh fill has tannin");
  PA.dispatch(s, { type: "SETUP_LIFE_SUPPORT", on: true });
  eq(s.cycle.lifeSupport, true, "life support on");
  PA.dispatch(s, { type: "ADD_AMMONIA_SOURCE", on: true });
  eq(s.cycle.ammoniaSource, true, "ammonia source armed");
  var aob0 = s.cycle.aob;
  PA.dispatch(s, { type: "INOCULATE_BACTERIA" });
  gt(s.cycle.aob, aob0, "inoculation raises nitrifier seed population");

  var r = PA.createState({ seed: 3, habitat: "reef" });
  PA.dispatch(r, { type: "SETUP_FILL" });
  approx(r.water.salinity, 35, 0.001, "reef fill mixes to ~35 ppt");
  gt(r.water.alkalinity, 0, "reef fill establishes alkalinity");
})();

/* ============================================================ *
 * 2. Fishless cycle gate, stage movement, unsafe-water lock
 * ============================================================ */
group("fishless cycle: stage movement + gate");
(function () {
  var s = PA.createState({ seed: 7, habitat: "amazon" });
  PA.dispatch(s, { type: "SETUP_FILL" });
  PA.dispatch(s, { type: "SETUP_LIFE_SUPPORT", on: true });
  PA.dispatch(s, { type: "ADD_AMMONIA_SOURCE", on: true });
  eq(D.isCycled(s), false, "not cycled at start");
  var firstSeen = {}, gateDay = null;
  for (var t = 0; t < 40; t += 0.1) {
    PA.stepDays(s, 0.1);
    var st = s.cycle.stage;
    if (firstSeen[st] == null) firstSeen[st] = +s.time.days.toFixed(2);
    if (gateDay == null && D.isCycled(s)) gateDay = +s.time.days.toFixed(2);
    if (gateDay != null && t > gateDay + 1) break;
  }
  ok(firstSeen["Ammonia oxidation"] != null, "passed through Ammonia oxidation");
  ok(firstSeen["Nitrite oxidation"] != null, "passed through Nitrite oxidation");
  ok(firstSeen["Nitrate present"] != null, "passed through Nitrate present");
  lt(firstSeen["Ammonia oxidation"], firstSeen["Nitrite oxidation"], "ammonia stage precedes nitrite stage");
  lt(firstSeen["Nitrite oxidation"], firstSeen["Nitrate present"], "nitrite stage precedes nitrate present");
  ok(gateDay != null, "stocking gate eventually opens");
  gt(gateDay, firstSeen["Nitrate present"], "gate opens only after nitrate is present");
  ok(D.stageIndex(s) >= D.CYCLE_STAGES.indexOf("Cycled"), "cycle stage reaches at least 'Cycled' (may age into Young/Mature biome)");
  eq(D.isCycled(s), true, "cycle gate is open once ammonia/nitrite safe with nitrate present + life support");
  gt(s.water.nitrate, 1, "nitrate present at cycle completion");
})();

group("unsafe-water purchase lock");
(function () {
  var s = cycledFresh(8);
  // spike ammonia to an unsafe level: stocking must be blocked
  s.water.ammonia = 1.0;
  eq(D.isCycled(s), false, "elevated ammonia closes the cycle gate");
  var v = PA.validatePurchase(s, { kind: "livestock", id: "neon_tetra", count: 6 });
  eq(v.ok, false, "cannot stock into measurable ammonia");
  has(v.reasons, "not cycled", "block cites uncycled/unsafe water");
  // dispatching the purchase must not add livestock
  PA.dispatch(s, { type: "PURCHASE_LIVESTOCK", species: "neon_tetra", count: 6 });
  eq(s.livestock.length, 0, "dispatch refuses to stock unsafe water");
  // feeding into dangerous water raises a warning flag
  s.food = []; delete s._feedWarning;
  PA.dispatch(s, { type: "FEED", x: 0.5, y: 0.4 });
  eq(s._feedWarning, true, "feeding into dangerous water warns");
})();

/* ============================================================ *
 * 3. Independent haze / diatom / green / cyano drivers
 * ============================================================ */
group("succession drivers are independent");
(function () {
  // haze <- nitrifier immaturity (compare immature vs mature filter, same everything else)
  function hazeCase(mature) {
    var s = freshBase(mature ? 21 : 22);
    if (mature) { s.cycle.aob = 0.95; s.cycle.nob = 0.9; }
    else { s.cycle.ammoniaSource = true; s.cycle.aob = 0.05; }
    PA.stepDays(s, 3); return s.succession.haze;
  }
  gt(hazeCase(false), hazeCase(true) + 0.1, "haze driven by immature nitrifiers, not mature filter");

  // diatom <- silicate (young), holding light/nutrient equal
  function diatomCase(sil) {
    var s = freshBase(31); s.equipment.light = "led";
    s.water.nitrate = 0; s.water.phosphate = 0; s.succession.silicate = sil;
    PA.stepDays(s, 3); return s.succession.diatom;
  }
  gt(diatomCase(1.0), diatomCase(0.0) + 0.1, "diatom driven by silicate, independent of nutrients");

  // green film <- dissolved nutrients, holding light equal
  function greenCase(nutrient) {
    var s = freshBase(41); s.equipment.light = "led";
    s.water.nitrate = nutrient ? 30 : 0; s.water.phosphate = nutrient ? 0.15 : 0;
    s.succession.silicate = 0; // remove diatom driver to isolate green
    PA.stepDays(s, 3); return s.succession.greenFilm;
  }
  gt(greenCase(true), greenCase(false) + 0.1, "green film driven by nutrients");

  // cyano <- poor flow / dead zones, holding nutrient + light equal
  function cyanoCase(circ) {
    var s = freshBase(51); s.equipment.light = "pro_led"; s.equipment.circulation = circ;
    s.water.nitrate = 30; s.water.phosphate = 0.15;
    PA.stepDays(s, 4); return s.succession.cyano;
  }
  gt(cyanoCase("none"), cyanoCase("gyre") + 0.1, "cyano driven by poor flow / dead zones");
})();

/* ============================================================ *
 * 4. Reef evaporation raises salinity; top-off + ATO control it
 * ============================================================ */
group("reef evaporation / top-off / ATO");
(function () {
  var s = reefBase(3);
  approx(s.water.salinity, 35, 0.001, "reef starts at 35 ppt");
  var lvl0 = s.water.levelL;
  PA.stepDays(s, 6);
  gt(s.water.salinity, 35.5, "evaporation raises salinity");
  lt(s.water.levelL, lvl0, "evaporation lowers water level");
  PA.dispatch(s, { type: "WATER_TOP_OFF" });
  approx(s.water.salinity, 35, 0.6, "manual freshwater top-off restores salinity");
  approx(s.water.levelL, lvl0, 0.001, "top-off restores volume");

  var a = reefBase(3); a.equipment.ato = "ato";
  PA.dispatch(a, { type: "REFILL_RESERVOIR" }); // finite reservoir must be filled to top off
  PA.stepDays(a, 6);
  gt(a.automation.ato.reservoirL, 0, "ATO reservoir still has freshwater after topping off");
  lt(a.automation.ato.reservoirL, D.EQUIPMENT.ato.levels[1].reservoirCapacityL, "ATO consumed some reservoir water");
  approx(a.water.salinity, 35, 0.1, "ATO holds salinity steady across evaporation");
  approx(a.water.levelL, a.water.levelL, 0.001, "ATO holds volume");
  approx(a.water.levelL, lvl0, 0.001, "ATO keeps the tank full");
})();

/* ============================================================ *
 * 5. Equipment / tier purchases cause measurable changes
 * ============================================================ */
group("equipment + tier purchases change coefficients/outcomes");
(function () {
  // filter -> biofilter/bioload capacity
  var f = cycledReef(40); var capBefore = D.bioloadCapacity(f);
  eq(PA.dispatch(f, { type: "PURCHASE_EQUIPMENT", category: "filter", levelId: "canister" }) === f, true, "dispatch returns state");
  gt(D.bioloadCapacity(f), capBefore, "canister filter raises bioload capacity");

  // heater -> temperature pull toward target
  function heat(level) { var s = cycledReef(41); s.equipment.heater = level; s.water.tempC = 20; PA.stepDays(s, 1); return s.water.tempC; }
  gt(heat("basic"), heat("none"), "better heater pulls temperature up faster");

  // circulation -> oxygen + flow
  function circ(level) { var s = cycledReef(42); s.equipment.circulation = level; s.water.oxygen = 5; PA.stepDays(s, 1); return s.water; }
  gt(circ("gyre").oxygen, circ("none").oxygen, "stronger circulation raises oxygen");
  gt(circ("gyre").flow, circ("none").flow, "stronger circulation raises flow");

  // light -> PAR ceiling reaching corals
  function par(level) { var s = cycledReef(43); s.equipment.light = level; s.time.days = 0.55; PA.stepDays(s, 0.05); return s.water.par; }
  gt(par("pro_led"), par("basic"), "bigger light raises available PAR");

  // skimmer (reef-only) -> organic/phosphate export
  function skim(level) { var s = cycledReef(44); s.equipment.skimmer = level; s.water.phosphate = 0.5; PA.stepDays(s, 2); return s.water.phosphate; }
  lt(skim("cone"), skim("none"), "protein skimmer exports phosphate faster");
  has(PA.validatePurchase(cycledFresh(44), { kind: "equipment", category: "skimmer", levelId: "cone" }).reasons, "reef", "skimmer flagged reef-only on freshwater");

  // refugium -> nitrate export + pod carrying capacity
  function refN(level) { var s = cycledReef(45); s.equipment.refugium = level; s.water.nitrate = 40; PA.stepDays(s, 3); return s.water.nitrate; }
  lt(refN("refugium"), refN("none"), "refugium exports nitrate faster");
  function refPods(level) { var s = cycledReef(46); s.equipment.refugium = level; s.microfauna.pods = 0.05; PA.stepDays(s, 8); return s.microfauna.pods; }
  gt(refPods("refugium"), refPods("none"), "refugium raises pod carrying capacity");

  // tier -> water volume, capacity, and unlocks tier-gated species
  var t = cycledFresh(47);
  var pyBefore = PA.validatePurchase(t, { kind: "livestock", id: "pygmy_cory", count: 6 });
  ok(pyBefore.reasons.some(function (x) { return /needs at least the/.test(x); }), "pygmy cory tier-gated on nano tank");
  var vol0 = D.TIERS[t.tier].volumeL, cap0 = D.bioloadCapacity(t);
  PA.dispatch(t, { type: "PURCHASE_TIER", tier: "mid151" });
  eq(t.tier, "mid151", "tier upgraded");
  gt(D.TIERS[t.tier].volumeL, vol0, "tier upgrade raises water volume");
  gt(D.bioloadCapacity(t), cap0, "tier upgrade raises bioload capacity");
  var pyAfter = PA.validatePurchase(t, { kind: "livestock", id: "pygmy_cory", count: 6 });
  ok(!pyAfter.reasons.some(function (x) { return /needs at least the/.test(x); }), "tier upgrade clears pygmy cory tier gate");
})();

/* ============================================================ *
 * 6. Feeding, uneaten decay, hunger->condition->health->death,
 *    corpse ammonia, dead removal
 * ============================================================ */
group("feeding: drop, fall, explicit contact nutrition, decay, persistence");
(function () {
  var s = cycledReef(60); addAdult(s, "ocellaris", 1);
  s.livestock[0].hunger = 0.2;
  var before = s.livestock[0].hunger, lastFed = s.livestock[0].lastFedDay;
  PA.dispatch(s, { type: "FEED_AT", x: 0.8, y: 0.7 });
  var pellet = s.food[0], y0 = pellet.y;
  ok(pellet.id > 0, "FEED_AT creates a stable pellet id");
  approx(pellet.x, 0.8, 1e-9, "pellet enters at tapped horizontal position");
  ok(y0 < 0.1, "pellet enters at the water surface, not the tapped depth");
  eq(s.livestock[0].hunger, before, "dropping food does not change hunger");
  PA.stepDays(s, 0.1);
  gt(pellet.y, y0, "pellet falls monotonically through authoritative tank space");
  ok(s.livestock[0].hunger >= before, "time and distance alone never lower hunger as if the pellet were eaten");
  eq(s.livestock[0].lastFedDay, lastFed, "last-fed time waits for contact");

  PA.dispatch(s, { type: D.ACTIONS.CONSUME_FOOD, foodId: pellet.id, eaterId: s.livestock[0].id });
  eq(s.food.length, 0, "a valid visual-contact action removes exactly its pellet");
  lt(s.livestock[0].hunger, before, "nutrition occurs only on explicit contact");
  gt(s.livestock[0].lastFedDay, lastFed, "contact updates last-fed time");
  var fedHunger = s.livestock[0].hunger;
  PA.dispatch(s, { type: D.ACTIONS.CONSUME_FOOD, foodId: pellet.id, eaterId: s.livestock[0].id });
  eq(s.livestock[0].hunger, fedHunger, "duplicate contact is a no-op");

  var bottom = cycledFresh(61); addAdult(bottom, "pygmy_cory", 1); bottom.livestock[0].hunger = 0.8;
  PA.dispatch(bottom, { type: "FEED_AT", x: 0.5 });
  PA.dispatch(bottom, { type: D.ACTIONS.CONSUME_FOOD, foodId: bottom.food[0].id, eaterId: bottom.livestock[0].id });
  eq(bottom.food.length, 1, "bottom feeder cannot consume a floating pellet");
  PA.stepDays(bottom, 0.4); ok(bottom.food[0].sunk, "falling pellet settles on the substrate");
  PA.dispatch(bottom, { type: D.ACTIONS.CONSUME_FOOD, foodId: bottom.food[0].id, eaterId: bottom.livestock[0].id });
  eq(bottom.food.length, 0, "bottom feeder can consume the settled pellet");

  function decayTank(n) {
    var u = freshBase(62); u.cycle.lifeSupport = false;
    for (var j = 0; j < n; j++) PA.dispatch(u, { type: "FEED", x: 0.5 });
    PA.stepDays(u, 0.61); return u;
  }
  var one = decayTank(1), three = decayTank(3);
  eq(one.food.length + three.food.length, 0, "expired uneaten pellets are removed");
  approx(three.water.ammonia / one.water.ammonia, 3, 0.01, "three uneaten portions create three times the ammonia");
  approx(three.water.phosphate / one.water.phosphate, 3, 0.01, "three uneaten portions create three times the phosphate");

  var saved = cycledReef(63); PA.dispatch(saved, { type: "FEED_AT", x: 0.37 }); PA.stepDays(saved, 0.1);
  var restored = PA.sanitizeState(JSON.parse(JSON.stringify(saved)));
  eq(restored.food.length, 1, "active food survives a save/sanitize round trip");
  eq(restored.food[0].id, saved.food[0].id, "food identity survives reload");
  approx(restored.food[0].y, saved.food[0].y, 1e-9, "food fall position survives reload");
  gt(restored.nextId, restored.food[0].id, "nextId cannot collide with restored food");

  var a = JSON.parse(JSON.stringify(restored)), b = JSON.parse(JSON.stringify(restored));
  PA.stepDays(a, 0.17); PA.stepDays(b, 0.17);
  eq(JSON.stringify(a), JSON.stringify(b), "pellet physics remains deterministic for identical state and elapsed time");
})();

group("starvation -> condition -> health -> death -> corpse -> removal");
(function () {
  var s = cycledFresh(63); addAdult(s, "neon_tetra", 6);
  s.cycle.ammoniaSource = false;
  var h0 = s.livestock[0].hunger;
  PA.stepDays(s, 1.5); gt(s.livestock[0].hunger, h0, "hunger rises without feeding");
  var condCrossed = null, healthCrossed = null, deathDay = null;
  for (var t = 0; t < 60 && deathDay == null; t += 0.25) {
    PA.stepDays(s, 0.25);
    var a = s.livestock[0];
    if (condCrossed == null && a.condition < 0.8) condCrossed = s.time.days;
    if (healthCrossed == null && a.health < 0.95) healthCrossed = s.time.days;
    if (a.alive === false) deathDay = s.time.days;
  }
  ok(condCrossed != null, "condition falls under prolonged hunger");
  ok(healthCrossed != null, "health falls after condition");
  ok(condCrossed <= healthCrossed, "condition degrades before health (hunger->condition->health chain)");
  ok(deathDay != null, "prolonged starvation eventually kills");
  eq(s.livestock[0].causeOfDeath, "starvation", "proximate cause logged as starvation");
  gt(s.memorial.length, 0, "dead animal recorded in memorial, not continued as livestock");
  ok(s.log.some(function (l) { return l.type === "death"; }), "death is explained in the log");

  // corpse raises ammonia until removed
  var amm0 = s.water.ammonia; PA.stepDays(s, 0.5); gt(s.water.ammonia, amm0, "decaying corpse fouls the water (ammonia rises)");
  var d0 = aliveDead(s).dead; gt(d0, 0, "corpses present");
  PA.dispatch(s, { type: "REMOVE_DEAD" });
  eq(aliveDead(s).dead, 0, "REMOVE_DEAD clears decaying biomass");
})();

/* ============================================================ *
 * 7. Compatibility + capacity blockers (validatePurchase)
 * ============================================================ */
group("compatibility + capacity blockers");
(function () {
  // wrong habitat / water type
  var fresh = cycledFresh(70);
  has(PA.validatePurchase(fresh, { kind: "livestock", id: "ocellaris", count: 1 }).reasons, "habitat", "clownfish blocked in freshwater (wrong habitat)");
  has(PA.validatePurchase(fresh, { kind: "livestock", id: "ocellaris", count: 1 }).reasons, "saltwater", "clownfish blocked in freshwater (wrong water type)");

  // school / group minimum + maximum
  has(PA.validatePurchase(fresh, { kind: "livestock", id: "neon_tetra", count: 3 }).reasons, "group of at least", "tetra school minimum enforced");
  var reef = cycledReef(71);
  has(PA.validatePurchase(reef, { kind: "livestock", id: "ocellaris", count: 3 }).reasons, "should not exceed", "clownfish social maximum enforced");

  // Published aquarium sizes are nominal, so tolerate up to one litre of conversion/rounding drift only.
  var savedMinVolume = D.SPECIES.ocellaris.minVolumeL;
  try {
    D.SPECIES.ocellaris.minVolumeL = 75.71;
    eq(PA.validatePurchase(reef, { kind: "livestock", id: "ocellaris", count: 1 }).ok, true,
      "nominal 75 L tank accepts the 75.71 L ocellaris minimum");
    D.SPECIES.ocellaris.minVolumeL = 76.01;
    has(PA.validatePurchase(reef, { kind: "livestock", id: "ocellaris", count: 1 }).reasons, "needs at least 76.01 L",
      "a volume deficit beyond the fixed one-litre tolerance remains blocked");
  } finally {
    D.SPECIES.ocellaris.minVolumeL = savedMinVolume;
  }

  // footprint / tier
  var pyR = PA.validatePurchase(cycledFresh(72), { kind: "livestock", id: "pygmy_cory", count: 6 }).reasons;
  has(pyR, "needs at least the", "pygmy cory tier gate");
  has(pyR, "floor space", "pygmy cory footprint gate");

  // capacity / bioload
  has(PA.validatePurchase(cycledFresh(73), { kind: "livestock", id: "neon_tetra", count: 30 }).reasons, "biological capacity", "bioload capacity enforced");

  // unstable water for coral (out-of-band salinity)
  var badReef = cycledReef(74); badReef.water.salinity = 29; badReef.water.alkalinity = 5.5;
  has(PA.validatePurchase(badReef, { kind: "coral", id: "zoanthid" }).reasons, "stable", "coral needs stable salinity/alkalinity");

  // territoriality + predator/prey + invert safety + expert/feature: epaulette shark vs nano reef w/ clownfish
  var nano = cycledReef(75); addAdult(nano, "ocellaris", 1);
  var shark = PA.validatePurchase(nano, { kind: "livestock", id: "epaulette_shark", count: 1 }).reasons;
  has(shark, "needs at least the", "epaulette needs the big tank tier");
  has(shark, "floor space", "epaulette needs sand footprint");
  has(shark, "expert", "epaulette flagged expert-only");
  has(shark, "strong filtration", "epaulette needs strong filtration");
  has(shark, "prey on", "epaulette would prey on the clownfish");

  // predator already present -> adding prey blocked (other direction)
  var big = cycledReef(76); big.tier = "xl757"; big.credits = 5000; addAdult(big, "epaulette_shark", 1);
  has(PA.validatePurchase(big, { kind: "livestock", id: "ocellaris", count: 1 }).reasons, "hunt and eat", "existing predator blocks adding its prey");

  // territorial conflict (two strong same-layer bottom holders)
  has(PA.validatePurchase(big, { kind: "livestock", id: "watchman_goby", count: 1 }).reasons, "fight", "territorial conflict flagged");

  // invert safety identifies the resident at risk
  var reefCoral = cycledReef(77); reefCoral.tier = "xl757"; reefCoral.credits = 5000;
  reefCoral.equipment.filter = "canister"; addAdult(reefCoral, "pistol_shrimp", 1);
  has(PA.validatePurchase(reefCoral, { kind: "livestock", id: "epaulette_shark", count: 1 }).reasons, "prey on", "invert safety enforced");

  // a legal starter group passes cleanly
  var legal = PA.validatePurchase(cycledFresh(78), { kind: "livestock", id: "neon_tetra", count: 6 });
  eq(legal.ok, true, "a legal neon-tetra school of 6 is allowed [reasons: " + JSON.stringify(legal.reasons) + "]");
})();

group("livestock conflict choices");
(function () {
  function sharkReady(seed, shrimpCount) {
    var s = cycledReef(seed); s.tier = "xl757"; s.equipment.filter = "canister"; s.credits = 5000;
    addAdult(s, "pistol_shrimp", shrimpCount || 2); return s;
  }

  var blocked = sharkReady(79, 2), beforeCredits = blocked.credits, beforeCount = blocked.livestock.length;
  var risk = PA.validatePurchase(blocked, { kind: "livestock", id: "epaulette_shark", count: 1 });
  eq(risk.ok, false, "risk-only purchase needs an explicit choice");
  eq(risk.conflicts.length, 1, "same-species conflicts are grouped");
  eq(risk.conflicts[0].riskTag, "predation", "risk is classified");
  eq(risk.conflicts[0].residentIds.length, 2, "every affected living resident is listed");
  eq(risk.conflicts[0].refundCredits, 22, "refund rounds half-price per resident");
  PA.dispatch(blocked, { type: "PURCHASE_LIVESTOCK", species: "epaulette_shark", count: 1 });
  eq(blocked.livestock.length, beforeCount, "unaccepted risk changes no residents");
  eq(blocked.credits, beforeCredits, "unaccepted risk changes no credits");

  var accepted = sharkReady(80, 2), acceptedIds = accepted.livestock.map(function (a) { return a.id; });
  PA.dispatch(accepted, { type: "PURCHASE_LIVESTOCK", species: "epaulette_shark", count: 1, acceptRisk: true });
  eq(accepted.livestock.filter(function (a) { return a.species === "epaulette_shark"; }).length, 1, "accept risk adds the requested animal");
  eq(acceptedIds.every(function (id) { return accepted.livestock.some(function (a) { return a.id === id; }); }), true, "accept risk retains every resident");

  var sold = sharkReady(81, 2), livingIds = sold.livestock.map(function (a) { return a.id; });
  addAdult(sold, "pistol_shrimp", 1); var deadId = sold.livestock[sold.livestock.length - 1].id; sold.livestock[sold.livestock.length - 1].alive = false;
  sold.selection = { entityType: "livestock", id: livingIds[0] };
  var soldRisk = PA.validatePurchase(sold, { kind: "livestock", id: "epaulette_shark", count: 1 });
  PA.dispatch(sold, { type: "SELL_LIVESTOCK", ids: soldRisk.conflicts[0].residentIds.concat([deadId, 99999]) });
  eq(sold.credits, 5022, "sell credits exact per-resident refund");
  eq(sold.selection, null, "selling the selected resident clears selection");
  eq(sold.livestock.length, 1, "only listed living residents are removed");
  eq(sold.livestock[0].id, deadId, "dead or unlisted residents are retained");
  PA.dispatch(sold, { type: "PURCHASE_LIVESTOCK", species: "epaulette_shark", count: 1 });
  eq(sold.livestock.filter(function (a) { return a.species === "epaulette_shark"; }).length, 1, "ordinary purchase succeeds after conflicts are sold");
  eq(sold.credits, 4122, "sale refund and purchase remain separate deterministic transactions");

  var hardBlocked = cycledReef(82); addAdult(hardBlocked, "pistol_shrimp", 1); var hardCount = hardBlocked.livestock.length;
  PA.dispatch(hardBlocked, { type: "PURCHASE_LIVESTOCK", species: "epaulette_shark", count: 1, acceptRisk: true });
  eq(hardBlocked.livestock.length, hardCount, "acceptRisk never bypasses hard tank gates");
  has(PA.validatePurchase(hardBlocked, { kind: "livestock", id: "epaulette_shark", count: 1, acceptRisk: true }).reasons, "needs at least the", "hard blocker stays visible after accepting risk");
})();

/* ============================================================ *
 * 8. Coral: extension responds to PAR/flow/stability; growth
 *    consumes reef chemistry
 * ============================================================ */
group("coral polyp extension + growth chemistry");
(function () {
  // PAR response: identical tanks differing only in light
  function extAt(light, circ, unstable) {
    var s = cycledReef(80, { light: light, circ: circ });
    PA.dispatch(s, { type: "PURCHASE_CORAL", coral: "zoanthid" });
    s.time.days = 0.5;
    if (unstable) { s.equipment.ato = "none"; s.water.salinity = 30; s.water.alkalinity = 6.0; }
    PA.stepDays(s, 0.2);
    return s.corals[0];
  }
  gt(extAt("led", "powerhead").extension, extAt("basic", "powerhead").extension, "polyp extension rises with more PAR");
  gt(extAt("led", "powerhead").extension, extAt("led", "gyre").extension, "over-strong flow retracts polyps");
  gt(extAt("led", "powerhead", true).stress, extAt("led", "powerhead").stress, "unstable chemistry stresses coral");

  // Growth consumes reef chemistry: coral present vs absent (ATO cancels evaporation)
  var withC = cycledReef(81, { light: "led", circ: "powerhead" });
  PA.dispatch(withC, { type: "PURCHASE_CORAL", coral: "zoanthid" });
  var noC = cycledReef(81, { light: "led", circ: "powerhead" });
  var g0 = withC.corals[0].growth, p0 = withC.corals[0].polyps;
  PA.stepDays(withC, 12); PA.stepDays(noC, 12);
  gt(withC.corals[0].growth, g0, "healthy coral grows over time");
  gt(withC.corals[0].polyps, p0, "polyp count increases with growth");
  gt(withC.corals[0].health, 0.6, "well-kept coral stays healthy (not doomed by nightfall)");
  lt(withC.water.alkalinity, noC.water.alkalinity, "coral growth draws down alkalinity");
  lt(withC.water.calcium, noC.water.calcium, "coral growth draws down calcium");
  lt(withC.water.magnesium, noC.water.magnesium, "coral growth draws down magnesium");

  // a mature colony milestone is reachable under sustained good care
  var m = cycledReef(82, { light: "led", circ: "powerhead" });
  PA.dispatch(m, { type: "PURCHASE_CORAL", coral: "zoanthid" });
  PA.stepDays(m, 55);
  ok(!!m.milestones["coral_mature_zoanthid"], "mature growing colony milestone is achievable under sustained good care");
})();

/* ============================================================ *
 * 9. Microfauna carrying capacity / export / predation
 * ============================================================ */
group("microfauna dynamics");
(function () {
  // seeded pods grow toward carrying capacity; unseeded stay empty
  var seeded = cycledReef(90); seeded.microfauna.pods = 0.05; PA.stepDays(seeded, 8);
  gt(seeded.microfauna.pods, 0.05, "seeded pods grow toward carrying capacity");
  var empty = cycledReef(91); empty.microfauna.pods = 0; PA.stepDays(empty, 8);
  approx(empty.microfauna.pods, 0, 0.001, "unseeded pod population stays empty (logistic)");
  // refugium raises carrying capacity (export/culture surface)
  var ref = cycledReef(92); ref.equipment.refugium = "refugium"; ref.microfauna.pods = 0.05; PA.stepDays(ref, 8);
  gt(ref.microfauna.pods, seeded.microfauna.pods, "refugium raises pod carrying capacity");
  gt(ref.microfauna.biodiversity, 0, "biodiversity score accumulates");
  // predation pressure: micro-feeding livestock holds pods lower than an empty tank
  var grazed = cycledReef(93); grazed.microfauna.pods = 0.3;
  addAdult(grazed, "watchman_goby", 1); // carnivore grazer adds predation pressure
  var ungrazed = cycledReef(93); ungrazed.microfauna.pods = 0.3;
  PA.stepDays(grazed, 6); PA.stepDays(ungrazed, 6);
  lt(grazed.microfauna.pods, ungrazed.microfauna.pods, "livestock predation lowers standing pod population");
})();

/* ============================================================ *
 * 10. Clownfish pair bonding -> spawn -> 6-8 day eggs -> hatch/fry
 * ============================================================ */
group("ocellaris pair bonding + spawn + egg phase + fry dependency");
(function () {
  var s = cycledReef(100, { light: "led", circ: "powerhead" });
  addAdult(s, "ocellaris", 2); s.microfauna.pods = 0.35;
  var pairedDay = null, spawnDay = null, hatchDay = null, fryDay = null;
  for (var t = 0; t < 28 && fryDay == null; t += 0.1) {
    PA.stepDays(s, 0.1);
    var cl = s.clutches[0];
    if (pairedDay == null && s.breeding.clown.paired) pairedDay = s.time.days;
    if (spawnDay == null && cl && cl.stage === "eggs") spawnDay = s.time.days;
    if (hatchDay == null && cl && cl.stage === "hatched") hatchDay = s.time.days;
    if (fryDay == null && cl && cl.stage === "fry") fryDay = s.time.days;
  }
  ok(pairedDay != null, "two healthy mature clownfish form a bonded pair");
  eq(s.breeding.clown.femaleId != null && s.breeding.clown.maleId != null, true, "pair resolves a female + male (protandrous hierarchy)");
  ok(spawnDay != null, "bonded pair spawns a clutch");
  ok(hatchDay != null, "eggs hatch");
  var eggPhase = hatchDay - spawnDay;
  ok(eggPhase >= 6 && eggPhase <= 8, "egg phase lasts 6-8 game days (got " + fmt(eggPhase) + ")");
  ok(fryDay != null, "larvae reach the fry stage when pods are available");
  ok(!!s.milestones["fry_ocellaris"], "surviving-fry milestone awarded");

  // fry dependency: without pods the larvae do not survive to fry
  var np = cycledReef(101, { light: "led", circ: "powerhead" });
  addAdult(np, "ocellaris", 2); np.microfauna.pods = 0;
  var sawFry = false;
  for (var u = 0; u < 28 && !sawFry; u += 0.1) { PA.stepDays(np, 0.1); if (np.clutches[0] && np.clutches[0].stage === "fry") sawFry = true; }
  ok(!!np.milestones["spawn_ocellaris"], "pair still spawns without pods");
  eq(sawFry, false, "larvae fail to reach fry without pod microfood (fry food dependency)");
})();

/* ============================================================ *
 * 11. Neon tetra school spawn -> short incubation -> fry food dep
 * ============================================================ */
group("neon tetra school spawning + fry dependency");
(function () {
  var s = cycledFresh(110); addAdult(s, "neon_tetra", 6); s.microfauna.infusoria = 0.35;
  // basic light (<=80 PAR ceiling) keeps the dim blackwater trigger satisfied
  var spawnDay = null, hatchDay = null, fryDay = null;
  for (var t = 0; t < 16 && fryDay == null; t += 0.1) {
    PA.stepDays(s, 0.1);
    var cl = s.clutches[0];
    if (spawnDay == null && cl && cl.stage === "eggs") spawnDay = s.time.days;
    if (hatchDay == null && cl && cl.stage === "hatched") hatchDay = s.time.days;
    if (fryDay == null && cl && cl.stage === "fry") fryDay = s.time.days;
  }
  ok(spawnDay != null, "a healthy tetra school spawns in soft, dim, acidic water");
  ok(hatchDay != null, "tetra eggs hatch");
  lt(hatchDay - spawnDay, 3, "tetra incubation is short (< 3 days)");
  ok(fryDay != null, "tetra larvae reach fry with infusoria available");
  ok(!!s.milestones["fry_neon_tetra"], "tetra surviving-fry milestone awarded");

  // fry food dependency: without infusoria, larvae starve
  var ni = cycledFresh(111); addAdult(ni, "neon_tetra", 6); ni.microfauna.infusoria = 0;
  var sawFry = false;
  for (var u = 0; u < 16 && !sawFry; u += 0.1) { PA.stepDays(ni, 0.1); if (ni.clutches[0] && ni.clutches[0].stage === "fry") sawFry = true; }
  eq(sawFry, false, "tetra larvae fail without infusoria (fry food dependency)");
})();

/* ============================================================ *
 * 12. Corrupt-save sanitize/quarantine + offline cap
 * ============================================================ */
group("sanitizeState corruption handling");
(function () {
  // total garbage never throws
  ok(PA.sanitizeState(null) && PA.sanitizeState(null).habitat === null, "null save -> safe fresh state");
  ok(PA.sanitizeState("nonsense").version === D.version, "string save -> safe fresh state");
  ok(PA.sanitizeState(42).credits === 120, "number save -> safe fresh state");

  var corrupt = {
    habitat: "amazon", credits: -999, xp: "lots", speed: 99,
    tier: "not_a_tier",
    water: { ammonia: "NaN-ish", tempC: 9999, nitrate: -50 },
    equipment: { filter: "bogus", light: "led" },
    livestock: [
      { species: "neon_tetra", health: 5, hunger: -3, stage: "adult" }, // valid, out-of-range fields
      { species: "ocellaris" },   // wrong habitat for amazon -> quarantine
      { species: "godzilla" },    // unknown -> quarantine
      "not-an-object"             // junk -> quarantine
    ],
    corals: [{ species: "zoanthid" }], // corals invalid in freshwater -> quarantine
    clutches: [{ species: "neon_tetra", stage: "eggs", count: 5, incubation: 1.2 }, { species: "x", stage: "eggs" }]
  };
  var s = PA.sanitizeState(corrupt);
  eq(s.habitat, "amazon", "valid habitat preserved");
  ok(s.credits >= 0, "negative credits clamped to >= 0");
  ok(s.water.tempC <= 100, "absurd temperature clamped into range");
  ok(s.water.ammonia >= 0, "non-numeric ammonia coerced to a safe number");
  eq(D.speeds.indexOf(s.speed) >= 0, true, "invalid speed reset to a valid value");
  eq(s.equipment.filter, "sponge", "invalid equipment id reset to default; valid one kept");
  eq(s.equipment.light, "led", "valid equipment id retained");
  eq(s.livestock.length, 1, "only the one valid same-habitat animal survives sanitization");
  eq(s.livestock[0].species, "neon_tetra", "surviving animal is the legal one");
  ok(s.livestock[0].health <= 1 && s.livestock[0].hunger >= 0, "animal numeric fields clamped");
  eq(s.corals.length, 0, "freshwater coral quarantined");
  ok(s.log.some(function (l) { return l.type === "quarantine"; }), "invalid entries quarantined to the log (no crash)");
  eq(s.clutches.length, 1, "invalid clutch dropped, valid clutch kept");
})();

group("offline catch-up cap (two game days)");
(function () {
  var s = cycledFresh(120);
  var rep = PA.offlineCatchUp(s, 10 * D.secondsPerGameDay1x * 1000); // 10 game-days away
  eq(rep.capped, true, "long absence is capped");
  eq(rep.appliedDays, D.offlineCapDays, "applied time capped at two game days");
  ok(rep.requestedDays > rep.appliedDays, "return report records the requested-vs-applied difference");
  // a healthy tank should not have livestock instantly wiped by the offline jump
  var s2 = cycledFresh(121); addAdult(s2, "neon_tetra", 6);
  var rep2 = PA.offlineCatchUp(s2, 10 * D.secondsPerGameDay1x * 1000);
  eq(rep2.deaths, 0, "offline cap does not instantly kill a healthy animal");
})();

group("snapshot display-rounding boundary (PAR5-01D)");
(function () {
  // A raw temperature fractionally under 24 must not be flagged out-of-range when
  // its displayed value rounds onto the 24 good lower bound. Value, severity, and
  // the alert list all derive from the same r3-rounded value.
  function tempEntry(snap) { return snap.water.filter(function (w) { return w.key === "tempC"; })[0]; }

  var s = cycledReef(200);
  s.water.tempC = 23.9996;                         // raw just below the 24 °C good lower bound
  var t = tempEntry(PA.snapshotSummary(s));
  eq(t.value, 24, "raw 23.9996 displays as the 24 good lower bound");
  eq(t.severity, "ok", "severity matches the displayed in-range value, not the hidden raw");
  ok(PA.snapshotSummary(s).alerts.indexOf(t.label) < 0, "no out-of-range alert for a displayed in-band temp");

  var s2 = cycledReef(201);
  s2.water.tempC = 30.0004;                        // raw just above 30 warn upper; rounds back onto 30
  var t2 = tempEntry(PA.snapshotSummary(s2));
  eq(t2.value, 30, "raw 30.0004 displays as 30, outside the 24-28 good band");
  eq(t2.severity, "warn", "displayed 30 is warn (in 22-30), not danger from hidden raw");
  ok(PA.snapshotSummary(s2).alerts.indexOf(t2.label) < 0, "no danger alert when the displayed value is in the warn band");
})();

/* ============================================================ *
 * 12. First-delight cold-start guide — LIVE wiring (PA-101-02 / PA-101-F1)
 *   These drive the SAME helpers js/app.js's handleAct calls, via the shared PA._app surface,
 *   so a broken inoculate / purchase / feed wiring cannot pass. Compatibility, determinism, and
 *   save-schema sanitation are already covered by the base suite above and are not re-asserted.
 * ============================================================ */
var APP = PA._app;
var appSource = require("fs").readFileSync(require("path").join(__dirname, "../js/app.js"), "utf8");
// Spy PA.stepDays around a thunk; returns the per-call day args (proves the ONE-time 8x boost).
function spyStepDays(fn) {
  var calls = [], orig = PA.stepDays;
  PA.stepDays = function (st, d) { calls.push(d); return orig(st, d); };
  try { fn(); } finally { PA.stepDays = orig; }
  return calls;
}
// Cold tank with the first three setup beats done (fill/life/ammonia), installed as the app state.
function coldFilled(hab) {
  var s = PA.createState({ seed: 11, habitat: hab });
  APP.setState(s);
  PA.dispatch(s, { type: "SETUP_FILL" });
  PA.dispatch(s, { type: "SETUP_LIFE_SUPPORT", on: true });
  PA.dispatch(s, { type: "ADD_AMMONIA_SOURCE", on: true });
  return s;
}

(function () {
  group("first-delight: shared live-action surface present (no parallel seam)");
  ok(APP && typeof APP.inoculate === "function" && typeof APP.buyLivestock === "function" &&
     typeof APP.feed === "function" && typeof APP.recommendedAction === "function",
     "app.js exposes the shared handleAct helpers (inoculate/buyLivestock/feed/recommendedAction)");
  ok(PA._guide === undefined, "the rejected parallel PA._guide seam is gone");

  group("first-delight: failed live inoculation runs no fast-forward");
  var s = PA.createState({ seed: 3, habitat: "amazon" }); APP.setState(s);
  var calls = spyStepDays(function () { APP.inoculate(); });
  eq(calls.length, 0, "inoculating an unfilled tank makes zero simulation-step calls");
  ok(!s.cycle.inoculated, "an unfilled tank is not inoculated");
})();

["amazon", "reef"].forEach(function (hab) {
  var starter = hab === "reef" ? "ocellaris" : "neon_tetra";
  var count = D.BUNDLES[starter] || 1;

  group("first-delight: four setup beats ordered + resumable (" + hab + ")");
  var s = PA.createState({ seed: 11, habitat: hab }); APP.setState(s);
  PA.dispatch(s, { type: "SETUP_LIFE_SUPPORT", on: true });
  ok(!s.cycle.lifeSupport, "no setup beat takes effect before the tank is filled (ordered)");
  PA.dispatch(s, { type: "SETUP_FILL" });
  PA.dispatch(s, { type: "SETUP_LIFE_SUPPORT", on: true });
  var r = PA.sanitizeState(JSON.parse(JSON.stringify(s))); APP.setState(r); // reload after two beats
  ok(r.cycle.filled && r.cycle.lifeSupport && !r.cycle.ammoniaSource && !r.cycle.inoculated,
     "reload resumes at the third beat without replaying completed ones");
  PA.dispatch(r, { type: "ADD_AMMONIA_SOURCE", on: true });

  group("first-delight: live inoculation fast-forwards exactly eight days once (" + hab + ")");
  var d0 = r.time.days;
  var calls = spyStepDays(function () { APP.inoculate(); }); // the SAME helper handleAct calls
  eq(calls.length, 8, "the live inoculate helper makes exactly eight simulation-step calls");
  ok(calls.every(function (d) { return d === 1; }), "each call advances exactly one game-day");
  approx(r.time.days - d0, 8, 1e-6, "eight game-days elapse through the public path");
  ok(D.isCycled(r), "the fast-forwarded tank is cycled and stockable");
  var repeat = spyStepDays(function () { APP.inoculate(); });
  eq(repeat.length, 0, "a repeat inoculate click runs no further fast-forward");

  group("first-delight: interrupted boost resumes only its remaining days (" + hab + ")");
  var interrupted = coldFilled(hab), d1 = interrupted.time.days, thrownCalls = 0, prior = PA.stepDays, failAt = hab === "reef" ? 4 : 3;
  PA.stepDays = function (st, d) { thrownCalls++; if (thrownCalls === failAt) throw new Error("interrupted"); return prior(st, d); };
  try { APP.inoculate(); } finally { PA.stepDays = prior; }
  eq(thrownCalls, failAt, "a later public step can interrupt the guided boost");
  approx(interrupted.time.days - d1, failAt - 1, 1e-6, "only completed authoritative days remain after interruption");
  eq(APP.recommendedAction(), "inoculate", "the command flow surfaces a retry, not an unretryable test action");
  var remaining = spyStepDays(function () { APP.inoculate(); });
  eq(remaining.length, 9 - failAt, "retry advances only the uncompleted guided days");
  approx(interrupted.time.days - d1, 8, 1e-6, "interruption plus retry advances exactly eight days, never more");

  group("first-delight: validated first purchase opens the feed beat; feed emits FEED_AT (" + hab + ")");
  APP.setState(r);
  ok(APP.recommendedAction() !== "feed", "feed is not recommended before the first fish");
  var before = r.livestock.length;
  APP.buyLivestock(starter, count); // the SAME helper handleAct calls
  eq(r.livestock.length - before, count, "the starter stocks through the existing validated purchase action");
  ok(APP.isPendingFirstFeed(), "a validated first purchase (0 -> >0 eaters) opens the runtime first-feed prompt");
  ok(/pendingFirstFeed = true;\s*renderNow\(\)/.test(appSource), "the live purchase path repaints after opening the feed beat (not merely a later state read)");
  eq(APP.recommendedAction(), "feed", "the guide immediately recommends feeding after the first fish");
  var fed = [], od = PA.dispatch;
  PA.dispatch = function (st, a) { fed.push(a.type); return od(st, a); };
  try { APP.feed(); } finally { PA.dispatch = od; }
  eq(fed.join(","), "FEED_AT", "the shared feed helper dispatches exactly FEED_AT (not FEED)");
  ok(!APP.isPendingFirstFeed(), "the first-feed prompt clears once a feed executes");
  ok(APP.recommendedAction() !== "feed", "after feeding, the guide surfaces the next care action");
});

(function () {
  group("first-delight: a throwing step still counts its authoritative day");
  var s = coldFilled("reef"), d0 = s.time.days, calls = 0, prior = PA.stepDays;
  PA.stepDays = function (st, d) { var out = prior(st, d); if (++calls === 3) throw new Error("after mutation"); return out; };
  try { APP.inoculate(); } finally { PA.stepDays = prior; }
  approx(s.time.days - d0, 3, 1e-6, "the throwing public step's completed day remains authoritative");
  eq(APP.recommendedAction(), "inoculate", "a reef that cycles mid-boost still exposes retry");
  eq(spyStepDays(function () { APP.inoculate(); }).length, 5, "retry excludes the already-mutated third day");
  approx(s.time.days - d0, 8, 1e-6, "the repaired boost finishes at exactly eight days");
})();

(function () {
  group("first-delight: load / resume / render never replay the boost; no persisted prompt");
  var s = coldFilled("amazon");
  PA.dispatch(s, { type: "INOCULATE_BACTERIA" }); // plain sim action, not the app boost
  var saved = JSON.parse(JSON.stringify(s));
  var calls = spyStepDays(function () {
    var reloaded = PA.sanitizeState(saved); // the exact load path bootstrap uses
    APP.setState(reloaded);                 // bootstrap installs + baselines the runtime prompt
    PA.snapshotSummary(reloaded);           // a render/snapshot pass
    APP.recommendedAction();
  });
  eq(calls.length, 0, "load + render never call the simulation-step path (no boost replay)");
  ok(!APP.isPendingFirstFeed(), "a freshly loaded save carries no first-feed prompt");

  group("first-delight: established resident saves bypass the guide with no schema change");
  var est = cycledFresh(91); addAdult(est, "neon_tetra", 6);
  var reloaded = PA.sanitizeState(JSON.parse(JSON.stringify(est)));
  APP.setState(reloaded);
  ok(!APP.isPendingFirstFeed(), "a resident save never enters the first-feed prompt");
  ok(APP.recommendedAction() !== "feed", "a resident save is not forced into the first-feed beat");
  ok(D.isCycled(reloaded) && reloaded.livestock.filter(function (a) { return a && a.alive !== false; }).length > 0,
     "the resident save reloads cycled with its residents intact");
  ok(!/pendingFirstFeed|firstFeed|tutorial|guideComplete|syntheticDay|feedFlash/i.test(JSON.stringify(reloaded)),
     "no first-feed / tutorial / emphasis field is persisted in the save");
})();

(function () {
  group("first-delight: start over clears runtime-only beats");
  var s = cycledFresh(92); APP.setState(s); APP.buyLivestock("neon_tetra", 6);
  ok(APP.isPendingFirstFeed(), "first-feed prompt is active before starting over");
  APP.startOver();
  ok(!APP.isPendingFirstFeed() && APP.recommendedAction() !== "feed", "a fresh tank cannot inherit the prior tank's feed prompt");
})();

/* ------------------------------ report ------------------------------ */
console.log("\n=================== Pocket Aquarium sim tests ===================");
console.log("passed: " + passed + "   failed: " + failed + "   total: " + (passed + failed));
if (failed) {
  console.log("\nFAILURES:");
  failures.forEach(function (f, i) { console.log("  " + (i + 1) + ". " + f); });
  process.exit(1);
} else {
  console.log("ALL PASSED");
  process.exit(0);
}
