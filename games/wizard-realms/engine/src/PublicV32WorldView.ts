import { discoveryMaskHasTileId } from './domain/discoveryMask'
import { HIGHLAND_LANDMARK, classifyStreamedRegion, highlandCorridorCells,
  highlandLandmark, highlandStoneNodes } from './domain/highlandContent'
import { resolvePublicV17GreenwaySite } from './domain/publicWorldV17GreenwaySites'
import { publicV25RiverCellAtGrid } from './domain/publicWorldV25River'
import { publicV25RiverTouchesSegment } from './domain/publicWorldV25RiverSweep'
import { projectPublicV31Pose } from './domain/publicWorldV31Support'
import type { PublicV32Progress } from './domain/publicWorldV32Migration'
import { starterCliffCanonicalFace } from './domain/starterCliffProfile'
import { WORLD_CELL_METERS, WORLD_CHUNK_CELLS } from './domain/worldChunks'
import type { WizardInteractionPrompt, WizardLandmark, WizardResourceNode,
  WizardViewProjection, WizardWorldOverview } from './view/contracts'

export const PUBLIC_V32_CROWN_INTERACTION_ID = 'highland:study:quarry_crown' as const
export const publicV32NodeInteractionId = (nodeId: string) => `highland:extract:${nodeId}`

type Point = Readonly<{ x: number; z: number }>
const historicRoute = highlandCorridorCells()
const pointKey = ({ x, z }: Point) => `${x}:${z}`
const distance2 = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z)
const distance3 = (a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const owned = (progress: PublicV32Progress, itemId: string) => progress.state.player.inventory
  .reduce((quantity, stack) => quantity + (stack.itemId === itemId ? stack.quantity : 0), 0)
const packUsed = (progress: PublicV32Progress) => progress.state.player.inventory
  .reduce((quantity, stack) => quantity + stack.quantity, 0)
  + progress.state.player.tradeSlots.reduce((quantity, slot) => quantity + slot.quantity, 0)
  + Object.values(progress.terrain.bag).reduce((quantity, count) => quantity + count, 0)

const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
const bearing = (from: Point, to: Point) => compass[(Math.round(Math.atan2(to.x - from.x,
  from.z - to.z) / (Math.PI / 4)) + 8) % 8]
const gridAt = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)
const tileIdAt = ({ x, z }: Point) => `tile-${gridAt(x) + 3}-${gridAt(z) + 3}`
const firstBendBypass: readonly Point[] = Array.from({ length: 9 }, (_, index) =>
  ({ x: 68 + index * WORLD_CELL_METERS, z: -4 }))
const routeCache = new Map<string, Readonly<{ points: readonly Point[];
  cells: ReadonlySet<string>; firstBendDry: boolean }>>()

/** V32-only cartography: historical IDs stay pinned; wet V25 cells cannot masquerade as trail. */
function dryDisplayRoute(seed: string) {
  const cached = routeCache.get(seed)
  if (cached) return cached
  const wet = ({ x, z }: Point) => publicV25RiverCellAtGrid(seed,
    x / WORLD_CELL_METERS, z / WORLD_CELL_METERS)
  const bend = [{ x: 68, z: 0 }, ...firstBendBypass]
  const firstBendDry = bend.every((point) => !wet(point))
    && bend.slice(1).every((point, index) =>
      !publicV25RiverTouchesSegment(seed, bend[index], point))
  const points: Point[] = []
  for (const point of historicRoute) {
    if (firstBendDry && ((point.z === 0 && point.x > 68 && point.x <= 100)
      || (point.x === 100 && point.z === -4))) continue
    if (!wet(point)) points.push(point)
    if (firstBendDry && point.x === 68 && point.z === 0) points.push(...firstBendBypass)
  }
  const route = { points, cells: new Set(points.map(pointKey)), firstBendDry }
  routeCache.set(seed, route)
  if (routeCache.size > 8) routeCache.delete(routeCache.keys().next().value!)
  return route
}

