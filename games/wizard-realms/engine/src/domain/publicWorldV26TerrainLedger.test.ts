import { describe, expect, it } from 'vitest'
import { emptyPublicV25ExcavationLedger } from './publicWorldV25Excavation'
import { publicV25StratumAt } from './publicWorldV25Strata'
import { decodePublicV26TerrainLedger, digPublicV26Column, emptyPublicV26TerrainLedger,
  fillPublicV26Column, migratePublicV25ExcavationLedger, publicV26ColumnAt } from './publicWorldV26TerrainLedger'

const at = { seed: 'v26-ledger', gx: 0, gz: 160, eligible: true }
const dig = (ledger: unknown, changes = {}) => digPublicV26Column(ledger, { ...at, ...changes })
const fill = (ledger: unknown, changes = {}) => fillPublicV26Column(ledger, { ...at, ...changes })
const row = { gx: 0, gz: 160, openDepth: 1, rewardDepth: 1, pitLadder: false }

describe('V26 terrain ledger', () => {
  it('copies a nonempty V25 source without aliasing or discarding reward provenance', () => {
    const source = { columns: [{ gx: -1, gz: 160, depth: 3 }, { gx: 0, gz: 160, depth: 2 }],
      bag: { soil: 2, stone: 1, iron_ore: 0, gold_ore: 0, diamond: 0 } }
    const result = migratePublicV25ExcavationLedger(source)
    expect(result).toEqual({ columns: [
      { gx: -1, gz: 160, openDepth: 3, rewardDepth: 3, pitLadder: false },
      { gx: 0, gz: 160, openDepth: 2, rewardDepth: 2, pitLadder: false }], bag: source.bag })
    expect(result?.bag).not.toBe(source.bag)
    expect(result?.columns[0]).not.toBe(source.columns[0])
    expect(migratePublicV25ExcavationLedger(emptyPublicV25ExcavationLedger()))
      .toEqual(emptyPublicV26TerrainLedger())
    expect(migratePublicV25ExcavationLedger({ ...source, columns: [{ gx: 0, gz: 160, depth: 0 }] }))
      .toBeNull()
  })

  it('earns only novel seeded layers, including after fill and reload', () => {
    const empty = emptyPublicV26TerrainLedger()
    const first = dig(empty)
    if (!first.ok) throw new Error(first.reason)
    expect(first).toMatchObject({ layer: 0,
      material: publicV25StratumAt(at.seed, at.gx, at.gz, 0).material,
      ledger: { columns: [{ ...row }] } })
    expect(empty).toEqual(emptyPublicV26TerrainLedger())
    const second = dig(first.ledger)
    if (!second.ok) throw new Error(second.reason)
    expect(second.ledger.columns).toEqual([{ ...row, openDepth: 2, rewardDepth: 2 }])
    const soil = { ...second.ledger, bag: { ...second.ledger.bag, soil: 1 } }
    const filled = fill(soil)
    if (!filled.ok) throw new Error(filled.reason)
    expect(filled.ledger.columns).toEqual([{ ...row, openDepth: 1, rewardDepth: 2 }])
    expect(filled.ledger.bag.soil).toBe(0)
    const reloaded = JSON.parse(JSON.stringify(filled.ledger))
    const redig = dig(reloaded)
    if (!redig.ok) throw new Error(redig.reason)
    expect(redig).toMatchObject({ layer: 1, material: null,
      ledger: { columns: [{ ...row, openDepth: 2, rewardDepth: 2 }] } })
    expect(redig.ledger.bag).toEqual(filled.ledger.bag)
    expect(reloaded).toEqual(filled.ledger)
    const novel = dig(redig.ledger)
    if (!novel.ok) throw new Error(novel.reason)
    expect(novel).toMatchObject({ layer: 2,
      material: publicV25StratumAt(at.seed, at.gx, at.gz, 2).material,
      ledger: { columns: [{ ...row, openDepth: 3, rewardDepth: 3 }] } })
  })

  it('retains a fully filled row and its pit ladder marker', () => {
    const source = { ...emptyPublicV26TerrainLedger(), columns: [{ ...row, pitLadder: true }],
      bag: { ...emptyPublicV26TerrainLedger().bag, soil: 1 } }
    const result = fill(source)
    if (!result.ok) throw new Error(result.reason)
    expect(result.ledger.columns).toEqual([{ ...row, openDepth: 0, pitLadder: true }])
    expect(publicV26ColumnAt(result.ledger, 0, 160)).toEqual(result.ledger.columns[0])
    expect(publicV26ColumnAt(result.ledger, 1, 160)).toBeNull()
    expect(fill(result.ledger)).toMatchObject({ ok: false, reason: 'already-filled' })
    expect(dig(result.ledger)).toMatchObject({ ok: true, material: null,
      ledger: { columns: [{ ...row, pitLadder: true }] } })
    expect(source.bag.soil).toBe(1)
  })

  it('enforces bounds, bag limit, and explicit pure-operation eligibility', () => {
    const empty = emptyPublicV26TerrainLedger()
    expect(dig(empty, { eligible: false })).toMatchObject({ ok: false, reason: 'ineligible' })
    expect(fill(empty, { eligible: false })).toMatchObject({ ok: false, reason: 'ineligible' })
    expect(dig(empty, { gx: 256 })).toMatchObject({ ok: false, reason: 'invalid-request' })
    expect(fill(empty, { gx: -257 })).toMatchObject({ ok: false, reason: 'invalid-request' })
    expect(dig(empty, { seed: '' })).toMatchObject({ ok: false, reason: 'invalid-request' })
    expect(fill(empty)).toMatchObject({ ok: false, reason: 'already-filled' })
    expect(fill({ ...empty, columns: [row] })).toMatchObject({ ok: false, reason: 'requires-soil' })
    expect(dig({ ...empty, columns: [{ ...row, openDepth: 12, rewardDepth: 12 }] }))
      .toMatchObject({ ok: false, reason: 'bedrock' })
    const fullBag = { ...empty, bag: { ...empty.bag, soil: 256 } }
    expect(dig(fullBag)).toMatchObject({ ok: false, reason: 'bag-full' })
    expect(dig({ ...fullBag, columns: [{ ...row, openDepth: 0 }] }))
      .toMatchObject({ ok: true, material: null })
    const fullColumns = { ...empty, columns: Array.from({ length: 256 }, (_, i) =>
      ({ ...row, gx: i - 256 })) }
    expect(dig(fullColumns, { gx: 0 })).toMatchObject({ ok: false, reason: 'columns-full' })
  })

  it('strictly rejects malformed, duplicate, unsorted, sparse, and proxy saves', () => {
    const empty = emptyPublicV26TerrainLedger()
    const malformed = [{ ...empty, extra: true }, { ...empty, bag: { soil: 0 } },
      { ...empty, bag: { ...empty.bag, diamond: 257 } },
      { ...empty, bag: { ...empty.bag, soil: 200, stone: 57 } },
      { ...empty, columns: [{ ...row, openDepth: -1 }] },
      { ...empty, columns: [{ ...row, openDepth: 0, rewardDepth: 0 }] },
      { ...empty, columns: [{ ...row, openDepth: 2 }] },
      { ...empty, columns: [{ ...row, rewardDepth: 13 }] },
      { ...empty, columns: [{ ...row, pitLadder: 1 }] },
      { ...empty, columns: [{ ...row, gx: 256 }] },
      { ...empty, columns: [{ ...row, extra: 1 }] },
      { ...empty, columns: [row, row] },
      { ...empty, columns: [{ ...row, gx: 1 }, row] },
      { ...empty, columns: Array(1) },
      { ...empty, columns: Array.from({ length: 257 }, (_, i) => ({ ...row, gx: i - 256 })) },
      new Proxy(empty, {}), { ...empty, columns: [new Proxy(row, {})] }]
    for (const ledger of malformed) {
      expect(decodePublicV26TerrainLedger(ledger)).toBeNull()
      expect(dig(ledger)).toMatchObject({ ok: false, reason: 'invalid-ledger' })
      expect(fill(ledger)).toMatchObject({ ok: false, reason: 'invalid-ledger' })
    }
    expect(decodePublicV26TerrainLedger({ ...empty, columns: [{ ...row, openDepth: 0 }] }))
      .not.toBeNull()
  })
})
