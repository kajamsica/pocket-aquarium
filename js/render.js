/* Pocket Aquarium Ecosystem — Living habitat Canvas renderer (FTG4-01C).
 *
 * Public contract (global namespace, non-module `file://` compatible):
 *   PA.createRenderer(canvas, getState, dispatch) -> { resize, draw, destroy }
 *
 * Design rules honoured here:
 *   - Reads the simulation via getState(); NEVER mutates authoritative state.
 *   - The only writes to the world happen through dispatch(), and only from an
 *     explicit pointer gesture: {type:'SELECT_ENTITY', id} on a hit, otherwise
 *     {type:'FEED_AT', x, y} with x/y in normalized [0,1] tank space.
 *   - All animal/coral/microfauna motion lives in a renderer-owned visual layer
 *     keyed by stable entity id; positions are seeded deterministically from the
 *     id so a given creature keeps a stable home across reloads.
 *   - No imports, no network, no image/font assets. Pure Canvas 2D.
 *   - DPR-aware. Bounded delta time. prefers-reduced-motion stays informative.
 *   - Renders gracefully before a habitat is chosen (uninitialized state).
 *
 * Coordinate contract: everything the renderer exchanges with the sim/app in
 * tank space is normalized [0,1] (x rightwards, y downwards). Pixel space is
 * internal to drawing only.
 */
"use strict";

