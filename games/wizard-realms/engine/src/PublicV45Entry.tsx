import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createAtomicV44PromotionStore } from './domain/atomicV44Promotion'
import { createAtomicV45Store } from './domain/atomicV45Database'
import { resumePublicV45, startPublicV45 } from './domain/publicWorldV45Flow'
import type { PublicV45Operation, PublicV45Start } from './domain/publicWorldV45Flow'
import { PUBLIC_V7_LOCK_NAME } from './domain/publicWorldV7'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { sameStrictBoundedRaw } from './domain/strictBoundedRaw'
import { openPublicV45SaveTransport } from './PublicV45SaveTransport'
import type { PublicV45SaveOpen, PublicV45SaveTransport } from './PublicV45SaveTransport'

export type PublicV45EntryBindings = Readonly<{
  locks: PublicV7LockProvider
  store: ReturnType<typeof createAtomicV45Store>
  v44Store: ReturnType<typeof createAtomicV44PromotionStore>
}>
export type PublicV45EntryDecision = { status: 'resume'; start: PublicV45Start }
  | { status: 'migration-available'; sourceRevision: number; interrupted: boolean }
  | { status: 'blocked'; reason: string }
type Choice = 'resume' | 'migrate'
export type PublicV45SessionSaveOpen = Extract<PublicV45SaveOpen,
  { status: 'ready' | 'unsupported' }>

/** A deferred close survives React StrictMode's synchronous effect replay. */
export function createPublicV45EntryTransportGate(open = openPublicV45SaveTransport) {
  let mounted = false, generation = 0, choice = 0
  let held: PublicV45SaveTransport | null = null
  return {
    isMounted: () => mounted,
    mount: () => {
      mounted = true; ++generation
      return () => {
        mounted = false
        const closing = ++generation
        queueMicrotask(() => {
          if (mounted || generation !== closing) return
          ++choice; held?.dispose(); held = null
        })
      }
    },
    open: async (start: PublicV45Start): Promise<PublicV45SaveOpen> => {
      const current = ++choice
      held?.dispose(); held = null
      let result: PublicV45SaveOpen
      try { result = await open(start) }
      catch { result = { status: 'blocked', reason: 'worker-init-error' } }
      if (!mounted || current !== choice) {
        if (result.status === 'ready') result.transport.dispose()
        return { status: 'blocked', reason: 'choice-superseded' }
      }
      if (result.status === 'ready') held = result.transport
      return result
    },
  }
}

/** Read checked roots and the V44 marker without completing a pending handoff. */
export async function inspectPublicV45Entry(bindings: PublicV45EntryBindings | null):
  Promise<PublicV45EntryDecision> {
  if (!bindings) return { status: 'blocked', reason: 'storage-error' }
  if (!bindings.locks || typeof bindings.locks.request !== 'function')
    return { status: 'blocked', reason: 'lock-unavailable' }
  try {
    return await bindings.locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' },
      async (): Promise<PublicV45EntryDecision> => {
        const source = await bindings.v44Store.readForPromotion()
        if (source.status !== 'valid') return { status: 'blocked',
          reason: source.status === 'blocked' ? source.reason : 'source-missing' }
        const target = await bindings.store.readChecked()
        if (target.status === 'blocked') return { status: 'blocked', reason: target.reason }
        if (!source.marker) return target.status === 'missing'
          ? { status: 'migration-available', sourceRevision: source.root.head.saveRevision,
            interrupted: false }
          : { status: 'blocked', reason: 'ambiguous-legacy-target' }
        if (target.status === 'valid' && (target.root.lineage.sourceRevision
          !== source.root.head.saveRevision || !sameStrictBoundedRaw(
            target.root.lineage.source, source.root, 3 << 20)))
          return { status: 'blocked', reason: 'target-conflict' }
        if (source.marker.phase === 'pending') return {
          status: 'migration-available', sourceRevision: source.root.head.saveRevision,
          interrupted: true }
        return target.status === 'valid'
          ? { status: 'resume', start: { head: target.root.head,
            lineage: target.root.lineage } }
          : { status: 'blocked', reason: 'target-missing' }
      })
  } catch { return { status: 'blocked', reason: 'storage-error' } }
}

export async function choosePublicV45Entry(decision: PublicV45EntryDecision,
  choice: Choice, bindings: PublicV45EntryBindings):
  Promise<PublicV45Operation<PublicV45Start>> {
  const current = await inspectPublicV45Entry(bindings)
  if (current.status === 'blocked') return { ok: false, reason: current.reason }
  if (decision.status === 'resume' && choice === 'resume'
    && current.status === 'resume')
    return resumePublicV45(bindings.locks, bindings.store, bindings.v44Store,
      decision.start.head.saveRevision, decision.start.lineage)
  if (decision.status === 'migration-available' && choice === 'migrate'
    && current.status === 'migration-available') {
    if (current.sourceRevision !== decision.sourceRevision)
      return { ok: false, reason: 'source-revision-changed' }
    if (current.interrupted !== decision.interrupted)
      return { ok: false, reason: 'branch-changed' }
    return startPublicV45(bindings.locks, bindings.store, bindings.v44Store,
      decision.sourceRevision)
  }
  return { ok: false, reason: 'branch-changed' }
}

