import { describe, expect, it, vi } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import * as terrainSurface from './publicWorldV26TerrainSurface'
import { confirmPublicV28RiverBridge } from './publicWorldV28RiverBridgeAction'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import { createFreshPublicV40Root } from './publicWorldV40Snapshot'
import { confirmPublicV40WaystationAction as confirm,
  decodePublicV40WaystationProgress, decodePublicV40WaystationWitness as decode,
  previewPublicV40WaystationAction as preview } from './publicWorldV40WaystationAction'
import type { PublicV40WaystationProgress, PublicV40WaystationWitness } from './publicWorldV40WaystationAction'
import { createStreamedWorld } from './streamedWorld'
import { waystationRiverSite } from './waystationRiverContent'
import { worldTileAtGrid } from './worldChunks'

const seed = 'wizard-realms'
const site = waystationRiverSite(seed)!
const barter = { kind: 'waystation-barter/v1' } as const
const cross = { kind: 'waystation-cross/v1' } as const
const claim = { kind: 'waystation-claim/v1' } as const

function atNorth(stone = 2, extraTileIds: readonly string[] = []): PublicV40WaystationProgress {
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...base } = createFreshPublicV40Root(seed).head
  const ids = [...new Set([...decodeDiscoveredTileIds(base.state.discoveryMask),
    ...site.footprintTileIds, ...extraTileIds])].sort()
  return { ...base, state: { ...base.state, movementOwner: 'streamed',
    discoveryMask: encodeDiscoveredTileIds(ids),
    player: { ...base.state.player, position: { ...site.approach },
      inventory: [...base.state.player.inventory,
        ...(stone ? [{ itemId: 'stone' as const, quantity: stone }] : [])] } } }
}

function atPoint(progress: PublicV40WaystationProgress,
  point: Readonly<{ x: number; y: number; z: number }>,
  owner: 'greenway' | 'streamed' = 'streamed'): PublicV40WaystationProgress {
  return { ...progress, state: { ...progress.state, movementOwner: owner,
    player: { ...progress.state.player, position: { ...point }, verticalVelocity: 0 } } }
}

function accepted(progress: PublicV40WaystationProgress,
  witness: PublicV40WaystationWitness): PublicV40WaystationProgress {
  const result = confirm(progress, witness)
  expect(result.rejection).toBeUndefined()
  return result.progress!
}

function built(progress: PublicV40WaystationProgress): PublicV40WaystationProgress {
  const atFrom = atPoint(progress, site.from)
  const result = confirmPublicV28RiverBridge(atFrom, site.id)
  expect(result.rejection).toBeUndefined()
  expect(result.event?.logsSpent).toBe(8)
  return { ...atFrom, ...result.progress! }
}

function atStore(progress: PublicV40WaystationProgress): PublicV40WaystationProgress {
  const store = progress.state.greenway.stores.find(({ id }) => id === 'store-greenway')!
  return atPoint(progress, store.position, 'greenway')
}

