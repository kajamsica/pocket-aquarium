import { mireglassHerbPatches } from './mireglassHerbPatches'
import { HERB_CYCLE_TICKS } from './mireglassHerbForaging'
import type { MireglassRegionProgress } from './mireglassExpedition'
import { inspectLegacyImportSource } from './publicWorldV6'
import {
  PUBLIC_V6_ROOT_KEY, inspectPublicV6Artifacts, loadPublicV6Root,
  parsePublicV6BootstrapRoot, parsePublicV6PlayableRoot,
} from './publicWorldV6'
import type { PublicV6BootstrapRoot, PublicV6PlayableRoot } from './publicWorldV6'
import { isValidPublicWorldState } from './publicWorldPersistence'
import { createPublicWorldFromBootstrap } from './publicWorldState'
import type { PublicWorldState } from './publicWorldState'

export const PUBLIC_V7_ROOT_KEY = 'wizard-realms:world:v7:root'
export const PUBLIC_V7_STAGE_KEY = 'wizard-realms:world:v7:stage'
export const PUBLIC_V7_BACKUP_KEY = 'wizard-realms:world:v7:backup'
export const PUBLIC_V7_SCHEMA = 'wizard-world/v7'
/** The old and new public writers must use the same cross-tab Web Lock. */
export const PUBLIC_V7_LOCK_NAME = `${PUBLIC_V6_ROOT_KEY}:exclusive`
export const HERB_REGROW_TICKS = HERB_CYCLE_TICKS

export type PublicWorldV7State = Omit<PublicWorldState, 'mireglass'> & {
  mireglass: MireglassRegionProgress & {
    herbHarvestCycles: readonly { patchId: string; cycle: number }[]
  }
}

export interface PublicV7PlayableRoot {
  readonly schemaVersion: typeof PUBLIC_V7_SCHEMA
  readonly saveRevision: number
  readonly bootstrap: PublicV6BootstrapRoot | null
  /** Immutable migration receipt. A fresh v7 world has no v6 source. */
  readonly migrationSourceV6Bytes: string | null
  readonly state: PublicWorldV7State
}

export type PublicV7RootLoad =
  | { status: 'missing' | 'invalid' | 'source-changed' | 'storage-error' }
  | { status: 'valid-playable'; root: PublicV7PlayableRoot; bytes: string }

export type PublicV7SaveResult =
  | { status: 'committed'; root: PublicV7PlayableRoot; bytes: string }
  | { status: 'invalid-state' | 'invalid-expected-root' | 'invalid-root' | 'root-changed'
    | 'v6-present' | 'legacy-present' | 'invalid-v6-source' | 'source-changed'
    | 'pending-v6-stage' | 'invalid-v6-backup' | 'pending-stage' | 'invalid-backup'
    | 'storage-error' | 'stage-verification-failed' | 'backup-verification-failed'
    | 'root-verification-failed' | 'root-present' }

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
function canonicalPatchIds(seed: string): ReadonlySet<string> {
  const ids = mireglassHerbPatches(seed).map((patch) => patch.id)
  if (ids.length < 1 || ids.length > 32 || new Set(ids).size !== ids.length) {
    throw new RangeError('Invalid Bell Alder herb catalog.')
  }
  return new Set(ids)
}

/** V7 adds only herb history. The unchanged v6 validator proves every other fact. */
export function isValidPublicWorldV7State(value: unknown, bootstrap: PublicV6BootstrapRoot | null): value is PublicWorldV7State {
  if (!record(value) || !record(value.mireglass) || !Object.hasOwn(value.mireglass, 'herbHarvestCycles')) return false
  const { herbHarvestCycles, ...v6Region } = value.mireglass
  if (!isValidPublicWorldState({ ...value, mireglass: v6Region }, bootstrap)
    || !Array.isArray(herbHarvestCycles)) return false
  const currentCycle = Math.floor((value.tick as number) / HERB_REGROW_TICKS)
  let patchIds: ReadonlySet<string>
  try { patchIds = canonicalPatchIds(value.seed as string) } catch { return false }
  if (herbHarvestCycles.length > patchIds.size) return false
  let previous = ''
  for (const entry of herbHarvestCycles) {
    if (!exact(entry, ['patchId', 'cycle']) || typeof entry.patchId !== 'string'
      || entry.patchId <= previous || !patchIds.has(entry.patchId)
      || !Number.isSafeInteger(entry.cycle) || (entry.cycle as number) < 0
      || (entry.cycle as number) > currentCycle) return false
    previous = entry.patchId
  }
  return true
}

