import type { createAtomicV14Store } from './atomicV14Database'
import { preservesPublicV13History } from './publicV13History'
import { advancePublicV14GreenwayAction } from './publicWorldV14Actions'
import { advancePublicV14GreenwayFrame } from './publicWorldV14GreenwayFrame'
import { createPublicV14ContinuousSession } from './publicWorldV14ContinuousSession'
import { confirmPublicV14TerrainWork } from './publicWorldV14TerrainWork'
import type { PublicTerrainWorkEvent } from './publicTerrainWorkAction'
import { PUBLIC_V11_BOOTS_LISTING_ID } from './publicWorldGait'
import { STARTER_CLIFF_SITE_ID } from './starterCliffProfile'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import type { PublicWorldEvent, PublicWorldIntent } from './publicWorldRuntime'
import { createFreshPublicV14Head, decodePublicV14Head,
  decodePublicV14FrameWitness, decodePublicV14Lineage, encodePublicV14Head } from './publicWorldV14Snapshot'
import type { PublicV14FrameWitness, PublicV14Head,
  PublicV14Lineage, PublicV14State } from './publicWorldV14Snapshot'
import { samePublicV14Value, validatePublicV14State } from './publicWorldV14Validation'

type Store = ReturnType<typeof createAtomicV14Store>
export type PublicV14Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV14Start = Readonly<{
  state: PublicV14State; bootstrap: null; saveRevision: number; lineage: PublicV14Lineage
}>
export type PublicV14ActionCommit = Readonly<{
  start: PublicV14Start; events: readonly PublicWorldEvent[]
}>
export type PublicV14FrameBatchCommit = PublicV14ActionCommit
export type PublicV14TerrainWorkCommit = Readonly<{
  start: PublicV14Start; event: PublicTerrainWorkEvent
}>
export type PublicV14Inspection =
  | { status: 'missing' }
  | { status: 'valid'; start: PublicV14Start }
  | { status: 'blocked'; reason: string }

const failed = (reason: string): PublicV14Operation<never> => ({ ok: false, reason })
const succeeded = <T,>(value: T): PublicV14Operation<T> => ({ ok: true, value })
function start(head: PublicV14Head, lineage: PublicV14Lineage): PublicV14Start {
  return { state: structuredClone(head.state), bootstrap: null,
    saveRevision: head.saveRevision, lineage: structuredClone(lineage) }
}
/** Reconstruct only one Greenway frame. Aggregate movement has no persisted transcript. */
function replayGreenwayFrame(before: PublicV14State, after: PublicV14State): boolean {
  if (before.movementOwner !== 'greenway' || after.tick !== before.tick + 1) return false
  const look: PublicWorldIntent = { type: 'look',
    yawDelta: after.player.yaw - before.player.yaw,
    pitchDelta: after.player.pitch - before.player.pitch }
  const move: PublicWorldIntent = { type: 'move', delta: {
    x: after.player.position.x - before.player.position.x,
    z: after.player.position.z - before.player.position.z } }
  for (const intents of [[], [look], [move], [look, move]] as PublicWorldIntent[][]) {
    for (const walkRequested of [false, true]) {
      try {
        const frame = advancePublicV14GreenwayFrame(before, intents, { walkRequested })
        if (frame.rejections.length === 0 && samePublicV14Value(frame.state, after)) return true
      } catch { /* A malformed or unavailable frame is never a save proof. */ }
    }
  }
  return false
}
function replayFrameWitness(before: PublicV14Head, lineage: PublicV14Lineage,
  witness: PublicV14FrameWitness): { state: PublicV14State; events: PublicWorldEvent[] } | null {
  try {
    const session = createPublicV14ContinuousSession(start(before, lineage))
    const events: PublicWorldEvent[] = []
    for (const frame of witness.frames) {
      const result = session.advanceFrame(frame.intents, { walkRequested: frame.walkRequested })
      if (result.rejections.length) return null
      events.push(...result.events)
    }
    const readiness = session.snapshotForSave()
    return readiness.status === 'deferred-airborne' ? null
      : { state: readiness.state, events }
  } catch { return null }
}
const nonFrameFacts = (state: PublicV14State) => ({ ...state, tick: 0, eventSequence: 0,
  rng: { ...state.rng, simulation: 0 }, discoveryMask: null,
  player: { ...state.player, position: null, yaw: 0, pitch: 0, verticalVelocity: 0 } })
