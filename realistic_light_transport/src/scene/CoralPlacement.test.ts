import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  CORAL_PLACEMENT_SURFACE_ID_KEY,
  CORAL_PLACEMENT_SURFACE_KEY,
  coralPlacementTransform,
  coralSurfaceHitFromIntersection,
  evaluateCoralPlacement,
  localTankPointToNormalized,
  normalizedTankPointToLocal,
  resolveCoralRenderPlan,
  type CoralSurfaceHit,
  type TankPlacementSpace,
} from './CoralPlacement'

const SPACE: TankPlacementSpace = { halfWidth: 2, halfDepth: 1, floorY: 0, waterlineY: 3 }
const UP_HIT: CoralSurfaceHit = {
  surface: 'sand', surfaceId: 'sand:base', point: new THREE.Vector3(0, .5, 0),
  normal: new THREE.Vector3(0, 1, 0),
}
const OPTIONS = { footprintRadius: .2, colonyHeight: .5 }

describe('coral placement coordinates', () => {
  it('round-trips normalized tank-local positions and aligns the specimen to the stored normal', () => {
    const point = new THREE.Vector3(1, 1.5, -.5)
    const normalized = localTankPointToNormalized(point, SPACE)
    expect(normalized).toEqual([.5, 0, -.5])
    expect(normalizedTankPointToLocal(normalized, SPACE).toArray()).toEqual(point.toArray())

    const placement = evaluateCoralPlacement({ ...UP_HIT, point, normal: new THREE.Vector3(1, 1, 0) },
      SPACE, { ...OPTIONS, yaw: .7 }).placement
    const transform = coralPlacementTransform(placement, SPACE)
    expect(transform.position.toArray()).toEqual(point.toArray())
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(transform.quaternion).toArray())
      .toEqual(expect.arrayContaining([expect.closeTo(Math.SQRT1_2), expect.closeTo(Math.SQRT1_2), expect.closeTo(0)]))
  })

  it('includes instanced and habitat transforms when resolving a tagged surface normal', () => {
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial(), 1)
    mesh.userData[CORAL_PLACEMENT_SURFACE_KEY] = 'rock'
    mesh.userData[CORAL_PLACEMENT_SURFACE_ID_KEY] = 'rock'
    mesh.position.x = 2
    mesh.updateMatrixWorld(true)
    const instance = new THREE.Matrix4().compose(new THREE.Vector3(1, 0, 0),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2),
      new THREE.Vector3(2, 1, 1))
    mesh.setMatrixAt(0, instance)
    const intersection = {
      object: mesh, instanceId: 0, distance: 0, point: new THREE.Vector3(3, 0, 0),
      face: { a: 0, b: 1, c: 2, materialIndex: 0, normal: new THREE.Vector3(0, 1, 0) },
    } as THREE.Intersection
    const hit = coralSurfaceHitFromIntersection(intersection,
      new THREE.Matrix4().makeTranslation(1, 0, 0))

    expect(hit?.surfaceId).toBe('rock:0')
    expect(hit?.point.toArray()).toEqual([2, 0, 0])
    expect(hit?.normal.toArray()).toEqual(expect.arrayContaining([
      expect.closeTo(-1), expect.closeTo(0), expect.closeTo(0),
    ]))
  })
})

describe('coral placement validation', () => {
  it('accepts a clear submerged position and rejects slope, bounds, and waterline deterministically', () => {
    expect(evaluateCoralPlacement(UP_HIT, SPACE, OPTIONS)).toMatchObject({ valid: true })
    expect(evaluateCoralPlacement({ ...UP_HIT, normal: new THREE.Vector3(.87, .5, 0) }, SPACE, OPTIONS))
      .toMatchObject({ valid: false, reason: 'slope' })
    expect(evaluateCoralPlacement({ ...UP_HIT, point: new THREE.Vector3(1.9, .5, 0) }, SPACE, OPTIONS))
      .toMatchObject({ valid: false, reason: 'bounds' })
    expect(evaluateCoralPlacement({ ...UP_HIT, point: new THREE.Vector3(0, 2.6, 0) }, SPACE,
      { ...OPTIONS, colonyHeight: .5 })).toMatchObject({ valid: false, reason: 'waterline' })
  })

  it('rejects a footprint inside the required clearance', () => {
    const accepted = evaluateCoralPlacement(UP_HIT, SPACE, OPTIONS)
    expect(evaluateCoralPlacement({ ...UP_HIT, point: new THREE.Vector3(.35, .5, 0) }, SPACE, {
      ...OPTIONS, minimumClearance: .1, occupied: [{ placement: accepted.placement, radius: .1 }],
    })).toMatchObject({ valid: false, reason: 'clearance' })
  })
})

describe('accepted coral render plans', () => {
  it('resolves exact and default accepted variants with preview feedback', () => {
    const exact = resolveCoralRenderPlan('goniopora', 'purple_green', 10, 'preview', false)
    expect(exact).toMatchObject({ asset: { key: 'goniopora@purple_green', category: 'coral' },
      targetWidth: 1, ringColor: '#ff5f6d' })
    expect(resolveCoralRenderPlan('goniopora', undefined, 10, 'preview', true)?.ringColor).toBe('#48e08b')
    expect(resolveCoralRenderPlan('goniopora', 'purple_green', 10, 'locked')).not.toHaveProperty('ringColor')
  })

  it('does not render unknown variants or accepted non-coral specimens', () => {
    expect(resolveCoralRenderPlan('goniopora', 'not_accepted', 10, 'preview')).toBeUndefined()
    expect(resolveCoralRenderPlan('ocellaris', undefined, 10, 'locked')).toBeUndefined()
  })
})
