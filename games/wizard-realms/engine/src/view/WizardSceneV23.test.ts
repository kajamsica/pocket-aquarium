import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { resolvePublicV23Site } from '../domain/publicWorldV23Sites'
import { resolveTerrainWorkSite } from '../domain/terrainWorks'
import type { WizardSavedTerrainWorksView, WizardTerrainCell } from './contracts'
import { pickV26TerrainColumn } from './V26TerrainPicker'
import { GreenwayWorksSurvey, greenwayWorksSurveySegments, pickVisibleRegionalLadderAimZ,
  pickVisibleWorkAimX, pickVisibleGroundPoint, regionalLadderVisuals, savedTerrainWorkVisuals,
  terrainWorkApproachMarkers, terrainWorkStructureGeometry, TerrainWorkStructure } from './WizardScene'

const seed = 'greenway-alpha'
const first = resolvePublicV23Site(seed, 'works5:ladder:mireglass-slate:W:-103:4306')!
const second = resolvePublicV23Site(seed, 'works5:ladder:mireglass-slate:W:-103:4334')!
const terrain = [...new Set([...first.footprintTileIds, ...second.footprintTileIds])]
  .map((id): WizardTerrainCell => ({ id, position: [0, 0, 0], size: [4, 4],
    height: 0, climate: 'loam' }))
const surveyColumn = (gx: number, rows: readonly number[], y: number): WizardTerrainCell[] =>
  rows.map((gz) => ({ id: `tile-${gx + 3}-${gz + 3}`,
    position: [gx * 4, y, gz * 4], size: [4, 4], height: y, climate: 'loam' }))
const surveyWorks = (selectedKind: 'ladder' | 'bridge'): WizardSavedTerrainWorksView => ({
  builtSites: [], dugTileIds: [], preview: null, context: 'works4-greenway',
  modeActive: true, actionsEnabled: true, selectedKind,
})

describe('dev ground destination picking', () => {
  it('returns the exact frontmost revealed top-surface point, not its cell center', () => {
    const scene = new THREE.Scene()
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial())
    ground.name = 'Continuous terrain surface'
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)
    const camera = new THREE.PerspectiveCamera(68, 1, 0.08, 180)
    camera.position.set(1, 6, 8)
    camera.lookAt(1, 0, 0)
    camera.updateProjectionMatrix()
    const bounds = { left: 0, top: 0, width: 200, height: 200 }
    const revealed: WizardTerrainCell[] = [{ id: 'tile-3-3', position: [0, 0, 0],
      size: [4, 4], height: 0, climate: 'loam' }]
    const point = pickVisibleGroundPoint(scene, camera, bounds, 100, 100, revealed)
    expect(point?.x).toBeCloseTo(1)
    expect(point?.y).toBeCloseTo(0)
    expect(point?.z).toBeCloseTo(0)
    expect(pickVisibleGroundPoint(scene, camera, bounds, 100, 100, [])).toBeNull()
    const dressing = new THREE.Group()
    dressing.name = 'Terrain cell dressing'
    const trail = new THREE.Mesh(new THREE.BoxGeometry(1, 0.025, 1), new THREE.MeshBasicMaterial())
    trail.position.set(1, 0.023, 0)
    dressing.add(trail)
    scene.add(dressing)
    expect(pickV26TerrainColumn(scene, camera, bounds, 100, 100, revealed)).toBeNull()
    expect(pickVisibleGroundPoint(scene, camera, bounds, 100, 100, revealed)?.x).toBeCloseTo(1)
    const water = new THREE.Mesh(new THREE.BoxGeometry(1, 0.025, 1), new THREE.MeshBasicMaterial())
    water.name = 'Greenway creek water'
    water.position.set(1, 0.07, 0)
    scene.add(water)
    expect(pickVisibleGroundPoint(scene, camera, bounds, 100, 100, revealed)).toBeNull()
    scene.remove(water)
    const stake = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1, 0.6), new THREE.MeshBasicMaterial())
    stake.position.set(1, 0.5, 0)
    dressing.add(stake)
    expect(pickVisibleGroundPoint(scene, camera, bounds, 100, 100, revealed)).toBeNull()
    dressing.remove(stake)
    const crownMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.12 })
    const crown = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), crownMaterial)
    crown.name = 'Tree crown'
    crown.position.set(1, 3, 4)
    scene.add(crown)
    expect(pickVisibleGroundPoint(scene, camera, bounds, 100, 100, revealed)?.x).toBeCloseTo(1)
    crownMaterial.opacity = 1
    expect(pickVisibleGroundPoint(scene, camera, bounds, 100, 100, revealed)).toBeNull()
    crownMaterial.opacity = 0.12
    crown.name = 'Tree trunk'
    expect(pickVisibleGroundPoint(scene, camera, bounds, 100, 100, revealed)).toBeNull()
    scene.remove(crown)
    const rock = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    rock.name = 'Foreground rock'
    rock.position.set(1, 3, 4)
    scene.add(rock)
    expect(pickVisibleGroundPoint(scene, camera, bounds, 100, 100, revealed)).toBeNull()
  })
})

