import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  advanceWizardWorld,
  createWizardProjection,
  createWizardWorld,
  restoreWizardWorld,
  serializeWizardWorld,
  type IntentRejection,
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
import type { EquipmentSlot } from './view/contracts'
import { areaAt } from './domain/generation'

const WORLD_SEED = 'greenway-alpha'
const SAVE_KEY = 'wizard-realms:world:v2'
const LEGACY_SAVE_KEY = 'wizard-realms:world:v1'
const FIXED_STEP_MS = 50
const MOVE_METERS_PER_TICK = 0.16
// ~149 deg/s: a 180-degree turn takes ~1.2 s instead of ~3.5 s at the previous 0.045.
export const PIVOT_RADIANS_PER_TICK = 0.13
const INTERACTION_RANGE = 3
const WELCOME_MESSAGE = 'Welcome to the Greenway vertical slice.'
// Mobile vertical bands, measured from the bottom edge (plus safe-area inset):
//   0-135   .wr-touch cluster (14px inset + two 58px d-pad rows + 5px gap)
//   142-222 objective pill (max-height 80px; long text scrolls inside the pill)
//   230+    .wr-prompt / .wr-context / .wr-events, relocated from the view's 148-152px anchors
export const OBJECTIVE_STYLES = `
.wr-objective{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);z-index:4;display:flex;gap:10px;align-items:center;padding:5px 5px 5px 10px;border-radius:999px;background:#101a17dd;color:#d8c987;font:11px system-ui;white-space:nowrap}
.wr-objective b{color:#f5d889;letter-spacing:.12em}
.wr-objective button{padding:3px 9px;border:1px solid #cfb66b55;border-radius:999px;background:#374b3d;color:#f8e8b2;font:inherit;cursor:pointer}
@media(max-width:719px),(min-width:720px) and (max-width:900px) and (max-height:590px){.wr-objective{left:10px;right:10px;bottom:calc(142px + env(safe-area-inset-bottom,0px));transform:none;box-sizing:border-box;max-height:80px;border-radius:12px;white-space:normal;font-size:12px;line-height:1.3}.wr-objective span{flex:1;min-width:0;max-height:70px;overflow-y:auto}.wr-objective button{flex:none;min-width:44px;min-height:44px}.wr-surface .wr-prompt,.wr-surface .wr-context{bottom:calc(230px + env(safe-area-inset-bottom,0px))}.wr-surface .wr-context{box-sizing:border-box;max-height:max(140px,calc(100vh - 340px));overflow-y:auto}}
@media(max-width:719px) and (max-height:590px){.wr-surface:has(.wr-context) .wr-backpack,.wr-surface .wr-events{display:none}}
@media(max-width:719px) and (max-height:400px){.wr-surface{min-height:0}.wr-surface .wr-prompt,.wr-surface .wr-context{box-sizing:border-box;top:54px;bottom:auto;max-height:80px;overflow-y:auto}}
@media(min-width:440px) and (max-width:719px) and (max-height:400px){.wr-surface .wr-backpack,.wr-surface .wr-context{left:8px;top:54px;max-height:80px;width:220px;overflow-y:auto;transform:none}.wr-surface .wr-prompt{left:auto;right:72px;max-width:160px;transform:none}}
@media(min-width:720px) and (max-width:900px) and (max-height:420px){.wr-surface .wr-context{top:54px;bottom:auto;max-height:calc(100vh - 254px);overflow-y:auto}}
`

const ITEM_NAMES: Record<ItemId, string> = {
  woodcutters_axe: 'Woodcutter axe', logs: 'Greenway logs', marsh_herb: 'Marsh herb',
  stone: 'Stone', iron_ore: 'Iron ore', apprentice_hat: 'Apprentice hat',
  traveler_tunic: 'Traveler tunic', trail_leggings: 'Trail leggings',
  leather_boots: 'Leather boots', oak_wand: 'Oak wand', wooden_shield: 'Wooden shield',
}
const EQUIPPABLE: Partial<Record<ItemId, readonly EquipmentSlot[]>> = {
  woodcutters_axe: ['mainHand'], apprentice_hat: ['head'], traveler_tunic: ['chest'],
  trail_leggings: ['legs'], leather_boots: ['feet'], oak_wand: ['mainHand', 'offHand'],
  wooden_shield: ['offHand'],
}
const TERRAIN_COLORS = { loam: '#56824b', wetland: '#466f62', rocky: '#7b765e', snow: '#d4e3df' } as const

