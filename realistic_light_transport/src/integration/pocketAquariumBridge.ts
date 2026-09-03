import '../../../js/data.js'
import '../../../js/sim.js'

import type { LifecyclePhase, ReefSnapshot } from '../contracts'
import { sampleSpectralTransmittance } from '../scene/materials/spectralTransport'

type PocketAction = Readonly<{ type: string } & Record<string, unknown>>

interface PocketWater {
  levelL: number
  tempC: number
  pH: number
  ammonia: number
  nitrite: number
  nitrate: number
  phosphate: number
  salinity: number
  alkalinity: number
  calcium: number
  magnesium: number
  par: number
  flow: number
}

interface PocketAnimal {
  id: number
  species: string
  kind: 'fish' | 'invert'
  ageDays: number
  stage: string
  sex: string
  hunger: number
  condition: number
  health: number
  alive: boolean
  lastFedDay: number
  x: number
  y: number
}

interface PocketCoral {
  id: number
  species: string
  health: number
  extension: number
  polyps: number
}

interface PocketFood {
  id: number
  x: number
  y: number
  amount: number
  ageDays: number
  sunk: boolean
  consumed?: boolean
}

/** A live, authoritative food pellet projected into the scene. `x` is the normalized
 *  horizontal tap position and `y` is normalized depth (0 = waterline, sinks toward 1). */
export interface FoodPellet {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly amount: number
  readonly ageDays: number
  readonly sunk: boolean
}

export interface PocketState {
  habitat: 'reef' | 'amazon' | null
  time: { days: number }
  lastRealTimestamp: number
  speed: number
  credits: number
  xp: number
  tier: string
  equipment: Record<string, string>
  water: PocketWater
  cycle: {
    stage: string
    filled: boolean
    lifeSupport: boolean
    ammoniaSource: boolean
    inoculated: boolean
    aob: number
    nob: number
    validationDays: number
  }
  succession: { age: number; haze: number; diatom: number; greenFilm: number; cyano: number }
  livestock: PocketAnimal[]
  corals: PocketCoral[]
  microfauna: { pods: number; worms: number; infusoria: number; biodiversity: number }
  food: PocketFood[]
  log: Array<{ type: string; message: string }>
}

interface CatalogSpecies {
  id: string
  name: string
  sci: string
  habitat: string
  kind: 'fish' | 'invert'
  adultSizeCm: number
  price: number
  layer: 'bottom' | 'mid' | 'top'
}

interface CatalogCoral { id: string; name: string; price: number }
interface CatalogTier { id: string; name: string; volumeL: number; price: number }
interface EquipmentLevel { id: string; name: string; price: number; parCeiling?: number; autoTopOff?: boolean }
interface Validation { ok: boolean; reasons: string[] }

interface PocketRuntime {
  ACTIONS: Record<string, string>
  DATA: {
    ACTIONS: Record<string, string>
    BUNDLES: Record<string, number>
    SPECIES: Record<string, CatalogSpecies>
    CORALS: Record<string, CatalogCoral>
    TIERS: Record<string, CatalogTier>
    TIER_ORDER: string[]
    EQUIPMENT: Record<string, { label: string; levels: EquipmentLevel[] }>
    equipLevel: (category: string, id: string) => EquipmentLevel | null
    isCycled: (state: PocketState) => boolean
    saveKey: string
  }
  createState: (options: Record<string, unknown>) => PocketState
  step: (state: PocketState, seconds: number) => PocketState
  stepDays: (state: PocketState, days: number) => PocketState
  dispatch: (state: PocketState, action: PocketAction) => PocketState
  validatePurchase: (state: PocketState, request: Record<string, unknown>) => Validation
  sanitizeState: (raw: unknown) => PocketState
  offlineCatchUp: (state: PocketState, elapsedMs: number) => unknown
  snapshotSummary: (state: PocketState) => {
    nextAction: { title: string; detail: string } | null
    alerts: string[]
  } | null
}

export interface PocketSpecimen extends PocketAnimal {
  readonly speciesId: string
  readonly name: string
  readonly scientificName: string
  readonly adultSizeCm: number
  readonly layer: CatalogSpecies['layer']
}

export interface PocketStoreOffer {
  readonly kind: 'livestock' | 'coral' | 'equipment' | 'tier'
  readonly id: string
  readonly name: string
  readonly price: number
  readonly allowed: boolean
  readonly reasons: readonly string[]
  readonly action: PocketAction
}

