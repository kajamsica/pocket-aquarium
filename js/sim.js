/* Pocket Aquarium Ecosystem v4 — deterministic fixed-step simulation (FTG4-01B).
   No imports, network, assets, or dependencies. Extends window.PA (load after data.js).
   Node tests set `global.window = global` before require() so this attaches to the
   shared global. All state/actions are plain-JSON serializable and renderer-safe.
   Randomness comes only from a seeded RNG stored in state (state.rngState), so every
   test is repeatable. See docs/ECOLOGY_MODEL.md for the model rationale and citations. */
(function (global) {
  "use strict";
  var PA = (global.PA = global.PA || {});
  var DATA = PA.DATA;
  var ACT = DATA.ACTIONS;
  var STAGES = DATA.CYCLE_STAGES;

  /* ============================ tuning ============================ *
   * Broad, documented coefficients — a readable game model, not a
   * professional life-support controller. Rates are per game-day. */
  var TICK_DAYS = 0.05;              // fixed sub-step (20 ticks / game day)
  var SEC_PER_DAY = DATA.secondsPerGameDay1x; // real seconds per game day at 1x
  var OFFLINE_CAP = DATA.offlineCapDays;

  var PROC_A = 2.0, PROC_N = 2.0;    // nitrifier processing (mg/L per day at full pop * biofilter)
  var A_GROW = 0.55, N_GROW = 0.5;   // nitrifier maturation rate
  var BAC_DECAY = 0.02;              // nitrifier attrition without substrate
  var VALID_DAYS = 0.75;             // sustained-safe window before "Cycled"
  var YOUNG_DAYS = 8, MATURE_DAYS = 20; // tank-age biome gates (days since fill)
  var AMMONIA_DOSE = 0.7;            // fishless dosing mg/L per day (tops toward ~3)
  var FOOD_DECAY_DAYS = 0.6, FOOD_BOTTOM = 0.82, FOOD_FALL_PER_DAY = 2.4;
  var FOOD_AMMONIA = 0.14;           // ammonia per decayed uneaten portion (before dilution)
  var METAB_AMMONIA = 0.045;         // ammonia per bioload-unit per day (before dilution)
  var DECAY_AMMONIA = 0.28;          // ammonia per size-unit per day from a corpse
  var CONDITION_LOSS = 0.30, CONDITION_RECOVER = 0.18;
  var HEALTH_STARVE = 0.38, HEALTH_TOX = 0.5, HEALTH_RECOVER = 0.16;

  /* ============================ helpers ============================ */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function num(v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function approach(cur, target, rate, dt) { return cur + (target - cur) * clamp(rate * dt, 0, 1); }

  /* seeded mulberry32 — advances and returns a value in [0,1). state carries the int. */
  function rng(state) {
    var a = (state.rngState | 0);
    a = (a + 0x6D2B79F5) | 0;
    state.rngState = a;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rrange(state, lo, hi) { return lo + rng(state) * (hi - lo); }

  function tierVol(state) { var t = DATA.TIERS[state.tier]; return t ? t.volumeL : 75; }
  function equipLevel(cat, id) { return DATA.equipLevel(cat, id); }
  function EQ(state) {
    var e = state.equipment || {};
    return {
      filter: equipLevel("filter", e.filter) || DATA.EQUIPMENT.filter.levels[0],
      heater: equipLevel("heater", e.heater) || DATA.EQUIPMENT.heater.levels[0],
      circ: equipLevel("circulation", e.circulation) || DATA.EQUIPMENT.circulation.levels[0],
      light: equipLevel("light", e.light) || DATA.EQUIPMENT.light.levels[0],
      skimmer: equipLevel("skimmer", e.skimmer) || DATA.EQUIPMENT.skimmer.levels[0],
      refugium: equipLevel("refugium", e.refugium) || DATA.EQUIPMENT.refugium.levels[0],
      ato: equipLevel("ato", e.ato) || DATA.EQUIPMENT.ato.levels[0]
    };
  }
  function isReef(state) { return state.habitat === "reef"; }

  function daylight(frac) {
    var start = 0.28, end = 0.86; // photoperiod window within a game day
    if (frac <= start || frac >= end) return 0;
    var mid = (start + end) / 2, half = (end - start) / 2;
    return clamp(1 - Math.abs(frac - mid) / half, 0, 1);
  }

  /* ============================ construction ============================ */
  function emptyWater() {
    return {
      levelL: 0, tempC: 22, pH: 7.0, ammonia: 0, nitrite: 0, nitrate: 0, oxygen: 6.0,
      salinity: 0, alkalinity: 0, calcium: 0, magnesium: 0, phosphate: 0, par: 0, flow: 0,
      hardness: 8, tannin: 0
    };
  }

  function freshState(seed, credits, now) {
    var s = (seed == null) ? 0x9e3779b9 : (seed >>> 0);
    return {
      version: DATA.version,
      habitat: null,
      rngSeed: s, rngState: s,
      time: { days: 0 },
      speed: 1, lastSpeed: 1,
      credits: (credits == null ? 120 : credits), xp: 0,
      tier: "nano20",
      equipment: { filter: "sponge", heater: "none", circulation: "none", light: "basic", skimmer: "none", refugium: "none", ato: "none" },
      water: emptyWater(),
      cycle: { stage: "Setup", aob: 0.02, nob: 0.01, ammoniaSource: false, inoculated: false, lifeSupport: false, filled: false, validationDays: 0 },
      succession: { age: 0, haze: 0, diatom: 0, greenFilm: 0, cyano: 0, silicate: 1.0 },
      livestock: [], corals: [], clutches: [],
      microfauna: { pods: 0, worms: 0, infusoria: 0, biodiversity: 0 },
      food: [],
      breeding: { clown: { paired: false, femaleId: null, maleId: null, bondDays: 0, spawnCooldown: 0 }, tetra: { readyDays: 0, spawnCooldown: 0 } },
      tests: {}, selection: null,
      milestones: {}, tasks: [], log: [], memorial: [],
      lastRealTimestamp: (now == null ? 0 : now),
      nextId: 1
    };
  }

  /* The shell posts habitat aliases: index.html's first-run dialog submits
     value="freshwater", and render.js speaks "marine"/"freshwater". Normalize
     any alias to the canonical catalog ids ("amazon"/"reef") before use. */
  function normalizeHabitat(h) {
    if (h === "amazon" || h === "freshwater" || h === "fresh") return "amazon";
    if (h === "reef" || h === "marine" || h === "salt" || h === "saltwater") return "reef";
    return h;
  }

  function applyHabitatChoice(state, habitat) {
    habitat = normalizeHabitat(habitat);
    if (habitat !== "amazon" && habitat !== "reef") return;
    state.habitat = habitat;
    state.tier = DATA.HABITATS[habitat].startTier || "nano20";
    state.water = emptyWater();
    state.cycle = { stage: "Setup", aob: 0.02, nob: 0.01, ammoniaSource: false, inoculated: false, lifeSupport: false, filled: false, validationDays: 0 };
    state.succession = { age: 0, haze: 0, diatom: 0, greenFilm: 0, cyano: 0, silicate: 1.0 };
    state.livestock = []; state.corals = []; state.clutches = []; state.food = [];
    state.microfauna = { pods: 0, worms: 0, infusoria: 0, biodiversity: 0 };
    // live rock / leaf litter carry a starter microfauna seed
    if (habitat === "reef") state.microfauna.pods = 0.05;
    else state.microfauna.infusoria = 0.05;
    state.breeding = { clown: { paired: false, femaleId: null, maleId: null, bondDays: 0, spawnCooldown: 0 }, tetra: { readyDays: 0, spawnCooldown: 0 } };
    log(state, "habitat", "Started a new " + DATA.HABITATS[habitat].name + ".");
  }

  function createState(opts) {
    opts = opts || {};
    var st = freshState(opts.seed, opts.credits, opts.now);
    if (opts.habitat) applyHabitatChoice(st, opts.habitat);
    return st;
  }

  /* ============================ logging / awards ============================ */
  function log(state, type, message) {
    state.log.push({ day: Math.floor(state.time.days), t: +(state.time.days).toFixed(3), type: type, message: message });
    if (state.log.length > 240) state.log.splice(0, state.log.length - 240);
  }
  function award(state, key, xp, credits, message, once) {
    if (once && state.milestones[key]) return false;
    state.milestones[key] = (state.milestones[key] || 0) + 1;
    state.xp += xp; state.credits += credits;
    if (message) log(state, "milestone", message + (credits ? " (+" + credits + "c" : " (") + (xp ? " +" + xp + "xp)" : ")"));
    return true;
  }

  /* ============================ chemistry / cycling ============================ */
  function nitrifyEnv(w, reef) {
    var o2 = clamp(w.oxygen / 6, 0.2, 1);
    var temp = Math.exp(-Math.pow((w.tempC - 27) / 7, 2));      // peak ~27C
    var ph = reef ? clamp((w.pH - 6.5) / 1.6, 0.5, 1) : clamp((w.pH - 5.2) / 2.2, 0.45, 1);
    return clamp(0.25 + 0.75 * o2 * temp * ph, 0.2, 1);
  }

  function updateVolumeAndConcentration(state, dt, eq) {
    var w = state.water;
    if (!state.cycle.filled) return;
    var full = tierVol(state);
    var parNorm = clamp(w.par / 200, 0, 1);
    var tempF = clamp((w.tempC - 22) / 8, 0, 1);
    var evapFrac = 0.012 * (1 + 0.6 * tempF + 0.5 * parNorm) * dt; // fraction of volume/day
    var oldL = w.levelL;
    var evapL = oldL * evapFrac;
    var newL = Math.max(oldL - evapL, full * 0.4);
    // ATO auto-replaces evaporated freshwater, holding volume (and reef salinity) steady.
    // Net solute mass is conserved across evaporate(oldL->newL) + refill(newL->full),
    // which equals a single dilution from oldL to full — so use oldL, not newL.
    if (eq.ato.autoTopOff && newL < full) {
      applyDilution(state, oldL, full, /*freshwater*/ true);
      newL = full;
    } else {
      // evaporation concentrates dissolved species (salts + wastes)
      applyDilution(state, oldL, newL, /*evaporating*/ false);
    }
    w.levelL = newL;
  }

  /* Recompute dissolved concentrations when volume changes.
     freshwater=true means the added water is pure freshwater (top-off / ATO):
     conserve solute mass across old->new volume. Called with (fromL,toL). */
  function applyDilution(state, fromL, toL, freshwater) {
    if (fromL <= 0 || toL <= 0) return;
    var factor = fromL / toL; // >1 concentrating (evap), <1 diluting (top-off)
    var w = state.water;
    var keys = ["ammonia", "nitrite", "nitrate", "phosphate"];
    for (var i = 0; i < keys.length; i++) w[keys[i]] *= factor;
    if (isReef(state)) {
      w.salinity *= factor; w.alkalinity *= factor; w.calcium *= factor; w.magnesium *= factor;
    } else {
      w.hardness *= factor;
    }
    void freshwater;
  }

  function stepChemistry(state, dt) {
    var w = state.water, c = state.cycle, reef = isReef(state);
    if (!c.filled) return;
    var eq = EQ(state);
    var dilute = 75 / Math.max(tierVol(state), 20); // bigger tank => more dilution of bioload

    // Temperature toward heater target (or ambient), with seeded fluctuation
    if (c.lifeSupport) {
      var h = eq.heater;
      w.tempC = approach(w.tempC, h.target, h.tempPull, dt);
      var noise = (rng(state) - 0.5) * (1 - h.stability) * 1.2 * dt;
      w.tempC = clamp(w.tempC + noise, 10, 34);
    }

    // Flow from filter + circulation
    var flow = Math.max(c.lifeSupport ? eq.circ.flow : 0, c.lifeSupport ? eq.filter.flow : 0);
    w.flow = flow;

    // Oxygen toward a target set by circulation, penalized by bioload & temperature
    var bioload = DATA.currentBioload(state);
    var cap = DATA.bioloadCapacity(state);
    var o2target = 5 + 4 * (c.lifeSupport ? eq.circ.oxygen : 0.1) - 2 * clamp(bioload / (cap || 1), 0, 1.5) - clamp((w.tempC - 26) / 8, 0, 1);
    w.oxygen = clamp(approach(w.oxygen, clamp(o2target, 1, 9), 0.8, dt), 0, 12);

    // ----- ammonia sources -----
    if (c.ammoniaSource && w.ammonia < 3) w.ammonia += AMMONIA_DOSE * dt;
    // fish metabolism
    for (var i = 0; i < state.livestock.length; i++) {
      var a = state.livestock[i];
      var sp = DATA.SPECIES[a.species]; if (!sp) continue;
      if (a.alive !== false) {
        w.ammonia += sp.bioload * METAB_AMMONIA * (0.6 + 0.6 * (1 - a.hunger)) * dt * dilute;
      } else {
        // decaying biomass raises ammonia until removed
        w.ammonia += sp.bioload * DECAY_AMMONIA * dt * dilute;
      }
    }
    // uneaten food decomposition handled in stepFeeding (adds to ammonia)

    // ----- nitrification -----
    var env = nitrifyEnv(w, reef);
    if (c.lifeSupport) {
      var bioCap = DATA.TIERS[state.tier].biofilterBase * eq.filter.biofilterSurface;
      var procA = PROC_A * bioCap * c.aob * env;
      var convA = Math.min(w.ammonia, procA * dt);
      w.ammonia -= convA; w.nitrite += convA;
      var procN = PROC_N * bioCap * c.nob * env;
      var convN = Math.min(w.nitrite, procN * dt);
      w.nitrite -= convN; w.nitrate += convN;
      // maturation (logistic, needs substrate)
      var hasA = w.ammonia > 0.05 || c.ammoniaSource;
      var hasN = w.nitrite > 0.05;
      c.aob = clamp(c.aob + (A_GROW * env * (hasA ? 1 : 0) * (1 - c.aob) - BAC_DECAY * (hasA ? 0 : 1) * c.aob) * dt, 0.01, 1);
      c.nob = clamp(c.nob + (N_GROW * env * (hasN ? 1 : 0) * (1 - c.nob) - BAC_DECAY * (hasN ? 0 : 1) * c.nob) * dt, 0.01, 1);
    }

    // ----- nitrate / phosphate export (plants/refugium/skimmer) + coral/plant uptake -----
    var nitrateExport = eq.refugium.nitrateExport + 0.15 * eq.skimmer.organicExport + 0.02;
    w.nitrate = Math.max(0, w.nitrate - w.nitrate * nitrateExport * dt);
    // phosphate accrues with bioload/food, exported by skimmer/refugium
    w.phosphate += bioload * 0.0015 * dt * dilute;
    w.phosphate = Math.max(0, w.phosphate - w.phosphate * (0.1 + eq.skimmer.organicExport * 0.5 + eq.refugium.nitrateExport * 0.4) * dt);

    // reef calcifiers draw down alkalinity/calcium/magnesium in proportion to coral growth
    if (reef) {
      var draw = 0;
      for (var ci = 0; ci < state.corals.length; ci++) {
        var co = state.corals[ci], cd = DATA.CORALS[co.species];
        if (cd && co.health > 0.2) draw += cd.calcification * (0.4 + 0.6 * co.growth);
      }
      w.alkalinity = Math.max(0, w.alkalinity - draw * 0.35 * dt);
      w.calcium = Math.max(0, w.calcium - draw * 6 * dt);
      w.magnesium = Math.max(0, w.magnesium - draw * 4 * dt);
    }

    // pH drift: fresh blackwater trends acidic with tannins; reef holds high with alk buffer
    if (reef) w.pH = approach(w.pH, clamp(7.9 + (w.alkalinity - 7) * 0.05, 7.6, 8.5), 0.3, dt);
    else w.pH = approach(w.pH, clamp(7.0 - w.tannin * 0.9, 5.8, 7.2), 0.2, dt);
  }

  /* ----- cycle stage classification + validation window ----- */
  function classifyCycle(state, dt) {
    var w = state.water, c = state.cycle;
    var reefSafe = DATA.waterSafeForLife(state);
    var safeCycled = reefSafe && c.lifeSupport && w.nitrate > 1;
    if (safeCycled) c.validationDays += dt; else c.validationDays = Math.max(0, c.validationDays - dt * 0.5);

    var prevIdx = STAGES.indexOf(c.stage);
    var stage;
    if (!c.filled || !c.lifeSupport) stage = "Setup";
    else if (c.validationDays >= VALID_DAYS && safeCycled) {
      if (state.succession.age >= MATURE_DAYS) stage = "Mature biome";
      else if (state.succession.age >= YOUNG_DAYS) stage = "Young biome";
      else stage = "Cycled";
    } else if (w.nitrate > 2 && w.nitrite < 0.6) stage = "Nitrate present";
    else if (w.nitrite > 0.1 || c.nob > 0.06) stage = "Nitrite oxidation";
    else if (w.ammonia > 0.1 || c.aob > 0.08) stage = "Ammonia oxidation";
    else stage = "Setup";
    c.stage = stage;

    var idx = STAGES.indexOf(stage);
    // latch stage-reached milestones (award once as the cycle progresses upward)
    var names = ["setup", "cycle_ammonia", "cycle_nitrite", "cycle_nitrate", "cycle_cycled", "biome_young", "biome_mature"];
    for (var k = Math.max(1, prevIdx + 1); k <= idx; k++) {
      award(state, names[k], k >= 4 ? 25 : 10, k >= 4 ? 15 : 5, "Cycle reached: " + STAGES[k], true);
    }
  }

  /* ============================ succession / ugly phases ============================ */
  function stepSuccession(state, dt) {
    var s = state.succession, w = state.water, c = state.cycle;
    if (!c.filled) return;
    s.age += dt;
    var eq = EQ(state);
    var parNorm = clamp(w.par / 200, 0, 1);
    var nutrient = clamp(w.nitrate / 30 + w.phosphate / 0.15, 0, 1.5);
    var exportP = clamp(eq.skimmer.organicExport + eq.refugium.nitrateExport, 0, 1.5);
    var bio = state.microfauna.biodiversity;

    // bacterial haze: strong while nitrifiers immature, fades as filter matures
    var hazeT = clamp((1 - c.aob) * (c.ammoniaSource || DATA.currentBioload(state) > 0 ? 1 : 0.4) - 0.1, 0, 1);
    s.haze = approach(s.haze, hazeT, 0.6, dt);

    // diatoms: young tank + silicate + light; silicate depletes as diatoms consume it
    var diatomT = clamp(s.silicate * (0.4 + 0.6 * parNorm) * clamp(1 - (s.age - 10) / 20, 0, 1), 0, 1);
    s.diatom = approach(s.diatom, diatomT, 0.5, dt);
    s.silicate = Math.max(0, s.silicate - s.diatom * 0.08 * dt);

    // green film: nutrients + light, mid age
    var greenT = clamp(nutrient * (0.3 + 0.7 * parNorm) - 0.15 * exportP, 0, 1);
    s.greenFilm = approach(s.greenFilm, greenT, 0.4, dt);

    // cyanobacteria: nutrients * dead-zone(flow) * long/high light, minus export + biodiversity + flow
    var deadzone = c.lifeSupport ? eq.circ.deadzone : 0.95;
    var cyanoT = clamp(nutrient * deadzone * (0.4 + 0.6 * parNorm) - 0.4 * exportP - 0.4 * bio - 0.2 * w.flow, 0, 1);
    s.cyano = approach(s.cyano, cyanoT, 0.4, dt);
  }

  /* ============================ light / PAR ============================ */
  function stepLight(state) {
    var w = state.water, eq = EQ(state);
    var frac = state.time.days - Math.floor(state.time.days);
    w.par = eq.light.parCeiling * daylight(frac);
  }

  /* ============================ feeding ============================ */
  function stepFeeding(state, dt) {
    var w = state.water, food = state.food, i;
    // Pellets fall through authoritative tank space. Feeding is completed only by
    // CONSUME_FOOD after the renderer observes a fish make visual contact.
    for (i = 0; i < food.length; i++) {
      food[i].ageDays += dt;
      food[i].y = Math.min(FOOD_BOTTOM, food[i].y + FOOD_FALL_PER_DAY * dt);
      food[i].sunk = food[i].y >= FOOD_BOTTOM - 1e-9;
    }
    // decompose uneaten pellets
    var kept = [];
    var dilute = 75 / Math.max(tierVol(state), 20);
    for (i = 0; i < food.length; i++) {
      if (food[i].consumed) continue;
      if (food[i].ageDays >= FOOD_DECAY_DAYS) { w.ammonia += FOOD_AMMONIA * food[i].amount * dilute; w.phosphate += 0.01 * food[i].amount * dilute; continue; }
      kept.push(food[i]);
    }
    state.food = kept;
  }

  /* ============================ livestock welfare ============================ */
  function stressFactors(state, a, sp) {
    var w = state.water, out = { starve: 0, toxic: 0, temp: 0, salinity: 0, oxygen: 0, crowd: 0 };
    if (a.condition < 0.3) out.starve = HEALTH_STARVE * (0.3 - a.condition) / 0.3;
    var toxA = Math.max(0, w.ammonia - HEALTH_TOX), toxN = Math.max(0, w.nitrite - HEALTH_TOX);
    if (toxA > 0 || toxN > 0) out.toxic = HEALTH_TOX * clamp(0.3 + (toxA + toxN) / HEALTH_TOX, 0, 1.6);
    var dTemp = Math.abs(w.tempC - 26);
    if (dTemp > 4) out.temp = 0.12 * (dTemp - 4);
    if (isReef(state)) { var dSal = Math.abs(w.salinity - 35); if (dSal > 3) out.salinity = 0.1 * (dSal - 3); }
    if (w.oxygen < 4.5) out.oxygen = 0.15 * (4.5 - w.oxygen);
    var cap = DATA.bioloadCapacity(state);
    if (DATA.currentBioload(state) > cap) out.crowd = 0.08;
    return out;
  }

  function stepLivestock(state, dt) {
    var i, ls = state.livestock;
    for (i = 0; i < ls.length; i++) {
      var a = ls[i]; var sp = DATA.SPECIES[a.species]; if (!sp) continue;
      if (a.alive === false) { a.decayDays = (a.decayDays || 0) + dt; continue; }
      a.ageDays += dt;
      if (a.stage !== "adult" && a.ageDays >= sp.maturityDays && a.health > 0.4) {
        a.stage = "adult";
        award(state, "adult_" + sp.id, 8, 4, sp.name + " matured to an adult.", true);
      }
      // hunger rises with metabolism
      a.hunger = clamp(a.hunger + (sp.metabolic / (sp.feedIntervalDays * 1.4)) * dt, 0, 1.2);
      // condition tracks feeding
      if (a.hunger > 0.85) a.condition = clamp(a.condition - CONDITION_LOSS * dt, 0, 1);
      else if (a.hunger < 0.5) a.condition = clamp(a.condition + CONDITION_RECOVER * dt, 0, 1);
      // health from stressors
      var f = stressFactors(state, a, sp);
      var loss = f.starve + f.toxic + f.temp + f.salinity + f.oxygen + f.crowd;
      if (loss > 0) {
        a.health = clamp(a.health - loss * dt, 0, 1);
      } else if (a.condition > 0.6 && a.hunger < 0.7) {
        a.health = clamp(a.health + HEALTH_RECOVER * dt, 0, 1);
      }
      if (a.health <= 0) killAnimal(state, a, dominantCause(f));
    }
  }

  function dominantCause(f) {
    var best = "unknown", v = 0, k;
    var labels = { starve: "starvation", toxic: "toxic ammonia/nitrite", temp: "temperature shock", salinity: "salinity shock", oxygen: "low oxygen", crowd: "chronic crowding" };
    for (k in f) if (f.hasOwnProperty(k) && f[k] > v) { v = f[k]; best = labels[k]; }
    return best;
  }

  function killAnimal(state, a, cause) {
    a.alive = false; a.health = 0; a.causeOfDeath = cause; a.decayDays = 0;
    var sp = DATA.SPECIES[a.species];
    log(state, "death", (sp ? sp.name : a.species) + " died — proximate cause: " + cause + ". Remove the body before it fouls the water.");
    state.memorial.push({ species: a.species, name: sp ? sp.name : a.species, ageDays: +a.ageDays.toFixed(1), cause: cause, day: Math.floor(state.time.days) });
  }

  /* ============================ corals / polyps ============================ */
  function bandScore(v, band) {
    // 1 inside [low,high]; decays to 0 at [min,max]; slightly negative beyond
    if (v >= band.low && v <= band.high) return 1;
    if (v < band.low) return clamp((v - band.min) / (band.low - band.min), -0.5, 1);
    return clamp((band.max - v) / (band.max - band.high), -0.5, 1);
  }
  function stepCorals(state, dt) {
    if (!isReef(state)) return;
    var w = state.water, i;
    var stable = DATA.waterSafeForLife(state) &&
      w.salinity >= 33 && w.salinity <= 36 && w.alkalinity >= 6.5 && Math.abs(w.tempC - 26) < 4;
    var stabF = stable ? 1 : 0.4;
    var frac = state.time.days - Math.floor(state.time.days);
    var dayF = daylight(frac); // day feeders open in light
    for (i = 0; i < state.corals.length; i++) {
      var co = state.corals[i], cd = DATA.CORALS[co.species]; if (!cd) continue;
      var parS = bandScore(w.par, cd.par);
      var flowS = bandScore(w.flow, cd.flow);
      var openScore = clamp(Math.min(parS, flowS) * (0.4 + 0.6 * dayF) * (0.6 + 0.4 * stabF), 0, 1);
      co.extension = approach(co.extension, openScore, 4.0, dt);
      // stress accrues when light/flow/chemistry are wrong; relaxes when good
      // Insufficient-light stress applies only during the photoperiod (dayF>0); the
      // natural night is not "too little light" for a day-feeder — its polyps simply
      // close (handled by the dayF term in openScore above). Without this gate a
      // well-kept coral would accrue max stress every night and slowly die.
      var badLight = (parS < 0.5 ? (0.5 - parS) : 0) * dayF;
      var stressT = clamp(badLight + (1 - flowS) * 0.3 + (1 - stabF) * 0.5, 0, 1);
      co.stress = approach(co.stress, stressT, 0.5, dt);
      // feeding reserve from suspended food (fed particles) + light
      var fedNear = state.food.length > 0 ? 0.4 : 0;
      co.feedingReserve = clamp(approach(co.feedingReserve, clamp(0.3 * dayF + fedNear, 0, 1), 0.3, dt), 0, 1);
      // health & growth
      if (co.stress > 0.35) co.health = clamp(co.health - (co.stress - 0.35) * 0.5 * dt, 0, 1);
      else if (co.extension > 0.5 && stable) co.health = clamp(co.health + 0.12 * dt, 0, 1);
      if (co.health > 0.6 && co.stress < 0.3 && co.extension > 0.5) {
        var g = 0.06 * (0.5 + co.feedingReserve) * dt;
        co.growth = clamp(co.growth + g, 0, 1);
        co.polyps = co.polyps + g * 20;
        if (co.growth >= 0.6) award(state, "coral_mature_" + co.species, 30, 20, cd.name + " reached a mature, growing colony.", true);
      }
      co.tissue = clamp(0.3 + 0.7 * co.health, 0, 1);
    }
  }

  /* ============================ microfauna ============================ */
  function stepMicrofauna(state, dt) {
    var m = state.microfauna, eq = EQ(state);
    var reef = isReef(state);
    var podCap = (reef ? 0.3 : 0.35) + eq.refugium.podCapacity * 0.7;
    var infuCap = (reef ? 0.2 : 0.5) + eq.refugium.podCapacity * 0.3;
    // predation pressure from specialist/small livestock + fry
    var predation = 0, i;
    for (i = 0; i < state.livestock.length; i++) {
      var a = state.livestock[i]; if (!a || a.alive === false) continue;
      var sp = DATA.SPECIES[a.species]; if (!sp) continue;
      if (sp.diet === "micro-omnivore" || sp.diet === "benthic-omnivore" || sp.diet === "carnivore") predation += 0.02;
    }
    // detritus feeds worms; pods and infusoria are pure logistic populations so an
    // empty tank stays empty until seeded (live culture / refugium / leaf litter).
    var detritus = clamp(state.water.ammonia + state.water.nitrate / 40, 0, 1);
    m.pods = clamp(m.pods + (0.6 * m.pods * (1 - m.pods / Math.max(podCap, 0.05)) - predation) * dt, 0, 1);
    m.worms = clamp(m.worms + (0.5 * (detritus * 0.5 + 0.05) * (1 - m.worms / 0.8)) * dt, 0, 1);
    m.infusoria = clamp(m.infusoria + (0.7 * m.infusoria * (1 - m.infusoria / Math.max(infuCap, 0.05)) - predation * 0.5) * dt, 0, 1);
    m.biodiversity = clamp(0.35 * m.pods + 0.25 * m.worms + 0.25 * m.infusoria + 0.15 * clamp(state.corals.length / 3, 0, 1), 0, 1);
  }

  /* ============================ breeding ============================ */
  function adultsOf(state, speciesId) {
    var out = [], ls = state.livestock;
    for (var i = 0; i < ls.length; i++) {
      var a = ls[i]; if (a && a.alive !== false && a.species === speciesId && a.stage === "adult") out.push(a);
    }
    return out;
  }
  function healthyAll(list, min) { for (var i = 0; i < list.length; i++) if (list[i].health < min) return false; return list.length > 0; }

  function stepBreeding(state, dt) {
    var w = state.water;
    // ---------- clownfish (pair, protandrous, male tends eggs 6-8 days) ----------
    var cb = state.breeding.clown, def = DATA.SPECIES.ocellaris.breeding;
    var clowns = adultsOf(state, "ocellaris");
    cb.spawnCooldown = Math.max(0, cb.spawnCooldown - dt);
    if (clowns.length >= 2) {
      // hierarchy: largest (oldest) becomes female, next becomes male
      clowns.sort(function (a, b) { return (b.ageDays - a.ageDays) || (a.id - b.id); });
      clowns[0].sex = "female"; clowns[1].sex = "male";
      for (var z = 2; z < clowns.length; z++) clowns[z].sex = "unknown";
      cb.femaleId = clowns[0].id; cb.maleId = clowns[1].id;
      var feats = DATA.tankFeatures(state);
      var stable = DATA.waterSafeForLife(state) && Math.abs(w.tempC - 26) < 3 && w.salinity >= 33 && w.salinity <= 36;
      var cond = healthyAll([clowns[0], clowns[1]], 0.7) && stable && feats.host && !overCapacity(state);
      if (cond) {
        cb.bondDays += dt;
        if (!cb.paired && cb.bondDays >= def.pairBondDays) {
          cb.paired = true; award(state, "clown_pair", 30, 20, "Clownfish formed a bonded breeding pair.", true);
        }
        if (cb.paired && cb.spawnCooldown <= 0) {
          spawnClutch(state, "ocellaris", 20, def.incubationDays, "pods");
          cb.spawnCooldown = 10;
        }
      } else {
        cb.bondDays = Math.max(0, cb.bondDays - dt);
      }
    } else { cb.paired = false; cb.bondDays = 0; }

    // ---------- neon tetra (school spawn, short incubation, microfood-dependent fry) ----------
    var tb = state.breeding.tetra, tdef = DATA.SPECIES.neon_tetra.breeding;
    tb.spawnCooldown = Math.max(0, tb.spawnCooldown - dt);
    var tetras = adultsOf(state, "neon_tetra");
    var dim = EQ(state).light.parCeiling <= 80; // subdued lighting (basic strip / shaded blackwater)
    var soft = w.pH <= tdef.water.pHMax && w.hardness <= tdef.water.hardnessMax;
    var tcond = tetras.length >= tdef.socialMin && healthyAll(tetras, 0.7) && soft && dim &&
      DATA.tankFeatures(state).cover && DATA.waterSafeForLife(state) && !overCapacity(state);
    if (tcond) {
      tb.readyDays += dt;
      if (tb.readyDays >= 1 && tb.spawnCooldown <= 0) {
        spawnClutch(state, "neon_tetra", 30, tdef.incubationDays, "infusoria");
        tb.spawnCooldown = 6; tb.readyDays = 0;
      }
    } else { tb.readyDays = Math.max(0, tb.readyDays - dt); }

    // ---------- clutch progression ----------
    stepClutches(state, dt);
  }

  function overCapacity(state) { return DATA.currentBioload(state) > DATA.bioloadCapacity(state) + 1e-9; }

  function spawnClutch(state, species, count, incubation, fryFeature) {
    var id = state.nextId++;
    state.clutches.push({ id: id, species: species, stage: "eggs", ageDays: 0, count: count, incubation: incubation, fryFeature: fryFeature, tended: true });
    var sp = DATA.SPECIES[species];
    award(state, "spawn_" + species, 25, 12, sp.name + " spawned a clutch of eggs.", true);
    log(state, "breeding", sp.name + " laid " + count + " eggs.");
  }

  function stepClutches(state, dt) {
    var keep = [], w = state.water;
    for (var i = 0; i < state.clutches.length; i++) {
      var cl = state.clutches[i]; var sp = DATA.SPECIES[cl.species];
      cl.ageDays += dt;
      var stable = DATA.waterSafeForLife(state) && Math.abs(w.tempC - 26) < 4;
      if (cl.stage === "eggs") {
        if (!stable) cl.count = Math.max(0, cl.count - cl.count * 0.4 * dt); // unstable water spoils eggs
        if (cl.ageDays >= cl.incubation) {
          if (cl.count >= 1) {
            cl.stage = "hatched"; cl.ageDays = 0;
            award(state, "hatch_" + cl.species, 25, 12, sp.name + " eggs hatched into larvae.", true);
            log(state, "breeding", sp.name + " larvae hatched (" + Math.round(cl.count) + ").");
          } else { log(state, "breeding", sp.name + " clutch failed to hatch."); continue; }
        }
      } else if (cl.stage === "hatched") {
        // fry survival needs the right microfood + stability
        var micro = state.microfauna[cl.fryFeature] || 0;
        var haveFood = micro > 0.2;
        // Without the right microfood (pods for clownfish, infusoria for tetra) larvae
        // starve fast; with it, only light natural attrition remains.
        if (!haveFood || !stable) cl.count = Math.max(0, cl.count - cl.count * 1.6 * dt);
        else cl.count = Math.max(0, cl.count - cl.count * 0.05 * dt);
        if (cl.ageDays >= 3) {
          if (cl.count >= 1) {
            cl.stage = "fry"; cl.ageDays = 0;
            award(state, "fry_" + cl.species, 40, 25, sp.name + " fry survived past the critical larval stage.", true);
            log(state, "breeding", Math.round(cl.count) + " " + sp.name + " fry survived on " + cl.fryFeature + ".");
          } else { log(state, "breeding", sp.name + " larvae did not survive (insufficient " + cl.fryFeature + ")."); continue; }
        }
      } else if (cl.stage === "fry") {
        if (cl.ageDays >= 4) { log(state, "breeding", sp.name + " fry grew into juveniles."); continue; }
      }
      keep.push(cl);
    }
    state.clutches = keep;
  }

  /* ============================ main step ============================ */
  function tick(state, dt) {
    state.time.days += dt;
    // freshness ages
    for (var k in state.tests) if (state.tests.hasOwnProperty(k)) state.tests[k].ageDays += dt;
    if (!state.habitat) return;
    stepLight(state);
    updateVolumeAndConcentration(state, dt, EQ(state));
    stepChemistry(state, dt);
    stepFeeding(state, dt);
    stepLivestock(state, dt);
    stepCorals(state, dt);
    stepMicrofauna(state, dt);
    stepBreeding(state, dt);
    stepSuccession(state, dt);
    classifyCycle(state, dt);
    // stable-day credit: reward keeping water safe with living stock
    if (DATA.waterSafeForLife(state) && aliveCount(state) > 0) {
      state._stableAccum = (state._stableAccum || 0) + dt;
      if (state._stableAccum >= 1) { state._stableAccum -= 1; award(state, "stable_day", 5, 8, "A calm, stable day of good husbandry.", false); }
    }
  }

  function aliveCount(state) { var n = 0; for (var i = 0; i < state.livestock.length; i++) if (state.livestock[i].alive !== false) n++; return n; }

  function stepDays(state, gameDays) {
    if (!(gameDays > 0)) return state;
    var remaining = gameDays;
    var guard = 0;
    while (remaining > 1e-9 && guard < 200000) {
      var dt = remaining < TICK_DAYS ? remaining : TICK_DAYS;
      tick(state, dt);
      remaining -= dt; guard++;
    }
    return state;
  }

  function step(state, realSeconds) {
    var speed = num(state.speed, 0);
    if (speed <= 0 || !(realSeconds > 0)) return state;
    return stepDays(state, realSeconds * speed / SEC_PER_DAY);
  }

  /* Offline catch-up capped at DATA.offlineCapDays. Returns a return-report.
     Cannot instantly kill a healthy animal because welfare loss is gradual. */
  function offlineCatchUp(state, elapsedMs) {
    var requested = (num(elapsedMs, 0) / 1000) / SEC_PER_DAY; // at 1x
    var applied = Math.min(Math.max(requested, 0), OFFLINE_CAP);
    var before = aliveCount(state);
    stepDays(state, applied);
    state.lastRealTimestamp = num(state.lastRealTimestamp, 0) + num(elapsedMs, 0);
    var report = { requestedDays: +requested.toFixed(3), appliedDays: +applied.toFixed(3), capped: requested > OFFLINE_CAP, deaths: before - aliveCount(state) };
    log(state, "offline", "Away " + report.appliedDays + " game day(s)" + (report.capped ? " (capped at " + OFFLINE_CAP + ")" : "") + ".");
    return report;
  }

  /* ============================ dispatch ============================ */
  function dispatch(state, action) {
    if (!state || !action || !action.type) return state;
    switch (action.type) {
      case ACT.CHOOSE_HABITAT:
        applyHabitatChoice(state, action.habitat); break;

      case ACT.SETUP_FILL: doFill(state); break;
      case ACT.SETUP_LIFE_SUPPORT:
        if (state.cycle.filled) { state.cycle.lifeSupport = (action.on !== false); log(state, "setup", "Life support " + (state.cycle.lifeSupport ? "started" : "stopped") + "."); }
        break;
      case ACT.ADD_AMMONIA_SOURCE:
        if (state.cycle.filled) { state.cycle.ammoniaSource = (action.on !== false); if (state.cycle.ammoniaSource) log(state, "setup", "Added an ammonia source to start the fishless cycle."); }
        break;
      case ACT.INOCULATE_BACTERIA:
        if (state.cycle.filled) { state.cycle.inoculated = true; state.cycle.aob = Math.max(state.cycle.aob, 0.25); state.cycle.nob = Math.max(state.cycle.nob, 0.12); award(state, "inoculate", 8, 0, "Inoculated the filter with nitrifying bacteria.", true); }
        break;

      case ACT.WATER_TEST: doTest(state, action.param); break;
      case ACT.WATER_CHANGE: doWaterChange(state, num(action.fraction, 0.25)); break;
      case ACT.WATER_TOP_OFF: doTopOff(state); break;

      case ACT.PURCHASE_EQUIPMENT: doBuyEquipment(state, action.category, action.levelId); break;
      case ACT.PURCHASE_TIER: doBuyTier(state, action.tier); break;
      case ACT.PURCHASE_LIVESTOCK: doBuyLivestock(state, action.species, action.count); break;
      case ACT.PURCHASE_CORAL: doBuyCoral(state, action.coral); break;
      case ACT.SEED_MICROFAUNA: doSeedMicrofauna(state, action.culture); break;

      case ACT.FEED:
      case "FEED_AT": doFeed(state, action.x, action.y); break; // FEED_AT is the renderer's pointer-feed action
      case ACT.CONSUME_FOOD: doConsumeFood(state, action.foodId, action.eaterId); break;
      case ACT.SELECT_ENTITY: state.selection = (action.id == null) ? null : { entityType: action.entityType || "livestock", id: action.id }; break;
      case ACT.REMOVE_DEAD: doRemoveDead(state, action.id); break;

      case ACT.SET_SPEED: doSetSpeed(state, action.speed); break;
      case ACT.TOGGLE_PAUSE:
        if (state.speed > 0) { state.lastSpeed = state.speed; state.speed = 0; }
        else { state.speed = state.lastSpeed || 1; }
        break;
      default: break;
    }
    return state;
  }

  function doFill(state) {
    if (!state.habitat) return;
    var w = state.water; w.levelL = tierVol(state);
    if (isReef(state)) { w.salinity = 35; w.alkalinity = 8.5; w.calcium = 420; w.magnesium = 1300; w.pH = 8.2; w.phosphate = 0.02; w.oxygen = 6.5; w.tempC = 24; }
    else { w.pH = 6.6; w.hardness = 3; w.tannin = 0.6; w.oxygen = 6.5; w.tempC = 23; }
    w.ammonia = 0; w.nitrite = 0; w.nitrate = 0;
    state.cycle.filled = true;
    state.succession.silicate = 1.0;
    log(state, "setup", isReef(state) ? "Mixed saltwater to ~35 ppt and filled the tank." : "Filled and dechlorinated the tank.");
    award(state, "filled", 5, 0, null, true);
  }

  function doTest(state, param) {
    var hab = state.habitat; if (!hab) return;
    var keys = param ? [param] : DATA.HABITATS[hab].params;
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var val = key === "level" ? (state.water.levelL / tierVol(state) * 100) : state.water[key];
      state.tests[key] = { value: +num(val, 0).toFixed(3), ageDays: 0, known: true };
    }
    award(state, "first_test", 8, 0, "Ran the first water test.", true);
  }

  function doWaterChange(state, fraction) {
    fraction = clamp(fraction, 0, 0.9);
    var w = state.water, reef = isReef(state);
    var wastes = ["ammonia", "nitrite", "nitrate", "phosphate"];
    for (var i = 0; i < wastes.length; i++) w[wastes[i]] *= (1 - fraction);
    if (reef) {
      w.salinity = lerp(w.salinity, 35, fraction); w.alkalinity = lerp(w.alkalinity, 8.5, fraction);
      w.calcium = lerp(w.calcium, 420, fraction); w.magnesium = lerp(w.magnesium, 1300, fraction);
    } else { w.hardness = lerp(w.hardness, 3, fraction); }
    w.levelL = tierVol(state);
    log(state, "water", Math.round(fraction * 100) + "% water change — diluted wastes and replenished buffers.");
  }

  function doTopOff(state) {
    var full = tierVol(state);
    if (state.water.levelL >= full) { log(state, "water", "Water level is already full."); return; }
    applyDilution(state, state.water.levelL, full, true);
    state.water.levelL = full;
    log(state, "water", isReef(state) ? "Topped off with freshwater — restored volume and lowered salinity back toward 35 ppt." : "Topped off with freshwater — restored volume and diluted dissolved wastes.");
  }

  function doBuyEquipment(state, category, levelId) {
    var v = PA.validatePurchase(state, { kind: "equipment", category: category, levelId: levelId });
    if (!v.ok) { log(state, "store", "Cannot buy equipment: " + v.reasons.join(" ")); return false; }
    var lvl = equipLevel(category, levelId);
    state.credits -= lvl.price; state.equipment[category] = levelId;
    log(state, "store", "Installed " + lvl.name + ".");
    award(state, "equip_" + category + "_" + levelId, 6, 0, null, true);
    return true;
  }
  function doBuyTier(state, tier) {
    var v = PA.validatePurchase(state, { kind: "tier", id: tier });
    if (!v.ok) { log(state, "store", "Cannot upgrade tank: " + v.reasons.join(" ")); return false; }
    var t = DATA.TIERS[tier]; state.credits -= t.price;
    var ratio = t.volumeL / Math.max(state.water.levelL, 1);
    state.tier = tier;
    // new water dilutes existing (topped to new volume with matched water)
    applyDilution(state, state.water.levelL, t.volumeL, !isReef(state));
    state.water.levelL = t.volumeL;
    void ratio;
    log(state, "store", "Upgraded to the " + t.name + " tank.");
    award(state, "tier_" + tier, 20, 0, null, true);
    return true;
  }
  function doBuyLivestock(state, species, cnt) {
    var v = PA.validatePurchase(state, { kind: "livestock", id: species, count: cnt });
    if (!v.ok) { log(state, "store", "Cannot add " + (DATA.SPECIES[species] ? DATA.SPECIES[species].name : species) + ": " + v.reasons.join(" ")); return false; }
    var sp = DATA.SPECIES[species];
    var n = Math.max(1, Math.floor(cnt || DATA.BUNDLES[species] || 1));
    state.credits -= sp.price * n;
    for (var i = 0; i < n; i++) state.livestock.push(makeAnimal(state, species));
    state.cycle.ammoniaSource = false; // stop dosing once real bioload is present
    log(state, "store", "Added " + n + " " + sp.name + (n > 1 ? "" : "") + " to the tank.");
    award(state, "first_livestock", 15, 0, "First livestock added.", true);
    // symbiosis note (goby + pistol shrimp)
    if (sp.symbiosisWith && DATA.currentBioload(state) >= 0 && aliveSpecies(state, sp.symbiosisWith) > 0)
      award(state, "symbiosis", 20, 15, "A goby–pistol-shrimp symbiosis formed.", true);
    return true;
  }
  function aliveSpecies(state, id) { var n = 0; for (var i = 0; i < state.livestock.length; i++) if (state.livestock[i].alive !== false && state.livestock[i].species === id) n++; return n; }

  function makeAnimal(state, species) {
    var sp = DATA.SPECIES[species];
    return {
      id: state.nextId++, species: species, kind: sp.kind,
      ageDays: sp.maturityDays * 0.4, stage: "juvenile", sex: "unknown",
      hunger: 0.2, condition: 1, health: 1, alive: true, causeOfDeath: null, decayDays: 0,
      lastFedDay: state.time.days,
      x: rrange(state, 0.15, 0.85), y: rrange(state, 0.2, 0.8)
    };
  }
  function doBuyCoral(state, coral) {
    var v = PA.validatePurchase(state, { kind: "coral", id: coral });
    if (!v.ok) { log(state, "store", "Cannot add coral: " + v.reasons.join(" ")); return false; }
    var cd = DATA.CORALS[coral]; state.credits -= cd.price;
    state.corals.push({
      id: state.nextId++, species: coral, health: 0.9, tissue: 0.9, polyps: cd.startPolyps,
      extension: 0.4, growth: 0.1, feedingReserve: 0.4, stress: 0.1,
      x: rrange(state, 0.2, 0.8), y: rrange(state, 0.55, 0.85)
    });
    log(state, "store", "Added a " + cd.name + " to the reef.");
    award(state, "first_coral", 15, 0, "First coral colony added.", true);
    return true;
  }
  function doSeedMicrofauna(state, culture) {
    var cost = 15;
    if (state.credits < cost) { log(state, "store", "Not enough credits for a live culture."); return false; }
    state.credits -= cost;
    var m = state.microfauna;
    if (culture === "infusoria") m.infusoria = Math.max(m.infusoria, 0.35);
    else { m.pods = Math.max(m.pods, 0.25); m.infusoria = Math.max(m.infusoria, 0.2); }
    log(state, "store", "Seeded a live " + (culture || "pod/copepod") + " culture.");
    award(state, "seed_microfauna", 8, 0, null, true);
    return true;
  }
  function doFeed(state, x, y) {
    var w = state.water;
    var dangerous = w.ammonia > (DATA.PARAMS.ammonia.good[1]) || w.nitrite > (DATA.PARAMS.nitrite.good[1]);
    var level = clamp(w.levelL / Math.max(tierVol(state), 1), 0, 1);
    var py = clamp(0.05 + (1 - level) * (FOOD_BOTTOM - 0.05), 0.05, FOOD_BOTTOM);
    state.food.push({ id: state.nextId++, x: clamp(num(x, 0.5), 0, 1), y: py, amount: 1, ageDays: 0, sunk: py >= FOOD_BOTTOM, consumed: false });
    void y; // vertical pointer position chooses the tank gesture; food enters at its surface
    if (dangerous) { state._feedWarning = true; log(state, "warn", "Careful — feeding while ammonia/nitrite is elevated worsens the water. Feed sparingly."); }
  }
  function doConsumeFood(state, foodId, eaterId) {
    var fi = -1, eater = null, i;
    for (i = 0; i < state.food.length; i++) if (String(state.food[i].id) === String(foodId)) { fi = i; break; }
    for (i = 0; i < state.livestock.length; i++) if (String(state.livestock[i].id) === String(eaterId)) { eater = state.livestock[i]; break; }
    if (fi < 0 || !eater || eater.alive === false || eater.hunger <= 0.05) return false;
    var p = state.food[fi], sp = DATA.SPECIES[eater.species];
    if (!sp || sp.kind === "invert" || (sp.layer === "bottom" && !p.sunk)) return false;
    eater.hunger = clamp(eater.hunger - sp.mealSize * p.amount, 0, 1.2);
    eater.lastFedDay = state.time.days;
    state.food.splice(fi, 1);
    return true;
  }
  function doRemoveDead(state, id) {
    var kept = [], removed = 0;
    for (var i = 0; i < state.livestock.length; i++) {
      var a = state.livestock[i];
      if (a.alive === false && (id == null || a.id === id)) { removed++; continue; }
      kept.push(a);
    }
    state.livestock = kept;
    if (removed) { log(state, "care", "Removed decaying biomass — the water can recover now."); award(state, "removed_dead", 3, 0, null, false); }
  }
  function doSetSpeed(state, speed) {
    if (DATA.speeds.indexOf(speed) < 0) return;
    if (speed > 0) state.lastSpeed = speed;
    state.speed = speed;
  }

  /* ============================ snapshot ============================ */
  function severityOf(band, value) {
    if (!band) return "ok";
    if (band.good && value >= band.good[0] && value <= band.good[1]) return "ok";
    if (band.warn && value >= band.warn[0] && value <= band.warn[1]) return "warn";
    return "danger";
  }
  function snapshotSummary(state) {
    if (!state) return null;
    var hab = state.habitat, out = {
      habitat: hab, habitatName: hab ? DATA.HABITATS[hab].name : null,
      waterType: hab ? DATA.HABITATS[hab].waterType : null,
      day: Math.floor(state.time.days), dayFloat: +state.time.days.toFixed(3),
      timeLabel: timeLabel(state), speed: state.speed,
      credits: Math.floor(state.credits), xp: Math.floor(state.xp),
      tier: state.tier, tierName: DATA.TIERS[state.tier] ? DATA.TIERS[state.tier].name : state.tier,
      cycle: { stage: state.cycle.stage, index: STAGES.indexOf(state.cycle.stage), aob: r3(state.cycle.aob), nob: r3(state.cycle.nob), validationDays: r3(state.cycle.validationDays), cycled: DATA.isCycled(state) },
      succession: { haze: r3(state.succession.haze), diatom: r3(state.succession.diatom), greenFilm: r3(state.succession.greenFilm), cyano: r3(state.succession.cyano), age: r3(state.succession.age) },
      water: [], livestock: [], corals: [],
      microfauna: { pods: r3(state.microfauna.pods), worms: r3(state.microfauna.worms), infusoria: r3(state.microfauna.infusoria), biodiversity: r3(state.microfauna.biodiversity) },
      alerts: [], nextAction: null, welfare: "—", memorial: state.memorial.slice(-8), log: state.log.slice(-12)
    };
    if (!hab) { out.nextAction = { title: "Choose a habitat", detail: "Pick a freshwater Amazon or an Indo-Pacific reef to begin." }; return out; }

    var params = DATA.HABITATS[hab].params;
    for (var i = 0; i < params.length; i++) {
      var key = params[i];
      var value = key === "level" ? (state.water.levelL / tierVol(state) * 100) : state.water[key];
      var band = DATA.paramBand(hab, key) || DATA.PARAMS[key];
      var test = state.tests[key];
      var shown = r3(value);                       // one rounded value drives display, severity, and alert
      var severity = severityOf(band, shown);
      var trend = 0;
      if (test && test.known) trend = Math.sign(shown - test.value);
      out.water.push({
        key: key, label: band ? band.label : key, unit: band ? band.unit : "",
        value: shown, target: band ? band.target : null, good: band ? band.good : null, warn: band ? band.warn : null,
        severity: severity, trend: trend,
        known: !!(test && test.known), testAgeDays: test ? r3(test.ageDays) : null
      });
      if (severity === "danger") out.alerts.push(band ? band.label : key + " is out of range");
    }

    var healthSum = 0, n = 0, dead = 0;
    for (i = 0; i < state.livestock.length; i++) {
      var a = state.livestock[i], sp = DATA.SPECIES[a.species];
      var alerts = [];
      if (a.alive === false) { dead++; alerts.push("dead — remove body"); }
      else { healthSum += a.health; n++; if (a.hunger > 0.85) alerts.push("hungry"); if (a.health < 0.5) alerts.push("unhealthy"); }
      out.livestock.push({
        id: a.id, species: a.species, name: sp ? sp.name : a.species, sci: sp ? sp.sci : "",
        ageDays: r3(a.ageDays), stage: a.stage, sex: a.sex,
        hunger: r3(a.hunger), condition: r3(a.condition), health: r3(a.health), alive: a.alive !== false, alerts: alerts
      });
    }
    for (i = 0; i < state.corals.length; i++) {
      var co = state.corals[i], cd = DATA.CORALS[co.species];
      out.corals.push({ id: co.id, species: co.species, name: cd ? cd.name : co.species, extension: r3(co.extension), health: r3(co.health), polyps: Math.round(co.polyps), growth: r3(co.growth), stress: r3(co.stress), tissue: r3(co.tissue) });
    }
    out.clutches = state.clutches.map(function (c) { return { species: c.species, stage: c.stage, count: Math.round(c.count), ageDays: r3(c.ageDays) }; });
    out.welfare = n === 0 ? (state.corals.length ? "reef only" : "empty") : welfareLabel(healthSum / n);
    out.nextAction = nextBestAction(state, out);
    if (dead > 0) out.alerts.unshift(dead + " animal(s) need removing");
    return out;
  }
  function r3(v) { return +num(v, 0).toFixed(3); }
  function timeLabel(state) {
    var frac = state.time.days - Math.floor(state.time.days);
    var h = Math.floor(frac * 24), m = Math.floor((frac * 24 - h) * 60);
    return "Day " + (Math.floor(state.time.days) + 1) + " " + (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }
  function welfareLabel(h) { return h >= 0.8 ? "thriving" : h >= 0.55 ? "settling" : h >= 0.3 ? "stressed" : "critical"; }

  function nextBestAction(state, snap) {
    var c = state.cycle;
    if (!c.filled) return { title: isReef(state) ? "Mix saltwater and fill" : "Fill and dechlorinate", detail: "Set up the water before anything else." };
    if (!c.lifeSupport) return { title: "Start life support", detail: "Turn on the filter, heater, and flow to build the biofilter." };
    if (!DATA.isCycled(state)) {
      if (!c.ammoniaSource && aliveCount(state) === 0) return { title: "Start the fishless cycle", detail: "Add an ammonia source (and inoculate) so nitrifying bacteria can establish." };
      return { title: "Let the cycle finish", detail: "Speed up time and test water. Wait for ammonia and nitrite to read safe with nitrate present." };
    }
    for (var i = 0; i < snap.alerts.length; i++) { if (/ammonia|nitrite/i.test(snap.alerts[i])) return { title: "Fix the water", detail: "Do a water change; do not feed heavily until it clears." }; }
    if (aliveCount(state) === 0) return { title: "Stock your first community", detail: "The tank is cycled — add a legal, compatible starter group." };
    var hungry = 0; for (i = 0; i < state.livestock.length; i++) if (state.livestock[i].alive !== false && state.livestock[i].hunger > 0.85) hungry++;
    if (hungry > 0) return { title: "Feed your animals", detail: "Tap the water to feed. " + hungry + (hungry === 1 ? " is" : " are") + " hungry." };
    if (state.succession.cyano > 0.4) return { title: "Beat back cyanobacteria", detail: "Improve flow and nutrient export; reduce the photoperiod." };
    return { title: "Observe and maintain", detail: "Keep parameters stable. Consider coral, upgrades, or a breeding project." };
  }

  /* ============================ sanitize ============================ */
  function sanitizeState(raw) {
    var seed = raw && isFinite(raw.rngSeed) ? (raw.rngSeed >>> 0) : 0x9e3779b9;
    var base = freshState(seed, 120, 0);
    if (!raw || typeof raw !== "object") return base;

    if (raw.habitat === "amazon" || raw.habitat === "reef") applyHabitatChoice(base, raw.habitat);
    else return base; // no valid habitat: return a fresh unstarted state

    base.rngState = isFinite(raw.rngState) ? (raw.rngState | 0) : seed;
    base.credits = clamp(num(raw.credits, 120), 0, 1e9);
    base.xp = clamp(num(raw.xp, 0), 0, 1e12);
    base.time.days = clamp(num(raw.time && raw.time.days, 0), 0, 1e7);
    base.speed = DATA.speeds.indexOf(raw.speed) >= 0 ? raw.speed : 1;
    base.lastSpeed = DATA.speeds.indexOf(raw.lastSpeed) > 0 ? raw.lastSpeed : 1;
    if (DATA.TIERS[raw.tier]) base.tier = raw.tier;

    // equipment: keep only valid level ids
    if (raw.equipment && typeof raw.equipment === "object") {
      for (var cat in DATA.EQUIPMENT) if (DATA.EQUIPMENT.hasOwnProperty(cat)) {
        if (equipLevel(cat, raw.equipment[cat])) base.equipment[cat] = raw.equipment[cat];
      }
    }
    // water: clamp numeric ranges
    if (raw.water && typeof raw.water === "object") {
      var wkeys = ["levelL", "tempC", "pH", "ammonia", "nitrite", "nitrate", "oxygen", "salinity", "alkalinity", "calcium", "magnesium", "phosphate", "par", "flow", "hardness", "tannin"];
      for (var wi = 0; wi < wkeys.length; wi++) {
        var wk = wkeys[wi];
        base.water[wk] = clamp(num(raw.water[wk], base.water[wk]), 0, wk === "calcium" || wk === "magnesium" ? 3000 : (wk === "levelL" ? 5000 : 100));
      }
      base.water.levelL = clamp(num(raw.water.levelL, tierVol(base)), 0, 5000);
    } else {
      base.water.levelL = tierVol(base);
    }
    // cycle
    if (raw.cycle && typeof raw.cycle === "object") {
      base.cycle.aob = clamp(num(raw.cycle.aob, 0.02), 0.01, 1);
      base.cycle.nob = clamp(num(raw.cycle.nob, 0.01), 0.01, 1);
      base.cycle.ammoniaSource = !!raw.cycle.ammoniaSource;
      base.cycle.inoculated = !!raw.cycle.inoculated;
      base.cycle.lifeSupport = !!raw.cycle.lifeSupport;
      base.cycle.filled = raw.cycle.filled !== false;
      base.cycle.validationDays = clamp(num(raw.cycle.validationDays, 0), 0, 100);
      if (STAGES.indexOf(raw.cycle.stage) >= 0) base.cycle.stage = raw.cycle.stage;
    }
    if (raw.succession && typeof raw.succession === "object") {
      base.succession.age = clamp(num(raw.succession.age, 0), 0, 1e6);
      base.succession.haze = clamp(num(raw.succession.haze, 0), 0, 1);
      base.succession.diatom = clamp(num(raw.succession.diatom, 0), 0, 1);
      base.succession.greenFilm = clamp(num(raw.succession.greenFilm, 0), 0, 1);
      base.succession.cyano = clamp(num(raw.succession.cyano, 0), 0, 1);
      base.succession.silicate = clamp(num(raw.succession.silicate, 1), 0, 1);
    }
    // livestock: quarantine invalid to the log rather than crash
    if (Array.isArray(raw.livestock)) {
      for (var li = 0; li < raw.livestock.length; li++) {
        var a = raw.livestock[li];
        if (a && typeof a === "object" && DATA.SPECIES[a.species] && DATA.SPECIES[a.species].habitat === base.habitat) {
          base.livestock.push(sanitizeAnimal(base, a));
        } else {
          log(base, "quarantine", "Ignored an invalid saved animal" + (a && a.species ? " (" + a.species + ")" : "") + ".");
        }
      }
    }
    if (Array.isArray(raw.corals)) {
      for (var ri = 0; ri < raw.corals.length; ri++) {
        var co = raw.corals[ri];
        if (co && DATA.CORALS[co.species] && base.habitat === "reef") base.corals.push(sanitizeCoral(base, co));
        else log(base, "quarantine", "Ignored an invalid saved coral.");
      }
    }
    // Active pellets are part of the husbandry state: preserving them prevents a
    // reload from erasing uneaten food and its eventual nutrient consequence.
    if (Array.isArray(raw.food)) {
      for (var fi = 0; fi < raw.food.length; fi++) {
        var fp = raw.food[fi]; if (!fp || typeof fp !== "object" || fp.consumed) continue;
        var fy = clamp(num(fp.y, 0.4), 0, FOOD_BOTTOM), fs = !!fp.sunk || fy >= FOOD_BOTTOM;
        var fid = Math.floor(clamp(num(fp.id, base.nextId++), 1, 1e9));
        while (idUsed(base, fid)) fid = base.nextId++;
        base.food.push({
          id: fid,
          x: clamp(num(fp.x, 0.5), 0, 1), y: fs ? FOOD_BOTTOM : fy,
          amount: clamp(num(fp.amount, 1), 0.1, 10), ageDays: clamp(num(fp.ageDays, 0), 0, FOOD_DECAY_DAYS),
          sunk: fs, consumed: false
        });
      }
    }
    if (raw.microfauna && typeof raw.microfauna === "object") {
      base.microfauna.pods = clamp(num(raw.microfauna.pods, base.microfauna.pods), 0, 1);
      base.microfauna.worms = clamp(num(raw.microfauna.worms, 0), 0, 1);
      base.microfauna.infusoria = clamp(num(raw.microfauna.infusoria, base.microfauna.infusoria), 0, 1);
      base.microfauna.biodiversity = clamp(num(raw.microfauna.biodiversity, 0), 0, 1);
    }
    if (Array.isArray(raw.clutches)) base.clutches = raw.clutches.filter(function (c) { return c && DATA.SPECIES[c.species] && ["eggs", "hatched", "fry"].indexOf(c.stage) >= 0; }).map(function (c) {
      return { id: num(c.id, base.nextId++), species: c.species, stage: c.stage, ageDays: clamp(num(c.ageDays, 0), 0, 100), count: clamp(num(c.count, 0), 0, 1000), incubation: clamp(num(c.incubation, 3), 0.1, 30), fryFeature: c.fryFeature === "infusoria" ? "infusoria" : "pods", tended: true };
    });
    if (Array.isArray(raw.memorial)) base.memorial = raw.memorial.filter(function (m) { return m && typeof m === "object"; }).slice(-40);
    if (Array.isArray(raw.log)) base.log = raw.log.filter(function (l) { return l && typeof l.message === "string"; }).slice(-100).concat(base.log);
    if (raw.tests && typeof raw.tests === "object") {
      for (var tk in raw.tests) if (raw.tests.hasOwnProperty(tk) && raw.tests[tk] && typeof raw.tests[tk] === "object") {
        base.tests[tk] = { value: num(raw.tests[tk].value, 0), ageDays: clamp(num(raw.tests[tk].ageDays, 0), 0, 1e5), known: !!raw.tests[tk].known };
      }
    }
    if (raw.milestones && typeof raw.milestones === "object") base.milestones = raw.milestones;
    if (raw.breeding && typeof raw.breeding === "object") {
      if (raw.breeding.clown) { base.breeding.clown.paired = !!raw.breeding.clown.paired; base.breeding.clown.bondDays = clamp(num(raw.breeding.clown.bondDays, 0), 0, 100); base.breeding.clown.spawnCooldown = clamp(num(raw.breeding.clown.spawnCooldown, 0), 0, 100); }
      if (raw.breeding.tetra) { base.breeding.tetra.readyDays = clamp(num(raw.breeding.tetra.readyDays, 0), 0, 100); base.breeding.tetra.spawnCooldown = clamp(num(raw.breeding.tetra.spawnCooldown, 0), 0, 100); }
    }
    base.selection = (raw.selection && raw.selection.id != null) ? { entityType: raw.selection.entityType || "livestock", id: raw.selection.id } : null;
    base.lastRealTimestamp = num(raw.lastRealTimestamp, 0);
    base.nextId = Math.max(base.nextId, Math.floor(num(raw.nextId, 1)), maxId(base) + 1);
    return base;
  }
  function maxId(state) {
    var m = 0, i;
    for (i = 0; i < state.livestock.length; i++) m = Math.max(m, num(state.livestock[i].id, 0));
    for (i = 0; i < state.corals.length; i++) m = Math.max(m, num(state.corals[i].id, 0));
    for (i = 0; i < state.food.length; i++) m = Math.max(m, num(state.food[i].id, 0));
    return m;
  }
  function idUsed(state, id) {
    var groups = [state.livestock, state.corals, state.food];
    for (var g = 0; g < groups.length; g++) for (var i = 0; i < groups[g].length; i++) if (groups[g][i].id === id) return true;
    return false;
  }
  function sanitizeAnimal(state, a) {
    var sp = DATA.SPECIES[a.species];
    return {
      id: num(a.id, state.nextId++), species: a.species, kind: sp.kind,
      ageDays: clamp(num(a.ageDays, sp.maturityDays * 0.4), 0, 1e5),
      stage: a.stage === "adult" ? "adult" : "juvenile",
      sex: ["male", "female", "unknown"].indexOf(a.sex) >= 0 ? a.sex : "unknown",
      hunger: clamp(num(a.hunger, 0.2), 0, 1.2), condition: clamp(num(a.condition, 1), 0, 1),
      health: clamp(num(a.health, 1), 0, 1), alive: a.alive !== false,
      causeOfDeath: a.causeOfDeath || null, decayDays: clamp(num(a.decayDays, 0), 0, 1e4),
      lastFedDay: num(a.lastFedDay, state.time.days),
      x: clamp(num(a.x, 0.5), 0, 1), y: clamp(num(a.y, 0.5), 0, 1)
    };
  }
  function sanitizeCoral(state, co) {
    var cd = DATA.CORALS[co.species];
    return {
      id: num(co.id, state.nextId++), species: co.species,
      health: clamp(num(co.health, 0.9), 0, 1), tissue: clamp(num(co.tissue, 0.9), 0, 1),
      polyps: clamp(num(co.polyps, cd.startPolyps), 0, 5000), extension: clamp(num(co.extension, 0.4), 0, 1),
      growth: clamp(num(co.growth, 0.1), 0, 1), feedingReserve: clamp(num(co.feedingReserve, 0.4), 0, 1),
      stress: clamp(num(co.stress, 0.1), 0, 1), x: clamp(num(co.x, 0.5), 0, 1), y: clamp(num(co.y, 0.7), 0, 1)
    };
  }

  /* ============================ exports ============================ */
  PA.createState = createState;
  PA.step = step;
  PA.stepDays = stepDays;           // deterministic day-advance (used by step and by tests)
  PA.dispatch = dispatch;
  PA.sanitizeState = sanitizeState;
  PA.snapshotSummary = snapshotSummary;
  PA.offlineCatchUp = offlineCatchUp;

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
