import {
  PUBLIC_V7_BACKUP_KEY, PUBLIC_V7_ROOT_KEY, PUBLIC_V7_STAGE_KEY,
  loadPublicV7Root, parsePublicV7PlayableRoot,
} from './publicWorldV7'
import { loadPublicV6Root } from './publicWorldV6'
import type { PublicV7PlayableRoot } from './publicWorldV7'

const PUBLIC_V7_ARCHIVE_PREFIX = 'wizard-realms:world:v7:archive:'
const MAX_RECOVERY_ARCHIVE_CHARS = 32 * 1024 * 1024
const ARCHIVE_KEY_PATTERN = /^wizard-realms:world:v7:archive:[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/

export interface PublicV7RecoverySnapshot {
  readonly rootBytes: string | null
  readonly stageBytes: string | null
  readonly backupBytes: string | null
}

export type PublicV7RecoveryResult =
  | { status: 'recovered'; root: PublicV7PlayableRoot; bytes: string; archiveKey: string }
  | { status: 'invalid-expected-snapshot' | 'snapshot-changed' | 'invalid-source'
    | 'source-changed'
    | 'archive-key-invalid' | 'archive-key-present' | 'archive-key-unavailable'
    | 'archive-too-large' | 'archive-verification-failed' | 'backup-verification-failed'
    | 'stage-verification-failed' | 'root-verification-failed' | 'storage-error' }

/** Reads every original byte string without selecting or modifying a candidate. */
export function readPublicV7RecoverySnapshot(storage: Pick<Storage, 'getItem'>):
  { status: 'available'; snapshot: PublicV7RecoverySnapshot } | { status: 'storage-error' } {
  try {
    return { status: 'available', snapshot: {
      rootBytes: storage.getItem(PUBLIC_V7_ROOT_KEY),
      stageBytes: storage.getItem(PUBLIC_V7_STAGE_KEY),
      backupBytes: storage.getItem(PUBLIC_V7_BACKUP_KEY),
    } }
  } catch { return { status: 'storage-error' } }
}

function validRecoverySnapshot(value: unknown): value is PublicV7RecoverySnapshot {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === 3
    && ['rootBytes', 'stageBytes', 'backupBytes'].every((key) => Object.hasOwn(value, key))
    && [(value as Record<string, unknown>).rootBytes,
      (value as Record<string, unknown>).stageBytes,
      (value as Record<string, unknown>).backupBytes]
      .every((bytes) => bytes === null || typeof bytes === 'string')
}

function sameRecoverySnapshot(a: PublicV7RecoverySnapshot, b: PublicV7RecoverySnapshot): boolean {
  return a.rootBytes === b.rootBytes && a.stageBytes === b.stageBytes && a.backupBytes === b.backupBytes
}

function unchangedMigrationSource(storage: Pick<Storage, 'getItem'>,
  root: PublicV7PlayableRoot): 'same' | 'source-changed' | 'storage-error' {
  const source = loadPublicV6Root(storage)
  if (source.status === 'storage-error') return 'storage-error'
  if (root.migrationSourceV6Bytes === null) {
    return source.status === 'missing' ? 'same' : 'source-changed'
  }
  return 'bytes' in source && source.bytes === root.migrationSourceV6Bytes ? 'same' : 'source-changed'
}

/**
 * Explicit recovery only. The caller holds PUBLIC_V7_LOCK_NAME around the snapshot
 * read and this whole operation. Archive readback precedes every candidate write.
 * A failed partial write leaves the archive and original candidates for review.
 */
export function recoverPublicV7Root(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  source: 'root' | 'stage' | 'backup',
  expected: PublicV7RecoverySnapshot,
  options: { archiveKey?: string } = {},
): PublicV7RecoveryResult {
  if (!validRecoverySnapshot(expected)) return { status: 'invalid-expected-snapshot' }
  const before = readPublicV7RecoverySnapshot(storage)
  if (before.status === 'storage-error') return before
  if (!sameRecoverySnapshot(before.snapshot, expected)) return { status: 'snapshot-changed' }
  const selected = source === 'root' ? expected.rootBytes
    : source === 'stage' ? expected.stageBytes
      : source === 'backup' ? expected.backupBytes : null
  const parsed = selected === null ? null : parsePublicV7PlayableRoot(selected)
  if (!parsed || selected === null) return { status: 'invalid-source' }
  const initialSource = unchangedMigrationSource(storage, parsed)
  if (initialSource !== 'same') return { status: initialSource }

  const rawLength = (expected.rootBytes?.length ?? 0) + (expected.stageBytes?.length ?? 0)
    + (expected.backupBytes?.length ?? 0)
  if (rawLength > MAX_RECOVERY_ARCHIVE_CHARS) return { status: 'archive-too-large' }
  const archive = JSON.stringify({ schemaVersion: 'wizard-world/v7-recovery-archive',
    selectedSource: source, ...expected })
  if (archive.length > MAX_RECOVERY_ARCHIVE_CHARS) return { status: 'archive-too-large' }
  let archiveKey = options.archiveKey
  if (archiveKey !== undefined && !ARCHIVE_KEY_PATTERN.test(archiveKey)) {
    return { status: 'archive-key-invalid' }
  }
  try {
    if (archiveKey === undefined) {
      if (typeof globalThis.crypto?.randomUUID !== 'function') return { status: 'archive-key-unavailable' }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const candidate = `${PUBLIC_V7_ARCHIVE_PREFIX}${globalThis.crypto.randomUUID()}`
        if (storage.getItem(candidate) === null) { archiveKey = candidate; break }
      }
      if (archiveKey === undefined) return { status: 'archive-key-unavailable' }
    } else if (storage.getItem(archiveKey) !== null) return { status: 'archive-key-present' }
    storage.setItem(archiveKey, archive)
    if (storage.getItem(archiveKey) !== archive) return { status: 'archive-verification-failed' }
  } catch { return { status: 'storage-error' } }

  const afterArchive = readPublicV7RecoverySnapshot(storage)
  if (afterArchive.status === 'storage-error') return afterArchive
  if (!sameRecoverySnapshot(afterArchive.snapshot, expected)) return { status: 'snapshot-changed' }
  const afterArchiveSource = unchangedMigrationSource(storage, parsed)
  if (afterArchiveSource !== 'same') return { status: afterArchiveSource }
  const repairBackup = expected.backupBytes !== null && !parsePublicV7PlayableRoot(expected.backupBytes)
  const settledBackupBytes = repairBackup ? selected : expected.backupBytes
  try {
    if (repairBackup) {
      storage.setItem(PUBLIC_V7_BACKUP_KEY, selected)
      if (storage.getItem(PUBLIC_V7_BACKUP_KEY) !== selected) return { status: 'backup-verification-failed' }
    }
    const afterBackup = readPublicV7RecoverySnapshot(storage)
    if (afterBackup.status === 'storage-error') return afterBackup
    if (!sameRecoverySnapshot(afterBackup.snapshot, { ...expected, backupBytes: settledBackupBytes })) {
      return { status: 'snapshot-changed' }
    }
    const afterBackupSource = unchangedMigrationSource(storage, parsed)
    if (afterBackupSource !== 'same') return { status: afterBackupSource }
    storage.setItem(PUBLIC_V7_STAGE_KEY, selected)
    if (storage.getItem(PUBLIC_V7_STAGE_KEY) !== selected) return { status: 'stage-verification-failed' }
    const beforePublish = readPublicV7RecoverySnapshot(storage)
    if (beforePublish.status === 'storage-error') return beforePublish
    if (beforePublish.snapshot.rootBytes !== expected.rootBytes
      || beforePublish.snapshot.stageBytes !== selected
      || beforePublish.snapshot.backupBytes !== settledBackupBytes) return { status: 'snapshot-changed' }
    const beforePublishSource = unchangedMigrationSource(storage, parsed)
    if (beforePublishSource !== 'same') return { status: beforePublishSource }
    if (source !== 'root') {
      storage.setItem(PUBLIC_V7_ROOT_KEY, selected)
      if (storage.getItem(PUBLIC_V7_ROOT_KEY) !== selected) return { status: 'root-verification-failed' }
    }
  } catch { return { status: 'storage-error' } }
  const published = loadPublicV7Root(storage)
  if (published.status === 'source-changed') return { status: 'source-changed' }
  if (published.status === 'storage-error') return { status: 'storage-error' }
  return published.status === 'valid-playable' && published.bytes === selected
    ? { status: 'recovered', root: published.root, bytes: selected, archiveKey }
    : { status: 'root-verification-failed' }
}
