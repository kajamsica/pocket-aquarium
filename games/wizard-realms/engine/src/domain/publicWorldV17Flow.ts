import type { createAtomicV16Store } from './atomicV16Database'
import type { createAtomicV17Store } from './atomicV17Database'
import { preservesPublicV13History } from './publicV13History'
import { PUBLIC_V11_BOOTS_LISTING_ID } from './publicWorldGait'
import type { PublicTerrainWorkEvent } from './publicTerrainWorkAction'
import type { PublicWorldEvent, PublicWorldIntent } from './publicWorldRuntime'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { STARTER_CLIFF_SITE_ID } from './starterCliffProfile'
import type { PublicV14FrameWitness, PublicV14State } from './publicWorldV14Snapshot'
import { confirmPublicV14TerrainWork } from './publicWorldV14TerrainWork'
import { samePublicV14Value } from './publicWorldV14Validation'
import { inspectPublicV16UnderLock } from './publicWorldV16Flow'
import type { PublicV16Start } from './publicWorldV16Flow'
import { replayPublicV17Frames } from './publicWorldV17ContinuousSession'
import { advancePublicV17GreenwayAction } from './publicWorldV17GreenwayFrame'
import { confirmPublicV17GreenwayWork } from './publicWorldV17GreenwayWork'
import type { PublicV17GreenwayWorkEvent } from './publicWorldV17GreenwayWork'
import { createFreshPublicV17Head, createMigratedPublicV17Head,
  decodePublicV17Head, decodePublicV17Lineage, encodePublicV17Head } from './publicWorldV17Snapshot'
import type { PublicV17Head, PublicV17Lineage } from './publicWorldV17Snapshot'
import { decodePublicV14FrameWitness } from './publicWorldV14Snapshot'
import { decodePublicV17Progress, preservesPublicV17GreenwayWorks } from './publicWorldV17Validation'
import type { PublicV17Progress } from './publicWorldV17Validation'
import { publicV17SavePhaseStart, publicV17SavePhaseEnd } from '../PublicV17InputScheduler'

type Store = ReturnType<typeof createAtomicV17Store>
type V16Store = ReturnType<typeof createAtomicV16Store>
export type PublicV17Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV17Start = Readonly<PublicV17Progress & {
  bootstrap: null; saveRevision: number; lineage: PublicV17Lineage
}>
export type PublicV17ActionCommit = Readonly<{ start: PublicV17Start;
  events: readonly PublicWorldEvent[] }>
export type PublicV17WorkCommit = Readonly<{ start: PublicV17Start;
  event: PublicV17GreenwayWorkEvent | PublicTerrainWorkEvent }>
export type PublicV17Inspection = { status: 'missing' }
  | { status: 'valid'; start: PublicV17Start }
  | { status: 'blocked'; reason: string }

const failed = (reason: string): PublicV17Operation<never> => ({ ok: false, reason })
const succeeded = <T,>(value: T): PublicV17Operation<T> => ({ ok: true, value })
const progress = (head: PublicV17Head): PublicV17Progress => ({
  state: head.state, greenwayWorks: head.greenwayWorks,
})
const start = (head: PublicV17Head, lineage: PublicV17Lineage): PublicV17Start => ({
  ...structuredClone(progress(head)), bootstrap: null, saveRevision: head.saveRevision,
  lineage: structuredClone(lineage),
})
async function withLock<T>(locks: PublicV7LockProvider | undefined,
  operation: () => Promise<PublicV17Operation<T>>): Promise<PublicV17Operation<T>> {
  if (!locks) return failed('lock-unavailable')
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, operation) }
  catch { return failed('storage-error') }
}
const preservesHistory = (before: PublicV17Progress, after: PublicV17Progress,
  seed: string) => preservesPublicV13History(before.state as never, after.state as never)
  && preservesPublicV17GreenwayWorks(before.greenwayWorks, after.greenwayWorks, seed)

