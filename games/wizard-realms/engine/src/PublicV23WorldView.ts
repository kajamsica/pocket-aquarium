import { discoveryMaskHasTileId } from './domain/discoveryMask'
import { previewPublicV23Work } from './domain/publicWorldV23Snapshot'
import type { PublicV23Progress } from './domain/publicWorldV23Snapshot'
import { publicV23PlacementId, resolvePublicV23Site } from './domain/publicWorldV23Sites'
import type { PublicV23ResolvedSite } from './domain/publicWorldV23Sites'
import type { PublicTerrainWorkRejection } from './domain/publicTerrainWorkAction'
import { publicWorldV14ViewProjection } from './PublicV14WorldView'
import { publicWorldV17ViewProjection } from './PublicV17WorldView'
import type { PublicV17ActiveView } from './PublicV17WorldView'
import type { WizardViewProjection } from './view/contracts'

export type PublicV23WorkAim = Readonly<{ kind: 'bridge' | 'ladder' | 'dig';
  bodyYaw: number; aimX: number | null; aimZ: number | null;
  modeActive: boolean; actionsEnabled: boolean }>
const reason = (rejection: string | null, playerX: number, footX: number) => rejection === null
  ? 'Ready: spend 4 logs for west-facing climbable rungs and 60 Construction XP.'
  : rejection === 'not_owned' ? 'Gather four logs.'
    : rejection === 'too_far' ? `${playerX < footX ? 'Move east onto' : 'Stand on'} grounded dry terrain at or east of the lower foot, within 3 m. Check for Ready before building.`
      : rejection === 'occupied' ? 'Another work or camp occupies this strip.'
        : rejection === 'already_done' ? 'This ladder is already built.'
          : rejection === 'undiscovered' ? 'Discover the entire lower and upper footprint first.'
            : `Unavailable: ${rejection}.`
const terrainRejections: readonly string[] = ['invalid_progress', 'invalid_ledger',
  'unavailable_here', 'invalid_site', 'undiscovered', 'too_far', 'already_done',
  'occupied', 'limit_reached', 'not_owned', 'requires_spade', 'capacity', 'invalid_value']
const legacyRejection = (value: string | null): PublicTerrainWorkRejection | null =>
  value === null ? null : terrainRejections.includes(value)
    ? value as PublicTerrainWorkRejection : 'invalid_progress'
const westStripCapability = new Map<string, boolean>()

/** A seed has the V23 west-face overlay only if its bounded canonical strip supports a site. */
export function publicV23HasWestStripSite(seed: string): boolean {
  const cached = westStripCapability.get(seed)
  if (cached !== undefined) return cached
  const supported = Array.from({ length: 29 }, (_, index) => 4306 + index).some((q) =>
    resolvePublicV23Site(seed, `works5:ladder:mireglass-slate:W:-103:${q}`) !== null)
  westStripCapability.set(seed, supported)
  return supported
}

/** A west-face ray selects Z; the snapped q is always recomputed by the canonical resolver. */
export function publicV23ReticleAimZ(position: { x: number; z: number }, yaw: number): number | null {
  if (![position.x, position.z, yaw].every(Number.isFinite)) return null
  const faceX = -Math.sin(yaw)
  if (Math.abs(faceX) < 1e-6) return null
  const distance = (-412 - position.x) / faceX
  return distance >= 0 && distance <= 32 ? position.z - Math.cos(yaw) * distance : null
}