export interface PocketObjective {
  readonly chapter: string
  readonly title: string
  readonly detail: string
  readonly lesson: string
  readonly destination: 'care' | 'store' | 'journal'
  readonly actionLabel?: string
  readonly action?: PocketAction
}

export interface PocketGameView {
  readonly authority: 'root_pa'
  readonly habitatName: string
  readonly tierName: string
  readonly credits: number
  readonly xp: number
  readonly cycleStage: string
  readonly cycled: boolean
  readonly filled: boolean
  readonly objective: PocketObjective
  readonly water: Readonly<PocketWater>
  readonly specimens: readonly PocketSpecimen[]
  readonly food: readonly FoodPellet[]
  readonly storeOffers: readonly PocketStoreOffer[]
  readonly reefSnapshot: ReefSnapshot
  readonly nextAction: { readonly title: string; readonly detail: string }
  readonly alerts: readonly string[]
}

const runtime = (globalThis as unknown as { PA: PocketRuntime }).PA
const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value))
const clone = (state: PocketState): PocketState => structuredClone(state)

/** Authoritative fishless->cycled commissioning shared by the starter tank and the
 *  workbench showcase: fill, install core equipment, run the fishless nitrogen cycle. */
function commissionCycledReef(credits: number): PocketState {
  const state = runtime.createState({ habitat: 'reef', credits, seed: 0x51f15e })
  const act = runtime.ACTIONS
  const send = (action: PocketAction) => runtime.dispatch(state, action)
  send({ type: act.SETUP_FILL })
  ;([
    ['filter', 'canister'], ['heater', 'controller'], ['circulation', 'powerhead'],
    ['light', 'led'], ['ato', 'ato'],
  ] as const).forEach(([category, levelId]) => send({ type: act.PURCHASE_EQUIPMENT, category, levelId }))
  send({ type: act.SETUP_LIFE_SUPPORT, on: true })
  send({ type: act.ADD_AMMONIA_SOURCE, on: true })
  send({ type: act.INOCULATE_BACTERIA })
  runtime.stepDays(state, 21.5)
  send({ type: act.ADD_AMMONIA_SOURCE, on: false })
  return state
}

/** First-run authoritative default: an empty reef that must be commissioned and cycled.
 * Existing saves still hydrate unchanged; only a player without a save starts here. */
export function createStarterPocketState(): PocketState {
  return runtime.createState({ habitat: 'reef', credits: 180, seed: 0x51f15e })
}

/** Fully-stocked demo state — workbench/demo only, never the live game default. */
export function createPocketReefShowcase(): PocketState {
  const state = commissionCycledReef(3000)
  const act = runtime.ACTIONS
  const send = (action: PocketAction) => runtime.dispatch(state, action)
  send({ type: act.SEED_MICROFAUNA, culture: 'pods' })
  send({ type: act.PURCHASE_LIVESTOCK, species: 'ocellaris', count: 2 })
  send({ type: act.PURCHASE_LIVESTOCK, species: 'watchman_goby', count: 1 })
  send({ type: act.PURCHASE_LIVESTOCK, species: 'pistol_shrimp', count: 1 })
  send({ type: act.PURCHASE_CORAL, coral: 'zoanthid' })
  send({ type: act.PURCHASE_CORAL, coral: 'goniopora' })
  runtime.stepDays(state, 0.02)
  send({ type: act.WATER_TEST })
  return state
}

/** Load the single authoritative save (shared key with the root Pocket Aquarium app),
 *  sanitizing it through the root reducer and applying capped offline catch-up. Returns
 *  null when there is no usable save so callers fall back to a fresh starter tank. */
export function loadSavedPocketState(now: number, storage?: Storage): PocketState | null {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  if (!store) return null
  let raw: string | null
  try { raw = store.getItem(runtime.DATA.saveKey) } catch { return null }
  if (!raw) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  const state = runtime.sanitizeState(parsed)
  if (!state.habitat) return null
  const elapsed = now - state.lastRealTimestamp
  if (now > 0 && state.lastRealTimestamp > 0 && elapsed > 1000) runtime.offlineCatchUp(state, elapsed)
  return state
}

