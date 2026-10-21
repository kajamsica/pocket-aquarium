import { highlandLandmark, highlandStoneNodes, isHighlandAuthoredPosition } from './highlandContent'
import { backpackSlotsAfterAdd } from './backpackSlots'
import { publicV11Gait } from './publicWorldGait'
import { publicBootPurchaseCandidate } from './publicBootPurchase'
import { applyFieldCampV10Action } from './fieldCamp'
import type { FieldCampV10ActionResult } from './fieldCamp'
import { applyMireglassExpeditionAction } from './mireglassExpedition'
import { actPublicV10Mireglass } from './publicWorldActions'
import type { PublicMireglassAction, PublicMireglassV10ActionResult } from './publicWorldActions'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { advancePublicWorldV11BaseFrame } from './publicWorldRuntime'
import type { PublicWorldEvent, PublicWorldIntent, PublicWorldRejection } from './publicWorldRuntime'
import type { PublicWorldV10State } from './publicWorldV10State'
import { isValidPublicWorldV11State } from './publicWorldV11State'
import type { PublicWorldV11State } from './publicWorldV11State'

export type PublicV11HighlandAction = { type: 'extract_highland_stone'; nodeId: string }
export type PublicV11HighlandEvent = {
  type: 'highland_stone_extracted'
  tick: number
  sequence: number
  nodeId: string
  itemId: 'stone'
  quantity: 2
  xp: 20
}
export type PublicV11LandmarkEvent = {
  type: 'highland_landmark_discovered'
  tick: number
  sequence: number
  landmarkId: string
}
export type PublicV11HighlandRejection = { actionType: 'extract_highland_stone' | 'unknown';
  code: 'invalid_progress' | 'invalid_value' | 'unavailable_here' | 'not_found' | 'undiscovered'
    | 'too_far' | 'requires_spade' | 'skill_locked' | 'capacity' | 'recovering'; message: string }
export type PublicV11HighlandActionResult =
  | { state: PublicWorldV11State; event: PublicV11HighlandEvent; rejection?: never }
  | { state: PublicWorldV11State; rejection: PublicV11HighlandRejection; event?: never }
export type PublicWorldV11AdvanceResult = {
  state: PublicWorldV11State
  events: Array<PublicWorldEvent | PublicV11LandmarkEvent>
  rejections: PublicWorldRejection[]
}

/** V11 has a virtual Outfitters offer so old generated store catalogs stay byte-compatible. */
export function buyPublicV11Boots(state: PublicWorldV11State, storeId: string,
  bootstrap: PublicV6BootstrapRoot | null = null):
  | { state: PublicWorldV11State; rejection: { message: string }; event?: never }
  | { state: PublicWorldV11State; event: Extract<PublicWorldEvent, { type: 'store_item_bought' }>;
    rejection?: never } {
  const reject = (message: string) => ({ state, rejection: { message } })
  if (!isValidPublicWorldV11State(state, bootstrap)) return reject('The v11 world is invalid.')
  const purchase = publicBootPurchaseCandidate(state, storeId)
  if ('rejection' in purchase) return reject(purchase.rejection)
  const next: PublicWorldV11State = { ...state, eventSequence: purchase.eventSequence,
    player: purchase.player }
  if (!isValidPublicWorldV11State(next, bootstrap)) return reject('The purchase would leave an invalid world.')
  return { state: next, event: purchase.event }
}

type V10MireglassSuccess = Extract<PublicMireglassV10ActionResult, { event: unknown }>
type V10MireglassFailure = Extract<PublicMireglassV10ActionResult, { rejection: unknown }>
export type PublicMireglassV11Action = PublicMireglassAction | { type: 'unequip_item'; slot: 'feet' }
export type PublicMireglassV11ActionResult =
  | { state: PublicWorldV11State; event: V10MireglassSuccess['event']
    | Extract<PublicWorldEvent, { type: 'item_unequipped' }>; rejection?: never }
  | { state: PublicWorldV11State; rejection: V10MireglassFailure['rejection']
    | { actionType: 'unequip_item'; code: 'invalid_progress' | 'unavailable_here' | 'invalid_value'; message: string };
    event?: never }
type V10CampSuccess = Extract<FieldCampV10ActionResult, { event: unknown }>
type V10CampFailure = Extract<FieldCampV10ActionResult, { rejection: unknown }>
export type FieldCampV11ActionResult =
  | { state: PublicWorldV11State; event: V10CampSuccess['event']; rejection?: never }
  | { state: PublicWorldV11State; rejection: V10CampFailure['rejection']; event?: never }

function projectV10(state: PublicWorldV11State): PublicWorldV10State {
  const { highlandContentRevision: _revision, highland: _progress, ...v10 } = state
  return v10
}
function preserveHighland(state: PublicWorldV11State, v10: PublicWorldV10State): PublicWorldV11State {
  return { ...v10, highlandContentRevision: state.highlandContentRevision, highland: state.highland }
}

