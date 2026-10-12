import type { TerrainWorkSite } from './terrainWorks'

type BuiltSite = Exclude<TerrainWorkSite, { kind: 'dig' }>
type Point = Readonly<{ x: number; z: number }>

/** The trial and persisted pose proof use one corridor width and support interpolation. */
export function terrainWorkSupportAt(site: BuiltSite, point: Point): Readonly<{
  axis: number; lateralMeters: number; floorY: number | null
}> {
  const dx = site.to.x - site.from.x, dz = site.to.z - site.from.z
  const lengthSquared = dx * dx + dz * dz
  const axis = ((point.x - site.from.x) * dx + (point.z - site.from.z) * dz) / lengthSquared
  const lateralMeters = Math.abs((point.x - site.from.x) * dz - (point.z - site.from.z) * dx)
    / Math.sqrt(lengthSquared)
  if (axis < -1e-9 || axis > 1 + 1e-9 || lateralMeters > site.widthMeters / 2 + 1e-9) {
    return { axis, lateralMeters, floorY: null }
  }
  const points = site.supportPath
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1], to = points[index]
    const fromAxis = ((from.x - site.from.x) * dx + (from.z - site.from.z) * dz) / lengthSquared
    const toAxis = ((to.x - site.from.x) * dx + (to.z - site.from.z) * dz) / lengthSquared
    if (axis <= toAxis || index === points.length - 1) {
      const share = Math.max(0, Math.min(1, (axis - fromAxis) / (toAxis - fromAxis)))
      return { axis, lateralMeters, floorY: from.y + (to.y - from.y) * share }
    }
  }
  return { axis, lateralMeters, floorY: site.to.y }
}
