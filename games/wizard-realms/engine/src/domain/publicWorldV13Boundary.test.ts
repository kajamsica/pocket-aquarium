import { describe, expect, it } from 'vitest'
import { terrainHeightAt } from './generation'
import { DISCOVERY_MASK_BYTES, discoveryMaskHasTileId, encodeDiscoveredTileIds } from './discoveryMask'
import { createFreshPublicWorld } from './publicWorldState'
import { withFreshPublicV7Herbs } from './publicWorldV7'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { encodePublicV11Head, PUBLIC_V11_SCHEMA } from './publicWorldV11Snapshot'
import { withPublicV11Highland } from './publicWorldV11State'
import { createPublicV13MigrationHead, decodePublicV13Head, PUBLIC_V13_SCHEMA } from './publicWorldV13Snapshot'
import type { PublicV13Head } from './publicWorldV13Snapshot'
import type { PublicV13Start } from './publicWorldV13Flow'
import { advancePublicV13OutboundBoundary, advancePublicV13ReturnBoundary } from './publicWorldV13Boundary'
import { createPublicV13GreenwaySession } from './publicWorldV13GreenwayFrame'
import { appendTerrainWorkLedger } from './terrainWorkLedger'
import { worldTileAtGrid } from './worldChunks'

const seed = 'greenway-alpha'
type Profile = 'greenway-classic-v1' | 'greenway-expanded-v1'
function startAt(profile: Profile, x: number, z = 0, extras?: {
  tick?: number; boots?: boolean; listing?: boolean }, worldSeed = seed): PublicV13Start {
  const fresh = createFreshPublicWorld(worldSeed, profile)
  const v11 = withPublicV11Highland(withPublicV10TerrainRevision(withFreshPublicV9Camps(
    withFreshPublicV7Herbs(fresh))))
  const position = { x, y: terrainHeightAt(v11.greenway.tiles, x, z), z }
  const tileId = worldTileAtGrid(worldSeed, Math.ceil(x / 4 - .5), Math.ceil(z / 4 - .5)).id
  const tradeSlots: typeof v11.player.tradeSlots = [
    { ...v11.player.tradeSlots[0], itemId: 'logs', quantity: 1, unitPrice: 2 },
    v11.player.tradeSlots[1], v11.player.tradeSlots[2], v11.player.tradeSlots[3],
  ]
  const player = { ...v11.player, position,
    inventory: extras?.boots ? [...v11.player.inventory, { itemId: 'leather_boots' as const,
      quantity: 1 }] : v11.player.inventory,
    equipment: { ...v11.player.equipment, feet: extras?.boots ? 'leather_boots' as const : null },
    tradeSlots: extras?.listing ? tradeSlots : v11.player.tradeSlots }
  const state = { ...v11, tick: extras?.tick ?? v11.tick, player,
    discoveredTileIds: [...new Set([...v11.discoveredTileIds, tileId])].sort() }
  const sourceLineage = { sourceSchemaVersion: PUBLIC_V11_SCHEMA,
    sourceHead: encodePublicV11Head(state, null, 0) } as const
  const zero = createPublicV13MigrationHead(sourceLineage)!
  return { state: zero.state, bootstrap: zero.bootstrap, saveRevision: zero.saveRevision,
    sourceLineage }
}
const move = (x: number, z = 0) => ({ type: 'move' as const, delta: { x, z } })
const advance = (base: PublicV13Start, current: PublicV13Head['state'], dx: number,
  walkRequested = false) => advancePublicV13OutboundBoundary(base, current,
    [move(dx)], { walkRequested })

