import * as THREE from 'three'

import type { ReefSnapshot } from '../contracts'

export type AquariumVisualProfile = 'reef' | 'freshwater'

export interface HabitatVisualSettings {
  readonly background: string
  readonly fog: string
  readonly fogDensity: number
  readonly hemisphereSky: string
  readonly hemisphereGround: string
  readonly directional: string
  readonly keyInitial: string
  readonly keyLow: readonly [number, number, number]
  readonly keyHigh: readonly [number, number, number]
  readonly fill: string
  readonly backing: string
  readonly stand: string
  readonly caustic: string
  readonly shaftColors: readonly [string, string]
  readonly substrate: string
  readonly opticalAttenuationScale: number
}

type ChemistryWithTannin = ReefSnapshot['chemistry'] & {
  readonly tannin?: number
  readonly tanninMgPerLiter?: number
}

export function snapshotTannin(snapshot: ReefSnapshot) {
  const chemistry = snapshot.chemistry as ChemistryWithTannin
  return THREE.MathUtils.clamp(chemistry.tannin ?? chemistry.tanninMgPerLiter ?? 0, 0, 1)
}

export function resolveHabitatVisualSettings(
  visualProfile: AquariumVisualProfile = 'reef',
  tannin = 0,
): HabitatVisualSettings {
  if (visualProfile === 'reef') {
    return {
      background: '#01080d', fog: '#061923', fogDensity: 0.055,
      hemisphereSky: '#8bd5f2', hemisphereGround: '#0d1c24', directional: '#8fbfd0', keyInitial: '#83cfff',
      keyLow: [0.2, 0.38, 1], keyHigh: [0.64, 0.82, 1], fill: '#3dd9d0',
      backing: '#06141a', stand: '#071014', caustic: '#45bfff',
      shaftColors: ['#4a9eff', '#7ecbff'], substrate: '#d6c8a1',
      opticalAttenuationScale: 1,
    }
  }

  const tea = THREE.MathUtils.clamp(tannin, 0, 1)
  return {
    background: `#${new THREE.Color('#07130f').lerp(new THREE.Color('#171006'), tea * .7).getHexString()}`,
    fog: `#${new THREE.Color('#12342d').lerp(new THREE.Color('#4a2f12'), tea * .68).getHexString()}`,
    fogDensity: THREE.MathUtils.lerp(.042, .072, tea),
    hemisphereSky: '#d9efc4', hemisphereGround: '#1e2415', directional: '#d7e6bd', keyInitial: '#e0efbd',
    keyLow: [.42, .5, .34], keyHigh: [.94, .96, .72], fill: '#7ebf98',
    backing: '#0b1915', stand: '#0a120f', caustic: '#77c9a5',
    shaftColors: ['#70b99c', '#b2d6a2'], substrate: '#b69a68',
    opticalAttenuationScale: THREE.MathUtils.lerp(1.05, 1.85, tea),
  }
}
