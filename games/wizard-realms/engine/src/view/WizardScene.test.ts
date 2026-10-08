import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { mireglassRouteSites } from '../domain/mireglassRouteSites'
import { highlandRidgeCellAt } from '../domain/highlandRidge'
import { WORLD_CELL_METERS } from '../domain/worldChunks'
import type { WizardLandmark, WizardViewProjection } from './contracts'
import { avatarGearFor, cameraFramingFor, constructionVisuals, digSiteAppearance, fieldCampVisuals, highlandDetailFor, landmarkAppearance, mireglassConstructionGeometry, mireglassDetailFor, ridgeSafeCameraPosition, storeSafeCameraPosition, storeStructureOccludesTarget, storeStructureOccludesView, terrainAppearanceFor, treeTrunkBlocksView } from './WizardScene'
import { visibleTerrainCells } from './visibleTerrain'

const stack = (itemId: string) => ({ id: `inventory-${itemId}`, itemId, name: itemId, quantity: 1 })
const equipment = (overrides: Partial<WizardViewProjection['equipment']> = {}): WizardViewProjection['equipment'] =>
  ({ head: null, chest: null, legs: null, feet: null, mainHand: null, offHand: null, ...overrides })

describe('terrain presentation', () => {
  it('uses smooth world-position tint across adjacent cells without depending on cell ID', () => {
    const cell = { id: 'tile-0-0', position: [0, 0, 0] as const, size: [4, 4] as const,
      height: 2, climate: 'temperate_forest', color: '#56824b' }
    const at = (x: number, z: number) => terrainAppearanceFor({ ...cell, position: [x, 0, z] })
    const distance = (a: THREE.Color, b: THREE.Color) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
    const origin = at(0, 0)
    expect(terrainAppearanceFor({ ...cell, id: 'different-id' }).top.getHex())
      .toBe(origin.top.getHex())
    expect(distance(origin.top, at(4, 0).top)).toBeLessThan(distance(origin.top, at(24, 20).top))
    expect(distance(origin.top, at(4, 0).top)).toBeLessThan(0.025)
    expect(origin.side.getHex()).not.toBe(origin.top.getHex())
  })
})

