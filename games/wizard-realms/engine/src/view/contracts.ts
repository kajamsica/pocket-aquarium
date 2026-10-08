import type { DigSiteId, InscriptionId, SkillId, SpellId, TerrainId } from '../domain/types'
import type { FieldCampActionResult } from '../domain/fieldCamp'

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
}

export interface WizardResourceNode {
  id: string
  kind: 'tree' | 'ore' | 'herb' | 'other'
  label: string
  position: Vec3
  available: boolean
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

export interface WizardTradeListing {
  id: string
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
}

export interface WizardMapTile {
  id: string
  gridX: number
  gridZ: number
  terrain: string | null
  biome: string | null
  discovered: boolean
  hasResource: boolean
  hasStore: boolean
  hasRing: boolean
  hasWaystone?: boolean
  /** A learned destination marker, which may sit on a still-unexplored tile. */
  hasWestTrail?: boolean
  /** A known route/target does not reveal the surrounding terrain. */
  hasFrontierTrail?: boolean
  hasFrontierMarker?: boolean
  hasRouteSite: boolean
  hasBuiltRoute: boolean
  hasCache?: boolean
  hasCamp?: boolean
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

export interface WizardViewProjection {
  seed: string
  tick: number
  player: {
    position: Vec3
    yaw: number
    pitch: number
  }
  terrain: readonly WizardTerrainCell[]
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
  map: {
    tiles: readonly WizardMapTile[]
    player: { gridX: number; gridZ: number; yaw: number }
    /** Atlas heading; omitted means the Greenway atlas. */
    title?: string
    /** Atlas glyph legend; omitted means the full Greenway legend. */
    legend?: string
    /** Read-only directions shown in the expanded atlas without revealing terrain. */
    guidance?: string
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
  | { type: 'jump' }
  | { type: 'interact' }
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
  | { type: 'trade.create-listing'; stackId: string; slot: number; quantity: number; unitPrice: number }
  | { type: 'trade.cancel-listing'; slot: number }
  | { type: 'fairy-ring.teleport'; ringId: string; destinationRingId: string }
