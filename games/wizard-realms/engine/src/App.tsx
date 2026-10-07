import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  advanceWizardWorld,
  createWizardProjection,
  createWizardWorld,
  restoreWizardWorld,
  serializeWizardWorld,
  type EquipmentSlot as DomainEquipmentSlot,
  type ItemId,
  type WizardEvent,
  type WizardIntent,
  type WizardWorldState,
} from './domain'
import {
  WizardSurface,
  type WizardViewIntent,
  type WizardViewProjection,
} from './view'
import type { EquipmentSlot as ViewEquipmentSlot } from './view/contracts'

const WORLD_SEED = 'greenway-alpha'
const SAVE_KEY = 'wizard-realms:world:v1'
const FIXED_STEP_MS = 50
const MOVE_METERS_PER_TICK = 0.16
const PIVOT_RADIANS_PER_TICK = 0.045
const INTERACTION_RANGE = 3

const ITEM_NAMES: Record<ItemId, string> = {
  woodcutters_axe: 'Woodcutter axe', logs: 'Greenway logs', marsh_herb: 'Marsh herb',
  stone: 'Stone', iron_ore: 'Iron ore', apprentice_hat: 'Apprentice hat',
  traveler_tunic: 'Traveler tunic', trail_leggings: 'Trail leggings',
  leather_boots: 'Leather boots', oak_wand: 'Oak wand', wooden_shield: 'Wooden shield',
}
const EQUIPPABLE: Partial<Record<ItemId, readonly ViewEquipmentSlot[]>> = {
  woodcutters_axe: ['focus'], apprentice_hat: ['head'], traveler_tunic: ['chest'],
  trail_leggings: ['legs'], leather_boots: ['feet'], oak_wand: ['focus', 'hands'],
  wooden_shield: ['hands'],
}
const TERRAIN_COLORS = { loam: '#56824b', wetland: '#466f62', rocky: '#7b765e', snow: '#d4e3df' } as const

type RecentMessage = { id: number; text: string }

function loadWorld(): WizardWorldState {
  const saved = window.localStorage.getItem(SAVE_KEY)
  if (!saved) return createWizardWorld(WORLD_SEED)
  try {
    const value = JSON.parse(saved) as { schemaVersion?: unknown; seed?: unknown }
    return value.schemaVersion === 'wizard-world/v1' && value.seed === WORLD_SEED
      ? restoreWizardWorld(saved)
      : createWizardWorld(WORLD_SEED)
  } catch {
    return createWizardWorld(WORLD_SEED)
  }
}

const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

function closestInteraction(state: WizardWorldState) {
  const candidates = [
    ...state.resources.filter((resource) => resource.kind === 'tree' && !resource.depleted)
      .map((resource) => ({ distance: distance(state.player.position, resource.position), kind: 'resource' as const, target: resource })),
    ...state.fairyRings.map((ring) => ({ distance: distance(state.player.position, ring.position), kind: 'fairy-ring' as const, target: ring })),
    ...state.stores.map((store) => ({ distance: distance(state.player.position, store.position), kind: 'store' as const, target: store })),
  ].filter((candidate) => candidate.distance <= INTERACTION_RANGE)
  return candidates.sort((left, right) => left.distance - right.distance)[0] ?? null
}

function itemStack(itemId: ItemId, quantity: number) {
  return {
    id: `inventory-${itemId}`, itemId, name: ITEM_NAMES[itemId], quantity,
    equippableSlots: EQUIPPABLE[itemId], suggestedTradePrice: itemId === 'logs' ? 4 : 12,
  }
}

function eventText(event: WizardEvent): string {
  switch (event.type) {
    case 'resource_damaged': return 'The tree shudders under your axe.'
    case 'resource_harvested': return `Gathered ${event.quantity} ${ITEM_NAMES[event.itemId]}.`
    case 'fairy_ring_discovered': return 'A fairy ring answers your presence.'
    case 'fairy_ring_teleported': return 'The mushroom path folds the world around you.'
    case 'store_item_bought': return `Purchased ${ITEM_NAMES[event.itemId]}.`
    case 'item_equipped': return `Equipped ${ITEM_NAMES[event.itemId]}.`
    case 'trade_listing_created': return `Listed ${event.quantity} ${ITEM_NAMES[event.itemId]} for trade.`
    case 'trade_listing_cancelled': return `Returned ${ITEM_NAMES[event.itemId]} to your backpack.`
    case 'player_jumped': return 'You spring over the trail.'
    default: return ''
  }
}

