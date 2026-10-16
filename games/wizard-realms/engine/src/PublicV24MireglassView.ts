import { mireglassAnchors, mireglassFairyRing, mireglassResources, MIREGLASS_RING_ID } from './domain/mireglassContent'
import { applyMireglassExpeditionAction, MIREGLASS_OUTPOST_CATALOG,
  MIREGLASS_OUTPOST_SELL_PRICES } from './domain/mireglassExpedition'
import { applyMireglassHerbForage, HERB_CYCLE_TICKS } from './domain/mireglassHerbForaging'
import { mireglassHerbPatches } from './domain/mireglassHerbPatches'
import { mireglassFrontierRoute, mireglassFullApproachTrail,
  mireglassV42FullApproachTrail } from './domain/mireglassApproachTrail'
import { mireglassPlateauAt } from './domain/mireglassTerrain'
import type { PublicV24MireglassAction } from './domain/publicWorldV24MireglassAction'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import type { PublicV23Progress } from './domain/publicWorldV23Snapshot'
import type { PublicV17ActiveView } from './PublicV17WorldView'
import type { WizardInteractionPrompt, WizardLandmark, WizardResourceNode,
  WizardViewProjection } from './view/contracts'
type Action = Exclude<PublicV24MireglassAction,
  { type: 'traverse_route' | 'build_route' }>
export type PublicV24MireglassChoiceId =
  | 'mireglass:study:fringe_marker' | 'mireglass:discover:ring'
  | 'mireglass:cast:wayfinder_glow' | 'mireglass:excavate:seal_cache'
  | `mireglass:chop:${string}` | `mireglass:stump:${string}`
  | `mireglass:forage:${string}` | `mireglass:buy:${string}`
  | `mireglass:sell:${string}` | `mireglass:sell-all:${string}`
  | `mireglass:equip:${string}`
export interface PublicV24MireglassChoice {
  id: PublicV24MireglassChoiceId
  label: string
  detail: string
  action: Action
  distanceMeters: number
  /** Only a checked world interaction may be selected by the generic E key. */
  genericInteract: boolean
  actionable: boolean
  disabledReason: string | null
}
export interface PublicV24MireglassView {
  projection: WizardViewProjection
  choices: readonly PublicV24MireglassChoice[]
  defaultInteractionId: PublicV24MireglassChoiceId | null
}
const REACH = 3
const point = (value: { x: number; y: number; z: number }) =>
  [value.x, value.y, value.z] as const
