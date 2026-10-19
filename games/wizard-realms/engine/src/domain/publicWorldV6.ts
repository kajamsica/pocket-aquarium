import { terrainHeightAt, WORLD_CONTENT_REVISION } from './generation'
import { mireglassApproachTrail, mireglassGreenwayToMarkerTrail } from './mireglassApproachTrail'
import { MIREGLASS_CONTENT_REVISION, mireglassAnchors, mireglassResources } from './mireglassContent'
import { isValidMireglassV6Player } from './mireglassExpedition'
import { mireglassRouteSites } from './mireglassRouteSites'
import { hasValidRoutePlacements, isRestorableWizardSave, restoreWizardWorld, serializeWizardWorld } from './persistence'
import { isValidPublicWorldState, legacyMovementEnvelope } from './publicWorldPersistence'
import type { PublicWorldState } from './publicWorldState'
import type { GenerationProfile, WizardWorldState } from './types'
import { worldTileAtGrid } from './worldChunks'

export const PUBLIC_V6_ROOT_KEY = 'wizard-realms:world:v6:root'
export const PUBLIC_V6_STAGE_KEY = 'wizard-realms:world:v6:stage'
export const PUBLIC_V6_BACKUP_KEY = 'wizard-realms:world:v6:backup'
export const PUBLIC_V6_BOOTSTRAP_SCHEMA = 'wizard-world/v6-bootstrap'
export const PUBLIC_V6_SCHEMA = 'wizard-world/v6'
export { legacyMovementEnvelope } from './publicWorldPersistence'

const LEGACY_KEYS: Record<GenerationProfile, readonly string[]> = {
  'greenway-classic-v1': [
    'wizard-realms:world:v5', 'wizard-realms:world:v4', 'wizard-realms:world:v3',
    'wizard-realms:world:v2', 'wizard-realms:world:v1',
  ],
  'greenway-expanded-v1': [
    'wizard-realms:world:expanded:v4', 'wizard-realms:world:expanded:v3',
    'wizard-realms:world:expanded:v2', 'wizard-realms:world:expanded:v1',
  ],
}

export interface LegacyImportSource {
  readonly profile: GenerationProfile
  readonly key: string
  readonly bytes: string
}

/** An import receipt, not a playable streamed-world save. Greenway remains complete v5 state. */
export interface PublicV6BootstrapRoot {
  readonly schemaVersion: typeof PUBLIC_V6_BOOTSTRAP_SCHEMA
  readonly greenwayContentRevision: typeof WORLD_CONTENT_REVISION
  readonly mireglassContentRevision: typeof MIREGLASS_CONTENT_REVISION
  readonly seed: string
  readonly source: LegacyImportSource
  readonly greenwaySaveBytes: string
}

export interface PublicV6PlayableRoot {
  readonly schemaVersion: typeof PUBLIC_V6_SCHEMA
  readonly saveRevision: number
  /** Exact imported source bytes remain inside this immutable lineage receipt. */
  readonly bootstrap: PublicV6BootstrapRoot | null
  readonly state: PublicWorldState
}

export type LegacyImportInspection =
  | { status: 'missing' | 'storage-error' }
  | { status: 'invalid'; key: string }
  | { status: 'incompatible'; key: string; reason: 'terrain' | 'position' | 'player' | 'mireglass-content' | 'streamed-resume' }
  | { status: 'available'; source: LegacyImportSource; greenwaySaveBytes: string }

export type PublicV6RootLoad =
  | { status: 'missing' | 'invalid' | 'storage-error' }
  | { status: 'valid-bootstrap'; root: PublicV6BootstrapRoot; bytes: string }
  | { status: 'valid-playable'; root: PublicV6PlayableRoot; bytes: string }

export type PublicV6ImportResult =
  | { status: 'committed'; root: PublicV6BootstrapRoot }
  | { status: 'root-present' | 'invalid-root' | 'pending-stage' | 'source-changed' | 'storage-error'
    | 'stage-verification-failed' | 'root-verification-failed' }

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const profileId = (value: unknown): value is GenerationProfile =>
  value === 'greenway-classic-v1' || value === 'greenway-expanded-v1'
export type PublicWorldCompatibilityIssue = Extract<LegacyImportInspection, { status: 'incompatible' }>['reason']

