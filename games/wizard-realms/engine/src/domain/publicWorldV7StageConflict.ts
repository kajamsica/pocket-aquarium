import {
  PUBLIC_V6_BACKUP_KEY, PUBLIC_V6_ROOT_KEY, PUBLIC_V6_STAGE_KEY,
  parsePublicV6BootstrapRoot, parsePublicV6PlayableRoot,
} from './publicWorldV6'
import {
  PUBLIC_V7_BACKUP_KEY, PUBLIC_V7_ROOT_KEY, PUBLIC_V7_STAGE_KEY,
  parsePublicV7PlayableRoot,
} from './publicWorldV7'

const ARCHIVE_PREFIX = 'wizard-realms:world:v7:stage-conflict-archive:'
const ARCHIVE_KEY_PATTERN = /^wizard-realms:world:v7:stage-conflict-archive:[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/
const MAX_ARCHIVE_CHARS = 32 * 1024 * 1024

export interface PublicV7StageConflictSnapshot {
  readonly v7RootBytes: string | null
  readonly v7StageBytes: string | null
  readonly v7BackupBytes: string | null
  readonly v6RootBytes: string | null
  readonly v6StageBytes: string | null
  readonly v6BackupBytes: string | null
}

export type PublicV7StageConflictEligibility =
  | { status: 'eligible' }
  | { status: 'invalid-expected-snapshot' | 'root-present' | 'stage-missing'
    | 'invalid-stage' | 'invalid-backup' | 'invalid-v6-root' | 'source-not-changed' }

export type PublicV7StageConflictResult =
  | { status: 'resolved'; archiveKey: string }
  | Exclude<PublicV7StageConflictEligibility, { status: 'eligible' }>
  | { status: 'snapshot-changed' | 'archive-key-invalid' | 'archive-key-present'
    | 'archive-key-unavailable' | 'archive-too-large' | 'archive-verification-failed'
    | 'remove-verification-failed' | 'storage-error' }

const fields = ['v7RootBytes', 'v7StageBytes', 'v7BackupBytes',
  'v6RootBytes', 'v6StageBytes', 'v6BackupBytes'] as const

function validSnapshot(value: unknown): value is PublicV7StageConflictSnapshot {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.hasOwn(value, field)
      && ((value as Record<string, unknown>)[field] === null
        || typeof (value as Record<string, unknown>)[field] === 'string'))
}

function sameSnapshot(a: PublicV7StageConflictSnapshot, b: PublicV7StageConflictSnapshot): boolean {
  return fields.every((field) => a[field] === b[field])
}

/** Read under PUBLIC_V7_LOCK_NAME. This does not repair or discard any save bytes. */
export function readPublicV7StageConflictSnapshot(storage: Pick<Storage, 'getItem'>):
  { status: 'available'; snapshot: PublicV7StageConflictSnapshot } | { status: 'storage-error' } {
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

/** Pure UI preflight. It neither reads nor changes storage. */
export function inspectPublicV7StaleStageConflict(value: unknown): PublicV7StageConflictEligibility {
  if (!validSnapshot(value)) return { status: 'invalid-expected-snapshot' }
  if (value.v7RootBytes !== null) return { status: 'root-present' }
  if (value.v7StageBytes === null) return { status: 'stage-missing' }
  const stage = parsePublicV7PlayableRoot(value.v7StageBytes)
  if (!stage || stage.migrationSourceV6Bytes === null) return { status: 'invalid-stage' }
  const backup = value.v7BackupBytes === null ? null : parsePublicV7PlayableRoot(value.v7BackupBytes)
  if (value.v7BackupBytes !== null && !backup) return { status: 'invalid-backup' }
  if (value.v6RootBytes === null || !(parsePublicV6PlayableRoot(value.v6RootBytes)
    || parsePublicV6BootstrapRoot(value.v6RootBytes))) return { status: 'invalid-v6-root' }
  return stage.migrationSourceV6Bytes === value.v6RootBytes
    || (backup !== null && (backup.migrationSourceV6Bytes === null
      || backup.migrationSourceV6Bytes === value.v6RootBytes))
    ? { status: 'source-not-changed' } : { status: 'eligible' }
}

/** Explicit conflict resolution only. Caller holds PUBLIC_V7_LOCK_NAME for read and resolve. */
export function resolvePublicV7StaleStage(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  expected: PublicV7StageConflictSnapshot,
  options: { archiveKey?: string } = {},
): PublicV7StageConflictResult {
  const eligibility = inspectPublicV7StaleStageConflict(expected)
  if (eligibility.status === 'invalid-expected-snapshot') return eligibility
  const before = readPublicV7StageConflictSnapshot(storage)
  if (before.status === 'storage-error') return before
  if (!sameSnapshot(before.snapshot, expected)) return { status: 'snapshot-changed' }
  if (eligibility.status !== 'eligible') return eligibility

  const rawLength = fields.reduce((size, field) => size + (expected[field]?.length ?? 0), 0)
  if (rawLength > MAX_ARCHIVE_CHARS) return { status: 'archive-too-large' }
  const archive = JSON.stringify({ schemaVersion: 'wizard-world/v7-stage-conflict-archive', ...expected })
  if (archive.length > MAX_ARCHIVE_CHARS) return { status: 'archive-too-large' }
  let archiveKey = options.archiveKey
  if (archiveKey !== undefined && !ARCHIVE_KEY_PATTERN.test(archiveKey)) {
    return { status: 'archive-key-invalid' }
  }
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

  const afterArchive = readPublicV7StageConflictSnapshot(storage)
  if (afterArchive.status === 'storage-error') return afterArchive
  if (!sameSnapshot(afterArchive.snapshot, expected)) return { status: 'snapshot-changed' }
  try {
    // Backup goes first so a failed second removal leaves the pending stage retryable.
    if (expected.v7BackupBytes !== null) {
      storage.removeItem(PUBLIC_V7_BACKUP_KEY)
      const afterBackup = readPublicV7StageConflictSnapshot(storage)
      if (afterBackup.status === 'storage-error') return afterBackup
      if (!sameSnapshot(afterBackup.snapshot, { ...expected, v7BackupBytes: null })) {
        return { status: 'remove-verification-failed' }
      }
    }
    const beforeStage = readPublicV7StageConflictSnapshot(storage)
    if (beforeStage.status === 'storage-error') return beforeStage
    if (!sameSnapshot(beforeStage.snapshot, { ...expected, v7BackupBytes: null })) {
      return { status: 'snapshot-changed' }
    }
    storage.removeItem(PUBLIC_V7_STAGE_KEY)
    const afterStage = readPublicV7StageConflictSnapshot(storage)
    if (afterStage.status === 'storage-error') return afterStage
    return sameSnapshot(afterStage.snapshot, { ...expected, v7StageBytes: null, v7BackupBytes: null })
      ? { status: 'resolved', archiveKey }
      : { status: 'remove-verification-failed' }
  } catch { return { status: 'storage-error' } }
}
