import type { createAtomicV15Store } from './atomicV15Database'
import { preservesPublicV13History } from './publicV13History'
import { PUBLIC_V11_BOOTS_LISTING_ID } from './publicWorldGait'
import type { PublicTerrainWorkEvent } from './publicTerrainWorkAction'
import type { PublicWorldEvent, PublicWorldIntent, PublicWorldRejection } from './publicWorldRuntime'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { STARTER_CLIFF_SITE_ID } from './starterCliffProfile'
import { advancePublicV14GreenwayAction } from './publicWorldV14Actions'
import type { PublicV14FrameWitness, PublicV14State } from './publicWorldV14Snapshot'
import { confirmPublicV14TerrainWork } from './publicWorldV14TerrainWork'
import { samePublicV14Value, validatePublicV14State } from './publicWorldV14Validation'
import { createPublicV15ContinuousSession } from './publicWorldV15ContinuousSession'
import { createFreshPublicV15Head, decodePublicV14FrameWitness, decodePublicV15Head,
  decodePublicV15Lineage, encodePublicV15Head, isLegacyPublicV15Lineage } from './publicWorldV15Snapshot'
import type { PublicV15Head, PublicV15Lineage, PublicV15StarterWorks } from './publicWorldV15Snapshot'
import { PUBLIC_V15_STARTER_BRIDGE_ID, PUBLIC_V15_STARTER_DIG_ID,
  publicWorldV15SuppressedStarterResourceIds } from './publicWorldV15StarterSites'
import { confirmPublicV15StarterWork } from './publicWorldV15StarterWork'
import { decodePublicV15Progress, preservesPublicV15StarterWorks } from './publicWorldV15Validation'
import type { PublicV15Progress } from './publicWorldV15Validation'

type Store = ReturnType<typeof createAtomicV15Store>
export type PublicV15Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV15Start = Readonly<{
  state: PublicV14State; starterWorks: PublicV15StarterWorks; bootstrap: null
  saveRevision: number; lineage: PublicV15Lineage
}>
export type PublicV15ActionCommit = Readonly<{ start: PublicV15Start; events: readonly PublicWorldEvent[] }>
export type PublicV15FrameBatchCommit = PublicV15ActionCommit
export type PublicV15TerrainWorkCommit = Readonly<{ start: PublicV15Start; event: PublicTerrainWorkEvent }>
export type PublicV15Inspection = { status: 'missing' }
  | { status: 'valid'; start: PublicV15Start }
  | { status: 'blocked'; reason: string }

const failed = (reason: string): PublicV15Operation<never> => ({ ok: false, reason })
const succeeded = <T,>(value: T): PublicV15Operation<T> => ({ ok: true, value })
const progress = (head: PublicV15Head): PublicV15Progress => ({
  state: head.state, starterWorks: head.starterWorks,
})
function start(head: PublicV15Head, lineage: PublicV15Lineage): PublicV15Start {
  return { ...structuredClone(progress(head)), bootstrap: null,
    saveRevision: head.saveRevision, lineage: structuredClone(lineage) }
}
async function withLock<T>(locks: PublicV7LockProvider | undefined,
  operation: () => Promise<PublicV15Operation<T>>): Promise<PublicV15Operation<T>> {
  if (!locks) return failed('lock-unavailable')
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, operation) }
  catch { return failed('storage-error') }
}
function expectation(revision: number, rawLineage: unknown, increment: boolean) {
  const lineage = decodePublicV15Lineage(rawLineage)
  return lineage && Number.isSafeInteger(revision) && revision >= 0
    && (!increment || Number.isSafeInteger(revision + 1)) ? lineage : null
}

/** Replay every bounded frame using the same native v15 session as local preview. */
function replayFrames(before: PublicV15Head, lineage: PublicV15Lineage,
  witness: PublicV14FrameWitness): { progress: PublicV15Progress; events: PublicWorldEvent[] } | null {
  try {
    const session = createPublicV15ContinuousSession(start(before, lineage))
    const events: PublicWorldEvent[] = []
    for (const frame of witness.frames) {
      const result = session.advanceFrame(frame.intents, { walkRequested: frame.walkRequested })
      if (result.rejections.length) return null
      events.push(...result.events)
    }
    const save = session.snapshotForSave()
    return save.status === 'deferred-airborne' ? null : { progress: save.progress, events }
  } catch { return null }
}

/**
 * The inherited D1 reducer can act only where the actual pose is v14-valid.
 * A projected v14 floor is exclusively a validation subproof, never a playable
 * input to an action. Suppressed resource IDs have no v15 interaction target.
 */
