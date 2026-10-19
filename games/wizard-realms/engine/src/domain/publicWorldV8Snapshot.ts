import { decodeDiscoveredTileIds, DISCOVERY_MASK_BYTES, encodeDiscoveredTileIds } from './discoveryMask'
import { parsePublicV6BootstrapRoot } from './publicWorldV6'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { isValidPublicWorldV7State } from './publicWorldV7'
import type { PublicWorldV7State } from './publicWorldV7'

export const PUBLIC_V8_SCHEMA = 'wizard-world/v8'

export interface PublicV8Head {
  readonly schemaVersion: typeof PUBLIC_V8_SCHEMA
  readonly saveRevision: number
  readonly bootstrap: PublicV6BootstrapRoot | null
  readonly state: Omit<PublicWorldV7State, 'discoveredTileIds'> & {
    readonly discoveryMask: Uint8Array
  }
}

const HEAD_KEYS = ['schemaVersion', 'saveRevision', 'bootstrap', 'state']
const STATE_KEYS = ['seed', 'generationProfile', 'movementOwner', 'tick', 'rng',
  'eventSequence', 'player', 'discoveryMask', 'greenway', 'mireglass']
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

function validatedBootstrap(value: unknown): PublicV6BootstrapRoot | null | undefined {
  if (value === null) return null
  try {
    const bytes = JSON.stringify(value)
    return typeof bytes === 'string' ? parsePublicV6BootstrapRoot(bytes) ?? undefined : undefined
  } catch { return undefined }
}

export function encodePublicV8Head(
  state: PublicWorldV7State, bootstrap: PublicV6BootstrapRoot | null, saveRevision: number,
): PublicV8Head {
  const checkedBootstrap = validatedBootstrap(bootstrap)
  if (!Number.isSafeInteger(saveRevision) || saveRevision < 0
    || checkedBootstrap === undefined || !isValidPublicWorldV7State(state, checkedBootstrap)) {
    throw new RangeError('Invalid public v8 world state.')
  }
  const { discoveredTileIds, ...otherState } = state
  return { schemaVersion: PUBLIC_V8_SCHEMA, saveRevision, bootstrap: checkedBootstrap,
    state: { ...otherState, discoveryMask: encodeDiscoveredTileIds(discoveredTileIds) } }
}

export function decodePublicV8Head(value: unknown): {
  state: PublicWorldV7State; bootstrap: PublicV6BootstrapRoot | null; saveRevision: number
} | null {
  try {
    if (!exact(value, HEAD_KEYS) || value.schemaVersion !== PUBLIC_V8_SCHEMA
      || !Number.isSafeInteger(value.saveRevision) || (value.saveRevision as number) < 0
      || !exact(value.state, STATE_KEYS) || !(value.state.discoveryMask instanceof Uint8Array)
      || value.state.discoveryMask.length !== DISCOVERY_MASK_BYTES) return null
    const bootstrap = validatedBootstrap(value.bootstrap)
    if (bootstrap === undefined) return null
    const { discoveryMask, ...otherState } = value.state
    const state = { ...otherState, discoveredTileIds: decodeDiscoveredTileIds(discoveryMask) }
    return isValidPublicWorldV7State(state, bootstrap)
      ? { state, bootstrap, saveRevision: value.saveRevision as number } : null
  } catch { return null }
}
