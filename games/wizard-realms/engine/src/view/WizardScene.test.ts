import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as THREE from 'three'
import { mireglassRouteSites } from '../domain/mireglassRouteSites'
import { mireglassFullApproachTrail, mireglassV42FullApproachTrail } from '../domain/mireglassApproachTrail'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from '../domain/discoveryMask'
import { discoveredTileIdsInActiveWindow } from '../domain/publicV13DiscoveryWindow'
import { publicWorldV16TileAtGrid, resolvePublicV16GreenwaySite } from '../domain/publicWorldV16GreenwaySites'
import { resolvePublicV17GreenwaySite } from '../domain/publicWorldV17GreenwaySites'
import { resolvePublicV28RiverBridge } from '../domain/publicWorldV28RiverBridgeSites'
import { resolvePublicV23Site } from '../domain/publicWorldV23Sites'
import { createFreshPublicV16Head } from '../domain/publicWorldV16Snapshot'
import { publicWorldV16ViewProjection } from '../PublicV16WorldView'
import { displayPublicV28RiverBridge } from '../PublicV28WorldView'
import { resolveTerrainWorkSite } from '../domain/terrainWorks'
import { highlandRidgeCellAt } from '../domain/highlandRidge'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN, worldTileAtGrid } from '../domain/worldChunks'
import { starterCliffCanonicalFace, starterCliffCanonicalSite } from '../domain/starterCliffProfile'
import { publicV26ValleyRimSegments } from '../domain/publicWorldV26ValleyRim'
import type { WizardLandmark, WizardResourceNode, WizardTerrainCell, WizardViewProjection } from './contracts'
import { Axe, avatarGearFor, cameraFramingFor, cameraOrbitDamping, constructionVisuals, digSiteAppearance, fieldCampVisuals, fogEndFor, fogVisibleDressingCells, highlandDetailFor, landscapeDressingEnabledForSearch, landmarkAppearance, MiningPick, mireglassConstructionGeometry, mireglassDetailFor, MIREGLASS_REED_GEOMETRY, pickVisibleWorkAimX, PUBLIC_FOG_END_M, PUBLIC_FOG_START_M, ridgeSafeCameraPosition, savedTerrainWorkMarkers, savedTerrainWorkVisuals, sceneFrameLoopForSave, sceneGraphicsOptionsForSearch, sceneGraphicsSearchForResolution, sceneProbeShadows, sceneResolutionForSearch, sceneShadowProbeEnabled, sceneTerrainFor, sceneTerrainPickKind, starterCliffConstructionVisuals, starterCliffLadderGeometry, StarterCliffLadder, STORE_POST_GEOMETRY, StorePosts, storeSafeCameraPosition, storeStructureOccludesTarget, storeStructureOccludesView, terrainAppearanceFor, terrainCellVisualsEqual, terrainWorkApproachMarkers, terrainWorkCandidateMarkers, terrainWorkConstructionVisuals, terrainWorkStructureGeometry, TerrainWorkStructure, TreeMeshes, treeMeshBlocksGroundPick, treeOcclusionAppearance, treeTrunkBlocksView, UNCHARTED_GROUND_MATERIAL, v26TargetedTerrainCell, v42TrailTerrainFor, visibleV26PitLadders, WORLD_BEDROCK_BOUNDS } from './WizardScene'
import { buildV26ValleyRimGeometry } from './V26ValleyRimLayer'
import { PUBLIC_VISUAL_RADIUS_CELLS, visibleTerrainCells } from './visibleTerrain'

const stack = (itemId: string) => ({ id: `inventory-${itemId}`, itemId, name: itemId, quantity: 1 })
const equipment = (overrides: Partial<WizardViewProjection['equipment']> = {}): WizardViewProjection['equipment'] =>
  ({ head: null, chest: null, legs: null, feet: null, mainHand: null, offHand: null, ...overrides })

describe('save-only scene frame loop', () => {
  it('runs normally outside a save and pauses only an active save', () => {
    expect(sceneFrameLoopForSave(false, '', true)).toBe('always')
    expect(sceneFrameLoopForSave(true, '', true)).toBe('always')
    expect(sceneFrameLoopForSave(true, '?saveRenderPause=on', true)).toBe('demand')
    expect(sceneFrameLoopForSave(false, '?saveRenderPause=off', true)).toBe('always')
    expect(sceneFrameLoopForSave(true, '?saveRenderPause=off', true)).toBe('always')
    expect(sceneFrameLoopForSave(true, '?saveRenderPause=on', false)).toBe('always')
  })
})

type RenderedMesh = { material?: THREE.Material; geometry?: THREE.BufferGeometry; name?: string;
  castShadow?: boolean; position?: readonly [number, number, number];
  rotation?: readonly [number, number, number]; scale?: number | readonly [number, number, number] }
const renderedMeshes = (node: unknown): RenderedMesh[] => {
  if (Array.isArray(node)) return node.flatMap(renderedMeshes)
  if (!node || typeof node !== 'object' || !('type' in node) || !('props' in node)) return []
  const element = node as { type: unknown; props: RenderedMesh & { children?: unknown } }
  return [...(element.type === 'mesh' ? [element.props] : []), ...renderedMeshes(element.props.children)]
}

const expectPreviewWireframe = (meshes: ReturnType<typeof renderedMeshes>) => {
  expect(meshes.length).toBeGreaterThan(0)
  for (const { material } of meshes) {
    expect(material).toMatchObject({ wireframe: true, transparent: true, depthWrite: false })
    expect(material?.opacity).toBeLessThan(1)
  }
}

