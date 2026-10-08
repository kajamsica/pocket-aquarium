import { highlandCorridorCells, highlandLandmark } from './highlandContent'
import { HIGHLAND_WINDWARD_STEP, highlandWindCastWindow, highlandWindTrailLocation,
  isHighlandWindWestboundTrailStep } from './highlandWindContent'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { advancePublicWorldV11Frame } from './publicWorldV11Authority'
import type { PublicV11LandmarkEvent } from './publicWorldV11Authority'
import type { PublicWorldEvent, PublicWorldIntent, PublicWorldRejection } from './publicWorldRuntime'
import type { PublicWorldV11State } from './publicWorldV11State'
import { isValidPublicWorldV12State } from './publicWorldV12State'
import type { PublicWorldV12State } from './publicWorldV12State'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

export type PublicV12WindAction =
  | { type: 'study_windward_glyph' }
  | { type: 'cast_windward_step' }

export type PublicV12WindEvent =
  | { type: 'windward_glyph_studied'; tick: number; sequence: number;
      landmarkId: typeof HIGHLAND_WINDWARD_STEP.learnedAtLandmarkId; spellId: 'windward_step' }
  | { type: 'windward_step_cast'; tick: number; sequence: number; spellId: 'windward_step';
      activeUntilTick: number; nextCastTick: number }

export type PublicV12WindPracticeEvent = {
  type: 'windward_step_practiced'
  tick: number
  sequence: number
  spellId: 'windward_step'
  segmentIndex: number
  xp: 1
}

export type PublicV12WindRejection = {
  actionType: PublicV12WindAction['type'] | 'unknown'
  code: 'invalid_progress' | 'invalid_value' | 'unavailable_here' | 'undiscovered'
    | 'too_far' | 'not_on_foot' | 'already_learned' | 'not_learned'
    | 'not_on_trail' | 'cooldown'
  message: string
}

export type PublicV12WindActionResult =
  | { state: PublicWorldV12State; event: PublicV12WindEvent; rejection?: never }
  | { state: PublicWorldV12State; rejection: PublicV12WindRejection; event?: never }

export type PublicWorldV12AdvanceResult = {
  state: PublicWorldV12State
  events: Array<PublicWorldEvent | PublicV11LandmarkEvent | PublicV12WindPracticeEvent>
  rejections: PublicWorldRejection[]
}

type BootstrapProof = readonly string[] | null
type TrustedFrame = { proof: BootstrapProof; v11: PublicWorldV11State }
const trustedFrames = new WeakMap<object, TrustedFrame>()
const BOOTSTRAP_KEYS = ['schemaVersion', 'greenwayContentRevision', 'mireglassContentRevision',
  'seed', 'source', 'greenwaySaveBytes'] as const
const SOURCE_KEYS = ['profile', 'key', 'bytes'] as const

function dataRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
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
    if (!dataRecord(bootstrap, BOOTSTRAP_KEYS)
      || !dataRecord(bootstrap.source, SOURCE_KEYS)) return undefined
    const values = [bootstrap.schemaVersion, bootstrap.greenwayContentRevision,
      bootstrap.mireglassContentRevision, bootstrap.seed, bootstrap.greenwaySaveBytes,
      bootstrap.source.profile, bootstrap.source.key, bootstrap.source.bytes]
    return values.every((value) => typeof value === 'string') ? Object.freeze(values) : undefined
  } catch { return undefined }
}

function sameProof(expected: BootstrapProof, actual: BootstrapProof | undefined): boolean {
  return actual !== undefined && (expected === null ? actual === null : actual !== null
    && expected.every((value, index) => value === actual[index]))
}

function freezeDeep(value: object): void {
  if (Object.isFrozen(value)) return
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new RangeError('Invalid v12 state accessor.')
    if (descriptor.value !== null && typeof descriptor.value === 'object') freezeDeep(descriptor.value)
  }
  Object.freeze(value)
}

function projectV11(state: PublicWorldV12State): PublicWorldV11State {
  const { windContentRevision: _revision, windstep: _windstep, ...v11 } = state
  return v11
}

function acceptedState(v11: PublicWorldV11State, source: PublicWorldV12State,
  windstep: PublicWorldV12State['windstep'], proof: BootstrapProof): PublicWorldV12State {
  const state: PublicWorldV12State = { ...v11,
    windContentRevision: source.windContentRevision, windstep }
  freezeDeep(state)
  trustedFrames.set(state, { proof, v11 })
  return state
}

