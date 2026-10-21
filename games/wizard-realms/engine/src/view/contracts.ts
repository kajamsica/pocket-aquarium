import type { DigSiteId, InscriptionId, SkillId, SpellId, TerrainId } from '../domain/types'
import type { FieldCampActionResult } from '../domain/fieldCamp'
import type { TerrainWorkSite } from '../domain/terrainWorks'
import type { PublicV13BuildPreview } from '../domain/publicV13BuildPreview'
import type { BuiltTerrainWorkTrialSite, TerrainWorkTrialRejection, TerrainWorkTrialState } from '../domain/terrainWorkTrial'
import type { PublicV11RoutePosition } from '../domain/publicV11RouteSupport'
import type { StarterCliffFace } from '../domain/starterCliffProfile'
import type { PublicV23ResolvedSite } from '../domain/publicWorldV23Sites'
import type { PublicV26ValleyRimSegment } from '../domain/publicWorldV26ValleyRim'
import type { PublicV29Mineral } from '../domain/publicWorldV29MineralSale'
import type { PublicV29PickTier } from '../domain/publicWorldV29MiningTools'
import type { SurveyorCrossingQuest } from './surveyorCrossingQuest'
import type { PublicV35LedgerQuest } from './publicV35LedgerQuest'
import type { PublicV36MarkerQuest } from './publicV36MarkerQuest'
import type { PublicV38SignalQuest } from './publicV38SignalQuest'
import type { PublicV39RingkeeperQuest } from './publicV39RingkeeperQuest'
import type { PublicV40WaystationQuest } from './publicV40WaystationQuest'
import type { PublicV41IronHallView } from './publicV41IronHallQuest'
import type { PublicV42IronHallView } from './publicV42IronHallQuest'

export type Vec2 = readonly [number, number]
export type Vec3 = readonly [number, number, number]

export type EquipmentSlot = 'head' | 'chest' | 'legs' | 'feet' | 'mainHand' | 'offHand'

export interface WizardItemStack {
  id: string
  itemId: string
  name: string
  quantity: number
  icon?: string
  equippableSlots?: readonly EquipmentSlot[]
  suggestedTradePrice?: number
}

export interface WizardTerrainCell {
  id: string
  position: Vec3
  size: readonly [number, number]
  height: number
  climate: string
  color?: string
  /** Visual-only surface tag in the authored Mireglass core and adjacent wetland rim. */
  mireglassTerrain?: TerrainId
  /** Display-only dry approach dressing; never changes tile collision or movement. */
  mireglassApproach?: boolean
  /** Display-only world [x,z] centerline clipped to this cell; adjacent endpoints meet. */
  mireglassTrailSegment?: { from: Vec2; to: Vec2 }
  /** V11 display-only stone palette or dry route. Never changes collision or terrain authority. */
  highlandSurface?: 'trail' | 'quarry'
  highlandTrailSegment?: { from: Vec2; to: Vec2 }
  /** V14 display-only ridge footprint; scenery never changes movement authority. */
  highlandRidgeCell?: 'rock' | 'gallery'
}

/** V26 presentation only. Both heights come from one checked saved column and its revealed tile. */
export interface WizardV26PitLadder {
  cellId: string
  gx: number
  gz: number
  floorY: number
  rimY: number
}

/** Bounded, discovery-gated scenery. Gameplay and interaction still use the region-owned arrays. */
export interface WizardVisualWorld {
  terrain: readonly WizardTerrainCell[]
  resources: readonly WizardResourceNode[]
  stores: readonly WizardStore[]
  fairyRings: readonly WizardFairyRing[]
  inscriptions: readonly WizardInscription[]
  digSites: readonly WizardDigSite[]
  landmarks: readonly WizardLandmark[]
  routes: readonly WizardRoute[]
  buildSites: readonly WizardBuildSite[]
  /** Persisted discoveries; other cells in the bounded window remain opaque fog. */
  discoveredTileIds: readonly string[]
}

export interface WizardResourceNode {
  id: string
  kind: 'tree' | 'ore' | 'herb' | 'other'
  label: string
  position: Vec3
  available: boolean
  /** V11 quarry rock art; ordinary ore keeps its previous model. */
  visualKind?: 'highland-stone' | 'mireglass-timber'
}

