import type { createAtomicV15Store } from './atomicV15Database'
import type { createAtomicV16Store } from './atomicV16Database'
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
import { inspectPublicV15UnderLock } from './publicWorldV15Flow'
import type { PublicV15Start } from './publicWorldV15Flow'
import { replayPublicV16Frames } from './publicWorldV16ContinuousSession'
import { advancePublicV16GreenwayAction } from './publicWorldV16GreenwayFrame'
import { confirmPublicV16GreenwayWork } from './publicWorldV16GreenwayWork'
import type { PublicV16GreenwayWorkEvent } from './publicWorldV16GreenwayWork'
import { createFreshPublicV16Head, createMigratedPublicV16Head,
  decodePublicV16Head, decodePublicV16Lineage, encodePublicV16Head } from './publicWorldV16Snapshot'
import type { PublicV16Head, PublicV16Lineage } from './publicWorldV16Snapshot'
import { decodePublicV14FrameWitness } from './publicWorldV14Snapshot'
import { decodePublicV16Progress, preservesPublicV16GreenwayWorks } from './publicWorldV16Validation'
import type { PublicV16Progress } from './publicWorldV16Validation'

type Store = ReturnType<typeof createAtomicV16Store>
type V15Store = ReturnType<typeof createAtomicV15Store>
export type PublicV16Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV16Start = Readonly<PublicV16Progress & {
  bootstrap: null; saveRevision: number; lineage: PublicV16Lineage
}>
export type PublicV16ActionCommit = Readonly<{ start: PublicV16Start;
  events: readonly PublicWorldEvent[] }>
export type PublicV16WorkCommit = Readonly<{ start: PublicV16Start;
  event: PublicV16GreenwayWorkEvent | PublicTerrainWorkEvent }>
export type PublicV16Inspection = { status: 'missing' }
  | { status: 'valid'; start: PublicV16Start }
  | { status: 'blocked'; reason: string }

const failed = (reason: string): PublicV16Operation<never> => ({ ok: false, reason })
const succeeded = <T,>(value: T): PublicV16Operation<T> => ({ ok: true, value })
const progress = (head: PublicV16Head): PublicV16Progress => ({
  state: head.state, greenwayWorks: head.greenwayWorks,
})
const start = (head: PublicV16Head, lineage: PublicV16Lineage): PublicV16Start => ({
  ...structuredClone(progress(head)), bootstrap: null, saveRevision: head.saveRevision,
  lineage: structuredClone(lineage),
})
async function withLock<T>(locks: PublicV7LockProvider | undefined,
  operation: () => Promise<PublicV16Operation<T>>): Promise<PublicV16Operation<T>> {
  if (!locks) return failed('lock-unavailable')
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, operation) }
  catch { return failed('storage-error') }
}
const preservesHistory = (before: PublicV16Progress, after: PublicV16Progress,
  seed: string) => preservesPublicV13History(before.state as never, after.state as never)
  && preservesPublicV16GreenwayWorks(before.greenwayWorks, after.greenwayWorks, seed)

/** One unwitnessed transition: checkpoint, one work, or one core action. */
function replayAction(before: PublicV16Progress, after: PublicV16Progress): boolean {
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
    const result = confirmPublicV16GreenwayWork(before, added[0])
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
    const result = advancePublicV16GreenwayAction(before, intent)
    return !result.rejections.length && samePublicV14Value(result.progress, after)
  })
}

type Checked = { status: 'missing'; proof: object }
  | { status: 'valid'; head: PublicV16Head; lineage: PublicV16Lineage; proof: object }
  | { status: 'blocked'; reason: string }
/** The raw three-slot history is decoded and its last transition replayed under lock. */
async function checkedRecords(store: Store): Promise<Checked> {
  const read = await store.readChecked()
  if (read.status !== 'ok') return { status: 'blocked', reason: 'storage-error' }
  if (!read.proof) return { status: 'blocked', reason: 'invalid-v16-records' }
  if (read.head === null && read.previous === null && read.lineage === null) {
    return { status: 'missing', proof: read.proof }
  }
  const lineage = decodePublicV16Lineage(read.lineage)
  const record = read.head as { saveRevision?: unknown; value?: unknown } | null
  const head = lineage && record && decodePublicV16Head(record.value, lineage)
  const prior = read.previous as { saveRevision?: unknown; value?: unknown } | null
  const previous = lineage && prior && decodePublicV16Head(prior.value, lineage)
  const genesis = lineage && (lineage.origin === 'fresh'
    ? createFreshPublicV16Head(lineage.seed)
    : createMigratedPublicV16Head({ ...lineage.sourceReceipt, bootstrap: null }))
  if (!lineage || !head || head.saveRevision !== record?.saveRevision || !genesis
    || !samePublicV14Value(genesis.lineage, lineage)
    || head.saveRevision === 0 && !samePublicV14Value(head, genesis.head)
    || previous?.saveRevision === 0 && !samePublicV14Value(previous, genesis.head)
    || (head.saveRevision === 0 ? read.previous !== null
      : !previous || previous.saveRevision !== head.saveRevision - 1
        || previous.saveRevision !== prior?.saveRevision
        || (head.frameWitness
          ? !samePublicV14Value(replayPublicV16Frames(previous, lineage, head.frameWitness)?.next,
            progress(head))
          : !replayAction(progress(previous), progress(head))))) {
    return { status: 'blocked', reason: 'invalid-v16-history' }
  }
  if (!preservesHistory(progress(genesis.head), progress(head), lineage.seed)
    || previous && !preservesHistory(progress(genesis.head), progress(previous), lineage.seed)) {
    return { status: 'blocked', reason: 'invalid-v16-history' }
  }
  return { status: 'valid', head, lineage, proof: read.proof }
}