describe('Mireglass terrain detail', () => {
  it('is stable, sparse, non-interactive scenery within the 17 by 17 visible window', () => {
    const terrains = ['wetland', 'loam', 'rocky'] as const
    const cells = Array.from({ length: 32 * 32 }, (_, index) => {
      const x = index % 32 - 16
      const z = Math.floor(index / 32) - 16
      return { id: `tile-${x}-${z}`, position: [x * 4, 0, z * 4] as const, size: [4, 4] as const,
        height: 2, climate: 'marsh', mireglassTerrain: terrains[index % terrains.length] }
    })
    const visible = visibleTerrainCells(cells, [0, 0, 0])
    expect(visible).toHaveLength(289)
    const details = visible.map(mireglassDetailFor)
    for (const kind of ['water', 'reeds', 'peat', 'stone'] as const) {
      const count = details.filter((detail) => detail[kind]).length
      expect(count).toBeGreaterThan(0)
      expect(count).toBeLessThan(visible.length)
    }
    expect(mireglassDetailFor(visible[0])).toEqual(mireglassDetailFor({ ...visible[0] }))
    expect(mireglassDetailFor({ ...visible[0], mireglassTerrain: undefined }))
      .toMatchObject({ water: false, reeds: false, peat: false, stone: false })
  })

  it('keeps legacy cells bare and gives tagged approach cells deterministic sparse ground detail', () => {
    const base = { id: 'approach-0-0', position: [0, 0, 0] as const, size: [4, 4] as const,
      height: 2, climate: 'temperate_forest' }
    expect(mireglassDetailFor(base)).toMatchObject({ brush: false, pebbles: false, trail: false })
    const approach = Array.from({ length: 576 }, (_, index) => mireglassDetailFor({ ...base,
      id: `approach-${index % 24}-${Math.floor(index / 24)}`, mireglassApproach: true }))
    expect(approach.filter((detail) => detail.brush).length).toBeGreaterThan(576 * 0.52)
    expect(approach.filter((detail) => detail.brush).length).toBeLessThan(576 * 0.72)
    expect(approach.filter((detail) => detail.pebbles).length).toBeGreaterThan(576 * 0.42)
    expect(approach.filter((detail) => detail.pebbles).length).toBeLessThan(576 * 0.62)
    expect(approach.filter((detail) => detail.soil).length).toBeGreaterThan(576 * 0.32)
    expect(approach.filter((detail) => detail.soil).length).toBeLessThan(576 * 0.52)
    expect(approach.every((detail) => !detail.trail)).toBe(true)
    expect(mireglassDetailFor({ ...base, mireglassApproach: true }))
      .toEqual(mireglassDetailFor({ ...base, mireglassApproach: true }))
  })

  it('joins clipped cell segments into one narrow diagonal and places scrub beside it', () => {
    const base = { id: 'diagonal-trail', size: [4, 4] as const, height: 2,
      climate: 'temperate_forest', mireglassApproach: true }
    const first = mireglassDetailFor({ ...base, position: [98, 0, 198] as const,
      mireglassTrailSegment: { from: [96, 196] as const, to: [100, 200] as const } })
    const second = mireglassDetailFor({ ...base, id: 'next-trail', position: [102, 0, 202] as const,
      mireglassTrailSegment: { from: [100, 200] as const, to: [104, 204] as const } })
    expect(first).toMatchObject({ trail: true, trailYaw: Math.PI / 4, trailLength: Math.sqrt(32), trailX: 0, trailZ: 0 })
    expect(second).toMatchObject({ trail: true, trailYaw: Math.PI / 4, trailLength: Math.sqrt(32), trailX: 0, trailZ: 0 })
    const end = [98 + first.trailX + Math.sin(first.trailYaw) * first.trailLength / 2,
      198 + first.trailZ + Math.cos(first.trailYaw) * first.trailLength / 2]
    const start = [102 + second.trailX - Math.sin(second.trailYaw) * second.trailLength / 2,
      202 + second.trailZ - Math.cos(second.trailYaw) * second.trailLength / 2]
    expect(end[0]).toBeCloseTo(start[0])
    expect(end[1]).toBeCloseTo(start[1])
    expect(Math.hypot(first.brushX - first.trailX, first.brushZ - first.trailZ)).toBeCloseTo(1.18)
  })

  it('places sparse waymark stakes off the dry trail from the first west crossing', () => {
    const cell = (gridX: number) => ({ id: `tile-${gridX + 3}-3`,
      position: [gridX * 4, 0, 0] as const, size: [4, 4] as const, height: 2,
      climate: 'temperate_forest', mireglassApproach: true,
      mireglassTrailSegment: { from: [gridX * 4 + 2, 0] as const, to: [gridX * 4 - 2, 0] as const } })
    const crossing = mireglassDetailFor(cell(-4))
    expect(crossing.trailStake).toBe(true)
    expect(crossing).toEqual(mireglassDetailFor({ ...cell(-4) }))
    const approach = Array.from({ length: 64 }, (_, index) => mireglassDetailFor(cell(-4 - index)))
    expect(approach.slice(0, 8).filter((detail) => detail.trailStake).length).toBeGreaterThanOrEqual(2)
    const stakes = approach.filter((detail) => detail.trailStake)
    expect(stakes.length).toBeGreaterThan(4)
    expect(stakes.length).toBeLessThan(16)
    for (const stake of stakes) {
      expect(Math.hypot(stake.stakeX - stake.trailX, stake.stakeZ - stake.trailZ)).toBeCloseTo(1.48)
      expect(Math.hypot(stake.stakeX - stake.brushX, stake.stakeZ - stake.brushZ)).toBeCloseTo(2.66)
    }
    expect(mireglassDetailFor({ ...cell(-4), mireglassTrailSegment: undefined }).trailStake).toBe(false)
    expect(mireglassDetailFor({ ...cell(-4), mireglassTrailSegment: {
      from: [-18, -2] as const, to: [-14, 2] as const } }).trailStake).toBe(false)
  })
})

