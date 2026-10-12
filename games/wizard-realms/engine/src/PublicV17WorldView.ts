import { discoveredTileIdsInActiveWindow } from './domain/publicV13DiscoveryWindow'
import type { ReadonlyWorldTile } from './domain/activeWorldTerrain'
import type { PublicTerrainWorkRejection } from './domain/publicTerrainWorkAction'
import { previewPublicV17GreenwayWork } from './domain/publicWorldV17GreenwayWork'
import { placementId, resolvePublicV17GreenwaySite } from './domain/publicWorldV17GreenwaySites'
import { enumeratePublicV16GreenwaySites,
  publicWorldV16TileAtGrid } from './domain/publicWorldV16GreenwaySites'
import type { PublicV16GreenwaySite as PublicV17GreenwaySite } from './domain/publicWorldV16GreenwaySites'
import type { PublicV17Progress } from './domain/publicWorldV17Validation'
import { decodePublicV17ViewProgress } from './domain/publicWorldV17Validation'
import type { TerrainWorkSite } from './domain/terrainWorks'
import type { Vec3 } from './domain/types'
import { WORLD_CELL_METERS, WORLD_CHUNK_CELLS } from './domain/worldChunks'
import { publicWorldV15SuppressedStarterResourceIds } from './domain/publicWorldV15StarterSites'
import { highlandTerrainFor } from './PublicV11WorldView'
import { publicWorldV14ViewProjection } from './PublicV14WorldView'
import type { WizardViewProjection } from './view/contracts'
import { visibleTerrainCells, PUBLIC_VISUAL_RADIUS_CELLS } from './view/visibleTerrain'

export type PublicV17ActiveView = Readonly<{
  movementOwner: PublicV17Progress['state']['movementOwner']
  tick: number
  player: PublicV17Progress['state']['player']
  activeKnownTileIds: readonly string[]
  activeTiles: readonly ReadonlyWorldTile[]
  pendingBoundary: boolean
}>
export type PublicV17WorkPreviewInput = Readonly<{
  kind: TerrainWorkSite['kind']
  bodyYaw: number
  /** Desired world X at the selected creek or cliff, transient and never saved. */
  aimX: number | null
  modeActive?: boolean
  actionsEnabled?: boolean
}>
export type PublicV17WorldViewProjection = WizardViewProjection

const point = (value: Vec3): readonly [number, number, number] =>
  [value.x, value.y, value.z]
const grid = (value: number) => Math.ceil(value / WORLD_CELL_METERS - 0.5)
const tileAt = (value: { x: number; z: number }) =>
  `tile-${grid(value.x) + 3}-${grid(value.z) + 3}`
const colors = { loam: '#56824b', wetland: '#466f62', rocky: '#7b765e', snow: '#d4e3df' }
type StructureSite = Extract<PublicV17GreenwaySite, { kind: 'bridge' | 'ladder' }>
const candidateCache = new Map<string, readonly StructureSite[]>()
let cachedDigSites: { key: string; sites: readonly PublicV17GreenwaySite[] } | null = null

/** Choose separated canonical works4 positions once per seed, never from a UI-invented point. */
function canonicalCandidates(seed: string): readonly StructureSite[] {
  const cached = candidateCache.get(seed)
  if (cached) return cached
  const find = (kind: 'bridge' | 'ladder', maxQ: number) => {
    const sites: StructureSite[] = []
    for (let distance = kind === 'bridge' ? 0 : 11;
      distance <= maxQ && sites.length < 2; distance++) {
      for (const q of distance === 0 ? [0] : [distance, -distance]) {
        const id = placementId(kind, q / 10)
        const site = id ? resolvePublicV17GreenwaySite(seed, id) : null
        if (site?.kind === kind && sites.every((other) =>
          Math.abs(site.from.x - other.from.x) >= 4)) sites.push(site)
        if (sites.length === 2) break
      }
    }
    return sites
  }
  const candidates = [...find('bridge', 91), ...find('ladder', 120)]
  if (candidateCache.size >= 8) candidateCache.delete(candidateCache.keys().next().value!)
  candidateCache.set(seed, candidates)
  return candidates
}

