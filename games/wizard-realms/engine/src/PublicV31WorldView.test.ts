import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { createPublicV23Root, decodePublicV23Progress } from './domain/publicWorldV23Snapshot'
import { createPublicV24Root } from './domain/publicWorldV24Snapshot'
import { createPublicV25Root } from './domain/publicWorldV25Snapshot'
import { createPublicV26Root } from './domain/publicWorldV26Snapshot'
import { emptyPublicV26TerrainLedger } from './domain/publicWorldV26TerrainLedger'
import { createPublicV27Root } from './domain/publicWorldV27Snapshot'
import { createPublicV28Root } from './domain/publicWorldV28Snapshot'
import { createPublicV29Root } from './domain/publicWorldV29Snapshot'
import { createPublicV30Root } from './domain/publicWorldV30Snapshot'
import type { PublicV31Progress } from './domain/publicWorldV31Migration'
import { confirmPublicV31SoilAction, decodePublicV31ActionProgress,
  previewPublicV31SoilPlaces } from './domain/publicWorldV31Soil'
import { projectPublicV31Pose } from './domain/publicWorldV31Support'
import { projectPublicV31WorldView } from './PublicV31WorldView'
import type { WizardViewProjection } from './view/contracts'

const seed = 'wizard-realms'
function readyProgress(): PublicV31Progress {
  const { head } = createPublicV23Root(seed)
  const point = { x: 4, z: 0 }
  const support = publicV17StarterSupportAt({ seed,
    profile: head.state.generationProfile,
    route: head.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
    built: false, greenwayWorks: head.greenwayWorks }, point)
  if (!support) throw new Error('Missing starter floor')
  const old = decodePublicV23Progress({ state: { ...head.state,
    player: { ...head.state.player, position: { ...point, y: support.floorY } } },
  greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks }, seed)
  if (!old) throw new Error('Invalid V31 view fixture')
  const terrain = emptyPublicV26TerrainLedger()
  return { ...old, terrain: { ...terrain, bag: { ...terrain.bag, soil: 2 } },
  nextHomeAtMs: 0, riverBridgeIds: [], miningTools: { basicPickOwned: false,
    enchantedPickOwned: false, activePick: null }, claimedBridgeheadId: null,
  raisedSoilCells: [{ gx: 1, gz: 0 }, { gx: 3, gz: 0 }] }
}

const progress = readyProgress()
const nativeY = progress.state.player.position.y
const cell = (gx: number, y: number, discovered = true) => ({
  id: `tile-${gx + 3}-3`, position: [gx * 4, y, 0] as const,
  size: [4, 4] as const, height: y + 0.7, climate: 'meadow', discovered,
})
const carrier = {
  seed, player: { position: [4, nativeY, 0] },
  terrain: [cell(1, nativeY), cell(2, nativeY), cell(3, nativeY, false)],
  visualWorld: { terrain: [cell(1, nativeY), cell(2, nativeY), cell(3, nativeY, false)],
    discoveredTileIds: ['tile-4-3', 'tile-5-3'] },
  map: { tiles: [
    { id: 'tile-4-3', discovered: true },
    { id: 'tile-5-3', discovered: true, elevationMeters: 0.6 },
    { id: 'tile-6-3', discovered: false },
  ] },
} as unknown as WizardViewProjection

