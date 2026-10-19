import { createFreshPublicWorld } from './publicWorldState'
import type { GenerationProfile } from './types'
import {
  commitLegacyImportToPublicV6, inspectLegacyImportSource, inspectPublicV6Artifacts,
  loadPublicV6Root, readPublicV6RecoverySnapshot,
} from './publicWorldV6'
import type { LegacyImportInspection, PublicV6ArtifactInspection, PublicV6RootLoad } from './publicWorldV6'
import {
  PUBLIC_V7_LOCK_NAME, PUBLIC_V7_SCHEMA, commitPublicV7World, inspectPublicV7Artifacts,
  loadPublicV7Root, migratePublicV6ToV7, parsePublicV7PlayableRoot,
  serializePublicV7World, withFreshPublicV7Herbs,
} from './publicWorldV7'
import type { PublicV7ArtifactInspection, PublicV7RootLoad, PublicWorldV7State } from './publicWorldV7'
import { readPublicV7RecoverySnapshot, recoverPublicV7Root } from './publicWorldV7Recovery'
import type { PublicV7RecoverySnapshot } from './publicWorldV7Recovery'
import { inspectPublicV7StaleStageConflict, readPublicV7StageConflictSnapshot,
  resolvePublicV7StaleStage } from './publicWorldV7StageConflict'
import type { PublicV7StageConflictSnapshot } from './publicWorldV7StageConflict'
import { inspectPublicV7RootConflictSnapshot, readPublicV7RootConflictSnapshot,
  resolvePublicV7RootConflict } from './publicWorldV7RootConflict'
import type { PublicV7RootConflictChoice, PublicV7RootConflictSnapshot } from './publicWorldV7RootConflict'
import { inspectPublicV7FreshForkSnapshot, readPublicV7FreshForkSnapshot,
  resolvePublicV7FreshFork } from './publicWorldV7FreshFork'
import type { PublicV7FreshForkChoice, PublicV7FreshForkSnapshot } from './publicWorldV7FreshFork'

export type { PublicWorldV7State } from './publicWorldV7'
export interface PublicV7LockProvider {
  request<T>(name: string, options: { mode: 'exclusive' }, callback: () => T | Promise<T>): Promise<T>
}
export type PublicV7Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export interface PublicV7Start { state: PublicWorldV7State; bytes: string }
export interface PublicWorldV7EntryInspection {
  root: PublicV7RootLoad
  artifacts: PublicV7ArtifactInspection
  recovery: ReturnType<typeof readPublicV7RecoverySnapshot>
  /** Older roots are inspected only when no v7 candidate needs attention. */
  v6: PublicV6RootLoad | { status: 'skipped' }
  v6Artifacts: PublicV6ArtifactInspection | { status: 'skipped' }
  v6Recovery: ReturnType<typeof readPublicV6RecoverySnapshot> | { status: 'skipped' }
  classic: LegacyImportInspection
  expanded: LegacyImportInspection
  blockedReason: string | null
  stageConflict: { status: 'eligible'; snapshot: PublicV7StageConflictSnapshot } | { status: 'unavailable' }
  rootConflict: { status: 'eligible'; snapshot: PublicV7RootConflictSnapshot;
    choices: readonly PublicV7RootConflictChoice[] } | { status: 'unavailable' }
  freshFork: { status: 'eligible'; snapshot: PublicV7FreshForkSnapshot;
    choices: readonly PublicV7FreshForkChoice[] } | { status: 'unavailable' }
}

const failed = (reason: string): PublicV7Operation<never> => ({ ok: false, reason })
const succeeded = <T,>(value: T): PublicV7Operation<T> => ({ ok: true, value })
async function withLock<T>(locks: PublicV7LockProvider | undefined,
  operation: () => PublicV7Operation<T>): Promise<PublicV7Operation<T>> {
  if (!locks) return failed('lock-unavailable')
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, operation) }
  catch { return failed('storage-error') }
}

