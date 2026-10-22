import type { Vec3 } from './types'

const brand: unique symbol = Symbol('public-v45-dry-ride-admission')
const issued = new WeakMap<object, Readonly<{ from: Vec3; middle: Vec3; to: Vec3 }>>()
const MAX_LEG_METERS = 0.2
const MAX_SPAN_METERS = 0.4

/** Internal geometry admission only. The V45 writer must separately prove a mounted dry ride. */
export type PublicV45DryRideAdmission = Readonly<{ [brand]: true }>

export function createPublicV45DryRideAdmission(from: Vec3, middle: Vec3,
  to: Vec3): PublicV45DryRideAdmission | null {
  if (![from, middle, to].every((point) => point
    && [point.x, point.y, point.z].every(Number.isFinite))) return null
  const first = { x: middle.x - from.x, z: middle.z - from.z }
  const second = { x: to.x - middle.x, z: to.z - middle.z }
  const a = Math.hypot(first.x, first.z), b = Math.hypot(second.x, second.z)
  if (!(a > 0) || !(b > 0) || a > MAX_LEG_METERS || b > MAX_LEG_METERS
    || a + b > MAX_SPAN_METERS
    || first.x * second.x + first.z * second.z <= 0
    || Math.abs(first.x * second.z - first.z * second.x) > 1e-8 * a * b) return null
  const admission = Object.freeze({ [brand]: true as const })
  issued.set(admission, { from: { ...from }, middle: { ...middle }, to: { ...to } })
  return admission
}

/** Private issuance and exact carrier endpoints are required at both passage leaves. */
export function publicV45DryRideMidpoint(value: unknown, from: Vec3, to: Vec3): Vec3 | null {
  if (!value || typeof value !== 'object') return null
  const original = issued.get(value)
  return original && [from, to].every((point) => point
    && [point.x, point.y, point.z].every(Number.isFinite))
    && from.x === original.from.x && from.y === original.from.y && from.z === original.from.z
    && to.x === original.to.x && to.y === original.to.y && to.z === original.to.z
    ? { ...original.middle } : null
}
