import { discoveredTileIdsInActiveWindow } from './domain/publicV13DiscoveryWindow'
import type { ReadonlyWorldTile } from './domain/activeWorldTerrain'
import type { PublicTerrainWorkRejection } from './domain/publicTerrainWorkAction'
import { previewPublicV16GreenwayWork } from './domain/publicWorldV16GreenwayWork'
import { enumeratePublicV16GreenwaySites, publicWorldV16TileAtGrid,
  resolvePublicV16GreenwaySite } from './domain/publicWorldV16GreenwaySites'
import type { PublicV16GreenwaySite } from './domain/publicWorldV16GreenwaySites'
import { publicV16StarterPoseValid } from './domain/publicWorldV16StarterMovement'
import type { PublicV16Progress } from './domain/publicWorldV16Validation'
import { decodePublicV16Progress } from './domain/publicWorldV16Validation'
import type { TerrainWorkSite } from './domain/terrainWorks'
import type { Vec3 } from './domain/types'
import { WORLD_CELL_METERS, WORLD_CHUNK_CELLS } from './domain/worldChunks'
import { publicWorldV15SuppressedStarterResourceIds } from './domain/publicWorldV15StarterSites'
import { highlandTerrainFor } from './PublicV11WorldView'
import { publicWorldV14ViewProjection } from './PublicV14WorldView'
import type { WizardViewProjection } from './view/contracts'
import { visibleTerrainCells, PUBLIC_VISUAL_RADIUS_CELLS } from './view/visibleTerrain'

export type PublicV16ActiveView = Readonly<{
  movementOwner: PublicV16Progress['state']['movementOwner']
  tick: number
  player: PublicV16Progress['state']['player']
  activeKnownTileIds: readonly string[]
  activeTiles: readonly ReadonlyWorldTile[]
  pendingBoundary: boolean
}>
export type PublicV16WorkPreviewInput = Readonly<{
  kind: TerrainWorkSite['kind']
  bodyYaw: number
  modeActive?: boolean
  actionsEnabled?: boolean
}>
export type PublicV16WorldViewProjection = WizardViewProjection

const point = (value: Vec3): readonly [number, number, number] =>
  [value.x, value.y, value.z]
const grid = (value: number) => Math.ceil(value / WORLD_CELL_METERS - 0.5)
const tileAt = (value: { x: number; z: number }) =>
  `tile-${grid(value.x) + 3}-${grid(value.z) + 3}`
const colors = { loam: '#56824b', wetland: '#466f62', rocky: '#7b765e', snow: '#d4e3df' }

/** Keep the existing scene contract while preserving canonical works3 IDs and geometry. */
function displaySite(site: PublicV16GreenwaySite): TerrainWorkSite {
  if (site.kind === 'dig') return { id: site.id, kind: 'dig', obstacle: 'suitable_ground',
    center: site.center, loweredCenter: site.loweredCenter,
    footprintTileIds: site.footprintTileIds, depthMeters: site.depthMeters,
    rewardClass: 'stone' }
  return { id: site.id, kind: site.kind,
    obstacle: site.kind === 'bridge' ? 'fen_channel' : 'slate_cliff',
    from: site.from, to: site.to, approach: site.approach, exit: site.exit,
    supportPath: site.supportPath, footprintTileIds: site.footprintTileIds,
    widthMeters: site.widthMeters, logCost: site.logCost, rewardClass: 'construction' }
}