/** The last two raw heads must be connected by one replayable v14 transition. */
function preservesV14History(before: PublicV14State, after: PublicV14State): boolean {
  if (!preservesPublicV13History(before as never, after as never)
    || before.seed !== after.seed || before.generationProfile !== after.generationProfile
    || before.movementOwner !== after.movementOwner) return false
  if (samePublicV14Value(before, after) || replayGreenwayFrame(before, after)) return true
  if (before.movementOwner === 'streamed') {
    const added = [...after.terrainWorks.builtWorkIds, ...after.terrainWorks.dugTileIds]
      .filter((id) => !before.terrainWorks.builtWorkIds.includes(id)
        && !before.terrainWorks.dugTileIds.includes(id))
    if (added.length !== 1) return false
    const action = confirmPublicV14TerrainWork(before, added[0])
    return !!action.candidate && samePublicV14Value(action.candidate, after)
  }
  const changedResources = before.greenway.resources.filter((resource, index) =>
    !samePublicV14Value(resource, after.greenway.resources[index]))
  const stoneCount = (state: PublicV14State) => state.player.inventory
    .filter((stack) => stack.itemId === 'stone')
    .reduce((count, stack) => count + stack.quantity, 0)
  const soldStone = stoneCount(before) - stoneCount(after)
  const intents: PublicWorldIntent[] = [
    { type: 'build_route', routeId: 'greenway_ladder', siteId: STARTER_CLIFF_SITE_ID },
    { type: 'buy_store_listing', storeId: 'store-greenway',
      listingId: PUBLIC_V11_BOOTS_LISTING_ID },
    { type: 'buy_store_listing', storeId: 'store-greenway', listingId: 'spade' },
    { type: 'equip_item', itemId: 'leather_boots', slot: 'feet' },
    { type: 'unequip_item', slot: 'feet' },
    { type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' },
    { type: 'equip_item', itemId: 'field_spade', slot: 'mainHand' },
    ...(Number.isSafeInteger(soldStone) && soldStone > 0
      ? [{ type: 'sell_to_store' as const, storeId: 'store-greenway',
        itemId: 'stone' as const, quantity: soldStone }] : []),
    ...changedResources.map((resource) => ({ type: 'harvest' as const, resourceId: resource.id })),
  ]
  return intents.some((intent) => {
    try {
      const action = advancePublicV14GreenwayAction(before, intent)
      return action.rejections.length === 0 && samePublicV14Value(action.state, after)
    } catch { return false }
  })
}
async function withLock<T>(locks: PublicV7LockProvider | undefined,
  operation: () => Promise<PublicV14Operation<T>>): Promise<PublicV14Operation<T>> {
  if (!locks) return failed('lock-unavailable')
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, operation) }
  catch { return failed('storage-error') }
}

type Checked =
  | { status: 'missing'; proof: object }
  | { status: 'valid'; head: PublicV14Head; lineage: PublicV14Lineage; proof: object }
  | { status: 'blocked'; reason: string }
/** Revalidate raw slots; store-provided decoded fields are advisory. */
async function checkedRecords(store: Store): Promise<Checked> {
  const read = await store.readChecked()
  if (read.status !== 'ok') return { status: 'blocked', reason: 'storage-error' }
  if (!read.proof) return { status: 'blocked', reason: 'invalid-v14-records' }
  if (read.head === null && read.previous === null && read.lineage === null) {
    return { status: 'missing', proof: read.proof }
  }
  const lineage = decodePublicV14Lineage(read.lineage)
  const record = read.head as { saveRevision?: unknown; value?: unknown } | null
  const head = lineage && record && decodePublicV14Head(record.value, lineage)
  const prior = read.previous as { saveRevision?: unknown; value?: unknown } | null
  const previous = lineage && prior && decodePublicV14Head(prior.value, lineage)
  if (!lineage || !head || head.saveRevision !== record?.saveRevision
    || (head.saveRevision === 0 ? read.previous !== null
      : !previous || previous.saveRevision !== head.saveRevision - 1
        || previous.saveRevision !== prior?.saveRevision
        || (head.frameWitness
          ? !samePublicV14Value(replayFrameWitness(previous, lineage, head.frameWitness)?.state,
            head.state)
          : !preservesV14History(previous.state, head.state)))) {
    return { status: 'blocked', reason: 'invalid-v14-history' }
  }
  const genesis = createFreshPublicV14Head(lineage.seed).head
  if (!preservesPublicV13History(genesis.state as never, head.state as never)
    || previous && !preservesPublicV13History(genesis.state as never,
      previous.state as never)) return { status: 'blocked', reason: 'invalid-v14-history' }
  return { status: 'valid', head, lineage, proof: read.proof }
}

