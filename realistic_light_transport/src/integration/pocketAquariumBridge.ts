import '../../../js/specimenProfiles.js'
import '../../../js/data.js'
import '../../../js/sim.js'
import '../../../js/sessionGuide.js'

import type { LifecyclePhase, ReefSnapshot } from '../contracts'
import { sampleSpectralTransmittance } from '../scene/materials/spectralTransport'
import { ACCEPTED_SPECIES_IDS, specimenAssetFor } from '../scene/specimens/assetRegistry'

export const pocketShowcasePopulationAuthority = 'root_pa' as const
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
  /** Player-authored label, absent unless the resident has been renamed. */
  customName?: string
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
  variantId: string | null
  placement: PocketCoralPlacement | null
  health: number
  tissue: number
  extension: number
  polyps: number
  growth: number
  feedingReserve: number
  stress: number
}

export interface PocketCoralPlacement {
  readonly version: 1
  readonly surface: 'sand' | 'rock'
  readonly surfaceId: string
  readonly position: readonly [number, number, number]
  readonly normal: readonly [number, number, number]
  readonly yaw: number
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
  log: Array<{ day?: number; t?: number; type: string; message: string }>
  memorial: Array<{ species: string; name: string; ageDays: number; cause: string; day: number }>
  lastRealTimestamp: number
  nextId: number
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
  maturityDays: number
  profileRevision?: Readonly<{ package: number; biology: number; calibration: number; morphology: number; asset: string }>
}

interface CatalogCoral {
  id: string
  name: string
  price: number
  maturityGate: string
  par: { min: number; max: number }
  flow: { min: number; max: number }
  startPolyps: number
  defaultVariantId: string
  variants: readonly Readonly<{ id: string; displayName: string }>[]
}
interface CatalogTier { id: string; name: string; volumeL: number; price: number; bioloadCap: number; hardscapeSlots: number }
interface CatalogKeeperRank { id: string; name: string; minXp: number; rewardCredits: number }
interface EquipmentLevel { id: string; name: string; price: number; parCeiling?: number; autoTopOff?: boolean; reservoirCapacityL?: number; autoFeed?: boolean; hopperCapacity?: number }
interface Validation { ok: boolean; reasons: string[]; conflicts?: PocketPurchaseConflict[] }

/** One structured compatibility risk from the root's `livestockConflicts`, grouped per existing
 *  species and risk. `residentIds` are the exact living residents the risk is about, so a decision
 *  acts on them rather than on a species name. */
export interface PocketPurchaseConflict {
  readonly riskTag: 'predation' | 'territoriality' | 'invert_safety'
  readonly message: string
  readonly residentSpeciesId: string
  readonly residentName: string
  readonly residentIds: readonly number[]
  /** Sum of the root's own 50% sell-back for those residents. */
  readonly refundCredits: number
}

interface PocketRuntime {
  ACTIONS: Record<string, string>
  DATA: {
    saveKey: string
    secondsPerGameDay1x: number
    offlineCapDays: number
    ACTIONS: Record<string, string>
    BUNDLES: Record<string, number>
    SPECIES: Record<string, CatalogSpecies>
    CORALS: Record<string, CatalogCoral>
    TIERS: Record<string, CatalogTier>
    TIER_ORDER: string[]
    HABITATS: Record<string, { params: string[] }>
    EQUIPMENT: Record<string, { label: string; levels: EquipmentLevel[] }>
    KEEPER_RANKS: CatalogKeeperRank[]
    residentNameMaxLength: number
    resolveSpecies: (state: PocketState | null, speciesId: string) => CatalogSpecies | null
    equipLevel: (category: string, id: string) => EquipmentLevel | null
    paramBand: (habitat: string, key: string) => { target?: number } | null
    isCycled: (state: PocketState) => boolean
    isPeakPhotoperiod: (dayFraction: number) => boolean
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
  /** What to call this resident: its custom name when it has one, otherwise the species name. */
  readonly name: string
  /** Always the catalog species name, so a renamed resident never loses its species identity. */
  readonly speciesName: string
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
  /** Stable catalog category used to group equipment into one upgrade path. */
  readonly categoryId?: string
  /** Zero-based position in an ordered equipment/tank upgrade path. */
  readonly levelIndex?: number
  readonly levelCount?: number
  readonly installedLevelIndex?: number
  /** Human-readable system currently installed before this offer is purchased. */
  readonly installedName?: string
  readonly problemSolved?: string
  readonly durableEffect?: string
  readonly operatingResource?: string
  /** True when this exact equipment level is already installed (shown, never repurchased). */
  readonly installed?: boolean
  /** True when a live care recommendation points at this offer. */
  readonly recommended?: boolean
  /** Livestock-only fact line: scientific name · adult size · water layer. */
  readonly detail?: string
  /** Accepted-package display name, present only for species with an accepted visual. */
  readonly acceptedName?: string
  /** Authoring render of the accepted package, when its source candidate rendered one. */
  readonly acceptedPreviewUrl?: string
  /** Livestock-only: the structured compatibility risks standing between the player and this
   *  purchase, present only when compatibility is the *sole* thing blocking it. A physical or
   *  husbandry requirement is never negotiable, so an offer that also fails one of those keeps
   *  this absent and stays hard-locked with its `reasons`. */
  readonly conflicts?: readonly PocketPurchaseConflict[]
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
  readonly authority: typeof pocketShowcasePopulationAuthority
  readonly habitatName: string
  readonly tierName: string
  readonly credits: number
  /** True when God mode is active: every Store offer is free and purchasable, and the pill shows ∞. */
  readonly unlimitedCredits: boolean
  readonly xp: number
  readonly progression: PocketProgressionView
  readonly cycleStage: string
  readonly cycled: boolean
  readonly filled: boolean
  readonly cycle: Readonly<PocketState['cycle']>
  readonly objective: PocketObjective
  readonly water: Readonly<PocketWater>
  readonly specimens: readonly PocketSpecimen[]
  readonly residents: readonly PocketSpecimen[]
  readonly coralInventory: readonly PocketCoralView[]
  readonly placedCorals: readonly PocketCoralView[]
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

export interface PocketCoralView {
  readonly id: number
  readonly speciesId: string
  readonly variantId: string
  readonly speciesName: string
  readonly variantDisplayName: string
  readonly health: number
  readonly placement: PocketCoralPlacement | null
}

export interface PocketProgressionView {
  readonly rank: string
  readonly rankMinXp: number
  readonly nextRank: string | null
  readonly nextRankXp: number | null
  readonly xpToNext: number
  readonly progress: number
  readonly nextRewardCredits: number
  readonly recentMilestones: readonly string[]
  readonly earningPaths: readonly Readonly<{ label: string; reward: string }>[]
}

const runtime = (globalThis as unknown as { PA: PocketRuntime }).PA
export const pocketActions: Readonly<Record<string, string>> = Object.freeze({ ...runtime.ACTIONS })
/** The root's own cap on a resident's custom name, so a rename field cannot accept more text than
 *  `RENAME_LIVESTOCK` would keep. */
export const residentNameMaxLength = runtime.DATA.residentNameMaxLength
const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value))
const clone = (state: PocketState): PocketState => structuredClone(state)

