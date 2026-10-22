import type { PublicV45Start } from './domain/publicWorldV45Flow'
import type { PublicV45RideBatchWitness } from './domain/publicWorldV45RideAction'
import type { PublicV45Witness } from './domain/publicWorldV45Snapshot'
import { sameStrictBoundedRaw } from './domain/strictBoundedRaw'
import type { Vec3 } from './domain/types'

export type PublicV45SaveAck = Readonly<{ epoch: string; baseRevision: number;
  nextRevision: number; frameCount: number; terminal: Readonly<{ tick: number;
    position: Vec3; yaw: number; groundMountMode: 'parked' | 'riding' }> }>
export type PublicV45RideSaveAck = Omit<PublicV45SaveAck, 'terminal'> & Readonly<{
  batchId: number; terminal: Omit<PublicV45SaveAck['terminal'], 'groundMountMode'>
    & Readonly<{ groundMountMode: 'riding' }> }>
export type PublicV45ActionSaveAck = PublicV45SaveAck & Readonly<{ requestId: number }>
export type PublicV45SaveResult<A> = { status: 'committed'; ack: A }
  | { status: 'blocked'; reason: string; durability: 'not-committed' | 'unknown' }
export type PublicV45SaveTransport = Readonly<{
  epoch: string
  commitRideBatch(input: { batchId: number; expectedRevision: number;
    witness: PublicV45RideBatchWitness }): Promise<PublicV45SaveResult<PublicV45RideSaveAck>>
  commitAction(input: { requestId: number; expectedRevision: number;
    witness: PublicV45Witness }): Promise<PublicV45SaveResult<PublicV45ActionSaveAck>>
  requestReturnHome(input: { requestId: number; expectedRevision: number }):
    Promise<PublicV45SaveResult<PublicV45ActionSaveAck>>
  onFatal(fn: (reason: string) => void): () => void
  dispose(): void
}>
export type PublicV45SaveOpen = { status: 'ready'; transport: PublicV45SaveTransport }
  | { status: 'unsupported'; reason: 'worker' | 'locks' | 'indexeddb' | 'crypto' }
  | { status: 'blocked'; reason: string }

type Kind = 'ride' | 'action' | 'home'
type Pending = { kind: Kind; id: number; revision: number; frames: number;
  resolve: (value: PublicV45SaveResult<PublicV45SaveAck>) => void }
const blocked = (reason: string, durability: 'not-committed' | 'unknown') =>
  ({ status: 'blocked' as const, reason, durability })
const object = (raw: unknown): raw is Record<string, unknown> =>
  !!raw && typeof raw === 'object'