/** Persist the authoritative state to the shared save key. */
export function savePocketState(state: PocketState, now?: number, storage?: Storage): void {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  if (!store) return
  if (now != null) state.lastRealTimestamp = now
  try { store.setItem(runtime.DATA.saveKey, JSON.stringify(state)) } catch { /* storage full/unavailable */ }
}

export function advancePocketState(state: PocketState, elapsedSeconds: number): PocketState {
  const next = clone(state)
  return runtime.step(next, elapsedSeconds)
}

export function dispatchPocketAction(state: PocketState, action: PocketAction): PocketState {
  const next = clone(state)
  return runtime.dispatch(next, action)
}

function lifecycleFor(state: PocketState): LifecyclePhase {
  const nuisance = Math.max(state.succession.diatom, state.succession.greenFilm, state.succession.cyano)
  if (!state.cycle.filled) return 'commissioning'
  if (!runtime.DATA.isCycled(state)) return 'cycling'
  if (nuisance > 0.18) return 'ugly_phase'
  return state.cycle.stage === 'Mature biome' ? 'young_reef' : 'stabilizing'
}

function storeOffers(state: PocketState): PocketStoreOffer[] {
  const offer = (kind: PocketStoreOffer['kind'], id: string, name: string, price: number,
    request: Record<string, unknown>, action: PocketAction): PocketStoreOffer => {
    const result = runtime.validatePurchase(state, request)
    return { kind, id, name, price, allowed: result.ok, reasons: result.reasons, action }
  }
  const livestock = Object.values(runtime.DATA.SPECIES).filter((item) => item.habitat === 'reef').map((item) => {
    const count = runtime.DATA.BUNDLES[item.id] ?? 1
    return offer('livestock', item.id, item.name, item.price * count,
      { kind: 'livestock', id: item.id, count }, { type: runtime.ACTIONS.PURCHASE_LIVESTOCK, species: item.id, count })
  })
  const corals = Object.values(runtime.DATA.CORALS).map((item) => offer('coral', item.id, item.name, item.price,
    { kind: 'coral', id: item.id }, { type: runtime.ACTIONS.PURCHASE_CORAL, coral: item.id }))
  const equipment = Object.entries(runtime.DATA.EQUIPMENT).flatMap(([category, item]) => item.levels
    .filter((level) => state.equipment[category] !== level.id)
    .map((level) => offer('equipment', `${category}:${level.id}`, level.name, level.price,
      { kind: 'equipment', category, levelId: level.id },
      { type: runtime.ACTIONS.PURCHASE_EQUIPMENT, category, levelId: level.id })))
  const tiers = runtime.DATA.TIER_ORDER.filter((id) => id !== state.tier).map((id) => {
    const item = runtime.DATA.TIERS[id]
    return offer('tier', id, item.name, item.price, { kind: 'tier', id },
      { type: runtime.ACTIONS.PURCHASE_TIER, tier: id })
  })
  return [...livestock, ...corals, ...equipment, ...tiers]
}

