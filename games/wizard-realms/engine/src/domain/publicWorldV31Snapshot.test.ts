import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { mireglassAnchors } from './mireglassContent'
import { nearbyWorldTileIds, PUBLIC_WALK_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { publicWorldV16TileAtGrid } from './publicWorldV16GreenwaySites'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { confirmPublicV23Work, createPublicV23Root } from './publicWorldV23Snapshot'
import { resolvePublicV23Site } from './publicWorldV23Sites'
import { createPublicV24Root } from './publicWorldV24Snapshot'
import { createPublicV25Root } from './publicWorldV25Snapshot'
import { createPublicV26Root } from './publicWorldV26Snapshot'
import { createPublicV27Root } from './publicWorldV27Snapshot'
import { createPublicV28Root } from './publicWorldV28Snapshot'
import { createPublicV29Root } from './publicWorldV29Snapshot'
import { createPublicV30Root } from './publicWorldV30Snapshot'
import type { PublicV30Root } from './publicWorldV30Snapshot'
import { createPublicV31Migration } from './publicWorldV31Migration'
import { createFreshPublicV17Head } from './publicWorldV17Snapshot'
import type { PublicV31Progress } from './publicWorldV31Migration'
import { projectPublicV31Pose } from './publicWorldV31Support'
import { createPublicV31Root, decodePublicV31CheckedSuccessor, decodePublicV31Witness,
  decodePublicV31Root, publicV31RaisedSoilConserved,
  replayPublicV31Witness } from './publicWorldV31Snapshot'
import { confirmPublicV31SoilAction, decodePublicV31ActionProgress,
  decodePublicV31RaisedSoilCells,
  decodePublicV31SoilWitness, publicV31RaisedSoilSitesValid } from './publicWorldV31Soil'
import { worldTileAtGrid } from './worldChunks'

const seed = 'wizard-realms'
function source(v23 = createPublicV23Root(seed)) {
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
  const v29 = createPublicV29Root({ head: v28.head, lineage: v28.lineage })
  return createPublicV30Root({ head: v29.head, lineage: v29.lineage })
}

const base = source()
const progress = (root: PublicV30Root): PublicV31Progress => {
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...v30 } = root.head
  return { ...v30, raisedSoilCells: [] }
}

function soilReady() {
  const initial = progress(base)
  const route = initial.state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null
  for (let gx = -10; gx <= 10; gx += 1) for (let gz = -10; gz <= 10; gz += 1) {
    const playerX = (gx - 1) * 4, playerZ = gz * 4
    const support = publicV17StarterSupportAt({ seed,
      profile: initial.state.generationProfile, route,
      built: initial.state.greenway.builtRouteIds.includes('greenway_ladder'),
      greenwayWorks: initial.greenwayWorks }, { x: playerX, z: playerZ })
    if (support?.kind !== 'ground') continue
    const id = `tile-${gx + 3}-${gz + 3}`
    const candidate: PublicV31Progress = { ...initial,
      terrain: { ...initial.terrain, bag: { ...initial.terrain.bag, soil: 1 } },
      state: { ...initial.state,
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(initial.state.discoveryMask), id])].sort()),
        player: { ...initial.state.player,
          position: { x: playerX, y: support.floorY, z: playerZ },
          inventory: [...initial.state.player.inventory,
            { itemId: 'field_spade', quantity: 1 }],
          equipment: { ...initial.state.player.equipment, mainHand: 'field_spade' } } } }
    const witness = { kind: 'soil-place/v1' as const, gx, gz }
    if (confirmPublicV31SoilAction(candidate, witness).progress)
      return { candidate, witness }
  }
  throw new Error('No eligible soil placement fixture')
}