function v7Block(root: PublicV7RootLoad, artifacts: PublicV7ArtifactInspection,
  recovery: ReturnType<typeof readPublicV7RecoverySnapshot>): string | null {
  if (root.status === 'storage-error' || artifacts.status === 'storage-error'
    || recovery.status === 'storage-error') return 'storage-error'
  if (root.status === 'invalid') return 'invalid-v7-root'
  if (root.status === 'source-changed') return 'source-changed'
  if (artifacts.stage.status === 'pending' || artifacts.stage.status === 'invalid') return 'pending-v7-stage'
  if (artifacts.backup.status === 'invalid') return 'invalid-v7-backup'
  if (root.status === 'missing' && artifacts.backup.status === 'available') return 'v7-backup-present'
  return null
}

function inspectUnlocked(storage: Pick<Storage, 'getItem'>): PublicWorldV7EntryInspection {
  const root = loadPublicV7Root(storage)
  const artifacts = inspectPublicV7Artifacts(storage)
  const recovery = readPublicV7RecoverySnapshot(storage)
  const v7Reason = v7Block(root, artifacts, recovery)
  const stageSnapshot = v7Reason === 'pending-v7-stage' && root.status === 'missing'
    ? readPublicV7StageConflictSnapshot(storage) : null
  const stageConflict = stageSnapshot?.status === 'available'
    && inspectPublicV7StaleStageConflict(stageSnapshot.snapshot).status === 'eligible'
    ? { status: 'eligible' as const, snapshot: stageSnapshot.snapshot }
    : { status: 'unavailable' as const }
  const rootSnapshot = v7Reason === 'source-changed' && root.status === 'source-changed'
    ? readPublicV7RootConflictSnapshot(storage) : null
  const rootEligibility = rootSnapshot?.status === 'available'
    ? inspectPublicV7RootConflictSnapshot(rootSnapshot.snapshot) : null
  const rootConflict = rootSnapshot?.status === 'available' && rootEligibility?.status === 'available'
    ? { status: 'eligible' as const, snapshot: rootSnapshot.snapshot, choices: rootEligibility.choices }
    : { status: 'unavailable' as const }
  const freshStageWithoutRoot = v7Reason === 'pending-v7-stage' && root.status === 'missing'
  const forkSnapshot = (v7Reason === 'source-changed' && root.status === 'source-changed'
    && rootConflict.status === 'unavailable') || freshStageWithoutRoot
    ? readPublicV7FreshForkSnapshot(storage) : null
  const forkEligibility = forkSnapshot?.status === 'available'
    ? inspectPublicV7FreshForkSnapshot(forkSnapshot.snapshot) : null
  const freshFork = forkSnapshot?.status === 'available' && forkEligibility?.status === 'available'
    ? { status: 'eligible' as const, snapshot: forkSnapshot.snapshot, choices: forkEligibility.choices }
    : { status: 'unavailable' as const }
  const resolvedV7Reason = stageSnapshot?.status === 'storage-error' || rootSnapshot?.status === 'storage-error'
    || forkSnapshot?.status === 'storage-error'
    ? 'storage-error' : freshStageWithoutRoot && forkEligibility?.status === 'not-initial-fresh-stage'
        ? forkEligibility.status : v7Reason
  const skipped = { status: 'skipped' } as const
  const missing = { status: 'missing' } as const
  if (root.status !== 'missing' || resolvedV7Reason) return {
    root, artifacts, recovery, v6: skipped, v6Artifacts: skipped, v6Recovery: skipped,
    classic: missing, expanded: missing, blockedReason: resolvedV7Reason, stageConflict, rootConflict, freshFork,
  }
  const v6 = loadPublicV6Root(storage)
  const v6Artifacts = inspectPublicV6Artifacts(storage)
  const v6Recovery = readPublicV6RecoverySnapshot(storage)
  let blockedReason: string | null = v6.status === 'storage-error'
    || v6Artifacts.status === 'storage-error' || v6Recovery.status === 'storage-error'
    ? 'storage-error' : v6.status === 'invalid' ? 'invalid-v6-root' : null
  if (!blockedReason && v6Artifacts.status === 'available') {
    if (v6Artifacts.stage.status === 'pending' || v6Artifacts.stage.status === 'invalid') blockedReason = 'pending-v6-stage'
    else if (v6Artifacts.backup.status === 'invalid') blockedReason = 'invalid-v6-backup'
    else if (v6.status === 'missing' && v6Artifacts.backup.status === 'available') blockedReason = 'v6-backup-present'
  }
  const classic = v6.status === 'missing' && !blockedReason
    ? inspectLegacyImportSource(storage, 'greenway-classic-v1') : missing
  const expanded = v6.status === 'missing' && !blockedReason
    ? inspectLegacyImportSource(storage, 'greenway-expanded-v1') : missing
  if (classic.status === 'storage-error' || expanded.status === 'storage-error') blockedReason = 'storage-error'
  return { root, artifacts, recovery, v6, v6Artifacts, v6Recovery, classic, expanded, blockedReason, stageConflict, rootConflict, freshFork }
}