function domainSlot(slot: ViewEquipmentSlot): DomainEquipmentSlot {
  return slot === 'focus' ? 'mainHand' : slot === 'hands' ? 'offHand' : slot
}

export function toViewProjection(state: WizardWorldState, messages: readonly RecentMessage[]): WizardViewProjection {
  const domain = createWizardProjection(state)
  const interaction = closestInteraction(state)
  const inventory = domain.player.inventory.map((stack) => itemStack(stack.itemId, stack.quantity))
  const equipped = (slot: ViewEquipmentSlot) => {
    const itemId = domain.player.equipment[domainSlot(slot)]
    return itemId ? itemStack(itemId, 1) : null
  }
  return {
    seed: state.seed,
    tick: domain.tick,
    player: { position: [domain.player.position.x, domain.player.position.y, domain.player.position.z], yaw: domain.player.yaw, pitch: domain.player.pitch },
    terrain: state.tiles.map((tile) => ({ id: tile.id, position: [tile.center.x, tile.center.y, tile.center.z], size: [4, 4], height: 0.7 + tile.elevation * 3, climate: tile.biome, color: TERRAIN_COLORS[tile.terrain] })),
    resources: state.resources.map((resource) => ({ id: resource.id, kind: resource.kind === 'stone' ? 'other' : resource.kind, label: resource.kind === 'tree' ? 'Greenway oak' : resource.kind, position: [resource.position.x, resource.position.y, resource.position.z], available: !resource.depleted })),
    fairyRings: state.fairyRings.map((ring) => ({
      id: ring.id, label: ring.name, position: [ring.position.x, ring.position.y, ring.position.z],
      discovered: domain.player.discoveredRingIds.includes(ring.id),
      destinations: state.fairyRings.filter((target) => target.id !== ring.id).map((target) => ({ ringId: target.id, label: target.name, discovered: domain.player.discoveredRingIds.includes(target.id) })),
    })),
    stores: state.stores.map((store) => ({ id: store.id, name: store.name, position: [store.position.x, store.position.y, store.position.z], listings: store.listings.map((listing) => ({ id: listing.id, name: ITEM_NAMES[listing.itemId], price: listing.price, stock: listing.stock })) })),
    backpack: { capacity: domain.player.backpackCapacity, stacks: inventory },
    coins: domain.player.coins,
    experience: { xp: domain.player.xp, nextLevelXp: domain.player.level * 100, level: domain.player.level },
    equipment: { head: equipped('head'), chest: equipped('chest'), hands: equipped('hands'), legs: equipped('legs'), feet: equipped('feet'), focus: equipped('focus') },
    tradeListings: domain.player.tradeSlots.map((slot) => slot.itemId ? ({ id: `trade-${slot.slotIndex}`, itemName: ITEM_NAMES[slot.itemId], quantity: slot.quantity, unitPrice: slot.unitPrice }) : null) as unknown as WizardViewProjection['tradeListings'],
    nearbyInteraction: interaction ? {
      kind: interaction.kind, targetId: interaction.target.id,
      label: interaction.kind === 'resource' ? 'Greenway oak' : interaction.target.name,
      action: interaction.kind === 'resource' ? 'Chop' : interaction.kind === 'store' ? 'Store open' : domain.player.discoveredRingIds.includes(interaction.target.id) ? 'Choose destination' : 'Discover',
      actionable: interaction.kind === 'resource' || (interaction.kind === 'fairy-ring' && !domain.player.discoveredRingIds.includes(interaction.target.id)),
    } : null,
    recentEvents: messages.map((message) => message.text),
  }
}