function savedNorthLadderFoot(progress: PublicV32Progress): Point | null {
  const { state } = progress
  const works = progress.greenwayWorks.builtLadderIds.flatMap((id) => {
    const site = resolvePublicV17GreenwaySite(state.seed, id)
    return site?.kind === 'ladder' ? [site.from] : []
  })
  const legacy = state.greenway.builtRouteIds.includes('greenway_ladder')
    ? [starterCliffCanonicalFace(state.seed).from] : []
  return [...works, ...legacy].sort((left, right) =>
    distance2(state.player.position, left) - distance2(state.player.position, right))[0] ?? null
}

/** A familiar waypoint may guide travel, but an unwalked tile never becomes a map marker. */
function knownRouteGuidance(seed: string, from: Point, known: ReadonlySet<string>,
  returning: boolean): string {
  const route = dryDisplayRoute(seed).points
  let nearest = 0
  let nearestDistance = Infinity
  for (const [index, point] of route.entries()) {
    const distance = distance2(from, point)
    if (distance < nearestDistance) { nearestDistance = distance; nearest = index }
  }
  const direction = returning ? -1 : 1
  let target: Point | null = null
  for (let index = nearest + direction; index >= 0 && index < route.length; index += direction) {
    const candidate = route[index]
    // Skipping a wet historic point must never imply a new dry connector.
    if (distance2(candidate, route[index - direction]) > WORLD_CELL_METERS + 1e-6
      || publicV25RiverTouchesSegment(seed, route[index - direction], candidate)) break
    if (!known.has(tileIdAt(candidate))) break
    if (distance2(from, candidate) <= 28) target = candidate
    else break
  }
  return target && distance2(from, target) > 2
    ? `${bearing(from, target)}, about ${Math.round(distance2(from, target))} m to the next walked bend`
    : returning ? 'west along the ground you have charted' : 'east along the ground you have charted'
}

function withHighlandOverview(overview: WizardWorldOverview,
  progress: PublicV32Progress): WizardWorldOverview {
  const { state } = progress
  const markers = new Map<string, string[]>()
  const add = (tileId: string, x: number, z: number, label: string) => {
    if (!discoveryMaskHasTileId(state.discoveryMask, tileId)) return
    const chunk = `${Math.floor(x / (WORLD_CELL_METERS * WORLD_CHUNK_CELLS))}:${Math.floor(z
      / (WORLD_CELL_METERS * WORLD_CHUNK_CELLS))}`
    markers.set(chunk, [...(markers.get(chunk) ?? []), label])
  }
  const crown = highlandLandmark(state.seed)
  add(crown.tile.id, crown.tile.center.x, crown.tile.center.z,
    state.highland.landmarkDiscovered ? 'Quarry Crown studied' : 'Quarry Crown')
  const readiness = new Map(state.highland.stoneNodes.map((node) => [node.id, node.readyAtTick]))
  for (const node of highlandStoneNodes(state.seed)) add(node.tile.id,
    node.tile.center.x, node.tile.center.z,
    state.tick < (readiness.get(node.id) ?? Infinity) ? 'Stone shelf recovering' : 'Stone shelf')
  return { ...overview, cells: overview.cells.map((cell) => ({ ...cell,
    markers: [...cell.markers, ...(markers.get(`${cell.gridX}:${cell.gridZ}`) ?? [])] })) }
}

function highlandPrompt(targetId: string, label: string, reason: string | null,
  kind: WizardInteractionPrompt['kind']): WizardInteractionPrompt {
  return { targetId, kind, label, action: reason ?? label, actionable: reason === null }
}