describe('store post batch', () => {
  it('keeps all four post silhouettes, shadows and first-hit rays with one mesh', () => {
    const [post] = renderedMeshes(StorePosts())
    expect(renderedMeshes(StorePosts())).toHaveLength(1)
    expect(post).toMatchObject({ name: 'Store corner posts', geometry: STORE_POST_GEOMETRY,
      castShadow: true })
    expect(post.material).toMatchObject({ transparent: false, roughness: 0.9 })
    expect((post.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('4a3222')
    const old = new THREE.Group()
    for (const x of [-1.52, 1.52]) for (const z of [-1.03, 1.03]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
      mesh.position.set(x, 1.3, z)
      mesh.scale.set(0.18, 2, 0.18)
      old.add(mesh)
    }
    const merged = new THREE.Mesh(STORE_POST_GEOMETRY)
    const triangles = (geometry: THREE.BufferGeometry) =>
      (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
    expect(triangles(STORE_POST_GEOMETRY)).toBe(48)
    expect(triangles(STORE_POST_GEOMETRY)).toBe(old.children.reduce((count, child) =>
      count + triangles((child as THREE.Mesh).geometry), 0))
    const oldBounds = new THREE.Box3().setFromObject(old, true)
    const newBounds = new THREE.Box3().setFromObject(merged, true)
    expect(newBounds.min.distanceTo(oldBounds.min)).toBeLessThan(1e-6)
    expect(newBounds.max.distanceTo(oldBounds.max)).toBeLessThan(1e-6)
    for (const x of [-1.52, 1.52]) for (const z of [-1.03, 1.03]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0))
      expect(ray.intersectObject(merged)[0].distance).toBeCloseTo(ray.intersectObjects(old.children)[0].distance, 6)
    }
    old.children.forEach((child) => (child as THREE.Mesh).geometry.dispose())
  })
})

describe('finite world bedrock', () => {
  it('ends at all four canonical grid faces with a fixed center and size', () => {
    const minFace = (WORLD_GRID_MIN - 0.5) * WORLD_CELL_METERS
    const maxFace = (WORLD_GRID_MAX + 0.5) * WORLD_CELL_METERS
    expect(WORLD_BEDROCK_BOUNDS).toEqual({
      west: minFace, east: maxFace, north: minFace, south: maxFace,
      centerX: (minFace + maxFace) / 2, centerZ: (minFace + maxFace) / 2,
      width: maxFace - minFace, depth: maxFace - minFace,
    })
    expect(WORLD_BEDROCK_BOUNDS.centerX - WORLD_BEDROCK_BOUNDS.width / 2).toBe(WORLD_BEDROCK_BOUNDS.west)
    expect(WORLD_BEDROCK_BOUNDS.centerX + WORLD_BEDROCK_BOUNDS.width / 2).toBe(WORLD_BEDROCK_BOUNDS.east)
    expect(WORLD_BEDROCK_BOUNDS.centerZ - WORLD_BEDROCK_BOUNDS.depth / 2).toBe(WORLD_BEDROCK_BOUNDS.north)
    expect(WORLD_BEDROCK_BOUNDS.centerZ + WORLD_BEDROCK_BOUNDS.depth / 2).toBe(WORLD_BEDROCK_BOUNDS.south)
    expect(WORLD_BEDROCK_BOUNDS.centerX).toBe(-2)
    expect(WORLD_BEDROCK_BOUNDS.centerZ).toBe(-2)
    expect(WORLD_BEDROCK_BOUNDS.width).toBe(2048)
    expect(WORLD_BEDROCK_BOUNDS.depth).toBe(2048)
  })
})

describe('V42 selected-bridge scene trail', () => {
  it('keeps the selected off-center bridge trail fixed as the camera/player moves away', () => {
    const seed = 'wizard-realms'
    const offCenterId = 'works4:bridge:greenway-creek:-60'
    const center = new Set(mireglassV42FullApproachTrail(seed).map(({ x, z }) => `${x}:${z}`))
    const point = mireglassV42FullApproachTrail(seed, offCenterId).slice(5)
      .find(({ x, z }) => x % 4 === 0 && z % 4 === 0 && !center.has(`${x}:${z}`))!
    const tile = worldTileAtGrid(seed, point.x / 4, point.z / 4)
    const cell: WizardTerrainCell = { id: tile.id,
      position: [point.x, tile.center.y, point.z], size: [4, 4],
      height: tile.center.y, climate: 'temperate_forest' }
    const selected = v42TrailTerrainFor(seed, [cell], undefined, offCenterId)
    expect(selected[0].mireglassTrailSegment).toBeDefined()
    expect(v42TrailTerrainFor(seed, [cell])[0].mireglassTrailSegment).toBeUndefined()
    const seen = (x: number) => sceneTerrainFor({ seed,
      player: { position: [x, tile.center.y, point.z] },
      visualWorld: { terrain: selected, discoveredTileIds: [cell.id] },
    } as unknown as WizardViewProjection, selected).revealedTerrain
    expect(seen(point.x)[0].mireglassTrailSegment).toEqual(
      seen(point.x + 4)[0].mireglassTrailSegment)
    expect(v42TrailTerrainFor(seed, [cell], undefined, offCenterId)[0].mireglassTrailSegment)
      .toEqual(selected[0].mireglassTrailSegment)
  })

  it('replaces the obsolete west trail on dry cells without mutating source terrain or older views', () => {
    const seed = 'wizard-realms'
    const current = mireglassV42FullApproachTrail(seed)
    const currentKeys = new Set(current.map(({ x, z }) => `${x}:${z}`))
    const old = mireglassFullApproachTrail(seed).find(({ x, z }) =>
      !currentKeys.has(`${x}:${z}`) && x === -32 && z === 0)!
    const point = current.slice(5).find(({ x, z }) =>
      Number.isInteger(x / 4) && Number.isInteger(z / 4))!
    const next = current.slice(6).find(({ x, z }) =>
      Number.isInteger(x / 4) && Number.isInteger(z / 4)
        && (x !== point.x || z !== point.z))!
    const cell = ({ x, z }: { x: number; z: number }): WizardTerrainCell => {
      const tile = worldTileAtGrid(seed, x / 4, z / 4)
      return { id: tile.id, position: [x, tile.center.y, z], size: [4, 4],
        height: tile.center.y, climate: 'temperate_forest' }
    }
    const oldCell = { ...cell(old), mireglassApproach: true,
      mireglassTrailSegment: { from: [old.x - 2, old.z] as const,
        to: [old.x + 2, old.z] as const } }
    const currentCell = cell(point)
    const hiddenCell = cell(next)
    const gapCell: WizardTerrainCell = { id: 'tile-3-5', position: [0, 0, 8],
      size: [4, 4], height: 0, climate: 'temperate_forest' }
    const source = [oldCell, currentCell, hiddenCell, gapCell]
    const before = JSON.stringify(source)
    const dressed = v42TrailTerrainFor(seed, source)
    expect(dressed[0]).not.toHaveProperty('mireglassTrailSegment')
    expect(dressed[0]).not.toHaveProperty('mireglassApproach')
    expect(dressed[1].mireglassTrailSegment).toBeDefined()
    expect(dressed[2].mireglassTrailSegment).toBeDefined()
    expect(dressed[3].mireglassTrailSegment).toBeUndefined()
    expect(JSON.stringify(source)).toBe(before)
    const projection = { seed, player: { position: currentCell.position }, visualWorld: {
      terrain: source, discoveredTileIds: [oldCell.id, currentCell.id] } } as unknown as WizardViewProjection
    expect(sceneTerrainFor(projection).revealedTerrain.find((tile) => tile.id === oldCell.id))
      .toBe(oldCell) // V6-V41 still use their existing scene cells.
    const visible = sceneTerrainFor(projection, dressed).revealedTerrain
    expect(visible.map(({ id }) => id)).toEqual([oldCell.id, currentCell.id])
    expect(visible.find((tile) => tile.id === oldCell.id)?.mireglassTrailSegment).toBeUndefined()
    expect(visible.find((tile) => tile.id === currentCell.id)?.mireglassTrailSegment).toBeDefined()
    expect(v42TrailTerrainFor(seed, source, [{ gx: point.x / 4, gz: point.z / 4,
      openDepth: 1 }])[1].mireglassTrailSegment).toBeUndefined()
  })
})

describe('V26 scene discovery gate', () => {
  it('opts only the V29 view into saved-pit targeting for Dig, Mine, and hover', () => {
    const historical = {} as WizardViewProjection
    const v29 = { v29Mining: {} } as WizardViewProjection
    expect(sceneTerrainPickKind(historical)).toBe('dig')
    expect(sceneTerrainPickKind(historical, 'dig')).toBe('dig')
    expect(sceneTerrainPickKind(historical, 'fill')).toBe('fill')
    expect(sceneTerrainPickKind(v29)).toBe('v29-open-pit')
    expect(sceneTerrainPickKind(v29, 'dig')).toBe('v29-open-pit')
    expect(sceneTerrainPickKind(v29, 'mine')).toBe('v29-open-pit')
    expect(sceneTerrainPickKind(v29, 'fill')).toBe('fill')
    expect(sceneTerrainPickKind(v29, 'place-soil')).toBe('dig')
  })
  it('highlights only a nearby revealed dry canonical spade target, without claiming authorization', () => {
    const ground: WizardTerrainCell = { id: 'tile-3-3', position: [0, 1, 0], size: [4, 4],
      height: 1.8, climate: 'temperate_forest' }
    const wet: WizardTerrainCell = { ...ground, id: 'tile-3-5', position: [0, 1, 8] }
    const projection = { seed: 'wizard-realms', player: { position: [0, 1, 0] },
      equipment: equipment({ mainHand: stack('field_spade') }),
      controllerActionsEnabled: true, v26ValleyRimSegments: [] } as unknown as WizardViewProjection
    expect(v26TargetedTerrainCell(projection, [ground], { gx: 0, gz: 0 })).toBe(ground)
    const bank: WizardTerrainCell = { ...ground, id: 'tile-3-7', position: [0, 1, 16] }
    expect(v26TargetedTerrainCell({ ...projection, player: { ...projection.player,
      position: [0, 1, 16] } }, [bank], { gx: 0, gz: 4 })).toBe(bank)
    expect(v26TargetedTerrainCell({ ...projection, player: { ...projection.player,
      position: [0, 1, 8] } }, [wet], { gx: 0, gz: 2 })).toBeNull()
    expect(v26TargetedTerrainCell(projection, [], { gx: 0, gz: 0 })).toBeNull()
    expect(v26TargetedTerrainCell(projection, [{ ...ground, id: 'tile-4-3' }], { gx: 0, gz: 0 })).toBeNull()
    expect(v26TargetedTerrainCell(projection, [wet], { gx: 0, gz: 2 })).toBeNull()
    expect(v26TargetedTerrainCell({ ...projection, v26ValleyRimSegments: undefined }, [ground], { gx: 0, gz: 0 })).toBeNull()
    expect(v26TargetedTerrainCell({ ...projection, controllerActionsEnabled: false }, [ground], { gx: 0, gz: 0 })).toBeNull()
    expect(v26TargetedTerrainCell({ ...projection, equipment: equipment() }, [ground], { gx: 0, gz: 0 })).toBeNull()
    expect(v26TargetedTerrainCell({ ...projection, equipment: equipment(),
      v29Mining: { tools: { basicPickOwned: true, enchantedPickOwned: false, activePick: 'basic' },
        offers: [], bids: { soil: 1, stone: 3, iron_ore: 8, gold_ore: 15, diamond: 60 },
        bag: { soil: 0, stone: 0, iron_ore: 0, gold_ore: 0, diamond: 0 },
        excavationLevel: 2, atOutfitters: false } }, [ground], { gx: 0, gz: 0 })).toBe(ground)
    expect(v26TargetedTerrainCell({ ...projection, player: { ...projection.player, position: [40, 1, 0] } },
      [ground], { gx: 0, gz: 0 })).toBeNull()
  })

  it('renders pit ladders only with the exact revealed floor and canonical cell', () => {
    const cell: WizardTerrainCell = { id: 'tile-6-4', position: [12, 1.2, 4],
      size: [4, 4], height: 1.9, climate: 'temperate_forest' }
    const ladder = { cellId: cell.id, gx: 3, gz: 1, floorY: 1.2, rimY: 2 }
    expect(visibleV26PitLadders([ladder], [cell])).toEqual([ladder])
    expect(visibleV26PitLadders(undefined, [cell])).toEqual([])
    expect(visibleV26PitLadders([ladder], [])).toEqual([])
    expect(visibleV26PitLadders([ladder], [{ ...cell, position: [12, 1.6, 4] }])).toEqual([])
    expect(visibleV26PitLadders([ladder], [{ ...cell, id: 'tile-7-4' }])).toEqual([])
    expect(visibleV26PitLadders([{ ...ladder, rimY: ladder.floorY }], [cell])).toEqual([])
  })

  it('passes only revealed cells to the saved-aperture rim mesh', () => {
    const cell = (x: number, z: number): WizardTerrainCell => ({
      id: `${x}:${z}`, position: [x, 0, z], size: [4, 4], height: 0.7,
      climate: 'rocky', color: '#7b765e' })
    const tiles = [-4, 0, 4, 28].flatMap((x) => [cell(x, -4), cell(x, -8)])
    const segments = publicV26ValleyRimSegments('wizard-realms', [{ x: -2, widthMeters: 1.05 }])
    const projection = { player: { position: [0, 0, -4] },
      visualWorld: { terrain: tiles, discoveredTileIds: ['-4:-4', '0:-4'] },
      v26ValleyRimSegments: segments } as unknown as WizardViewProjection
    const { revealedTerrain } = sceneTerrainFor(projection)
    expect(revealedTerrain.map((entry) => entry.id)).toEqual(['-4:-4', '0:-4'])
    const geometry = buildV26ValleyRimGeometry(segments, revealedTerrain)
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute
    expect(positions.count).toBeGreaterThan(0)
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index)
      expect(x > -2.524 && x < -1.476).toBe(false)
      expect(x).toBeLessThan(6)
    }
    geometry.dispose()
  })
})

describe('opt-in software graphics profile', () => {
  it('keeps normal GPU quality unless graphics=software is exact', () => {
    const normal = { dpr: [1, 1.5], shadows: { type: THREE.PCFShadowMap }, antialias: true }
    expect(sceneGraphicsOptionsForSearch('')).toEqual(normal)
    expect(sceneGraphicsOptionsForSearch('?publicWorld=v17&graphics=high')).toEqual(normal)
    expect(sceneGraphicsOptionsForSearch('?graphics=softwareish')).toEqual(normal)
    expect(sceneGraphicsOptionsForSearch('?publicWorld=v17&graphics=software'))
      .toEqual({ dpr: 1, shadows: false, antialias: false })
  })

  it('uses a lower pixel ratio only for the exact resolution75 profile', () => {
    const reduced = { dpr: 0.75, shadows: { type: THREE.PCFShadowMap }, antialias: true }
    expect(sceneGraphicsOptionsForSearch('?dev=1&graphics=resolution75')).toEqual(reduced)
    expect(sceneGraphicsOptionsForSearch('?graphics=resolution75ish')).toEqual({
      dpr: [1, 1.5], shadows: { type: THREE.PCFShadowMap }, antialias: true,
    })
  })

  it('switches only resolution and preserves the rest of the running scene URL', () => {
    const initial = '?dev=1&rendererProbe=1&graphics=resolution75'
    expect(sceneResolutionForSearch(initial)).toBe('performance')
    const quality = sceneGraphicsSearchForResolution(initial, 'quality')
    expect(quality).toBe('?dev=1&rendererProbe=1')
    expect(sceneGraphicsOptionsForSearch(quality, 'quality')).toEqual({
      dpr: [1, 1.5], shadows: { type: THREE.PCFShadowMap }, antialias: true,
    })
    const performance = sceneGraphicsSearchForResolution(quality, 'performance')
    expect(performance).toBe(initial)
    expect(sceneGraphicsOptionsForSearch(performance, 'performance')).toEqual({
      dpr: 0.75, shadows: { type: THREE.PCFShadowMap }, antialias: true,
    })
    expect(sceneResolutionForSearch('?graphics=software')).toBe('quality')
  })
})