describe('V31 raised soil authority', () => {
  it('checks authored dry-bank soil placement against occupancy, not raw wetness', () => {
    const gx = -2, gz = 4, stance = { x: -12, z: 16 }
    expect(worldTileAtGrid(seed, gx, gz).terrain).toBe('wetland')
    expect(publicWorldV16TileAtGrid(seed, gx, gz).terrain).toBe('loam')
    const source = soilReady().candidate
    const route = source.state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null
    const support = publicV17StarterSupportAt({ seed, profile: source.state.generationProfile,
      route, built: source.state.greenway.builtRouteIds.includes('greenway_ladder'),
      greenwayWorks: source.greenwayWorks }, stance)
    if (support?.kind !== 'ground') throw new Error('Missing dry-bank stance')
    const targetId = `tile-${gx + 3}-${gz + 3}`
    const candidate = { ...source, state: { ...source.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(source.state.discoveryMask), targetId, 'tile-3-5'])].sort()),
      player: { ...source.state.player, position: { ...stance, y: support.floorY } } } }
    expect(decodePublicV31ActionProgress(candidate)).not.toBeNull()
    const before = structuredClone(candidate)
    expect(confirmPublicV31SoilAction(candidate, { kind: 'soil-place/v1', gx, gz }))
      .toEqual({ rejection: 'occupied' })
    expect(candidate).toEqual(before)
    expect(publicV31RaisedSoilSitesValid({ ...candidate,
      raisedSoilCells: [{ gx, gz }] })).toBe(false)
    expect(confirmPublicV31SoilAction(candidate, { kind: 'soil-place/v1', gx: 0, gz: 2 }))
      .toEqual({ rejection: 'wet' })
  })

  it('reloads a checked Slate upper-foot alignment and eastward descent', () => {
    const farSeed = 'greenway-alpha'
    const site = resolvePublicV23Site(farSeed,
      'works5:ladder:mireglass-slate:W:-103:4311')!
    const v17 = createFreshPublicV17Head(farSeed)
    const state = { ...v17.head.state, movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(v17.head.state.discoveryMask),
        ...site.footprintTileIds])].sort()),
      player: { ...v17.head.state.player, position: { ...site.from },
        inventory: [...v17.head.state.player.inventory,
          { itemId: 'logs' as const, quantity: 4 }] } }
    const v23 = createPublicV23Root(farSeed, { state,
      greenwayWorks: v17.head.greenwayWorks, saveRevision: 1,
      lineage: v17.lineage })
    const built = confirmPublicV23Work({ state: v23.head.state,
      greenwayWorks: v23.head.greenwayWorks,
      regionalWorks: v23.head.regionalWorks }, site.id)
    if (!('progress' in built)) throw new Error(`Slate fixture: ${built.rejection}`)
    const v23Source = { lineage: v23.lineage, head: { ...v23.head,
      ...built.progress, saveRevision: 1,
      witness: { kind: 'regional-work' as const, id: site.id } } }
    const root = createPublicV31Root(source(v23Source))
    expect(decodePublicV31Root(root)).toEqual(root)
    const frame = (x: number, z: number) => ({ intents: [{ type: 'move' as const,
      delta: { x, z } }], walkRequested: false })
    const outgoing = { kind: 'frame-batch/v1' as const, frames: [
      ...Array.from({ length: 28 }, () => frame(-0.16, 0)),
      ...Array.from({ length: 4 }, () => frame(0, 0.1575)),
      ...Array.from({ length: 15 }, () => frame(0.16, 0))] }
    const offLane = replayPublicV31Witness(root.head, outgoing)
    if (!offLane) throw new Error('Checked Slate upper-side arrival was rejected')
    expect(offLane.state.player.position.x).toBeCloseTo(-414.08)
    expect(offLane.state.player.position.z).toBeCloseTo(431.73)
    const saved = { lineage: root.lineage, previous: root.head,
      head: { ...root.head, ...offLane, saveRevision: 1, witness: outgoing } }
    expect(decodePublicV31CheckedSuccessor(root, saved)).toEqual(saved)
    const reloaded = decodePublicV31Root(structuredClone(saved))
    expect(reloaded).toEqual(saved)
    const returning = { kind: 'frame-batch/v1' as const, frames: [
      ...Array.from({ length: 15 }, () => frame(-0.16, 0)),
      ...Array.from({ length: 4 }, () => frame(0, -0.1575)),
      ...Array.from({ length: 27 }, () => frame(0.16, 0))] }
    const lower = replayPublicV31Witness(reloaded!.head, returning)
    if (!lower) throw new Error('Checked Slate eastward descent was rejected')
    expect(lower.state.player.position.y).toBeCloseTo(site.from.y)
    expect(lower.state.player.position.z).toBeCloseTo(site.from.z)
    const returned = { lineage: reloaded!.lineage, previous: reloaded!.head,
      head: { ...reloaded!.head, ...lower, saveRevision: 2, witness: returning } }
    expect(decodePublicV31CheckedSuccessor(reloaded!, returned)).toEqual(returned)
    expect(decodePublicV31Root(structuredClone(returned))).toEqual(returned)
  }, 120_000)

  it('inherits an exact V24 wide Glow witness through V31 replay and reload', () => {
    const point = mireglassAnchors(seed).fringeMarker.tile.center
    const surface = resolvePublicV23Surface(base.head.state, point, [])!
    const known = [...new Set([...decodeDiscoveredTileIds(base.head.state.discoveryMask),
      ...nearbyWorldTileIds(point, PUBLIC_WALK_REVEAL_RADIUS_METERS), surface.tileId])].sort()
    const state = { ...base.head.state, movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds(known),
      player: { ...base.head.state.player,
        position: { x: point.x, y: surface.floorY, z: point.z },
        learnedSpellIds: ['wayfinder_glow' as const] } }
    const v29 = base.lineage.sourceReceipt
    const source = createPublicV30Root({ lineage: v29.lineage,
      head: { ...v29.head, state, saveRevision: 1,
        witness: { kind: 'checkpoint' as const } } })
    const root = createPublicV31Root(source)
    expect(decodePublicV31Root(root)).toEqual(root)
    const witness = { kind: 'mireglass-action/v1' as const,
      action: { type: 'cast_wayfinder_glow_wide' as const } }
    expect(decodePublicV31Witness({ ...witness,
      action: { ...witness.action, radius: 24 } })).toBeNull()
    const next = replayPublicV31Witness(root.head, witness)
    if (!next) throw new Error('Inherited wide cast was rejected')
    expect(next.state.mireglass.cacheRevealed).toBe(false)
    expect(decodeDiscoveredTileIds(next.state.discoveryMask).length).toBeGreaterThan(known.length)
    const saved = { lineage: root.lineage, previous: root.head,
      head: { ...root.head, ...next, saveRevision: 1, witness } }
    expect(decodePublicV31CheckedSuccessor(root, saved)).toEqual(saved)
    expect(decodePublicV31Root(structuredClone(saved))).toEqual(saved)
  }, 120_000)

  it('decodes only sorted, unique, bounded canonical cells and witnesses', () => {
    expect(decodePublicV31RaisedSoilCells([{ gx: -1, gz: 0 },
      { gx: 0, gz: -1 }])).toEqual([{ gx: -1, gz: 0 }, { gx: 0, gz: -1 }])
    expect(decodePublicV31RaisedSoilCells([{ gx: 0, gz: 0 },
      { gx: 0, gz: 0 }])).toBeNull()
    expect(decodePublicV31RaisedSoilCells([{ gx: 1, gz: 0 },
      { gx: 0, gz: 0 }])).toBeNull()
    expect(decodePublicV31RaisedSoilCells([{ gx: 256, gz: 0 }])).toBeNull()
    expect(decodePublicV31RaisedSoilCells(Array.from({ length: 257 }, (_, gx) =>
      ({ gx, gz: 0 })))).toBeNull()
    expect(decodePublicV31SoilWitness({ kind: 'soil-place/v1', gx: 0,
      gz: 1, eligible: true })).toBeNull()
    expect(decodePublicV31SoilWitness({ kind: 'soil-remove/v1', gx: -1,
      gz: 2 })).toEqual({ kind: 'soil-remove/v1', gx: -1, gz: 2 })
  })

  it('pins a complete checked V30 root and starts with no raised cells', () => {
    const migrated = createPublicV31Migration(base)
    expect(migrated.lineage.sourceReceipt).toEqual(base)
    expect(migrated.progress.raisedSoilCells).toEqual([])
    const root = createPublicV31Root(base)
    expect(decodePublicV31Root(root)).toEqual(root)
    expect(decodePublicV31Root({ ...root,
      lineage: { ...root.lineage, seed: 'other-seed' } })).toBeNull()
    expect(() => createPublicV31Migration({ head: base.head,
      lineage: base.lineage })).toThrow(RangeError)
  }, 30_000)

  it('places and removes one soil with no XP, geology, or duplicate reward', () => {
    const { candidate, witness } = soilReady()
    const before = structuredClone(candidate)
    const placed = confirmPublicV31SoilAction(candidate, witness).progress
    if (!placed) throw new Error('Place rejected')
    expect(candidate).toEqual(before)
    expect(placed.terrain.bag.soil).toBe(candidate.terrain.bag.soil - 1)
    expect(placed.terrain.columns).toEqual(candidate.terrain.columns)
    expect(placed.state.player.xp).toBe(candidate.state.player.xp)
    expect(placed.state.player.skillXp).toEqual(candidate.state.player.skillXp)
    expect(placed.state.eventSequence).toBe(candidate.state.eventSequence)
    expect(placed.raisedSoilCells).toEqual([{ gx: witness.gx, gz: witness.gz }])
    expect(publicV31RaisedSoilSitesValid({ ...placed,
      state: { ...placed.state, movementOwner: 'streamed' } })).toBe(true)
    const raisedSupport = publicV17StarterSupportAt({ seed,
      profile: placed.state.generationProfile,
      route: placed.state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null,
      built: placed.state.greenway.builtRouteIds.includes('greenway_ladder'),
      greenwayWorks: placed.greenwayWorks }, { x: witness.gx * 4, z: witness.gz * 4 })
    if (!raisedSupport) throw new Error('Missing raised support')
    const standing = { ...placed, state: { ...placed.state,
      player: { ...placed.state.player, position: { x: witness.gx * 4,
        y: raisedSupport.floorY, z: witness.gz * 4 } } } }
    expect(decodePublicV31ActionProgress(standing)).not.toBeNull()
    expect(projectPublicV31Pose(standing)?.effective.floorY).toBeCloseTo(raisedSupport.floorY + 0.4)
    expect(confirmPublicV31SoilAction(standing, { ...witness,
      kind: 'soil-remove/v1' })).toEqual({ rejection: 'occupied' })
    expect(confirmPublicV31SoilAction(placed, witness)).toEqual({ rejection: 'already_raised' })
    expect(replayPublicV31Witness(candidate, witness)).toEqual(placed)
    expect(replayPublicV31Witness(placed, { kind: 'checkpoint' })).toEqual(placed)
    expect(replayPublicV31Witness(placed, { kind: 'deep-dig',
      gx: witness.gx, gz: witness.gz })).toBeNull()
    const removed = confirmPublicV31SoilAction(placed, { ...witness,
      kind: 'soil-remove/v1' }).progress
    expect(removed).toEqual(candidate)
    expect(removed?.state.player.xp).toBe(candidate.state.player.xp)
    expect(removed?.state.eventSequence).toBe(candidate.state.eventSequence)
    expect(replayPublicV31Witness(placed, { kind: 'terrain-action/v1',
      action: { kind: 'dig', gx: witness.gx, gz: witness.gz } })).toEqual(candidate)
    expect(confirmPublicV31SoilAction(candidate, { ...witness,
      kind: 'soil-remove/v1' })).toEqual({ rejection: 'not_raised' })
  }, 30_000)

  it('reserves unbuilt starter creek and north-cliff Works footprints', () => {
    const ordinary = soilReady()
    expect(confirmPublicV31SoilAction(ordinary.candidate,
      ordinary.witness).progress).toBeTruthy()
    for (const { workId, gx, gz, stanceGX, stanceGZ } of [
      { workId: 'works4:bridge:greenway-creek:-60', gx: -2, gz: 0,
        stanceGX: -1, stanceGZ: 0 },
      { workId: 'works4:ladder:greenway-north-cliff:11', gx: 0, gz: -2,
        stanceGX: 1, stanceGZ: -2 },
    ]) {
      const site = resolvePublicV17GreenwaySite(seed, workId)
      if (!site || site.kind === 'dig') throw new Error(`Missing ${workId}`)
      const id = `tile-${gx + 3}-${gz + 3}`
      expect(site.footprintTileIds).toContain(id)
      expect(publicV25RiverCellAtGrid(seed, gx, gz)).toBe(false)
      expect(worldTileAtGrid(seed, gx, gz).terrain).not.toBe('wetland')
      const route = ordinary.candidate.state.greenway.routes.find((entry) =>
        entry.id === 'greenway_ladder') ?? null
      const x = stanceGX * 4, z = stanceGZ * 4
      const support = publicV17StarterSupportAt({ seed,
        profile: ordinary.candidate.state.generationProfile, route,
        built: ordinary.candidate.state.greenway.builtRouteIds.includes('greenway_ladder'),
        greenwayWorks: ordinary.candidate.greenwayWorks }, { x, z })
      if (support?.kind !== 'ground') throw new Error(`Missing stance ${workId}`)
      const resource = ordinary.candidate.state.greenway.resources.find((item) => item.tileId === id)
      expect(resource?.kind ?? 'none').toMatch(/^(tree|none)$/)
      const candidate: PublicV31Progress = { ...ordinary.candidate,
        state: { ...ordinary.candidate.state,
          discoveryMask: encodeDiscoveredTileIds([...new Set([
            ...decodeDiscoveredTileIds(ordinary.candidate.state.discoveryMask), id])].sort()),
          greenway: { ...ordinary.candidate.state.greenway,
            resources: ordinary.candidate.state.greenway.resources.map((item) =>
              item.tileId === id && item.kind === 'tree'
                ? { ...item, health: 0, depleted: true } : item) },
          player: { ...ordinary.candidate.state.player,
            position: { x, y: support.floorY, z } } } }
      expect(candidate.greenwayWorks.builtBridgeIds).not.toContain(workId)
      expect(candidate.greenwayWorks.builtLadderIds).not.toContain(workId)
      expect(decodePublicV31ActionProgress(candidate)).not.toBeNull()
      expect(confirmPublicV31SoilAction(candidate,
        { kind: 'soil-place/v1', gx, gz })).toEqual({ rejection: 'occupied' })
    }
  }, 30_000)

  it('rejects free raised soil and replays checked place/remove successors', () => {
    const { candidate, witness } = soilReady()
    const v29Receipt = base.lineage.sourceReceipt
    const v30Source = createPublicV30Root({ lineage: v29Receipt.lineage,
      head: { ...v29Receipt.head, state: candidate.state,
        terrain: candidate.terrain, saveRevision: 1,
        witness: { kind: 'checkpoint' } } })
    const root = createPublicV31Root(v30Source)
    expect(decodePublicV31Root(root)).toEqual(root)
    const placed = replayPublicV31Witness(root.head, witness)
    if (!placed) throw new Error('Place replay rejected')
    const saved = { lineage: root.lineage, previous: root.head,
      head: { ...root.head, ...placed, saveRevision: 1, witness } }
    expect(decodePublicV31CheckedSuccessor(root, saved)).toEqual(saved)
    expect(decodePublicV31Root(saved)).toEqual(saved)
    const forged = { ...placed, terrain: root.head.terrain }
    expect(publicV31RaisedSoilConserved(root.head, forged, seed)).toBe(false)
    expect(decodePublicV31Root({ ...saved, head: { ...saved.head,
      terrain: root.head.terrain } })).toBeNull()
    expect(decodePublicV31Root({ ...saved, head: { ...saved.head,
      raisedSoilCells: [{ gx: 0, gz: 0 }] } })).toBeNull()
    const removedWitness = { ...witness, kind: 'soil-remove/v1' as const }
    const removed = replayPublicV31Witness(placed, removedWitness)
    expect(removed).toEqual(progress(v30Source))
  }, 120_000)
})