/** One unwitnessed transition: checkpoint, one work, or one core action. */
function replayAction(before: PublicV17Progress, after: PublicV17Progress): boolean {
  const seed = before.state.seed
  if (!preservesHistory(before, after, seed) || after.state.seed !== seed
    || after.state.generationProfile !== before.state.generationProfile) return false
  if (samePublicV14Value(before, after)) return true
  const old = before.greenwayWorks, next = after.greenwayWorks
  const added = [...next.builtBridgeIds.filter((id) => !old.builtBridgeIds.includes(id)),
    ...next.builtLadderIds.filter((id) => !old.builtLadderIds.includes(id)),
    ...next.dugTileIds.filter((id) => !old.dugTileIds.includes(id))]
  if (added.length) {
    if (added.length !== 1) return false
    const result = confirmPublicV17GreenwayWork(before, added[0])
    return !!result.progress && samePublicV14Value(result.progress, after)
  }
  if (before.state.movementOwner === 'streamed') {
    const left = before.state.terrainWorks, right = after.state.terrainWorks
    const works = [...right.builtWorkIds.filter((id) => !left.builtWorkIds.includes(id)),
      ...right.dugTileIds.filter((id) => !left.dugTileIds.includes(id))]
    if (works.length !== 1) return false
    try {
      const result = confirmPublicV14TerrainWork(before.state, works[0])
      return !!result.candidate && samePublicV14Value({ state: result.candidate,
        greenwayWorks: old }, after)
    } catch { return false }
  }
  const changedResources = before.state.greenway.resources.filter((resource, index) =>
    !samePublicV14Value(resource, after.state.greenway.resources[index]))
  const stones = (state: PublicV14State) => state.player.inventory
    .filter((stack) => stack.itemId === 'stone')
    .reduce((count, stack) => count + stack.quantity, 0)
  const soldStone = stones(before.state) - stones(after.state)
  const intents: PublicWorldIntent[] = [
    { type: 'study_inscription', inscriptionId: 'greenway_waystone' },
    { type: 'cast_spell', spellId: 'wayfinder_glow' },
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
    const result = advancePublicV17GreenwayAction(before, intent)
    return !result.rejections.length && samePublicV14Value(result.progress, after)
  })
}

type Checked = { status: 'missing'; proof: object }
  | { status: 'valid'; head: PublicV17Head; lineage: PublicV17Lineage; proof: object }
  | { status: 'blocked'; reason: string }
/** The raw three-slot history is decoded and its last transition replayed under lock. */
async function checkedRecords(store: Store): Promise<Checked> {
  const read = await store.readChecked()
  if (read.status !== 'ok') return { status: 'blocked', reason: 'storage-error' }
  if (!read.proof) return { status: 'blocked', reason: 'invalid-v17-records' }
  if (read.head === null && read.previous === null && read.lineage === null) {
    return { status: 'missing', proof: read.proof }
  }
  const lineage = decodePublicV17Lineage(read.lineage)
  const record = read.head as { saveRevision?: unknown; value?: unknown } | null
  const head = lineage && record && decodePublicV17Head(record.value, lineage)
  const prior = read.previous as { saveRevision?: unknown; value?: unknown } | null
  const previous = lineage && prior && decodePublicV17Head(prior.value, lineage)
  const genesis = lineage && (lineage.origin === 'fresh'
    ? createFreshPublicV17Head(lineage.seed)
    : createMigratedPublicV17Head({ ...lineage.sourceReceipt, bootstrap: null }))
  const historyStarted = publicV17SavePhaseStart(store)
  if (!lineage || !head || head.saveRevision !== record?.saveRevision || !genesis
    || !samePublicV14Value(genesis.lineage, lineage)
    || head.saveRevision === 0 && !samePublicV14Value(head, genesis.head)
    || previous?.saveRevision === 0 && !samePublicV14Value(previous, genesis.head)
    || (head.saveRevision === 0 ? read.previous !== null
      : !previous || previous.saveRevision !== head.saveRevision - 1
        || previous.saveRevision !== prior?.saveRevision
        || (head.frameWitness
          ? !samePublicV14Value(replayPublicV17Frames(previous, lineage, head.frameWitness)?.next,
            progress(head))
          : !replayAction(progress(previous), progress(head))))) {
    publicV17SavePhaseEnd(store, 'previous-replay', historyStarted)
    return { status: 'blocked', reason: 'invalid-v17-history' }
  }
  publicV17SavePhaseEnd(store, 'previous-replay', historyStarted)
  if (!preservesHistory(progress(genesis.head), progress(head), lineage.seed)
    || previous && !preservesHistory(progress(genesis.head), progress(previous), lineage.seed)) {
    return { status: 'blocked', reason: 'invalid-v17-history' }
  }
  return { status: 'valid', head, lineage, proof: read.proof }
}

