import { describe, expect, it } from 'vitest'
import { terrainHeightAt } from './domain/generation'
import { mireglassAnchors } from './domain/mireglassContent'
import { mireglassRouteSites } from './domain/mireglassRouteSites'
import { advancePublicWorld } from './domain/publicWorldRuntime'
import { createFreshPublicWorld, type PublicWorldState } from './domain/publicWorldState'
import { createStreamedWorld } from './domain/streamedWorld'
import { publicWorldViewProjection } from './PublicWorldView'

const seed = 'greenway-alpha'

describe('public v6 read-only view adapter', () => {
  it.each([
    ['greenway-classic-v1', -12, 49],
    ['greenway-expanded-v1', -30, 256],
  ] as const)('projects the %s Greenway save and edge without changing authority', (profile, edgeX, tileCount) => {
    const fresh = createFreshPublicWorld(seed, profile)
    const greenway = structuredClone(fresh.greenway)
    greenway.stores[0].listings[0].stock = 1
    const edge: PublicWorldState = { ...fresh, greenway, player: { ...fresh.player,
      position: { x: edgeX, y: terrainHeightAt(fresh.greenway.tiles, edgeX, 0), z: 0 },
      coins: 73 } }
    const before = JSON.stringify(edge)
    const view = publicWorldViewProjection(edge, ['Old Greenway progress'], null)
    expect(view.player.position).toEqual([edgeX, edge.player.position.y, 0])
    expect(view.terrain).toHaveLength(tileCount)
    expect(view.map.tiles).toHaveLength(tileCount)
    expect(view.stores).toHaveLength(2)
    expect(view.stores[0].listings[0].stock).toBe(1)
    expect(view.coins).toBe(73)
    expect(view.recentEvents).toEqual(['Old Greenway progress'])
    expect(JSON.stringify(edge)).toBe(before)
    expect(edge.movementOwner).toBe('greenway')
  })

  it('keeps a returned Mireglass item visible in Greenway inventory and equipment', () => {
    const fresh = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const returned: PublicWorldState = { ...fresh, player: { ...fresh.player,
      inventory: [...fresh.player.inventory,
        { itemId: 'mireglass_reach/item/waders', quantity: 1 },
        { itemId: 'mireglass_reach/item/seal', quantity: 1 }],
      equipment: { ...fresh.player.equipment, feet: 'mireglass_reach/item/waders' } } }
    const before = JSON.stringify(returned)
    const view = publicWorldViewProjection(returned, [], null)
    expect(view.backpack.stacks).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'mireglass_reach/item/waders', name: 'Fen waders', equippableSlots: ['feet'] }),
      expect.objectContaining({ itemId: 'mireglass_reach/item/seal', name: 'Mireglass seal' }),
    ]))
    expect(view.equipment.feet).toMatchObject({ itemId: 'mireglass_reach/item/waders', name: 'Fen waders' })
    expect(JSON.stringify(returned)).toBe(before)
  })

  it('switches to the streamed Mireglass map and landmark without a second player', () => {
    const fresh = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const outboundEdge: PublicWorldState = { ...fresh, player: { ...fresh.player,
      position: { x: -12, y: terrainHeightAt(fresh.greenway.tiles, -12, 0), z: 0 } } }
    const crossed = advancePublicWorld(outboundEdge, { type: 'move', delta: { x: -4, z: 0 } })
    expect(crossed.rejections).toEqual([])
    const approach = publicWorldViewProjection(crossed.state, [], null)
    expect(approach.map.title).toContain('Mireglass')
    expect(approach.player.position).toEqual([
      crossed.state.player.position.x, crossed.state.player.position.y, crossed.state.player.position.z,
    ])
    expect(approach.map.tiles.length).toBeGreaterThan(49)

    const marker = mireglassAnchors(seed).fringeMarker.tile.center
    const streamed = createStreamedWorld(seed, marker)
    const bridge = mireglassRouteSites(seed).find((site) => site.kind === 'bridge')!
    const atMarker: PublicWorldState = { ...crossed.state,
      player: { ...crossed.state.player, position: streamed.state.player.position,
        inventory: [...crossed.state.player.inventory,
          { itemId: 'mireglass_reach/item/waders', quantity: 1 }],
        equipment: { ...crossed.state.player.equipment, feet: 'mireglass_reach/item/waders' } },
      discoveredTileIds: [...streamed.state.discoveredTileIds],
      mireglass: { ...crossed.state.mireglass, fringeMarkerStudied: true,
        builtRoutes: { ...crossed.state.mireglass.builtRoutes, bridge: bridge.id } } }
    const before = JSON.stringify(atMarker)
    const view = publicWorldViewProjection(atMarker, ['Marker studied'], null)
    expect(view.map.title).toContain('Mireglass')
    expect(view.landmarks).toContainEqual(expect.objectContaining({ kind: 'frontier-marker', studied: true }))
    expect(view.routes.find((route) => route.id === bridge.routeId)?.built).toBe(true)
    expect(view.recentEvents).toEqual(['Marker studied'])
    expect(view.backpack.stacks[0]?.itemId).toBe(atMarker.player.inventory[0]?.itemId)
    expect(view.equipment.feet).toMatchObject({ itemId: 'mireglass_reach/item/waders', name: 'Fen waders' })
    expect(JSON.stringify(atMarker)).toBe(before)
  })

  it('marks only the revealed seal cache on the current streamed map', () => {
    const fresh = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const cache = mireglassAnchors(seed).sealCache.tile.center
    const streamed = createStreamedWorld(seed, cache)
    const atCache: PublicWorldState = { ...fresh, movementOwner: 'streamed',
      player: { ...fresh.player, position: streamed.state.player.position },
      discoveredTileIds: [...streamed.state.discoveredTileIds],
      mireglass: { ...fresh.mireglass, cacheRevealed: true } }
    const view = publicWorldViewProjection(atCache, [], null)
    expect(view.landmarks).toContainEqual(expect.objectContaining({ kind: 'seal-cache', revealed: true, excavated: false }))
    expect(view.map.tiles.filter((tile) => tile.hasCache).map((tile) => tile.id)).toEqual([mireglassAnchors(seed).sealCache.tile.id])
  })
})