describe('unmounted v13 outbound boundary', () => {
  it.each([['greenway-classic-v1', -12], ['greenway-expanded-v1', -30]] as const)(
    'crosses %s at revision zero without inventing a saved revision', (profile, edge) => {
      const base = startAt(profile, edge)
      expect(base.saveRevision).toBe(0)
      const before = structuredClone(base)
      const result = advance(base, base.state, -.16)
      expect(result.rejections).toEqual([])
      expect(result.candidate?.movementOwner).toBe('streamed')
      expect(result.candidate?.tick).toBe(base.state.tick + 1)
      expect(result.events.map((event) => event.sequence))
        .toEqual(result.events.map((_, index) => base.state.eventSequence + index + 1))
      const revealed = result.events.filter((event) => event.type === 'tile_discovered')
      expect(revealed.length).toBeGreaterThan(0)
      for (const event of revealed) {
        if (event.type === 'tile_discovered') {
          expect(discoveryMaskHasTileId(result.candidate!.discoveryMask, event.tileId)).toBe(true)
        }
      }
      expect(result.candidate?.eventSequence).toBe(base.state.eventSequence + result.events.length)
      expect(result.candidate?.windstep).toEqual(base.state.windstep)
      expect(result.candidate?.terrainWorks).toEqual(base.state.terrainWorks)
      expect(base).toEqual(before)
      expect(decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
        saveRevision: base.saveRevision + 1, bootstrap: base.bootstrap,
        state: result.candidate }, base.sourceLineage)).not.toBeNull()
    })

  it('accepts a real unsaved Greenway frame against the original revision-zero base', () => {
    const base = startAt('greenway-classic-v1', -11.84)
    const session = createPublicV13GreenwaySession(base)
    expect(session.advance([move(-.16)], { walkRequested: false }).rejections).toEqual([])
    const current = session.snapshotForSave()
    expect(current.player.position.x).toBeCloseTo(-12)
    expect(base.saveRevision).toBe(0)
    const result = advance(base, current, -.16)
    expect(result.rejections).toEqual([])
    expect(result.candidate?.tick).toBe(current.tick + 1)
    expect(base.saveRevision).toBe(0)
  })

  it('rejects invalid look, barefoot overstep, and an in-Greenway move atomically', () => {
    const base = startAt('greenway-classic-v1', -12)
    const before = structuredClone(base)
    const invalid = advancePublicV13OutboundBoundary(base, base.state,
      [{ type: 'look', yawDelta: Infinity, pitchDelta: 0 }, move(-.16)],
      { walkRequested: false })
    expect(invalid.rejections).toMatchObject([{ code: 'invalid_value', intentIndex: 0 }])
    expect(invalid.candidate).toBeNull()
    expect(invalid.events).toEqual([])
    expect(advancePublicV13OutboundBoundary(base, base.state, [], { walkRequested: false }).rejections)
      .toMatchObject([{ code: 'invalid_frame', intentIndex: 0 }])
    expect(advance(base, base.state, -.24).rejections).toMatchObject([{ code: 'invalid_value' }])
    expect(advance(base, base.state, .16).rejections).toMatchObject([{ code: 'unavailable_here' }])
    expect(base).toEqual(before)
    const booted = startAt('greenway-classic-v1', -12, 0, { boots: true })
    expect(advance(booted, booted.state, -.24).rejections).toEqual([])
    expect(advance(booted, booted.state, -.24, true).rejections)
      .toMatchObject([{ code: 'invalid_value' }])
  })

  it('preserves dense remote discovery bits and does not materialize world IDs', () => {
    const base = startAt('greenway-classic-v1', -12)
    const current = { ...base.state, discoveryMask: new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff) }
    const result = advance(base, current, -.16)
    expect(result.rejections).toEqual([])
    expect(result.events.filter((event) => event.type === 'tile_discovered')).toEqual([])
    expect(result.candidate?.discoveryMask).toEqual(current.discoveryMask)
    expect(discoveryMaskHasTileId(result.candidate!.discoveryMask, 'tile-100-100')).toBe(true)
    expect('discoveredTileIds' in result.candidate!).toBe(false)
  })

  it('commits one look and move tick, RNG step, and due market settlement', () => {
    const base = startAt('greenway-classic-v1', -12, 0, { tick: 599, listing: true })
    const before = structuredClone(base)
    const result = advancePublicV13OutboundBoundary(base, base.state,
      [{ type: 'look', yawDelta: .1, pitchDelta: .02 }, move(-.16)],
      { walkRequested: false })
    expect(result.rejections).toEqual([])
    expect(result.events.slice(0, 2).map((event) => event.type))
      .toEqual(['player_looked', 'player_moved'])
    expect(result.events.some((event) => event.type === 'trade_listing_sold')).toBe(true)
    expect(result.candidate?.tick).toBe(600)
    expect(result.candidate?.player.tradeSlots[0].itemId).toBeNull()
    expect(result.candidate?.player.coins).toBe(before.state.player.coins + 2)
    expect(result.candidate?.player.yaw).toBeCloseTo(before.state.player.yaw + .1)
    let rng = before.state.rng.simulation | 0
    rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5
    expect(result.candidate?.rng.simulation).toBe(rng >>> 0 || 1)
    expect(result.candidate?.eventSequence).toBe(result.events.at(-1)?.sequence)
    expect(base).toEqual(before)
  })

  it('rejects a wet exterior edge while keeping a dry crossing available', () => {
    const outcomes: Array<{ z: number; code: string }> = []
    for (let z = -12; z <= 12; z += 4) {
      try {
        const base = startAt('greenway-classic-v1', -12, z)
        const result = advance(base, base.state, -.16)
        outcomes.push({ z, code: result.rejections[0]?.code ?? 'passed' })
      } catch { outcomes.push({ z, code: 'invalid-source' }) }
    }
    expect(outcomes).toContainEqual({ z: 0, code: 'passed' })
    expect(outcomes.some(({ code }) => code === 'terrain_missing')).toBe(true)
  })

  it('carries a validated built bridge, steep ladder, and dug-height ledger across the edge', () => {
    const base = startAt('greenway-classic-v1', -12)
    const context = { seed, fieldCampTileIds: [], authoredBuiltRouteIds: [] }
    let ledger = base.state.terrainWorks
    for (const id of ['works1:bridge:-102:92:z', 'works1:ladder:-103:108:W', 'tile--64-76']) {
      ledger = appendTerrainWorkLedger(ledger, id, context)!
      expect(ledger).not.toBeNull()
    }
    const current = { ...base.state, terrainWorks: ledger }
    expect(decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA, saveRevision: 1,
      bootstrap: base.bootstrap, state: current }, base.sourceLineage)).not.toBeNull()
    const result = advance(base, current, -.16)
    expect(result.rejections).toEqual([])
    expect(result.candidate?.terrainWorks).toEqual(ledger)
    expect(result.candidate?.player.position.x).toBeLessThan(-12)
  })
})