function reason(site: PublicV16GreenwaySite,
  rejection: PublicTerrainWorkRejection | null, progress: PublicV16Progress): string {
  if (rejection === null) return site.kind === 'bridge'
    ? 'Ready: spend 8 logs for a supported creek crossing and 80 Construction XP.'
    : site.kind === 'ladder'
      ? 'Ready: spend 4 logs for a climbable cliff ladder and 60 Construction XP.'
      : 'Ready: dig 0.24 m for one stone and 30 Excavation XP.'
  if (rejection === 'occupied' && site.kind !== 'dig'
    && site.blockingResourceIds.some((id) => progress.state.greenway.resources
      .some((resource) => resource.id === id && (!resource.depleted || resource.health !== 0)))) {
    return 'Chop the marked tree fully before building here.'
  }
  if (rejection === 'undiscovered') return 'Discover the full site footprint first.'
  if (rejection === 'too_far') return site.kind === 'dig'
    ? 'Move within 4 m of the marked dig patch, but stand beside it, not on it.'
    : 'Move within 3 m of this site.'
  if (rejection === 'occupied') return site.kind === 'dig'
    ? 'Stand beside the marked dig ground, not on it; choose another patch if it overlaps saved works.'
    : 'Move clear of the footprint and other works.'
  if (rejection === 'not_owned') return `Gather ${site.kind === 'dig' ? 0 : site.logCost} logs.`
  if (rejection === 'requires_spade') return 'Own and equip a field spade.'
  if (rejection === 'capacity') return 'Free one backpack slot for the stone.'
  if (rejection === 'already_done') return site.kind === 'dig'
    ? 'This loam patch is already dug.' : 'This structure is complete.'
  if (rejection === 'unavailable_here') return 'Return to Greenway for this work.'
  return `Unavailable: ${rejection}.`
}

function guidance(progress: PublicV16Progress): string {
  const { state, greenwayWorks } = progress
  if (state.movementOwner !== 'greenway') return 'Walk to chart nearby ground. Unexplored terrain stays hidden.'
  const stone = state.player.inventory.some((stack) => stack.itemId === 'stone')
  if (!greenwayWorks.builtBridgeIds.length) return 'South of spawn, reveal a creek bridge site. Chop oaks for 8 logs, then use B Works, 1 Bridge, F at the discovered bank.'
  if (!greenwayWorks.dugTileIds.length) return 'Cross the creek to far-bank loam. Equip a field spade, free one bag slot, stand beside a discovered patch within 4 m, then B Works, 3 Dig, F.'
  if (!greenwayWorks.builtLadderIds.length) return 'North cliff: reveal a clear ladder face, gather 4 logs, then use B Works, 2 Ladder, F. Stone sells at Outfitters.'
  if (stone) return 'Sell the dug stone at Greenway Outfitters. Built bridges and ladders remain usable.'
  return 'Greenway works complete. Explore to reveal more sites; Outfitters buys stone.'
}

function assertActive(progress: PublicV16Progress, active: PublicV16ActiveView): void {
  const { state, greenwayWorks } = progress
  const saved = state.player, shown = active?.player
  if (!shown || active.movementOwner !== state.movementOwner || active.tick !== state.tick
    || shown.position.x !== saved.position.x || shown.position.y !== saved.position.y
    || shown.position.z !== saved.position.z || shown.yaw !== saved.yaw
    || shown.pitch !== saved.pitch || shown.verticalVelocity !== saved.verticalVelocity
    || !Array.isArray(active.activeTiles) || active.activeTiles.length < 1
    || active.activeTiles.length > 9 * WORLD_CHUNK_CELLS ** 2) {
    throw new RangeError('The v16 view and progress must describe the same bounded frame.')
  }
  const known = discoveredTileIdsInActiveWindow(state.discoveryMask, saved.position)
  if (known.length !== active.activeKnownTileIds?.length
    || known.some((id, index) => id !== active.activeKnownTileIds[index])) {
    throw new RangeError('The v16 view has stale discovery facts.')
  }
  if (state.movementOwner === 'greenway') {
    const route = state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null
    if (!publicV16StarterPoseValid({ seed: state.seed, profile: state.generationProfile,
      route, built: state.greenway.builtRouteIds.includes('greenway_ladder'), greenwayWorks },
    saved.position, saved.verticalVelocity)) throw new RangeError('Unsupported v16 pose.')
    if (active.activeTiles.length !== state.greenway.tiles.length) {
      throw new RangeError('The active Greenway window is incomplete.')
    }
    const expected = new Set(state.greenway.tiles.map((tile) => tile.id))
    const seen = new Set<string>()
    for (const tile of active.activeTiles) {
      const canonical = publicWorldV16TileAtGrid(state.seed, tile.gridX - 3, tile.gridZ - 3)
      if (!expected.has(tile.id) || seen.has(tile.id)
        || tile.id !== canonical.id || tile.center.y !== canonical.center.y
        || tile.terrain !== canonical.terrain || tile.biome !== canonical.biome
        || tile.elevation !== canonical.elevation) {
        throw new RangeError('The active Greenway tile differs from v16 terrain.')
      }
      seen.add(tile.id)
    }
  }
}

