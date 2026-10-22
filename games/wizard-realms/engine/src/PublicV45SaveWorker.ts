import { createAtomicV44PromotionStore } from './domain/atomicV44Promotion'
import { createAtomicV45Store } from './domain/atomicV45Database'
import { commitPublicV45, consumePublicV45CommitReceipt, resumePublicV45,
  requestPublicV45ReturnHome } from './domain/publicWorldV45Flow'
import type { PublicV45Start } from './domain/publicWorldV45Flow'
import { decodePublicV45RideBatchWitness } from './domain/publicWorldV45RideAction'
import { decodePublicV45Witness } from './domain/publicWorldV45Snapshot'
import { sameStrictBoundedRaw } from './domain/strictBoundedRaw'

type Request = { kind: 'ride' | 'action' | 'home'; epoch: string; id: number;
  expectedRevision: number; witness?: unknown }
type Scope = { postMessage: (message: unknown) => void;
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void }
const scope = globalThis as unknown as Scope
let current: PublicV45Start | null = null
let epoch = ''
let busy = false, initialized = false
let lastBatch = 0, lastRequest = 0
let store: ReturnType<typeof createAtomicV45Store> | null = null
let source: ReturnType<typeof createAtomicV44PromotionStore> | null = null
const reply = (message: unknown) => scope.postMessage(message)

async function handle(raw: unknown) {
  if (!raw || typeof raw !== 'object') return
  const message = raw as Record<string, unknown>
  if (message.kind === 'init' && !initialized) {
    initialized = true
    const missing = !navigator.locks?.request ? 'locks'
      : typeof indexedDB === 'undefined' ? 'indexeddb'
      : typeof crypto === 'undefined' || !crypto.subtle
        || typeof crypto.randomUUID !== 'function' ? 'crypto' : null
    if (missing) { reply({ kind: 'unsupported', reason: missing }); return }
    const expected = message.expected as PublicV45Start
    if (!expected?.head || !expected.lineage
      || !sameStrictBoundedRaw(expected, expected, 3 << 20)) {
      reply({ kind: 'blocked', reason: 'invalid-start' }); return
    }
    store = createAtomicV45Store(indexedDB)
    source = createAtomicV44PromotionStore(indexedDB)
    const resumed = await resumePublicV45(navigator.locks, store, source,
      expected.head.saveRevision, expected.lineage)
    if (!resumed.ok || !sameStrictBoundedRaw(resumed.value, expected, 3 << 20)) {
      reply({ kind: 'blocked', reason: resumed.ok ? 'start-changed' : resumed.reason }); return
    }
    current = resumed.value
    epoch = crypto.randomUUID()
    reply({ kind: 'ready', epoch })
    return
  }
  if (!current || !store || !source || busy) {
    reply({ kind: 'fatal', reason: 'protocol-error' }); return }
  const request = message as Request
  if (!['ride', 'action', 'home'].includes(request.kind)) {
    reply({ kind: 'fatal', reason: 'protocol-error' }); return
  }
  const last = request.kind === 'ride' ? lastBatch : lastRequest
  const idValid = Number.isSafeInteger(request.id) && request.id > last
  const revisionValid = request.expectedRevision === current.head.saveRevision
  const witness = request.kind === 'home' ? null
    : request.kind === 'ride' ? decodePublicV45RideBatchWitness(request.witness)
      : decodePublicV45Witness(request.witness)
  const valid = request.epoch === epoch && idValid && revisionValid
    && Object.keys(request).sort().join() === (request.kind === 'home'
      ? 'epoch,expectedRevision,id,kind' : 'epoch,expectedRevision,id,kind,witness')
    && (request.kind === 'home' ? !Object.hasOwn(request, 'witness')
      : !!witness && sameStrictBoundedRaw(request.witness, request.witness, 1 << 18))
    && (request.kind !== 'action' || witness?.kind !== 'sedgehorn-assisted-ride-batch/v1'
      && witness?.kind !== 'return-home/v1')
  if (!valid) {
    reply({ kind: 'result', epoch, id: request.id,
      result: { status: 'blocked', reason: 'invalid-request', durability: 'not-committed' } })
    return
  }
  if (request.kind === 'ride') lastBatch = request.id
  else lastRequest = request.id
  busy = true
  const before = current
  try {
    const committed = request.kind === 'home'
      ? await requestPublicV45ReturnHome(navigator.locks, store, source,
        request.expectedRevision, before.lineage)
      : await commitPublicV45(navigator.locks, store, source,
        request.expectedRevision, before.lineage, witness!)
    if (committed.ok && consumePublicV45CommitReceipt(committed, before, witness)) {
      current = { head: committed.value.head, lineage: committed.value.lineage }
      const { state, groundMount } = current.head
      const ack = { epoch, [request.kind === 'ride' ? 'batchId' : 'requestId']: request.id,
        baseRevision: request.expectedRevision, nextRevision: current.head.saveRevision,
        frameCount: request.kind === 'ride' && witness?.kind
          === 'sedgehorn-assisted-ride-batch/v1' ? witness.frames.length : 0,
        terminal: { tick: state.tick, position: state.player.position,
          yaw: state.player.yaw, groundMountMode: groundMount.mode } }
      reply({ kind: 'result', epoch, id: request.id,
        result: { status: 'committed', ack } })
    } else {
      const reread = await resumePublicV45(navigator.locks, store, source,
        before.head.saveRevision, before.lineage)
      const durability = reread.ok && sameStrictBoundedRaw(reread.value, before, 3 << 20)
        ? 'not-committed' : 'unknown'
      reply({ kind: 'result', epoch, id: request.id, result: { status: 'blocked',
        reason: committed.ok ? 'receipt-mismatch' : committed.reason, durability } })
      if (durability === 'unknown') current = null
    }
  } catch {
    reply({ kind: 'result', epoch, id: request.id,
      result: { status: 'blocked', reason: 'worker-error', durability: 'unknown' } })
    current = null
  } finally { busy = false }
}

if (typeof document === 'undefined') scope.addEventListener('message', (event) => {
  void handle(event.data).catch(() => reply({ kind: 'fatal', reason: 'worker-error' }))
})