describe('unmounted v13 return boundary', () => {
  it.each([['greenway-classic-v1', -12], ['greenway-expanded-v1', -30]] as const)(
    'returns across the %s edge from an unsaved revision-zero outbound candidate', (profile, edge) => {
      const base = startAt(profile, edge)
      const before = structuredClone(base)
      const outbound = advance(base, base.state, -.16)
      expect(outbound.rejections).toEqual([])
      const current = outbound.candidate!
      const returned = advancePublicV13ReturnBoundary(base, current, [move(.16)],
        { walkRequested: false })
      expect(returned.rejections).toEqual([])
      expect(returned.candidate?.movementOwner).toBe('greenway')
      expect(returned.candidate?.player.position.x).toBeCloseTo(edge)
      expect(returned.candidate?.tick).toBe(current.tick + 1)
      expect(returned.events.map((event) => event.sequence))
        .toEqual(returned.events.map((_, index) => current.eventSequence + index + 1))
      for (const event of returned.events) {
        if (event.type === 'tile_discovered') {
          expect(discoveryMaskHasTileId(returned.candidate!.discoveryMask, event.tileId)).toBe(true)
        }
      }
      expect(returned.candidate?.eventSequence).toBe(current.eventSequence + returned.events.length)
      expect(returned.candidate?.terrainWorks).toEqual(current.terrainWorks)
      expect(returned.candidate?.windstep).toEqual(current.windstep)
      expect(base).toEqual(before)
      expect(decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
        saveRevision: 1, bootstrap: base.bootstrap, state: returned.candidate },
      base.sourceLineage)).not.toBeNull()
    })

  it('settles a due trade listing on return and retains compact remote discovery', () => {
    const base = startAt('greenway-classic-v1', -12, 0, { tick: 598, listing: true })
    const outbound = advance(base, base.state, -.16)
    expect(outbound.rejections).toEqual([])
    const current = { ...outbound.candidate!,
      discoveryMask: new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff) }
    const before = structuredClone(current)
    const result = advancePublicV13ReturnBoundary(base, current,
      [{ type: 'look', yawDelta: .1, pitchDelta: .02 }, move(.16)],
      { walkRequested: false })
    expect(result.rejections).toEqual([])
    expect(result.events.slice(0, 2).map((event) => event.type))
      .toEqual(['player_looked', 'player_moved'])
    expect(result.events.some((event) => event.type === 'trade_listing_sold')).toBe(true)
    expect(result.events.filter((event) => event.type === 'tile_discovered')).toEqual([])
    expect(result.candidate?.tick).toBe(600)
    expect(result.candidate?.player.coins).toBe(current.player.coins + 2)
    expect(result.candidate?.player.tradeSlots[0].itemId).toBeNull()
    expect(result.candidate?.discoveryMask).toEqual(current.discoveryMask)
    expect(discoveryMaskHasTileId(result.candidate!.discoveryMask, 'tile-100-100')).toBe(true)
    expect('discoveredTileIds' in result.candidate!).toBe(false)
    expect(result.candidate?.player.yaw).toBeCloseTo(current.player.yaw + .1)
    let rng = current.rng.simulation | 0
    rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5
    expect(result.candidate?.rng.simulation).toBe(rng >>> 0 || 1)
    expect(current).toEqual(before)
  })

  it('rejects malformed, overlong, wrong-direction, and locked-area returns atomically', () => {
    const base = startAt('greenway-classic-v1', -12)
    const outbound = advance(base, base.state, -.16)
    const current = outbound.candidate!
    const before = structuredClone(current)
    const invalid = advancePublicV13ReturnBoundary(base, current,
      [{ type: 'look', yawDelta: Infinity, pitchDelta: 0 }, move(.16)],
      { walkRequested: false })
    expect(invalid.rejections).toMatchObject([{ code: 'invalid_value', intentIndex: 0 }])
    expect(invalid.candidate).toBeNull()
    expect(invalid.events).toEqual([])
    expect(advancePublicV13ReturnBoundary(base, base.state, [move(.16)],
      { walkRequested: false }).rejections).toMatchObject([{ code: 'unavailable_here' }])
    for (const [intents, code] of [
      [[move(.4)], 'invalid_value'],
      [[move(-.16)], 'unavailable_here'],
      [[{ type: 'teleport_fairy_ring', sourceRingId: 'ring-greenway',
        targetRingId: 'mireglass-reach/fairy-ring' }], 'invalid_frame'],
    ] as const) {
      const result = advancePublicV13ReturnBoundary(base, current,
        intents as readonly import('./publicWorldRuntime').PublicWorldIntent[],
        { walkRequested: false })
      expect(result.rejections).toMatchObject([{ code }])
      expect(result.candidate).toBeNull()
      expect(result.events).toEqual([])
    }
    expect(current).toEqual(before)
    const northBase = startAt('greenway-classic-v1', 0, -12)
    const northOut = advancePublicV13OutboundBoundary(northBase, northBase.state,
      [move(0, -.16)], { walkRequested: false })
    expect(northOut.rejections).toEqual([])
    const blocked = advancePublicV13ReturnBoundary(northBase, northOut.candidate!,
      [move(0, .16)], { walkRequested: false })
    expect(blocked.rejections).toMatchObject([{ code: 'locked_area' }])
    expect(blocked.events).toEqual([])
    expect(blocked.candidate).toBeNull()
  })

  it('uses the same booted run and walk-toggle gait on return', () => {
    const base = startAt('greenway-classic-v1', -12, 0, { boots: true })
    const outbound = advance(base, base.state, -.24)
    expect(outbound.rejections).toEqual([])
    const current = outbound.candidate!
    expect(advancePublicV13ReturnBoundary(base, current, [move(.24)],
      { walkRequested: false }).rejections).toEqual([])
    expect(advancePublicV13ReturnBoundary(base, current, [move(.24)],
      { walkRequested: true }).rejections).toMatchObject([{ code: 'invalid_value' }])
  })

  it('carries validated remote terrain works unchanged on return', () => {
    const base = startAt('greenway-classic-v1', -12)
    const outbound = advance(base, base.state, -.16)
    let ledger = outbound.candidate!.terrainWorks
    const context = { seed, fieldCampTileIds: [], authoredBuiltRouteIds: [] }
    for (const id of ['works1:bridge:-102:92:z', 'works1:ladder:-103:108:W', 'tile--64-76']) {
      ledger = appendTerrainWorkLedger(ledger, id, context)!
    }
    const withWork = { ...outbound.candidate!, terrainWorks: ledger }
    const returned = advancePublicV13ReturnBoundary(base, withWork, [move(.16)],
      { walkRequested: false })
    expect(returned.rejections).toEqual([])
    expect(returned.candidate?.terrainWorks).toEqual(ledger)
  })

  it('rejects a dry-endpoint diagonal that touches one wet side cell at the expanded seam', () => {
    const cornerSeed = 'corner-0'
    const sourceTile = worldTileAtGrid(cornerSeed, -8, 1)
    const targetTile = worldTileAtGrid(cornerSeed, -7, 0)
    expect(sourceTile.terrain).not.toBe('wetland')
    expect(targetTile.terrain).not.toBe('wetland')
    expect(worldTileAtGrid(cornerSeed, -7, 1).terrain).toBe('wetland')
    const base = startAt('greenway-expanded-v1', -29.95, 1.95, undefined, cornerSeed)
    const mask = new Uint8Array(base.state.discoveryMask)
    const bit = encodeDiscoveredTileIds([sourceTile.id])
    for (let index = 0; index < mask.length; index++) mask[index] |= bit[index]
    const current = { ...base.state, movementOwner: 'streamed' as const,
      tick: base.state.tick + 1, discoveryMask: mask,
      player: { ...base.state.player, position: { x: -30.05,
        y: Math.max(base.state.player.position.y, sourceTile.center.y), z: 2.05 } } }
    expect(decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA, saveRevision: 1,
      bootstrap: base.bootstrap, state: current }, base.sourceLineage)).not.toBeNull()
    const before = structuredClone(current)
    const result = advancePublicV13ReturnBoundary(base, current, [move(.1, -.1)],
      { walkRequested: false })
    expect(result.rejections).toMatchObject([{ code: 'terrain_missing', intentIndex: 0 }])
    expect(result.candidate).toBeNull()
    expect(result.events).toEqual([])
    expect(current).toEqual(before)
  })
})
