import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { publicV26ValleyRimSegments } from '../domain/publicWorldV26ValleyRim'
import type { WizardTerrainCell } from './contracts'
import { buildTerrainSurfaceGeometry } from './TerrainSurfaceLayer'
import { pickV26TerrainColumn } from './V26TerrainPicker'

const bounds = { left: 100, top: 50, width: 200, height: 100 }
const cell = (gx: number, gz: number): WizardTerrainCell => ({
  id: `tile-${gx + 3}-${gz + 3}`, position: [gx * 4, 0, gz * 4],
  size: [4, 4], height: 0.7, climate: 'temperate_forest',
})
const cameraAt = (x: number, z: number, y = 8) => {
  const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 100)
  camera.position.set(x, y, z)
  camera.lookAt(x, 0, z)
  return camera
}
const surface = (scene: THREE.Scene, name = 'Continuous terrain surface', y = 0) => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(24, 24),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = y
  mesh.name = name
  scene.add(mesh)
  return mesh
}
const pick = (scene: THREE.Scene, camera: THREE.Camera, revealed: WizardTerrainCell[],
  x = 200, y = 100) => pickV26TerrainColumn(scene, camera, bounds, x, y, revealed)

const pitFace = () => {
  const scene = new THREE.Scene()
  const face = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.4),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  face.rotation.y = Math.PI / 2
  face.position.set(2, -0.2, 0)
  face.name = 'Terrain perimeter and cliff fascia'
  scene.add(face)
  const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 100)
  camera.position.set(0, 1, 0)
  camera.lookAt(2, -0.2, 0)
  return { scene, camera, face }
}

