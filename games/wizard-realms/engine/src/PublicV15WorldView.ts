import { discoveredTileIdsInActiveWindow } from './domain/publicV13DiscoveryWindow'
import type { ReadonlyWorldTile } from './domain/activeWorldTerrain'
import { publicV15StarterPoseValid } from './domain/publicWorldV15StarterMovement'
import { publicWorldV15StarterSites, publicWorldV15StarterTileAtGrid,
  publicWorldV15SuppressedStarterResourceIds } from './domain/publicWorldV15StarterSites'
import type { PublicV15StarterSite } from './domain/publicWorldV15StarterSites'
import { previewPublicV15StarterWork } from './domain/publicWorldV15StarterWork'
import type { PublicV15Progress } from './domain/publicWorldV15Validation'
import type { PublicTerrainWorkRejection } from './domain/publicTerrainWorkAction'
import type { PublicV14State } from './domain/publicWorldV14Snapshot'
import type { TerrainWorkSite } from './domain/terrainWorks'
import type { Vec3 } from './domain/types'
import { activeChunkCoordinates, WORLD_CELL_METERS, WORLD_CHUNK_CELLS } from './domain/worldChunks'
import { highlandTerrainFor } from './PublicV11WorldView'
import { publicWorldV14ViewProjection } from './PublicV14WorldView'
import type { WizardViewProjection } from './view/contracts'
import { visibleTerrainCells, PUBLIC_VISUAL_RADIUS_CELLS } from './view/visibleTerrain'

/** The same bounded read surface returned by the native v15 session. */
export type PublicV15ActiveView = Readonly<{
  movementOwner: PublicV14State['movementOwner']
  tick: number
  player: PublicV14State['player']
  activeKnownTileIds: readonly string[]
  activeTiles: readonly ReadonlyWorldTile[]
  pendingBoundary: boolean
}>

export type PublicV15WorkPreviewInput = Readonly<{
  kind: TerrainWorkSite['kind']
  bodyYaw: number
  modeActive?: boolean
  actionsEnabled?: boolean
}>

export type PublicV15WorkChoice = Readonly<{
  site: TerrainWorkSite
  distanceMeters: number
  angleRadians: number
  benefit: string
  rejection: PublicTerrainWorkRejection | null
  reason: string
}>

export type PublicV15WorldViewProjection = WizardViewProjection

const point = (value: Vec3): readonly [number, number, number] =>
  [value.x, value.y, value.z]
const grid = (value: number) => Math.ceil(value / WORLD_CELL_METERS - 0.5)
const tileIdAt = (value: { x: number; z: number }) =>
  `tile-${grid(value.x) + 3}-${grid(value.z) + 3}`
const colors = { loam: '#56824b', wetland: '#466f62', rocky: '#7b765e', snow: '#d4e3df' }

function starterFacts(seed: string) {
  const [bridge, dig] = publicWorldV15StarterSites(seed)
  if (bridge?.kind !== 'bridge' || dig?.kind !== 'dig') {
    throw new RangeError('Invalid v15 starter-site facts.')
  }
  return { bridge, dig }
}

/** Structural scene adapter only. `works2` IDs are never parsed by the v14 writer. */
function displaySite(site: PublicV15StarterSite): TerrainWorkSite {
  if (site.kind === 'dig') return { id: site.id, kind: 'dig', obstacle: 'suitable_ground',
    center: site.center, loweredCenter: site.loweredCenter,
    footprintTileIds: site.footprintTileIds, depthMeters: site.depthMeters,
    rewardClass: 'stone' }
  return { id: site.id, kind: 'bridge', obstacle: 'fen_channel',
    from: site.from, to: site.to, approach: site.approach, exit: site.exit,
    supportPath: site.supportPath, footprintTileIds: site.footprintTileIds,
    widthMeters: site.widthMeters, logCost: site.logCost, rewardClass: 'construction' }
}

