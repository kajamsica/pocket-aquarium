import { describe, expect, it } from 'vitest'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { createPublicV24Root } from './publicWorldV24Snapshot'
import { createPublicV25Root, decodePublicV25Root } from './publicWorldV25Snapshot'
import { createPublicV26Migration, decodePublicV26Lineage, decodePublicV26SourceReceipt,
  PUBLIC_V26_DATABASE_NAME, PUBLIC_V26_SCHEMA } from './publicWorldV26Migration'

const seed = 'wizard-realms'
function receipt() {
  const v23 = createPublicV23Root(seed)
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  return { head: v25.head, lineage: v25.lineage }
}

describe('V26 pinned V25 pure migration', () => {
  it('copies a genuine V25 genesis with exact lineage and zero rescue cooldown', () => {
    const source = receipt(), before = structuredClone(source)
    const migrated = createPublicV26Migration(source)
    expect([PUBLIC_V26_SCHEMA, PUBLIC_V26_DATABASE_NAME]).toEqual([
      'wizard-world/v26', 'wizard-realms:world:v26'])
    expect(migrated.lineage).toEqual({ origin: 'v25-migration', seed,
      rulesProfile: 'physical-starter-valley/v1', sourceReceipt: source })
    expect(migrated.progress).toEqual({ state: source.head.state,
      greenwayWorks: source.head.greenwayWorks, regionalWorks: source.head.regionalWorks,
      terrain: { columns: [], bag: source.head.excavation.bag }, nextHomeAtMs: 0 })
    expect(decodePublicV26Lineage(migrated.lineage)).toEqual(migrated.lineage)
    expect(migrated.progress.state).not.toBe(source.head.state)
    expect(migrated.lineage.sourceReceipt.head).not.toBe(source.head)
    expect(source).toEqual(before)
  })

  it('copies nonempty V25 shape provenance without claiming live-root validity', () => {
    const source = receipt()
    const excavation = { columns: [{ gx: 1, gz: 0, depth: 3 }],
      bag: { ...source.head.excavation.bag, stone: 2, iron_ore: 1 } }
    const shaped = { ...source, head: { ...source.head, saveRevision: 1,
      witness: { kind: 'checkpoint' as const }, excavation } }
    expect(decodePublicV26SourceReceipt(shaped)).not.toBeNull()
    expect(decodePublicV25Root({ ...shaped, previous: source.head })).toBeNull()
    const migrated = createPublicV26Migration(shaped)
    expect(migrated.progress.terrain).toEqual({ columns: [{ gx: 1, gz: 0,
      openDepth: 3, rewardDepth: 3, pitLadder: false }], bag: excavation.bag })
    expect(shaped.head.excavation).toEqual(excavation)
  })

  it('rejects an open home column without changing or discarding its source', () => {
    const source = receipt()
    const opened = { ...source, head: { ...source.head, saveRevision: 1,
      witness: { kind: 'checkpoint' as const }, excavation: {
        columns: [{ gx: 0, gz: 0, depth: 1 }], bag: { ...source.head.excavation.bag, soil: 1 } } } }
    const before = structuredClone(opened)
    expect(decodePublicV26SourceReceipt(opened)).not.toBeNull()
    expect(() => createPublicV26Migration(opened)).toThrow('open home column')
    expect(opened).toEqual(before)
  })

  it('rejects extra keys, seed/profile mismatch, malformed heads, and hostile input', () => {
    const source = receipt(), lineage = createPublicV26Migration(source).lineage
    expect(decodePublicV26SourceReceipt({ ...source, previous: null })).toBeNull()
    expect(decodePublicV26SourceReceipt({ ...source, head: { ...source.head,
      schemaVersion: PUBLIC_V26_SCHEMA } })).toBeNull()
    expect(decodePublicV26SourceReceipt({ ...source, head: { ...source.head,
      excavation: { ...source.head.excavation, columns: [{ gx: 0, gz: 0, depth: 0 }] } } })).toBeNull()
    expect(decodePublicV26Lineage({ ...lineage, seed: 'other' })).toBeNull()
    expect(decodePublicV26Lineage({ ...lineage, rulesProfile: 'other' })).toBeNull()
    expect(decodePublicV26Lineage({ ...lineage, extra: true })).toBeNull()
    expect(() => createPublicV26Migration({ ...source, previous: null })).toThrow(RangeError)
    const hostile = new Proxy(source, { get() { throw new Error('hostile') } })
    expect(decodePublicV26SourceReceipt(hostile)).toBeNull()
    expect(decodePublicV26Lineage(new Proxy(lineage, {
      get() { throw new Error('hostile') },
    }))).toBeNull()
    expect(() => createPublicV26Migration(hostile)).toThrow(RangeError)
  })
})
