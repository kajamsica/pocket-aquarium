import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { createPublicV23Root, decodePublicV23Progress } from './publicWorldV23Snapshot'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { publicV25RiverCellAtGrid, publicV25RiverCenterZ } from './publicWorldV25River'
import { publicV25RiverPassage } from './publicWorldV25Passage'
import { publicV25RiverTouchesSegment } from './publicWorldV25RiverSweep'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

const seed = 'wizard-realms'
const fresh = () => {
  const { head } = createPublicV23Root(seed)
  return { state: head.state, greenwayWorks: head.greenwayWorks,
    regionalWorks: head.regionalWorks }
}

describe('V25 checked river passage', () => {
  it('allows a short dry step but blocks new water on old dry streamed ground', () => {
    const base = fresh()
    const dry = { x: 36, y: 2, z: 4 }
    expect(publicV25RiverPassage(base, dry, { ...dry, z: 4.16 })).toEqual({ ok: true })
    const floor = resolvePublicV23Surface(base.state, { x: 36, z: 11 }, [])
    if (!floor) throw new Error('Missing V24 streamed source floor')
    const mask = encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(base.state.discoveryMask), floor.tileId])].sort())
    const from = { x: 36, y: floor.floorY, z: 11 }
    const source = decodePublicV23Progress({ ...base, state: { ...base.state,
      movementOwner: 'streamed', discoveryMask: mask,
      player: { ...base.state.player, position: from } } }, seed)
    if (!source) throw new Error('Invalid V24 streamed source')
    const before = structuredClone(source)
    expect(publicV25RiverPassage(source, from, { ...from, z: 11.16 })).toEqual({ ok: false, reason: 'river-needs-bridge' })
    expect(source).toEqual(before)
  })
  it('permits only the saved Greenway bridge deck over water', () => {
    const base = fresh(), id = 'works3:bridge:1'
    const site = resolvePublicV17GreenwaySite(seed, id)
    if (!site || site.kind !== 'bridge') throw new Error('Missing canonical built bridge')
    const greenwayWorks = { ...base.greenwayWorks, builtBridgeIds: [id] }
    const context = { seed, profile: base.state.generationProfile,
      route: base.state.greenway.routes[0] ?? null, built: false, greenwayWorks }
    const start = { x: site.gapCenter.x, z: site.gapCenter.z }
    const end = { ...start, z: start.z + 0.16 }
    const startFloor = publicV17StarterSupportAt(context, start)
    const endFloor = publicV17StarterSupportAt(context, end)
    if (startFloor?.kind !== 'bridge' || endFloor?.kind !== 'bridge') throw new Error('Missing physical deck')
    const from = { ...start, y: startFloor.floorY }
    const to = { ...end, y: endFloor.floorY }
    const source = decodePublicV23Progress({ ...base, greenwayWorks,
      state: { ...base.state, player: { ...base.state.player,
        xp: 80, skillXp: { ...base.state.player.skillXp, construction: 80 },
        position: from } } }, seed)
    if (!source) throw new Error('Invalid V24 saved bridge progress')
    expect(publicV25RiverPassage(source, from, to)).toEqual({ ok: true })
    expect(publicV25RiverPassage(base, from, to)).toEqual({ ok: false, reason: 'river-needs-bridge' })
    expect(publicV25RiverPassage({ ...base, greenwayWorks }, from, to))
      .toEqual({ ok: false, reason: 'invalid-segment' })
    expect(publicV25RiverPassage(source, { ...from, y: from.y + 1 }, { ...to, y: to.y + 1 }))
      .toEqual({ ok: false, reason: 'river-needs-bridge' })
  })
  it('fails closed on a swept wet corner with no wet interior sample', () => {
    let rise: number | undefined
    for (let gx = WORLD_GRID_MIN + 1; gx <= WORLD_GRID_MAX; gx++) {
      if (publicV25RiverCenterZ(seed, gx) > publicV25RiverCenterZ(seed, gx - 1)) { rise = gx; break }
    }
    if (rise === undefined) throw new Error('Missing river bend')
    const x = (rise - 0.5) * WORLD_CELL_METERS
    const z = (publicV25RiverCenterZ(seed, rise) + 0.5) * WORLD_CELL_METERS
    const from = { x: x - 0.05, y: 2, z: z - 0.05 }
    const to = { x: x + 0.05, y: 2, z: z + 0.05 }
    expect([from, { x, y: 2, z }, to].every((point) => !publicV25RiverCellAtGrid(seed,
      Math.ceil(point.x / 4 - 0.5), Math.ceil(point.z / 4 - 0.5)))).toBe(true)
    expect(publicV25RiverTouchesSegment(seed, from, to)).toBe(true)
    expect(publicV25RiverPassage(fresh(), from, to)).toEqual({ ok: false, reason: 'river-needs-bridge' })
  })
  it('rejects malformed, overlong, and out-of-world segments without throwing', () => {
    const base = fresh(), point = { x: 0, y: 2, z: 0 }
    for (const end of [{ ...point, z: 0.25 }, { ...point, x: Number.NaN },
      { ...point, x: (WORLD_GRID_MAX + 1) * WORLD_CELL_METERS },
      { ...point, z: Number.POSITIVE_INFINITY }, null as never]) {
      expect(publicV25RiverPassage(base, point, end)).toEqual({ ok: false, reason: 'invalid-segment' })
    }
  })
})