export function intentForView(state: WizardWorldState, intent: Exclude<WizardViewIntent, { type: 'movement' }>): WizardIntent | null {
  if (intent.type === 'jump') return { type: 'jump' }
  if (intent.type === 'interact') {
    const interaction = closestInteraction(state)
    if (interaction?.kind === 'resource') return { type: 'harvest', resourceId: interaction.target.id }
    if (interaction?.kind === 'fairy-ring' && !state.player.discoveredRingIds.includes(interaction.target.id)) return { type: 'discover_fairy_ring', ringId: interaction.target.id }
    return null
  }
  if (intent.type === 'store.select-listing') return { type: 'buy_store_listing', storeId: intent.storeId, listingId: intent.listingId }
  if (intent.type === 'equipment.equip') return { type: 'equip_item', itemId: intent.stackId.replace('inventory-', '') as ItemId, slot: domainSlot(intent.slot) }
  if (intent.type === 'trade.create-listing') return { type: 'create_trade_listing', slotIndex: intent.slot, itemId: intent.stackId.replace('inventory-', '') as ItemId, quantity: intent.quantity, unitPrice: intent.unitPrice }
  if (intent.type === 'trade.cancel-listing') return { type: 'cancel_trade_listing', slotIndex: intent.slot }
  return { type: 'teleport_fairy_ring', sourceRingId: intent.ringId, targetRingId: intent.destinationRingId }
}

export function movementIntent(state: WizardWorldState, vector: readonly [number, number]): WizardIntent | null {
  if (vector[1] === 0) return null
  const { yaw } = state.player
  const x = -vector[1] * Math.sin(yaw) * MOVE_METERS_PER_TICK
  return { type: 'move', delta: {
    x: Math.abs(x) < 1e-12 ? 0 : x,
    y: 0,
    z: -vector[1] * Math.cos(yaw) * MOVE_METERS_PER_TICK,
  } }
}

export function controlIntents(state: WizardWorldState, vector: readonly [number, number]): WizardIntent[] {
  const intents: WizardIntent[] = []
  const yawDelta = -vector[0] * PIVOT_RADIANS_PER_TICK
  if (yawDelta !== 0) intents.push({ type: 'look', yawDelta, pitchDelta: 0 })
  if (vector[1] !== 0) {
    const facing = { ...state, player: { ...state.player, yaw: state.player.yaw + yawDelta } }
    const movement = movementIntent(facing, vector)
    if (movement) intents.push(movement)
  }
  return intents
}

export default function App() {
  const [world, setWorld] = useState(loadWorld)
  const [messages, setMessages] = useState<RecentMessage[]>([{ id: 0, text: 'Welcome to the Greenway vertical slice.' }])
  const worldRef = useRef(world)
  const movementRef = useRef<readonly [number, number]>([0, 0])
  const queuedRef = useRef<WizardIntent[]>([])
  const messageId = useRef(1)

  useEffect(() => { worldRef.current = world }, [world])
  useEffect(() => {
    const timer = window.setInterval(() => {
      const intents = queuedRef.current.splice(0)
      intents.push(...controlIntents(worldRef.current, movementRef.current))
      const result = advanceWizardWorld(worldRef.current, intents)
      worldRef.current = result.state
      setWorld(result.state)
      window.localStorage.setItem(SAVE_KEY, serializeWizardWorld(result.state))
      const nextMessages = [
        ...result.events.map(eventText).filter(Boolean),
        ...result.rejections.map((rejection) => rejection.message),
      ]
      if (nextMessages.length) setMessages((current) => [...current, ...nextMessages.map((text) => ({ id: messageId.current++, text }))].slice(-5))
    }, FIXED_STEP_MS)
    return () => window.clearInterval(timer)
  }, [])

  const onIntent = useCallback((intent: WizardViewIntent) => {
    if (intent.type === 'movement') {
      movementRef.current = intent.vector
      return
    }
    const domainIntent = intentForView(worldRef.current, intent)
    if (domainIntent) queuedRef.current.push(domainIntent)
  }, [])
  const projection = useMemo(() => toViewProjection(world, messages), [world, messages])

  return <main style={{ position: 'fixed', inset: 0, background: '#14221f' }}>
    <WizardSurface projection={projection} onIntent={onIntent} diagnostics />
    <div style={{ position: 'absolute', left: '50%', bottom: 8, transform: 'translateX(-50%)', zIndex: 4, padding: '5px 10px', borderRadius: 999, background: '#101a17dd', color: '#d8c987', font: '11px system-ui' }}>
      Playable systems vertical slice. World, economy, and persistence are real. Combat and quests are not in this build.
    </div>
  </main>
}