export function advancePublicV15GreenwayAction(before: PublicV15Progress,
  intent: PublicWorldIntent): { progress: PublicV15Progress; events: PublicWorldEvent[];
    rejections: PublicWorldRejection[] } {
  const reject = (code: PublicWorldRejection['code']) => ({ progress: before,
    events: [], rejections: [{ intentIndex: 0, intentType: intent?.type ?? 'move',
      code, message: 'The action is unavailable at this v15 position.' }] })
  if (before.state.movementOwner !== 'greenway'
    || !validatePublicV14State(before.state, before.state.seed)) return reject('unavailable_here')
  if (intent?.type === 'harvest' && publicWorldV15SuppressedStarterResourceIds(
    before.state.seed, before.state.greenway.resources).includes(intent.resourceId)) {
    return reject('not_found')
  }
  try {
    const result = advancePublicV14GreenwayAction(before.state, intent)
    if (result.rejections.length) return { progress: before, events: [], rejections: result.rejections }
    const next = decodePublicV15Progress({ state: result.state,
      starterWorks: before.starterWorks }, before.state.seed)
    return next ? { progress: next, events: result.events, rejections: [] }
      : reject('invalid_value')
  } catch { return reject('invalid_value') }
}

/** Exactly one eligible action (or an identical checkpoint) connects unwitnessed heads. */
function replayAction(before: PublicV15Progress, after: PublicV15Progress): boolean {
  if (!preservesPublicV13History(before.state as never, after.state as never)
    || !preservesPublicV15StarterWorks(before.starterWorks, after.starterWorks)
    || before.state.seed !== after.state.seed
    || before.state.generationProfile !== after.state.generationProfile) return false
  if (samePublicV14Value(before, after)) return true
  const changed = (['bridgeBuilt', 'bankCacheDug'] as const)
    .filter((key) => !before.starterWorks[key] && after.starterWorks[key])
  if (changed.length) {
    if (changed.length !== 1) return false
    const id = changed[0] === 'bridgeBuilt' ? PUBLIC_V15_STARTER_BRIDGE_ID : PUBLIC_V15_STARTER_DIG_ID
    const result = confirmPublicV15StarterWork(before, id)
    return 'progress' in result && samePublicV14Value(result.progress, after)
  }
  if (before.state.movementOwner === 'streamed') {
    const old = before.state.terrainWorks, next = after.state.terrainWorks
    const added = [...next.builtWorkIds.filter((id) => !old.builtWorkIds.includes(id)),
      ...next.dugTileIds.filter((id) => !old.dugTileIds.includes(id))]
    if (added.length !== 1) return false
    try {
      const result = confirmPublicV14TerrainWork(before.state, added[0])
      return !!result.candidate && samePublicV14Value({ state: result.candidate,
        starterWorks: before.starterWorks }, after)
    } catch { return false }
  }
  const changedResources = before.state.greenway.resources.filter((resource, index) =>
    !samePublicV14Value(resource, after.state.greenway.resources[index]))
  const stones = (state: PublicV14State) => state.player.inventory
    .filter((stack) => stack.itemId === 'stone')
    .reduce((count, stack) => count + stack.quantity, 0)
  const soldStone = stones(before.state) - stones(after.state)
  const intents: PublicWorldIntent[] = [
    { type: 'build_route', routeId: 'greenway_ladder', siteId: STARTER_CLIFF_SITE_ID },
    { type: 'buy_store_listing', storeId: 'store-greenway', listingId: PUBLIC_V11_BOOTS_LISTING_ID },
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
    const result = advancePublicV15GreenwayAction(before, intent)
    return !result.rejections.length && samePublicV14Value(result.progress, after)
  })
}

type Checked = { status: 'missing'; proof: object }
  | { status: 'valid'; head: PublicV15Head; lineage: PublicV15Lineage; proof: object }
  | { status: 'blocked'; reason: string }