function preparePocketReef(state: PocketState) {
  const act = runtime.ACTIONS
  const send = (action: PocketAction) => runtime.dispatch(state, action)
  send({ type: act.PURCHASE_TIER, tier: 'mid151' })
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
  send({ type: act.SEED_MICROFAUNA, culture: 'pods' })
  return send
}

export function createPocketReefShowcase(): PocketState {
  const state = runtime.createState({ habitat: 'reef', credits: 3000, seed: 0x51f15e })
  const send = preparePocketReef(state)
  const act = runtime.ACTIONS
  send({ type: act.PURCHASE_TIER, tier: 'xl757' })
  const acceptedDefaults = [...ACCEPTED_SPECIES_IDS].sort().map((speciesId) => {
    const asset = specimenAssetFor(speciesId)
    if (!asset) throw new Error(`Accepted showcase default is missing: ${speciesId}`)
    return asset
  })
  const animalDefaults = acceptedDefaults.filter((asset) => asset.category !== 'coral'
    && asset.speciesId !== 'epaulette_shark')
  state.livestock = animalDefaults.map((asset, index) => {
    const profile = runtime.DATA.resolveSpecies(state, asset.speciesId)
    if (!profile || profile.habitat !== 'reef')
      throw new Error(`Accepted showcase animal has no reef runtime profile: ${asset.speciesId}`)
    const row = Math.floor(index / 5)
    const layerY = profile.layer === 'bottom' ? .86 : profile.layer === 'top' ? .18 : .5
    return { id: index + 1, species: profile.id, kind: profile.kind, ageDays: profile.maturityDays,
      stage: 'adult', sex: 'unknown', hunger: .1, condition: 1, health: 1, alive: true,
      causeOfDeath: null, decayDays: 0, lastFedDay: state.time.days,
      x: .1 + (index % 5) * .2, y: clamp(layerY + (row - 2) * .03, .1, .92) }
  })
  const coralDefaults = acceptedDefaults.filter((asset) => asset.category === 'coral')
  state.corals = coralDefaults.map((asset, index) => {
    const profile = runtime.DATA.CORALS[asset.speciesId]
    const variantId = asset.variantId ?? profile?.defaultVariantId
    if (!profile || !profile.variants.some((variant) => variant.id === variantId))
      throw new Error(`Accepted showcase coral has no runtime variant: ${asset.key}`)
    return { id: animalDefaults.length + index + 1, species: profile.id, variantId, placement: null,
      health: 1, tissue: 1, extension: .8, polyps: profile.startPolyps, growth: .3,
      feedingReserve: .6, stress: 0 }
  })
  state.nextId = state.livestock.length + state.corals.length + 1
  send({ type: act.WATER_TEST })  // the store needs a peak-light PAR reading on file before it sells coral
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
/** Matches the root simulator's fixed sub-step so protection lands inside every tick. */
const DEV_SAFE_STEP_DAYS = 0.05

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

/** Removes one pooled match so only as many artifacts as prevented deaths are dropped. */
function takeMatch(pool: string[], matches: (value: string) => boolean): boolean {
  const index = pool.findIndex(matches)
  if (index < 0) return false
  pool.splice(index, 1)
  return true
}

/**
 * Advance the authoritative simulation in the root's own fixed sub-step, mutating `state` in place,
 * and reverse each death inside the step that produced it — before a later step can treat the body
 * as decaying biomass. Death is captured honestly (id/species/cause/day) and reversed only by
 * restoring `alive` plus the smallest health floor, then dropping the death log and memorial rows
 * that same step appended for it. Water, hunger, condition, age, food, credits, ecology, equipment,
 * and time are whatever the real ticks produced.
 */
function stepDaysDevSafe(state: PocketState, gameDays: number): PocketPreventedDeath[] {
  const prevented: PocketPreventedDeath[] = []
  let remaining = gameDays
  let guard = 0
  while (remaining > 1e-9 && guard++ < 200000) {
    const chunk = Math.min(remaining, DEV_SAFE_STEP_DAYS)
    remaining -= chunk
    const wasAlive = new Set<number>()
    for (const animal of state.livestock) if (animal.alive !== false) wasAlive.add(animal.id)
    const priorLog = new Set(state.log)
    const memorialBefore = state.memorial.length
    runtime.stepDays(state, chunk)
    const revivedSpecies: string[] = []
    const revivedNames: string[] = []
    for (const animal of state.livestock) {
      if (animal.alive !== false || !wasAlive.has(animal.id)) continue
      prevented.push({ id: animal.id, species: animal.species, cause: animal.causeOfDeath ?? 'unknown', day: state.time.days })
      animal.alive = true
      animal.causeOfDeath = null
      // The optimum is the only welfare policy here, and `killAnimal` zeroes health: leaving a
      // revived resident at 0 would re-kill it on the very next sub-step and log the same death
      // again, so the revival restores the same health `stabilizeDevSafe` re-asserts after the step.
      animal.health = 1
      revivedSpecies.push(animal.species)
      // Must be the same label `killAnimal` logs, custom name included, or a renamed resident's
      // prevented death would leave its death line behind in the log.
      revivedNames.push(animal.customName || runtime.DATA.resolveSpecies(state, animal.species)?.name || animal.species)
    }
    if (!revivedSpecies.length) continue
    // Drop only the records this step appended for these prevented deaths; earlier memorial/log
    // history and every non-death entry survive untouched.
    state.memorial = state.memorial.filter((entry, index) =>
      index < memorialBefore || !takeMatch(revivedSpecies, (species) => species === entry.species))
    state.log = state.log.filter((entry) =>
      priorLog.has(entry) || entry.type !== 'death'
      || !takeMatch(revivedNames, (name) => entry.message.startsWith(`${name} died`)))
  }
  return prevented
}

/**
 * Restore the tank to the catalog's own declared optimum, so a protected aquarium stops accruing
 * care hazards instead of merely surviving them. A filled tank returns to its current tier's volume,
 * which is also how `level` reads, so evaporation has no visible or chemical effect. Declared water
 * targets are pinned only once `isCycled` holds, leaving setup and fishless cycling meaningful, and
 * reuse `paramBand` rather than a second set of magic values. Elapsed time, age, growth, breeding,
 * food, equipment, credits, and setup/cycle progression are whatever the real ticks produced.
 */
function stabilizeDevSafe(state: PocketState): void {
  const fullVolumeL = runtime.DATA.TIERS[state.tier]?.volumeL
  if (state.cycle.filled && fullVolumeL) state.water.levelL = fullVolumeL
  if (state.habitat && runtime.DATA.isCycled(state)) {
    const water = state.water as unknown as Record<string, number>
    for (const key of runtime.DATA.HABITATS[state.habitat]?.params ?? []) {
      if (key === 'level') continue // held by volume above, not stored as its own reading
      const target = runtime.DATA.paramBand(state.habitat, key)?.target
      if (typeof target === 'number') water[key] = target
    }
  }
  // Only residents this tick left living are restored; the memorial keeps every earlier loss.
  for (const animal of state.livestock) {
    if (animal.alive === false) continue
    animal.health = 1
    animal.condition = 1
    animal.hunger = 0
    animal.alive = true
    animal.causeOfDeath = null
  }
  for (const coral of state.corals) {
    coral.health = 1
    coral.tissue = 1
    coral.extension = 1
    coral.stress = 0
  }
}

/**
 * Live dev tick: same paused/speed and commissioning contract as `runtime.step`, run through the
 * protected path. A pre-commissioning tank with no water or no running life support advances zero
 * game time; setup dispatches stay immediate. The optimal-state pass runs even on a zero-day tick,
 * so enabling God Mode normalizes an established tank immediately rather than on the next step.
 */
export function advancePocketStateDevSafe(
  state: PocketState,
  elapsedSeconds: number,
): { readonly state: PocketState; readonly prevented: readonly PocketPreventedDeath[] } {
  const next = clone(state)
  const days = next.speed > 0 && elapsedSeconds > 0 && next.cycle.filled && next.cycle.lifeSupport
    ? (elapsedSeconds * next.speed) / runtime.DATA.secondsPerGameDay1x
    : 0
  const prevented = stepDaysDevSafe(next, days)
  stabilizeDevSafe(next)
  return { state: next, prevented }
}

/**
 * Dev-only counterpart to `restorePocketGame`: identical sanitize and fresh/no-habitat fallback, but
 * away time is applied through the protected fixed step. Requested/applied days, the timestamp
 * advance, and the `offline` log line reuse the root's own `secondsPerGameDay1x`/`offlineCapDays`,
 * so an unprotected resident sees exactly the away time `runtime.offlineCatchUp` would have applied.
 */
export function restorePocketGameDevSafe(
  raw: unknown,
  now = Date.now(),
): { readonly state: PocketState; readonly prevented: readonly PocketPreventedDeath[] } {
  // Every exit normalizes, so a restored or adopted protected save paints at the optimum instead of
  // waiting for the first live tick -- including the throttled and background views that may not
  // tick for a while. Normal restore is a separate function and is untouched.
  const done = (state: PocketState, prevented: readonly PocketPreventedDeath[] = []) => {
    stabilizeDevSafe(state)
    return { state, prevented }
  }
  const state = runtime.sanitizeState(raw)
  if (!state.habitat) return done(createPocketNewGame())
  const elapsedMs = state.lastRealTimestamp ? now - state.lastRealTimestamp : 0
  if (!(elapsedMs > 1000)) return done(state)
  // Same freeze contract as `runtime.offlineCatchUp`: a paused save, or a pre-commissioning tank
  // with no water or no running life support, consumes the elapsed wall clock and accrues no away
  // time, so nothing steps, dies, or reaches the offline log — and nothing is deferred to the
  // resume or applied retroactively once life support starts.
  if (!(state.speed > 0) || !state.cycle.filled || !state.cycle.lifeSupport) {
    state.lastRealTimestamp += elapsedMs
    return done(state)
  }
  const cap = runtime.DATA.offlineCapDays
  const requested = elapsedMs / 1000 / runtime.DATA.secondsPerGameDay1x
  const applied = Math.min(Math.max(requested, 0), cap)
  const prevented = stepDaysDevSafe(state, applied)
  state.lastRealTimestamp += elapsedMs
  state.log.push({
    day: Math.floor(state.time.days), t: +state.time.days.toFixed(3), type: 'offline',
    message: `Away ${+applied.toFixed(3)} game day(s)${requested > cap ? ` (capped at ${cap})` : ''}.`,
  })
  return done(state, prevented)
}

export function dispatchPocketAction(
  state: PocketState,
  action: PocketAction,
  options?: { readonly godMode?: boolean },
): PocketState {
  const next = clone(state)
  if (!options?.godMode) return runtime.dispatch(next, action)
  // God Mode paints every Store offer purchasable, so the same dispatch must not be refused by the
  // validator that painted it — an enabled button the root rejects is the bug this closes. The
  // bypass is installed on the root's own `PA.validatePurchase` seam (which `js/sim.js` reads at
  // call time) for exactly this one synchronous dispatch, and `finally` always restores it: normal
  // play, every other caller, and the projection's own validation keep the unmodified gates.
  const validate = runtime.validatePurchase
  runtime.validatePurchase = (validated, request) => {
    const result = validate(validated, request)
    return result.ok ? result : { ok: true, reasons: [], conflicts: [] }
  }
  try { return runtime.dispatch(next, action) } finally { runtime.validatePurchase = validate }
}

function lifecycleFor(state: PocketState): LifecyclePhase {
  const nuisance = Math.max(state.succession.diatom, state.succession.greenFilm, state.succession.cyano)
  if (!state.cycle.filled) return 'commissioning'
  if (!runtime.DATA.isCycled(state)) return 'cycling'
  if (nuisance > 0.18) return 'ugly_phase'
  return state.cycle.stage === 'Mature biome' ? 'young_reef' : 'stabilizing'
}

function keeperProgression(state: PocketState): PocketProgressionView {
  const ranks = runtime.DATA.KEEPER_RANKS
  const currentIndex = Math.max(0, ranks.findLastIndex((rank) => state.xp >= rank.minXp))
  const current = ranks[currentIndex]
  const next = ranks[currentIndex + 1]
  const span = next ? Math.max(1, next.minXp - current.minXp) : 1
  return {
    rank: current.name,
    rankMinXp: current.minXp,
    nextRank: next?.name ?? null,
    nextRankXp: next?.minXp ?? null,
    xpToNext: next ? Math.max(0, next.minXp - state.xp) : 0,
    progress: next ? clamp((state.xp - current.minXp) / span) : 1,
    nextRewardCredits: next?.rewardCredits ?? 0,
    recentMilestones: state.log.filter((entry) => entry.type === 'milestone').slice(-5).reverse().map((entry) => entry.message),
    earningPaths: [
      { label: 'Maintain a safe, stable day with living residents', reward: '+5 XP · +8 credits' },
      { label: 'Advance the nitrogen cycle', reward: '+10–25 XP · +5–15 credits' },
      { label: 'Mature livestock or a coral colony', reward: '+8–30 XP' },
      { label: 'Establish breeding, hatching, and surviving fry', reward: '+25–40 XP · +12–25 credits' },
    ],
  }
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

/* Accepted specimen packages bundle only the GLB, so a Store card's still image is the authoring
 * render that produced it. The eager glob imports URL strings over a superset the way the runtime
 * asset registry already does with `**\/lod1.glb`, and the accepted registry — not the glob —
 * decides which one a species may show. A candidate that never rendered a preview (or whose
 * accepted `sourceCandidate` predates the render step) keeps the card's SVG glyph. */
const acceptedPreviewUrls = import.meta.glob('../../art/specimens/*/candidates/*/renders/author-preview.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Readonly<Record<string, string>>

/** Accepted visual metadata for a gameplay species; empty when the species has no accepted asset. */
function acceptedArtwork(speciesId: string): Partial<PocketStoreOffer> {
  const asset = specimenAssetFor(speciesId)
  if (!asset) return {}
  const preview = acceptedPreviewUrls[`../../art/specimens/${asset.speciesId}/candidates/${asset.sourceCandidate}/renders/author-preview.png`]
  return { acceptedName: asset.displayName, ...(preview ? { acceptedPreviewUrl: preview } : {}) }
}

function storeOffers(state: PocketState, godMode = false): PocketStoreOffer[] {
  const offer = (kind: PocketStoreOffer['kind'], group: PocketStoreOffer['group'], id: string, name: string,
    price: number, request: Record<string, unknown>, action: PocketAction,
    extra?: Partial<PocketStoreOffer>): PocketStoreOffer => {
    // God Mode is a sandbox store: every offer is free and purchasable whatever the tank's cycle,
    // water, maturity, PAR, volume, capacity, equipment, compatibility, or balance says.
    // `dispatchPocketAction` installs the matching bypass, so the root validator cannot refuse
    // what this card promised. Normal mode never reaches this branch.
    if (godMode) return { kind, group, id, name, price: 0, allowed: true, reasons: [], action, ...extra }
    const result = runtime.validatePurchase(state, request)
    // A compatibility conflict is a husbandry judgement the player is entitled to make, so when
    // every remaining reason is one of those conflict messages the card carries the structured
    // risks and offers a choice instead of a lock. Any other reason keeps the offer hard-locked.
    const conflicts = result.conflicts ?? []
    const negotiable = new Set(conflicts.map((item) => item.message))
    const riskOnly = conflicts.length > 0 && result.reasons.every((reason) => negotiable.has(reason))
    return { kind, group, id, name, price, allowed: result.ok, reasons: result.reasons, action,
      ...(riskOnly ? { conflicts } : {}), ...extra }
  }
  const livestock = Object.keys(runtime.DATA.SPECIES).map((id) => runtime.DATA.resolveSpecies(state, id))
    .filter((item): item is CatalogSpecies => Boolean(item && item.habitat === 'reef')).map((item) => {
    const count = runtime.DATA.BUNDLES[item.id] ?? 1
    const detail = `${item.sci} · ${item.adultSizeCm} cm adult · ${item.layer} layer`
    return offer('livestock', 'livestock', item.id, item.name, item.price * count,
      { kind: 'livestock', id: item.id, count }, { type: runtime.ACTIONS.PURCHASE_LIVESTOCK, species: item.id, count },
      { detail, ...acceptedArtwork(item.id) })
  })
  const corals = Object.values(runtime.DATA.CORALS).flatMap((item) => item.variants.map((variant) =>
    offer('coral', 'coral', `${item.id}@${variant.id}`, variant.displayName, item.price,
      { kind: 'coral', id: item.id, variantId: variant.id },
      { type: runtime.ACTIONS.PURCHASE_CORAL, coral: item.id, variantId: variant.id },
      { detail: `${item.name} · PAR ${item.par.min}–${item.par.max} µmol · flow ${item.flow.min}–${item.flow.max}`
        + ` · needs a ${item.maturityGate === 'mature' ? 'mature' : 'cycled'} biome` })))
  const equipment = Object.entries(runtime.DATA.EQUIPMENT).flatMap(([category, item]) => {
    const installedLevelIndex = item.levels.findIndex((level) => level.id === state.equipment[category])
    const installedName = item.levels[installedLevelIndex]?.name
    return item.levels.map((level, levelIndex) => {
      const installed = state.equipment[category] === level.id
      const copy = EQUIPMENT_COPY[`${category}:${level.id}`]
      return offer('equipment', 'equipment', `${category}:${level.id}`, level.name, level.price,
        { kind: 'equipment', category, levelId: level.id },
        { type: runtime.ACTIONS.PURCHASE_EQUIPMENT, category, levelId: level.id },
        { installed, category: item.label, categoryId: category, levelIndex, levelCount: item.levels.length,
          installedLevelIndex, installedName,
          problemSolved: copy?.problem, durableEffect: copy?.effect, operatingResource: copy?.resource })
    })
  })
  const tiers = runtime.DATA.TIER_ORDER.filter((id) => id !== state.tier).map((id) => {
    const item = runtime.DATA.TIERS[id]
    return offer('tier', 'tank', id, item.name, item.price, { kind: 'tier', id },
      { type: runtime.ACTIONS.PURCHASE_TIER, tier: id }, { levelIndex: runtime.DATA.TIER_ORDER.indexOf(id),
        levelCount: runtime.DATA.TIER_ORDER.length, installedLevelIndex: runtime.DATA.TIER_ORDER.indexOf(state.tier),
        installedName: runtime.DATA.TIERS[state.tier]?.name,
        detail: `${item.volumeL} L · ${item.bioloadCap} bioload capacity · ${item.hardscapeSlots} hardscape slots`
          + ' · arrives filled with habitat-matched conditioned water: salinity, alkalinity, calcium, and magnesium hold,'
          + ' accumulated nutrients dilute into the larger volume, and every water test needs a retest.' })
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
  const deadCount = state.livestock.filter((animal) => animal.alive === false).length
  if (deadCount) result.push({ severity: 'urgent', title: `Remove ${deadCount} dead ${deadCount === 1 ? 'resident' : 'residents'}`,
    cause: 'Decomposition releases ammonia continuously.' })
  // Welfare is read per living resident (one failing animal, not the tank average) and ranks
  // ahead of the water findings below, so a starving fish is never sent to clean water first.
  const living = state.livestock.filter((animal) => animal.alive !== false)
  if (living.length) {
    // Hunger rises past 1 as the overdue-feeding reserve; the percentage shown stays 0–100.
    const pct = (value: number) => Math.round(clamp(value) * 100)
    const worstHunger = Math.max(...living.map((animal) => animal.hunger))
    const worstCondition = Math.min(...living.map((animal) => animal.condition))
    const frailest = living.reduce((worst, animal) => animal.health < worst.health ? animal : worst)
    if (worstHunger > .85 || worstCondition < .30) result.push({ severity: 'urgent',
      title: 'Residents are underfed',
      cause: `Worst hunger ${pct(worstHunger)}% (feed above 85%) · worst body condition ${pct(worstCondition)}% (target above 30%). Body condition rebuilds gradually over small, repeated feedings; food left uneaten decays into ammonia.`,
      ...(worstHunger > .85 ? { actionLabel: 'Feed one portion', action: { type: 'FEED', x: .5 } } : {}) })
    else if (frailest.health < .30) result.push({ severity: 'urgent',
      title: `${frailest.customName || runtime.DATA.resolveSpecies(state, frailest.species)?.name || frailest.species} is in failing health`,
      cause: `Health ${pct(frailest.health)}% (critical below 30%) with hunger ${pct(frailest.hunger)}% and body condition ${pct(frailest.condition)}%, so feeding does not explain it. Open that resident under Livestock and read its details.` })
  }
  if (!state.habitat || !state.cycle.filled) return result

  const expected = runtime.DATA.HABITATS[state.habitat]?.params ?? []
  const readingsCurrent = expected.length > 0 && expected.every((key) => {
    const reading = state.tests[key]
    return Boolean(reading?.known && Number.isFinite(reading.ageDays) && reading.ageDays < .75)
  })
  if (!readingsCurrent) {
    result.push({ severity: 'watch', title: 'Test the water before intervening',
      cause: 'Run a complete water test so care advice uses current measured water rather than hidden chemistry.',
      actionLabel: 'Test the water', action: { type: 'WATER_TEST' } })
    return result.slice(0, 4)
  }

  const reading = (key: string) => state.tests[key]?.value ?? Number.NaN
  const suggestedOffers = new Set<string>()
  const recommend = (recommendation: PocketCareRecommendation, category?: string) => {
    const installedIndex = category
      ? offers.find((offer) => offer.kind === 'equipment' && offer.categoryId === category)?.installedLevelIndex ?? -1
      : -1
    const upgrade = category ? offers
      .filter((offer) => offer.kind === 'equipment' && offer.categoryId === category && !offer.installed
        && (offer.levelIndex ?? -1) > installedIndex)
      .sort((a, b) => (a.levelIndex ?? 0) - (b.levelIndex ?? 0))[0] : undefined
    if (upgrade && !suggestedOffers.has(upgrade.id)) {
      suggestedOffers.add(upgrade.id)
      result.push({ ...recommendation, suggestedOfferId: upgrade.id, suggestedOfferName: upgrade.name })
    } else result.push(recommendation)
  }

  const ammonia = reading('ammonia')
  const nitrite = reading('nitrite')
  const nitrate = reading('nitrate')
  const level = reading('level')
  const oxygen = reading('oxygen')
  const flow = reading('flow')
  const temperature = Math.round(reading('tempC') * 10) / 10 // Temperature decisions use the one decimal Water displays
  const reef = state.habitat === 'reef'
  const salinity = reef ? reading('salinity') : Number.NaN
  // An unstocked tank that has not finished cycling is supposed to read ammonia and nitrite: that is
  // the fishless dose feeding the two colonies, and no gills are exposed to it. Diluting it here would
  // strip the substrate the player is growing, so this phase teaches the sequence and points at the
  // same observe/test step the objective gives. Cycled, or anything alive in the water, keeps the
  // protective emergency below.
  const fishlessCycle = !biologicalCycleEstablished(state) && !living.length && !state.corals.length

  if (ammonia > .25 || nitrite > .25) {
    if (fishlessCycle) recommend({ severity: 'watch', title: 'Fishless cycle is processing nitrogen',
      cause: `Ammonia ${ammonia.toFixed(2)} → nitrite ${nitrite.toFixed(2)} → nitrate ${nitrate.toFixed(1)} mg/L. Expected while the tank cycles unstocked: one colony converts ammonia to nitrite, a second converts nitrite to nitrate. Keep observing and retesting until ammonia and nitrite fall back to zero — a water change now would dilute the food those colonies are growing on.`,
      actionLabel: state.speed >= 4 ? 'Test the water' : 'Observe at 4×',
      action: state.speed >= 4 ? { type: 'WATER_TEST' } : { type: 'SET_SPEED', speed: 4 } })
    else recommend({ severity: 'urgent', title: 'Toxic nitrogen detected',
      cause: `Ammonia ${ammonia.toFixed(2)} and nitrite ${nitrite.toFixed(2)} mg/L; target is 0–0.25 mg/L. Elevated nitrogen burns gills and impairs respiration.`,
      actionLabel: 'Change 25% water', action: { type: 'WATER_CHANGE', fraction: .25 } }, 'filter')
  }
  if (level < 92 || (reef && salinity > 36)) recommend({ severity: salinity > 38 || level < 80 ? 'urgent' : 'watch',
    title: reef ? 'Evaporation is concentrating salt' : 'Water level is below target',
    cause: reef
      ? `Water level ${level.toFixed(0)}% (target 92–100%) · salinity ${salinity.toFixed(1)} ppt (target 33–36). Low volume concentrates salt and stresses osmoregulation.`
      : `Water level ${level.toFixed(0)}%; target is 92–100%. Evaporation reduces swimming volume and concentrates dissolved waste.`,
    actionLabel: 'Top off freshwater', action: { type: 'WATER_TOP_OFF' } }, 'ato')
  if (oxygen < 6 || flow < .3) recommend({ severity: oxygen < 4.5 ? 'urgent' : 'watch',
    title: 'Oxygen or circulation is too low',
    cause: reef
      ? `Oxygen ${oxygen.toFixed(1)} mg/L (target at least 6) · flow ${flow.toFixed(2)} (target at least 0.30). Stagnant, oxygen-poor water stresses gills and creates detritus dead zones.`
      : `Oxygen ${oxygen.toFixed(1)} mg/L; target is at least 6. Oxygen-poor water stresses gills and limits the biofilter.` }, 'circulation')
  if (temperature < 24 || temperature > 28) recommend({ severity: temperature < 22 || temperature > 30 ? 'urgent' : 'watch',
    title: reef ? 'Temperature is outside the reef range' : 'Temperature is outside the habitat range',
    cause: `Temperature ${temperature.toFixed(1)} °C; target 24–28 °C. Thermal drift disrupts metabolism and compounds oxygen stress.` }, 'heater')
  const pH = Math.round(reading('pH') * 100) / 100 // pH decisions use the two decimals Water displays
  if (reef) {
    const phosphate = reading('phosphate')
    const alkalinity = reading('alkalinity')
    const par = Math.round(reading('par')) // PAR decisions use the zero decimals Water displays
    const parTestedFraction = Math.max(0, state.time.days - (state.tests.par?.ageDays ?? 0)) % 1
    // Reef PAR is specified at the schedule's peak, so only a reading captured inside the store's
    // representative window judges the fixture. Lights-off and the programmed dawn/dusk ramp are
    // neutral context: explain them and ask for a peak retest instead of selling a light.
    const parTestedOffPeak = !runtime.DATA.isPeakPhotoperiod(parTestedFraction)
    if (nitrate > 15) recommend({ severity: nitrate > 40 ? 'urgent' : 'watch', title: 'Nitrate is accumulating',
      cause: `Nitrate ${nitrate.toFixed(1)} mg/L; reef target is 0–15 mg/L. Chronic excess fuels nuisance growth and stresses coral tissue.`,
      actionLabel: 'Change 25% water', action: { type: 'WATER_CHANGE', fraction: .25 } }, 'refugium')
    if (phosphate > .1) recommend({ severity: phosphate > .25 ? 'urgent' : 'watch', title: 'Phosphate is accumulating',
      cause: `Phosphate ${phosphate.toFixed(2)} mg/L; reef target is 0–0.10 mg/L. Excess phosphate feeds nuisance growth and suppresses coral calcification.`,
      actionLabel: 'Change 25% water', action: { type: 'WATER_CHANGE', fraction: .25 } }, 'skimmer')
    const bufferOut = alkalinity < 7 || alkalinity > 11
    if (pH < 8 || pH > 8.4 || bufferOut) recommend({ severity: 'watch',
      title: 'pH or alkalinity is outside target',
      cause: `pH ${pH.toFixed(2)} (target 8.0–8.4) · alkalinity ${alkalinity.toFixed(1)} dKH (target 7–11). ${bufferOut ? 'The carbonate buffer is off-band, so pH cannot hold — a 25% change with matched water pulls alkalinity back toward 8.5 dKH.' : 'The buffer is adequate, so time at 4× lets pH settle toward its alkalinity-buffered equilibrium.'} Retest afterward; rapid swings impair coral calcification.`,
      actionLabel: bufferOut ? 'Change 25% water' : 'Stabilize at 4×',
      action: bufferOut ? { type: 'WATER_CHANGE', fraction: .25 } : { type: 'SET_SPEED', speed: 4 } })
    if (state.corals.length && (par < 40 || par > 220)) recommend({ severity: parTestedOffPeak ? 'stable' : 'watch',
      title: parTestedOffPeak ? 'Coral PAR was captured away from peak light' : `Coral PAR is ${par < 40 ? 'too low' : 'too high'}`,
      cause: parTestedOffPeak
        ? `PAR ${par.toFixed(0)} µmol was captured outside peak light (about 11:56–15:25 game time), where the programmed dawn/dusk ramp — or lights-off — reads off target by design. Retest near peak light before changing equipment.`
        : `PAR ${par.toFixed(0)} µmol (target 40–220 for this stocked reef). ${par < 40 ? 'Insufficient usable light limits coral energy and growth.' : 'Excess usable light can bleach coral tissue; reduce intensity or duration.'}` },
      par < 40 && !parTestedOffPeak ? 'light' : undefined)
    if (state.succession.cyano > .4) recommend({ severity: 'watch', title: 'Cyanobacteria is overtaking the reef',
      cause: `Coverage ${Math.round(state.succession.cyano * 100)}% (target below 40%). Thick mats smother surfaces and signal nutrient-rich dead zones.` }, 'circulation')
  } else {
    const hardness = reading('hardness')
    const tannin = reading('tannin')
    if (nitrate > 40) recommend({ severity: nitrate > 80 ? 'urgent' : 'watch', title: 'Nitrate is accumulating',
      cause: `Nitrate ${nitrate.toFixed(1)} mg/L; freshwater target is 0–40 mg/L. Chronic excess degrades water quality and stresses fish.`,
      actionLabel: 'Change 25% water', action: { type: 'WATER_CHANGE', fraction: .25 } })
    if (pH < 6 || pH > 7) recommend({ severity: 'watch', title: 'pH is outside the blackwater range',
      cause: `pH ${pH.toFixed(2)}; target is 6.0–7.0. Correct gradually and retest because rapid pH swings stress fish.` })
    if (hardness < 1 || hardness > 6) recommend({ severity: 'watch', title: 'Hardness is outside target',
      cause: `Hardness ${hardness.toFixed(1)} dGH; target is 1–6 dGH. Water outside the soft-water range disrupts osmoregulation.`,
      ...(hardness > 6 ? { actionLabel: 'Change 25% water', action: { type: 'WATER_CHANGE', fraction: .25 } } : {}) })
    if (tannin < .3 || tannin > 1) recommend({ severity: 'watch', title: 'Tannin is outside target',
      cause: `Tannin ${tannin.toFixed(2)}; target is 0.3–1.0. Blackwater chemistry outside this band destabilizes habitat conditions.`,
      ...(tannin > 1 ? { actionLabel: 'Change 25% water', action: { type: 'WATER_CHANGE', fraction: .25 } } : {}) })
  }
  if (!result.length) result.push({ severity: 'stable', title: 'No intervention needed',
    cause: 'Tested habitat parameters are within target; continue routine observation.' })
  return result.slice(0, 4)
}

export function projectPocketState(
  state: PocketState,
  options?: { readonly godMode?: boolean },
): PocketGameView {
  const godMode = Boolean(options?.godMode)
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
  const coralViews: PocketCoralView[] = state.corals.map((coral) => {
    const species = runtime.DATA.CORALS[coral.species]
    const variantId = coral.variantId || species.defaultVariantId
    const variant = species.variants.find((item) => item.id === variantId)
    return { id: coral.id, speciesId: coral.species, variantId, speciesName: species.name,
      variantDisplayName: variant?.displayName ?? species.name, health: coral.health,
      placement: coral.placement }
  })
  const coralInventory = coralViews.filter((coral) => coral.placement === null)
  const placedCorals = coralViews.filter((coral) => coral.placement !== null)
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
    // A renamed resident leads with its name and keeps the species name as its first fact.
    if (animal && profile) selection = { entityType: 'livestock', id: animal.id,
      title: animal.customName || profile.name,
      facts: [...(animal.customName ? [profile.name] : []), profile.sci,
        `${animal.stage} · ${animal.sex}`, `Health ${Math.round(animal.health * 100)}%`,
        `Condition ${Math.round(animal.condition * 100)}%`, `Hunger ${Math.round(clamp(animal.hunger) * 100)}%`] }
  }
  const residents = state.livestock.map((animal) => {
    const species = runtime.DATA.resolveSpecies(state, animal.species)
    if (!species) throw new Error(`Unknown root PA specimen: ${animal.species}`)
    // A custom name replaces only what the resident is *called*; species name, scientific name,
    // size, layer, and the runtime profile stay the species' own, so identity survives a rename.
    return { ...animal, speciesId: animal.species, name: animal.customName || species.name,
      speciesName: species.name, scientificName: species.sci,
      adultSizeCm: species.adultSizeCm, layer: species.layer, runtimeProfile: species }
  })
  // God mode projects the Store as a sandbox without ever mutating the real dev-save balance the
  // pill falls back to when the toggle is off. Care advice still reads the true tank.
  const rawOffers = storeOffers(state, godMode)
  const recommendations = careRecommendations(state, rawOffers)
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
      polypExtension: placedCorals.length ? state.corals.filter((coral) => coral.placement)
        .reduce((sum, coral) => sum + coral.extension, 0) / placedCorals.length : 0 },
    livestock: { clownfishCount: fish.filter((animal) => animal.species === 'ocellaris').length,
      smallReefFishCount: fish.filter((animal) => animal.species !== 'ocellaris').length,
      fishSatiation: clamp(1 - hunger), fishStress: clamp(1 - health),
      coralHealth: corals.length ? corals.reduce((sum, coral) => sum + coral.health, 0) / corals.length : 0,
      corals: corals.map(({ id, species, health: colonyHealth, extension, polyps, growth }) =>
        ({ id, species, health: colonyHealth, extension, polyps, growth })) },
    lightField: { surfacePpfd: state.water.par, localPpfd: state.water.par * transmission * (1 - shading), sampleDepthMeters: depth,
      interfaceTransmission: 0.96, attenuationPerMeter: attenuation, shading },
    events: { sequence: state.log.length, lastEvent: state.log.at(-1)?.message ?? 'Reef ready',
      causalNote: 'Pocket Aquarium advances all gameplay state.', feedPulse },
  }
  return { authority: pocketShowcasePopulationAuthority, habitatName: 'Indo-Pacific sheltered lagoon reef', tierName: tier.name,
    credits: Math.floor(state.credits), unlimitedCredits: godMode, xp: Math.floor(state.xp), progression: keeperProgression(state), cycleStage: state.cycle.stage,
    cycled: biologicalCycleEstablished(state), filled: state.cycle.filled, cycle: { ...state.cycle }, water: { ...state.water },
    objective, residents, coralInventory, placedCorals,
    selectedSpecimen: residents.find((animal) => animal.id === state.selection?.id),
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