describe('Highland quarry scenery', () => {
  it('uses a distinct stone surface and sparse low relief without dressing older terrain', () => {
    const cell = { id: 'tile-120--110', position: [468, 3, -452] as const,
      size: [4, 4] as const, height: 2.4, climate: 'dry_highland', color: '#7b765e' }
    const old = terrainAppearanceFor(cell).top
    const quarry = terrainAppearanceFor({ ...cell, highlandSurface: 'quarry' as const }).top
    expect(Math.hypot(quarry.r - old.r, quarry.g - old.g, quarry.b - old.b)).toBeGreaterThan(0.04)
    expect(highlandDetailFor(cell)).toMatchObject({ trail: false, scree: false })
    const details = Array.from({ length: 289 }, (_, index) => highlandDetailFor({ ...cell,
      id: `quarry-${index}`, highlandSurface: 'quarry' as const }))
    const scree = details.filter((detail) => detail.scree).length
    expect(scree).toBeGreaterThan(55)
    expect(scree).toBeLessThan(110)
    expect(highlandDetailFor({ ...cell, highlandSurface: 'quarry' })).toEqual(
      highlandDetailFor({ ...cell, highlandSurface: 'quarry' }))
  })

  it('draws a joined pale trail but leaves its centre clear of quarry scree', () => {
    const first = highlandDetailFor({ id: 'highland-trail-a', position: [96, 0, 0],
      size: [4, 4], height: 2, climate: 'dry_highland', highlandSurface: 'trail',
      highlandTrailSegment: { from: [94, 0], to: [98, 0] } })
    const second = highlandDetailFor({ id: 'highland-trail-b', position: [100, 0, 0],
      size: [4, 4], height: 2, climate: 'dry_highland', highlandSurface: 'trail',
      highlandTrailSegment: { from: [98, 0], to: [102, 0] } })
    expect(first).toMatchObject({ trail: true, scree: false, yaw: Math.PI / 2, length: 4 })
    expect(second).toMatchObject({ trail: true, scree: false, yaw: Math.PI / 2, length: 4 })
    expect(96 + first.trailX + Math.sin(first.yaw) * first.length / 2).toBeCloseTo(
      100 + second.trailX - Math.sin(second.yaw) * second.length / 2)
  })

  it('exposes the Quarry Crown silhouette only for the new landmark discriminator', () => {
    expect(landmarkAppearance({ id: 'highland_quarry/landmark/quarry_crown',
      kind: 'quarry-crown', position: [464, 3, -432], discovered: false })).toBe('quarry-crown')
  })
})

describe('avatar gear projection', () => {
  it('shows no hat, staff, axe, or shield on the bare starting wizard', () => {
    expect(avatarGearFor(equipment())).toEqual({
      hat: false, tunic: false, leggings: false, boots: false, waders: false, mainHand: null, offHand: null, offHandLight: false,
    })
  })

  it('maps each equipped slot to its visible gear', () => {
    expect(avatarGearFor(equipment({ mainHand: stack('woodcutters_axe'), offHand: stack('wooden_shield'), head: stack('apprentice_hat') })))
      .toMatchObject({ hat: true, mainHand: 'axe', offHand: 'shield', offHandLight: false })
    expect(avatarGearFor(equipment({ mainHand: stack('field_spade') }))).toMatchObject({ mainHand: 'spade' })
    expect(avatarGearFor(equipment({ chest: stack('traveler_tunic'), legs: stack('trail_leggings'), feet: stack('leather_boots') })))
      .toMatchObject({ tunic: true, leggings: true, boots: true, waders: false })
  })

  it('shows fen waders only when the authored waders occupy the feet slot', () => {
    expect(avatarGearFor(equipment({ feet: stack('mireglass_reach/item/waders') })))
      .toMatchObject({ boots: false, waders: true })
    expect(avatarGearFor(equipment({ mainHand: stack('mireglass_reach/item/waders') })))
      .toMatchObject({ boots: false, waders: false })
    expect(avatarGearFor(equipment({ feet: stack('unknown_feet') })))
      .toMatchObject({ boots: false, waders: false })
  })

  it('lights an off-hand wand only when the main hand does not already carry one', () => {
    expect(avatarGearFor(equipment({ offHand: stack('oak_wand') }))).toMatchObject({ mainHand: null, offHand: 'wand', offHandLight: true })
    expect(avatarGearFor(equipment({ mainHand: stack('oak_wand'), offHand: stack('oak_wand') }))).toMatchObject({ mainHand: 'wand', offHand: 'wand', offHandLight: false })
  })
})