/** Keep the scene contract while displaying both migrated works3 and snapped works4 geometry. */
function displaySite(site: PublicV17GreenwaySite): TerrainWorkSite {
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

function reason(site: PublicV17GreenwaySite,
  rejection: PublicTerrainWorkRejection | null, progress: PublicV17Progress): string {
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

function guidance(progress: PublicV17Progress): string {
  const { state, greenwayWorks } = progress
  if (state.movementOwner !== 'greenway') return 'Walk to chart nearby ground. Unexplored terrain stays hidden.'
  const stone = state.player.inventory.some((stack) => stack.itemId === 'stone')
  if (!greenwayWorks.builtBridgeIds.length) return 'South of spawn, discover both creek banks. Chop oaks for 8 logs, then use B Works, 1 Bridge, aim across the water, and F at a ready ghost.'
  if (!greenwayWorks.dugTileIds.length) return 'Cross the creek to far-bank loam. Equip a field spade, free one bag slot, stand beside a discovered patch within 4 m, then B Works, 3 Dig, F.'
  if (!greenwayWorks.builtLadderIds.length) return 'North cliff: discover both ledges, gather 4 logs, then use B Works, 2 Ladder, shift the upright rung ghost to a clear face, and F. Stone sells at Outfitters.'
  if (stone) return 'Sell the dug stone at Greenway Outfitters. Built bridges and ladders remain usable.'
  return 'Greenway works complete. Explore to reveal more sites; Outfitters buys stone.'
}

function assertActive(progress: PublicV17Progress, active: PublicV17ActiveView): void {
  const { state } = progress
  const saved = state.player, shown = active?.player
  if (!shown || active.movementOwner !== state.movementOwner || active.tick !== state.tick
    || shown.position.x !== saved.position.x || shown.position.y !== saved.position.y
    || shown.position.z !== saved.position.z || shown.yaw !== saved.yaw
    || shown.pitch !== saved.pitch || shown.verticalVelocity !== saved.verticalVelocity
    || !Array.isArray(active.activeTiles) || active.activeTiles.length < 1
    || active.activeTiles.length > 9 * WORLD_CHUNK_CELLS ** 2) {
    throw new RangeError('The v17 view and progress must describe the same bounded frame.')
  }
  const known = discoveredTileIdsInActiveWindow(state.discoveryMask, saved.position)
  if (known.length !== active.activeKnownTileIds?.length
    || known.some((id, index) => id !== active.activeKnownTileIds[index])) {
    throw new RangeError('The v17 view has stale discovery facts.')
  }
  if (state.movementOwner === 'greenway') {
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
        throw new RangeError('The active Greenway tile differs from canonical terrain.')
      }
      seen.add(tile.id)
    }
  }
}

