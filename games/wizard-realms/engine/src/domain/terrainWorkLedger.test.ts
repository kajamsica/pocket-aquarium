import { describe, expect, it } from 'vitest'
import { resolveFieldCampSite } from './fieldCamp'
import { appendTerrainWorkLedger, emptyTerrainWorkLedger, isValidTerrainWorkLedger } from './terrainWorkLedger'
import type { TerrainWorkLedgerContext } from './terrainWorkLedger'
import { resolveTerrainWorkSite } from './terrainWorks'
import { worldTileAtGrid } from './worldChunks'

const seed = 'greenway-alpha'
const bridgeId = 'works1:bridge:-102:92:z'
const ladderId = 'works1:ladder:-103:108:W'
const digId = 'tile--64-76'
const context: TerrainWorkLedgerContext = { seed, fieldCampTileIds: [], authoredBuiltRouteIds: [] }
const ledger = (builtWorkIds: string[] = [], dugTileIds: string[] = []) => ({ builtWorkIds, dugTileIds })

describe('v13 sparse terrain-work ledger primitive', () => {
  it('has one exact frozen empty migration value and appends canonical sorted copies', () => {
    const empty = emptyTerrainWorkLedger()
    expect(empty).toEqual({ builtWorkIds: [], dugTileIds: [] })
    expect(Object.isFrozen(empty)).toBe(true)
    expect(Object.isFrozen(empty.builtWorkIds)).toBe(true)
    expect(emptyTerrainWorkLedger()).toBe(empty)
    expect(isValidTerrainWorkLedger(empty, context)).toBe(true)
    const ladder = appendTerrainWorkLedger(empty, ladderId, context)!
    const bridge = appendTerrainWorkLedger(ladder, bridgeId, context)!
    const dug = appendTerrainWorkLedger(bridge, digId, context)!
    expect(dug).toEqual({ builtWorkIds: [bridgeId, ladderId], dugTileIds: [digId] })
    expect(Object.isFrozen(dug.builtWorkIds)).toBe(true)
    expect(empty).toEqual({ builtWorkIds: [], dugTileIds: [] })
    expect(isValidTerrainWorkLedger(dug, context)).toBe(true)
    expect(appendTerrainWorkLedger(dug, bridgeId, context)).toBeNull()
  })

  it('rejects extra keys, sparse arrays, duplicates, wrong kinds, over-caps and malformed sites', () => {
    for (const invalid of [null, [], { ...ledger(), kit: {} },
      { builtWorkIds: [], dugTileIds: [], other: null },
      { builtWorkIds: [bridgeId, bridgeId], dugTileIds: [] },
      { builtWorkIds: [ladderId, bridgeId], dugTileIds: [] },
      { builtWorkIds: [digId], dugTileIds: [] },
      { builtWorkIds: [], dugTileIds: [bridgeId] },
      { builtWorkIds: ['works1:bridge:-0102:92:z'], dugTileIds: [] },
      { builtWorkIds: ['works1:bridge:0:0:z'], dugTileIds: [] },
      { builtWorkIds: [], dugTileIds: [worldTileAtGrid(seed, -102, 92).id] },
      ledger(Array.from({ length: 33 }, (_, i) => `works1:bridge:${i}:0:x`).sort()),
      ledger([], Array.from({ length: 65 }, (_, i) => `tile-${i}-0`).sort())]) {
      expect(isValidTerrainWorkLedger(invalid, context), JSON.stringify(invalid)).toBe(false)
      expect(appendTerrainWorkLedger(invalid, digId, context)).toBeNull()
    }
    const sparse = new Array<string>(1)
    expect(isValidTerrainWorkLedger(ledger(sparse), context)).toBe(false)
    const extraArray = [bridgeId] as string[] & { extra?: boolean }
    extraArray.extra = true
    expect(isValidTerrainWorkLedger(ledger(extraArray), context)).toBe(false)
    const symbolKey = { ...ledger(), [Symbol('extra')]: true }
    expect(isValidTerrainWorkLedger(symbolKey, context)).toBe(false)
  })

  it('rejects overlapping built works, digs and an existing field camp', () => {
    const bridge = resolveTerrainWorkSite(seed, bridgeId)
    if (!bridge || bridge.kind === 'dig') throw new Error('Missing bridge fixture.')
    const approachDig = bridge.footprintTileIds[0]
    expect(resolveTerrainWorkSite(seed, approachDig)?.kind).toBe('dig')
    expect(isValidTerrainWorkLedger(ledger([bridgeId], [approachDig]), context)).toBe(false)
    expect(appendTerrainWorkLedger(ledger([bridgeId]), approachDig, context)).toBeNull()
    const campId = worldTileAtGrid(seed, -76, 100).id
    expect(resolveFieldCampSite(seed, campId)).not.toBeNull()
    expect(resolveTerrainWorkSite(seed, campId)?.kind).toBe('dig')
    expect(isValidTerrainWorkLedger(ledger([], [campId]),
      { ...context, fieldCampTileIds: [campId] })).toBe(false)
    expect(isValidTerrainWorkLedger(emptyTerrainWorkLedger(),
      { ...context, fieldCampTileIds: [campId] })).toBe(true)
  })

  it('reserves the full constructed authored approach but not an unbuilt marker', () => {
    const routeId = 'mireglass_reach/route/fen_bridge/-98/92'
    const approachDig = 'tile--95-93'
    expect(resolveTerrainWorkSite(seed, approachDig)?.kind).toBe('dig')
    expect(isValidTerrainWorkLedger(ledger([], [approachDig]), context)).toBe(true)
    const builtContext = { ...context, authoredBuiltRouteIds: [routeId] }
    expect(isValidTerrainWorkLedger(ledger([], [approachDig]), builtContext)).toBe(false)
    expect(appendTerrainWorkLedger(emptyTerrainWorkLedger(), approachDig, builtContext)).toBeNull()
  })

  it('rejects invalid contexts and non-string append IDs without throwing', () => {
    const empty = emptyTerrainWorkLedger()
    for (const invalid of [null, {}, { ...context, seed: '' }, { ...context, seed: 7 },
      { ...context, fieldCampTileIds: ['invented'] },
      { ...context, authoredBuiltRouteIds: ['invented'] },
      { ...context, extra: true },
      { ...context, fieldCampTileIds: [digId, digId] }]) {
      expect(isValidTerrainWorkLedger(empty, invalid)).toBe(false)
      expect(appendTerrainWorkLedger(empty, digId, invalid)).toBeNull()
    }
    expect(appendTerrainWorkLedger(empty, { id: digId }, context)).toBeNull()
    expect(isValidTerrainWorkLedger(empty, new Proxy({}, { ownKeys: () => { throw Error('bad') } }))).toBe(false)
  })

  it('does not re-read a changing caller index after validating it', () => {
    let reads = 0
    const shifting = [bridgeId]
    Object.defineProperty(shifting, '0', { enumerable: true, configurable: true,
      get: () => ++reads <= 3 ? bridgeId : 'works1:bridge:0:0:z' })
    const appended = appendTerrainWorkLedger(ledger(shifting), ladderId, context)
    expect(appended).toBeNull()
    expect(reads).toBeLessThanOrEqual(1)
    let propertyReads = 0
    const proxy = new Proxy([bridgeId], { get(target, key, receiver) {
      if (key === '0') { propertyReads++; return 'works1:bridge:0:0:z' }
      return Reflect.get(target, key, receiver)
    } })
    const copied = appendTerrainWorkLedger(ledger(proxy), ladderId, context)
    expect(copied?.builtWorkIds).toEqual([bridgeId, ladderId])
    expect(propertyReads).toBe(0)
  })

  it('rejects nonenumerable or accessor-backed persisted keys and array indices', () => {
    const hiddenField = ledger([bridgeId])
    Object.defineProperty(hiddenField, 'builtWorkIds', { value: [bridgeId], enumerable: false })
    expect(isValidTerrainWorkLedger(hiddenField, context)).toBe(false)
    const accessorField = ledger([bridgeId])
    Object.defineProperty(accessorField, 'builtWorkIds', { get: () => [bridgeId], enumerable: true })
    expect(isValidTerrainWorkLedger(accessorField, context)).toBe(false)
    const hiddenIndex = [bridgeId]
    Object.defineProperty(hiddenIndex, '0', { value: bridgeId, enumerable: false })
    expect(isValidTerrainWorkLedger(ledger(hiddenIndex), context)).toBe(false)
  })
})