describe('V49 Greenway Works survey', () => {
  const ladder = surveyColumn(-7, [0, -1, -2, -3], 1)
  const bridge = surveyColumn(-2, [0, 1, 2, 3, 4], 2)

  it('shows only the selected obstacle with stable, sub-cell line geometry', () => {
    const revealed = [...ladder, ...bridge]
    expect(greenwayWorksSurveySegments(surveyWorks('ladder'), revealed)).toEqual([
      { id: 'ladder:-28', from: [-29.38, 1.92, -5.48], to: [-26.62, 1.92, -5.48] },
    ])
    expect(greenwayWorksSurveySegments(surveyWorks('bridge'), revealed)).toEqual([
      { id: 'bridge:-8', from: [-9.1, 2.16, 8], to: [-6.9, 2.16, 8] },
    ])
  })

  it('clips each 4 m column unless every canonical footprint row is revealed', () => {
    const nextLadder = surveyColumn(-6, [0, -1, -2, -3], 1)
    expect(greenwayWorksSurveySegments(surveyWorks('ladder'),
      [...ladder.slice(1), ...nextLadder]).map(({ id }) => id)).toEqual(['ladder:-24'])
    expect(greenwayWorksSurveySegments(surveyWorks('bridge'), bridge.slice(1))).toEqual([])
    expect(greenwayWorksSurveySegments(surveyWorks('ladder'),
      ladder.map((cell, index) => index === 2 ? { ...cell, id: 'unrelated-tile' } : cell)))
      .toEqual([])
  })

  it('hides the strip outside active Greenway bridge or ladder Works mode', () => {
    const revealed = [...ladder, ...bridge]
    const works = surveyWorks('ladder')
    for (const saved of [undefined, { ...works, modeActive: false },
      { ...works, actionsEnabled: false }, { ...works, context: 'v28-river' as const },
      { ...works, selectedKind: 'dig' as const }]) {
      expect(greenwayWorksSurveySegments(saved, revealed)).toEqual([])
    }
  })

  it('renders one non-Mesh line that obstacle picking cannot hit', () => {
    const segments = greenwayWorksSurveySegments(surveyWorks('ladder'), ladder)
    const markup = renderToStaticMarkup(createElement(GreenwayWorksSurvey, { segments }))
    expect(markup).toContain('<lineSegments name="Greenway Works survey only, aim to check"')
    expect(markup).not.toContain('<mesh')
  })
})

describe('V23 west cliff scene tap', () => {
  const bounds = { left: 100, top: 50, width: 200, height: 100 }
  const scene = new THREE.Scene()
  const cliff = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.56, 4),
    new THREE.MeshBasicMaterial())
  cliff.name = 'Mireglass cosmetic slate escarpment'
  cliff.position.set(-414, 1.62, 432)
  scene.add(cliff)
  scene.fog = new THREE.Fog('#5b657c', 24, 31)
  const cameraAt = (z: number) => {
    const camera = new THREE.PerspectiveCamera(68, 2, 0.08, 180)
    camera.position.set(-410, 1.62, z)
    camera.lookAt(-414, 1.62, z)
    camera.updateProjectionMatrix()
    return camera
  }
  const pick = (z: number, known = first.footprintTileIds) =>
    pickVisibleRegionalLadderAimZ(scene, cameraAt(z), bounds, 200, 100,
      { seed, discoveredTileIds: known })

  it('snaps visible first and last face taps onto separate canonical Z placements', () => {
    expect(pick(430.6)).toBeCloseTo(first.from.z)
    expect(pick(433.4)).toBeCloseTo(second.from.z)
    expect(pick(430.5)).toBeNull()
    expect(pick(433.5)).toBeNull()
  })

  it('requires the complete footprint and rejects occluded or unrelated surfaces', () => {
    expect(pick(430.6, first.footprintTileIds.slice(1))).toBeNull()
    cliff.name = 'Unrelated rock'
    expect(pick(430.6)).toBeNull()
    cliff.name = 'Terrain perimeter and cliff fascia'
    expect(pick(430.6)).toBeCloseTo(first.from.z)
    cliff.name = 'Mireglass cosmetic slate escarpment'
    const foreground = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2, 1),
      new THREE.MeshBasicMaterial())
    foreground.name = 'Foreground rock'
    foreground.position.set(-412, 1.62, 430.6)
    scene.add(foreground)
    expect(pick(430.6)).toBeNull()
    scene.remove(foreground)
    cliff.position.x = -416
    expect(pick(430.6)).toBeNull()
    cliff.position.x = -414
    scene.fog = new THREE.Fog('#5b657c', 0, 2)
    expect(pick(430.6)).toBeNull()
    scene.fog = new THREE.Fog('#5b657c', 24, 31)
    expect(pickVisibleRegionalLadderAimZ(scene, cameraAt(430.6),
      { ...bounds, width: 0 }, 200, 100,
      { seed, discoveredTileIds: first.footprintTileIds })).toBeNull()
  })
})

