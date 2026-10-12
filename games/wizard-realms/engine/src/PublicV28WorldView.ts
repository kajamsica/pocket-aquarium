import { discoveryMaskHasTileId } from './domain/discoveryMask'
import { previewPublicV28RiverBridge } from './domain/publicWorldV28RiverBridgeAction'
import type { PublicV28BridgeRejection } from './domain/publicWorldV28RiverBridgeAction'
import { enumeratePublicV28RiverBridges, publicV28RiverBridgeId,
  resolvePublicV28RiverBridge, parsePublicV28RiverBridgeId } from './domain/publicWorldV28RiverBridgeSites'
import type { PublicV28RiverBridgeSite, PublicV28RiverBridgeWindow } from './domain/publicWorldV28RiverBridgeSites'
import { publicV25RiverCenterZ } from './domain/publicWorldV25River'
import { resolvePublicV17GreenwaySite } from './domain/publicWorldV17GreenwaySites'
import type { PublicV28Progress } from './domain/publicWorldV28Migration'
import { projectPublicV28Pose } from './domain/publicWorldV28RiverSupport'
import type { TerrainWorkSite } from './domain/terrainWorks'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './domain/worldChunks'
import type { WizardSavedTerrainWorksView, WizardViewProjection } from './view/contracts'

export type PublicV28WorkAim = Readonly<{
  kind: 'bridge' | 'ladder' | 'dig'; modeActive: boolean; actionsEnabled: boolean
  bodyYaw: number; aimX: number | null
}>

const grid = (value: number) => Math.ceil(value / WORLD_CELL_METERS - 0.5)
const clamp = (value: number) => Math.max(WORLD_GRID_MIN, Math.min(WORLD_GRID_MAX, value))
const tileAt = (x: number, z: number) =>
  `tile-${grid(x) + 3}-${grid(z) + 3}`
const localWindow = (x: number, z: number): PublicV28RiverBridgeWindow => {
  const gx = grid(x), gz = grid(z)
  return { minGX: clamp(gx - 7), maxGX: clamp(gx + 7),
    minGZ: clamp(gz - 7), maxGZ: clamp(gz + 7) }
}
let localCache: { key: string; sites: readonly PublicV28RiverBridgeSite[] } | null = null

/** One bounded 15 by 15 search per entered cell, never a render-time full-river scan. */
export function localPublicV28RiverBridgeSites(seed: string, x: number, z: number) {
  const window = localWindow(x, z)
  const key = `${seed}:${window.minGX}:${window.maxGX}:${window.minGZ}:${window.maxGZ}`
  if (localCache?.key !== key) localCache = { key,
    sites: enumeratePublicV28RiverBridges(seed, window) }
  return localCache.sites
}

/** The old Works scene contract is presentation-only; preserve the canonical deck path verbatim. */
export function displayPublicV28RiverBridge(site: PublicV28RiverBridgeSite):
  Exclude<TerrainWorkSite, { kind: 'dig' }> {
  return { id: site.id, kind: 'bridge', obstacle: 'fen_channel',
    from: site.from, to: site.to, approach: site.approach, exit: site.exit,
    supportPath: site.supportPath, footprintTileIds: site.footprintTileIds,
    widthMeters: site.widthMeters, logCost: site.logCost, rewardClass: 'construction' }
}

export function publicV28RiverBridgeReason(rejection: PublicV28BridgeRejection | null,
  site: PublicV28RiverBridgeSite): string {
  switch (rejection) {
    case null: return 'Ready: build this checked connected-river deck for 8 logs and 80 Construction XP.'
    case 'too_far': return `Stand grounded in the dry source-bank cell at x ${site.from.x}, z ${site.from.z}, within 3 m.`
    case 'not_owned': return 'Gather 8 logs before confirming this crossing.'
    case 'occupied': return 'A saved work, camp, or open pit occupies this crossing footprint.'
    case 'already_done': return 'This connected-river bridge is already built.'
    case 'limit_reached': return 'The checked river-bridge limit has been reached.'
    case 'undiscovered': return 'Reveal the full dry approach, wet span, and far-bank exit first.'
    case 'unavailable_here': return 'Move to the streamed dry source bank of this supported crossing.'
    default: return `This crossing cannot be confirmed (${rejection}).`
  }
}

