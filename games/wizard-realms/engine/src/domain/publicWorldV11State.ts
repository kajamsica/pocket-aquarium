import { HIGHLAND_CONTENT_REVISION, highlandStoneNodes } from './highlandContent'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { isValidPublicWorldV10State } from './publicWorldV10State'
import type { PublicWorldV10State } from './publicWorldV10State'

export type PublicV11StoneNodeState = {
  readonly id: string
  readonly readyAtTick: number
}

export type PublicWorldV11State = PublicWorldV10State & {
  readonly highlandContentRevision: typeof HIGHLAND_CONTENT_REVISION
  readonly highland: {
    readonly landmarkDiscovered: boolean
    readonly stoneNodes: readonly PublicV11StoneNodeState[]
  }
}

const STATE_KEYS = ['seed', 'generationProfile', 'movementOwner', 'tick', 'rng',
  'eventSequence', 'player', 'discoveredTileIds', 'greenway', 'mireglass',
  'fieldCampTileIds', 'terrainRevision', 'highlandContentRevision', 'highland']
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

/** Only the v11 validator understands the quarry ledger; older validators remain exact-key. */
export function isValidPublicWorldV11State(value: unknown,
  bootstrap: PublicV6BootstrapRoot | null): value is PublicWorldV11State {
  if (!exact(value, STATE_KEYS)
    || value.highlandContentRevision !== HIGHLAND_CONTENT_REVISION
    || !exact(value.highland, ['landmarkDiscovered', 'stoneNodes'])
    || typeof value.highland.landmarkDiscovered !== 'boolean'
    || !Array.isArray(value.highland.stoneNodes)
    || value.highland.stoneNodes.length !== 4) return false
  try {
    const { highlandContentRevision: _revision, highland: _highland, ...v10 } = value
    if (!isValidPublicWorldV10State(v10, bootstrap)) return false
    const canonical = highlandStoneNodes(v10.seed).map(({ id }) => id)
      .sort((a, b) => a.localeCompare(b))
    if (new Set(canonical).size !== 4) return false
    for (let i = 0; i < canonical.length; i++) {
      const node: unknown = value.highland.stoneNodes[i]
      if (!exact(node, ['id', 'readyAtTick']) || node.id !== canonical[i]
        || !Number.isSafeInteger(node.readyAtTick) || (node.readyAtTick as number) < 0
        // The only writer assigns actionTick + 3000. Compare by subtraction
        // so a near-MAX_SAFE_INTEGER tick cannot overflow this bound.
        || ((node.readyAtTick as number) > v10.tick
          && (node.readyAtTick as number) - v10.tick > 3000)) return false
    }
    if (!value.highland.landmarkDiscovered
      && value.highland.stoneNodes.some((node: PublicV11StoneNodeState) => node.readyAtTick > 0)) return false
    return true
  } catch { return false }
}

/** Additive, deterministic migration. The caller first validates the v10 source. */
export function withPublicV11Highland(v10State: PublicWorldV10State): PublicWorldV11State {
  if (Object.hasOwn(v10State, 'highlandContentRevision') || Object.hasOwn(v10State, 'highland')) {
    throw new RangeError('Highland revision already exists on this state.')
  }
  const stoneNodes = highlandStoneNodes(v10State.seed)
    .map(({ id }) => ({ id, readyAtTick: 0 })).sort((a, b) => a.id.localeCompare(b.id))
  if (stoneNodes.length !== 4 || new Set(stoneNodes.map(({ id }) => id)).size !== 4) {
    throw new RangeError('Invalid canonical highland stone catalog.')
  }
  return { ...v10State, highlandContentRevision: HIGHLAND_CONTENT_REVISION,
    highland: { landmarkDiscovered: false, stoneNodes } }
}
