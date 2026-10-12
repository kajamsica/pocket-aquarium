import type { createAtomicV14Store, AtomicV14CheckedRead, AtomicV14Read,
  AtomicV14Record, AtomicV14Write } from './atomicV14Database'
import type { createAtomicV15Store, AtomicV15Read } from './atomicV15Database'
import { decodePublicV14Head, decodePublicV14Lineage } from './publicWorldV14Snapshot'
import type { PublicV14Lineage } from './publicWorldV14Snapshot'
import { decodePublicV15Head, decodePublicV15Lineage,
  encodePublicV15Head, PUBLIC_V15_RULES_PROFILE,
  publicV15ToV14Head, publicV15ToV14Lineage } from './publicWorldV15Snapshot'
import type { PublicV15Head, PublicV15Lineage } from './publicWorldV15Snapshot'

type Store = ReturnType<typeof createAtomicV15Store>
type CompatStore = ReturnType<typeof createAtomicV14Store>

export function publicV14ToV15Lineage(value: unknown): PublicV15Lineage | null {
  const old = decodePublicV14Lineage(value)
  return old ? { ...old, rulesProfile: PUBLIC_V15_RULES_PROFILE } : null
}

function convertRecord(raw: unknown, lineage: PublicV15Lineage | null): unknown {
  if (raw === null) return null
  if (!lineage || raw === null || typeof raw !== 'object') return raw
  const record = raw as { saveRevision?: unknown; value?: unknown }
  const head = decodePublicV15Head(record.value, lineage)
  return head ? { saveRevision: record.saveRevision, value: publicV15ToV14Head(head) } : raw
}

function convertRead(raw: AtomicV15Read): AtomicV14Read {
  if (raw.status !== 'ok') return raw
  const lineage = decodePublicV15Lineage(raw.lineage)
  return { status: 'ok', head: convertRecord(raw.head, lineage),
    previous: convertRecord(raw.previous, lineage),
    lineage: lineage ? publicV15ToV14Lineage(lineage) : raw.lineage }
}

/**
 * Temporary P28-A compatibility boundary. The v14 replay engine sees only the
 * inert core. The v15 store persists an independent schema and preserves the
 * v15 starter-work overlay across old-compatible frames and actions. P28-C
 * must replace this adapter for starter-work commits and v15 movement rules.
 */
export function createPublicV15V14Adapter(store: Store): CompatStore {
  const issued = new WeakMap<object, { head: PublicV15Head | null;
    lineage: PublicV15Lineage | null }>()
  return {
    async read() { return convertRead(await store.read()) },
    async readChecked(): Promise<AtomicV14CheckedRead> {
      const raw = await store.readChecked()
      if (raw.status !== 'ok') return { status: 'storage-error' }
      const converted = convertRead(raw)
      if (converted.status !== 'ok') return { status: 'storage-error' }
      const lineage = decodePublicV15Lineage(raw.lineage)
      const headRecord = raw.head as { value?: unknown } | null
      const previousRecord = raw.previous as { value?: unknown } | null
      const head = lineage && headRecord ? decodePublicV15Head(headRecord.value, lineage) : null
      const previous = lineage && previousRecord
        ? decodePublicV15Head(previousRecord.value, lineage) : null
      if (raw.proof) issued.set(raw.proof, { head, lineage })
      return { ...converted,
        decodedHead: head ? publicV15ToV14Head(head) : null,
        decodedPrevious: previous ? publicV15ToV14Head(previous) : null,
        decodedLineage: lineage ? publicV15ToV14Lineage(lineage) : null,
        proof: raw.proof }
    },
    async commit(expectedRevision: number | null, expectedLineage: unknown,
      next: AtomicV14Record, initialLineage: unknown, proof: object): Promise<AtomicV14Write> {
      const snapshot = issued.get(proof)
      issued.delete(proof)
      if (!snapshot) return 'invalid'
      const oldLineage: PublicV14Lineage | null = expectedRevision === null
        ? decodePublicV14Lineage(initialLineage) : decodePublicV14Lineage(expectedLineage)
      const lineage = oldLineage && publicV14ToV15Lineage(oldLineage)
      if (!lineage || expectedRevision === null && snapshot.head !== null
        || expectedRevision !== null && (!snapshot.head || !snapshot.lineage
          || snapshot.head.saveRevision !== expectedRevision
          || snapshot.lineage.seed !== lineage.seed)) return 'invalid'
      const oldHead = decodePublicV14Head(next.value, oldLineage)
      if (!oldHead || oldHead.saveRevision !== next.saveRevision) return 'invalid'
      let head: PublicV15Head
      try {
        head = encodePublicV15Head(oldHead.state, oldHead.saveRevision, lineage,
          oldHead.frameWitness, snapshot.head?.starterWorks,
          snapshot.head?.resourceClearance)
      } catch { return 'invalid' }
      return store.commit(expectedRevision,
        expectedRevision === null ? null : snapshot.lineage,
        { saveRevision: head.saveRevision, value: head },
        expectedRevision === null ? lineage : undefined, proof)
    },
  }
}

/** A native v15 session can be projected into the old, replayable core only. */
export function publicV15StartToV14(start: {
  state: PublicV15Head['state']; saveRevision: number; lineage: PublicV15Lineage; bootstrap: null
}) {
  return { state: start.state, saveRevision: start.saveRevision, bootstrap: null as null,
    lineage: publicV15ToV14Lineage(start.lineage) }
}

export function publicV14StartToV15(start: {
  state: PublicV15Head['state']; saveRevision: number; lineage: PublicV14Lineage; bootstrap: null
}): { state: PublicV15Head['state']; saveRevision: number; lineage: PublicV15Lineage; bootstrap: null } {
  const lineage = publicV14ToV15Lineage(start.lineage)
  if (!lineage) throw new RangeError('A v14-compatible writer returned an invalid lineage.')
  return { ...start, lineage }
}
