import {
  PUBLIC_V6_BACKUP_KEY, PUBLIC_V6_ROOT_KEY, PUBLIC_V6_STAGE_KEY,
  parsePublicV6BootstrapRoot, parsePublicV6PlayableRoot,
} from './publicWorldV6'
import type { PublicV6BootstrapRoot, PublicV6PlayableRoot } from './publicWorldV6'
import {
  PUBLIC_V7_BACKUP_KEY, PUBLIC_V7_ROOT_KEY, PUBLIC_V7_SCHEMA, PUBLIC_V7_STAGE_KEY,
  createPublicV7StateFromV6Root, loadPublicV7Root, parsePublicV7PlayableRoot,
  serializePublicV7World,
} from './publicWorldV7'
import type { PublicV7PlayableRoot } from './publicWorldV7'

const ARCHIVE_PREFIX = 'wizard-realms:world:v7:source-conflict-archive:'
const ARCHIVE_KEY = /^wizard-realms:world:v7:source-conflict-archive:[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/
const MAX_ARCHIVE_CHARS = 96 * 1024 * 1024

export type PublicV7RootConflictChoice = 'continue-v7' | 'use-v7-stage' | 'use-newer-v6'
export interface PublicV7RootConflictSnapshot {
  readonly v7RootBytes: string | null
  readonly v7StageBytes: string | null
  readonly v7BackupBytes: string | null
  readonly v6RootBytes: string | null
  readonly v6StageBytes: string | null
  readonly v6BackupBytes: string | null
}

type FailureStatus = 'invalid-expected-snapshot' | 'snapshot-changed' | 'not-source-conflict'
  | 'invalid-v7-root' | 'invalid-v6-root' | 'incompatible-lineage' | 'not-newer-v6'
  | 'pending-v7-stage' | 'invalid-v7-backup' | 'pending-v6-stage' | 'invalid-v6-backup'
  | 'invalid-choice' | 'invalid-result' | 'archive-too-large' | 'archive-key-invalid'
  | 'archive-key-present' | 'archive-key-unavailable' | 'archive-verification-failed'
  | 'stage-verification-failed' | 'backup-verification-failed'
  | 'root-verification-failed' | 'storage-error'
export type PublicV7RootConflictResult =
  | { status: 'resolved'; choice: PublicV7RootConflictChoice; root: PublicV7PlayableRoot;
    bytes: string; archiveKey: string }
  | { status: FailureStatus; archiveKey?: string }
export type PublicV7RootConflictEligibility =
  | { status: 'available'; choices: readonly PublicV7RootConflictChoice[] }
  | { status: FailureStatus }

const fields = ['v7RootBytes', 'v7StageBytes', 'v7BackupBytes',
  'v6RootBytes', 'v6StageBytes', 'v6BackupBytes'] as const

/** The caller holds PUBLIC_V7_LOCK_NAME across this read and the later choice. */
export function readPublicV7RootConflictSnapshot(storage: Pick<Storage, 'getItem'>):
  { status: 'available'; snapshot: PublicV7RootConflictSnapshot } | { status: 'storage-error' } {
  try {
    return { status: 'available', snapshot: {
      v7RootBytes: storage.getItem(PUBLIC_V7_ROOT_KEY),
      v7StageBytes: storage.getItem(PUBLIC_V7_STAGE_KEY),
      v7BackupBytes: storage.getItem(PUBLIC_V7_BACKUP_KEY),
      v6RootBytes: storage.getItem(PUBLIC_V6_ROOT_KEY),
      v6StageBytes: storage.getItem(PUBLIC_V6_STAGE_KEY),
      v6BackupBytes: storage.getItem(PUBLIC_V6_BACKUP_KEY),
    } }
  } catch { return { status: 'storage-error' } }
}

function validSnapshot(value: unknown): value is PublicV7RootConflictSnapshot {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.hasOwn(value, field)
      && ((value as Record<string, unknown>)[field] === null
        || typeof (value as Record<string, unknown>)[field] === 'string'))
}

function sameSnapshot(a: PublicV7RootConflictSnapshot, b: PublicV7RootConflictSnapshot): boolean {
  return fields.every((field) => a[field] === b[field])
}

function parseV6(bytes: string): PublicV6BootstrapRoot | PublicV6PlayableRoot | null {
  return parsePublicV6PlayableRoot(bytes) ?? parsePublicV6BootstrapRoot(bytes)
}

