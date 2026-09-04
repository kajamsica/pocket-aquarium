/* Pocket Aquarium Ecosystem v4 — immutable domain catalog + purchase validation (FTG4-01B).
   No imports, network, assets, or dependencies. Extends the single global namespace `window.PA`.
   Load order: data.js -> sim.js -> render.js -> app.js. Node tests set `global.window = global`
   before require() so this IIFE attaches PA to the shared global. See docs/ECOLOGY_MODEL.md. */
(function (global) {
  "use strict";
  var PA = (global.PA = global.PA || {});

  /* ------------------------------------------------------------------ *
   * Enumerations and named action types.
   * Action types are strings so state/actions stay serializable and
   * renderer/app safe. `dispatch` (sim.js) consumes {type, ...payload}.
   * ------------------------------------------------------------------ */
  var ACTIONS = {
    CHOOSE_HABITAT: "CHOOSE_HABITAT",       // {habitat}
    // ---- cycle setup inputs ----
    SETUP_FILL: "SETUP_FILL",               // fill+dechlorinate (fresh) OR mix saltwater (reef)
    SETUP_LIFE_SUPPORT: "SETUP_LIFE_SUPPORT", // start filter/heater/flow ({on})
    ADD_AMMONIA_SOURCE: "ADD_AMMONIA_SOURCE", // start fishless cycle ({on})
    INOCULATE_BACTERIA: "INOCULATE_BACTERIA", // seed nitrifiers
    // ---- water actions ----
    WATER_TEST: "WATER_TEST",               // {param?} reveal parameter freshness; whole panel if no param
    WATER_CHANGE: "WATER_CHANGE",           // {fraction}
    WATER_TOP_OFF: "WATER_TOP_OFF",         // restore evaporated volume with freshwater
    // ---- automation (installed physical equipment) ----
    SET_FEEDER: "SET_FEEDER",               // {enabled?, intervalDays?, portionsPerDispense?} configure/toggle auto feeder
    REFILL_FEEDER: "REFILL_FEEDER",         // refill the auto-feeder hopper (costs credits)
    REFILL_RESERVOIR: "REFILL_RESERVOIR",   // refill the finite freshwater ATO reservoir
    // ---- purchases ----
    PURCHASE_EQUIPMENT: "PURCHASE_EQUIPMENT", // {category, levelId}
    PURCHASE_TIER: "PURCHASE_TIER",           // {tier}
    PURCHASE_LIVESTOCK: "PURCHASE_LIVESTOCK", // {species, count?, acceptRisk?}
    SELL_LIVESTOCK: "SELL_LIVESTOCK",         // {ids}
    PURCHASE_CORAL: "PURCHASE_CORAL",         // {coral}
    SEED_MICROFAUNA: "SEED_MICROFAUNA",       // {culture} pods / infusoria culture
    // ---- interaction ----
    FEED: "FEED",                           // {x, y} normalized [0,1] tank coordinates
    CONSUME_FOOD: "CONSUME_FOOD",           // {foodId, eaterId} after renderer-observed contact
    SELECT_ENTITY: "SELECT_ENTITY",         // {entityType, id} | {id:null} to clear
    REMOVE_DEAD: "REMOVE_DEAD",             // {id} remove decaying biomass
    RENAME_LIVESTOCK: "RENAME_LIVESTOCK",   // {id, name} custom name for one resident; empty name restores the species name
    // ---- time ----
    SET_SPEED: "SET_SPEED",                 // {speed: 0|1|4|8}
    TOGGLE_PAUSE: "TOGGLE_PAUSE"            // pause <-> last speed
  };

  var CYCLE_STAGES = [
    "Setup", "Ammonia oxidation", "Nitrite oxidation",
    "Nitrate present", "Cycled", "Young biome", "Mature biome"
  ];

  /* ------------------------------------------------------------------ *
   * Habitats.
   * ------------------------------------------------------------------ */
  var HABITATS = {
    amazon: {
      id: "amazon",
      name: "Amazonian blackwater margin",
      waterType: "fresh",
      blurb: "Tannin-tinted soft acidic water, leaf litter and roots. Schooling tetras and cory.",
      salinityTarget: 0,
      startTier: "nano20",
      // freshwater-visible chemistry set (no reef-only salt chemistry)
      params: ["level", "tempC", "pH", "ammonia", "nitrite", "nitrate", "oxygen", "hardness", "tannin"]
    },
    reef: {
      id: "reef",
      name: "Indo-Pacific sheltered lagoon reef",
      waterType: "salt",
      blurb: "Aragonite sand and live rock. Clownfish, coral, and reef chemistry to balance.",
      salinityTarget: 35,
      startTier: "nano20",
      params: ["level", "tempC", "pH", "ammonia", "nitrite", "nitrate", "oxygen",
        "salinity", "alkalinity", "calcium", "magnesium", "phosphate", "par", "flow"]
    }
  };

  /* ------------------------------------------------------------------ *
   * Parameter target bands (broad, documented — not a controller).
   * severity is derived in sim.js from these bands.
   * ------------------------------------------------------------------ */
  var PARAMS = {
    level:     { label: "Water level", unit: "%", target: 100, good: [92, 100], warn: [80, 100] },
    tempC:     { label: "Temperature", unit: "°C", target: 26, good: [24, 28], warn: [22, 30] },
    oxygen:    { label: "Oxygen", unit: "mg/L", target: 7.2, good: [6, 9], warn: [4.5, 12] },
    ammonia:   { label: "Ammonia", unit: "mg/L", target: 0, good: [0, 0.25], warn: [0, 0.5], toxic: 0.5 },
    nitrite:   { label: "Nitrite", unit: "mg/L", target: 0, good: [0, 0.25], warn: [0, 0.5], toxic: 0.5 },
    // habitat-specific bands override generic below when present
    fresh: {
      pH:       { label: "pH", unit: "", target: 6.4, good: [6.0, 7.0], warn: [5.5, 7.6] },
      nitrate:  { label: "Nitrate", unit: "mg/L", target: 10, good: [0, 40], warn: [0, 80] },
      hardness: { label: "Hardness", unit: "dGH", target: 3, good: [1, 6], warn: [0, 10] },
      tannin:   { label: "Tannin", unit: "idx", target: 0.6, good: [0.3, 1], warn: [0, 1] }
    },
    reef: {
      pH:         { label: "pH", unit: "", target: 8.2, good: [8.0, 8.4], warn: [7.8, 8.5] },
      nitrate:    { label: "Nitrate", unit: "mg/L", target: 5, good: [0, 15], warn: [0, 40] },
      salinity:   { label: "Salinity", unit: "ppt", target: 35, good: [33, 36], warn: [30, 38] },
      alkalinity: { label: "Alkalinity", unit: "dKH", target: 8.5, good: [7, 11], warn: [6, 13] },
      calcium:    { label: "Calcium", unit: "ppm", target: 420, good: [380, 460], warn: [340, 500] },
      magnesium:  { label: "Magnesium", unit: "ppm", target: 1300, good: [1250, 1400], warn: [1150, 1500] },
      phosphate:  { label: "Phosphate", unit: "ppm", target: 0.05, good: [0, 0.1], warn: [0, 0.25] },
      par:        { label: "PAR", unit: "µmol", target: 120, good: [40, 220], warn: [20, 350] },
      flow:       { label: "Flow", unit: "idx", target: 0.55, good: [0.3, 0.8], warn: [0.15, 1] }
    }
  };

  /* ------------------------------------------------------------------ *
   * Tank tiers. footprintCm2 = usable bottom area (benthic gate).
   * biofilterBase scales nitrifier carrying capacity / bioload capacity.
   * ------------------------------------------------------------------ */
  var TIER_ORDER = ["nano20", "mid151", "large284", "xl757"];
  var TIERS = {
    nano20:   { id: "nano20",   name: "20 gal long (75 L)",  volumeL: 75,  footprintCm2: 1800,  biofilterBase: 1.0, hardscapeSlots: 2, bioloadCap: 10, price: 0 },
    mid151:   { id: "mid151",   name: "40 gal (151 L)",      volumeL: 151, footprintCm2: 3600,  biofilterBase: 1.6, hardscapeSlots: 4, bioloadCap: 22, price: 220 },
    large284: { id: "large284", name: "75 gal (284 L)",      volumeL: 284, footprintCm2: 6000,  biofilterBase: 2.4, hardscapeSlots: 6, bioloadCap: 42, price: 480 },
    xl757:    { id: "xl757",    name: "200 gal (757 L)",     volumeL: 757, footprintCm2: 12000, biofilterBase: 4.0, hardscapeSlots: 10, bioloadCap: 120, price: 1200 }
  };

  /* ------------------------------------------------------------------ *
   * Equipment. Ordered levels; each level carries the coefficient deltas
   * consumed by sim.js so every upgrade is functional, not cosmetic.
   *   filter.biofilterSurface -> nitrifier capacity
   *   heater.tempPull/stability -> temperature stability toward target
   *   circulation.flow/oxygen/deadzone -> O2 + cyano dead-zone pressure
   *   light.parCeiling/photoperiod -> PAR available to corals
   *   skimmer.organicExport -> dissolved-organic (ammonia precursor + nitrate) export
   *   refugium.nitrateExport/podCapacity -> nitrate export + pod carrying capacity
   *   ato.autoTopOff -> replaces evaporated volume with freshwater, stabilizes salinity
   * ------------------------------------------------------------------ */
  var EQUIPMENT = {
    filter: {
      category: "filter", label: "Filtration",
      levels: [
        { id: "sponge",   name: "Sponge filter",  price: 0,   biofilterSurface: 1.0, flow: 0.10 },
        { id: "hob",      name: "HOB power filter", price: 60,  biofilterSurface: 1.9, flow: 0.25 },
        { id: "canister", name: "Canister filter", price: 180, biofilterSurface: 3.1, flow: 0.40 }
      ]
    },
    heater: {
      category: "heater", label: "Heater / controller",
      levels: [
        { id: "none",       name: "No heater",           price: 0,   target: 24, tempPull: 0.05, stability: 0.15 },
        { id: "basic",      name: "Preset heater",       price: 40,  target: 26, tempPull: 0.55, stability: 0.7 },
        { id: "controller", name: "Controller + heater", price: 120, target: 26, tempPull: 0.85, stability: 0.95 }
      ]
    },
    circulation: {
      category: "circulation", label: "Circulation",
      levels: [
        { id: "none",      name: "No powerhead", price: 0,   flow: 0.08, oxygen: 0.30, deadzone: 0.90 },
        { id: "powerhead", name: "Powerhead",    price: 50,  flow: 0.50, oxygen: 0.72, deadzone: 0.40 },
        { id: "gyre",      name: "Gyre pump",    price: 140, flow: 0.90, oxygen: 0.96, deadzone: 0.10 }
      ]
    },
    light: {
      category: "light", label: "Lighting / PAR",
      levels: [
        { id: "basic",   name: "Basic strip",        price: 0,   parCeiling: 60,  photoperiodControl: false },
        { id: "led",     name: "Reef/plant LED",     price: 90,  parCeiling: 160, photoperiodControl: true },
        { id: "pro_led", name: "Programmable LED",   price: 220, parCeiling: 340, photoperiodControl: true }
      ]
    },
    skimmer: {
      category: "skimmer", label: "Protein skimmer", reefOnly: true,
      levels: [
        { id: "none", name: "No skimmer",        price: 0,   organicExport: 0.0 },
        { id: "hob",  name: "HOB skimmer",       price: 80,  organicExport: 0.4 },
        { id: "cone", name: "Cone skimmer",      price: 200, organicExport: 0.8 }
      ]
    },
    refugium: {
      category: "refugium", label: "Refugium / planted refuge",
      levels: [
        { id: "none",     name: "None",                     price: 0,   nitrateExport: 0.05, podCapacity: 0.25 },
        { id: "refugium", name: "Refugium (macroalgae/plants)", price: 130, nitrateExport: 0.5, podCapacity: 1.0 }
      ]
    },
    ato: {
      category: "ato", label: "Auto top-off (ATO)",
      levels: [
        { id: "none", name: "Manual top-off", price: 0,  autoTopOff: false, reservoirCapacityL: 0 },
        { id: "ato",  name: "Freshwater ATO", price: 70, autoTopOff: true,  reservoirCapacityL: 90 }
      ]
    },
    feeder: {
      category: "feeder", label: "Auto feeder",
      levels: [
        { id: "none", name: "Hand feeding",              price: 0,  autoFeed: false, hopperCapacity: 0 },
        { id: "auto", name: "Programmable auto feeder",  price: 55, autoFeed: true,  hopperCapacity: 28 }
      ]
    }
  };

  /* ------------------------------------------------------------------ *
   * Livestock catalog. Every rule needed by validatePurchase lives here.
   *   layer: bottom|mid|top; territoriality 0..1; prey/predator flags.
   *   preysOn: list of prey-tags this animal will eat.
   *   preyTags: tags describing this animal as prey.
   *   requiredFeature: hardscape/system feature the tank must offer.
   *   breeding: species-specific reproduction gate (see sim.js).
   * ------------------------------------------------------------------ */
  var SPECIES = {
    neon_tetra: {
      id: "neon_tetra", kind: "fish", name: "Neon tetra", sci: "Paracheirodon innesi",
      waterType: "fresh", habitat: "amazon", nativeHabitat: "Amazon black/clearwater streams",
      adultSizeCm: 3.5, price: 6, bioload: 1.0,
      minTier: "nano20", minVolumeL: 45, minFootprintCm2: 1400,
      socialMin: 5, socialMax: 30, layer: "mid", territoriality: 0.05,
      predator: false, preysOn: [], preyTags: ["nano_fish"],
      coralSafe: true, invertSafe: true, requiredFeature: null, expert: false,
      diet: "micro-omnivore", feedIntervalDays: 0.9, mealSize: 0.85, metabolic: 1.0,
      maturityDays: 18,
      breeding: {
        type: "egg-scatter", needsAdults: 2, socialMin: 6,
        water: { pHMax: 6.8, hardnessMax: 5, dimLight: true },
        cover: true, incubationDays: 1.2, frySurvivalFeature: "infusoria",
        note: "Soft acidic dim water triggers spawning; eggs are light-sensitive and hatch fast."
      }
    },
    pygmy_cory: {
      id: "pygmy_cory", kind: "fish", name: "Pygmy corydoras", sci: "Corydoras pygmaeus",
      waterType: "fresh", habitat: "amazon", nativeHabitat: "Amazon basin, soft substrate",
      adultSizeCm: 3.0, price: 7, bioload: 0.9,
      minTier: "mid151", minVolumeL: 90, minFootprintCm2: 3000,
      socialMin: 6, socialMax: 24, layer: "bottom", territoriality: 0.05,
      predator: false, preysOn: [], preyTags: ["nano_fish"],
      coralSafe: true, invertSafe: true, requiredFeature: "fine_sand", expert: false,
      diet: "benthic-omnivore", feedIntervalDays: 1.0, mealSize: 0.8, metabolic: 0.9,
      maturityDays: 24, breeding: null
    },
    ocellaris: {
      id: "ocellaris", kind: "fish", name: "Ocellaris clownfish", sci: "Amphiprion ocellaris",
      waterType: "salt", habitat: "reef", nativeHabitat: "Indo-Pacific reef lagoons, host anemones",
      adultSizeCm: 8, price: 28, bioload: 3.0,
      minTier: "nano20", minVolumeL: 60, minFootprintCm2: 1500,
      socialMin: 1, socialMax: 2, layer: "mid", territoriality: 0.4,
      predator: false, preysOn: [], preyTags: ["small_fish"],
      coralSafe: true, invertSafe: true, requiredFeature: null, expert: false,
      diet: "omnivore", feedIntervalDays: 1.0, mealSize: 0.85, metabolic: 1.4,
      maturityDays: 30,
      breeding: {
        type: "pair-substrate", needsAdults: 2, socialMin: 2,
        water: { stable: true },
        cover: true, hostFeature: "host",
        pairBondDays: 3, incubationDays: 7, tendedBy: "male",
        frySurvivalFeature: "pods",
        note: "Protandrous pair: largest becomes female. Male tends adhesive eggs 6-8 days."
      }
    },
    watchman_goby: {
      id: "watchman_goby", kind: "fish", name: "Yellow watchman goby", sci: "Cryptocentrus cinctus",
      waterType: "salt", habitat: "reef", nativeHabitat: "Indo-Pacific sandy lagoon burrows",
      adultSizeCm: 8, price: 30, bioload: 2.6,
      minTier: "nano20", minVolumeL: 75, minFootprintCm2: 1500,
      socialMin: 1, socialMax: 2, layer: "bottom", territoriality: 0.5,
      predator: false, preysOn: [], preyTags: ["small_fish"],
      coralSafe: true, invertSafe: true, requiredFeature: "sand_burrow", expert: false,
      diet: "carnivore", feedIntervalDays: 1.0, mealSize: 0.8, metabolic: 1.2,
      maturityDays: 30, symbiosisWith: "pistol_shrimp", breeding: null
    },
    pistol_shrimp: {
      id: "pistol_shrimp", kind: "invert", name: "Tiger pistol shrimp", sci: "Alpheus bellulus",
      waterType: "salt", habitat: "reef", nativeHabitat: "Indo-Pacific sand burrows",
      adultSizeCm: 5, price: 22, bioload: 0.8,
      minTier: "nano20", minVolumeL: 75, minFootprintCm2: 1500,
      socialMin: 1, socialMax: 2, layer: "bottom", territoriality: 0.3,
      predator: false, preysOn: [], preyTags: ["invert"],
      coralSafe: true, invertSafe: true, requiredFeature: "sand_burrow", expert: false,
      diet: "detritivore", feedIntervalDays: 1.4, mealSize: 0.7, metabolic: 0.6,
      maturityDays: 20, symbiosisWith: "watchman_goby", breeding: null
    },
    epaulette_shark: {
      id: "epaulette_shark", kind: "fish", name: "Epaulette shark", sci: "Hemiscyllium ocellatum",
      waterType: "salt", habitat: "reef", nativeHabitat: "Great Barrier Reef benthic flats",
      adultSizeCm: 90, price: 900, bioload: 40,
      minTier: "xl757", minVolumeL: 757, minFootprintCm2: 10000,
      socialMin: 1, socialMax: 1, layer: "bottom", territoriality: 0.6,
      predator: true, preysOn: ["nano_fish", "small_fish", "invert"], preyTags: [],
      coralSafe: true, invertSafe: false, requiredFeature: "deep_sand", expert: true,
      needsStrongFiltration: true,
      diet: "benthic-predator", feedIntervalDays: 2.5, mealSize: 0.9, metabolic: 2.0,
      maturityDays: 120, breeding: null,
      teachNote: "An epaulette shark is an expert-only benthic predator that outgrows nano tanks; it needs the 757 L tier, deep sand, and strong filtration and will hunt nano fish and inverts."
    },
    /* Remaining accepted saltwater fish (runtime-acceptance.v1.json, category "fish").
       Husbandry is authored conservatively against published adult sizes and the
       recommended-minimum display volumes: every value is consumed by the existing
       validatePurchase gates and sim.js loops — no new fields, features, or logic.
       `diet` is behavioural: "herbivore" grazers add no microfauna predation pressure
       (sim.js stepMicrofauna), unlike the carnivore/benthic-omnivore micropredators.
       `breeding` is null throughout because sim.js only drives the clown and tetra
       projects; a breeding block here would promise reproduction the sim never runs. */
    banggai_cardinal: {
      id: "banggai_cardinal", kind: "fish", name: "Banggai cardinalfish", sci: "Pterapogon kauderni",
      waterType: "salt", habitat: "reef", nativeHabitat: "Banggai Archipelago shallows, sheltering among urchin spines and branching coral",
      adultSizeCm: 8, price: 26, bioload: 2.2,
      minTier: "mid151", minVolumeL: 150, minFootprintCm2: 3500,
      socialMin: 1, socialMax: 6, layer: "mid", territoriality: 0.35,
      predator: false, preysOn: [], preyTags: ["small_fish"],
      coralSafe: true, invertSafe: true, requiredFeature: null, expert: false,
      diet: "carnivore", feedIntervalDays: 1.1, mealSize: 0.8, metabolic: 1.0,
      maturityDays: 35, breeding: null,
      teachNote: "Banggai cardinalfish are hovering group fish: keep one, or introduce five or more at once. A pair or trio reliably produces one dominant fish that harasses the rest."
    },
    black_storm_ocellaris: {
      id: "black_storm_ocellaris", kind: "fish", name: "Black Storm ocellaris", sci: "Amphiprion ocellaris",
      waterType: "salt", habitat: "reef", nativeHabitat: "Captive-bred designer morph of the Indo-Pacific lagoon clownfish",
      adultSizeCm: 11, price: 190, bioload: 3.0,
      minTier: "nano20", minVolumeL: 75, minFootprintCm2: 1500,
      socialMin: 1, socialMax: 2, layer: "mid", territoriality: 0.4,
      predator: false, preysOn: [], preyTags: ["small_fish"],
      coralSafe: true, invertSafe: true, requiredFeature: null, expert: false,
      diet: "omnivore", feedIntervalDays: 1.0, mealSize: 0.85, metabolic: 1.4,
      maturityDays: 30, breeding: null,
      teachNote: "Black Storm is a designer Amphiprion ocellaris, so it fights other clownfish as a conspecific rival: keep one individual or one bonded pair, never a second clown of any morph."
    },
    royal_gramma: {
      id: "royal_gramma", kind: "fish", name: "Royal gramma", sci: "Gramma loreto",
      waterType: "salt", habitat: "reef", nativeHabitat: "Caribbean reef ledges and cave overhangs",
      adultSizeCm: 8, price: 34, bioload: 1.8,
      minTier: "mid151", minVolumeL: 114, minFootprintCm2: 3000,
      socialMin: 1, socialMax: 1, layer: "mid", territoriality: 0.4,
      predator: false, preysOn: [], preyTags: ["small_fish"],
      coralSafe: true, invertSafe: true, requiredFeature: null, expert: false,
      diet: "carnivore", feedIntervalDays: 1.0, mealSize: 0.8, metabolic: 1.1,
      maturityDays: 30, breeding: null
    },
    six_line_wrasse: {
      id: "six_line_wrasse", kind: "fish", name: "Six-line wrasse", sci: "Pseudocheilinus hexataenia",
      waterType: "salt", habitat: "reef", nativeHabitat: "Indo-Pacific reef rubble and dense branching rockwork",
      adultSizeCm: 7.5, price: 32, bioload: 2.0,
      minTier: "mid151", minVolumeL: 114, minFootprintCm2: 3000,
      socialMin: 1, socialMax: 1, layer: "bottom", territoriality: 0.55,
      predator: false, preysOn: [], preyTags: ["small_fish"],
      coralSafe: true, invertSafe: false, requiredFeature: null, expert: false,
      diet: "carnivore", feedIntervalDays: 0.9, mealSize: 0.75, metabolic: 1.3,
      maturityDays: 30, breeding: null,
      teachNote: "A six-line wrasse hunts pods and small shrimp and grows more territorial with age, harassing burrowing gobies and later additions. Add it last, into rock-dense cover."
    },
    diamond_goby: {
      id: "diamond_goby", kind: "fish", name: "Diamond goby", sci: "Valenciennea puellaris",
      waterType: "salt", habitat: "reef", nativeHabitat: "Indo-Pacific sand flats, sifting open substrate beside rock",
      adultSizeCm: 15, price: 28, bioload: 4.0,
      minTier: "mid151", minVolumeL: 150, minFootprintCm2: 3500,
      socialMin: 1, socialMax: 2, layer: "bottom", territoriality: 0.45,
      predator: false, preysOn: [], preyTags: ["small_fish"],
      coralSafe: true, invertSafe: true, requiredFeature: "sand_burrow", expert: false,
      diet: "benthic-omnivore", feedIntervalDays: 0.9, mealSize: 0.8, metabolic: 1.3,
      maturityDays: 45, breeding: null,
      teachNote: "A diamond goby feeds by sifting sand for meiofauna and starves in a young or bare-bottom tank: it needs a broad established sand bed plus deliberate supplemental feeding."
    },
    tomini_tang: {
      id: "tomini_tang", kind: "fish", name: "Tomini tang", sci: "Ctenochaetus tominiensis",
      waterType: "salt", habitat: "reef", nativeHabitat: "Western Pacific reef slopes, combing film algae and detritus",
      adultSizeCm: 15, price: 70, bioload: 6.5,
      minTier: "large284", minVolumeL: 280, minFootprintCm2: 5500,
      socialMin: 1, socialMax: 1, layer: "mid", territoriality: 0.5,
      predator: false, preysOn: [], preyTags: [],
      coralSafe: true, invertSafe: true, requiredFeature: null, expert: false,
      diet: "herbivore", feedIntervalDays: 0.9, mealSize: 0.85, metabolic: 1.35,
      maturityDays: 80, breeding: null,
      teachNote: "The smallest accepted tang still needs 280 L of open swimming length and near-continuous grazing food, and will not share a system with another tang."
    },
    yellow_tang: {
      id: "yellow_tang", kind: "fish", name: "Yellow tang", sci: "Zebrasoma flavescens",
      waterType: "salt", habitat: "reef", nativeHabitat: "Hawaiian and Central Pacific reef flats, grazing turf algae",
      adultSizeCm: 20, price: 130, bioload: 9,
      minTier: "xl757", minVolumeL: 450, minFootprintCm2: 7400,
      socialMin: 1, socialMax: 1, layer: "mid", territoriality: 0.6,
      predator: false, preysOn: [], preyTags: [],
      coralSafe: true, invertSafe: true, requiredFeature: null, expert: false,
      diet: "herbivore", feedIntervalDays: 0.85, mealSize: 0.85, metabolic: 1.45,
      maturityDays: 95, breeding: null,
      teachNote: "A yellow tang grazes all day and reaches 20 cm: it needs 450 L with long open swimming lanes, and a second tang in the same tank means constant fighting."
    },
    purple_tang: {
      id: "purple_tang", kind: "fish", name: "Purple tang", sci: "Zebrasoma xanthurum",
      waterType: "salt", habitat: "reef", nativeHabitat: "Red Sea and Arabian Gulf reefs, grazing exposed rock faces",
      adultSizeCm: 22, price: 260, bioload: 11,
      minTier: "xl757", minVolumeL: 470, minFootprintCm2: 8400,
      socialMin: 1, socialMax: 1, layer: "mid", territoriality: 0.65,
      predator: false, preysOn: [], preyTags: [],
      coralSafe: true, invertSafe: true, requiredFeature: null, expert: false,
      diet: "herbivore", feedIntervalDays: 0.85, mealSize: 0.85, metabolic: 1.5,
      maturityDays: 100, breeding: null,
      teachNote: "Purple tangs are among the most aggressive Zebrasoma: one per system, in at least 470 L, and never alongside another tang."
    },
    gem_tang: {
      id: "gem_tang", kind: "fish", name: "Gem tang", sci: "Zebrasoma gemmatum",
      waterType: "salt", habitat: "reef", nativeHabitat: "Western Indian Ocean rocky reef slopes, Madagascar to Mozambique",
      adultSizeCm: 20, price: 950, bioload: 10,
      minTier: "xl757", minVolumeL: 680, minFootprintCm2: 11000,
      socialMin: 1, socialMax: 1, layer: "mid", territoriality: 0.7,
      predator: false, preysOn: [], preyTags: [],
      coralSafe: true, invertSafe: true, requiredFeature: null, expert: true,
      diet: "herbivore", feedIntervalDays: 0.85, mealSize: 0.85, metabolic: 1.5,
      maturityDays: 100, breeding: null,
      teachNote: "A gem tang is a rare, expensive Zebrasoma that claims the whole water column and tolerates no other tang; buy it only into a mature 680 L reef."
    },
    blue_hippo_tang: {
      id: "blue_hippo_tang", kind: "fish", name: "Blue hippo tang", sci: "Paracanthurus hepatus",
      waterType: "salt", habitat: "reef", nativeHabitat: "Indo-Pacific reef slopes, open water above branching coral",
      adultSizeCm: 25, price: 85, bioload: 12,
      minTier: "xl757", minVolumeL: 680, minFootprintCm2: 11000,
      socialMin: 1, socialMax: 1, layer: "mid", territoriality: 0.55,
      predator: false, preysOn: [], preyTags: [],
      coralSafe: true, invertSafe: true, requiredFeature: null, expert: false,
      diet: "herbivore", feedIntervalDays: 0.85, mealSize: 0.9, metabolic: 1.55,
      maturityDays: 110, breeding: null,
      teachNote: "A blue hippo tang reaches 25 cm and needs a 680 L system with long open swimming lanes; it keeps growing whether or not the tank can hold it."
    }
  };

  /* Accepted specimen packages replace their legacy catalog rows at load time.
     The generated file is loaded first by both index.html and the RLT bridge. */
  var acceptedSpecimens = PA.SPECIMEN_PROFILES || {};
  if (acceptedSpecimens.ocellaris && acceptedSpecimens.ocellaris.schemaVersion === "pocket-aquarium.runtime-specimen/v1") {
    SPECIES.ocellaris = acceptedSpecimens.ocellaris;
  }

  /* ------------------------------------------------------------------ *
   * Corals (reef only). PAR/flow preference and maturity gate.
   * ------------------------------------------------------------------ */
  var CORALS = {
    zoanthid: {
      id: "zoanthid", kind: "coral", name: "Zoanthid colony", sci: "Zoanthus sp.",
      waterType: "salt", habitat: "reef", price: 35,
      par: { min: 40, max: 200, low: 60, high: 150 },
      flow: { min: 0.2, max: 0.8, low: 0.3, high: 0.7 },
      dayFeeder: true, maturityGate: "cycled", stabilityDaysGate: 1,
      calcification: 0.15, startPolyps: 12,
      note: "Hardy first coral; polyps open across a broad PAR band with moderate flow."
    },
    goniopora: {
      id: "goniopora", kind: "coral", name: "Goniopora (flowerpot)", sci: "Goniopora sp.",
      waterType: "salt", habitat: "reef", price: 70,
      par: { min: 50, max: 160, low: 70, high: 110 },
      flow: { min: 0.25, max: 0.6, low: 0.3, high: 0.55 },
      dayFeeder: true, maturityGate: "mature", stabilityDaysGate: 4,
      calcification: 0.35, startPolyps: 24,
      note: "Demands a mature, chemically stable system, target PAR and gentle flow, and regular feeding."
    }
  };

  /* group bundles: buying a school in one action. */
  var BUNDLES = {
    neon_tetra: 6,
    pygmy_cory: 6,
    ocellaris: 1,
    /* Banggai cardinalfish are the only accepted reef fish with a group policy:
       a simultaneous cohort spreads dominance, while a pair or trio does not. */
    banggai_cardinal: 5
  };

  /* Keeper XP is cumulative husbandry experience, never a spendable currency.
     Ordered ranks turn that record into one-time Tank credit rewards. */
  var KEEPER_RANKS = [
    { id: "new_keeper", name: "New Keeper", minXp: 0, rewardCredits: 0 },
    { id: "cycle_technician", name: "Cycle Technician", minXp: 40, rewardCredits: 25 },
    { id: "aquarist", name: "Aquarist", minXp: 120, rewardCredits: 50 },
    { id: "reef_keeper", name: "Reef Keeper", minXp: 300, rewardCredits: 100 },
    { id: "reef_steward", name: "Reef Steward", minXp: 650, rewardCredits: 200 }
  ];

  var DATA = {
    version: 1,
    saveKey: "pocket-aquarium-ecosystem-v1",
    arcadeKey: "pocket-aquarium-v1", // never mutate/delete — belongs to preserved checkpoint
    secondsPerGameDay1x: 96,
    speeds: [0, 1, 4, 8],
    offlineCapDays: 2,
    ACTIONS: ACTIONS,
    CYCLE_STAGES: CYCLE_STAGES,
    HABITATS: HABITATS,
    PARAMS: PARAMS,
    TIER_ORDER: TIER_ORDER,
    TIERS: TIERS,
    EQUIPMENT: EQUIPMENT,
    SPECIES: SPECIES,
    CORALS: CORALS,
    BUNDLES: BUNDLES,
    KEEPER_RANKS: KEEPER_RANKS
  };

  /* ------------------------------------------------------------------ *
   * Catalog helpers (pure).
   * ------------------------------------------------------------------ */
  function tierIndex(id) { var i = TIER_ORDER.indexOf(id); return i < 0 ? 0 : i; }
  function equipLevel(category, levelId) {
    var cat = EQUIPMENT[category]; if (!cat) return null;
    for (var i = 0; i < cat.levels.length; i++) if (cat.levels[i].id === levelId) return cat.levels[i];
    return null;
  }
  function paramBand(habitat, key) {
    var wt = HABITATS[habitat] && HABITATS[habitat].waterType === "salt" ? "reef" : "fresh";
    if (PARAMS[wt] && PARAMS[wt][key]) return PARAMS[wt][key];
    return PARAMS[key] || null;
  }
  DATA.tierIndex = tierIndex;
  DATA.equipLevel = equipLevel;
  DATA.paramBand = paramBand;

  /* Preview profiles are constrained to the accepted runtime shape. Unknown
     keys or incompatible value types invalidate the whole draft override. */
  function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    var proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }
  var INVALID_PROFILE_VALUE = {};
  function copyProfileShape(template, candidate) {
    if (candidate === undefined) return template;
    if (Array.isArray(template)) {
      if (!Array.isArray(candidate) || (!template.length && candidate.length)) return INVALID_PROFILE_VALUE;
      var arrayCopy = [];
      for (var ai = 0; ai < candidate.length; ai++) {
        var copiedItem = copyProfileShape(template[0], candidate[ai]);
        if (copiedItem === INVALID_PROFILE_VALUE) return INVALID_PROFILE_VALUE;
        arrayCopy.push(copiedItem);
      }
      return arrayCopy;
    }
    if (isPlainObject(template)) {
      if (!isPlainObject(candidate)) return INVALID_PROFILE_VALUE;
      var candidateKeys = Object.keys(candidate);
      for (var ci = 0; ci < candidateKeys.length; ci++) {
        if (!Object.prototype.hasOwnProperty.call(template, candidateKeys[ci])) return INVALID_PROFILE_VALUE;
      }
      var objectCopy = {};
      var templateKeys = Object.keys(template);
      for (var ti = 0; ti < templateKeys.length; ti++) {
        var key = templateKeys[ti];
        var copiedValue = copyProfileShape(template[key], candidate[key]);
        if (copiedValue === INVALID_PROFILE_VALUE) return INVALID_PROFILE_VALUE;
        objectCopy[key] = copiedValue;
      }
      return objectCopy;
    }
    if (template === null) return candidate === null ? null : INVALID_PROFILE_VALUE;
    if (typeof candidate !== typeof template) return INVALID_PROFILE_VALUE;
    if (typeof candidate === "number" && !isFinite(candidate)) return INVALID_PROFILE_VALUE;
    return candidate;
  }
  function sanitizeProfileOverride(speciesId, candidate) {
    var accepted = SPECIES[speciesId];
    if (!accepted || !isPlainObject(candidate)) return null;
    var copy = copyProfileShape(accepted, candidate);
    if (!copy || copy === INVALID_PROFILE_VALUE || copy.id !== speciesId || copy.speciesId !== speciesId ||
        copy.schemaVersion !== "pocket-aquarium.runtime-specimen/v1" ||
        copy.waterType !== accepted.waterType || copy.habitat !== accepted.habitat) return null;
    for (var i = 0; i < copy.compatibilityEdges.length; i++) {
      var edge = copy.compatibilityEdges[i];
      if (edge.subjectSpeciesId !== speciesId ||
          ["compatible", "conditional", "incompatible", "unknown"].indexOf(edge.outcome) < 0) return null;
    }
    return copy;
  }
  function resolveSpecies(state, speciesId) {
    var accepted = SPECIES[speciesId] || null;
    if (!accepted || !state || state.mode !== "specimen_preview" || state.previewSpeciesId !== speciesId ||
        state.profileOverrideStatus !== "valid") return accepted;
    var overrides = state.profileOverrides;
    if (!overrides || !Object.prototype.hasOwnProperty.call(overrides, speciesId)) return accepted;
    var override = overrides[speciesId];
    return override && override.id === speciesId && override.speciesId === speciesId &&
      override.schemaVersion === "pocket-aquarium.runtime-specimen/v1" ? override : accepted;
  }
  DATA.sanitizeProfileOverride = sanitizeProfileOverride;
  DATA.resolveSpecies = resolveSpecies;

  /* A resident's custom name is player text, so it is stored as one compact single-line label:
     non-strings, control characters, and runs of whitespace collapse away, and the result is
     capped. An empty result means "no custom name" — which is how a rename resets a resident to
     its species name, and why an old save with no name field restores unchanged. */
  var RESIDENT_NAME_MAX = 24;
  function sanitizeResidentName(value) {
    if (typeof value !== "string") return "";
    return value.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, RESIDENT_NAME_MAX).trim();
  }
  DATA.residentNameMaxLength = RESIDENT_NAME_MAX;
  DATA.sanitizeResidentName = sanitizeResidentName;

  /* ------------------------------------------------------------------ *
   * validatePurchase(state, request) -> { ok, reasons[] }
   * Lists EVERY blocking reason, not just the first. request examples:
   *   { kind:"livestock", id:"neon_tetra", count:6 }
   *   { kind:"coral", id:"zoanthid" }
   *   { kind:"equipment", category:"filter", levelId:"canister" }
   *   { kind:"tier", id:"mid151" }
   * `state` is a sim state (may be partially sanitized). This function is
   * pure and does not mutate state.
   * ------------------------------------------------------------------ */
  function count(arr) { return Array.isArray(arr) ? arr.length : 0; }

  function currentTierId(state) { return (state && state.tier) || "nano20"; }

  function tankVolumeL(state) {
    var t = TIERS[currentTierId(state)];
    return t ? t.volumeL : 75;
  }
  function tankFootprint(state) {
    var t = TIERS[currentTierId(state)];
    return t ? t.footprintCm2 : 1800;
  }

  /* features the tank currently offers (hardscape + equipment derived). */
  function tankFeatures(state) {
    var feats = {};
    var hab = state && state.habitat;
    if (hab === "amazon") { feats.fine_sand = true; feats.cover = true; feats.infusoria = hasMicrofauna(state, "infusoria"); }
    if (hab === "reef") {
      feats.sand_burrow = true; feats.deep_sand = tierIndex(currentTierId(state)) >= tierIndex("large284");
      feats.host = true; // live rock / host territory available on a reef
      feats.pods = hasMicrofauna(state, "pods");
    }
    var eq = state && state.equipment;
    if (eq) {
      var f = equipLevel("filter", eq.filter);
      feats.strong_filtration = !!(f && f.biofilterSurface >= 3.0) && tierIndex(currentTierId(state)) >= tierIndex("xl757");
    }
    return feats;
  }

  function hasMicrofauna(state, key) {
    var m = state && state.microfauna;
    if (!m) return false;
    return (m[key] || 0) > 0.15;
  }

  function currentBioload(state) {
    var sum = 0, i, ls = (state && state.livestock) || [];
    for (i = 0; i < ls.length; i++) {
      if (ls[i] && ls[i].alive !== false) {
        var sp = resolveSpecies(state, ls[i].species);
        sum += sp ? sp.bioload : 1;
      }
    }
    return sum;
  }

  function bioloadCapacity(state) {
    var t = TIERS[currentTierId(state)];
    var base = t ? t.bioloadCap : 10;
    var eq = state && state.equipment;
    var fil = eq ? equipLevel("filter", eq.filter) : null;
    var mult = fil ? (0.6 + 0.4 * (fil.biofilterSurface / 1.0)) : 1;
    return base * (mult / 1.0);
  }

  function stageIndex(state) {
    var s = state && state.cycle && state.cycle.stage;
    var i = CYCLE_STAGES.indexOf(s);
    return i < 0 ? 0 : i;
  }

  function waterSafeForLife(state) {
    var w = state && state.water; if (!w) return false;
    var amm = PARAMS.ammonia, nit = PARAMS.nitrite;
    return (w.ammonia <= amm.good[1] + 1e-9) && (w.nitrite <= nit.good[1] + 1e-9);
  }

  function isCycled(state) {
    // Stocking gate: stage at least Cycled AND ammonia/nitrite safe AND life support on.
    // Nitrate is evidence that the initial cycle completed, not the biofilter itself: once the
    // stage is established, dilution (water change / matched-water transfer) must not un-cycle it.
    var ls = state && state.cycle && state.cycle.lifeSupport;
    return stageIndex(state) >= CYCLE_STAGES.indexOf("Cycled") &&
      waterSafeForLife(state) && !!ls;
  }

  function aliveOf(state, speciesId) {
    var n = 0, ls = (state && state.livestock) || [];
    for (var i = 0; i < ls.length; i++) if (ls[i] && ls[i].alive !== false && ls[i].species === speciesId) n++;
    return n;
  }

  /* Coral light readiness. The only evidence the store accepts is the player's own
     PAR test: still fresh (Care's 0.75-day window) and captured near the schedule's
     peak, which is where reef PAR is specified — dawn/dusk are programmed ramps, not
     fixture faults. The representative window is derived from the same triangular
     photoperiod sim.js lights the tank on: daylight() at PEAK_DAYLIGHT_FLOOR or more,
     i.e. day fractions .4975-.6425 (about 11:56-15:25 game time). Returns the measured
     peak-window PAR, or null when no such reading exists. */
  var PAR_READING_STALE_DAYS = 0.75, PHOTOPERIOD_START = 0.28, PHOTOPERIOD_END = 0.86;
  var PEAK_DAYLIGHT_FLOOR = 0.75;
  var PEAK_MID = (PHOTOPERIOD_START + PHOTOPERIOD_END) / 2;
  var PEAK_HALF = ((PHOTOPERIOD_END - PHOTOPERIOD_START) / 2) * (1 - PEAK_DAYLIGHT_FLOOR);
  /* Inclusive on both edges (1e-9 for the derivation's float drift): a reading captured
     exactly on a boundary is as representative as one at the peak itself. */
  function isPeakPhotoperiod(frac) {
    return isFinite(frac) && frac >= PEAK_MID - PEAK_HALF - 1e-9 && frac <= PEAK_MID + PEAK_HALF + 1e-9;
  }
  DATA.isPeakPhotoperiod = isPeakPhotoperiod; // shared with the Guide and Care so the window cannot drift
  function measuredDayPar(state) {
    var test = state && state.tests && state.tests.par;
    if (!test || !test.known || !isFinite(test.value) || !(test.ageDays < PAR_READING_STALE_DAYS)) return null;
    var days = state.time && isFinite(state.time.days) ? state.time.days : 0;
    var at = days - Math.max(0, test.ageDays), frac = at - Math.floor(at);
    return isPeakPhotoperiod(frac) ? test.value : null;
  }

  function validatePurchase(state, request) {
    var reasons = [];
    state = state || {};
    request = request || {};
    var kind = request.kind;

    if (kind === "equipment") {
      var lvl = equipLevel(request.category, request.levelId);
      if (!lvl) { reasons.push("Unknown equipment."); return { ok: false, reasons: reasons }; }
      var catDef = EQUIPMENT[request.category];
      if (catDef && catDef.reefOnly && state.habitat !== "reef")
        reasons.push(catDef.label + " is only useful on a saltwater reef.");
      // Repurchase / downgrade gate: the same installed level is never purchasable, and any
      // lower level in the category is not an upgrade. Higher levels fall through to credits.
      if (catDef && state.equipment) {
        var installedId = state.equipment[request.category];
        var reqIdx = -1, instIdx = -1;
        for (var li = 0; li < catDef.levels.length; li++) {
          if (catDef.levels[li].id === request.levelId) reqIdx = li;
          if (catDef.levels[li].id === installedId) instIdx = li;
        }
        if (instIdx >= 0 && reqIdx >= 0) {
          if (reqIdx === instIdx) { reasons.push("Already installed."); return { ok: false, reasons: reasons }; }
          if (reqIdx < instIdx) { reasons.push("Not an upgrade over current equipment."); return { ok: false, reasons: reasons }; }
        }
      }
      if ((state.credits || 0) < lvl.price)
        reasons.push("Not enough credits (need " + lvl.price + ", have " + Math.floor(state.credits || 0) + ").");
      return { ok: reasons.length === 0, reasons: reasons };
    }

    if (kind === "tier") {
      var t = TIERS[request.id];
      if (!t) { reasons.push("Unknown tank tier."); return { ok: false, reasons: reasons }; }
      if (tierIndex(request.id) <= tierIndex(currentTierId(state)))
        reasons.push("That tank is not larger than your current tank.");
      if ((state.credits || 0) < t.price)
        reasons.push("Not enough credits (need " + t.price + ", have " + Math.floor(state.credits || 0) + ").");
      return { ok: reasons.length === 0, reasons: reasons };
    }

    if (kind === "coral") {
      var coral = CORALS[request.id];
      if (!coral) { reasons.push("Unknown coral."); return { ok: false, reasons: reasons }; }
      if (state.habitat !== "reef") reasons.push(coral.name + " needs a saltwater reef habitat.");
      if (!isCycled(state)) reasons.push("The tank must be cycled and stable before adding coral.");
      var wantMature = coral.maturityGate === "mature";
      if (wantMature && stageIndex(state) < CYCLE_STAGES.indexOf("Mature biome"))
        reasons.push(coral.name + " needs a mature biome (let the tank age and stabilize first).");
      // Suitability decides on the zero-decimal PAR Water displays, so a shown boundary
      // reading is never rejected against the range printed beside it. Raw PAR is untouched.
      var rawDayPar = measuredDayPar(state), dayPar = rawDayPar === null ? null : Math.round(rawDayPar);
      if (dayPar === null)
        reasons.push("Run a fresh PAR test near peak light (about 11:56–15:25 game time) before adding " + coral.name +
          " — dawn and dusk ramps read below the fixture's output.");
      else if (dayPar < coral.par.min || dayPar > coral.par.max)
        reasons.push(coral.name + " needs " + coral.par.min + "–" + coral.par.max + " µmol PAR, but your peak-light reading is " +
          dayPar + " µmol — " + (dayPar < coral.par.min ? "install stronger lighting" : "dim or raise the light") + ", then retest.");
      if ((state.credits || 0) < coral.price)
        reasons.push("Not enough credits (need " + coral.price + ", have " + Math.floor(state.credits || 0) + ").");
      // stability: recent water must be within warn bands for salinity/alk if reef
      if (state.habitat === "reef" && state.water) {
        if (!withinWarn(state.habitat, "salinity", state.water.salinity) ||
            !withinWarn(state.habitat, "alkalinity", state.water.alkalinity))
          reasons.push(coral.name + " needs stable salinity and alkalinity.");
      }
      return { ok: reasons.length === 0, reasons: reasons };
    }

    // ---- livestock ----
    var sp = resolveSpecies(state, request.id);
    if (!sp) { reasons.push("Unknown species."); return { ok: false, reasons: reasons }; }
    var reqCount = Math.max(1, Math.floor(request.count || BUNDLES[request.id] || 1));
    var already = aliveOf(state, request.id);

    // water type / habitat
    var habWater = HABITATS[state.habitat] ? HABITATS[state.habitat].waterType : null;
    if (habWater && sp.waterType !== habWater)
      reasons.push(sp.name + " needs " + sp.waterType + "water; this is a " + habWater + "water tank.");
    if (state.habitat && sp.habitat !== state.habitat)
      reasons.push(sp.name + " belongs to the " + (HABITATS[sp.habitat] ? HABITATS[sp.habitat].name : sp.habitat) + ", not this habitat.");

    // cycled / water stability gate — never place livestock into measurable ammonia/nitrite
    if (!isCycled(state))
      reasons.push("The tank is not cycled yet — ammonia/nitrite must be safe with nitrate present before stocking.");

    // tank volume / tier / footprint
    if (tierIndex(currentTierId(state)) < tierIndex(sp.minTier))
      reasons.push(sp.name + " needs at least the " + TIERS[sp.minTier].name + " tank.");
    // Published aquarium sizes are nominal; allow at most 1 L of conversion/rounding drift.
    if (sp.minVolumeL - tankVolumeL(state) > 1)
      reasons.push(sp.name + " needs at least " + sp.minVolumeL + " L of water (this tank holds " + tankVolumeL(state) + " L).");
    if (tankFootprint(state) < sp.minFootprintCm2)
      reasons.push(sp.name + " needs at least " + sp.minFootprintCm2 + " cm² of floor space.");

    // social group minimum / maximum
    var totalAfter = already + reqCount;
    if (totalAfter < sp.socialMin)
      reasons.push(sp.name + " is a social animal and needs a group of at least " + sp.socialMin + " (you would have " + totalAfter + ").");
    if (totalAfter > sp.socialMax)
      reasons.push(sp.name + " should not exceed " + sp.socialMax + " in this system (you would have " + totalAfter + ").");

    // capacity / bioload
    var addBioload = sp.bioload * reqCount;
    if (currentBioload(state) + addBioload > bioloadCapacity(state) + 1e-9)
      reasons.push("Not enough biological capacity for " + reqCount + " more " + sp.name + " — upgrade filtration or tank size.");

    // required feature
    var feats = tankFeatures(state);
    if (sp.requiredFeature && !feats[sp.requiredFeature])
      reasons.push(sp.name + " needs the tank feature: " + featureLabel(sp.requiredFeature) + ".");
    if (sp.needsStrongFiltration && !feats.strong_filtration)
      reasons.push(sp.name + " needs strong filtration (large tank + canister-class filter).");
    if (sp.expert && tierIndex(currentTierId(state)) < tierIndex("xl757"))
      reasons.push(sp.name + " is an expert-only animal for a mature large system.");

    // Structured compatibility risks require an explicit player choice. Legacy
    // callers still see their messages in reasons until acceptRisk is supplied.
    var conflicts = livestockConflicts(state, sp);
    if (request.acceptRisk !== true) for (var c = 0; c < conflicts.length; c++) reasons.push(conflicts[c].message);

    // credits
    var cost = sp.price * reqCount;
    if ((state.credits || 0) < cost)
      reasons.push("Not enough credits (need " + cost + ", have " + Math.floor(state.credits || 0) + ").");

    return { ok: reasons.length === 0, reasons: reasons, conflicts: conflicts };
  }

  function withinWarn(habitat, key, value) {
    var band = paramBand(habitat, key);
    if (!band || !band.warn) return true;
    if (value == null || isNaN(value)) return false;
    return value >= band.warn[0] && value <= band.warn[1];
  }

  function featureLabel(f) {
    var map = {
      fine_sand: "fine sand bottom", sand_burrow: "open sand for burrowing",
      deep_sand: "a deep sand bed", host: "a host anemone / live rock",
      cover: "planted cover", strong_filtration: "strong filtration"
    };
    return map[f] || f;
  }

  function livestockConflicts(state, sp) {
    var out = [], buckets = {}, ls = (state && state.livestock) || [];
    for (var i = 0; i < ls.length; i++) {
      var resident = ls[i]; if (!resident || resident.alive === false) continue;
      var os = resolveSpecies(state, resident.species); if (!os) continue;
      var tag = null, message = null;
      var territorial = sp.territoriality >= 0.45 && os.id !== sp.id && os.layer === sp.layer && os.territoriality >= 0.45;
      if (sp.predator && tagsIntersect(sp.preysOn, os.preyTags)) {
        tag = "predation"; message = sp.name + " will prey on your " + os.name + ".";
      } else if (os.predator && tagsIntersect(os.preysOn, sp.preyTags)) {
        tag = "predation"; message = "Your " + os.name + " would hunt and eat " + sp.name + ".";
      }
      if (territorial) {
        if (tag) message += " They may also fight over the same territory.";
        else { tag = "territoriality"; message = sp.name + " will fight your " + os.name + " over the same territory."; }
      }
      if (!tag && !sp.invertSafe && os.kind === "invert") {
        tag = "invert_safety"; message = sp.name + " may harm your " + os.name + ".";
      }
      if (!tag) continue;
      var key = tag + ":" + os.id, item = buckets[key];
      if (!item) item = buckets[key] = { riskTag: tag, message: message, residentSpeciesId: os.id,
        residentName: os.name, residentIds: [], refundCredits: 0 }, out.push(item);
      item.residentIds.push(resident.id);
      item.refundCredits += Math.floor((os.price || 0) * 0.5);
    }
    return out;
  }

  function tagsIntersect(a, b) {
    if (!a || !b) return false;
    for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) >= 0) return true;
    return false;
  }

  /* export helpers used by sim.js as well */
  DATA.currentBioload = currentBioload;
  DATA.bioloadCapacity = bioloadCapacity;
  DATA.tankFeatures = tankFeatures;
  DATA.isCycled = isCycled;
  DATA.waterSafeForLife = waterSafeForLife;
  DATA.stageIndex = stageIndex;

  PA.DATA = DATA;
  PA.ACTIONS = ACTIONS;
  PA.validatePurchase = validatePurchase;

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