/** Reuses v10 Mireglass rules without weakening either version's exact-key validator. */
export function actPublicV11Mireglass(state: PublicWorldV11State, action: PublicMireglassV11Action,
  bootstrap: PublicV6BootstrapRoot | null = null): PublicMireglassV11ActionResult {
  const invalid = (): PublicMireglassV11ActionResult => ({ state, rejection: {
    actionType: action?.type ?? 'unknown', code: 'invalid_progress',
    message: 'The v11 world state is invalid.',
  } })
  if (!isValidPublicWorldV11State(state, bootstrap)) return invalid()
  if (action?.type === 'unequip_item') {
    const reject = (code: 'unavailable_here' | 'invalid_value', message: string): PublicMireglassV11ActionResult =>
      ({ state, rejection: { actionType: 'unequip_item', code, message } })
    if (state.movementOwner !== 'streamed') return reject('unavailable_here',
      'Mireglass equipment actions are unavailable while Greenway owns movement.')
    if (action.slot !== 'feet' || state.player.equipment.feet === null) return reject('invalid_value',
      'No footwear is equipped in Feet.')
    if (!Number.isSafeInteger(state.eventSequence + 1)) return reject('invalid_value',
      'The event sequence is exhausted.')
    const itemId = state.player.equipment.feet
    const next: PublicWorldV11State = { ...state, eventSequence: state.eventSequence + 1,
      player: { ...state.player, equipment: { ...state.player.equipment, feet: null } } }
    if (!isValidPublicWorldV11State(next, bootstrap)) return invalid()
    return { state: next, event: { type: 'item_unequipped', itemId, slot: 'feet',
      tick: state.tick, sequence: next.eventSequence } }
  }
  if (action?.type === 'equip_item' && action.itemId === 'leather_boots') {
    if (state.movementOwner !== 'streamed') return { state, rejection: {
      actionType: 'equip_item', code: 'unavailable_here',
      message: 'Mireglass equipment actions are unavailable while Greenway owns movement.',
    } }
    if (!Number.isSafeInteger(state.eventSequence + 1)) return { state, rejection: {
      actionType: 'equip_item', code: 'invalid_value', message: 'The event sequence is exhausted.',
    } }
    const result = applyMireglassExpeditionAction(state.seed, state.player, state.mireglass,
      action, state.discoveredTileIds, true)
    if (result.rejection) return { state, rejection: result.rejection }
    const next: PublicWorldV11State = { ...state, player: result.player,
      eventSequence: state.eventSequence + 1 }
    if (!isValidPublicWorldV11State(next, bootstrap)) return invalid()
    return { state: next, event: { ...result.event, sequence: next.eventSequence } }
  }
  const result = actPublicV10Mireglass(projectV10(state), action, bootstrap)
  if (result.rejection) return { state, rejection: result.rejection }
  const next = preserveHighland(state, result.state)
  if (!isValidPublicWorldV11State(next, bootstrap)) return invalid()
  return { state: next, event: result.event }
}

/** Camp placement sees the v10 terrain witness, then restores v11 quarry progress. */
export function applyFieldCampV11Action(state: PublicWorldV11State, tileId: string,
  bootstrap: PublicV6BootstrapRoot | null = null): FieldCampV11ActionResult {
  const invalid = (): FieldCampV11ActionResult => ({ state, rejection: {
    code: 'invalid_progress', message: 'The v11 camp world state is invalid.',
  } })
  if (!isValidPublicWorldV11State(state, bootstrap)) return invalid()
  const result = applyFieldCampV10Action(projectV10(state), tileId, bootstrap)
  if (result.rejection) return { state, rejection: result.rejection }
  const next = preserveHighland(state, result.state)
  if (!isValidPublicWorldV11State(next, bootstrap)) return invalid()
  return { state: next, event: result.event }
}

const ownsSpade = (state: PublicWorldV11State) => state.player.inventory
  .some((stack) => stack.itemId === 'field_spade' && stack.quantity > 0)