describe('V31 placed-soil view', () => {
  it('lifts only canonical cells and marks only discovered raised map tops', () => {
    const view = projectPublicV31WorldView(progress, carrier)
    expect(view.terrain.map((entry) => entry.position[1]))
      .toEqual([nativeY + 0.4, nativeY, nativeY + 0.4])
    expect(view.visualWorld?.terrain.map((entry) => entry.position[1]))
      .toEqual([nativeY + 0.4, nativeY, nativeY + 0.4])
    expect(view.player.position[1]).toBeCloseTo(projectPublicV31Pose(progress)!.effective.position.y)
    expect(view.player.position[1]).toBeCloseTo(view.terrain[0].position[1])
    expect(view.map.tiles[0]).toMatchObject({ hasRaisedSoil: true,
      elevationMeters: nativeY + 0.4 })
    expect(view.map.tiles[1]).toMatchObject({ elevationMeters: 0.6 })
    expect(view.map.tiles[1].hasRaisedSoil).toBeUndefined()
    expect(view.map.tiles[2].hasRaisedSoil).toBeUndefined()
    expect(view.v31Soil).toMatchObject({ soilAvailable: 2, raisedCells: progress.raisedSoilCells })
    expect(carrier.player.position[1]).toBe(nativeY)
    expect(progress.state.player.position.y).toBe(nativeY)
    expect(carrier.terrain[0].position[1]).toBe(nativeY)
    expect(carrier.map.tiles[0].hasRaisedSoil).toBeUndefined()
  })

  it('leaves the player at the inherited height without a V31 raised cell', () => {
    const unraised = { ...progress, raisedSoilCells: [] }
    const view = projectPublicV31WorldView(unraised, carrier)
    expect(view.player.position[1]).toBeCloseTo(nativeY)
    expect(view.terrain[0].position[1]).toBe(nativeY)
  })

  it('refuses a mismatched carrier pose or seed', () => {
    expect(() => projectPublicV31WorldView(progress,
      { ...carrier, seed: 'another-world' })).toThrow(RangeError)
    expect(() => projectPublicV31WorldView(progress,
      { ...carrier, player: { ...carrier.player, position: [5, nativeY, 0] } })).toThrow(RangeError)
  })

  it('previews nearby revealed place decisions with checked wet and occupied precedence', () => {
    const v23 = createPublicV23Root(seed)
    const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
    const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
    const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
    const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
    const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
    const v29 = createPublicV29Root({ head: v28.head, lineage: v28.lineage })
    const v30 = createPublicV30Root({ head: v29.head, lineage: v29.lineage })
    const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
      ...inherited } = v30.head
    const stance = { x: -12, z: 16 }
    const support = publicV17StarterSupportAt({ seed, profile: inherited.state.generationProfile,
      route: inherited.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
      built: inherited.state.greenway.builtRouteIds.includes('greenway_ladder'),
      greenwayWorks: inherited.greenwayWorks }, stance)
    if (support?.kind !== 'ground') throw new Error('Missing dry-bank stance')
    const nearby = [
      [-4, 4], [-3, 3], [-3, 4], [-3, 5], [-2, 4],
    ] as const
    const revealed = nearby.map(([gx, gz]) => `tile-${gx + 3}-${gz + 3}`)
    const checked: PublicV31Progress = { ...inherited, raisedSoilCells: [],
      terrain: { ...inherited.terrain,
        bag: { ...inherited.terrain.bag, soil: 1 } },
      state: { ...inherited.state,
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(inherited.state.discoveryMask), ...revealed])].sort()),
        player: { ...inherited.state.player,
          position: { ...stance, y: support.floorY },
          inventory: [...inherited.state.player.inventory,
            { itemId: 'field_spade', quantity: 1 }],
          equipment: { ...inherited.state.player.equipment, mainHand: 'field_spade' } } } }
    expect(decodePublicV31ActionProgress(checked)).not.toBeNull()
    const before = structuredClone(checked)
    const view = projectPublicV31WorldView(checked, { ...carrier,
      player: { ...carrier.player, position: [stance.x, support.floorY, stance.z] } })
    const rows = view.v31Soil?.placePreview ?? []
    expect(rows.length).toBeLessThanOrEqual(9)
    expect(previewPublicV31SoilPlaces({ ...checked, terrain: { ...checked.terrain,
      bag: { ...checked.terrain.bag, soil: 0 } } })).toEqual([])
    expect(previewPublicV31SoilPlaces({ ...checked, state: { ...checked.state,
      player: { ...checked.state.player, equipment: { ...checked.state.player.equipment,
        mainHand: null } } } })).toEqual([])
    expect(previewPublicV31SoilPlaces(null as unknown as PublicV31Progress)).toEqual([])
    expect(rows.find(({ gx, gz }) => gx === -2 && gz === 4)?.rejection).toBe('occupied')
    expect(rows.find(({ gx, gz }) => gx === -3 && gz === 5)?.rejection).toBe('wet')
    for (const { gx, gz, rejection } of rows) {
      expect(revealed).toContain(`tile-${gx + 3}-${gz + 3}`)
      expect(Math.hypot(gx * 4 - stance.x, gz * 4 - stance.z)).toBeLessThanOrEqual(5.5)
      expect(confirmPublicV31SoilAction(checked, { kind: 'soil-place/v1', gx, gz }).rejection
        ?? null).toBe(rejection)
    }
    expect(checked).toEqual(before)

    let valid: { progress: PublicV31Progress; gx: number; gz: number;
      stance: { x: number; z: number }; floorY: number } | null = null
    for (let gx = -10; gx <= 10 && !valid; gx += 1) {
      for (let gz = -10; gz <= 10 && !valid; gz += 1) {
        const nextStance = { x: (gx - 1) * 4, z: gz * 4 }
        const floor = publicV17StarterSupportAt({ seed,
          profile: checked.state.generationProfile,
          route: checked.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
          built: checked.state.greenway.builtRouteIds.includes('greenway_ladder'),
          greenwayWorks: checked.greenwayWorks }, nextStance)
        if (floor?.kind !== 'ground') continue
        const id = `tile-${gx + 3}-${gz + 3}`
        const candidate: PublicV31Progress = { ...checked, state: { ...checked.state,
          discoveryMask: encodeDiscoveredTileIds([...new Set([
            ...decodeDiscoveredTileIds(checked.state.discoveryMask), id])].sort()),
          player: { ...checked.state.player,
            position: { ...nextStance, y: floor.floorY } } } }
        if (confirmPublicV31SoilAction(candidate, { kind: 'soil-place/v1', gx, gz }).progress)
          valid = { progress: candidate, gx, gz, stance: nextStance, floorY: floor.floorY }
      }
    }
    if (!valid) throw new Error('No checked-valid nearby soil fixture')
    const validBefore = structuredClone(valid.progress)
    const validView = projectPublicV31WorldView(valid.progress, { ...carrier,
      player: { ...carrier.player,
        position: [valid.stance.x, valid.floorY, valid.stance.z] } })
    expect(validView.v31Soil?.placePreview?.find(({ gx, gz }) =>
      gx === valid.gx && gz === valid.gz)?.rejection).toBeNull()
    expect(validView.v31Soil?.placePreview?.length).toBeLessThanOrEqual(9)
    expect(valid.progress).toEqual(validBefore)
  }, 30_000)
})
