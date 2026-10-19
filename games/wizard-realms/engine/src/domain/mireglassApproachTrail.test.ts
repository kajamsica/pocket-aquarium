import { describe, expect, it } from 'vitest'
import { createGeneratedWorld } from './generation'
import { mireglassApproachTrail, mireglassFrontierRoute, mireglassFullApproachTrail,
  mireglassGreenwayToMarkerTrail, mireglassV42BridgeId,
  mireglassV42FullApproachTrail } from './mireglassApproachTrail'
import { mireglassAnchors } from './mireglassContent'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import { discoveryMaskHasTileId, encodeDiscoveredTileIds } from './discoveryMask'
import { advancePublicV14BoundaryFrame, publicV14InsideGreenway } from './publicWorldV14Boundary'
import { createFreshPublicV14State } from './publicWorldV14Validation'
import { resolvePublicV14Surface } from './publicWorldV14Terrain'
import { PUBLIC_V16_GREENWAY_CENTER_BRIDGE_ID, publicV16InsideGreenway,
  publicWorldV16TileAtGrid } from './publicWorldV16GreenwaySites'
import { createFreshPublicV17Head } from './publicWorldV17Snapshot'
import { publicV17StarterAdvanceMove, publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { publicV26ValleyRimPassage } from './publicWorldV26ValleyRim'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { starterCliffSupportAt } from './starterCliffMovement'
import { starterCliffWorldTileAtGrid } from './starterCliffWorld'
import { createStreamedWorld } from './streamedWorld'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const seeds = [
  ...Array.from({ length: 100 }, (_, index) => `mireglass-corpus-${index}`),
  'greenway-alpha',
]

describe('Mireglass dry approach trail', () => {
  it('joins the center-bridge connector to the outpost trail at the marker exactly once', () => {
    const seed = 'greenway-alpha'
    const connector = mireglassFrontierRoute(seed).points
    const outpost = mireglassApproachTrail(seed)
    const full = mireglassV42FullApproachTrail(seed)
    expect(full).toHaveLength(connector.length + outpost.length - 1)
    expect(full.slice(0, connector.length)).toEqual(connector)
    expect(full.slice(connector.length)).toEqual(outpost.slice(1))
    expect(full.filter((point) => point.x === outpost[0].x && point.z === outpost[0].z)).toHaveLength(1)
    expect(mireglassV42FullApproachTrail(seed)).toBe(full)
    expect(Object.isFrozen(full)).toBe(true)
    expect(connector[0]).toMatchObject({ x: 0, z: 0 })
    expect(full.some(({ x, z }) => x === -32 && z === 0)).toBe(false)
  })

  it('keeps the visible trail on a dry two-way route across the actual Greenway seam', () => {
    for (const seed of ['wizard-realms', ...seeds.slice(0, 100)]) {
      const route = mireglassFrontierRoute(seed)
      const bridge = resolvePublicV17GreenwaySite(seed, PUBLIC_V16_GREENWAY_CENTER_BRIDGE_ID)
      if (!bridge || bridge.kind !== 'bridge') throw new Error(`Missing center bridge for ${seed}`)
      expect(route.requiredBridgeId, seed).toBe(PUBLIC_V16_GREENWAY_CENTER_BRIDGE_ID)
      expect(route.points.slice(0, 5), seed).toEqual([
        bridge.approach, bridge.from, bridge.supportPath[1], bridge.to, bridge.exit,
      ])
      expect(route.points.at(-1), seed).toEqual(mireglassAnchors(seed).fringeMarker.tile.center)
      expect(route.points.some(({ x, z }) => x < -30 && z === 0), seed).toBe(false)
      expect(mireglassV42FullApproachTrail(seed).slice(0, route.points.length), seed).toEqual(route.points)
      const seam = route.points.findIndex((point, index) => index > 0
        && publicV14InsideGreenway(route.points[index - 1]) && !publicV14InsideGreenway(point))
      expect(seam, `${seed} owner seam`).toBeGreaterThan(5)
      for (let index = 5; index < route.points.length; index += 1) {
        const from = route.points[index - 1], to = route.points[index]
        expect(Math.abs(to.x - from.x) + Math.abs(to.z - from.z), `${seed} step ${index}`)
          .toBe(WORLD_CELL_METERS)
        expect(Math.abs(to.y - from.y), `${seed} grade ${index}`).toBeLessThanOrEqual(0.55)
        const tile = publicV14InsideGreenway(to)
          ? publicWorldV16TileAtGrid(seed, to.x / 4, to.z / 4)
          : worldTileAtGrid(seed, to.x / 4, to.z / 4)
        expect(tile.terrain, `${seed} dry ${index}`)
          .not.toBe('wetland')
        expect(publicV25RiverCellAtGrid(seed, to.x / 4, to.z / 4), `${seed} river ${index}`).toBe(false)
        expect(mireglassMoveBarrier(seed, from, to), `${seed} forward ${index}`).toBeNull()
        expect(mireglassMoveBarrier(seed, to, from), `${seed} reverse ${index}`).toBeNull()
        expect(publicV26ValleyRimPassage(seed, from, to, []).ok, `${seed} rim ${index}`).toBe(true)
        expect(publicV26ValleyRimPassage(seed, to, from, []).ok, `${seed} rim reverse ${index}`).toBe(true)
      }
    }
  }, 120_000)

  it('keeps the saved V6-V41 full cue on the original westbound connector', () => {
    const seed = 'greenway-alpha'
    const connector = mireglassGreenwayToMarkerTrail(seed)
    const outpost = mireglassApproachTrail(seed)
    const legacy = mireglassFullApproachTrail(seed)
    expect(legacy).toEqual([...connector, ...outpost.slice(1)])
    expect(legacy.some(({ x, z }) => x === -32 && z === 0)).toBe(true)
    expect(mireglassFullApproachTrail(seed)).toBe(legacy)
    expect(mireglassV42FullApproachTrail(seed)).not.toEqual(legacy)
  })

  it('starts V42 routes on the exact works4 deck while retaining the legacy works3 route', () => {
    const seed = 'wizard-realms'
    const legacy = mireglassFrontierRoute(seed)
    expect(legacy.requiredBridgeId).toBe(PUBLIC_V16_GREENWAY_CENTER_BRIDGE_ID)
    expect(mireglassV42BridgeId(seed, [])).toBe('works4:bridge:greenway-creek:0')
    expect(mireglassV42BridgeId(seed, ['works3:bridge:1'])).toBe('works3:bridge:1')
    expect(mireglassV42BridgeId(seed, ['works4:bridge:greenway-creek:-60']))
      .toBe('works4:bridge:greenway-creek:-60')
    expect(mireglassV42BridgeId(seed, ['works4:bridge:greenway-creek:00',
      'works3:ladder:1'])).toBe('works4:bridge:greenway-creek:0')
    for (const id of ['works3:bridge:1', 'works4:bridge:greenway-creek:0',
      'works4:bridge:greenway-creek:-60']) {
      const bridge = resolvePublicV17GreenwaySite(seed, id)
      if (!bridge || bridge.kind !== 'bridge') throw new Error(`Missing ${id}`)
      const route = mireglassFrontierRoute(seed, id)
      expect(route.requiredBridgeId).toBe(id)
      expect(route.points.slice(0, 5)).toEqual([
        bridge.approach, bridge.from, bridge.supportPath[1], bridge.to, bridge.exit,
      ])
      expect(mireglassV42FullApproachTrail(seed, id).slice(0, route.points.length))
        .toEqual(route.points)
      expect(route.points.at(-1)).toEqual(mireglassAnchors(seed).fringeMarker.tile.center)
      if (bridge.exit.x % 4 !== 0) {
        expect(route.points[5].x).toBe(4 * Math.ceil(bridge.exit.x / 4 - 0.5))
        expect(route.points[5].z).toBe(bridge.exit.z)
      }
    }
    expect(mireglassFrontierRoute(seed)).toBe(legacy)
    expect(mireglassV42FullApproachTrail(seed)).not.toEqual(
      mireglassV42FullApproachTrail(seed, 'works4:bridge:greenway-creek:-60'))
    expect(() => mireglassFrontierRoute(seed, 'works4:bridge:greenway-creek:00'))
      .toThrow('No Greenway bridge site')
  })

  it('bounds route memoization without changing generated points or the required bridge fact', () => {
    const seed = 'mireglass-corpus-0'
    const first = mireglassFrontierRoute(seed)
    const fullFirst = mireglassV42FullApproachTrail(seed)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.points)).toBe(true)
    for (let index = 1; index <= 8; index += 1) {
      const otherSeed = `mireglass-corpus-${index}`
      mireglassFrontierRoute(otherSeed)
      mireglassV42FullApproachTrail(otherSeed)
    }
    const replay = mireglassFrontierRoute(seed)
    expect(replay).not.toBe(first)
    expect(replay).toEqual(first)
    expect(mireglassV42FullApproachTrail(seed)).not.toBe(fullFirst)
    expect(mireglassV42FullApproachTrail(seed)).toEqual(fullFirst)
  })

  it('requires the existing saved bridge and crosses it and the owner seam in both directions', () => {
    const seed = 'wizard-realms'
    const freshHead = createFreshPublicV17Head(seed).head
    const savedHead = { ...freshHead, greenwayWorks: { ...freshHead.greenwayWorks,
      builtBridgeIds: [PUBLIC_V16_GREENWAY_CENTER_BRIDGE_ID] } }
    const savedBefore = structuredClone(savedHead)
    const route = mireglassFrontierRoute(seed)
    const base = createFreshPublicV14State(seed)
    const greenwayWorks = { builtBridgeIds: [route.requiredBridgeId], builtLadderIds: [], dugTileIds: [] }
    const context = { seed, profile: base.generationProfile, route: base.greenway.routes[0],
      built: false, greenwayWorks }
    const originalFacts = structuredClone(greenwayWorks)
    expect(publicV17StarterSupportAt({ ...context, greenwayWorks: { ...greenwayWorks,
      builtBridgeIds: [] } }, { x: 0, z: 8 })).toBeNull()
    let pose = { x: 0, z: 3.8,
      y: publicV17StarterSupportAt(context, { x: 0, z: 3.8 })!.floorY }
    for (let step = 0; step <= 52; step += 1) {
      const next = publicV17StarterAdvanceMove(context, pose, { x: 0, z: 4 + step * 0.16 }, 0)
      expect(next.accepted, `built bridge forward ${step}`).toBe(true)
      if (!next.accepted) return
      pose = next.position
    }
    for (let step = 0; step <= 52; step += 1) {
      const next = publicV17StarterAdvanceMove(context, pose, { x: 0, z: 12.16 - step * 0.16 }, 0)
      expect(next.accepted, `built bridge reverse ${step}`).toBe(true)
      if (!next.accepted) return
      pose = next.position
    }
    expect(greenwayWorks).toEqual(originalFacts)
    expect(savedHead).toEqual(savedBefore)
    for (const point of [{ x: -30, z: 0 }, { x: -30.01, z: 0 },
      { x: 34, z: 34 }, { x: 34.01, z: 34 }, { x: 0, z: -30 }, { x: 0, z: -30.01 }]) {
      expect(publicV16InsideGreenway(point)).toBe(publicV14InsideGreenway(point))
    }
    const seamIndex = route.points.findIndex((point, index) => index > 0
      && publicV14InsideGreenway(route.points[index - 1]) && !publicV14InsideGreenway(point))
    expect(seamIndex).toBeGreaterThan(5)
    const inside = route.points[seamIndex - 1], outside = route.points[seamIndex]
    expect(inside.z).toBe(32)
    expect(outside.z).toBe(36)
    const boundaryPoint = { x: inside.x, z: 34 }
    const floor = starterCliffSupportAt({ seed, profile: base.generationProfile,
      route: base.greenway.routes[0], built: false }, boundaryPoint)!.floorY
    const bit = encodeDiscoveredTileIds([starterCliffWorldTileAtGrid(seed, inside.x / 4, 8).id])
    const mask = new Uint8Array(base.discoveryMask)
    for (let index = 0; index < mask.length; index += 1) mask[index] |= bit[index]
    const state = { ...base, movementOwner: 'greenway' as const,
      discoveryMask: mask, player: { ...base.player, position: { ...boundaryPoint, y: floor } } }
    const forward = advancePublicV14BoundaryFrame(state,
      [{ type: 'move', delta: { x: 0, z: 0.16 } }], { walkRequested: true },
      { maxOrdinaryGroundStepMeters: 0.8 })
    expect(forward.rejections).toEqual([])
    expect(forward.candidate?.movementOwner).toBe('streamed')
    if (!forward.candidate) return
    expect(discoveryMaskHasTileId(forward.candidate.discoveryMask,
      worldTileAtGrid(seed, outside.x / 4, outside.z / 4).id)).toBe(true)
    const reverse = advancePublicV14BoundaryFrame(forward.candidate,
      [{ type: 'move', delta: { x: 0, z: -0.16 } }], { walkRequested: true },
      { maxOrdinaryGroundStepMeters: 0.8 })
    expect(reverse.rejections).toEqual([])
    expect(reverse.candidate?.movementOwner).toBe('greenway')
    expect(reverse.candidate?.player.position.x).toBeCloseTo(boundaryPoint.x)
    expect(reverse.candidate?.player.position.z).toBeCloseTo(boundaryPoint.z)
    expect(resolvePublicV14Surface(base, boundaryPoint)).not.toBeNull()
  })

  it('walks dry canonical cells from fresh Greenway through both profile edges to the marker across 100 seeds', () => {
    for (const seed of seeds.slice(0, 100)) {
      const trail = mireglassGreenwayToMarkerTrail(seed)
      const marker = mireglassAnchors(seed).fringeMarker.tile.center
      expect(trail[0], seed).toEqual(worldTileAtGrid(seed, 0, 0).center)
      expect(trail.at(-1), seed).toEqual(marker)
      expect(mireglassGreenwayToMarkerTrail(seed), `${seed} cached`).toBe(trail)
      expect(Object.isFrozen(trail), seed).toBe(true)
      expect(Object.isFrozen(trail[0]), seed).toBe(true)

      for (const [profile, edgeX] of [
        ['greenway-classic-v1', -12], ['greenway-expanded-v1', -28],
      ] as const) {
        const greenway = createGeneratedWorld(seed, profile)
        const edge = trail.findIndex(({ x, z }) => x === edgeX && z === 0)
        expect(edge, `${seed} ${profile} edge`).toBeGreaterThan(0)
        expect(greenway.tiles.find(({ center }) => center.x === edgeX && center.z === 0), `${seed} ${profile}`)
          .toEqual(worldTileAtGrid(seed, edgeX / WORLD_CELL_METERS, 0))
        expect(trail[edge + 1], `${seed} ${profile} handoff`).toMatchObject({ x: edgeX - WORLD_CELL_METERS, z: 0 })
        expect(greenway.tiles.some(({ center }) => center.x === trail[edge + 1].x
          && center.z === trail[edge + 1].z), `${seed} ${profile} outside footprint`).toBe(false)
      }

      const streamed = createStreamedWorld(seed)
      for (let index = 0; index < trail.length; index += 1) {
        const cell = trail[index]
        const tile = worldTileAtGrid(seed, cell.x / WORLD_CELL_METERS, cell.z / WORLD_CELL_METERS)
        expect(cell, `${seed} cell ${index}`).toEqual(tile.center)
        expect(tile.terrain, `${seed} cell ${index}`).not.toBe('wetland')
        if (index === 0) continue
        const previous = trail[index - 1]
        const delta = { x: cell.x - previous.x, z: cell.z - previous.z }
        expect(Math.abs(delta.x) + Math.abs(delta.z), `${seed} step ${index}`).toBe(WORLD_CELL_METERS)
        expect(mireglassMoveBarrier(seed, previous, cell), `${seed} forward ${index}`).toBeNull()
        expect(mireglassMoveBarrier(seed, cell, previous), `${seed} reverse ${index}`).toBeNull()
        const moved = streamed.advance([{ type: 'move', delta }])
        expect(moved.rejections, `${seed} streamed move ${index}`).toEqual([])
        expect(moved.state.player.position, `${seed} streamed position ${index}`)
          .toMatchObject({ x: cell.x, z: cell.z })
        expect(moved.state.discoveredTileIds, `${seed} discovered ${tile.id}`).toContain(tile.id)
      }
    }
  }, 120_000)

  it('bounds the Greenway connector cache while regenerating the same path and canonical tile IDs', () => {
    const seed = 'mireglass-corpus-0'
    const original = mireglassGreenwayToMarkerTrail(seed)
    const originalIds = original.map(({ x, z }) => worldTileAtGrid(seed,
      x / WORLD_CELL_METERS, z / WORLD_CELL_METERS).id)
    const existingApproach = mireglassApproachTrail(seed)
    for (let index = 1; index <= 8; index += 1) mireglassGreenwayToMarkerTrail(`mireglass-corpus-${index}`)
    const replay = mireglassGreenwayToMarkerTrail(seed)
    expect(replay).not.toBe(original)
    expect(replay).toEqual(original)
    expect(replay.map(({ x, z }) => worldTileAtGrid(seed,
      x / WORLD_CELL_METERS, z / WORLD_CELL_METERS).id)).toEqual(originalIds)
    expect(mireglassApproachTrail(seed)).toBe(existingApproach)
  })

  it('routes every seed from marker to salvager on reproducible dry, cardinal, walkable cells', () => {
    for (const seed of seeds) {
      const trail = mireglassApproachTrail(seed)
      const anchors = mireglassAnchors(seed)
      expect(trail.length, seed).toBeGreaterThan(1)
      expect(trail[0], seed).toEqual(anchors.fringeMarker.tile.center)
      expect(trail.at(-1), seed).toEqual(anchors.salvager.tile.center)
      expect(mireglassApproachTrail(seed), `${seed} repeat`).toBe(trail)
      expect(Object.isFrozen(trail), seed).toBe(true)
      expect(Object.isFrozen(trail[0]), seed).toBe(true)
      for (let index = 0; index < trail.length; index += 1) {
        const cell = trail[index]
        const tile = worldTileAtGrid(seed, cell.x / WORLD_CELL_METERS, cell.z / WORLD_CELL_METERS)
        expect(cell, `${seed} cell ${index} (${cell.x}, ${cell.z})`).toEqual(tile.center)
        expect(tile.terrain, `${seed} cell ${index} (${cell.x}, ${cell.z})`).not.toBe('wetland')
        if (index === 0) continue
        const previous = trail[index - 1]
        expect(Math.abs(cell.x - previous.x) + Math.abs(cell.z - previous.z), `${seed} step ${index}`).toBe(WORLD_CELL_METERS)
        expect(mireglassMoveBarrier(seed, previous, cell), `${seed} forward step ${index}`).toBeNull()
        expect(mireglassMoveBarrier(seed, cell, previous), `${seed} reverse step ${index}`).toBeNull()
      }
    }
  }, 120_000)

  it('bounds cached trails while recomputing an evicted seed identically', () => {
    const original = mireglassApproachTrail('mireglass-corpus-0')
    for (let index = 1; index <= 8; index += 1) mireglassApproachTrail(`mireglass-corpus-${index}`)
    const replay = mireglassApproachTrail('mireglass-corpus-0')
    expect(replay).not.toBe(original)
    expect(replay).toEqual(original)
  })
})
