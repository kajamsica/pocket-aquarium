import { WORLD_CONTENT_REVISION } from './generation'
import { MIREGLASS_CONTENT_REVISION, mireglassAnchors } from './mireglassContent'
import { isValidMireglassV6Player } from './mireglassExpedition'
import { mireglassRouteSites } from './mireglassRouteSites'
import { hasValidRoutePlacements, isRestorableWizardSave, restoreWizardWorld, serializeWizardWorld } from './persistence'
import type { GenerationProfile, WizardWorldState } from './types'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

export const PUBLIC_V6_ROOT_KEY = 'wizard-realms:world:v6:root'
export const PUBLIC_V6_STAGE_KEY = 'wizard-realms:world:v6:stage'
export const PUBLIC_V6_BOOTSTRAP_SCHEMA = 'wizard-world/v6-bootstrap'

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

export type LegacyImportInspection =
  | { status: 'missing' | 'storage-error' }
  | { status: 'invalid'; key: string }
  | { status: 'incompatible'; key: string; reason: 'terrain' | 'position' | 'player' | 'mireglass-content' }
  | { status: 'available'; source: LegacyImportSource; greenwaySaveBytes: string }

export type PublicV6RootLoad =
  | { status: 'missing' | 'invalid' | 'storage-error' }
  | { status: 'valid-bootstrap'; root: PublicV6BootstrapRoot; bytes: string }

export type PublicV6ImportResult =
  | { status: 'committed'; root: PublicV6BootstrapRoot }
  | { status: 'root-present' | 'invalid-root' | 'source-changed' | 'storage-error'
    | 'stage-verification-failed' | 'root-verification-failed' }

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const profileId = (value: unknown): value is GenerationProfile =>
  value === 'greenway-classic-v1' || value === 'greenway-expanded-v1'
type CompatibilityIssue = Extract<LegacyImportInspection, { status: 'incompatible' }>['reason']

/** A v5 restore may be valid while containing mutable terrain that a streamed cell cannot represent. */
function compatibility(world: WizardWorldState): CompatibilityIssue | null {
  if (!hasValidRoutePlacements(world) || !isValidMireglassV6Player(world.player)) return 'player'
  for (const tile of world.tiles) {
    const canonical = worldTileAtGrid(world.seed, tile.gridX - 3, tile.gridZ - 3)
    if (tile.id !== canonical.id || tile.center.x !== canonical.center.x
      || tile.center.y !== canonical.center.y || tile.center.z !== canonical.center.z
      || tile.elevation !== canonical.elevation || tile.temperature !== canonical.temperature
      || tile.moisture !== canonical.moisture || tile.terrain !== canonical.terrain
      || tile.biome !== canonical.biome) return 'terrain'
  }
  try {
    const { x, y, z } = world.player.position
    const ground = worldTileAtGrid(world.seed,
      Math.ceil(x / WORLD_CELL_METERS - 0.5), Math.ceil(z / WORLD_CELL_METERS - 0.5))
    if (y < ground.center.y) return 'position'
  } catch { return 'position' }
  try { mireglassAnchors(world.seed); mireglassRouteSites(world.seed) }
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
    const issue = compatibility(world)
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
      || compatibility(original) !== null) return null
  } catch { return null }
  return value as unknown as PublicV6BootstrapRoot
}

export function loadPublicV6Root(storage: Pick<Storage, 'getItem'>): PublicV6RootLoad {
  let bytes: string | null
  try { bytes = storage.getItem(PUBLIC_V6_ROOT_KEY) } catch { return { status: 'storage-error' } }
  if (bytes === null) return { status: 'missing' }
  const root = parsePublicV6BootstrapRoot(bytes)
  return root ? { status: 'valid-bootstrap', root, bytes } : { status: 'invalid' }
}

/** Writes no legacy key. A present public root, including an invalid one, is never replaced here. */
export function commitLegacyImportToPublicV6(
  storage: Pick<Storage, 'getItem' | 'setItem'>, inspected: Extract<LegacyImportInspection, { status: 'available' }>,
): PublicV6ImportResult {
  const before = loadPublicV6Root(storage)
  if (before.status === 'valid-bootstrap') return { status: 'root-present' }
  if (before.status === 'invalid') return { status: 'invalid-root' }
  if (before.status === 'storage-error') return { status: 'storage-error' }
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
    storage.setItem(PUBLIC_V6_STAGE_KEY, bytes)
    if (storage.getItem(PUBLIC_V6_STAGE_KEY) !== bytes) return { status: 'stage-verification-failed' }
  } catch { return { status: 'storage-error' } }
  const finalSource = inspectLegacyImportSource(storage, inspected.source.profile)
  if (finalSource.status === 'storage-error') return { status: 'storage-error' }
  if (finalSource.status !== 'available' || finalSource.source.key !== inspected.source.key
    || finalSource.source.bytes !== inspected.source.bytes) return { status: 'source-changed' }
  const finalRoot = loadPublicV6Root(storage)
  if (finalRoot.status === 'valid-bootstrap') return { status: 'root-present' }
  if (finalRoot.status === 'invalid') return { status: 'invalid-root' }
  if (finalRoot.status === 'storage-error') return { status: 'storage-error' }
  try {
    storage.setItem(PUBLIC_V6_ROOT_KEY, bytes)
    if (storage.getItem(PUBLIC_V6_ROOT_KEY) !== bytes) return { status: 'root-verification-failed' }
  } catch { return { status: 'storage-error' } }
  return loadPublicV6Root(storage).status === 'valid-bootstrap'
    ? { status: 'committed', root } : { status: 'root-verification-failed' }
}