/** Raw head, previous and lineage are decoded again under the shared lock. */
async function checkedRecords(store: Store): Promise<Checked> {
  const read = await store.readChecked()
  if (read.status !== 'ok') return { status: 'blocked', reason: 'storage-error' }
  if (isLegacyPublicV15Lineage(read.lineage)) return { status: 'blocked', reason: 'legacy-v15-root' }
  if (!read.proof) return { status: 'blocked', reason: 'invalid-v15-records' }
  if (read.head === null && read.previous === null && read.lineage === null) {
    return { status: 'missing', proof: read.proof }
  }
  const lineage = decodePublicV15Lineage(read.lineage)
  const record = read.head as { saveRevision?: unknown; value?: unknown } | null
  const head = lineage && record && decodePublicV15Head(record.value, lineage)
  const prior = read.previous as { saveRevision?: unknown; value?: unknown } | null
  const previous = lineage && prior && decodePublicV15Head(prior.value, lineage)
  const genesis = lineage && createFreshPublicV15Head(lineage.seed).head
  if (!lineage || !head || head.saveRevision !== record?.saveRevision
    || !genesis
    || head.saveRevision === 0 && !samePublicV14Value(head, genesis)
    || previous?.saveRevision === 0 && !samePublicV14Value(previous, genesis)
    || (head.saveRevision === 0 ? read.previous !== null
      : !previous || previous.saveRevision !== head.saveRevision - 1
        || previous.saveRevision !== prior?.saveRevision
        || (head.frameWitness
          ? !samePublicV14Value(replayFrames(previous, lineage, head.frameWitness)?.progress,
            progress(head))
          : !replayAction(progress(previous), progress(head))))) {
    return { status: 'blocked', reason: 'invalid-v15-history' }
  }
  if (!preservesPublicV13History(genesis.state as never, head.state as never)
    || !preservesPublicV15StarterWorks(genesis.starterWorks, head.starterWorks)
    || previous && (!preservesPublicV13History(genesis.state as never,
      previous.state as never) || !preservesPublicV15StarterWorks(genesis.starterWorks,
      previous.starterWorks))) return { status: 'blocked', reason: 'invalid-v15-history' }
  return { status: 'valid', head, lineage, proof: read.proof }
}

async function checkedCommit<T>(locks: PublicV7LockProvider | undefined, store: Store,
  revision: number, rawLineage: unknown,
  transition: (head: PublicV15Head, lineage: PublicV15Lineage) =>
    { next: PublicV15Progress; witness?: PublicV14FrameWitness; result: T } | string):
  Promise<PublicV15Operation<{ start: PublicV15Start; result: T }>> {
  const expected = expectation(revision, rawLineage, true)
  if (!expected) return failed('invalid-expectation')
  return withLock(locks, async () => {
    const checked = await checkedRecords(store)
    if (checked.status !== 'valid') return failed(checked.status === 'missing'
      ? 'root-missing' : checked.reason)
    if (!samePublicV14Value(checked.lineage, expected)) return failed('lineage-changed')
    if (checked.head.saveRevision !== revision) return failed('revision-changed')
    const result = transition(checked.head, checked.lineage)
    if (typeof result === 'string') return failed(result)
    const next = decodePublicV15Progress(result.next, checked.lineage.seed)
    if (!next || !preservesPublicV13History(checked.head.state as never, next.state as never)
      || !preservesPublicV15StarterWorks(checked.head.starterWorks, next.starterWorks)) {
      return failed('invalid-state')
    }
    let head: PublicV15Head
    try {
      head = encodePublicV15Head(next.state, revision + 1, checked.lineage,
        result.witness, next.starterWorks, checked.head.resourceClearance)
    } catch { return failed('invalid-state') }
    if (head.frameWitness
      ? !samePublicV14Value(replayFrames(checked.head, checked.lineage,
        head.frameWitness)?.progress, progress(head))
      : !replayAction(progress(checked.head), progress(head))) {
      return failed('invalid-v15-history')
    }
    const write = await store.commit(revision, checked.lineage,
      { saveRevision: head.saveRevision, value: head }, undefined, checked.proof)
    return write === 'committed'
      ? succeeded({ start: start(head, checked.lineage), result: result.result })
      : failed(write)
  })
}