/** A v5 restore may be valid while containing mutable terrain that a streamed cell cannot represent. */
export function publicWorldCompatibility(world: WizardWorldState): PublicWorldCompatibilityIssue | null {
  if (!hasValidRoutePlacements(world) || !isValidMireglassV6Player(world.player)) return 'player'
  for (const tile of world.tiles) {
    const canonical = worldTileAtGrid(world.seed, tile.gridX - 3, tile.gridZ - 3)
    if (tile.id !== canonical.id || tile.center.x !== canonical.center.x
      || tile.center.y !== canonical.center.y || tile.center.z !== canonical.center.z
      || tile.elevation !== canonical.elevation || tile.temperature !== canonical.temperature
      || tile.moisture !== canonical.moisture || tile.terrain !== canonical.terrain
      || tile.biome !== canonical.biome) return 'terrain'
  }
  const { x, y, z } = world.player.position
  const bounds = legacyMovementEnvelope(world)
  // The imported pose is Greenway-owned. Streamed half-cell terrain can differ at the
  // edge and must not replace the saved height or require a second discovered tile.
  if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ
    || y < terrainHeightAt(world.tiles, x, z)) return 'position'
  try {
    mireglassAnchors(world.seed)
    mireglassResources(world.seed)
    mireglassRouteSites(world.seed)
    mireglassApproachTrail(world.seed)
    mireglassGreenwayToMarkerTrail(world.seed)
  }
  catch { return 'mireglass-content' }
  return null
}

/** The first present key wins, even when its bytes are invalid. This function never writes storage. */
export function inspectLegacyImportSource(
  storage: Pick<Storage, 'getItem'>, profile: GenerationProfile,
): LegacyImportInspection {
  for (const key of LEGACY_KEYS[profile]) {
    let bytes: string | null
    try { bytes = storage.getItem(key) } catch { return { status: 'storage-error' } }
    if (bytes === null) continue
    if (bytes.length > 16 * 1024 * 1024) return { status: 'invalid', key }
    if (!isRestorableWizardSave(bytes, profile)) return { status: 'invalid', key }
    let world: WizardWorldState
    try { world = restoreWizardWorld(bytes) } catch { return { status: 'invalid', key } }
    const issue = publicWorldCompatibility(world)
    if (issue) return { status: 'incompatible', key, reason: issue }
    return { status: 'available', source: { profile, key, bytes },
      greenwaySaveBytes: serializeWizardWorld(world) }
  }
  return { status: 'missing' }
}

/** A valid result is still bootstrap-only. The current Mireglass runtime cannot consume this DTO. */
export function parsePublicV6BootstrapRoot(bytes: string): PublicV6BootstrapRoot | null {
  if (bytes.length > 32 * 1024 * 1024) return null
  let value: unknown
  try { value = JSON.parse(bytes) } catch { return null }
  if (!exact(value, ['schemaVersion', 'greenwayContentRevision', 'mireglassContentRevision',
    'seed', 'source', 'greenwaySaveBytes'])
    || value.schemaVersion !== PUBLIC_V6_BOOTSTRAP_SCHEMA
    || value.greenwayContentRevision !== WORLD_CONTENT_REVISION
    || value.mireglassContentRevision !== MIREGLASS_CONTENT_REVISION
    || typeof value.seed !== 'string' || !value.seed
    || typeof value.greenwaySaveBytes !== 'string'
    || !exact(value.source, ['profile', 'key', 'bytes'])
    || !profileId(value.source.profile) || typeof value.source.key !== 'string'
    || !LEGACY_KEYS[value.source.profile].includes(value.source.key)
    || typeof value.source.bytes !== 'string'
    || !isRestorableWizardSave(value.source.bytes, value.source.profile)
    || !isRestorableWizardSave(value.greenwaySaveBytes, value.source.profile)) return null
  try {
    const original = restoreWizardWorld(value.source.bytes)
    const normalized = JSON.parse(value.greenwaySaveBytes) as Record<string, unknown>
    if (original.seed !== value.seed || normalized.schemaVersion !== 'wizard-world/v5'
      || serializeWizardWorld(original) !== value.greenwaySaveBytes
      || publicWorldCompatibility(original) !== null) return null
  } catch { return null }
  return value as unknown as PublicV6BootstrapRoot
}

