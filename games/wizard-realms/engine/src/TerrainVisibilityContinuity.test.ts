/** Authority and visible-ground continuity at owner, chunk, and physical world edges. */
import { describe, expect, it, vi } from 'vitest'
import { createPublicV42ControllerRuntime } from './PublicV42ControllerRuntime'
import { publicWorldV23ViewProjection } from './PublicV23WorldView'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { nearbyWorldTileIds } from './domain/publicWorldDiscovery'
import * as streamTerrain from './domain/publicWorldV14Terrain'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { createFreshPublicV42Root, replayPublicV42Witness } from './domain/publicWorldV42Snapshot'
import type { PublicV42Start } from './domain/publicWorldV42Flow'
import { resolveTerrainWorkSite } from './domain/terrainWorks'
import { worldTileAtGrid } from './domain/worldChunks'

const seed = 'wizard-realms'
const move = (x: number, z = 0) => [{ type: 'move' as const, delta: { x, z } }]
const tileAt = (x: number, z: number) => worldTileAtGrid(seed,
  Math.ceil(x / 4 - 0.5), Math.ceil(z / 4 - 0.5)).id

function at(point: { x: number; z: number }, owner: 'greenway' | 'streamed' = 'streamed',
  write: Parameters<typeof createPublicV42ControllerRuntime>[1] =
    async () => ({ ok: false, reason: 'not-called' })) {
  const root = createFreshPublicV42Root(seed)
  const state = root.head.state
  const support = owner === 'greenway' ? publicV17StarterSupportAt({ seed,
    profile: state.generationProfile,
    route: state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
    built: false, greenwayWorks: root.head.greenwayWorks }, point)
    : resolvePublicV23Surface(state, point, root.head.regionalWorks.builtLadderIds)
  if (!support) throw new Error(`No support for ${owner} at ${point.x},${point.z}`)
  const discoveryMask = encodeDiscoveredTileIds([...new Set([
    ...decodeDiscoveredTileIds(state.discoveryMask), ...nearbyWorldTileIds(point, 24),
  ])].sort())
  const head = { ...root.head, state: { ...state, movementOwner: owner,
    discoveryMask, player: { ...state.player,
      position: { ...point, y: support.floorY } } } }
  return createPublicV42ControllerRuntime({ ...root, head }, write)
}

function checkedRuntime(start: PublicV42Start) {
  let runtime: ReturnType<typeof createPublicV42ControllerRuntime>
  runtime = createPublicV42ControllerRuntime(start, async (revision, lineage, witness) => {
    const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
      ...before } = runtime.committed().head
    const next = replayPublicV42Witness(before, witness)
    if (!next) return { ok: false, reason: 'local-replay' }
    return { ok: true, value: { lineage, head: { ...next,
      schemaVersion: start.head.schemaVersion, saveRevision: revision + 1, witness } } }
  })
  return runtime
}

function projected(runtime: ReturnType<typeof at>) {
  const active = runtime.view()
  return publicWorldV23ViewProjection(runtime.preview(), active, [], null, null, false,
    { kind: 'bridge', bodyYaw: active.player.yaw, aimX: null, aimZ: null,
      modeActive: false, actionsEnabled: false })
}

