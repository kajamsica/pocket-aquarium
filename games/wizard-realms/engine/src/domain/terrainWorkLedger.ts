import { resolveFieldCampSite } from './fieldCamp'
import { occupiedTerrainWorkTiles } from './terrainWorkTrial'
import { resolveTerrainWorkSite } from './terrainWorks'

/** The only terrain-work fields intended for a future v13 persisted state. */
export type TerrainWorkLedger = Readonly<{
  builtWorkIds: readonly string[]
  dugTileIds: readonly string[]
}>
export type TerrainWorkLedgerContext = Readonly<{
  seed: string
  fieldCampTileIds: readonly string[]
  authoredBuiltRouteIds: readonly string[]
}>

const MAX_BUILT = 32
const MAX_DUG = 64
const EMPTY: TerrainWorkLedger = Object.freeze({
  builtWorkIds: Object.freeze([]), dugTileIds: Object.freeze([]),
})
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
function snapshotRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!record(value)) return null
  const actual = Reflect.ownKeys(value)
  if (actual.length !== keys.length || !keys.every((key) => actual.includes(key))) return null
  const copy: Record<string, unknown> = Object.create(null)
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return null
    copy[key] = descriptor.value
  }
  return copy
}
function snapshotStrings(value: unknown, maximum: number): string[] | null {
  if (!Array.isArray(value)) return null
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum
    || Reflect.ownKeys(value).length !== length + 1) return null
  const copy: string[] = []
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'string') return null
    copy.push(descriptor.value)
  }
  return copy
}
const sortedUnique = (ids: readonly string[]) => ids.every((id, index) =>
  index === 0 || ids[index - 1] < id)

/** Deterministic migration value for a validated pre-v13 world. */
export function emptyTerrainWorkLedger(): TerrainWorkLedger { return EMPTY }

function snapshotContext(value: unknown): TerrainWorkLedgerContext | null {
  const fields = snapshotRecord(value, ['seed', 'fieldCampTileIds', 'authoredBuiltRouteIds'])
  if (!fields || typeof fields.seed !== 'string' || !fields.seed) return null
  const fieldCampTileIds = snapshotStrings(fields.fieldCampTileIds, 1)
  const authoredBuiltRouteIds = snapshotStrings(fields.authoredBuiltRouteIds, 2)
  if (!fieldCampTileIds || !authoredBuiltRouteIds
    || new Set(fieldCampTileIds).size !== fieldCampTileIds.length
    || new Set(authoredBuiltRouteIds).size !== authoredBuiltRouteIds.length
    || fieldCampTileIds.some((id) => resolveFieldCampSite(fields.seed as string, id) === null)) return null
  return { seed: fields.seed, fieldCampTileIds, authoredBuiltRouteIds }
}

function validatedOccupancy(value: unknown, context: unknown): {
  occupied: Set<string>; ledger: TerrainWorkLedger; context: TerrainWorkLedgerContext
} | null {
  try {
    const fields = snapshotRecord(value, ['builtWorkIds', 'dugTileIds'])
    if (!fields) return null
    const builtWorkIds = snapshotStrings(fields.builtWorkIds, MAX_BUILT)
    const dugTileIds = snapshotStrings(fields.dugTileIds, MAX_DUG)
    const source = snapshotContext(context)
    if (!builtWorkIds || !dugTileIds || !source
      || !sortedUnique(builtWorkIds) || !sortedUnique(dugTileIds)) return null
    const ledger = { builtWorkIds, dugTileIds }
    const occupied = occupiedTerrainWorkTiles(EMPTY, source)
    if (!occupied) return null
    for (const [ids, expectedKind] of [
      [ledger.builtWorkIds, 'built'], [ledger.dugTileIds, 'dig'],
    ] as const) {
      for (const id of ids) {
        const site = resolveTerrainWorkSite(source.seed, id)
        if (!site || (site.kind === 'dig' ? 'dig' : 'built') !== expectedKind
          || site.footprintTileIds.some((tileId) => occupied.has(tileId))) return null
        site.footprintTileIds.forEach((tileId) => occupied.add(tileId))
      }
    }
    return { occupied, ledger, context: source }
  } catch { return null }
}

/** Strict JSON-shape and seed-ground validation. No inventory or client coordinates enter this ledger. */
export function isValidTerrainWorkLedger(value: unknown,
  context: unknown): value is TerrainWorkLedger {
  return validatedOccupancy(value, context) !== null
}

/** Returns a frozen sorted copy, or null without changing the input. */
export function appendTerrainWorkLedger(value: unknown, id: unknown,
  context: unknown): TerrainWorkLedger | null {
  const occupied = validatedOccupancy(value, context)
  if (!occupied || typeof id !== 'string') return null
  const site = resolveTerrainWorkSite(occupied.context.seed, id)
  if (!site || site.footprintTileIds.some((tileId) => occupied.occupied.has(tileId))) return null
  const { ledger } = occupied
  const builtWorkIds = site.kind === 'dig' ? [...ledger.builtWorkIds] : [...ledger.builtWorkIds, id].sort()
  const dugTileIds = site.kind === 'dig' ? [...ledger.dugTileIds, id].sort() : [...ledger.dugTileIds]
  if (builtWorkIds.length > MAX_BUILT || dugTileIds.length > MAX_DUG) return null
  return Object.freeze({ builtWorkIds: Object.freeze(builtWorkIds), dugTileIds: Object.freeze(dugTileIds) })
}