describe('dig-site view state', () => {
  const ridge = { id: 'ridge_cache' as const, name: 'Buried ridge cache', position: [-6, 0, -9] as const, revealed: false, excavated: false, minimumExcavationLevel: 2 }

  it('keeps an unrevealed cache hidden, then shows its mound and persistent dug ground', () => {
    expect(digSiteAppearance(ridge)).toBe('hidden')
    expect(digSiteAppearance({ ...ridge, revealed: true })).toBe('mound')
    expect(digSiteAppearance({ ...ridge, revealed: true, excavated: true })).toBe('dug')
  })
})

describe('Mireglass landmark view state', () => {
  const marker: WizardLandmark = { id: 'mireglass_reach/landmark/fringe_marker', kind: 'frontier-marker', position: [-380, 0, 320], studied: false }
  const trailGate: WizardLandmark = { id: 'greenway/landmark/west_trail_gate', kind: 'west-trail-gate', position: [-10.5, 1, 0] }
  const alder: WizardLandmark = { id: 'mireglass_reach/landmark/bell_alder', kind: 'bell-alder', position: [-370, 0, 340] }
  const cache: WizardLandmark = { id: 'mireglass_reach/dig/seal_cache', kind: 'seal-cache', position: [-410, 0, 480], revealed: false, excavated: false }

  it('shows the authored frontier marker and bell alder without requiring a dig-site reveal', () => {
    expect(landmarkAppearance(marker)).toBe('frontier-marker')
    expect(landmarkAppearance(trailGate)).toBe('west-trail-gate')
    expect(landmarkAppearance({ ...marker, studied: true })).toBe('frontier-marker')
    expect(landmarkAppearance(alder)).toBe('bell-alder')
  })

  it('keeps the cache invisible until revealed and gives it a persistent dug appearance', () => {
    expect(landmarkAppearance(cache)).toBe('hidden')
    expect(landmarkAppearance({ ...cache, excavated: true })).toBe('hidden')
    expect(landmarkAppearance({ ...cache, revealed: true })).toBe('mound')
    expect(landmarkAppearance({ ...cache, revealed: true, excavated: true })).toBe('dug')
  })
})

describe('construction scene visibility', () => {
  const routes = [
    { id: 'ladder', label: 'Greenway ladder', from: [0, 0, 0] as const, to: [0, 0, -2] as const, built: false, unlocked: true, logCost: 4 },
    { id: 'bridge', label: 'Highland bridge', from: [2, 0, 0] as const, to: [4, 0, 0] as const, built: true, unlocked: true, logCost: 6 },
  ]
  const sites = [
    { id: 'ladder-west', routeId: 'ladder', label: 'West crossing', from: [-3, 0, 0] as const, to: [-3, 0, -2] as const, logCost: 4, status: 'ready' as const, reason: 'Ready', discovered: true },
    { id: 'ladder-east', routeId: 'ladder', label: 'East crossing', from: [3, 0, 0] as const, to: [3, 0, -2] as const, logCost: 4, status: 'ready' as const, reason: 'Ready', discovered: true },
    { id: 'ladder-fog', routeId: 'ladder', label: 'Hidden crossing', from: [5, 0, 0] as const, to: [5, 0, -2] as const, logCost: 4, status: 'ready' as const, reason: 'Ready', discovered: false },
  ]

  it('shows completed structures and only the one selected discovered preview', () => {
    expect(constructionVisuals(routes, sites, null).map((route) => route.id)).toEqual(['bridge'])
    expect(constructionVisuals(routes, sites, 'ladder-east').map((route) => route.id)).toEqual(['bridge', 'ladder-east'])
    expect(constructionVisuals(routes, sites, 'ladder-west')[1]).toMatchObject({ from: [-3, 0, 0], to: [-3, 0, -2], built: false })
    expect(constructionVisuals(routes, sites, 'ladder-fog').map((route) => route.id)).toEqual(['bridge'])
  })

  it('does not draw a duplicate ghost after its route has been built', () => {
    const built = [{ ...routes[0], built: true }, routes[1]]
    expect(constructionVisuals(built, sites, 'ladder-east').map((route) => route.id)).toEqual(['ladder', 'bridge'])
  })

  it('fits a joined fen deck and steep slate ladder to canonical Mireglass route endpoints', () => {
    const choices = mireglassRouteSites('greenway-alpha')
    const bridgeSite = choices.find((site) => site.kind === 'bridge')!
    const ladderSite = choices.find((site) => site.kind === 'ladder')!
    const viewOf = (site: typeof bridgeSite, id: string) => ({ id,
      from: [site.from.x, site.from.y, site.from.z] as const,
      to: [site.to.x, site.to.y, site.to.z] as const })
    const bridge = mireglassConstructionGeometry(viewOf(bridgeSite, bridgeSite.routeId))!
    const ladder = mireglassConstructionGeometry(viewOf(ladderSite, ladderSite.id))!
    expect(bridge.kind).toBe('bridge')
    expect(bridge.run).toBe(8)
    expect(bridge.run + 0.7).toBeGreaterThan(bridgeSite.spanMeters)
    expect(bridge.run / bridge.count + 0.04).toBeGreaterThan(bridge.run / bridge.count)
    expect(ladder.kind).toBe('ladder')
    expect(ladder.rise).toBeCloseTo(1.56)
    expect(ladder.run).toBeLessThan(1)
    expect(ladder.pitch).toBeLessThan(-1)
    expect(ladder.midpoint[1] + 0.14 - ladder.length * Math.sin(-ladder.pitch) / 2)
      .toBeCloseTo(ladderSite.from.y + 0.14)
    expect(ladder.midpoint[1] + 0.14 + ladder.length * Math.sin(-ladder.pitch) / 2)
      .toBeCloseTo(ladderSite.to.y + 0.14)
    expect(mireglassConstructionGeometry({ ...viewOf(ladderSite, 'greenway_ladder') })).toBeNull()
  })
})

