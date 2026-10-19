import { describe, expect, it } from 'vitest'
import { decodePublicV25ExcavationLedger, digPublicV25Column,
  emptyPublicV25ExcavationLedger } from './publicWorldV25Excavation'
import { publicV25RiverCenterZ, publicV25RiverCellAtGrid } from './publicWorldV25River'
import { publicV25StratumAt } from './publicWorldV25Strata'
const request = { seed: 'strata-terrain', gx: 0, gz: 160, tool: 'spade' as const,
  excavationLevel: 1, backpackCapacity: 300, legacyCarriedCount: 0,
  reservedCount: 0, reachable: true, revealed: true }
const dig = (ledger: unknown, changes = {}) => digPublicV25Column(ledger, { ...request, ...changes })
describe('V25 excavation ledger', () => {
  it('progresses one stable layer and reward per action without mutating the source', () => {
    const empty = emptyPublicV25ExcavationLedger()
    const first = dig(empty)
    expect(first).toMatchObject({ ok: true, material: 'soil', layer: 0, ledger: {
      columns: [{ gx: 0, gz: 160, depth: 1 }], bag: { soil: 1 } } })
    expect(empty).toEqual(emptyPublicV25ExcavationLedger())
    if (!first.ok) return
    const saved = JSON.parse(JSON.stringify(first.ledger))
    const second = dig(saved)
    expect(second).toMatchObject({ ok: true, material: 'soil', layer: 1, ledger: {
      columns: [{ gx: 0, gz: 160, depth: 2 }], bag: { soil: 2 } } })
    expect(saved).toEqual(first.ledger)
    const other = dig(first.ledger, { gx: -1 })
    if (!other.ok) throw new Error(other.reason)
    expect(other.ledger.columns).toEqual([{ gx: -1, gz: 160, depth: 1 }, { gx: 0, gz: 160, depth: 1 }])
    expect(dig(other.ledger)).toMatchObject({ ok: true, material: 'soil', layer: 1 })
    if (!second.ok) throw new Error(second.reason)
    expect(dig(second.ledger, { tool: 'pick', excavationLevel: 2 })).toMatchObject({ ok: true, layer: 2, material: 'stone', ledger: { columns: [{ gx: 0, gz: 160, depth: 3 }], bag: { soil: 2, stone: 1 } } })
  })
  it('enforces tool, skill, wet, reach, reveal, bedrock, and capacity gates', () => {
    const empty = emptyPublicV25ExcavationLedger()
    expect(dig(empty, { gx: 160, gz: -160 })).toMatchObject({ ok: false, reason: 'tool' })
    expect(dig(empty, { gx: 160, gz: -160, tool: 'pick' })).toMatchObject({ ok: false, reason: 'skill' })
    expect(dig(empty, { gx: 160, gz: -160, tool: 'enchanted_pick', excavationLevel: 2 })).toMatchObject({ ok: true, material: 'stone' })
    for (const [changes, reason] of [[{ revealed: false }, 'unrevealed'],
      [{ reachable: false }, 'unreachable'],
      [{ gz: publicV25RiverCenterZ(request.seed, 0) }, 'wet']] as const) {
      expect(dig(empty, changes)).toMatchObject({ ok: false, reason })
    }
    expect(dig({ ...empty, columns: [{ gx: 0, gz: 160, depth: 12 }] }, { tool: 'enchanted_pick', excavationLevel: 25 }))
      .toMatchObject({ ok: false, reason: 'bedrock' })
    expect(dig(empty, { backpackCapacity: 2, legacyCarriedCount: 1, reservedCount: 1 })).toMatchObject({ ok: false, reason: 'capacity' })
    expect(dig({ ...empty, bag: { ...empty.bag, soil: 1 } }, { backpackCapacity: 1 })).toMatchObject({ ok: false, reason: 'capacity' })
    expect(dig({ ...empty, bag: { ...empty.bag, soil: 256 } })).toMatchObject({ ok: false, reason: 'bag-full' })
  })
  it('rejects malformed, unsorted, duplicate, oversized, and proxy ledgers', () => {
    const empty = emptyPublicV25ExcavationLedger()
    const row = { gx: 0, gz: 160, depth: 1 }
    const bad = [{ ...empty, extra: 1 }, { ...empty, columns: [row, row] },
      { ...empty, columns: [{ ...row, gx: 1 }, row] }, { ...empty, columns: [{ ...row, depth: 0 }] },
      { ...empty, columns: [{ ...row, gx: 256 }] }, { ...empty, bag: { ...empty.bag, soil: 257 } },
      { ...empty, bag: { ...empty.bag, soil: 1.5 } }, { ...empty, bag: { soil: 0 } },
      { ...empty, bag: { ...empty.bag, clay: 0 } },
      { ...empty, bag: { ...empty.bag, soil: 200, stone: 57 } },
      { ...empty, columns: Array(1) },
      { ...empty, columns: Array.from({ length: 257 }, (_, i) => ({ gx: i - 256, gz: 160, depth: 1 })) },
      new Proxy(empty, {}), { ...empty, columns: [new Proxy(row, {})] }]
    for (const ledger of bad) { expect(decodePublicV25ExcavationLedger(ledger)).toBeNull(); expect(dig(ledger).ok).toBe(false) }
    const full = { ...empty, columns: Array.from({ length: 256 }, (_, i) => ({ gx: i - 256, gz: 160, depth: 1 })) }
    expect(decodePublicV25ExcavationLedger(full)).not.toBeNull()
    expect(dig(full)).toMatchObject({ ok: false, reason: 'columns-full' })
  })
  it('keeps failed actions and hostile requests from changing the source ledger', () => {
    const empty = emptyPublicV25ExcavationLedger()
    const source = { ...empty, columns: [{ gx: 0, gz: 160, depth: 1 }],
      bag: { ...empty.bag, soil: 1 } }
    const before = structuredClone(source)
    for (const changes of [{ revealed: false }, { reachable: false },
      { gz: publicV25RiverCenterZ(request.seed, 0) }, { tool: null },
      { backpackCapacity: 1 }]) {
      expect(dig(source, changes).ok).toBe(false)
      expect(source).toEqual(before)
    }
    const hostile = new Proxy(request, { get() { throw new Error('hostile request') } })
    expect(digPublicV25Column(source, hostile)).toMatchObject({ ok: false, reason: 'invalid-request' })
    expect(source).toEqual(before)
    expect(dig(empty, { material: 'diamond' })).toMatchObject({ ok: true, material: 'soil' })
  })
  it('derives deeper gold and diamond only from seeded strata, including after reload', () => {
    const found = new Map<'gold_ore' | 'diamond', { gx: number; gz: number }>()
    for (let gx = -32; gx <= 32; gx += 1) for (let gz = -32; gz <= 32; gz += 1) {
      if (publicV25RiverCellAtGrid(request.seed, gx, gz)) continue
      const material = publicV25StratumAt(request.seed, gx, gz, 8).material
      if ((material === 'gold_ore' || material === 'diamond') && !found.has(material)) {
        found.set(material, { gx, gz })
      }
    }
    expect(found.size).toBe(2)
    for (const material of ['gold_ore', 'diamond'] as const) {
      const point = found.get(material)
      if (!point) throw new Error(`No seeded ${material} stratum found`)
      const empty = emptyPublicV25ExcavationLedger()
      const source = { ...empty, columns: [{ ...point, depth: 8 }] }
      const changes = { ...point, tool: 'enchanted_pick', excavationLevel: 25 }
      const result = dig(source, changes)
      expect(result).toMatchObject({ ok: true, material, layer: 8, ledger: {
        columns: [{ ...point, depth: 9 }], bag: { [material]: 1 } } })
      expect(dig(JSON.parse(JSON.stringify(source)), changes)).toEqual(result)
      expect(source.columns[0].depth).toBe(8)
    }
  })
})
