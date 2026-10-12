import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { discoveryMaskHasTileId } from './discoveryMask'
import { isValidPublicWorldV12State } from './publicWorldV12State'
import type { PublicWorldV12State } from './publicWorldV12State'
import { decodePublicV13HeadWithSource } from './publicWorldV13Snapshot'
import type { PublicV13Head } from './publicWorldV13Snapshot'
import type { PublicV13SourceLease } from './publicWorldV13SourceReader'
import { appendTerrainWorkLedger, isValidTerrainWorkLedger } from './terrainWorkLedger'
import type { TerrainWorkLedger, TerrainWorkLedgerContext } from './terrainWorkLedger'
import { resolveTerrainWorkSite } from './terrainWorks'
import type { TerrainWorkSite } from './terrainWorks'

export type PublicTerrainWorkRejection = 'invalid_progress' | 'invalid_ledger' | 'unavailable_here'
  | 'invalid_site' | 'undiscovered' | 'too_far' | 'already_done' | 'occupied'
  | 'limit_reached' | 'not_owned' | 'requires_spade' | 'capacity' | 'invalid_value'
export type PublicTerrainWorkPreview = Readonly<{
  site: TerrainWorkSite | null; rejection: PublicTerrainWorkRejection | null
}>
export type PublicTerrainWorkEvent = Readonly<{
  type: 'terrain_work_built' | 'terrain_work_dug'; id: string; tick: number; sequence: number
  logsSpent: number; stoneGained: number; xp: number
}>
export type PublicTerrainWorkResult = Readonly<{
  state: PublicWorldV12State; ledger: TerrainWorkLedger
  event?: PublicTerrainWorkEvent; rejection?: PublicTerrainWorkRejection
}>
export type CompactPublicTerrainWorkResult =
  | Readonly<{ head: PublicV13Head; event: PublicTerrainWorkEvent; rejection?: never }>
  | Readonly<{ head?: never; event?: never; rejection: PublicTerrainWorkRejection }>

const XP = { bridge: 80, ladder: 60, dig: 30 } as const
const REACH_METERS = 3
type ActionState = PublicWorldV12State | PublicV13Head['state']
const contextFor = (state: ActionState): TerrainWorkLedgerContext => ({
  seed: state.seed, fieldCampTileIds: state.fieldCampTileIds,
  authoredBuiltRouteIds: [state.mireglass.builtRoutes.bridge, state.mireglass.builtRoutes.ladder]
    .filter((id): id is string => id !== null),
})
const itemCount = (state: ActionState, itemId: 'logs' | 'field_spade') =>
  state.player.inventory.filter((stack) => stack.itemId === itemId)
    .reduce((sum, stack) => sum + stack.quantity, 0)
const usedCapacity = (state: ActionState) =>
  state.player.inventory.reduce((sum, stack) => sum + stack.quantity, 0)
  + state.player.tradeSlots.reduce((sum, slot) => sum + slot.quantity, 0)

type Checked<T extends ActionState> = { site: TerrainWorkSite; state: T
  ledger: TerrainWorkLedger; rejection: null }
  | { site: TerrainWorkSite | null; state: null; ledger: null
    rejection: PublicTerrainWorkRejection }
function checkedOwned<T extends ActionState>(ownedState: T, ledger: TerrainWorkLedger,
  id: unknown, discovered: (tileId: string) => boolean): Checked<T> {
  const reject = (rejection: PublicTerrainWorkRejection,
    site: TerrainWorkSite | null = null): Checked<T> => ({ site, state: null, ledger: null, rejection })
  const context = contextFor(ownedState)
  if (!isValidTerrainWorkLedger(ledger, context)) return reject('invalid_ledger')
  let ownedLedger: TerrainWorkLedger
  try { ownedLedger = structuredClone(ledger) } catch { return reject('invalid_ledger') }
  if (!isValidTerrainWorkLedger(ownedLedger, context)) return reject('invalid_ledger')
  if (ownedState.movementOwner !== 'streamed') return reject('unavailable_here')
  if (typeof id !== 'string') return reject('invalid_site')
  const site = resolveTerrainWorkSite(ownedState.seed, id)
  if (!site) return reject('invalid_site')
  const discoveryId = site.kind === 'dig' ? site.footprintTileIds[0] : site.footprintTileIds[1]
  if (!discovered(discoveryId)) return reject('undiscovered')
  const target = site.kind === 'dig' ? site.center : site.from
  if (Math.hypot(ownedState.player.position.x - target.x, ownedState.player.position.y - target.y,
    ownedState.player.position.z - target.z) > REACH_METERS) return reject('too_far', site)
  if (ownedLedger.builtWorkIds.includes(id) || ownedLedger.dugTileIds.includes(id)) return reject('already_done', site)
  if (site.kind === 'dig' ? ownedLedger.dugTileIds.length >= 64 : ownedLedger.builtWorkIds.length >= 32) {
    return reject('limit_reached', site)
  }
  const nextLedger = appendTerrainWorkLedger(ownedLedger, id, context)
  if (!nextLedger) return reject('occupied', site)
  if (site.kind === 'dig') {
    if (ownedState.player.equipment.mainHand !== 'field_spade' || itemCount(ownedState, 'field_spade') < 1) {
      return reject('requires_spade', site)
    }
    if (usedCapacity(ownedState) + 1 > ownedState.player.backpackCapacity) return reject('capacity', site)
  } else if (itemCount(ownedState, 'logs') < site.logCost) return reject('not_owned', site)
  const xp = XP[site.kind]
  const skill = site.kind === 'dig' ? 'excavation' : 'construction'
  const stone = ownedState.player.inventory.find((stack) => stack.itemId === 'stone')
  if (![ownedState.eventSequence + 1, ownedState.player.xp + xp, ownedState.player.skillXp[skill] + xp,
    (stone?.quantity ?? 0) + Number(site.kind === 'dig')].every(Number.isSafeInteger)) {
    return reject('invalid_value', site)
  }
  return { site, state: ownedState, ledger: nextLedger, rejection: null }
}

