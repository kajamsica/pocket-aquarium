import { exactPublicV23 } from './publicWorldV23Snapshot'
import { decodePublicV25ExcavationLedger, type PublicV25ExcavationLedger } from './publicWorldV25Excavation'
import { PUBLIC_V25_BEDROCK_LAYER, publicV25StratumAt, type PublicV25Material } from './publicWorldV25Strata'
import { WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

type Material = Exclude<PublicV25Material, 'bedrock'>
const materials = ['soil', 'stone', 'iron_ore', 'gold_ore', 'diamond'] as const
export type PublicV26Column = Readonly<{ gx: number; gz: number; openDepth: number;
  rewardDepth: number; pitLadder: boolean }>
export type PublicV26TerrainLedger = Readonly<{ columns: readonly PublicV26Column[];
  bag: Readonly<Record<Material, number>> }>
const validGrid = (n: unknown): n is number => Number.isSafeInteger(n)
  && (n as number) >= WORLD_GRID_MIN && (n as number) <= WORLD_GRID_MAX
const order = (a: PublicV26Column, b: PublicV26Column) => a.gx - b.gx || a.gz - b.gz

export function emptyPublicV26TerrainLedger(): PublicV26TerrainLedger {
  return { columns: [], bag: { soil: 0, stone: 0, iron_ore: 0, gold_ore: 0, diamond: 0 } }
}

export function decodePublicV26TerrainLedger(value: unknown): PublicV26TerrainLedger | null {
  try {
    if (!exactPublicV23(value, ['columns', 'bag']) || !Array.isArray(value.columns)
      || Object.getPrototypeOf(value.columns) !== Array.prototype || value.columns.length > 256
      || Reflect.ownKeys(value.columns).length !== value.columns.length + 1
      || !exactPublicV23(value.bag, materials)) return null
    const columns: PublicV26Column[] = []
    for (let i = 0; i < value.columns.length; i += 1) {
      const field = Object.getOwnPropertyDescriptor(value.columns, String(i))
      const row: unknown = field?.value
      if (!field?.enumerable || !Object.hasOwn(field, 'value')
        || !exactPublicV23(row, ['gx', 'gz', 'openDepth', 'rewardDepth', 'pitLadder'])
        || !validGrid(row.gx) || !validGrid(row.gz)
        || !Number.isSafeInteger(row.openDepth) || (row.openDepth as number) < 0
        || !Number.isSafeInteger(row.rewardDepth) || (row.rewardDepth as number) < 1
        || (row.rewardDepth as number) > PUBLIC_V25_BEDROCK_LAYER
        || (row.openDepth as number) > (row.rewardDepth as number)
        || typeof row.pitLadder !== 'boolean') return null
      const column = { gx: row.gx, gz: row.gz, openDepth: row.openDepth as number,
        rewardDepth: row.rewardDepth as number, pitLadder: row.pitLadder }
      if (columns.length && order(columns[columns.length - 1], column) >= 0) return null
      columns.push(column)
    }
    const bag = {} as Record<Material, number>
    let total = 0
    for (const material of materials) {
      const count = value.bag[material]
      if (!Number.isSafeInteger(count) || (count as number) < 0) return null
      total += count as number
      if (total > 256) return null
      bag[material] = count as number
    }
    structuredClone(value) // Reject proxies anywhere in the save tree.
    return { columns, bag }
  } catch { return null }
}

export function migratePublicV25ExcavationLedger(source: PublicV25ExcavationLedger): PublicV26TerrainLedger | null {
  const checked = decodePublicV25ExcavationLedger(source)
  return checked ? { columns: checked.columns.map(({ gx, gz, depth }) =>
    ({ gx, gz, openDepth: depth, rewardDepth: depth, pitLadder: false })), bag: { ...checked.bag } } : null
}

export function publicV26ColumnAt(ledger: PublicV26TerrainLedger, gx: number, gz: number): PublicV26Column | null {
  const checked = decodePublicV26TerrainLedger(ledger)
  return checked && validGrid(gx) && validGrid(gz)
    ? checked.columns.find((column) => column.gx === gx && column.gz === gz) ?? null : null
}

type Gate = Readonly<{ gx: number; gz: number; eligible: boolean }>
type Failure = Readonly<{ ok: false; reason: string }>
type Success = Readonly<{ ok: true; ledger: PublicV26TerrainLedger }>

/** `eligible` is a writer-derived fact, not a client permission or a checked action. */
export function digPublicV26Column(ledger: unknown, request: Gate & Readonly<{ seed: string }> ):
  (Success & Readonly<{ layer: number; material: Material | null }>) | Failure {
  const current = decodePublicV26TerrainLedger(ledger)
  if (!current) return { ok: false, reason: 'invalid-ledger' }
  try {
    const { gx, gz, seed, eligible } = request
    if (!validGrid(gx) || !validGrid(gz) || typeof seed !== 'string' || !seed || seed.length > 128
      || typeof eligible !== 'boolean') return { ok: false, reason: 'invalid-request' }
    if (!eligible) return { ok: false, reason: 'ineligible' }
    const index = current.columns.findIndex((column) => column.gx === gx && column.gz === gz)
    const prior = index < 0 ? null : current.columns[index]
    const layer = prior?.openDepth ?? 0
    if (layer >= PUBLIC_V25_BEDROCK_LAYER) return { ok: false, reason: 'bedrock' }
    if (!prior && current.columns.length >= 256) return { ok: false, reason: 'columns-full' }
    const novel = layer === (prior?.rewardDepth ?? 0)
    const material = novel ? publicV25StratumAt(seed, gx, gz, layer).material : null
    if (material === 'bedrock') return { ok: false, reason: 'bedrock' }
    if (material && materials.reduce((sum, key) => sum + current.bag[key], 0) >= 256)
      return { ok: false, reason: 'bag-full' }
    const updated: PublicV26Column = { gx, gz, openDepth: layer + 1,
      rewardDepth: (prior?.rewardDepth ?? 0) + Number(novel), pitLadder: prior?.pitLadder ?? false }
    const columns = current.columns.filter((_, i) => i !== index).concat(updated).sort(order)
    return { ok: true, layer, material, ledger: { columns, bag: material
      ? { ...current.bag, [material]: current.bag[material] + 1 } : { ...current.bag } } }
  } catch { return { ok: false, reason: 'invalid-request' } }
}

/** Filling spends soil but never lowers the rewarded high-water mark. */
export function fillPublicV26Column(ledger: unknown, request: Gate): Success | Failure {
  const current = decodePublicV26TerrainLedger(ledger)
  if (!current) return { ok: false, reason: 'invalid-ledger' }
  try {
    const { gx, gz, eligible } = request
    if (!validGrid(gx) || !validGrid(gz) || typeof eligible !== 'boolean')
      return { ok: false, reason: 'invalid-request' }
    if (!eligible) return { ok: false, reason: 'ineligible' }
    const index = current.columns.findIndex((column) => column.gx === gx && column.gz === gz)
    if (index < 0 || current.columns[index].openDepth === 0)
      return { ok: false, reason: 'already-filled' }
    if (current.bag.soil === 0) return { ok: false, reason: 'requires-soil' }
    const columns = current.columns.map((column, i) => i === index
      ? { ...column, openDepth: column.openDepth - 1 } : column)
    return { ok: true, ledger: { columns, bag: { ...current.bag, soil: current.bag.soil - 1 } } }
  } catch { return { ok: false, reason: 'invalid-request' } }
}