async function checkedCommit<T>(locks: PublicV7LockProvider | undefined, store: Store,
  revision: number, rawLineage: unknown,
  transition: (head: PublicV17Head, lineage: PublicV17Lineage) =>
    { next: PublicV17Progress; witness?: PublicV14FrameWitness; result: T } | string):
  Promise<PublicV17Operation<{ start: PublicV17Start; result: T }>> {
  const expected = decodePublicV17Lineage(rawLineage)
  if (!expected || !Number.isSafeInteger(revision) || revision < 0
    || !Number.isSafeInteger(revision + 1)) return failed('invalid-expectation')
  return withLock(locks, async () => {
    const recordsStarted = publicV17SavePhaseStart(store)
    const checked = await checkedRecords(store)
    publicV17SavePhaseEnd(store, 'checked-records', recordsStarted)
    if (checked.status !== 'valid') return failed(checked.status === 'missing'
      ? 'root-missing' : checked.reason)
    if (!samePublicV14Value(checked.lineage, expected)) return failed('lineage-changed')
    if (checked.head.saveRevision !== revision) return failed('revision-changed')
    const incomingStarted = publicV17SavePhaseStart(store)
    const result = transition(checked.head, checked.lineage)
    publicV17SavePhaseEnd(store, 'incoming-replay', incomingStarted)
    if (typeof result === 'string') return failed(result)
    const next = decodePublicV17Progress(result.next, checked.lineage.seed)
    if (!next || !preservesHistory(progress(checked.head), next, checked.lineage.seed)) {
      return failed('invalid-state')
    }
    let head: PublicV17Head
    const encodingStarted = publicV17SavePhaseStart(store)
    try { head = encodePublicV17Head(next, revision + 1, checked.lineage, result.witness) }
    catch { return failed('invalid-state') }
    if (head.frameWitness
      ? !samePublicV14Value(replayPublicV17Frames(checked.head, checked.lineage,
        head.frameWitness)?.next, progress(head))
      : !replayAction(progress(checked.head), progress(head))) {
      return failed('invalid-v17-history')
    }
    publicV17SavePhaseEnd(store, 'encode-final-replay', encodingStarted)
    const write = await store.commit(revision, checked.lineage,
      { saveRevision: head.saveRevision, value: head }, undefined, checked.proof)
    return write === 'committed'
      ? succeeded({ start: start(head, checked.lineage), result: result.result })
      : failed(write)
  })
}

/** Checked source inspection for a later migration while its caller owns the world lock. */
export async function inspectPublicV17UnderLock(store: Store): Promise<PublicV17Inspection> {
  const checked = await checkedRecords(store)
  if (checked.status === 'blocked') return { status: 'blocked', reason: checked.reason }
  if (checked.status === 'missing') return { status: 'missing' }
  return { status: 'valid', start: start(checked.head, checked.lineage) }
}
export function inspectPublicV17(locks: PublicV7LockProvider | undefined,
  store: Store): Promise<PublicV17Operation<PublicV17Inspection>> {
  return withLock<PublicV17Inspection>(locks, async () =>
    succeeded(await inspectPublicV17UnderLock(store)))
}
export function startFreshPublicV17(locks: PublicV7LockProvider | undefined,
  store: Store, seed: string): Promise<PublicV17Operation<PublicV17Start>> {
  if (typeof seed !== 'string' || !seed || seed.length > 128) return Promise.resolve(failed('invalid-seed'))
  return withLock(locks, () => startFreshPublicV17UnderLock(store, seed))
}
/** The caller owns the world lock across this checked genesis write. */
export async function startFreshPublicV17UnderLock(store: Store,
  seed: string): Promise<PublicV17Operation<PublicV17Start>> {
  if (typeof seed !== 'string' || !seed || seed.length > 128) return failed('invalid-seed')
  const checked = await checkedRecords(store)
  if (checked.status !== 'missing') return failed(checked.status === 'valid'
    ? 'root-present' : checked.reason)
  const fresh = createFreshPublicV17Head(seed)
  const write = await store.commit(null, null,
    { saveRevision: 0, value: fresh.head }, fresh.lineage, checked.proof)
  return write === 'committed' ? succeeded(start(fresh.head, fresh.lineage)) : failed(write)
}
export function startMigratedPublicV17(locks: PublicV7LockProvider | undefined,
  store: Store, sourceStore: V16Store, sourceStart: PublicV16Start):
  Promise<PublicV17Operation<PublicV17Start>> {
  const mapped = createMigratedPublicV17Head(sourceStart)
  if (!mapped) return Promise.resolve(failed('invalid-source'))
  return withLock(locks, async () => {
    const checked = await checkedRecords(store)
    if (checked.status !== 'missing') return failed(checked.status === 'valid'
      ? 'root-present' : checked.reason)
    const source = await inspectPublicV16UnderLock(sourceStore)
    if (source.status !== 'valid') return failed(source.status === 'missing'
      ? 'source-missing' : source.reason)
    const expected = { saveRevision: sourceStart.saveRevision, lineage: sourceStart.lineage,
      state: sourceStart.state, greenwayWorks: sourceStart.greenwayWorks }
    const actual = { saveRevision: source.start.saveRevision, lineage: source.start.lineage,
      state: source.start.state, greenwayWorks: source.start.greenwayWorks }
    if (!samePublicV14Value(expected, actual)
      || !samePublicV14Value(mapped.lineage.sourceReceipt, actual)) return failed('source-changed')
    const write = await store.commit(null, null,
      { saveRevision: 0, value: mapped.head }, mapped.lineage, checked.proof)
    return write === 'committed' ? succeeded(start(mapped.head, mapped.lineage)) : failed(write)
  })
}
export function resumePublicV17(locks: PublicV7LockProvider | undefined,
  store: Store, revision: number, rawLineage: unknown): Promise<PublicV17Operation<PublicV17Start>> {
  const expected = decodePublicV17Lineage(rawLineage)
  if (!expected || !Number.isSafeInteger(revision) || revision < 0) {
    return Promise.resolve(failed('invalid-expectation'))
  }
  return withLock(locks, async () => {
    const checked = await checkedRecords(store)
    if (checked.status !== 'valid') return failed(checked.status === 'missing'
      ? 'root-missing' : checked.reason)
    if (!samePublicV14Value(checked.lineage, expected)) return failed('lineage-changed')
    return checked.head.saveRevision === revision
      ? succeeded(start(checked.head, checked.lineage)) : failed('revision-changed')
  })
}

