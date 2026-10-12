import { discoveryMaskHasTileId } from './discoveryMask'
import type { PublicTerrainWorkEvent, PublicTerrainWorkPreview,
  PublicTerrainWorkRejection } from './publicTerrainWorkAction'
import type { PublicV14State } from './publicWorldV14Snapshot'
import { resolvePublicV14Surface } from './publicWorldV14Terrain'
import { validatePublicV14State } from './publicWorldV14Validation'
import { appendTerrainWorkLedger } from './terrainWorkLedger'
import type { TerrainWorkLedger } from './terrainWorkLedger'
import { resolveTerrainWorkSite } from './terrainWorks'
import type { TerrainWorkSite } from './terrainWorks'

export type PublicV14TerrainWorkResult =
  | Readonly<{ candidate: PublicV14State; event: PublicTerrainWorkEvent; rejection?: never }>
  | Readonly<{ candidate?: never; event?: never; rejection: PublicTerrainWorkRejection }>

type Eligible = Readonly<{ state: PublicV14State; site: TerrainWorkSite;
  ledger: TerrainWorkLedger }>
type Check = { eligible: Eligible; site: TerrainWorkSite; rejection: null }
  | { eligible: null; site: TerrainWorkSite | null; rejection: PublicTerrainWorkRejection }
const XP = { bridge: 80, ladder: 60, dig: 30 } as const
const REACH_METERS = 3
const contextFor = (state: PublicV14State) => ({ seed: state.seed,
  fieldCampTileIds: state.fieldCampTileIds,
  authoredBuiltRouteIds: [state.mireglass.builtRoutes.bridge,
    state.mireglass.builtRoutes.ladder].filter((id): id is string => id !== null) })
const itemCount = (state: PublicV14State, id: 'logs' | 'field_spade') =>
  state.player.inventory.filter((stack) => stack.itemId === id)
    .reduce((count, stack) => count + stack.quantity, 0)
const usedCapacity = (state: PublicV14State) =>
  state.player.inventory.reduce((count, stack) => count + stack.quantity, 0)
  + state.player.tradeSlots.reduce((count, slot) => count + slot.quantity, 0)

/** Previews are advisory. Confirmation reruns every check on a freshly owned v14 state. */
function check(raw: PublicV14State, id: unknown): Check {
  const reject = (rejection: PublicTerrainWorkRejection,
    site: TerrainWorkSite | null = null): Check => ({ eligible: null, site, rejection })
  let state: PublicV14State | null
  try { state = validatePublicV14State(raw, raw?.seed) } catch { state = null }
  if (!state) return reject('invalid_progress')
  if (state.movementOwner !== 'streamed') return reject('unavailable_here')
  if (typeof id !== 'string') return reject('invalid_site')
  const site = resolveTerrainWorkSite(state.seed, id)
  if (!site) return reject('invalid_site')
  const seen = site.kind === 'dig' ? site.footprintTileIds[0] : site.footprintTileIds[1]
  if (!discoveryMaskHasTileId(state.discoveryMask, seen)) return reject('undiscovered')
  const target = site.kind === 'dig' ? site.center : site.from
  const position = state.player.position
  if (Math.hypot(position.x - target.x, position.y - target.y,
    position.z - target.z) > REACH_METERS) return reject('too_far', site)
  if (state.terrainWorks.builtWorkIds.includes(id)
    || state.terrainWorks.dugTileIds.includes(id)) return reject('already_done', site)
  if (site.kind === 'dig'
    && resolvePublicV14Surface(state, position)?.tileId === site.footprintTileIds[0]) {
    return reject('occupied', site)
  }
  if (site.kind === 'dig' ? state.terrainWorks.dugTileIds.length >= 64
    : state.terrainWorks.builtWorkIds.length >= 32) return reject('limit_reached', site)
  const ledger = appendTerrainWorkLedger(state.terrainWorks, id, contextFor(state))
  if (!ledger) return reject('occupied', site)
  if (site.kind === 'dig') {
    if (state.player.equipment.mainHand !== 'field_spade'
      || itemCount(state, 'field_spade') < 1) return reject('requires_spade', site)
    if (usedCapacity(state) + 1 > state.player.backpackCapacity) return reject('capacity', site)
  } else if (itemCount(state, 'logs') < site.logCost) return reject('not_owned', site)
  const xp = XP[site.kind]
  const skill = site.kind === 'dig' ? 'excavation' : 'construction'
  const stone = state.player.inventory.find((stack) => stack.itemId === 'stone')
  if (![state.eventSequence + 1, state.player.xp + xp,
    state.player.skillXp[skill] + xp,
    (stone?.quantity ?? 0) + Number(site.kind === 'dig')].every(Number.isSafeInteger)) {
    return reject('invalid_value', site)
  }
  return { eligible: { state, site, ledger }, site, rejection: null }
}

export function previewPublicV14TerrainWork(state: PublicV14State,
  id: unknown): PublicTerrainWorkPreview {
  const result = check(state, id)
  return { site: result.site, rejection: result.rejection }
}

/** Pure candidate for a future checked under-lock v14 writer; no revision or storage mutation. */
export function confirmPublicV14TerrainWork(state: PublicV14State,
  id: unknown): PublicV14TerrainWorkResult {
  const result = check(state, id)
  if (!result.eligible) return { rejection: result.rejection }
  const { state: owned, site, ledger } = result.eligible
  const player = owned.player
  const xp = XP[site.kind]
  let logsSpent = 0, stoneGained = 0
  if (site.kind === 'dig') {
    const stone = player.inventory.find((stack) => stack.itemId === 'stone')
    if (stone) stone.quantity++
    else player.inventory.push({ itemId: 'stone', quantity: 1 })
    player.skillXp.excavation += xp
    stoneGained = 1
  } else {
    logsSpent = site.logCost
    let remaining = logsSpent
    for (const stack of player.inventory) {
      if (stack.itemId !== 'logs') continue
      const spent = Math.min(remaining, stack.quantity)
      stack.quantity -= spent
      remaining -= spent
    }
    player.inventory = player.inventory.filter((stack) => stack.quantity > 0)
    player.skillXp.construction += xp
  }
  player.xp += xp
  player.level = 1 + Math.floor(player.xp / 100)
  const candidate = validatePublicV14State({ ...owned,
    terrainWorks: ledger, eventSequence: owned.eventSequence + 1 }, owned.seed)
  if (!candidate) return { rejection: 'invalid_progress' }
  return { candidate, event: { type: site.kind === 'dig' ? 'terrain_work_dug' : 'terrain_work_built',
    id: site.id, tick: state.tick, sequence: candidate.eventSequence,
    logsSpent, stoneGained, xp } }
}
