import { publicV25StratumAt, type PublicV25Material } from './publicWorldV25Strata'
import { decodePublicV26TerrainLedger } from './publicWorldV26TerrainLedger'

type Material = Exclude<PublicV25Material, 'bedrock'>
const materials = ['soil', 'stone', 'iron_ore', 'gold_ore', 'diamond'] as const
const key = (gx: number, gz: number) => `${gx},${gz}`

/** Structural bound only. A three-slot save cannot authenticate a wholly forged history. */
export function publicV26TerrainConserved(genesisTerrain: unknown, candidateTerrain: unknown,
  seed: unknown): boolean {
  try {
    if (typeof seed !== 'string' || !seed || seed.length > 128) return false
    const genesis = decodePublicV26TerrainLedger(genesisTerrain)
    const candidate = decodePublicV26TerrainLedger(candidateTerrain)
    if (!genesis || !candidate) return false
    const prior = new Map(genesis.columns.map((column) => [key(column.gx, column.gz), column]))
    const allowed: Record<Material, number> = { ...genesis.bag }
    for (const column of genesis.columns) if (column.gx === 0 && column.gz === 0) return false
    for (const column of candidate.columns) {
      if (column.gx === 0 && column.gz === 0) return false
      const id = key(column.gx, column.gz)
      const baseline = prior.get(id)
      if (column.rewardDepth < (baseline?.rewardDepth ?? 0)) return false
      for (let layer = baseline?.rewardDepth ?? 0; layer < column.rewardDepth; layer += 1) {
        const material = publicV25StratumAt(seed, column.gx, column.gz, layer).material
        if (material === 'bedrock') return false
        allowed[material] += 1
      }
      prior.delete(id)
    }
    return prior.size === 0 && materials.every((material) => candidate.bag[material] <= allowed[material])
  } catch { return false }
}
