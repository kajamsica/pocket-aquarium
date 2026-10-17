/** Authority and visible-ground continuity at owner, chunk, and physical world edges. */
import { describe, expect, it } from 'vitest'
import { createPublicV42ControllerRuntime } from './PublicV42ControllerRuntime'
import { publicWorldV23ViewProjection } from './PublicV23WorldView'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { nearbyWorldTileIds } from './domain/publicWorldDiscovery'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { createFreshPublicV42Root } from './domain/publicWorldV42Snapshot'
import { worldTileAtGrid } from './domain/worldChunks'

const seed = 'wizard-realms'
const move = (x: number, z = 0) => [{ type: 'move' as const, delta: { x, z } }]
const tileAt = (x: number, z: number) => worldTileAtGrid(seed,
  Math.ceil(x / 4 - 0.5), Math.ceil(z / 4 - 0.5)).id

function at(point: { x: number; z: number }, owner: 'greenway' | 'streamed' = 'streamed') {
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
  return createPublicV42ControllerRuntime({ ...root, head },
    async () => ({ ok: false, reason: 'not-called' }))
}

function projected(runtime: ReturnType<typeof at>) {
  const active = runtime.view()
  return publicWorldV23ViewProjection(runtime.preview(), active, [], null, null, false,
    { kind: 'bridge', bodyYaw: active.player.yaw, aimX: null, aimZ: null,
      modeActive: false, actionsEnabled: false })
}

describe('V42 terrain and visibility continuity without a renderer', () => {
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