/** V1 experimental roots are retained, but require an explicit compatibility decision. */
export async function inspectPublicV15UnderLock(store: Store): Promise<PublicV15Inspection> {
  const checked = await checkedRecords(store)
  if (checked.status === 'blocked') return { status: 'blocked', reason: checked.reason }
  if (checked.status === 'missing') return { status: 'missing' }
  return { status: 'valid', start: start(checked.head, checked.lineage) }
}
export function inspectPublicV15(locks: PublicV7LockProvider | undefined,
  store: Store): Promise<PublicV15Operation<PublicV15Inspection>> {
  return withLock<PublicV15Inspection>(locks, async () =>
    succeeded(await inspectPublicV15UnderLock(store)))
}
export function startFreshPublicV15(locks: PublicV7LockProvider | undefined,
  store: Store, seed: string): Promise<PublicV15Operation<PublicV15Start>> {
  if (typeof seed !== 'string' || !seed || seed.length > 128) return Promise.resolve(failed('invalid-seed'))
  return withLock(locks, async () => {
    const checked = await checkedRecords(store)
    if (checked.status !== 'missing') return failed(checked.status === 'valid'
      ? 'root-present' : checked.reason)
    const fresh = createFreshPublicV15Head(seed)
    const write = await store.commit(null, null,
      { saveRevision: 0, value: fresh.head }, fresh.lineage, checked.proof)
    return write === 'committed' ? succeeded(start(fresh.head, fresh.lineage)) : failed(write)
  })
}
export function resumePublicV15(locks: PublicV7LockProvider | undefined,
  store: Store, revision: number, rawLineage: unknown): Promise<PublicV15Operation<PublicV15Start>> {
  const expected = expectation(revision, rawLineage, false)
  if (!expected) return Promise.resolve(failed('invalid-expectation'))
  return withLock(locks, async () => {
    const checked = await checkedRecords(store)
    if (checked.status !== 'valid') return failed(checked.status === 'missing'
      ? 'root-missing' : checked.reason)
    if (!samePublicV14Value(checked.lineage, expected)) return failed('lineage-changed')
    if (checked.head.saveRevision !== revision) return failed('revision-changed')
    return succeeded(start(checked.head, checked.lineage))
  })
}

export async function commitPublicV15FrameBatch(locks: PublicV7LockProvider | undefined,
  store: Store, frames: unknown, revision: number, lineage: unknown):
  Promise<PublicV15Operation<PublicV15FrameBatchCommit>> {
  const witness = decodePublicV14FrameWitness({ kind: 'frame-batch/v1', frames })
  if (!witness) return failed('invalid-frames')
  const saved = await checkedCommit(locks, store, revision, lineage, (head, root) => {
    const frame = replayFrames(head, root, witness)
    return frame ? { next: frame.progress, witness, result: frame.events } : 'frame-rejected'
  })
  return saved.ok ? succeeded({ start: saved.value.start, events: saved.value.result }) : saved
}
/** Generic checkpoints cannot introduce material, XP, flags, or movement. */
export async function commitPublicV15Snapshot(locks: PublicV7LockProvider | undefined,
  store: Store, rawNext: unknown, revision: number, lineage: unknown):
  Promise<PublicV15Operation<PublicV15Start>> {
  const saved = await checkedCommit(locks, store, revision, lineage, (head) => {
    const next = decodePublicV15Progress(rawNext, head.state.seed)
    return next && samePublicV14Value(next, progress(head))
      ? { next, result: null } : 'action-required'
  })
  return saved.ok ? succeeded(saved.value.start) : saved
}
export async function commitPublicV15GreenwayAction(locks: PublicV7LockProvider | undefined,
  store: Store, intent: PublicWorldIntent, revision: number, lineage: unknown):
  Promise<PublicV15Operation<PublicV15ActionCommit>> {
  const saved = await checkedCommit(locks, store, revision, lineage, (head) => {
    const action = advancePublicV15GreenwayAction(progress(head), intent)
    return action.rejections.length ? 'action-rejected'
      : { next: action.progress, result: action.events }
  })
  return saved.ok ? succeeded({ start: saved.value.start, events: saved.value.result }) : saved
}
export async function commitPublicV15TerrainWork(locks: PublicV7LockProvider | undefined,
  store: Store, id: unknown, revision: number, lineage: unknown):
  Promise<PublicV15Operation<PublicV15TerrainWorkCommit>> {
  const saved = await checkedCommit(locks, store, revision, lineage, (head) => {
    if (head.state.movementOwner !== 'streamed') return 'action-rejected'
    const action = confirmPublicV14TerrainWork(head.state, id)
    return action.candidate && action.event ? { next: { state: action.candidate,
      starterWorks: head.starterWorks }, result: action.event } : 'action-rejected'
  })
  return saved.ok ? succeeded({ start: saved.value.start, event: saved.value.result }) : saved
}
export async function commitPublicV15StarterWork(locks: PublicV7LockProvider | undefined,
  store: Store, id: unknown, revision: number, lineage: unknown):
  Promise<PublicV15Operation<PublicV15TerrainWorkCommit>> {
  const saved = await checkedCommit(locks, store, revision, lineage, (head) => {
    const action = confirmPublicV15StarterWork(progress(head), id)
    if (!action.progress || !action.event) return action.rejection ?? 'action-rejected'
    return { next: action.progress, result: action.event }
  })
  return saved.ok ? succeeded({ start: saved.value.start, event: saved.value.result }) : saved
}
