import { preservesPublicV13History } from './publicV13History'
import { preservesPublicV17GreenwayWorks } from './publicWorldV17Validation'
import { samePublicV14Value } from './publicWorldV14Validation'
import { decodePublicV23Head, decodePublicV23Lineage, decodePublicV23Progress,
  exactPublicV23 } from './publicWorldV23Snapshot'
import type { PublicV23Head, PublicV23Lineage, PublicV23Progress,
  PublicV23Witness } from './publicWorldV23Snapshot'
import { decodePublicV23Witness, replayPublicV23Witness } from './publicWorldV23Transitions'
import { applyPublicV24MireglassAction, decodePublicV24MireglassAction } from './publicWorldV24MireglassAction'

export const PUBLIC_V24_SCHEMA = 'wizard-world/v24' as const
export const PUBLIC_V24_DATABASE_NAME = 'wizard-realms:world:v24'
export type PublicV24SourceReceipt = Readonly<{ head: PublicV23Head; lineage: PublicV23Lineage }>
export type PublicV24Lineage = Readonly<{ origin: 'v23-migration'; seed: string;
  rulesProfile: 'mireglass-actions/v1'; sourceReceipt: PublicV24SourceReceipt }>
export type PublicV24Progress = PublicV23Progress
export type PublicV24MireglassAction = NonNullable<ReturnType<typeof decodePublicV24MireglassAction>>
export type PublicV24Witness = PublicV23Witness | Readonly<{
  kind: 'mireglass-action/v1'; action: PublicV24MireglassAction }>
export type PublicV24Head = PublicV24Progress & Readonly<{
  schemaVersion: typeof PUBLIC_V24_SCHEMA; saveRevision: number; witness: PublicV24Witness | null }>
export type PublicV24Root = Readonly<{ lineage: PublicV24Lineage;
  head: PublicV24Head; previous: PublicV24Head | null }>

const progress = ({ state, greenwayWorks, regionalWorks }: PublicV24Progress): PublicV24Progress =>
  ({ state, greenwayWorks, regionalWorks })

/** A receipt shape proof. The flow must still inspect the complete live V23 root under lock. */
export function decodePublicV24SourceReceipt(value: unknown): PublicV24SourceReceipt | null {
  try {
    if (!exactPublicV23(value, ['head', 'lineage'])) return null
    const lineage = decodePublicV23Lineage(value.lineage)
    const head = lineage && decodePublicV23Head(value.head, lineage)
    return head && lineage ? { head, lineage } : null
  } catch { return null }
}

export function decodePublicV24Lineage(value: unknown): PublicV24Lineage | null {
  try {
    if (!exactPublicV23(value, ['origin', 'seed', 'rulesProfile', 'sourceReceipt'])
      || value.origin !== 'v23-migration' || value.rulesProfile !== 'mireglass-actions/v1'
      || typeof value.seed !== 'string' || !value.seed || value.seed.length > 128) return null
    const sourceReceipt = decodePublicV24SourceReceipt(value.sourceReceipt)
    return sourceReceipt?.head.state.seed === value.seed && sourceReceipt.lineage.seed === value.seed
      ? { origin: 'v23-migration', seed: value.seed, rulesProfile: 'mireglass-actions/v1', sourceReceipt }
      : null
  } catch { return null }
}

export function createPublicV24Root(rawSource: unknown): PublicV24Root {
  const sourceReceipt = decodePublicV24SourceReceipt(rawSource)
  if (!sourceReceipt) throw new RangeError('Invalid V23 source receipt')
  const lineage: PublicV24Lineage = { origin: 'v23-migration',
    seed: sourceReceipt.head.state.seed, rulesProfile: 'mireglass-actions/v1', sourceReceipt }
  const head: PublicV24Head = { ...structuredClone(progress(sourceReceipt.head)),
    schemaVersion: PUBLIC_V24_SCHEMA, saveRevision: 0, witness: null }
  return { lineage, head, previous: null }
}

export function decodePublicV24Witness(value: unknown): PublicV24Witness | null {
  try {
    const inherited = decodePublicV23Witness(value)
    if (inherited) return inherited
    if (!exactPublicV23(value, ['kind', 'action']) || value.kind !== 'mireglass-action/v1') return null
    const action = decodePublicV24MireglassAction(value.action)
    return action ? { kind: 'mireglass-action/v1', action: structuredClone(action) } : null
  } catch { return null }
}

export function replayPublicV24Witness(before: PublicV24Progress, rawWitness: unknown): PublicV24Progress | null {
  const witness = decodePublicV24Witness(rawWitness)
  if (!witness) return null
  if (witness.kind !== 'mireglass-action/v1') return replayPublicV23Witness(before, witness)
  const result = applyPublicV24MireglassAction(before, witness.action)
  return 'progress' in result ? decodePublicV23Progress(result.progress, before.state.seed) : null
}

export function decodePublicV24Head(value: unknown, lineage: PublicV24Lineage): PublicV24Head | null {
  try {
    if (!exactPublicV23(value, ['schemaVersion', 'saveRevision', 'state', 'greenwayWorks', 'regionalWorks', 'witness'])
      || value.schemaVersion !== PUBLIC_V24_SCHEMA || !Number.isSafeInteger(value.saveRevision)
      || (value.saveRevision as number) < 0) return null
    const owned = decodePublicV23Progress({ state: value.state, greenwayWorks: value.greenwayWorks,
      regionalWorks: value.regionalWorks }, lineage.seed)
    if (!owned) return null
    if (value.saveRevision === 0) return samePublicV14Value(value,
      createPublicV24Root(lineage.sourceReceipt).head) ? structuredClone(value) as PublicV24Head : null
    const witness = decodePublicV24Witness(value.witness)
    return witness ? { ...owned, schemaVersion: PUBLIC_V24_SCHEMA,
      saveRevision: value.saveRevision as number, witness } : null
  } catch { return null }
}

export function replayPublicV24Transition(before: PublicV24Head, after: PublicV24Head): boolean {
  return after.saveRevision === before.saveRevision + 1 && !!after.witness
    && samePublicV14Value(replayPublicV24Witness(progress(before), after.witness), progress(after))
}

/** Exact three-slot root proof, including the last complete replay and monotonic history. */
export function decodePublicV24Root(value: unknown): PublicV24Root | null {
  try {
    if (!exactPublicV23(value, ['lineage', 'head', 'previous'])) return null
    const lineage = decodePublicV24Lineage(value.lineage)
    const head = lineage && decodePublicV24Head(value.head, lineage)
    if (!lineage || !head) return null
    const previous = value.previous === null ? null : decodePublicV24Head(value.previous, lineage)
    if (head.saveRevision === 0 ? value.previous !== null
      : !previous || !replayPublicV24Transition(previous, head)) return null
    const genesis = createPublicV24Root(lineage.sourceReceipt).head
    const preserves = (prior: PublicV24Head, next: PublicV24Head) =>
      preservesPublicV13History(prior.state as never, next.state as never)
      && preservesPublicV17GreenwayWorks(prior.greenwayWorks, next.greenwayWorks, lineage.seed)
      && prior.regionalWorks.builtLadderIds.every((id) => next.regionalWorks.builtLadderIds.includes(id))
    return preserves(genesis, head) && (!previous || preserves(genesis, previous))
      ? { lineage, head, previous } : null
  } catch { return null }
}