export function inspectPublicV7Entry(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined): Promise<PublicV7Operation<PublicWorldV7EntryInspection>> {
  return withLock(locks, () => succeeded(inspectUnlocked(storage)))
}

function committed(result: ReturnType<typeof commitPublicV7World>): PublicV7Operation<PublicV7Start> {
  return result.status === 'committed'
    ? succeeded({ state: result.root.state, bytes: result.bytes }) : failed(result.status)
}

export function startFreshPublicV7(storage: Pick<Storage, 'getItem' | 'setItem'>,
  locks: PublicV7LockProvider | undefined, profile: GenerationProfile,
  confirmedFreshStartWithLegacy: boolean): Promise<PublicV7Operation<PublicV7Start>> {
  return withLock(locks, () => {
    const entry = inspectUnlocked(storage)
    if (entry.blockedReason) return failed(entry.blockedReason)
    if (entry.root.status !== 'missing') return failed('root-present')
    if (entry.v6.status !== 'missing') return failed('v6-present')
    if (!confirmedFreshStartWithLegacy && (entry.classic.status !== 'missing'
      || entry.expanded.status !== 'missing')) return failed('legacy-present')
    return committed(commitPublicV7World(storage,
      withFreshPublicV7Herbs(createFreshPublicWorld('greenway-alpha', profile)), null,
      { confirmedFreshStartWithLegacy }))
  })
}

export function resumePublicV7(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, expectedBytes: string): Promise<PublicV7Operation<PublicV7Start>> {
  return withLock(locks, () => {
    const entry = inspectUnlocked(storage)
    if (entry.blockedReason) return failed(entry.blockedReason)
    if (entry.root.status !== 'valid-playable' || entry.root.bytes !== expectedBytes) return failed('root-changed')
    return succeeded({ state: entry.root.root.state, bytes: entry.root.bytes })
  })
}

export function upgradePublicV6(storage: Pick<Storage, 'getItem' | 'setItem'>,
  locks: PublicV7LockProvider | undefined, expectedV6Bytes: string): Promise<PublicV7Operation<PublicV7Start>> {
  return withLock(locks, () => {
    const entry = inspectUnlocked(storage)
    if (entry.blockedReason) return failed(entry.blockedReason)
    if (entry.root.status !== 'missing') return failed('root-present')
    if (!('bytes' in entry.v6) || entry.v6.bytes !== expectedV6Bytes) return failed('source-changed')
    return committed(migratePublicV6ToV7(storage, expectedV6Bytes))
  })
}