/** Discovery-gated v17 scene, map and checked work preview. No gameplay writes. */
export function publicWorldV17ViewProjection(progress: PublicV17Progress,
  active: PublicV17ActiveView, messages: readonly string[],
  selectedSiteId: string | null, openStoreId: string | null = null,
  walkRequested = false, workPreview?: PublicV17WorkPreviewInput): PublicV17WorldViewProjection {
  const checked = decodePublicV17ViewProgress(progress, progress?.state?.seed)
  if (!checked) throw new RangeError('Invalid v17 progress for projection.')
  assertActive(checked, active)
  const { state, greenwayWorks } = checked
  const greenway = state.movementOwner === 'greenway'
  const base = publicWorldV14ViewProjection(state, { ...active,
    activeTiles: greenway ? state.greenway.tiles : active.activeTiles }, messages,
  selectedSiteId, openStoreId, walkRequested, greenway ? undefined : workPreview)
  if (!greenway) return base
  if (workPreview && (!Number.isFinite(workPreview.bodyYaw)
    || workPreview.aimX !== null && !Number.isFinite(workPreview.aimX)
    || !['bridge', 'ladder', 'dig'].includes(workPreview.kind))) {
    throw new RangeError('A finite v17 Works preview heading, aim and kind are required.')
  }
  const known = new Set(active.activeKnownTileIds)
  const dug = new Map(greenwayWorks.dugTileIds.map((id) => {
    const site = resolvePublicV17GreenwaySite(state.seed, id)
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
    const site = resolvePublicV17GreenwaySite(state.seed, id)
    return site && site.kind !== 'dig' ? site.blockingResourceIds : []
  }))
  const resources = base.resources.filter((resource) => !suppressed.has(resource.id)
    && !coveredTrees.has(resource.id))
  const xs = active.activeTiles.map((tile) => tile.gridX - 3)
  const zs = active.activeTiles.map((tile) => tile.gridZ - 3)
  const bounds = { minGX: Math.min(...xs), maxGX: Math.max(...xs),
    minGZ: Math.min(...zs), maxGZ: Math.max(...zs) }
  const digKey = `${state.seed}:${bounds.minGX}:${bounds.maxGX}:${bounds.minGZ}:${bounds.maxGZ}`
  if (cachedDigSites?.key !== digKey) cachedDigSites = { key: digKey,
    sites: enumeratePublicV16GreenwaySites(state.seed, bounds)
      .filter((site) => site.kind === 'dig') }
  const digs = structuredClone(cachedDigSites.sites)
  const built = [...greenwayWorks.builtBridgeIds, ...greenwayWorks.builtLadderIds]
    .map((id) => resolvePublicV17GreenwaySite(state.seed, id))
    .filter((site): site is PublicV17GreenwaySite => site !== null)
  const occupied = [...built, ...greenwayWorks.dugTileIds
    .map((id) => resolvePublicV17GreenwaySite(state.seed, id))
    .filter((site): site is PublicV17GreenwaySite => site !== null)]
  const aimedId = workPreview?.modeActive && workPreview.kind !== 'dig'
    && workPreview.aimX !== null
    ? placementId(workPreview.kind, workPreview.aimX) : null
  const aimedSite = aimedId ? resolvePublicV17GreenwaySite(state.seed, aimedId) : null
  const sites = [...new Map([...digs, ...built, ...(aimedSite ? [aimedSite] : [])]
    .map((site) => [site.id, site] as const)).values()]
  const discovered = sites.filter((site) => site.footprintTileIds.every((id) => known.has(id)))
  const isBuilt = (site: PublicV17GreenwaySite) => site.kind === 'bridge'
    ? greenwayWorks.builtBridgeIds.includes(site.id) : site.kind === 'ladder'
      ? greenwayWorks.builtLadderIds.includes(site.id) : greenwayWorks.dugTileIds.includes(site.id)
  const showSite = (site: PublicV17GreenwaySite) =>
    site.footprintTileIds.some((id) => visible.has(id))
  const showWholeSite = (site: PublicV17GreenwaySite) =>
    site.footprintTileIds.every((id) => visible.has(id))
  const overlapsBuilt = (site: StructureSite) => occupied.some((existing) => {
    const half = site.widthMeters / 2 + (site.kind === 'bridge' ? 0.04 : 0.015)
    const otherHalf = existing.kind === 'dig' ? 2
      : existing.widthMeters / 2 + (existing.kind === 'bridge' ? 0.04 : 0.015)
    if (Math.abs(site.from.x - (existing.kind === 'dig' ? existing.center.x : existing.from.x))
      >= half + otherHalf) return false
    const minZ = site.kind === 'bridge' ? site.from.z - 0.5 : site.supportPath[2].z - 0.5
    const maxZ = site.kind === 'bridge' ? site.to.z + 0.5 : site.supportPath[1].z + 0.5
    const otherMinZ = existing.kind === 'dig' ? existing.center.z - 2
      : existing.kind === 'bridge' ? existing.from.z - 0.5 : existing.supportPath[2].z - 0.5
    const otherMaxZ = existing.kind === 'dig' ? existing.center.z + 2
      : existing.kind === 'bridge' ? existing.to.z + 0.5 : existing.supportPath[1].z + 0.5
    return minZ < otherMaxZ && otherMinZ < maxZ
  })
  const suggestions = canonicalCandidates(state.seed).filter((site) =>
    !isBuilt(site) && !overlapsBuilt(site)
    && site.footprintTileIds.every((id) => known.has(id)) && showWholeSite(site))
  const suggestedDigs = discovered.filter((site): site is Extract<PublicV17GreenwaySite,
    { kind: 'dig' }> => site.kind === 'dig'
    && !isBuilt(site) && showWholeSite(site))
    .sort((a, b) => Math.hypot(a.center.x - state.player.position.x,
      a.center.z - state.player.position.z) - Math.hypot(b.center.x - state.player.position.x,
    b.center.z - state.player.position.z) || a.id.localeCompare(b.id)).slice(0, 5)
  const suggestedSites = [...suggestions, ...suggestedDigs].map(displaySite)
  const activeTilesById = new Map(active.activeTiles.map((tile) => [tile.id, tile]))
  const sitesByMarkerTile = new Map<string, PublicV17GreenwaySite[]>()
  for (const site of discovered) {
    const markerTileId = site.footprintTileIds[site.kind === 'dig' ? 0 : 1]
    if (markerTileId === undefined) continue
    const entries = sitesByMarkerTile.get(markerTileId)
    if (entries) entries.push(site)
    else sitesByMarkerTile.set(markerTileId, [site])
  }
  const mapTiles = base.map.tiles.map((tile) => {
    const native = activeTilesById.get(tile.id)
    const visibleSites = tile.discovered ? sitesByMarkerTile.get(tile.id) ?? [] : []
    return { ...tile, terrain: tile.discovered ? native?.terrain ?? null : null,
      biome: tile.discovered ? native?.biome ?? null : null,
      hasResource: tile.discovered && resources.some((resource) => resource.available
        && tileAt({ x: resource.position[0], z: resource.position[2] }) === tile.id),
      hasWaystone: tile.discovered && inscriptions.some((inscription) =>
        tileAt({ x: inscription.position[0], z: inscription.position[2] }) === tile.id),
      hasRouteSite: tile.hasRouteSite || visibleSites.some((site) => site.kind !== 'dig'
        && !isBuilt(site) && showWholeSite(site))
        || suggestions.some((site) => site.footprintTileIds[1] === tile.id),
      hasBuiltRoute: tile.hasBuiltRoute || visibleSites.some((site) => site.kind !== 'dig' && isBuilt(site)),
      hasDigSite: visibleSites.some((site) => site.kind === 'dig' && !isBuilt(site)
        && showWholeSite(site)),
      ...(dug.has(tile.id) && tile.discovered
        ? { elevationMeters: dug.get(tile.id)!.loweredCenter.y } : {}) }
  })
  const faceX = workPreview ? -Math.sin(workPreview.bodyYaw) : 0
  const faceZ = workPreview ? -Math.cos(workPreview.bodyYaw) : 0
  const choices = discovered.filter((site) => workPreview?.modeActive === true
    && site.kind === workPreview.kind && showSite(site)
    && (site.kind === 'dig' || site.id === aimedId)).flatMap((site) => {
    const target = site.kind === 'dig' ? site.center : site.from
    const dx = target.x - state.player.position.x, dz = target.z - state.player.position.z
    const distanceMeters = Math.hypot(dx, dz)
    if (distanceMeters > 16) return []
    const angleRadians = distanceMeters < 1e-9 ? 0
      : Math.atan2(Math.abs(faceX * dz - faceZ * dx), faceX * dx + faceZ * dz)
    const preview = previewPublicV17GreenwayWork(checked, site.id)
    const benefit = site.kind === 'bridge'
      ? 'Costs 8 logs; cross the creek on a narrow supported deck and gain 80 Construction XP.'
      : site.kind === 'ladder'
        ? 'Costs 4 logs; climb the real north cliff on rungs and gain 60 Construction XP.'
        : 'Requires an owned equipped field spade and bag room; lower dry loam 0.24 m for one stone and 30 Excavation XP.'
    return [{ site: displaySite(site), distanceMeters, angleRadians, benefit,
      rejection: preview.rejection, reason: reason(site, preview.rejection, checked) }]
  }).sort((a, b) => a.angleRadians - b.angleRadians
    || a.distanceMeters - b.distanceMeters || a.site.id.localeCompare(b.site.id))
  const selected = workPreview?.kind === 'dig'
    ? choices.find((choice) => choice.angleRadians <= Math.PI / 6
      && choice.rejection === null)
      ?? choices.find((choice) => choice.rejection === null)
      ?? choices.find((choice) => choice.angleRadians <= Math.PI / 6) ?? null
    : choices[0] ?? null
  const nearby = selected
    ? [selected, ...choices.filter((choice) => choice !== selected)].slice(0, 5)
    : choices.slice(0, 5)
  const preview: NonNullable<WizardViewProjection['savedTerrainWorks']>['preview'] =
    !workPreview || workPreview.modeActive === false ? null : {
      selected, nearby,
      guidance: nearby.length ? null : workPreview.kind === 'dig'
        ? 'Cross to the far bank and reveal dry loam; stand beside a patch within 4 m.'
        : workPreview.aimX === null
          ? 'Face the south creek or north cliff to aim a structure, or use the aim control.'
          : !aimedId || !aimedSite
            ? `No supported ${workPreview.kind} position at x ${Number(workPreview.aimX.toFixed(1))}. Shift the aim along the obstacle.`
            : !aimedSite.footprintTileIds.every((id) => known.has(id))
              ? 'Discover both ends of this footprint before building.'
              : 'Move closer until the aimed ghost is visible.',
    }
  const builtSites = [...greenwayWorks.builtBridgeIds, ...greenwayWorks.builtLadderIds]
    .flatMap((id) => {
      const site = resolvePublicV17GreenwaySite(state.seed, id)
      return site && site.kind !== 'dig' && site.footprintTileIds.every((tileId) => known.has(tileId))
        && showWholeSite(site) ? [displaySite(site) as Exclude<TerrainWorkSite, { kind: 'dig' }>] : []
    })
  const dugTileIds = greenwayWorks.dugTileIds.flatMap((id) => {
    const site = resolvePublicV17GreenwaySite(state.seed, id)
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
    savedTerrainWorks: { context: 'works4-greenway', builtSites, dugTileIds, suggestedSites,
      actionsEnabled: workPreview?.actionsEnabled === true,
      modeActive: workPreview?.modeActive === true,
      selectedKind: workPreview?.kind ?? 'bridge',
      aimX: workPreview?.aimX ?? null, preview },
    visualWorld: { ...base.visualWorld!, terrain, resources,
      inscriptions: inscriptions.filter((inscription) => visible.has(tileAt({
        x: inscription.position[0], z: inscription.position[2] }))),
      discoveredTileIds: [...known].filter((id) => visible.has(id)) },
    map: { ...base.map, tiles: mapTiles,
      legend: '▲ you · W waystone · ◇ discovered bridge/ladder candidate · ✓ built route · ⌄ dig patch · S Outfitters · • oak · ? unexplored',
      guidance: guidance(checked) } }
}
