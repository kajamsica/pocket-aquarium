import { exactPublicV23 } from './publicWorldV23Snapshot'
import { publicV32Monotonic, publicV32Preserves } from './publicWorldV32Snapshot'
import { PUBLIC_V43_PROGRESS_KEYS } from './publicWorldV43FamiliarAction'
import { decodePublicV43Progress, decodePublicV43Witness,
  publicV43Monotonic } from './publicWorldV43Snapshot'
import type { PublicV43Witness } from './publicWorldV43Snapshot'
import { projectPublicV43MountTraining } from './publicWorldV43MountTraining'
import type { PublicV45MountWitness } from './publicWorldV45MountTransition'
import { confirmPublicV45Action, decodePublicV45RideBatchWitness,
  decodePublicV45RideFrameWitness } from './publicWorldV45RideAction'
import type { PublicV45Progress, PublicV45RideWitness } from './publicWorldV45RideAction'
import type { PublicWorldEvent } from './publicWorldRuntime'
import { createPublicV45GenesisFromCheckedSource, PUBLIC_V45_SCHEMA }
  from './publicWorldV45Migration'
import type { PublicV45Lineage } from './publicWorldV45Migration'
import { decodePublicV44Root } from './publicWorldV44Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

export type PublicV45Witness = PublicV45RideWitness | PublicV45MountWitness
  | Readonly<{ kind: 'buy-sedgehorn-tack/v1' }>
  | Readonly<{ kind: 'sell-marsh-herb/v1'; quantity: number }>
  | PublicV43Witness
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
type PreparedRideBatch = Readonly<{ before: PublicV45Root; candidate: PublicV45Root;
  proof: object }>
const preparedRideBatches = new WeakMap<object, PreparedRideBatch>()
const OPTIONAL_KEYS = ['mountTraining', 'greenwayOrder', 'greenwayBagUpgrade'] as const
const progressOf = ({ schemaVersion: _schema, saveRevision: _revision,
  witness: _witness, ...progress }: PublicV45Head): PublicV45Progress => progress
const tackMonotonic = (before: PublicV45Head, after: PublicV45Head) =>
  before.tack === 'not_owned'
    ? after.tack === 'not_owned' || after.tack === 'purchased'
    : after.tack === before.tack
const preservesGenesis = (genesis: PublicV45Head, head: PublicV45Head,
  seed: string) => publicV32Preserves(genesis, head, seed)
  && publicV32Monotonic(genesis, head)
  && publicV43Monotonic(genesis, head)
  && (!genesis.mountTraining || !!head.mountTraining
    && genesis.mountTraining.careWitnesses.length
      <= head.mountTraining.careWitnesses.length
    && sameStrictBoundedRaw(genesis.mountTraining.careWitnesses,
      head.mountTraining.careWitnesses.slice(0,
        genesis.mountTraining.careWitnesses.length), RAW_LIMIT))
  && tackMonotonic(genesis, head)