/** A valid imported state is detached before any rule reads it. Frozen results use a bounded fast path. */
function ingress(state: PublicWorldV12State, bootstrap: PublicV6BootstrapRoot | null):
  { state: PublicWorldV12State; v11: PublicWorldV11State;
    bootstrap: PublicV6BootstrapRoot | null; proof: BootstrapProof } | null {
  const proof = bootstrapProof(bootstrap)
  if (proof === undefined) return null
  const trusted = trustedFrames.get(state)
  if (trusted) return sameProof(trusted.proof, proof)
    ? { state, v11: trusted.v11, bootstrap, proof } : null
  try {
    if (!isValidPublicWorldV12State(state, bootstrap)) return null
    const copy = structuredClone(state) as PublicWorldV12State
    const bootstrapCopy = bootstrap === null ? null : structuredClone(bootstrap)
    if (!isValidPublicWorldV12State(copy, bootstrapCopy)
      || !sameProof(proof, bootstrapProof(bootstrap))
      || !sameProof(proof, bootstrapProof(bootstrapCopy))) return null
    return { state: copy, v11: projectV11(copy), bootstrap: bootstrapCopy, proof }
  } catch { return null }
}

const gridAtWorld = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)
function onFoot(state: PublicWorldV12State): boolean {
  if (state.player.verticalVelocity !== 0) return false
  const { x, y, z } = state.player.position
  const ground = worldTileAtGrid(state.seed, gridAtWorld(x), gridAtWorld(z))
  return Math.abs(y - ground.center.y) <= 0.001
}

function exactAction(action: unknown): action is PublicV12WindAction {
  if (!dataRecord(action, ['type'])) return false
  return action.type === 'study_windward_glyph' || action.type === 'cast_windward_step'
}

/** Actions change one overlay on the one v11 player and never advance its movement clock. */
export function actPublicV12Windstep(state: PublicWorldV12State, action: PublicV12WindAction,
  bootstrap: PublicV6BootstrapRoot | null = null): PublicV12WindActionResult {
  let snapshot: PublicV12WindAction | null = null
  try {
    if (exactAction(action)) {
      const copy: unknown = structuredClone(action)
      if (exactAction(copy)) snapshot = copy
    }
  } catch { /* invalid action */ }
  const actionType: PublicV12WindRejection['actionType'] = snapshot?.type ?? 'unknown'
  const reject = (code: PublicV12WindRejection['code'], message: string): PublicV12WindActionResult =>
    ({ state, rejection: { actionType, code, message } })
  const input = ingress(state, bootstrap)
  if (!input) return reject('invalid_progress', 'The v12 world state is invalid.')
  if (!snapshot) return reject('invalid_value', 'Unknown Windward Step action.')
  if (input.state.movementOwner !== 'streamed') {
    return reject('unavailable_here', 'Windward Step is only available on the Highland trail.')
  }
  if (!onFoot(input.state)) return reject('not_on_foot', 'Stand on solid ground to use the wind glyph.')
  if (snapshot.type === 'study_windward_glyph') {
    if (input.state.windstep.learned) return reject('already_learned', 'The wind glyph is already studied.')
    if (!input.state.highland.landmarkDiscovered) {
      return reject('undiscovered', 'Discover Quarry Crown on foot first.')
    }
    const glyph = highlandLandmark(input.state.seed)
    const position = input.state.player.position
    if (Math.hypot(position.x - glyph.tile.center.x,
      position.y - glyph.tile.center.y, position.z - glyph.tile.center.z) > 3) {
      return reject('too_far', 'The Quarry Crown wind glyph is out of reach.')
    }
    if (!Number.isSafeInteger(input.state.eventSequence + 1)) {
      return reject('invalid_value', 'The event sequence is exhausted.')
    }
    const nextV11 = { ...input.v11, eventSequence: input.v11.eventSequence + 1 }
    const next = acceptedState(nextV11, input.state,
      { ...input.state.windstep, learned: true }, input.proof)
    if (!sameProof(input.proof, bootstrapProof(bootstrap))) {
      return reject('invalid_progress', 'The v12 source changed during the action.')
    }
    return { state: next, event: { type: 'windward_glyph_studied', tick: next.tick,
      sequence: next.eventSequence, landmarkId: glyph.id, spellId: 'windward_step' } }
  }
  if (!input.state.windstep.learned) return reject('not_learned', 'Study the Quarry Crown glyph first.')
  const location = highlandWindTrailLocation(input.state.player.position)
  const position = input.state.player.position
  if (!location || worldTileAtGrid(input.state.seed,
    gridAtWorld(position.x), gridAtWorld(position.z)).terrain === 'wetland') {
    return reject('not_on_trail', 'Stand on the dry authored Highland trail to cast.')
  }
  if (input.state.tick < input.state.windstep.nextCastTick) {
    return reject('cooldown', 'Windward Step is still recovering.')
  }
  const window = highlandWindCastWindow(input.state.tick)
  if (!window || !Number.isSafeInteger(input.state.eventSequence + 1)) {
    return reject('invalid_value', 'The spell clock or event sequence is exhausted.')
  }
  const nextV11 = { ...input.v11, eventSequence: input.v11.eventSequence + 1 }
  const next = acceptedState(nextV11, input.state,
    { ...input.state.windstep, activeUntilTick: window.activeUntilTick,
      nextCastTick: window.readyAtTick }, input.proof)
  if (!sameProof(input.proof, bootstrapProof(bootstrap))) {
    return reject('invalid_progress', 'The v12 source changed during the action.')
  }
  return { state: next, event: { type: 'windward_step_cast', tick: next.tick,
    sequence: next.eventSequence, spellId: 'windward_step',
    activeUntilTick: window.activeUntilTick, nextCastTick: window.readyAtTick } }
}