function sourceFacts(root: PublicV6BootstrapRoot | PublicV6PlayableRoot) {
  return root.schemaVersion === 'wizard-world/v6-bootstrap'
    ? { seed: root.seed, profile: root.source.profile, bootstrap: root }
    : { seed: root.state.seed, profile: root.state.generationProfile, bootstrap: root.bootstrap }
}

function eligibleStage(value: PublicV7RootConflictSnapshot, root: PublicV7PlayableRoot): PublicV7PlayableRoot | null {
  if (value.v7StageBytes === null || value.v7StageBytes === value.v7RootBytes) return null
  const stage = parsePublicV7PlayableRoot(value.v7StageBytes)
  return stage && stage.saveRevision > root.saveRevision
    && Number.isSafeInteger(stage.saveRevision + 1)
    && stage.state.seed === root.state.seed
    && stage.state.generationProfile === root.state.generationProfile
    && JSON.stringify(stage.bootstrap) === JSON.stringify(root.bootstrap)
    && (stage.migrationSourceV6Bytes === root.migrationSourceV6Bytes
      || stage.migrationSourceV6Bytes === value.v6RootBytes)
    ? stage : null
}

/** Pure inspection for UI choice visibility. It never reads or writes storage. */
export function inspectPublicV7RootConflictSnapshot(value: unknown): PublicV7RootConflictEligibility {
  if (!validSnapshot(value)) return { status: 'invalid-expected-snapshot' }
  const v7 = value.v7RootBytes === null ? null : parsePublicV7PlayableRoot(value.v7RootBytes)
  if (!v7) return { status: 'invalid-v7-root' }
  if (v7.migrationSourceV6Bytes === null || value.v6RootBytes === v7.migrationSourceV6Bytes) {
    return { status: 'not-source-conflict' }
  }
  const v6 = value.v6RootBytes === null ? null : parseV6(value.v6RootBytes)
  if (!v6) return { status: 'invalid-v6-root' }
  const oldV6 = parseV6(v7.migrationSourceV6Bytes)
  if (!oldV6) return { status: 'invalid-v7-root' }
  const oldFacts = sourceFacts(oldV6)
  const newFacts = sourceFacts(v6)
  if (oldFacts.seed !== newFacts.seed || oldFacts.profile !== newFacts.profile
    || newFacts.seed !== v7.state.seed || newFacts.profile !== v7.state.generationProfile
    || JSON.stringify(oldFacts.bootstrap) !== JSON.stringify(newFacts.bootstrap)
    || JSON.stringify(newFacts.bootstrap) !== JSON.stringify(v7.bootstrap)) {
    return { status: 'incompatible-lineage' }
  }
  if (oldV6.schemaVersion === 'wizard-world/v6'
    && (v6.schemaVersion !== 'wizard-world/v6' || v6.saveRevision <= oldV6.saveRevision)) {
    return { status: 'not-newer-v6' }
  }
  if (oldV6.schemaVersion === 'wizard-world/v6-bootstrap'
    && v6.schemaVersion !== 'wizard-world/v6') return { status: 'not-newer-v6' }
  const stage = eligibleStage(value, v7)
  if (!Number.isSafeInteger(Math.max(v7.saveRevision, stage?.saveRevision ?? 0) + 1)) {
    return { status: 'invalid-result' }
  }
  // Stage and backup may contain interrupted or invalid candidate bytes. They
  // are kept verbatim in the archive before any v7 candidate is replaced.
  return { status: 'available', choices: stage
    ? ['continue-v7', 'use-v7-stage', 'use-newer-v6']
    : ['continue-v7', 'use-newer-v6'] }
}

/**
 * Explicit divergent-root choice. No v6 key is ever written. A fresh v7 root has
 * no common v6 baseline and must be handled as a different fork conflict.
 */
