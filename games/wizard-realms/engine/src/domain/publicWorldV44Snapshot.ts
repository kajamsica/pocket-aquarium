import { exactPublicV23 } from './publicWorldV23Snapshot'
import { decodePublicV43Root, decodePublicV43Witness } from './publicWorldV43Snapshot'
import type { PublicV43Root, PublicV43Witness } from './publicWorldV43Snapshot'
import { createPublicV44GroundMountProgress,
  decodePublicV44GroundMountProgress,
  decodePublicV44GroundMountSuccessor,
  decodePublicV44GroundMountWitness } from './publicWorldV44GroundMount'
import type { PublicV44GroundMountProgress,
  PublicV44GroundMountWitness } from './publicWorldV44GroundMount'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

export const PUBLIC_V44_SCHEMA = 'wizard-world/v44' as const
export const PUBLIC_V44_DATABASE_NAME = 'wizard-realms:world:v44'
export type PublicV44Witness = PublicV43Witness | PublicV44GroundMountWitness
export type PublicV44Lineage = Readonly<{
  origin: 'v43-migration'
  rulesProfile: 'ground-sedgehorn/v1'
  seed: string
  sourceRevision: number
  source: PublicV43Root
}>
export type PublicV44Head = PublicV44GroundMountProgress & Readonly<{
  schemaVersion: typeof PUBLIC_V44_SCHEMA
  saveRevision: number
  witness: PublicV44Witness | null
}>
export type PublicV44Root = Readonly<{
  lineage: PublicV44Lineage
  head: PublicV44Head
  previous: PublicV44Head | null
}>

const progressOf = (head: PublicV44Head): PublicV44GroundMountProgress =>
  ({ v43: head.v43, groundMount: head.groundMount })
const genesisHead = (lineage: PublicV44Lineage): PublicV44Head => ({
  v43: structuredClone(lineage.source), groundMount: { mode: 'parked',
    parkedPosition: null }, schemaVersion: PUBLIC_V44_SCHEMA,
  saveRevision: 0, witness: null,
})

/** V43 remains untouched. The complete checked source is pinned in lineage so
 * any later legacy write becomes a detectable import conflict. */
export function createPublicV44Root(rawSource: PublicV43Root): PublicV44Root {
  const source = decodePublicV43Root(rawSource)
  if (!source || !createPublicV44GroundMountProgress(source))
    throw new RangeError('Invalid checked V43 source root')
  const lineage: PublicV44Lineage = { origin: 'v43-migration',
    rulesProfile: 'ground-sedgehorn/v1', seed: source.head.state.seed,
    sourceRevision: source.head.saveRevision, source: structuredClone(source) }
  return { lineage, head: genesisHead(lineage), previous: null }
}

export function decodePublicV44Lineage(raw: unknown): PublicV44Lineage | null {
  try {
    if (!exactPublicV23(raw, ['origin', 'rulesProfile', 'seed',
      'sourceRevision', 'source']) || raw.origin !== 'v43-migration'
      || raw.rulesProfile !== 'ground-sedgehorn/v1'
      || typeof raw.seed !== 'string' || !raw.seed || raw.seed.length > 128
      || !Number.isSafeInteger(raw.sourceRevision)
      || (raw.sourceRevision as number) < 0) return null
    const source = decodePublicV43Root(raw.source)
    return source && source.head.state.seed === raw.seed
      && source.head.saveRevision === raw.sourceRevision
      ? { origin: 'v43-migration', rulesProfile: 'ground-sedgehorn/v1',
        seed: raw.seed, sourceRevision: raw.sourceRevision as number,
        source: structuredClone(source) } : null
  } catch { return null }
}

export function decodePublicV44Witness(raw: unknown): PublicV44Witness | null {
  const mount = decodePublicV44GroundMountWitness(raw)
  if (mount) return mount
  const inherited = decodePublicV43Witness(raw)
  // Return-home timestamps must still be minted by a future locked writer.
  return inherited?.kind === 'return-home/v1' ? null : inherited
}

function decodeHead(raw: unknown, lineage: PublicV44Lineage): PublicV44Head | null {
  try {
    if (!exactPublicV23(raw, ['v43', 'groundMount', 'schemaVersion',
      'saveRevision', 'witness']) || raw.schemaVersion !== PUBLIC_V44_SCHEMA
      || !Number.isSafeInteger(raw.saveRevision)
      || (raw.saveRevision as number) < 0) return null
    const progress = decodePublicV44GroundMountProgress({ v43: raw.v43,
      groundMount: raw.groundMount })
    if (!progress || progress.v43.head.state.seed !== lineage.seed
      || progress.v43.head.saveRevision < lineage.sourceRevision
      || !sameStrictBoundedRaw(progress.v43.lineage,
        lineage.source.lineage, 3 << 20)) return null
    if (raw.saveRevision === 0) return raw.witness === null
      && sameStrictBoundedRaw(raw, genesisHead(lineage), 3 << 20)
      ? genesisHead(lineage) : null
    const witness = decodePublicV44Witness(raw.witness)
    return witness ? { ...progress, schemaVersion: PUBLIC_V44_SCHEMA,
      saveRevision: raw.saveRevision as number, witness } : null
  } catch { return null }
}

/** Offline local storage is not anti-cheat proof of evicted history. The
 * retained pair and every new writer successor are strictly replay checked. */
export function decodePublicV44Root(raw: unknown): PublicV44Root | null {
  try {
    if (!exactPublicV23(raw, ['lineage', 'head', 'previous'])) return null
    const lineage = decodePublicV44Lineage(raw.lineage)
    const head = lineage && decodeHead(raw.head, lineage)
    const previous = lineage && raw.previous !== null
      ? decodeHead(raw.previous, lineage) : null
    if (!lineage || !head || head.saveRevision === 0 && raw.previous !== null
      || head.saveRevision > 0 && (!previous || !head.witness
        || head.saveRevision !== previous.saveRevision + 1)) return null
    if (!previous) return { lineage, head, previous: null }
    if (previous.saveRevision === 0 && !sameStrictBoundedRaw(
      previous, genesisHead(lineage), 3 << 20)) return null
    const replayed = decodePublicV44GroundMountSuccessor(
      progressOf(previous), head.witness, progressOf(head))
    return replayed ? { lineage, head, previous } : null
  } catch { return null }
}

export function decodePublicV44CheckedSuccessor(before: PublicV44Root,
  raw: unknown): PublicV44Root | null {
  try {
    if (!exactPublicV23(raw, ['lineage', 'head', 'previous'])
      || !sameStrictBoundedRaw(raw.lineage, before.lineage, 3 << 20)
      || !sameStrictBoundedRaw(raw.previous, before.head, 3 << 20)) return null
    const head = decodeHead(raw.head, before.lineage)
    if (!head || !head.witness
      || head.saveRevision !== before.head.saveRevision + 1
      || !decodePublicV44GroundMountSuccessor(
        progressOf(before.head), head.witness, progressOf(head))) return null
    return { lineage: before.lineage, previous: before.head, head }
  } catch { return null }
}
