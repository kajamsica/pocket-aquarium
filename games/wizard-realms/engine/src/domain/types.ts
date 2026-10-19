export type Vec3 = { x: number; y: number; z: number }
export type BiomeId = 'temperate_forest' | 'marsh' | 'dry_highland' | 'alpine'
export type TerrainId = 'loam' | 'wetland' | 'rocky' | 'snow'
export type GenerationProfile = 'greenway-classic-v1' | 'greenway-expanded-v1'
export type ResourceKind = 'tree' | 'herb' | 'stone' | 'ore'
export type ItemId =
  | 'woodcutters_axe' | 'logs' | 'marsh_herb' | 'stone' | 'iron_ore'
  | 'apprentice_hat' | 'traveler_tunic' | 'trail_leggings' | 'leather_boots'
  | 'oak_wand' | 'wooden_shield' | 'field_spade' | 'ancient_relic'
export type EquipmentSlot = 'head' | 'chest' | 'legs' | 'feet' | 'mainHand' | 'offHand'
export type SkillId = 'woodcutting' | 'construction' | 'wayfinding' | 'spellcraft' | 'excavation'
export type SpellId = 'wayfinder_glow'
export type InscriptionId = 'greenway_waystone'
export type DigSiteId = 'practice_mound' | 'ridge_cache'

export interface WorldTile {
  id: string
  gridX: number
  gridZ: number
  center: Vec3
  elevation: number
  temperature: number
  moisture: number
  terrain: TerrainId
  biome: BiomeId
}

export interface ResourceNode {
  id: string
  tileId: string
  kind: ResourceKind
  position: Vec3
  health: number
  maxHealth: number
  depleted: boolean
}

export interface FairyRing { id: string; name: string; kind: 'mushroom'; position: Vec3 }
export interface StoreListing { id: string; itemId: ItemId; price: number; stock: number }
export interface StoreState { id: string; name: string; position: Vec3; listings: StoreListing[] }
export interface InventoryStack { itemId: ItemId; quantity: number }
export interface InscriptionProfile { id: InscriptionId; name: string; position: Vec3; spellId: SpellId }
export interface DigSiteProfile {
  id: DigSiteId
  name: string
  position: Vec3
  visibleFromStart: boolean
  minimumExcavationLevel: number
  reward: InventoryStack
  xpReward: number
}
export interface TradeSlot {
  slotIndex: 0 | 1 | 2 | 3
  itemId: ItemId | null
  quantity: number
  unitPrice: number
}

export type AreaId = 'greenway' | 'northern_ridge' | 'eastern_highland'
export type RouteId = 'greenway_ladder' | 'highland_bridge'
export type RecipeId = RouteId
export type RouteSiteId = string

