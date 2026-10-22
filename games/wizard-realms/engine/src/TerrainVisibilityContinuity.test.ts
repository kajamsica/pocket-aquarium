/** Authority and visible-ground continuity at owner, chunk, and physical world edges. */
import { describe, expect, it, vi } from 'vitest'
import { createPublicV42ControllerRuntime } from './PublicV42ControllerRuntime'
import { publicWorldV23ViewProjection } from './PublicV23WorldView'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { nearbyWorldTileIds } from './domain/publicWorldDiscovery'
import { mireglassRouteSites } from './domain/mireglassRouteSites'
import { resolveFieldCampSite } from './domain/fieldCamp'
import * as streamTerrain from './domain/publicWorldV14Terrain'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { createFreshPublicV42Root, replayPublicV42Witness } from './domain/publicWorldV42Snapshot'
import type { PublicV42Start } from './domain/publicWorldV42Flow'
import { resolveTerrainWorkSite } from './domain/terrainWorks'
import { enumerateTerrainWorkSites } from './domain/terrainWorks'
import { worldTileAtGrid } from './domain/worldChunks'

const seed = 'wizard-realms'
const move = (x: number, z = 0) => [{ type: 'move' as const, delta: { x, z } }]
const tileAt = (x: number, z: number) => worldTileAtGrid(seed,
  Math.ceil(x / 4 - 0.5), Math.ceil(z / 4 - 0.5)).id

function startAt(point: { x: number; z: number }, owner: 'greenway' | 'streamed' = 'streamed') {
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
  return { lineage: root.lineage, head }
}

