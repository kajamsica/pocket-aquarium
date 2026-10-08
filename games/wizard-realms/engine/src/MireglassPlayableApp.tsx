import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mireglassAnchors, mireglassResources } from './domain/mireglassContent'
import { mireglassApproachTrail } from './domain/mireglassApproachTrail'
import type { MireglassExpeditionAction, MireglassExpeditionEvent, MireglassItemId } from './domain/mireglassExpedition'
import { MIREGLASS_OUTPOST_CATALOG, MIREGLASS_OUTPOST_SELL_PRICES, mireglassGlowRevealableTileIds } from './domain/mireglassExpedition'
import { mireglassRouteSites } from './domain/mireglassRouteSites'
import { MIREGLASS_PLATEAU } from './domain/mireglassTerrain'
import { MIREGLASS_SAVE_KEY, parseMireglassWorld, serializeMireglassWorld } from './domain/mireglassPersistence'
import { createMireglassWorld, createMireglassWorldFromState, type MireglassWorldActionResult, type MireglassWorldAdvanceResult, type MireglassWorldRuntime, type MireglassWorldState } from './domain/mireglassWorld'
import type { StreamedWorldIntent, StreamedWorldRejection, StreamedWorldRuntime, StreamedWorldState } from './domain/streamedWorld'
import { streamedControlIntents, streamedProjection } from './StreamedPreviewApp'
import { WizardSurface, type WizardViewIntent, type WizardViewProjection } from './view'
import type { EquipmentSlot, WizardItemStack, WizardLandmark, WizardTerrainCell } from './view/contracts'

const SEED = 'greenway-alpha'
const STEP_MS = 50
const REACH = 3
export const MIREGLASS_TRAVEL_AUTOSAVE_MS = 5_000
export const shouldAutosaveMireglassTravel = (dirty: boolean, lastSavedMs: number, nowMs: number) =>
  dirty && nowMs - lastSavedMs >= MIREGLASS_TRAVEL_AUTOSAVE_MS
const ITEM_NAMES: Readonly<Record<MireglassItemId, string>> = {
  woodcutters_axe: 'Woodcutter axe', logs: 'Logs', marsh_herb: 'Marsh herb', stone: 'Stone',
  iron_ore: 'Iron ore', apprentice_hat: 'Apprentice hat', traveler_tunic: 'Traveler tunic',
  trail_leggings: 'Trail leggings', leather_boots: 'Leather boots', oak_wand: 'Oak wand',
  wooden_shield: 'Wooden shield', field_spade: 'Field spade', ancient_relic: 'Ancient relic',
  'mireglass_reach/item/seal': 'Mireglass seal', 'mireglass_reach/item/waders': 'Fen waders',
}
const EQUIPPABLE: Partial<Record<MireglassItemId, readonly EquipmentSlot[]>> = {
  woodcutters_axe: ['mainHand'], field_spade: ['mainHand'], 'mireglass_reach/item/waders': ['feet'],
  apprentice_hat: ['head'], traveler_tunic: ['chest'], trail_leggings: ['legs'],
  leather_boots: ['feet'], oak_wand: ['mainHand', 'offHand'], wooden_shield: ['offHand'],
}
const REJECTION_TEXT: Readonly<Record<StreamedWorldRejection['code'], string>> = {
  out_of_bounds: 'The world boundary is here.', terrain_missing: 'Terrain is not active here.',
  airborne: 'You are already airborne.', invalid_value: 'Movement was rejected.',
  fen_channel: 'The fen channel needs a built bridge.', slate_cliff: 'The slate rise needs a built ladder.',
}

export function mireglassBarrierAfterResult(
  current: string | null, result: MireglassWorldAdvanceResult | MireglassWorldActionResult,
): string | null {
  if ('rejections' in result) {
    const rejection = result.rejections[0]
    if (rejection) return REJECTION_TEXT[rejection.code]
    return result.events.some((event) => event.type === 'player_moved') ? null : current
  }
  return result.event?.type === 'route_traversed' ? null : current
}

const STYLES = `
.wr-mireglass{position:fixed;inset:0;background:#14221f}
.wr-mireglass .wr-surface{min-height:0}
.wr-mireglass .wr-topbar,.wr-mireglass .wr-backpack,.wr-mireglass .wr-backpack-toggle,.wr-mireglass .wr-gear,.wr-mireglass .wr-trade,.wr-mireglass .wr-context,.wr-mireglass .wr-prompt,.wr-mireglass .wr-events,.wr-mireglass .wr-focus-note,.wr-mireglass .wr-diagnostics{display:none}
.wr-mireglass-panel{position:absolute;z-index:6;right:14px;top:14px;box-sizing:border-box;width:min(348px,calc(100vw - 28px));max-height:calc(100vh - 28px);overflow:auto;padding:14px;border:1px solid #d0bb8588;border-radius:14px;background:#101b18f2;color:#f6f0db;box-shadow:0 12px 38px #0009;font:13px/1.36 system-ui}
.wr-mireglass-panel h1{margin:0;color:#f3d589;font:700 21px Georgia,serif}.wr-mireglass-panel h2{margin:13px 0 5px;color:#e8c981;font:700 13px system-ui;text-transform:uppercase;letter-spacing:.08em}.wr-mireglass-panel p{margin:5px 0}.wr-mireglass-panel small{color:#afc3b8}.wr-mireglass-panel .warning{color:#ffd4aa}.wr-mireglass-panel .readout{font:11px/1.5 monospace;color:#b9d4c4}.wr-mireglass-panel .status{margin:8px 0;padding:7px;border-radius:7px;background:#273a31;color:#fff0cb}.wr-mireglass-panel .status[data-error=true]{background:#542f2d;color:#ffe0d4}
.wr-mireglass-panel button{box-sizing:border-box;min-height:42px;border:1px solid #c7aa6477;border-radius:7px;background:#344d3f;color:#fff0c7;cursor:pointer}.wr-mireglass-panel button:disabled{opacity:.5;cursor:not-allowed}.wr-mireglass-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px}.wr-mireglass-actions button{padding:7px;text-align:left}.wr-mireglass-actions button small{display:block;font-size:11px}.wr-mireglass-stages{display:grid;gap:3px;padding-left:18px;margin:6px 0}.wr-mireglass-stages li.done{color:#9cd3a4}.wr-mireglass-stages li.pending{color:#ead8aa}.wr-mireglass-top{display:flex;align-items:start;justify-content:space-between;gap:8px}.wr-mireglass-top button{min-width:44px}.wr-mireglass-panel[data-collapsed=true]{width:auto;max-width:min(320px,calc(100vw - 28px))}.wr-mireglass-panel[data-collapsed=true] .wr-mireglass-content{display:none}
.wr-mireglass-save-controls{display:flex;gap:6px;margin:8px 0}.wr-mireglass-save-controls button{padding:5px 10px}.wr-mireglass-save-note{padding:6px;border-radius:6px;background:#293b32;color:#d5e9d8}.wr-mireglass-save-note[data-error=true]{background:#542f2d;color:#ffe0d4}
@media(max-width:719px){.wr-mireglass-panel{top:auto;bottom:calc(144px + env(safe-area-inset-bottom,0px));max-height:43vh}.wr-mireglass-panel[data-collapsed=true]{bottom:calc(144px + env(safe-area-inset-bottom,0px))}.wr-mireglass .wr-map-toggle{top:8px;right:8px}}
@media(min-width:720px) and (max-height:590px){.wr-mireglass-panel{left:8px;right:auto;top:8px;max-height:calc(100vh - 16px);width:min(292px,31vw)}.wr-mireglass .wr-map-toggle{left:auto;right:8px;top:8px}}
`