/** Pure action boundary: any failure returns the exact original state reference. */
export function actPublicV11Highland(state: PublicWorldV11State, action: PublicV11HighlandAction,
  bootstrap: PublicV6BootstrapRoot | null = null): PublicV11HighlandActionResult {
  const reject = (code: PublicV11HighlandRejection['code'], message: string): PublicV11HighlandActionResult =>
    ({ state, rejection: { actionType: action?.type === 'extract_highland_stone'
      ? 'extract_highland_stone' : 'unknown', code, message } })
  if (!isValidPublicWorldV11State(state, bootstrap)) return reject('invalid_progress', 'The v11 world is invalid.')
  if (!action || action.type !== 'extract_highland_stone' || typeof action.nodeId !== 'string'
    || Reflect.ownKeys(action).length !== 2) return reject('invalid_value', 'Unknown Highland action.')
  if (state.movementOwner !== 'streamed' || !isHighlandAuthoredPosition(state.player.position)) {
    return reject('unavailable_here', 'The quarry is not available from this region.')
  }
  const node = highlandStoneNodes(state.seed).find(({ id }) => id === action.nodeId)
  if (!node) return reject('not_found', 'This is not a canonical Highland stone node.')
  if (!state.highland.landmarkDiscovered) return reject('undiscovered', 'Discover the quarry landmark on foot first.')
  if (!state.discoveredTileIds.includes(node.tile.id)) return reject('undiscovered', 'Walk to this node before extracting stone.')
  if (Math.hypot(state.player.position.x - node.tile.center.x,
    state.player.position.y - node.tile.center.y,
    state.player.position.z - node.tile.center.z) > 3) return reject('too_far', 'The stone node is out of reach.')
  if (state.player.equipment.mainHand !== 'field_spade' || !ownsSpade(state)) {
    return reject('requires_spade', 'Equip an owned field spade to quarry stone.')
  }
  if (1 + Math.floor(state.player.skillXp.excavation / 30) < 2) {
    return reject('skill_locked', 'Excavation level two is required.')
  }
  if (backpackSlotsAfterAdd(state.player.inventory, state.player.tradeSlots, 'stone', 2)
    > state.player.backpackCapacity) {
    return reject('capacity', 'The backpack cannot hold two stone.')
  }
  const progress = state.highland.stoneNodes.find(({ id }) => id === node.id)!
  if (state.tick < progress.readyAtTick) return reject('recovering', 'This stone node is recovering.')
  const stoneIndex = state.player.inventory.findIndex((stack) => stack.itemId === 'stone')
  const stone = stoneIndex >= 0 ? state.player.inventory[stoneIndex] : null
  if (![state.tick + 3000, state.eventSequence + 1, state.player.xp + 20,
    state.player.skillXp.excavation + 20, (stone?.quantity ?? 0) + 2].every(Number.isSafeInteger)) {
    return reject('invalid_value', 'The quarry clock, item count, or experience would overflow.')
  }
  const inventory = stone
    ? state.player.inventory.map((stack, index) => index === stoneIndex
      ? { ...stack, quantity: stack.quantity + 2 } : stack)
    : [...state.player.inventory, { itemId: 'stone' as const, quantity: 2 }]
  const xp = state.player.xp + 20
  const next: PublicWorldV11State = { ...state, eventSequence: state.eventSequence + 1,
    player: { ...state.player, inventory, xp, level: 1 + Math.floor(xp / 100),
      skillXp: { ...state.player.skillXp, excavation: state.player.skillXp.excavation + 20 } },
    highland: { ...state.highland, stoneNodes: state.highland.stoneNodes.map((entry) => entry.id === node.id
      ? { ...entry, readyAtTick: state.tick + 3000 } : entry) } }
  if (!isValidPublicWorldV11State(next, bootstrap)) {
    return reject('invalid_progress', 'Quarry extraction would leave an invalid world.')
  }
  return { state: next, event: { type: 'highland_stone_extracted', tick: state.tick,
    sequence: next.eventSequence, nodeId: node.id, itemId: 'stone', quantity: 2, xp: 20 } }
}

type BootstrapProof = readonly string[] | null
const trusted = new WeakMap<object, BootstrapProof>()
const BOOTSTRAP_KEYS = ['schemaVersion', 'greenwayContentRevision', 'mireglassContentRevision',
  'seed', 'source', 'greenwaySaveBytes'] as const
const SOURCE_KEYS = ['profile', 'key', 'bytes'] as const
const exactDataRecord = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== keys.length) return false
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, 'value')
  })
}
function bootstrapProof(bootstrap: PublicV6BootstrapRoot | null): BootstrapProof | undefined {
  if (bootstrap === null) return null
  try {
    if (!exactDataRecord(bootstrap, BOOTSTRAP_KEYS)
      || !exactDataRecord(bootstrap.source, SOURCE_KEYS)) return undefined
    const values = [bootstrap.schemaVersion, bootstrap.greenwayContentRevision,
      bootstrap.mireglassContentRevision, bootstrap.seed, bootstrap.greenwaySaveBytes,
      bootstrap.source.profile, bootstrap.source.key, bootstrap.source.bytes]
    return values.every((value) => typeof value === 'string') ? Object.freeze(values) : undefined
  } catch { return undefined }
}
const sameProof = (expected: BootstrapProof, actual: BootstrapProof | undefined) => actual !== undefined
  && (expected === null ? actual === null : actual !== null
    && expected.every((value, index) => value === actual[index]))