async function checkedCommit<T>(locks: PublicV7LockProvider | undefined, store: Store,
  revision: number, rawLineage: unknown,
  transition: (head: PublicV16Head, lineage: PublicV16Lineage) =>
    { next: PublicV16Progress; witness?: PublicV14FrameWitness; result: T } | string):
  Promise<PublicV16Operation<{ start: PublicV16Start; result: T }>> {
  const expected = decodePublicV16Lineage(rawLineage)
  if (!expected || !Number.isSafeInteger(revision) || revision < 0
    || !Number.isSafeInteger(revision + 1)) return failed('invalid-expectation')
  return withLock(locks, async () => {
    const checked = await checkedRecords(store)
    if (checked.status !== 'valid') return failed(checked.status === 'missing'
      ? 'root-missing' : checked.reason)
    if (!samePublicV14Value(checked.lineage, expected)) return failed('lineage-changed')
    if (checked.head.saveRevision !== revision) return failed('revision-changed')
    const result = transition(checked.head, checked.lineage)
    if (typeof result === 'string') return failed(result)
    const next = decodePublicV16Progress(result.next, checked.lineage.seed)
    if (!next || !preservesHistory(progress(checked.head), next, checked.lineage.seed)) {
      return failed('invalid-state')
    }
    let head: PublicV16Head
    try { head = encodePublicV16Head(next, revision + 1, checked.lineage, result.witness) }
    catch { return failed('invalid-state') }
    if (head.frameWitness
      ? !samePublicV14Value(replayPublicV16Frames(checked.head, checked.lineage,
        head.frameWitness)?.next, progress(head))
      : !replayAction(progress(checked.head), progress(head))) {
      return failed('invalid-v16-history')
    }
    const write = await store.commit(revision, checked.lineage,
      { saveRevision: head.saveRevision, value: head }, undefined, checked.proof)
    return write === 'committed'
      ? succeeded({ start: start(head, checked.lineage), result: result.result })
      : failed(write)
  })
}

