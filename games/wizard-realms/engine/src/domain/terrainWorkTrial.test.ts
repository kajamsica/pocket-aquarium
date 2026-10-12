import { describe, expect, it } from 'vitest'
import { mireglassRouteSites } from './mireglassRouteSites'
import { createTerrainWorkTrialState, confirmTerrainWorkTrial,
  previewTerrainWorkTrial, resolveBuiltTerrainWorkTrialSites } from './terrainWorkTrial'
import type { TerrainWorkTrialAuthority, TerrainWorkTrialState } from './terrainWorkTrial'
import { resolveTerrainWorkSite } from './terrainWorks'
import { worldTileAtGrid } from './worldChunks'

const seed = 'greenway-alpha'
const bridgeId = 'works1:bridge:-102:92:z'
const ladderId = 'works1:ladder:-103:108:W'
const digId = 'tile--64-76'
const site = (id: string) => {
  const found = resolveTerrainWorkSite(seed, id)
  if (!found) throw new Error(`Missing fixture site ${id}`)
  return found
}
const authority = (id: string): TerrainWorkTrialAuthority => {
  const found = site(id)
  return { seed, position: found.kind === 'dig' ? found.center : found.from,
    discoveredTileIds: [found.kind === 'dig' ? found.footprintTileIds[0] : found.footprintTileIds[1]],
    fieldCampTileIds: [], authoredBuiltRouteIds: [] }
}