function freezeDeep(value: object): void {
  if (Object.isFrozen(value)) return
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new RangeError('Invalid v11 state accessor.')
    if (descriptor.value !== null && typeof descriptor.value === 'object') freezeDeep(descriptor.value)
  }
  Object.freeze(value)
}

/** Shared voluntary gait and equipment policy for v11 and already-trusted v12 frames. */
export function publicV11FrameGuard(input: PublicWorldV11State,
  intents: readonly PublicWorldIntent[], walkRequested: boolean): PublicWorldRejection | null {
  const gait = publicV11Gait(input.player.equipment.feet, walkRequested === true)
  const moveIndex = intents.findIndex((intent) => intent.type === 'move')
  const move = intents[moveIndex]
  if (move?.type === 'move' && Math.hypot(move.delta.x, move.delta.z) > gait.metersPerStep + 1e-9) {
    return { intentIndex: moveIndex, intentType: 'move', code: 'invalid_value',
      message: `${gait.reason}. Maximum step is ${gait.metersPerStep} m.` }
  }
  const duplicateEquipIndex = intents.findIndex((intent) => intent.type === 'equip_item'
    && intent.slot === 'feet' && intent.itemId === 'leather_boots'
    && input.player.equipment.feet === 'leather_boots')
  return duplicateEquipIndex >= 0 ? { intentIndex: duplicateEquipIndex, intentType: 'equip_item',
    code: 'invalid_value', message: 'Leather boots are already equipped.' } : null
}

/** Fold a realized Highland approach after the shared base frame, preserving event order. */
export function foldPublicV11Landmark(input: PublicWorldV11State,
  intents: readonly PublicWorldIntent[], base: ReturnType<typeof advancePublicWorldV11BaseFrame>):
  PublicWorldV11AdvanceResult {
  let next = base.state
  const events: PublicWorldV11AdvanceResult['events'] = [...base.events]
  const moved = intents.some((intent) => intent.type === 'move'
    && (intent.delta.x !== 0 || intent.delta.z !== 0))
    && (next.player.position.x !== input.player.position.x
      || next.player.position.z !== input.player.position.z)
  if (moved && next.movementOwner === 'streamed' && !next.highland.landmarkDiscovered) {
    const landmark = highlandLandmark(next.seed)
    if (Math.hypot(next.player.position.x - landmark.tile.center.x,
      next.player.position.z - landmark.tile.center.z) <= 8) {
      next = { ...next, eventSequence: next.eventSequence + 1,
        highland: { ...next.highland, landmarkDiscovered: true } }
      events.push({ type: 'highland_landmark_discovered', tick: next.tick,
        sequence: next.eventSequence, landmarkId: landmark.id })
    }
  }
  return { state: next, events, rejections: [] }
}

/** V11 keeps its own frozen trust chain, so older exact-key runtime entrypoints stay untouched. */
export function advancePublicWorldV11Frame(state: PublicWorldV11State,
  intents: readonly PublicWorldIntent[], bootstrap: PublicV6BootstrapRoot | null = null,
  walkRequested = false): PublicWorldV11AdvanceResult {
  const invalid = (): PublicWorldV11AdvanceResult => {
    if (!intents[0]) throw new RangeError('Invalid v11 world state.')
    return { state, events: [], rejections: [{ intentIndex: 0, intentType: intents[0].type,
      code: 'invalid_value', message: 'Invalid v11 world state.' }] }
  }
  const proof = bootstrapProof(bootstrap)
  if (proof === undefined) return invalid()
  const prior = trusted.get(state)
  if (prior !== undefined && !sameProof(prior, proof)) return invalid()
  let input = state
  if (prior === undefined) {
    if (!isValidPublicWorldV11State(state, bootstrap)) return invalid()
    try { input = structuredClone(state) } catch { return invalid() }
    if (!isValidPublicWorldV11State(input, bootstrap)
      || !sameProof(proof, bootstrapProof(bootstrap))) return invalid()
  }
  if (!Number.isSafeInteger(input.eventSequence + 9)) return invalid()
  let frameIntents: readonly PublicWorldIntent[]
  try { frameIntents = structuredClone(intents) } catch { return invalid() }
  const guard = publicV11FrameGuard(input, frameIntents, walkRequested)
  if (guard) return { state, events: [], rejections: [guard] }
  const base = advancePublicWorldV11BaseFrame(input, frameIntents)
  if (base.rejections.length) return { state, events: [], rejections: base.rejections }
  const { state: next, events } = foldPublicV11Landmark(input, frameIntents, base)
  if ((prior === undefined && !isValidPublicWorldV11State(next, bootstrap))
    || !sameProof(proof, bootstrapProof(bootstrap))) return invalid()
  freezeDeep(next)
  trusted.set(next, proof)
  return { state: next, events, rejections: [] }
}