export interface WizardStoreListing {
  id: string
  name: string
  price: number
  stock?: number
}

export interface WizardStore {
  id: string
  name: string
  position: Vec3
  listings: readonly WizardStoreListing[]
  sellOffers: readonly { itemId: string; name: string; quantity: number; unitPrice: number }[]
}

export interface WizardFairyRingDestination {
  ringId: string
  label: string
  discovered: boolean
}

export interface WizardFairyRing {
  id: string
  label: string
  position: Vec3
  discovered: boolean
  destinations: readonly WizardFairyRingDestination[]
}

export interface WizardInscription {
  id: InscriptionId
  name: string
  position: Vec3
  spellId: SpellId
  studied: boolean
}

export interface WizardDigSite {
  id: DigSiteId
  name: string
  position: Vec3
  revealed: boolean
  excavated: boolean
  minimumExcavationLevel: number
}

/** Projection-only regional scenery. Presence and progression come from campaign state. */
export type WizardLandmark =
  | { id: 'greenway/landmark/west_trail_gate'; kind: 'west-trail-gate'; position: Vec3 }
  | { id: 'mireglass_reach/landmark/fringe_marker'; kind: 'frontier-marker'; position: Vec3; studied: boolean }
  | { id: 'mireglass_reach/landmark/bell_alder'; kind: 'bell-alder'; position: Vec3 }
  | { id: 'mireglass_reach/dig/seal_cache'; kind: 'seal-cache'; position: Vec3; revealed: boolean; excavated: boolean }
  | { id: 'highland_quarry/landmark/quarry_crown'; kind: 'quarry-crown'; position: Vec3; discovered: boolean }

export interface WizardTradeListing {
  id: string
  itemId?: string
  itemName: string
  quantity: number
  unitPrice: number
}

export interface WizardInteractionPrompt {
  kind: 'resource' | 'store' | 'fairy-ring' | 'route' | 'inscription' | 'dig-site' | 'other'
  targetId: string
  label: string
  action: string
  actionable: boolean
}

export interface WizardRoute {
  id: string
  label: string
  from: Vec3
  to: Vec3
  built: boolean
  unlocked: boolean
  logCost: number
}

export interface WizardBuildSite {
  id: string
  routeId: string
  label: string
  from: Vec3
  to: Vec3
  logCost: number
  status: 'ready' | 'locked' | 'too_far' | 'needs_logs' | 'obstructed' | 'built'
  reason: string
  discovered: boolean
}

export interface WizardFieldCamp {
  tileId: string
  position: Vec3
}

export interface WizardFieldCampPreview {
  tileId: string
  position: Vec3 | null
  rejection: NonNullable<FieldCampActionResult['rejection']> | null
}

export interface WizardFieldCampView {
  camps: readonly WizardFieldCamp[]
  preview: WizardFieldCampPreview | null
  selectionEnabled: boolean
  /** Secondary route hint for an unbuilt v9 camp; absent from older projections. */
  guidance?: string | null
}

/** Development-only, unsaved terrain-work projection. IDs and geometry come from the trial authority. */
export interface WizardTerrainWorkTrialView {
  kit: TerrainWorkTrialState['kit']
  bootsEquipped: boolean
  candidates: readonly { site: TerrainWorkSite; rejection: TerrainWorkTrialRejection | null }[]
  selectedId: string | null
  selectedSite: TerrainWorkSite | null
  selectedRejection: TerrainWorkTrialRejection | null
  builtSites: readonly BuiltTerrainWorkTrialSite[]
}

/** Saved v13 ledger and bounded, read-only aim preview. Never carries a trial kit. */
export interface WizardSavedTerrainWorksView {
  builtSites: readonly Exclude<TerrainWorkSite, { kind: 'dig' }>[]
  dugTileIds: readonly string[]
  preview: PublicV13BuildPreview | null
  /** V17-only unsaved, discovery-gated scenery; never an actionable preview. */
  suggestedSites?: readonly TerrainWorkSite[]
  /** Versioned display context only. Work IDs and checked writers remain authoritative. */
  context?: 'starter-greenway' | 'works3-greenway' | 'works4-greenway' | 'v28-river'
  /** Only the checkpointed v13 controller may enable these controls. */
  actionsEnabled?: boolean
  /** Local v13 input mode; it is never written to the world save. */
  modeActive?: boolean
  selectedKind?: TerrainWorkSite['kind']
  /** V17-only transient world X under the creek/cliff reticle. */
  aimX?: number | null
}