function at(point: { x: number; z: number }, owner: 'greenway' | 'streamed' = 'streamed',
  write: Parameters<typeof createPublicV42ControllerRuntime>[1] =
    async () => ({ ok: false, reason: 'not-called' })) {
  return createPublicV42ControllerRuntime(startAt(point, owner), write)
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

function spadeStartAt(siteId: string): { start: PublicV42Start; gx: number; gz: number } {
  const root = createFreshPublicV42Root(seed)
  const site = resolveTerrainWorkSite(seed, siteId)
  if (!site || site.kind !== 'dig') throw new Error('Missing canonical dig site')
  const point = { x: site.center.x + 2.5, z: site.center.z }
  const floor = resolvePublicV23Surface(root.head.state, point,
    root.head.regionalWorks.builtLadderIds)
  if (!floor) throw new Error('Missing dig approach support')
  const start: PublicV42Start = { lineage: root.lineage, head: { ...root.head,
    state: { ...root.head.state, tick: 1, movementOwner: 'streamed',
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
  return { start, gx: site.center.x / 4, gz: site.center.z / 4 }
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
    const point = { x: 63.95, z: 28 }
    const runtime = checkedRuntime(startAt(point))
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

  it('regenerates across the negative 64 m seam, then reuses the new window', () => {
    const runtime = at({ x: -64.05, z: 28 })
    const generate = vi.spyOn(streamTerrain, 'createPublicV23StreamTerrain')
    try {
      const west = runtime.view()
      generate.mockClear()
      expect(runtime.advanceFrame(move(0.1), false).rejections).toEqual([])
      generate.mockClear()
      const east = runtime.view()
      expect(generate).toHaveBeenCalledOnce()
      expect(east.player.position.x).toBeCloseTo(-63.95)
      expect(east.activeTiles).not.toEqual(west.activeTiles)
      generate.mockClear()
      expect(runtime.view()).toEqual(east)
      expect(generate).not.toHaveBeenCalled()
    } finally { generate.mockRestore() }
  })

  it('invalidates the streamed window after a checked terrain dig', async () => {
    const { start } = spadeStartAt('tile--64-76')
    const runtime = checkedRuntime(start)
    const generate = vi.spyOn(streamTerrain, 'createPublicV23StreamTerrain')
    try {
      const before = runtime.view()
      generate.mockClear()
      expect(await runtime.action({ kind: 'legacy-work', id: 'tile--64-76' }))
        .toMatchObject({ status: 'saved' })
      expect(runtime.preview().state.terrainWorks.dugTileIds).toContain('tile--64-76')
      generate.mockClear()
      const after = runtime.view()
      expect(generate).toHaveBeenCalledOnce()
      expect(after.activeTiles).not.toEqual(before.activeTiles)
      expect(after.activeTiles).toEqual(streamTerrain.createPublicV23StreamTerrain(
        runtime.preview().state, runtime.preview().regionalWorks.builtLadderIds).activeTiles())
    } finally { generate.mockRestore() }
  }, 30_000)

  it('regenerates after a checked soil fill even when base tiles are unchanged', async () => {
    const { start, gx, gz } = spadeStartAt('tile--64-76')
    const filledStart: PublicV42Start = { lineage: start.lineage, head: { ...start.head,
      terrain: { columns: [{ gx, gz, openDepth: 1, rewardDepth: 1, pitLadder: false }],
        bag: { ...start.head.terrain.bag, soil: 1 } } } }
    const runtime = checkedRuntime(filledStart)
    const generate = vi.spyOn(streamTerrain, 'createPublicV23StreamTerrain')
    try {
      const before = runtime.view()
      generate.mockClear()
      expect(await runtime.action({ kind: 'terrain-action/v1', action: { kind: 'fill', gx, gz } }))
        .toMatchObject({ status: 'saved' })
      expect(runtime.preview().terrain.columns[0].openDepth).toBe(0)
      generate.mockClear()
      expect(runtime.view().activeTiles).toEqual(before.activeTiles)
      expect(generate).toHaveBeenCalledOnce()
    } finally { generate.mockRestore() }
  }, 30_000)

  it('invalidates the streamed window after a checked authored route build', async () => {
    const site = mireglassRouteSites(seed).find((candidate) => candidate.kind === 'bridge')!
    const initial = startAt(site.from)
    const start: PublicV42Start = { lineage: initial.lineage, head: { ...initial.head,
      state: { ...initial.head.state,
        player: { ...initial.head.state.player, backpackCapacity: 30,
          inventory: [...initial.head.state.player.inventory.filter((stack) => stack.itemId !== 'logs'),
            { itemId: 'logs', quantity: site.logCost }] } } } }
    const runtime = checkedRuntime(start)
    const generate = vi.spyOn(streamTerrain, 'createPublicV23StreamTerrain')
    try {
      const before = runtime.view()
      generate.mockClear()
      expect(await runtime.action({ kind: 'mireglass-action/v1',
        action: { type: 'build_route', siteId: site.id } })).toMatchObject({ status: 'saved' })
      expect(runtime.preview().state.mireglass.builtRoutes.bridge).toBe(site.id)
      generate.mockClear()
      const after = runtime.view()
      expect(generate).toHaveBeenCalledOnce()
      expect(after.activeTiles).toEqual(streamTerrain.createPublicV23StreamTerrain(
        runtime.preview().state, runtime.preview().regionalWorks.builtLadderIds).activeTiles())
      expect(after.activeTiles).toEqual(before.activeTiles)
    } finally { generate.mockRestore() }
  }, 30_000)

  it('drops the streamed window when an inherited return-home write changes owner', async () => {
    const initial = startAt({ x: -268, z: 300 })
    const start: PublicV42Start = { lineage: initial.lineage, head: { ...initial.head,
      terrain: { ...initial.head.terrain,
        columns: [{ gx: -67, gz: 75, openDepth: 8, rewardDepth: 8, pitLadder: false }] } } }
    const { schemaVersion: _initialSchema, saveRevision: _initialRevision,
      witness: _initialWitness, ...initialProgress } = start.head
    expect(replayPublicV42Witness(initialProgress, { kind: 'return-home/v1', atMs: 10_000 }))
      .not.toBeNull()
    let runtime: ReturnType<typeof createPublicV42ControllerRuntime>
    runtime = createPublicV42ControllerRuntime(start,
      async () => ({ ok: false, reason: 'not-called' }),
      async (revision, lineage) => {
        const witness = { kind: 'return-home/v1' as const, atMs: 10_000 }
        const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
          ...before } = runtime.committed().head
        const next = replayPublicV42Witness(before, witness)
        if (!next) return { ok: false, reason: 'local-replay' }
        return { ok: true, value: { lineage, head: { ...next,
          schemaVersion: start.head.schemaVersion, saveRevision: revision + 1, witness } } }
      })
    const generate = vi.spyOn(streamTerrain, 'createPublicV23StreamTerrain')
    try {
      runtime.view()
      generate.mockClear()
      expect(await runtime.returnHome()).toEqual({ status: 'saved', events: [], resetWalkRequested: false })
      expect(runtime.preview().state.movementOwner).toBe('greenway')
      expect(runtime.view().movementOwner).toBe('greenway')
      expect(generate).not.toHaveBeenCalled()
    } finally { generate.mockRestore() }
  }, 30_000)

  it('keys exact same-count terrain ledgers, route IDs, and field-camp IDs', () => {
    const base = startAt({ x: -268, z: 300 })
    const dugIds = enumerateTerrainWorkSites(seed, { minGX: -75, maxGX: -60,
      minGZ: 70, maxGZ: 85 }).filter((site) => site.kind === 'dig').slice(0, 2)
      .map((site) => site.id)
    const builtIds = enumerateTerrainWorkSites(seed, { minGX: -104, maxGX: -89,
      minGZ: 88, maxGZ: 103 }).filter((site) => site.kind !== 'dig').slice(0, 2)
      .map((site) => site.id)
    expect(dugIds).toHaveLength(2)
    expect(builtIds).toHaveLength(2)
    for (const id of builtIds) expect(resolveTerrainWorkSite(seed, id)).not.toBeNull()
    const camps: string[] = []
    for (let gz = 68; gz <= 83 && camps.length < 2; gz++) {
      for (let gx = -76; gx <= -61 && camps.length < 2; gx++) {
        const id = worldTileAtGrid(seed, gx, gz).id
        if (resolveFieldCampSite(seed, id)) camps.push(id)
      }
    }
    expect(camps).toHaveLength(2)
    const routes = mireglassRouteSites(seed).filter((site) => site.kind === 'bridge').slice(0, 2)
    expect(routes).toHaveLength(2)
    const keyFor = (overrides: Partial<PublicV42Start['head']['state']>) => {
      const state = { ...base.head.state, ...overrides }
      const runtime = createPublicV42ControllerRuntime({ lineage: base.lineage,
        head: { ...base.head, state } }, async () => ({ ok: false, reason: 'not-called' }))
      const stringify = vi.spyOn(JSON, 'stringify')
      try {
        runtime.view()
        const call = stringify.mock.calls.find(([value]) => Array.isArray(value)
          && value.length === 8 && value[0] === seed && Array.isArray(value[2]))
        expect(call).toBeDefined()
        return JSON.stringify(call![0])
      } finally { stringify.mockRestore() }
    }
    const terrain = base.head.state.terrainWorks
    const withDug = (id: string) => ({ terrainWorks: { ...terrain, dugTileIds: [id] } })
    const withBuilt = (id: string) => ({ terrainWorks: { ...terrain, builtWorkIds: [id] } })
    expect(keyFor(withDug(dugIds[0]))).not.toBe(keyFor(withDug(dugIds[1])))
    expect(keyFor(withBuilt(builtIds[0]))).not.toBe(keyFor(withBuilt(builtIds[1])))
    expect(keyFor({ fieldCampTileIds: [camps[0]] }))
      .not.toBe(keyFor({ fieldCampTileIds: [camps[1]] }))
    expect(keyFor({ mireglass: { ...base.head.state.mireglass,
      builtRoutes: { ...base.head.state.mireglass.builtRoutes, bridge: routes[0].id } } }))
      .not.toBe(keyFor({ mireglass: { ...base.head.state.mireglass,
        builtRoutes: { ...base.head.state.mireglass.builtRoutes, bridge: routes[1].id } } }))
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
