import '../../../js/specimenProfiles.js'
import '../../../js/data.js'
import '../../../js/sim.js'
import '../../../js/sessionGuide.js'

import type { LifecyclePhase, ReefSnapshot } from '../contracts'
import { sampleSpectralTransmittance } from '../scene/materials/spectralTransport'

export type PocketAction = Readonly<{ type: string } & Record<string, unknown>>

export interface PocketFoodPellet {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly amount: number
  readonly ageDays: number
  readonly sunk: boolean
}
export type FoodPellet = PocketFoodPellet

export interface PocketGuideView {
  readonly stage: string
  readonly title: string
  readonly body: string
  readonly nextAction: Readonly<{ type: string } & Record<string, unknown>> | null
  readonly firstFeedPending: boolean
  readonly testedAtDay: number | null
  readonly readingAgeDays: number | null
}

export interface PocketTestedReading {
  readonly key: string
  readonly value: number | null
  readonly known: boolean
  readonly ageDays: number | null
  readonly testedAtDay: number | null
}

export interface PocketTestFreshness {
  readonly label: string
  readonly stale: boolean
  readonly testedAtDay: number | null
  readonly readingAgeDays: number | null
}

export interface PocketSelectionView {
  readonly entityType: 'livestock' | 'coral'
  readonly id: number
  readonly title: string
  readonly facts: readonly string[]
}

export interface PocketClutchView {
  readonly id: number
  readonly speciesId: string
  readonly stage: string
  readonly ageDays: number
}

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
  causeOfDeath?: string | null
  decayDays?: number
  lastFedDay: number
  x: number
  y: number
}

interface PocketCoral {
  id: number
  species: string
  health: number
  tissue: number
  extension: number
  polyps: number
  growth: number
  stress: number
}

interface PocketClutch {
  id: number
  species: string
  stage: string
  ageDays: number
}

interface PocketTestRecord {
  value: number
  ageDays: number
  known: boolean
}

export interface PocketState {
  mode?: 'specimen_preview'
  previewSpeciesId?: string
  profileOverrides?: Record<string, CatalogSpecies>
  profileOverrideStatus?: 'accepted' | 'valid' | 'invalid_accepted_fallback'
  habitat: 'reef' | 'amazon' | null
  time: { days: number }
  speed: number
  credits: number
  xp: number
  tier: string
  equipment: Record<string, string>
  automation: {
    feeder: { enabled: boolean; intervalDays: number; portionsPerDispense: number; hopperPortions: number; capacity: number; nextFeedDay: number; status: string }
    ato: { reservoirL: number; capacityL: number }
  }
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
  clutches: PocketClutch[]
  microfauna: { pods: number; worms: number; infusoria: number; biodiversity: number }
  food: PocketFoodPellet[]
  tests: Record<string, PocketTestRecord>
  selection: { entityType: 'livestock' | 'coral'; id: number } | null
  log: Array<{ type: string; message: string }>
  lastRealTimestamp: number
}

export interface CatalogSpecies {
  id: string
  name: string
  sci: string
  habitat: string
  kind: 'fish' | 'invert'
  adultSizeCm: number
  price: number
  layer: 'bottom' | 'mid' | 'top'
  profileRevision?: Readonly<{ package: number; biology: number; calibration: number; morphology: number; asset: string }>
}

interface CatalogCoral { id: string; name: string; price: number }
interface CatalogTier { id: string; name: string; volumeL: number; price: number }
interface EquipmentLevel { id: string; name: string; price: number; parCeiling?: number; autoTopOff?: boolean; reservoirCapacityL?: number; autoFeed?: boolean; hopperCapacity?: number }
interface Validation { ok: boolean; reasons: string[] }