const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const owned = (state: MireglassWorldState, itemId: MireglassItemId) => state.player.inventory
  .filter((stack) => stack.itemId === itemId).reduce((sum, stack) => sum + stack.quantity, 0)
const stackFor = (itemId: MireglassItemId, quantity: number): WizardItemStack => ({
  id: `inventory-${itemId}`, itemId, name: ITEM_NAMES[itemId], quantity, equippableSlots: EQUIPPABLE[itemId],
})
const routeName = (kind: 'bridge' | 'ladder') => kind === 'bridge' ? 'Fen bridge' : 'Slate ladder'
const pointText = (point: { x: number; z: number }) => `x ${point.x.toFixed(0)}, z ${point.z.toFixed(0)}`
type TrailPoint = { x: number; z: number }
type TrailSegment = { from: readonly [number, number]; to: readonly [number, number] }
const approachTerrainCache = new WeakMap<readonly WizardTerrainCell[], {
  trail: readonly TrailPoint[]; dressed: readonly WizardTerrainCell[]
}>()
const approachLayoutCache = new WeakMap<readonly TrailPoint[], {
  near: ReadonlySet<string>; segments: ReadonlyMap<string, TrailSegment>
}>()
const cellKey = (x: number, z: number) => `${x}:${z}`
const midpoint = (left: TrailPoint, right: TrailPoint): readonly [number, number] =>
  [(left.x + right.x) / 2, (left.z + right.z) / 2]

function approachLayout(trail: readonly TrailPoint[]) {
  const cached = approachLayoutCache.get(trail)
  if (cached) return cached
  const near = new Set<string>()
  const segments = new Map<string, TrailSegment>()
  for (let index = 0; index < trail.length; index += 1) {
    const center = trail[index]
    const from = index === 0 ? [center.x, center.z] as const : midpoint(trail[index - 1], center)
    const to = index === trail.length - 1 ? [center.x, center.z] as const : midpoint(center, trail[index + 1])
    segments.set(cellKey(center.x, center.z), { from, to })
    for (let dx = -4; dx <= 4; dx += 1) for (let dz = -4; dz <= 4; dz += 1) {
      if (dx * dx + dz * dz <= 20) near.add(cellKey(center.x + dx * 4, center.z + dz * 4))
    }
  }
  const layout = { near, segments }
  approachLayoutCache.set(trail, layout)
  return layout
}

/** Dress only dry cells on the canonical marker-to-outpost approach; this has no authority or collision effect. */
export function mireglassApproachTerrain(
  cells: readonly WizardTerrainCell[],
  worldTiles: readonly { id: string; terrain: string }[],
  trail: readonly TrailPoint[],
): readonly WizardTerrainCell[] {
  const cached = approachTerrainCache.get(cells)
  if (cached?.trail === trail) return cached.dressed
  const layout = approachLayout(trail)
  const dryIds = new Set(worldTiles.filter((tile) => tile.terrain !== 'wetland').map((tile) => tile.id))
  const dressed = cells.map((cell) => {
    if (!dryIds.has(cell.id)) return cell
    const x = cell.position[0]
    const z = cell.position[2]
    const key = cellKey(x, z)
    if (!layout.near.has(key)) return cell
    const trailSegment = layout.segments.get(key)
    return { ...cell, mireglassApproach: true,
      ...(trailSegment ? { mireglassTrailSegment: trailSegment } : {}) }
  })
  approachTerrainCache.set(cells, { trail, dressed })
  return dressed
}

export function bearingText(from: { x: number; z: number }, to: { x: number; z: number }): string {
  const dx = to.x - from.x
  const dz = to.z - from.z
  if (Math.hypot(dx, dz) < 1) return 'here'
  const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
  return compass[(Math.round(Math.atan2(dx, -dz) / (Math.PI / 4)) + 8) % 8]
}

export interface MireglassActionChoice {
  id: string
  label: string
  detail: string
  action: MireglassExpeditionAction
  distanceMeters: number
}