function assertNativeActive(progress: PublicV15Progress, active: PublicV15ActiveView): void {
  const { state, starterWorks } = progress
  const saved = state.player, shown = active?.player
  if (!shown || active.movementOwner !== state.movementOwner || active.tick !== state.tick
    || shown.position.x !== saved.position.x || shown.position.y !== saved.position.y
    || shown.position.z !== saved.position.z || shown.yaw !== saved.yaw
    || shown.pitch !== saved.pitch || shown.verticalVelocity !== saved.verticalVelocity
    || !Array.isArray(active.activeTiles) || active.activeTiles.length < 1
    || active.activeTiles.length > 9 * WORLD_CHUNK_CELLS ** 2) {
    throw new RangeError('The v15 view and progress must describe the same bounded frame.')
  }
  const known = discoveredTileIdsInActiveWindow(state.discoveryMask, saved.position)
  if (known.length !== active.activeKnownTileIds?.length
    || known.some((id, index) => id !== active.activeKnownTileIds[index])) {
    throw new RangeError('The v15 view has stale discovery facts.')
  }
  const route = state.greenway.routes.find((entry) => entry.id === 'greenway_ladder')
  if (state.movementOwner === 'greenway' && (!route || !publicV15StarterPoseValid({
    seed: state.seed, profile: state.generationProfile, route,
    built: state.greenway.builtRouteIds.includes('greenway_ladder'), starterWorks,
  }, saved.position, saved.verticalVelocity))) {
    throw new RangeError('The active v15 pose has no starter-world support.')
  }
  const chunks = new Set(activeChunkCoordinates(saved.position)
    .map(({ chunkX, chunkZ }) => `${chunkX}:${chunkZ}`))
  const greenwayIds = new Set(state.greenway.tiles.map((tile) => tile.id))
  const seen = new Set<string>()
  if (state.movementOwner === 'greenway'
    && active.activeTiles.length !== state.greenway.tiles.length) {
    throw new RangeError('The active v15 Greenway window is incomplete.')
  }
  for (const tile of active.activeTiles) {
    if (seen.has(tile.id) || tile.id !== `tile-${tile.gridX}-${tile.gridZ}`
      || tile.center.x !== (tile.gridX - 3) * WORLD_CELL_METERS
      || tile.center.z !== (tile.gridZ - 3) * WORLD_CELL_METERS
      || state.movementOwner === 'greenway' && !greenwayIds.has(tile.id)
      || !chunks.has(`${Math.floor((tile.gridX - 3) / WORLD_CHUNK_CELLS)}:${Math.floor((tile.gridZ - 3) / WORLD_CHUNK_CELLS)}`)) {
      throw new RangeError('The active v15 window contains foreign or duplicate terrain.')
    }
    if (state.movementOwner === 'greenway') {
      const canonical = publicWorldV15StarterTileAtGrid(state.seed,
        tile.gridX - 3, tile.gridZ - 3)
      if (tile.center.y !== canonical.center.y || tile.terrain !== canonical.terrain
        || tile.biome !== canonical.biome || tile.elevation !== canonical.elevation) {
        throw new RangeError('The active Greenway tile differs from v15 terrain.')
      }
    }
    seen.add(tile.id)
  }
}

function reasonFor(site: PublicV15StarterSite,
  rejection: PublicTerrainWorkRejection | null): string {
  if (rejection === null) return site.kind === 'bridge'
    ? 'Ready: spend 8 logs to bridge the creek.'
    : 'Ready: dig 0.24 m for one stone and 30 XP.'
  if (rejection === 'undiscovered') return 'Discover the full site footprint first.'
  if (rejection === 'too_far') return 'Move within 3 m of this site.'
  if (rejection === 'occupied') return site.kind === 'dig'
    ? 'Stand beside the patch on supported ground.'
    : 'Stand on supported ground off the bridge footprint.'
  if (rejection === 'not_owned') return 'Gather 8 logs from nearby oaks.'
  if (rejection === 'requires_spade') return 'Own and equip a field spade.'
  if (rejection === 'capacity') return 'Free one backpack slot for the stone.'
  if (rejection === 'already_done') return site.kind === 'bridge'
    ? 'The creek bridge is complete.' : 'The bank cache is already dug.'
  if (rejection === 'unavailable_here') return 'Return to Greenway for this work.'
  return `Unavailable: ${rejection}.`
}