function objectiveFor(state: PocketState, summary: ReturnType<PocketRuntime['snapshotSummary']>): PocketObjective {
  const act = runtime.ACTIONS
  if (!state.cycle.filled) return {
    chapter: 'Commissioning · 1 of 4', title: 'Mix saltwater and fill',
    detail: 'Bring the dry reef to its operating waterline at 35 ppt.',
    lesson: 'Saltwater establishes the habitat, but it is not biologically safe yet. The filter still has no mature bacteria to process animal waste.',
    destination: 'care', actionLabel: 'Fill the reef', action: { type: act.SETUP_FILL },
  }
  if (!state.cycle.lifeSupport) return {
    chapter: 'Commissioning · 2 of 4', title: 'Start life support',
    detail: 'Turn on filtration, heat, oxygenation, and circulation.',
    lesson: 'Nitrifying bacteria live on wet filter and rock surfaces. Flow brings them oxygen and carries dissolved waste to the biofilter.',
    destination: 'care', actionLabel: 'Start life support', action: { type: act.SETUP_LIFE_SUPPORT, on: true },
  }
  if (!state.cycle.ammoniaSource && !runtime.DATA.isCycled(state)) return {
    chapter: 'Commissioning · 3 of 4', title: 'Feed the invisible filter',
    detail: 'Add a measured ammonia source before any animal enters.',
    lesson: 'Ammonia is toxic to fish, but a fishless dose is the fuel that grows the first bacterial colony. That colony converts ammonia into nitrite.',
    destination: 'care', actionLabel: 'Add ammonia source', action: { type: act.ADD_AMMONIA_SOURCE, on: true },
  }
  if (!state.cycle.inoculated) return {
    chapter: 'Commissioning · 4 of 4', title: 'Seed nitrifying bacteria',
    detail: 'Inoculate the filter, then watch both bacterial colonies establish.',
    lesson: 'The first colony oxidizes ammonia into nitrite. A second colony converts nitrite into nitrate—the safer end product removed by water changes and export.',
    destination: 'care', actionLabel: 'Inoculate filter', action: { type: act.INOCULATE_BACTERIA },
  }
  if (!runtime.DATA.isCycled(state)) {
    const stage = state.cycle.stage
    const lesson = stage === 'Ammonia oxidation'
      ? 'Ammonia is now feeding the first bacterial colony. A later nitrite rise proves that oxidation is happening.'
      : stage === 'Nitrite oxidation'
        ? 'Nitrite is the toxic middle step. The second bacterial colony must grow before nitrite falls and nitrate accumulates.'
        : stage === 'Nitrate present'
          ? 'Nitrate proves both oxidation steps are working. The tank still needs a sustained safe window before livestock unlocks.'
          : 'The biofilter is establishing. Watch the three readings move in sequence rather than chasing a single number.'
    const observing = state.speed >= 4
    return {
      chapter: `Fishless cycle · ${stage}`, title: stage === 'Nitrate present' ? 'Prove the safe window' : 'Watch the nitrogen cycle',
      detail: `Ammonia ${state.water.ammonia.toFixed(2)} → nitrite ${state.water.nitrite.toFixed(2)} → nitrate ${state.water.nitrate.toFixed(1)} mg/L`,
      lesson, destination: 'care', actionLabel: observing ? 'Test the water' : 'Observe at 4×',
      action: observing ? { type: act.WATER_TEST } : { type: act.SET_SPEED, speed: 4 },
    }
  }
  if (state.livestock.every((animal) => animal.alive === false)) return {
    chapter: 'First stocking unlocked', title: 'Choose the first resident',
    detail: 'The biofilter held ammonia and nitrite safe while nitrate remained present.',
    lesson: 'Stock slowly. Every animal adds waste, so compatibility, adult size, social needs, and biofilter capacity all matter.',
    destination: 'store',
  }
  return {
    chapter: 'Living reef', title: summary?.nextAction?.title ?? 'Observe the reef',
    detail: summary?.nextAction?.detail ?? 'Keep the water stable.',
    lesson: 'Observe the animals and water together. Intervene only when the tank gives you a reason.',
    destination: summary?.nextAction?.title.toLowerCase().includes('feed') ? 'journal' : 'care',
  }
}