export function resolvePublicV7RootConflict(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  choice: PublicV7RootConflictChoice,
  expected: PublicV7RootConflictSnapshot,
  options: { archiveKey?: string } = {},
): PublicV7RootConflictResult {
  if (!validSnapshot(expected)) return { status: 'invalid-expected-snapshot' }
  const initial = readPublicV7RootConflictSnapshot(storage)
  if (initial.status !== 'available') return initial
  if (!sameSnapshot(initial.snapshot, expected)) return { status: 'snapshot-changed' }
  const eligibility = inspectPublicV7RootConflictSnapshot(expected)
  if (eligibility.status !== 'available') return eligibility
  if (!eligibility.choices.includes(choice)) return { status: 'invalid-choice' }
  // The eligibility check proved these roots parse and are from one lineage.
  const v7 = parsePublicV7PlayableRoot(expected.v7RootBytes!)!
  const v6 = parseV6(expected.v6RootBytes!)!
  const pendingStage = eligibleStage(expected, v7)
  const next: PublicV7PlayableRoot = {
    schemaVersion: PUBLIC_V7_SCHEMA, saveRevision: Math.max(v7.saveRevision, pendingStage?.saveRevision ?? 0) + 1,
    bootstrap: v7.bootstrap, migrationSourceV6Bytes: expected.v6RootBytes!,
    state: choice === 'continue-v7' ? v7.state
      : choice === 'use-v7-stage' ? pendingStage!.state : createPublicV7StateFromV6Root(v6),
  }
  let bytes: string
  try { bytes = serializePublicV7World(next) } catch { return { status: 'invalid-result' } }
  const archive = JSON.stringify({ schemaVersion: 'wizard-world/v7-source-conflict-archive',
    choice, ...expected })
  if (archive.length > MAX_ARCHIVE_CHARS) return { status: 'archive-too-large' }
  let archiveKey = options.archiveKey
  if (archiveKey !== undefined && !ARCHIVE_KEY.test(archiveKey)) return { status: 'archive-key-invalid' }
  try {
    if (archiveKey === undefined) {
      if (typeof globalThis.crypto?.randomUUID !== 'function') return { status: 'archive-key-unavailable' }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const candidate = `${ARCHIVE_PREFIX}${globalThis.crypto.randomUUID()}`
        if (storage.getItem(candidate) === null) { archiveKey = candidate; break }
      }
      if (archiveKey === undefined) return { status: 'archive-key-unavailable' }
    } else if (storage.getItem(archiveKey) !== null) return { status: 'archive-key-present' }
    storage.setItem(archiveKey, archive)
    if (storage.getItem(archiveKey) !== archive) return { status: 'archive-verification-failed' }
  } catch { return { status: 'storage-error' } }

  // The lock should prevent a second writer. These exact rereads also catch a
  // broken lock provider or a storage implementation that mutates during writes.
  let last: PublicV7RootConflictSnapshot = expected
  const unchanged = (): FailureStatus | null => {
    const read = readPublicV7RootConflictSnapshot(storage)
    if (read.status !== 'available') return 'storage-error'
    return sameSnapshot(read.snapshot, last) ? null : 'snapshot-changed'
  }
  const publish = (key: string, value: string, field: 'v7StageBytes' | 'v7BackupBytes' | 'v7RootBytes',
    verificationStatus: FailureStatus): FailureStatus | null => {
    const changed = unchanged()
    if (changed) return changed
    try {
      storage.setItem(key, value)
      if (storage.getItem(key) !== value) return verificationStatus
    } catch { return 'storage-error' }
    last = { ...last, [field]: value }
    return unchanged()
  }
  // Leave the original settled stage intact until the new root is published.
  // A failed backup or root write then leaves the original conflict retryable.
  const backup = publish(PUBLIC_V7_BACKUP_KEY, expected.v7RootBytes!, 'v7BackupBytes', 'backup-verification-failed')
  if (backup) return { status: backup, archiveKey }
  const root = publish(PUBLIC_V7_ROOT_KEY, bytes, 'v7RootBytes', 'root-verification-failed')
  if (root) return { status: root, archiveKey }
  // If this last write fails, the new valid root and old stage are both preserved.
  // Existing explicit v7 recovery can select root and settle its pending stage.
  const stage = publish(PUBLIC_V7_STAGE_KEY, bytes, 'v7StageBytes', 'stage-verification-failed')
  if (stage) return { status: stage, archiveKey }
  const loaded = loadPublicV7Root(storage)
  return loaded.status === 'valid-playable' && loaded.bytes === bytes
    ? { status: 'resolved', choice, root: loaded.root, bytes, archiveKey }
    : { status: 'root-verification-failed', archiveKey }
}