function stageGuidance(progress: PublicV15Progress, known: ReadonlySet<string>): string {
  const { state, starterWorks } = progress
  if (state.movementOwner !== 'greenway') return 'Walk to chart nearby ground. Unexplored terrain stays hidden.'
  const { bridge, dig } = starterFacts(state.seed)
  const bridgeKnown = bridge.footprintTileIds.every((id) => known.has(id))
  const digKnown = dig.footprintTileIds.every((id) => known.has(id))
  const logs = state.player.inventory.filter((stack) => stack.itemId === 'logs')
    .reduce((sum, stack) => sum + stack.quantity, 0)
  const stone = state.player.inventory.filter((stack) => stack.itemId === 'stone')
    .reduce((sum, stack) => sum + stack.quantity, 0)
  if (!starterWorks.bridgeBuilt) {
    if (logs < 8) return `Chop nearby oaks twice each to gather 8 logs for the creek bridge (${logs}/8).`
    return bridgeKnown ? 'Bridge ready near the south creek bank. Select Bridge in Works, face the discovered crossing, and build.'
      : 'Walk south to discover the full creek crossing, then build a bridge with 8 logs.'
  }
  if (!starterWorks.bankCacheDug) {
    const ownsSpade = state.player.inventory.some((stack) => stack.itemId === 'field_spade')
    if (!ownsSpade) return 'Buy a field spade at Greenway Outfitters, then cross the narrow bridge to dig.'
    if (state.player.equipment.mainHand !== 'field_spade') return 'Equip your field spade, then cross the narrow bridge to dig.'
    if (state.player.position.z <= 10) return 'Cross the narrow built bridge to the far bank, then find the diggable patch.'
    if (!digKnown) return 'Explore the far bank to discover the diggable patch.'
    return 'Equip an owned field spade, stand beside the patch, and dig for one stone and 30 XP.'
  }
  return stone > 0 ? 'Return across the bridge to Greenway Outfitters and sell the stone.'
    : 'First bridge and bank cache complete. Greenway Outfitters buys future stone.'
}