describe('opt-in same-resolution shadow probe', () => {
  it('is available only with exact development flags', () => {
    expect(sceneShadowProbeEnabled('?dev=1&shadowProbe=1', true)).toBe(true)
    for (const search of ['', '?shadowProbe=1', '?dev=1', '?dev=1&shadowProbe=on']) {
      expect(sceneShadowProbeEnabled(search, true)).toBe(false)
    }
    expect(sceneShadowProbeEnabled('?dev=1&shadowProbe=1', false)).toBe(false)
  })

  it('changes only the shadow pass for an A/B/A comparison', () => {
    const graphics = sceneGraphicsOptionsForSearch('?graphics=software&dev=1&shadowProbe=1')
    expect(graphics).toEqual({ dpr: 1, shadows: false, antialias: false })
    const on = { type: THREE.PCFShadowMap }
    expect(sceneProbeShadows(graphics.shadows, true, true)).toEqual(on)
    expect(sceneProbeShadows(graphics.shadows, true, false)).toBe(false)
    expect(sceneProbeShadows(graphics.shadows, true, true)).toEqual(on)
    expect(sceneProbeShadows(graphics.shadows, false, true)).toBe(false)
    expect(sceneProbeShadows(graphics.shadows, false, false)).toBe(false)
  })
})

describe('opt-in landscape dressing A/B probe', () => {
  it('hides cosmetic dressing only with both exact flags in development', () => {
    expect(landscapeDressingEnabledForSearch('', true)).toBe(true)
    expect(landscapeDressingEnabledForSearch('?dev=1', true)).toBe(true)
    expect(landscapeDressingEnabledForSearch('?landscapeDressing=off', true)).toBe(true)
    expect(landscapeDressingEnabledForSearch('?dev=0&landscapeDressing=off', true)).toBe(true)
    expect(landscapeDressingEnabledForSearch('?dev=1&landscapeDressing=offish', true)).toBe(true)
    expect(landscapeDressingEnabledForSearch('?dev=1&landscapeDressing=off', false)).toBe(true)
    expect(landscapeDressingEnabledForSearch('?dev=1&landscapeDressing=off', true)).toBe(false)
  })
})

describe('camera orbit release', () => {
  it('converges a pending drag within a quarter second without a one-frame snap', () => {
    const at60Hz = cameraOrbitDamping(false, 1 / 60)
    const at120Hz = cameraOrbitDamping(false, 1 / 120)
    expect(at60Hz).toBeGreaterThan(0)
    expect(at60Hz).toBeLessThan(1)
    expect(cameraOrbitDamping(true, 1 / 60)).toBeGreaterThan(at60Hz)
    const settle = (frames: number, blend: number) => {
      let orbit = 0
      for (let frame = 0; frame < frames; frame += 1) orbit += (1 - orbit) * blend
      return orbit
    }
    expect(settle(15, at60Hz)).toBeGreaterThan(0.96)
    expect(settle(15, at60Hz)).toBeCloseTo(settle(30, at120Hz), 12)
  })
})