/** Pure V28 overlay. Every actionable ID and rejection comes from checked V28 authority. */
export function publicWorldV28ViewProjection(progress: PublicV28Progress,
  carrier: WizardViewProjection, work: PublicV28WorkAim): WizardViewProjection {
  const { state } = progress, { position } = state.player
  if (carrier.seed !== state.seed || carrier.player.position[0] !== position.x
    || carrier.player.position[2] !== position.z)
    throw new RangeError('The V28 view and checked carrier position must match.')
  const pose = projectPublicV28Pose(progress, progress.terrain, progress.riverBridgeIds)
  if (!pose) throw new RangeError('Invalid V28 bridge pose.')
  const player = { ...carrier.player, position: [position.x,
    pose.effective.position.y, position.z] as const }
  if (state.movementOwner !== 'streamed') return { ...carrier, player }

  // These are saved global works, not local scene candidates. Keep their canonical
  // feet available to the map after the owner changes without revealing terrain.
  const greenwayLadders = progress.greenwayWorks.builtLadderIds.flatMap((id) => {
    const site = resolvePublicV17GreenwaySite(state.seed, id)
    return site?.kind === 'ladder' ? [{ id, from: [site.from.x, site.from.y,
      site.from.z] as const, to: [site.to.x, site.to.y, site.to.z] as const }] : []
  })
  const v28TravelContinuity = { position: player.position, greenwayLadders }

  const visible = new Set(carrier.visualWorld?.terrain.map((cell) => cell.id)
    ?? carrier.terrain.map((cell) => cell.id))
  const known = (site: PublicV28RiverBridgeSite) => site.footprintTileIds.length > 0
    && site.footprintTileIds.every((id) => visible.has(id)
      && discoveryMaskHasTileId(state.discoveryMask, id))
  const local = localPublicV28RiverBridgeSites(state.seed, position.x, position.z)
  const discovered = local.filter(known)
  const builtIds = new Set(progress.riverBridgeIds)
  const built = progress.riverBridgeIds.flatMap((id) => {
    const gx = parsePublicV28RiverBridgeId(id)
    if (gx === null || gx < grid(position.x) - 7 || gx > grid(position.x) + 7) return []
    const site = resolvePublicV28RiverBridge(state.seed, id)
    return site && known(site) ? [displayPublicV28RiverBridge(site)] : []
  })
  const facing = { x: -Math.sin(work.bodyYaw), z: -Math.cos(work.bodyYaw) }
  const candidates = discovered.filter((site) => !builtIds.has(site.id))
    .flatMap((site) => {
      const dx = site.from.x - position.x, dz = site.from.z - position.z
      const distanceMeters = Math.hypot(dx, dz)
      if (distanceMeters > 16) return []
      const angleRadians = distanceMeters < 1e-9 ? 0 : Math.atan2(
        Math.abs(facing.x * dz - facing.z * dx), facing.x * dx + facing.z * dz)
      return [{ site, distanceMeters, angleRadians }]
    }).sort((a, b) => a.distanceMeters - b.distanceMeters
      || a.angleRadians - b.angleRadians || a.site.id.localeCompare(b.site.id))
  const aimedGX = work.aimX === null ? null : grid(work.aimX)
  const aimedId = aimedGX === null || aimedGX < WORLD_GRID_MIN || aimedGX > WORLD_GRID_MAX
    ? null : publicV28RiverBridgeId(aimedGX)
  const aimedSite = aimedId ? resolvePublicV28RiverBridge(state.seed, aimedId) : null
  const selectedCandidate = work.modeActive && work.kind === 'bridge'
    ? aimedId ? candidates.find((choice) => choice.site.id === aimedId) ?? null
      : candidates.find((choice) => choice.angleRadians <= Math.PI / 6)
        ?? candidates[0] ?? null : null
  // The checked preview validates the selected site only. Unselected visible sites remain
  // suggestions, avoiding repeated full-world validation for each nearby column at 20 Hz.
  const selectedRiver = selectedCandidate && (() => {
    const checked = previewPublicV28RiverBridge(progress, selectedCandidate.site.id)
    return { site: displayPublicV28RiverBridge(selectedCandidate.site),
      distanceMeters: selectedCandidate.distanceMeters,
      angleRadians: selectedCandidate.angleRadians,
      benefit: 'Cross this connected river on one saved 8-log deck; earn 80 Construction XP.',
      rejection: checked.rejection,
      reason: publicV28RiverBridgeReason(checked.rejection, selectedCandidate.site) }
  })()
  const nearRiver = Math.abs(grid(position.z) - publicV25RiverCenterZ(state.seed,
    grid(position.x))) <= 3
  const legacy = carrier.savedTerrainWorks
  const legacyChoices = work.modeActive && work.kind === 'bridge'
    ? legacy?.preview?.nearby ?? [] : []
  const useRiver = work.kind === 'bridge' && work.modeActive
    && (!!selectedRiver || nearRiver && !legacyChoices.length)
  const preview = !work.modeActive ? null : work.kind !== 'bridge' ? legacy?.preview ?? null
    : { selected: useRiver ? selectedRiver : legacy?.preview?.selected ?? null,
      nearby: useRiver ? [...(selectedRiver ? [selectedRiver] : []), ...legacyChoices].slice(0, 5)
        : [...legacyChoices, ...(selectedRiver ? [selectedRiver] : [])].slice(0, 5),
      guidance: useRiver ? selectedRiver ? null
        : aimedSite && !known(aimedSite)
          ? 'Reveal the full dry approach, wet span, and far-bank exit before this site appears.'
          : aimedId && !aimedSite
            ? 'No supported crossing at this river column. Follow the bank to a marked, dry-bank site.'
            : nearRiver
              ? 'No supported bridge at this reached bank. Follow the river to a marked dry-bank crossing; not every bank is buildable.'
              : 'Discover a complete supported river crossing before building.'
        : legacy?.preview?.guidance ?? null }
  const riverContext = nearRiver && !legacyChoices.length
  const savedTerrainWorks: WizardSavedTerrainWorksView = {
    ...legacy, builtSites: [...(legacy?.builtSites ?? []), ...built],
    dugTileIds: legacy?.dugTileIds ?? [],
    suggestedSites: [...(legacy?.suggestedSites ?? []),
      ...discovered.filter((site) => !builtIds.has(site.id)).map(displayPublicV28RiverBridge)],
    actionsEnabled: work.actionsEnabled, modeActive: work.modeActive,
    selectedKind: work.kind, aimX: work.aimX,
    preview, ...(riverContext ? { context: 'v28-river' as const } : {}) }
  const candidateFrom = new Set(discovered.filter((site) => !builtIds.has(site.id))
    .map((site) => tileAt(site.from.x, site.from.z)))
  const builtTiles = new Set(built.flatMap((site) => site.footprintTileIds))
  const map = { ...carrier.map, tiles: carrier.map.tiles.map((tile) => ({ ...tile,
    hasRouteSite: tile.hasRouteSite || tile.discovered && candidateFrom.has(tile.id),
    hasBuiltRoute: tile.hasBuiltRoute || tile.discovered && builtTiles.has(tile.id) })),
    ...(riverContext ? { guidance: selectedRiver?.reason ?? preview?.guidance
      ?? 'Connected river: use only marked dry-bank crossings. Open Works, choose Bridge, and confirm when Ready.' }
      : {}) }
  return { ...carrier, player, savedTerrainWorks, map, v28TravelContinuity }
}
