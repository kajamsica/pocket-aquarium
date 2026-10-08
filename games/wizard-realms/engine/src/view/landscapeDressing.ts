import type { WizardTerrainCell } from './contracts'

export type LandscapeDetailKind = 'ground' | 'grass' | 'flower' | 'shrub' | 'stone' | 'reed' | 'snag' | 'alder'

export interface LandscapeDetail {
  kind: LandscapeDetailKind
  position: readonly [number, number, number]
  yaw: number
  scale: number
  color: string
}

type Accent = readonly [LandscapeDetailKind, string]
interface DressingProfile {
  count: readonly [number, number]
  ground: readonly string[]
  accents: readonly Accent[]
}

const CLIMATE: Record<string, DressingProfile> = {
  temperate_forest: { count: [3, 4], ground: ['#5c7445', '#75664b'], accents: [
    ['grass', '#7d9853'], ['grass', '#9cae65'], ['flower', '#e0c785'],
    ['flower', '#b5b8d5'], ['shrub', '#526f43'], ['stone', '#aaa892'],
  ] },
  marsh: { count: [3, 4], ground: ['#4c6551', '#625d49'], accents: [
    ['reed', '#8e9e68'], ['reed', '#acaa75'], ['grass', '#6f9565'],
    ['flower', '#c7bc8f'], ['shrub', '#577253'], ['stone', '#989d88'],
  ] },
  dry_highland: { count: [2, 4], ground: ['#8c8064', '#756f57'], accents: [
    ['grass', '#9ca16d'], ['shrub', '#717853'], ['stone', '#aaa58b'],
    ['stone', '#888b80'], ['flower', '#d2bd8e'],
  ] },
  alpine: { count: [2, 3], ground: ['#aab4a8', '#98a8a3'], accents: [
    ['grass', '#8eaa91'], ['flower', '#d4d8c6'], ['stone', '#abb7b5'],
    ['stone', '#82999c'],
  ] },
}

const MIREGLASS: Record<string, DressingProfile> = {
  wetland: { count: [3, 4], ground: ['#375a53', '#4b5145'], accents: [
    ['reed', '#8f9d6c'], ['reed', '#adb17a'], ['reed', '#728e67'],
    ['grass', '#6e9a76'], ['flower', '#c8b891'], ['shrub', '#4e765b'],
  ] },
  loam: { count: [3, 4], ground: ['#5a5344', '#607155'], accents: [
    ['grass', '#859961'], ['grass', '#a2a971'], ['shrub', '#587653'],
    ['flower', '#d2bd92'], ['stone', '#a49f86'],
  ] },
  rocky: { count: [2, 3], ground: ['#81847a', '#6c7168'], accents: [
    ['stone', '#a9ada1'], ['stone', '#91988e'], ['grass', '#879974'],
  ] },
  snow: CLIMATE.alpine,
}

const APPROACH: DressingProfile = { count: [2, 3], ground: ['#77775e', '#8a8066'], accents: [
  ['grass', '#8d9a67'], ['shrub', '#6d8357'], ['stone', '#a9a28a'],
] }
const HIGHLAND_TRAIL: DressingProfile = { count: [2, 3], ground: ['#a89d80', '#8f8b76'], accents: [
  ['grass', '#9fa176'], ['stone', '#a9a696'], ['stone', '#858b84'],
] }
const HIGHLAND_QUARRY: DressingProfile = { count: [2, 3], ground: ['#898d82', '#777d77'], accents: [
  ['stone', '#b1afa0'], ['stone', '#8b928c'], ['stone', '#a1a49a'], ['grass', '#8c9a79'],
] }
const SNAG_COLORS = ['#736c5d', '#8a826e', '#5e665c'] as const
const ALDER_COLORS = ['#557858', '#688760', '#74916b'] as const

function profileFor(cell: WizardTerrainCell): DressingProfile {
  if (cell.highlandSurface === 'quarry') return HIGHLAND_QUARRY
  if (cell.highlandSurface === 'trail') return HIGHLAND_TRAIL
  if (cell.mireglassTerrain) return MIREGLASS[cell.mireglassTerrain] ?? CLIMATE[cell.climate] ?? CLIMATE.temperate_forest
  if (cell.mireglassApproach) return APPROACH
  return CLIMATE[cell.climate] ?? CLIMATE.temperate_forest
}

/** A local repeatable stream; scenery never consumes simulation randomness. */
function detailRolls(cell: WizardTerrainCell): () => number {
  const identity = `${cell.id}|${cell.position.join(',')}|${cell.climate}|${cell.mireglassTerrain ?? ''}|${cell.mireglassApproach ?? ''}|${cell.highlandSurface ?? ''}`
  let state = 2166136261
  for (let index = 0; index < identity.length; index += 1) {
    state = Math.imul(state ^ identity.charCodeAt(index), 16777619)
  }
  state ||= 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}

