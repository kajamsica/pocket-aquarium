import { discoveryMaskHasTileId } from './domain/discoveryMask'
import { MIREGLASS_RING_ID, mireglassFairyRing } from './domain/mireglassContent'
import { projectPublicV31Pose } from './domain/publicWorldV31Support'
import type { PublicV32Progress } from './domain/publicWorldV32Migration'
import { WORLD_CELL_METERS, worldTileAtGrid } from './domain/worldChunks'
import type { WizardFairyRing, WizardInteractionPrompt, WizardViewProjection } from './view/contracts'

const GREENWAY_RING_ID = 'ring-greenway'
const gridAt = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)
const point = (position: { x: number; y: number; z: number }) =>
  [position.x, position.y, position.z] as const
const distance = (left: readonly [number, number, number],
  right: readonly [number, number, number]) => Math.hypot(
    left[0] - right[0], left[1] - right[1], left[2] - right[2])

/** V33-only ring affordance. Discovery and travel remain checked writer actions. */
export function projectPublicV33FairyRingView(progress: PublicV32Progress,
  carrier: WizardViewProjection): WizardViewProjection {
  const { state } = progress
  const pose = projectPublicV31Pose(progress)
  if (!pose || carrier.seed !== state.seed
    || carrier.player.position[0] !== state.player.position.x
    || Math.abs(carrier.player.position[1] - pose.effective.position.y) > 1e-6
    || carrier.player.position[2] !== state.player.position.z)
    throw new RangeError('The V33 ring view and checked carrier pose must match.')

  const greenway = state.greenway.fairyRings.find((ring) => ring.id === GREENWAY_RING_ID)
  if (!greenway) throw new RangeError('Missing canonical Greenway fairy ring.')
  const mireglass = mireglassFairyRing(state.seed)
  const facts = [
    { id: GREENWAY_RING_ID, label: greenway.name, position: point(greenway.position),
      tileId: worldTileAtGrid(state.seed, gridAt(greenway.position.x),
        gridAt(greenway.position.z)).id },
    { id: MIREGLASS_RING_ID, label: 'Mireglass Ring', position: point(mireglass.tile.center),
      tileId: mireglass.tile.id },
  ] as const
  const mapKnown = new Set(carrier.map.tiles.filter((tile) => tile.discovered)
    .map((tile) => tile.id))
  const visualKnown = new Set(carrier.visualWorld?.discoveredTileIds ?? mapKnown)
  const active = new Set((carrier.visualWorld?.terrain ?? carrier.terrain)
    .map((tile) => tile.id))
  const revealed = (tileId: string) => discoveryMaskHasTileId(state.discoveryMask, tileId)
  const shown = (tileId: string) => revealed(tileId) && mapKnown.has(tileId)
    && visualKnown.has(tileId) && active.has(tileId)
  const discovered = (id: string, tileId: string) =>
    state.player.discoveredRingIds.includes(id) && revealed(tileId)
  const rings: WizardFairyRing[] = facts.filter((ring) => shown(ring.tileId))
    .map((ring) => ({ id: ring.id, label: ring.label, position: ring.position,
      discovered: discovered(ring.id, ring.tileId),
      destinations: facts.filter((other) => other.id !== ring.id).map((other) => ({
        ringId: other.id, label: other.label,
        discovered: discovered(other.id, other.tileId),
      })) }))
  const canonicalIds = new Set<string>(facts.map((ring) => ring.id))
  const ringTiles = new Set<string>(facts.map((ring) => ring.tileId))
  const merge = (existing: readonly WizardFairyRing[]) => [
    ...existing.filter((ring) => !canonicalIds.has(ring.id)), ...rings]
  const nearby = rings.filter((ring) => distance(carrier.player.position, ring.position) <= 3)
    .sort((left, right) => distance(carrier.player.position, left.position)
      - distance(carrier.player.position, right.position))[0]
  const grounded = state.player.verticalVelocity === 0
    && Math.abs(pose.effective.position.y - pose.effective.floorY) <= 1e-6
  const greenwayUndiscovered = nearby?.id === GREENWAY_RING_ID && !nearby.discovered
  const greenwayReason = !grounded ? 'Stand grounded inside Greenway Ring to discover it.'
    : state.movementOwner !== 'greenway' ? 'Enter Greenway to discover this ring.'
      : !Number.isSafeInteger(state.eventSequence + 1)
        ? 'The world event sequence cannot advance.' : null
  const canDiscoverGreenway = greenwayUndiscovered && greenwayReason === null
  const prompt: WizardInteractionPrompt | null = !nearby ? null
    : greenwayUndiscovered ? { kind: 'fairy-ring', targetId: GREENWAY_RING_ID,
      label: 'Greenway Ring', action: canDiscoverGreenway
        ? 'Discover Greenway Ring' : greenwayReason!,
      actionable: !!canDiscoverGreenway }
      : nearby.id === MIREGLASS_RING_ID && !nearby.discovered
        ? null // Keep V24's checked mireglass:discover:ring prompt and choice.
        : { kind: 'fairy-ring', targetId: nearby.id, label: nearby.label,
          action: 'Choose a discovered fairy path to travel.', actionable: false }
  const checkedActionChoices = greenwayUndiscovered
    ? [...(carrier.checkedActionChoices ?? []).filter((choice) => choice.id !== GREENWAY_RING_ID),
      { id: GREENWAY_RING_ID, actionable: !!canDiscoverGreenway,
        reason: greenwayReason }]
    : carrier.checkedActionChoices
  return { ...carrier, v33FairyTravel: true, fairyRings: merge(carrier.fairyRings),
    ...(carrier.visualWorld ? { visualWorld: { ...carrier.visualWorld,
      fairyRings: merge(carrier.visualWorld.fairyRings) } } : {}),
    nearbyInteraction: prompt ?? carrier.nearbyInteraction,
    checkedActionChoices,
    map: { ...carrier.map, tiles: carrier.map.tiles.map((tile) =>
      ringTiles.has(tile.id)
        ? { ...tile, hasRing: shown(tile.id) } : tile) },
  }
}
