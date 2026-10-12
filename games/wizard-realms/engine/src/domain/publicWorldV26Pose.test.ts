import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { createPublicV23Root, decodePublicV23Progress } from './publicWorldV23Snapshot'
import type { PublicV24Progress } from './publicWorldV24Snapshot'
import { projectPublicV26Pose } from './publicWorldV26Pose'
import { emptyPublicV26TerrainLedger, type PublicV26TerrainLedger } from './publicWorldV26TerrainLedger'

const seed = 'wizard-realms'
const fresh = (): PublicV24Progress => {
  const { head } = createPublicV23Root(seed)
  return { state: head.state, greenwayWorks: head.greenwayWorks,
    regionalWorks: head.regionalWorks }
}
const ledgerAt = (gx: number, gz: number, openDepth: number): PublicV26TerrainLedger => ({
  ...emptyPublicV26TerrainLedger(),
  columns: [{ gx, gz, openDepth, rewardDepth: openDepth, pitLadder: false }],
})
const context = (progress: PublicV24Progress) => ({ seed,
  profile: progress.state.generationProfile,
  route: progress.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
  built: progress.state.greenway.builtRouteIds.includes('greenway_ladder'),
  greenwayWorks: progress.greenwayWorks })

function greenwayAt(x: number, z: number, works = fresh().greenwayWorks): PublicV24Progress {
  const base = fresh(), withWorks = { ...base, greenwayWorks: works }
  const support = publicV17StarterSupportAt(context(withWorks), { x, z })
  if (!support) throw new Error('Missing old Greenway support')
  const construction = works.builtBridgeIds.length * 80 + works.builtLadderIds.length * 60
  const source = decodePublicV23Progress({ ...withWorks, state: { ...base.state,
    player: { ...base.state.player, position: { x, y: support.floorY, z },
      xp: base.state.player.xp + construction,
      skillXp: { ...base.state.player.skillXp,
        construction: base.state.player.skillXp.construction + construction } } } }, seed)
  if (!source) throw new Error('Invalid old Greenway progress')
  return source
}

describe('V26 effective pose projection', () => {
  it('lowers ordinary floor without changing old carrier, preserving airborne offset', () => {
    const source = greenwayAt(12, 4), before = structuredClone(source)
    const oldY = source.state.player.position.y
    const carrier = { x: 12, y: oldY + 1.2, z: 4 }
    const ledger = ledgerAt(3, 1, 2), ledgerBefore = structuredClone(ledger)
    const pose = projectPublicV26Pose(source, ledger, carrier)
    expect(pose?.support).toBe('ground')
    expect(pose?.cell).toEqual({ gx: 3, gz: 1 })
    expect(pose?.carrier).toEqual({ position: carrier, floorY: oldY })
    expect(pose?.effective.floorY).toBeCloseTo(oldY - 0.8)
    expect(pose?.effective.position.y).toBeCloseTo(oldY + 0.4)
    expect(pose?.homePose).toMatchObject({ x: 0, z: 0 })
    expect(source).toEqual(before)
    expect(ledger).toEqual(ledgerBefore)
    expect(projectPublicV26Pose(source, ledger, carrier)).toEqual(pose)
  })

  it('keeps a validated built bridge deck above an excavated cell', () => {
    const id = 'works3:bridge:1', site = resolvePublicV17GreenwaySite(seed, id)
    if (!site || site.kind !== 'bridge') throw new Error('Missing bridge site')
    const base = fresh(), works = { ...base.greenwayWorks, builtBridgeIds: [id] }
    const source = greenwayAt(site.gapCenter.x, site.gapCenter.z, works)
    const point = source.state.player.position
    const gx = Math.ceil(point.x / 4 - 0.5), gz = Math.ceil(point.z / 4 - 0.5)
    const pose = projectPublicV26Pose(source, ledgerAt(gx, gz, 3))
    expect(pose?.support).toBe('bridge')
    expect(pose?.effective.floorY).toBe(pose?.carrier.floorY)
    expect(pose?.effective.position).toEqual(point)
  })

  it('keeps a validated built ladder deck at its old height', () => {
    const id = 'works4:ladder:greenway-north-cliff:11'
    const site = resolvePublicV17GreenwaySite(seed, id)
    if (!site || site.kind !== 'ladder') throw new Error('Missing ladder site')
    const base = fresh(), works = { ...base.greenwayWorks, builtLadderIds: [id] }
    const source = greenwayAt(site.supportPath[1].x, site.supportPath[1].z, works)
    const point = source.state.player.position
    const gx = Math.ceil(point.x / 4 - 0.5), gz = Math.ceil(point.z / 4 - 0.5)
    const pose = projectPublicV26Pose(source, ledgerAt(gx, gz, 2))
    expect(pose?.support).toBe('ladder')
    expect(pose?.effective.floorY).toBe(pose?.carrier.floorY)
    expect(pose?.effective.position).toEqual(point)
  })

  it('uses streamed terrain support and the same four-meter cell key', () => {
    const base = fresh(), point = { x: 36, z: 4 }
    const surface = resolvePublicV23Surface(base.state, point, [])
    if (!surface) throw new Error('Missing streamed support')
    const source = decodePublicV23Progress({ ...base, state: { ...base.state,
      movementOwner: 'streamed',
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(base.state.discoveryMask), surface.tileId])].sort()),
      player: { ...base.state.player, position: { ...point, y: surface.floorY } } } }, seed)
    if (!source) throw new Error('Invalid streamed progress')
    const pose = projectPublicV26Pose(source, ledgerAt(9, 1, 1))
    expect(pose?.support).toBe('terrain')
    expect(pose?.effective.floorY).toBeCloseTo(surface.floorY - 0.4)
    expect(pose?.carrier.position).toEqual(source.state.player.position)
  })

  it('invalidates protected home pose if the home cell is open', () => {
    const source = greenwayAt(12, 4)
    expect(projectPublicV26Pose(source, ledgerAt(0, 0, 1))?.homePose).toBeNull()
    expect(projectPublicV26Pose(source, emptyPublicV26TerrainLedger())?.homePose)
      .toMatchObject({ x: 0, z: 0 })
  })

  it('rejects an unsupported old carrier instead of snapping it to a floor', () => {
    const source = greenwayAt(12, 4)
    const point = source.state.player.position
    expect(projectPublicV26Pose(source, emptyPublicV26TerrainLedger(),
      { ...point, y: point.y - 2 })).toBeNull()
  })
})
