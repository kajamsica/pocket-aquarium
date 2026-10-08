import type { ReadonlyWorldTile } from './activeWorldTerrain'
import { mireglassAnchors, mireglassFairyRing, mireglassResources } from './mireglassContent'
import { mireglassHerbPatches } from './mireglassHerbPatches'
import { mireglassRouteSites } from './mireglassRouteSites'
import { MIREGLASS_CORE } from './mireglassTerrain'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { isValidPublicWorldV9State } from './publicWorldV9State'
import type { PublicWorldV9State } from './publicWorldV9State'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

export type FieldCampSite = Readonly<{
  tileId: string; gridX: number; gridZ: number; tile: ReadonlyWorldTile
}>
export type FieldCampPlaced = Readonly<{
  type: 'field_camp_placed'; tileId: string; logsSpent: 4; stoneSpent: 1; xp: 30
}>
export type FieldCampActionResult =
  | { state: PublicWorldV9State; event: FieldCampPlaced & { readonly sequence: number }; rejection?: never }
  | { state: PublicWorldV9State; event?: never; rejection: {
    code: 'invalid_progress' | 'invalid_value' | 'unavailable_here' | 'invalid_site'
      | 'site_hidden' | 'too_far' | 'not_owned' | 'already_built'; message: string
  } }

/** Resolves an ID to canonical terrain, never to the atlas's legacy grid offset. */
export function resolveFieldCampSite(seed: string, tileId: string): FieldCampSite | null {
  if (typeof seed !== 'string' || !seed || typeof tileId !== 'string') return null
  const match = /^tile-(-?\d+)-(-?\d+)$/.exec(tileId)
  if (!match) return null
  const gridX = Number(match[1]) - 3
  const gridZ = Number(match[2]) - 3
  if (!Number.isSafeInteger(gridX) || !Number.isSafeInteger(gridZ)
    || tileId !== `tile-${gridX + 3}-${gridZ + 3}`) return null
  const x = gridX * WORLD_CELL_METERS
  const z = gridZ * WORLD_CELL_METERS
  const cell = WORLD_CELL_METERS
  // A complete dry footprint must fit inside the authored core.
  if (x - cell < MIREGLASS_CORE.minX || x + cell >= MIREGLASS_CORE.maxX
    || z - cell < MIREGLASS_CORE.minZ || z + cell >= MIREGLASS_CORE.maxZ) return null
  try {
    const tile = worldTileAtGrid(seed, gridX, gridZ)
    const heights: number[] = []
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const support = worldTileAtGrid(seed, gridX + dx, gridZ + dz)
        if (support.terrain !== 'loam') return null
        heights.push(support.center.y)
      }
    }
    if (Math.max(...heights) - Math.min(...heights) > 0.9) return null
    const occupied = [
      ...Object.values(mireglassAnchors(seed)).map(({ tile }) => tile.center),
      ...mireglassResources(seed).map(({ tile }) => tile.center),
      ...mireglassHerbPatches(seed).map(({ tile }) => tile.center),
      mireglassFairyRing(seed).tile.center,
    ]
    if (occupied.some((point) => Math.hypot(x - point.x, z - point.z) < cell)) return null
    for (const route of mireglassRouteSites(seed)) {
      const minZ = Math.min(route.from.z, route.to.z) - cell
      const maxZ = Math.max(route.from.z, route.to.z) + cell
      if (Math.hypot(x - route.from.x, z - Math.max(minZ, Math.min(maxZ, z))) < cell) return null
    }
    return Object.freeze({ tileId, gridX, gridZ,
      tile: Object.freeze({ ...tile, center: Object.freeze({ ...tile.center }) }) })
  } catch { return null }
}

/** Placement consumes one event sequence, without advancing movement, time, or RNG. */
export function applyFieldCampAction(state: PublicWorldV9State, tileId: string,
  bootstrap: PublicV6BootstrapRoot | null = null): FieldCampActionResult {
  const reject = (code: NonNullable<FieldCampActionResult['rejection']>['code'], message: string): FieldCampActionResult =>
    ({ state, rejection: { code, message } })
  if (!isValidPublicWorldV9State(state, bootstrap)) return reject('invalid_progress', 'The camp world state is invalid.')
  if (state.movementOwner !== 'streamed') return reject('unavailable_here', 'Build a camp while exploring Mireglass.')
  if (!Number.isSafeInteger(state.eventSequence + 1)) return reject('invalid_value', 'The event sequence is exhausted.')
  if (state.fieldCampTileIds.length) return reject('already_built', 'This world already has a field camp.')
  const site = resolveFieldCampSite(state.seed, tileId)
  if (!site) return reject('invalid_site', 'Camp needs a flat, clear 3×3 loam patch in inner Mireglass. Follow the frontier trail toward the salvager; the map marks suitable discovered cells.')
  if (!state.discoveredTileIds.includes(tileId)) return reject('site_hidden', 'Discover this camp site first.')
  const { position } = state.player
  if (Math.hypot(position.x - site.tile.center.x, position.y - site.tile.center.y,
    position.z - site.tile.center.z) > 3) return reject('too_far', 'The camp site is out of reach.')
  const count = (itemId: 'logs' | 'stone') => state.player.inventory
    .filter((stack) => stack.itemId === itemId).reduce((sum, stack) => sum + stack.quantity, 0)
  if (count('logs') < 4 || count('stone') < 1) return reject('not_owned', 'A camp needs 4 logs and 1 stone.')
  if (!Number.isSafeInteger(state.player.xp + 30)
    || !Number.isSafeInteger(state.player.skillXp.construction + 30)) {
    return reject('invalid_value', 'Construction experience exceeds safe limits.')
  }
  const player = structuredClone(state.player)
  for (const [itemId, cost] of [['logs', 4], ['stone', 1]] as const) {
    let remaining = cost as number
    for (const stack of player.inventory) {
      if (stack.itemId !== itemId) continue
      const spent = Math.min(remaining, stack.quantity)
      stack.quantity -= spent
      remaining -= spent
    }
  }
  player.inventory = player.inventory.filter((stack) => stack.quantity > 0)
  player.xp += 30
  player.level = 1 + Math.floor(player.xp / 100)
  player.skillXp.construction += 30
  const sequence = state.eventSequence + 1
  return { state: { ...state, player, fieldCampTileIds: [tileId], eventSequence: sequence },
    event: { type: 'field_camp_placed', tileId, logsSpent: 4, stoneSpent: 1, xp: 30, sequence } }
}
