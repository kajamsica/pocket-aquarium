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
  water: PocketWater
  cycle: { stage: string; filled: boolean; lifeSupport: boolean }
  succession: { age: number; haze: number; diatom: number; greenFilm: number; cyano: number }
  livestock: PocketAnimal[]
  corals: PocketCoral[]
  clutches: PocketClutch[]
  microfauna: { pods: number; worms: number; infusoria: number; biodiversity: number }
  food: PocketFoodPellet[]
  tests: Record<string, PocketTestRecord>
  selection: { entityType: 'livestock' | 'coral'; id: number } | null
  log: Array<{ type: string; message: string }>
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
  readonly id: string
  readonly name: string
  readonly price: number
  readonly allowed: boolean
  readonly reasons: readonly string[]
  readonly action: PocketAction
}

export interface PocketGameView {
  readonly authority: 'root_pa'
  readonly habitatName: string
  readonly tierName: string
  readonly credits: number
  readonly xp: number
  readonly cycleStage: string
  readonly cycled: boolean
  readonly water: Readonly<PocketWater>
  readonly specimens: readonly PocketSpecimen[]
  readonly food: readonly PocketFoodPellet[]
  readonly guide: PocketGuideView
  readonly testedWater: readonly PocketTestedReading[]
  readonly testFreshness: PocketTestFreshness
  readonly selection: PocketSelectionView | null
  readonly clutches: readonly PocketClutchView[]
  readonly storeOffers: readonly PocketStoreOffer[]
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
  const livestock = Object.keys(runtime.DATA.SPECIES).map((id) => runtime.DATA.resolveSpecies(state, id))
    .filter((item): item is CatalogSpecies => Boolean(item && item.habitat === 'reef')).map((item) => {
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
    events: { sequence: state.log.length + (feedPulse > 0 ? 1 : 0), lastEvent: feedPulse > 0 ? 'Feed dispatched through root PA' : state.log.at(-1)?.message ?? 'Reef ready',
      causalNote: feedPulse > 0 ? 'Root livestock hunger and the optical feed response share the same action.' : 'Pocket Aquarium advances all gameplay state.', feedPulse },
  }
  return { authority: 'root_pa', habitatName: 'Indo-Pacific sheltered lagoon reef', tierName: tier.name,
    credits: Math.floor(state.credits), xp: Math.floor(state.xp), cycleStage: state.cycle.stage,
    cycled: runtime.DATA.isCycled(state), water: { ...state.water },
    specimens: living.map((animal) => { const species = runtime.DATA.resolveSpecies(state, animal.species); if (!species) throw new Error(`Unknown root PA specimen: ${animal.species}`); return { ...animal,
      speciesId: animal.species, name: species.name, scientificName: species.sci,
      adultSizeCm: species.adultSizeCm, layer: species.layer, runtimeProfile: species } }),
    food: state.food.map(({ id, x, y, amount, ageDays, sunk }) => ({ id, x, y, amount, ageDays, sunk })),
    guide, testedWater,
    testFreshness: { label: String(guide.nextAction?.freshness ?? 'Never tested'),
      stale: Boolean(guide.nextAction?.stale ?? true), testedAtDay: guide.testedAtDay,
      readingAgeDays: guide.readingAgeDays },
    selection,
    clutches: state.clutches.map(({ id, species, stage, ageDays }) => ({ id, speciesId: species, stage, ageDays })),
    storeOffers: storeOffers(state), optics: { localPpfd: reefSnapshot.lightField.localPpfd, mode: 'read_only' },
    reefSnapshot }
}