describe('v20 pointer aim through the live scene camera', () => {
  const bounds = { left: 100, top: 50, width: 200, height: 100 }
  const cameraAt = (x: number, targetX: number, targetZ: number) => {
    const camera = new THREE.PerspectiveCamera(68, 2, 0.08, 180)
    camera.position.set(x, 4, 16)
    camera.lookAt(targetX, 1, targetZ)
    camera.updateProjectionMatrix()
    return camera
  }

  it('aims only at the frontmost visible creek skin and follows the current camera', () => {
    const scene = new THREE.Scene()
    const water = new THREE.Mesh(new THREE.PlaneGeometry(20, 4),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    water.name = 'Greenway creek water'
    water.rotation.x = -Math.PI / 2
    water.position.set(0, 1, 8)
    scene.add(water)
    scene.fog = new THREE.Fog('#5b657c', 24, 31)
    const camera = cameraAt(0, 0, 8)
    expect(pickVisibleWorkAimX(scene, camera, bounds, 200, 100, 'bridge')).toBeCloseTo(0)
    camera.position.x = 4
    camera.lookAt(2, 1, 8)
    expect(pickVisibleWorkAimX(scene, camera, bounds, 200, 100, 'bridge')).toBeCloseTo(2)
    expect(pickVisibleWorkAimX(scene, camera, bounds, 200, 100, 'ladder')).toBeNull()
    const foreground = new THREE.Mesh(new THREE.PlaneGeometry(20, 10),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    foreground.name = 'Foreground rock'
    foreground.position.set(2, 1, 12)
    scene.add(foreground)
    expect(pickVisibleWorkAimX(scene, camera, bounds, 200, 100, 'bridge')).toBeNull()
    foreground.visible = false
    expect(pickVisibleWorkAimX(scene, camera, bounds, 200, 100, 'bridge')).toBeCloseTo(2)
    camera.position.set(4, 4, 50)
    camera.lookAt(2, 1, 8)
    expect(pickVisibleWorkAimX(scene, camera, bounds, 200, 100, 'bridge')).toBeNull()
  })

  it('only accepts a visible north-cliff fascia hit, not other fascia or invalid canvas points', () => {
    const scene = new THREE.Scene()
    const fascia = new THREE.Mesh(new THREE.PlaneGeometry(60, 3),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    fascia.name = 'Terrain perimeter and cliff fascia'
    fascia.position.set(0, 1, -6)
    scene.add(fascia)
    scene.fog = new THREE.Fog('#5b657c', 24, 31)
    const camera = cameraAt(3, 2, -6)
    expect(pickVisibleWorkAimX(scene, camera, bounds, 200, 100, 'ladder')).toBeCloseTo(2)
    camera.position.set(3, 4, 40)
    camera.lookAt(2, 1, -6)
    expect(pickVisibleWorkAimX(scene, camera, bounds, 200, 100, 'ladder')).toBeNull()
    camera.position.set(3, 4, 16)
    camera.lookAt(2, 1, -6)
    expect(pickVisibleWorkAimX(scene, camera, bounds, 200, 100, 'bridge')).toBeNull()
    fascia.position.z = -3
    expect(pickVisibleWorkAimX(scene, camera, bounds, 200, 100, 'ladder')).toBeNull()
    fascia.position.z = -6
    expect(pickVisibleWorkAimX(scene, camera, { ...bounds, width: 0 }, 200, 100, 'ladder')).toBeNull()
    expect(pickVisibleWorkAimX(scene, camera, bounds, 99, 100, 'ladder')).toBeNull()
    expect(pickVisibleWorkAimX(scene, camera, bounds, Number.NaN, 100, 'ladder')).toBeNull()
    expect(pickVisibleWorkAimX(new THREE.Scene(), camera, bounds, 200, 100, 'ladder')).toBeNull()
  })

  it('aims at a revealed V26 north rim face but not hidden, back, side, or occluded stone', () => {
    const seed = 'wizard-realms'
    const cell = (gx: number, gz: number): WizardTerrainCell => ({
      id: `tile-${gx + 3}-${gz + 3}`, position: [gx * 4, gz === -2 ? 2.4 : 1, gz * 4],
      size: [4, 4], height: 1, climate: 'loam' })
    const revealed = [cell(3, -1), cell(3, -2)]
    const geometry = buildV26ValleyRimGeometry(publicV26ValleyRimSegments(seed, []), revealed)
    const scene = new THREE.Scene()
    const rim = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    rim.name = 'V26 starter valley rock rim'
    scene.add(rim)
    scene.fog = new THREE.Fog('#5b657c', 24, 31)
    const camera = new THREE.PerspectiveCamera(68, 2, 0.08, 180)
    camera.position.set(12.3, 1.7, 0)
    camera.lookAt(12.3, 1.7, -6)
    camera.updateProjectionMatrix()
    const raycaster = new THREE.Raycaster()
    const rimHit = () => {
      scene.updateMatrixWorld(true)
      camera.updateMatrixWorld()
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)
      return raycaster.intersectObject(rim)[0]
    }
    expect(rimHit()?.face?.normal.z).toBeGreaterThan(0)
    const pick = (tiles: readonly WizardTerrainCell[] = revealed) =>
      pickVisibleWorkAimX(scene, camera, bounds, 200, 100, 'ladder', seed, tiles)
    expect(pick()).toBeCloseTo(12.3, 1)
    expect(pickVisibleWorkAimX(scene, camera, bounds, 200, 100, 'ladder', seed)).toBeNull()
    expect(pick(revealed.slice(0, 1))).toBeNull()
    expect(pick(revealed.map((tile, index) => index === 1
      ? { ...tile, id: 'unrelated-tile' } : tile))).toBeNull()
    camera.position.set(12.3, 1.7, -12)
    camera.lookAt(12.3, 1.7, -6)
    expect(rimHit()).toBeDefined()
    expect(pick()).toBeNull()
    camera.position.set(12.3, 1.7, 0)
    camera.lookAt(12.3, 1.7, -6)
    const foreground = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.2),
      new THREE.MeshBasicMaterial())
    foreground.name = 'Unrelated foreground rock'
    foreground.position.set(12.3, 1.7, -3)
    scene.add(foreground)
    expect(pick()).toBeNull()

    const sideCells = [cell(-7, 0), cell(-8, 0)]
    const sideGeometry = buildV26ValleyRimGeometry(publicV26ValleyRimSegments(seed, []), sideCells)
    const sideRim = new THREE.Mesh(sideGeometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    sideRim.name = 'V26 starter valley rock rim'
    const sideScene = new THREE.Scene()
    sideScene.add(sideRim)
    const sideCamera = new THREE.PerspectiveCamera(68, 2, 0.08, 180)
    sideCamera.position.set(-24, 1.7, 2)
    sideCamera.lookAt(-30, 1.7, 0)
    sideCamera.updateProjectionMatrix()
    sideScene.updateMatrixWorld(true)
    sideCamera.updateMatrixWorld()
    raycaster.setFromCamera(new THREE.Vector2(0, 0), sideCamera)
    expect(raycaster.intersectObject(sideRim)).not.toHaveLength(0)
    expect(pickVisibleWorkAimX(sideScene, sideCamera, bounds, 200, 100,
      'ladder', seed, sideCells)).toBeNull()
    geometry.dispose()
    sideGeometry.dispose()
  })
})

describe('new-world starter cliff scenery', () => {
  const seed = 'greenway-alpha'
  const face = starterCliffCanonicalFace(seed)
  const site = starterCliffCanonicalSite(seed)
  const route = { id: 'greenway_ladder', from: [site.from.x, site.from.y, site.from.z],
    to: [site.to.x, site.to.y, site.to.z], built: false } as const
  const ready = { id: site.id, routeId: route.id, label: 'Starter cliff ladder',
    from: route.from, to: route.to, logCost: 4, status: 'ready' as const,
    reason: 'Ready to build', discovered: true }
  const view = (ladder: 'built' | 'preview' | null, built = false) => ({ seed,
    routes: [{ ...route, built }], buildSites: [ready], selectedBuildSiteId: site.id,
    starterCliff: { face, ladder },
  }) as unknown as WizardViewProjection

  it('places the short rails and rungs on the same endpoints and width as authoritative support', () => {
    const shape = starterCliffLadderGeometry(face)
    expect(shape.run).toBeCloseTo(0.65)
    expect(shape.rise).toBeCloseTo(1.56)
    expect(shape.length).toBeCloseTo(Math.hypot(0.65, 1.56))
    expect(shape.rungCount).toBeGreaterThanOrEqual(5)
    expect(shape.railOffset + 0.055).toBeLessThan(face.width / 2)
    expect(shape.rungWidth).toBeLessThan(face.width)
    const rotation = new THREE.Euler(shape.pitch, shape.yaw, 0)
    const midpoint = new THREE.Vector3(...shape.midpoint)
    const lower = new THREE.Vector3(0, 0, shape.length / 2).applyEuler(rotation).add(midpoint)
    const upper = new THREE.Vector3(0, 0, -shape.length / 2).applyEuler(rotation).add(midpoint)
    for (const [drawn, support] of [[lower, face.from], [upper, face.to]] as const) {
      expect(drawn.x).toBeCloseTo(support.x)
      expect(drawn.y).toBeCloseTo(support.y)
      expect(drawn.z).toBeCloseTo(support.z)
    }
  })

  it('renders two long rails and open, bounded rungs on the center face', () => {
    const shape = starterCliffLadderGeometry(face)
    const markup = renderToStaticMarkup(createElement(StarterCliffLadder, { face, status: 'built' }))
    const meshes = [...markup.matchAll(/<mesh\b[^>]*>/g)].map(([tag]) => tag)
    const rails = meshes.filter((tag) => tag.includes('scale="0.13,0.14,'))
    const rungs = meshes.filter((tag) => tag.includes(`scale="${shape.rungWidth},0.13,0.08"`))
    expect(rails).toHaveLength(2)
    expect(shape.rungCount).toBeGreaterThanOrEqual(5)
    expect(shape.rungCount).toBeLessThanOrEqual(7)
    expect(rungs).toHaveLength(shape.rungCount)
    expect(meshes).toHaveLength(shape.rungCount + 4)
    const positions = rungs.map((tag) => Number(tag.match(/position="0,0.1,([^,"]+)/)?.[1]))
    expect(positions.every(Number.isFinite)).toBe(true)
    expect(positions.slice(1).every((position, index) => position - positions[index] > 0.16)).toBe(true)
    expect(shape.rise / shape.run).toBeGreaterThan(2)
  })

  it('renders the unbuilt starter cliff as a translucent guide, not a complete ladder', () => {
    const shape = starterCliffLadderGeometry(face)
    const preview = renderToStaticMarkup(createElement(StarterCliffLadder, { face, status: 'preview' }))
    const built = renderToStaticMarkup(createElement(StarterCliffLadder, { face, status: 'built' }))
    const previewMeshes = [...preview.matchAll(/<mesh\b[^>]*>/g)].map(([tag]) => tag)
    expect(preview).toContain('Greenway starter cliff ladder (preview)')
    expect(previewMeshes).toHaveLength(4)
    expect(preview).not.toContain(`scale="${shape.rungWidth},0.13,0.08"`)
    expect(built.match(new RegExp(`scale="${shape.rungWidth},0.13,0.08"`, 'g')))
      .toHaveLength(shape.rungCount)
    expectPreviewWireframe(renderedMeshes(StarterCliffLadder({ face, status: 'preview' })))
  })

  it('shows only a selected discovered ready preview or a committed ladder, never a legacy ramp', () => {
    const previewRoute = { id: site.id, from: route.from, to: route.to, built: false }
    expect(starterCliffConstructionVisuals(view('preview'), [previewRoute], [ready]))
      .toEqual({ routes: [], ladder: 'preview' })
    expect(starterCliffConstructionVisuals(view('preview'), [previewRoute],
      [{ ...ready, discovered: false }]).ladder).toBeNull()
    expect(starterCliffConstructionVisuals(view('preview'), [previewRoute],
      [{ ...ready, status: 'too_far' }]).ladder).toBeNull()
    expect(starterCliffConstructionVisuals({ ...view('preview'),
      selectedBuildSiteId: null }, [previewRoute], [ready]).ladder).toBeNull()
    expect(starterCliffConstructionVisuals({ ...view('preview'),
      controllerActionsEnabled: false }, [previewRoute], [ready]).ladder).toBeNull()
    expect(starterCliffConstructionVisuals(view('built', true), [{ ...route, built: true }], [ready]))
      .toEqual({ routes: [], ladder: 'built' })
    expect(starterCliffConstructionVisuals(view('built'), [previewRoute], [ready]).ladder).toBeNull()
  })

  it('uses the streamed visual window, not active-owner routes or hidden projection sites', () => {
    const activeOwner = { ...view('built'), routes: [], buildSites: [] }
    const built = { ...route, built: true }
    expect(starterCliffConstructionVisuals(activeOwner, [built], []))
      .toEqual({ routes: [], ladder: 'built' })
    expect(starterCliffConstructionVisuals(view('built', true), [], [ready]).ladder).toBeNull()

    const selectedButUnseen = view('preview')
    expect(starterCliffConstructionVisuals(selectedButUnseen, [], []).ladder).toBeNull()
    expect(starterCliffConstructionVisuals(selectedButUnseen, [
      { id: site.id, from: route.from, to: route.to, built: false },
    ], []).ladder).toBeNull()
  })

  it('keeps the old Greenway low-steps renderer when the v14-only field is absent', () => {
    const old = { ...route, built: true }
    const oldProjection = { ...view(null, true), starterCliff: undefined } as WizardViewProjection
    const routes = [old]
    expect(starterCliffConstructionVisuals(oldProjection, routes, []).routes).toBe(routes)
    expect(starterCliffConstructionVisuals(oldProjection, routes, []).ladder).toBeNull()
    expect(mireglassConstructionGeometry(old, true)).toMatchObject({ kind: 'ramp', run: 4 })
  })
})

describe('public scenery horizon', () => {
  it('culls only fully fogged cosmetic cells and restores the same cell after movement', () => {
    const cell = (x: number, size: readonly [number, number] = [4, 4]): WizardTerrainCell => ({
      id: `tile-${x / 4 + 3}-3`, position: [x, 0, 0], size, height: 0, climate: 'temperate_forest',
    })
    const near = cell(36)
    const fogged = cell(48)
    const wide = { ...cell(48, [20, 20]), id: 'wide-cosmetic-cell' }
    const cells = [near, fogged, wide]
    const selected = fogVisibleDressingCells(cells, [0, 0, 0], true)
    expect(selected).toEqual([near, wide])
    expect(selected[0]).toBe(near)
    expect(near.position[0] - near.size[0] / 2 - cameraFramingFor(1280, 800).distance)
      .toBeLessThan(PUBLIC_FOG_END_M) // Fog-visible dressing remains available to ground picking.
    expect(sceneTerrainFor({ seed: 'greenway-alpha', player: { position: [0, 0, 0] },
      visualWorld: { terrain: [fogged], discoveredTileIds: [fogged.id] },
    } as unknown as WizardViewProjection).revealedTerrain).toEqual([fogged])
    for (const x of [-1.99, -1, 0, 1, 1.99]) for (const z of [-1.99, -1, 0, 1, 1.99]) {
      expect(fogVisibleDressingCells(cells, [x, 0, z], true)).toEqual(selected)
    }
    for (let step = -7; step <= 7; step++) {
      expect(fogVisibleDressingCells(cells, [step / 4, 0, 0], true)).toEqual(selected)
    }
    expect(fogVisibleDressingCells(cells, [2.01, 0, 0], true)).toEqual(cells)
    expect(fogVisibleDressingCells(cells, [16, 0, 0], true)).toEqual(cells)
    expect(fogVisibleDressingCells(cells, [0, 0, 0], true)).toEqual(selected)
    expect(fogVisibleDressingCells(cells, [0, 0, 0], false)).toBe(cells)
    expect(cells).toEqual([near, fogged, wide])
  })

  it('fades uncharted terrain through the same distance fog as the scene', () => {
    expect(UNCHARTED_GROUND_MATERIAL).toBeInstanceOf(THREE.MeshBasicMaterial)
    expect(UNCHARTED_GROUND_MATERIAL.fog).toBe(true)
  })

  it('keeps legacy fog while clearing the public mid-field', () => {
    expect(PUBLIC_FOG_START_M).toBe(24)
    expect(fogEndFor(true)).toBe(PUBLIC_FOG_END_M)
    expect(fogEndFor(false)).toBe(40)
  })

  it('hides the 31 by 31 cell cutoff at wide aspect, including intermediate-angle terrain poses', () => {
    const framing = cameraFramingFor(2100, 900)
    const camera = new THREE.PerspectiveCamera(68, 21 / 9, 0.08, 180)
    const edge = (PUBLIC_VISUAL_RADIUS_CELLS + 0.5) * WORLD_CELL_METERS
    let nearestVisibleCutoff = Infinity
    for (const heading of [
      ...Array.from({ length: 8 }, (_, index) => index * Math.PI / 4),
      THREE.MathUtils.degToRad(214), THREE.MathUtils.degToRad(237),
    ]) {
      for (const pitch of [0.08, 0.4, 0.54, 0.55, 0.72]) {
        const horizontal = Math.cos(pitch * framing.pitchScale) * framing.distance
        camera.position.set(Math.sin(heading) * horizontal,
          framing.focusHeight + framing.eyeRise + Math.sin(pitch * framing.pitchScale) * framing.distance,
          Math.cos(heading) * horizontal)
        camera.lookAt(0, framing.focusHeight, 0)
        camera.updateMatrixWorld()
        for (const [playerX, playerZ] of [[0, 0], [1.99, 1.99], [-1.99, 1.99]]) {
          for (const height of [-3, 0, 2, 2.29, 13]) {
            for (let offset = -edge; offset <= edge; offset += 1) {
              for (const point of [
                new THREE.Vector3(-edge - playerX, height, offset - playerZ),
                new THREE.Vector3(edge - playerX, height, offset - playerZ),
                new THREE.Vector3(offset - playerX, height, -edge - playerZ),
                new THREE.Vector3(offset - playerX, height, edge - playerZ),
              ]) {
                const projected = point.clone().project(camera)
                if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || Math.abs(projected.z) > 1) continue
                nearestVisibleCutoff = Math.min(nearestVisibleCutoff,
                  -point.applyMatrix4(camera.matrixWorldInverse).z)
              }
            }
          }
        }
      }
    }
    expect(PUBLIC_FOG_END_M).toBe(31)
    expect(Number.isFinite(nearestVisibleCutoff)).toBe(true)
    expect(nearestVisibleCutoff).toBeLessThan(32)
    expect(nearestVisibleCutoff).toBeGreaterThan(PUBLIC_FOG_END_M + 0.5)
  })
})

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

  it('skips cloned cells only while every scene input stays equal', () => {
    const cell: WizardTerrainCell = { id: 'tile-0-0', position: [0, 2, 0], size: [4, 4],
      height: 2, climate: 'marsh', color: '#56824b', mireglassTerrain: 'wetland',
      mireglassApproach: true, mireglassTrailSegment: { from: [-2, 0], to: [2, 0] },
      highlandSurface: 'trail', highlandTrailSegment: { from: [0, -2], to: [0, 2] },
      highlandRidgeCell: 'rock' }
    expect(terrainCellVisualsEqual(cell, structuredClone(cell))).toBe(true)
    const changed: WizardTerrainCell[] = [
      { ...cell, id: 'tile-1-0' },
      { ...cell, position: [4, 2, 0] },
      { ...cell, size: [5, 4] },
      { ...cell, height: 3 },
      { ...cell, climate: 'snow' },
      { ...cell, color: '#ffffff' },
      { ...cell, mireglassTerrain: 'rocky' },
      { ...cell, mireglassApproach: false },
      { ...cell, mireglassTrailSegment: { from: [-1, 0], to: [2, 0] } },
      { ...cell, mireglassTrailSegment: { from: [-2, 0], to: [1, 0] } },
      { ...cell, mireglassTrailSegment: undefined },
      { ...cell, highlandSurface: 'quarry' },
      { ...cell, highlandTrailSegment: { from: [0, -1], to: [0, 2] } },
      { ...cell, highlandTrailSegment: { from: [0, -2], to: [0, 1] } },
      { ...cell, highlandTrailSegment: undefined },
      { ...cell, highlandRidgeCell: 'gallery' },
    ]
    for (const other of changed) expect(terrainCellVisualsEqual(cell, other)).toBe(false)
  })
})