/** The tray shows in-reach actions only. The reducer still checks every prerequisite and distance. */
export function mireglassActionChoices(state: MireglassWorldState): MireglassActionChoice[] {
  const { seed, player, expedition } = state
  const choices: MireglassActionChoice[] = []
  const add = (id: string, label: string, detail: string, target: { x: number; y: number; z: number }, action: MireglassExpeditionAction, reach = REACH) => {
    const meters = distance(player.position, target)
    if (meters <= reach) choices.push({ id, label, detail, action, distanceMeters: meters })
  }
  const anchors = mireglassAnchors(seed)
  if (!expedition.fringeMarkerStudied) add('study', 'Study frontier marker', 'Learn Wayfinder Glow', anchors.fringeMarker.tile.center, { type: 'study_fringe_marker' })
  for (const tree of mireglassResources(seed)) {
    if (!expedition.depletedResourceIds.includes(tree.id)) add(`chop:${tree.id}`, 'Chop reserved timber', '+4 logs, requires axe', tree.tile.center, { type: 'chop_tree', resourceId: tree.id })
    else if (!expedition.dugStumpIds.includes(tree.id)) add(`stump:${tree.id}`, 'Dig tree stump', '+30 excavation XP and 1 stone, requires spade', tree.tile.center, { type: 'dig_tree_stump', resourceId: tree.id })
  }
  for (const site of mireglassRouteSites(seed)) {
    const selectedId = expedition.builtRoutes[site.kind]
    if (selectedId === null) add(`build:${site.id}`, `Build ${routeName(site.kind)}`, `${site.logCost} logs`, site.from, { type: 'build_route', siteId: site.id })
    else if (selectedId === site.id) {
      add(`cross:${site.id}:from`, `Cross ${routeName(site.kind)}`, 'To far bank', site.from, { type: 'traverse_route', siteId: site.id, from: 'from' })
      add(`cross:${site.id}:to`, `Return by ${routeName(site.kind)}`, 'To near bank', site.to, { type: 'traverse_route', siteId: site.id, from: 'to' })
    }
  }
  if (player.learnedSpellIds.includes('wayfinder_glow') && (
    mireglassGlowRevealableTileIds(seed, player.position, state.discoveredTileIds).length > 0
    || (!expedition.cacheRevealed && distance(player.position, anchors.sealCache.tile.center) <= 8)
  )) choices.push({ id: 'cast', label: 'Cast Wayfinder Glow', detail: 'Reveal nearby fog and hidden magic',
    action: { type: 'cast_wayfinder_glow' }, distanceMeters: 0 })
  if (expedition.cacheRevealed && !expedition.cacheExcavated) add('excavate', 'Excavate seal cache', 'Requires spade and excavation Lv2', anchors.sealCache.tile.center, { type: 'excavate_cache' })
  add('buy-spade', 'Buy field spade', `${MIREGLASS_OUTPOST_CATALOG.field_spade.price} coins · ${expedition.shopStock.field_spade} left`, anchors.salvager.tile.center, { type: 'buy_item', itemId: 'field_spade' })
  add('buy-waders', 'Buy fen waders', `${MIREGLASS_OUTPOST_CATALOG['mireglass_reach/item/waders'].price} coins · ${expedition.shopStock['mireglass_reach/item/waders']} left`, anchors.salvager.tile.center, { type: 'buy_item', itemId: 'mireglass_reach/item/waders' })
  if (owned(state, 'logs')) add('sell-logs', 'Sell one log', `${MIREGLASS_OUTPOST_SELL_PRICES.logs} coins`, anchors.salvager.tile.center, { type: 'sell_item', itemId: 'logs', quantity: 1 })
  if (owned(state, 'mireglass_reach/item/seal')) add('sell-seal', 'Sell Mireglass seal', `${MIREGLASS_OUTPOST_SELL_PRICES['mireglass_reach/item/seal']} coins`, anchors.salvager.tile.center, { type: 'sell_item', itemId: 'mireglass_reach/item/seal', quantity: 1 })
  for (const itemId of ['woodcutters_axe', 'field_spade', 'mireglass_reach/item/waders'] as const) {
    const slot = itemId === 'mireglass_reach/item/waders' ? 'feet' : 'mainHand'
    if (owned(state, itemId) && player.equipment[slot] !== itemId) choices.push({
      id: `equip:${itemId}`, label: `Equip ${ITEM_NAMES[itemId]}`, detail: `${slot === 'feet' ? 'Feet' : 'Main hand'} slot`,
      action: { type: 'equip_item', itemId }, distanceMeters: 0,
    })
  }
  return choices.sort((a, b) => Number(a.action.type === 'cast_wayfinder_glow')
    - Number(b.action.type === 'cast_wayfinder_glow') || a.distanceMeters - b.distanceMeters || a.label.localeCompare(b.label))
}

/** E performs a world interaction, never an unrequested purchase, gear swap, sale, or spell cast. */
export function mireglassNearestInteractChoice(state: MireglassWorldState): MireglassActionChoice | undefined {
  const worldActions = new Set<MireglassExpeditionAction['type']>([
    'study_fringe_marker', 'chop_tree', 'dig_tree_stump', 'build_route', 'traverse_route', 'excavate_cache',
  ])
  return mireglassActionChoices(state).find((choice) => worldActions.has(choice.action.type))
}

export interface MireglassObjective {
  label: string
  position: { x: number; z: number }
  searchArea?: boolean
  complete?: boolean
}

