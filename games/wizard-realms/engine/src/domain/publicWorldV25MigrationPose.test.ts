import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { createPublicV23Root, decodePublicV23Progress } from './publicWorldV23Snapshot'
import type { PublicV24Progress } from './publicWorldV24Snapshot'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { publicWorldV16TileAtGrid } from './publicWorldV16GreenwaySites'
import { publicV25RiverCellAtGrid, publicV25RiverCenterZ } from './publicWorldV25River'
import { relocatePublicV25RiverSource } from './publicWorldV25MigrationPose'

const seed = 'wizard-realms'
const fresh = (): PublicV24Progress => {
  const { head } = createPublicV23Root(seed)
  return { state: head.state, greenwayWorks: head.greenwayWorks,
    regionalWorks: head.regionalWorks }
}
const context = (progress: PublicV24Progress) => ({ seed,
  profile: progress.state.generationProfile,
  route: progress.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
  built: progress.state.greenway.builtRouteIds.includes('greenway_ladder'),
  greenwayWorks: progress.greenwayWorks })

/** Bounded search only over the first dry legacy columns beyond the short V24 creek. */
function newlyWetGreenway(): PublicV24Progress {
  const base = fresh()
  for (let gx = 3; gx <= 7; gx++) {
    for (let gz = 0; gz <= 5; gz++) {
      if (!publicV25RiverCellAtGrid(seed, gx, gz)) continue
      const point = { x: gx * 4, z: gz * 4 }
      const support = publicV17StarterSupportAt(context(base), point)
      if (support?.kind !== 'ground') continue
      const candidate = decodePublicV23Progress({ ...base, state: { ...base.state,
        player: { ...base.state.player,
          position: { ...point, y: support.floorY } } } }, seed)
      if (candidate) return candidate
    }
  }
  throw new Error('No validated newly wet Greenway source fixture')
}

function streamedWet(z: number, revealedBanks: readonly number[]): PublicV24Progress {
  const base = fresh()
  const positions = [z, ...revealedBanks].map((rowZ) => {
    const surface = resolvePublicV23Surface(base.state, { x: 36, z: rowZ }, [])
    if (!surface) throw new Error('Missing streamed fixture floor')
    return { z: rowZ, surface }
  })
  const discovered = encodeDiscoveredTileIds([...new Set([
    ...decodeDiscoveredTileIds(base.state.discoveryMask),
    ...positions.map(({ surface }) => surface.tileId)])].sort())
  const source = decodePublicV23Progress({ ...base, state: { ...base.state,
    movementOwner: 'streamed', discoveryMask: discovered,
    player: { ...base.state.player, position: {
      x: 36, y: positions[0].surface.floorY, z } } } }, seed)
  if (!source) throw new Error('Invalid streamed source fixture')
  return source
}