/** V30 read-only, locally discovered post. The checked claim preview owns readiness. */
export interface WizardV30BridgeheadPost {
  bridgeId: string
  position: Vec3
  tileId: string
  claimed: boolean
  claimReady: boolean
  reward: 'basic-pick' | 'coins' | null
}

/** Optional scene-only V23 ladder data, supplied from validated canonical sites. */
export interface WizardRegionalLaddersView {
  builtSites: readonly PublicV23ResolvedSite[]
  preview: { site: PublicV23ResolvedSite; rejection: string | null } | null
}

export interface WizardMapTile {
  id: string
  gridX: number
  gridZ: number
  terrain: string | null
  biome: string | null
  discovered: boolean
  /** Effective ground height for a known altered cell; omitted by seed-only worlds. */
  elevationMeters?: number
  /** V31-only placed soil lift; never inferred from another changed elevation. */
  hasRaisedSoil?: boolean
  /** Discovered, active-known natural Mireglass plateau, presentation only. */
  hasNaturalMireglassShelf?: boolean
  hasResource: boolean
  /** Discovered, available dry Mireglass timber; presentation only. */
  hasMireglassTimber?: boolean
  hasStore: boolean
  hasRing: boolean
  hasWaystone?: boolean
  /** A learned destination marker, which may sit on a still-unexplored tile. */
  hasWestTrail?: boolean
  /** V42-only learned center bridge approach, not a traversable deck until built. */
  hasCenterBridgeRoute?: boolean
  /** V11 only. These cues mark walked and discovered ground, never remote fog. */
  hasEastTrail?: boolean
  hasHighlandTrail?: boolean
  hasHighlandLandmark?: boolean
  hasHighlandNode?: boolean
  highlandNodeReady?: boolean
  /** A known route/target does not reveal the surrounding terrain. */
  hasFrontierTrail?: boolean
  hasFrontierMarker?: boolean
  hasRouteSite: boolean
  /** A discovered dig site in the unsaved trial or v11 Greenway; never marks unknown ground. */
  hasDigSite?: boolean
  hasBuiltRoute: boolean
  /** V30-only discovered, locally streamed saved-bridge far-exit marker. */
  hasBridgeheadPost?: boolean
  hasCache?: boolean
  hasCamp?: boolean
  /** Transient canonical footprint suitability, shown only for discovered v9 camp choices. */
  campSuitable?: boolean
}

/** One 64 m chunk, with color sampled only from terrain the player has discovered. */
export interface WizardOverviewCell {
  id: string
  gridX: number
  gridZ: number
  discoveredCells: number
  terrain: TerrainId | null
  biome: string | null
  markers: readonly string[]
}

export interface WizardWorldOverview {
  cells: readonly WizardOverviewCell[]
  player: { gridX: number; gridZ: number; yaw: number }
}

/** The Windward Step ledger remains in the authoritative world state. */
export interface WizardWindwardStepView {
  learned: boolean
  /** V37 readiness comes from checked spell witnesses and effective support. */
  checkedActions?: boolean
  glyph: { position: Vec3; canStudy: boolean } | null
  activeSeconds: number
  cooldownSeconds: number
  canCast: boolean
  /** A read-only projection may retain learning/status while compact action authority is unavailable. */
  unavailableReason?: string
  stoneReturn?: {
    quantity: number
    offers: readonly { storeId: string; name: string; unitPrice: number; total: number }[]
  }
}