/** The page sends witnesses only; the Worker owns the checked durable Flow. */
export function openPublicV45SaveTransport(expected: PublicV45Start):
  Promise<PublicV45SaveOpen> {
  if (typeof Worker === 'undefined') return Promise.resolve({ status: 'unsupported', reason: 'worker' })
  let worker: Worker
  try { worker = new Worker(new URL('./PublicV45SaveWorker.ts', import.meta.url),
    { type: 'module' }) }
  catch { return Promise.resolve({ status: 'unsupported', reason: 'worker' }) }
  return new Promise((resolveOpen) => {
    let opened = false, closed = false, failure: string | null = null, epoch = ''
    let pending: Pending | null = null
    let tail: Promise<unknown> = Promise.resolve()
    const listeners = new Set<(reason: string) => void>()
    const close = (reason: string, notify: boolean) => {
      if (closed) return
      closed = true; failure = reason; clearTimeout(timer); worker.terminate()
      if (pending) { pending.resolve(blocked(reason, 'unknown')); pending = null }
      if (!opened) resolveOpen({ status: 'blocked', reason })
      if (notify) for (const fn of listeners) try { fn(reason) } catch { /* Isolate listeners. */ }
    }
    const timer = setTimeout(() => close('worker-init-timeout', true), 30_000)
    worker.onerror = () => close('worker-error', true)
    worker.onmessageerror = () => close('worker-message-error', true)
    worker.onmessage = ({ data }: MessageEvent) => {
      if (closed || !object(data)) return
      if (!opened) {
        clearTimeout(timer)
        if (data.kind === 'unsupported' && ['locks', 'indexeddb', 'crypto'].includes(
          String(data.reason)) && sameStrictBoundedRaw(data,
            { kind: 'unsupported', reason: data.reason }, 1 << 12)) {
          closed = true; worker.terminate()
          resolveOpen({ status: 'unsupported', reason: data.reason as 'locks' | 'indexeddb' | 'crypto' })
          return
        }
        if (data.kind !== 'ready' || typeof data.epoch !== 'string'
          || !data.epoch || !sameStrictBoundedRaw(data,
            { kind: 'ready', epoch: data.epoch }, 1 << 12)) {
          close(String(data.reason ?? 'worker-init-failed'), true); return }
        opened = true
        epoch = data.epoch
        const send = (kind: Kind, id: number, expectedRevision: number,
          witness?: PublicV45Witness): Promise<PublicV45SaveResult<PublicV45SaveAck>> => {
          // Snapshot before enqueue. A caller can mutate its object before the first
          // microtask or while a previous write holds the serial queue.
          let snapshot: PublicV45Witness | undefined
          if (kind !== 'home') {
            if (!witness || !sameStrictBoundedRaw(witness, witness, 1 << 18))
              return Promise.resolve(blocked('invalid-request', 'not-committed'))
            try { snapshot = structuredClone(witness) }
            catch { return Promise.resolve(blocked('invalid-request', 'not-committed')) }
            if (!sameStrictBoundedRaw(snapshot, witness, 1 << 18))
              return Promise.resolve(blocked('invalid-request', 'not-committed'))
          }
          const frames = kind === 'ride' && snapshot?.kind
            === 'sedgehorn-assisted-ride-batch/v1' ? snapshot.frames.length : 0
          const run = () => new Promise<PublicV45SaveResult<PublicV45SaveAck>>((done) => {
            if (closed) { done(blocked(failure ?? 'disposed', 'not-committed')); return }
            if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(expectedRevision)
              || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) {
              done(blocked('invalid-request', 'not-committed')); return
            }
            const timeout = setTimeout(() => close('worker-request-timeout', true), 30_000)
            pending = { kind, id, revision: expectedRevision, frames,
              resolve: (value) => { clearTimeout(timeout); done(value) } }
            try { worker.postMessage({ kind, epoch, id, expectedRevision,
              ...(kind === 'home' ? {} : { witness: snapshot }) }) }
            catch { clearTimeout(timeout); pending = null
              done(blocked('post-message-error', 'not-committed')) }
          })
          const result = tail.then(run)
          tail = result.then(() => undefined)
          return result
        }
        const transport: PublicV45SaveTransport = { epoch,
          commitRideBatch: async ({ batchId, expectedRevision, witness }) => {
            const result = await send('ride', batchId, expectedRevision, witness)
            if (result.status === 'blocked') return result
            const { ack } = result
            if (ack.terminal.groundMountMode !== 'riding')
              return blocked('worker-ack-mismatch', 'unknown')
            return { status: 'committed', ack: { ...ack, batchId,
              terminal: { ...ack.terminal, groundMountMode: 'riding' } } }
          },
          commitAction: async ({ requestId, expectedRevision, witness }) => {
            const result = await send('action', requestId, expectedRevision, witness)
            return result.status === 'blocked' ? result
              : { status: 'committed', ack: { ...result.ack, requestId } }
          },
          requestReturnHome: async ({ requestId, expectedRevision }) => {
            const result = await send('home', requestId, expectedRevision)
            return result.status === 'blocked' ? result
              : { status: 'committed', ack: { ...result.ack, requestId } }
          },
          onFatal: (fn) => { listeners.add(fn); if (failure) try { fn(failure) } catch {}
            return () => { listeners.delete(fn) } },
          dispose: () => close('disposed', false) }
        resolveOpen({ status: 'ready', transport })
        return
      }
      if (data.kind === 'fatal' && typeof data.reason === 'string') {
        close(data.reason, true); return
      }
      const active = pending
      if (!active || data.kind !== 'result' || data.epoch !== epoch
        || data.id !== active.id || !object(data.result)
        || Object.keys(data).sort().join() !== 'epoch,id,kind,result') {
        close('worker-protocol-error', true); return
      }
      const result = data.result
      if (result.status === 'blocked' && typeof result.reason === 'string'
        && (result.durability === 'not-committed' || result.durability === 'unknown')
        && sameStrictBoundedRaw(result, { status: 'blocked',
          reason: result.reason, durability: result.durability }, 1 << 12)) {
        pending = null
        active.resolve(blocked(result.reason, result.durability))
        if (result.durability === 'unknown') close(result.reason, true)
        return
      }
      const ack = result.ack
      if (result.status !== 'committed' || !object(ack) || !object(ack.terminal)) {
        close('worker-protocol-error', true); return
      }
      const terminal = ack.terminal, position = terminal.position
      const canonical = { epoch, [active.kind === 'ride' ? 'batchId' : 'requestId']: active.id,
        baseRevision: active.revision, nextRevision: active.revision + 1,
        frameCount: active.frames, terminal: { tick: terminal.tick,
          position: object(position) ? { x: position.x, y: position.y, z: position.z } : null,
          yaw: terminal.yaw, groundMountMode: terminal.groundMountMode } }
      if (!sameStrictBoundedRaw(ack, canonical, 1 << 12) || !object(position)
        || ![position.x, position.y, position.z, terminal.yaw].every(
          (value) => typeof value === 'number' && Number.isFinite(value))
        || !Number.isSafeInteger(terminal.tick) || (terminal.tick as number) < 0
        || !['parked', 'riding'].includes(String(terminal.groundMountMode))
        || active.kind === 'ride' && terminal.groundMountMode !== 'riding') {
        close('worker-ack-mismatch', true); return
      }
      pending = null
      active.resolve({ status: 'committed', ack: ack as PublicV45SaveAck })
    }
    try { worker.postMessage({ kind: 'init', expected }) }
    catch { clearTimeout(timer); close('worker-init-error', true) }
  })
}