interface PocketRuntime {
  ACTIONS: Record<string, string>
  DATA: {
    saveKey: string
    ACTIONS: Record<string, string>
    BUNDLES: Record<string, number>
    SPECIES: Record<string, CatalogSpecies>
    CORALS: Record<string, CatalogCoral>
    TIERS: Record<string, CatalogTier>
    TIER_ORDER: string[]
    HABITATS: Record<string, { params: string[] }>
    EQUIPMENT: Record<string, { label: string; levels: EquipmentLevel[] }>
    resolveSpecies: (state: PocketState | null, speciesId: string) => CatalogSpecies | null
    equipLevel: (category: string, id: string) => EquipmentLevel | null
    isCycled: (state: PocketState) => boolean
  }
  createState: (options: Record<string, unknown>) => PocketState
  createSpecimenPreviewState: (options: Record<string, unknown>) => PocketState
  step: (state: PocketState, seconds: number) => PocketState
  stepDays: (state: PocketState, days: number) => PocketState
  dispatch: (state: PocketState, action: PocketAction) => PocketState
  sanitizeState: (raw: unknown) => PocketState
  offlineCatchUp: (state: PocketState, elapsedMs: number) => unknown
  validatePurchase: (state: PocketState, request: Record<string, unknown>) => Validation
  sessionGuide: {
    project: (state: PocketState) => PocketGuideView
  }
}

export interface PocketSpecimen extends PocketAnimal {
  readonly speciesId: string
  readonly name: string
  readonly scientificName: string
  readonly adultSizeCm: number
  readonly layer: CatalogSpecies['layer']
  readonly runtimeProfile: Readonly<CatalogSpecies>
}

export interface PocketStoreOffer {
  readonly kind: 'livestock' | 'coral' | 'equipment' | 'tier'
  /** Store-drawer filter group. Livestock/coral/tank map straight from kind. */
  readonly group: 'equipment' | 'livestock' | 'coral' | 'tank'
  readonly id: string
  readonly name: string
  readonly price: number
  readonly allowed: boolean
  readonly reasons: readonly string[]
  readonly action: PocketAction
  /** Equipment-only causal copy so a card can explain itself without a content framework. */
  readonly category?: string
  readonly problemSolved?: string
  readonly durableEffect?: string
  readonly operatingResource?: string
  /** True when this exact equipment level is already installed (shown, never repurchased). */
  readonly installed?: boolean
  /** True when a live care recommendation points at this offer. */
  readonly recommended?: boolean
  /** Livestock-only fact line: scientific name · adult size · water layer. */
  readonly detail?: string
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

export interface PocketCareRecommendation {
  readonly severity: 'urgent' | 'watch' | 'stable'
  readonly title: string
  readonly cause: string
  readonly actionLabel?: string
  readonly action?: PocketAction
  readonly suggestedOfferId?: string
  readonly suggestedOfferName?: string
}

export interface PocketDeadResident {
  readonly id: number
  readonly name: string
  readonly cause: string | null
}

export interface PocketFeederView {
  readonly installed: boolean
  readonly enabled: boolean
  readonly intervalDays: number
  readonly portionsPerDispense: number
  readonly hopperPortions: number
  readonly capacity: number
  readonly status: string
}

export interface PocketAtoView {
  readonly installed: boolean
  readonly reservoirL: number
  readonly capacityL: number
  readonly topping: boolean
}

export interface PocketGameView {
  readonly authority: 'root_pa'
  readonly habitatName: string
  readonly tierName: string
  readonly credits: number
  /** True when God mode is active: Store treats credits as unlimited and the pill shows ∞. */
  readonly unlimitedCredits: boolean
  readonly xp: number
  readonly cycleStage: string
  readonly cycled: boolean
  readonly filled: boolean
  readonly cycle: Readonly<PocketState['cycle']>
  readonly objective: PocketObjective
  readonly water: Readonly<PocketWater>
  readonly specimens: readonly PocketSpecimen[]
  readonly residents: readonly PocketSpecimen[]
  readonly selectedSpecimen?: PocketSpecimen
  readonly food: readonly PocketFoodPellet[]
  readonly guide: PocketGuideView
  readonly testedWater: readonly PocketTestedReading[]
  readonly testFreshness: PocketTestFreshness
  readonly selection: PocketSelectionView | null
  readonly clutches: readonly PocketClutchView[]
  readonly storeOffers: readonly PocketStoreOffer[]
  readonly careRecommendations: readonly PocketCareRecommendation[]
  readonly deadResidents: readonly PocketDeadResident[]
  readonly feeder: PocketFeederView
  readonly ato: PocketAtoView
  readonly nextAction: Readonly<{ title: string; detail: string }>
  readonly alerts: readonly string[]
  readonly optics: Readonly<{ localPpfd: number; mode: 'read_only' }>
  readonly reefSnapshot: ReefSnapshot
}

const runtime = (globalThis as unknown as { PA: PocketRuntime }).PA
export const pocketActions: Readonly<Record<string, string>> = Object.freeze({ ...runtime.ACTIONS })
const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value))
const clone = (state: PocketState): PocketState => structuredClone(state)