function distanceToTrail(x: number, z: number, segment: WizardTerrainCell['mireglassTrailSegment']): number {
  if (!segment) return Infinity
  const [ax, az] = segment.from
  const [bx, bz] = segment.to
  if (![ax, az, bx, bz].every(Number.isFinite)) return Infinity
  const dx = bx - ax
  const dz = bz - az
  const lengthSquared = dx * dx + dz * dz
  const along = lengthSquared > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared)) : 0
  return Math.hypot(x - ax - along * dx, z - az - along * dz)
}

/** Low, cosmetic scenery for a visible terrain window. Positions are world-space surface points. */
export function landscapeDressingFor(
  cells: readonly WizardTerrainCell[], clearings: readonly (readonly [number, number])[] = [],
): readonly LandscapeDetail[] {
  const details: LandscapeDetail[] = []
  const trailSegments = cells.flatMap((cell) => [cell.mireglassTrailSegment, cell.highlandTrailSegment])
    .filter((segment) => segment !== undefined)
  for (const cell of cells) {
    const [x, y, z] = cell.position
    const halfX = cell.size[0] / 2 - 0.3
    const halfZ = cell.size[1] / 2 - 0.3
    if (![x, y, z, halfX, halfZ].every(Number.isFinite) || halfX <= 0 || halfZ <= 0) continue

    const profile = profileFor(cell)
    const roll = detailRolls(cell)
    const count = profile.count[0] + Math.floor(roll() * (profile.count[1] - profile.count[0] + 1))
    const lowland = !cell.highlandSurface && cell.climate !== 'dry_highland' && cell.climate !== 'alpine'
    const snagChance = !lowland ? 0 : cell.mireglassTerrain === 'loam' ? 1 / 18
      : cell.climate === 'marsh' || cell.mireglassTerrain === 'wetland' ? 1 / 12 : 0
    const snag = snagChance > 0 && roll() < snagChance
    const alder = !snag && snagChance > 0 && roll() < 1 / 8
    for (let index = 0; index < count; index += 1) {
      const accent = profile.accents[Math.floor(roll() * profile.accents.length)]
      const kind = index === 0 ? 'ground' : index === count - 1 && snag ? 'snag'
        : index === count - 1 && alder ? 'alder' : accent[0]
      const color = kind === 'ground' ? profile.ground[Math.floor(roll() * profile.ground.length)]
        : kind === 'snag' ? SNAG_COLORS[Math.floor(roll() * SNAG_COLORS.length)]
          : kind === 'alder' ? ALDER_COLORS[Math.floor(roll() * ALDER_COLORS.length)] : accent[1]
      const scale = kind === 'ground' ? 0.55 + roll() * 0.25
        : kind === 'snag' || kind === 'alder' ? 0.65 + roll() * 0.15 : 0.28 + roll() * 0.28
      const yaw = roll() * Math.PI * 2
      // Footprints include the rendered mesh radius and remain 0.3 m inside the tile edge.
      const footprint = kind === 'ground' ? scale : kind === 'shrub' ? 1.05 * scale
        : kind === 'stone' ? 0.7 * scale : kind === 'grass' ? 0.45 * scale
          : kind === 'reed' ? 0.38 * scale : kind === 'flower' ? 0.16 * scale : 0.45
      const insetX = halfX - footprint
      const insetZ = halfZ - footprint
      if (insetX <= 0 || insetZ <= 0) continue
      // Plants leave 1.3 m beyond their rendered footprint, stones leave the route's 0.65 m half-width.
      const clearance = kind === 'ground' ? 0.65 : kind === 'stone' ? 0.65 + footprint
        : kind === 'snag' || kind === 'alder' ? 2.3 : 1.3 + footprint
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const px = x + (roll() * 2 - 1) * insetX
        const pz = z + (roll() * 2 - 1) * insetZ
        const nearTrail = kind === 'ground'
          ? distanceToTrail(px, pz, cell.mireglassTrailSegment) < clearance
            || distanceToTrail(px, pz, cell.highlandTrailSegment) < clearance
          : trailSegments.some((segment) => distanceToTrail(px, pz, segment) < clearance)
        if (nearTrail || ((kind === 'snag' || kind === 'alder')
          && clearings.some(([cx, cz]) => Math.hypot(px - cx, pz - cz) < 2.5))) continue
        details.push({ kind, position: [px, y, pz], yaw, scale, color })
        break
      }
    }
  }
  return details
}