export function withFreshPublicV7Herbs(state: PublicWorldState): PublicWorldV7State {
  if (Object.hasOwn(state.mireglass, 'herbHarvestCycles')) {
    throw new RangeError('Herb history already exists on this state.')
  }
  return { ...state, mireglass: { ...state.mireglass, herbHarvestCycles: [] } }
}

/** Validated v6 roots become detached v7 state without changing their source bytes. */
export function createPublicV7StateFromV6Root(root: PublicV6BootstrapRoot | PublicV6PlayableRoot): PublicWorldV7State {
  const bytes = JSON.stringify(root)
  const playable = parsePublicV6PlayableRoot(bytes)
  const bootstrap = playable ? null : parsePublicV6BootstrapRoot(bytes)
  if (!playable && !bootstrap) throw new RangeError('Invalid public v6 migration source.')
  return withFreshPublicV7Herbs(playable ? playable.state : createPublicWorldFromBootstrap(bootstrap!))
}

export function parsePublicV7PlayableRoot(bytes: string): PublicV7PlayableRoot | null {
  if (typeof bytes !== 'string' || bytes.length > 96 * 1024 * 1024) return null
  let value: unknown
  try { value = JSON.parse(bytes) } catch { return null }
  if (!exact(value, ['schemaVersion', 'saveRevision', 'bootstrap', 'migrationSourceV6Bytes', 'state'])
    || value.schemaVersion !== PUBLIC_V7_SCHEMA
    || !Number.isSafeInteger(value.saveRevision) || (value.saveRevision as number) < 0) return null
  const bootstrap = value.bootstrap === null ? null
    : parsePublicV6BootstrapRoot(JSON.stringify(value.bootstrap))
  if (value.bootstrap !== null && !bootstrap) return null
  if (value.migrationSourceV6Bytes !== null) {
    if (typeof value.migrationSourceV6Bytes !== 'string') return null
    const source = parsePublicV6PlayableRoot(value.migrationSourceV6Bytes)
      ?? parsePublicV6BootstrapRoot(value.migrationSourceV6Bytes)
    if (!source || !record(value.state)) return null
    const sourceBootstrap = source.schemaVersion === 'wizard-world/v6-bootstrap' ? source : source.bootstrap
    const sourceSeed = source.schemaVersion === 'wizard-world/v6-bootstrap' ? source.seed : source.state.seed
    if (value.state.seed !== sourceSeed || JSON.stringify(bootstrap) !== JSON.stringify(sourceBootstrap)) return null
  }
  return isValidPublicWorldV7State(value.state, bootstrap) ? value as unknown as PublicV7PlayableRoot : null
}

export function serializePublicV7World(root: PublicV7PlayableRoot): string {
  const bytes = JSON.stringify(root)
  if (!parsePublicV7PlayableRoot(bytes)) throw new RangeError('Invalid public v7 world state.')
  return bytes
}

export function loadPublicV7Root(storage: Pick<Storage, 'getItem'>): PublicV7RootLoad {
  let bytes: string | null
  try { bytes = storage.getItem(PUBLIC_V7_ROOT_KEY) } catch { return { status: 'storage-error' } }
  if (bytes === null) return { status: 'missing' }
  const root = parsePublicV7PlayableRoot(bytes)
  if (!root) return { status: 'invalid' }
  if (root.migrationSourceV6Bytes !== null) {
    const source = unchangedV6Source(storage, root.migrationSourceV6Bytes)
    if (source !== 'same') return { status: source }
  } else {
    // An older open v6 tab can create a separate root after a fresh v7 start.
    // Stop both branches from silently advancing until their bytes are reconciled.
    const source = loadPublicV6Root(storage)
    if (source.status === 'storage-error') return { status: 'storage-error' }
    if (source.status !== 'missing') return { status: 'source-changed' }
  }
  return { status: 'valid-playable', root, bytes }
}