describe('field camp scene visibility', () => {
  const terrain = Array.from({ length: 32 * 32 }, (_, index) => ({
    id: `legacy-offset-${index}`, position: [(index % 32 - 16) * 4, 2, (Math.floor(index / 32) - 16) * 4] as const,
    size: [4, 4] as const, height: 2, climate: 'marsh',
  }))
  const visible = visibleTerrainCells(terrain, [0, 2, 0])
  const camp = { tileId: 'canonical-camp', position: [0, 2, 0] as const }
  const preview = { tileId: 'candidate', position: [4, 2, 0] as const, rejection: null }
  const view = { camps: [camp], preview, selectionEnabled: true }

  it('leaves absent camp projections empty and uses the canonical resolved ground position', () => {
    expect(fieldCampVisuals(undefined, visible)).toEqual([])
    expect(fieldCampVisuals(view, visible)).toEqual([
      { ...camp, status: 'built' }, { tileId: preview.tileId, position: preview.position, status: 'ready' },
    ])
    expect(fieldCampVisuals({ ...view, selectionEnabled: false }, visible)).toHaveLength(2)
  })

  it('bounds committed camps to one and never draws a duplicate or unresolved preview', () => {
    expect(fieldCampVisuals({ ...view, camps: [camp, { ...camp, tileId: 'extra' }] }, visible)).toHaveLength(2)
    expect(fieldCampVisuals({ ...view, preview: { ...preview, tileId: camp.tileId } }, visible)).toHaveLength(1)
    expect(fieldCampVisuals({ ...view, preview: { ...preview, position: camp.position } }, visible)).toHaveLength(1)
    expect(fieldCampVisuals({ ...view, preview: { ...preview, position: null } }, visible)).toHaveLength(1)
    expect(fieldCampVisuals({ ...view, preview: null }, visible)).toEqual([{ ...camp, status: 'built' }])
  })

  it('clips full footprints to the current visible cells and shows resolved rejections distinctly', () => {
    expect(fieldCampVisuals(view, [])).toEqual([])
    expect(fieldCampVisuals({ ...view, camps: [{ ...camp, position: [60, 2, 0] }] }, visible))
      .toEqual([{ tileId: preview.tileId, position: preview.position, status: 'ready' }])
    expect(fieldCampVisuals({ ...view, camps: [], preview: { ...preview, position: [33.5, 2, 0] } }, visible)).toEqual([])
    expect(fieldCampVisuals({ ...view, camps: [], preview: { ...preview, position: [NaN, 2, 0] } }, visible)).toEqual([])
    expect(fieldCampVisuals({ ...view, preview: { ...preview,
      rejection: { code: 'not_owned', message: 'A camp needs 4 logs and 1 stone.' } } }, visible)[1].status).toBe('blocked')
  })
})