/** V32's read-only Highland layer. The checked V32 writer remains the sole action authority. */
export function projectPublicV32WorldView(progress: PublicV32Progress,
  carrier: WizardViewProjection): WizardViewProjection {
  const { state } = progress
  if (carrier.seed !== state.seed || carrier.player.position[0] !== state.player.position.x
    || carrier.player.position[2] !== state.player.position.z)
    throw new RangeError('The V32 view and checked carrier position must match.')

  const { player } = state
  const from = player.position
  const pose = projectPublicV31Pose(progress)
  if (!pose) throw new RangeError('Invalid V32 checked pose.')
  const grounded = player.verticalVelocity === 0
    && Math.abs(pose.effective.position.y - pose.effective.floorY) <= 1e-6
  const mapKnown = new Set(carrier.map.tiles.filter((tile) => tile.discovered
    && discoveryMaskHasTileId(state.discoveryMask, tile.id)).map((tile) => tile.id))
  const visual = carrier.visualWorld
  const active = new Set((visual?.terrain ?? carrier.terrain).map((cell) => cell.id))
  const visualKnown = new Set(visual?.discoveredTileIds ?? [...mapKnown])
  const shown = (id: string) => mapKnown.has(id) && visualKnown.has(id) && active.has(id)
  const region = classifyStreamedRegion(state.seed, from)
  const inQuarry = region === 'highland_quarry'
  const crown = highlandLandmark(state.seed)
  const crownShown = shown(crown.tile.id)
  const crownLandmark: WizardLandmark[] = crownShown ? [{ id: HIGHLAND_LANDMARK.id,
    kind: 'quarry-crown', position: [crown.tile.center.x, crown.tile.center.y,
      crown.tile.center.z], discovered: state.highland.landmarkDiscovered }] : []
  const readiness = new Map(state.highland.stoneNodes.map((node) => [node.id, node.readyAtTick]))
  const nodes = highlandStoneNodes(state.seed)
  const visibleNodes = nodes.filter((node) => shown(node.tile.id))
  const stoneResources: WizardResourceNode[] = visibleNodes.map((node) => ({ id: node.id,
    kind: 'ore', visualKind: 'highland-stone', label: 'Highland stone outcrop',
    position: [node.tile.center.x, node.tile.center.y, node.tile.center.z],
    available: state.tick >= (readiness.get(node.id) ?? Infinity) }))

  const crownMeters = distance2(from, crown.tile.center)
  const crownReason = !grounded ? 'Land on supported ground to study Quarry Crown.'
    : crownMeters > 8 ? 'Move within 8 m of Quarry Crown to study it.' : null
  const crownPrompt = crownShown && !state.highland.landmarkDiscovered && crownMeters <= 12
    ? highlandPrompt(PUBLIC_V32_CROWN_INTERACTION_ID, 'Quarry Crown', crownReason, 'other') : null
  const nearbyNode = visibleNodes.filter((node) => distance3(pose.effective.position,
    node.tile.center) <= 5).sort((left, right) => distance3(pose.effective.position,
    left.tile.center) - distance3(pose.effective.position, right.tile.center)
    || left.id.localeCompare(right.id))[0]
  const nodeMeters = nearbyNode ? distance3(pose.effective.position,
    nearbyNode.tile.center) : Infinity
  const readyAtTick = nearbyNode ? readiness.get(nearbyNode.id) : undefined
  const nodeReason = !nearbyNode ? null : !grounded
    ? 'Land on supported ground before extracting.'
    : !state.highland.landmarkDiscovered ? 'Study Quarry Crown first.'
      : nodeMeters > 3 ? 'Move within 3 m of this stone shelf.'
        : owned(progress, 'field_spade') < 1 ? 'Buy a field spade at Greenway Outfitters.'
          : player.equipment.mainHand !== 'field_spade' ? 'Equip your field spade.'
            : 1 + Math.floor(player.skillXp.excavation / 30) < 2
              ? 'Excavation Lv2 required. Practice digging before extracting stone.'
              : packUsed(progress) + 2 > player.backpackCapacity
                ? 'Make room for 2 stone in your backpack.'
                : readyAtTick === undefined ? 'This stone shelf is unavailable.'
                  : state.tick < readyAtTick
                    ? `Stone shelf recovering (about ${Math.ceil((readyAtTick - state.tick) / 20)} s).`
                    : null
  const nodePrompt = nearbyNode ? highlandPrompt(publicV32NodeInteractionId(nearbyNode.id),
    'Highland stone outcrop', nodeReason, 'resource') : null
  const highlandInteraction = crownPrompt ?? nodePrompt
  const markerTiles = new Map(nodes.map((node) => [node.tile.id, node.id]))
  const east = state.greenway.tiles.filter((tile) => tile.center.z === 0)
    .sort((left, right) => right.center.x - left.center.x)[0]
  const eastKnown = !!east && discoveryMaskHasTileId(state.discoveryMask, east.id)
  // V26's east rock return seals the low valley at x=30, z>=-6. A revealed
  // far-side path cell is memory, not an adjacent crossing from the pocket.
  const insideEastReturn = state.movementOwner === 'greenway'
    && from.x <= 30 && from.z >= -6
  const westOfEastReturn = state.movementOwner === 'greenway' && from.x <= 30
  const displayRoute = dryDisplayRoute(state.seed)
  const mapTiles = carrier.map.tiles.map((tile) => {
    if (!mapKnown.has(tile.id)) return tile
    const center = { x: (tile.gridX - 3) * WORLD_CELL_METERS,
      z: (tile.gridZ - 3) * WORLD_CELL_METERS }
    const nodeId = markerTiles.get(tile.id)
    return { ...tile,
      ...(east?.id === tile.id && !westOfEastReturn ? { hasEastTrail: true } : {}),
      ...(displayRoute.cells.has(pointKey(center))
        && (!westOfEastReturn || center.x < 30) ? { hasHighlandTrail: true } : {}),
      ...(tile.id === crown.tile.id && shown(tile.id) ? { hasHighlandLandmark: true } : {}),
      ...(nodeId && shown(tile.id) ? { hasHighlandNode: true,
        highlandNodeReady: state.tick >= (readiness.get(nodeId) ?? Infinity) } : {}),
    }
  })
  const carryingStone = owned(progress, 'stone') > 0 && state.highland.landmarkDiscovered
  const eastGreenway = state.movementOwner === 'greenway' && from.x >= 8
  const northGreenway = state.movementOwner === 'greenway' && from.z < -6
  const eastJourney = eastKnown && (eastGreenway || northGreenway)
  const savedLadder = eastJourney ? savedNorthLadderFoot(progress) : null
  const eastWilderness = state.movementOwner === 'streamed' && from.x >= 8
    && from.x <= 560 && from.z < 8 && !inQuarry
  const atFirstRiverBend = eastWilderness && displayRoute.firstBendDry
    && from.x >= 68 && from.x < 104 && from.z > -8 && from.z < 4
  const guidance = carryingStone && (eastGreenway || eastWilderness || inQuarry)
    ? state.movementOwner === 'greenway'
      ? 'Quarry stone in your pack. Return to Greenway Outfitters and sell it for coins.'
      : `Follow the walked quarry path ${knownRouteGuidance(state.seed, from, mapKnown, true)}. Greenway Outfitters buys stone.`
    : inQuarry && crownPrompt ? crownPrompt.actionable
      ? 'Quarry Crown is within reach. Press E or tap Interact to study it.'
      : crownPrompt.action
      : inQuarry && !state.highland.landmarkDiscovered
        ? 'Find Quarry Crown on revealed ground, then stand nearby and study it.'
        : inQuarry && nodePrompt ? nodePrompt.actionable
          ? 'Extract two stone from this discovered shelf, then carry it west to Greenway Outfitters.'
          : nodePrompt.action
          : inQuarry ? 'Survey the exposed rock around Quarry Crown. Stone shelves appear only after you walk to them.'
            : atFirstRiverBend && from.x > 69 && from.z > -2
              ? 'River water blocks the old east trail. Backtrack west along dry ground toward the charted x68 north-bypass entrance, then turn north to the z -4 bank before heading east.'
              : atFirstRiverBend && from.z > -2
                ? 'River water blocks the old east trail. From the dry x68 tile, turn north to the charted z -4 bank before heading east.'
                : atFirstRiverBend
                  ? 'Follow the charted dry bank east near z -4. Avoid the old low trail where the river may cross it.'
            : eastWilderness
              ? `Follow the pale quarry trail ${knownRouteGuidance(state.seed, from, mapKnown, false)}. Unwalked ground stays hidden.`
              : eastJourney && insideEastReturn && savedLadder
                ? `East rock wall blocks the low valley. Return ${bearing(from, savedLadder)} about ${Math.round(distance2(from, savedLadder))} m to your saved north ladder, climb, stay north of the cliff until past x30, then look for supported ground to descend east of the wall.`
                : eastJourney && insideEastReturn
                  ? 'East rock wall blocks the low valley. Build a north cliff ladder with 4 logs, climb it, stay north of the cliff until past x30, then look for supported ground to descend east of the wall.'
                  : eastJourney && northGreenway && from.x <= 30
                    ? 'On the upper shelf, stay north of the cliff (z below -6) and travel east past x30. Look for supported ground to descend on the far side of the rock return.'
                    : eastJourney && northGreenway
                      ? 'You are east of the rock return. Curve south on dry ground to the charted quarry trail, then head east.'
                      : eastJourney
                        ? 'Follow the charted quarry trail east. The rock return is behind you.'
                : null
  const overview = carrier.map.overview
  const mergedResources = [...carrier.resources.filter((resource) =>
    !stoneResources.some((stone) => stone.id === resource.id)), ...stoneResources]
  const mergedLandmarks = [...(carrier.landmarks ?? []).filter((landmark) =>
    landmark.id !== HIGHLAND_LANDMARK.id), ...crownLandmark]
  const visualWorld = visual ? { ...visual,
    resources: [...visual.resources.filter((resource) =>
      !stoneResources.some((stone) => stone.id === resource.id)), ...stoneResources],
    landmarks: [...visual.landmarks.filter((landmark) =>
      landmark.id !== HIGHLAND_LANDMARK.id), ...crownLandmark],
  } : undefined
  const legacyChoices = carrier.checkedActionChoices?.filter((choice) =>
    !choice.id.startsWith('highland:')) ?? []
  return { ...carrier, resources: mergedResources, landmarks: mergedLandmarks,
    ...(visualWorld ? { visualWorld } : {}),
    ...(inQuarry ? { ambience: 'highland-wind' as const,
      unavailableActions: undefined, starterCliff: undefined,
      nearbyInteraction: highlandInteraction ?? carrier.nearbyInteraction,
      highlandExtraction: nodePrompt ? { nodeId: nearbyNode!.id,
        label: nodePrompt.label, actionable: nodePrompt.actionable,
        reason: nodePrompt.actionable ? 'Ready: +2 stone and 20 Excavation XP.' : nodePrompt.action } : undefined,
    } : {}),
    checkedActionChoices: highlandInteraction
      ? [...legacyChoices, { id: highlandInteraction.targetId,
        actionable: highlandInteraction.actionable,
        reason: highlandInteraction.actionable ? null : highlandInteraction.action }]
      : carrier.checkedActionChoices,
    map: { ...carrier.map, tiles: mapTiles,
      ...(guidance ? { guidancePriority: true as const } : {}),
      ...(inQuarry ? { title: 'Highland Quarry' } : {}),
      ...(guidance ? { guidance } : {}),
      ...(mapTiles.some((tile) => tile.hasEastTrail || tile.hasHighlandTrail
        || tile.hasHighlandLandmark || tile.hasHighlandNode)
        ? { legend: `${carrier.map.legend ?? '▲ you · ? unexplored'} · ⇨ east trail · · walked quarry path · Q Quarry Crown · ◆ ready stone · ◌ recovering stone` }
        : {}),
      ...(overview ? { overview: () => withHighlandOverview(overview(), progress) } : {}),
    },
  }
}