export type PublicV7ArtifactInspection =
  | { status: 'storage-error' }
  | { status: 'available'; stage: { status: 'missing' | 'invalid' | 'settled' | 'pending'; bytes?: string };
    backup: { status: 'missing' | 'invalid' | 'available'; bytes?: string } }

/** Exposes failed commits for explicit recovery without modifying their bytes. */
export function inspectPublicV7Artifacts(storage: Pick<Storage, 'getItem'>): PublicV7ArtifactInspection {
  let root: string | null
  let stage: string | null
  let backup: string | null
  try {
    root = storage.getItem(PUBLIC_V7_ROOT_KEY)
    stage = storage.getItem(PUBLIC_V7_STAGE_KEY)
    backup = storage.getItem(PUBLIC_V7_BACKUP_KEY)
  } catch { return { status: 'storage-error' } }
  return { status: 'available',
    stage: stage === null ? { status: 'missing' }
      : !parsePublicV7PlayableRoot(stage) ? { status: 'invalid', bytes: stage }
        : { status: stage === root ? 'settled' : 'pending', bytes: stage },
    backup: backup === null ? { status: 'missing' }
      : !parsePublicV7PlayableRoot(backup) ? { status: 'invalid', bytes: backup }
        : { status: 'available', bytes: backup },
  }
}

function unchangedV6Source(storage: Pick<Storage, 'getItem'>, expected: string): 'same' | 'source-changed' | 'storage-error' {
  const current = loadPublicV6Root(storage)
  if (current.status === 'storage-error') return 'storage-error'
  return 'bytes' in current && current.bytes === expected ? 'same' : 'source-changed'
}

/** Caller holds PUBLIC_V7_LOCK_NAME around its read and this complete commit. */
function commitV7(storage: Pick<Storage, 'getItem' | 'setItem'>, state: PublicWorldV7State,
  expectedRootBytes: string | null, bootstrap: PublicV6BootstrapRoot | null,
  expectedV6Bytes?: string): PublicV7SaveResult {
  const previous = expectedRootBytes === null ? null : parsePublicV7PlayableRoot(expectedRootBytes)
  if (expectedRootBytes !== null && !previous) return { status: 'invalid-expected-root' }
  const revision = previous ? previous.saveRevision + 1 : 0
  if (!Number.isSafeInteger(revision)) return { status: 'invalid-state' }
  const root: PublicV7PlayableRoot = { schemaVersion: PUBLIC_V7_SCHEMA, saveRevision: revision,
    bootstrap: previous?.bootstrap ?? bootstrap,
    migrationSourceV6Bytes: previous?.migrationSourceV6Bytes ?? expectedV6Bytes ?? null, state }
  let bytes: string
  try { bytes = serializePublicV7World(root) } catch { return { status: 'invalid-state' } }
  const current = loadPublicV7Root(storage)
  if (current.status === 'invalid') return { status: 'invalid-root' }
  if (current.status === 'source-changed') return { status: 'source-changed' }
  if (current.status === 'storage-error') return { status: 'storage-error' }
  if (('bytes' in current ? current.bytes : null) !== expectedRootBytes) return { status: 'root-changed' }
  if (expectedV6Bytes) {
    const source = unchangedV6Source(storage, expectedV6Bytes)
    if (source !== 'same') return { status: source }
  }
  const artifacts = inspectPublicV7Artifacts(storage)
  if (artifacts.status === 'storage-error') return { status: 'storage-error' }
  if (artifacts.stage.status === 'pending' || artifacts.stage.status === 'invalid') return { status: 'pending-stage' }
  if (artifacts.backup.status === 'invalid') return { status: 'invalid-backup' }
  try {
    storage.setItem(PUBLIC_V7_STAGE_KEY, bytes)
    if (storage.getItem(PUBLIC_V7_STAGE_KEY) !== bytes) return { status: 'stage-verification-failed' }
  } catch { return { status: 'storage-error' } }
  const afterStage = loadPublicV7Root(storage)
  if (afterStage.status === 'invalid') return { status: 'invalid-root' }
  if (afterStage.status === 'source-changed') return { status: 'source-changed' }
  if (afterStage.status === 'storage-error') return { status: 'storage-error' }
  if (('bytes' in afterStage ? afterStage.bytes : null) !== expectedRootBytes) return { status: 'root-changed' }
  if (expectedRootBytes !== null) {
    try {
      storage.setItem(PUBLIC_V7_BACKUP_KEY, expectedRootBytes)
      if (storage.getItem(PUBLIC_V7_BACKUP_KEY) !== expectedRootBytes) return { status: 'backup-verification-failed' }
    } catch { return { status: 'storage-error' } }
  }
  const beforePublish = loadPublicV7Root(storage)
  if (beforePublish.status === 'invalid') return { status: 'invalid-root' }
  if (beforePublish.status === 'source-changed') return { status: 'source-changed' }
  if (beforePublish.status === 'storage-error') return { status: 'storage-error' }
  if (('bytes' in beforePublish ? beforePublish.bytes : null) !== expectedRootBytes) return { status: 'root-changed' }
  if (expectedV6Bytes) {
    const source = unchangedV6Source(storage, expectedV6Bytes)
    if (source !== 'same') return { status: source }
  }
  try {
    storage.setItem(PUBLIC_V7_ROOT_KEY, bytes)
    if (storage.getItem(PUBLIC_V7_ROOT_KEY) !== bytes) return { status: 'root-verification-failed' }
  } catch { return { status: 'storage-error' } }
  const published = loadPublicV7Root(storage)
  return published.status === 'valid-playable' && published.bytes === bytes
    ? { status: 'committed', root: published.root, bytes } : { status: 'root-verification-failed' }
}