export async function commitPublicV17FrameBatch(locks: PublicV7LockProvider | undefined,
  store: Store, frames: unknown, revision: number, lineage: unknown):
  Promise<PublicV17Operation<PublicV17ActionCommit>> {
  const witness = decodePublicV14FrameWitness({ kind: 'frame-batch/v1', frames })
  if (!witness) return failed('invalid-frames')
  const saved = await checkedCommit(locks, store, revision, lineage, (head, root) => {
    const frame = replayPublicV17Frames(head, root, witness)
    return frame ? { next: frame.next, witness, result: frame.events } : 'frame-rejected'
  })
  return saved.ok ? succeeded({ start: saved.value.start, events: saved.value.result }) : saved
}
export async function commitPublicV17Snapshot(locks: PublicV7LockProvider | undefined,
  store: Store, rawNext: unknown, revision: number, lineage: unknown):
  Promise<PublicV17Operation<PublicV17Start>> {
  const saved = await checkedCommit(locks, store, revision, lineage, (head) => {
    const next = decodePublicV17Progress(rawNext, head.state.seed)
    return next && samePublicV14Value(next, progress(head))
      ? { next, result: null } : 'action-required'
  })
  return saved.ok ? succeeded(saved.value.start) : saved
}
export async function commitPublicV17GreenwayAction(locks: PublicV7LockProvider | undefined,
  store: Store, intent: PublicWorldIntent, revision: number, lineage: unknown):
  Promise<PublicV17Operation<PublicV17ActionCommit>> {
  const saved = await checkedCommit(locks, store, revision, lineage, (head) => {
    const action = advancePublicV17GreenwayAction(progress(head), intent)
    return action.rejections.length ? 'action-rejected'
      : { next: action.progress, result: action.events }
  })
  return saved.ok ? succeeded({ start: saved.value.start, events: saved.value.result }) : saved
}
export async function commitPublicV17GreenwayWork(locks: PublicV7LockProvider | undefined,
  store: Store, id: unknown, revision: number, lineage: unknown):
  Promise<PublicV17Operation<PublicV17WorkCommit>> {
  const saved = await checkedCommit(locks, store, revision, lineage, (head) => {
    const work = confirmPublicV17GreenwayWork(progress(head), id)
    return work.progress && work.event ? { next: work.progress, result: work.event }
      : work.rejection ?? 'action-rejected'
  })
  return saved.ok ? succeeded({ start: saved.value.start, event: saved.value.result }) : saved
}
export async function commitPublicV17TerrainWork(locks: PublicV7LockProvider | undefined,
  store: Store, id: unknown, revision: number, lineage: unknown):
  Promise<PublicV17Operation<PublicV17WorkCommit>> {
  const saved = await checkedCommit(locks, store, revision, lineage, (head) => {
    if (head.state.movementOwner !== 'streamed') return 'action-rejected'
    const work = confirmPublicV14TerrainWork(head.state, id)
    return work.candidate && work.event ? { next: { state: work.candidate,
      greenwayWorks: head.greenwayWorks }, result: work.event } : 'action-rejected'
  })
  return saved.ok ? succeeded({ start: saved.value.start, event: saved.value.result }) : saved
}
