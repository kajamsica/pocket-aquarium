import { describe, expect, it } from 'vitest'
import { publicV25StratumAt } from './publicWorldV25Strata'
import { publicV26TerrainConserved } from './publicWorldV26TerrainConservation'
import { digPublicV26Column, emptyPublicV26TerrainLedger,
  fillPublicV26Column } from './publicWorldV26TerrainLedger'

const seed = 'wizard-realms'
function soilCell() {
  for (let gz = -5; gz <= 1; gz += 1) for (let gx = -6; gx <= 6; gx += 1) {
    if ((gx !== 0 || gz !== 0) && publicV25StratumAt(seed, gx, gz, 0).material === 'soil') {
      return { gx, gz }
    }
  }
  throw new Error('No soil fixture')
}
function dig(ledger: ReturnType<typeof emptyPublicV26TerrainLedger>, gx: number, gz: number) {
  const result = digPublicV26Column(ledger, { seed, gx, gz, eligible: true })
  if (!result.ok) throw new Error(result.reason)
  return result.ledger
}

describe('V26 terrain structural conservation', () => {
  it('accepts a rewarded dig, soil-spending fill, and unrewarded re-dig', () => {
    const { gx, gz } = soilCell(), genesis = emptyPublicV26TerrainLedger()
    const opened = dig(genesis, gx, gz)
    expect(opened.bag.soil).toBe(1)
    expect(publicV26TerrainConserved(genesis, opened, seed)).toBe(true)
    const filled = fillPublicV26Column(opened, { gx, gz, eligible: true })
    if (!filled.ok) throw new Error(filled.reason)
    expect(filled.ledger.columns[0]).toMatchObject({ openDepth: 0, rewardDepth: 1 })
    expect(filled.ledger.bag.soil).toBe(0)
    expect(publicV26TerrainConserved(genesis, filled.ledger, seed)).toBe(true)
    const reopened = dig(filled.ledger, gx, gz)
    expect(reopened.bag.soil).toBe(0)
    expect(reopened.columns[0]).toMatchObject({ openDepth: 1, rewardDepth: 1 })
    expect(publicV26TerrainConserved(genesis, reopened, seed)).toBe(true)
  })

  it('counts only deterministic layers above each genesis reward high-water mark', () => {
    const { gx, gz } = soilCell(), empty = emptyPublicV26TerrainLedger()
    const genesis = dig(empty, gx, gz), deeper = dig(genesis, gx, gz)
    expect(deeper.columns[0].rewardDepth).toBe(2)
    expect(deeper.bag.soil).toBe(2)
    expect(publicV26TerrainConserved(genesis, deeper, seed)).toBe(true)
    expect(publicV26TerrainConserved(genesis, { ...deeper,
      bag: { ...deeper.bag, soil: 3 } }, seed)).toBe(false)
    expect(publicV26TerrainConserved(genesis, empty, seed)).toBe(false)
    expect(publicV26TerrainConserved(deeper, genesis, seed)).toBe(false)
  })

  it('rejects unearned material and any home excavation, even if filled', () => {
    const { gx, gz } = soilCell(), genesis = emptyPublicV26TerrainLedger()
    const opened = dig(genesis, gx, gz)
    expect(publicV26TerrainConserved(genesis, { ...genesis,
      bag: { ...genesis.bag, soil: 1 } }, seed)).toBe(false)
    expect(publicV26TerrainConserved(genesis, { ...opened,
      bag: { ...opened.bag, stone: 1 } }, seed)).toBe(false)
    const home = { ...genesis, columns: [{ gx: 0, gz: 0, openDepth: 0,
      rewardDepth: 1, pitLadder: false }] }
    expect(publicV26TerrainConserved(genesis, home, seed)).toBe(false)
    expect(publicV26TerrainConserved(home, home, seed)).toBe(false)
  })

  it('rejects invalid ledgers and seed without mutating either input', () => {
    const genesis = emptyPublicV26TerrainLedger()
    const candidate = { ...genesis, bag: { ...genesis.bag, soil: 1 } }
    const before = structuredClone(candidate)
    expect(publicV26TerrainConserved(genesis, candidate, '')).toBe(false)
    expect(publicV26TerrainConserved(genesis, { ...candidate, extra: true }, seed)).toBe(false)
    expect(candidate).toEqual(before)
  })
})