type RecentMessage = { id: number; text: string }

function loadWorld(): WizardWorldState {
  const saved = window.localStorage.getItem(SAVE_KEY) ?? window.localStorage.getItem(LEGACY_SAVE_KEY)
  if (!saved) return createWizardWorld(WORLD_SEED)
  try {
    const value = JSON.parse(saved) as { schemaVersion?: unknown; seed?: unknown }
    return (value.schemaVersion === 'wizard-world/v1' || value.schemaVersion === 'wizard-world/v2') && value.seed === WORLD_SEED
      ? restoreWizardWorld(saved)
      : createWizardWorld(WORLD_SEED)
  } catch {
    return createWizardWorld(WORLD_SEED)
  }
}

export function resetSavedWorld(storage: Pick<Storage, 'removeItem'>): WizardWorldState {
  storage.removeItem(SAVE_KEY)
  storage.removeItem(LEGACY_SAVE_KEY)
  return createWizardWorld(WORLD_SEED)
}

const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

const owned = (state: WizardWorldState, itemId: ItemId) =>
  state.player.inventory.filter((stack) => stack.itemId === itemId).reduce((sum, stack) => sum + stack.quantity, 0)
const axeEquipped = (state: WizardWorldState) => state.player.equipment.mainHand === 'woodcutters_axe'

export function objectiveFor(state: WizardWorldState): string {
  const logs = owned(state, 'logs')
  const gather = (cost: number) => `Gather logs from Greenway oaks (${Math.min(logs, cost)}/${cost})`
  const greenwayRing = state.player.discoveredRingIds.includes('ring-greenway')
  const highlandRing = state.player.discoveredRingIds.includes('ring-highland')
  if (greenwayRing && highlandRing) return areaAt(state.areas, state.player.position.x, state.player.position.z).id === 'greenway'
    ? 'Quest complete: fairy rings linked. Explore, trade, or travel to Highland again.'
    : 'Both fairy rings are linked. Use the Highland Ring to travel home.'
  if (highlandRing) return 'Return to the Greenway and discover its fairy ring near the start to link travel home.'
  if (state.builtRouteIds.includes('highland_bridge')) return 'Cross the Highland bridge east and discover the Highland fairy ring.'
  if (state.builtRouteIds.includes('greenway_ladder')) return logs >= 6 ? 'Build the Highland bridge east along the ridge (6 logs).' : `${gather(6)}, then build the Highland bridge east along the ridge.`
  if (axeEquipped(state)) return logs >= 4 ? 'Build the Greenway ladder north (4 logs).' : `${gather(4)}, then build the Greenway ladder north.`
  return owned(state, 'woodcutters_axe') > 0 ? 'Equip the woodcutter axe from your backpack.' : 'Buy a woodcutter axe at Greenway Outfitters.'
}

function closestInteraction(state: WizardWorldState) {
  const candidates = [
    ...state.resources.filter((resource) => resource.kind === 'tree' && !resource.depleted)
      .map((resource) => ({ distance: distance(state.player.position, resource.position), kind: 'resource' as const, target: resource })),
    ...state.fairyRings.map((ring) => ({ distance: distance(state.player.position, ring.position), kind: 'fairy-ring' as const, target: ring })),
    ...state.stores.map((store) => ({ distance: distance(state.player.position, store.position), kind: 'store' as const, target: store })),
    ...state.routes.map((route) => ({ distance: Math.min(distance(state.player.position, route.from), distance(state.player.position, route.to)), kind: 'route' as const, target: route })),
  ].filter((candidate) => candidate.distance <= INTERACTION_RANGE)
  return candidates.sort((left, right) => left.distance - right.distance)[0] ?? null
}