/** Rejects forged player, region, detached Greenway, and owner-specific movement state. */
export function parsePublicV6PlayableRoot(bytes: string): PublicV6PlayableRoot | null {
  if (typeof bytes !== 'string' || bytes.length > 32 * 1024 * 1024) return null
  let value: unknown
  try { value = JSON.parse(bytes) } catch { return null }
  if (!exact(value, ['schemaVersion', 'saveRevision', 'bootstrap', 'state'])
    || value.schemaVersion !== PUBLIC_V6_SCHEMA
    || !Number.isSafeInteger(value.saveRevision) || (value.saveRevision as number) < 0) return null
  const bootstrap = value.bootstrap === null ? null
    : parsePublicV6BootstrapRoot(JSON.stringify(value.bootstrap))
  if (value.bootstrap !== null && !bootstrap) return null
  if (!isValidPublicWorldState(value.state, bootstrap)) return null
  return value as unknown as PublicV6PlayableRoot
}

export function serializePublicV6World(root: PublicV6PlayableRoot): string {
  const bytes = JSON.stringify(root)
  if (!parsePublicV6PlayableRoot(bytes)) throw new RangeError('Invalid public v6 world state.')
  return bytes
}

export function loadPublicV6Root(storage: Pick<Storage, 'getItem'>): PublicV6RootLoad {
  let bytes: string | null
  try { bytes = storage.getItem(PUBLIC_V6_ROOT_KEY) } catch { return { status: 'storage-error' } }
  if (bytes === null) return { status: 'missing' }
  const bootstrap = parsePublicV6BootstrapRoot(bytes)
  if (bootstrap) return { status: 'valid-bootstrap', root: bootstrap, bytes }
  const playable = parsePublicV6PlayableRoot(bytes)
  return playable ? { status: 'valid-playable', root: playable, bytes } : { status: 'invalid' }
}

/** Writes no legacy key. A present public root, including an invalid one, is never replaced here. */
export function commitLegacyImportToPublicV6(
  storage: Pick<Storage, 'getItem' | 'setItem'>, inspected: Extract<LegacyImportInspection, { status: 'available' }>,
): PublicV6ImportResult {
  const before = loadPublicV6Root(storage)
  if (before.status === 'valid-bootstrap' || before.status === 'valid-playable') return { status: 'root-present' }
  if (before.status === 'invalid') return { status: 'invalid-root' }
  if (before.status === 'storage-error') return { status: 'storage-error' }
  try { if (storage.getItem(PUBLIC_V6_STAGE_KEY) !== null) return { status: 'pending-stage' } }
  catch { return { status: 'storage-error' } }
  const current = inspectLegacyImportSource(storage, inspected.source.profile)
  if (current.status === 'storage-error') return { status: 'storage-error' }
  if (current.status !== 'available' || current.source.key !== inspected.source.key
    || current.source.bytes !== inspected.source.bytes
    || current.greenwaySaveBytes !== inspected.greenwaySaveBytes) return { status: 'source-changed' }
  const root: PublicV6BootstrapRoot = {
    schemaVersion: PUBLIC_V6_BOOTSTRAP_SCHEMA,
    greenwayContentRevision: WORLD_CONTENT_REVISION,
    mireglassContentRevision: MIREGLASS_CONTENT_REVISION,
    seed: restoreWizardWorld(current.greenwaySaveBytes).seed,
    source: current.source,
    greenwaySaveBytes: current.greenwaySaveBytes,
  }
  const bytes = JSON.stringify(root)
  if (!parsePublicV6BootstrapRoot(bytes)) return { status: 'source-changed' }
  try {
    // The caller must hold a Web Lock around read and commit; this repeat check
    // keeps an intervening staged snapshot from being overwritten by this import.
    if (storage.getItem(PUBLIC_V6_STAGE_KEY) !== null) return { status: 'pending-stage' }
    storage.setItem(PUBLIC_V6_STAGE_KEY, bytes)
    if (storage.getItem(PUBLIC_V6_STAGE_KEY) !== bytes) return { status: 'stage-verification-failed' }
  } catch { return { status: 'storage-error' } }
  const finalSource = inspectLegacyImportSource(storage, inspected.source.profile)
  if (finalSource.status === 'storage-error') return { status: 'storage-error' }
  if (finalSource.status !== 'available' || finalSource.source.key !== inspected.source.key
    || finalSource.source.bytes !== inspected.source.bytes) return { status: 'source-changed' }
  const finalRoot = loadPublicV6Root(storage)
  if (finalRoot.status === 'valid-bootstrap' || finalRoot.status === 'valid-playable') return { status: 'root-present' }
  if (finalRoot.status === 'invalid') return { status: 'invalid-root' }
  if (finalRoot.status === 'storage-error') return { status: 'storage-error' }
  try {
    storage.setItem(PUBLIC_V6_ROOT_KEY, bytes)
    if (storage.getItem(PUBLIC_V6_ROOT_KEY) !== bytes) return { status: 'root-verification-failed' }
  } catch { return { status: 'storage-error' } }
  return loadPublicV6Root(storage).status === 'valid-bootstrap'
    ? { status: 'committed', root } : { status: 'root-verification-failed' }
}