describe('V23 west-facing ladder scene', () => {
  it('draws separate steep open-rung ladders at both canonical snapped positions', () => {
    expect(first.id).not.toBe(second.id)
    for (const site of [first, second]) {
      const segment = terrainWorkStructureGeometry(site)[0]
      expect(segment.rise / segment.run).toBeGreaterThan(2)
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
      const tangent = new THREE.Vector3(1, 0, 0).applyEuler(rotation)
      expect(Math.abs(tangent.z)).toBeCloseTo(1)
      const markup = renderToStaticMarkup(createElement(TerrainWorkStructure,
        { site, built: true, source: 'Regional' }))
      const meshes = [...markup.matchAll(/<mesh\b[^>]*>/g)].map(([tag]) => tag)
      const rungs = meshes.filter((tag) => tag.includes(`scale="${site.widthMeters - 0.26},0.1,0.08"`))
      expect(rungs.length).toBeGreaterThanOrEqual(5)
      expect(meshes).toHaveLength(rungs.length + 6)
      expect(markup).not.toContain(`scale="${site.widthMeters},0.14,`)
    }
  })

  it('keeps the selected regional ladder a sparse guide until it is built', () => {
    const ready = renderToStaticMarkup(createElement(TerrainWorkStructure,
      { site: first, built: false, source: 'Regional' }))
    const blocked = renderToStaticMarkup(createElement(TerrainWorkStructure,
      { site: first, built: false, blocked: true, source: 'Regional' }))
    const built = renderToStaticMarkup(createElement(TerrainWorkStructure,
      { site: first, built: true, source: 'Regional' }))
    const physicalRung = `scale="${first.widthMeters - 0.26},0.1,0.08"`
    expect(ready).toContain(`Regional ladder ${first.id} (preview)`)
    expect(blocked).toContain(`Regional ladder ${first.id} (blocked preview)`)
    expect([...ready.matchAll(/<mesh\b/g)]).toHaveLength(4)
    expect([...blocked.matchAll(/<mesh\b/g)]).toHaveLength(4)
    expect(ready).not.toContain(physicalRung)
    expect(blocked).not.toContain(physicalRung)
    expect(built.split(physicalRung).length - 1).toBeGreaterThanOrEqual(5)
  })

  it('gates the selected ghost and completed structures on every discovery tile', () => {
    const feed = { builtSites: [first], preview: { site: second, rejection: null } }
    expect(regionalLadderVisuals(feed, terrain).map(({ site, built }) => [site.id, built]))
      .toEqual([[first.id, true], [second.id, false]])
    expect(regionalLadderVisuals({ builtSites: [first, second], preview: null }, terrain)
      .map(({ site }) => site.id)).toEqual([first.id, second.id])
    const hidden = terrain.filter(({ id }) => id !== first.footprintTileIds[0])
    expect(regionalLadderVisuals(feed, hidden)).toEqual([])
    expect(regionalLadderVisuals({ ...feed, preview: { site: second,
      rejection: 'too_far' } }, terrain)[1]).toMatchObject({ built: false, blocked: true })
    expect(regionalLadderVisuals({ ...feed, preview: { site: second,
      rejection: 'undiscovered' } }, terrain)).toHaveLength(1)
    expect(regionalLadderVisuals({ builtSites: [first], preview: { site: first,
      rejection: null } }, terrain)).toHaveLength(1)
  })

  it('marks both dry feet of a built Slate ladder while previewing only the lower approach', () => {
    const works = regionalLadderVisuals({ builtSites: [first], preview: { site: second,
      rejection: null } }, terrain)
    const markers = terrainWorkApproachMarkers(works, terrain)
    expect(markers.map(({ id }) => id)).toEqual([
      `${first.id}:0`, `${first.id}:1`, `${second.id}:0`,
    ])
    for (const [marker, site] of [[markers[0], first], [markers[2], second]] as const) {
      expect(marker.regional).toBe(true)
      expect(marker.position[0]).toBeGreaterThan(site.from.x)
      expect(marker.position[1]).toBeCloseTo(site.from.y + 0.055)
      expect(marker.position[2]).toBeCloseTo(site.from.z)
    }
    const upper = markers[1]
    expect(upper).toMatchObject({ regional: true, built: true, blocked: false })
    expect(upper.position).toEqual([first.to.x - 0.4, first.to.y + 0.055, first.to.z])
    expect(upper.position[0]).toBeLessThan(first.supportPath[2].x)
    expect(upper.position[0]).toBeGreaterThan(first.to.x - 2)
    expect(upper.yaw).toBeCloseTo(markers[0].yaw + Math.PI)
    expect(terrainWorkApproachMarkers(works, terrain.slice(1))).toEqual([])
  })

  it('renders one selected V23 ghost when Works HUD and regional scene feeds share its ID', () => {
    const regional = { builtSites: [], preview: { site: first, rejection: null } }
    // The HUD feed intentionally carries the same canonical site through the older preview shape.
    const saved = { builtSites: [], dugTileIds: [], context: 'works4-greenway',
      preview: { selected: { site: first, rejection: null }, nearby: [], guidance: null } } as unknown as WizardSavedTerrainWorksView
    expect(savedTerrainWorkVisuals(saved, terrain)).toHaveLength(1)
    const works = [
      ...savedTerrainWorkVisuals(saved, terrain, regional),
      ...regionalLadderVisuals(regional, terrain),
    ]
    expect(works).toHaveLength(1)
    const markup = renderToStaticMarkup(createElement(TerrainWorkStructure,
      { site: works[0].site, built: works[0].built, source: 'Regional' }))
    expect(markup).toContain(`Regional ladder ${first.id} (preview)`)

    const legacy = resolveTerrainWorkSite(seed, 'works1:ladder:-103:108:W')
    if (legacy?.kind !== 'ladder') throw new Error('Missing legacy cliff fixture')
    const legacySaved = { ...saved, preview: { ...saved.preview!,
      selected: { ...saved.preview!.selected!, site: legacy } } }
    const legacyTerrain = [...terrain, ...legacy.footprintTileIds.map((id): WizardTerrainCell =>
      ({ id, position: [0, 0, 0], size: [4, 4], height: 0, climate: 'loam' }))]
    expect(savedTerrainWorkVisuals(legacySaved, legacyTerrain, regional)
      .map(({ site }) => site.id)).toEqual([legacy.id])
  })
})

