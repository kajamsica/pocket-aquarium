import { decodePublicV14FrameWitness } from './publicWorldV14Snapshot'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { publicV32Monotonic, publicV32Preserves } from './publicWorldV32Snapshot'
import { PUBLIC_V43_PROGRESS_KEYS } from './publicWorldV43FamiliarAction'
import { decodePublicV43Progress, decodePublicV43Witness,
  publicV43Monotonic } from './publicWorldV43Snapshot'
import type { PublicV43Witness } from './publicWorldV43Snapshot'
import { projectPublicV43MountTraining } from './publicWorldV43MountTraining'
import { confirmPublicV45Action } from './publicWorldV45RideAction'
import type { PublicV45Progress, PublicV45RideWitness } from './publicWorldV45RideAction'
import { createPublicV45Genesis, decodePublicV45Genesis, PUBLIC_V45_SCHEMA }
  from './publicWorldV45Migration'
import type { PublicV45Lineage } from './publicWorldV45Migration'
import { decodePublicV44Root } from './publicWorldV44Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

export type PublicV45Witness = PublicV45RideWitness | PublicV43Witness
export type PublicV45Head = PublicV45Progress & Readonly<{
  schemaVersion: typeof PUBLIC_V45_SCHEMA
  saveRevision: number
  witness: PublicV45Witness | null
}>
export type PublicV45Root = Readonly<{
  lineage: PublicV45Lineage
  previous: PublicV45Head | null
  head: PublicV45Head
}>

const RAW_LIMIT = 3 << 20
const OPTIONAL_KEYS = ['mountTraining', 'greenwayOrder', 'greenwayBagUpgrade'] as const
const progressOf = ({ schemaVersion: _schema, saveRevision: _revision,
  witness: _witness, ...progress }: PublicV45Head): PublicV45Progress => progress
const preservesGenesis = (genesis: PublicV45Head, head: PublicV45Head,
  seed: string) => publicV32Preserves(genesis, head, seed)
  && publicV43Monotonic(genesis, head)
  && sameStrictBoundedRaw([head.groundMount, head.tack],
    [genesis.groundMount, genesis.tack], RAW_LIMIT)

/** Accept a canonical assisted ride or an existing V43 ordinary witness. */
export function decodePublicV45Witness(raw: unknown): PublicV45Witness | null {
  try {
    if (!exactPublicV23(raw, ['kind', 'intents'])
      || raw.kind !== 'sedgehorn-assisted-ride-frame/v1')
      return decodePublicV43Witness(raw)
    const frame = decodePublicV14FrameWitness({ kind: 'frame-batch/v1',
      frames: [{ intents: raw.intents, walkRequested: false }] })?.frames[0]
    const move = frame?.intents.at(-1)
    if (!frame || move?.type !== 'move'
      || Math.hypot(move.delta.x, move.delta.z) <= 0) return null
    structuredClone(raw)
    return { kind: 'sedgehorn-assisted-ride-frame/v1',
      intents: frame.intents as PublicV45RideWitness['intents'] }
  } catch { return null }
}

function decodeLineage(raw: unknown): PublicV45Lineage | null {
  try {
    if (!exactPublicV23(raw, ['origin', 'source', 'sourceRevision', 'seed'])
      || raw.origin !== 'v44-migration') return null
    const source = decodePublicV44Root(raw.source)
    if (!source || raw.sourceRevision !== source.head.saveRevision
      || raw.seed !== source.head.v43.head.state.seed) return null
    const lineage: PublicV45Lineage = { origin: 'v44-migration',
      source, sourceRevision: source.head.saveRevision, seed: source.head.v43.head.state.seed }
    return sameStrictBoundedRaw(raw, lineage, RAW_LIMIT) ? lineage : null
  } catch { return null }
}