/** Checked source inspection for a later migration while its caller owns the world lock. */
export async function inspectPublicV16UnderLock(store: Store): Promise<PublicV16Inspection> {
  const checked = await checkedRecords(store)
  if (checked.status === 'blocked') return { status: 'blocked', reason: checked.reason }
  if (checked.status === 'missing') return { status: 'missing' }
  return { status: 'valid', start: start(checked.head, checked.lineage) }
}
export function inspectPublicV16(locks: PublicV7LockProvider | undefined,
  store: Store): Promise<PublicV16Operation<PublicV16Inspection>> {
  return withLock<PublicV16Inspection>(locks, async () =>
    succeeded(await inspectPublicV16UnderLock(store)))
}
export function startFreshPublicV16(locks: PublicV7LockProvider | undefined,
  store: Store, seed: string): Promise<PublicV16Operation<PublicV16Start>> {
  if (typeof seed !== 'string' || !seed || seed.length > 128) return Promise.resolve(failed('invalid-seed'))
  return withLock(locks, async () => {
    const checked = await checkedRecords(store)
    if (checked.status !== 'missing') return failed(checked.status === 'valid'
      ? 'root-present' : checked.reason)
    const fresh = createFreshPublicV16Head(seed)
    const write = await store.commit(null, null,
      { saveRevision: 0, value: fresh.head }, fresh.lineage, checked.proof)
    return write === 'committed' ? succeeded(start(fresh.head, fresh.lineage)) : failed(write)
  })
}
export function startMigratedPublicV16(locks: PublicV7LockProvider | undefined,
  store: Store, sourceStore: V15Store, sourceStart: PublicV15Start):
  Promise<PublicV16Operation<PublicV16Start>> {
  const mapped = createMigratedPublicV16Head(sourceStart)
  if (!mapped) return Promise.resolve(failed('invalid-source'))
  return withLock(locks, async () => {
    const checked = await checkedRecords(store)
    if (checked.status !== 'missing') return failed(checked.status === 'valid'
      ? 'root-present' : checked.reason)
    const source = await inspectPublicV15UnderLock(sourceStore)
    if (source.status !== 'valid') return failed(source.status === 'missing'
      ? 'source-missing' : source.reason)
    const expected = { saveRevision: sourceStart.saveRevision, lineage: sourceStart.lineage,
      state: sourceStart.state, starterWorks: sourceStart.starterWorks }
    const actual = { saveRevision: source.start.saveRevision, lineage: source.start.lineage,
      state: source.start.state, starterWorks: source.start.starterWorks }
    if (!samePublicV14Value(expected, actual)
      || !samePublicV14Value(mapped.lineage.sourceReceipt, actual)) return failed('source-changed')
    const write = await store.commit(null, null,
      { saveRevision: 0, value: mapped.head }, mapped.lineage, checked.proof)
    return write === 'committed' ? succeeded(start(mapped.head, mapped.lineage)) : failed(write)
  })
}
export function resumePublicV16(locks: PublicV7LockProvider | undefined,
  store: Store, revision: number, rawLineage: unknown): Promise<PublicV16Operation<PublicV16Start>> {
  const expected = decodePublicV16Lineage(rawLineage)
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

export async function commitPublicV16FrameBatch(locks: PublicV7LockProvider | undefined,
  store: Store, frames: unknown, revision: number, lineage: unknown):
  Promise<PublicV16Operation<PublicV16ActionCommit>> {
  const witness = decodePublicV14FrameWitness({ kind: 'frame-batch/v1', frames })
  if (!witness) return failed('invalid-frames')
  const saved = await checkedCommit(locks, store, revision, lineage, (head, root) => {
    const frame = replayPublicV16Frames(head, root, witness)
    return frame ? { next: frame.next, witness, result: frame.events } : 'frame-rejected'
  })
  return saved.ok ? succeeded({ start: saved.value.start, events: saved.value.result }) : saved
}
export async function commitPublicV16Snapshot(locks: PublicV7LockProvider | undefined,
  store: Store, rawNext: unknown, revision: number, lineage: unknown):
  Promise<PublicV16Operation<PublicV16Start>> {
  const saved = await checkedCommit(locks, store, revision, lineage, (head) => {
    const next = decodePublicV16Progress(rawNext, head.state.seed)
    return next && samePublicV14Value(next, progress(head))
      ? { next, result: null } : 'action-required'
  })
  return saved.ok ? succeeded(saved.value.start) : saved
}
export async function commitPublicV16GreenwayAction(locks: PublicV7LockProvider | undefined,
  store: Store, intent: PublicWorldIntent, revision: number, lineage: unknown):
  Promise<PublicV16Operation<PublicV16ActionCommit>> {
  const saved = await checkedCommit(locks, store, revision, lineage, (head) => {
    const action = advancePublicV16GreenwayAction(progress(head), intent)
    return action.rejections.length ? 'action-rejected'
      : { next: action.progress, result: action.events }
  })
  return saved.ok ? succeeded({ start: saved.value.start, events: saved.value.result }) : saved
}
export async function commitPublicV16GreenwayWork(locks: PublicV7LockProvider | undefined,
  store: Store, id: unknown, revision: number, lineage: unknown):
  Promise<PublicV16Operation<PublicV16WorkCommit>> {
  const saved = await checkedCommit(locks, store, revision, lineage, (head) => {
    const work = confirmPublicV16GreenwayWork(progress(head), id)
    return work.progress && work.event ? { next: work.progress, result: work.event }
      : work.rejection ?? 'action-rejected'
  })
  return saved.ok ? succeeded({ start: saved.value.start, event: saved.value.result }) : saved
}
export async function commitPublicV16TerrainWork(locks: PublicV7LockProvider | undefined,
  store: Store, id: unknown, revision: number, lineage: unknown):
  Promise<PublicV16Operation<PublicV16WorkCommit>> {
  const saved = await checkedCommit(locks, store, revision, lineage, (head) => {
    if (head.state.movementOwner !== 'streamed') return 'action-rejected'
    const work = confirmPublicV14TerrainWork(head.state, id)
    return work.candidate && work.event ? { next: { state: work.candidate,
      greenwayWorks: head.greenwayWorks }, result: work.event } : 'action-rejected'
  })
  return saved.ok ? succeeded({ start: saved.value.start, event: saved.value.result }) : saved
}