export interface WizardViewProjection {
  seed: string
  tick: number
  player: {
    position: Vec3
    yaw: number
    pitch: number
    /** Read-only jump animation signal; absent on older view projections. */
    verticalVelocity?: number
  }
  terrain: readonly WizardTerrainCell[]
  /** Optional continuous scene data for the public world, never an action source. */
  visualWorld?: WizardVisualWorld
  /** V42 checked Works bridge selected for read-only frontier trail presentation. */
  v42FrontierBridgeId?: string
  /** Unsaved streamed preview scene mask; absent from campaign views. */
  previewSceneDiscoveryIds?: readonly string[]
  resources: readonly WizardResourceNode[]
  fairyRings: readonly WizardFairyRing[]
  inscriptions: readonly WizardInscription[]
  digSites: readonly WizardDigSite[]
  /** Optional so legacy Greenway projections keep their scene unchanged. */
  landmarks?: readonly WizardLandmark[]
  skillXp: Readonly<Record<SkillId, number>>
  learnedSpellIds: readonly SpellId[]
  routes: readonly WizardRoute[]
  buildSites: readonly WizardBuildSite[]
  selectedBuildSiteId: string | null
  fieldCamp?: WizardFieldCampView
  terrainWorkTrial?: WizardTerrainWorkTrialView
  savedTerrainWorks?: WizardSavedTerrainWorksView
  v30Bridgehead?: WizardV30BridgeheadPost
  /** V34 read-only quest journal, derived from checked works and claim state. */
  v34Quest?: SurveyorCrossingQuest
  /** V35 journal and local checked-action previews, never reward authority. */
  v35LedgerQuest?: PublicV35LedgerQuest
  v35LedgerSurvey?: Readonly<{ bridgeId: string; rejection: string | null; hint: string | null }>
  v35LedgerDeliver?: Readonly<{ rejection: string | null; hint: string | null }>
  /** V36 read-only marker chapter and local checked-action preview, never reward authority. */
  v36MarkerQuest?: PublicV36MarkerQuest
  v36MarkerClaim?: Readonly<{ rejection: string | null; hint: string | null }>
  /** V38 journal and revealed landmark are read-only projections, never witness authority. */
  v38SignalQuest?: PublicV38SignalQuest
  v38SignalVane?: Readonly<{ position: Vec3; inspected: boolean }> | null
  /** V39 read-only optional chapter and revealed Quarry ring, never travel authority. */
  v39RingkeeperQuest?: PublicV39RingkeeperQuest
  v39QuarryRing?: Readonly<{ position: Vec3; discovered: boolean }> | null
  /** V40 read-only chapter and discovery-gated marker. Neither authorizes barter, Works or rewards. */
  v40WaystationQuest?: PublicV40WaystationQuest
  v40WaystationSite?: Readonly<{ id: string; approach: Vec3; exit: Vec3; built: boolean; revealed: boolean }> | null
  /** V41 presentation only. Checked combat and frame replay own health, damage and defeat. */
  v41IronHall?: PublicV41IronHallView
  v41IronHallSite?: Readonly<{ alcove: Vec3; ward: Vec3; door: Vec3; revealed: boolean }> | null
  /** V42 read-only quest gear and checked action previews. Reward authority stays in the V42 writer. */
  v42IronHall?: PublicV42IronHallView
  v42QuartermasterSite?: Readonly<{ position: Vec3; revealed: true }> | null
  /** V44 read-only adult presentation. Checked mount state and movement remain in the V44 writer. */
  groundMount?: Readonly<{ mode: 'parked' | 'riding'; position: Vec3; yaw: number }>
  regionalLadders?: WizardRegionalLaddersView
  /** Streamed v13 hides unsupported legacy actions while retaining their read-only state. */
  unavailableActions?: true
  /** V24 streamed read view: the checked region supports switching gear, not unequipping it. */
  unsupportedEquipmentUnequipReason?: string
  /** V24 checked equip capability for owned items; missing items cannot use shared Equip. */
  checkedEquipmentChoices?: readonly { itemId: string; actionable: boolean; reason: string | null }[]
  /** V24 shared controls must mirror the currently checked regional choice. */
  checkedActionChoices?: readonly { id: string; actionable: boolean; reason: string | null }[]
  /** V33 only: expose the existing fairy panel at a checked Greenway ring. */
  v33FairyTravel?: boolean
  /** V24 streamed read view: player trade listings have no checked regional action. */
  unsupportedTradeListingsReason?: string
  /** V13 save gate only; absent in older worlds, which retain their existing controls. */
  controllerActionsEnabled?: boolean
  /** Only Wayfinder Glow is supported on streamed v13, while its save gate is open. */
  streamedSpellAvailable?: boolean
  /** V11-only presentation marker, present throughout the world even away from a built route. */
  physicalRoutes?: { active: PublicV11RoutePosition | null }
  /** Validated v14-only face. Its absence preserves every older Greenway route visual. */
  starterCliff?: { face: StarterCliffFace; ladder: 'built' | 'preview' | null }
  /** V11-only, read from the committed node ledger. Actions still validate in authority. */
  highlandExtraction?: { nodeId: string; label: string; actionable: boolean; reason: string }
  /** V11-only ambient identity; no physical or simulation effect. */
  ambience?: 'highland-wind'
  /** V14-only ridge scenery, omitted from earlier public world projections. */
  highlandRidgeActive?: true
  /** V25-only visual river. The canonical river predicate also owns passage checks. */
  v25RiverActive?: boolean
  /** V26 checked boundary geometry, used only for read-only scene meshes. */
  v26ValleyRimSegments?: readonly PublicV26ValleyRimSegment[]
  /** V27-only presentation opt-in for ordinary 0.8 m dry ground links. */
  v27WalkableSurface?: boolean
  /** V28 streamed map memory: checked global Greenway Works survive the owner handoff. */
  v28TravelContinuity?: Readonly<{
    position: Vec3
    greenwayLadders: readonly Readonly<{ id: string; from: Vec3; to: Vec3 }>[]
  }>
  /** Saved pit ladders projected only onto revealed canonical 4 m ground. */
  v26PitLadders?: readonly WizardV26PitLadder[]
  /** Read-only checked excavation rewards, separate from store inventory. */
  v26TerrainBag?: Readonly<{ soil: number; stone: number; iron_ore: number;
    gold_ore: number; diamond: number }>
  /** V29-only virtual tools and checked terrain-bag economy, never historical inventory. */
  v29Mining?: Readonly<{
    tools: Readonly<{ basicPickOwned: boolean; enchantedPickOwned: boolean;
      activePick: PublicV29PickTier | null }>
    offers: readonly Readonly<{ tier: PublicV29PickTier; price: number; owned: boolean;
      buyReason: string | null }>[]
    bids: Readonly<Record<PublicV29Mineral, number>>
    bag: Readonly<Record<PublicV29Mineral, number>>
    excavationLevel: number
    atOutfitters: boolean
  }>
  /** V31-only checked soil sidecar, read for placement controls and top/edge presentation. */
  v31Soil?: Readonly<{ raisedCells: readonly Readonly<{ gx: number; gz: number }>[];
    soilAvailable: number }>
  /** Saved open pits on revealed, currently visible canonical 4 m ground. */
  v26OpenPitColumns?: readonly { gx: number; gz: number; openDepth: number }[]
  /** A read-only hint for the current saved pit; the writer still validates the action. */
  v26PitLadderOpportunity?: Readonly<{ gx: number; gz: number; logCost: 4 }>
  /** Absent from v7-v11 projections and never added to learnedSpellIds. */
  windwardStep?: WizardWindwardStepView
  map: {
    tiles: readonly WizardMapTile[]
    player: { gridX: number; gridZ: number; yaw: number }
    /** Atlas heading; omitted means the Greenway atlas. */
    title?: string
    /** Atlas glyph legend; omitted means the full Greenway legend. */
    legend?: string
    /** Read-only directions shown in the expanded atlas without revealing terrain. */
    guidance?: string
    /** Show current route guidance even when the physical Greenway notes are present. */
    guidancePriority?: true
    /** Accessible name for a revealed region-specific cache. */
    cacheLabel?: string
    /** Lazy read-only journey overview; absent from legacy and developer previews. */
    overview?: () => WizardWorldOverview
  }
  stores: readonly WizardStore[]
  openStoreId: string | null
  nearbyStoreId: string | null
  backpack: {
    capacity: number
    stacks: readonly WizardItemStack[]
  }
  coins: number
  experience: {
    xp: number
    nextLevelXp: number
    level: number
  }
  equipment: Readonly<Record<EquipmentSlot, WizardItemStack | null>>
  /** V11-only display of the effective, equipment-gated movement pace. */
  gait?: { pace: 'walk' | 'run'; canRun: boolean; reason: string }
  tradeListings: readonly [
    WizardTradeListing | null,
    WizardTradeListing | null,
    WizardTradeListing | null,
    WizardTradeListing | null,
  ]
  nearbyInteraction: WizardInteractionPrompt | null
  recentEvents: readonly string[]
}