export type PublicV6SaveResult =
  | { status: 'committed'; root: PublicV6PlayableRoot; bytes: string }
  | { status: 'invalid-state' | 'invalid-expected-root' | 'invalid-root' | 'root-changed'
    | 'legacy-present' | 'pending-stage' | 'storage-error' | 'stage-verification-failed'
    | 'backup-verification-failed' | 'root-verification-failed' }

export type PublicV6ArtifactInspection =
  | { status: 'storage-error' }
  | { status: 'available'; stage: { status: 'missing' | 'invalid' | 'settled' | 'pending'; bytes?: string };
    backup: { status: 'missing' | 'invalid' | 'available'; bytes?: string } }

/** Stage and backup are visible to recovery UI. Nothing is auto-restored or deleted. */
export function inspectPublicV6Artifacts(storage: Pick<Storage, 'getItem'>): PublicV6ArtifactInspection {
  let root: string | null
  let stage: string | null
  let backup: string | null
  try {
    root = storage.getItem(PUBLIC_V6_ROOT_KEY)
    stage = storage.getItem(PUBLIC_V6_STAGE_KEY)
    backup = storage.getItem(PUBLIC_V6_BACKUP_KEY)
  } catch { return { status: 'storage-error' } }
  const valid = (bytes: string) => !!(parsePublicV6BootstrapRoot(bytes) || parsePublicV6PlayableRoot(bytes))
  return {
    status: 'available',
    stage: stage === null ? { status: 'missing' }
      : !valid(stage) ? { status: 'invalid', bytes: stage }
        : { status: stage === root ? 'settled' : 'pending', bytes: stage },
    backup: backup === null ? { status: 'missing' }
      : !valid(backup) ? { status: 'invalid', bytes: backup }
        : { status: 'available', bytes: backup },
  }
}

/**
 * Lossless optimistic save. The caller must serialize its read-and-commit sequence
 * under a Web Lock across tabs: localStorage's byte compare is not an atomic CAS.
 */
export function commitPublicV6World(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  state: PublicWorldState,
  expectedRootBytes: string | null,
  options: { confirmedFreshStartWithLegacy?: boolean } = {},
): PublicV6SaveResult {
  const expectedBootstrap = expectedRootBytes === null ? null : parsePublicV6BootstrapRoot(expectedRootBytes)
  const expectedPlayable = expectedRootBytes === null || expectedBootstrap ? null
    : parsePublicV6PlayableRoot(expectedRootBytes)
  if (expectedRootBytes !== null && !expectedBootstrap && !expectedPlayable) {
    return { status: 'invalid-expected-root' }
  }
  const bootstrap = expectedBootstrap ?? expectedPlayable?.bootstrap ?? null
  const revision = expectedPlayable ? expectedPlayable.saveRevision + 1 : 0
  if (!Number.isSafeInteger(revision)) return { status: 'invalid-state' }
  const root: PublicV6PlayableRoot = { schemaVersion: PUBLIC_V6_SCHEMA, saveRevision: revision, bootstrap, state }
  let bytes: string
  try { bytes = serializePublicV6World(root) } catch { return { status: 'invalid-state' } }

  const current = loadPublicV6Root(storage)
  if (current.status === 'invalid') return { status: 'invalid-root' }
  if (current.status === 'storage-error') return { status: 'storage-error' }
  if (('bytes' in current ? current.bytes : null) !== expectedRootBytes) return { status: 'root-changed' }
  if (expectedRootBytes === null && !options.confirmedFreshStartWithLegacy) {
    try {
      for (const key of [...LEGACY_KEYS['greenway-classic-v1'], ...LEGACY_KEYS['greenway-expanded-v1']]) {
        if (storage.getItem(key) !== null) return { status: 'legacy-present' }
      }
    } catch { return { status: 'storage-error' } }
  }
  let oldStage: string | null
  try { oldStage = storage.getItem(PUBLIC_V6_STAGE_KEY) } catch { return { status: 'storage-error' } }
  if (oldStage !== null && oldStage !== expectedRootBytes) return { status: 'pending-stage' }
  try {
    storage.setItem(PUBLIC_V6_STAGE_KEY, bytes)
    if (storage.getItem(PUBLIC_V6_STAGE_KEY) !== bytes) return { status: 'stage-verification-failed' }
  } catch { return { status: 'storage-error' } }
  const afterStage = loadPublicV6Root(storage)
  if (afterStage.status === 'invalid') return { status: 'invalid-root' }
  if (afterStage.status === 'storage-error') return { status: 'storage-error' }
  if (('bytes' in afterStage ? afterStage.bytes : null) !== expectedRootBytes) return { status: 'root-changed' }
  if (expectedRootBytes !== null) {
    try {
      storage.setItem(PUBLIC_V6_BACKUP_KEY, expectedRootBytes)
      if (storage.getItem(PUBLIC_V6_BACKUP_KEY) !== expectedRootBytes) return { status: 'backup-verification-failed' }
    } catch { return { status: 'storage-error' } }
  }
  const beforePublish = loadPublicV6Root(storage)
  if (beforePublish.status === 'invalid') return { status: 'invalid-root' }
  if (beforePublish.status === 'storage-error') return { status: 'storage-error' }
  if (('bytes' in beforePublish ? beforePublish.bytes : null) !== expectedRootBytes) return { status: 'root-changed' }
  try {
    storage.setItem(PUBLIC_V6_ROOT_KEY, bytes)
    if (storage.getItem(PUBLIC_V6_ROOT_KEY) !== bytes) return { status: 'root-verification-failed' }
  } catch { return { status: 'storage-error' } }
  const published = loadPublicV6Root(storage)
  return published.status === 'valid-playable' && published.bytes === bytes
    ? { status: 'committed', root: published.root, bytes }
    : { status: 'root-verification-failed' }
}

