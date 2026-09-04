/* Pocket Aquarium shared session guide.
   Purely projects authoritative PA state into one frozen guide view. */
(function (global) {
  "use strict";

  var PA = global.PA;
  if (!PA || !PA.DATA) return;

  var DATA = PA.DATA;
  var INOCULATION_ADVANCE_DAYS = 8;

  function finite(v, fallback) { return typeof v === "number" && isFinite(v) ? v : fallback; }
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function isReef(state) { return state && state.habitat === "reef"; }
  function waterByKey(snap) {
    var out = {}, water = snap && snap.water || [];
    for (var i = 0; i < water.length; i++) out[water[i].key] = water[i];
    return out;
  }
  function aliveEaters(state) {
    var count = 0, livestock = state && state.livestock || [];
    for (var i = 0; i < livestock.length; i++) {
      var animal = livestock[i];
      if (!animal || animal.alive === false) continue;
      var species = DATA.resolveSpecies(state, animal.species);
      if (species && species.kind !== "invert") count++;
    }
    return count;
  }
  function deadCount(state) {
    var count = 0, livestock = state && state.livestock || [];
    for (var i = 0; i < livestock.length; i++) if (livestock[i] && livestock[i].alive === false) count++;
    return count;
  }
  /* Worst value on each welfare axis across living residents: one failing animal must not be
     averaged away by healthy tankmates the way snapshot welfare is. */
  function worstWelfare(state) {
    var livestock = state && state.livestock || [], worst = null;
    for (var i = 0; i < livestock.length; i++) {
      var animal = livestock[i];
      if (!animal || animal.alive === false) continue;
      var hunger = finite(animal.hunger, 0), condition = finite(animal.condition, 1), health = finite(animal.health, 1);
      worst = worst
        ? { hunger: Math.max(worst.hunger, hunger), condition: Math.min(worst.condition, condition), health: Math.min(worst.health, health) }
        : { hunger: hunger, condition: condition, health: health };
    }
    return worst;
  }
  /* Hunger rises past 1 as the sim's overdue-feeding reserve, so percentages are bounded for display. */
  function pct(v) { return Math.round(Math.min(1, Math.max(0, v)) * 100); }
  function readingFreshness(state) {
    var habitat = state && DATA.HABITATS[state.habitat];
    var expected = habitat && habitat.params || [];
    var tests = state && state.tests || {};
    var unknown = 0, known = 0, oldest = 0;
    for (var i = 0; i < expected.length; i++) {
      var test = tests[expected[i]];
      if (!test || !test.known || !isFinite(test.ageDays)) unknown++;
      else { known++; oldest = Math.max(oldest, Math.max(0, test.ageDays)); }
    }
    var age = known ? r3(oldest) : null;
    var at = known ? r3(Math.max(0, finite(state.time && state.time.days, 0) - oldest)) : null;
    if (!known) return { text: "Never tested", stale: true, testedAtDay: null, readingAgeDays: null };
    if (unknown) return { text: unknown + " reading" + (unknown === 1 ? "" : "s") + " untested", stale: true, testedAtDay: at, readingAgeDays: age };
    if (oldest < 0.25) return { text: "Readings fresh", stale: false, testedAtDay: at, readingAgeDays: age };
    if (oldest < 0.75) return { text: "Readings recent", stale: false, testedAtDay: at, readingAgeDays: age };
    if (oldest < 1.5) return { text: "Readings aging", stale: true, testedAtDay: at, readingAgeDays: age };
    return { text: "Readings stale", stale: true, testedAtDay: at, readingAgeDays: age };
  }
  function environmentIssue(state, snap) {
    var water = waterByKey(snap), level = water.level, salinity = water.salinity;
    var temperature = water.tempC, ph = water.pH, alk = water.alkalinity;
    if (level && level.value < (level.good ? level.good[0] : 92))
      return ["The water level has dropped from evaporation.", isReef(state)
        ? "A freshwater top-off restores volume and lowers salinity back toward target; it does not remove nitrate."
        : "A freshwater top-off restores the evaporated volume; it does not remove nitrate.", "Freshwater top-off", "topoff"];
    if (salinity && isReef(state) && salinity.severity !== "ok" && salinity.value > (salinity.target || 35))
      return ["Salinity has risen above the target range.", "Evaporation concentrates salt — top off with fresh (salt-free) water to dilute it back toward 35 ppt.", "Freshwater top-off", "topoff"];
    if (temperature && temperature.severity !== "ok")
      return ["Temperature is outside the safe band.", "Check the heater/controller in the Water tab and let it stabilise before stocking or feeding.", "Review water", "open-water"];
    if (ph && ph.severity !== "ok" && isReef(state))
      return alk && alk.severity !== "ok"
        ? ["Reef pH and its carbonate buffer are both out of band.", "Alkalinity is the buffer that holds pH steady — a 25% change with matched water pulls it back toward 8.5 dKH. Retest afterward.", "25% water change", "wc25"]
        : ["Reef pH is outside the target band.", "Alkalinity is in range, so the buffer is adequate — keep life support running at 4× and pH settles toward its alkalinity-buffered equilibrium. Retest afterward.", "Stabilize at 4×", "speed4"];
    if (ph && ph.severity !== "ok")
      return ["pH is outside the target band.", "Review chemistry in the Water tab; correct it gradually because sharp swings stress residents.", "Review water", "open-water"];
    if (salinity && isReef(state) && salinity.severity !== "ok")
      return ["Salinity is outside the target range.", "Review salinity in the Water tab and adjust it gradually.", "Review water", "open-water"];
    return null;
  }
  /* Coral light is only diagnosable at the schedule's peak — the same representative window
     the store qualifies PAR tests in (DATA.isPeakPhotoperiod). Dawn and dusk ramps are
     programmed, so a dim or bright ramp moment is not a lighting problem to report. */
  function coralLightIssue(state, snap) {
    if (!isReef(state) || !snap.corals || !snap.corals.length) return null;
    var days = finite(state.time && state.time.days, 0), frac = days - Math.floor(days);
    if (!DATA.isPeakPhotoperiod(frac)) return null;
    var par = finite(state.water && state.water.par, 0);
    var dim = 0, bright = 0, corals = state.corals || [];
    for (var i = 0; i < corals.length; i++) {
      if (!corals[i] || !corals[i].placement) continue;
      var profile = DATA.CORALS[corals[i].species];
      if (!profile || !profile.par) continue;
      if (par > profile.par.high) bright++;
      else if (par < profile.par.low) dim++;
    }
    if (bright) return ["Peak-photoperiod PAR is stronger than your coral can use.", "Too much usable light bleaches coral tissue — dim the fixture or raise it, then re-check PAR in the Water tab.", "Review water", "open-water"];
    if (dim) return ["Peak-photoperiod PAR is too dim for your coral.", "Coral needs enough usable light (PAR) at its spot at peak light to grow — check PAR and the fixture in the Water tab.", "Review water", "open-water"];
    return null;
  }
  function result(stage, title, body, label, type, tone, badge, freshness, pending) {
    var nextAction = type ? Object.freeze({ type: type, label: label, tone: tone, badge: badge,
      freshness: freshness.text, stale: freshness.stale }) : null;
    return Object.freeze({ stage: stage, title: title, body: body, nextAction: nextAction,
      firstFeedPending: pending, testedAtDay: freshness.testedAtDay, readingAgeDays: freshness.readingAgeDays });
  }
  function guide(state, options) {
    options = options || {};
    state = state || {};
    var snap = options.snapshot || (PA.snapshotSummary ? PA.snapshotSummary(state) : null) || {};
    var pending = !!options.firstFeedPending;
    var boostDays = Math.max(0, Math.floor(finite(options.cycleBoostDays, 0)));
    var freshness = readingFreshness(state), cycle = state.cycle || {};
    var eaters = aliveEaters(state), water = waterByKey(snap), toxic = false, elevated = false;
    toxic = !!((water.ammonia && water.ammonia.severity === "danger") || (water.nitrite && water.nitrite.severity === "danger"));
    elevated = !!((water.ammonia && water.ammonia.severity === "warn") || (water.nitrite && water.nitrite.severity === "warn"));
    function view(stage, title, body, label, type, tone, badge) { return result(stage, title, body, label, type, tone, badge, freshness, pending); }

    if (!state.habitat) return view("choose_habitat", "No habitat chosen yet.", "Pick a freshwater or reef habitat to start the cycle.", "Choose a habitat", "open-dialog", "watch", "SET UP");
    if (!cycle.filled) return view("fill_tank", "The tank isn't filled yet.", "Add and dechlorinate water before anything can live in it.", isReef(state) ? "Mix saltwater & fill" : "Fill & dechlorinate", "setup-fill", "watch", "SET UP");
    if (!cycle.lifeSupport) return view("start_life_support", "Life support is off.", "The filter, heater and flow grow the biofilter that keeps water safe.", "Start life support", "life-on", "watch", "SET UP");
    if (toxic && eaters) return view("toxic_water", "Ammonia or nitrite is at a toxic level.", "A 25% water change dilutes the toxins now; don't feed heavily until it clears.", "25% water change", "wc25", "critical", "CRITICAL");
    if (elevated && eaters) return view("elevated_waste", "Ammonia or nitrite is elevated.", "It isn't toxic yet, but a 25% water change and lighter feeding keep it from climbing.", "25% water change", "wc25", "watch", "WATCH");
    if (deadCount(state)) return view("remove_dead", "A dead animal is decaying in the tank.", "Remove the body before it spikes ammonia — find it under Livestock.", "Review livestock", "open-livestock", "critical", "CRITICAL");
    var worst = worstWelfare(state);
    if (worst && (worst.hunger > 0.85 || worst.condition < 0.30)) return view("resident_starving", "A resident is starving — worst hunger " + pct(worst.hunger) + "%, worst body condition " + pct(worst.condition) + "%.", "Feed small portions: body condition rebuilds gradually over repeated feedings, and food they don't eat rots into ammonia.", "Feed the tank", "feed", "critical", "CRITICAL");
    if (worst && worst.health < 0.30) return view("resident_failing", "A resident's health has fallen to " + pct(worst.health) + "%.", "Hunger and body condition don't explain it — open Livestock and read that resident's details before treating the water.", "Review livestock", "open-livestock", "critical", "CRITICAL");
    if (boostDays && !eaters) return view("resume_inoculation", "The bacteria boost was interrupted.", "Retry inoculating bacteria to finish the remaining guided cycle days through the normal simulation.", "Retry inoculation", "inoculate", "watch", "CYCLING");
    if (!DATA.isCycled(state)) {
      if (!cycle.ammoniaSource && !eaters) return view("start_fishless_cycle", "The fishless cycle hasn't started.", "An ammonia source feeds the nitrifying bacteria that make the tank safe.", "Add ammonia source", "ammonia-on", "watch", "CYCLING");
      if (!cycle.inoculated && !eaters) return view("inoculate_filter", "Seed the filter to finish the cycle.", "Add bottled nitrifying bacteria — it establishes the biofilter and fast-forwards the fishless cycle so the tank is ready to stock.", "Inoculate bacteria", "inoculate", "watch", "CYCLING");
      return view("test_cycle", "The tank is still cycling — not safe to stock.", "Test the water to see when ammonia and nitrite have fallen safe with nitrate present.", "Test the water", "test", "watch", "CYCLING");
    }
    if (pending) return view("feed_fish", "Your first fish has settled in.", "Tap the water to drop a pellet and watch it respond — then keep the water clean.", "Feed the tank", "feed", "watch", "WATCH");
    var issue = environmentIssue(state, snap);
    if (issue) return view("correct_environment", issue[0], issue[1], issue[2], issue[3], "watch", "WATCH");
    issue = coralLightIssue(state, snap);
    if (issue) return view("correct_light", issue[0], issue[1], issue[2], issue[3], "watch", "WATCH");
    var nitrate = water.nitrate;
    if (nitrate && nitrate.severity !== "ok") return view("reduce_nitrate", "Nitrate is climbing from accumulated waste.", "A partial water change dilutes nitrate — a top-off won't, because evaporation leaves nitrate behind.", "25% water change", "wc25", "watch", "WATCH");
    if (state.succession && state.succession.cyano > 0.4) return view("control_cyano", "Cyanobacteria is spreading across surfaces.", "Improve flow and nutrient export and cut the photoperiod to starve it back.", "Review water", "open-water", "watch", "WATCH");
    if (freshness.stale) return view("test_water", "Your readings are getting stale.", "A quick water test refreshes every parameter so this guidance stays accurate.", "Test the water", "test", "watch", "WATCH");
    if (!eaters && !(snap.corals && snap.corals.length)) return view("stock_first_community", "The tank is cycled and the environment is in range.", "Nothing lives here yet — stock a small, compatible starter group from the store.", "Open the store", "open-store", "watch", "READY");
    return view("maintain", "Water is in range and residents look healthy.", "Keep parameters steady — consider corals, upgrades or a breeding project.", "Open the store", "open-store", "stable", "STABLE");
  }

  PA.sessionGuide = Object.freeze({ inoculationAdvanceDays: INOCULATION_ADVANCE_DAYS, project: guide });
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
