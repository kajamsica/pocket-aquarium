import { parsePublicV6BootstrapRoot, parsePublicV6PlayableRoot } from './publicWorldV6'
import {
  PUBLIC_V7_BACKUP_KEY, PUBLIC_V7_ROOT_KEY, PUBLIC_V7_SCHEMA, PUBLIC_V7_STAGE_KEY,
  createPublicV7StateFromV6Root, loadPublicV7Root, parsePublicV7PlayableRoot,
  serializePublicV7World,
} from './publicWorldV7'
import type { PublicV7PlayableRoot } from './publicWorldV7'
import { readPublicV7RootConflictSnapshot } from './publicWorldV7RootConflict'
import type { PublicV7RootConflictSnapshot } from './publicWorldV7RootConflict'

export type PublicV7FreshForkSnapshot = PublicV7RootConflictSnapshot
export const readPublicV7FreshForkSnapshot = readPublicV7RootConflictSnapshot
export type PublicV7FreshForkChoice = 'continue-v7' | 'use-v7-stage' | 'use-v6'

type Failure = 'invalid-expected-snapshot' | 'snapshot-changed' | 'invalid-v7-root'
  | 'invalid-v7-stage' | 'not-fresh-v7' | 'not-initial-fresh-stage'
  | 'invalid-v6-root' | 'invalid-result' | 'invalid-choice'
  | 'archive-too-large' | 'archive-key-invalid' | 'archive-key-present'
  | 'archive-key-unavailable' | 'archive-verification-failed'
  | 'incompatible-lineage' | 'stage-verification-failed'
  | 'backup-verification-failed' | 'root-verification-failed' | 'storage-error'

export type PublicV7FreshForkEligibility =
  | { status: 'available'; choices: readonly PublicV7FreshForkChoice[] }
  | { status: Failure }
export type PublicV7FreshForkResult =
  | { status: 'resolved'; choice: PublicV7FreshForkChoice; root: PublicV7PlayableRoot;
    bytes: string; archiveKey: string; warning: 'old-v6-tabs-may-advance-source' }
  | { status: Failure; archiveKey?: string }

const fields = ['v7RootBytes', 'v7StageBytes', 'v7BackupBytes',
  'v6RootBytes', 'v6StageBytes', 'v6BackupBytes'] as const
const ARCHIVE_PREFIX = 'wizard-realms:world:v7:fresh-fork-archive:'
const ARCHIVE_KEY = /^wizard-realms:world:v7:fresh-fork-archive:[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/
const MAX_ARCHIVE_CHARS = 96 * 1024 * 1024

function validSnapshot(value: unknown): value is PublicV7FreshForkSnapshot {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.hasOwn(value, field)
      && ((value as Record<string, unknown>)[field] === null
        || typeof (value as Record<string, unknown>)[field] === 'string'))
}

function sameSnapshot(a: PublicV7FreshForkSnapshot, b: PublicV7FreshForkSnapshot): boolean {
  return fields.every((field) => a[field] === b[field])
}

function eligibleStage(value: PublicV7FreshForkSnapshot,
  root: PublicV7PlayableRoot): PublicV7PlayableRoot | null {
  if (value.v7StageBytes === null || value.v7StageBytes === value.v7RootBytes) return null
  const stage = parsePublicV7PlayableRoot(value.v7StageBytes)
  return stage && stage.migrationSourceV6Bytes === null && stage.bootstrap === null
    && stage.saveRevision > root.saveRevision
    && stage.state.seed === root.state.seed
    && stage.state.generationProfile === root.state.generationProfile
    ? stage : null
}

/** Pure preflight for the two independent valid roots. It never reads storage. */
export function inspectPublicV7FreshForkSnapshot(value: unknown): PublicV7FreshForkEligibility {
  if (!validSnapshot(value)) return { status: 'invalid-expected-snapshot' }
  const stageOnly = value.v7RootBytes === null
  const v7 = stageOnly
    ? value.v7StageBytes === null ? null : parsePublicV7PlayableRoot(value.v7StageBytes)
    : parsePublicV7PlayableRoot(value.v7RootBytes!)
  if (!v7) return { status: stageOnly ? 'invalid-v7-stage' : 'invalid-v7-root' }
  if (v7.migrationSourceV6Bytes !== null || v7.bootstrap !== null) return { status: 'not-fresh-v7' }
  if (stageOnly && v7.saveRevision !== 0) return { status: 'not-initial-fresh-stage' }
  const v6 = value.v6RootBytes === null ? null
    : parsePublicV6PlayableRoot(value.v6RootBytes) ?? parsePublicV6BootstrapRoot(value.v6RootBytes)
  if (!v6) return { status: 'invalid-v6-root' }
  const stage = stageOnly ? v7 : eligibleStage(value, v7)
  if (!Number.isSafeInteger(Math.max(v7.saveRevision, stage?.saveRevision ?? 0) + 1)) {
    return { status: 'invalid-result' }
  }
  const compatible = v6.schemaVersion === 'wizard-world/v6' && v6.bootstrap === null
    && v6.state.seed === v7.state.seed
    && v6.state.generationProfile === v7.state.generationProfile
  // Interrupted or invalid candidates stay byte-for-byte in the archive. Only
  // a valid later fresh stage becomes a selectable third branch.
  return { status: 'available', choices: stageOnly
    ? compatible ? ['use-v7-stage', 'use-v6'] : ['use-v6'] : compatible
    ? stage ? ['continue-v7', 'use-v7-stage', 'use-v6'] : ['continue-v7', 'use-v6']
    : ['use-v6'] }
}