describe('Mireglass terrain detail', () => {
  it('merges each reed cluster without changing its world shape or ray hit locations', () => {
    const unit = new THREE.BoxGeometry(1, 1, 1)
    const original = new THREE.Group()
    original.position.set(17.9, 2.3, -8.7)
    original.rotation.y = 0.43
    const reeds = [
      { position: [-0.12, 0.24, 0], rotation: -0.12, scale: [0.045, 0.48, 0.045] },
      { position: [0.09, 0.31, 0.09], rotation: 0.16, scale: [0.04, 0.62, 0.04] },
      { position: [0.02, 0.18, -0.1], rotation: 0, scale: [0.04, 0.36, 0.04] },
    ] as const
    const originalMeshes = reeds.map(({ position, rotation, scale }) => {
      const mesh = new THREE.Mesh(unit)
      mesh.position.set(position[0], position[1], position[2])
      mesh.rotation.z = rotation
      mesh.scale.set(scale[0], scale[1], scale[2])
      original.add(mesh)
      return mesh
    })
    const merged = new THREE.Mesh(MIREGLASS_REED_GEOMETRY)
    const mergedGroup = new THREE.Group()
    mergedGroup.position.copy(original.position)
    mergedGroup.rotation.copy(original.rotation)
    mergedGroup.add(merged)
    original.updateMatrixWorld(true)
    mergedGroup.updateMatrixWorld(true)

    const vertices = (meshes: THREE.Mesh[]) => meshes.flatMap((mesh) => {
      const positions = mesh.geometry.getAttribute('position')
      return Array.from({ length: positions.count }, (_, index) =>
        new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld))
    })
    const expected = vertices(originalMeshes)
    const actual = vertices([merged])
    expect(actual).toHaveLength(expected.length)
    for (let index = 0; index < actual.length; index += 1) {
      expect(actual[index].distanceTo(expected[index])).toBeLessThan(1e-6)
    }
    expect(MIREGLASS_REED_GEOMETRY.index?.count).toBe(3 * unit.index!.count)
    expect(MIREGLASS_REED_GEOMETRY.groups).toHaveLength(0)
    const originalBounds = new THREE.Box3().setFromObject(original, true)
    const mergedBounds = new THREE.Box3().setFromObject(mergedGroup, true)
    expect(mergedBounds.min.distanceTo(originalBounds.min)).toBeLessThan(1e-6)
    expect(mergedBounds.max.distanceTo(originalBounds.max)).toBeLessThan(1e-6)
    expect(merged.frustumCulled).toBe(true)
    expect(merged.castShadow).toBe(false)
    expect(merged.receiveShadow).toBe(false)

    for (const { position } of reeds) {
      const origin = original.localToWorld(new THREE.Vector3(position[0], position[1], position[2] + 1))
      const target = original.localToWorld(new THREE.Vector3(...position))
      const ray = new THREE.Raycaster(origin, target.sub(origin).normalize())
      const originalHits = ray.intersectObjects(originalMeshes)
      const mergedHits = ray.intersectObject(merged)
      expect(mergedHits).toHaveLength(originalHits.length)
      for (let index = 0; index < mergedHits.length; index += 1) {
        expect(mergedHits[index].distance).toBeCloseTo(originalHits[index].distance, 6)
        expect(mergedHits[index].point.distanceTo(originalHits[index].point)).toBeLessThan(1e-6)
      }
    }
    unit.dispose()
  })

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

describe('unsaved canonical terrain-work scenery', () => {
  const seed = 'greenway-alpha'
  const bridge = resolveTerrainWorkSite(seed, 'works1:bridge:-102:92:z')!
  const ladder = resolveTerrainWorkSite(seed, 'works1:ladder:-103:108:W')!
  const dig = resolveTerrainWorkSite(seed, 'tile--64-76')!

  it('marks revealed unbuilt banks, the true ladder foot and dig soil without changing trial data', () => {
    if (bridge.kind !== 'bridge' || ladder.kind !== 'ladder' || dig.kind !== 'dig') throw new Error('Missing work fixtures')
    const trial = { kit: { logs: 12, stone: 0, capacity: 16 as const, spadeOwned: true,
      spadeEquipped: true, xp: 0, constructionXp: 0, excavationXp: 0 }, bootsEquipped: false,
    candidates: [bridge, ladder, dig].map((site) => ({ site, rejection: null })),
    selectedId: null, selectedSite: null, selectedRejection: null, builtSites: [] }
    const terrain = [...new Set([bridge, ladder, dig].flatMap((site) => site.footprintTileIds))]
      .map((id) => ({ id } as WizardViewProjection['terrain'][number]))
    const before = structuredClone(trial)
    expect(terrainWorkCandidateMarkers(trial, terrain)).toEqual([
      { id: bridge.id, kind: 'bridge', positions: [[bridge.from.x, bridge.from.y, bridge.from.z],
        [bridge.to.x, bridge.to.y, bridge.to.z]] },
      { id: ladder.id, kind: 'ladder', positions: [[ladder.supportPath[1].x,
        ladder.supportPath[1].y, ladder.supportPath[1].z]] },
      { id: dig.id, kind: 'dig', positions: [[dig.center.x, dig.center.y, dig.center.z]] },
    ])
    expect(trial).toEqual(before)
  })

  it('fails closed on hidden footprints and excludes completed or previewed duplicates within five candidates', () => {
    if (bridge.kind !== 'bridge' || ladder.kind !== 'ladder' || dig.kind !== 'dig') throw new Error('Missing work fixtures')
    const terrain = [...new Set([bridge, ladder, dig].flatMap((site) => site.footprintTileIds))]
      .map((id) => ({ id } as WizardViewProjection['terrain'][number]))
    const trial = { kit: { logs: 12, stone: 0, capacity: 16 as const, spadeOwned: true,
      spadeEquipped: true, xp: 0, constructionXp: 0, excavationXp: 0 }, bootsEquipped: false,
    candidates: [bridge, ladder, dig].map((site) => ({ site, rejection: null })),
    selectedId: null, selectedSite: null, selectedRejection: null, builtSites: [] }
    expect(terrainWorkCandidateMarkers(trial, terrain.filter(({ id }) => id !== bridge.footprintTileIds[4]))
      .map(({ id }) => id)).toEqual([ladder.id, dig.id])
    expect(terrainWorkCandidateMarkers({ ...trial, builtSites: [bridge], selectedId: ladder.id,
      selectedSite: ladder }, terrain).map(({ id }) => id)).toEqual([dig.id])
    expect(terrainWorkCandidateMarkers({ ...trial, candidates: [
      { site: dig, rejection: 'already_done' as const }, ...trial.candidates.slice(0, 1),
    ] }, terrain).map(({ id }) => id)).toEqual([bridge.id])
    expect(terrainWorkCandidateMarkers({ ...trial, candidates: [
      { site: dig, rejection: 'undiscovered' as const }, { site: bridge, rejection: null },
    ] }, terrain).map(({ id }) => id)).toEqual([bridge.id])
    expect(terrainWorkCandidateMarkers({ ...trial, selectedId: dig.id, selectedSite: dig }, terrain)
      .some(({ id }) => id === dig.id)).toBe(true)
    expect(terrainWorkCandidateMarkers({ ...trial, candidates: [
      ...Array.from({ length: 6 }, (_, index) => ({ site: { ...dig, id: `dig-${index}` }, rejection: null })),
    ] }, terrain).map(({ id }) => id)).toEqual(['dig-0', 'dig-1', 'dig-2', 'dig-3', 'dig-4'])
  })

  it('lays bridge segments on each authoritative support edge and raises the ladder only at its face', () => {
    if (bridge.kind !== 'bridge' || ladder.kind !== 'ladder') throw new Error('Missing work fixtures')
    const deck = terrainWorkStructureGeometry(bridge)
    expect(deck).toHaveLength(2)
    expect(deck.every((segment) => segment.rotationOrder === 'XYZ')).toBe(true)
    expect(deck[0].midpoint[1]).toBeCloseTo((bridge.supportPath[0].y + bridge.supportPath[1].y) / 2)
    expect(deck[1].midpoint[1]).toBeCloseTo((bridge.supportPath[1].y + bridge.supportPath[2].y) / 2)
    expect(deck[0].run).toBeCloseTo(4)
    const face = terrainWorkStructureGeometry(ladder)
    expect(face).toHaveLength(1)
    expect(face[0].run).toBeCloseTo(0.65)
    expect(face[0].rise).toBeCloseTo(1.56)
    expect(face[0].midpoint[1]).toBeCloseTo((ladder.supportPath[1].y + ladder.supportPath[2].y) / 2)
  })

  it('shows only visible built works and a ready selected ghost, never a blocked or dug structure', () => {
    if (bridge.kind !== 'bridge' || ladder.kind !== 'ladder') throw new Error('Missing work fixtures')
    const cells = bridge.footprintTileIds.map((id) => ({ id, position: [0, 0, 0] as const,
      size: [4, 4] as const, height: 2, climate: 'marsh' }))
    const trial = { kit: { logs: 12, stone: 0, capacity: 16 as const, spadeOwned: true,
      spadeEquipped: true, xp: 0, constructionXp: 0, excavationXp: 0 },
    bootsEquipped: false, candidates: [], selectedId: ladder.id, selectedSite: ladder,
    selectedRejection: null, builtSites: [bridge] }
    expect(terrainWorkConstructionVisuals(trial, cells).map(({ site }) => site.id)).toEqual([bridge.id])
    const ladderCells = [...cells, { ...cells[0], id: ladder.footprintTileIds[0] }]
    expect(terrainWorkConstructionVisuals(trial, ladderCells).map(({ site, built }) => [site.id, built]))
      .toEqual([[bridge.id, true], [ladder.id, false]])
    expect(terrainWorkConstructionVisuals({ ...trial, selectedRejection: 'too_far' }, ladderCells))
      .toHaveLength(1)
    expect(mireglassConstructionGeometry({ id: 'greenway_ladder', from: [0, 0, 0], to: [0, 1.56, 4] }))
      .toBeNull()
  })
})

describe('saved canonical terrain-work scenery', () => {
  it('renders selected bridge and ladder ghosts as wire guides while built works stay physical', () => {
    const bridge = resolvePublicV17GreenwaySite('wizard-realms', 'works4:bridge:greenway-creek:0')
    const ladder = resolvePublicV17GreenwaySite('wizard-realms', 'works4:ladder:greenway-north-cliff:11')
    const river = resolvePublicV28RiverBridge('wizard-realms', 'works6:river-bridge:-14')
    if (bridge?.kind !== 'bridge' || ladder?.kind !== 'ladder' || !river) {
      throw new Error('Missing canonical route fixtures')
    }
    for (const site of [{ ...bridge, obstacle: 'fen_channel' as const },
      displayPublicV28RiverBridge(river)]) {
      const guide = renderToStaticMarkup(createElement(TerrainWorkStructure,
        { site, built: false, source: 'Saved' }))
      const physical = renderToStaticMarkup(createElement(TerrainWorkStructure,
        { site, built: true, source: 'Saved' }))
      expect(guide).toContain(`Saved bridge ${site.id} (preview)`)
      expect([...guide.matchAll(/<mesh\b/g)]).toHaveLength(terrainWorkStructureGeometry(site).length * 4)
      expect(guide).not.toContain(`scale="${site.widthMeters},0.14,`)
      expect(guide).not.toContain(`scale="${site.widthMeters + 0.08},0.05,`)
      expect(physical).toContain(`scale="${site.widthMeters},0.14,`)
      expectPreviewWireframe(renderedMeshes(TerrainWorkStructure(
        { site, built: false, source: 'Saved' })))
    }
    const ladderDisplay = { ...ladder, obstacle: 'slate_cliff' as const }
    const ready = renderToStaticMarkup(createElement(TerrainWorkStructure,
      { site: ladderDisplay, built: false, source: 'Saved' }))
    const blocked = renderToStaticMarkup(createElement(TerrainWorkStructure,
      { site: ladderDisplay, built: false, blocked: true, source: 'Saved' }))
    const built = renderToStaticMarkup(createElement(TerrainWorkStructure,
      { site: ladderDisplay, built: true, source: 'Saved' }))
    expect(ready).toContain(`Saved ladder ${ladder.id} (preview)`)
    expect(blocked).toContain(`Saved ladder ${ladder.id} (blocked preview)`)
    expect([...ready.matchAll(/<mesh\b/g)]).toHaveLength(4)
    expect(ready).not.toContain(`scale="${ladder.widthMeters - 0.26},0.1,0.08"`)
    expect(built.match(new RegExp(`scale="${ladder.widthMeters - 0.26},0.1,0.08"`, 'g'))?.length)
      .toBeGreaterThanOrEqual(5)
    const readyMeshes = renderedMeshes(TerrainWorkStructure({ site: ladderDisplay, built: false,
      source: 'Saved' }))
    const blockedMeshes = renderedMeshes(TerrainWorkStructure({ site: ladderDisplay, built: false,
      blocked: true, source: 'Saved' }))
    expectPreviewWireframe(readyMeshes)
    expectPreviewWireframe(blockedMeshes)
    expect((readyMeshes[0].material as THREE.MeshBasicMaterial).color.getHex())
      .not.toBe((blockedMeshes[0].material as THREE.MeshBasicMaterial).color.getHex())
  })

  it('renders saved off-center ladders as spaced rungs and keeps bridge decks distinct', () => {
    const ladder = resolvePublicV16GreenwaySite('wizard-realms', 'works3:ladder:-3')
    const bridge = resolvePublicV16GreenwaySite('wizard-realms', 'works3:bridge:1')
    if (ladder?.kind !== 'ladder' || bridge?.kind !== 'bridge') throw new Error('Missing work fixtures')
    const ladderMarkup = renderToStaticMarkup(createElement(TerrainWorkStructure,
      { site: { ...ladder, obstacle: 'slate_cliff' }, built: true, source: 'Saved' }))
    const bridgeMarkup = renderToStaticMarkup(createElement(TerrainWorkStructure,
      { site: { ...bridge, obstacle: 'fen_channel' }, built: true, source: 'Saved' }))
    const ladderMeshes = [...ladderMarkup.matchAll(/<mesh\b[^>]*>/g)].map(([tag]) => tag)
    const rungMeshes = ladderMeshes.filter((tag) => tag.includes(`scale="${ladder.widthMeters - 0.26},0.1,0.08"`))
    expect(ladderMeshes.filter((tag) => tag.includes('scale="0.12,0.13,'))).toHaveLength(2)
    expect(rungMeshes.length).toBeGreaterThanOrEqual(5)
    expect(rungMeshes.length).toBeLessThanOrEqual(7)
    expect(ladderMeshes).toHaveLength(rungMeshes.length + 6)
    const positions = rungMeshes.map((tag) => Number(tag.match(/position="0,0.16,([^,"]+)/)?.[1]))
    expect(positions.every(Number.isFinite)).toBe(true)
    expect(positions.slice(1).every((position, index) => position - positions[index] > 0.16)).toBe(true)
    expect(bridgeMarkup).toContain(`scale="${bridge.widthMeters},0.14,`)
    expect(bridgeMarkup).not.toContain(`scale="${ladder.widthMeters - 0.26},0.1,0.08"`)
    expect(ladderMarkup).not.toContain(`scale="${bridge.widthMeters},0.14,`)
  })

  it('shows a steep open-rung Works4 cliff ladder beside an unchanged full-width bridge deck', () => {
    const ladder = resolvePublicV17GreenwaySite('wizard-realms', 'works4:ladder:greenway-north-cliff:11')
    const bridge = resolvePublicV17GreenwaySite('wizard-realms', 'works4:bridge:greenway-creek:0')
    if (ladder?.kind !== 'ladder' || bridge?.kind !== 'bridge') throw new Error('Missing Works4 fixture')
    const ladderVisual = { ...ladder, obstacle: 'slate_cliff' as const }
    const bridgeVisual = { ...bridge, obstacle: 'fen_channel' as const }
    const face = terrainWorkStructureGeometry(ladderVisual)[0]
    expect(face.rise / face.run).toBeGreaterThan(2)
    const ladderMarkup = renderToStaticMarkup(createElement(TerrainWorkStructure,
      { site: ladderVisual, built: true, source: 'Saved' }))
    const bridgeMarkup = renderToStaticMarkup(createElement(TerrainWorkStructure,
      { site: bridgeVisual, built: true, source: 'Saved' }))
    const meshes = [...ladderMarkup.matchAll(/<mesh\b[^>]*>/g)].map(([tag]) => tag)
    const rungs = meshes.filter((tag) => tag.includes(`scale="${ladder.widthMeters - 0.26},0.1,0.08"`))
    expect(rungs.length).toBeGreaterThanOrEqual(5)
    expect(meshes).toHaveLength(rungs.length + 6)
    expect(ladderMarkup).toContain(`position="${ladder.widthMeters / 2 - 0.1},0.08,0"`)
    expect(ladderMarkup).not.toContain(`scale="${bridge.widthMeters},0.14,`)
    expect(bridgeMarkup).toContain(`scale="${bridge.widthMeters},0.14,`)
  })

  it('places built dry-foot marks outside both creek deck ends and below the cliff ladder', () => {
    const bridge = resolvePublicV17GreenwaySite('wizard-realms', 'works4:bridge:greenway-creek:0')
    const ladder = resolvePublicV17GreenwaySite('wizard-realms', 'works4:ladder:greenway-north-cliff:11')
    if (bridge?.kind !== 'bridge' || ladder?.kind !== 'ladder') throw new Error('Missing Works4 fixture')
    const works = [
      { site: { ...bridge, obstacle: 'fen_channel' as const }, built: true },
      { site: { ...ladder, obstacle: 'slate_cliff' as const }, built: true },
    ]
    const terrain = [...new Set([...bridge.footprintTileIds, ...ladder.footprintTileIds])]
      .map((id) => ({ id } as WizardViewProjection['terrain'][number]))
    const bridgeOnly = bridge.footprintTileIds.find((id) => !ladder.footprintTileIds.includes(id))
    const ladderOnly = ladder.footprintTileIds.find((id) => !bridge.footprintTileIds.includes(id))
    if (!bridgeOnly || !ladderOnly) throw new Error('Expected distinct dry approach tiles')
    const markers = terrainWorkApproachMarkers(works, terrain)
    expect(markers.map(({ kind }) => kind)).toEqual(['bridge', 'bridge', 'ladder'])
    expect(markers[0].position[0]).toBe(bridge.from.x)
    expect(markers[0].position[2]).toBeLessThan(bridge.from.z)
    expect(markers[1].position[2]).toBeGreaterThan(bridge.to.z)
    const rung = ladder.supportPath[1]
    expect(Math.abs(ladder.from.z + 0.4 - rung.z)).toBeGreaterThan(1.5)
    expect(markers[2].position[0]).toBe(rung.x)
    expect(markers[2].position[1]).toBeCloseTo(ladder.from.y + 0.055)
    expect(ladder.from.z - markers[2].position[2]).toBeGreaterThan(0.15)
    expect(ladder.from.z - markers[2].position[2]).toBeLessThan(0.3)
    expect(markers[2].position[2]).toBeGreaterThan(rung.z)
    const rungDistance = Math.hypot(markers[2].position[0] - rung.x,
      markers[2].position[2] - rung.z)
    expect(rungDistance).toBeCloseTo(1.08, 1)
    expect(rungDistance).toBeLessThan(1.5)
    expect(terrainWorkApproachMarkers(works, terrain.filter(({ id }) =>
      id !== bridgeOnly)).map(({ kind }) => kind)).toEqual(['ladder'])
    expect(terrainWorkApproachMarkers(works, terrain.filter(({ id }) =>
      id !== ladderOnly)).map(({ kind }) => kind)).toEqual(['bridge', 'bridge'])
    expect(terrainWorkApproachMarkers(works.map((work) => ({ ...work, built: false })), terrain))
      .toEqual([])
  })

  it('aligns a second built Greenway ladder without moving historical or regional marks', () => {
    const greenway = resolvePublicV17GreenwaySite('wizard-realms', 'works4:ladder:greenway-north-cliff:27')
    const historical = resolvePublicV16GreenwaySite('wizard-realms', 'works3:ladder:-3')
    const regional = resolvePublicV23Site('greenway-alpha', 'works5:ladder:mireglass-slate:W:-103:4306')
    if (greenway?.kind !== 'ladder' || historical?.kind !== 'ladder' || !regional) {
      throw new Error('Missing distinct ladder fixtures')
    }
    const terrain = [...new Set([greenway, historical, regional]
      .flatMap((site) => site.footprintTileIds))]
      .map((id) => ({ id } as WizardTerrainCell))
    const [newFoot, oldFoot, previewFoot] = terrainWorkApproachMarkers([
      { site: { ...greenway, obstacle: 'slate_cliff' as const }, built: true },
      { site: { ...historical, obstacle: 'slate_cliff' as const }, built: true },
      { site: regional, built: false },
    ], terrain)
    expect(newFoot.position[0]).toBe(greenway.supportPath[1].x)
    expect(newFoot.position[1]).toBeCloseTo(greenway.from.y + 0.055)
    expect(greenway.from.z - newFoot.position[2]).toBeGreaterThan(0.15)
    expect(greenway.from.z - newFoot.position[2]).toBeLessThan(0.3)
    expect(oldFoot.position).toEqual([historical.from.x,
      historical.from.y + 0.055, historical.from.z + 0.4])
    expect(previewFoot).toMatchObject({ regional: true, built: false,
      position: [regional.from.x + 0.4, regional.from.y + 0.055, regional.from.z] })
  })

  it('places saved ladder rail endpoints on the support face for v16 and earlier works', () => {
    const v16 = resolvePublicV16GreenwaySite('wizard-realms', 'works3:ladder:-3')
    const works1 = resolveTerrainWorkSite('greenway-alpha', 'works1:ladder:-103:108:W')
    if (v16?.kind !== 'ladder' || works1?.kind !== 'ladder') throw new Error('Missing ladder fixture')
    const ladders = [{ ...v16, obstacle: 'slate_cliff' as const }, works1]
    for (const site of ladders) {
      const segment = terrainWorkStructureGeometry(site)[0]
      expect(segment.rotationOrder).toBe('YXZ')
      const rotation = new THREE.Euler(segment.pitch, segment.yaw, 0, segment.rotationOrder)
      const midpoint = new THREE.Vector3(...segment.midpoint)
      const lower = new THREE.Vector3(0, 0, -segment.length / 2).applyEuler(rotation).add(midpoint)
      const upper = new THREE.Vector3(0, 0, segment.length / 2).applyEuler(rotation).add(midpoint)
      for (const [drawn, support] of [[lower, site.supportPath[1]],
        [upper, site.supportPath[2]]] as const) {
        expect(drawn.x).toBeCloseTo(support.x)
        expect(drawn.y).toBeCloseTo(support.y)
        expect(drawn.z).toBeCloseTo(support.z)
      }
    }
  })

  it('reveals only complete footprints, shows a ready ladder ghost and a dig marker, never a blocked structure', () => {
    const seed = 'greenway-alpha'
    const bridge = resolveTerrainWorkSite(seed, 'works1:bridge:-102:92:z')
    const ladder = resolveTerrainWorkSite(seed, 'works1:ladder:-103:108:W')
    const dig = resolveTerrainWorkSite(seed, 'tile--64-76')
    if (!bridge || bridge.kind !== 'bridge' || !ladder || ladder.kind !== 'ladder'
      || !dig || dig.kind !== 'dig') throw new Error('Missing work fixtures')
    const ready = { site: ladder, angleRadians: 0, distanceMeters: 2, rejection: null,
      reason: 'Ready to build here.', benefit: 'Climb a Slate cliff.' }
    const blocked = { site: dig, angleRadians: 1, distanceMeters: 3,
      rejection: 'requires_spade' as const, reason: 'Own and equip a field spade to dig.', benefit: 'Gain stone.' }
    const saved: NonNullable<WizardViewProjection['savedTerrainWorks']> = {
      builtSites: [bridge], dugTileIds: [], preview: { selected: ready, nearby: [ready, blocked], guidance: null },
    }
    const terrain = [...new Set([bridge, ladder, dig].flatMap((site) => site.footprintTileIds))]
      .map((id) => ({ id } as WizardViewProjection['terrain'][number]))
    expect(savedTerrainWorkVisuals(saved, terrain).map(({ site, built }) => [site.id, built]))
      .toEqual([[bridge.id, true], [ladder.id, false]])
    expect(savedTerrainWorkMarkers(saved, terrain).map(({ id }) => id)).toEqual([dig.id])
    const hidden = terrain.filter(({ id }) => id !== ladder.footprintTileIds[0])
    expect(savedTerrainWorkVisuals(saved, hidden).map(({ site }) => site.id)).toEqual([bridge.id])
    expect(savedTerrainWorkMarkers(saved, hidden).map(({ id }) => id)).toEqual([dig.id])
    expect(savedTerrainWorkVisuals({ ...saved, preview: { selected: { ...ready, rejection: 'not_owned' },
      nearby: [], guidance: null } }, terrain).map(({ site }) => site.id)).toEqual([bridge.id])
    const blockedSaved = { ...saved, context: 'works4-greenway' as const,
      preview: { selected: { ...ready, rejection: 'too_far' as const }, nearby: [], guidance: null } }
    expect(savedTerrainWorkVisuals(blockedSaved, terrain).at(-1))
      .toMatchObject({ site: ladder, built: false, blocked: true })
    expect(savedTerrainWorkVisuals(blockedSaved, hidden).map(({ site }) => site.id))
      .toEqual([bridge.id])
  })

  it('uses v16 shifted deck geometry and an open-rung ladder face from saved works', () => {
    const seed = 'wizard-realms'
    const bridge = resolvePublicV16GreenwaySite(seed, 'works3:bridge:1')
    const ladder = resolvePublicV16GreenwaySite(seed, 'works3:ladder:-3')
    const dig = resolvePublicV16GreenwaySite(seed, 'works3:dig:-2:4')
    if (bridge?.kind !== 'bridge' || ladder?.kind !== 'ladder' || dig?.kind !== 'dig') {
      throw new Error('Missing v16 scene sites')
    }
    expect(bridge.from.x).not.toBe(4)
    const { head } = createFreshPublicV16Head(seed)
    const discoveryMask = encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(head.state.discoveryMask),
      ...bridge.footprintTileIds, ...ladder.footprintTileIds, ...dig.footprintTileIds,
    ])].sort())
    const progress = { state: { ...head.state, discoveryMask,
      player: { ...head.state.player, xp: 170, level: 2,
        skillXp: { ...head.state.player.skillXp, construction: 140, excavation: 30 } } },
      greenwayWorks: { builtBridgeIds: [bridge.id], builtLadderIds: [ladder.id],
        dugTileIds: [dig.id] } }
    const active = { movementOwner: progress.state.movementOwner,
      tick: progress.state.tick, player: structuredClone(progress.state.player),
      pendingBoundary: false,
      activeKnownTileIds: discoveredTileIdsInActiveWindow(discoveryMask,
        progress.state.player.position),
      activeTiles: progress.state.greenway.tiles.map((tile) => publicWorldV16TileAtGrid(
        seed, tile.gridX - 3, tile.gridZ - 3)) }
    const view = publicWorldV16ViewProjection(progress, active, [], null)
    const visuals = savedTerrainWorkVisuals(view.savedTerrainWorks, view.terrain)
    expect(visuals.map(({ site }) => [site.id, site.kind])).toEqual([
      [bridge.id, 'bridge'], [ladder.id, 'ladder']])
    const deck = terrainWorkStructureGeometry(visuals[0].site)
    expect(deck).toHaveLength(2)
    expect(deck.every((segment) => segment.rotationOrder === 'XYZ')).toBe(true)
    expect(deck.every((edge) => edge.midpoint[0] === bridge.from.x)).toBe(true)
    expect(deck[0].midpoint[1]).toBeCloseTo((bridge.supportPath[0].y
      + bridge.supportPath[1].y) / 2)
    const face = terrainWorkStructureGeometry(visuals[1].site)
    expect(face).toHaveLength(1)
    expect(face[0].rise).toBeGreaterThan(0.55)
    expect(face[0].run).toBeLessThan(1)
    expect(face[0].midpoint[0]).toBe(ladder.supportPath[1].x)
    const hidden = view.terrain.filter((cell) => cell.id !== ladder.footprintTileIds[0])
    expect(savedTerrainWorkVisuals(view.savedTerrainWorks, hidden).map(({ site }) => site.id))
      .toEqual([bridge.id])
    expect(view.savedTerrainWorks?.dugTileIds).toContain(dig.footprintTileIds[0])
    expect(view.terrain.find((cell) => cell.id === dig.footprintTileIds[0])?.position[1])
      .toBe(dig.loweredCenter.y)
    expect(savedTerrainWorkMarkers(view.savedTerrainWorks, view.terrain)).toEqual([])
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
  it('faces the axe edge and both pick heads forward in idle and walking arm poses', () => {
    for (const tool of [Axe(), MiningPick({ tier: 'basic' }), MiningPick({ tier: 'enchanted' })]) {
      const [x, y, z] = (tool as React.ReactElement<{ rotation: [number, number, number] }>).props.rotation
      const headDirection = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(x, y, z))
      for (const armSwing of [-0.3, 0, 0.3]) {
        const posedDirection = headDirection.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), armSwing)
        expect(posedDirection.z).toBeLessThan(-0.85)
      }
    }
  })
  it('shows only the V29 active pick as held gear, with distinct basic and enchanted heads', () => {
    expect(avatarGearFor(equipment(), 'basic').mainHand).toBe('basic-pick')
    expect(avatarGearFor(equipment(), 'enchanted').mainHand).toBe('enchanted-pick')
    expect(avatarGearFor(equipment()).mainHand).toBeNull()
    const basic = renderToStaticMarkup(createElement(MiningPick, { tier: 'basic' }))
    const enchanted = renderToStaticMarkup(createElement(MiningPick, { tier: 'enchanted' }))
    expect(basic).toContain('basic mining pick')
    expect(enchanted).toContain('enchanted mining pick')
    expect(basic).not.toContain('#7135bb')
    expect(enchanted).toContain('#7135bb')
  })
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

  it('passes only a selected discovered Mireglass bridge or ladder to the legacy preview renderer', () => {
    const choices = mireglassRouteSites('greenway-alpha')
    for (const kind of ['bridge', 'ladder'] as const) {
      const site = choices.find((choice) => choice.kind === kind)
      if (!site) throw new Error(`Missing Mireglass ${kind} fixture`)
      const from = [site.from.x, site.from.y, site.from.z] as const
      const to = [site.to.x, site.to.y, site.to.z] as const
      const candidate = { id: site.id, routeId: site.routeId, label: kind,
        from, to, logCost: site.logCost, status: 'ready' as const,
        reason: 'Ready', discovered: true }
      const preview = constructionVisuals([], [candidate], candidate.id)
      expect(preview).toEqual([{ id: candidate.id, from, to, built: false }])
      expect(mireglassConstructionGeometry(preview[0])?.kind).toBe(kind)
      expect(constructionVisuals([], [{ ...candidate, discovered: false }], candidate.id)).toEqual([])
      expect(constructionVisuals([], [candidate], null)).toEqual([])
      const builtRoute = { id: site.routeId, label: kind, from, to,
        built: true, unlocked: true, logCost: site.logCost }
      expect(constructionVisuals([builtRoute], [candidate], candidate.id))
        .toEqual([builtRoute])
    }
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

  it('keeps shadows and depth writes off through fade-out and fade-in until the tree is nearly opaque', () => {
    const fade = [
      treeOcclusionAppearance(true, 1, 1),
      treeOcclusionAppearance(true, 0.4, 1),
      treeOcclusionAppearance(false, 0, 1),
      treeOcclusionAppearance(false, 0.5, 1),
      treeOcclusionAppearance(false, 0.89, 1),
      treeOcclusionAppearance(false, 0.9, 1),
      treeOcclusionAppearance(false, 1, 1),
    ]
    expect(fade.map(({ castShadow, depthWrite }) => [castShadow, depthWrite])).toEqual([
      [false, false], [false, false], [false, false], [false, false], [false, false], [true, true], [true, true],
    ])
    expect(fade.map(({ targetOpacity }) => targetOpacity)).toEqual([0, 0, 1, 1, 1, 1, 1])
    expect(treeOcclusionAppearance(false, 0.44, 0.5).castShadow).toBe(false)
    expect(treeOcclusionAppearance(false, 0.45, 0.5).castShadow).toBe(true)
  })

  it('lets ground clicks pass through every faint live-tree part but not a stump', () => {
    const tree = new THREE.Group()
    tree.name = 'Live tree'
    const faint = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.03 })
    const trunk = new THREE.Mesh(undefined, faint)
    const crown = new THREE.Mesh(undefined, faint)
    crown.name = 'Tree crown'
    tree.add(trunk, crown)
    expect(treeMeshBlocksGroundPick(trunk)).toBe(false)
    expect(treeMeshBlocksGroundPick(crown)).toBe(false)
    faint.opacity = 0.05
    expect(treeMeshBlocksGroundPick(trunk)).toBe(true)
    const timber = new THREE.Group()
    timber.name = 'Harvestable Mireglass timber'
    timber.add(crown)
    faint.opacity = 0.03
    expect(treeMeshBlocksGroundPick(crown)).toBe(false)
    const stump = new THREE.Group()
    stump.name = 'Depleted tree stump'
    stump.add(trunk)
    faint.opacity = 0.03
    expect(treeMeshBlocksGroundPick(trunk)).toBe(true)
    faint.dispose()
  })
})

