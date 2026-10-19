import { mireglassRouteSites } from './mireglassRouteSites'
import { parseTerrainWorkId, resolveTerrainWorkSite } from './terrainWorks'
import type { TerrainWorkSite } from './terrainWorks'
import type { Vec3 } from './types'
import { WORLD_CELL_METERS } from './worldChunks'

/** Ephemeral preview only. The runtime owns this state; a player intent supplies only a work ID. */
export type TerrainWorkTrialState = Readonly<{
  builtWorkIds: readonly string[]; dugTileIds: readonly string[]
  kit: Readonly<{ logs: number; stone: number; capacity: 16; spadeOwned: boolean
    spadeEquipped: boolean; xp: number; constructionXp: number; excavationXp: number }>
}>
export type TerrainWorkTrialAuthority = Readonly<{
  seed: string; position: Readonly<Vec3>; discoveredTileIds: readonly string[]
  fieldCampTileIds: readonly string[]; authoredBuiltRouteIds: readonly string[]
}>
export type TerrainWorkTrialRejection = 'invalid_state' | 'invalid_site' | 'undiscovered'
  | 'too_far' | 'occupied' | 'already_done' | 'insufficient_logs'
  | 'requires_spade' | 'capacity' | 'limit_reached' | 'invalid_value'
export type TerrainWorkTrialPreview = Readonly<{
  site: TerrainWorkSite | null; rejection: TerrainWorkTrialRejection | null
}>
export type TerrainWorkTrialResult = Readonly<{
  state: TerrainWorkTrialState; event?: Readonly<{ type: 'terrain_work_built' | 'terrain_work_dug'
    id: string; logsSpent: number; stoneGained: number; xp: number }>
  rejection?: TerrainWorkTrialRejection
}>
export type BuiltTerrainWorkTrialSite = Exclude<TerrainWorkSite, { kind: 'dig' }>

const MAX_STRUCTURES = 32
const MAX_DIGS = 64
const REACH_METERS = 3
// Existing Mireglass bridge, ladder and ordinary stump-dig rewards. Ordinary digging has no level gate.
const XP = { bridge: 80, ladder: 60, dig: 30 } as const
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const sortedUnique = (ids: readonly string[]) => ids.every((id, index) =>
  typeof id === 'string' && (index === 0 || ids[index - 1] < id))
const tileId = (gx: number, gz: number) => `tile-${gx + 3}-${gz + 3}`
const freezeTrialState = (state: TerrainWorkTrialState): TerrainWorkTrialState => Object.freeze({
  builtWorkIds: Object.freeze([...state.builtWorkIds]), dugTileIds: Object.freeze([...state.dugTileIds]),
  kit: Object.freeze({ ...state.kit }),
})

export function createTerrainWorkTrialState(): TerrainWorkTrialState {
  return freezeTrialState({ builtWorkIds: [], dugTileIds: [], kit: { logs: 12, stone: 0, capacity: 16,
    spadeOwned: true, spadeEquipped: true, xp: 0, constructionXp: 0, excavationXp: 0 } })
}

/** Resolve once per ledger revision for scene/collision consumers, never once per render frame. */
export function resolveBuiltTerrainWorkTrialSites(state: TerrainWorkTrialState,
  seed: string): readonly BuiltTerrainWorkTrialSite[] | null {
  if (!validState(state) || typeof seed !== 'string') return null
  const sites = state.builtWorkIds.map((id) => resolveTerrainWorkSite(seed, id))
  return sites.every((site) => site && site.kind !== 'dig') ? sites as BuiltTerrainWorkTrialSite[] : null
}

function validState(state: TerrainWorkTrialState): boolean {
  if (!state || !Array.isArray(state.builtWorkIds) || !Array.isArray(state.dugTileIds)
    || state.builtWorkIds.length > MAX_STRUCTURES || state.dugTileIds.length > MAX_DIGS
    || !sortedUnique(state.builtWorkIds) || !sortedUnique(state.dugTileIds) || !state.kit) return false
  const kit = state.kit
  return kit.capacity === 16 && typeof kit.spadeOwned === 'boolean'
    && typeof kit.spadeEquipped === 'boolean' && (!kit.spadeEquipped || kit.spadeOwned)
    && [kit.logs, kit.stone, kit.xp, kit.constructionXp, kit.excavationXp].every(integer)
    && kit.logs + kit.stone + Number(kit.spadeOwned) <= kit.capacity
    && kit.xp === kit.constructionXp + kit.excavationXp
    && state.builtWorkIds.every((id) => {
      const parsed = parseTerrainWorkId(id)
      return parsed?.kind === 'bridge' || parsed?.kind === 'ladder'
    }) && state.dugTileIds.every((id) => parseTerrainWorkId(id)?.kind === 'dig')
}

function validAuthority(authority: TerrainWorkTrialAuthority): boolean {
  return !!authority && typeof authority.seed === 'string' && !!authority.position
    && [authority.position.x, authority.position.y, authority.position.z].every(Number.isFinite)
    && [authority.discoveredTileIds, authority.fieldCampTileIds,
      authority.authoredBuiltRouteIds].every((ids) => Array.isArray(ids)
        && ids.every((id) => typeof id === 'string'))
}