type MoveIntent = Extract<PublicWorldIntent, { type: 'move' }>
function sampledMove(intents: readonly PublicWorldIntent[]): { index: number; move: MoveIntent } | null {
  const index = intents.findIndex((intent) => intent.type === 'move')
  const move = intents[index]
  if (!move || move.type !== 'move') return null
  if (typeof move.delta !== 'object' || move.delta === null || Array.isArray(move.delta)) return null
  const keys = Reflect.ownKeys(move.delta)
  if (keys.some((key) => key !== 'x' && key !== 'y' && key !== 'z')) return null
  const { x, z, y = 0 } = move.delta
  return Number.isFinite(x) && Number.isFinite(z) && y === 0 && Number.isFinite(y)
    && Math.hypot(x, z) > 0 && Math.hypot(x, z) <= 0.16 + 1e-9
    ? { index, move } : null
}

/** A doubtful tangent, corner, cell edge, jump, or long intent remains a normal v11 move. */
function assistedIntents(state: PublicWorldV12State, intents: readonly PublicWorldIntent[]):
  { intents: readonly PublicWorldIntent[]; assisted: boolean } {
  if (!state.windstep.learned || state.tick >= state.windstep.activeUntilTick
    || state.movementOwner !== 'streamed' || !onFoot(state)) return { intents, assisted: false }
  // Only the two fixed-frame shapes supported by v11 may be transformed. In
  // particular, jump plus move and duplicate moves must reach v11 unchanged.
  if (!(intents.length === 1 && intents[0].type === 'move'
    || intents.length === 2 && intents[0].type === 'look' && intents[1].type === 'move')) {
    return { intents, assisted: false }
  }
  const sampled = sampledMove(intents)
  if (!sampled) return { intents, assisted: false }
  const { x, z } = sampled.move.delta
  const from = state.player.position
  const normal = { x: from.x + x, z: from.z + z }
  const rawBoosted = { x: from.x + x * HIGHLAND_WINDWARD_STEP.speedMultiplier,
    z: from.z + z * HIGHLAND_WINDWARD_STEP.speedMultiplier }
  const start = highlandWindTrailLocation(from)
  // Repeated 0.20 m steps can miss a 4 m corner by machine epsilon. Snap only
  // that sub-nanometer rounding error to the authored vertex, never across it.
  const westVertex = start && highlandCorridorCells()[start.segmentIndex]
  const boosted = westVertex && Math.hypot(rawBoosted.x - westVertex.x,
    rawBoosted.z - westVertex.z) <= 1e-9 ? westVertex : rawBoosted
  const normalEnd = highlandWindTrailLocation(normal)
  const boostedEnd = highlandWindTrailLocation(boosted)
  const length = Math.hypot(x, z)
  if (!start || !normalEnd || !boostedEnd
    || start.routeMeters - normalEnd.routeMeters < length * 0.9
    || start.routeMeters - boostedEnd.routeMeters < length * 0.9
    // An old-tangent overshoot at a 4 m bend is not travel on its next leg.
    || (boostedEnd.segmentIndex < start.segmentIndex
      && boostedEnd.deviationMeters > start.deviationMeters + 1e-9)
    || !isHighlandWindWestboundTrailStep(state.seed, from, normal)
    || !isHighlandWindWestboundTrailStep(state.seed, from, boosted)) {
    return { intents, assisted: false }
  }
  const scaled = intents.map((intent, index) => index === sampled.index
    ? { type: 'move' as const, delta: { x: boosted.x - from.x,
      z: boosted.z - from.z } } : intent)
  return { intents: scaled, assisted: true }
}

