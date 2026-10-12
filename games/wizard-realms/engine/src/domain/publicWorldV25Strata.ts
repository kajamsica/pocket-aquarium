import { hashSeed } from './generation'
import { WORLD_GRID_MAX, WORLD_GRID_MIN, worldTileAtGrid } from './worldChunks'

export const PUBLIC_V25_BEDROCK_LAYER = 12

export type PublicV25Material = 'soil' | 'stone' | 'iron_ore' | 'gold_ore' | 'diamond' | 'bedrock'
export type PublicV25ToolTier = 'spade' | 'pick' | 'enchanted_pick' | 'none'
export interface PublicV25Stratum {
  material: PublicV25Material
  toolTier: PublicV25ToolTier
  minimumExcavationLevel: number
}

const facts: Record<PublicV25Material, PublicV25Stratum> = {
  soil: { material: 'soil', toolTier: 'spade', minimumExcavationLevel: 1 },
  stone: { material: 'stone', toolTier: 'pick', minimumExcavationLevel: 2 },
  iron_ore: { material: 'iron_ore', toolTier: 'pick', minimumExcavationLevel: 5 },
  gold_ore: { material: 'gold_ore', toolTier: 'pick', minimumExcavationLevel: 12 },
  diamond: { material: 'diamond', toolTier: 'enchanted_pick', minimumExcavationLevel: 25 },
  bedrock: { material: 'bedrock', toolTier: 'none', minimumExcavationLevel: 0 },
}

export function publicV25StratumAt(seed: string, gx: number, gz: number, layer: number): PublicV25Stratum {
  if (typeof seed !== 'string' || seed.length < 1 || seed.length > 128
    || !Number.isSafeInteger(gx) || gx < WORLD_GRID_MIN || gx > WORLD_GRID_MAX
    || !Number.isSafeInteger(gz) || gz < WORLD_GRID_MIN || gz > WORLD_GRID_MAX
    || !Number.isSafeInteger(layer) || layer < 0 || layer > PUBLIC_V25_BEDROCK_LAYER) {
    throw new RangeError('V25 stratum requires a nonempty seed, in-range grid coordinates, and layer 0 through 12.')
  }
  if (layer === PUBLIC_V25_BEDROCK_LAYER) return { ...facts.bedrock }
  if (layer <= 1) {
    const terrain = worldTileAtGrid(seed, gx, gz).terrain
    return { ...(terrain === 'loam' || terrain === 'wetland' ? facts.soil : facts.stone) }
  }
  const roll = hashSeed(`${seed}:v25:stratum:${gx}:${gz}:${layer}`) % 4096
  const material: PublicV25Material = layer >= 8 && roll < 8 ? 'diamond'
    : layer >= 5 && roll < 64 ? 'gold_ore'
      : layer >= 3 && roll < 512 ? 'iron_ore'
        : 'stone'
  return { ...facts[material] }
}