describe('tree camera obstruction', () => {
  const camera = new THREE.Vector3(0, 1.7, 6)
  const avatar = new THREE.Vector3(0, 0, 0)

  it('fades a near-camera trunk even when its high canopy misses the center sightline', () => {
    expect(treeTrunkBlocksView(camera, avatar, [1.2, 0, 5.4], 1, 0.25)).toBe(true)
    expect(treeTrunkBlocksView(camera, avatar, [0.3, 0, 6], 1, 0.25)).toBe(true)
  })

  it('keeps distant, behind-camera, and high-clearance tree silhouettes opaque', () => {
    expect(treeTrunkBlocksView(camera, avatar, [3, 0, 5.4], 1, 0.25)).toBe(false)
    expect(treeTrunkBlocksView(camera, avatar, [0, 0, 8], 1, 0.25)).toBe(false)
    expect(treeTrunkBlocksView(new THREE.Vector3(0, 6, 6), new THREE.Vector3(0, 6, 0), [0, 0, 5], 1, 0.25)).toBe(false)
  })
})

describe('shop-aware follow camera', () => {
  const target = new THREE.Vector3(0, 1.35, 0)
  const desired = new THREE.Vector3(0, 4.32, 6.14)
  const storeAt = (x: number) => ({ id: `store-${x}`, name: 'Outfitters', position: [x, 0, 2] as const, listings: [], sellOffers: [] })

  it('orbits away from the shop roof behind the fresh spawn without crowding the wizard', () => {
    const stores = [storeAt(-2)]
    const camera = storeSafeCameraPosition(target, desired, stores, null, 0.016)
    expect(camera.x).toBeGreaterThan(0)
    expect(camera.distanceTo(target)).toBeGreaterThan(5)
    expect(storeSafeCameraPosition(target, camera, stores, null, 0.016).distanceTo(camera)).toBeLessThan(1e-6)
  })

  it('chooses the opposite side for a mirrored shop and leaves a clear orbit unchanged', () => {
    expect(storeSafeCameraPosition(target, desired, [storeAt(2)], null, 0.016).x).toBeLessThan(0)
    expect(storeSafeCameraPosition(target, desired, [storeAt(-12)], null, 0.016).toArray()).toEqual(desired.toArray())
  })

  it('hides an overlapping shop structure and keeps the full follow distance inside it', () => {
    const stores = [storeAt(-2)]
    const inside = new THREE.Vector3(-2, 1.35, 2)
    const desiredBehind = inside.clone().add(new THREE.Vector3(0, 2.97, 6.14))
    const camera = storeSafeCameraPosition(inside, desiredBehind, stores, null, 0.016)
    expect(storeStructureOccludesTarget(inside, stores[0])).toBe(true)
    expect(camera.toArray()).toEqual(desiredBehind.toArray())
    expect(storeSafeCameraPosition(inside, camera, stores, null, 0.016).distanceTo(camera)).toBeLessThan(1e-6)

    const nearWall = new THREE.Vector3(-0.4, 1.35, 2)
    const outward = nearWall.clone().add(new THREE.Vector3(6, 2.97, 0))
    expect(storeStructureOccludesTarget(nearWall, stores[0])).toBe(true)
    expect(storeSafeCameraPosition(nearWall, outward, stores, null, 0.016).toArray()).toEqual(outward.toArray())
    expect(storeStructureOccludesTarget(new THREE.Vector3(0.5, 1.35, 2), stores[0])).toBe(false)
    expect(storeStructureOccludesTarget(new THREE.Vector3(-2, 5, 2), stores[0])).toBe(false)
  })

  it('hides a shop crossed by the compact camera just outside the Outfitters footprint', () => {
    const shop = { ...storeAt(-5), position: [-5, 0, -1] as const }
    const player = new THREE.Vector3(-2.6, 0, -1.9)
    const compact = cameraFramingFor(682, 350)
    const pitch = 0.28 * compact.pitchScale
    const target = player.clone().add(new THREE.Vector3(0, compact.focusHeight, 0))
    const desired = target.clone().add(new THREE.Vector3(
      -Math.cos(pitch) * compact.distance, compact.eyeRise + Math.sin(pitch) * compact.distance, 0))
    const clearEast = target.clone().add(new THREE.Vector3(compact.distance, compact.eyeRise, 0))
    expect(storeStructureOccludesTarget(target, shop)).toBe(false)
    expect(storeStructureOccludesView(target, desired, shop)).toBe(true)
    expect(storeStructureOccludesView(player, desired, shop)).toBe(true)
    expect(storeSafeCameraPosition(target, desired, [shop], null, 0.016).toArray()).toEqual(desired.toArray())
    expect(storeStructureOccludesView(target, clearEast, shop)).toBe(false)
  })

  it('eases through nearby poses with finite coordinates and clear sightlines', () => {
    const stores = [storeAt(-2)]
    let camera = storeSafeCameraPosition(target, desired, stores, null, 0.016)
    for (let frame = 1; frame <= 30; frame += 1) {
      const nextTarget = target.clone().add(new THREE.Vector3(frame * 0.02, 0, 0))
      const nextDesired = desired.clone().add(new THREE.Vector3(frame * 0.02, 0, 0))
      const next = storeSafeCameraPosition(nextTarget, nextDesired, stores, camera, 0.016)
      expect(next.toArray().every(Number.isFinite)).toBe(true)
      expect(next.distanceTo(camera)).toBeLessThan(0.3)
      expect(storeSafeCameraPosition(nextTarget, next, stores, null, 0.016).distanceTo(next)).toBeLessThan(1e-6)
      camera = next
    }
  })

  it('frames the 853 by 480 spawn below the roof and above the compact objective bar', () => {
    const compact = cameraFramingFor(853, 480)
    const desktop = cameraFramingFor(1280, 800)
    expect(compact.focusHeight).toBeLessThan(desktop.focusHeight)
    expect(compact.pitchScale).toBeLessThan(desktop.pitchScale)
    const compactTarget = new THREE.Vector3(0, compact.focusHeight, 0)
    const pitch = 0.28 * compact.pitchScale
    const compactDesired = compactTarget.clone().add(new THREE.Vector3(0, compact.eyeRise + Math.sin(pitch) * compact.distance, Math.cos(pitch) * compact.distance))
    expect(storeSafeCameraPosition(compactTarget, compactDesired, [storeAt(-2)], null, 0.016).toArray()).toEqual(compactDesired.toArray())
  })
})