export function importLegacyToPublicV7(storage: Pick<Storage, 'getItem' | 'setItem'>,
  locks: PublicV7LockProvider | undefined,
  inspected: Extract<LegacyImportInspection, { status: 'available' }>): Promise<PublicV7Operation<PublicV7Start>> {
  return withLock(locks, () => {
    const entry = inspectUnlocked(storage)
    if (entry.blockedReason) return failed(entry.blockedReason)
    if (entry.root.status !== 'missing' || entry.v6.status !== 'missing') return failed('root-present')
    const imported = commitLegacyImportToPublicV6(storage, inspected)
    if (imported.status !== 'committed') return failed(imported.status)
    const source = loadPublicV6Root(storage)
    if (source.status !== 'valid-bootstrap') return failed('bootstrap-verification-failed')
    return committed(migratePublicV6ToV7(storage, source.bytes))
  })
}

export function commitPublicV7Snapshot(storage: Pick<Storage, 'getItem' | 'setItem'>,
  locks: PublicV7LockProvider | undefined, state: PublicWorldV7State,
  expectedBytes: string | null, confirmedFreshStartWithLegacy = false): Promise<PublicV7Operation<PublicV7Start>> {
  return withLock(locks, () => {
    if (expectedBytes === null) {
      const entry = inspectUnlocked(storage)
      if (entry.blockedReason) return failed(entry.blockedReason)
      if (entry.root.status !== 'missing') return failed('root-present')
      if (entry.v6.status !== 'missing') return failed('v6-present')
    }
    return committed(commitPublicV7World(storage, state, expectedBytes, { confirmedFreshStartWithLegacy }))
  })
}

export function recoverPublicV7Snapshot(storage: Pick<Storage, 'getItem' | 'setItem'>,
  locks: PublicV7LockProvider | undefined, source: 'root' | 'stage' | 'backup',
  expected: PublicV7RecoverySnapshot): Promise<PublicV7Operation<{ archiveKey: string }>> {
  return withLock(locks, () => {
    const result = recoverPublicV7Root(storage, source, expected)
    return result.status === 'recovered' ? succeeded({ archiveKey: result.archiveKey }) : failed(result.status)
  })
}

export function clearArchivedStaleV7Stage(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  locks: PublicV7LockProvider | undefined,
  expected: PublicV7StageConflictSnapshot): Promise<PublicV7Operation<{ archiveKey: string }>> {
  return withLock(locks, () => {
    const result = resolvePublicV7StaleStage(storage, expected)
    return result.status === 'resolved' ? succeeded({ archiveKey: result.archiveKey }) : failed(result.status)
  })
}

export function reconcilePublicV7RootConflict(storage: Pick<Storage, 'getItem' | 'setItem'>,
  locks: PublicV7LockProvider | undefined, choice: PublicV7RootConflictChoice,
  expected: PublicV7RootConflictSnapshot): Promise<PublicV7Operation<{ archiveKey: string }>> {
  return withLock(locks, () => {
    const result = resolvePublicV7RootConflict(storage, choice, expected)
    return result.status === 'resolved' ? succeeded({ archiveKey: result.archiveKey }) : failed(result.status)
  })
}

export function reconcilePublicV7FreshFork(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  locks: PublicV7LockProvider | undefined, choice: PublicV7FreshForkChoice,
  expected: PublicV7FreshForkSnapshot): Promise<PublicV7Operation<{ archiveKey: string }>> {
  return withLock(locks, () => {
    const result = resolvePublicV7FreshFork(storage, choice, expected)
    return result.status === 'resolved' ? succeeded({ archiveKey: result.archiveKey }) : failed(result.status)
  })
}

/** Build a portable, validated snapshot without writing storage. */
export function unsavedPublicV7Bytes(state: PublicWorldV7State, lastCommittedBytes: string | null): string | null {
  const prior = lastCommittedBytes === null ? null : parsePublicV7PlayableRoot(lastCommittedBytes)
  if (!prior || !Number.isSafeInteger(prior.saveRevision + 1)) return null
  try { return serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA,
    saveRevision: prior.saveRevision + 1, bootstrap: prior.bootstrap,
    migrationSourceV6Bytes: prior.migrationSourceV6Bytes, state }) }
  catch { return null }
}