function preparePocketReef(state: PocketState) {
  const act = runtime.ACTIONS
  const send = (action: PocketAction) => runtime.dispatch(state, action)
  send({ type: act.SETUP_FILL })
  send({ type: act.PURCHASE_TIER, tier: 'mid151' })
  ;([
    ['filter', 'canister'], ['heater', 'controller'], ['circulation', 'powerhead'],
    ['light', 'led'], ['ato', 'ato'],
  ] as const).forEach(([category, levelId]) => send({ type: act.PURCHASE_EQUIPMENT, category, levelId }))
  send({ type: act.SETUP_LIFE_SUPPORT, on: true })
  send({ type: act.ADD_AMMONIA_SOURCE, on: true })
  send({ type: act.INOCULATE_BACTERIA })
  runtime.stepDays(state, 21.5)
  send({ type: act.ADD_AMMONIA_SOURCE, on: false })
  send({ type: act.SEED_MICROFAUNA, culture: 'pods' })
  return send
}

export function createPocketReefShowcase(): PocketState {
  const state = runtime.createState({ habitat: 'reef', credits: 3000, seed: 0x51f15e })
  const send = preparePocketReef(state)
  const act = runtime.ACTIONS
  send({ type: act.PURCHASE_LIVESTOCK, species: 'ocellaris', count: 2 })
  send({ type: act.PURCHASE_LIVESTOCK, species: 'watchman_goby', count: 1 })
  send({ type: act.PURCHASE_LIVESTOCK, species: 'pistol_shrimp', count: 1 })
  send({ type: act.PURCHASE_CORAL, coral: 'zoanthid' })
  send({ type: act.PURCHASE_CORAL, coral: 'goniopora' })
  runtime.stepDays(state, 0.02)
  send({ type: act.WATER_TEST })
  return state
}

export function createPocketNewGame(): PocketState {
  return runtime.createState({ habitat: 'reef', seed: 0x51f15e })
}

export const createStarterPocketState = createPocketNewGame

export const pocketSaveKey = runtime.DATA.saveKey

export function restorePocketGame(raw: unknown, now = Date.now()): PocketState {
  const state = runtime.sanitizeState(raw)
  if (!state.habitat) return createPocketNewGame()
  if (state.lastRealTimestamp && now - state.lastRealTimestamp > 1000) {
    runtime.offlineCatchUp(state, now - state.lastRealTimestamp)
  }
  return state
}

export function serializePocketGame(state: PocketState, now = Date.now()): string {
  return JSON.stringify({ ...state, lastRealTimestamp: now })
}

export function loadSavedPocketState(now: number, storage?: Storage): PocketState | null {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  if (!store) return null
  let raw: string | null
  try { raw = store.getItem(pocketSaveKey) } catch { return null }
  if (!raw) return null
  try { return restorePocketGame(JSON.parse(raw), now) } catch { return null }
}

export function savePocketState(state: PocketState, now = Date.now(), storage?: Storage): void {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  if (!store) return
  try { store.setItem(pocketSaveKey, serializePocketGame(state, now)) } catch { /* storage is optional */ }
}

export function createPocketSpecimenPreview(speciesId: string, profileOverride?: CatalogSpecies): PocketState {
  const state = runtime.createSpecimenPreviewState({ habitat: 'reef', credits: 3000, seed: 0x51f15e,
    speciesId, profileOverride })
  const send = preparePocketReef(state)
  const act = runtime.ACTIONS
  send({ type: act.PURCHASE_LIVESTOCK, species: speciesId, count: 1 })
  runtime.stepDays(state, 0.02)
  send({ type: act.WATER_TEST })
  return state
}

export function advancePocketState(state: PocketState, elapsedSeconds: number): PocketState {
  const next = clone(state)
  return runtime.step(next, elapsedSeconds)
}

/** Developer safe/watch mode: a dev-only overlay that never touches the normal player key. */
export const devSafeSaveKey = `${pocketSaveKey}:dev-safe-v1`
const DEV_SAFE_HEALTH_FLOOR = 0.02