export function mireglassNextObjective(state: MireglassWorldState): MireglassObjective {
  const { seed, player, expedition } = state
  const anchors = mireglassAnchors(seed)
  const trees = mireglassResources(seed)
  const routes = mireglassRouteSites(seed)
  const closest = <T extends { x: number; y: number; z: number }>(positions: readonly T[]) => [...positions].sort((a, b) => distance(player.position, a) - distance(player.position, b))[0]
  if (!expedition.fringeMarkerStudied) return { label: 'Study the frontier marker to learn Wayfinder Glow', position: anchors.fringeMarker.tile.center }
  if (owned(state, 'field_spade') < 1) return { label: 'Visit the salvager to buy a field spade', position: anchors.salvager.tile.center }
  if (player.skillXp.excavation < 30) {
    const stump = closest(trees.filter((tree) => expedition.depletedResourceIds.includes(tree.id)
      && !expedition.dugStumpIds.includes(tree.id)).map((tree) => tree.tile.center))
    if (stump) return { label: 'Equip the spade and dig a chopped stump to train excavation', position: stump }
    return { label: 'Equip the axe and chop a tree for stump-digging practice', position: closest(trees.filter((tree) => !expedition.depletedResourceIds.includes(tree.id) && tree.phase === 'before_bridge').map((tree) => tree.tile.center)) ?? anchors.fenChannel.tile.center }
  }
  if (owned(state, 'logs') < 8 && expedition.builtRoutes.bridge === null) return { label: 'Equip the axe and chop timber for the fen bridge', position: closest(trees.filter((tree) => !expedition.depletedResourceIds.includes(tree.id) && tree.phase === 'before_bridge').map((tree) => tree.tile.center)) ?? anchors.fenChannel.tile.center }
  if (expedition.builtRoutes.bridge === null) return { label: 'Build the eight-log fen bridge', position: closest(routes.filter((site) => site.kind === 'bridge').map((site) => site.from)) }
  const bridge = routes.find((site) => site.id === expedition.builtRoutes.bridge)!
  const ladder = routes.find((site) => site.id === expedition.builtRoutes.ladder)
  if (expedition.cacheExcavated && owned(state, 'mireglass_reach/item/seal') === 0) {
    if (owned(state, 'mireglass_reach/item/waders') === 0) return {
      label: 'Buy fen waders with the seal proceeds', position: anchors.salvager.tile.center,
    }
    if (player.equipment.feet !== 'mireglass_reach/item/waders') return {
      label: 'Equip your fen waders', position: player.position,
    }
    return { label: 'Expedition complete. Save and reload to verify your progress.',
      position: player.position, complete: true }
  }
  if (expedition.cacheExcavated) {
    if (ladder && player.position.z >= ladder.to.z) return { label: 'Descend the built slate ladder', position: ladder.to }
    if (player.position.z >= bridge.to.z) return { label: 'Return across the built fen bridge', position: bridge.to }
    return { label: 'Return to the salvager and sell the seal', position: anchors.salvager.tile.center }
  }
  if (player.position.z < bridge.to.z) return { label: 'Cross the built fen bridge', position: bridge.from }
  if (expedition.builtRoutes.ladder === null && owned(state, 'logs') < 4) return { label: 'Gather four more logs for the slate ladder', position: closest(trees.filter((tree) => !expedition.depletedResourceIds.includes(tree.id) && tree.phase === 'after_bridge').map((tree) => tree.tile.center)) ?? anchors.slateBerm.tile.center }
  if (expedition.builtRoutes.ladder === null) return { label: 'Build the four-log slate ladder', position: closest(routes.filter((site) => site.kind === 'ladder').map((site) => site.from)) }
  if (ladder && player.position.z < ladder.to.z) return { label: 'Climb the built slate ladder', position: ladder.from }
  if (!expedition.cacheRevealed) return {
    label: 'Search the upper slate shelf and cast Wayfinder Glow where the focus stirs',
    position: { x: (MIREGLASS_PLATEAU.minX + MIREGLASS_PLATEAU.maxX) / 2,
      z: MIREGLASS_PLATEAU.maxZ - 48 }, searchArea: true,
  }
  if (!expedition.cacheExcavated) return { label: player.equipment.mainHand === 'field_spade'
    ? 'Excavate the revealed seal cache' : 'Equip the field spade and excavate the seal cache', position: anchors.sealCache.tile.center }
  return { label: 'Return to the salvager and sell the seal', position: anchors.salvager.tile.center }
}

/** The vendor quote is shown on approach, before the player owns a seal to sell. */
export function mireglassOutpostQuote(state: MireglassWorldState): string | null {
  const salvager = mireglassAnchors(state.seed).salvager
  if (distance(state.player.position, salvager.tile.center) > REACH) return null
  return `Salvager buys Mireglass seals for ${MIREGLASS_OUTPOST_SELL_PRICES['mireglass_reach/item/seal']} coins and logs for ${MIREGLASS_OUTPOST_SELL_PRICES.logs} coins each.`
}