export type WizardViewIntent =
  // Optional timestamps allow a newer consumer to integrate press durations between fixed ticks.
  // v5 and the streamed preview continue reading vector only.
  | { type: 'movement'; vector: Vec2; atMs?: number }
  | { type: 'movement.tap'; vector: Vec2; atMs?: number; source?: 'keyboard' }
  | { type: 'dev.navigate'; destination: { x: number; z: number } }
  | { type: 'dev.navigate.cancel' }
  | { type: 'gait.toggle' }
  | { type: 'jump' }
  | { type: 'interact' }
  | { type: 'highland.extract'; nodeId: string }
  | { type: 'windward.study' }
  | { type: 'windward.cast' }
  | { type: 'store.close' }
  | { type: 'store.open'; storeId: string }
  | { type: 'store.select-listing'; storeId: string; listingId: string }
  | { type: 'store.sell-item'; storeId: string; itemId: string; quantity: number }
  | { type: 'equipment.equip'; stackId: string; slot: EquipmentSlot }
  | { type: 'equipment.unequip'; slot: EquipmentSlot }
  | { type: 'inscription.study'; inscriptionId: InscriptionId }
  | { type: 'spell.cast'; spellId: SpellId }
  | { type: 'dig-site.excavate'; digSiteId: DigSiteId }
  | { type: 'build-site.select'; siteId: string | null }
  | { type: 'build-site.confirm'; siteId: string }
  | { type: 'field-camp.select'; tileId: string | null }
  | { type: 'field-camp.confirm'; tileId: string }
  | { type: 'terrain-work.select'; id: string | null }
  | { type: 'terrain-work.confirm'; id: string }
  | { type: 'saved-work.mode'; active: boolean }
  | { type: 'saved-work.kind'; kind: TerrainWorkSite['kind'] }
  | { type: 'saved-work.aim'; aimX: number | null }
  | { type: 'saved-work.aim-waystation' }
  | { type: 'saved-work.aim-west'; aimZ: number }
  | { type: 'saved-work.confirm'; id: string }
  | { type: 'v26.terrain'; kind: 'dig' | 'fill'; gx: number; gz: number }
  | { type: 'v29.mining-tool'; action: 'buy' | 'equip'; tier: PublicV29PickTier }
  | { type: 'v29.deep-dig'; gx: number; gz: number }
  | { type: 'v29.sell-mineral'; material: PublicV29Mineral; quantity: number }
  | { type: 'v30.bridgehead.claim'; bridgeId: string }
  | { type: 'v35.ledger.survey'; bridgeId: string }
  | { type: 'v35.ledger.deliver' }
  | { type: 'v36.marker.claim' }
  | { type: 'v38.signal.inspect' }
  | { type: 'v38.signal.claim' }
  | { type: 'v39.ring.discover' }
  | { type: 'v39.ring.link' }
  | { type: 'v39.ring.claim' }
  | { type: 'v40.waystation.barter' }
  | { type: 'v40.waystation.cross' }
  | { type: 'v40.waystation.claim' }
  | { type: 'v41.ironhall.study' }
  | { type: 'v41.ironhall.engage' }
  | { type: 'v41.ironhall.bolt' }
  | { type: 'v41.ironhall.guard' }
  | { type: 'v41.ironhall.rest' }
  | { type: 'v42.ironhall.claim' }
  | { type: 'v42.ironhall.vest-equip' }
  | { type: 'v42.ironhall.vest-unequip' }
  | { type: 'v42.ironhall.vest-repair' }
  | { type: 'v42.ironhall.spar' }
  | { type: 'v31.soil-place'; gx: number; gz: number }
  | { type: 'trial-footwear.toggle' }
  | { type: 'trade.create-listing'; stackId: string; slot: number; quantity: number; unitPrice: number }
  | { type: 'trade.cancel-listing'; slot: number }
  | { type: 'fairy-ring.teleport'; ringId: string; destinationRingId: string }