/** Accept exact V45 mount-economy witnesses or an existing V43 ordinary witness. */
export function decodePublicV45Witness(raw: unknown): PublicV45Witness | null {
  try {
    const batch = decodePublicV45RideBatchWitness(raw)
    if (batch) return batch
    if (exactPublicV23(raw, ['kind'])) {
      if (raw.kind === 'sedgehorn-mount/v1'
        || raw.kind === 'sedgehorn-dismount/v1'
        || raw.kind === 'buy-sedgehorn-tack/v1') return { kind: raw.kind }
    }
    if (exactPublicV23(raw, ['kind', 'quantity'])
      && raw.kind === 'sell-marsh-herb/v1'
      && Number.isSafeInteger(raw.quantity)
      && (raw.quantity as number) >= 1 && (raw.quantity as number) <= 256)
      return { kind: raw.kind, quantity: raw.quantity as number }
    return decodePublicV45RideFrameWitness(raw) ?? decodePublicV43Witness(raw)
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
      || raw.tack !== 'legacy' && raw.tack !== 'not_owned'
        && raw.tack !== 'purchased') return null
    if (raw.tack === 'not_owned'
      && (mount.mode !== 'parked' || mount.parkedPosition !== null)) return null
    if ((mount.mode === 'riding' || mount.parkedPosition !== null
      || raw.tack === 'purchased')
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
    const genesis = createPublicV45GenesisFromCheckedSource(lineage.source).head
    if (head.saveRevision === 0) return raw.previous === null
      && sameStrictBoundedRaw(raw.head, genesis, RAW_LIMIT)
      ? { lineage, previous: null, head } : null
    const previous = decodeHead(raw.previous, lineage)
    if (!previous || head.saveRevision !== previous.saveRevision + 1
      || !preservesGenesis(genesis, head, lineage.seed)
      || !preservesGenesis(genesis, previous, lineage.seed)
      || !tackMonotonic(previous, head)
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
  const before = decodePublicV45Root(rawBefore)
  return before ? decodePublicV45SuccessorOfCheckedRoot(before, raw) : null
}

/** Only a private checked-read proof may supply before without redecoding it. */
export function decodePublicV45SuccessorOfCheckedRoot(before: PublicV45Root,
  raw: unknown): PublicV45Root | null {
  return successorOfCheckedRoot(before, raw, false)
}

/** Replay exactly once while preparing a batch, before any durable-write shortcut. */
export function preparePublicV45RideBatch(before: PublicV45Root,
  rawWitness: unknown, proof: object): Readonly<{ candidate: PublicV45Root; certificate: object;
    events: readonly PublicWorldEvent[] }> | null {
  try {
    const witness = decodePublicV45RideBatchWitness(rawWitness)
    if (!witness || !Number.isSafeInteger(before.head.saveRevision + 1)) return null
    const action = confirmPublicV45Action(progressOf(before.head), witness)
    if (!action.progress) return null
    const candidate: PublicV45Root = { lineage: before.lineage, previous: before.head,
      head: { ...action.progress, schemaVersion: PUBLIC_V45_SCHEMA,
        saveRevision: before.head.saveRevision + 1, witness } }
    const certificate = {}
    preparedRideBatches.set(certificate, { before: structuredClone(before),
      candidate: structuredClone(candidate), proof })
    return { candidate, certificate, events: action.events }
  } catch { return null }
}

/** Only the atomic store's private checked-read root can redeem this one-use proof. */
export function decodePublicV45PreparedRideBatchSuccessor(before: PublicV45Root,
  raw: unknown, certificate: object, proof: object): PublicV45Root | null {
  const prepared = preparedRideBatches.get(certificate)
  preparedRideBatches.delete(certificate)
  try {
    return prepared && proof === prepared.proof
      && sameStrictBoundedRaw(before, prepared.before, RAW_LIMIT)
      && sameStrictBoundedRaw(raw, prepared.candidate, RAW_LIMIT)
      ? successorOfCheckedRoot(before, raw, true) : null
  } catch { return null }
}

function successorOfCheckedRoot(before: PublicV45Root, raw: unknown,
  preparedBatch: boolean): PublicV45Root | null {
  try {
    if (!exactPublicV23(raw, ['lineage', 'previous', 'head'])
      || !sameStrictBoundedRaw(raw.lineage, before.lineage, RAW_LIMIT)
      || !sameStrictBoundedRaw(raw.previous, before.head, RAW_LIMIT)) return null
    const head = decodeHead(raw.head, before.lineage)
    const genesis = createPublicV45GenesisFromCheckedSource(before.lineage.source).head
    return head && head.saveRevision === before.head.saveRevision + 1
      && preservesGenesis(genesis, head, before.lineage.seed)
      && tackMonotonic(before.head, head)
      && publicV32Monotonic(before.head, head)
      && publicV43Monotonic(before.head, head)
      && (preparedBatch || replayMatches(before.head, head, raw.head))
      ? { lineage: before.lineage, previous: before.head, head } : null
  } catch { return null }
}