/** Read-only v15 scene and guidance. Every preview rejection comes from C1's pure checked path. */
export function publicWorldV15ViewProjection(progress: PublicV15Progress,
  active: PublicV15ActiveView, messages: readonly string[],
  selectedSiteId: string | null, openStoreId: string | null = null,
  walkRequested = false, workPreview?: PublicV15WorkPreviewInput): PublicV15WorldViewProjection {
  assertNativeActive(progress, active)
  const { state, starterWorks } = progress
  // V14 supplies unchanged inventory, store and ladder presentation only. The
  // session's native tile window and v15 work flags replace its world facts below.
  const base = publicWorldV14ViewProjection(state, { ...active,
    activeTiles: state.movementOwner === 'greenway' ? state.greenway.tiles : active.activeTiles,
  }, messages, selectedSiteId, openStoreId, walkRequested,
  state.movementOwner === 'streamed' ? workPreview : undefined)
  const known = new Set(active.activeKnownTileIds)
  const { bridge, dig } = starterFacts(state.seed)
  const cells = highlandTerrainFor(active.activeTiles.map((tile) => {
    const center = starterWorks.bankCacheDug && tile.id === dig.footprintTileIds[0]
      ? dig.loweredCenter : tile.center
    return { id: tile.id, position: point(center),
      size: [WORLD_CELL_METERS, WORLD_CELL_METERS] as const,
      height: 0.7 + center.y, climate: tile.biome, color: colors[tile.terrain] }
  }), state.seed)
  const terrain = visibleTerrainCells(cells, point(state.player.position), PUBLIC_VISUAL_RADIUS_CELLS)
  const visible = new Set(terrain.map((cell) => cell.id))
  const suppressed = new Set(publicWorldV15SuppressedStarterResourceIds(state.seed,
    state.greenway.resources))
  const resources = base.resources.filter((resource) => !suppressed.has(resource.id))
  const bridgeKnown = bridge.footprintTileIds.every((id) => known.has(id))
  const digKnown = dig.footprintTileIds.every((id) => known.has(id))
  const bridgeVisible = bridge.footprintTileIds.some((id) => visible.has(id))
  const digVisible = dig.footprintTileIds.some((id) => visible.has(id))
  const activeById = new Map(active.activeTiles.map((tile) => [tile.id, tile]))
  const mapTiles = base.map.tiles.map((tile) => {
    const native = activeById.get(tile.id)
    const discovered = tile.discovered && known.has(tile.id)
    return { ...tile,
      terrain: discovered ? native?.terrain ?? null : null,
      biome: discovered ? native?.biome ?? null : null,
      hasResource: discovered && resources.some((resource) =>
        tileIdAt({ x: resource.position[0], z: resource.position[2] }) === tile.id
          && resource.available),
      hasRouteSite: tile.hasRouteSite || discovered && bridgeKnown
        && !starterWorks.bridgeBuilt && tile.id === bridge.footprintTileIds[1],
      hasBuiltRoute: tile.hasBuiltRoute || discovered && bridgeKnown
        && starterWorks.bridgeBuilt && tile.id === bridge.footprintTileIds[1],
      hasDigSite: discovered && digKnown && !starterWorks.bankCacheDug
        && tile.id === dig.footprintTileIds[0],
      ...(discovered && starterWorks.bankCacheDug && tile.id === dig.footprintTileIds[0]
        ? { elevationMeters: dig.loweredCenter.y } : {}),
    }
  })
  if (workPreview && (!Number.isFinite(workPreview.bodyYaw)
    || !['bridge', 'ladder', 'dig'].includes(workPreview.kind))) {
    throw new RangeError('A finite v15 Works preview heading and kind are required.')
  }
  const availableSites = [bridge, dig].filter((site) => workPreview?.modeActive === true
    && site.kind === workPreview.kind
    && site.footprintTileIds.every((id) => known.has(id))
    && site.footprintTileIds.some((id) => visible.has(id)))
  const faceX = workPreview ? -Math.sin(workPreview.bodyYaw) : 0
  const faceZ = workPreview ? -Math.cos(workPreview.bodyYaw) : 0
  const nearby = availableSites.flatMap((site): PublicV15WorkChoice[] => {
    const target = site.kind === 'dig' ? site.center : site.from
    const dx = target.x - state.player.position.x, dz = target.z - state.player.position.z
    const distanceMeters = Math.hypot(dx, dz)
    if (distanceMeters > 16) return []
    const angleRadians = distanceMeters < 1e-9 ? 0
      : Math.atan2(Math.abs(faceX * dz - faceZ * dx), faceX * dx + faceZ * dz)
    const checked = previewPublicV15StarterWork(progress, site.id)
    return [{ site: displaySite(site), distanceMeters, angleRadians,
      benefit: site.kind === 'bridge' ? 'Costs 8 logs; cross the creek on a narrow supported deck and gain 80 construction XP.'
        : 'Requires an equipped owned field spade and one free backpack slot; lower the patch by 0.24 m for one stone and 30 excavation XP.',
      rejection: checked.rejection, reason: reasonFor(site, checked.rejection) }]
  }).sort((left, right) => left.angleRadians - right.angleRadians
    || left.distanceMeters - right.distanceMeters || left.site.id.localeCompare(right.site.id))
  const preview = !workPreview || workPreview.modeActive === false ? null : {
    selected: nearby.find((choice) => choice.angleRadians <= Math.PI / 6) ?? null,
    nearby, guidance: nearby.length ? null : workPreview.kind === 'bridge'
      ? 'Discover the full creek crossing south of the starting area.'
      : workPreview.kind === 'ladder'
        ? 'The starter cliff ladder is a separate discovered map route, not a Greenway Works site.'
        : 'Cross the bridge and discover the far-bank dig patch.',
  }
  const savedTerrainWorks: WizardViewProjection['savedTerrainWorks'] =
    state.movementOwner === 'streamed' ? base.savedTerrainWorks : {
      context: 'starter-greenway',
      builtSites: starterWorks.bridgeBuilt && bridgeKnown && bridgeVisible
        ? [displaySite(bridge) as Extract<TerrainWorkSite, { kind: 'bridge' }>] : [],
      dugTileIds: starterWorks.bankCacheDug && digKnown && digVisible
        ? [dig.footprintTileIds[0]] : [],
      actionsEnabled: workPreview?.actionsEnabled === true,
      modeActive: workPreview?.modeActive === true,
      selectedKind: workPreview?.kind ?? 'bridge', preview,
    }
  const alternativeTree = resources.filter((resource) => resource.available
    && Math.hypot(state.player.position.x - resource.position[0],
      state.player.position.y - resource.position[1],
      state.player.position.z - resource.position[2]) <= 3)
    .sort((left, right) => Math.hypot(state.player.position.x - left.position[0],
      state.player.position.z - left.position[2])
      - Math.hypot(state.player.position.x - right.position[0],
        state.player.position.z - right.position[2]) || left.id.localeCompare(right.id))[0]
  const nearbyInteraction = base.nearbyInteraction?.kind === 'resource'
    && suppressed.has(base.nearbyInteraction.targetId)
    ? alternativeTree ? { kind: 'resource' as const, targetId: alternativeTree.id,
      label: alternativeTree.label,
      action: state.player.equipment.mainHand === 'woodcutters_axe' ? 'Chop' : 'Equip axe',
      actionable: state.player.equipment.mainHand === 'woodcutters_axe' } : null
    : base.nearbyInteraction
  return { ...base, terrain, resources, nearbyInteraction, savedTerrainWorks,
    visualWorld: { ...base.visualWorld!, terrain, resources,
      discoveredTileIds: [...known].filter((id) => visible.has(id)) },
    map: { ...base.map, tiles: mapTiles,
      legend: '▲ you · ◇ ladder/bridge site · ✓ built route · ⌄ dig patch · S Outfitters · • oak · ? unexplored',
      guidance: stageGuidance(progress, known) },
  }
}
