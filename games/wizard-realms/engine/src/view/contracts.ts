export type Vec2 = readonly [number, number]
export type Vec3 = readonly [number, number, number]

export type EquipmentSlot = 'head' | 'chest' | 'hands' | 'legs' | 'feet' | 'focus'

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

export interface WizardTradeListing {
  id: string
  itemName: string
  quantity: number
  unitPrice: number
}

export interface WizardInteractionPrompt {
  kind: 'resource' | 'store' | 'fairy-ring' | 'route' | 'other'
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
  routes: readonly WizardRoute[]
  map: {
    tiles: readonly WizardMapTile[]
    player: { gridX: number; gridZ: number; yaw: number }
  }
  stores: readonly WizardStore[]
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
  | { type: 'movement'; vector: Vec2 }
  | { type: 'jump' }
  | { type: 'interact' }
  | { type: 'store.select-listing'; storeId: string; listingId: string }
  | { type: 'equipment.equip'; stackId: string; slot: EquipmentSlot }
  | { type: 'trade.create-listing'; stackId: string; slot: number; quantity: number; unitPrice: number }
  | { type: 'trade.cancel-listing'; slot: number }
  | { type: 'fairy-ring.teleport'; ringId: string; destinationRingId: string }