/** Shared canonical occupancy for trial actions and the later sparse save ledger. */
export function occupiedTerrainWorkTiles(
  state: Pick<TerrainWorkTrialState, 'builtWorkIds' | 'dugTileIds'>,
  authority: Pick<TerrainWorkTrialAuthority, 'seed' | 'fieldCampTileIds' | 'authoredBuiltRouteIds'>,
): Set<string> | null {
  const occupied = new Set<string>()
  for (const id of [...state.builtWorkIds, ...state.dugTileIds]) {
    const site = resolveTerrainWorkSite(authority.seed, id)
    if (!site) return null
    site.footprintTileIds.forEach((footprint) => occupied.add(footprint))
  }
  for (const id of authority.fieldCampTileIds) {
    const camp = parseTerrainWorkId(id)
    if (camp?.kind !== 'dig') return null
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      occupied.add(tileId(camp.gx + dx, camp.gz + dz))
    }
  }
  // Only constructed legacy routes occupy space. Unbuilt markers remain choices.
  const routes = mireglassRouteSites(authority.seed)
  for (const id of authority.authoredBuiltRouteIds) {
    const route = routes.find((candidate) => candidate.id === id)
    if (!route) return null
    const fromGX = route.from.x / WORLD_CELL_METERS, fromGZ = route.from.z / WORLD_CELL_METERS
    const toGX = route.to.x / WORLD_CELL_METERS, toGZ = route.to.z / WORLD_CELL_METERS
    const steps = Math.max(Math.abs(toGX - fromGX), Math.abs(toGZ - fromGZ))
    // Reserve both dry approach cells too, not only the crossing centerline.
    for (let step = -1; step <= steps + 1; step++) {
      occupied.add(tileId(fromGX + Math.sign(toGX - fromGX) * step,
        fromGZ + Math.sign(toGZ - fromGZ) * step))
    }
  }
  return occupied
}

/** Recompute every check on confirm; preview is never an authorization token. */
export function previewTerrainWorkTrial(state: TerrainWorkTrialState,
  authority: TerrainWorkTrialAuthority, id: string): TerrainWorkTrialPreview {
  if (!validState(state) || !validAuthority(authority)) return { site: null, rejection: 'invalid_state' }
  const site = resolveTerrainWorkSite(authority.seed, id)
  if (!site) return { site: null, rejection: 'invalid_site' }
  const seenFrom = site.kind === 'dig' ? site.footprintTileIds[0] : site.footprintTileIds[1]
  if (!authority.discoveredTileIds.includes(seenFrom)) return { site: null, rejection: 'undiscovered' }
  const target = site.kind === 'dig' ? site.center : site.from
  if (Math.hypot(authority.position.x - target.x, authority.position.y - target.y,
    authority.position.z - target.z) > REACH_METERS) return { site, rejection: 'too_far' }
  if (state.builtWorkIds.includes(id) || state.dugTileIds.includes(id)) return { site, rejection: 'already_done' }
  const occupied = occupiedTerrainWorkTiles(state, authority)
  if (!occupied) return { site: null, rejection: 'invalid_state' }
  if (site.footprintTileIds.some((footprint) => occupied.has(footprint))) return { site, rejection: 'occupied' }
  if (site.kind === 'dig') {
    if (state.dugTileIds.length >= MAX_DIGS) return { site, rejection: 'limit_reached' }
    if (!state.kit.spadeOwned || !state.kit.spadeEquipped) return { site, rejection: 'requires_spade' }
    if (state.kit.logs + state.kit.stone + 1 + Number(state.kit.spadeOwned) > state.kit.capacity) {
      return { site, rejection: 'capacity' }
    }
  } else {
    if (state.builtWorkIds.length >= MAX_STRUCTURES) return { site, rejection: 'limit_reached' }
    if (state.kit.logs < site.logCost) return { site, rejection: 'insufficient_logs' }
  }
  if (!Number.isSafeInteger(state.kit.xp + XP[site.kind])
    || !Number.isSafeInteger((site.kind === 'dig' ? state.kit.excavationXp
      : state.kit.constructionXp) + XP[site.kind])) return { site, rejection: 'invalid_value' }
  return { site, rejection: null }
}

export function confirmTerrainWorkTrial(state: TerrainWorkTrialState,
  authority: TerrainWorkTrialAuthority, id: string): TerrainWorkTrialResult {
  const preview = previewTerrainWorkTrial(state, authority, id)
  if (preview.rejection || !preview.site) return { state, rejection: preview.rejection ?? 'invalid_site' }
  const site = preview.site, xp = XP[site.kind]
  const builtWorkIds = site.kind === 'dig' ? state.builtWorkIds : [...state.builtWorkIds, id].sort()
  const dugTileIds = site.kind === 'dig' ? [...state.dugTileIds, id].sort() : state.dugTileIds
  const next: TerrainWorkTrialState = { builtWorkIds, dugTileIds, kit: {
    ...state.kit, logs: state.kit.logs - (site.kind === 'dig' ? 0 : site.logCost),
    stone: state.kit.stone + Number(site.kind === 'dig'), xp: state.kit.xp + xp,
    constructionXp: state.kit.constructionXp + (site.kind === 'dig' ? 0 : xp),
    excavationXp: state.kit.excavationXp + (site.kind === 'dig' ? xp : 0),
  } }
  return { state: freezeTrialState(next), event: { type: site.kind === 'dig' ? 'terrain_work_dug' : 'terrain_work_built',
    id, logsSpent: site.kind === 'dig' ? 0 : site.logCost,
    stoneGained: Number(site.kind === 'dig'), xp } }
}