export function projectPocketState(state: PocketState): PocketGameView {
  const tier = runtime.DATA.TIERS[state.tier]
  const light = runtime.DATA.equipLevel('light', state.equipment.light)
  const ato = runtime.DATA.equipLevel('ato', state.equipment.ato)
  const living = state.livestock.filter((animal) => animal.alive !== false)
  const fish = living.filter((animal) => animal.kind === 'fish')
  const corals = state.corals
  const depth = 0.28
  const shading = clamp(0.18 + state.succession.diatom * 0.09 + state.succession.greenFilm * 0.16 + state.succession.cyano * 0.13)
  const attenuation = clamp(0.78 + state.succession.haze * 0.4 + state.succession.greenFilm * 0.22, 0.2, 2.4)
  const spectrum = sampleSpectralTransmittance(depth, attenuation, 0.96)
  const transmission = spectrum.reduce((sum, value) => sum + value, 0) / spectrum.length
  const footprint = Math.max(tier.volumeL / 1000 / (0.4 * 0.78), 0.01)
  const tankDepth = Math.sqrt(footprint / 2.4)
  const hunger = fish.length ? fish.reduce((sum, animal) => sum + animal.hunger, 0) / fish.length : 1
  const health = fish.length ? fish.reduce((sum, animal) => sum + animal.health, 0) / fish.length : 0
  const saltFraction = clamp(state.water.salinity / 1000, 0, 0.2)
  const reefSnapshot: ReefSnapshot = {
    namespace: 'marine_reef',
    clock: { elapsedHours: state.time.days * 24, day: Math.floor(state.time.days) + 1,
      timeOfDayHours: (state.time.days % 1) * 24, speed: state.speed, paused: state.speed === 0 },
    tank: { nominalVolumeLiters: tier.volumeL, targetWaterVolumeLiters: tier.volumeL,
      waterVolumeLiters: state.water.levelL, waterLevelMeters: state.water.levelL / 1000 / footprint,
      widthMeters: tankDepth * 2.4, heightMeters: 0.4, depthMeters: tankDepth,
      evaporationLitersPerDay: tier.volumeL * 0.012 },
    chemistry: { saltEquivalentMassKilograms: state.water.levelL * 0.997 * saltFraction / (1 - saltFraction),
      saltEquivalentGPerKg: state.water.salinity, totalAmmoniaNitrogenMassMilligrams: state.water.ammonia * state.water.levelL,
      nitriteNitrogenMassMilligrams: state.water.nitrite * state.water.levelL, nitrateNitrogenMassMilligrams: state.water.nitrate * state.water.levelL,
      phosphatePhosphorusMassMilligrams: state.water.phosphate * state.water.levelL,
      totalAmmoniaNitrogenMgPerLiter: state.water.ammonia, nitriteNitrogenMgPerLiter: state.water.nitrite,
      nitrateNitrogenMgPerLiter: state.water.nitrate, phosphatePhosphorusMgPerLiter: state.water.phosphate,
      temperatureCelsius: state.water.tempC, ph: state.water.pH, alkalinityDkh: state.water.alkalinity },
    equipment: { atoEnabled: Boolean(ato?.autoTopOff), atoReservoirLiters: 0, atoSetpointLiters: tier.volumeL,
      atoPumpLitersPerHour: 0, lightPower: clamp(state.water.par / Math.max(light?.parCeiling ?? 1, 1)), flowPower: clamp(state.water.flow) },
    ecology: { phase: lifecycleFor(state), maturity: clamp(state.succession.age / 20), diatomCoverage: state.succession.diatom,
      greenAlgaeCoverage: state.succession.greenFilm, cyanobacteriaCoverage: state.succession.cyano,
      microfaunaActivity: state.microfauna.biodiversity,
      polypExtension: corals.length ? corals.reduce((sum, coral) => sum + coral.extension, 0) / corals.length : 0 },
    livestock: { clownfishCount: fish.filter((animal) => animal.species === 'ocellaris').length,
      smallReefFishCount: fish.filter((animal) => animal.species !== 'ocellaris').length,
      fishSatiation: clamp(1 - hunger), fishStress: clamp(1 - health),
      coralHealth: corals.length ? corals.reduce((sum, coral) => sum + coral.health, 0) / corals.length : 0 },
    lightField: { surfacePpfd: state.water.par, localPpfd: state.water.par * transmission * (1 - shading), sampleDepthMeters: depth,
      interfaceTransmission: 0.96, attenuationPerMeter: attenuation, shading },
    // feedPulse is retained only for the shared ReefSnapshot contract (Ben's legacy
    // reefSimulation). The live scene now reads authoritative food/consumption events,
    // so no lastFed/time heuristic drives feeding here.
    events: { sequence: state.log.length, lastEvent: state.log.at(-1)?.message ?? 'Reef ready',
      causalNote: 'Pocket Aquarium advances all gameplay state.', feedPulse: 0 },
  }
  const summary = runtime.snapshotSummary(state)
  const objective = objectiveFor(state, summary)
  return { authority: 'root_pa', habitatName: 'Indo-Pacific sheltered lagoon reef', tierName: tier.name,
    credits: Math.floor(state.credits), xp: Math.floor(state.xp), cycleStage: state.cycle.stage,
    cycled: runtime.DATA.isCycled(state), filled: state.cycle.filled, objective, water: { ...state.water },
    specimens: living.map((animal) => { const species = runtime.DATA.SPECIES[animal.species]; return { ...animal,
      speciesId: animal.species, name: species.name, scientificName: species.sci,
      adultSizeCm: species.adultSizeCm, layer: species.layer } }),
    food: state.food.filter((pellet) => !pellet.consumed).map((pellet) => ({
      id: pellet.id, x: pellet.x, y: pellet.y, amount: pellet.amount, ageDays: pellet.ageDays, sunk: pellet.sunk })),
    storeOffers: storeOffers(state), reefSnapshot,
    nextAction: { title: objective.title, detail: objective.detail },
    alerts: summary?.alerts ?? [] }
}
