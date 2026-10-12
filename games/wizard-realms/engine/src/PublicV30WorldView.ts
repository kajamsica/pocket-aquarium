import { previewPublicV30BridgeheadClaim } from './domain/publicWorldV30BridgeheadAction'
import type { PublicV30Progress } from './domain/publicWorldV30Migration'
import { resolvePublicV17GreenwaySite } from './domain/publicWorldV17GreenwaySites'
import { resolvePublicV28RiverBridge } from './domain/publicWorldV28RiverBridgeSites'
import { WORLD_CELL_METERS } from './domain/worldChunks'
import type { WizardV30BridgeheadPost, WizardViewProjection } from './view/contracts'

const gridAt = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)

/** Only locally projected built works can place a post; the checked writer owns any reward. */
export function localPublicV30BridgeheadPost(progress: PublicV30Progress,
  carrier: WizardViewProjection): WizardV30BridgeheadPost | null {
  const visual = carrier.visualWorld
  if (!visual || !carrier.savedTerrainWorks) return null
  const known = new Set(visual.discoveredTileIds)
  const cells = new Map(visual.terrain.map((cell) => [cell.id, cell]))
  const mapTiles = new Set(carrier.map.tiles.filter((tile) => tile.discovered).map((tile) => tile.id))
  const greenwayIds = new Set(progress.greenwayWorks.builtBridgeIds)
  const riverIds = new Set(progress.riverBridgeIds)
  const options = carrier.savedTerrainWorks.builtSites.flatMap((work) => {
    if (work.kind !== 'bridge') return []
    const site = greenwayIds.has(work.id) ? resolvePublicV17GreenwaySite(progress.state.seed, work.id)
      : riverIds.has(work.id) ? resolvePublicV28RiverBridge(progress.state.seed, work.id) : null
    if (!site || site.kind !== 'bridge') return []
    const gx = gridAt(site.exit.x), gz = gridAt(site.exit.z)
    const tileId = `tile-${gx + 3}-${gz + 3}`
    const cell = cells.get(tileId)
    if (!known.has(tileId) || !mapTiles.has(tileId) || !cell
      || cell.size[0] !== WORLD_CELL_METERS || cell.size[1] !== WORLD_CELL_METERS
      || cell.position[0] !== gx * WORLD_CELL_METERS
      || cell.position[2] !== gz * WORLD_CELL_METERS) return []
    // Keep the sign inside the revealed dry exit tile, within a step of the checked exit.
    const side = site.exit.x <= cell.position[0] ? 1.4 : -1.4
    const position = [site.exit.x + side, cell.position[1], site.exit.z] as const
    const distance = Math.hypot(progress.state.player.position.x - site.exit.x,
      progress.state.player.position.z - site.exit.z)
    return [{ bridgeId: site.id, position, tileId, distance }]
  }).sort((left, right) => left.distance - right.distance
    || left.bridgeId.localeCompare(right.bridgeId))
  const nearest = options[0]
  if (!nearest) return null
  // The full checked preview is only useful near an unclaimed post in its owner region.
  const canPreview = progress.claimedBridgeheadId === null && nearest.distance <= 3
    && progress.state.movementOwner === (greenwayIds.has(nearest.bridgeId) ? 'greenway' : 'streamed')
  const preview = canPreview ? previewPublicV30BridgeheadClaim(progress, nearest.bridgeId) : null
  return { bridgeId: nearest.bridgeId, position: nearest.position,
    tileId: nearest.tileId, claimed: progress.claimedBridgeheadId !== null,
    claimReady: preview?.rejection === null, reward: preview?.reward ?? null }
}

/** V30-only read overlay. An absent local, discovered post leaves V29 presentation unchanged. */
export function projectPublicV30WorldView(progress: PublicV30Progress,
  carrier: WizardViewProjection): WizardViewProjection {
  if (carrier.seed !== progress.state.seed
    || carrier.player.position[0] !== progress.state.player.position.x
    || carrier.player.position[2] !== progress.state.player.position.z)
    throw new RangeError('The V30 view and checked carrier position must match.')
  const post = localPublicV30BridgeheadPost(progress, carrier)
  return post ? { ...carrier, v30Bridgehead: post,
    map: { ...carrier.map, tiles: carrier.map.tiles.map((tile) => ({ ...tile,
      hasBridgeheadPost: tile.discovered && tile.id === post.tileId })) } } : carrier
}