/** A batch is one CAS revision; the canonical witness is retained for raw-history replay. */
export function commitPublicV14FrameBatch(locks: PublicV7LockProvider | undefined,
  store: Store, frames: unknown, expectedRevision: number,
  expectedLineage: unknown): Promise<PublicV14Operation<PublicV14FrameBatchCommit>> {
  const expected = decodePublicV14Lineage(expectedLineage)
  const witness = decodePublicV14FrameWitness({ kind: 'frame-batch/v1', frames })
  if (!expected || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
    || !Number.isSafeInteger(expectedRevision + 1)) return Promise.resolve(failed('invalid-expectation'))
  if (!witness) return Promise.resolve(failed('invalid-frames'))
  return withLock(locks, async () => {
    const checked = await checkedRecords(store)
    if (checked.status !== 'valid') return failed(checked.status === 'missing'
      ? 'root-missing' : checked.reason)
    if (!samePublicV14Value(checked.lineage, expected)) return failed('lineage-changed')
    if (checked.head.saveRevision !== expectedRevision) return failed('revision-changed')
    const replayed = replayFrameWitness(checked.head, checked.lineage, witness)
    if (!replayed) return failed('frame-rejected')
    const head = encodePublicV14Head(replayed.state, expectedRevision + 1,
      checked.lineage, witness)
    const result = await store.commit(expectedRevision, checked.lineage,
      { saveRevision: head.saveRevision, value: head }, undefined, checked.proof)
    return result === 'committed'
      ? succeeded({ start: start(head, checked.lineage), events: replayed.events })
      : failed(result)
  })
}

/** Independent v14 root. Streamed records remain unmounted until boundary replay exists. */
export function inspectPublicV14(locks: PublicV7LockProvider | undefined,
  store: Store): Promise<PublicV14Operation<PublicV14Inspection>> {
  return withLock<PublicV14Inspection>(locks, async () => {
    const checked = await checkedRecords(store)
    if (checked.status === 'blocked') return succeeded({ status: 'blocked', reason: checked.reason })
    if (checked.status === 'missing') return succeeded({ status: 'missing' })
    return succeeded({ status: 'valid', start: start(checked.head, checked.lineage) })
  })
}

/** Explicit fresh genesis under the old shared lock, published only into an empty v14 root. */
export function startFreshPublicV14(locks: PublicV7LockProvider | undefined,
  store: Store, seed: string): Promise<PublicV14Operation<PublicV14Start>> {
  if (typeof seed !== 'string' || !seed || seed.length > 128) {
    return Promise.resolve(failed('invalid-seed'))
  }
  return withLock(locks, async () => {
    const checked = await checkedRecords(store)
    if (checked.status !== 'missing') return failed(checked.status === 'valid'
      ? 'root-present' : checked.reason)
    const fresh = createFreshPublicV14Head(seed)
    const result = await store.commit(null, null,
      { saveRevision: 0, value: fresh.head }, fresh.lineage, checked.proof)
    return result === 'committed' ? succeeded(start(fresh.head, fresh.lineage)) : failed(result)
  })
}

/** Resume the exact inspected revision and lineage, with no migration or write. */
export function resumePublicV14(locks: PublicV7LockProvider | undefined,
  store: Store, expectedRevision: number, expectedLineage: unknown): Promise<PublicV14Operation<PublicV14Start>> {
  const expected = decodePublicV14Lineage(expectedLineage)
  if (!expected || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    return Promise.resolve(failed('invalid-expectation'))
  }
  return withLock(locks, async () => {
    const checked = await checkedRecords(store)
    if (checked.status !== 'valid') return failed(checked.status === 'missing'
      ? 'root-missing' : checked.reason)
    if (!samePublicV14Value(checked.lineage, expected)) return failed('lineage-changed')
    if (checked.head.saveRevision !== expectedRevision) return failed('revision-changed')
    return succeeded(start(checked.head, checked.lineage))
  })
}