export interface AreaProfile {
  id: AreaId
  name: string
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface RouteProfile {
  id: RouteId
  name: string
  fromAreaId: AreaId
  toAreaId: AreaId
  from: Vec3
  to: Vec3
  siteId: RouteSiteId | null
}

export interface RouteSite { id: RouteSiteId; routeId: RouteId; from: Vec3; to: Vec3 }
export interface RouteBuildOption extends RouteSite {
  status: 'ready' | 'locked' | 'too_far' | 'needs_logs' | 'obstructed' | 'built'
  reason: string
}

export interface RecipeProfile {
  id: RecipeId
  name: string
  routeId: RouteId
  logCost: number
  xpReward: number
  minimumLevel: number
  prerequisiteRouteId: RouteId | null
}

export interface PlayerState {
  position: Vec3
  verticalVelocity: number
  yaw: number
  pitch: number
  coins: number
  xp: number
  level: number
  backpackCapacity: number
  inventory: InventoryStack[]
  equipment: Record<EquipmentSlot, ItemId | null>
  tradeSlots: [TradeSlot, TradeSlot, TradeSlot, TradeSlot]
  discoveredRingIds: string[]
  skillXp: Record<SkillId, number>
  learnedSpellIds: SpellId[]
}

export interface WizardWorldState {
  schemaVersion: 'wizard-world/v5'
  contentRevision: 'greenway-region-v3'
  seed: string
  generationProfile: GenerationProfile
  tick: number
  fixedStepMs: 50
  rng: { generation: number; simulation: number }
  tiles: WorldTile[]
  resources: ResourceNode[]
  stores: [StoreState, StoreState]
  fairyRings: FairyRing[]
  inscriptions: InscriptionProfile[]
  digSites: DigSiteProfile[]
  areas: AreaProfile[]
  routes: RouteProfile[]
  recipes: RecipeProfile[]
  builtRouteIds: RouteId[]
  unlockedRecipeIds: RecipeId[]
  discoveredTileIds: string[]
  studiedInscriptionIds: InscriptionId[]
  revealedDigSiteIds: DigSiteId[]
  excavatedDigSiteIds: DigSiteId[]
  player: PlayerState
  eventSequence: number
}

export type WizardIntent =
  | { type: 'move'; delta: Vec3 }
  | { type: 'look'; yawDelta: number; pitchDelta: number }
  | { type: 'jump' }
  | { type: 'build_route'; routeId: RouteId; siteId: RouteSiteId }
  | { type: 'traverse_route'; routeId: RouteId }
  | { type: 'harvest'; resourceId: string }
  | { type: 'discover_fairy_ring'; ringId: string }
  | { type: 'teleport_fairy_ring'; sourceRingId: string; targetRingId: string }
  | { type: 'buy_store_listing'; storeId: string; listingId: string }
  | { type: 'sell_to_store'; storeId: string; itemId: ItemId; quantity: number }
  | { type: 'equip_item'; itemId: ItemId; slot: EquipmentSlot }
  | { type: 'unequip_item'; slot: EquipmentSlot }
  | { type: 'create_trade_listing'; slotIndex: number; itemId: ItemId; quantity: number; unitPrice: number }
  | { type: 'cancel_trade_listing'; slotIndex: number }
  | { type: 'study_inscription'; inscriptionId: InscriptionId }
  | { type: 'cast_spell'; spellId: SpellId }
  | { type: 'dig_site'; digSiteId: DigSiteId }

type EventBase = { sequence: number; tick: number }
export type WizardEvent = EventBase & (
  | { type: 'player_moved'; position: Vec3 }
  | { type: 'player_looked'; yaw: number; pitch: number }
  | { type: 'player_jumped' }
  | { type: 'route_built'; routeId: RouteId; siteId: RouteSiteId; logCost: number; xp: number }
  | { type: 'route_used'; routeId: RouteId; fromAreaId: AreaId; toAreaId: AreaId; position: Vec3 }
  | { type: 'recipe_unlocked'; recipeId: RecipeId }
  | { type: 'tile_discovered'; tileId: string }
  | { type: 'resource_damaged'; resourceId: string; health: number }
  | { type: 'resource_harvested'; resourceId: string; itemId: ItemId; quantity: number; xp: number }
  | { type: 'fairy_ring_discovered'; ringId: string }
  | { type: 'fairy_ring_teleported'; sourceRingId: string; targetRingId: string; position: Vec3 }
  | { type: 'store_item_bought'; storeId: string; listingId: string; itemId: ItemId; price: number }
  | { type: 'store_item_sold'; storeId: string; itemId: ItemId; quantity: number; unitPrice: number; totalPrice: number }
  | { type: 'item_equipped'; itemId: ItemId; slot: EquipmentSlot }
  | { type: 'item_unequipped'; itemId: ItemId; slot: EquipmentSlot }
  | { type: 'trade_listing_created'; slotIndex: number; itemId: ItemId; quantity: number; unitPrice: number }
  | { type: 'trade_listing_cancelled'; slotIndex: number; itemId: ItemId; quantity: number }
  | { type: 'trade_listing_sold'; slotIndex: number; itemId: ItemId; quantity: number; unitPrice: number; totalPrice: number }
  | { type: 'inscription_studied'; inscriptionId: InscriptionId; spellId: SpellId }
  | { type: 'spell_cast'; spellId: SpellId; revealedTileIds: string[]; revealedDigSiteIds: DigSiteId[] }
  | { type: 'dig_site_excavated'; digSiteId: DigSiteId; itemId: ItemId; quantity: number; xp: number }
  | { type: 'skill_xp_gained'; skillId: SkillId; xp: number }
)
export type TradeListingSoldEvent = Extract<WizardEvent, { type: 'trade_listing_sold' }>

export interface IntentRejection {
  intentIndex: number
  intentType: WizardIntent['type']
  code: 'invalid_value' | 'not_found' | 'too_far' | 'requires_axe' | 'depleted' | 'capacity' |
    'insufficient_coins' | 'out_of_stock' | 'not_owned' | 'wrong_slot' | 'undiscovered' |
    'trade_slot_unavailable' | 'locked_area' | 'recipe_locked' | 'already_built' |
    'unlearned_spell' | 'requires_spade' | 'site_hidden' | 'already_excavated' |
    'skill_locked' | 'incompatible_ground' | 'already_studied' | 'site_obstructed'
  message: string
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown ? T :
  T extends readonly (infer U)[] ? ReadonlyArray<DeepReadonly<U>> :
  T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T

export type WizardProjection = DeepReadonly<{
  tick: number
  player: PlayerState
  currentTile: WorldTile
  nearbyResources: ResourceNode[]
  nearbyFairyRings: Array<FairyRing & { discovered: boolean }>
  nearbyStores: StoreState[]
  nearbyRoutes: RouteProfile[]
  inscriptions: InscriptionProfile[]
  digSites: DigSiteProfile[]
  builtRouteIds: RouteId[]
  unlockedRecipeIds: RecipeId[]
  discoveredTileIds: string[]
  studiedInscriptionIds: InscriptionId[]
  revealedDigSiteIds: DigSiteId[]
  excavatedDigSiteIds: DigSiteId[]
}>

export interface WizardAdvanceResult {
  state: WizardWorldState
  events: WizardEvent[]
  rejections: IntentRejection[]
}