const button = { minHeight: 44, padding: '8px 14px', font: 'inherit', cursor: 'pointer' } as const
export function PublicV45EntryView({ entry, busyChoice, onChoose, onRetry, actionError }: {
  entry: PublicV45EntryDecision | { status: 'checking' }; busyChoice: Choice | null;
  onChoose: (choice: Choice) => void; onRetry: () => void; actionError: string | null }) {
  const busy = busyChoice !== null
  return <main data-public-v45-entry="true" style={{ minHeight: '100dvh', display: 'grid',
    placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#10201b',
    color: '#f4efda', font: '16px/1.5 system-ui' }}><section style={{ maxWidth: 560 }}>
    <p role="status">Experimental V45 mount and market preview</p>
    <h1>Wizard Realms</h1>
    {busyChoice && <p role="status" aria-live="polite">{busyChoice === 'migrate'
      ? 'Checking and importing adventure…' : 'Continuing adventure…'}</p>}
    {entry.status === 'checking' && <p>Checking this device for a V45 adventure…</p>}
    {entry.status === 'migration-available' && <><p>A checked V44 adventure at save
      #{entry.sourceRevision} is ready {entry.interrupted ? 'to complete its interrupted V45 import'
        : 'to import into a separate V45 save'}. Import is your choice. The V44 save bytes remain,
      but V44 is fenced afterward and cannot continue independently. This does not change your
      V42 save. Close older game tabs before importing.</p><button type="button" style={button}
      disabled={busy} onClick={() => onChoose('migrate')}>{entry.interrupted
        ? 'Complete V45 import' : 'Import V44 adventure into V45'}</button></>}
    {entry.status === 'resume' && <><p>Checked V45 save #{entry.start.head.saveRevision}
      is ready. It came from checked V44 save #{entry.start.lineage.sourceRevision}.
      The V44 source is fenced after import.</p><button type="button" style={button}
      disabled={busy} onClick={() => onChoose('resume')}>Continue V45 adventure</button></>}
    {entry.status === 'blocked' && <><p role="alert">V45 cannot open ({entry.reason}).
      No save was cleared or replaced. A checked V44 development adventure is required.
      Recheck before trying another import.</p><button type="button" style={button}
      disabled={busy} onClick={onRetry}>Reload to recheck</button></>}
    {actionError && <p role="alert">The action did not complete ({actionError}). No save
      was reset. Reload to recheck before retrying.</p>}
  </section></main>
}

export function PublicV45EntryApp({ renderSession }: {
  renderSession: (start: PublicV45Start, bindings: PublicV45EntryBindings,
    saveOpen: PublicV45SessionSaveOpen) => ReactNode }) {
  const bindings = useRef<PublicV45EntryBindings | null>(null)
  const transportGate = useRef<ReturnType<typeof createPublicV45EntryTransportGate> | null>(null)
  transportGate.current ??= createPublicV45EntryTransportGate()
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV45EntryDecision | { status: 'checking' }>(
    { status: 'checking' })
  const [busyChoice, setBusyChoice] = useState<Choice | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [session, setSession] = useState<{ start: PublicV45Start;
    saveOpen: PublicV45SessionSaveOpen } | null>(null)
  useEffect(() => {
    let cancelled = false
    const unmountGate = transportGate.current!.mount()
    const inspect = async () => {
      try {
        const locks = (navigator as Navigator & { locks?: PublicV7LockProvider }).locks
        const factory = window.indexedDB
        if (!locks || typeof locks.request !== 'function' || !factory) {
          if (!cancelled) setEntry({ status: 'blocked', reason: !locks
            || typeof locks.request !== 'function' ? 'lock-unavailable' : 'storage-error' })
          return
        }
        bindings.current ??= { locks, store: createAtomicV45Store(factory),
          v44Store: createAtomicV44PromotionStore(factory) }
        const result = await inspectPublicV45Entry(bindings.current)
        if (!cancelled) setEntry(result)
      } catch { if (!cancelled) setEntry({ status: 'blocked', reason: 'storage-error' }) }
    }
    void inspect()
    return () => { cancelled = true; unmountGate() }
  }, [])
  const choose = async (choice: Choice) => {
    if (choosing.current || !bindings.current || entry.status === 'checking') return
    choosing.current = true; setBusyChoice(choice); setActionError(null)
    try {
      const result = await choosePublicV45Entry(entry, choice, bindings.current)
      if (!transportGate.current!.isMounted()) return
      if (result.ok) {
        const saveOpen = await transportGate.current!.open(result.value)
        if (!transportGate.current!.isMounted()) return
        if (saveOpen.status === 'blocked') setEntry({ status: 'blocked', reason: saveOpen.reason })
        else setSession({ start: result.value, saveOpen })
      } else {
        setActionError(result.reason)
        const next = await inspectPublicV45Entry(bindings.current)
        if (transportGate.current!.isMounted()) setEntry(next)
      }
    } catch { if (transportGate.current!.isMounted()) setActionError('storage-error') }
    finally {
      choosing.current = false
      if (transportGate.current!.isMounted()) setBusyChoice(null)
    }
  }
  if (session && bindings.current) return <>{renderSession(session.start, bindings.current,
    session.saveOpen)}</>
  return <PublicV45EntryView entry={entry} busyChoice={busyChoice}
    onChoose={(choice) => void choose(choice)} onRetry={() => window.location.reload()}
    actionError={actionError} />
}
