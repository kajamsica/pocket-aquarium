import { useRef } from 'react'
import * as THREE from 'three'

import { useSpecimenDispatch } from './SpecimenFish'
import { specimenAssetFor, type SpecimenAsset } from './specimens/assetRegistry'
import { RiggedSpecimen } from './specimens/RiggedSpecimen'

export type CoralSurface = 'sand' | 'rock'
export type Vec3Tuple = readonly [number, number, number]
export const CORAL_PLACEMENT_SURFACE_KEY = 'coralPlacementSurface'
export const CORAL_PLACEMENT_SURFACE_ID_KEY = 'coralPlacementSurfaceId'

export interface CoralPlacementV1 {
  readonly version: 1
  readonly surface: CoralSurface
  readonly surfaceId: string
  readonly position: Vec3Tuple
  readonly normal: Vec3Tuple
  readonly yaw: number
}

export interface TankPlacementSpace {
  readonly halfWidth: number
  readonly halfDepth: number
  readonly floorY: number
  readonly waterlineY: number
}

export interface CoralSurfaceHit {
  readonly surface: CoralSurface
  readonly surfaceId: string
  readonly point: THREE.Vector3
  readonly normal: THREE.Vector3
}

export interface PlacedCoralFootprint {
  readonly placement: CoralPlacementV1
  readonly radius: number
}

export type PlacementInvalidReason = 'slope' | 'bounds' | 'waterline' | 'clearance'

export interface CoralPlacementCandidate {
  readonly placement: CoralPlacementV1
  readonly valid: boolean
  readonly reason?: PlacementInvalidReason
}

export interface CandidateOptions {
  readonly footprintRadius: number
  readonly colonyHeight: number
  readonly yaw?: number
  readonly maximumSlopeDegrees?: number
  readonly minimumClearance?: number
  readonly occupied?: readonly PlacedCoralFootprint[]
}

export function localTankPointToNormalized(point: THREE.Vector3, space: TankPlacementSpace): Vec3Tuple {
  const waterHeight = space.waterlineY - space.floorY
  return [point.x / space.halfWidth, (point.y - space.floorY) / waterHeight,
    point.z / space.halfDepth]
}

export function normalizedTankPointToLocal(point: Vec3Tuple, space: TankPlacementSpace): THREE.Vector3 {
  return new THREE.Vector3(point[0] * space.halfWidth,
    space.floorY + point[1] * (space.waterlineY - space.floorY),
    point[2] * space.halfDepth)
}

function surfaceIdFor(surface: CoralSurface, baseId: string, instanceId?: number): string | undefined {
  const id = instanceId === undefined ? baseId : `${baseId}:${instanceId}`
  const accepted = surface === 'sand' ? /^sand:(?:base|mound:\d+)$/.test(id) : /^rock:\d+$/.test(id)
  return accepted ? id : undefined
}

/** Converts a tagged R3F intersection into habitat-local data. Instanced geometry normals
 * include both the instance and object transforms. */
export function coralSurfaceHitFromIntersection(intersection: THREE.Intersection,
  habitatMatrixWorld = new THREE.Matrix4()): CoralSurfaceHit | undefined {
  const data = intersection.object.userData
  const surface = data[CORAL_PLACEMENT_SURFACE_KEY] as CoralSurface | undefined
  const baseId = data[CORAL_PLACEMENT_SURFACE_ID_KEY] as string | undefined
  if ((surface !== 'sand' && surface !== 'rock') || !baseId || !intersection.face) return undefined
  const surfaceId = surfaceIdFor(surface, baseId, intersection.instanceId)
  if (!surfaceId) return undefined

  const surfaceMatrix = intersection.object.matrixWorld.clone()
  if (intersection.object instanceof THREE.InstancedMesh && intersection.instanceId !== undefined) {
    const instanceMatrix = new THREE.Matrix4()
    intersection.object.getMatrixAt(intersection.instanceId, instanceMatrix)
    surfaceMatrix.multiply(instanceMatrix)
  }
  const worldToHabitat = habitatMatrixWorld.clone().invert()
  const surfaceToHabitat = worldToHabitat.clone().multiply(surfaceMatrix)
  const normal = intersection.face.normal.clone()
    .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(surfaceToHabitat)).normalize()
  return { surface, surfaceId, point: intersection.point.clone().applyMatrix4(worldToHabitat), normal }
}