function itemStack(itemId: ItemId, quantity: number) {
  return {
    id: `inventory-${itemId}`, itemId, name: ITEM_NAMES[itemId], quantity,
    equippableSlots: EQUIPPABLE[itemId], suggestedTradePrice: itemId === 'logs' ? 4 : 12,
  }
}

function itemAmountName(itemId: ItemId, quantity: number) {
  return itemId === 'logs' && quantity === 1 ? 'Greenway log' : ITEM_NAMES[itemId]
}

function eventText(event: WizardEvent): string {
  switch (event.type) {
    case 'resource_damaged': return 'The tree shudders under your axe.'
    case 'resource_harvested': return `Gathered ${event.quantity} ${itemAmountName(event.itemId, event.quantity)}.`
    case 'fairy_ring_discovered': return 'A fairy ring answers your presence.'
    case 'fairy_ring_teleported': return 'The mushroom path folds the world around you.'
    case 'store_item_bought': return `Purchased ${ITEM_NAMES[event.itemId]}.`
    case 'item_equipped': return `Equipped ${ITEM_NAMES[event.itemId]}.`
    case 'trade_listing_created': return `Listed ${event.quantity} ${itemAmountName(event.itemId, event.quantity)} for trade.`
    case 'trade_listing_cancelled': return `Returned ${event.quantity} ${itemAmountName(event.itemId, event.quantity)} to your backpack.`
    case 'player_jumped': return 'You spring over the trail.'
    case 'route_built': return `Built ${event.routeId === 'greenway_ladder' ? 'the Greenway ladder' : 'the Highland bridge'} for ${event.logCost} logs.`
    case 'route_used': return 'You cross the completed route.'
    case 'recipe_unlocked': return 'A new construction recipe is ready.'
    case 'tile_discovered': return 'The map reveals a new tile.'
    default: return ''
  }
}

export function toViewProjection(state: WizardWorldState, messages: readonly RecentMessage[]): WizardViewProjection {
  const domain = createWizardProjection(state)
  const interaction = closestInteraction(state)
  const inventory = domain.player.inventory.map((stack) => itemStack(stack.itemId, stack.quantity))
  const currentTile = state.tiles.reduce((closest, tile) => distance(state.player.position, tile.center) < distance(state.player.position, closest.center) ? tile : closest)
  const equipped = (slot: EquipmentSlot) => {
    const itemId = domain.player.equipment[slot]
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
    routes: state.routes.map((route) => {
      const recipe = state.recipes.find((candidate) => candidate.routeId === route.id)!
      return { id: route.id, label: route.name, from: [route.from.x, route.from.y, route.from.z], to: [route.to.x, route.to.y, route.to.z], built: state.builtRouteIds.includes(route.id), unlocked: state.unlockedRecipeIds.includes(recipe.id), logCost: recipe.logCost }
    }),
    map: {
      tiles: state.tiles.map((tile) => {
        const discovered = state.discoveredTileIds.includes(tile.id)
        return {
          id: tile.id, gridX: tile.gridX, gridZ: tile.gridZ,
          terrain: discovered ? tile.terrain : null, biome: discovered ? tile.biome : null, discovered,
          hasResource: discovered && state.resources.some((resource) => resource.tileId === tile.id && !resource.depleted),
          hasStore: discovered && state.stores.some((store) => distance(store.position, tile.center) < 3),
          hasRing: discovered && state.fairyRings.some((ring) => distance(ring.position, tile.center) < 3),
        }
      }),
      player: { gridX: currentTile.gridX, gridZ: currentTile.gridZ, yaw: state.player.yaw },
    },
    stores: state.stores.map((store) => ({ id: store.id, name: store.name, position: [store.position.x, store.position.y, store.position.z], listings: store.listings.map((listing) => ({ id: listing.id, name: ITEM_NAMES[listing.itemId], price: listing.price, stock: listing.stock })) })),
    backpack: { capacity: domain.player.backpackCapacity, stacks: inventory },
    coins: domain.player.coins,
    experience: { xp: domain.player.xp, nextLevelXp: domain.player.level * 100, level: domain.player.level },
    equipment: { head: equipped('head'), chest: equipped('chest'), legs: equipped('legs'), feet: equipped('feet'), mainHand: equipped('mainHand'), offHand: equipped('offHand') },
    tradeListings: domain.player.tradeSlots.map((slot) => slot.itemId ? ({ id: `trade-${slot.slotIndex}`, itemName: ITEM_NAMES[slot.itemId], quantity: slot.quantity, unitPrice: slot.unitPrice }) : null) as unknown as WizardViewProjection['tradeListings'],
    nearbyInteraction: interaction ? {
      kind: interaction.kind, targetId: interaction.target.id,
      label: interaction.kind === 'resource' ? 'Greenway oak' : interaction.target.name,
      action: interaction.kind === 'resource' ? (axeEquipped(state) ? 'Chop' : owned(state, 'woodcutters_axe') > 0 ? 'Equip axe' : 'Needs axe')
        : interaction.kind === 'store' ? 'Store open'
        : interaction.kind === 'route' ? (state.builtRouteIds.includes(interaction.target.id) ? 'Cross' : state.unlockedRecipeIds.includes(interaction.target.id) ? 'Build' : 'Locked')
        : domain.player.discoveredRingIds.includes(interaction.target.id)
          ? state.fairyRings.some((ring) => ring.id !== interaction.target.id && domain.player.discoveredRingIds.includes(ring.id)) ? 'Choose destination' : 'Find another ring'
          : 'Discover',
      actionable: interaction.kind === 'resource' && (axeEquipped(state) || owned(state, 'woodcutters_axe') > 0)
        || interaction.kind === 'route' && (state.builtRouteIds.includes(interaction.target.id) || state.unlockedRecipeIds.includes(interaction.target.id))
        || (interaction.kind === 'fairy-ring' && !domain.player.discoveredRingIds.includes(interaction.target.id)),
    } : null,
    recentEvents: messages.map((message) => message.text),
  }
}