describe('V40 Waystation physical action', () => {
  it('selects dry supported V28 crossings with reachable north approaches for both seeds', () => {
    for (const testSeed of [seed, 'greenway-alpha']) {
      const selected = waystationRiverSite(testSeed)!
      expect(selected.id).toBe('works6:river-bridge:20')
      expect(selected).toEqual(resolvePublicV28RiverBridge(testSeed, selected.id))
      const state = { ...atNorth().state, seed: testSeed, movementOwner: 'streamed' as const }
      for (const point of [selected.approach, selected.from, selected.to, selected.exit]) {
        const tile = worldTileAtGrid(testSeed, point.x / 4, point.z / 4)
        expect(tile.terrain).toBe('loam')
        expect(publicV25RiverCellAtGrid(testSeed, point.x / 4, point.z / 4)).toBeFalsy()
        expect(terrainSurface.publicV26TerrainCellIsWet(testSeed,
          point.x / 4, point.z / 4, 'streamed')).toBe(false)
        expect(resolvePublicV23Surface(state, point, [])?.floorY).toBeCloseTo(point.y)
      }
      const approach = selected.approach
      const points = [approach.z - 8, approach.z - 4, approach.z]
      const world = createStreamedWorld(testSeed, { x: approach.x, z: points[0] })
      for (let index = 1; index < points.length; index++) {
        const result = world.advance([{ type: 'move', delta: { x: 0,
          z: points[index] - points[index - 1] } }], { atomicOnRejection: true })
        expect(result.rejections).toEqual([])
        expect(result.state.player.position.z).toBe(points[index])
      }
    }
    expect(confirm(atNorth(), barter).rejection).toBeUndefined()
  })

  it('accepts only exact cloneable kind-only witnesses and strict progress', () => {
    for (const witness of [barter, cross, claim]) expect(decode(witness)).toEqual(witness)
    for (const forged of [null, { kind: 'waystation-barter/v1', logs: 800 },
      { kind: 'waystation-cross/v1', bridgeId: site.id },
      { kind: 'waystation-claim/v1', coins: 45 },
      { kind: 'waystation-barter/v2' }, new Proxy(barter, {}),
      Object.create({ kind: barter.kind }),
      Object.defineProperty({}, 'kind', { enumerable: true, get: () => barter.kind })]) {
      expect(decode(forged)).toBeNull()
      expect(confirm(atNorth(), forged)).toEqual({ rejection: 'invalid_value' })
    }
    expect(decodePublicV40WaystationProgress({ ...atNorth(), waystationClaimed: true }))
      .toBeNull()
    expect(decodePublicV40WaystationProgress({ ...atNorth(), extra: true })).toBeNull()
  })

  it('rejects remote, airborne, wet and open-pit barter sources', () => {
    const ready = atNorth()
    expect(confirm(atPoint(ready, site.from), barter)).toEqual({ rejection: 'too_far' })
    expect(confirm({ ...ready, state: { ...ready.state,
      player: { ...ready.state.player, verticalVelocity: 1 } } }, barter).progress)
      .toBeUndefined()
    const wet = vi.spyOn(terrainSurface, 'publicV26TerrainCellIsWet').mockReturnValue(true)
    try { expect(confirm(ready, barter)).toEqual({ rejection: 'unsafe_source' }) }
    finally { wet.mockRestore() }
    const pit = { ...ready, terrain: { ...ready.terrain,
      columns: [{ gx: 20, gz: site.approach.z / 4,
        openDepth: 1, rewardDepth: 1, pitLadder: false }] } }
    expect(confirm(pit, barter).rejection).toBe('unsafe_source')
  })

  it('barters exactly two owned stone into eight logs once, with no reward or inventory aliasing', () => {
    const before = atNorth()
    const exchanged = accepted(before, barter)
    expect(before.state.player.inventory).toContainEqual({ itemId: 'stone', quantity: 2 })
    expect(exchanged.state.player.inventory).not.toContainEqual({ itemId: 'stone', quantity: 2 })
    expect(exchanged.state.player.inventory).toContainEqual({ itemId: 'logs', quantity: 8 })
    expect(exchanged.state.player.coins).toBe(before.state.player.coins)
    expect(exchanged.state.player.xp).toBe(before.state.player.xp)
    expect(exchanged.state.eventSequence).toBe(before.state.eventSequence + 1)
    expect(confirm(exchanged, barter)).toEqual({ rejection: 'already_bartered' })
    expect(preview(exchanged, barter).rejection).toBe('already_bartered')
    expect(confirm(atNorth(0), barter)).toEqual({ rejection: 'not_owned' })
    const full = { ...before, state: { ...before.state,
      player: { ...before.state.player, backpackCapacity: 3 } } }
    expect(confirm(full, barter)).toEqual({ rejection: 'capacity' })
    const directLogs = { ...atNorth(0), state: { ...before.state,
      player: { ...before.state.player, inventory: [
        ...before.state.player.inventory.filter(({ itemId }) => itemId !== 'stone'),
        { itemId: 'logs' as const, quantity: 8 }] } } }
    expect(confirm(atPoint(built(directLogs), site.approach), barter))
      .toEqual({ rejection: 'already_built' })
  })

  it('requires the selected saved bridge and a physical far-bank exit before crossing', () => {
    const ready = atNorth()
    expect(confirm(atPoint(ready, site.exit), cross)).toEqual({ rejection: 'not_built' })
    const other = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:19')!
    const wrong = atNorth(2, other.footprintTileIds)
    const wrongBridge = atPoint({ ...wrong, riverBridgeIds: [other.id] }, site.exit)
    expect(confirm(wrongBridge, cross)).toEqual({ rejection: 'not_built' })
    const repaired = built(accepted(ready, barter))
    expect(confirm(atPoint(repaired, site.approach), cross)).toEqual({ rejection: 'too_far' })
    const far = accepted(atPoint(repaired, site.exit), cross)
    expect(far.southbankReached).toBe(true)
    expect(far.state.eventSequence).toBe(repaired.state.eventSequence + 1)
    expect(confirm(far, cross)).toEqual({ rejection: 'already_crossed' })
  })

  it('requires the Outfitters return, pays exactly 45/45/45 once and refuses overflow', () => {
    const ready = atNorth()
    expect(confirm(atStore(ready), claim)).toEqual({ rejection: 'requires_crossing' })
    const repaired = built(accepted(ready, barter))
    const far = accepted(atPoint(repaired, site.exit), cross)
    expect(confirm(far, claim)).toEqual({ rejection: 'wrong_region' })
    const returned = atStore(far)
    const done = accepted(returned, claim)
    expect(done.state.player.coins - returned.state.player.coins).toBe(45)
    expect(done.state.player.skillXp.wayfinding - returned.state.player.skillXp.wayfinding)
      .toBe(45)
    expect(done.state.player.xp - returned.state.player.xp).toBe(45)
    expect(done.state.player.level).toBe(1 + Math.floor(done.state.player.xp / 100))
    expect(done.state.eventSequence).toBe(returned.state.eventSequence + 1)
    expect(confirm(done, claim)).toEqual({ rejection: 'already_claimed' })
    const overflow = { ...returned, state: { ...returned.state,
      player: { ...returned.state.player, coins: Number.MAX_SAFE_INTEGER } } }
    expect(confirm(overflow, claim).progress).toBeUndefined()
  })
})