const PUBLIC_V6_ARCHIVE_PREFIX = 'wizard-realms:world:v6:archive:'
const MAX_RECOVERY_ARCHIVE_CHARS = 32 * 1024 * 1024

export interface PublicV6RecoverySnapshot {
  readonly rootBytes: string | null
  readonly stageBytes: string | null
  readonly backupBytes: string | null
}

export type PublicV6RecoveryResult =
  | { status: 'recovered'; root: PublicV6BootstrapRoot | PublicV6PlayableRoot;
    bytes: string; archiveKey: string }
  | { status: 'invalid-expected-snapshot' | 'snapshot-changed' | 'invalid-source'
    | 'archive-key-invalid' | 'archive-key-present' | 'archive-key-unavailable'
    | 'archive-too-large' | 'archive-verification-failed' | 'backup-verification-failed'
    | 'stage-verification-failed'
    | 'root-verification-failed' | 'storage-error' }

/** Reads raw bytes, including invalid roots, without choosing or modifying any candidate. */
export function readPublicV6RecoverySnapshot(storage: Pick<Storage, 'getItem'>):
  { status: 'available'; snapshot: PublicV6RecoverySnapshot } | { status: 'storage-error' } {
  try {
    return { status: 'available', snapshot: {
      rootBytes: storage.getItem(PUBLIC_V6_ROOT_KEY),
      stageBytes: storage.getItem(PUBLIC_V6_STAGE_KEY),
      backupBytes: storage.getItem(PUBLIC_V6_BACKUP_KEY),
    } }
  } catch { return { status: 'storage-error' } }
}

function validRecoverySnapshot(value: unknown): value is PublicV6RecoverySnapshot {
  return exact(value, ['rootBytes', 'stageBytes', 'backupBytes'])
    && [value.rootBytes, value.stageBytes, value.backupBytes]
      .every((bytes) => bytes === null || typeof bytes === 'string')
}

function sameRecoverySnapshot(a: PublicV6RecoverySnapshot, b: PublicV6RecoverySnapshot): boolean {
  return a.rootBytes === b.rootBytes && a.stageBytes === b.stageBytes && a.backupBytes === b.backupBytes
}

/**
 * Explicit recovery only. The caller must hold one Web Lock around snapshot read
 * and this whole operation. Archive readback precedes every stage/root write.
 * A failed partial write leaves the archive and candidate keys intact for review.
 */
