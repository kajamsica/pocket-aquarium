import * as THREE from 'three'

export const REEF_SAND_Y = -1.44

export function seededUnit(index: number, salt = 0) {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}

/** Shared by rendering and fish clearance so both use the same live-rock volumes. */
export const REEF_ROCKS = Array.from({ length: 13 }, (_, index) => {
  const arc = (index / 12) * Math.PI * 1.74 + 0.16
  const radius = 0.66 + seededUnit(index, 1) * 1.12
  const side = index < 7 ? -0.62 : 0.82
  return {
    position: new THREE.Vector3(
      side + Math.cos(arc) * radius,
      REEF_SAND_Y + 0.22 + seededUnit(index, 2) * 0.4,
      Math.sin(arc) * 0.52 + (seededUnit(index, 3) - 0.5) * 0.42,
    ),
    rotation: new THREE.Euler(
      seededUnit(index, 4) * 0.45,
      seededUnit(index, 5) * Math.PI,
      (seededUnit(index, 6) - 0.5) * 0.48,
    ),
    scale: new THREE.Vector3(
      0.36 + seededUnit(index, 7) * 0.4,
      0.32 + seededUnit(index, 8) * 0.42,
      0.34 + seededUnit(index, 9) * 0.36,
    ),
  }
})