export function evaluateCoralPlacement(hit: CoralSurfaceHit, space: TankPlacementSpace,
  options: CandidateOptions): CoralPlacementCandidate {
  const normal = hit.normal.clone().normalize()
  const placement: CoralPlacementV1 = {
    version: 1, surface: hit.surface, surfaceId: hit.surfaceId,
    position: localTankPointToNormalized(hit.point, space),
    normal: [normal.x, normal.y, normal.z], yaw: options.yaw ?? 0,
  }
  const result = (reason?: PlacementInvalidReason): CoralPlacementCandidate =>
    reason ? { placement, valid: false, reason } : { placement, valid: true }
  const maximumSlope = THREE.MathUtils.degToRad(options.maximumSlopeDegrees ?? 45)
  if (normal.dot(new THREE.Vector3(0, 1, 0)) < Math.cos(maximumSlope)) return result('slope')
  const radius = options.footprintRadius
  if (hit.point.y < space.floorY || Math.abs(hit.point.x) + radius > space.halfWidth
    || Math.abs(hit.point.z) + radius > space.halfDepth) return result('bounds')
  if (hit.point.y + options.colonyHeight > space.waterlineY) return result('waterline')
  const minimumClearance = options.minimumClearance ?? 0
  const overlaps = (options.occupied ?? []).some((other) => {
    const point = normalizedTankPointToLocal(other.placement.position, space)
    return Math.hypot(point.x - hit.point.x, point.z - hit.point.z)
      < radius + other.radius + minimumClearance
  })
  return result(overlaps ? 'clearance' : undefined)
}

export function coralPlacementTransform(placement: CoralPlacementV1, space: TankPlacementSpace) {
  const normal = new THREE.Vector3(...placement.normal).normalize()
  const align = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal)
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.yaw)
  return { position: normalizedTankPointToLocal(placement.position, space), quaternion: align.multiply(yaw) }
}

export interface CoralRenderPlan {
  readonly asset: SpecimenAsset
  readonly targetWidth: number
  readonly ringColor?: '#48e08b' | '#ff5f6d'
}

export function resolveCoralRenderPlan(speciesId: string, variantId: string | undefined,
  sceneUnitsPerMeter: number, mode: 'preview' | 'locked', valid = true): CoralRenderPlan | undefined {
  const asset = specimenAssetFor(speciesId, variantId)
  if (!asset || asset.category !== 'coral') return undefined
  return {
    asset, targetWidth: asset.referenceAdultLengthMeters * sceneUnitsPerMeter,
    ...(mode === 'preview' ? { ringColor: valid ? '#48e08b' as const : '#ff5f6d' as const } : {}),
  }
}

export interface CoralPlacementProps {
  readonly speciesId: string
  readonly variantId?: string
  readonly individualId: number
  readonly placement: CoralPlacementV1
  readonly space: TankPlacementSpace
  readonly sceneUnitsPerMeter: number
  readonly mode: 'preview' | 'locked'
  readonly valid?: boolean
  readonly active?: boolean
}

function stopPlacementEvent(event: { stopPropagation(): void }) { event.stopPropagation() }

/** Controlled renderer only. Persistence and placement-mode ownership remain above the scene. */
export function CoralPlacement({ speciesId, variantId, individualId, placement, space,
  sceneUnitsPerMeter, mode, valid = true, active = false }: CoralPlacementProps) {
  const dispatch = useSpecimenDispatch()
  const feedDrive = useRef(0)
  const plan = resolveCoralRenderPlan(speciesId, variantId, sceneUnitsPerMeter, mode, valid)
  if (!plan) return null
  const transform = coralPlacementTransform(placement, space)
  const stop = active ? stopPlacementEvent : undefined
  // A locked colony is a placed resident of the tank, so it answers the same root selection
  // action a fish does. A preview is still being positioned and stays a placement target only.
  // `rootCoralId` is how the water feed target recognizes the click as a selection, not a feed.
  const selectable = mode === 'locked'
  const ringRadius = plan.targetWidth * 0.62
  return (
    <group name={`coral-${mode}-${individualId}`} position={transform.position} quaternion={transform.quaternion}
      userData={selectable ? { rootCoralId: individualId } : {}}
      onPointerDown={stop} onPointerMove={stop} onPointerUp={stop} onDoubleClick={stop} onWheel={stop}
      onClick={selectable ? (event) => {
        stopPlacementEvent(event)
        dispatch?.({ type: 'SELECT_ENTITY', entityType: 'coral', id: individualId })
      } : stop}>
      <RiggedSpecimen asset={plan.asset} individualId={individualId} targetLengthSceneUnits={plan.targetWidth}
        stage="adult" hunger={0} feedDrive={feedDrive} />
      {plan.ringColor && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .006, 0]} renderOrder={20}>
        <ringGeometry args={[ringRadius * .78, ringRadius, 36]} />
        <meshBasicMaterial color={plan.ringColor} transparent opacity={.9} depthTest={false} />
      </mesh>}
    </group>
  )
}
