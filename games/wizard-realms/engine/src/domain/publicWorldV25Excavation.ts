import { exactPublicV23 } from './publicWorldV23Snapshot'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { PUBLIC_V25_BEDROCK_LAYER, publicV25StratumAt, type PublicV25Material } from './publicWorldV25Strata'
import { WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'
type DigMaterial = Exclude<PublicV25Material, 'bedrock'>
const materials = ['soil', 'stone', 'iron_ore', 'gold_ore', 'diamond'] as const
const tiers = { spade: 1, pick: 2, enchanted_pick: 3 } as const
export type PublicV25ExcavationLedger = Readonly<{
  columns: readonly Readonly<{ gx: number; gz: number; depth: number }>[]
  bag: Readonly<{ soil: number; stone: number; iron_ore: number; gold_ore: number; diamond: number }>
}>
const validGrid = (n: unknown): n is number => Number.isSafeInteger(n)
  && (n as number) >= WORLD_GRID_MIN && (n as number) <= WORLD_GRID_MAX
export function emptyPublicV25ExcavationLedger(): PublicV25ExcavationLedger {
  return { columns: [], bag: { soil: 0, stone: 0, iron_ore: 0, gold_ore: 0, diamond: 0 } }
}
export function decodePublicV25ExcavationLedger(value: unknown): PublicV25ExcavationLedger | null {
  try {
    if (!exactPublicV23(value, ['columns', 'bag']) || !Array.isArray(value.columns)
      || Object.getPrototypeOf(value.columns) !== Array.prototype || value.columns.length > 256
      || Reflect.ownKeys(value.columns).length !== value.columns.length + 1
      || !exactPublicV23(value.bag, materials)) return null
    const columns: { gx: number; gz: number; depth: number }[] = []
    for (let i = 0; i < value.columns.length; i += 1) {
      const field = Object.getOwnPropertyDescriptor(value.columns, String(i))
      const row: unknown = field?.value
      if (!field?.enumerable || !Object.hasOwn(field, 'value')
        || !exactPublicV23(row, ['gx', 'gz', 'depth'])
        || !validGrid(row.gx) || !validGrid(row.gz)
        || !Number.isSafeInteger(row.depth) || (row.depth as number) < 1
        || (row.depth as number) > PUBLIC_V25_BEDROCK_LAYER) return null
      const previous = columns.at(-1)
      if (previous && (row.gx as number) < previous.gx
        || previous && row.gx === previous.gx && (row.gz as number) <= previous.gz) return null
      columns.push({ gx: row.gx, gz: row.gz, depth: row.depth as number })
    }
    const bag = {} as Record<DigMaterial, number>
    let total = 0
    for (const material of materials) {
      const count = value.bag[material]
      if (!Number.isSafeInteger(count) || (count as number) < 0) return null
      total += count as number
      if (total > 256) return null
      bag[material] = count as number
    }
    structuredClone(value) // A proxy anywhere in the supplied tree is not a save value.
    return { columns, bag }
  } catch { return null }
}
export function digPublicV25Column(ledger: unknown, request: Readonly<{
  seed: string; gx: number; gz: number; tool: 'spade' | 'pick' | 'enchanted_pick' | null
  excavationLevel: number; backpackCapacity: number; legacyCarriedCount: number
  reservedCount: number; reachable: boolean; revealed: boolean
}>): { ok: true; ledger: PublicV25ExcavationLedger; material: DigMaterial; layer: number }
  | { ok: false; reason: string } {
  const current = decodePublicV25ExcavationLedger(ledger)
  if (!current) return { ok: false, reason: 'invalid-ledger' }
  try {
    const { seed, gx, gz, tool, excavationLevel, backpackCapacity,
      legacyCarriedCount, reservedCount, reachable, revealed } = request
    if (typeof seed !== 'string' || !seed || seed.length > 128 || !validGrid(gx) || !validGrid(gz)
      || !Number.isSafeInteger(excavationLevel) || excavationLevel < 0
      || !Number.isSafeInteger(backpackCapacity) || backpackCapacity < 0
      || !Number.isSafeInteger(legacyCarriedCount) || legacyCarriedCount < 0
      || !Number.isSafeInteger(reservedCount) || reservedCount < 0
      || ![null, ...Object.keys(tiers)].includes(tool)
      || typeof reachable !== 'boolean' || typeof revealed !== 'boolean') {
      return { ok: false, reason: 'invalid-request' }
    }
    if (!revealed) return { ok: false, reason: 'unrevealed' }
    if (!reachable) return { ok: false, reason: 'unreachable' }
    if (publicV25RiverCellAtGrid(seed, gx, gz)) return { ok: false, reason: 'wet' }
    const index = current.columns.findIndex((column) => column.gx === gx && column.gz === gz)
    const layer = index < 0 ? 0 : current.columns[index].depth
    if (layer >= PUBLIC_V25_BEDROCK_LAYER) return { ok: false, reason: 'bedrock' }
    if (index < 0 && current.columns.length >= 256) return { ok: false, reason: 'columns-full' }
    const stratum = publicV25StratumAt(seed, gx, gz, layer)
    if (stratum.material === 'bedrock') return { ok: false, reason: 'bedrock' }
    if (!tool || tiers[tool] < tiers[stratum.toolTier as keyof typeof tiers]) {
      return { ok: false, reason: 'tool' }
    }
    if (excavationLevel < stratum.minimumExcavationLevel) return { ok: false, reason: 'skill' }
    const bagCount = materials.reduce((sum, material) => sum + current.bag[material], 0)
    if (bagCount >= 256) return { ok: false, reason: 'bag-full' }
    const carried = legacyCarriedCount + reservedCount + bagCount
    if (carried >= backpackCapacity) return { ok: false, reason: 'capacity' }
    const columns = current.columns.map((column) => ({ ...column }))
    if (index < 0) columns.push({ gx, gz, depth: 1 })
    else columns[index].depth += 1
    columns.sort((a, b) => a.gx - b.gx || a.gz - b.gz)
    return { ok: true, ledger: { columns, bag: { ...current.bag,
      [stratum.material]: current.bag[stratum.material] + 1 } }, material: stratum.material, layer }
  } catch { return { ok: false, reason: 'invalid-request' } }
}