/** Explicit choice only. Caller holds PUBLIC_V7_LOCK_NAME across read and resolution. */
export function resolvePublicV7FreshFork(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  choice: PublicV7FreshForkChoice,
  expected: PublicV7FreshForkSnapshot,
  options: { archiveKey?: string } = {},
): PublicV7FreshForkResult {
  if (!validSnapshot(expected)) return { status: 'invalid-expected-snapshot' }
  const before = readPublicV7FreshForkSnapshot(storage)
  if (before.status !== 'available') return before
  if (!sameSnapshot(before.snapshot, expected)) return { status: 'snapshot-changed' }
  if (choice !== 'continue-v7' && choice !== 'use-v7-stage' && choice !== 'use-v6') {
    return { status: 'invalid-choice' }
  }
  const eligibility = inspectPublicV7FreshForkSnapshot(expected)
  if (eligibility.status !== 'available') return eligibility
  if (!eligibility.choices.includes(choice)) {
    return { status: choice === 'continue-v7' && expected.v7RootBytes !== null
      ? 'incompatible-lineage' : 'invalid-choice' }
  }
  const oldRoot = expected.v7RootBytes === null ? null : parsePublicV7PlayableRoot(expected.v7RootBytes)!
  const pendingStage = oldRoot ? eligibleStage(expected, oldRoot)
    : parsePublicV7PlayableRoot(expected.v7StageBytes!)!
  const v6 = parsePublicV6PlayableRoot(expected.v6RootBytes!)
    ?? parsePublicV6BootstrapRoot(expected.v6RootBytes!)!
  let nextBytes: string
  try {
    const next: PublicV7PlayableRoot = {
      schemaVersion: PUBLIC_V7_SCHEMA,
      saveRevision: Math.max(oldRoot?.saveRevision ?? 0, pendingStage?.saveRevision ?? 0) + 1,
      bootstrap: choice === 'use-v6'
        ? v6.schemaVersion === 'wizard-world/v6-bootstrap' ? v6 : v6.bootstrap
        : (oldRoot ?? pendingStage)!.bootstrap,
      migrationSourceV6Bytes: expected.v6RootBytes!,
      state: choice === 'continue-v7' ? oldRoot!.state
        : choice === 'use-v7-stage' ? pendingStage!.state : createPublicV7StateFromV6Root(v6),
    }
    nextBytes = serializePublicV7World(next)
  } catch { return { status: 'invalid-result' } }

  const archive = JSON.stringify({ schemaVersion: 'wizard-world/v7-fresh-fork-archive',
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

  let last = expected
  const reread = (): Failure | null => {
    const current = readPublicV7FreshForkSnapshot(storage)
    if (current.status !== 'available') return 'storage-error'
    return sameSnapshot(current.snapshot, last) ? null : 'snapshot-changed'
  }
  const publish = (key: string, value: string, field: keyof PublicV7FreshForkSnapshot,
    failure: Failure): Failure | null => {
    const changed = reread()
    if (changed) return changed
    try {
      storage.setItem(key, value)
      if (storage.getItem(key) !== value) return failure
    } catch { return 'storage-error' }
    last = { ...last, [field]: value }
    return reread()
  }
  const changed = reread()
  if (changed) return { status: changed, archiveKey }
  const backup = publish(PUBLIC_V7_BACKUP_KEY, expected.v7RootBytes ?? expected.v7StageBytes!,
    'v7BackupBytes', 'backup-verification-failed')
  if (backup) return { status: backup, archiveKey }
  const root = publish(PUBLIC_V7_ROOT_KEY, nextBytes, 'v7RootBytes', 'root-verification-failed')
  if (root) return { status: root, archiveKey }
  // A stage-first write would strand this explicit fork choice after backup/root
  // failure. Settle the old stage only after the new root is published. If this
  // final write fails, the existing explicit v7 root recovery can settle it.
  const stage = publish(PUBLIC_V7_STAGE_KEY, nextBytes, 'v7StageBytes', 'stage-verification-failed')
  if (stage) return { status: stage, archiveKey }
  const loaded = loadPublicV7Root(storage)
  return loaded.status === 'valid-playable' && loaded.bytes === nextBytes
    ? { status: 'resolved', choice, root: loaded.root, bytes: loaded.bytes,
      archiveKey, warning: 'old-v6-tabs-may-advance-source' }
    : { status: 'root-verification-failed', archiveKey }
}