describe('V42 terrain and visibility continuity without a renderer', () => {
  it('reuses one detached streamed tile window while pose and discovery stay current', () => {
    const runtime = at({ x: 80, z: 28 })
    const generate = vi.spyOn(streamTerrain, 'createPublicV23StreamTerrain')
    try {
      const cold = runtime.view()
      expect(generate).toHaveBeenCalledOnce()
      generate.mockClear()
      const warm = runtime.view()
      expect(generate).not.toHaveBeenCalled()
      expect(warm).toEqual(cold)
      expect(warm.activeTiles).not.toBe(cold.activeTiles)
      const callerCenter = warm.activeTiles[0].center as { y: number }
      callerCenter.y += 10
      expect(runtime.view().activeTiles[0]).toEqual(cold.activeTiles[0])
      expect(runtime.advanceFrame([{ type: 'look', yawDelta: 0.1, pitchDelta: 0 }], false)
        .rejections).toEqual([])
      generate.mockClear()
      const turned = runtime.view()
      expect(generate).not.toHaveBeenCalled()
      expect(turned.tick).toBe(cold.tick + 1)
      expect(turned.player.yaw).not.toBe(cold.player.yaw)
      expect(runtime.advanceFrame(move(0.16), false).rejections).toEqual([])
      generate.mockClear()
      const moved = runtime.view()
      expect(generate).not.toHaveBeenCalled()
      expect(moved.player.position.x).toBeCloseTo(80.16)
      expect(moved.activeKnownTileIds).toEqual(runtime.view().activeKnownTileIds)
      expect(moved.activeTiles).toEqual(streamTerrain.createPublicV23StreamTerrain(
        runtime.preview().state, runtime.preview().regionalWorks.builtLadderIds).activeTiles())
    } finally { generate.mockRestore() }
  })

  it('regenerates exactly once at a 64 m seam and after a checked save', async () => {
    const seedRoot = createFreshPublicV42Root(seed)
    const point = { x: 63.95, z: 28 }
    const surface = resolvePublicV23Surface(seedRoot.head.state, point,
      seedRoot.head.regionalWorks.builtLadderIds)
    if (!surface) throw new Error('Missing seam support')
    const discoveryMask = encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(seedRoot.head.state.discoveryMask),
      ...nearbyWorldTileIds(point, 24),
    ])].sort())
    const start = { lineage: seedRoot.lineage, head: { ...seedRoot.head,
      state: { ...seedRoot.head.state, movementOwner: 'streamed' as const,
        discoveryMask, player: { ...seedRoot.head.state.player,
          position: { ...point, y: surface.floorY } } } } }
    const runtime = checkedRuntime(start)
    const generate = vi.spyOn(streamTerrain, 'createPublicV23StreamTerrain')
    try {
      runtime.view()
      generate.mockClear()
      expect(runtime.advanceFrame(move(0.1), false).rejections).toEqual([])
      generate.mockClear()
      const crossed = runtime.view()
      expect(generate).toHaveBeenCalledOnce()
      expect(crossed.activeTiles).toEqual(streamTerrain.createPublicV23StreamTerrain(
        runtime.preview().state, runtime.preview().regionalWorks.builtLadderIds).activeTiles())
      generate.mockClear()
      runtime.view()
      expect(generate).not.toHaveBeenCalled()
      expect(await runtime.save()).toMatchObject({ status: 'saved' })
      generate.mockClear()
      expect(runtime.view().activeTiles).toEqual(crossed.activeTiles)
      expect(generate).toHaveBeenCalledOnce()
      expect(runtime.status().pendingFrames).toBe(0)
    } finally { generate.mockRestore() }
  }, 30_000)

  it('invalidates the streamed window after a checked terrain dig', async () => {
    const root = createFreshPublicV42Root(seed)
    const site = resolveTerrainWorkSite(seed, 'tile--64-76')
    if (!site || site.kind !== 'dig') throw new Error('Missing canonical dig site')
    const point = { x: site.center.x + 2.5, z: site.center.z }
    const floor = resolvePublicV23Surface(root.head.state, point,
      root.head.regionalWorks.builtLadderIds)
    if (!floor) throw new Error('Missing dig approach support')
    const start: PublicV42Start = { lineage: root.lineage, head: { ...root.head,
      state: { ...root.head.state, tick: 1, movementOwner: 'streamed' as const,
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(root.head.state.discoveryMask), floor.tileId,
          ...site.footprintTileIds,
        ])].sort()),
        player: { ...root.head.state.player, position: { ...point, y: floor.floorY },
          backpackCapacity: 30,
          inventory: [...root.head.state.player.inventory.filter((stack) =>
            stack.itemId !== 'logs' && stack.itemId !== 'field_spade'),
          { itemId: 'field_spade', quantity: 1 }],
          equipment: { ...root.head.state.player.equipment, mainHand: 'field_spade' } } } } }
    const runtime = checkedRuntime(start)
    const generate = vi.spyOn(streamTerrain, 'createPublicV23StreamTerrain')
    try {
      const before = runtime.view()
      generate.mockClear()
      expect(await runtime.action({ kind: 'legacy-work', id: site.id }))
        .toMatchObject({ status: 'saved' })
      expect(runtime.preview().state.terrainWorks.dugTileIds).toContain(site.id)
      generate.mockClear()
      const after = runtime.view()
      expect(generate).toHaveBeenCalledOnce()
      expect(after.activeTiles).not.toEqual(before.activeTiles)
      expect(after.activeTiles).toEqual(streamTerrain.createPublicV23StreamTerrain(
        runtime.preview().state, runtime.preview().regionalWorks.builtLadderIds).activeTiles())
    } finally { generate.mockRestore() }
  }, 30_000)
  it('accepts an Iron Hall step while keeping the next ground tile visible', () => {
    const runtime = at({ x: 80, z: 28 })
    const nextTile = tileAt(84, 28)
    expect(projected(runtime).visualWorld?.terrain.some((tile) => tile.id === nextTile)).toBe(true)
    expect(runtime.advanceFrame(move(0.16), false).rejections).toEqual([])
    expect(runtime.preview().state.player.position.x).toBeCloseTo(80.16)
    const view = projected(runtime)
    expect(view.visualWorld?.terrain.some((tile) => tile.id === nextTile)).toBe(true)
    expect(view.visualWorld?.discoveredTileIds).toContain(nextTile)
  })

  it('crosses a 64 m chunk seam with the next ground tile in the scene', () => {
    const runtime = at({ x: 63.95, z: 28 })
    const nextTile = tileAt(68, 28)
    expect(runtime.advanceFrame(move(0.1), false).rejections).toEqual([])
    expect(runtime.preview().state.player.position.x).toBeCloseTo(64.05)
    expect(runtime.view().activeTiles.some((tile) => tile.id === nextTile)).toBe(true)
    expect(projected(runtime).visualWorld?.terrain.some((tile) => tile.id === nextTile)).toBe(true)
  })

  it('keeps the same Greenway scenery on an east-owner out and back crossing', () => {
    const runtime = at({ x: 33.95, z: 0 }, 'greenway')
    const homeTile = tileAt(32, 0), beyondTile = tileAt(36, 0)
    const before = projected(runtime).visualWorld?.terrain
    const homeGround = before?.find((tile) => tile.id === homeTile)
    const beyondGround = before?.find((tile) => tile.id === beyondTile)
    expect(homeGround).toBeDefined()
    expect(beyondGround).toBeDefined()
    expect(runtime.advanceFrame(move(0.1), false).rejections).toEqual([])
    expect(runtime.preview().state.movementOwner).toBe('streamed')
    const outside = projected(runtime)
    expect(outside.visualWorld?.terrain.find((tile) => tile.id === homeTile)).toEqual(homeGround)
    expect(outside.visualWorld?.terrain.find((tile) => tile.id === beyondTile)).toEqual(beyondGround)
    expect(runtime.advanceFrame(move(-0.1), false).rejections).toEqual([])
    expect(runtime.preview().state.movementOwner).toBe('greenway')
    expect(projected(runtime).visualWorld?.terrain.find((tile) => tile.id === beyondTile))
      .toEqual(beyondGround)
  })

  it('rejects the physical world face but still shows the final in-bounds tile', () => {
    const runtime = at({ x: 1021.95, z: 0 })
    const edgeTile = tileAt(1020, 0)
    expect(projected(runtime).visualWorld?.terrain.some((tile) => tile.id === edgeTile)).toBe(true)
    expect(runtime.advanceFrame(move(0.1), false).rejections).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/edge of this world/i) }),
    ])
    expect(runtime.preview().state.player.position.x).toBeCloseTo(1021.95)
    expect(projected(runtime).visualWorld?.terrain.some((tile) => tile.id === edgeTile)).toBe(true)
    expect(projected(runtime).visualWorld?.terrain.some((tile) => tile.id === 'tile-259-3'))
      .toBe(false)
  })
})