/** Built sites come only from the validated save; the ghost is fully discovery gated. */
export function publicWorldV23ViewProjection(progress: PublicV23Progress,
  active: PublicV17ActiveView, messages: readonly string[], selectedSiteId: string | null,
  openStoreId: string | null, walkRequested: boolean,
  work: PublicV23WorkAim): WizardViewProjection {
  const { state } = progress
  const greenway = state.movementOwner === 'greenway'
  const westStripSupported = publicV23HasWestStripSite(state.seed)
  const base = greenway
    ? publicWorldV17ViewProjection({ state, greenwayWorks: progress.greenwayWorks }, active,
      messages, selectedSiteId, openStoreId, walkRequested, { kind: work.kind,
        bodyYaw: work.bodyYaw, aimX: work.aimX, modeActive: work.modeActive,
        actionsEnabled: work.actionsEnabled })
    : publicWorldV14ViewProjection(state, active, messages, selectedSiteId,
      openStoreId, walkRequested, { kind: work.kind, bodyYaw: work.bodyYaw,
        modeActive: work.modeActive, actionsEnabled: work.actionsEnabled })
  const known = (site: PublicV23ResolvedSite) => site.footprintTileIds.every((tile) =>
    discoveryMaskHasTileId(state.discoveryMask, tile))
  const builtSites = progress.regionalWorks.builtLadderIds.map((id) =>
    resolvePublicV23Site(state.seed, id)).filter((site): site is PublicV23ResolvedSite =>
    !!site && known(site))
  const id = !greenway && work.modeActive && work.kind === 'ladder'
    && work.aimZ !== null ? publicV23PlacementId(work.aimZ) : null
  const checked = id ? previewPublicV23Work({ state,
    greenwayWorks: progress.greenwayWorks, regionalWorks: progress.regionalWorks }, id) : null
  const regionalPreview = checked?.site ? { site: checked.site,
    rejection: checked.rejection } : null
  const marked = (westStripSupported ? [4306, 4334] : []).map((q) => resolvePublicV23Site(state.seed,
    `works5:ladder:mireglass-slate:W:-103:${q}`)).filter((site): site is PublicV23ResolvedSite =>
    !!site && known(site))
  const saved = base.savedTerrainWorks
  const target = regionalPreview?.site
  const dx = target ? target.from.x - state.player.position.x : 0
  const dz = target ? target.from.z - state.player.position.z : 0
  const distanceMeters = Math.hypot(dx, dz)
  const facing = { x: -Math.sin(work.bodyYaw), z: -Math.cos(work.bodyYaw) }
  const angleRadians = distanceMeters < 1e-9 ? 0 : Math.atan2(
    Math.abs(facing.x * dz - facing.z * dx), facing.x * dx + facing.z * dz)
  const choice = target ? { site: { ...target, obstacle: 'slate_cliff' as const },
    distanceMeters, angleRadians,
    benefit: 'Four logs support a reusable west-facing cliff climb.',
    rejection: legacyRejection(checked!.rejection),
    reason: reason(checked!.rejection, state.player.position.x, target.from.x) } : null
  const savedTerrainWorks = saved && !greenway && westStripSupported
    && work.modeActive && work.kind === 'ladder'
    ? { ...saved, preview: { selected: choice, nearby: choice ? [choice] : [],
        guidance: choice ? null : work.aimZ === null
          ? 'Face the west cliff or use the Z aim control.'
          : checked?.rejection === 'undiscovered' ? 'Discover both ledges before aiming this footprint.'
            : 'Shift aim onto the supported west cliff face.' } }
    : saved
  // The scene uses a bounded, saved discovery mask even while the local frame view advances.
  const revealed = new Set(active.activeKnownTileIds)
  return { ...base, ...(savedTerrainWorks ? { savedTerrainWorks } : {}),
    regionalLadders: { builtSites, preview: regionalPreview },
    visualWorld: base.visualWorld ? { ...base.visualWorld,
      discoveredTileIds: base.visualWorld.discoveredTileIds.filter((tile) => revealed.has(tile)) }
      : undefined,
    map: { ...base.map, tiles: base.map.tiles.map((tile) => ({ ...tile,
      hasRouteSite: tile.hasRouteSite || marked.some((site) =>
        !progress.regionalWorks.builtLadderIds.includes(site.id)
        && site.footprintTileIds[0] === tile.id),
      hasBuiltRoute: tile.hasBuiltRoute || builtSites.some((site) =>
        site.footprintTileIds.includes(tile.id)) })),
    guidance: !westStripSupported ? base.map.guidance : greenway
      ? `${base.map.guidance} Follow the west trail to Mireglass, discover both ledges of its west Slate cliff, and bring four logs for another ladder.`
      : 'West Mireglass Slate cliff: discover both ledges, gather four logs, then B Works, 2 Ladder, aim Z, and F.' } }
}