const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
function prompt(choice: PublicV24MireglassChoice): WizardInteractionPrompt {
  const { type } = choice.action
  return { kind: type === 'study_fringe_marker' ? 'inscription'
    : type === 'discover_fairy_ring' ? 'fairy-ring'
      : type === 'excavate_cache' || type === 'dig_tree_stump' ? 'dig-site' : 'resource',
  targetId: choice.id, label: choice.label,
  action: choice.actionable ? choice.label : choice.disabledReason ?? choice.detail,
  actionable: choice.actionable }
}
/** Overlay only canonical, locally discovered Mireglass facts on a V23 scene. */
export function projectPublicV24Mireglass(base: WizardViewProjection,
  progress: PublicV23Progress & { terrain?: { columns: readonly {
    gx: number; gz: number; openDepth: number }[] } },
  active: PublicV17ActiveView,
  routeRevision: 'legacy' | 'v42-center-bridge' = 'legacy'): PublicV24MireglassView {
  const { state } = progress
  if (state.movementOwner !== 'streamed') return {
    projection: base, choices: [], defaultInteractionId: null,
  }
  const { seed, player, mireglass } = state
  const v42Route = routeRevision === 'v42-center-bridge'
  const trail = v42Route ? mireglassV42FullApproachTrail(seed) : mireglassFullApproachTrail(seed)
  const trailTileIds = new Set(trail.map(({ x, z }) =>
    `tile-${x / 4 + 3}-${z / 4 + 3}`))
  const trailTiles = base.map.tiles.map((tile) => ({ ...tile,
    hasFrontierTrail: tile.discovered && (tile.hasFrontierTrail === true
      || trailTileIds.has(tile.id)) }))
  const nearTrail = v42Route && trail.some((point) => Math.hypot(
    player.position.x - point.x, player.position.z - point.z) <= 8)
  const oldOnlyConnector = v42Route && !nearTrail && base.map.title === 'mireglass_reach'
    && mireglassFullApproachTrail(seed)
    .some((point) => Math.hypot(player.position.x - point.x,
      player.position.z - point.z) <= 8)
  const region = nearTrail || base.map.title === 'mireglass_reach' && !oldOnlyConnector
  if (!region) return { projection: { ...base, map: { ...base.map, tiles: trailTiles,
    ...(trailTiles.some((tile) => tile.hasFrontierTrail) ? {
      legend: `${base.map.legend ?? '▲ you · ? unexplored'} · · marked frontier trail`,
    } : {}) } }, choices: [], defaultInteractionId: null }
  const visible = new Set((base.visualWorld?.terrain ?? base.terrain).map((tile) => tile.id))
  const known = new Set(active.activeKnownTileIds)
  const shown = (id: string) => visible.has(id) && known.has(id)
  const activeTiles = new Map(active.activeTiles.map((tile) => [tile.id, tile]))
  const anchors = mireglassAnchors(seed)
  const naturalShelfTileIds = new Set(active.activeTiles.filter((tile) =>
    known.has(tile.id) && mireglassPlateauAt(seed, tile.center.x, tile.center.z) !== null)
    .map((tile) => tile.id))
  const openPitTileIds = new Set(progress.terrain?.columns.filter((pit) => pit.openDepth > 0)
    .map((pit) => `tile-${pit.gx + 3}-${pit.gz + 3}`) ?? [])
  const trees = mireglassResources(seed)
  const dryTimber = trees.filter((tree) => shown(tree.tile.id)
    && !mireglass.depletedResourceIds.includes(tree.id)
    && tree.tile.terrain === 'loam' && activeTiles.get(tree.tile.id)?.terrain === 'loam'
    && !progress.terrain?.columns.some((pit) => pit.gx === tree.tile.gridX - 3
      && pit.gz === tree.tile.gridZ - 3 && pit.openDepth > 0))
  const dryTimberTileIds = new Set(dryTimber.map((tree) => tree.tile.id))
  const herbs = mireglassHerbPatches(seed)
  const ring = mireglassFairyRing(seed)
  const cycle = Math.floor(state.tick / HERB_CYCLE_TICKS)
  const owned = (itemId: string) => player.inventory.filter((stack) => stack.itemId === itemId)
    .reduce((sum, stack) => sum + stack.quantity, 0)
  const resources: WizardResourceNode[] = [
    ...trees.filter((tree) => shown(tree.tile.id)).map((tree) => ({ id: tree.id,
      kind: 'tree' as const, label: 'Mireglass timber', position: point(tree.tile.center),
      available: !mireglass.depletedResourceIds.includes(tree.id),
      ...(dryTimberTileIds.has(tree.tile.id) ? { visualKind: 'mireglass-timber' as const } : {}) })),
    ...herbs.filter((herb) => shown(herb.tile.id)).map((herb) => ({ id: herb.id,
      kind: 'herb' as const, label: 'Marsh herb patch', position: point(herb.tile.center),
      available: !mireglass.herbHarvestCycles.some((entry) =>
        entry.patchId === herb.id && entry.cycle >= cycle) })),
  ]
  const landmarks: WizardLandmark[] = []
  if (shown(anchors.fringeMarker.tile.id)) landmarks.push({
    id: 'mireglass_reach/landmark/fringe_marker', kind: 'frontier-marker',
    position: point(anchors.fringeMarker.tile.center), studied: mireglass.fringeMarkerStudied,
  })
  if (shown(anchors.bellAlder.tile.id)) landmarks.push({
    id: 'mireglass_reach/landmark/bell_alder', kind: 'bell-alder',
    position: point(anchors.bellAlder.tile.center),
  })
  if (mireglass.cacheRevealed && shown(anchors.sealCache.tile.id)) landmarks.push({
    id: 'mireglass_reach/dig/seal_cache', kind: 'seal-cache',
    position: point(activeTiles.get(anchors.sealCache.tile.id)?.center
      ?? anchors.sealCache.tile.center),
    revealed: true, excavated: mireglass.cacheExcavated,
  })
  const ringVisible = shown(ring.tile.id)
  const rings = ringVisible ? [{ id: MIREGLASS_RING_ID, label: 'Mireglass Ring',
    position: point(ring.tile.center),
    discovered: player.discoveredRingIds.includes(MIREGLASS_RING_ID),
    // Discovery is V24 scope; no legacy teleport action is exposed here.
    destinations: [] }] : []
  const outpost = anchors.salvager
  const outpostVisible = shown(outpost.tile.id)
  const outpostNear = outpostVisible && distance(player.position, outpost.tile.center) <= REACH
  const store = outpostVisible ? [{ id: outpost.id, name: 'Mireglass salvager',
    position: point(outpost.tile.center),
    listings: (['field_spade', 'mireglass_reach/item/waders'] as const).map((itemId) => ({
      id: itemId, name: itemId === 'field_spade' ? 'Field spade' : 'Fen waders',
      price: MIREGLASS_OUTPOST_CATALOG[itemId].price, stock: mireglass.shopStock[itemId],
    })),
    sellOffers: (['logs', 'mireglass_reach/item/seal'] as const)
      .filter((itemId) => owned(itemId) > 0).map((itemId) => ({ itemId,
        name: itemId === 'logs' ? 'Logs' : 'Mireglass seal', quantity: owned(itemId),
        unitPrice: MIREGLASS_OUTPOST_SELL_PRICES[itemId] })),
  }] : []
  const surface = resolvePublicV23Surface(state, player.position,
    progress.regionalWorks.builtLadderIds)
  const readinessReason = !surface || player.verticalVelocity !== 0
    || Math.abs(player.position.y - surface.floorY) > 1e-6
    ? 'Stand on grounded terrain to interact.'
    : !Number.isSafeInteger(state.eventSequence + 1)
      ? 'The world event sequence cannot advance.' : null
  const choices: PublicV24MireglassChoice[] = []
  const add = (id: PublicV24MireglassChoiceId, label: string, detail: string,
    target: { x: number; y: number; z: number }, action: Action,
    genericInteract: boolean) => {
    const distanceMeters = distance(player.position, target)
    if (distanceMeters > REACH) return
    const result = action.type === 'forage_herb'
      ? applyMireglassHerbForage(seed, player, mireglass, state.tick, action.patchId)
      : applyMireglassExpeditionAction(seed, player, mireglass,
        action.type === 'cast_wayfinder_glow_wide' ? { type: 'cast_wayfinder_glow' } : action,
        active.activeKnownTileIds, true, action.type === 'cast_wayfinder_glow_wide')
    choices.push({ id, label, detail, action, distanceMeters, genericInteract,
      actionable: !readinessReason && !result.rejection,
      disabledReason: readinessReason ?? result.rejection?.message ?? null })
  }
  if (shown(anchors.fringeMarker.tile.id) && !mireglass.fringeMarkerStudied) add(
    'mireglass:study:fringe_marker', 'Study frontier marker', 'Learn Wayfinder Glow',
    anchors.fringeMarker.tile.center, { type: 'study_fringe_marker' }, true)
  if (ringVisible && !player.discoveredRingIds.includes(MIREGLASS_RING_ID)) add(
    'mireglass:discover:ring', 'Discover Mireglass ring', 'Chart the fairy ring',
    ring.tile.center, { type: 'discover_fairy_ring' }, true)
  for (const tree of trees) if (shown(tree.tile.id)) {
    if (!mireglass.depletedResourceIds.includes(tree.id)) add(`mireglass:chop:${tree.id}`,
      'Chop Mireglass timber', 'Requires an equipped axe', tree.tile.center,
      { type: 'chop_tree', resourceId: tree.id }, true)
    else if (!mireglass.dugStumpIds.includes(tree.id)) add(`mireglass:stump:${tree.id}`,
      'Dig timber stump', 'Requires an equipped spade', tree.tile.center,
      { type: 'dig_tree_stump', resourceId: tree.id }, true)
  }
  for (const herb of herbs) if (shown(herb.tile.id)) add(`mireglass:forage:${herb.id}`,
    'Gather marsh herb', 'One herb per regrowth cycle', herb.tile.center,
    { type: 'forage_herb', patchId: herb.id }, true)
  if (mireglass.cacheRevealed && !mireglass.cacheExcavated
    && shown(anchors.sealCache.tile.id)) add('mireglass:excavate:seal_cache',
    'Excavate seal cache', 'Requires a field spade and Excavation Lv2',
    anchors.sealCache.tile.center, { type: 'excavate_cache' }, true)
  if (player.learnedSpellIds.includes('wayfinder_glow') && region) {
    add('mireglass:cast:wayfinder_glow', 'Cast Wayfinder Glow',
      'Survey farther terrain; hidden magic still needs proximity', player.position,
      { type: 'cast_wayfinder_glow_wide' }, false)
  }
  if (outpostNear) {
    for (const itemId of ['field_spade', 'mireglass_reach/item/waders'] as const) add(
      `mireglass:buy:${itemId}`, `Buy ${itemId === 'field_spade' ? 'field spade' : 'fen waders'}`,
      `${MIREGLASS_OUTPOST_CATALOG[itemId].price} coins`, outpost.tile.center,
      { type: 'buy_item', itemId }, false)
    for (const itemId of ['logs', 'mireglass_reach/item/seal'] as const) if (owned(itemId)) add(
      `mireglass:sell:${itemId}`, `Sell ${itemId === 'logs' ? 'one log' : 'Mireglass seal'}`,
      `${MIREGLASS_OUTPOST_SELL_PRICES[itemId]} coins`, outpost.tile.center,
      { type: 'sell_item', itemId, quantity: 1 }, false)
    for (const itemId of ['logs', 'mireglass_reach/item/seal'] as const) if (owned(itemId) > 1) add(
      `mireglass:sell-all:${itemId}`, `Sell all ${owned(itemId)} ${itemId === 'logs' ? 'logs' : 'seals'}`,
      `${MIREGLASS_OUTPOST_SELL_PRICES[itemId] * owned(itemId)} coins`, outpost.tile.center,
      { type: 'sell_item', itemId, quantity: owned(itemId) }, false)
  }
  for (const itemId of ['woodcutters_axe', 'field_spade', 'leather_boots',
    'mireglass_reach/item/waders'] as const)
    if (owned(itemId) && player.equipment[itemId === 'mireglass_reach/item/waders'
      || itemId === 'leather_boots' ? 'feet' : 'mainHand'] !== itemId)
      add(`mireglass:equip:${itemId}`, `Equip ${itemId.replaceAll('_', ' ')}`,
        'Explicit gear choice', player.position, { type: 'equip_item', itemId }, false)
  const generic = choices.filter((choice) => choice.genericInteract)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id))
  const nearest = generic.find((choice) => choice.actionable) ?? generic[0] ?? null
  const defaultInteractionId = nearest?.actionable ? nearest.id : null
  const resourceTiles = new Set([
    ...dryTimberTileIds, ...herbs.map((herb) => herb.tile.id),
  ])
  const projection: WizardViewProjection = { ...base,
    // V14's starter-only HUD gate must not suppress regional V24 interactions.
    starterCliff: undefined, unavailableActions: undefined,
    unsupportedEquipmentUnequipReason: 'Mireglass supports equipping another item to switch gear, but not unequipping yet.',
    checkedEquipmentChoices: choices.filter((choice) => choice.action.type === 'equip_item')
      .map((choice) => ({ itemId: (choice.action as Extract<Action, { type: 'equip_item' }>).itemId,
        actionable: choice.actionable, reason: choice.disabledReason })),
    checkedActionChoices: choices.map((choice) => ({ id: choice.id,
      actionable: choice.actionable, reason: choice.disabledReason })),
    unsupportedTradeListingsReason: 'Player trade listings are not available in Mireglass yet; use the salvager to sell items.',
    backpack: { ...base.backpack, stacks: base.backpack.stacks.map((stack) =>
      stack.itemId === 'mireglass_reach/item/waders'
        ? { ...stack, equippableSlots: ['feet' as const] } : stack) },
    resources: [...base.resources, ...resources], fairyRings: [...base.fairyRings, ...rings],
    stores: [...base.stores, ...store], landmarks: [...(base.landmarks ?? []), ...landmarks],
    nearbyStoreId: outpostNear ? outpost.id : base.nearbyStoreId,
    nearbyInteraction: nearest ? prompt(nearest) : outpostNear
      ? { kind: 'store', targetId: outpost.id, label: 'Mireglass salvager',
        action: 'Open salvager trade', actionable: true } : null,
    ...(base.visualWorld ? { visualWorld: { ...base.visualWorld,
      resources: [...base.visualWorld.resources, ...resources],
      fairyRings: [...base.visualWorld.fairyRings, ...rings],
      stores: [...base.visualWorld.stores, ...store],
      landmarks: [...base.visualWorld.landmarks, ...landmarks],
    } } : {}),
    map: { ...base.map, ...(region ? { title: 'Mireglass Reach',
      guidance: !mireglass.fringeMarkerStudied
        ? v42Route
          ? `${progress.greenwayWorks.builtBridgeIds.includes(mireglassFrontierRoute(seed).requiredBridgeId)
            ? 'Cross the built center Greenway creek bridge'
            : 'Build the center Greenway creek bridge before crossing'}, then follow the revealed dry trail and study the frontier marker.`
          : 'Follow the dry west trail and study the frontier marker.'
        : !mireglass.cacheRevealed
          ? 'Explore the fen and slate shelf. Use Works for crossings and cast Wayfinder Glow.'
          : !mireglass.cacheExcavated
            ? 'Equip a field spade and excavate the revealed seal cache.'
            : 'Return to the salvager to trade, then explore onward.',
      cacheLabel: 'revealed seal cache',
      legend: '▲ you · · marked frontier trail · M marker · S salvager · R ring · ✦ revealed cache · ♣ harvestable timber · • marsh herb/resource · ? unexplored',
    } : {}), tiles: trailTiles.map((tile) => ({ ...tile,
      hasFrontierMarker: tile.hasFrontierMarker || tile.discovered
        && tile.id === anchors.fringeMarker.tile.id,
      hasResource: tile.hasResource || tile.discovered && resourceTiles.has(tile.id),
      hasMireglassTimber: tile.discovered && tile.terrain === 'loam'
        && dryTimberTileIds.has(tile.id),
      hasNaturalMireglassShelf: tile.discovered && naturalShelfTileIds.has(tile.id)
        && tile.elevationMeters === undefined && !openPitTileIds.has(tile.id)
        && !(mireglass.cacheExcavated && tile.id === anchors.sealCache.tile.id),
      hasStore: tile.hasStore || tile.discovered && tile.id === outpost.tile.id,
      hasRing: tile.hasRing || tile.discovered && tile.id === ring.tile.id,
      hasCache: tile.hasCache || tile.discovered && mireglass.cacheRevealed
        && tile.id === anchors.sealCache.tile.id,
    })) },
  }
  return { projection, choices, defaultInteractionId }
}
