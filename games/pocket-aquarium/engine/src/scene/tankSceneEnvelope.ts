import * as THREE from 'three'

import type { ReefSnapshot } from '../contracts'

const BASE_TANK_VOLUME_LITERS = 75
const BASE_TANK_WIDTH = 5.8
const BASE_TANK_HEIGHT = 3.1
const BASE_TANK_DEPTH = 2.6

export type TankDisplayForm = 'rectangular' | 'cylinder'

export interface TankSceneEnvelope {
  readonly form: TankDisplayForm
  readonly key: string
  readonly scale: readonly [number, number, number]
  readonly width: number
  readonly height: number
  readonly depth: number
}

export interface TankCameraFit {
  readonly distance: number
  readonly fov: number
  readonly minDistance: number
  readonly maxDistance: number
}

/**
 * Keep real tank proportions perceptible without letting multi-thousand-litre displays make the
 * scene or its residents unusably small. Rectangular displays grow on all three axes with a
 * compressed logarithmic scale. The cylindrical tier becomes a tall, square-footprint envelope.
 */
export function resolveTankSceneEnvelope(tank: ReefSnapshot['tank']): TankSceneEnvelope {
  const form: TankDisplayForm = tank.form === 'cylinder' ? 'cylinder' : 'rectangular'
  const volume = Math.max(Number.isFinite(tank.nominalVolumeLiters) ? tank.nominalVolumeLiters : BASE_TANK_VOLUME_LITERS, 1)

  let scale: readonly [number, number, number]
  if (form === 'cylinder') {
    const widthScale = .78
    scale = [widthScale, 1.46, BASE_TANK_WIDTH * widthScale / BASE_TANK_DEPTH]
  } else {
    const growth = Math.log2(volume / BASE_TANK_VOLUME_LITERS)
    scale = [
      THREE.MathUtils.clamp(1 + growth * .075, .94, 1.45),
      THREE.MathUtils.clamp(1 + growth * .018, .98, 1.12),
      THREE.MathUtils.clamp(1 + growth * .055, .96, 1.34),
    ]
  }

  return {
    form,
    key: `${form}:${Math.round(volume)}`,
    scale,
    width: BASE_TANK_WIDTH * scale[0],
    height: BASE_TANK_HEIGHT * scale[1],
    depth: BASE_TANK_DEPTH * scale[2],
  }
}

export function cameraFovForAspect(aspect: number) {
  return aspect < .72 ? 60 : 43
}

/** Preserve the accepted desktop framing while guaranteeing a complete fit on narrow screens and
 * for larger scene envelopes. Rectangular tanks reserve diagonal orbit clearance; cylinders have
 * a constant projected diameter as the camera revolves. */
export function cameraFitForEnvelope(envelope: TankSceneEnvelope, aspect: number): TankCameraFit {
  const boundedAspect = THREE.MathUtils.clamp(Number.isFinite(aspect) ? aspect : 1, .35, 3)
  const fov = cameraFovForAspect(boundedAspect)
  const tangent = Math.tan(THREE.MathUtils.degToRad(fov) / 2)
  const projectedWidth = envelope.form === 'cylinder'
    ? envelope.width : Math.hypot(envelope.width, envelope.depth)
  const horizontalDistance = projectedWidth * .5 * 1.15 / (tangent * boundedAspect)
  const verticalDistance = envelope.height * .5 * 1.18 / tangent
  const geometricDistance = Math.max(horizontalDistance, verticalDistance) + envelope.depth * .5
  const acceptedDesktopDistance = boundedAspect < .72 ? 8.55 : boundedAspect > 1.5 ? 6.95 : 7.7
  const distance = Math.max(acceptedDesktopDistance, geometricDistance)

  return {
    distance,
    fov,
    minDistance: .95,
    maxDistance: Math.max(10.2, distance * 1.42),
  }
}