describe('unsaved terrain-work trial authority', () => {
  it('builds selected useful bridge and ladder from a finite kit, with sorted ledger and exact rewards', () => {
    const initial = createTerrainWorkTrialState()
    expect(Object.isFrozen(initial)).toBe(true)
    expect(Object.isFrozen(initial.kit)).toBe(true)
    const bridge = confirmTerrainWorkTrial(initial, authority(bridgeId), bridgeId)
    expect(bridge.event).toEqual({ type: 'terrain_work_built', id: bridgeId,
      logsSpent: 8, stoneGained: 0, xp: 80 })
    expect(initial.kit.logs).toBe(12)
    expect(bridge.state.kit).toMatchObject({ logs: 4, xp: 80, constructionXp: 80 })
    expect(Object.isFrozen(bridge.state.builtWorkIds)).toBe(true)
    const ladder = confirmTerrainWorkTrial(bridge.state, authority(ladderId), ladderId)
    expect(ladder.event).toEqual({ type: 'terrain_work_built', id: ladderId,
      logsSpent: 4, stoneGained: 0, xp: 60 })
    expect(ladder.state.builtWorkIds).toEqual([bridgeId, ladderId].sort())
    expect(ladder.state.kit).toMatchObject({ logs: 0, xp: 140, constructionXp: 140 })
    expect(resolveBuiltTerrainWorkTrialSites(ladder.state, seed)?.map((site) =>
      [site.id, site.supportPath.length])).toEqual([[bridgeId, 3], [ladderId, 4]])
    const reversed = confirmTerrainWorkTrial(
      confirmTerrainWorkTrial(initial, authority(ladderId), ladderId).state,
      authority(bridgeId), bridgeId)
    expect(reversed.state.builtWorkIds).toEqual(ladder.state.builtWorkIds)
    expect(previewTerrainWorkTrial(ladder.state, authority(bridgeId), bridgeId).rejection).toBe('already_done')
    expect(confirmTerrainWorkTrial(ladder.state, authority(bridgeId), bridgeId).state).toBe(ladder.state)
  })

  it('digs a suitable unmarked dry tile and requires an owned equipped spade and capacity', () => {
    const initial = createTerrainWorkTrialState()
    const dug = confirmTerrainWorkTrial(initial, authority(digId), digId)
    expect(dug.event).toEqual({ type: 'terrain_work_dug', id: digId,
      logsSpent: 0, stoneGained: 1, xp: 30 })
    expect(dug.state.dugTileIds).toEqual([digId])
    expect(dug.state.kit).toMatchObject({ logs: 12, stone: 1, xp: 30, excavationXp: 30 })
    expect(previewTerrainWorkTrial(dug.state, authority(digId), digId).rejection).toBe('already_done')
    for (const kit of [{ spadeOwned: false, spadeEquipped: false },
      { spadeOwned: true, spadeEquipped: false }]) {
      const state = { ...initial, kit: { ...initial.kit, ...kit } }
      expect(confirmTerrainWorkTrial(state, authority(digId), digId)).toEqual({ state, rejection: 'requires_spade' })
    }
    const full = { ...initial, kit: { ...initial.kit, logs: 15 } }
    expect(confirmTerrainWorkTrial(full, authority(digId), digId)).toEqual({ state: full, rejection: 'capacity' })
  })

  it('recomputes on confirm, rejecting hidden, moved, malformed, wet and insufficient attempts atomically', () => {
    const initial = createTerrainWorkTrialState()
    const near = authority(bridgeId)
    expect(previewTerrainWorkTrial(initial, near, bridgeId).rejection).toBeNull()
    const moved = { ...near, position: { ...near.position, x: near.position.x + 4 } }
    expect(confirmTerrainWorkTrial(initial, moved, bridgeId)).toEqual({ state: initial, rejection: 'too_far' })
    expect(previewTerrainWorkTrial(initial, { ...near, discoveredTileIds: [] }, bridgeId))
      .toEqual({ site: null, rejection: 'undiscovered' })
    expect(confirmTerrainWorkTrial(initial, { ...near, discoveredTileIds: [] }, bridgeId))
      .toEqual({ state: initial, rejection: 'undiscovered' })
    for (const invalid of ['works1:bridge:-0102:92:z', 'works1:bridge:0:0:z',
      worldTileAtGrid(seed, -102, 92).id,
      { id: bridgeId, from: { x: 0, y: 0, z: 0 } } as never]) {
      expect(confirmTerrainWorkTrial(initial, near, invalid))
        .toEqual({ state: initial, rejection: 'invalid_site' })
    }
    const short = { ...initial, kit: { ...initial.kit, logs: 7 } }
    expect(confirmTerrainWorkTrial(short, near, bridgeId))
      .toEqual({ state: short, rejection: 'insufficient_logs' })
  })

  it('rejects camp, authored-route and dynamic footprint occupancy without spending materials', () => {
    const initial = createTerrainWorkTrialState()
    const dig = authority(digId)
    expect(confirmTerrainWorkTrial(initial, { ...dig, fieldCampTileIds: [digId] }, digId))
      .toEqual({ state: initial, rejection: 'occupied' })
    const authored = mireglassRouteSites(seed).find((route) => route.kind === 'bridge')!
    const candidate = resolveTerrainWorkSite(seed,
      `works1:bridge:${authored.from.x / 4}:${(authored.from.z + 4) / 4}:z`)
    expect(candidate?.kind).toBe('bridge')
    if (!candidate) throw new Error('Missing authored route overlap fixture.')
    expect(confirmTerrainWorkTrial(initial,
      { ...authority(candidate.id), authoredBuiltRouteIds: [authored.id] }, candidate.id))
      .toEqual({ state: initial, rejection: 'occupied' })
    const authoredApproachDig = 'tile--95-93'
    const builtRoute = 'mireglass_reach/route/fen_bridge/-98/92'
    expect(site(authoredApproachDig).kind).toBe('dig')
    expect(confirmTerrainWorkTrial(initial,
      { ...authority(authoredApproachDig), authoredBuiltRouteIds: [builtRoute] }, authoredApproachDig))
      .toEqual({ state: initial, rejection: 'occupied' })
    const built = confirmTerrainWorkTrial(initial, authority(bridgeId), bridgeId).state
    const approachTile = site(bridgeId).footprintTileIds[0]
    const approachDig = resolveTerrainWorkSite(seed, approachTile)
    expect(approachDig?.kind).toBe('dig')
    const result = confirmTerrainWorkTrial(built, authority(approachTile), approachTile)
    expect(result).toEqual({ state: built, rejection: 'occupied' })
  })

  it('rejects malformed authority or ledger before any mutation', () => {
    const initial = createTerrainWorkTrialState()
    const invalid = { ...initial, builtWorkIds: [bridgeId, bridgeId] } as TerrainWorkTrialState
    expect(confirmTerrainWorkTrial(invalid, authority(ladderId), ladderId))
      .toEqual({ state: invalid, rejection: 'invalid_state' })
    const badAuthority = { ...authority(bridgeId), position: { x: NaN, y: 0, z: 0 } }
    expect(confirmTerrainWorkTrial(initial, badAuthority, bridgeId))
      .toEqual({ state: initial, rejection: 'invalid_state' })
    const longHistory = { ...authority(bridgeId), discoveredTileIds: [
      ...Array.from({ length: 2049 }, (_, index) => `tile-${index}-0`),
      authority(bridgeId).discoveredTileIds[0],
    ] }
    expect(previewTerrainWorkTrial(initial, longHistory, bridgeId).rejection).toBeNull()
  })
})
