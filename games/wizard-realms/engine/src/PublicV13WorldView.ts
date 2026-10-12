import { discoveryMaskHasTileId, isValidDiscoveryMask } from './domain/discoveryMask'
import { resolveFieldCampSite } from './domain/fieldCamp'
import { selectPublicV13BuildPreview } from './domain/publicV13BuildPreview'
import type { PublicV13BuildPreview } from './domain/publicV13BuildPreview'
import { discoveredTileIdsInActiveWindow } from './domain/publicV13DiscoveryWindow'
import { publicV13Overview } from './domain/publicV13Overview'
import type { PublicV13ContinuousSession } from './domain/publicWorldV13ContinuousSession'
import type { PublicV13Head } from './domain/publicWorldV13Snapshot'
import type { PublicWorldV12State } from './domain/publicWorldV12State'
import { resolveTerrainWorkSite } from './domain/terrainWorks'
import type { TerrainWorkSite } from './domain/terrainWorks'
import type { TerrainWorkWindow } from './domain/terrainWorks'
import { publicWorldV12ViewProjection } from './PublicV12WorldView'
import type { WizardTerrainCell, WizardViewProjection } from './view/contracts'

type State = PublicV13Head['state']
type ActiveView = ReturnType<PublicV13ContinuousSession['view']>
type BuiltSite = Exclude<TerrainWorkSite, { kind: 'dig' }>
export type PublicV13WorkPreviewInput = Readonly<{ window: TerrainWorkWindow;
  sites: readonly TerrainWorkSite[]; kind: TerrainWorkSite['kind']; bodyYaw: number }>
export type PublicV13WorldView = WizardViewProjection & Readonly<{
  savedTerrainWorks: { builtSites: readonly BuiltSite[]; dugTileIds: readonly string[];
    preview: PublicV13BuildPreview | null }
}>

function assertCurrent(state: State, active: ActiveView): void {
  const saved = state.player, shown = active?.player
  if (!isValidDiscoveryMask(state.discoveryMask) || !shown
    || active.movementOwner !== state.movementOwner || active.tick !== state.tick
    || saved.position.x !== shown.position.x || saved.position.y !== shown.position.y
    || saved.position.z !== shown.position.z || saved.yaw !== shown.yaw
    || saved.pitch !== shown.pitch || saved.verticalVelocity !== shown.verticalVelocity) {
    throw new RangeError('The v13 view and saved state must describe the same frame.')
  }
}

/** Reuse the existing economic/equipment projection with only local mask-known IDs. */
function v12Witness(state: State): PublicWorldV12State {
  const discovered = new Set(discoveredTileIdsInActiveWindow(state.discoveryMask, state.player.position))
  for (const tile of state.greenway.tiles) {
    if (discoveryMaskHasTileId(state.discoveryMask, tile.id)) discovered.add(tile.id)
  }
  const { discoveryMask: _mask, terrainWorks: _works, ...legacy } = state
  return { ...legacy, discoveredTileIds: [...discovered].sort() }
}

function effectiveCell(cell: WizardTerrainCell, heights: ReadonlyMap<string, number>): WizardTerrainCell {
  const y = heights.get(cell.id)
  return y === undefined || y === cell.position[1]
    ? cell : { ...cell, position: [cell.position[0], y, cell.position[2]] }
}

/** Pure, unmounted v13 read model. The overview closure alone scans the whole compact mask. */
export function publicWorldV13ViewProjection(state: State, active: ActiveView,
  messages: readonly string[], selectedSiteId: string | null,
  openStoreId: string | null = null,
  workPreview?: PublicV13WorkPreviewInput): PublicV13WorldView {
  assertCurrent(state, active)
  const camps = state.fieldCampTileIds.flatMap((id) => {
    const site = resolveFieldCampSite(state.seed, id)
    return site ? [{ tileId: id, position: [site.tile.center.x, site.tile.center.y,
      site.tile.center.z] as const }] : []
  })
  const base = publicWorldV12ViewProjection(v12Witness(state), messages, selectedSiteId,
    state.movementOwner === 'greenway' ? openStoreId : null,
    camps.length ? { camps, preview: null, selectionEnabled: false } : undefined)
  const streamed = active.movementOwner === 'streamed'
  const activeTiles = streamed ? active.activeTiles : []
  if (activeTiles.length > 9 * 16 * 16) throw new RangeError('The v13 active tile window is too large.')
  const heights = new Map(activeTiles.map((tile) => [tile.id, tile.center.y]))
  const inWindow = new Set(heights.keys())
  const dug = new Set(state.terrainWorks.dugTileIds)
  const builtSites = state.terrainWorks.builtWorkIds.flatMap((id) => {
    const site = resolveTerrainWorkSite(state.seed, id)
    return site && site.kind !== 'dig' && site.footprintTileIds.some((tileId) => inWindow.has(tileId))
      ? [site] : []
  })
  const builtSourceTiles = new Set(builtSites.map((site) => site.footprintTileIds[1]))
  const savedTerrainWorks = { builtSites,
    dugTileIds: state.terrainWorks.dugTileIds.filter((id) => inWindow.has(id)),
    preview: workPreview ? selectPublicV13BuildPreview(state, workPreview.window,
      workPreview.sites, workPreview.kind, workPreview.bodyYaw) : null }
  let overview: ReturnType<typeof publicV13Overview> | undefined
  return { ...base,
    player: { position: [state.player.position.x, state.player.position.y, state.player.position.z],
      yaw: state.player.yaw, pitch: state.player.pitch },
    terrain: streamed ? base.terrain.map((cell) => effectiveCell(cell, heights)) : base.terrain,
    ...(base.visualWorld && streamed ? { visualWorld: { ...base.visualWorld,
      terrain: base.visualWorld.terrain.map((cell) => effectiveCell(cell, heights)) } } : {}),
    map: { ...base.map,
      tiles: streamed ? base.map.tiles.map((tile) => tile.discovered ? { ...tile,
        ...(dug.has(tile.id) && heights.has(tile.id)
          ? { elevationMeters: heights.get(tile.id) } : {}),
        ...(builtSourceTiles.has(tile.id) ? { hasBuiltRoute: true } : {}),
      } : tile) : base.map.tiles,
      overview: () => overview ??= publicV13Overview(state) },
    ...(base.windwardStep ? { windwardStep: { ...base.windwardStep,
      glyph: base.windwardStep.glyph && { ...base.windwardStep.glyph, canStudy: false },
      canCast: false,
      unavailableReason: 'Windward Step actions are unavailable in the continuous v13 preview.' } } : {}),
    nearbyInteraction: streamed && base.nearbyInteraction
      ? { ...base.nearbyInteraction, actionable: false,
        action: 'Unavailable in the continuous v13 preview' } : base.nearbyInteraction,
    highlandExtraction: streamed ? undefined : base.highlandExtraction,
    savedTerrainWorks,
  }
}