describe('V26 click-to-column terrain picker', () => {
  it('returns the exact revealed 4 m cell under the frontmost ground hit', () => {
    const scene = new THREE.Scene()
    surface(scene)
    expect(pick(scene, cameraAt(4, 0), [cell(0, 0), cell(1, 0)]))
      .toEqual({ gx: 1, gz: 0 })
    expect(pick(scene, cameraAt(-4, 4), [cell(-1, 1)]))
      .toEqual({ gx: -1, gz: 1 })
  })

  it('does not click through a rock, water, cliff, or visible parent', () => {
    const scene = new THREE.Scene()
    surface(scene)
    const blocker = surface(scene, 'Rock', 1)
    expect(pick(scene, cameraAt(0, 0), [cell(0, 0)])).toBeNull()
    blocker.name = 'Greenway creek water'
    expect(pick(scene, cameraAt(0, 0), [cell(0, 0)])).toBeNull()
    blocker.name = 'Terrain perimeter and cliff fascia'
    expect(pick(scene, cameraAt(0, 0), [cell(0, 0)])).toBeNull()
    blocker.visible = false
    expect(pick(scene, cameraAt(0, 0), [cell(0, 0)])).toEqual({ gx: 0, gz: 0 })
    blocker.visible = true
    const parent = new THREE.Group()
    parent.visible = false
    scene.remove(blocker)
    parent.add(blocker)
    scene.add(parent)
    expect(pick(scene, cameraAt(0, 0), [cell(0, 0)])).toEqual({ gx: 0, gz: 0 })
  })

  it('targets only a saved visible pit from its frontmost wall for Fill', () => {
    const { scene, camera, face } = pitFace()
    const pit = { ...cell(0, 0), position: [0, -0.4, 0] as const }
    const visible = [pit, cell(1, 0)]
    const open = [{ gx: 0, gz: 0, openDepth: 1 }]
    const aim = (revealed = visible, pits = open,
      kind: 'dig' | 'fill' | 'v29-open-pit' = 'fill') =>
      pickV26TerrainColumn(scene, camera, bounds, 200, 100, revealed, kind, pits)
    expect(aim()).toEqual({ gx: 0, gz: 0 })
    expect(aim(visible, open, 'dig')).toBeNull()
    expect(aim(visible, open, 'v29-open-pit')).toEqual({ gx: 0, gz: 0 })
    expect(aim(visible, [], 'v29-open-pit')).toBeNull()
    expect(aim([cell(1, 0)], open, 'v29-open-pit')).toBeNull()
    expect(aim(visible, [])).toBeNull()
    expect(aim([cell(1, 0)])).toBeNull()
    expect(aim(visible, [{ ...open[0], openDepth: 0 }])).toBeNull()
    face.name = 'Unrelated cliff'
    expect(aim()).toBeNull()
    face.name = 'Terrain perimeter and cliff fascia'
    const blocker = new THREE.Mesh(new THREE.PlaneGeometry(4, 1),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    blocker.rotation.y = Math.PI / 2
    blocker.position.set(1, 0.4, 0)
    blocker.name = 'Rock'
    scene.add(blocker)
    expect(aim()).toBeNull()
    expect(aim(visible, open, 'v29-open-pit')).toBeNull()
    blocker.name = 'Greenway creek water'
    expect(aim()).toBeNull()
    expect(aim(visible, open, 'v29-open-pit')).toBeNull()
  })

  it('keeps the first V29 ground dig and its deeper saved pit selectable', () => {
    const first = new THREE.Scene()
    surface(first)
    expect(pickV26TerrainColumn(first, cameraAt(0, 0), bounds, 200, 100,
      [cell(0, 0)], 'v29-open-pit')).toEqual({ gx: 0, gz: 0 })
    const floor = new THREE.Scene()
    surface(floor, 'Continuous terrain surface', -0.8)
    const lowered = { ...cell(0, 0), position: [0, -0.8, 0] as const }
    expect(pickV26TerrainColumn(floor, cameraAt(0, 0), bounds, 200, 100,
      [lowered], 'v29-open-pit', [{ gx: 0, gz: 0, openDepth: 2 }]))
      .toEqual({ gx: 0, gz: 0 })
    const wall = pitFace()
    expect(pickV26TerrainColumn(wall.scene, wall.camera, bounds, 200, 100,
      [lowered, cell(1, 0)], 'v29-open-pit', [{ gx: 0, gz: 0, openDepth: 2 }]))
      .toEqual({ gx: 0, gz: 0 })
    expect(pickV26TerrainColumn(wall.scene, wall.camera, bounds, 200, 100,
      [lowered, cell(1, 0)], 'dig', [{ gx: 0, gz: 0, openDepth: 2 }])).toBeNull()
  })

  it('picks an actual front-facing saved pit fascia without clicking through another object', () => {
    const pit = { ...cell(0, 0), position: [0, -0.4, 0] as const }
    const tiles = [pit, cell(1, 0)]
    const open = [{ gx: 0, gz: 0, openDepth: 1 }]
    const geometry = buildTerrainSurfaceGeometry('wizard-realms', tiles, tiles,
      () => ({ top: new THREE.Color('#54805a'), side: new THREE.Color('#654d37') }),
      publicV26ValleyRimSegments('wizard-realms', []), true, open)
    const scene = new THREE.Scene()
    const top = new THREE.Mesh(geometry.top, new THREE.MeshBasicMaterial())
    top.name = 'Continuous terrain surface'
    scene.add(top)
    const fascia = new THREE.Mesh(geometry.sides, new THREE.MeshBasicMaterial())
    fascia.name = 'Terrain perimeter and cliff fascia'
    scene.add(fascia)
    const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 100)
    camera.position.set(0, 1, 0)
    camera.lookAt(2, -0.2, 0)
    expect(pickV26TerrainColumn(scene, camera, bounds, 200, 100,
      tiles, 'v29-open-pit', open)).toEqual({ gx: 0, gz: 0 })
    expect(pickV26TerrainColumn(scene, camera, bounds, 200, 100,
      tiles, 'dig', open)).toBeNull()
    const rock = new THREE.Mesh(new THREE.PlaneGeometry(4, 1),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    rock.rotation.y = Math.PI / 2
    rock.position.set(1, 0.4, 0)
    rock.name = 'Rock'
    scene.add(rock)
    expect(pickV26TerrainColumn(scene, camera, bounds, 200, 100,
      tiles, 'v29-open-pit', open)).toBeNull()
    geometry.top.dispose(); geometry.sides.dispose()
  })

  it('rejects hidden or forged cells, fogged distance, and ambiguous cell edges', () => {
    const scene = new THREE.Scene()
    surface(scene)
    expect(pick(scene, cameraAt(4, 0), [cell(0, 0)])).toBeNull()
    expect(pick(scene, cameraAt(4, 0), [{ ...cell(1, 0), id: 'wrong' }])).toBeNull()
    expect(pick(scene, cameraAt(4, 0), [cell(1, 0), cell(1, 0)])).toBeNull()
    expect(pick(scene, cameraAt(2, 0), [cell(0, 0), cell(1, 0)])).toBeNull()
    expect(pick(scene, cameraAt(0, -2), [cell(0, -1), cell(0, 0)])).toBeNull()
    expect(pick(scene, cameraAt(2.01, 0), [cell(1, 0)])).toEqual({ gx: 1, gz: 0 })
    scene.fog = new THREE.Fog('#a7cddb', 24, 31)
    expect(pick(scene, cameraAt(0, 0, 50), [cell(0, 0)])).toBeNull()
  })

  it('fails closed for unsafe canvas bounds, outside taps, and absent ground', () => {
    const scene = new THREE.Scene()
    surface(scene)
    const camera = cameraAt(0, 0)
    expect(pickV26TerrainColumn(scene, camera, { ...bounds, width: 0 }, 200, 100, [cell(0, 0)]))
      .toBeNull()
    expect(pickV26TerrainColumn(scene, camera, { ...bounds, left: Number.NaN }, 200, 100, [cell(0, 0)]))
      .toBeNull()
    expect(pickV26TerrainColumn(scene, camera, { ...bounds, width: Number.POSITIVE_INFINITY },
      200, 100, [cell(0, 0)])).toBeNull()
    expect(pick(scene, camera, [cell(0, 0)], 99, 100)).toBeNull()
    expect(pick(scene, camera, [cell(0, 0)], Number.NaN, 100)).toBeNull()
    expect(pick(new THREE.Scene(), camera, [cell(0, 0)])).toBeNull()
  })
})