export function recoverPublicV6Root(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  source: 'root' | 'stage' | 'backup',
  expected: PublicV6RecoverySnapshot,
  options: { archiveKey?: string } = {},
): PublicV6RecoveryResult {
  if (!validRecoverySnapshot(expected)) return { status: 'invalid-expected-snapshot' }
  const before = readPublicV6RecoverySnapshot(storage)
  if (before.status === 'storage-error') return before
  if (!sameRecoverySnapshot(before.snapshot, expected)) return { status: 'snapshot-changed' }
  const selected = source === 'root' ? expected.rootBytes
    : source === 'stage' ? expected.stageBytes
      : source === 'backup' ? expected.backupBytes : null
  const parsed = selected === null ? null
    : parsePublicV6BootstrapRoot(selected) ?? parsePublicV6PlayableRoot(selected)
  if (!parsed || selected === null) return { status: 'invalid-source' }

  const rawLength = (expected.rootBytes?.length ?? 0) + (expected.stageBytes?.length ?? 0)
    + (expected.backupBytes?.length ?? 0)
  if (rawLength > MAX_RECOVERY_ARCHIVE_CHARS) return { status: 'archive-too-large' }
  const archive = JSON.stringify({ schemaVersion: 'wizard-world/v6-recovery-archive',
    selectedSource: source, ...expected })
  if (archive.length > MAX_RECOVERY_ARCHIVE_CHARS) return { status: 'archive-too-large' }
  let archiveKey = options.archiveKey
  if (archiveKey !== undefined && !new RegExp(`^${PUBLIC_V6_ARCHIVE_PREFIX}[0-9a-fA-F-]{36}$`).test(archiveKey)) {
    return { status: 'archive-key-invalid' }
  }
  try {
    if (archiveKey === undefined) {
      if (typeof globalThis.crypto?.randomUUID !== 'function') return { status: 'archive-key-unavailable' }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const candidate = `${PUBLIC_V6_ARCHIVE_PREFIX}${globalThis.crypto.randomUUID()}`
        if (storage.getItem(candidate) === null) { archiveKey = candidate; break }
      }
      if (archiveKey === undefined) return { status: 'archive-key-unavailable' }
    } else if (storage.getItem(archiveKey) !== null) return { status: 'archive-key-present' }
    storage.setItem(archiveKey, archive)
    if (storage.getItem(archiveKey) !== archive) return { status: 'archive-verification-failed' }
  } catch { return { status: 'storage-error' } }

  const afterArchive = readPublicV6RecoverySnapshot(storage)
  if (afterArchive.status === 'storage-error') return afterArchive
  if (!sameRecoverySnapshot(afterArchive.snapshot, expected)) return { status: 'snapshot-changed' }
  const repairBackup = expected.backupBytes !== null
    && !parsePublicV6BootstrapRoot(expected.backupBytes)
    && !parsePublicV6PlayableRoot(expected.backupBytes)
  const settledBackupBytes = repairBackup ? selected : expected.backupBytes
  try {
    if (repairBackup) {
      storage.setItem(PUBLIC_V6_BACKUP_KEY, selected)
      if (storage.getItem(PUBLIC_V6_BACKUP_KEY) !== selected) return { status: 'backup-verification-failed' }
    }
    const afterBackup = readPublicV6RecoverySnapshot(storage)
    if (afterBackup.status === 'storage-error') return afterBackup
    if (!sameRecoverySnapshot(afterBackup.snapshot, { ...expected, backupBytes: settledBackupBytes })) {
      return { status: 'snapshot-changed' }
    }
    storage.setItem(PUBLIC_V6_STAGE_KEY, selected)
    if (storage.getItem(PUBLIC_V6_STAGE_KEY) !== selected) return { status: 'stage-verification-failed' }
    const beforePublish = readPublicV6RecoverySnapshot(storage)
    if (beforePublish.status === 'storage-error') return beforePublish
    if (beforePublish.snapshot.rootBytes !== expected.rootBytes
      || beforePublish.snapshot.stageBytes !== selected
      || beforePublish.snapshot.backupBytes !== settledBackupBytes) return { status: 'snapshot-changed' }
    if (source !== 'root') {
      storage.setItem(PUBLIC_V6_ROOT_KEY, selected)
      if (storage.getItem(PUBLIC_V6_ROOT_KEY) !== selected) return { status: 'root-verification-failed' }
    }
  } catch { return { status: 'storage-error' } }
  const published = loadPublicV6Root(storage)
  return (published.status === 'valid-bootstrap' || published.status === 'valid-playable')
    && published.bytes === selected
    ? { status: 'recovered', root: published.root, bytes: selected, archiveKey }
    : { status: 'root-verification-failed' }
}
