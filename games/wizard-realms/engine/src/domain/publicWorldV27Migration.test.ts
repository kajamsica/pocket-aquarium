import { describe, expect, it } from 'vitest'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { createPublicV24Root } from './publicWorldV24Snapshot'
import { createPublicV25Root } from './publicWorldV25Snapshot'
import { createPublicV26Root } from './publicWorldV26Snapshot'
import { createPublicV27Migration, decodePublicV27Lineage, decodePublicV27SourceReceipt,
  PUBLIC_V27_DATABASE_NAME, PUBLIC_V27_SCHEMA } from './publicWorldV27Migration'

function source() {
  const v23 = createPublicV23Root('wizard-realms')
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  return { head: v26.head, lineage: v26.lineage }
}

describe('V27 pinned V26 migration', () => {
  it('copies exact V26 progress and provenance without mutating the source', () => {
    const receipt = source(), untouched = structuredClone(receipt)
    const migrated = createPublicV27Migration(receipt)
    expect([PUBLIC_V27_SCHEMA, PUBLIC_V27_DATABASE_NAME]).toEqual([
      'wizard-world/v27', 'wizard-realms:world:v27'])
    expect(migrated.lineage).toEqual({ origin: 'v26-migration', seed: 'wizard-realms',
      rulesProfile: 'connected-dry-ground/v1', sourceReceipt: receipt })
    expect(migrated.progress).toEqual({ state: receipt.head.state,
      greenwayWorks: receipt.head.greenwayWorks, regionalWorks: receipt.head.regionalWorks,
      terrain: receipt.head.terrain, nextHomeAtMs: receipt.head.nextHomeAtMs })
    expect(migrated.progress.state).not.toBe(receipt.head.state)
    expect(migrated.lineage.sourceReceipt.head).not.toBe(receipt.head)
    expect(decodePublicV27Lineage(migrated.lineage)).toEqual(migrated.lineage)
    expect(receipt).toEqual(untouched)
  })

  it('rejects extra keys, wrong source version, wrong profile, and hostile input', () => {
    const receipt = source(), lineage = createPublicV27Migration(receipt).lineage
    expect(decodePublicV27SourceReceipt({ ...receipt, previous: null })).toBeNull()
    expect(decodePublicV27SourceReceipt({ ...receipt, head: { ...receipt.head,
      schemaVersion: PUBLIC_V27_SCHEMA } })).toBeNull()
    expect(decodePublicV27Lineage({ ...lineage, seed: 'other' })).toBeNull()
    expect(decodePublicV27Lineage({ ...lineage, rulesProfile: 'other' })).toBeNull()
    expect(decodePublicV27Lineage({ ...lineage, extra: true })).toBeNull()
    expect(() => createPublicV27Migration({ ...receipt, previous: null })).toThrow(RangeError)
    const hostile = new Proxy(receipt, { get() { throw new Error('hostile') } })
    expect(decodePublicV27SourceReceipt(hostile)).toBeNull()
    expect(() => createPublicV27Migration(hostile)).toThrow(RangeError)
  })
})