/** Discovery-gated v16 scene, map and checked work preview. No gameplay writes. */
export function publicWorldV16ViewProjection(progress: PublicV16Progress,
  active: PublicV16ActiveView, messages: readonly string[],
  selectedSiteId: string | null, openStoreId: string | null = null,
  walkRequested = false, workPreview?: PublicV16WorkPreviewInput): PublicV16WorldViewProjection {
  const checked = decodePublicV16Progress(progress, progress?.state?.seed)
  if (!checked) throw new RangeError('Invalid v16 progress for projection.')
  assertActive(checked, active)
  const { state, greenwayWorks } = checked
  const greenway = state.movementOwner === 'greenway'
  const base = publicWorldV14ViewProjection(state, { ...active,
    activeTiles: greenway ? state.greenway.tiles : active.activeTiles }, messages,
  selectedSiteId, openStoreId, walkRequested, greenway ? undefined : workPreview)
  if (!greenway) return base
  if (workPreview && (!Number.isFinite(workPreview.bodyYaw)
    || !['bridge', 'ladder', 'dig'].includes(workPreview.kind))) {
    throw new RangeError('A finite v16 Works preview heading and kind are required.')
  }
  const known = new Set(active.activeKnownTileIds)
  const dug = new Map(greenwayWorks.dugTileIds.map((id) => {
    const site = resolvePublicV16GreenwaySite(state.seed, id)
    return site?.kind === 'dig' ? [site.footprintTileIds[0], site] as const : [id, null] as const
  }))
  const cells = highlandTerrainFor(active.activeTiles.map((tile) => {
    const altered = dug.get(tile.id)?.loweredCenter ?? tile.center
    return { id: tile.id, position: point(altered),
      size: [WORLD_CELL_METERS, WORLD_CELL_METERS] as const,
      height: 0.7 + altered.y, climate: tile.biome, color: colors[tile.terrain] }
  }), state.seed)
  const terrain = visibleTerrainCells(cells, point(state.player.position), PUBLIC_VISUAL_RADIUS_CELLS)
  const visible = new Set(terrain.map((cell) => cell.id))
  const inscriptions = state.greenway.inscriptions.filter((inscription) =>
    inscription.id === 'greenway_waystone' && known.has(tileAt(inscription.position)))
    .map((inscription) => ({ id: inscription.id, name: inscription.name,
      position: point(inscription.position), spellId: inscription.spellId,
      studied: state.greenway.studiedInscriptionIds.includes(inscription.id) }))
  const suppressed = new Set(publicWorldV15SuppressedStarterResourceIds(state.seed,
    state.greenway.resources))
  const coveredTrees = new Set([...greenwayWorks.builtBridgeIds,
    ...greenwayWorks.builtLadderIds].flatMap((id) => {
    const site = resolvePublicV16GreenwaySite(state.seed, id)
    return site && site.kind !== 'dig' ? site.blockingResourceIds : []
  }))
  const resources = base.resources.filter((resource) => !suppressed.has(resource.id)
    && !coveredTrees.has(resource.id))
  const xs = active.activeTiles.map((tile) => tile.gridX - 3)
  const zs = active.activeTiles.map((tile) => tile.gridZ - 3)
  const sites = enumeratePublicV16GreenwaySites(state.seed, {
    minGX: Math.min(...xs), maxGX: Math.max(...xs),
    minGZ: Math.min(...zs), maxGZ: Math.max(...zs) })
  const discovered = sites.filter((site) => site.footprintTileIds.every((id) => known.has(id)))
  const isBuilt = (site: PublicV16GreenwaySite) => site.kind === 'bridge'
    ? greenwayWorks.builtBridgeIds.includes(site.id) : site.kind === 'ladder'
      ? greenwayWorks.builtLadderIds.includes(site.id) : greenwayWorks.dugTileIds.includes(site.id)
  const showSite = (site: PublicV16GreenwaySite) =>
    site.footprintTileIds.some((id) => visible.has(id))
  const showWholeSite = (site: PublicV16GreenwaySite) =>
    site.footprintTileIds.every((id) => visible.has(id))
  const mapTiles = base.map.tiles.map((tile) => {
    const native = active.activeTiles.find((entry) => entry.id === tile.id)
    const visibleSites = tile.discovered ? discovered.filter((site) => site.kind === 'dig'
      ? site.footprintTileIds[0] === tile.id : site.footprintTileIds[1] === tile.id) : []
    return { ...tile, terrain: tile.discovered ? native?.terrain ?? null : null,
      biome: tile.discovered ? native?.biome ?? null : null,
      hasResource: tile.discovered && resources.some((resource) => resource.available
        && tileAt({ x: resource.position[0], z: resource.position[2] }) === tile.id),
      hasWaystone: tile.discovered && inscriptions.some((inscription) =>
        tileAt({ x: inscription.position[0], z: inscription.position[2] }) === tile.id),
      hasRouteSite: tile.hasRouteSite || visibleSites.some((site) => site.kind !== 'dig' && !isBuilt(site)),
      hasBuiltRoute: tile.hasBuiltRoute || visibleSites.some((site) => site.kind !== 'dig' && isBuilt(site)),
      hasDigSite: visibleSites.some((site) => site.kind === 'dig' && !isBuilt(site)),
      ...(dug.has(tile.id) && tile.discovered
        ? { elevationMeters: dug.get(tile.id)!.loweredCenter.y } : {}) }
  })
  const faceX = workPreview ? -Math.sin(workPreview.bodyYaw) : 0
  const faceZ = workPreview ? -Math.cos(workPreview.bodyYaw) : 0
  const choices = discovered.filter((site) => workPreview?.modeActive === true
    && site.kind === workPreview.kind && showSite(site)).flatMap((site) => {
    const target = site.kind === 'dig' ? site.center : site.from
    const dx = target.x - state.player.position.x, dz = target.z - state.player.position.z
    const distanceMeters = Math.hypot(dx, dz)
    if (distanceMeters > 16) return []
    const angleRadians = distanceMeters < 1e-9 ? 0
      : Math.atan2(Math.abs(faceX * dz - faceZ * dx), faceX * dx + faceZ * dz)
    const preview = previewPublicV16GreenwayWork(checked, site.id)
    const benefit = site.kind === 'bridge'
      ? 'Costs 8 logs; cross the creek on a narrow supported deck and gain 80 Construction XP.'
      : site.kind === 'ladder'
        ? 'Costs 4 logs; climb the real north cliff on rungs and gain 60 Construction XP.'
        : 'Requires an owned equipped field spade and bag room; lower dry loam 0.24 m for one stone and 30 Excavation XP.'
    return [{ site: displaySite(site), distanceMeters, angleRadians, benefit,
      rejection: preview.rejection, reason: reason(site, preview.rejection, checked) }]
  }).sort((a, b) => a.angleRadians - b.angleRadians
    || a.distanceMeters - b.distanceMeters || a.site.id.localeCompare(b.site.id))
  const selected = choices.find((choice) => choice.angleRadians <= Math.PI / 6
    && choice.rejection === null)
    ?? choices.filter((choice) => choice.rejection === null)
      .sort((a, b) => a.distanceMeters - b.distanceMeters
        || a.site.id.localeCompare(b.site.id))[0]
    ?? choices.find((choice) => choice.angleRadians <= Math.PI / 6) ?? null
  const nearest = selected ?? choices.slice().sort((a, b) => a.distanceMeters - b.distanceMeters
    || a.site.id.localeCompare(b.site.id))[0]
  const nearby = nearest ? [nearest, ...choices.filter((choice) => choice !== nearest)].slice(0, 5) : []
  const preview: NonNullable<WizardViewProjection['savedTerrainWorks']>['preview'] =
    !workPreview || workPreview.modeActive === false ? null : {
      selected,
      nearby, guidance: nearby.length ? null : workPreview.kind === 'bridge'
        ? 'Explore the south creek to reveal a complete bridge site.'
        : workPreview.kind === 'ladder'
          ? 'Explore the north cliff to reveal a clear ladder face.'
          : 'Cross to the far bank and reveal dry loam; stand beside a patch within 4 m.',
    }
  const builtSites = [...greenwayWorks.builtBridgeIds, ...greenwayWorks.builtLadderIds]
    .flatMap((id) => {
      const site = resolvePublicV16GreenwaySite(state.seed, id)
      return site && site.kind !== 'dig' && discovered.some((entry) => entry.id === id)
        && showWholeSite(site) ? [displaySite(site) as Exclude<TerrainWorkSite, { kind: 'dig' }>] : []
    })
  const dugTileIds = greenwayWorks.dugTileIds.flatMap((id) => {
    const site = resolvePublicV16GreenwaySite(state.seed, id)
    return site?.kind === 'dig' && discovered.some((entry) => entry.id === id)
      && showSite(site) ? [site.footprintTileIds[0]] : []
  })
  const alternativeTree = resources.filter((resource) => resource.available
    && Math.hypot(state.player.position.x - resource.position[0],
      state.player.position.y - resource.position[1],
      state.player.position.z - resource.position[2]) <= 3)
    .sort((a, b) => Math.hypot(state.player.position.x - a.position[0],
      state.player.position.z - a.position[2])
      - Math.hypot(state.player.position.x - b.position[0],
        state.player.position.z - b.position[2]) || a.id.localeCompare(b.id))[0]
  const treeInteraction = alternativeTree ? { kind: 'resource' as const,
    targetId: alternativeTree.id, label: alternativeTree.label,
    action: state.player.equipment.mainHand === 'woodcutters_axe' ? 'Chop' : 'Equip axe',
    actionable: state.player.equipment.mainHand === 'woodcutters_axe' } : null
  const nearbyInteraction = base.nearbyInteraction?.kind === 'resource'
    && !resources.some((resource) => resource.id === base.nearbyInteraction?.targetId)
    ? treeInteraction : base.nearbyInteraction ?? (base.openStoreId ? null : treeInteraction)
  return { ...base, terrain, resources, inscriptions, nearbyInteraction,
    savedTerrainWorks: { context: 'works3-greenway', builtSites, dugTileIds,
      actionsEnabled: workPreview?.actionsEnabled === true,
      modeActive: workPreview?.modeActive === true,
      selectedKind: workPreview?.kind ?? 'bridge', preview },
    visualWorld: { ...base.visualWorld!, terrain, resources,
      inscriptions: inscriptions.filter((inscription) => visible.has(tileAt({
        x: inscription.position[0], z: inscription.position[2] }))),
      discoveredTileIds: [...known].filter((id) => visible.has(id)) },
    map: { ...base.map, tiles: mapTiles,
      legend: '▲ you · W waystone · ◇ bridge/ladder site · ✓ built route · ⌄ dig patch · S Outfitters · • oak · ? unexplored',
      guidance: guidance(checked) } }
}
