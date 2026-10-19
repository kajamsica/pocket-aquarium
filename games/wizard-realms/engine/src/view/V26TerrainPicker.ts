import * as THREE from 'three'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from '../domain/worldChunks'
import type { WizardTerrainCell } from './contracts'

export type V26PickedTerrainColumn = Readonly<{ gx: number; gz: number }>
export type V26TerrainPickKind = 'dig' | 'fill' | 'v29-open-pit'
export type V26OpenPitColumn = Readonly<{ gx: number; gz: number; openDepth: number }>
type CanvasBounds = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>
const EDGE_EPSILON_METERS = 0.001
const PIT_EDGE_TOLERANCE_METERS = 0.025

/** A click names only frontmost revealed ground, or an opted-in saved pit's frontmost face. */
export function pickV26TerrainColumn(scene: THREE.Scene, camera: THREE.Camera,
  bounds: CanvasBounds, clientX: number, clientY: number,
  revealed: readonly WizardTerrainCell[], kind: V26TerrainPickKind = 'dig',
  openPitColumns: readonly V26OpenPitColumn[] = []): V26PickedTerrainColumn | null {
  if (!(camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera)
    || ![bounds.left, bounds.top, bounds.width, bounds.height, clientX, clientY].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0
    || !Number.isFinite(bounds.left + bounds.width) || !Number.isFinite(bounds.top + bounds.height)
    || clientX < bounds.left || clientX > bounds.left + bounds.width
    || clientY < bounds.top || clientY > bounds.top + bounds.height) return null

  scene.updateMatrixWorld(true)
  camera.updateMatrixWorld()
  const ray = new THREE.Raycaster()
  ray.setFromCamera(new THREE.Vector2(
    (clientX - bounds.left) / bounds.width * 2 - 1,
    1 - (clientY - bounds.top) / bounds.height * 2), camera)
  const meshes: THREE.Mesh[] = []
  scene.traverseVisible((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    if (materials.some((material) => material.visible && (!material.transparent || material.opacity > 0))) {
      meshes.push(object)
    }
  })
  const hit = ray.intersectObjects(meshes, false)[0]
  if (!hit || scene.fog instanceof THREE.Fog && hit.distance >= scene.fog.far
    || !Number.isFinite(hit.point.x) || !Number.isFinite(hit.point.y)
    || !Number.isFinite(hit.point.z)) return null

  const revealedCell = (gx: number, gz: number) => {
    if (!Number.isSafeInteger(gx) || !Number.isSafeInteger(gz)
      || gx < WORLD_GRID_MIN || gx > WORLD_GRID_MAX || gz < WORLD_GRID_MIN || gz > WORLD_GRID_MAX) return null
    const matches = revealed.filter((cell) => cell.id === `tile-${gx + 3}-${gz + 3}`
      && cell.size[0] === WORLD_CELL_METERS && cell.size[1] === WORLD_CELL_METERS
      && cell.position[0] === gx * WORLD_CELL_METERS
      && cell.position[2] === gz * WORLD_CELL_METERS)
    return matches.length === 1 ? matches[0] : null
  }

  if ((kind === 'fill' || kind === 'v29-open-pit')
    && hit.object.name === 'Terrain perimeter and cliff fascia') {
    const candidates = openPitColumns.flatMap(({ gx, gz, openDepth }) => {
      if (!Number.isSafeInteger(openDepth) || openDepth < 1) return []
      const pit = revealedCell(gx, gz)
      if (!pit) return []
      const dx = hit.point.x - gx * WORLD_CELL_METERS
      const dz = hit.point.z - gz * WORLD_CELL_METERS
      const half = WORLD_CELL_METERS / 2
      const onX = Math.abs(Math.abs(dx) - half) <= PIT_EDGE_TOLERANCE_METERS
        && Math.abs(dz) < half - EDGE_EPSILON_METERS
      const onZ = Math.abs(Math.abs(dz) - half) <= PIT_EDGE_TOLERANCE_METERS
        && Math.abs(dx) < half - EDGE_EPSILON_METERS
      if (onX === onZ) return []
      const neighbor = revealedCell(gx + (onX ? Math.sign(dx) : 0),
        gz + (onZ ? Math.sign(dz) : 0))
      if (!neighbor || neighbor.position[1] - pit.position[1] < 0.3
        || hit.point.y < pit.position[1] - PIT_EDGE_TOLERANCE_METERS
        || hit.point.y > neighbor.position[1] + PIT_EDGE_TOLERANCE_METERS) return []
      return [{ gx, gz }]
    })
    return candidates.length === 1 ? candidates[0] : null
  }
  if (hit.object.name !== 'Continuous terrain surface') return null

  const gx = Math.ceil(hit.point.x / WORLD_CELL_METERS - 0.5)
  const gz = Math.ceil(hit.point.z / WORLD_CELL_METERS - 0.5)
  if (Math.abs(hit.point.x - gx * WORLD_CELL_METERS) >= WORLD_CELL_METERS / 2 - EDGE_EPSILON_METERS
    || Math.abs(hit.point.z - gz * WORLD_CELL_METERS) >= WORLD_CELL_METERS / 2 - EDGE_EPSILON_METERS) return null
  return revealedCell(gx, gz) ? { gx: gx || 0, gz: gz || 0 } : null
}