export function intentForView(state: WizardWorldState, intent: Exclude<WizardViewIntent, { type: 'movement' }>): WizardIntent | null {
  if (intent.type === 'jump') return { type: 'jump' }
  if (intent.type === 'interact') {
    const interaction = closestInteraction(state)
    if (interaction?.kind === 'resource') {
      if (axeEquipped(state)) return { type: 'harvest', resourceId: interaction.target.id }
      return owned(state, 'woodcutters_axe') > 0 ? { type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' } : null
    }
    if (interaction?.kind === 'fairy-ring' && !state.player.discoveredRingIds.includes(interaction.target.id)) return { type: 'discover_fairy_ring', ringId: interaction.target.id }
    if (interaction?.kind === 'route') return state.builtRouteIds.includes(interaction.target.id)
      ? { type: 'traverse_route', routeId: interaction.target.id }
      : { type: 'build_route', routeId: interaction.target.id }
    return null
  }
  if (intent.type === 'store.select-listing') return { type: 'buy_store_listing', storeId: intent.storeId, listingId: intent.listingId }
  if (intent.type === 'equipment.equip') return { type: 'equip_item', itemId: intent.stackId.replace('inventory-', '') as ItemId, slot: intent.slot }
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

// Catch-up cap: at most 12 fixed steps (600 ms) per callback; any excess backlog is discarded
// rather than simulated, so a long stall cannot spiral into ever-longer batches.
export const MAX_CATCH_UP_STEPS = 12
export type StepClock = { lastMs: number | null; accumulatedMs: number }
export const IDLE_CLOCK: StepClock = { lastMs: null, accumulatedMs: 0 }

export function accumulateElapsed(clock: StepClock, nowMs: number): StepClock {
  const elapsed = clock.lastMs === null ? 0 : Math.max(0, nowMs - clock.lastMs)
  return { lastMs: nowMs, accumulatedMs: clock.accumulatedMs + elapsed }
}

export function stepBatch(world: WizardWorldState, queued: readonly WizardIntent[], movement: readonly [number, number], accumulatedMs: number) {
  let steps = Math.floor(accumulatedMs / FIXED_STEP_MS)
  let remainderMs = accumulatedMs - steps * FIXED_STEP_MS
  if (steps > MAX_CATCH_UP_STEPS) { steps = MAX_CATCH_UP_STEPS; remainderMs = 0 }
  let state = world
  const events: WizardEvent[] = []
  const rejections: IntentRejection[] = []
  for (let index = 0; index < steps; index += 1) {
    const result = advanceWizardWorld(state, [...(index === 0 ? queued : []), ...controlIntents(state, movement)])
    state = result.state
    events.push(...result.events)
    rejections.push(...result.rejections)
  }
  return { state, events, rejections, steps, remainderMs }
}

export type BatchSink = { commit: (state: WizardWorldState, messages: string[]) => void; persist: (state: WizardWorldState) => void }

export function runBatch(
  input: { clock: StepClock; nowMs: number; world: WizardWorldState; queued: readonly WizardIntent[]; movement: readonly [number, number] },
  sink: BatchSink,
): { clock: StepClock; world: WizardWorldState; queueConsumed: boolean } {
  const clock = accumulateElapsed(input.clock, input.nowMs)
  const batch = stepBatch(input.world, input.queued, input.movement, clock.accumulatedMs)
  if (batch.steps === 0) return { clock, world: input.world, queueConsumed: false }
  sink.persist(batch.state)
  sink.commit(batch.state, [...batch.events.map(eventText).filter(Boolean), ...batch.rejections.map((rejection) => rejection.message)])
  return { clock: { ...clock, accumulatedMs: batch.remainderMs }, world: batch.state, queueConsumed: true }
}

export default function App() {
  const [world, setWorld] = useState(loadWorld)
  const [messages, setMessages] = useState<RecentMessage[]>([{ id: 0, text: WELCOME_MESSAGE }])
  const worldRef = useRef(world)
  const movementRef = useRef<readonly [number, number]>([0, 0])
  const queuedRef = useRef<WizardIntent[]>([])
  const messageId = useRef(1)
  const clockRef = useRef<StepClock>(IDLE_CLOCK)

  useEffect(() => { worldRef.current = world }, [world])
  useEffect(() => {
    const sink: BatchSink = {
      persist: (state) => window.localStorage.setItem(SAVE_KEY, serializeWizardWorld(state)),
      commit: (state, texts) => {
        setWorld(state)
        if (texts.length) setMessages((current) => [...current, ...texts.map((text) => ({ id: messageId.current++, text }))].slice(-5))
      },
    }
    const onVisibilityChange = () => {
      movementRef.current = [0, 0]
      clockRef.current = IDLE_CLOCK
    }
    const timer = window.setInterval(() => {
      if (document.hidden) return
      const result = runBatch({ clock: clockRef.current, nowMs: performance.now(), world: worldRef.current, queued: queuedRef.current, movement: movementRef.current }, sink)
      clockRef.current = result.clock
      worldRef.current = result.world
      if (result.queueConsumed) queuedRef.current = []
    }, FIXED_STEP_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  const onIntent = useCallback((intent: WizardViewIntent) => {
    if (intent.type === 'movement') {
      movementRef.current = intent.vector
      return
    }
    const domainIntent = intentForView(worldRef.current, intent)
    if (domainIntent) queuedRef.current.push(domainIntent)
  }, [])
  const restart = useCallback(() => {
    const fresh = resetSavedWorld(window.localStorage)
    worldRef.current = fresh
    queuedRef.current = []
    movementRef.current = [0, 0]
    setWorld(fresh)
    setMessages([{ id: messageId.current++, text: WELCOME_MESSAGE }])
  }, [])
  const projection = useMemo(() => toViewProjection(world, messages), [world, messages])

  return <main style={{ position: 'fixed', inset: 0, background: '#14221f' }}>
    <WizardSurface projection={projection} onIntent={onIntent} diagnostics />
    <style>{OBJECTIVE_STYLES}</style>
    <div className="wr-objective" role="status">
      <span><b>OBJECTIVE</b> {objectiveFor(world)}</span>
      <button type="button" onClick={restart}>Restart</button>
    </div>
  </main>
}
