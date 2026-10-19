import { discoveryMaskHasTileId } from './domain/discoveryMask'
import { highlandQuarryRing } from './domain/highlandQuarryRingContent'
import { previewPublicV39RingActions } from './domain/publicWorldV39RingAction'
import type { PublicV39RingProgress, PublicV39RingRejection } from './domain/publicWorldV39RingAction'
import { WORLD_CELL_METERS, WORLD_CHUNK_CELLS, worldTileAtGrid } from './domain/worldChunks'
import { publicV39RingkeeperQuest } from './view/publicV39RingkeeperQuest'
import type { WizardFairyRing, WizardInteractionPrompt, WizardViewProjection } from './view/contracts'

const QUARRY_ID = 'ring-highland-quarry'
const GREENWAY_ID = 'ring-greenway'
const hints: Record<PublicV39RingRejection, string> = {
  invalid_value: 'This ring action cannot be checked. Reload before retrying.',
  invalid_progress: 'The checked adventure is unavailable. Reload before retrying.',
  wrong_region: 'Stand beside the correct source ring for this action.',
  not_grounded: 'Land on supported dry ground beside the ring.',
  unsafe_source: 'The ring cannot be used from wet, raised or open ground.',
  unsafe_arrival: 'The destination is not safely supported. No travel was saved.',
  undiscovered: 'Discover both the Greenway and Highland Quarry rings first.',
  unrevealed: 'Explore until the ring tile is revealed.',
  too_far: 'Move within 3 m of the ring.',
  already_discovered: 'Highland Quarry ring was already discovered.',
  already_linked: 'The two-way ring link is already saved.',
  requires_link: 'Establish the Highland shortcut at Greenway first.',
  requires_outbound: 'Travel from Greenway to Highland before returning by ring.',
  requires_return: 'Return from Highland to Greenway by ring before claiming.',
  already_claimed: 'The Ringkeeper reward was already claimed.',
}

/** V39-only affordance; checked discovery, relocation and payout remain writer-owned. */
export function projectPublicV39Ringkeeper(progress: PublicV39RingProgress,
  carrier: WizardViewProjection): WizardViewProjection {
  const { state } = progress, quarry = highlandQuarryRing(state.seed)
  const tileId = quarry.tile.id
  const revealed = discoveryMaskHasTileId(state.discoveryMask, tileId)
  const mapKnown = carrier.map.tiles.some((tile) => tile.id === tileId && tile.discovered)
  const visualKnown = carrier.visualWorld?.discoveredTileIds.includes(tileId) ?? mapKnown
  const active = (carrier.visualWorld?.terrain ?? carrier.terrain).some((tile) => tile.id === tileId)
  const shown = revealed && mapKnown && visualKnown && active
  const position = [quarry.tile.center.x, quarry.tile.center.y, quarry.tile.center.z] as const
  const greenway = state.greenway.fairyRings.find((ring) => ring.id === GREENWAY_ID)
  const greenwayTile = greenway && worldTileAtGrid(state.seed,
    Math.ceil(greenway.position.x / WORLD_CELL_METERS - 0.5),
    Math.ceil(greenway.position.z / WORLD_CELL_METERS - 0.5))
  const greenwayKnown = !!greenwayTile && state.player.discoveredRingIds.includes(GREENWAY_ID)
    && discoveryMaskHasTileId(state.discoveryMask, greenwayTile.id)
  const linkReady = progress.ringLinkEstablished && progress.quarryRingDiscovered
    && revealed && greenwayKnown
  const toQuarry = { ringId: QUARRY_ID, label: 'Highland Quarry Ring', discovered: true }
  const toGreenway = { ringId: GREENWAY_ID, label: greenway?.name ?? 'Greenway Ring',
    discovered: true }
  const rings: WizardFairyRing[] = carrier.fairyRings.map((ring) => ring.id === GREENWAY_ID
    && linkReady ? { ...ring, destinations: [...ring.destinations, toQuarry] } : ring)
  const quarryRing: WizardFairyRing = { id: QUARRY_ID, label: 'Highland Quarry Ring', position,
    discovered: progress.quarryRingDiscovered && revealed,
    destinations: linkReady ? [toGreenway] : [] }
  if (shown) rings.push(quarryRing)
  const nearQuarry = shown && Math.hypot(carrier.player.position[0] - position[0],
    carrier.player.position[1] - position[1],
    carrier.player.position[2] - position[2]) <= 3
  const prompt: WizardInteractionPrompt | null = nearQuarry
    ? { kind: 'fairy-ring', targetId: QUARRY_ID, label: 'Highland Quarry Ring',
      action: progress.quarryRingDiscovered
        ? 'Choose a discovered destination in the Fairy Rings panel.'
        : 'Discover this site in the Ringkeeper chapter.', actionable: false } : null
  const projected: WizardViewProjection = { ...carrier, fairyRings: rings,
    ...(carrier.visualWorld ? { visualWorld: { ...carrier.visualWorld,
      fairyRings: shown ? [...carrier.visualWorld.fairyRings.filter((ring) =>
        ring.id !== QUARRY_ID), quarryRing] : carrier.visualWorld.fairyRings } } : {}),
    ...(prompt ? { nearbyInteraction: prompt } : {}),
    v39QuarryRing: shown ? { position, discovered: progress.quarryRingDiscovered } : null,
    map: { ...carrier.map, tiles: carrier.map.tiles.map((tile) => tile.id === tileId
      ? { ...tile, hasRing: shown } : tile) },
  }
  const [discover, link, claim] = previewPublicV39RingActions(progress, [
    'ringkeeper-discover/v1', 'ringkeeper-link/v1', 'ringkeeper-claim/v1',
  ]).map((result) => result.rejection)
  const quest = publicV39RingkeeperQuest(projected, {
    quarryRingDiscovered: progress.quarryRingDiscovered,
    ringLinkEstablished: progress.ringLinkEstablished,
    ringOutboundCompleted: progress.ringOutboundCompleted,
    ringReturnCompleted: progress.ringReturnCompleted,
    ringkeeperClaimed: progress.ringkeeperClaimed,
    discover: { rejection: discover, hint: discover ? hints[discover] : null },
    link: { rejection: link, hint: link ? hints[link] : null },
    claim: { rejection: claim, hint: claim ? hints[claim] : null },
  })
  const overview = projected.map.overview
  const chunkMeters = WORLD_CELL_METERS * WORLD_CHUNK_CELLS
  const chunkX = Math.floor(position[0] / chunkMeters)
  const chunkZ = Math.floor(position[2] / chunkMeters)
  return { ...projected, v39RingkeeperQuest: quest,
    ...(revealed && overview ? { map: { ...projected.map,
      overview: () => { const shown = overview(); return { ...shown,
        cells: shown.cells.map((cell) => cell.gridX === chunkX && cell.gridZ === chunkZ
          ? { ...cell, markers: [...cell.markers, 'Highland Quarry Ring'] } : cell) } } } }
      : {}),
  }
}