(function () {
  var PA = (typeof window !== "undefined")
    ? (window.PA = window.PA || {})
    : (typeof globalThis !== "undefined" ? (globalThis.PA = globalThis.PA || {}) : {});

  /* ============================ small utilities ============================ */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  var TAU = Math.PI * 2;
  // Shortest signed rotation (radians) to turn heading `from` toward `to`, in [-pi, pi].
  function angDiff(from, to) {
    var d = (to - from) % TAU;
    if (d > Math.PI) d -= TAU;
    else if (d < -Math.PI) d += TAU;
    return d;
  }

  // Longest per-frame step (ms). A slow frame, a backgrounded tab, or fast sim
  // transport can hand the renderer a large gap; clamping it here keeps visible
  // locomotion frame-rate independent (bounded), never inflated at 4x/8x.
  var MAX_DT = 50;

  /* --------- bounded, frame-rate-independent steering integrators --------- */
  // Shared by the renderer AND exercised directly by tests. Every result is hard
  // bounded so a large dt can never push turn rate or speed past the per-ms
  // species limits — the core of watchable, physically coherent motion.
  function stepTurn(hd, av, want, maxRate, angAccel, dt) {
    // Desired angular velocity is proportional to heading error, capped at the
    // species turn rate and decaying to 0 at the target so momentum settles
    // instead of ringing. The gain stays below 1/MAX_DT so even a full 50ms frame
    // corrects a fraction of the error, never past it (no overshoot blow-up).
    var desired = clamp(angDiff(hd, want) * 0.012, -maxRate, maxRate);
    av += clamp(desired - av, -angAccel * dt, angAccel * dt);
    if (av > maxRate) av = maxRate; else if (av < -maxRate) av = -maxRate;
    return { hd: hd + av * dt, av: av };
  }
  function stepSpeed(sp, target, accel, dt) {
    // Bounded acceleration; drag lets it shed speed a little faster. Approaching
    // from below never overshoots the target, so speed cannot inflate with dt.
    sp += clamp(target - sp, -accel * 1.6 * dt, accel * dt);
    return sp < 0 ? 0 : sp;
  }
  // Transient feeding-emphasis intensity (runtime-only, internal): 1 the instant a pellet drops,
  // easing linearly to 0 across `dur` ms, then staying 0. Renderer lifecycle (first-frame baseline,
  // real-feed retrigger, expiry) is proven through PA.createRenderer in tests/render-drawpath.test.js.
  var FEED_FLASH_MS = 1100;
  function feedFlash(now, until, dur) {
    if (!(dur > 0) || !(until > now)) return 0;
    var t = (until - now) / dur;
    return t > 1 ? 1 : (t < 0 ? 0 : t);
  }

  function isArr(v) { return Array.isArray(v); }
  function asArray(v) { return isArr(v) ? v : []; }
  function lc(v) { return String(v == null ? "" : v).toLowerCase(); }

  // First finite number found by walking candidate paths on an object.
  function firstNum(obj, paths, d) {
    for (var i = 0; i < paths.length; i++) {
      var v = dig(obj, paths[i]);
      v = +v;
      if (Number.isFinite(v)) return v;
    }
    return d;
  }
  function firstVal(obj, paths) {
    for (var i = 0; i < paths.length; i++) {
      var v = dig(obj, paths[i]);
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  }
  function dig(obj, path) {
    if (!obj) return undefined;
    var parts = path.split("."), cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  // Normalize a value that might be a fraction (0..1), a percent (0..100),
  // or a value/capacity pair, into 0..1.
  function to01(v, cap) {
    v = +v;
    if (!Number.isFinite(v)) return null;
    if (Number.isFinite(+cap) && +cap > 0) return clamp01(v / +cap);
    if (v > 1.0001 && v <= 100) return clamp01(v / 100);
    if (v > 100) return 1;
    return clamp01(v);
  }

  function countOf(v) {
    if (isArr(v)) return v.length;
    v = +v;
    return Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
  }

  /* --------- deterministic per-entity randomness (stable positions) -------- */

  function hashId(id) {
    var s = String(id), h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Stable 0..1 for an (id, salt) pair.
  function seeded(id, salt) { return mulberry32(hashId(id + "|" + salt))(); }

  /* ------------------------------ colour ---------------------------------- */

  function hex2rgb(h) {
    h = String(h).replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (!Number.isFinite(n)) return [0, 0, 0];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(h, a) { var c = hex2rgb(h); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }
  function mix(h1, h2, t) {
    var a = hex2rgb(h1), b = hex2rgb(h2);
    return "rgb(" + Math.round(lerp(a[0], b[0], t)) + "," + Math.round(lerp(a[1], b[1], t)) + "," + Math.round(lerp(a[2], b[2], t)) + ")";
  }
  // Blend two [r,g,b] arrays -> [r,g,b] (for the lighting colour-temperature model).
  function mixRGB(a, b, t) { return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))]; }
  function rgbaMix(h1, h2, t, a) {
    var c1 = hex2rgb(h1), c2 = hex2rgb(h2);
    return "rgba(" + Math.round(lerp(c1[0], c2[0], t)) + "," + Math.round(lerp(c1[1], c2[1], t)) + "," + Math.round(lerp(c1[2], c2[2], t)) + "," + a + ")";
  }

  /* ============================ shared palette ============================= */

  var INK = "#202124", BLUE = "#2f80ed", CORAL = "#ff8a3d";

  var PAL = {
    freshwater: {
      // Amazonian blackwater margin — tea-stained, tannin amber over dark.
      waterTop: "#7c5c2c", waterMid: "#4d3619", waterDeep: "#241606",
      surface: "#a98544",
      sand: "#cdb488", sandDeep: "#a98a5c",
      rock: "#3d2a17", rockLit: "#5a4127",
      plant: "#3f7d3a", plantDeep: "#2c5c2b", plantRed: "#9c4a2f",
      litter: "#8a4f24", litter2: "#a5642c",
      glass: "#d8cdae"
    },
    marine: {
      // Indo-Pacific sheltered lagoon reef — bright, clear, aragonite.
      waterTop: "#3aa9d6", waterMid: "#1f7fb0", waterDeep: "#0d4a70",
      surface: "#bfe9f5",
      sand: "#f0ece0", sandDeep: "#d6cdb6",
      rock: "#7d6f84", rockLit: "#9a8ea0",
      coralline: "#b7517f", coralline2: "#7a5aa8",
      glass: "#cfe6ee"
    },
    // Neutral empty tank before a habitat is chosen.
    empty: {
      waterTop: "#2b5766", waterMid: "#1c3d49", waterDeep: "#122831",
      surface: "#87b3bf", sand: "#c9c2ad", sandDeep: "#a79f88", glass: "#c2d2d6"
    }
  };

  // Tank-space geometry (normalized). Substrate bed sits at the physical bottom;
  // only the waterline moves with water level.
  var SUB_TOP = 0.83;   // top of the sand bed at full tank
  var MARGIN_X = 0.04;

  /* ------------------------- species archetypes --------------------------- */
  // rel   = adult body length as a fraction of the tank's short reference span.
  // Motion is a persistent heading (rad) + speed model — never target interpolation:
  //   cruise     = comfortable speed, normalized tank-units per ms
  //   turn       = max heading change, radians per ms (bounded turn rate)
  //   accel      = max speed change, units per ms^2 (bounded acceleration)
  //   wanderRate = how fast the smooth wander phase evolves (rad per ms)
  //   pauseRate  = benthic settle/pause cadence (rad per ms; 0 = never pauses)
  var ARCH = {
    tetra:  { layer: "mid",     school: true,  rel: 0.11, min: 13, max: 60,  cruise: 2.9e-4, turn: 0.011, accel: 2.2e-6, wanderRate: 0.0016, pauseRate: 0 },
    cory:   { layer: "bottom",  school: true,  rel: 0.12, min: 15, max: 64,  cruise: 1.7e-4, turn: 0.007, accel: 1.3e-6, wanderRate: 0.0013, pauseRate: 0.0011 },
    clown:  { layer: "host",    school: false, rel: 0.20, min: 20, max: 96,  cruise: 1.9e-4, turn: 0.009, accel: 1.7e-6, wanderRate: 0.0014, pauseRate: 0 },
    goby:   { layer: "burrow",  school: false, rel: 0.19, min: 18, max: 92,  cruise: 1.4e-4, turn: 0.007, accel: 1.2e-6, wanderRate: 0.0010, pauseRate: 0.0013 },
    shrimp: { layer: "burrow2", school: false, rel: 0.13, min: 12, max: 56,  cruise: 1.1e-4, turn: 0.006, accel: 1.0e-6, wanderRate: 0.0009, pauseRate: 0.0016 },
    shark:  { layer: "benthic", school: false, rel: 0.58, min: 46, max: 320, cruise: 1.5e-4, turn: 0.004, accel: 0.9e-6, wanderRate: 0.0006, pauseRate: 0 },
    generic:{ layer: "mid",     school: false, rel: 0.18, min: 16, max: 90,  cruise: 2.3e-4, turn: 0.008, accel: 1.6e-6, wanderRate: 0.0013, pauseRate: 0 }
  };

  // Map a sim species descriptor onto a drawing archetype by keyword.
  function archOf(ent) {
    var s = lc(firstVal(ent, ["species", "kind", "type", "id", "name", "scientific", "scientificName", "sciName"]));
    var name = lc(firstVal(ent, ["name", "commonName"]));
    var key = s + " " + name;
    if (/tetra|innesi|paracheirodon|neon/.test(key)) return "tetra";
    if (/cory|corydoras|pygmaeus|catfish/.test(key)) return "cory";
    if (/clown|ocellaris|amphiprion|anemonefish/.test(key)) return "clown";
    if (/watchman|cryptocentrus|\bgoby\b/.test(key)) return "goby";
    if (/pistol|alpheus|snapping|\bshrimp\b/.test(key)) return "shrimp";
    if (/epaulette|hemiscyllium|shark/.test(key)) return "shark";
    return "generic";
  }

  // Life-stage scale (juvenile smaller) with a legibility floor applied later.
  function lifeScale(ent) {
    var r = firstNum(ent, ["sizeRatio", "growth", "maturityRatio", "adultRatio"], NaN);
    if (Number.isFinite(r)) return clamp(r <= 1 ? r : r / 100, 0.5, 1);
    var stage = lc(firstVal(ent, ["stage", "lifeStage", "ageStage"]));
    if (/egg|larva|fry/.test(stage)) return 0.42;
    if (/juv|sub|young|baby/.test(stage)) return 0.62;
    if (/adult|mature|full/.test(stage)) return 1;
    var age = firstNum(ent, ["ageDays", "age", "days"], NaN);
    var adult = firstNum(ent, ["adultAgeDays", "maturityDays", "adultAge"], NaN);
    if (Number.isFinite(age) && Number.isFinite(adult) && adult > 0) return clamp(0.55 + 0.45 * (age / adult), 0.55, 1);
    return 1;
  }

  function isDead(ent) {
    if (!ent) return false;
    var alive = firstVal(ent, ["alive", "isAlive"]);
    if (alive === false) return true;
    var dead = firstVal(ent, ["dead", "isDead", "deceased"]);
    if (dead === true) return true;
    var st = lc(firstVal(ent, ["status", "state", "condition"]));
    if (/dead|deceased|corpse/.test(st)) return true;
    var hp = firstNum(ent, ["health", "hp", "condition"], NaN);
    if (Number.isFinite(hp) && hp <= 0) return true;
    return false;
  }
  function hungerOf(ent) {
    var h = firstNum(ent, ["hunger", "appetite"], NaN);
    if (Number.isFinite(h)) return clamp01(h <= 1 ? h : h / 100);
    var sat = firstNum(ent, ["satiation", "fullness", "fed"], NaN);
    if (Number.isFinite(sat)) return clamp01(1 - (sat <= 1 ? sat : sat / 100));
    return 0.3;
  }
  function healthOf(ent) {
    var h = firstNum(ent, ["health", "hp", "condition", "welfare"], NaN);
    if (Number.isFinite(h)) return clamp01(h <= 1 ? h : h / 100);
    return 0.85;
  }

  /* ======================= state normalization view ======================= */
  // Produce a defensive, read-only snapshot from getState(). Never writes back.

  function normalizeHabitat(st) {
    var h = firstVal(st, ["habitat", "biotope", "environment", "waterType", "type"]);
    var key = "";
    if (h && typeof h === "object") key = lc(firstVal(h, ["id", "type", "kind", "name", "waterType"]));
    else key = lc(h);
    var water = lc(firstVal(st, ["waterType", "water.type", "chemistry.waterType"]));
    var sal = firstNum(st, ["salinity", "water.salinity", "chemistry.salinity", "params.salinity"], NaN);
    if (/reef|marine|salt|indo|pacific|lagoon|ocellaris|coral/.test(key) || /salt|marine/.test(water) || (Number.isFinite(sal) && sal > 5)) return "marine";
    if (/amazon|fresh|blackwater|tetra|river|tannin/.test(key) || /fresh/.test(water) || (Number.isFinite(sal) && sal >= 0 && /fresh|amazon|black/.test(key + water))) return "freshwater";
    if (key || water) {
      if (/reef|marine|salt/.test(key + water)) return "marine";
      if (/fresh|amazon|black/.test(key + water)) return "freshwater";
    }
    return null; // undecided -> uninitialized rendering
  }

  function normalizeStage01(st) {
    var m = firstNum(st, ["maturity", "maturity01", "biome.maturity"], NaN);
    if (Number.isFinite(m)) return clamp01(m <= 1 ? m : m / 100);
    var stageName = lc(firstVal(st, ["cycle.stage", "cycleStage", "stage", "succession.stage", "phase"]));
    var order = ["setup", "ammonia", "nitrite", "nitrate", "cycled", "young", "mature"];
    for (var i = 0; i < order.length; i++) if (stageName.indexOf(order[i]) >= 0) return i / (order.length - 1);
    var day = firstNum(st, ["day", "gameDay", "ageDays", "tank.ageDays", "time.day"], NaN);
    if (Number.isFinite(day)) return clamp01(day / 30);
    return 0;
  }

  function normalizeFilms(st) {
    var s = firstVal(st, ["succession", "algae", "films", "biofilm"]) || st || {};
    function pick(paths) {
      var v = firstNum(s, paths, NaN);
      if (!Number.isFinite(v)) v = firstNum(st, paths, NaN);
      if (!Number.isFinite(v)) return 0;
      return clamp01(v <= 1 ? v : v / 100);
    }
    return {
      haze:   pick(["haze", "bacterialHaze", "bacteria", "cloudiness", "turbidity"]),
      diatom: pick(["diatom", "diatoms", "brownDiatom", "brown", "diatomFilm"]),
      green:  pick(["green", "greenAlgae", "greenFilm", "algae", "greenFilmIntensity"]),
      cyano:  pick(["cyano", "cyanobacteria", "cyanobacteriaMat", "redSlime", "bga"])
    };
  }

  function normalizeEquipment(st) {
    var eq = firstVal(st, ["equipment", "gear", "hardware"]) || {};
    function on(names) {
      for (var i = 0; i < names.length; i++) {
        var v = eq[names[i]];
        if (v === undefined) v = dig(st, names[i]);
        if (v === true) return 1;
        if (v && typeof v === "object") {
          var o = firstVal(v, ["on", "enabled", "active", "installed", "present"]);
          if (o === true) return firstNum(v, ["level", "power", "rate"], 1) || 1;
          if (o === false) continue;
          var lvl = firstNum(v, ["level", "power", "rate"], NaN);
          if (Number.isFinite(lvl)) return lvl <= 1 ? lvl : clamp01(lvl / 10);
        }
        if (Number.isFinite(+v) && +v > 0) return clamp01(+v <= 1 ? +v : +v / 10);
        if (typeof v === "string") {
          // The sim stores equipment as tier-id strings ("sponge", "basic",
          // "powerhead"...) and uses "none" for an EMPTY slot. Treat the off
          // sentinels as disabled; any real installed tier reads as on.
          var s = v.trim().toLowerCase();
          if (s === "" || s === "none" || s === "off" || s === "no" || s === "false" || s === "disabled") continue;
          return 1;
        }
      }
      return 0;
    }
    return {
      filter:      on(["filter", "canister", "hob", "biofilter"]),
      heater:      on(["heater", "heat", "controller", "thermostat"]),
      circulation: on(["circulation", "powerhead", "flow", "pump", "wavemaker"]),
      light:       on(["light", "led", "lamp", "lighting", "fixture"]),
      skimmer:     on(["skimmer", "proteinSkimmer"]),
      refugium:    on(["refugium", "fuge", "sump"]),
      ato:         on(["ato", "topOff", "autoTopOff", "freshwaterAto"])
    };
  }

  // Mirror of the authoritative photoperiod window in js/sim.js (daylight()): a
  // triangular day/night curve over the fractional game day. Duplicated here (not
  // imported) so the renderer stays a standalone, defensive normalizer while its
  // ambient light still tracks the sim's midnight..midday cycle exactly.
  function simDaylight(frac) {
    var start = 0.28, end = 0.86;
    if (frac <= start || frac >= end) return 0;
    var mid = (start + end) / 2, half = (end - start) / 2;
    return clamp01(1 - Math.abs(frac - mid) / half);
  }

  /* ============================== lighting ============================= */
  // Causal chain mirrored from the reef reference (contracts.ts lightField):
  //   surface irradiance x air/glass/seawater transmission
  //     -> Beer-Lambert attenuation over water depth -> local PPFD -> presentation.
  // Resolved from EXISTING state only (daylight, par, equipment.light); no new
  // persisted settings. Pure over `view` (hoisted to module scope so tests can
  // assert photoperiod continuity headlessly).
  function computeLight(view) {
    var marine = view.habitat === "marine";
    // Photoperiod is the sim's own SMOOTH daylight curve (simDaylight over the
    // fractional game-day, mirrored into view.daylight), so day<->night is
    // continuous — no stepwise hour-window jumps. A fixture lifts a night floor.
    var sun = clamp01(view.daylight);
    var fixture = view.equipment.light ? 1 : 0;
    var elev = sun * sun * (3 - 2 * sun);             // smoothstep sun elevation
    var dayWarmth = marine ? 0.12 : 0.5;
    var warmth = lerp(0.92, dayWarmth, elev);         // warm amber low sun -> cool at noon
    var nightAmt = clamp01((0.16 - sun) / 0.16);      // smoothly ramps to moonlight near 0
    var phase = sun > 0.55 ? "day" : (sun > 0.14 ? "dusk" : "night");
    // surface irradiance at the waterline (photoperiod x PAR, lifted by a fixture)
    var surfaceI = clamp01(sun * 0.85 * (0.45 + view.par * 0.6) + fixture * 0.3);
    var dayCol = marine ? [255, 251, 236] : [255, 236, 196], warmCol = [255, 214, 150], moonCol = [150, 178, 224];
    var col = mixRGB(dayCol, warmCol, warmth);
    col = mixRGB(col, moonCol, nightAmt * (1 - fixture * 0.6)); // fixture keeps colour truer at night
    if (fixture) col = mixRGB(col, marine ? [232, 244, 255] : [255, 240, 205], 0.2 + elev * 0.15);
    var iface = 0.9;                        // air/glass/seawater interface transmission
    var atten = marine ? 1.15 : 2.6;        // clear reef vs tannin-stained blackwater
    var adequacy = clamp01(surfaceI * iface * Math.exp(-atten * 0.5) * (0.45 + view.par * 0.7));
    return { marine: marine, phase: phase, fx: 0.5, sun: sun,
      rgb: col, col: col.join(","), surfaceI: surfaceI, iface: iface, atten: atten, adequacy: adequacy, fixture: fixture };
  }

  // Resolve the current tank volume (litres) for the water-level ratio. Prefer the
  // authoritative catalog the sim divides against (PA.DATA.TIERS[state.tier].volumeL),
  // then any explicit volume on the state, so the renderer still degrades gracefully
  // if the catalog is absent. Returns NaN when no volume is known.
  function tierVolumeOf(st) {
    var tier = firstVal(st, ["tier", "tank.tier", "tierId"]);
    if (tier != null && PA && PA.DATA && PA.DATA.TIERS && PA.DATA.TIERS[tier]) {
      var v = +PA.DATA.TIERS[tier].volumeL;
      if (Number.isFinite(v) && v > 0) return v;
    }
    return firstNum(st, ["tierVolumeL", "tank.volumeL", "volumeL", "tank.capacity", "water.capacity", "capacityL"], NaN);
  }

  function normalizeView(st) {
    if (!st || typeof st !== "object") return { ready: false };
    var habitat = normalizeHabitat(st);
    var ready = !!habitat;

    // Water level: the sim stores authoritative LITRES in water.levelL against a
    // per-tier volume it does not inline. Divide by the resolved tier volume, keeping
    // a true zero for an unfilled tank (never a forced midpoint). Fall back to a
    // pre-divided fraction or a value+capacity pair for alternate schemas, then to full.
    var level = null;
    var levelL = firstNum(st, ["water.levelL", "levelL"], NaN);
    var tankVol = tierVolumeOf(st);
    if (Number.isFinite(levelL) && Number.isFinite(tankVol) && tankVol > 0) level = clamp01(levelL / tankVol);
    if (level == null) level = to01(firstNum(st, ["waterLevel", "water.level", "tank.waterLevel", "water.levelPct", "level"], NaN),
                                    firstNum(st, ["tank.capacity", "water.capacity", "capacityL", "tank.volumeL"], NaN));
    if (level == null) level = 1;

    var trend = firstNum(st, ["water.levelTrend", "waterTrend", "water.trend", "evaporationTrend"], NaN);

    var par = firstNum(st, ["par", "water.par", "light.par", "lighting.par"], NaN);
    if (Number.isFinite(par)) par = par > 1.5 ? clamp01(par / 600) : clamp01(par);
    else par = null;

    // Photoperiod: the sim advances a FRACTIONAL game-day counter (state.time.days)
    // and lights the tank on a fixed daily window — it exposes no clock/daylight field.
    // Derive the hour and daylight from that counter so the canvas light matches the
    // sim's night/day exactly. An explicit clock/daylight field (if a host ever supplies
    // one) still wins; the legacy hour-window fallback covers any other schema.
    var hour = firstNum(st, ["timeOfDay", "clock.hour", "time.hour", "hourOfDay"], NaN);
    if (Number.isFinite(hour)) hour = hour <= 1 ? hour * 24 : (hour >= 24 ? hour % 24 : hour);
    else hour = null;

    var dayCount = firstNum(st, ["time.days", "gameDays", "gameDay", "dayFloat", "time.day"], NaN);
    var dayFrac = Number.isFinite(dayCount) ? dayCount - Math.floor(dayCount) : NaN;
    if (hour == null && Number.isFinite(dayFrac)) hour = dayFrac * 24;

    var daylight = firstNum(st, ["daylight", "dayFraction", "lightOn", "photoperiodOn"], NaN);
    if (Number.isFinite(daylight)) daylight = clamp01(daylight <= 1 ? daylight : daylight / 100);
    else if (Number.isFinite(dayFrac)) daylight = simDaylight(dayFrac);
    else if (hour != null) {
      var hr = hour;
      daylight = (hr >= 8 && hr <= 20) ? 1 : (hr >= 6 && hr < 8 ? (hr - 6) / 2 : (hr > 20 && hr <= 22 ? (22 - hr) / 2 : 0.08));
    } else daylight = 1;

    var flow = firstNum(st, ["flow", "water.flow", "circulation"], NaN);
    var equipment = normalizeEquipment(st);
    if (!Number.isFinite(flow)) flow = equipment.circulation ? 0.65 : 0.25;
    else flow = clamp01(flow <= 1 ? flow : flow / 100);

    var detritus = firstNum(st, ["detritus", "waste", "mulm", "organicLoad"], NaN);
    detritus = Number.isFinite(detritus) ? clamp01(detritus <= 1 ? detritus : detritus / 100) : 0;

    var micro = firstVal(st, ["microfauna", "pods", "biodiversity", "microLife"]);
    var micro01;
    if (micro && typeof micro === "object") {
      var pop = firstNum(micro, ["population", "count", "value", "score", "density"], NaN);
      var capp = firstNum(micro, ["capacity", "carryingCapacity", "max"], NaN);
      micro01 = Number.isFinite(pop) ? (Number.isFinite(capp) && capp > 0 ? clamp01(pop / capp) : clamp01(pop > 1 ? Math.log10(pop + 1) / 3 : pop)) : 0;
    } else {
      var mv = +micro;
      micro01 = Number.isFinite(mv) ? (mv > 1 ? clamp01(Math.log10(mv + 1) / 3) : clamp01(mv)) : 0;
    }
    if (equipment.refugium) micro01 = clamp01(micro01 + 0.2);

    // Livestock roster (defensive): several likely container names.
    var rawAnimals = firstVal(st, ["livestock", "animals", "fish", "creatures", "stock", "inhabitants"]);
    var animals = asArray(rawAnimals).filter(function (e) { return e && typeof e === "object"; }).map(function (e, i) {
      var id = firstVal(e, ["id", "uid", "key", "entityId"]);
      if (id == null) id = "a" + i + ":" + lc(firstVal(e, ["species", "name", "type"]) || "x");
      return {
        id: String(id), ent: e, kind: archOf(e), dead: isDead(e),
        seedX: firstNum(e, ["x", "pos.x"], NaN), seedY: firstNum(e, ["y", "pos.y"], NaN)
      };
    });

    // Corals.
    var rawCorals = firstVal(st, ["corals", "coral", "colonies"]);
    var corals = asArray(rawCorals).filter(function (e) { return e && typeof e === "object"; }).map(function (e, i) {
      var id = firstVal(e, ["id", "uid", "key"]);
      if (id == null) id = "c" + i;
      var sp = lc(firstVal(e, ["species", "name", "type", "id"]));
      var ck = /gonio|flower|daisy|long/.test(sp) ? "goniopora" : (/zoa|zoanthid|palythoa|button|mat/.test(sp) ? "zoanthid" : "zoanthid");
      var ext = firstNum(e, ["extension", "polypExtension", "openness"], NaN);
      ext = Number.isFinite(ext) ? clamp01(ext <= 1 ? ext : ext / 100) : clamp01(0.4 + 0.5 * healthOf(e));
      return {
        id: String(id), ent: e, kind: ck, ext: ext, health: healthOf(e),
        polyps: Math.max(3, Math.round(firstNum(e, ["polyps", "polypCount", "count"], ck === "goniopora" ? 5 : 14))),
        color: firstVal(e, ["color", "tint", "tissue", "hue"]),
        seedX: firstNum(e, ["x", "pos.x"], NaN), seedY: firstNum(e, ["y", "pos.y"], NaN)
      };
    });

    // Anemone host: explicit entity, or implied by a clownfish being present.
    var anemone = firstVal(st, ["anemone", "host", "hostAnemone"]);
    var hasClown = animals.some(function (a) { return a.kind === "clown" && !a.dead; });
    var hostPresent = habitat === "marine" && (!!anemone || hasClown);

    var hasGoby = animals.some(function (a) { return a.kind === "goby"; });
    var hasShrimp = animals.some(function (a) { return a.kind === "shrimp"; });
    var burrow = habitat === "marine" && (hasGoby || hasShrimp);

    // Food / detritus particles.
    var food = asArray(firstVal(st, ["food", "pellets", "feed"])).filter(function (p) { return p && typeof p === "object"; }).map(function (p) {
      return { x: to01n(firstNum(p, ["x", "pos.x"], NaN)), y: to01n(firstNum(p, ["y", "pos.y"], NaN)), amt: firstNum(p, ["amount", "size", "mass"], 1) };
    }).filter(function (p) { return p.x != null && p.y != null; });

    // Eggs and fry: counts are enough; positions derived deterministically.
    var eggsRaw = firstVal(st, ["eggs", "clutch", "eggCount", "spawn"]);
    var eggs = countOf(eggsRaw);
    var eggSpecies = "";
    if (isArr(eggsRaw) && eggsRaw.length && eggsRaw[0] && typeof eggsRaw[0] === "object") eggSpecies = lc(firstVal(eggsRaw[0], ["species", "name"]));
    var fry = countOf(firstVal(st, ["fry", "larvae", "juveniles", "fryCount"]));

    var selected = firstVal(st, ["selectedId", "selected", "selection", "inspectId", "focusId"]);
    if (selected && typeof selected === "object") selected = firstVal(selected, ["id", "uid", "key"]);

    return {
      ready: ready, habitat: habitat, maturity: normalizeStage01(st),
      level: level, trend: Number.isFinite(trend) ? trend : null,
      par: par == null ? (habitat === "marine" ? 0.6 : 0.4) : par,
      daylight: daylight, hour: hour, flow: flow,
      films: normalizeFilms(st), equipment: equipment,
      detritus: detritus, micro: micro01,
      animals: animals, corals: corals,
      hostPresent: hostPresent, burrow: burrow,
      food: food, eggs: eggs, eggSpecies: eggSpecies, fry: fry,
      selected: selected == null ? null : String(selected)
    };
  }
  function to01n(v) { return Number.isFinite(v) ? clamp01(v <= 1 ? v : v / 100) : null; }

  /* Test-only surface (no browser/canvas dependency): lets tests/render.test.js
     assert the sim->view normalization contract — photoperiod, equipment on/off,
     and water level — headlessly under Node. Not used by the running app. */
  PA._render = { normalizeView: normalizeView, simDaylight: simDaylight, computeLight: computeLight,
    stepTurn: stepTurn, stepSpeed: stepSpeed, MAX_DT: MAX_DT };

  /* ============================ the renderer ============================== */

  PA.createRenderer = function (canvas, getState, dispatch) {
    var ctx = (canvas && canvas.getContext) ? canvas.getContext("2d") : null;
    var noop = function () {};
    if (!ctx) {
      // Canvas 2D unavailable: return an inert but contract-shaped handle.
      return { resize: noop, draw: noop, destroy: noop };
    }
    if (typeof getState !== "function") getState = function () { return null; };
    var send = (typeof dispatch === "function") ? dispatch : noop;

    var cssW = 0, cssH = 0, dpr = 1, scale = 1, renderScale = 0; // renderScale eases toward scale (stage-scale interpolation)
    var frameLight = null;              // per-frame resolved lighting state (see computeLight)
    var actors = Object.create(null);   // id -> visual actor
    var bubbles = [], caustics = [];
    var levelHist = [];                 // visual-only trend smoothing
    var hitTargets = [];                // rebuilt each frame for pointer routing
    var prevNow = null, lastRenderAt = -1e9, rafId = 0, destroyed = false;
    var lastFoodCount = 0, feedFlashUntil = 0, foodBaselined = false; // runtime-only feeding emphasis (never persisted)

    var reducedMQ = (typeof window !== "undefined" && window.matchMedia)
      ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    var reduced = reducedMQ ? reducedMQ.matches : false;
    function onReducedChange() { reduced = reducedMQ.matches; requestDraw(); }
    if (reducedMQ) { try { reducedMQ.addEventListener("change", onReducedChange); } catch (e) { try { reducedMQ.addListener(onReducedChange); } catch (e2) {} } }

    /* ------------------------------ sizing ------------------------------- */
    function resize() {
      if (destroyed) return;
      var r = (canvas.getBoundingClientRect && canvas.getBoundingClientRect()) || { width: canvas.width || 800, height: canvas.height || 500 };
      cssW = Math.max(1, r.width || canvas.clientWidth || 800);
      cssH = Math.max(1, r.height || canvas.clientHeight || 500);
      scale = clamp(cssH / 520, 0.65, 1.5);
      dpr = clamp((typeof window !== "undefined" && window.devicePixelRatio) || 1, 1, 3);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initAmbient();
      requestDraw();
    }

    function initAmbient() {
      bubbles = [];
      var n = reduced ? 6 : Math.round(clamp(cssW / 42, 8, 26));
      for (var i = 0; i < n; i++) bubbles.push({ x: seeded("bub", i + "x"), y: seeded("bub", i + "y"), r: 1 + seeded("bub", i + "r") * 4, s: 3e-5 + seeded("bub", i + "s") * 9e-5 });
      caustics = [];
      var cn = reduced ? 0 : 5;
      for (var j = 0; j < cn; j++) caustics.push({ o: seeded("cau", j) * 6.28, y: 0.06 + j * 0.15 });
    }

    /* -------------------- photographic habitat plates -------------------- */
    // Project-local, validated plates. Paths are RELATIVE so they resolve at a
    // file:// root, localhost, and the GitHub Pages subpath alike. No network
    // fetch, no dependency: these ship inside the repository next to the app.
    var HABITAT_SRC = {
      marine: "assets/habitats/reef-lagoon-v1.png",
      freshwater: "assets/habitats/amazon-blackwater-v1.png"
    };
    var plates = Object.create(null); // habitat key -> { img, ready, failed }
    function preloadPlates() {
      if (typeof Image === "undefined") return; // non-browser (tests): stay on procedural fallback
      Object.keys(HABITAT_SRC).forEach(function (key) {
        if (plates[key]) return;
        var rec = plates[key] = { img: new Image(), ready: false, failed: false };
        rec.img.onload = function () { rec.ready = true; requestDraw(); };
        rec.img.onerror = function () { rec.failed = true; requestDraw(); };
        try { rec.img.decoding = "async"; } catch (e) {}
        rec.img.src = HABITAT_SRC[key];
      });
    }
    // Cover-render the plate for the current habitat (object-fit: cover, centred).
    // Returns true when a plate was painted, false to request the procedural fallback.
    function drawHabitatPlate(view, pal) {
      var rec = plates[view.habitat];
      if (!rec || !rec.ready || rec.failed) return false;
      var iw = rec.img.naturalWidth || rec.img.width, ih = rec.img.naturalHeight || rec.img.height;
      if (!iw || !ih) return false;
      var s = Math.max(cssW / iw, cssH / ih);
      var dw = iw * s, dh = ih * s;
      // The plates are OPAQUE underwater scenes. Paint the photo ONLY in the wet region
      // (below the waterline) and fill glass/air above it, so an unfilled or evaporated
      // tank shows a real dry gap rather than a submerged photo. At level 0 the waterline
      // sits at SUB_TOP, so no underwater plate appears above the substrate. A full tank's
      // waterline is near the rim, so its composition is effectively unchanged.
      var wl = waterlineY(view) * cssH;
      drawAirGlass(wl, pal ? pal.waterTop : "#cfe6ee");
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, wl, cssW, cssH - wl);
      ctx.clip();
      try { ctx.drawImage(rec.img, (cssW - dw) / 2, (cssH - dh) / 2, dw, dh); }
      catch (e) { ctx.restore(); rec.failed = true; return false; }
      ctx.restore();
      return true;
    }

    /* ---------------------- validated species cutouts -------------------- */
    // Project-local RGBA sprites for the three mechanically-validated species.
    // Crop bounds are each source image's alpha content trim (normalized), so
    // transparent margins never inflate on-screen scale or the hit radius.
    var SPRITE_SRC = {
      clown: "assets/animals/ocellaris-clownfish-v2.png",
      tetra: "assets/animals/neon-tetra-v1.png",
      goby: "assets/animals/yellow-watchman-goby-v1.png"
    };
    var SPRITE_CROP = {
      clown: { u0: 0.0579, v0: 0.1904, u1: 0.9010, v1: 0.8125 }, // 1295x637 +89+195 of 1536x1024
      tetra: { u0: 0.0573, v0: 0.2158, u1: 0.9108, v1: 0.7490 }, // 1311x546 +88+221
      goby: { u0: 0.0371, v0: 0.2178, u1: 0.9460, v1: 0.7148 }   // 1396x509 +57+223
    };
    var sprites = Object.create(null); // kind -> { img, ready, failed, crop }
    function preloadSprites() {
      if (typeof Image === "undefined") return;
      Object.keys(SPRITE_SRC).forEach(function (key) {
        if (sprites[key]) return;
        var rec = sprites[key] = { img: new Image(), ready: false, failed: false, crop: SPRITE_CROP[key] };
        rec.img.onload = function () { rec.ready = true; requestDraw(); };
        rec.img.onerror = function () { rec.failed = true; requestDraw(); };
        try { rec.img.decoding = "async"; } catch (e) {}
        rec.img.src = SPRITE_SRC[key];
      });
    }
    function spriteFor(kind) {
      var s = sprites[kind];
      return (s && s.ready && !s.failed && s.crop) ? s : null; // else: restrained procedural fallback
    }

    /* ---------------------- geometry helpers per frame ------------------- */
    function waterlineY(view) {
      // level 1 => waterline near the rim; level 0 => a genuinely DRY tank with the
      // surface dropped to the substrate line (reach 0). The old 0.5/0.55 clamp pinned
      // an unfilled tank to a false mid-tank waterline; span to SUB_TOP instead.
      return clamp(0.035 + (1 - view.level) * (SUB_TOP - 0.035), 0.03, SUB_TOP);
    }
    function swimBounds(view, arch) {
      var top = waterlineY(view) + 0.05;
      var subTop = SUB_TOP;
      if (arch.layer === "mid" || arch.layer === "host") return { yLo: top, yHi: subTop - 0.06 };
      if (arch.layer === "bottom") return { yLo: subTop - 0.14, yHi: subTop - 0.005 };
      if (arch.layer === "benthic") return { yLo: subTop - 0.08, yHi: subTop + 0.02 };
      if (arch.layer === "burrow" || arch.layer === "burrow2") return { yLo: subTop - 0.1, yHi: subTop + 0.01 };
      return { yLo: top, yHi: subTop - 0.05 };
    }

    // Deterministic anchors that several features share (host, burrow, cyano).
    function hostAnchor() { return { x: 0.7, y: SUB_TOP - 0.04 }; }
    function burrowAnchor() { return { x: 0.28, y: SUB_TOP + 0.01 }; }
    function lowFlowZones() {
      // Corners and the lee side of rock — where cyano and detritus settle.
      return [
        { x: 0.06, y: SUB_TOP + 0.02, r: 0.14 },
        { x: 0.94, y: SUB_TOP + 0.02, r: 0.13 },
        { x: 0.72, y: SUB_TOP - 0.01, r: 0.1 }
      ];
    }

    /* --------------------------- visual actors --------------------------- */
    function ensureActor(rec, view) {
      var a = actors[rec.id];
      var arch = ARCH[rec.kind] || ARCH.generic;
      if (!a) {
        var hx = Number.isFinite(rec.seedX) ? clamp(rec.seedX, MARGIN_X, 1 - MARGIN_X) : MARGIN_X + seeded(rec.id, "hx") * (1 - 2 * MARGIN_X);
        var b = swimBounds(view, arch);
        var hy = Number.isFinite(rec.seedY) ? clamp(rec.seedY, b.yLo, b.yHi) : lerp(b.yLo, b.yHi, seeded(rec.id, "hy"));
        var f = seeded(rec.id, "f") > 0.5 ? 1 : -1;
        var hd0 = seeded(rec.id, "hd") * TAU;
        a = actors[rec.id] = {
          id: rec.id, kind: rec.kind,
          x: hx, y: hy,
          hd: hd0, av: 0, rhd: hd0, sp: arch.cruise * 0.5,        // heading, angular velocity, lagged body heading, speed
          face: f, faceTarget: f, faceHold: 0,                    // flip hysteresis state
          phase: seeded(rec.id, "p") * 6.28,
          homeX: hx, homeY: hy,
          z: 0.15 + seeded(rec.id, "z") * 0.85,                   // depth 0..1 (near = larger/opaque)
          wander: seeded(rec.id, "wn") * TAU,                     // smooth wander phase (no random targets)
          intent: seeded(rec.id, "in") * TAU,                     // low-frequency burst/glide phase
          pausePhase: seeded(rec.id, "pp") * TAU,                 // benthic settle/pause cadence
          swim: seeded(rec.id, "p") * 6.28, eff: 0, forage: 0,    // undulation phase, swim effort, eased food gain
          rlen: 0,                                                // rendered length, eased (stage-scale)
          sink: 0, seen: true
        };
      }
      a.seen = true; a.kind = rec.kind;
      return a;
    }

    function reconcile(view) {
      var id;
      for (id in actors) actors[id].seen = false;
      for (var i = 0; i < view.animals.length; i++) ensureActor(view.animals[i], view);
      for (id in actors) if (!actors[id].seen) delete actors[id];
    }

    // Centroid + mean heading of a live school (cohesion + alignment inputs).
    function schoolInfo(view, kind) {
      var sx = 0, sy = 0, hx = 0, hy = 0, n = 0;
      for (var i = 0; i < view.animals.length; i++) {
        var rec = view.animals[i];
        if (rec.kind !== kind || rec.dead) continue;
        var a = actors[rec.id]; if (!a) continue;
        sx += a.x; sy += a.y; hx += Math.cos(a.hd); hy += Math.sin(a.hd); n++;
      }
      return n ? { x: sx / n, y: sy / n, hx: hx / n, hy: hy / n, n: n } : null;
    }
    // Nearest live same-kind neighbour actor (schooling separation).
    function nearestNeighbor(view, self, kind) {
      var best = null, bd = Infinity;
      for (var i = 0; i < view.animals.length; i++) {
        var rec = view.animals[i];
        if (rec.kind !== kind || rec.dead) continue;
        var a = actors[rec.id]; if (!a || a === self) continue;
        var d = Math.hypot(a.x - self.x, a.y - self.y);
        if (d < bd) { bd = d; best = a; }
      }
      return bd < 0.2 ? best : null;
    }

    function updateActors(view, dt) {
      var dts = clamp(dt, 0, MAX_DT);
      // Ease the global stage scale so size changes across a resize interpolate.
      renderScale = renderScale > 0 ? renderScale + (scale - renderScale) * Math.min(1, dts / 260) : scale;

      var schools = {};
      if (!reduced) { schools.tetra = schoolInfo(view, "tetra"); schools.cory = schoolInfo(view, "cory"); }

      for (var i = 0; i < view.animals.length; i++) {
        var rec = view.animals[i];
        var a = actors[rec.id]; if (!a) continue;
        var ent = rec.ent, arch = ARCH[rec.kind] || ARCH.generic;
        var b = swimBounds(view, arch);

        if (rec.dead) {
          // Sink gently to the substrate and rest, motionless.
          a.sink = Math.min(1, a.sink + dts / 2600);
          a.y += ((SUB_TOP - 0.02) - a.y) * Math.min(1, dts / 900);
          a.sp *= 0.9;
          continue;
        }

        if (reduced) {
          // Static but meaningful layout: settle onto seeded homes / anchors.
          var home = homeFor(rec, a, view);
          a.x += (home.x - a.x) * 0.5; a.y += (home.y - a.y) * 0.5;
          a.faceTarget = a.face = home.x >= 0.5 ? -1 : 1;
          continue;
        }

        // --- accumulate a desired-direction steering vector (Reynolds-style) ---
        var Sx = Math.cos(a.hd) * 0.7, Sy = Math.sin(a.hd) * 0.7; // calm forward persistence
        var speedScale = 1, chase = false;
        var benthic = (arch.layer === "bottom" || arch.layer === "benthic" || arch.layer === "burrow" || arch.layer === "burrow2");

        // Food attraction eases in and out via a forage gain (0..1) so a pellet
        // blends into the steering over ~0.5s instead of instantly hijacking the
        // fish; interest fades as the fish is fed or the pellet drifts off.
        var pellet = nearestFood(view, a, arch);
        var wantForage = (pellet && hungerOf(ent) > 0.25) ? hungerOf(ent) : 0;
        a.forage += clamp(wantForage - a.forage, -dts / 900, dts / 500);
        if (pellet && a.forage > 0.02) {
          var fdx = pellet.x - a.x, fdy = pellet.y - a.y, fd = Math.hypot(fdx, fdy) || 1e-4;
          var fg = a.forage * 2.6;
          Sx += fdx / fd * fg; Sy += fdy / fd * fg;
          chase = a.forage > 0.5; speedScale = 1 + a.forage * 0.6;
        }

        // Smooth wander: a slowly-evolving lateral bias giving gentle S-curves —
        // never a jump or interpolation to a random target point.
        a.wander += dts * arch.wanderRate;
        var wob = Math.sin(a.wander) * 0.7 + Math.sin(a.wander * 0.53 + a.phase) * 0.3;
        Sx += Math.cos(a.hd + Math.PI / 2) * wob * 0.55;
        Sy += Math.sin(a.hd + Math.PI / 2) * wob * 0.55;

        // Low-frequency intent: a slow burst/glide bias so cruising speed drifts
        // (visible coasting) instead of holding one mechanical velocity forever.
        a.intent += dts * arch.wanderRate * 0.32;

        // Schooling: cohesion + alignment + short-range separation.
        if (arch.school) {
          var s = schools[rec.kind];
          if (s && s.n > 1) {
            var cdx = s.x - a.x, cdy = s.y - a.y, cd = Math.hypot(cdx, cdy) || 1e-4;
            Sx += cdx / cd * 0.5; Sy += cdy / cd * 0.5;                    // cohesion
            Sx += s.hx * 0.6; Sy += s.hy * 0.6;                            // alignment
            var nb = nearestNeighbor(view, a, rec.kind);
            if (nb) {
              var ndx = a.x - nb.x, ndy = a.y - nb.y, nd = Math.hypot(ndx, ndy) || 1e-4;
              if (nd < 0.06) { Sx += ndx / nd * 0.9; Sy += ndy / nd * 0.9; } // separation
            }
          }
        }

        // Clownfish: compact host territory with hesitant excursions.
        if (rec.kind === "clown" && view.hostPresent) {
          var hc = hostAnchor(), hdx = hc.x - a.x, hdy = (hc.y - 0.04) - a.y, hdd = Math.hypot(hdx, hdy) || 1e-4;
          var radius = 0.06 + 0.05 * (0.5 + 0.5 * Math.sin(a.wander * 0.25)); // slowly breathing territory
          if (hdd > radius) { var pull = 1.2 + clamp((hdd - radius) / 0.12, 0, 1.5); Sx += hdx / hdd * pull; Sy += hdy / hdd * pull; }
          else { speedScale *= 0.55; } // linger, hesitant, within the anemone
        }

        // Goby / pistol shrimp: stay tied to the shared burrow.
        if ((rec.kind === "goby" || rec.kind === "shrimp") && view.burrow) {
          var bA = burrowAnchor(), gdx = bA.x - a.x, gdy = (bA.y - (rec.kind === "goby" ? 0.03 : 0)) - a.y, gdd = Math.hypot(gdx, gdy) || 1e-4;
          if (gdd > 0.08) { Sx += gdx / gdd * 1.8; Sy += gdy / gdd * 1.8; }
        }

        // Benthic / bottom dwellers: hug the substrate and pause periodically.
        if (benthic) {
          Sy += ((b.yHi - 0.01) - a.y) * 6;
          if (arch.pauseRate) {
            a.pausePhase += dts * arch.pauseRate;
            if (!chase && Math.sin(a.pausePhase) > 0.55) speedScale *= 0.12; // settle & rest on the sand
          }
        }

        // Pre-edge steering: turn away from the glass BEFORE reaching it.
        var m = 0.10;
        if (a.x < MARGIN_X + m) Sx += (1 - (a.x - MARGIN_X) / m) * 2.2;
        else if (a.x > 1 - MARGIN_X - m) Sx -= (1 - ((1 - MARGIN_X) - a.x) / m) * 2.2;
        if (a.y < b.yLo + m) Sy += (1 - (a.y - b.yLo) / m) * 2.0;
        else if (a.y > b.yHi - m) Sy -= (1 - (b.yHi - a.y) / m) * 2.0;

        // --- resolve to a bounded heading (angular momentum) + bounded speed ---
        var mag = Math.hypot(Sx, Sy);
        if (mag > 1e-6) {
          var maxRate = arch.turn * (chase ? 1.5 : 1);       // species turn-rate cap (rad/ms)
          var st = stepTurn(a.hd, a.av, Math.atan2(Sy, Sx), maxRate, arch.turn * 0.02, dts);
          a.hd = st.hd; a.av = st.av;
        } else { a.av *= Math.max(0, 1 - dts / 200); }        // no goal -> shed spin, don't snap
        var glide = chase ? 1 : (0.72 + 0.28 * (0.5 + 0.5 * Math.sin(a.intent))); // burst/glide coasting
        a.sp = stepSpeed(a.sp, arch.cruise * speedScale * glide, arch.accel, dts);
        a.x += Math.cos(a.hd) * a.sp * dts;
        a.y += Math.sin(a.hd) * a.sp * dts;

        // Soft containment: ease back inside — never pin to the wall or reflect.
        if (a.x < MARGIN_X) a.x += (MARGIN_X - a.x) * Math.min(1, dts / 120);
        else if (a.x > 1 - MARGIN_X) a.x -= (a.x - (1 - MARGIN_X)) * Math.min(1, dts / 120);
        if (a.y < b.yLo) a.y += (b.yLo - a.y) * Math.min(1, dts / 120);
        else if (a.y > b.yHi) a.y -= (a.y - b.yHi) * Math.min(1, dts / 120);

        // Mild body-axis lag: the drawn body heading trails the true heading, so a
        // turn reads as a body swinging around rather than an instant re-point.
        a.rhd += angDiff(a.rhd, a.hd) * Math.min(1, dts / 220);
        // Swim effort from real speed + turn effort drives undulation: a nearly
        // still fish barely beats its tail; a fast or hard-turning one works harder.
        var eff = clamp01(a.sp / arch.cruise * 0.75 + Math.abs(a.av) / (arch.turn + 1e-6) * 0.35);
        a.eff += (eff - a.eff) * Math.min(1, dts / 160);
        a.swim += dts * (0.006 + a.eff * 0.013);              // tailbeat frequency rises with effort

        updateFace(a, dts);
      }
    }

    // Flip hysteresis: reverse the sprite only after committed, sustained
    // horizontal motion, then ease the flip — never snap instantly.
    function updateFace(a, dt) {
      var hvx = Math.cos(a.hd) * a.sp;                 // horizontal velocity component
      var desired = a.faceTarget;
      if (hvx > 6e-5) desired = 1; else if (hvx < -6e-5) desired = -1; // dead zone avoids flutter
      if (desired !== a.faceTarget) {
        a.faceHold += dt;
        if (a.faceHold >= 260) { a.faceTarget = desired; a.faceHold = 0; }
      } else a.faceHold = 0;
      a.face += (a.faceTarget - a.face) * Math.min(1, dt / 240);
    }

    function homeFor(rec, a, view) {
      var arch = ARCH[rec.kind] || ARCH.generic;
      if (rec.kind === "clown" && view.hostPresent) { var h = hostAnchor(); return { x: h.x + (seeded(rec.id, "ox") - 0.5) * 0.1, y: h.y - 0.05 - seeded(rec.id, "oy") * 0.05 }; }
      if (rec.kind === "goby" && view.burrow) { var bg = burrowAnchor(); return { x: bg.x + 0.03, y: bg.y - 0.03 }; }
      if (rec.kind === "shrimp" && view.burrow) { var bs = burrowAnchor(); return { x: bs.x - 0.03, y: bs.y }; }
      return { x: a.homeX, y: a.homeY };
    }

    function nearestFood(view, a, arch) {
      if (!view.food.length) return null;
      var best = null, bd = Infinity;
      for (var i = 0; i < view.food.length; i++) {
        var p = view.food[i];
        // bottom feeders only chase food that has sunk low
        if ((arch.layer === "bottom" || arch.layer === "benthic") && p.y < SUB_TOP - 0.2) continue;
        var d = Math.hypot(p.x - a.x, p.y - a.y);
        if (d < bd) { bd = d; best = p; }
      }
      return bd < 0.5 ? best : null;
    }

    function updateAmbient(view, dt) {
      if (reduced) return;
      var k = 1 + view.flow * 0.8;
      for (var i = 0; i < bubbles.length; i++) {
        var b = bubbles[i];
        b.y -= b.s * dt * k;
        if (b.y < waterlineY(view) - 0.02) { b.y = 1.02; b.x = seeded("bub", i + "rx" + Math.round(b.y * 97)); }
      }
    }

    /* ============================== drawing ============================== */
    function render(now) {
      if (destroyed || !ctx) return;
      var dt = prevNow == null ? 16 : clamp(now - prevNow, 0, MAX_DT);
      prevNow = now; lastRenderAt = now;

      var view;
      try { view = normalizeView(getState()); }
      catch (e) { view = { ready: false }; }

      hitTargets.length = 0;
      ctx.clearRect(0, 0, cssW, cssH);

      if (!view.ready) { drawEmpty(now); return; }

      // record water level for a visual trend arrow when the sim gives none
      levelHist.push(view.level); if (levelHist.length > 90) levelHist.shift();

      reconcile(view);
      updateActors(view, dt);
      updateAmbient(view, dt);

      var pal = PAL[view.habitat];
      var light = frameLight = computeLight(view);

      // Photographic habitat plate is the visual hero; fall back to the
      // procedural, habitat-appropriate scene until (or unless) it loads.
      var photo = drawHabitatPlate(view, pal);
      if (!photo) {
        drawWater(view, pal, now);
        drawSubstrate(view, pal, now);
        if (view.habitat === "freshwater") { drawRootsAndLitter(view, pal, now); drawPlants(view, pal, now); }
        else { drawLiveRock(view, pal, now); }
      }
      // Coherent lighting over the settled scene: water-depth attenuation, a
      // localized fixture footprint, then flow-driven surface caustics.
      drawDepthAttenuation(view, light);
      drawDownwelling(view, light, now);
      drawCaustics(view, light, now);
      drawEquipment(view, pal, now);
      if (view.burrow) drawBurrow(view, pal);
      if (view.hostPresent) drawAnemone(view, now);
      drawCyano(view, now);
      drawCorals(view, now);
      drawOcclusion(view, light, photo);
      if (view.micro > 0.02) drawMicrofauna(view, now);
      drawLightMotes(view, light, now);
      if (view.eggs > 0) drawEggs(view, pal, now);
      drawDetritus(view, pal, now);
      drawFood(view, now);

      // dead behind, then living from back (bottom) to front (surface)
      drawAnimalsPass(view, now, true);
      drawAnimalsPass(view, now, false);
      if (view.fry > 0) drawFry(view, pal, now);

      drawHaze(view);
      drawGreenFilm(view);
      drawDiatomGlass(view);
      drawWaterlineAndTrend(view, pal, now);
      drawSelection(view);
      drawGlass(view);
    }

    /* ---- uninitialized: a calm, unstocked tank before habitat choice ---- */
    function drawEmpty(now) {
      var pal = PAL.empty;
      var g = ctx.createLinearGradient(0, 0, 0, cssH);
      g.addColorStop(0, pal.waterTop); g.addColorStop(0.6, pal.waterMid); g.addColorStop(1, pal.waterDeep);
      ctx.fillStyle = g; ctx.fillRect(0, 0, cssW, cssH);
      // faint light from above
      var lg = ctx.createLinearGradient(0, 0, 0, cssH * 0.7);
      lg.addColorStop(0, "rgba(255,255,255,0.14)"); lg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = lg; ctx.fillRect(0, 0, cssW, cssH * 0.7);
      // empty sand bed
      var sy = cssH * SUB_TOP;
      var sg = ctx.createLinearGradient(0, sy, 0, cssH);
      sg.addColorStop(0, pal.sand); sg.addColorStop(1, pal.sandDeep);
      ctx.fillStyle = sg; wavyBed(sy); ctx.fill();
      if (!reduced) {
        ctx.globalAlpha = 0.12; ctx.fillStyle = "#eafcff";
        for (var i = 0; i < bubbles.length; i++) { var b = bubbles[i]; ctx.beginPath(); ctx.arc(b.x * cssW, b.y * cssH, b.r, 0, 6.29); ctx.fill(); }
        ctx.globalAlpha = 1;
      }
      drawGlass({ level: 1 });
    }

    function wavyBed(sy) {
      ctx.beginPath(); ctx.moveTo(0, cssH); ctx.lineTo(0, sy);
      for (var x = 0; x <= cssW; x += 34) ctx.lineTo(x, sy + Math.sin(x * 0.02) * 5 * scale);
      ctx.lineTo(cssW, cssH); ctx.closePath();
    }

    /* ------------------------------ water -------------------------------- */
    // Glassy air region above the waterline, blended toward the water tone. Shared by
    // the procedural water pass and the photographic plate so a low/zero tank shows a
    // real dry/air gap in both, instead of a full-canvas submerged scene.
    function drawAirGlass(wl, blend) {
      if (wl <= 2) return;
      var ag = ctx.createLinearGradient(0, 0, 0, wl);
      ag.addColorStop(0, "#e9eef0"); ag.addColorStop(1, mix("#e9eef0", blend, 0.6));
      ctx.fillStyle = ag; ctx.fillRect(0, 0, cssW, wl);
    }
    function drawWater(view, pal, now) {
      var wl = waterlineY(view) * cssH;
      var haze = view.films.haze, green = view.films.green;
      var top = mix(pal.waterTop, "#dfeaea", haze * 0.4);
      var mid = mix(pal.waterMid, "#3f5a3a", green * 0.35);
      var deep = pal.waterDeep;
      var g = ctx.createLinearGradient(0, wl, 0, cssH);
      g.addColorStop(0, top); g.addColorStop(0.55, mid); g.addColorStop(1, deep);
      ctx.fillStyle = g; ctx.fillRect(0, wl, cssW, cssH - wl);
      drawAirGlass(wl, top); // glassy air gap above the waterline (faintly lit)
    }

    // Water-depth attenuation + photoperiod dimming as a MULTIPLY gradient that
    // deepens toward the substrate — not a flat full-frame tint.
    function drawDepthAttenuation(view, light) {
      var wl = waterlineY(view) * cssH, h = cssH - wl; if (h <= 0) return;
      var deep = light.marine ? [10, 42, 66] : [24, 14, 6];
      var top = clamp01(0.06 + (1 - light.surfaceI) * 0.16);
      var bot = clamp01(0.30 + (1 - light.surfaceI) * 0.5);
      ctx.save(); ctx.globalCompositeOperation = "multiply";
      var g = ctx.createLinearGradient(0, wl, 0, cssH);
      g.addColorStop(0, "rgba(" + deep.join(",") + "," + top + ")");
      g.addColorStop(1, "rgba(" + deep.join(",") + "," + bot + ")");
      ctx.fillStyle = g; ctx.fillRect(0, wl, cssW, h);
      ctx.restore();
    }

    // Localized fixture downwelling: an additive cone under the light bar that
    // attenuates with depth (Beer-Lambert) and lands as a bright footprint on the
    // sand. Additive so it reads as light, and localized so tank edges stay dim.
    function drawDownwelling(view, light, now) {
      var wl = waterlineY(view) * cssH, sub = cssH * SUB_TOP, reach = sub - wl;
      if (reach <= 4) return;
      var cx = light.fx * cssW, topHalf = cssW * 0.15, botHalf = cssW * 0.34;
      var core = clamp01(0.08 + light.surfaceI * 0.5) * light.iface;
      var t1 = Math.exp(-light.atten * 0.5), t2 = Math.exp(-light.atten * 1.0);
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      var grd = ctx.createLinearGradient(0, wl, 0, sub);
      grd.addColorStop(0, "rgba(" + light.col + "," + core + ")");
      grd.addColorStop(0.5, "rgba(" + light.col + "," + (core * t1) + ")");
      grd.addColorStop(1, "rgba(" + light.col + "," + (core * t2) + ")");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(cx - topHalf, wl); ctx.lineTo(cx + topHalf, wl);
      ctx.lineTo(cx + botHalf, sub); ctx.lineTo(cx - botHalf, sub);
      ctx.closePath(); ctx.fill();
      // bright substrate footprint directly beneath the bar
      var pool = ctx.createRadialGradient(cx, sub, 3, cx, sub, botHalf * 1.1);
      pool.addColorStop(0, "rgba(" + light.col + "," + (core * t2 * 1.5) + ")");
      pool.addColorStop(1, "rgba(" + light.col + ",0)");
      ctx.fillStyle = pool; ctx.beginPath(); ctx.ellipse(cx, sub, botHalf * 1.1, reach * 0.15, 0, 0, 6.29); ctx.fill();
      // faint emitter seat so the cone reads as a real fixture, not a gradient
      if (light.fixture && wl > 3 * scale) {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "rgba(" + light.col + "," + (0.35 * light.surfaceI + 0.1) + ")";
        ctx.fillRect(cx - topHalf * 0.7, wl - 2 * scale, topHalf * 1.4, 2.4 * scale);
      }
      ctx.restore();
    }

    // Surface caustics whose speed and amplitude respond to flow/pump state and
    // whose brightness tracks the local light. Localized to the lit band. Moving
    // caustics are fully suppressed under reduced motion.
    function drawCaustics(view, light, now) {
      if (reduced) return;
      var wl = waterlineY(view) * cssH, sub = cssH * SUB_TOP;
      if (sub - wl <= 0) return;                     // no water column (dry tank): suppress entirely
      var flow = view.flow, boost = view.equipment.circulation ? 1.35 : 1;
      var spd = 0.0006 + flow * 0.0016 * boost;    // pump/flow -> ripple speed
      var amp = (4 + flow * 10 * boost) * scale;    // pump/flow -> ripple amplitude
      var bright = clamp01(0.03 + light.surfaceI * 0.10) * (0.4 + light.adequacy);
      if (bright < 0.01) return;
      var cx = light.fx * cssW, span = cssW * 0.42;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, wl, cssW, sub - wl); ctx.clip();   // confine ripples to the wet region — never above the waterline
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = "rgba(" + light.col + "," + bright + ")"; ctx.lineWidth = 1.6 * scale;
      for (var i = 0; i < caustics.length; i++) {
        var c = caustics[i], yy = lerp(wl, sub, c.y), started = false;
        ctx.beginPath();
        for (var x = cx - span; x <= cx + span; x += 20) {
          var edge = 1 - Math.abs(x - cx) / span;   // fade at the edges of the lit band
          var y = yy + Math.sin(x * 0.03 + now * spd + c.o) * amp * edge;
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // Rock/coral occlusion: soft contact shadows on the substrate, offset away
    // from the fixture. Corals shadow in every scene; procedural hardscape adds
    // its own shadow only when no photographic plate owns the scene.
    function drawOcclusion(view, light, photo) {
      var sub = cssH * SUB_TOP, shade = 0.08 + light.surfaceI * 0.16;
      ctx.save(); ctx.globalCompositeOperation = "multiply";
      for (var i = 0; i < view.corals.length; i++) {
        var c = view.corals[i], p = coralPos(view, c, i);
        var off = (p.x / cssW - light.fx) * 42 * scale;
        var g = ctx.createRadialGradient(p.x + off, sub + 2 * scale, 2, p.x + off, sub + 2 * scale, 32 * scale);
        g.addColorStop(0, "rgba(18,24,28," + shade + ")"); g.addColorStop(1, "rgba(18,24,28,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(p.x + off, sub + 2 * scale, 28 * scale, 8 * scale, 0, 0, 6.29); ctx.fill();
      }
      if (!photo) {
        var anchors = light.marine ? [{ x: 0.68, w: 0.34 }, { x: 0.2, w: 0.24 }] : [{ x: 0.16, w: 0.14 }, { x: 0.82, w: 0.16 }];
        for (var m = 0; m < anchors.length; m++) {
          var ax = anchors[m].x * cssW, off2 = (anchors[m].x - light.fx) * 60 * scale, rw = anchors[m].w * cssW * 0.5;
          var rg = ctx.createRadialGradient(ax + off2, sub, 3, ax + off2, sub, rw * 1.2);
          rg.addColorStop(0, "rgba(14,20,24," + (shade * 1.1) + ")"); rg.addColorStop(1, "rgba(14,20,24,0)");
          ctx.fillStyle = rg; ctx.beginPath(); ctx.ellipse(ax + off2, sub + 3 * scale, rw, 11 * scale, 0, 0, 6.29); ctx.fill();
        }
      }
      ctx.restore();
    }

    // Suspended particulate catching the light: motes brightest inside the lit
    // cone, drifting slowly with flow, count bounded for mobile. Reduced motion
    // holds them still.
    function drawLightMotes(view, light, now) {
      var density = clamp01(view.micro * 0.7 + view.films.haze * 0.4);
      var n = Math.round(density * (reduced ? 10 : 26));
      if (n <= 0 || light.surfaceI < 0.04) return;
      var wlF = waterlineY(view), cx = light.fx, span = 0.42;
      var wlPx = wlF * cssH, subPx = cssH * SUB_TOP;
      if (subPx - wlPx <= 0) return;                  // no water column (dry tank): suppress entirely
      ctx.save();
      ctx.beginPath(); ctx.rect(0, wlPx, cssW, subPx - wlPx); ctx.clip();   // confine motes to the wet region — never above the waterline
      ctx.globalCompositeOperation = "lighter";
      for (var i = 0; i < n; i++) {
        var driftX = reduced ? 0 : Math.sin(now * (0.00016 + seeded("mote", i) * 0.0002) + i) * 0.02 * (0.4 + view.flow);
        var driftY = reduced ? 0 : Math.sin(now * 0.0002 + i * 1.3) * 0.03;
        var x = clamp01(seeded("mote", i + "x") + driftX);
        var y = clamp01(wlF + 0.06 + seeded("mote", i + "y") * (SUB_TOP - wlF - 0.06) + driftY);
        var inCone = clamp01(1 - Math.abs(x - cx) / span);
        var a = (0.04 + inCone * 0.26) * light.surfaceI * (0.5 + seeded("mote", i + "a") * 0.5);
        if (a < 0.015) continue;
        ctx.fillStyle = "rgba(" + light.col + "," + a + ")";
        var r = (0.6 + seeded("mote", i + "s") * 1.2) * scale;
        ctx.beginPath(); ctx.arc(x * cssW, y * cssH, r, 0, 6.29); ctx.fill();
      }
      ctx.restore();
    }

    /* ---------------------------- substrate ------------------------------ */
    function drawSubstrate(view, pal, now) {
      var sy = cssH * SUB_TOP;
      var sand = pal.sand, deep = pal.sandDeep;
      // brown diatom film tints young substrate; maturity greens it slightly
      sand = mix(sand, "#8a6a34", view.films.diatom * 0.5);
      sand = mix(sand, "#6f7d45", view.films.green * 0.25);
      var sg = ctx.createLinearGradient(0, sy, 0, cssH);
      sg.addColorStop(0, mix(sand, "#ffffff", 0.06)); sg.addColorStop(1, deep);
      ctx.fillStyle = sg; wavyBed(sy); ctx.fill();
      // grain speckle
      ctx.save(); ctx.beginPath(); wavyBed(sy); ctx.clip();
      ctx.globalAlpha = 0.5;
      for (var i = 0; i < 90; i++) {
        var gx = seeded("grain", i + "x") * cssW, gy = sy + seeded("grain", i + "y") * (cssH - sy);
        ctx.fillStyle = seeded("grain", i) > 0.5 ? rgba(deep, 0.5) : rgba("#ffffff", 0.35);
        ctx.fillRect(gx, gy, 1.6 * scale, 1.6 * scale);
      }
      ctx.restore();
    }

    /* ----------------------- freshwater hardscape ------------------------ */
    function drawRootsAndLitter(view, pal, now) {
      var sy = cssH * SUB_TOP;
      // driftwood roots reaching down from the back
      ctx.save();
      ctx.strokeStyle = pal.rock; ctx.lineCap = "round";
      var roots = [{ x: 0.16, spread: 0.05 }, { x: 0.82, spread: 0.06 }];
      for (var r = 0; r < roots.length; r++) {
        var rt = roots[r], bx = rt.x * cssW;
        for (var i = 0; i < 3; i++) {
          ctx.lineWidth = (7 - i * 1.6) * scale;
          ctx.beginPath(); ctx.moveTo(bx + (i - 1) * 10 * scale, 0);
          ctx.bezierCurveTo(bx + (i - 1) * 22 * scale, cssH * 0.35, bx + (i - 1.5) * rt.spread * cssW, cssH * 0.6, rt.x * cssW + (i - 1) * rt.spread * cssW, sy - 4 * scale);
          ctx.stroke();
        }
      }
      ctx.restore();
      // leaf litter on the sand
      var n = Math.round(6 + view.maturity * 8);
      for (var L = 0; L < n; L++) {
        var lx = seeded("leaf", L + "x") * cssW, ly = sy + 4 * scale + seeded("leaf", L + "y") * (cssH - sy) * 0.7;
        var lw = (14 + seeded("leaf", L + "w") * 16) * scale, rot = (seeded("leaf", L + "r") - 0.5) * 1.2;
        ctx.save(); ctx.translate(lx, ly); ctx.rotate(rot);
        ctx.fillStyle = seeded("leaf", L) > 0.5 ? pal.litter : pal.litter2;
        ctx.beginPath(); ctx.ellipse(0, 0, lw, lw * 0.34, 0, 0, 6.29); ctx.fill();
        ctx.strokeStyle = rgba("#3a2110", 0.5); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-lw, 0); ctx.lineTo(lw, 0); ctx.stroke();
        ctx.restore();
      }
    }

    function drawPlants(view, pal, now) {
      var sy = cssH * SUB_TOP;
      var clumps = [{ x: 0.1, n: 5, h: 0.34 }, { x: 0.9, n: 6, h: 0.4 }, { x: 0.6, n: 4, h: 0.26 }];
      for (var c = 0; c < clumps.length; c++) {
        var cl = clumps[c], bx = cl.x * cssW, grow = 0.5 + view.maturity * 0.6;
        for (var i = 0; i < cl.n; i++) {
          var x = bx + (i - cl.n / 2) * 9 * scale;
          var sway = reduced ? 0 : Math.sin(now * 0.001 + i + c) * 9 * scale * (0.4 + view.flow);
          var topY = sy - cl.h * cssH * grow;
          var col = (i % 4 === 0) ? pal.plantRed : (i % 2 ? pal.plant : pal.plantDeep);
          ctx.strokeStyle = col; ctx.lineWidth = (3.4 - (i % 2)) * scale; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(x, sy);
          ctx.quadraticCurveTo(x + sway * 0.6, (sy + topY) / 2, x + sway, topY); ctx.stroke();
          // blade tip leaf
          ctx.fillStyle = rgba(col, 0.85);
          ctx.beginPath(); ctx.ellipse(x + sway, topY, 3.5 * scale, 8 * scale, sway * 0.02, 0, 6.29); ctx.fill();
        }
      }
    }

    /* --------------------------- reef hardscape -------------------------- */
    function drawLiveRock(view, pal, now) {
      var sy = cssH * SUB_TOP;
      // a sheltered reef mound plus a smaller outcrop
      var mounds = [{ x: 0.68, w: 0.34, h: 0.32 }, { x: 0.2, w: 0.24, h: 0.2 }];
      for (var m = 0; m < mounds.length; m++) {
        var md = mounds[m], cx = md.x * cssW, w = md.w * cssW, h = md.h * cssH;
        var top = sy - h;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx - w / 2, sy + 6 * scale);
        ctx.bezierCurveTo(cx - w * 0.55, top + h * 0.2, cx - w * 0.2, top, cx, top + h * 0.05);
        ctx.bezierCurveTo(cx + w * 0.25, top - h * 0.02, cx + w * 0.55, top + h * 0.25, cx + w / 2, sy + 6 * scale);
        ctx.closePath();
        var rg = ctx.createLinearGradient(0, top, 0, sy);
        rg.addColorStop(0, pal.rockLit); rg.addColorStop(1, pal.rock);
        ctx.fillStyle = rg; ctx.fill();
        // coralline encrusting patches, richer with maturity
        ctx.clip();
        var patches = Math.round(6 + view.maturity * 14);
        for (var i = 0; i < patches; i++) {
          var px = cx - w / 2 + seeded("cor" + m, i + "x") * w;
          var py = top + seeded("cor" + m, i + "y") * h;
          var pr = (4 + seeded("cor" + m, i + "r") * 10) * scale * (0.5 + view.maturity);
          ctx.fillStyle = rgba(seeded("cor" + m, i) > 0.5 ? pal.coralline : pal.coralline2, 0.35 + view.maturity * 0.4);
          ctx.beginPath(); ctx.arc(px, py, pr, 0, 6.29); ctx.fill();
        }
        // green algae fuzz on rock when green film is high
        if (view.films.green > 0.2) {
          ctx.strokeStyle = rgba("#5f8f3a", view.films.green * 0.5); ctx.lineWidth = 1.4 * scale;
          for (var g = 0; g < patches; g++) {
            var gx = cx - w / 2 + seeded("alg" + m, g) * w, gy = top + seeded("alg" + m, g + "y") * h * 0.7;
            var sway = reduced ? 0 : Math.sin(now * 0.002 + g) * 3;
            ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + sway, gy - 7 * scale); ctx.stroke();
          }
        }
        ctx.restore();
      }
    }

    /* ----------------------------- burrow -------------------------------- */
    function drawBurrow(view, pal) {
      var b = burrowAnchor(), bx = b.x * cssW, by = b.y * cssH;
      ctx.save();
      // rubble ring
      ctx.fillStyle = rgba(pal.sandDeep, 0.9);
      ctx.beginPath(); ctx.ellipse(bx, by, 34 * scale, 15 * scale, 0, 0, 6.29); ctx.fill();
      // dark mouth
      var g = ctx.createRadialGradient(bx, by, 2, bx, by, 22 * scale);
      g.addColorStop(0, "rgba(10,14,18,0.95)"); g.addColorStop(1, "rgba(10,14,18,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(bx, by, 20 * scale, 9 * scale, 0, 0, 6.29); ctx.fill();
      // scattered rubble stones
      for (var i = 0; i < 6; i++) {
        var rx = bx + (seeded("rub", i + "x") - 0.5) * 66 * scale, ry = by + (seeded("rub", i + "y") - 0.5) * 20 * scale;
        ctx.fillStyle = rgba("#8f8f9a", 0.8); ctx.beginPath(); ctx.arc(rx, ry, (2 + seeded("rub", i) * 3) * scale, 0, 6.29); ctx.fill();
      }
      ctx.restore();
    }

    /* --------------------------- equipment cues -------------------------- */
    // Subtle, back/side-of-tank hardware cues, gated on the equipment flags.
    // Particle motion is stateless (derived from `now`) and skipped when reduced.
    function drawEquipment(view, pal, now) {
      var eq = view.equipment;
      var wl = waterlineY(view) * cssH, subY = cssH * SUB_TOP;
      ctx.save();
      // Filter return nozzle (top-right) with an outflow stream.
      if (eq.filter) {
        var nx = cssW * 0.9, ny = wl + 10 * scale;
        ctx.fillStyle = "#2c2f33";
        ctx.fillRect(nx - 4 * scale, wl - 8 * scale, 8 * scale, 18 * scale);
        ctx.beginPath(); ctx.moveTo(nx - 7 * scale, ny); ctx.lineTo(nx + 6 * scale, ny); ctx.lineTo(nx - 3 * scale, ny + 8 * scale); ctx.closePath(); ctx.fill();
        if (!reduced) {
          ctx.fillStyle = "rgba(230,245,250,0.5)";
          for (var i = 0; i < 7; i++) {
            var t = ((now * 0.03 + i * 40) % 120) / 120;
            var bx = nx - 6 * scale - t * 42 * scale + Math.sin(now * 0.004 + i) * 3 * scale;
            var by = ny + 6 * scale + t * 34 * scale;
            ctx.beginPath(); ctx.arc(bx, by, (1.4 + (1 - t) * 1.6) * scale, 0, 6.29); ctx.fill();
          }
        }
      }
      // Heater rod (back-left) with an amber indicator and warm shimmer.
      if (eq.heater) {
        var hx = cssW * 0.12;
        ctx.strokeStyle = "#c9ccd1"; ctx.lineWidth = 5 * scale; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(hx, wl - 2 * scale); ctx.lineTo(hx, subY - 12 * scale); ctx.stroke();
        ctx.fillStyle = "#ff6a3d"; ctx.beginPath(); ctx.arc(hx, wl + 10 * scale, 2.2 * scale, 0, 6.29); ctx.fill();
        var gg = ctx.createRadialGradient(hx, subY - 24 * scale, 2, hx, subY - 24 * scale, 44 * scale);
        gg.addColorStop(0, "rgba(255,120,60,0.10)"); gg.addColorStop(1, "rgba(255,120,60,0)");
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(hx, subY - 30 * scale, 44 * scale, 0, 6.29); ctx.fill();
      }
      // Powerhead / circulation (right wall) throwing flow lines into the tank.
      if (eq.circulation) {
        var px = cssW * 0.965, py = wl + (subY - wl) * 0.4;
        ctx.fillStyle = "#3a3d42"; ctx.beginPath(); ctx.ellipse(px, py, 7 * scale, 9 * scale, 0, 0, 6.29); ctx.fill();
        ctx.fillStyle = "#1c1e21"; ctx.beginPath(); ctx.arc(px - 2 * scale, py, 4 * scale, 0, 6.29); ctx.fill();
        ctx.strokeStyle = "rgba(220,240,245,0.35)"; ctx.lineWidth = 1.5 * scale;
        var ph = reduced ? 0 : (now * 0.06) % 20;
        for (var a = 0; a < 3; a++) {
          var yy = py + (a - 1) * 8 * scale;
          ctx.beginPath(); ctx.moveTo(px - 8 * scale - ph * scale, yy); ctx.lineTo(px - 26 * scale - ph * scale, yy); ctx.stroke();
        }
      }
      // Protein skimmer fine-bubble column (marine only).
      if (eq.skimmer && view.habitat === "marine" && !reduced) {
        var sx = cssW * 0.045;
        ctx.fillStyle = "rgba(240,250,252,0.4)";
        for (var j = 0; j < 9; j++) {
          var st = ((now * 0.05 + j * 30) % 90) / 90;
          var sby = subY - st * (subY - wl);
          ctx.beginPath(); ctx.arc(sx + Math.sin(now * 0.005 + j) * 2 * scale, sby, 1.3 * scale, 0, 6.29); ctx.fill();
        }
      }
      // Auto top-off trickle at the surface (freshwater ATO / reef ATO).
      if (eq.ato) {
        var ax = cssW * 0.83;
        ctx.strokeStyle = "rgba(210,235,245,0.5)"; ctx.lineWidth = 1.5 * scale;
        ctx.beginPath(); ctx.moveTo(ax, wl - 10 * scale); ctx.lineTo(ax, wl + 2 * scale); ctx.stroke();
        ctx.fillStyle = "rgba(210,235,245,0.6)"; ctx.beginPath(); ctx.arc(ax, wl + 3 * scale, 1.6 * scale, 0, 6.29); ctx.fill();
      }
      ctx.restore();
    }

    /* ---------------------------- anemone host --------------------------- */
    function drawAnemone(view, now) {
      var h = hostAnchor(), cx = h.x * cssW, cy = h.y * cssH;
      var open = 0.6 + view.par * 0.4;
      ctx.save();
      // column
      ctx.fillStyle = "#c98fae";
      ctx.beginPath(); ctx.ellipse(cx, cy, 22 * scale, 12 * scale, 0, 0, 6.29); ctx.fill();
      // oral disc + tentacles
      var n = 22;
      for (var i = 0; i < n; i++) {
        var a = i / n * 6.28;
        var len = (16 + seeded("anem", i) * 10) * scale * open;
        var sway = reduced ? 0 : Math.sin(now * 0.003 + i) * 3 * scale;
        var ex = cx + Math.cos(a) * (18 * scale + len * 0.3) + sway;
        var ey = cy + Math.sin(a) * (9 * scale) - len;
        ctx.strokeStyle = rgba("#d99bbe", 0.9); ctx.lineWidth = 3 * scale; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 14 * scale, cy + Math.sin(a) * 7 * scale); ctx.quadraticCurveTo((cx + ex) / 2 + sway, (cy + ey) / 2, ex, ey); ctx.stroke();
        // magenta tip
        ctx.fillStyle = "#8e3fb0"; ctx.beginPath(); ctx.arc(ex, ey, 2.4 * scale, 0, 6.29); ctx.fill();
      }
      ctx.restore();
    }

    /* ------------------------------ cyano -------------------------------- */
    function drawCyano(view, now) {
      var lvl = view.films.cyano; if (lvl <= 0.03) return;
      var zones = lowFlowZones();
      for (var z = 0; z < zones.length; z++) {
        var zn = zones[z];
        // cyano prefers low flow — attenuate by flow, boost in dead corners
        var local = clamp01(lvl * (1 - view.flow * 0.6) * (1.1 - z * 0.1));
        if (local <= 0.04) continue;
        var cx = zn.x * cssW, cy = zn.y * cssH, rw = zn.r * cssW, rh = zn.r * cssH * 0.5;
        ctx.save();
        ctx.globalAlpha = clamp01(0.25 + local * 0.55);
        var blobs = 5;
        for (var i = 0; i < blobs; i++) {
          var bx = cx + (seeded("cy" + z, i + "x") - 0.5) * rw;
          var by = cy + (seeded("cy" + z, i + "y") - 0.5) * rh;
          var br = (10 + seeded("cy" + z, i + "r") * 18) * scale * (0.6 + local);
          var g = ctx.createRadialGradient(bx, by, 1, bx, by, br);
          g.addColorStop(0, "rgba(150,32,46,0.9)"); g.addColorStop(0.7, "rgba(110,26,54,0.7)"); g.addColorStop(1, "rgba(90,20,60,0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(bx, by, br, br * 0.6, 0, 0, 6.29); ctx.fill();
        }
        // stringy filaments with trapped O2 bubbles
        ctx.strokeStyle = "rgba(120,24,52,0.6)"; ctx.lineWidth = 1.4 * scale;
        for (var f = 0; f < 4; f++) {
          var fx = cx + (seeded("cyf" + z, f) - 0.5) * rw, fy = cy - seeded("cyf" + z, f + "y") * rh * 0.6;
          var sway = reduced ? 0 : Math.sin(now * 0.0015 + f) * 3;
          ctx.beginPath(); ctx.moveTo(fx, cy); ctx.quadraticCurveTo(fx + sway, (cy + fy) / 2, fx + sway, fy); ctx.stroke();
          ctx.fillStyle = "rgba(220,230,220,0.55)"; ctx.beginPath(); ctx.arc(fx + sway, fy, 1.5 * scale, 0, 6.29); ctx.fill();
        }
        ctx.restore();
      }
    }

    /* ------------------------------ corals ------------------------------- */
    function coralPos(view, c, idx) {
      if (Number.isFinite(c.seedX) && Number.isFinite(c.seedY)) return { x: clamp01(c.seedX) * cssW, y: clamp01(c.seedY) * cssH };
      // place on the reef mound deterministically
      var x = 0.52 + (seeded(c.id, "x") - 0.5) * 0.5;
      var y = SUB_TOP - 0.02 - seeded(c.id, "y") * 0.14;
      return { x: clamp01(x) * cssW, y: clamp01(y) * cssH };
    }
    function coralColor(c, fallback) {
      var col = c.color;
      if (typeof col === "string" && /^#?[0-9a-fA-F]{3,6}$/.test(col)) return col[0] === "#" ? col : "#" + col;
      if (typeof col === "string") {
        var map = { green: "#3fbf6f", red: "#e0533a", purple: "#9a5cc4", blue: "#4aa8d8", orange: "#ff8a3d", pink: "#e06ea0", teal: "#2fb6a8" };
        if (map[lc(col)]) return map[lc(col)];
      }
      return fallback;
    }
    function drawCorals(view, now) {
      // Photosynthetic corals present themselves by light adequacy (local PPFD):
      // polyps extend and colour deepens under adequate light, retract when dim.
      var adeq = frameLight ? frameLight.adequacy : 0.7;
      for (var i = 0; i < view.corals.length; i++) {
        var c = view.corals[i], p = coralPos(view, c, i);
        // record hit target
        hitTargets.push({ id: c.id, x: p.x, y: p.y, r: 26 * scale });
        var pale = lerp(1, 0.5, 1 - c.health) * (0.55 + 0.45 * adeq); // low health OR low light -> paler
        if (c.kind === "goniopora") drawGoniopora(c, p, view, now, pale, adeq);
        else drawZoanthid(c, p, view, now, pale, adeq);
      }
    }
    function drawZoanthid(c, p, view, now, pale, adeq) {
      var base = coralColor(c, "#3fbf6f"), disc = mix(base, "#ffffff", 0.18);
      var mat = 18 * scale + view.maturity * 6 * scale;
      ctx.save(); ctx.translate(p.x, p.y);
      // encrusting mat
      ctx.fillStyle = mix("#6a4a3a", base, 0.3); ctx.beginPath(); ctx.ellipse(0, 0, mat, mat * 0.55, 0, 0, 6.29); ctx.fill();
      var n = clamp(c.polyps, 4, 20);
      for (var i = 0; i < n; i++) {
        var a = i / n * 6.28 + c.polyps;
        var rr = (i % 3 === 0) ? 0 : mat * (0.4 + (i % 2) * 0.4);
        var px = Math.cos(a) * rr, py = Math.sin(a) * rr * 0.55;
        var ext = clamp01(c.ext * (0.35 + 0.65 * adeq) + Math.sin(now * 0.002 * (reduced ? 0 : 1) + i) * 0.05);
        var pr = (3 + ext * 4) * scale;
        // tentacle fringe
        ctx.strokeStyle = rgbaMix(base, "#ffffff", 0.1, 0.8 * pale); ctx.lineWidth = 1 * scale;
        var fr = 10;
        for (var t = 0; t < fr; t++) {
          var ta = t / fr * 6.28, tl = pr * (1.2 + ext * 0.8);
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(ta) * tl, py + Math.sin(ta) * tl); ctx.stroke();
        }
        // oral disc + mouth
        ctx.fillStyle = rgba(disc, 0.95 * pale); ctx.beginPath(); ctx.arc(px, py, pr, 0, 6.29); ctx.fill();
        ctx.fillStyle = rgba(mix(base, "#20140a", 0.5), 0.9); ctx.beginPath(); ctx.arc(px, py, pr * 0.35, 0, 6.29); ctx.fill();
      }
      ctx.restore();
    }
    function drawGoniopora(c, p, view, now, pale, adeq) {
      var base = coralColor(c, "#9a7bc4");
      ctx.save(); ctx.translate(p.x, p.y);
      // fleshy mound
      var R = (16 + view.maturity * 6) * scale;
      var g = ctx.createRadialGradient(0, 0, 2, 0, 0, R);
      g.addColorStop(0, mix(base, "#ffffff", 0.2)); g.addColorStop(1, mix(base, "#3a2b50", 0.4));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.29); ctx.fill();
      // long daisy polyps on stalks — extension driven by state
      var n = clamp(c.polyps, 3, 12);
      for (var i = 0; i < n; i++) {
        var a = i / n * 6.28, dist = R * (0.3 + (i % 3) * 0.22);
        var bx = Math.cos(a) * dist, by = Math.sin(a) * dist * 0.7 - R * 0.2;
        var ext = clamp01(c.ext * (0.35 + 0.65 * adeq) + (reduced ? 0 : Math.sin(now * 0.0022 + i) * 0.06));
        var stalk = (10 + ext * 20) * scale;
        var tipx = bx + (reduced ? 0 : Math.sin(now * 0.0018 + i) * 3 * scale);
        var tipy = by - stalk;
        ctx.strokeStyle = rgba(mix(base, "#ffffff", 0.1), 0.85 * pale); ctx.lineWidth = 2 * scale; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx, by - stalk * 0.6, tipx, tipy); ctx.stroke();
        // 24-tentacle flower head, opening with extension
        var petals = 8;
        for (var t = 0; t < petals; t++) {
          var ta = t / petals * 6.28, pl = (2 + ext * 5) * scale;
          ctx.beginPath(); ctx.moveTo(tipx, tipy); ctx.lineTo(tipx + Math.cos(ta) * pl, tipy + Math.sin(ta) * pl); ctx.stroke();
        }
        ctx.fillStyle = rgba(mix(base, "#ffffff", 0.35), 0.9 * pale); ctx.beginPath(); ctx.arc(tipx, tipy, 2 * scale, 0, 6.29); ctx.fill();
      }
      ctx.restore();
    }

    /* ---------------------------- microfauna ----------------------------- */
    function drawMicrofauna(view, now) {
      var n = Math.round(view.micro * (reduced ? 14 : 30));
      ctx.save();
      for (var i = 0; i < n; i++) {
        var baseX = seeded("mf", i + "x"), baseY = 0.8 + seeded("mf", i + "y") * 0.19;
        var dx = reduced ? 0 : Math.sin(now * 0.004 + i * 1.7) * 0.006;
        var dy = reduced ? 0 : Math.cos(now * 0.003 + i) * 0.004;
        var x = clamp01(baseX + dx) * cssW, y = clamp01(baseY + dy) * cssH;
        ctx.globalAlpha = 0.25 + seeded("mf", i) * 0.4;
        ctx.fillStyle = i % 4 === 0 ? "#d8e0c0" : "#e8dcc0";
        ctx.fillRect(x, y, 1.5 * scale, 1.5 * scale);
        if (i % 5 === 0) { ctx.fillRect(x - 1.2 * scale, y, 1.1 * scale, 1.1 * scale); } // amphipod hint
      }
      ctx.restore();
    }

    /* ------------------------------- eggs -------------------------------- */
    function drawEggs(view, pal, now) {
      var marine = view.habitat === "marine";
      var origin = marine ? { x: hostAnchor().x - 0.05, y: hostAnchor().y + 0.02 } : { x: 0.6, y: SUB_TOP - 0.16 };
      var n = Math.min(view.eggs, 60);
      ctx.save();
      for (var i = 0; i < n; i++) {
        var ex = (origin.x + (seeded("egg", i + "x") - 0.5) * (marine ? 0.1 : 0.16)) * cssW;
        var ey = (origin.y + (seeded("egg", i + "y") - 0.5) * (marine ? 0.05 : 0.1)) * cssH;
        var shimmer = reduced ? 1 : 0.8 + Math.sin(now * 0.004 + i) * 0.2;
        ctx.fillStyle = marine ? rgba("#ff9a3d", 0.9 * shimmer) : rgba("#cfeaf2", 0.85 * shimmer);
        ctx.beginPath(); ctx.ellipse(ex, ey, 2.6 * scale, 3.4 * scale, 0, 0, 6.29); ctx.fill();
        ctx.fillStyle = rgba("#20140a", 0.5); ctx.beginPath(); ctx.arc(ex, ey + 0.6 * scale, 0.9 * scale, 0, 6.29); ctx.fill(); // developing eye
      }
      ctx.restore();
    }

    /* ---------------------------- detritus ------------------------------- */
    function drawDetritus(view, pal, now) {
      var lvl = view.detritus; if (lvl <= 0.02) return;
      var n = Math.round(lvl * 60);
      var zones = lowFlowZones();
      ctx.save(); ctx.globalAlpha = 0.5;
      for (var i = 0; i < n; i++) {
        // bias detritus into low-flow zones
        var z = zones[i % zones.length];
        var x = clamp01(z.x + (seeded("det", i + "x") - 0.5) * z.r * 1.4) * cssW;
        var y = clamp01((SUB_TOP - 0.01) + seeded("det", i + "y") * 0.15) * cssH;
        ctx.fillStyle = seeded("det", i) > 0.5 ? "#6b5334" : "#4d3c22";
        ctx.fillRect(x, y, 1.8 * scale, 1.4 * scale);
      }
      ctx.restore();
    }

    /* ------------------------------ food --------------------------------- */
    function drawFood(view, now) {
      // A fresh pellet (food count rose since last frame) opens a brief, runtime-only emphasis
      // window so a cold player sees the food land and the fish turn to it. Purely visual —
      // FEED_AT stays the authoritative feeding action and nothing here touches state or the save.
      // The FIRST ready frame only BASELINES the count (adopting any pellets a save already holds),
      // so loading a save or recreating the renderer never fabricates a feed response; only a later
      // increase flashes.
      var fc = view.food.length;
      if (!foodBaselined) foodBaselined = true;
      else if (fc > lastFoodCount) feedFlashUntil = now + FEED_FLASH_MS;
      lastFoodCount = fc;
      var flash = feedFlash(now, feedFlashUntil, FEED_FLASH_MS); // 1 at the drop, easing to 0
      for (var i = 0; i < view.food.length; i++) {
        var p = view.food[i], x = p.x * cssW, y = p.y * cssH;
        if (flash > 0) {
          var hr = (7 + 9 * (1 - flash)) * scale; // an expanding, fading halo
          var hg = ctx.createRadialGradient(x, y, 0.5, x, y, hr);
          hg.addColorStop(0, "rgba(255,242,200," + (0.6 * flash).toFixed(3) + ")");
          hg.addColorStop(1, "rgba(255,214,120,0)");
          ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(x, y, hr, 0, 6.29); ctx.fill();
        }
        var g = ctx.createRadialGradient(x - 1.5, y - 1.5, 0.5, x, y, 5 * scale);
        g.addColorStop(0, "#ffe6a8"); g.addColorStop(1, "#c07a24");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, (3.4 + clamp(p.amt, 0.3, 2)) * scale, 0, 6.29); ctx.fill();
      }
    }

    /* ----------------------------- animals ------------------------------- */
    function sizeFor(rec, a) {
      var arch = ARCH[rec.kind] || ARCH.generic;
      var rs = renderScale > 0 ? renderScale : scale;
      var depthK = a ? lerp(0.82, 1.14, a.z) : 1; // near = larger, far = smaller
      var L = arch.rel * Math.min(cssW, cssH * 1.7) * lifeScale(rec.ent) * rs * depthK;
      return clamp(L, arch.min * rs, arch.max * rs);
    }
    function layerRank(kind) {
      var arch = ARCH[kind] || ARCH.generic;
      if (arch.layer === "benthic") return 0;
      if (arch.layer === "burrow" || arch.layer === "burrow2") return 1;
      if (arch.layer === "bottom") return 2;
      return 3;
    }
    function drawAnimalsPass(view, now, deadPass) {
      var list = view.animals.filter(function (r) { return r.dead === deadPass; });
      if (!deadPass) list.sort(function (p, q) {
        var lr = layerRank(p.kind) - layerRank(q.kind); if (lr) return lr;
        var az = actors[p.id] ? actors[p.id].z : 0.5, bz = actors[q.id] ? actors[q.id].z : 0.5;
        return az - bz; // far (small z) behind, near (large z) in front
      });
      for (var i = 0; i < list.length; i++) {
        var rec = list[i], a = actors[rec.id]; if (!a) continue;
        // Ease rendered length toward target so growth and stage/scale changes interpolate.
        var target = sizeFor(rec, a);
        a.rlen = a.rlen > 0 ? a.rlen + (target - a.rlen) * 0.12 : target;
        var L = a.rlen;
        // Subtle depth parallax: layers slide at slightly different rates (offset
        // applies to both draw and hit target so pointer routing stays accurate).
        var par = reduced ? 0 : (a.z - 0.5) * 0.012 * Math.sin(now * 0.00013 + a.phase);
        var px = (a.x + par) * cssW, py = a.y * cssH;
        if (!rec.dead) hitTargets.push({ id: rec.id, x: px, y: py, r: Math.max(14 * renderScale, L * 0.55) });
        ctx.save(); ctx.translate(px, py);
        if (rec.dead) {
          ctx.globalAlpha = 0.5; ctx.scale(a.face >= 0 ? 1 : -1, -1); // belly-up
          drawSpecies(rec.kind, L, now, a, view, true);
        } else {
          ctx.globalAlpha = lerp(0.7, 1, a.z); // far fish sit back, hazier
          var spr = spriteFor(rec.kind);
          var dir = a.face >= 0 ? Math.max(0.3, a.face) : Math.min(-0.3, a.face);
          if (spr) {
            // Bank on the LAGGED body heading (body-axis lag) plus a subtle
            // effort-scaled sway, so the sprite rides the physics layer
            // (heading/speed/flip/depth) rather than reading as a flat sticker.
            var bank = reduced ? 0 : clamp(Math.sin(a.rhd) * 0.5, -0.26, 0.26);
            var sway = reduced ? 0 : Math.sin(a.swim) * a.eff * 0.05;
            ctx.rotate((bank + sway) * (a.face >= 0 ? 1 : -1));
            ctx.scale(dir, 1);
            drawSpriteBody(spr, L, a, view);
          } else {
            ctx.scale(dir, 1);
            drawSpecies(rec.kind, L, now, a, view, false); // restrained procedural fallback
          }
        }
        ctx.restore();
      }
    }
    // Photographic sprite body drawn in the already-transformed local frame
    // (translated to position, banked, flipped). Uses the source content crop so
    // transparent margins never distort scale; then integrates with the frame's
    // lighting via a silhouette-only (source-atop) shade so it is not a flat cutout.
    function drawSpriteBody(spr, L, a, view) {
      var iw = spr.img.naturalWidth || spr.img.width, ih = spr.img.naturalHeight || spr.img.height;
      if (!iw || !ih) return;
      var cr = spr.crop;
      var sx = cr.u0 * iw, sy = cr.v0 * ih, sw = (cr.u1 - cr.u0) * iw, sh = (cr.v1 - cr.v0) * ih;
      var dw = L, dh = L * (sh / sw), dx = -L * 0.5, dy = -dh * 0.5;
      try { ctx.drawImage(spr.img, sx, sy, sw, sh, dx, dy, dw, dh); }
      catch (e) { spr.failed = true; return; }
      var lite = frameLight;
      if (lite) {
        // local light at this depth (Beer-Lambert on the fish's y within the column)
        var depthFrac = clamp01((a.y - waterlineY(view)) / 0.8);
        var local = clamp01(lite.surfaceI * lite.iface * Math.exp(-lite.atten * depthFrac));
        ctx.save(); ctx.globalCompositeOperation = "source-atop";
        if (local < 0.5) ctx.fillStyle = "rgba(12,22,34," + ((0.5 - local) * 0.5) + ")";        // cool shadow when dim/deep
        else ctx.fillStyle = "rgba(" + lite.col + "," + ((local - 0.5) * 0.22) + ")";          // faint warm sheen when well lit
        ctx.fillRect(dx, dy, dw, dh);
        ctx.restore();
      }
    }
    function drawSpecies(kind, L, now, a, view, dead) {
      switch (kind) {
        case "tetra": return drawTetra(L, now, a, dead);
        case "cory": return drawCory(L, now, a, dead);
        case "clown": return drawClown(L, now, a, dead);
        case "goby": return drawGoby(L, now, a, dead);
        case "shrimp": return drawShrimp(L, now, a, dead);
        case "shark": return drawShark(L, now, a, dead);
        default: return drawGeneric(L, now, a, dead);
      }
    }

    // shared primitives (local space, +x = forward/nose)
    // Restrained organic eye: a soft dark iris with a faint socket and a small
    // catchlight — not a hard cartoon white ball.
    function eye(x, y, r, dead) {
      ctx.save();
      ctx.fillStyle = dead ? "rgba(120,120,120,0.6)" : "rgba(20,26,32,0.5)";
      ctx.beginPath(); ctx.arc(x, y, r * 1.05, 0, 6.29); ctx.fill();          // soft socket
      ctx.fillStyle = dead ? "#8a8a8a" : "#0f151b";
      ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, 6.29); ctx.fill();           // iris
      if (!dead) { ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.beginPath(); ctx.arc(x - r * 0.28, y - r * 0.28, r * 0.24, 0, 6.29); ctx.fill(); } // catchlight
      ctx.restore();
    }
    function tri(ax, ay, bx, by, cx, cy) { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill(); }

    function drawTetra(L, now, a, dead) {
      var bh = L * 0.42, wag = dead ? 0 : Math.sin(a.swim + a.phase) * bh * (0.14 + a.eff * 0.5);
      // caudal + dorsal fins
      ctx.fillStyle = "rgba(200,225,235,0.62)";
      tri(-L * 0.42, 0, -L * 0.62, -bh * 0.6 + wag, -L * 0.62, bh * 0.6 + wag);
      // body: translucent silver
      var g = ctx.createLinearGradient(0, -bh, 0, bh);
      g.addColorStop(0, "#2a4a63"); g.addColorStop(0.5, "#bcd6e4"); g.addColorStop(1, "#eef6fa");
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, L * 0.44, bh, 0, 0, 6.29); ctx.fill();
      // neon blue stripe (nose -> adipose) and red stripe (mid -> tail)
      ctx.save(); ctx.beginPath(); ctx.ellipse(0, 0, L * 0.44, bh, 0, 0, 6.29); ctx.clip();
      ctx.fillStyle = dead ? "#6a8a9a" : "rgba(74,190,222,0.92)"; // muted neon blue
      ctx.beginPath(); ctx.moveTo(L * 0.3, -bh * 0.16); ctx.lineTo(-L * 0.12, -bh * 0.22); ctx.lineTo(-L * 0.12, bh * 0.04); ctx.lineTo(L * 0.3, bh * 0.08); ctx.closePath(); ctx.fill();
      ctx.fillStyle = dead ? "#9a6a6a" : "rgba(206,86,74,0.9)";   // muted red
      ctx.beginPath(); ctx.moveTo(L * 0.02, bh * 0.05); ctx.lineTo(-L * 0.42, bh * 0.05); ctx.lineTo(-L * 0.42, bh * 0.32); ctx.lineTo(L * 0.02, bh * 0.24); ctx.closePath(); ctx.fill();
      ctx.restore();
      eye(L * 0.32, -bh * 0.12, Math.max(1.6, L * 0.05), dead);
    }

    function drawCory(L, now, a, dead) {
      var bh = L * 0.4;
      // flat-bottomed olive body
      ctx.fillStyle = "rgba(120,120,90,0.5)"; tri(-L * 0.4, 0, -L * 0.6, -bh * 0.5, -L * 0.6, bh * 0.3); // tail
      var g = ctx.createLinearGradient(0, -bh, 0, bh);
      g.addColorStop(0, "#8f8256"); g.addColorStop(0.6, "#b7a986"); g.addColorStop(1, "#e3dcc7");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(L * 0.46, 0);
      ctx.quadraticCurveTo(L * 0.1, -bh, -L * 0.4, -bh * 0.4);
      ctx.quadraticCurveTo(-L * 0.5, 0, -L * 0.4, bh * 0.34);
      ctx.quadraticCurveTo(L * 0.1, bh * 0.5, L * 0.46, 0); ctx.closePath(); ctx.fill();
      // dorsal
      ctx.fillStyle = "#6d5f42"; tri(-L * 0.02, -bh * 0.5, L * 0.14, -bh * 1.05, L * 0.24, -bh * 0.42);
      // dark lateral mottle
      ctx.fillStyle = "rgba(70,60,40,0.6)"; ctx.beginPath(); ctx.ellipse(-L * 0.05, -bh * 0.1, L * 0.22, bh * 0.16, 0, 0, 6.29); ctx.fill();
      // barbels
      ctx.strokeStyle = "#7a6f52"; ctx.lineWidth = 1 * scale;
      ctx.beginPath(); ctx.moveTo(L * 0.44, bh * 0.1); ctx.lineTo(L * 0.5, bh * 0.34); ctx.stroke();
      eye(L * 0.3, -bh * 0.14, Math.max(1.5, L * 0.05), dead);
    }

    function drawClown(L, now, a, dead) {
      var bh = L * 0.5, wag = dead ? 0 : Math.sin(a.swim + a.phase) * bh * (0.08 + a.eff * 0.3);
      // soft translucent fins (no hard black margins)
      ctx.fillStyle = "rgba(233,120,44,0.9)";
      tri(-L * 0.34, 0, -L * 0.56, -bh * 0.5 + wag, -L * 0.56, bh * 0.5 + wag);
      ctx.beginPath(); ctx.ellipse(L * 0.02, bh * 0.42, L * 0.12, bh * 0.2, 0.4, 0, 6.29); ctx.fill(); // pectoral
      // body: warm gradient, darker back to lit belly
      var g = ctx.createLinearGradient(0, -bh, 0, bh);
      g.addColorStop(0, "#d8631a"); g.addColorStop(0.5, "#f2822c"); g.addColorStop(1, "#ffa658");
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, L * 0.42, bh, 0, 0, 6.29); ctx.fill();
      // three white bands with soft (not hard black) edges + volume shading
      ctx.save(); ctx.beginPath(); ctx.ellipse(0, 0, L * 0.42, bh, 0, 0, 6.29); ctx.clip();
      var bands = [{ c: L * 0.24, w: L * 0.09 }, { c: -L * 0.02, w: L * 0.13 }, { c: -L * 0.3, w: L * 0.07 }];
      for (var i = 0; i < bands.length; i++) {
        var bd = bands[i];
        ctx.fillStyle = "rgba(58,32,16,0.32)"; ctx.fillRect(bd.c - bd.w / 2 - 1.2 * scale, -bh, bd.w + 2.4 * scale, bh * 2);
        ctx.fillStyle = dead ? "#d8d2c8" : "#fbeede"; ctx.fillRect(bd.c - bd.w / 2, -bh, bd.w, bh * 2);
      }
      var sh = ctx.createLinearGradient(0, -bh, 0, bh);
      sh.addColorStop(0, "rgba(90,40,10,0.32)"); sh.addColorStop(0.4, "rgba(90,40,10,0)"); sh.addColorStop(1, "rgba(255,240,210,0.16)");
      ctx.fillStyle = sh; ctx.fillRect(-L * 0.42, -bh, L * 0.84, bh * 2);
      ctx.restore();
      eye(L * 0.3, -bh * 0.16, Math.max(2, L * 0.055), dead);
    }

    function drawGoby(L, now, a, dead) {
      var bh = L * 0.34, wag = dead ? 0 : Math.sin(a.swim + a.phase) * bh * (0.14 + a.eff * 0.5);
      // elongate yellow body
      ctx.fillStyle = "rgba(255,210,62,0.6)"; tri(-L * 0.42, 0, -L * 0.6, -bh * 0.7 + wag, -L * 0.6, bh * 0.7 + wag);
      var g = ctx.createLinearGradient(0, -bh, 0, bh);
      g.addColorStop(0, "#ffdc4a"); g.addColorStop(1, "#f0a81f");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(L * 0.48, 0);
      ctx.quadraticCurveTo(0, -bh, -L * 0.44, -bh * 0.5);
      ctx.quadraticCurveTo(-L * 0.5, 0, -L * 0.44, bh * 0.5);
      ctx.quadraticCurveTo(0, bh, L * 0.48, 0); ctx.closePath(); ctx.fill();
      // tall first dorsal (watchman perch look)
      ctx.fillStyle = "rgba(255,225,120,0.85)"; tri(L * 0.06, -bh * 0.7, L * 0.2, -bh * 1.5, L * 0.3, -bh * 0.6);
      // pale cheek spots
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath(); ctx.arc(L * 0.24, bh * 0.1, L * 0.03, 0, 6.29); ctx.fill();
      // big high-set eyes
      eye(L * 0.34, -bh * 0.34, Math.max(2, L * 0.07), dead);
    }

    function drawShrimp(L, now, a, dead) {
      var bh = L * 0.4;
      var flick = dead ? 0 : Math.sin(a.swim + a.phase) * (0.4 + a.eff * 2.2) * scale;
      // banded body (segments), red/white tiger
      ctx.save();
      var segs = 6;
      for (var i = 0; i < segs; i++) {
        var sx = L * 0.3 - i * L * 0.11;
        ctx.fillStyle = i % 2 ? "#f2e3cf" : "#d94f3d";
        ctx.beginPath(); ctx.ellipse(sx, 0, L * 0.1, bh * (0.9 - i * 0.08), 0, 0, 6.29); ctx.fill();
      }
      // tail fan
      ctx.fillStyle = "#d94f3d"; tri(-L * 0.34, 0, -L * 0.5, -bh * 0.7, -L * 0.5, bh * 0.7);
      // one oversized snapping claw
      ctx.fillStyle = "#e56a52";
      ctx.beginPath(); ctx.ellipse(L * 0.34, bh * 0.3, L * 0.16, bh * 0.5, 0.3, 0, 6.29); ctx.fill();
      ctx.fillStyle = "#c23c2c"; ctx.fillRect(L * 0.42, bh * 0.1, L * 0.14, 2 * scale);
      // antennae (contact with goby)
      ctx.strokeStyle = "#f2e3cf"; ctx.lineWidth = 1 * scale;
      ctx.beginPath(); ctx.moveTo(L * 0.36, -bh * 0.2); ctx.lineTo(L * 0.62 + flick, -bh * 0.7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(L * 0.36, -bh * 0.1); ctx.lineTo(L * 0.6 - flick, -bh * 0.3); ctx.stroke();
      eye(L * 0.3, -bh * 0.28, Math.max(1.2, L * 0.04), dead);
      ctx.restore();
    }

    function drawShark(L, now, a, dead) {
      var bh = L * 0.24, undo = dead ? 0 : Math.sin(a.swim + a.phase) * bh * (0.2 + a.eff * 0.6);
      // long benthic body
      ctx.fillStyle = "rgba(150,120,80,0.6)"; tri(-L * 0.44, undo, -L * 0.6, -bh * 0.9 + undo, -L * 0.58, bh * 0.5 + undo); // caudal
      var g = ctx.createLinearGradient(0, -bh, 0, bh);
      g.addColorStop(0, "#b89a68"); g.addColorStop(0.6, "#a98b5f"); g.addColorStop(1, "#e0d3b4");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(L * 0.5, 0);
      ctx.quadraticCurveTo(L * 0.2, -bh, -L * 0.1, -bh * 0.7 + undo * 0.4);
      ctx.quadraticCurveTo(-L * 0.44, -bh * 0.3 + undo, -L * 0.5, undo);
      ctx.quadraticCurveTo(-L * 0.3, bh * 0.6, 0, bh * 0.7);
      ctx.quadraticCurveTo(L * 0.3, bh * 0.7, L * 0.5, 0); ctx.closePath(); ctx.fill();
      // pectoral + pelvic "walking" fins
      ctx.fillStyle = "#9c8253";
      var step = dead ? 0 : Math.sin(a.swim * 0.8 + a.phase) * bh * (0.15 + a.eff * 0.45);
      tri(L * 0.16, bh * 0.5, L * 0.28, bh * 1.1 + step, L * 0.02, bh * 0.7); // pectoral
      tri(-L * 0.12, bh * 0.55, -L * 0.02, bh * 1.05 - step, -L * 0.24, bh * 0.7); // pelvic
      // dorsal fins set far back
      tri(-L * 0.05, -bh * 0.7, L * 0.05, -bh * 1.2, L * 0.14, -bh * 0.6);
      // spotted pattern + signature epaulette ocellus behind pectoral
      ctx.save(); ctx.beginPath();
      ctx.moveTo(L * 0.5, 0); ctx.quadraticCurveTo(L * 0.2, -bh, -L * 0.1, -bh * 0.7);
      ctx.quadraticCurveTo(-L * 0.44, -bh * 0.3, -L * 0.5, 0);
      ctx.quadraticCurveTo(-L * 0.3, bh * 0.6, 0, bh * 0.7);
      ctx.quadraticCurveTo(L * 0.3, bh * 0.7, L * 0.5, 0); ctx.closePath(); ctx.clip();
      ctx.fillStyle = "rgba(70,52,30,0.6)";
      for (var i = 0; i < 22; i++) {
        var sx = -L * 0.45 + seeded("shk", i + "x") * L * 0.9, sy = -bh * 0.7 + seeded("shk", i + "y") * bh * 1.4;
        ctx.beginPath(); ctx.arc(sx, sy, (1.4 + seeded("shk", i) * 1.6) * scale, 0, 6.29); ctx.fill();
      }
      // epaulette: black ring with pale center behind the pectoral fin
      var ox = L * 0.06, oy = -bh * 0.05;
      ctx.strokeStyle = "rgba(32,20,10,0.6)"; ctx.lineWidth = 2 * scale; ctx.beginPath(); ctx.arc(ox, oy, bh * 0.5, 0, 6.29); ctx.stroke();
      ctx.fillStyle = "rgba(60,44,24,0.5)"; ctx.beginPath(); ctx.arc(ox, oy, bh * 0.34, 0, 6.29); ctx.fill();
      ctx.restore();
      eye(L * 0.38, -bh * 0.25, Math.max(1.8, L * 0.03), dead);
    }

    function drawGeneric(L, now, a, dead) {
      var bh = L * 0.46, wag = dead ? 0 : Math.sin(a.swim + a.phase) * bh * (0.12 + a.eff * 0.45);
      ctx.fillStyle = "#5a86a8"; tri(-L * 0.4, 0, -L * 0.62, -bh * 0.5 + wag, -L * 0.62, bh * 0.5 + wag);
      var g = ctx.createLinearGradient(0, -bh, 0, bh);
      g.addColorStop(0, "#6fa0c2"); g.addColorStop(1, "#cfe2ee");
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, L * 0.46, bh, 0, 0, 6.29); ctx.fill();
      eye(L * 0.3, -bh * 0.14, Math.max(1.8, L * 0.06), dead);
    }

    /* ------------------------------- fry --------------------------------- */
    function drawFry(view, pal, now) {
      var n = Math.min(view.fry, 40);
      var cover = view.habitat === "marine" ? hostAnchor() : { x: 0.6, y: SUB_TOP - 0.16 };
      ctx.save();
      for (var i = 0; i < n; i++) {
        var fx = clamp01(cover.x + (seeded("fry", i + "x") - 0.5) * 0.28 + (reduced ? 0 : Math.sin(now * 0.003 + i) * 0.01)) * cssW;
        var fy = clamp01(cover.y - 0.04 + (seeded("fry", i + "y") - 0.5) * 0.16) * cssH;
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = "#dfeef4";
        ctx.beginPath(); ctx.ellipse(fx, fy, 2.4 * scale, 1.1 * scale, 0, 0, 6.29); ctx.fill();
        ctx.fillStyle = "#12161c"; ctx.beginPath(); ctx.arc(fx + 1.4 * scale, fy, 0.8 * scale, 0, 6.29); ctx.fill();
      }
      ctx.restore();
    }

    /* --------------------------- film overlays --------------------------- */
    function drawHaze(view) {
      var h = view.films.haze; if (h <= 0.02) return;
      var wl = waterlineY(view) * cssH;
      ctx.fillStyle = rgba("#e6eef0", clamp01(h * 0.5));
      ctx.fillRect(0, wl, cssW, cssH - wl);
    }
    function drawGreenFilm(view) {
      var g = view.films.green; if (g <= 0.03) return;
      // green tint on the front glass (back wall + edges heavier)
      var grad = ctx.createLinearGradient(0, 0, cssW, 0);
      grad.addColorStop(0, rgba("#4f8a3a", g * 0.4)); grad.addColorStop(0.5, rgba("#4f8a3a", g * 0.14)); grad.addColorStop(1, rgba("#4f8a3a", g * 0.4));
      ctx.fillStyle = grad; ctx.fillRect(0, 0, cssW, cssH);
    }
    function drawDiatomGlass(view) {
      var d = view.films.diatom; if (d <= 0.03) return;
      // brown film clings to the lower glass band
      var y0 = cssH * (SUB_TOP - 0.18);
      var grad = ctx.createLinearGradient(0, y0, 0, cssH);
      grad.addColorStop(0, rgba("#7a5a2c", 0)); grad.addColorStop(1, rgba("#7a5a2c", d * 0.4));
      ctx.fillStyle = grad; ctx.fillRect(0, y0, cssW, cssH - y0);
    }

    /* --------------------- water surface + level trend ------------------- */
    function drawWaterlineAndTrend(view, pal, now) {
      var wl = waterlineY(view) * cssH;
      // meniscus highlight
      ctx.strokeStyle = rgba(pal.surface || "#bfe9f5", 0.8); ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      for (var x = 0; x <= cssW; x += 16) { var y = wl + (reduced ? 0 : Math.sin(x * 0.05 + now * 0.002) * 1.6 * scale); x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
      ctx.strokeStyle = rgba("#ffffff", 0.25); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, wl + 3 * scale); ctx.lineTo(cssW, wl + 3 * scale); ctx.stroke();

      // trend arrow: explicit sim trend, else derived from recent history
      var tr = view.trend;
      if (tr == null && levelHist.length > 8) tr = view.level - levelHist[Math.max(0, levelHist.length - 30)];
      if (tr == null) tr = 0;
      var dir = tr > 0.002 ? 1 : (tr < -0.002 ? -1 : 0);
      var ax = cssW - 22 * scale, ay = wl + 16 * scale;
      ctx.save();
      ctx.fillStyle = dir < 0 ? CORAL : (dir > 0 ? BLUE : "rgba(120,130,130,0.9)");
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1;
      if (dir === 0) {
        ctx.fillRect(ax - 6 * scale, ay - 1.5 * scale, 12 * scale, 3 * scale);
      } else {
        var s = dir < 0 ? 1 : -1; // down arrow when evaporating
        ctx.beginPath();
        ctx.moveTo(ax, ay + s * 8 * scale);
        ctx.lineTo(ax - 5 * scale, ay - s * 3 * scale);
        ctx.lineTo(ax + 5 * scale, ay - s * 3 * scale);
        ctx.closePath(); ctx.fill();
        ctx.fillRect(ax - 1.6 * scale, ay - s * 8 * scale, 3.2 * scale, 8 * scale);
      }
      ctx.restore();
    }

    /* ---------------------------- selection ------------------------------ */
    function drawSelection(view) {
      if (!view.selected) return;
      for (var i = 0; i < hitTargets.length; i++) {
        var t = hitTargets[i];
        if (t.id !== view.selected) continue;
        ctx.save();
        ctx.strokeStyle = BLUE; ctx.lineWidth = 2.5 * scale;
        ctx.setLineDash([6 * scale, 5 * scale]);
        ctx.beginPath(); ctx.arc(t.x, t.y, t.r + 6 * scale, 0, 6.29); ctx.stroke();
        ctx.setLineDash([]); ctx.strokeStyle = rgba("#ffffff", 0.6); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(t.x, t.y, t.r + 6 * scale, 0, 6.29); ctx.stroke();
        ctx.restore();
        break;
      }
    }

    /* ------------------------------- glass ------------------------------- */
    function drawGlass(view) {
      // soft inner vignette + top-left sheen for a real-tank feel
      var vg = ctx.createRadialGradient(cssW * 0.5, cssH * 0.5, Math.min(cssW, cssH) * 0.3, cssW * 0.5, cssH * 0.5, Math.max(cssW, cssH) * 0.7);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.28)");
      ctx.fillStyle = vg; ctx.fillRect(0, 0, cssW, cssH);
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(cssW * 0.28, 0); ctx.lineTo(0, cssH * 0.5); ctx.closePath(); ctx.fill();
    }

    /* ============================ animation ============================== */
    function clock() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }
    function frame(ts) {
      if (destroyed) return;
      rafId = raf(frame);
      var gap = reduced ? 380 : 12;
      if (ts - lastRenderAt >= gap) render(ts);
    }
    function raf(fn) {
      return (typeof requestAnimationFrame === "function") ? requestAnimationFrame(fn)
        : (typeof setTimeout === "function") ? setTimeout(function () { fn(clock()); }, 16) : 0;
    }
    function caf(id) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
      else if (typeof clearTimeout === "function") clearTimeout(id);
    }
    var drawScheduled = false;
    function requestDraw() {
      if (drawScheduled || destroyed) return;
      drawScheduled = true;
      raf(function () { drawScheduled = false; render(clock()); });
    }

    // Public draw(): force one immediate frame (host may drive its own loop).
    function draw(arg) {
      if (destroyed) return;
      var now = (typeof arg === "number" && isFinite(arg)) ? arg : clock();
      render(now);
    }

    /* ============================== pointer ============================= */
    function onPointer(e) {
      if (destroyed) return;
      var r = canvas.getBoundingClientRect();
      var cx = (e.clientX != null ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0)) - r.left;
      var cy = (e.clientY != null ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0)) - r.top;
      // hit test nearest entity
      var best = null, bd = Infinity;
      for (var i = 0; i < hitTargets.length; i++) {
        var t = hitTargets[i], d = Math.hypot(cx - t.x, cy - t.y);
        if (d <= t.r && d < bd) { bd = d; best = t; }
      }
      if (best) { send({ type: "SELECT_ENTITY", id: best.id }); }
      else {
        var nx = clamp01((r.width ? cx / r.width : 0));
        var ny = clamp01((r.height ? cy / r.height : 0));
        send({ type: "FEED_AT", x: nx, y: ny });
      }
      requestDraw();
    }

    /* ============================== wiring ============================== */
    canvas.addEventListener("pointerdown", onPointer);
    var ro = null;
    if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(function () { resize(); }); ro.observe(canvas); }
    else if (typeof window !== "undefined") window.addEventListener("resize", resize);

    preloadPlates();
    preloadSprites();
    resize();
    rafId = raf(frame);

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      caf(rafId);
      canvas.removeEventListener("pointerdown", onPointer);
      if (ro) { try { ro.disconnect(); } catch (e) {} }
      else if (typeof window !== "undefined") window.removeEventListener("resize", resize);
      if (reducedMQ) { try { reducedMQ.removeEventListener("change", onReducedChange); } catch (e) { try { reducedMQ.removeListener(onReducedChange); } catch (e2) {} } }
      actors = Object.create(null);
    }

    return { resize: resize, draw: draw, destroy: destroy };
  };
})();