/** Read-only scene adapter. Movement and actions always run through createMireglassWorld. */
export function mireglassViewProjection(runtime: MireglassWorldRuntime, state: MireglassWorldState, messages: readonly string[], selectedSiteId: string | null): WizardViewProjection {
  // streamedProjection reads only activeTiles/tileAtWorld; the campaign runtime owns those same read methods.
  const streamedView = streamedProjection(runtime as unknown as StreamedWorldRuntime, {
    seed: state.seed, tick: state.tick, discoveredTileIds: state.discoveredTileIds,
    player: { position: state.player.position, yaw: state.player.yaw, pitch: state.player.pitch,
      verticalVelocity: state.player.verticalVelocity },
  } satisfies StreamedWorldState, messages)
  const activeIds = new Set(runtime.activeTiles().map((tile) => tile.id))
  const discovered = new Set(state.discoveredTileIds)
  const anchors = mireglassAnchors(state.seed)
  const approachTerrain = mireglassApproachTerrain(streamedView.terrain, runtime.activeTiles(),
    mireglassApproachTrail(state.seed))
  const trees = mireglassResources(state.seed)
  const sites = mireglassRouteSites(state.seed)
  const routeFor = (kind: 'bridge' | 'ladder') => sites.find((site) => site.id === state.expedition.builtRoutes[kind])
    ?? sites.find((site) => site.kind === kind)!
  const builtSites = sites.filter((site) => activeIds.has(runtime.tileAtWorld(site.from.x, site.from.z)?.id ?? '')).map((site) => ({
    id: site.id, routeId: site.routeId, label: `${routeName(site.kind)} at ${pointText(site.from)}`,
    from: [site.from.x, site.from.y, site.from.z] as const, to: [site.to.x, site.to.y, site.to.z] as const,
    logCost: site.logCost, discovered: discovered.has(runtime.tileAtWorld(site.from.x, site.from.z)?.id ?? ''),
    status: state.expedition.builtRoutes[site.kind] === site.id ? 'built' as const
      : state.expedition.builtRoutes[site.kind] !== null ? 'obstructed' as const
      : owned(state, 'logs') < site.logCost ? 'needs_logs' as const
      : distance(state.player.position, site.from) > REACH ? 'too_far' as const : 'ready' as const,
    reason: state.expedition.builtRoutes[site.kind] === site.id ? 'Built here'
      : state.expedition.builtRoutes[site.kind] !== null ? 'Another site was built'
      : owned(state, 'logs') < site.logCost ? `Need ${site.logCost} logs`
      : distance(state.player.position, site.from) > REACH ? 'Move within three meters of the approach' : 'Ready to build',
  }))
  const inventory = state.player.inventory.map((stack) => stackFor(stack.itemId, stack.quantity))
  const equipped = (slot: EquipmentSlot) => state.player.equipment[slot]
    ? stackFor(state.player.equipment[slot]!, 1) : null
  const tradeListing = (slotIndex: 0 | 1 | 2 | 3) => {
    const slot = state.player.tradeSlots[slotIndex]
    return slot.itemId ? { id: `trade-${slotIndex}`, itemName: ITEM_NAMES[slot.itemId],
      quantity: slot.quantity, unitPrice: slot.unitPrice } : null
  }
  const store = anchors.salvager
  const storeTile = runtime.tileAtWorld(store.tile.center.x, store.tile.center.z)
  const visibleAnchor = (tileId: string) => activeIds.has(tileId) && discovered.has(tileId)
  const positionOf = (center: { x: number; y: number; z: number }) =>
    [center.x, center.y, center.z] as const
  const landmarks: WizardLandmark[] = []
  if (visibleAnchor(anchors.fringeMarker.tile.id)) landmarks.push({
    id: 'mireglass_reach/landmark/fringe_marker', kind: 'frontier-marker',
    position: positionOf(anchors.fringeMarker.tile.center), studied: state.expedition.fringeMarkerStudied,
  })
  if (visibleAnchor(anchors.bellAlder.tile.id)) landmarks.push({
    id: 'mireglass_reach/landmark/bell_alder', kind: 'bell-alder',
    position: positionOf(anchors.bellAlder.tile.center),
  })
  if (activeIds.has(anchors.sealCache.tile.id)
    && (discovered.has(anchors.sealCache.tile.id) || state.expedition.cacheRevealed)) landmarks.push({
    id: 'mireglass_reach/dig/seal_cache', kind: 'seal-cache',
    position: positionOf(anchors.sealCache.tile.center),
    revealed: state.expedition.cacheRevealed, excavated: state.expedition.cacheExcavated,
  })
  const resourceTileIds = new Set(trees.filter((tree) => !state.expedition.depletedResourceIds.includes(tree.id)).map((tree) => tree.tile.id))
  const siteTileIds = new Set(builtSites.filter((site) => site.discovered && site.status !== 'built' && site.status !== 'obstructed').map((site) => runtime.tileAtWorld(site.from[0], site.from[2])?.id))
  const builtTileIds = new Set(builtSites.filter((site) => site.discovered && site.status === 'built').map((site) => runtime.tileAtWorld(site.from[0], site.from[2])?.id))
  return {
    ...streamedView,
    terrain: approachTerrain,
    map: { ...streamedView.map, title: 'Mireglass expedition (v6)',
      legend: '▲ you · ◇ route site · ✓ built route · ✦ revealed cache · S outpost · • timber · ? undiscovered',
      tiles: streamedView.map.tiles.map((tile) => ({ ...tile,
        hasResource: tile.discovered && resourceTileIds.has(tile.id),
        hasStore: tile.discovered && tile.id === storeTile?.id,
        hasRouteSite: tile.discovered && siteTileIds.has(tile.id),
        hasBuiltRoute: tile.discovered && builtTileIds.has(tile.id),
        hasCache: state.expedition.cacheRevealed && tile.id === anchors.sealCache.tile.id,
      })) },
    resources: trees.filter((tree) => activeIds.has(tree.tile.id)).map((tree) => ({
      id: tree.id, kind: 'tree' as const, label: 'Mireglass timber',
      position: [tree.tile.center.x, tree.tile.center.y, tree.tile.center.z] as const,
      available: !state.expedition.depletedResourceIds.includes(tree.id),
    })),
    routes: (['bridge', 'ladder'] as const).map((kind) => {
      const site = routeFor(kind)
      return { id: site.routeId, label: routeName(kind),
        from: [site.from.x, site.from.y, site.from.z] as const,
        to: [site.to.x, site.to.y, site.to.z] as const,
        built: state.expedition.builtRoutes[kind] !== null, unlocked: true, logCost: site.logCost }
    }),
    buildSites: builtSites,
    landmarks,
    selectedBuildSiteId: selectedSiteId,
    stores: activeIds.has(store.tile.id) ? [{ id: store.id, name: 'Mireglass salvager',
      position: [store.tile.center.x, store.tile.center.y, store.tile.center.z],
      listings: [{ id: 'field_spade', name: ITEM_NAMES.field_spade, price: MIREGLASS_OUTPOST_CATALOG.field_spade.price,
        stock: state.expedition.shopStock.field_spade },
      { id: 'mireglass_reach/item/waders', name: ITEM_NAMES['mireglass_reach/item/waders'],
        price: MIREGLASS_OUTPOST_CATALOG['mireglass_reach/item/waders'].price,
        stock: state.expedition.shopStock['mireglass_reach/item/waders'] }],
      sellOffers: (['logs', 'mireglass_reach/item/seal'] as const)
        .filter((itemId) => owned(state, itemId) > 0)
        .map((itemId) => ({ itemId, name: ITEM_NAMES[itemId], quantity: owned(state, itemId),
          unitPrice: MIREGLASS_OUTPOST_SELL_PRICES[itemId] })) }] : [],
    nearbyStoreId: distance(state.player.position, store.tile.center) <= REACH ? store.id : null,
    openStoreId: null,
    backpack: { capacity: state.player.backpackCapacity, stacks: inventory },
    coins: state.player.coins,
    experience: { xp: state.player.xp % 100, nextLevelXp: 100, level: state.player.level },
    equipment: { head: equipped('head'), chest: equipped('chest'), legs: equipped('legs'), feet: equipped('feet'),
      mainHand: equipped('mainHand'), offHand: equipped('offHand') },
    skillXp: { ...state.player.skillXp }, learnedSpellIds: [...state.player.learnedSpellIds],
    tradeListings: [tradeListing(0), tradeListing(1), tradeListing(2), tradeListing(3)],
    nearbyInteraction: null,
    recentEvents: messages,
  }
}