export interface PocketPreventedDeath {
  readonly id: number
  readonly species: string
  readonly cause: string
  readonly day: number
}

/** True only under a Vite dev build served from a loopback host with an explicit `?dev=1`. */
export function isDevSafeActive(env?: {
  readonly dev?: boolean
  readonly hostname?: string
  readonly search?: string
}): boolean {
  const dev = env?.dev ?? Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV)
  if (!dev) return false
  const hostname = env?.hostname ?? (typeof location !== 'undefined' ? location.hostname : '')
  const loopback =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  if (!loopback) return false
  const search = env?.search ?? (typeof location !== 'undefined' ? location.search : '')
  return new URLSearchParams(search).get('dev') === '1'
}

/**
 * Advance the authoritative simulation normally, then keep any previously living animal alive.
 * Death is captured honestly (id/species/cause/day) and reversed only by restoring `alive` plus
 * the smallest health floor — water, hunger, condition, age, food, credits, ecology, and time are
 * whatever the real tick produced.
 */
export function advancePocketStateDevSafe(
  state: PocketState,
  elapsedSeconds: number,
): { readonly state: PocketState; readonly prevented: readonly PocketPreventedDeath[] } {
  const wasAlive = new Set<number>()
  for (const animal of state.livestock) if (animal.alive !== false) wasAlive.add(animal.id)
  const next = advancePocketState(state, elapsedSeconds)
  const prevented: PocketPreventedDeath[] = []
  for (const animal of next.livestock) {
    if (animal.alive === false && wasAlive.has(animal.id)) {
      prevented.push({ id: animal.id, species: animal.species, cause: animal.causeOfDeath ?? 'unknown', day: next.time.days })
      animal.alive = true
      animal.causeOfDeath = null
      if (!(animal.health >= DEV_SAFE_HEALTH_FLOOR)) animal.health = DEV_SAFE_HEALTH_FLOOR
    }
  }
  return { state: next, prevented }
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

function biologicalCycleEstablished(state: PocketState) {
  return runtime.DATA.isCycled(state)
    || state.cycle.stage === 'Cycled'
    || state.cycle.stage === 'Young biome'
    || state.cycle.stage === 'Mature biome'
}

/** Causal, non-cosmetic copy for each equipment level so a Store card explains what it solves,
 *  the durable simulation effect it applies, and the ongoing resource/maintenance it costs. */
const EQUIPMENT_COPY: Readonly<Record<string, Readonly<{ problem: string; effect: string; resource: string }>>> = {
  'filter:sponge': { problem: 'No mechanical or biological filtration', effect: 'Baseline biofilter surface and trickle flow', resource: 'Rinse the sponge during water changes' },
  'filter:hob': { problem: 'Ammonia and nitrite climb faster than the sponge clears', effect: 'Nearly 2× biofilter surface and stronger flow', resource: 'Replace cartridge media periodically' },
  'filter:canister': { problem: 'Heavy stocking overruns hang-on filtration', effect: 'Over 3× biofilter surface with the highest flow', resource: 'Deep-clean canister media on a schedule' },
  'heater:basic': { problem: 'Temperature drifts with the room', effect: 'Holds ~26 °C with moderate stability', resource: 'Draws power continuously' },
  'heater:controller': { problem: 'Preset heaters overshoot and stress corals', effect: 'Tight ~26 °C control at high stability', resource: 'Draws power; verify probe calibration' },
  'circulation:powerhead': { problem: 'Stagnant zones starve oxygen and let detritus settle', effect: 'Adds directed flow and oxygenation, shrinks dead zones', resource: 'Draws power; clear impeller of buildup' },
  'circulation:gyre': { problem: 'Large tanks need broad, tuned water movement', effect: 'Highest flow and oxygenation, near-zero dead zones', resource: 'Draws power; periodic impeller service' },
  'light:led': { problem: 'Basic strip caps PAR too low for most corals', effect: 'Raises PAR ceiling to 160 with photoperiod control', resource: 'Draws power on the programmed photoperiod' },
  'light:pro_led': { problem: 'Demanding corals need intense, tunable light', effect: 'Raises PAR ceiling to 340 with full photoperiod control', resource: 'Higher power draw on the programmed photoperiod' },
  'skimmer:hob': { problem: 'Dissolved organics accumulate before the biofilter can export them', effect: 'Exports organics (0.4) to ease nutrient load', resource: 'Empty and rinse the collection cup' },
  'skimmer:cone': { problem: 'Heavily fed reefs export organics slowly', effect: 'Strong organic export (0.8) for low nutrients', resource: 'Draws power; empty the cup regularly' },
  'refugium:refugium': { problem: 'Nitrate lingers with only water changes to export it', effect: 'Macroalgae export nitrate (0.5) and grow pod habitat', resource: 'Harvest macroalgae; runs a refugium light' },
  'ato:ato': { problem: 'Evaporation concentrates salt between top-offs', effect: 'Auto-replaces evaporated freshwater to hold salinity', resource: 'Refill the finite freshwater reservoir' },
  'feeder:auto': { problem: 'Fish miss feedings when unattended', effect: 'Dispenses scheduled portions to the surface', resource: 'Refill the hopper; tune interval and portions' },
}

function storeOffers(state: PocketState): PocketStoreOffer[] {
  const offer = (kind: PocketStoreOffer['kind'], group: PocketStoreOffer['group'], id: string, name: string,
    price: number, request: Record<string, unknown>, action: PocketAction,
    extra?: Partial<PocketStoreOffer>): PocketStoreOffer => {
    const result = runtime.validatePurchase(state, request)
    return { kind, group, id, name, price, allowed: result.ok, reasons: result.reasons, action, ...extra }
  }
  const livestock = Object.keys(runtime.DATA.SPECIES).map((id) => runtime.DATA.resolveSpecies(state, id))
    .filter((item): item is CatalogSpecies => Boolean(item && item.habitat === 'reef')).map((item) => {
    const count = runtime.DATA.BUNDLES[item.id] ?? 1
    const detail = `${item.sci} · ${item.adultSizeCm} cm adult · ${item.layer} layer`
    return offer('livestock', 'livestock', item.id, item.name, item.price * count,
      { kind: 'livestock', id: item.id, count }, { type: runtime.ACTIONS.PURCHASE_LIVESTOCK, species: item.id, count },
      { detail })
  })
  const corals = Object.values(runtime.DATA.CORALS).map((item) => offer('coral', 'coral', item.id, item.name, item.price,
    { kind: 'coral', id: item.id }, { type: runtime.ACTIONS.PURCHASE_CORAL, coral: item.id }))
  const equipment = Object.entries(runtime.DATA.EQUIPMENT).flatMap(([category, item]) => item.levels
    .map((level) => {
      const installed = state.equipment[category] === level.id
      const copy = EQUIPMENT_COPY[`${category}:${level.id}`]
      return offer('equipment', 'equipment', `${category}:${level.id}`, level.name, level.price,
        { kind: 'equipment', category, levelId: level.id },
        { type: runtime.ACTIONS.PURCHASE_EQUIPMENT, category, levelId: level.id },
        { installed, category: item.label,
          problemSolved: copy?.problem, durableEffect: copy?.effect, operatingResource: copy?.resource })
    }))
  const tiers = runtime.DATA.TIER_ORDER.filter((id) => id !== state.tier).map((id) => {
    const item = runtime.DATA.TIERS[id]
    return offer('tier', 'tank', id, item.name, item.price, { kind: 'tier', id },
      { type: runtime.ACTIONS.PURCHASE_TIER, tier: id })
  })
  return [...livestock, ...corals, ...equipment, ...tiers]
}

function objectiveFor(state: PocketState, guide: PocketGuideView): PocketObjective {
  if (!state.cycle.filled) return { chapter: 'Commissioning · 1 of 4', title: 'Mix saltwater and fill',
    detail: 'Bring the dry reef to its operating waterline at 35 ppt.',
    lesson: 'Saltwater establishes the habitat, but the filter still needs nitrifying bacteria.',
    destination: 'care', actionLabel: 'Fill the reef', action: { type: 'SETUP_FILL' } }
  if (!state.cycle.lifeSupport) return { chapter: 'Commissioning · 2 of 4', title: 'Start life support',
    detail: 'Turn on filtration, heat, oxygenation, and circulation.',
    lesson: 'Flow carries oxygen and dissolved waste to the biofilter.',
    destination: 'care', actionLabel: 'Start life support', action: { type: 'SETUP_LIFE_SUPPORT', on: true } }
  if (!state.cycle.ammoniaSource && !biologicalCycleEstablished(state)) return {
    chapter: 'Commissioning · 3 of 4', title: 'Feed the invisible filter',
    detail: 'Add a measured ammonia source before any animal enters.',
    lesson: 'A fishless ammonia dose grows the first bacterial colony.',
    destination: 'care', actionLabel: 'Add ammonia source', action: { type: 'ADD_AMMONIA_SOURCE', on: true } }
  if (!state.cycle.inoculated) return { chapter: 'Commissioning · 4 of 4', title: 'Seed nitrifying bacteria',
    detail: 'Inoculate the filter, then observe both colonies establish.',
    lesson: 'One colony converts ammonia to nitrite and another converts nitrite to nitrate.',
    destination: 'care', actionLabel: 'Inoculate filter', action: { type: 'INOCULATE_BACTERIA' } }
  const dead = state.livestock.filter((animal) => animal.alive === false)
  if (dead.length) return { chapter: 'Tank care · urgent', title: `Remove ${dead.length} dead ${dead.length === 1 ? 'resident' : 'residents'}`,
    detail: 'Dead livestock keeps decomposing until it is removed.',
    lesson: 'Prompt removal limits the ammonia pulse.', destination: 'care' }
  if (biologicalCycleEstablished(state) && (state.water.ammonia > .25 || state.water.nitrite > .25)) return {
    chapter: 'Tank care · urgent', title: 'Dilute toxic nitrogen now',
    detail: `Ammonia ${state.water.ammonia.toFixed(2)} · nitrite ${state.water.nitrite.toFixed(2)} mg/L`,
    lesson: 'A water change immediately lowers both toxic nitrogen compounds.',
    destination: 'care', actionLabel: 'Change 25% water', action: { type: 'WATER_CHANGE', fraction: .25 } }
  if (!biologicalCycleEstablished(state)) return { chapter: `Fishless cycle · ${state.cycle.stage}`, title: 'Watch the nitrogen cycle',
    detail: `Ammonia ${state.water.ammonia.toFixed(2)} → nitrite ${state.water.nitrite.toFixed(2)} → nitrate ${state.water.nitrate.toFixed(1)} mg/L`,
    lesson: 'Wait for ammonia and nitrite to fall while nitrate proves both colonies are working.',
    destination: 'care', actionLabel: state.speed >= 4 ? 'Test the water' : 'Observe at 4×',
    action: state.speed >= 4 ? { type: 'WATER_TEST' } : { type: 'SET_SPEED', speed: 4 } }
  if (!state.livestock.some((animal) => animal.alive !== false)) return { chapter: 'First stocking unlocked',
    title: 'Choose the first resident', detail: 'The biofilter is ready for a gradual first stocking.',
    lesson: 'Every animal adds waste, so stock slowly.', destination: 'store' }
  return { chapter: 'Living reef', title: guide.title, detail: guide.body,
    lesson: 'Observe animals and water together before intervening.', destination: 'care' }
}

function careRecommendations(state: PocketState, offers: readonly PocketStoreOffer[]): PocketCareRecommendation[] {
  const result: PocketCareRecommendation[] = []
  if (!state.cycle.filled || (!biologicalCycleEstablished(state) && state.livestock.length === 0)) return result
  const deadCount = state.livestock.filter((animal) => animal.alive === false).length
  if (deadCount) result.push({ severity: 'urgent', title: `Remove ${deadCount} dead ${deadCount === 1 ? 'resident' : 'residents'}`,
    cause: 'Decomposition releases ammonia continuously.' })
  if (biologicalCycleEstablished(state) && (state.water.ammonia > .25 || state.water.nitrite > .25)) {
    const upgradeId = state.equipment.filter === 'sponge' ? 'filter:hob' : 'filter:canister'
    const upgrade = offers.find((offer) => offer.id === upgradeId)
    result.push({ severity: 'urgent', title: 'Toxic nitrogen detected',
      cause: `Ammonia ${state.water.ammonia.toFixed(2)} and nitrite ${state.water.nitrite.toFixed(2)} mg/L stress gills.`,
      actionLabel: 'Change 25% water', action: { type: 'WATER_CHANGE', fraction: .25 },
      suggestedOfferId: upgradeId, suggestedOfferName: upgrade?.name })
  }
  const tier = runtime.DATA.TIERS[state.tier]
  if (state.water.levelL / Math.max(tier.volumeL, 1) < .92 || state.water.salinity > 36) {
    const upgrade = offers.find((offer) => offer.id === 'ato:ato')
    result.push({ severity: state.water.salinity > 38 ? 'urgent' : 'watch', title: 'Evaporation is concentrating salt',
      cause: 'Freshwater top-off restores volume without adding salt.', actionLabel: 'Top off freshwater',
      action: { type: 'WATER_TOP_OFF' }, suggestedOfferId: 'ato:ato', suggestedOfferName: upgrade?.name })
  }
  if (!result.length) result.push({ severity: 'stable', title: 'No intervention needed',
    cause: 'Routine observation is the right move.' })
  return result.slice(0, 4)
}

/** God-mode credit ceiling used only for Store validation/projection, never persisted. */
const GOD_MODE_CREDITS = Number.MAX_SAFE_INTEGER

export function projectPocketState(
  state: PocketState,
  options?: { readonly unlimitedCredits?: boolean },
): PocketGameView {
  const unlimitedCredits = Boolean(options?.unlimitedCredits)
  const tier = runtime.DATA.TIERS[state.tier]
  const light = runtime.DATA.equipLevel('light', state.equipment.light)
  const ato = runtime.DATA.equipLevel('ato', state.equipment.ato)
  const feederLevel = runtime.DATA.equipLevel('feeder', state.equipment.feeder)
  const automation = state.automation
  const atoInstalled = Boolean(ato?.autoTopOff)
  const atoTopping = atoInstalled && automation.ato.reservoirL > 0 && state.water.levelL < tier.volumeL - 0.05
  const feeder: PocketFeederView = { installed: Boolean(feederLevel?.autoFeed), enabled: automation.feeder.enabled,
    intervalDays: automation.feeder.intervalDays, portionsPerDispense: automation.feeder.portionsPerDispense,
    hopperPortions: automation.feeder.hopperPortions, capacity: automation.feeder.capacity, status: automation.feeder.status }
  const atoView: PocketAtoView = { installed: atoInstalled, reservoirL: automation.ato.reservoirL,
    capacityL: automation.ato.capacityL, topping: atoTopping }
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
  const lastFed = living.reduce((latest, animal) => Math.max(latest, animal.lastFedDay), -Infinity)
  const feedPulse = state.food.length ? 1 : clamp(1 - (state.time.days - lastFed) / 0.012)
  const saltFraction = clamp(state.water.salinity / 1000, 0, 0.2)
  const guide = runtime.sessionGuide.project(state)
  const habitatParameters = state.habitat ? runtime.DATA.HABITATS[state.habitat]?.params ?? [] : []
  const testedWater = habitatParameters.map((key: string): PocketTestedReading => {
    const reading = state.tests[key]
    const known = Boolean(reading?.known)
    const ageDays = known ? reading.ageDays : null
    return { key, value: known ? reading.value : null, known, ageDays,
      testedAtDay: ageDays === null ? null : Math.max(0, state.time.days - ageDays) }
  })
  let selection: PocketSelectionView | null = null
  if (state.selection?.entityType === 'coral') {
    const coral = state.corals.find((item) => item.id === state.selection?.id)
    const profile = coral ? runtime.DATA.CORALS[coral.species] : null
    if (coral && profile) selection = { entityType: 'coral', id: coral.id, title: profile.name,
      facts: [`${Math.round(coral.polyps)} polyps`, `Health ${Math.round(coral.health * 100)}%`,
        `Extension ${Math.round(coral.extension * 100)}%`] }
  } else if (state.selection) {
    const animal = state.livestock.find((item) => item.id === state.selection?.id)
    const profile = animal ? runtime.DATA.resolveSpecies(state, animal.species) : null
    if (animal && profile) selection = { entityType: 'livestock', id: animal.id, title: profile.name,
      facts: [profile.sci, `${animal.stage} · ${animal.sex}`, `Health ${Math.round(animal.health * 100)}%`,
        `Condition ${Math.round(animal.condition * 100)}%`, `Hunger ${Math.round(animal.hunger * 100)}%`] }
  }
  const residents = state.livestock.map((animal) => {
    const species = runtime.DATA.resolveSpecies(state, animal.species)
    if (!species) throw new Error(`Unknown root PA specimen: ${animal.species}`)
    return { ...animal, speciesId: animal.species, name: species.name, scientificName: species.sci,
      adultSizeCm: species.adultSizeCm, layer: species.layer, runtimeProfile: species }
  })
  // God mode validates and prices Store actions as if credits were unlimited, without ever
  // mutating the real dev-save balance the pill falls back to when the toggle is off.
  const validationState = unlimitedCredits ? { ...state, credits: GOD_MODE_CREDITS } : state
  const rawOffers = storeOffers(validationState)
  const recommendations = careRecommendations(validationState, rawOffers)
  const recommendedIds = new Set(recommendations.map((rec) => rec.suggestedOfferId).filter(Boolean) as string[])
  const offers = recommendedIds.size
    ? rawOffers.map((item) => recommendedIds.has(item.id) ? { ...item, recommended: true } : item)
    : rawOffers
  const deadResidents: PocketDeadResident[] = state.livestock
    .filter((animal) => animal.alive === false)
    .map((animal) => ({ id: animal.id, name: residents.find((r) => r.id === animal.id)?.name ?? animal.species,
      cause: animal.causeOfDeath ?? null }))
  const objective = objectiveFor(state, guide)
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
    equipment: { atoEnabled: Boolean(ato?.autoTopOff), atoReservoirLiters: automation.ato.reservoirL,
      atoReservoirCapacityLiters: automation.ato.capacityL, atoEmpty: atoInstalled && automation.ato.reservoirL <= 0.05,
      atoSetpointLiters: tier.volumeL, atoPumpLitersPerHour: atoTopping ? tier.volumeL * 0.012 / 24 : 0,
      feederInstalled: feeder.installed, feederEnabled: feeder.enabled,
      feederDispensing: feeder.enabled && feeder.status === 'dispensed' && state.food.length > 0,
      feederEmpty: feeder.installed && feeder.hopperPortions <= 0,
      filterLevel: state.equipment.filter, circulationLevel: state.equipment.circulation,
      lightLevel: state.equipment.light, skimmerLevel: state.equipment.skimmer, refugiumLevel: state.equipment.refugium,
      lightPower: clamp(state.water.par / Math.max(light?.parCeiling ?? 1, 1)), flowPower: clamp(state.water.flow) },
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
    events: { sequence: state.log.length + (feedPulse > 0 ? 1 : 0), lastEvent: feedPulse > 0 ? 'Feed dispatched through root PA' : state.log.at(-1)?.message ?? 'Reef ready',
      causalNote: feedPulse > 0 ? 'Root livestock hunger and the optical feed response share the same action.' : 'Pocket Aquarium advances all gameplay state.', feedPulse },
  }
  return { authority: 'root_pa', habitatName: 'Indo-Pacific sheltered lagoon reef', tierName: tier.name,
    credits: Math.floor(state.credits), unlimitedCredits, xp: Math.floor(state.xp), cycleStage: state.cycle.stage,
    cycled: biologicalCycleEstablished(state), filled: state.cycle.filled, cycle: { ...state.cycle }, water: { ...state.water },
    objective, residents, selectedSpecimen: residents.find((animal) => animal.id === state.selection?.id),
    specimens: residents.filter((animal) => animal.alive !== false),
    food: state.food.map(({ id, x, y, amount, ageDays, sunk }) => ({ id, x, y, amount, ageDays, sunk })),
    guide, testedWater,
    testFreshness: { label: String(guide.nextAction?.freshness ?? 'Never tested'),
      stale: Boolean(guide.nextAction?.stale ?? true), testedAtDay: guide.testedAtDay,
      readingAgeDays: guide.readingAgeDays },
    selection,
    clutches: state.clutches.map(({ id, species, stage, ageDays }) => ({ id, speciesId: species, stage, ageDays })),
    storeOffers: offers, careRecommendations: recommendations, deadResidents,
    feeder, ato: atoView,
    nextAction: { title: objective.title, detail: objective.detail }, alerts: [],
    optics: { localPpfd: reefSnapshot.lightField.localPpfd, mode: 'read_only' }, reefSnapshot }
}