describe('tree harvest visual state', () => {
  it('keeps a live canopy and branches, then leaves only a grounded, shadowless stump', () => {
    const barkMaterial = new THREE.MeshStandardMaterial()
    const crownMaterial = new THREE.MeshStandardMaterial()
    const liveNode: WizardResourceNode = { id: 'oak-1', kind: 'tree', label: 'Oak',
      position: [0, 0, 0], available: true }
    const depletedNode: WizardResourceNode = { ...liveNode, available: false }
    const meshes = (node: WizardResourceNode, timber = false) => renderedMeshes(TreeMeshes({
      available: node.available, timber, barkMaterial, crownMaterial,
    }))
    const live = meshes(liveNode)
    expect(live).toHaveLength(2)
    expect(live.map(({ name }) => name)).toContain('Tree crown')
    expect(live.every(({ castShadow }) => castShadow === true)).toBe(true)
    const occluded = renderedMeshes(TreeMeshes({ available: true, timber: false, barkMaterial, crownMaterial,
      castShadow: treeOcclusionAppearance(true, 1, 1).castShadow }))
    expect(occluded).toHaveLength(6)
    expect(occluded.every(({ castShadow }) => castShadow === false)).toBe(true)
    const restored = renderedMeshes(TreeMeshes({ available: true, timber: false, barkMaterial, crownMaterial,
      castShadow: treeOcclusionAppearance(false, 1, 1).castShadow }))
    expect(restored).toHaveLength(2)
    expect(restored.every(({ castShadow }) => castShadow === true)).toBe(true)
    const nearlyRestored = renderedMeshes(TreeMeshes({ available: true, timber: false,
      barkMaterial, crownMaterial, castShadow: true, mergeBark: false }))
    expect(nearlyRestored).toHaveLength(6)
    expect(nearlyRestored.every(({ castShadow }) => castShadow === true)).toBe(true)
    expect(restored[0].geometry).toBe(live[0].geometry)
    expect(restored[0].material).toBe(barkMaterial)
    expect(restored[1].geometry).toBe(live[1].geometry)
    expect(restored[1].material).toBe(crownMaterial)
    expect(meshes(liveNode, true)).toHaveLength(2)
    expect(renderedMeshes(TreeMeshes({ available: true, timber: true, barkMaterial, crownMaterial,
      castShadow: false }))).toHaveLength(3)
    const depleted = meshes(depletedNode)
    expect(depleted.map(({ name }) => name)).toEqual(['Tree stump', 'Tree stump cut'])
    expect(depleted.every(({ castShadow }) => castShadow === false)).toBe(true)
    barkMaterial.dispose()
    crownMaterial.dispose()
  })

  it.each([false, true])('bakes %s timber bark with the same triangles, bounds and first-hit rays', (timber) => {
    const barkMaterial = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.45, depthWrite: false })
    const crownMaterial = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.45, depthWrite: false })
    const clear = renderedMeshes(TreeMeshes({ available: true, timber, barkMaterial, crownMaterial }))
    const fading = renderedMeshes(TreeMeshes({ available: true, timber, barkMaterial, crownMaterial,
      castShadow: false }))
    const bark = clear[0].geometry!
    const original = new THREE.Group()
    for (const part of fading.slice(0, -1)) {
      const mesh = new THREE.Mesh(part.geometry!, barkMaterial)
      if (part.position) mesh.position.set(...part.position)
      if (part.rotation) mesh.rotation.set(...part.rotation)
      if (typeof part.scale === 'number') mesh.scale.setScalar(part.scale)
      else if (part.scale) mesh.scale.set(...part.scale)
      original.add(mesh)
    }
    const baked = new THREE.Mesh(bark, barkMaterial)
    const triangles = (geometry: THREE.BufferGeometry) =>
      (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
    expect(triangles(bark)).toBe(fading.slice(0, -1).reduce((count, part) => count + triangles(part.geometry!), 0))
    const oldBounds = new THREE.Box3().setFromObject(original, true)
    const newBounds = new THREE.Box3().setFromObject(baked, true)
    expect(newBounds.min.distanceTo(oldBounds.min)).toBeLessThan(1e-6)
    expect(newBounds.max.distanceTo(oldBounds.max)).toBeLessThan(1e-6)
    for (const [x, y, z] of [[0, 2, 7], [-0.46, 2.75, 7], [0.46, 2.9, -7]] as const) {
      const origin = new THREE.Vector3(x, y, z)
      const direction = new THREE.Vector3(0, y, 0).sub(origin).normalize()
      const ray = new THREE.Raycaster(origin, direction)
      const oldHit = ray.intersectObjects(original.children)[0]
      const newHit = ray.intersectObject(baked)[0]
      expect(Boolean(newHit)).toBe(Boolean(oldHit))
      if (oldHit && newHit) expect(newHit.distance).toBeCloseTo(oldHit.distance, 6)
    }
    expect(clear[1].geometry).toBe(fading.at(-1)?.geometry)
    expect(clear[1].material).toBe(crownMaterial)
    barkMaterial.dispose()
    crownMaterial.dispose()
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