describe('V25 source pose migration', () => {
  it('returns an independent validated copy of an already dry source', () => {
    const source = fresh(), before = structuredClone(source)
    const mapped = relocatePublicV25RiverSource(source)
    expect(mapped).toEqual({ progress: source, relocation: null })
    expect(mapped?.progress).not.toBe(source)
    expect(source).toEqual(before)
  })

  it('moves a validated newly wet pose to dry ground in the same column and owner', () => {
    const source = newlyWetGreenway(), before = structuredClone(source)
    const from = source.state.player.position
    expect(publicV25RiverCellAtGrid(seed, 3, 1)).toBe(false)
    expect(publicV25RiverCellAtGrid(seed, 3, 3)).toBe(false)
    for (const z of [4, 12]) {
      const support = publicV17StarterSupportAt(context(source), { x: 12, z })
      expect(support?.kind).toBe('ground')
      expect(publicWorldV16TileAtGrid(seed, 3, z / 4).terrain).not.toBe('wetland')
      expect(decodePublicV23Progress({ ...source, state: { ...source.state,
        player: { ...source.state.player,
          position: { x: 12, y: support!.floorY, z } } } }, seed)).not.toBeNull()
    }
    const mapped = relocatePublicV25RiverSource(source)
    expect(mapped).not.toBeNull()
    expect(from).toMatchObject({ x: 12, z: 8 })
    expect(mapped?.relocation?.from).toEqual(from)
    expect(mapped?.relocation?.to.x).toBe(from.x)
    expect(mapped?.relocation?.to.z).toBe(4)
    expect(mapped?.progress.state.movementOwner).toBe('greenway')
    expect(mapped?.progress.state.player.verticalVelocity).toBe(0)
    expect(mapped?.progress.state.tick).toBe(source.state.tick)
    expect(mapped?.progress.state.eventSequence).toBe(source.state.eventSequence)
    expect(mapped?.progress.state.player.yaw).toBe(source.state.player.yaw)
    expect(mapped?.progress.state.player.inventory).toEqual(source.state.player.inventory)
    expect(mapped?.progress.greenwayWorks).toEqual(source.greenwayWorks)
    expect({ ...mapped!.progress, state: { ...mapped!.progress.state,
      player: { ...mapped!.progress.state.player, position: from } } }).toEqual(source)
    expect(decodePublicV23Progress(mapped?.progress, seed)).toEqual(mapped?.progress)
    expect(source).toEqual(before)
    expect(relocatePublicV25RiverSource(source)).toEqual(mapped)
  })

  it('keeps a validated old built bridge deck over new water', () => {
    const base = fresh(), id = 'works3:bridge:1'
    const site = resolvePublicV17GreenwaySite(seed, id)
    expect(site?.kind).toBe('bridge')
    if (!site || site.kind !== 'bridge') return
    const works = { ...base.greenwayWorks, builtBridgeIds: [id] }
    const point = { x: site.gapCenter.x, z: site.gapCenter.z }
    const support = publicV17StarterSupportAt(context({ ...base, greenwayWorks: works }), point)
    expect(support?.kind).toBe('bridge')
    if (!support) throw new Error('Missing bridge support')
    const source = decodePublicV23Progress({ ...base, greenwayWorks: works,
      state: { ...base.state, player: { ...base.state.player,
        xp: 80, skillXp: { ...base.state.player.skillXp, construction: 80 },
        position: { ...point, y: support.floorY } } } }, seed)
    expect(source).not.toBeNull()
    if (!source) return
    expect(relocatePublicV25RiverSource(source)).toEqual({ progress: source, relocation: null })
  })

  it('keeps a newly wet streamed source on its original bank when both banks are available', () => {
    expect(publicV25RiverCenterZ(seed, 9) * 4).toBe(12)
    const north = streamedWet(11, [4, 16]), before = structuredClone(north)
    expect(relocatePublicV25RiverSource(north)?.relocation?.to).toMatchObject({ x: 36, z: 4 })
    expect(north).toEqual(before)
    const south = streamedWet(13, [4, 16])
    expect(relocatePublicV25RiverSource(south)?.relocation?.to).toMatchObject({ x: 36, z: 16 })
    const center = streamedWet(12, [4, 16])
    expect(relocatePublicV25RiverSource(center)?.relocation?.to).toMatchObject({ x: 36, z: 4 })
  })

  it('does not cross to the opposite bank when no same-bank support is discovered', () => {
    const north = streamedWet(11, [16]), before = structuredClone(north)
    expect(relocatePublicV25RiverSource(north) === null).toBe(true)
    expect(north).toEqual(before)
  })

  it('rejects malformed input and a valid streamed pose with no discovered dry destination', () => {
    expect(relocatePublicV25RiverSource(null as never)).toBeNull()
    const base = fresh(), gz = publicV25RiverCenterZ(seed, 9)
    const point = { x: 36, z: gz * 4 }
    expect(publicV25RiverCellAtGrid(seed, 9, gz)).toBe(true)
    const floor = resolvePublicV23Surface(base.state, point, [])
    if (!floor) throw new Error('Missing streamed fixture floor')
    const source = decodePublicV23Progress({ ...base, state: { ...base.state,
      movementOwner: 'streamed',
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(base.state.discoveryMask), floor.tileId])].sort()),
      player: { ...base.state.player, position: { ...point, y: floor.floorY } } } }, seed)
    expect(source).not.toBeNull()
    if (source) expect(relocatePublicV25RiverSource(source)).toBeNull()
  })
})