export function commitPublicV7World(storage: Pick<Storage, 'getItem' | 'setItem'>,
  state: PublicWorldV7State, expectedRootBytes: string | null,
  options: { confirmedFreshStartWithLegacy?: boolean } = {}): PublicV7SaveResult {
  if (expectedRootBytes === null) {
    const current = loadPublicV7Root(storage)
    if (current.status === 'invalid') return { status: 'invalid-root' }
    if (current.status === 'source-changed' || current.status === 'storage-error') return { status: current.status }
    if (current.status === 'valid-playable') return { status: 'root-changed' }
    const v6 = loadPublicV6Root(storage)
    if (v6.status === 'storage-error') return { status: 'storage-error' }
    if (v6.status !== 'missing') return { status: 'v6-present' }
    if (!options.confirmedFreshStartWithLegacy) {
      const classic = inspectLegacyImportSource(storage, 'greenway-classic-v1')
      const expanded = inspectLegacyImportSource(storage, 'greenway-expanded-v1')
      if (classic.status === 'storage-error' || expanded.status === 'storage-error') return { status: 'storage-error' }
      if (classic.status !== 'missing' || expanded.status !== 'missing') return { status: 'legacy-present' }
    }
  }
  return commitV7(storage, state, expectedRootBytes, null)
}

/** A v6 root stays byte-for-byte intact; the caller holds the shared Web Lock. */
export function migratePublicV6ToV7(storage: Pick<Storage, 'getItem' | 'setItem'>,
  expectedV6Bytes: string): PublicV7SaveResult {
  if (typeof expectedV6Bytes !== 'string') return { status: 'invalid-v6-source' }
  const source = parsePublicV6PlayableRoot(expectedV6Bytes) ?? parsePublicV6BootstrapRoot(expectedV6Bytes)
  if (!source) return { status: 'invalid-v6-source' }
  const v7 = loadPublicV7Root(storage)
  if (v7.status === 'storage-error') return { status: 'storage-error' }
  if (v7.status === 'invalid') return { status: 'invalid-root' }
  if (v7.status === 'source-changed') return { status: 'source-changed' }
  if (v7.status !== 'missing') return { status: 'root-present' }
  const artifacts = inspectPublicV6Artifacts(storage)
  if (artifacts.status === 'storage-error') return { status: 'storage-error' }
  if (artifacts.stage.status === 'pending' || artifacts.stage.status === 'invalid') return { status: 'pending-v6-stage' }
  if (artifacts.backup.status === 'invalid') return { status: 'invalid-v6-backup' }
  const sourceStatus = unchangedV6Source(storage, expectedV6Bytes)
  if (sourceStatus !== 'same') return { status: sourceStatus }
  const bootstrap = source.schemaVersion === 'wizard-world/v6-bootstrap' ? source : source.bootstrap
  return commitV7(storage, createPublicV7StateFromV6Root(source), null, bootstrap, expectedV6Bytes)
}