/** One v11 movement-authority call, followed by a bounded, realized-segment ledger commit. */
export function advancePublicWorldV12Frame(state: PublicWorldV12State,
  intents: readonly PublicWorldIntent[],
  bootstrap: PublicV6BootstrapRoot | null = null): PublicWorldV12AdvanceResult {
  const invalid = (): PublicWorldV12AdvanceResult => {
    if (!intents[0]) throw new RangeError('Invalid v12 world state.')
    return { state, events: [], rejections: [{ intentIndex: 0, intentType: intents[0].type,
      code: 'invalid_value', message: 'Invalid v12 world state.' }] }
  }
  const input = ingress(state, bootstrap)
  if (!input || !Number.isSafeInteger(input.state.eventSequence + 9)) return invalid()
  let frameIntents: readonly PublicWorldIntent[]
  try { frameIntents = structuredClone(intents) } catch { return invalid() }
  if (!Array.isArray(frameIntents) || !frameIntents.every((intent) =>
    typeof intent === 'object' && intent !== null && typeof intent.type === 'string'
    && (intent.type !== 'move' || typeof intent.delta === 'object'
      && intent.delta !== null && !Array.isArray(intent.delta)))) return invalid()
  const selected = assistedIntents(input.state, frameIntents)
  const base = advancePublicWorldV11Frame(input.v11, selected.intents, input.bootstrap)
  if (base.rejections.length) return { state, events: [], rejections: base.rejections }
  if (!sameProof(input.proof, bootstrapProof(bootstrap))) return invalid()

  let v11 = base.state
  let windstep = input.state.windstep
  const events: PublicWorldV12AdvanceResult['events'] = [...base.events]
  const move = sampledMove(frameIntents)
  if (selected.assisted && move && input.state.tick < windstep.activeUntilTick) {
    const before = input.state.player.position
    const after = base.state.player.position
    const intendedX = before.x + move.move.delta.x * HIGHLAND_WINDWARD_STEP.speedMultiplier
    const intendedZ = before.z + move.move.delta.z * HIGHLAND_WINDWARD_STEP.speedMultiplier
    const origin = highlandWindTrailLocation(before)
    const arrival = highlandWindTrailLocation(after)
    const realized = Math.hypot(after.x - before.x, after.z - before.z)
    if (origin && arrival && arrival.segmentIndex < origin.segmentIndex
      && !windstep.practicedRouteIndices.includes(arrival.segmentIndex)
      && Math.abs(after.x - intendedX) <= 1e-9 && Math.abs(after.z - intendedZ) <= 1e-9
      && realized <= HIGHLAND_WINDWARD_STEP.maxAssistedStepMeters + 1e-9
      && isHighlandWindWestboundTrailStep(input.state.seed, before, after)) {
      const indices = [...windstep.practicedRouteIndices, arrival.segmentIndex].sort((a, b) => a - b)
      windstep = { ...windstep, practicedRouteIndices: indices }
      if (indices.length % 4 === 0) {
        const xp = v11.player.xp + 1
        const spellcraft = v11.player.skillXp.spellcraft + 1
        const sequence = v11.eventSequence + 1
        const level = 1 + Math.floor(xp / 100)
        if (![xp, spellcraft, sequence, level].every(Number.isSafeInteger)) return invalid()
        v11 = { ...v11, eventSequence: sequence,
          player: { ...v11.player, xp, level,
            skillXp: { ...v11.player.skillXp, spellcraft } } }
        events.push({ type: 'windward_step_practiced', tick: v11.tick, sequence,
          spellId: 'windward_step', segmentIndex: arrival.segmentIndex, xp: 1 })
      }
    }
  }
  const next = acceptedState(v11, input.state, windstep, input.proof)
  return { state: next, events, rejections: [] }
}