function eventText(event: MireglassExpeditionEvent): string {
  switch (event.type) {
    case 'tree_chopped': return 'Chopped timber: +4 logs and woodcutting XP.'
    case 'tree_stump_dug': return 'Dug a stump: +1 stone and 30 excavation XP.'
    case 'fringe_marker_studied': return event.learned
      ? 'Studied the marker and learned Wayfinder Glow.' : 'Studied the marker; Wayfinder Glow was already known.'
    case 'route_built': return `Built ${routeName(event.kind)} for ${event.logCost} logs.`
    case 'route_traversed': return `Crossed the ${event.routeId.includes('fen') ? 'fen bridge' : 'slate ladder'}.`
    case 'cache_revealed': return 'Wayfinder Glow revealed the seal cache.'
    case 'terrain_revealed': return `Wayfinder Glow revealed ${event.revealedTileIds.length} nearby map tiles.`
    case 'cache_excavated': return 'Excavated the Mireglass seal.'
    case 'item_bought': return `Bought ${ITEM_NAMES[event.itemId]} for ${event.price} coins.`
    case 'item_sold': return `Sold ${event.quantity} ${ITEM_NAMES[event.itemId]} for ${event.totalPrice} coins.`
    case 'item_equipped': return `Equipped ${ITEM_NAMES[event.itemId]}.`
  }
}

/** Fresh skill and inventory state, but a frontier dev spawn avoids a several-minute walk from Greenway. */
export function createMireglassDevWorld(seed = SEED): MireglassWorldRuntime {
  const frontier = mireglassAnchors(seed).fringeMarker.tile.center
  return createMireglassWorld(seed, undefined, { x: frontier.x, z: frontier.z })
}

export type MireglassLoadMode = 'fresh' | 'resumed' | 'invalid' | 'storage-error'
export interface MireglassLoadResult {
  runtime: MireglassWorldRuntime
  mode: MireglassLoadMode
  notice: string
}

/** A bad v6 save is left byte-for-byte intact and never replaced by an automatic fresh start. */
export function loadMireglassDevWorld(storage: Pick<Storage, 'getItem'>, seed = SEED): MireglassLoadResult {
  let raw: string | null
  try { raw = storage.getItem(MIREGLASS_SAVE_KEY) }
  catch { return { runtime: createMireglassDevWorld(seed), mode: 'storage-error',
    notice: 'Browser storage could not be read. This session is in memory only; use Save to retry.' } }
  if (raw === null) return { runtime: createMireglassDevWorld(seed), mode: 'fresh',
    notice: 'New v6 journey. Actions save immediately; travel saves periodically.' }
  const parsed = parseMireglassWorld(raw, seed)
  if (parsed) {
    try { return { runtime: createMireglassWorldFromState(parsed), mode: 'resumed',
      notice: 'Resumed the validated v6 Mireglass save.' } }
    catch { /* Preserve bytes and require explicit replacement, just like a parser rejection. */ }
  }
  return { runtime: createMireglassDevWorld(seed), mode: 'invalid',
    notice: 'Existing v6 save is invalid or from another revision. Its bytes were preserved. This temporary session will not autosave.' }
}

export type MireglassSaveResult = { ok: true } | { ok: false; message: string }
/** Writes only the separate v6 key. Never reads or migrates the v5 world. */
export function saveMireglassDevWorld(storage: Pick<Storage, 'setItem'>, state: MireglassWorldState): MireglassSaveResult {
  try {
    const bytes = serializeMireglassWorld(state)
    storage.setItem(MIREGLASS_SAVE_KEY, bytes)
    return { ok: true }
  } catch {
    return { ok: false, message: 'Save failed. Browser storage may be unavailable or full; current progress remains in memory.' }
  }
}