function decodeHead(raw: unknown, lineage: PublicV45Lineage): PublicV45Head | null {
  try {
    if (!raw || typeof raw !== 'object') return null
    const optional = OPTIONAL_KEYS.filter((key) => Object.hasOwn(raw, key))
    if (!exactPublicV23(raw, [...PUBLIC_V43_PROGRESS_KEYS, ...optional,
      'groundMount', 'tack', 'schemaVersion', 'saveRevision', 'witness'])
      || raw.schemaVersion !== PUBLIC_V45_SCHEMA
      || !Number.isSafeInteger(raw.saveRevision) || (raw.saveRevision as number) < 0) return null
    const progress = decodePublicV43Progress(Object.fromEntries(
      [...PUBLIC_V43_PROGRESS_KEYS, ...optional].map((key) => [key, raw[key]])))
    const mount = raw.groundMount
    if (!progress || progress.state.seed !== lineage.seed
      || !exactPublicV23(mount, ['mode', 'parkedPosition'])
      || mount.mode !== 'parked' && mount.mode !== 'riding'
      || mount.parkedPosition !== null && (!exactPublicV23(mount.parkedPosition,
        ['x', 'y', 'z']) || ![mount.parkedPosition.x, mount.parkedPosition.y,
        mount.parkedPosition.z].every(Number.isFinite))
      || raw.tack !== 'legacy' && raw.tack !== 'not_owned') return null
    if ((mount.mode === 'riding' || mount.parkedPosition !== null)
      && (progress.familiar.phase !== 'claimed'
        || projectPublicV43MountTraining(progress)?.mature !== true)) return null
    const witness = raw.saveRevision === 0 ? null : decodePublicV45Witness(raw.witness)
    if (raw.saveRevision === 0 ? raw.witness !== null : !witness) return null
    const head: PublicV45Head = { ...progress,
      groundMount: structuredClone(mount) as PublicV45Progress['groundMount'],
      tack: raw.tack as PublicV45Progress['tack'], schemaVersion: PUBLIC_V45_SCHEMA,
      saveRevision: raw.saveRevision as number, witness }
    return sameStrictBoundedRaw(raw, head, RAW_LIMIT) ? head : null
  } catch { return null }
}

function replayMatches(previous: PublicV45Head, head: PublicV45Head,
  rawHead: unknown): boolean {
  if (!head.witness || !Number.isSafeInteger(previous.saveRevision + 1)
    || head.saveRevision !== previous.saveRevision + 1) return false
  const checked = confirmPublicV45Action(progressOf(previous), head.witness)
  return !!checked.progress && sameStrictBoundedRaw(rawHead, {
    ...checked.progress, schemaVersion: PUBLIC_V45_SCHEMA,
    saveRevision: head.saveRevision, witness: head.witness }, RAW_LIMIT)
}

/** A retained two-head pair checks its latest edge, not evicted earlier history. */
export function decodePublicV45Root(raw: unknown): PublicV45Root | null {
  try {
    if (!exactPublicV23(raw, ['lineage', 'previous', 'head'])) return null
    const lineage = decodeLineage(raw.lineage)
    const head = lineage && decodeHead(raw.head, lineage)
    if (!lineage || !head) return null
    if (head.saveRevision === 0) return decodePublicV45Genesis(raw)
    const previous = decodeHead(raw.previous, lineage)
    const genesis = createPublicV45Genesis(lineage.source).head
    if (!previous || head.saveRevision !== previous.saveRevision + 1
      || !preservesGenesis(genesis, head, lineage.seed)
      || !preservesGenesis(genesis, previous, lineage.seed)
      || !publicV32Monotonic(previous, head)
      || !publicV43Monotonic(previous, head)) return null
    if (previous.saveRevision === 0 && !sameStrictBoundedRaw(raw.previous,
      genesis, RAW_LIMIT)) return null
    if (previous.saveRevision === 1 && !replayMatches(genesis, previous,
      raw.previous)) return null
    return replayMatches(previous, head, raw.head)
      ? { lineage, previous, head } : null
  } catch { return null }
}

/** The writer must present the exact old head and the complete replayed next head. */
export function decodePublicV45CheckedSuccessor(rawBefore: PublicV45Root,
  raw: unknown): PublicV45Root | null {
  try {
    const before = decodePublicV45Root(rawBefore)
    if (!before || !exactPublicV23(raw, ['lineage', 'previous', 'head'])
      || !sameStrictBoundedRaw(raw.lineage, before.lineage, RAW_LIMIT)
      || !sameStrictBoundedRaw(raw.previous, before.head, RAW_LIMIT)) return null
    const head = decodeHead(raw.head, before.lineage)
    const genesis = createPublicV45Genesis(before.lineage.source).head
    return head && preservesGenesis(genesis, head, before.lineage.seed)
      && publicV32Monotonic(before.head, head)
      && publicV43Monotonic(before.head, head)
      && replayMatches(before.head, head, raw.head)
      ? { lineage: before.lineage, previous: before.head, head } : null
  } catch { return null }
}