/** Generic saves can checkpoint only an identical state or one replayed Greenway frame. */
export function commitPublicV14Snapshot(locks: PublicV7LockProvider | undefined,
  store: Store, nextState: unknown, expectedRevision: number,
  expectedLineage: unknown): Promise<PublicV14Operation<PublicV14Start>> {
  const expected = decodePublicV14Lineage(expectedLineage)
  if (!expected || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
    || !Number.isSafeInteger(expectedRevision + 1)) return Promise.resolve(failed('invalid-expectation'))
  const next = validatePublicV14State(nextState, expected.seed)
  if (!next) return Promise.resolve(failed('invalid-state'))
  return withLock(locks, async () => {
    const checked = await checkedRecords(store)
    if (checked.status !== 'valid') return failed(checked.status === 'missing'
      ? 'root-missing' : checked.reason)
    if (!samePublicV14Value(checked.lineage, expected)) return failed('lineage-changed')
    if (checked.head.saveRevision !== expectedRevision) return failed('revision-changed')
    if (next.movementOwner !== checked.head.state.movementOwner) return failed('boundary-required')
    if (!samePublicV14Value(checked.head.state, next)
      && !replayGreenwayFrame(checked.head.state, next)) {
      return failed(samePublicV14Value(nonFrameFacts(checked.head.state), nonFrameFacts(next))
        ? 'invalid-v14-history' : 'action-required')
    }
    const head = encodePublicV14Head(next, expectedRevision + 1, checked.lineage)
    if (!preservesV14History(checked.head.state, head.state)) {
      return failed('invalid-v14-history')
    }
    const result = await store.commit(expectedRevision, checked.lineage,
      { saveRevision: head.saveRevision, value: head }, undefined, checked.proof)
    return result === 'committed' ? succeeded(start(head, checked.lineage)) : failed(result)
  })
}

/** Replays a pure D1 action against the checked head under the shared root lock and CAS. */
export function commitPublicV14GreenwayAction(locks: PublicV7LockProvider | undefined,
  store: Store, intent: PublicWorldIntent, expectedRevision: number,
  expectedLineage: unknown): Promise<PublicV14Operation<PublicV14ActionCommit>> {
  const expected = decodePublicV14Lineage(expectedLineage)
  if (!expected || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
    || !Number.isSafeInteger(expectedRevision + 1)) return Promise.resolve(failed('invalid-expectation'))
  return withLock(locks, async () => {
    const checked = await checkedRecords(store)
    if (checked.status !== 'valid') return failed(checked.status === 'missing'
      ? 'root-missing' : checked.reason)
    if (!samePublicV14Value(checked.lineage, expected)) return failed('lineage-changed')
    if (checked.head.saveRevision !== expectedRevision) return failed('revision-changed')
    let action: ReturnType<typeof advancePublicV14GreenwayAction>
    try { action = advancePublicV14GreenwayAction(checked.head.state, intent) }
    catch { return failed('action-rejected') }
    if (action.rejections.length) return failed('action-rejected')
    const next = validatePublicV14State(action.state, checked.lineage.seed)
    if (!next || !preservesV14History(checked.head.state, next)) return failed('invalid-state')
    const head = encodePublicV14Head(next, expectedRevision + 1, checked.lineage)
    const result = await store.commit(expectedRevision, checked.lineage,
      { saveRevision: head.saveRevision, value: head }, undefined, checked.proof)
    return result === 'committed'
      ? succeeded({ start: start(head, checked.lineage), events: structuredClone(action.events) })
      : failed(result)
  })
}

/** A streamed work action is recomputed against the checked head, never from a preview. */
export function commitPublicV14TerrainWork(locks: PublicV7LockProvider | undefined,
  store: Store, id: unknown, expectedRevision: number,
  expectedLineage: unknown): Promise<PublicV14Operation<PublicV14TerrainWorkCommit>> {
  const expected = decodePublicV14Lineage(expectedLineage)
  if (!expected || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
    || !Number.isSafeInteger(expectedRevision + 1)) return Promise.resolve(failed('invalid-expectation'))
  return withLock(locks, async () => {
    const checked = await checkedRecords(store)
    if (checked.status !== 'valid') return failed(checked.status === 'missing'
      ? 'root-missing' : checked.reason)
    if (!samePublicV14Value(checked.lineage, expected)) return failed('lineage-changed')
    if (checked.head.saveRevision !== expectedRevision) return failed('revision-changed')
    let action: ReturnType<typeof confirmPublicV14TerrainWork>
    try { action = confirmPublicV14TerrainWork(checked.head.state, id) }
    catch { return failed('action-rejected') }
    if (!action.candidate || !action.event) return failed('action-rejected')
    const next = validatePublicV14State(action.candidate, checked.lineage.seed)
    if (!next || !preservesV14History(checked.head.state, next)) return failed('invalid-state')
    const head = encodePublicV14Head(next, expectedRevision + 1, checked.lineage)
    const result = await store.commit(expectedRevision, checked.lineage,
      { saveRevision: head.saveRevision, value: head }, undefined, checked.proof)
    return result === 'committed'
      ? succeeded({ start: start(head, checked.lineage), event: structuredClone(action.event) })
      : failed(result)
  })
}