export function MireglassPlayableApp() {
  const [initial] = useState<MireglassLoadResult>(() => {
    try { return loadMireglassDevWorld(window.localStorage) }
    catch { return { runtime: createMireglassDevWorld(), mode: 'storage-error',
      notice: 'Browser storage is unavailable. This session is in memory only; use Save to retry.' } }
  })
  const [runtime, setRuntime] = useState(initial.runtime)
  const [state, setState] = useState(runtime.state)
  const [saveMode, setSaveMode] = useState<MireglassLoadMode>(initial.mode)
  const [saveNotice, setSaveNotice] = useState(initial.notice)
  const [messages, setMessages] = useState<string[]>([initial.mode === 'resumed'
    ? 'Welcome back to Mireglass Reach.' : 'Frontier dev start. Study the marker, then equip your axe.'])
  const [error, setError] = useState(false)
  const [movementBarrierStatus, setMovementBarrierStatus] = useState<string | null>(null)
  const [statusSource, setStatusSource] = useState<'action' | 'movement'>('action')
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const movement = useRef<readonly [number, number]>([0, 0])
  const queued = useRef<StreamedWorldIntent[]>([])
  const clock = useRef<{ last: number | null; accrued: number }>({ last: null, accrued: 0 })
  const invalidSave = useRef(initial.mode === 'invalid')
  const autosavePaused = useRef(initial.mode === 'invalid' || initial.mode === 'storage-error')
  const travelDirty = useRef(false)
  const lastTravelSave = useRef(performance.now())

  const persist = useCallback((snapshot: MireglassWorldState, explicit = false) => {
    if (invalidSave.current || (autosavePaused.current && !explicit)) return false
    let result: MireglassSaveResult
    try { result = saveMireglassDevWorld(window.localStorage, snapshot) }
    catch { result = { ok: false, message: 'Save failed. Browser storage is unavailable; progress remains in memory.' } }
    if (!result.ok) {
      autosavePaused.current = true
      setSaveMode('storage-error')
      setSaveNotice(result.message)
      return false
    }
    autosavePaused.current = false
    travelDirty.current = false
    lastTravelSave.current = performance.now()
    setSaveMode('resumed')
    setSaveNotice('Mireglass v6 progress saved on this device.')
    return true
  }, [])

  const report = useCallback((text: string, rejected = false) => {
    setError(rejected)
    setMessages((current) => [...current.slice(-2), text])
    setStatusSource('action')
  }, [])
  const act = useCallback((action: MireglassExpeditionAction) => {
    const result = runtime.act(action)
    setState(result.state)
    report(result.rejection ? result.rejection.message : eventText(result.event), !!result.rejection)
    if (result.event?.type === 'route_traversed') setMovementBarrierStatus((current) => mireglassBarrierAfterResult(current, result))
    if (result.event) persist(result.state)
  }, [runtime, report, persist])

  useEffect(() => {
    const reset = () => { movement.current = [0, 0]; queued.current = []; clock.current = { last: null, accrued: 0 } }
    const onVisibility = () => {
      if (document.hidden) persist(runtime.state)
      reset()
    }
    const onBlur = () => { persist(runtime.state); reset() }
    const timer = window.setInterval(() => {
      if (document.hidden) return
      const now = performance.now()
      const tickClock = clock.current
      tickClock.accrued += tickClock.last === null ? 0 : Math.max(0, now - tickClock.last)
      tickClock.last = now
      const steps = Math.min(12, Math.floor(tickClock.accrued / STEP_MS))
      tickClock.accrued = steps === 12 ? 0 : tickClock.accrued - steps * STEP_MS
      if (!steps) return
      for (let index = 0; index < steps; index += 1) {
        const intents = [...(index === 0 ? queued.current : []), ...streamedControlIntents(runtime.state.player.yaw, movement.current)]
        const result = runtime.advance(intents)
        if (result.events.some((event) => event.type === 'player_moved' || event.type === 'player_looked'
          || event.type === 'player_jumped' || event.type === 'tile_discovered')) travelDirty.current = true
        if (result.rejections[0] || result.events.some((event) => event.type === 'player_moved')) {
          setMovementBarrierStatus((current) => mireglassBarrierAfterResult(current, result))
          setStatusSource(result.rejections[0] ? 'movement' : 'action')
        }
      }
      queued.current = []
      setState(runtime.state)
      if (shouldAutosaveMireglassTravel(travelDirty.current, lastTravelSave.current, now)) persist(runtime.state)
    }, STEP_MS)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('blur', onBlur) }
  }, [runtime, report, persist])

  const choices = useMemo(() => mireglassActionChoices(state), [state])
  const onIntent = useCallback((intent: WizardViewIntent) => {
    if (intent.type === 'movement') movement.current = intent.vector
    else if (intent.type === 'movement.tap') queued.current.push(...streamedControlIntents(runtime.state.player.yaw, intent.vector))
    else if (intent.type === 'jump') queued.current.push({ type: 'jump' })
    else if (intent.type === 'interact') {
      const nearest = mireglassNearestInteractChoice(runtime.state)
      if (nearest) act(nearest.action)
      else report('No nearby world interaction. Use an explicit tray button for gear, spells, or trade.', true)
    } else if (intent.type === 'build-site.select') {
      setSelectedSiteId(intent.siteId)
      if (intent.siteId) report('Route site selected. Follow its coordinates, then build within three meters.')
    }
    else if (intent.type === 'build-site.confirm') act({ type: 'build_route', siteId: intent.siteId })
    else if (intent.type === 'spell.cast') act({ type: 'cast_wayfinder_glow' })
    else if (intent.type === 'store.select-listing' && (intent.listingId === 'field_spade' || intent.listingId === 'mireglass_reach/item/waders')) act({ type: 'buy_item', itemId: intent.listingId })
    else if (intent.type === 'store.sell-item' && (intent.itemId === 'logs' || intent.itemId === 'mireglass_reach/item/seal')) act({ type: 'sell_item', itemId: intent.itemId, quantity: intent.quantity })
    else if (intent.type === 'equipment.equip') {
      const itemId = intent.stackId.replace(/^inventory-/, '')
      if (itemId === 'woodcutters_axe' || itemId === 'field_spade' || itemId === 'mireglass_reach/item/waders') act({ type: 'equip_item', itemId })
      else report('That equipment action is not part of this dev journey.', true)
    } else report('This action is not implemented in the Mireglass dev journey.', true)
  }, [runtime, act, report])
  const projection = useMemo(() => mireglassViewProjection(runtime, state, messages, selectedSiteId), [runtime, state, messages, selectedSiteId])
  const objective = useMemo(() => mireglassNextObjective(state), [state])
  const progress = state.expedition
  const player = state.player
  const replaceInvalidSave = () => {
    const fresh = createMireglassDevWorld()
    let result: MireglassSaveResult
    try { result = saveMireglassDevWorld(window.localStorage, fresh.state) }
    catch { result = { ok: false, message: 'Save failed. Browser storage is unavailable; the existing bytes were preserved.' } }
    if (!result.ok) { setSaveNotice(result.message); return }
    invalidSave.current = false
    autosavePaused.current = false
    travelDirty.current = false
    lastTravelSave.current = performance.now()
    movement.current = [0, 0]
    queued.current = []
    setRuntime(fresh)
    setState(fresh.state)
    setSelectedSiteId(null)
    setSaveMode('resumed')
    setSaveNotice('Started a new v6 frontier save. The previous invalid bytes were replaced by your explicit choice.')
    report('New frontier journey started.')
  }
  const selectedSite = selectedSiteId ? mireglassRouteSites(state.seed).find((site) => site.id === selectedSiteId) : undefined
  const nearMeters = distance(player.position, { ...objective.position, y: runtime.tileAtWorld(objective.position.x, objective.position.z)?.center.y ?? player.position.y })
  const sealSold = progress.cacheExcavated && owned(state, 'mireglass_reach/item/seal') === 0
  const outpostQuote = mireglassOutpostQuote(state)

  return <main className="wr-mireglass">
    <WizardSurface projection={projection} onIntent={onIntent} />
    <style>{STYLES}</style>
    <aside className="wr-mireglass-panel" data-collapsed={collapsed} aria-label="Mireglass expedition controls">
      <div className="wr-mireglass-top"><h1>Mireglass Reach</h1><button type="button" aria-label={collapsed ? 'Expand expedition controls' : 'Collapse expedition controls'} onClick={() => setCollapsed((value) => !value)}>{collapsed ? 'Open' : '−'}</button></div>
      <div className="wr-mireglass-content">
        <p className="warning">Frontier dev spawn skips travel only; starter skills and items are ordinary. Mireglass uses its own v6 save; v5 saves are untouched.</p>
        <p className="wr-mireglass-save-note" data-error={saveMode === 'invalid' || saveMode === 'storage-error'} role="status">{saveNotice}</p>
        <div className="wr-mireglass-save-controls">
          <button type="button" disabled={saveMode === 'invalid'} onClick={() => persist(runtime.state, true)}>Save now</button>
          {saveMode === 'invalid' && <button type="button" onClick={replaceInvalidSave}>Replace invalid save with fresh start</button>}
        </div>
        <p><b>Next:</b> {objective.label}</p>
        {!objective.complete && <p className="readout">{objective.searchArea
          ? 'Search area: upper slate shelf. The cache has no exact waypoint until revealed.'
          : `Target ${bearingText(player.position, objective.position)} · ${pointText(objective.position)} · ${nearMeters.toFixed(0)}m away`}</p>}
        {outpostQuote && <p className="readout">{outpostQuote}</p>}
        {selectedSite && <p className="readout">Selected {routeName(selectedSite.kind)} site: {bearingText(player.position, selectedSite.from)} · {pointText(selectedSite.from)} · {distance(player.position, selectedSite.from).toFixed(0)}m away</p>}
        <p className="readout">You: x {player.position.x.toFixed(1)}, y {player.position.y.toFixed(1)}, z {player.position.z.toFixed(1)} · {player.coins} coins · {state.discoveredTileIds.length} tiles</p>
        <p className="readout">Pack {player.inventory.reduce((sum, stack) => sum + stack.quantity, 0)}/{player.backpackCapacity}: {player.inventory.map((stack) => `${ITEM_NAMES[stack.itemId]} ×${stack.quantity}`).join(', ') || 'empty'}</p>
        <p className="readout">Hand: {player.equipment.mainHand ? ITEM_NAMES[player.equipment.mainHand] : 'empty'} · Feet: {player.equipment.feet ? ITEM_NAMES[player.equipment.feet] : 'empty'} · Glow: {player.learnedSpellIds.includes('wayfinder_glow') ? 'learned' : 'unknown'} · Excavation Lv{1 + Math.floor(player.skillXp.excavation / 30)}</p>
        <p className="readout">W/S move · A/D turn · Space jump · E nearest action · M map</p>
        <div className="status" data-error={statusSource === 'movement' && movementBarrierStatus !== null || error} role="status">{statusSource === 'movement' && movementBarrierStatus !== null ? movementBarrierStatus : messages.at(-1)}</div>
        <h2>Available here</h2>
        <div className="wr-mireglass-actions">{choices.map((choice) => <button type="button" key={choice.id} onClick={() => act(choice.action)}>{choice.label}<small>{choice.detail}</small></button>)}</div>
        {!choices.length && <p><small>Walk toward the next target. The map shows discovered routes and resources.</small></p>}
        <h2>Expedition path</h2>
        <ol className="wr-mireglass-stages">
          <li className={progress.fringeMarkerStudied ? 'done' : 'pending'}>Study the frontier marker</li>
          <li className={owned(state, 'field_spade') ? 'done' : 'pending'}>Buy a field spade</li>
          <li className={player.skillXp.excavation >= 30 ? 'done' : 'pending'}>Dig a chopped stump to train excavation</li>
          <li className={progress.builtRoutes.bridge ? 'done' : 'pending'}>Gather logs and build the fen bridge</li>
          <li className={progress.builtRoutes.ladder ? 'done' : 'pending'}>Cross and build the slate ladder</li>
          <li className={progress.cacheRevealed ? 'done' : 'pending'}>Cast Glow at the cache</li>
          <li className={progress.cacheExcavated ? 'done' : 'pending'}>Excavate the seal</li>
          <li className={sealSold ? 'done' : 'pending'}>Return to the salvager and trade</li>
          <li className={player.equipment.feet === 'mireglass_reach/item/waders' ? 'done' : 'pending'}>Buy and equip fen waders</li>
        </ol>
      </div>
    </aside>
  </main>
}