describe('V28 connected-river Works scene', () => {
  it('aims only the frontmost revealed river skin, not arbitrary terrain or hidden water', () => {
    const scene = new THREE.Scene()
    const water = new THREE.Mesh(new THREE.BoxGeometry(4, 0.04, 4),
      new THREE.MeshBasicMaterial())
    water.name = 'Greenway creek water'
    water.position.set(-56, 1, 12)
    scene.add(water)
    const camera = new THREE.PerspectiveCamera(68, 2, 0.08, 180)
    camera.position.set(-56, 6, 8)
    camera.lookAt(-56, 1, 12)
    camera.updateProjectionMatrix()
    const bounds = { left: 100, top: 50, width: 200, height: 100 }
    const pick = () => pickVisibleWorkAimX(scene, camera, bounds, 200, 100,
      'river-bridge', seed)
    expect(pick()).toBe(-56)
    expect(pickVisibleWorkAimX(scene, camera, bounds, 200, 100,
      'river-bridge')).toBeNull()
    const rock = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 4),
      new THREE.MeshBasicMaterial())
    rock.name = 'Foreground rock'
    rock.position.set(-56, 2.5, 10)
    scene.add(rock)
    expect(pick()).toBeNull()
    scene.remove(rock)
    water.visible = false
    expect(pick()).toBeNull()
  })
})