describe('ridge-aware follow camera', () => {
  const cellAt = (x: number, z: number) => highlandRidgeCellAt(
    Math.ceil(x / WORLD_CELL_METERS - 0.5) * WORLD_CELL_METERS,
    Math.ceil(z / WORLD_CELL_METERS - 0.5) * WORLD_CELL_METERS)
  const expectGallerySightline = (target: THREE.Vector3, camera: THREE.Vector3) => {
    for (let step = 0; step <= 100; step += 1) {
      const point = target.clone().lerp(camera, step / 100)
      expect(cellAt(point.x, point.z)).toBe('gallery')
    }
    expect(camera.y).toBeLessThanOrEqual(6.8)
  }

  it('keeps north- and south-facing views beside the player inside the gallery', () => {
    const target = new THREE.Vector3(580, 4, -466)
    for (const direction of [-1, 1]) {
      const desired = target.clone().add(new THREE.Vector3(0, 3.2, direction * 6.4))
      const camera = ridgeSafeCameraPosition(target, desired)
      expect(camera.distanceTo(target)).toBeGreaterThan(5)
      expectGallerySightline(target, camera)
    }
  })

  it('clears the observed near-wall view and moves smoothly along the gallery', () => {
    const offset = new THREE.Vector3(Math.sin(-0.13) * 6.4, 3, Math.cos(-0.13) * 6.4)
    const start = new THREE.Vector3(577.3, 3.8, -463)
    let previous = ridgeSafeCameraPosition(start, start.clone().add(offset))
    expectGallerySightline(start, previous)
    for (let frame = 1; frame <= 20; frame += 1) {
      const target = start.clone().add(new THREE.Vector3(frame * 0.02, 0, 0))
      const next = ridgeSafeCameraPosition(target, target.clone().add(offset))
      expect(next.distanceTo(previous)).toBeLessThan(0.1)
      expectGallerySightline(target, next)
      previous = next
    }
  })

  it('leaves exterior camera positions unchanged', () => {
    const target = new THREE.Vector3(520, 4, -466)
    const desired = target.clone().add(new THREE.Vector3(0, 3.2, 6.4))
    expect(ridgeSafeCameraPosition(target, desired).toArray()).toEqual(desired.toArray())
  })
})