function checked(state: PublicWorldV12State, ledger: TerrainWorkLedger,
  bootstrap: PublicV6BootstrapRoot | null, id: unknown): Checked<PublicWorldV12State> {
  let ownedState: PublicWorldV12State
  try { ownedState = structuredClone(state) } catch {
    return { site: null, state: null, ledger: null, rejection: 'invalid_progress' }
  }
  let sourceValid: boolean
  try { sourceValid = isValidPublicWorldV12State(state, bootstrap) } catch {
    return { site: null, state: null, ledger: null, rejection: 'invalid_progress' }
  }
  if (!sourceValid || !isValidPublicWorldV12State(ownedState, bootstrap)) {
    return { site: null, state: null, ledger: null, rejection: 'invalid_progress' }
  }
  return checkedOwned(ownedState, ledger, id,
    (tileId) => ownedState.discoveredTileIds.includes(tileId))
}

function applyWork<T extends ActionState>(state: T, ledger: TerrainWorkLedger,
  site: TerrainWorkSite): { state: T; ledger: TerrainWorkLedger; event: PublicTerrainWorkEvent } {
  const xp = XP[site.kind]
  const player = state.player
  let logsSpent = 0, stoneGained = 0
  if (site.kind === 'dig') {
    const stack = player.inventory.find((entry) => entry.itemId === 'stone')
    if (stack) stack.quantity += 1
    else player.inventory.push({ itemId: 'stone', quantity: 1 })
    stoneGained = 1
    player.skillXp.excavation += xp
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
  const next = { ...state, eventSequence: state.eventSequence + 1 } as T
  return { state: next, ledger,
    event: { type: site.kind === 'dig' ? 'terrain_work_dug' : 'terrain_work_built',
      id: site.id, tick: state.tick, sequence: next.eventSequence, logsSpent, stoneGained, xp } }
}

/** Recomputes eligibility from the current validated public state, never from a preview token. */
export function previewPublicTerrainWork(state: PublicWorldV12State, ledger: TerrainWorkLedger,
  bootstrap: PublicV6BootstrapRoot | null, id: unknown): PublicTerrainWorkPreview {
  const result = checked(state, ledger, bootstrap, id)
  return { site: result.site, rejection: result.rejection }
}

/** Advisory only for an already checked compact state; confirmation still decodes under lock. */
export function previewCheckedCompactPublicTerrainWork(state: PublicV13Head['state'],
  id: string): PublicTerrainWorkPreview {
  const result = checkedOwned(state, state.terrainWorks, id,
    (tileId) => discoveryMaskHasTileId(state.discoveryMask, tileId))
  return { site: result.site, rejection: result.rejection }
}

/** Unmounted pure action. The future v13 writer owns storage, collision and pose validation. */
export function confirmPublicTerrainWork(state: PublicWorldV12State, ledger: TerrainWorkLedger,
  bootstrap: PublicV6BootstrapRoot | null, id: unknown): PublicTerrainWorkResult {
  const result = checked(state, ledger, bootstrap, id)
  if (result.rejection || !result.site || !result.state || !result.ledger) {
    return { state, ledger, rejection: result.rejection ?? 'invalid_site' }
  }
  const next = applyWork(result.state, result.ledger, result.site)
  if (!isValidPublicWorldV12State(next.state, bootstrap)) {
    return { state, ledger, rejection: 'invalid_progress' }
  }
  return next
}

/** Pure candidate only. The future under-lock writer must recheck the head and lease. */
export function confirmCompactPublicTerrainWork(head: unknown, lease: PublicV13SourceLease,
  id: unknown): CompactPublicTerrainWorkResult {
  const owned = decodePublicV13HeadWithSource(head, lease)
  if (!owned) return { rejection: 'invalid_progress' }
  const checked = checkedOwned(owned.state, owned.state.terrainWorks, id,
    (tileId) => discoveryMaskHasTileId(owned.state.discoveryMask, tileId))
  if (checked.rejection || !checked.site || !checked.state || !checked.ledger) {
    return { rejection: checked.rejection ?? 'invalid_site' }
  }
  if (!Number.isSafeInteger(owned.saveRevision + 1)) return { rejection: 'invalid_value' }
  const next = applyWork(checked.state, checked.ledger, checked.site)
  const candidate = decodePublicV13HeadWithSource({ ...owned,
    saveRevision: owned.saveRevision + 1,
    state: { ...next.state, terrainWorks: next.ledger } }, lease)
  return candidate ? { head: candidate, event: next.event } : { rejection: 'invalid_progress' }
}
