import { describe, expect, it } from 'vitest'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { createPublicV23Root, decodePublicV23Progress } from './domain/publicWorldV23Snapshot'
import { emptyPublicV26TerrainLedger } from './domain/publicWorldV26TerrainLedger'
import type { PublicV31Progress } from './domain/publicWorldV31Migration'
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
})
