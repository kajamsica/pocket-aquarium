import { useEffect, useRef, useState } from 'react'
import { publicV14MovementIntents } from './PublicV14Controller'
import { publicV17ActionForView, publicV17ReticleAimX, publicV17SuggestedWorkAimX,
  publicV17WorkRouteForView } from './PublicV17Controller'
import { createPublicV17InputTrace, publicV17InputTraceEnabled } from './PublicV17InputScheduler'
import { createPublicV23ControllerRuntime, createPublicV24ControllerRuntime,
  createPublicV25ControllerRuntime } from './PublicV23ControllerRuntime'
import { createPublicV26ControllerRuntime, createPublicV27ControllerRuntime } from './PublicV26ControllerRuntime'
import { createPublicV28ControllerRuntime } from './PublicV28ControllerRuntime'
import { createPublicV29ControllerRuntime } from './PublicV29ControllerRuntime'
import type { PublicV29DigOutcome } from './PublicV29ControllerRuntime'
import { createPublicV30ControllerRuntime } from './PublicV30ControllerRuntime'
import { createPublicV31ControllerRuntime } from './PublicV31ControllerRuntime'
import { createPublicV32ControllerRuntime } from './PublicV32ControllerRuntime'
import { createPublicV33ControllerRuntime } from './PublicV33ControllerRuntime'
import { createPublicV34ControllerRuntime } from './PublicV34ControllerRuntime'
import { createPublicV35ControllerRuntime } from './PublicV35ControllerRuntime'
import { createPublicV36ControllerRuntime } from './PublicV36ControllerRuntime'
import { createPublicV37ControllerRuntime } from './PublicV37ControllerRuntime'
import { projectPublicV37Windward } from './PublicV37WorldView'
import { createPublicV38ControllerRuntime } from './PublicV38ControllerRuntime'
import { projectPublicV38Signal } from './PublicV38WorldView'
import type { PublicV38EntryBindings } from './PublicV38Entry'
import { commitPublicV38, requestPublicV38ReturnHome } from './domain/publicWorldV38Flow'
import type { PublicV38Start } from './domain/publicWorldV38Flow'
import type { PublicV38SignalWitness, PublicV38SignalProgress } from './domain/publicWorldV38SignalAction'
import { createPublicV39ControllerRuntime } from './PublicV39ControllerRuntime'
import { projectPublicV39Ringkeeper } from './PublicV39WorldView'
import type { PublicV39EntryBindings } from './PublicV39Entry'
import { commitPublicV39, requestPublicV39ReturnHome } from './domain/publicWorldV39Flow'
import type { PublicV39Start } from './domain/publicWorldV39Flow'
import type { PublicV39RingWitness, PublicV39RingProgress } from './domain/publicWorldV39RingAction'
import { createPublicV40ControllerRuntime } from './PublicV40ControllerRuntime'
import { projectPublicV40Waystation } from './PublicV40WorldView'
import type { PublicV40EntryBindings } from './PublicV40Entry'
import { commitPublicV40, requestPublicV40ReturnHome } from './domain/publicWorldV40Flow'
import type { PublicV40Start } from './domain/publicWorldV40Flow'
import type { PublicV40WaystationProgress, PublicV40WaystationWitness } from './domain/publicWorldV40WaystationAction'
import { createPublicV41ControllerRuntime } from './PublicV41ControllerRuntime'
import { projectPublicV41IronHall } from './PublicV41WorldView'
import type { PublicV41EntryBindings } from './PublicV41Entry'
import { commitPublicV41, requestPublicV41ReturnHome } from './domain/publicWorldV41Flow'
import type { PublicV41Start } from './domain/publicWorldV41Flow'
import type { PublicV41CombatProgress, PublicV41CombatWitness } from './domain/publicWorldV41CombatAction'
import { createPublicV42ControllerRuntime } from './PublicV42ControllerRuntime'
import { projectPublicV42IronHall } from './PublicV42WorldView'
import type { PublicV42EntryBindings } from './PublicV42Entry'
import { commitPublicV42, requestPublicV42ReturnHome } from './domain/publicWorldV42Flow'
import type { PublicV42Start } from './domain/publicWorldV42Flow'
import type { PublicV42RewardProgress, PublicV42RewardWitness } from './domain/publicWorldV42RewardAction'
import { publicV42IronHallRejectionHint } from './view/publicV42IronHallQuest'
import type { PublicV37EntryBindings } from './PublicV37Entry'
import { commitPublicV37, requestPublicV37ReturnHome } from './domain/publicWorldV37Flow'
import type { PublicV37Start } from './domain/publicWorldV37Flow'
import type { PublicV37WindwardWitness } from './domain/publicWorldV37WindwardAction'
import type { PublicV23EntryBindings } from './PublicV23Entry'
import type { PublicV24EntryBindings } from './PublicV24Entry'
import type { PublicV25EntryBindings } from './PublicV25Entry'
import type { PublicV26EntryBindings } from './PublicV26Entry'
import type { PublicV27EntryBindings } from './PublicV27Entry'
import type { PublicV28EntryBindings } from './PublicV28Entry'
import type { PublicV29EntryBindings } from './PublicV29Entry'
import type { PublicV30EntryBindings } from './PublicV30Entry'
import type { PublicV31EntryBindings } from './PublicV31Entry'
import type { PublicV32EntryBindings } from './PublicV32Entry'
import type { PublicV33EntryBindings } from './PublicV33Entry'
import type { PublicV34EntryBindings } from './PublicV34Entry'
import type { PublicV35EntryBindings } from './PublicV35Entry'
import type { PublicV36EntryBindings } from './PublicV36Entry'
import { projectPublicV24Mireglass } from './PublicV24MireglassView'
import type { PublicV24MireglassChoice, PublicV24MireglassChoiceId } from './PublicV24MireglassView'
import { publicV23HasWestStripSite, publicV23ReticleAimZ,
  publicWorldV23ViewProjection } from './PublicV23WorldView'
import type { PublicV17ActiveView } from './PublicV17WorldView'
import { publicWorldV26ViewProjection } from './PublicV26WorldView'
import { publicWorldV28ViewProjection } from './PublicV28WorldView'
import { projectPublicV29WorldView } from './PublicV29WorldView'
import { projectPublicV30WorldView } from './PublicV30WorldView'
import { projectPublicV31WorldView } from './PublicV31WorldView'
import { projectPublicV32WorldView, PUBLIC_V32_CROWN_INTERACTION_ID,
  publicV32NodeInteractionId } from './PublicV32WorldView'
import { projectPublicV33FairyRingView } from './PublicV33WorldView'
import { publicV11Gait } from './domain/publicWorldGait'
import { mireglassAnchors, mireglassResources } from './domain/mireglassContent'
import { mireglassApproachTrail } from './domain/mireglassApproachTrail'
import { mireglassRouteSites } from './domain/mireglassRouteSites'
import { mireglassMoveBarrier } from './domain/mireglassMovementGate'
import { MIREGLASS_ENVELOPES, mireglassFenBankAt,
  mireglassPlateauAt } from './domain/mireglassTerrain'
import { discoveryMaskHasTileId } from './domain/discoveryMask'
import { waystationRiverSite } from './domain/waystationRiverContent'
import type { PublicWorldIntent } from './domain/publicWorldRuntime'
import { commitPublicV23 } from './domain/publicWorldV23Flow'
import type { PublicV23Start } from './domain/publicWorldV23Flow'
import { commitPublicV24 } from './domain/publicWorldV24Flow'
import type { PublicV24Start } from './domain/publicWorldV24Flow'
import { commitPublicV25 } from './domain/publicWorldV25Flow'
import type { PublicV25Start } from './domain/publicWorldV25Flow'
import { commitPublicV26, requestPublicV26ReturnHome } from './domain/publicWorldV26Flow'
import type { PublicV26Start } from './domain/publicWorldV26Flow'
import { commitPublicV27, requestPublicV27ReturnHome } from './domain/publicWorldV27Flow'
import type { PublicV27Start } from './domain/publicWorldV27Flow'
import { commitPublicV28, requestPublicV28ReturnHome } from './domain/publicWorldV28Flow'
import type { PublicV28Start } from './domain/publicWorldV28Flow'
import type { PublicV28Progress } from './domain/publicWorldV28Migration'
import { commitPublicV29, requestPublicV29ReturnHome } from './domain/publicWorldV29Flow'
import type { PublicV29Start } from './domain/publicWorldV29Flow'
import type { PublicV29Progress } from './domain/publicWorldV29Migration'
import type { PublicV29Witness } from './domain/publicWorldV29Snapshot'
import { commitPublicV30, requestPublicV30ReturnHome } from './domain/publicWorldV30Flow'
import type { PublicV30Start } from './domain/publicWorldV30Flow'
import type { PublicV30Progress } from './domain/publicWorldV30Migration'
import { commitPublicV31, requestPublicV31ReturnHome } from './domain/publicWorldV31Flow'
import type { PublicV31Start } from './domain/publicWorldV31Flow'
import type { PublicV31Progress } from './domain/publicWorldV31Migration'
import { publicV31HasRaisedSoilCell } from './domain/publicWorldV31Soil'
import type { PublicV31SoilWitness } from './domain/publicWorldV31Soil'
import { HIGHLAND_LANDMARK } from './domain/highlandContent'
import { commitPublicV32, requestPublicV32ReturnHome } from './domain/publicWorldV32Flow'
import type { PublicV32Start } from './domain/publicWorldV32Flow'
import type { PublicV32Progress } from './domain/publicWorldV32Migration'
import type { PublicV32HighlandWitness } from './domain/publicWorldV32Highland'
import { decodePublicV33FairyRingWitness } from './domain/publicWorldV33FairyRing'
import type { PublicV33FairyRingWitness } from './domain/publicWorldV33FairyRing'
import { commitPublicV33, requestPublicV33ReturnHome } from './domain/publicWorldV33Flow'
import type { PublicV33Start } from './domain/publicWorldV33Flow'
import { commitPublicV34, requestPublicV34ReturnHome } from './domain/publicWorldV34Flow'
import type { PublicV34Start } from './domain/publicWorldV34Flow'
import { commitPublicV35, requestPublicV35ReturnHome } from './domain/publicWorldV35Flow'
import type { PublicV35Start } from './domain/publicWorldV35Flow'
import { previewPublicV35LedgerAction } from './domain/publicWorldV35LedgerAction'
import type { PublicV35LedgerWitness, PublicV35Progress } from './domain/publicWorldV35LedgerAction'
import { commitPublicV36, requestPublicV36ReturnHome } from './domain/publicWorldV36Flow'
import type { PublicV36Start } from './domain/publicWorldV36Flow'
import { previewPublicV36MarkerAction } from './domain/publicWorldV36MarkerAction'
import type { PublicV36MarkerProgress, PublicV36MarkerWitness } from './domain/publicWorldV36MarkerAction'
import { resolvePublicV28RiverBridge } from './domain/publicWorldV28RiverBridgeSites'
import { publicV25RiverCellAtGrid } from './domain/publicWorldV25River'
import type { PublicV26Progress } from './domain/publicWorldV26Migration'
import { WORLD_CELL_METERS, worldTileAtGrid } from './domain/worldChunks'
import { parseTerrainWorkId, resolveTerrainWorkSite } from './domain/terrainWorks'
import { terrainWorkSupportAt } from './domain/terrainWorkSupport'
import type { PublicV24Witness } from './domain/publicWorldV24Snapshot'
import { publicV23PlacementId, resolvePublicV23Site } from './domain/publicWorldV23Sites'
import type { WizardViewIntent, WizardViewProjection } from './view/contracts'
import { planDevRoute } from './view/devNavigation'
import { publicV25NorthLadderGuidance } from './view/WizardHud'
import { surveyorCrossingQuest } from './view/surveyorCrossingQuest'
import { publicV35LedgerQuest } from './view/publicV35LedgerQuest'
import { publicV36MarkerQuest, publicV36MarkerRejectionMessage } from './view/publicV36MarkerQuest'
import { WizardSurface } from './view/WizardSurface'

type Runtime = ReturnType<typeof createPublicV23ControllerRuntime>
type V24Runtime = ReturnType<typeof createPublicV24ControllerRuntime>
type V25Runtime = ReturnType<typeof createPublicV25ControllerRuntime>
type V26Runtime = ReturnType<typeof createPublicV26ControllerRuntime>
type V27Runtime = ReturnType<typeof createPublicV27ControllerRuntime>
type V28Runtime = ReturnType<typeof createPublicV28ControllerRuntime>
type V29Runtime = ReturnType<typeof createPublicV29ControllerRuntime>
type V30Runtime = ReturnType<typeof createPublicV30ControllerRuntime>
type V31Runtime = ReturnType<typeof createPublicV31ControllerRuntime>
type V32Runtime = ReturnType<typeof createPublicV32ControllerRuntime>
type V33Runtime = ReturnType<typeof createPublicV33ControllerRuntime>
type V34Runtime = ReturnType<typeof createPublicV34ControllerRuntime>
type V35Runtime = ReturnType<typeof createPublicV35ControllerRuntime>
type V36Runtime = ReturnType<typeof createPublicV36ControllerRuntime>
type V37Runtime = ReturnType<typeof createPublicV37ControllerRuntime>
type V38Runtime = ReturnType<typeof createPublicV38ControllerRuntime>
type V39Runtime = ReturnType<typeof createPublicV39ControllerRuntime>
type V40Runtime = ReturnType<typeof createPublicV40ControllerRuntime>
type V41Runtime = ReturnType<typeof createPublicV41ControllerRuntime>
type V42Runtime = ReturnType<typeof createPublicV42ControllerRuntime>
type V33PlusRuntime = V33Runtime | V34Runtime | V35Runtime | V36Runtime | V37Runtime | V38Runtime | V39Runtime | V40Runtime | V41Runtime | V42Runtime
type V32PlusRuntime = V32Runtime | V33PlusRuntime
type ActiveViewSource = Readonly<{ status: () => { saveRevision: number; pendingFrames: number }
  view: () => PublicV17ActiveView }>
type ActiveViewMemo = { runtime: ActiveViewSource; saveRevision: number; pendingFrames: number
  value: PublicV17ActiveView }
/** Reuse one defensive runtime clone while its checked preview identity is unchanged. */
export function publicV23ReadActiveView(runtime: ActiveViewSource,
  memo: { current: ActiveViewMemo | null }, status = runtime.status()): PublicV17ActiveView {
  const cached = memo.current
  if (cached?.runtime === runtime && cached.saveRevision === status.saveRevision
    && cached.pendingFrames === status.pendingFrames) return cached.value
  const value = runtime.view()
  memo.current = { runtime, saveRevision: status.saveRevision,
    pendingFrames: status.pendingFrames, value }
  return value
}
type MireglassWitness = Extract<PublicV24Witness, { kind: 'mireglass-action/v1' }>
type TerrainWitness = Readonly<{ kind: 'terrain-action/v1'; action: Readonly<{
  kind: 'dig' | 'fill'; gx: number; gz: number }> }>
type PitLadderWitness = Readonly<{ kind: 'pit-ladder/v1'; action: Readonly<{
  kind: 'place-pit-ladder'; gx: number; gz: number }> }>
type ReturnHomeRequest = Readonly<{ kind: 'return-home-request' }>
type WorkKind = 'bridge' | 'ladder' | 'dig'
type CheckedIntent = PublicWorldIntent | { id: string; kind: 'regional-work' | 'legacy-work' }
  | { id: string; kind: 'river-bridge/v1' }
  | { kind: 'bridgehead-claim/v1'; bridgeId: string }
  | PublicV31SoilWitness
  | PublicV32HighlandWitness
  | PublicV33FairyRingWitness
  | PublicV35LedgerWitness
  | PublicV36MarkerWitness
  | PublicV37WindwardWitness
  | PublicV38SignalWitness
  | PublicV39RingWitness
  | PublicV40WaystationWitness
  | PublicV41CombatWitness
  | PublicV42RewardWitness
  | Extract<PublicV29Witness, { kind: 'mining-tool/v1' | 'deep-dig' | 'sell-mineral/v1' }>
  | MireglassWitness | TerrainWitness | PitLadderWitness | ReturnHomeRequest
type InputToken = { kind: 'pulse'; vector: readonly [number, number]; jump: boolean }
  | { kind: 'checked'; intent: CheckedIntent }
const STEP_MS = 50
const MOVE_RESERVE_AT = 96
const MAX_PULSES = 16
const OBSTACLE_CUE_MS = 3500
const SALVAGER_LEG_CELLS = 8
const REJOIN_RADIUS_CELLS = 24
const REJOIN_MAX_VISITS = 1200
const FEN_TIMBER_POCKET = { minX: -336, maxX: -304, minZ: 304, maxZ: 336 } as const
const FEN_TIMBER_TARGET = { ...FEN_TIMBER_POCKET,
  maxX: FEN_TIMBER_POCKET.maxX - WORLD_CELL_METERS,
  maxZ: FEN_TIMBER_POCKET.maxZ - WORLD_CELL_METERS } as const
const FEN_BANK_TARGET = { minX: MIREGLASS_ENVELOPES.fenChannel.minX,
  maxX: MIREGLASS_ENVELOPES.fenChannel.maxX - WORLD_CELL_METERS,
  minZ: MIREGLASS_ENVELOPES.fenChannel.minZ - WORLD_CELL_METERS,
  maxZ: MIREGLASS_ENVELOPES.fenChannel.minZ - WORLD_CELL_METERS } as const
const SLATE_LOWER_APPROACH = { minX: MIREGLASS_ENVELOPES.slateBerm.minX,
  maxX: MIREGLASS_ENVELOPES.slateBerm.maxX,
  minZ: MIREGLASS_ENVELOPES.slateBerm.minZ - 3 * WORLD_CELL_METERS,
  maxZ: MIREGLASS_ENVELOPES.slateBerm.minZ + WORLD_CELL_METERS } as const
const salvagerLegCache = new Map<string, readonly number[]>()
type FenWorkSite = Exclude<NonNullable<ReturnType<typeof resolveTerrainWorkSite>>, { kind: 'dig' }>
const fenWorksSiteCache = new Map<string, readonly FenWorkSite[]>()
const gridAt = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)
const gridKey = (gx: number, gz: number) => `${gx},${gz}`
function fenWorksSites(seed: string): readonly FenWorkSite[] {
  const cached = fenWorksSiteCache.get(seed)
  if (cached) return cached
  const sites = mireglassRouteSites(seed).flatMap((route) => {
    if (route.kind !== 'bridge') return []
    const site = resolveTerrainWorkSite(seed,
      `works1:bridge:${gridAt(route.from.x)}:${gridAt(route.from.z) + 1}:z`)
    return site?.kind === 'bridge' && site.obstacle === 'fen_channel'
      && site.from.x === route.from.x && site.from.z === route.from.z ? [site] : []
  })
  fenWorksSiteCache.set(seed, sites)
  if (fenWorksSiteCache.size > 8) fenWorksSiteCache.delete(fenWorksSiteCache.keys().next().value!)
  return sites
}
function dryDirectLine(seed: string, from: Readonly<{ x: number; z: number }>,
  to: Readonly<{ x: number; z: number }>): boolean {
  const distance = Math.hypot(to.x - from.x, to.z - from.z)
  if (distance > 64) return false
  const steps = Math.max(1, Math.ceil(distance))
  const tileAt = (point: Readonly<{ x: number; z: number }>) => worldTileAtGrid(seed,
    Math.ceil(point.x / WORLD_CELL_METERS - 0.5),
    Math.ceil(point.z / WORLD_CELL_METERS - 0.5))
  let previous = from, previousTile = tileAt(from)
  if (previousTile.terrain === 'wetland') return false
  for (let step = 1; step <= steps; step += 1) {
    const point = { x: from.x + (to.x - from.x) * step / steps,
      z: from.z + (to.z - from.z) * step / steps }
    const tile = tileAt(point)
    if (tile.terrain === 'wetland' || Math.abs(tile.center.y - previousTile.center.y) > 0.8
      || mireglassMoveBarrier(seed, previous, point) !== null) return false
    previous = point; previousTile = tile
  }
  return true
}
function salvagerLegEnds(seed: string, trail: readonly Readonly<{ x: number; z: number }>[]): readonly number[] {
  const cached = salvagerLegCache.get(seed)
  if (cached) return cached
  const ends: number[] = []
  for (let from = 0; from < trail.length - 1;) {
    let to = Math.min(from + SALVAGER_LEG_CELLS, trail.length - 1)
    while (to > from && !dryDirectLine(seed, trail[from], trail[to])) to -= 1
    if (to === from) throw new Error(`No dry salvager leg for ${seed}`)
    ends.push(to); from = to
  }
  salvagerLegCache.set(seed, ends)
  if (salvagerLegCache.size > 8) salvagerLegCache.delete(salvagerLegCache.keys().next().value!)
  return ends
}
function routeBearing(view: WizardViewProjection, target: Readonly<{ x: number; z: number }>) {
  const dx = target.x - view.player.position[0], dz = target.z - view.player.position[2]
  const meters = Math.round(Math.hypot(dx, dz))
  const compass = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'] as const
  const direction = compass[(Math.round(Math.atan2(dx, -dz) / (Math.PI / 8)) + 16) % 16]
  return { meters, direction }
}
function frontierMarkerRoute(view: WizardViewProjection): string {
  const { meters, direction } = routeBearing(view,
    mireglassAnchors(view.seed).fringeMarker.tile.center)
  return `Mireglass frontier marker: ${meters < 1 ? 'here' : `${direction}, about ${meters} m direct`}. North is up on the map; stay on revealed dry ground.`
}
/** A tile-stable, bounded search over this frame's saved, discovered map surface. */
function knownDryWaypoint(view: WizardViewProjection,
  trail: readonly Readonly<{ x: number; z: number }>[] | null,
  openPitColumns: readonly Readonly<{ gx: number; gz: number; openDepth: number }>[],
  targetZone = FEN_BANK_TARGET, frontierZone?: Readonly<{
    minX: number; maxX: number; minZ: number; maxZ: number }>, upperFloorY?: number):
  Readonly<{ x: number; z: number; atFrontier?: boolean }> | null {
  const startX = gridAt(view.player.position[0]), startZ = gridAt(view.player.position[2])
  const openPits = new Set(openPitColumns.filter((column) => column.openDepth > 0)
    .map((column) => gridKey(column.gx, column.gz)))
  const heights = new Map(view.terrain.map((cell) => [cell.id, cell.position[1]] as const))
  const cells = new Map<string, { x: number; z: number; y: number }>()
  for (const tile of view.map.tiles) {
    const gx = tile.gridX - 3, gz = tile.gridZ - 3
    if (!tile.discovered || tile.terrain === null || tile.terrain === 'wetland'
      || publicV25RiverCellAtGrid(view.seed, gx, gz)
      || openPits.has(gridKey(gx, gz))
      || Math.abs(gx - startX) > REJOIN_RADIUS_CELLS
      || Math.abs(gz - startZ) > REJOIN_RADIUS_CELLS) continue
    const y = tile.elevationMeters ?? heights.get(tile.id)
    if (y === undefined || upperFloorY !== undefined && (
      mireglassPlateauAt(view.seed, gx * WORLD_CELL_METERS,
        gz * WORLD_CELL_METERS) === null || Math.abs(y - upperFloorY) > 0.15)) continue
    cells.set(gridKey(gx, gz), { x: gx * WORLD_CELL_METERS,
      z: gz * WORLD_CELL_METERS, y })
  }
  const start = gridKey(startX, startZ)
  if (!cells.has(start)) return null
  const trailIds = new Set(trail?.map((tile) => gridKey(gridAt(tile.x), gridAt(tile.z))))
  const unknownPocket = new Set(frontierZone ? view.map.tiles.filter((tile) => {
    const x = (tile.gridX - 3) * WORLD_CELL_METERS
    const z = (tile.gridZ - 3) * WORLD_CELL_METERS
    return !tile.discovered && x >= frontierZone.minX && x < frontierZone.maxX
      && z >= frontierZone.minZ && z < frontierZone.maxZ
      && (upperFloorY === undefined || mireglassPlateauAt(view.seed, x, z) === 'interior')
  }).map((tile) => gridKey(tile.gridX - 3, tile.gridZ - 3)) : [])
  const targetDistance = (cell: { x: number; z: number }) => Math.hypot(
    Math.max(targetZone.minX - cell.x, 0, cell.x - targetZone.maxX),
    Math.max(targetZone.minZ - cell.z, 0, cell.z - targetZone.maxZ))
  const parent = new Map<string, string>([[start, start]])
  const queue = [start]
  let goal: string | null = null
  let frontierGoal: string | null = null
  let bestDistance = targetDistance(cells.get(start)!)
  for (let head = 0; head < queue.length && head < REJOIN_MAX_VISITS; head += 1) {
    const key = queue[head]
    if (trail && key !== start && trailIds.has(key)) { goal = key; break }
    const current = cells.get(key)!
    if (frontierZone && [[-1, 0], [0, 1], [1, 0], [0, -1]].some(([dx, dz]) =>
      unknownPocket.has(gridKey(gridAt(current.x) + dx, gridAt(current.z) + dz)))) {
      frontierGoal = key; goal = key; break
    }
    if (!trail && !frontierZone && targetDistance(current) < bestDistance - 1e-6) {
      goal = key; bestDistance = targetDistance(current)
    }
    for (const [dx, dz] of [[-1, 0], [0, 1], [1, 0], [0, -1]]) {
      const nextKey = gridKey(gridAt(current.x) + dx, gridAt(current.z) + dz)
      const next = cells.get(nextKey)
      if (!next || parent.has(nextKey) || Math.abs(current.y - next.y) > 0.8
        || mireglassMoveBarrier(view.seed, current, next) !== null
        || mireglassMoveBarrier(view.seed, next, current) !== null) continue
      parent.set(nextKey, key); queue.push(nextKey)
    }
  }
  if (frontierZone && !frontierGoal) return null
  if (frontierGoal === start) return { ...cells.get(start)!, atFrontier: true }
  if (!goal || !trail && !frontierGoal
    && bestDistance > targetDistance(cells.get(start)!) - WORLD_CELL_METERS / 2)
    return null
  const path: string[] = []
  for (let key = goal; key !== start; key = parent.get(key)!) path.push(key)
  path.push(start); path.reverse()
  const playerFrom = { x: view.player.position[0], z: view.player.position[2] }
  const from = cells.get(start)!
  if (mireglassMoveBarrier(view.seed, playerFrom, from) !== null
    || mireglassMoveBarrier(view.seed, from, playerFrom) !== null) return null
  const safeLine = (origin: Readonly<{ x: number; z: number }>,
    target: Readonly<{ x: number; z: number }>) => {
    const meters = Math.hypot(target.x - origin.x, target.z - origin.z)
    if (meters > SALVAGER_LEG_CELLS * WORLD_CELL_METERS + 1) return false
    let previous: Readonly<{ x: number; z: number }> = origin
    let previousCell = cells.get(start)!
    for (let step = 1, count = Math.max(1, Math.ceil(meters)); step <= count; step += 1) {
      const point = { x: origin.x + (target.x - origin.x) * step / count,
        z: origin.z + (target.z - origin.z) * step / count }
      const cell = cells.get(gridKey(gridAt(point.x), gridAt(point.z)))
      if (!cell || Math.abs(gridAt(point.x) - gridAt(previous.x))
          + Math.abs(gridAt(point.z) - gridAt(previous.z)) > 1
        || Math.abs(cell.y - previousCell.y) > 0.8
        || mireglassMoveBarrier(view.seed, previous, point) !== null
        || mireglassMoveBarrier(view.seed, point, previous) !== null) return false
      previous = point; previousCell = cell
    }
    return true
  }
  for (let index = Math.min(path.length - 1, SALVAGER_LEG_CELLS); index > 0; index -= 1) {
    const target = cells.get(path[index])!
    if (safeLine(from, target) && safeLine(playerFrom, target)) return target
  }
  if (Math.hypot(playerFrom.x - from.x, playerFrom.z - from.z) >= 0.5
    && safeLine(playerFrom, from)) return from
  return null
}
function knownDryEastRetreat(view: WizardViewProjection, eastX: number,
  openPitColumns: readonly Readonly<{ gx: number; gz: number; openDepth: number }>[]): boolean {
  const [x, , z] = view.player.position
  if (eastX <= x || eastX - x > 2 * WORLD_CELL_METERS) return false
  const tiles = new Map(view.map.tiles.map((tile) => [tile.id, tile] as const))
  const heights = new Map(view.terrain.map((cell) => [cell.id, cell.position[1]] as const))
  const openPits = new Set(openPitColumns.filter((column) => column.openDepth > 0)
    .map((column) => gridKey(column.gx, column.gz)))
  const ground = (pointX: number) => {
    const gx = gridAt(pointX), gz = gridAt(z)
    const tile = tiles.get(`tile-${gx + 3}-${gz + 3}`)
    return tile?.discovered && tile.terrain !== null && tile.terrain !== 'wetland'
      && !publicV25RiverCellAtGrid(view.seed, gx, gz)
      && !openPits.has(gridKey(gx, gz))
      ? tile.elevationMeters ?? heights.get(tile.id) : null
  }
  let previous = x, previousY = ground(x)
  if (previousY === null || previousY === undefined) return false
  const steps = Math.ceil(eastX - x)
  for (let step = 1; step <= steps; step += 1) {
    const next = x + (eastX - x) * step / steps
    const nextY = ground(next)
    if (nextY === null || nextY === undefined || Math.abs(nextY - previousY) > 0.8
      || mireglassMoveBarrier(view.seed, { x: previous, z }, { x: next, z }) !== null
      || mireglassMoveBarrier(view.seed, { x: next, z }, { x: previous, z }) !== null)
      return false
    previous = next; previousY = nextY
  }
  return true
}
function salvagerTrailRoute(view: WizardViewProjection,
  openPitColumns: readonly Readonly<{ gx: number; gz: number; openDepth: number }>[]): string {
  const trail = mireglassApproachTrail(view.seed)
  const from = { x: view.player.position[0], z: view.player.position[2] }
  let nearest = 0, nearestDistance = Infinity
  for (let index = 0; index < trail.length; index += 1) {
    const distance = Math.hypot(trail[index].x - from.x, trail[index].z - from.z)
    if (distance < nearestDistance) { nearest = index; nearestDistance = distance }
  }
  const onTrail = trail.some((point) => gridAt(point.x) === gridAt(from.x)
    && gridAt(point.z) === gridAt(from.z))
  if (!onTrail) {
    const target = knownDryWaypoint(view, trail, openPitColumns)
    if (!target) return 'No known dry connection to the marked trail. Retrace explored ground or reveal another safe route; do not cross wetland. At the salvager, buy a field spade.'
    const { meters, direction } = routeBearing(view, target)
    return `Rejoin the marked dry trail: ${direction}, about ${meters} m to the next safe turn. At the salvager, buy a field spade. North is up on the map; stay on revealed dry ground.`
  }
  const nextLeg = salvagerLegEnds(view.seed, trail).find((end) => end > nearest)
    ?? trail.length - 1
  const nextCell = trail[Math.min(nearest + 1, trail.length - 1)]
  const target = [trail[nextLeg], nextCell, trail[nearest]]
    .find((point) => dryDirectLine(view.seed, from, point))
  if (!target) return 'Follow revealed dry ground to rejoin the route toward the Mireglass salvager. At the salvager, buy a field spade.'
  const { meters, direction } = routeBearing(view, target)
  if (meters < 1 && target === trail.at(-1)) return 'Mireglass salvager is here. At the salvager, buy a field spade.'
  return `${nearestDistance > 6 ? 'Rejoin' : 'Follow'} the dry route toward the Mireglass salvager: ${direction}, about ${meters} m to the next dry waypoint. At the salvager, buy a field spade. North is up on the map; stay on revealed dry ground.`
}
export function publicV27StarterGuide(view: WizardViewProjection,
  works: PublicV26Progress['greenwayWorks'], context: Readonly<{
    movementOwner: 'greenway' | 'streamed'; riverBridgeBuilt: boolean
    riverBridgeId?: string | null; claimedBridgeheadId?: string | null
    mireglassGuidance?: string | null
    fringeMarkerStudied?: boolean; mireglassCacheRevealed?: boolean
    mireglassCacheExcavated?: boolean; fieldSpadeOwned?: boolean
    grounded?: boolean
    authoredFenBridgeId?: string | null; builtTerrainWorkIds?: readonly string[]
    authoredSlateLadderId?: string | null; regionalSlateLadderBuilt?: boolean
    discoveryMask?: Uint8Array
    openPitColumns?: readonly Readonly<{ gx: number; gz: number; openDepth: number }>[]
    depletedMireglassResourceIds?: readonly string[]
  }> = { movementOwner: 'greenway', riverBridgeBuilt: false }) {
  const logs = view.backpack.stacks.reduce((sum, stack) =>
    sum + (stack.itemId === 'logs' ? stack.quantity : 0), 0)
  const stone = view.backpack.stacks.reduce((sum, stack) =>
    sum + (stack.itemId === 'stone' ? stack.quantity : 0), 0)
  const carried = view.backpack.stacks.reduce((sum, stack) => sum + stack.quantity, 0)
    + view.tradeListings.reduce((sum, listing) => sum + (listing?.quantity ?? 0), 0)
    + Object.values(view.v26TerrainBag ?? {}).reduce((sum, quantity) => sum + quantity, 0)
  const full = carried >= view.backpack.capacity
  const ladder = works.builtLadderIds.length > 0, creekBridge = works.builtBridgeIds.length > 0
  const streamed = context.movementOwner === 'streamed'
  // This coordinate describes the Greenway cliff only, never the streamed world.
  const upperShelf = !streamed && view.player.position[2] <= -6
  const ladderRoute = upperShelf
    ? 'On the upper north shelf, stay north of the cliff lip for the westward route.'
    : 'Return to the built ladder’s lower foot and climb to the upper north shelf for the westward route.'
  const riverRoute = context.riverBridgeBuilt
    ? 'Your connected-river bridge is built; use its saved deck from a dry bank to cross.'
    : logs >= 8 ? 'Carry 8 logs west to a marked Ready dry-bank site for the separate connected-river bridge.'
      : 'Chop accessible Greenway oaks until you carry 8 logs for the separate connected-river bridge before heading west.'
  const action = streamed ? context.riverBridgeBuilt
    ? 'Connected-river bridge built: use its saved deck from a dry bank to cross.'
    : logs >= 8 ? 'You have 8 logs: open Works at a marked Ready dry-bank site, build the connected-river bridge, then cross its deck.'
      : `${full ? 'Make pack room, then return' : 'Return'} east${ladder ? ' via your saved north ladder' : ''} to accessible Greenway oaks. Gather ${8 - logs} more logs for the 8-log connected-river bridge, then come back west to a marked Ready dry-bank site.`
    : ladder && context.riverBridgeBuilt
    ? `Routes ready: ${ladderRoute} ${riverRoute}`
    : full
    ? `Pack full: ${context.riverBridgeBuilt
      ? 'make room before exploring beyond your saved connected-river bridge'
      : !ladder && logs >= 4
        ? 'use 4 logs at a Ready north cliff ladder, then gather 8 more for the connected-river bridge'
      : ladder && logs >= 8 ? 'use 8 logs at a Ready connected-river crossing'
      : ladder && logs >= 4 ? 'make room to gather toward an 8-log connected-river bridge'
      : stone > 0
        ? 'sell carried stone at Greenway Outfitters' : (view.v26TerrainBag?.soil ?? 0) > 0
          ? 'use Fill on an open pit in reach to refill it with carried soil'
          : 'find a valid use for carried materials before gathering'}.
      ${stone > 0 && logs >= 4 ? 'Outfitters also buys carried stone. ' : ''}${view.v29Mining
        ? 'Sell excavated terrain-bag materials at Greenway Outfitters.'
        : 'Excavated terrain-bag materials cannot be sold yet.'}${ladder ? ` ${ladderRoute} ${riverRoute}` : ''}`
    : ladder ? `Ladder built: ${ladderRoute} ${riverRoute}`
        : creekBridge ? 'Starter creek bridge built: use its saved deck. Build the north cliff ladder for 4 logs, then carry 8 additional logs for the connected-river bridge.'
          : logs >= 4 ? 'Build the north cliff ladder for 4 logs, then carry 8 additional logs for the separate connected-river bridge before heading west.'
            : `Chop accessible Greenway oaks for a 4-log north cliff ladder, then gather 8 additional logs for the connected-river bridge. ${logs ? `${logs} carried.` : ''}`
  const boots = view.equipment.feet?.itemId === 'leather_boots'
    ? 'Boots equipped: run by default; Walk/R changes pace.'
    : view.backpack.stacks.some((stack) => stack.itemId === 'leather_boots')
      ? 'Equip your boots to run.' : 'Buy boots at Greenway Outfitters to run.'
  const spade = view.equipment.mainHand?.itemId === 'field_spade'
    ? `Spade equipped: Dig is selected; tap revealed, unoccupied dry grassy (loam) ground in reach. Chopped-stump E interactions also use it${context.mireglassCacheRevealed ? ', as does the revealed cache E interaction' : ''}.`
    : view.backpack.stacks.some((stack) => stack.itemId === 'field_spade')
      ? 'Equip your spade to select Dig, then tap revealed, unoccupied dry grassy (loam) ground in reach.'
      : 'Outfitters also sells a spade for click-to-dig on revealed, unoccupied dry grassy (loam) ground.'
  const riverId = context.riverBridgeId ?? view.v30Bridgehead?.bridgeId
  const riverSite = context.riverBridgeBuilt && riverId
    ? resolvePublicV28RiverBridge(view.seed, riverId) : null
  const claimed = riverId && (context.claimedBridgeheadId === riverId
    || view.v30Bridgehead?.bridgeId === riverId && view.v30Bridgehead.claimed)
  const riverStage = riverSite ? view.player.position[2] <= riverSite.from.z
    ? claimed ? { summary: 'River Works claimed: Greenway trade or return',
      action: 'Greenway Outfitters can trade your recovered material. Your saved river bridge remains available if you choose to cross again.' }
      : { summary: 'Connected-river bridge ready: cross its deck',
        action: 'Use the saved connected-river deck from its dry source bank to cross.' }
    : view.player.position[2] >= riverSite.to.z
      ? claimed ? { summary: 'River Works claimed: follow the frontier',
        action: frontierMarkerRoute(view) }
        : view.v30Bridgehead?.bridgeId === riverId
          ? { summary: 'River Works find: visit the post',
            action: 'Approach the discovered River Works post at the dry far exit and claim its one-time find.' }
          : { summary: 'Explore the far bank',
            action: 'Explore revealed far-bank ground for the next route.' }
      : { summary: 'On the saved river bridge',
        action: 'Continue along the saved deck to a dry bank.' } : null
  const regionalGuide = streamed && view.map.title === 'Mireglass Reach'
    ? context.mireglassGuidance ?? view.map.guidance : null
  const salvagerGuide = streamed && context.fringeMarkerStudied && !context.mireglassCacheRevealed
    && !context.fieldSpadeOwned && riverSite && claimed
    && view.player.position[2] >= riverSite.to.z
    ? salvagerTrailRoute(view, context.openPitColumns ?? []) : null
  const excavationGuide = streamed && view.v31Soil && context.fringeMarkerStudied
    && context.fieldSpadeOwned && view.skillXp.excavation < 30 && riverSite && claimed
    && view.player.position[2] >= riverSite.to.z ? {
      summary: full ? 'Excavation Lv2: make room, then Dig'
        : context.grounded === false ? 'Excavation Lv2: land, then Dig'
          : view.equipment.mainHand?.itemId !== 'field_spade'
            ? 'Excavation Lv2: equip spade, then Dig'
            : 'Excavation Lv2: Dig revealed, unoccupied dry loam',
      action: `${full ? 'Make room in your pack and terrain bag first. ' : ''}${context.grounded === false ? 'Land on stable ground first. ' : ''}Equip your field spade, close trade/map/Works, stand on stable dry ground, then tap an unoccupied revealed dry grassy (loam) patch within 5 m to Dig topsoil for 30 Excavation XP and reach Lv2. Chopped-stump E prompts are another 30 XP option when available.`,
    } : null
  const fenBuilt = Boolean(context.authoredFenBridgeId)
    || context.builtTerrainWorkIds?.some((id) => parseTerrainWorkId(id)?.kind === 'bridge')
  const fenPending = streamed && view.v31Soil && context.fringeMarkerStudied
    && context.fieldSpadeOwned && view.skillXp.excavation >= 30
    && !context.mireglassCacheRevealed && !fenBuilt && riverSite && claimed
    && view.player.position[2] >= riverSite.to.z
  let timberGuide: { summary: string; action: string } | null = null
  if (fenPending && logs < 8) {
    const pocket = FEN_TIMBER_POCKET
    const depleted = new Set(context.depletedMireglassResourceIds ?? [])
    const available = mireglassResources(view.seed).filter((resource) =>
      resource.phase === 'before_bridge' && resource.tile.terrain === 'loam'
      && resource.tile.center.x >= pocket.minX && resource.tile.center.x < pocket.maxX
      && resource.tile.center.z >= pocket.minZ && resource.tile.center.z < pocket.maxZ
      && !depleted.has(resource.id))
    const visible = available.filter((resource) => view.resources.some((node) =>
      node.id === resource.id && node.kind === 'tree' && node.available)
      && view.map.tiles.some((tile) => tile.id === resource.tile.id
        && tile.discovered && tile.terrain === 'loam'))
    const treeHere = visible.find((resource) => view.nearbyInteraction?.kind === 'resource'
      && view.nearbyInteraction.actionable
      && view.nearbyInteraction.targetId === `mireglass:chop:${resource.id}`)
    const treeRoute = treeHere ? null : visible.map((resource) => knownDryWaypoint(view,
      [resource.tile.center], context.openPitColumns ?? [])).find((point) => point !== null)
    const need = 8 - logs
    const timberSummary = 'Fen logs: find and chop dry-side timber before Works'
    const finish = `Gather ${need} more ${need === 1 ? 'log' : 'logs'}, then return to the Fen north bank and check Works at a fully revealed bridge footprint.`
    if (treeHere) timberGuide = { summary: timberSummary,
      action: `A usable dry-side timber tree is in reach. Equip your axe and use its checked Chop Mireglass timber prompt. ${finish}` }
    else if (treeRoute) {
      const { meters, direction } = routeBearing(view, treeRoute)
      timberGuide = { summary: timberSummary,
        action: `A revealed dry-side timber tree is ahead: ${direction}, about ${meters} m to the next known safe turn. Stay on revealed dry ground and use its checked Chop prompt with an equipped axe. ${finish}` }
    } else if (visible.length) timberGuide = { summary: timberSummary,
      action: `A dry-side timber tree is revealed, but no known dry route to it is connected here. Retrace explored ground or reveal another safe route; do not cross wetland or open pits. ${finish}` }
    else {
      const waypoint = available.length ? knownDryWaypoint(view, null,
        context.openPitColumns ?? [], FEN_TIMBER_TARGET, pocket) : null
      if (waypoint?.atFrontier) timberGuide = { summary: timberSummary,
        action: `You are on revealed dry ground at the pre-Fen timber-pocket frontier. Reveal nearby pocket ground from here; only enter after it proves dry and clear. A map dot may be an herb, not a tree; use a checked Chop Mireglass timber prompt when one appears. ${finish}` }
      else if (waypoint) {
        const { meters, direction } = routeBearing(view, waypoint)
        timberGuide = { summary: timberSummary,
          action: `Find dry-side timber before checking Fen Works: ${direction}, about ${meters} m to the next known safe turn on revealed dry ground toward a pocket frontier. At that frontier, reveal nearby pocket ground from safe footing; do not enter unknown or wetland tiles. A map dot may be an herb, not a tree. ${finish}` }
      } else if (!available.length) timberGuide = { summary: timberSummary,
        action: `No usable dry timber is confirmed in this pocket. Retrace known dry ground and search another safe timber area; do not cross wetland for decorative trees. ${finish}` }
      else timberGuide = { summary: timberSummary,
        action: `No reachable revealed dry frontier beside unexplored pocket ground is known here. Reveal ground from safe footing or retrace a known route; do not cross wetland or open pits. A map dot may be an herb, not a tree. ${finish}` }
    }
  }
  let fenGuide: { summary: string; action: string } | null = null
  if (fenPending && logs >= 8) {
    const fen = MIREGLASS_ENVELOPES.fenChannel
    const [x, , z] = view.player.position
    const nearBank = x >= fen.minX - 24 && x <= fen.maxX + 24
      && z >= fen.minZ - 24 && z <= fen.maxZ
    const discovered = nearBank ? new Set(view.map.tiles.filter((tile) => tile.discovered)
      .map((tile) => tile.id)) : null
    const revealedSites = nearBank ? fenWorksSites(view.seed).filter((site) =>
      site.footprintTileIds.every((id) => discovered?.has(id))) : []
    const previewable = revealedSites.some((site) => {
      const anchor = parseTerrainWorkId(site.id)
      return anchor?.kind === 'bridge' && Math.abs(anchor.gx - gridAt(x)) <= 4
        && Math.abs(anchor.gz - gridAt(z)) <= 4
        && Math.hypot(site.from.x - x, site.from.z - z) <= 16
    })
    if (previewable) fenGuide = { summary: 'Fen bank: gather 8 logs and check Works',
      action: 'A Fen bridge footprint is fully revealed nearby and within Works preview range. You have 8 bridge logs. Open Works, select Bridge, and follow its checked Ready or blocked preview before building; do not cross wetland without a saved deck.' }
    else if (revealedSites.length) {
      const waypoint = knownDryWaypoint(view, revealedSites.map((site) => site.from),
        context.openPitColumns ?? [])
      if (waypoint) {
        const { meters, direction } = routeBearing(view, waypoint)
        fenGuide = { summary: 'Fen bank: follow a known dry waypoint',
          action: `Approach a fully revealed Fen source bank: ${direction}, about ${meters} m to the next known safe turn. Stay on revealed dry ground and avoid wetland or open pits; the guide will signal when Works can show a checked bridge candidate.` }
      } else fenGuide = { summary: 'Fen bank: reveal adjacent safe ground',
        action: 'A Fen bridge footprint is revealed, but no known dry route to its source bank is connected here. Reveal adjacent safe ground or retrace a known route; do not cross wetland or open pits.' }
    }
    else if (nearBank) fenGuide = { summary: 'Fen bank: reveal nearby crossing ground',
      action: 'You are near the Fen north bank, but no complete supported bridge footprint is revealed here. Reveal adjacent safe dry ground; do not cross wetland or assume a placement is Ready.' }
    else {
      const waypoint = knownDryWaypoint(view, null, context.openPitColumns ?? [])
      if (waypoint) {
        const { meters, direction } = routeBearing(view, waypoint)
        fenGuide = { summary: 'Fen bank: follow a known dry waypoint',
          action: `Chart the dry approach toward the Fen north bank: ${direction}, about ${meters} m to the next known safe turn. North is up on the map; stay on revealed dry ground, then seek a fully discovered bridge footprint and carry 8 logs.` }
      } else fenGuide = { summary: 'Fen bank: reveal adjacent safe ground',
        action: 'No known dry continuation toward the Fen north bank is connected here. Reveal adjacent safe ground or retrace a known route; do not cross wetland. Carry 8 logs and seek a fully discovered bridge footprint.' }
    }
  }
  let fenDeckGuide: { summary: string; action: string } | null = null
  if (streamed && view.v31Soil && context.fringeMarkerStudied && context.fieldSpadeOwned
    && view.skillXp.excavation >= 30 && !context.mireglassCacheRevealed && riverSite && claimed
    && view.player.position[2] >= riverSite.to.z) {
    const worksDecks = (context.builtTerrainWorkIds ?? []).flatMap((id) => {
      const site = parseTerrainWorkId(id)?.kind === 'bridge'
        ? resolveTerrainWorkSite(view.seed, id) : null
      return site?.kind === 'bridge' && site.obstacle === 'fen_channel' ? [{
        from: site.from, to: site.to, approach: site.approach,
        halfWidth: site.widthMeters / 2, footprint: site.footprintTileIds,
      }] : []
    })
    const authoredDeck = context.authoredFenBridgeId ? mireglassRouteSites(view.seed)
      .find((site) => site.kind === 'bridge' && site.id === context.authoredFenBridgeId) : null
    const authoredCandidate = authoredDeck ? {
      from: authoredDeck.from, to: authoredDeck.to,
      approach: worldTileAtGrid(view.seed, gridAt(authoredDeck.from.x),
        gridAt(authoredDeck.from.z) - 1).center,
      halfWidth: 0.72,
      footprint: [-1, 0, 1, 2, 3].map((offset) =>
        `tile-${gridAt(authoredDeck.from.x) + 3}-${gridAt(authoredDeck.from.z) + offset + 3}`),
    } : null
    const discovered = new Set(view.map.tiles.filter((tile) => tile.discovered)
      .map((tile) => tile.id))
    const [playerX, , playerZ] = view.player.position
    const deck = [...worksDecks, ...(authoredCandidate ? [authoredCandidate] : [])]
      .filter((site) => playerZ < site.to.z
        && site.footprint.every((id) => discovered.has(id)))
      .sort((a, b) => Math.hypot(a.from.x - playerX, a.from.z - playerZ)
        - Math.hypot(b.from.x - playerX, b.from.z - playerZ))[0]
    if (deck) {
      const [x, , z] = view.player.position
      const sourceGX = gridAt(deck.from.x), sourceGZ = gridAt(deck.from.z)
      const sourcePit = context.openPitColumns?.some((pit) => pit.openDepth > 0
        && pit.gx === sourceGX && pit.gz === sourceGZ)
      if (Math.abs(x - deck.from.x) <= deck.halfWidth && z >= deck.from.z
        && (!sourcePit || z >= deck.from.z + WORLD_CELL_METERS / 2)) {
        fenDeckGuide = { summary: 'Fen deck: cross lengthwise to the far bank',
          action: 'You are aligned on the saved Fen bridge lane. Walk straight along its center toward the dry far foot; stay on the supported deck, not the wet ground beside it.' }
      } else if (!sourcePit && gridAt(x) === sourceGX && gridAt(z) === sourceGZ
        && mireglassMoveBarrier(view.seed, { x, z }, deck.from) === null) {
        fenDeckGuide = { summary: 'Fen deck: retreat to the dry entry end',
          action: 'First walk north on this dry source tile, away from the wet span, to the bridge entry end. Only then move sideways to line up with the middle of the bridge entrance on dry ground. Walk straight south lengthwise across the saved deck; do not enter from its wet side.' }
      } else {
        const waypoint = knownDryWaypoint(view, [deck.approach, deck.from],
          context.openPitColumns ?? [])
        if (waypoint) {
          const { meters, direction } = routeBearing(view, waypoint)
          fenDeckGuide = { summary: 'Fen deck: follow a known dry approach',
            action: `Return to the bridge's dry source end: ${direction}, about ${meters} m to the next known safe turn. Stay on revealed dry ground, then align with the deck before crossing. Do not step sideways onto the wet span.` }
        } else fenDeckGuide = { summary: 'Fen deck: retrace a known dry approach',
          action: 'No known dry route to the saved bridge source is connected here. Retrace revealed dry ground or reveal another safe approach; do not step sideways onto the wet span or cross open pits.' }
      }
    }
  }
  let slateGuide: { summary: string; action: string } | null = null
  let slateClimbGuide: { summary: string; action: string } | null = null
  if (streamed && view.v31Soil && context.fringeMarkerStudied && context.fieldSpadeOwned
    && view.skillXp.excavation >= 30 && !context.mireglassCacheRevealed
    && context.regionalSlateLadderBuilt && context.discoveryMask && riverSite && claimed) {
    const mask = context.discoveryMask
    const [x, y, z] = view.player.position
    const discovered = new Set(view.map.tiles.filter((tile) => tile.discovered)
      .map((tile) => tile.id))
    const sites = (view.regionalLadders?.builtSites ?? []).filter((site) =>
      site.footprintTileIds.every((id) => discoveryMaskHasTileId(mask, id))
      && discovered.has(worldTileAtGrid(view.seed,
        gridAt(site.approach.x), gridAt(site.approach.z)).id))
      .sort((a, b) => Math.hypot(a.approach.x - x, a.approach.z - z)
      - Math.hypot(b.approach.x - x, b.approach.z - z))
    let site: ReturnType<typeof resolvePublicV23Site> = null
    for (const candidate of sites) {
      site = resolvePublicV23Site(view.seed, candidate.id)
      if (site) break
    }
    const upperRim = mireglassPlateauAt(view.seed, gridAt(x) * WORLD_CELL_METERS,
      gridAt(z) * WORLD_CELL_METERS) !== null
    const upperFooting = context.grounded !== false && sites.some((built) =>
      y >= built.to.y - 0.15 && (x <= built.to.x || upperRim
        && terrainWorkSupportAt({ ...built, obstacle: 'slate_cliff' }, { x, z }).floorY === null))
    if (site && !upperFooting) {
      const support = terrainWorkSupportAt({ ...site, obstacle: 'slate_cliff' }, { x, z })
      if (support.floorY !== null && Math.abs(y - support.floorY) < 0.15) {
        slateClimbGuide = { summary: 'Slate ladder: climb west on the saved rungs',
          action: 'You are aligned on the supported ladder lane. Continue west straight along its center mark to the upper floor; do not step sideways off the narrow rungs.' }
      } else {
        const aligned = { x, z: site.from.z }
        const onApproach = gridAt(x) === gridAt(site.approach.x)
          && gridAt(z) === gridAt(site.approach.z) && context.grounded !== false
          && mireglassMoveBarrier(view.seed, { x, z }, aligned) === null
          && mireglassMoveBarrier(view.seed, aligned, { x, z }) === null
          && knownDryWaypoint({ ...view, player: { ...view.player,
            position: [x, y, aligned.z] } }, [site.from],
            context.openPitColumns ?? []) !== null
        const approach = onApproach ? null : knownDryWaypoint(view, [site.approach],
          context.openPitColumns ?? [])
        const nearLowerFoot = x < site.from.x && x > site.to.x
          && y < site.to.y - 0.5
        if (onApproach) slateClimbGuide = {
          summary: 'Slate ladder: align on the dry east approach',
          action: 'On the revealed dry lower east approach, align sideways with the visible ladder center mark before entering. Then move west straight along the narrow supported rungs to the upper floor; do not enter from the cliff side.' }
        else if (approach && nearLowerFoot && knownDryEastRetreat(view, site.approach.x,
          context.openPitColumns ?? [])) slateClimbGuide = {
          summary: 'Slate ladder: retreat east to align',
          action: 'This cliff-side position is outside the supported ladder lane. Retreat east on revealed dry lower ground to the ladder approach before moving sideways to align with its visible center mark. Then move west straight along the saved rungs to the upper floor.' }
        else if (approach && !nearLowerFoot) {
          const { meters, direction } = routeBearing(view, approach)
          slateClimbGuide = { summary: 'Slate ladder: follow a known dry approach',
            action: `Approach the saved ladder from its dry lower east side: ${direction}, about ${meters} m to the next known safe turn. Stay on revealed dry ground, line up with the visible center mark on the east approach, then move west straight along the rungs.` }
        } else slateClimbGuide = { summary: 'Slate ladder: retrace a known dry approach',
          action: 'No known dry route to the saved ladder’s lower east approach is connected here. Retrace revealed dry ground or reveal another safe way; do not enter from the unsupported cliff side, wetland, or an open pit.' }
      }
    }
  }
  if (streamed && view.v31Soil && context.fringeMarkerStudied && context.fieldSpadeOwned
    && view.skillXp.excavation >= 30 && !context.mireglassCacheRevealed
    && !context.authoredSlateLadderId && !context.regionalSlateLadderBuilt
    && context.discoveryMask && riverSite && claimed
    && view.player.position[2] >= riverSite.to.z
    && mireglassFenBankAt(view.seed, { x: view.player.position[0],
      z: view.player.position[2] }) === 'south'
    && !(context.builtTerrainWorkIds ?? []).some((id) => {
      const site = parseTerrainWorkId(id)?.kind === 'ladder'
        ? resolveTerrainWorkSite(view.seed, id) : null
      return site?.kind === 'ladder' && site.obstacle === 'slate_cliff'
    })) {
    const mask = context.discoveryMask
    const builtFenSites = (context.builtTerrainWorkIds ?? []).flatMap((id) => {
      const site = parseTerrainWorkId(id)?.kind === 'bridge'
        ? resolveTerrainWorkSite(view.seed, id) : null
      return site?.kind === 'bridge' && site.obstacle === 'fen_channel'
        ? [{ to: site.to, footprint: site.footprintTileIds }] : []
    })
    const authoredFen = context.authoredFenBridgeId ? mireglassRouteSites(view.seed)
      .find((site) => site.kind === 'bridge' && site.id === context.authoredFenBridgeId) : null
    if (authoredFen) builtFenSites.push({ to: authoredFen.to,
      footprint: [-1, 0, 1, 2, 3].map((offset) =>
        `tile-${gridAt(authoredFen.from.x) + 3}-${gridAt(authoredFen.from.z) + offset + 3}`) })
    const crossedKnownFen = builtFenSites.some((site) =>
      view.player.position[2] >= site.to.z
      && site.footprint.every((id) => discoveryMaskHasTileId(mask, id)))
    const [x, , z] = view.player.position
    const nearWestFace = Math.abs(x + 412) < 32 && Math.abs(z - 432) < 32
    const westSiteKnown = nearWestFace && [430.6, 433.4].some((aimZ) =>
      publicV23DiscoveredWestSite(view.seed, mask, aimZ) !== null)
    const westSitePreviewable = nearWestFace && (view.savedTerrainWorks?.preview?.nearby
      .some((choice) => choice.site.kind === 'ladder'
        && choice.site.obstacle === 'slate_cliff') ?? false)
    if (crossedKnownFen && !westSiteKnown && !westSitePreviewable) {
      const waypoint = knownDryWaypoint(view, null, context.openPitColumns ?? [],
        SLATE_LOWER_APPROACH)
        ?? knownDryWaypoint(view, null, context.openPitColumns ?? [],
          SLATE_LOWER_APPROACH, MIREGLASS_ENVELOPES.slateBerm)
      if (waypoint?.atFrontier) slateGuide = { summary: 'Slate approach: reveal the next safe ground',
        action: 'You are on revealed dry ground at the Slate-side frontier. Expose neighboring ground from safe footing, then enter only a revealed dry, clear step; do not walk into unknown ground or the cliff.' }
      else if (waypoint) {
        const { meters, direction } = routeBearing(view, waypoint)
        slateGuide = { summary: 'Slate approach: follow a known dry turn',
          action: `Toward Slate lower ground: ${direction}, about ${meters} m to the next known safe turn on revealed dry ground. Keep to this connected safe route; reveal more ground before entering any unknown or blocked tile.` }
      } else slateGuide = { summary: 'Slate approach: reveal or retrace safe ground',
        action: 'No known dry continuation toward Slate is connected here. Reveal neighboring ground from safe footing or retrace a known route; do not cross wetland, open pits, unknown ground, or the cliff.' }
    }
  }
  let upperSurveyGuide: { summary: string; action: string } | null = null
  if (streamed && view.v31Soil && context.grounded === true
    && !context.mireglassCacheRevealed && context.discoveryMask
    && view.learnedSpellIds.includes('wayfinder_glow')) {
    const mask = context.discoveryMask
    const [x, y, z] = view.player.position
    const tile = worldTileAtGrid(view.seed, gridAt(x), gridAt(z))
    const onUpper = mireglassPlateauAt(view.seed, tile.center.x, tile.center.z) !== null
      && Math.abs(y - tile.center.y) < 0.15
    const authored = onUpper && context.authoredSlateLadderId ? mireglassRouteSites(view.seed)
      .find((site) => site.kind === 'ladder' && site.id === context.authoredSlateLadderId) : null
    const authoredKnown = authored && [authored.from, authored.to].every((point) =>
      discoveryMaskHasTileId(mask, worldTileAtGrid(view.seed,
        gridAt(point.x), gridAt(point.z)).id))
    const regionalKnown = onUpper && context.regionalSlateLadderBuilt
      && view.regionalLadders?.builtSites.some((site) => site.footprintTileIds.every((id) =>
        discoveryMaskHasTileId(mask, id)))
    const genericKnown = onUpper && (context.builtTerrainWorkIds ?? []).some((id) => {
      const site = parseTerrainWorkId(id)?.kind === 'ladder'
        ? resolveTerrainWorkSite(view.seed, id) : null
      return site?.kind === 'ladder' && site.obstacle === 'slate_cliff'
        && site.footprintTileIds.every((tileId) => discoveryMaskHasTileId(mask, tileId))
    })
    if (onUpper && (authoredKnown || regionalKnown || genericKnown)) {
      const glowReady = view.checkedActionChoices?.some((choice) =>
        choice.id === 'mireglass:cast:wayfinder_glow' && choice.actionable)
      const highGround = 'The green ground north of the Slate cliff is lower than this elevated shelf; do not step across the cliff edge.'
      if (glowReady) upperSurveyGuide = {
        summary: 'Upper Slate shelf: cast Glow; north green is below',
        action: `${highGround} Cast Wayfinder Glow now using its checked action, then inspect newly revealed high ground before stepping.` }
      else upperSurveyGuide = {
        summary: 'Upper Slate shelf: search the western high ground',
        action: `${highGround} Old survey records place the buried seal somewhere on the western upper shelf, not at an exact marked point. On discovered, visibly level footing, make short east-west passes: check the current Glow action about every two map cells along a pass, shift about two cells between passes where clear, then sweep back. Glow only reveals the hidden seal when cast nearby. The map marks discovered elevation, not safe passage; unknown or pitted ground is uncertified. If no clear route west appears, retrace known high ground.` }
    }
  }
  let slateReturnGuide: { summary: string; action: string } | null = null
  if (streamed && context.mireglassCacheExcavated && context.mireglassCacheRevealed
    && context.regionalSlateLadderBuilt && context.discoveryMask && context.grounded === true
    && view.backpack.stacks.some((stack) => stack.itemId === 'mireglass_reach/item/seal'
      && stack.quantity > 0)) {
    const [x, y, z] = view.player.position
    if (mireglassPlateauAt(view.seed, gridAt(x) * WORLD_CELL_METERS,
      gridAt(z) * WORLD_CELL_METERS) !== null) {
      const site = (view.regionalLadders?.builtSites ?? []).flatMap((built) => {
        if (!built.footprintTileIds.every((id) =>
          discoveryMaskHasTileId(context.discoveryMask!, id))) return []
        const canonical = resolvePublicV23Site(view.seed, built.id)
        return canonical ? [canonical] : []
      }).sort((a, b) => Math.hypot(a.to.x - x, a.to.z - z)
        - Math.hypot(b.to.x - x, b.to.z - z))
        .find((built) => Math.abs(y - built.to.y) < 0.15
          && Math.hypot(built.to.x - x, built.to.z - z) <= 8)
      if (site) slateReturnGuide = Math.abs(z - site.to.z) <= site.widthMeters / 2
        ? { summary: 'Slate return: descend the saved rungs',
          action: 'You are aligned with the upper dry-foot mark. Walk east straight along the narrow rung lane to descend; do not step sideways off the supported rungs.' }
        : { summary: 'Slate return: align at the upper dry foot',
          action: 'On the nearby level upper shelf, retreat west beyond the upper rung end. Align sideways with the visible upper dry-foot mark, then walk east straight along the narrow rung lane to descend. Do not enter the ladder from its cliff side.' }
    }
  }
  return { summary: salvagerGuide ? 'Mireglass salvager: field spade'
    : excavationGuide ? excavationGuide.summary
    : timberGuide ? timberGuide.summary
    : fenGuide ? fenGuide.summary
    : fenDeckGuide ? fenDeckGuide.summary
    : slateClimbGuide ? slateClimbGuide.summary
    : slateGuide ? slateGuide.summary
    : upperSurveyGuide ? upperSurveyGuide.summary
    : slateReturnGuide ? slateReturnGuide.summary
    : regionalGuide ? 'Mireglass Reach' : riverStage?.summary ?? (streamed ? context.riverBridgeBuilt
    ? 'Connected-river bridge ready: cross its deck'
    : logs >= 8 ? 'Connected-river bridge next: build at a Ready bank'
      : 'Connected-river bridge next: return for 8 logs'
    : ladder && context.riverBridgeBuilt ? 'Routes ready: connected-river bridge saved'
    : full ? 'Pack full: make room to gather' : ladder
      ? upperShelf ? logs >= 8 ? 'Upper shelf: head west with bridge logs'
          : 'Upper shelf: gather 8 bridge logs' : 'Ladder ready: find a river crossing'
      : creekBridge ? 'Bridge ready: find a cliff route' : logs >= 4
        ? 'Logs ready: 4-log ladder, then 8 more for bridge'
        : 'First steps: chop for 4-log ladder, then 8-log bridge'),
    action: salvagerGuide ?? excavationGuide?.action ?? timberGuide?.action ?? fenGuide?.action
      ?? fenDeckGuide?.action
      ?? slateClimbGuide?.action
      ?? slateGuide?.action
      ?? upperSurveyGuide?.action
      ?? slateReturnGuide?.action
      ?? regionalGuide ?? riverStage?.action ?? action,
    boots, spade }
}
const PUBLIC_V23_PANEL_STYLES = `
[data-public-v23] .v23-guide,[data-public-v23] .v23-aim{position:fixed;z-index:20;left:12px;bottom:96px;box-sizing:border-box;background:#10251de8;color:#fff;border-radius:8px}
[data-public-v23] .v23-guide{max-width:330px;padding:10px}
[data-public-v23] .v23-guide-west{max-width:320px}
[data-public-version=v25] .v25-start-guide,[data-public-version=v26] .v25-start-guide,[data-public-version=v27] .v25-start-guide,[data-public-version=v28] .v25-start-guide,[data-public-version=v29] .v25-start-guide,[data-public-version=v30] .v25-start-guide,[data-public-version=v31] .v25-start-guide,[data-public-version=v32] .v25-start-guide,[data-public-version=v33] .v25-start-guide,[data-public-version=v34] .v25-start-guide,[data-public-version=v35] .v25-start-guide,:is([data-public-version=v36],[data-public-version=v37],[data-public-version=v38],[data-public-version=v39],[data-public-version=v40],[data-public-version=v41],[data-public-version=v42]) .v25-start-guide{width:min(280px,calc(100vw - 112px));max-height:min(38vh,240px);overflow:auto}
[data-public-version=v25] .v25-start-guide summary,[data-public-version=v26] .v25-start-guide summary,[data-public-version=v27] .v25-start-guide summary,[data-public-version=v28] .v25-start-guide summary,[data-public-version=v29] .v25-start-guide summary,[data-public-version=v30] .v25-start-guide summary,[data-public-version=v31] .v25-start-guide summary,[data-public-version=v32] .v25-start-guide summary,[data-public-version=v33] .v25-start-guide summary,[data-public-version=v34] .v25-start-guide summary,[data-public-version=v35] .v25-start-guide summary,:is([data-public-version=v36],[data-public-version=v37],[data-public-version=v38],[data-public-version=v39],[data-public-version=v40],[data-public-version=v41],[data-public-version=v42]) .v25-start-guide summary{min-height:44px;display:flex;align-items:center;cursor:pointer}
[data-public-v23] .v23-aim{width:324px;padding:12px}
[data-public-v23] .v23-status{position:fixed;z-index:21;top:8px;left:12px;max-width:min(300px,calc(100vw - 24px));box-sizing:border-box;margin:0;padding:6px 9px;background:#10251de8;color:#fff;border-radius:8px;pointer-events:none}
[data-public-version=v34] .v34-branch-label,[data-public-version=v35] .v34-branch-label{position:fixed;z-index:20;top:8px;right:12px;max-width:min(250px,calc(100vw - 24px));box-sizing:border-box;margin:0;padding:6px 9px;background:#10251de8;color:#fff;border-radius:8px;pointer-events:none}
[data-public-v23] .v23-obstacle-cue{position:fixed;z-index:22;top:36%;left:50%;transform:translateX(-50%);box-sizing:border-box;width:min(390px,calc(100vw - 32px));margin:0;padding:10px 14px;border:1px solid #f5d889;border-radius:10px;background:#10251df2;color:#fff;box-shadow:0 8px 24px #0009;text-align:center;pointer-events:none}
[data-public-v23] .v23-save{position:fixed;z-index:21;top:8px;right:12px;max-width:220px;box-sizing:border-box;padding:8px;background:#10251de8;color:#fff;border-radius:8px}
[data-public-v23] .v23-save button{min-height:44px}
[data-public-v23] .v23-save p{margin:4px 0 0}
[data-public-v23] .v24-actions{position:fixed;z-index:21;right:12px;bottom:96px;box-sizing:border-box;width:min(300px,calc(100vw - 24px));max-height:45vh;overflow:auto;padding:10px;background:#10251de8;color:#fff;border-radius:8px}
[data-public-v23] .v24-actions button{display:block;min-height:44px;width:100%;margin-top:6px;text-align:left}
:is([data-public-version=v36],[data-public-version=v37],[data-public-version=v38],[data-public-version=v39],[data-public-version=v40],[data-public-version=v41],[data-public-version=v42]) .v24-actions summary{position:sticky;top:0;z-index:1;display:flex;align-items:center;min-height:44px;background:#10251d;cursor:pointer;font-weight:700}
[data-public-v23] .v26-safety{position:fixed;z-index:21;left:50%;bottom:8px;transform:translateX(-50%);box-sizing:border-box;width:min(230px,calc(100vw - 24px));max-height:35vh;overflow:auto;padding:8px;background:#10251de8;color:#fff;border-radius:8px}
[data-public-v23] .v26-safety:not([open]){width:140px;padding:0 6px;opacity:.85}
[data-public-v23] .v26-safety summary{min-height:44px;display:flex;align-items:center;justify-content:center;cursor:pointer}
[data-public-v23] .v26-safety button{display:block;min-height:44px;width:100%;margin-top:6px;text-align:left}
[data-public-v23] .v26-safety p{margin:6px 0 0;font-size:12px}
[data-public-v23]:has(.wr-map-backdrop) .v23-guide,[data-public-v23]:has(.wr-map-backdrop) .v23-aim{display:none}
[data-public-v23]:has(.wr-map-backdrop) .v24-actions{display:none}
[data-public-v23]:has(.wr-map-backdrop) .v26-safety{display:none}
[data-public-v23]:has(.wr-map-backdrop) .v23-obstacle-cue{display:none}
@media(max-height:400px){[data-public-v23] .v23-obstacle-cue{top:64px;max-height:calc(100dvh - 215px - env(safe-area-inset-bottom,0px));overflow:hidden;padding:6px 10px;font-size:12px;line-height:1.2}}
@media(max-width:719px),(min-width:720px) and (max-width:900px) and (max-height:590px){
  [data-public-v23]{height:calc(100dvh - 16px - env(safe-area-inset-bottom,0px))}
  [data-public-v23] .wr-surface{height:100%;min-height:0}
  [data-public-v23] .v23-guide,[data-public-v23] .v23-aim{left:8px;bottom:calc(156px + env(safe-area-inset-bottom,0px));width:min(300px,calc(100vw - 104px));max-width:calc(100vw - 104px);max-height:calc(100dvh - 184px - env(safe-area-inset-bottom,0px));overflow-y:auto;overscroll-behavior:contain}
  [data-public-v23] .v23-aim>div{flex-wrap:wrap}
  [data-public-v23] .v23-status{left:8px;max-width:min(260px,calc(100vw - 16px))}
  [data-public-v23] .v23-save{top:76px;right:8px}
  [data-public-v23] .v24-actions{right:8px;bottom:calc(156px + env(safe-area-inset-bottom,0px));max-height:30vh}
  :is([data-public-version=v36],[data-public-version=v37],[data-public-version=v38],[data-public-version=v39],[data-public-version=v40],[data-public-version=v41],[data-public-version=v42]) .v24-actions:not([open]){width:156px;max-height:none;padding:0 8px}
  :is([data-public-version=v36],[data-public-version=v37],[data-public-version=v38],[data-public-version=v39],[data-public-version=v40],[data-public-version=v41],[data-public-version=v42]):has(.wr-surface[data-work-mode="true"]) .v24-actions,:is([data-public-version=v36],[data-public-version=v37],[data-public-version=v38],[data-public-version=v39],[data-public-version=v40],[data-public-version=v41],[data-public-version=v42]):has(.wr-v35-quest[data-expanded="true"]) .v24-actions{display:none}
  [data-public-v23] .v26-safety{bottom:calc(8px + env(safe-area-inset-bottom,0px));max-height:calc(100dvh - 300px);min-height:0}
  [data-public-version=v42] .v26-safety{left:auto;right:8px;transform:none;width:min(200px,calc(100vw - 160px))}
  [data-public-version=v42] .v26-safety:not([open]){bottom:calc(214px + env(safe-area-inset-bottom,0px))}
}
body:has([data-public-version=v26]),body:has([data-public-version=v27]),body:has([data-public-version=v28]),body:has([data-public-version=v29]),body:has([data-public-version=v30]),body:has([data-public-version=v31]),body:has([data-public-version=v32]),body:has([data-public-version=v33]),body:has([data-public-version=v34]){margin:0;background:#14221f}
[data-public-version=v26],[data-public-version=v27],[data-public-version=v28],[data-public-version=v29],[data-public-version=v30],[data-public-version=v31],[data-public-version=v32],[data-public-version=v33],[data-public-version=v34]{height:100dvh}
[data-public-version=v26] .wr-surface,[data-public-version=v27] .wr-surface,[data-public-version=v28] .wr-surface,[data-public-version=v29] .wr-surface,[data-public-version=v30] .wr-surface,[data-public-version=v31] .wr-surface,[data-public-version=v32] .wr-surface,[data-public-version=v33] .wr-surface,[data-public-version=v34] .wr-surface{height:100%;min-height:0}
@media(min-width:901px){[data-public-version=v26] .v25-start-guide,[data-public-version=v27] .v25-start-guide,[data-public-version=v28] .v25-start-guide,[data-public-version=v29] .v25-start-guide,[data-public-version=v30] .v25-start-guide,[data-public-version=v31] .v25-start-guide,[data-public-version=v32] .v25-start-guide,[data-public-version=v33] .v25-start-guide,[data-public-version=v34] .v25-start-guide{left:166px;bottom:16px}}
`
export function publicV23SavedWorkMessage(event: NonNullable<Extract<
  Awaited<ReturnType<Runtime['action']>>, { status: 'saved' }>['workEvent']>): string {
  return event.kind === 'dig'
    ? `Dig saved: ${event.id}. ${event.stoneGained} stone gained, ${event.xp} XP.`
    : `Build saved: ${event.id}. ${event.logsSpent} logs spent, ${event.xp} XP.`
}
const v26TerrainRejection: Record<string, string> = {
  unrevealed: 'Reveal this ground before changing it.',
  invalid_pose: 'Stand on supported ground before changing terrain.',
  wet: 'Choose dry ground outside the river and wetland.',
  occupied: 'This ground supports a protected home, route, or structure.',
  too_far: 'Move within 5 m of the column center.',
  requires_tool: 'Equip a suitable owned tool for this terrain layer. The field spade also works with eligible E interactions.',
  skill_locked: 'Raise Excavation skill before opening this layer.',
  capacity: 'Make room in your backpack and terrain bag first.',
  bedrock: 'Bedrock cannot be excavated.',
  'columns-full': 'The saved terrain has reached its column limit.',
  'bag-full': 'The terrain bag is full.',
  'already-filled': 'This column is already filled.',
  'requires-soil': 'Earn soil by digging before filling this column.',
}
export function publicV26TerrainRejectionMessage(reason: string): string {
  return v26TerrainRejection[reason] ?? `Terrain action could not be saved (${reason}).`
}
export function publicV31SoilRejectionMessage(reason: string): string {
  if (reason === 'occupied') return 'This ground is underfoot, occupied, or reserved for a bridge or ladder. Try open dry ground a few steps away.'
  if (reason === 'too_far') return 'Move within 5 m of the ground cell before placing or removing soil.'
  if (reason === 'wet') return 'Soil cannot be placed in the river or wetland. Choose dry ground.'
  if (reason === 'requires_soil') return 'Dig safe dry ground first to collect soil for this lift.'
  if (reason === 'requires_tool') return 'Equip your owned field spade to place or remove soil.'
  return `Soil action rejected: ${reason}.`
}
const v26SafetyRejection: Record<string, string> = {
  not_owned: 'Gather 4 logs before building a pit ladder.',
  wrong_cell: 'Stand in this pit before building its ladder.',
  needs_depth: 'A pit ladder needs a pit at least two layers deep.',
  already_done: 'This pit already has a saved ladder.',
  not_trapped: 'Return home is available only when every checked exit is blocked.',
  cooldown: 'Return home is cooling down for 30 minutes after the last rescue.',
  unsafe_home: 'The home return point is not safe.',
}
export function publicV26SafetyRejectionMessage(reason: string): string {
  return v26SafetyRejection[reason] ?? `Safety action could not be saved (${reason}).`
}
export function publicV26PitLadderWitness(opportunity: NonNullable<
  WizardViewProjection['v26PitLadderOpportunity']>): PitLadderWitness {
  return { kind: 'pit-ladder/v1', action: { kind: 'place-pit-ladder',
    gx: opportunity.gx, gz: opportunity.gz } }
}
export function publicV26KnownPitLadderHere(view: WizardViewProjection): boolean {
  const [x, , z] = view.player.position
  const gx = Math.ceil(x / WORLD_CELL_METERS - 0.5)
  const gz = Math.ceil(z / WORLD_CELL_METERS - 0.5)
  return view.v26PitLadders?.some((ladder) => ladder.gx === gx && ladder.gz === gz) ?? false
}

/** Controls only route an actually selected, ready canonical ID to the checked writer. */
export function publicV23WorkRouteForView(view: WizardViewProjection, id: string,
  owner: 'greenway' | 'streamed', seed: string): 'regional-work' | 'legacy-work' | null {
  const selected = view.savedTerrainWorks?.preview?.selected
  if (view.controllerActionsEnabled === false || !view.savedTerrainWorks?.modeActive
    || selected?.site.id !== id || selected.rejection !== null) return null
  if (id.startsWith('works5:')) return owner === 'streamed' && resolvePublicV23Site(seed, id)
    ? 'regional-work' : null
  return publicV17WorkRouteForView(view, id, owner, seed) ? 'legacy-work' : null
}

/** V28 confirms only the current checked Ready river site; old Works routing is unchanged. */
export function publicV28WorkRouteForView(view: WizardViewProjection, id: string,
  owner: 'greenway' | 'streamed', seed: string): 'river-bridge/v1'
    | 'regional-work' | 'legacy-work' | null {
  if (!id.startsWith('works6:')) return publicV23WorkRouteForView(view, id, owner, seed)
  const selected = view.savedTerrainWorks?.preview?.selected
  return owner === 'streamed' && view.controllerActionsEnabled !== false
    && view.savedTerrainWorks?.modeActive && selected?.site.id === id
    && selected.rejection === null && resolvePublicV28RiverBridge(seed, id)
    ? 'river-bridge/v1' : null
}

export function publicV23DiscoveredWestSite(seed: string, discoveryMask: Uint8Array,
  aimZ: number) {
  const id = publicV23PlacementId(aimZ)
  const site = id && resolvePublicV23Site(seed, id)
  return site && site.footprintTileIds.every((tile) =>
    discoveryMaskHasTileId(discoveryMask, tile)) ? site : null
}

export type PublicV23ControllerProps = PublicV23EntryBindings & Readonly<{ start: PublicV23Start }>
export type PublicV24ControllerProps = PublicV24EntryBindings & Readonly<{
  start: PublicV24Start; version: 'v24' }>
export type PublicV25ControllerProps = PublicV25EntryBindings & Readonly<{
  start: PublicV25Start; version: 'v25' }>
export type PublicV26ControllerProps = PublicV26EntryBindings & Readonly<{
  start: PublicV26Start; version: 'v26' }>
export type PublicV27ControllerProps = PublicV27EntryBindings & Readonly<{
  start: PublicV27Start; version: 'v27' }>
export type PublicV28ControllerProps = PublicV28EntryBindings & Readonly<{
  start: PublicV28Start; version: 'v28' }>
export type PublicV29ControllerProps = PublicV29EntryBindings & Readonly<{
  start: PublicV29Start; version: 'v29' }>
export type PublicV30ControllerProps = PublicV30EntryBindings & Readonly<{
  start: PublicV30Start; version: 'v30' }>
export type PublicV31ControllerProps = PublicV31EntryBindings & Readonly<{
  start: PublicV31Start; version: 'v31' }>
export type PublicV32ControllerProps = PublicV32EntryBindings & Readonly<{
  start: PublicV32Start; version: 'v32' }>
export type PublicV33ControllerProps = PublicV33EntryBindings & Readonly<{
  start: PublicV33Start; version: 'v33' }>
export type PublicV34ControllerProps = PublicV34EntryBindings & Readonly<{
  start: PublicV34Start; version: 'v34' }>
export type PublicV35ControllerProps = PublicV35EntryBindings & Readonly<{
  start: PublicV35Start; version: 'v35' }>
export type PublicV36ControllerProps = PublicV36EntryBindings & Readonly<{
  start: PublicV36Start; version: 'v36' }>
export type PublicV37ControllerProps = PublicV37EntryBindings & Readonly<{
  start: PublicV37Start; version: 'v37' }>
export type PublicV38ControllerProps = PublicV38EntryBindings & Readonly<{
  start: PublicV38Start; version: 'v38' }>
export type PublicV39ControllerProps = PublicV39EntryBindings & Readonly<{
  start: PublicV39Start; version: 'v39' }>
export type PublicV40ControllerProps = PublicV40EntryBindings & Readonly<{
  start: PublicV40Start; version: 'v40' }>
export type PublicV41ControllerProps = PublicV41EntryBindings & Readonly<{
  start: PublicV41Start; version: 'v41' }>
export type PublicV42ControllerProps = PublicV42EntryBindings & Readonly<{
  start: PublicV42Start; version: 'v42' }>

/** The clicked cell is not a claim of mineability; only the checked action decides. */
export function publicV29ActionRejectionMessage(reason: string): string {
  const message: Record<string, string> = {
    requires_spade: 'This soil layer needs a spade. Equip one before digging.',
    requires_pick: 'This rock layer needs a pick. Buy and equip one at Greenway Outfitters.',
    requires_enchanted_pick: 'This deep layer needs an enchanted pick equipped.',
    skill_locked: 'Your Excavation skill is not high enough for this layer yet.',
    too_far: 'Move within 5 m of the selected excavation cell, or within 3 m of Outfitters to trade.',
    capacity: 'Your backpack and terrain bag are full. Sell or place materials before digging.',
    occupied: 'A structure, route, store, camp, or pit ladder occupies this excavation cell.',
    wet: 'This wet or river cell cannot be excavated.',
    bedrock: 'You reached bedrock. This column cannot be dug deeper.',
    unrevealed: 'Explore this cell before excavating it.',
    invalid_pose: 'Land on stable ground or a supported route before digging.',
  }
  return message[reason] ?? `Action rejected: ${reason}.`
}

export function publicV30ClaimRejectionMessage(reason: string): string {
  const message: Record<string, string> = {
    too_far: 'Stand on dry ground within 3 m of the saved bridge’s far exit.',
    undiscovered: 'Explore the bridge’s far exit before claiming the River Works reward.',
    not_built: 'Build and cross a saved River Works bridge before claiming.',
    unavailable_here: 'Reach the bridge’s far exit in its current region before claiming.',
    already_claimed: 'This world has already saved its one River Works bridgehead reward.',
    invalid_value: 'The reward cannot fit safely in this save.',
  }
  return message[reason] ?? `River Works claim was not saved (${reason}).`
}

function publicV35LedgerRejectionMessage(reason: string): string {
  const message: Record<string, string> = {
    requires_first_find: 'Claim The Surveyor’s First Find before surveying this crossing.',
    requires_survey: 'Survey a saved connected-river far-bank exit first.',
    not_built: 'Build the north ladder and a saved connected-river bridge first.',
    undiscovered: 'Reveal the dry far-bank exit before surveying.',
    unavailable_here: 'Use the crossing post on its streamed far bank, or return to Greenway Outfitters to deliver.',
    too_far: 'Land within 3 m of the dry far-bank exit or Greenway Outfitters.',
    no_stone: 'Dig to stone depth with an equipped pick and carry one terrain-bag stone.',
    already_surveyed: 'This connected-river exit was already surveyed.',
    already_claimed: 'The Outfitters’ Ledger reward was already claimed.',
    invalid_site: 'This is not a connected-river bridge site.',
    invalid_progress: 'The checked quest progress could not be read safely.',
    invalid_value: 'The quest reward cannot fit safely in this save.',
  }
  return message[reason] ?? `Outfitters’ Ledger was not saved (${reason}).`
}

export function publicV32HighlandRejectionMessage(reason: string): string {
  const message: Record<string, string> = {
    too_far: 'Move closer to the revealed Quarry Crown or stone outcrop.',
    unrevealed: 'Walk nearer to reveal this part of the Highland before interacting.',
    not_grounded: 'Land on firm ground before studying or extracting.',
    already_studied: 'Quarry Crown was already studied in this save.',
    study_crown_first: 'Study the revealed Quarry Crown before extracting stone.',
    requires_spade: 'Equip your field spade before extracting Highland stone.',
    skill_locked: 'Reach Excavation Lv2 before extracting Highland stone.',
    capacity: 'Make room for two stone in your backpack.',
    recovering: 'This outcrop is recovering. Try another revealed stone node.',
    not_found: 'This stone outcrop is not part of the checked Highland.',
  }
  return message[reason] ?? `Highland action was not saved (${reason}).`
}

function publicV33FairyRejectionMessage(reason: string): string {
  const message: Record<string, string> = {
    too_far: 'Move within 3 m of the fairy ring before using it.',
    unrevealed: 'Walk to reveal both fairy-ring tiles before traveling.',
    not_grounded: 'Land on supported ground before using the fairy ring.',
    wrong_region: 'Stand beside the ring in its own region.',
    undiscovered: 'Discover both Greenway and Mireglass rings before traveling.',
    already_discovered: 'Greenway Ring is already discovered in this save.',
    unsafe_arrival: 'The destination is not safe to land on right now.',
    overflow: 'The world clock cannot advance safely.',
  }
  return message[reason] ?? `Fairy-ring action was not saved (${reason}).`
}

export function publicV29DigSavedMessage(kind: 'Dig' | 'Excavation', gx: number, gz: number,
  outcome?: PublicV29DigOutcome): string {
  const saved = `${kind} saved at column ${gx}, ${gz}.`
  if (!outcome) return saved
  const yieldMessage = outcome.material
    ? `Found ${outcome.material.replaceAll('_', ' ')}.` : 'No new material.'
  return `${saved} ${yieldMessage} Depth ${(outcome.depthLayers * 0.4).toFixed(1)} m.`
}

/** Resolve only a current, checked V24 choice; generic E never buys, sells, equips, or casts. */
export function publicV24ActionForChoice(choices: readonly PublicV24MireglassChoice[],
  id: PublicV24MireglassChoiceId | null, route: 'generic' | 'explicit'): MireglassWitness | null {
  const choice = choices.find((entry) => entry.id === id && entry.actionable
    && (route === 'explicit' || entry.genericInteract))
  return choice ? { kind: 'mireglass-action/v1', action: choice.action } : null
}
/** Shared HUD controls are explicit choices, never generic E purchases or sales. */
export function publicV24ActionForSharedIntent(intent: WizardViewIntent,
  choices: readonly PublicV24MireglassChoice[], nearbyStoreId: string | null,
  openStoreId: string | null,
  stacks: WizardViewProjection['backpack']['stacks'] = []): MireglassWitness | null {
  if (intent.type === 'spell.cast' && intent.spellId === 'wayfinder_glow')
    return publicV24ActionForChoice(choices, 'mireglass:cast:wayfinder_glow', 'explicit')
  if (intent.type === 'equipment.equip') {
    const stack = stacks.find((entry) => entry.id === intent.stackId
      && entry.equippableSlots?.includes(intent.slot))
    return stack ? publicV24ActionForChoice(choices,
      `mireglass:equip:${stack.itemId}`, 'explicit') : null
  }
  if ((intent.type !== 'store.select-listing' && intent.type !== 'store.sell-item')
    || !nearbyStoreId || intent.storeId !== nearbyStoreId || intent.storeId !== openStoreId)
    return null
  if (intent.type === 'store.select-listing') return publicV24ActionForChoice(choices,
    `mireglass:buy:${intent.listingId}`, 'explicit')
  const id: PublicV24MireglassChoiceId = intent.quantity === 1
    ? `mireglass:sell:${intent.itemId}` : `mireglass:sell-all:${intent.itemId}`
  const current = choices.find((choice) => choice.id === id)
  return current?.action.type === 'sell_item' && current.action.quantity === intent.quantity
    ? publicV24ActionForChoice(choices, id, 'explicit') : null
}
export function publicV24OpenStoreId(view: WizardViewProjection, requested: string | null) {
  return requested && view.nearbyStoreId === requested
    && view.stores.some((store) => store.id === requested) ? requested : view.openStoreId
}

/** Highland controls can only select the current, projected checked interaction. */
export function publicV32ActionForProjectedChoice(view: WizardViewProjection,
  route: 'generic' | { nodeId: string }): PublicV32HighlandWitness | null {
  const prompt = route === 'generic' ? view.nearbyInteraction : null
  const targetId = route === 'generic' ? prompt?.targetId
    : publicV32NodeInteractionId(route.nodeId)
  if (!targetId || (route === 'generic' && !prompt?.actionable)
    || !view.checkedActionChoices?.some((choice) =>
      choice.id === targetId && choice.actionable)) return null
  if (targetId === PUBLIC_V32_CROWN_INTERACTION_ID)
    return route === 'generic' ? { kind: 'highland-discover/v1',
      landmarkId: HIGHLAND_LANDMARK.id } : null
  const nodeId = view.highlandExtraction?.nodeId
  return nodeId && targetId === publicV32NodeInteractionId(nodeId)
    ? { kind: 'highland-extract/v1', nodeId } : null
}

/** A discovered east route may be the primary V32 objective without deleting the west route. */
export function publicV32HighlandObjective(view: WizardViewProjection,
  owner: 'greenway' | 'streamed', position: { x: number; z: number },
  carryingQuarryStone: boolean, northLadderBuilt: boolean):
  { summary: string; action: string } | null {
  const onApproach = position.x >= 8 && Math.abs(position.z) <= 12
    && view.map.tiles.some((tile) => tile.discovered
      && (tile.hasEastTrail || tile.hasHighlandTrail))
  const inQuarry = owner === 'streamed' && view.map.title === 'Highland Quarry'
  const prioritizedGuidance = owner === 'streamed' && view.map.guidancePriority
    ? view.map.guidance : null
  if (!onApproach && !inQuarry && !prioritizedGuidance) return null
  if (carryingQuarryStone) return { summary: 'Highland stone: return west to trade',
    action: view.map.guidance || 'Return west on discovered ground and sell the stone at Greenway Outfitters.' }
  if (owner === 'greenway' && position.z >= -6) return {
    summary: 'Highland Quarry: bypass the east rock wall',
    action: northLadderBuilt
      ? 'The rock wall blocks a straight east exit from this valley. Backtrack west to your saved north ladder, climb it, stay north of the wall while passing x 30, then turn southeast and follow discovered ground toward Highland Quarry.'
      : 'The rock wall blocks a straight east exit. Gather four logs and build a supported north cliff ladder, climb it, stay north of the wall while passing x 30, then turn southeast toward Highland Quarry.',
  }
  if (owner === 'greenway') return { summary: 'Highland Quarry: pass north of the east wall',
    action: 'Stay on the north side of the rock wall as you pass x 30, then turn southeast and follow discovered ground toward Highland Quarry.' }
  if (prioritizedGuidance && !inQuarry) return {
    summary: /\bbacktrack west\b/i.test(prioritizedGuidance)
      ? 'Highland route: backtrack west to the north bypass'
      : 'Highland route: follow the charted dry ground',
    action: prioritizedGuidance,
  }
  return { summary: inQuarry ? 'Highland Quarry: study and extract'
      : 'Highland Quarry: follow the east trail',
  action: view.map.guidance || 'Follow the revealed eastern trail on walkable ground toward Highland Quarry.' }
}

export function PublicV23Controller(props: PublicV23ControllerProps | PublicV24ControllerProps
  | PublicV25ControllerProps | PublicV26ControllerProps | PublicV27ControllerProps
  | PublicV28ControllerProps | PublicV29ControllerProps | PublicV30ControllerProps
  | PublicV31ControllerProps | PublicV32ControllerProps | PublicV33ControllerProps
  | PublicV34ControllerProps | PublicV35ControllerProps | PublicV36ControllerProps
  | PublicV37ControllerProps | PublicV38ControllerProps | PublicV39ControllerProps
  | PublicV40ControllerProps | PublicV41ControllerProps | PublicV42ControllerProps) {
  const v42 = 'version' in props && props.version === 'v42'
  const v41 = 'version' in props && (props.version === 'v41' || v42)
  const v40 = 'version' in props && (props.version === 'v40' || v41)
  const v39 = 'version' in props && (props.version === 'v39' || v40)
  const v38 = 'version' in props && (props.version === 'v38' || v39)
  const v37 = 'version' in props && (props.version === 'v37' || v38)
  const v36 = 'version' in props && (props.version === 'v36' || v37)
  const v35 = 'version' in props && (props.version === 'v35' || v36)
  const v34 = 'version' in props && (props.version === 'v34' || v35)
  const v33 = 'version' in props && (props.version === 'v33' || v34)
  const v32 = 'version' in props && (props.version === 'v32' || v33)
  const v31 = 'version' in props && (props.version === 'v31' || v32)
  const v30 = 'version' in props && props.version === 'v30'
  const v29 = 'version' in props && props.version === 'v29'
  const v28 = 'version' in props && props.version === 'v28'
  const v27 = 'version' in props && props.version === 'v27'
  const v26 = 'version' in props && props.version === 'v26'
  const v25 = 'version' in props && props.version === 'v25'
  const bridgeheadWorld = v30 || v31
  const miningWorld = v29 || bridgeheadWorld
  const riverBridgeWorld = v28 || miningWorld
  const physicalWorld = v26 || v27 || riverBridgeWorld
  const river = v25 || physicalWorld
  const v24 = 'version' in props
  const saveVersion = v42 ? '42' : v41 ? '41' : v40 ? '40' : v39 ? '39' : v38 ? '38' : v37 ? '37' : v36 ? '36' : v35 ? '35' : v34 ? '34' : v33 ? '33' : v32 ? '32' : v31 ? '31' : v30 ? '30' : v29 ? '29' : v28 ? '28' : v27 ? '27' : v26 ? '26' : v25 ? '25' : v24 ? '24' : '23'
  const traceRef = useRef<ReturnType<typeof createPublicV17InputTrace> | null | undefined>(undefined)
  if (traceRef.current === undefined) traceRef.current = publicV17InputTraceEnabled(
    typeof window === 'undefined' ? '' : window.location?.hostname ?? '',
    typeof window === 'undefined' ? '' : window.location?.search ?? '')
    ? createPublicV17InputTrace() : null
  const trace = traceRef.current
  const runtimeRef = useRef<Runtime | V24Runtime | V25Runtime | V26Runtime | V27Runtime
    | V28Runtime | V29Runtime | V30Runtime | V31Runtime | V32Runtime
    | V33Runtime | V34Runtime | V35Runtime | V36Runtime | V37Runtime | V38Runtime | V39Runtime | V40Runtime | V41Runtime | V42Runtime | null>(null)
  if (!runtimeRef.current) {
    runtimeRef.current = 'version' in props && props.version === 'v42'
      ? createPublicV42ControllerRuntime(props.start, (revision, lineage, witness) =>
        commitPublicV42(props.locks, props.store, revision, lineage, witness),
        (revision, lineage) => requestPublicV42ReturnHome(props.locks, props.store, revision, lineage))
      : 'version' in props && props.version === 'v41'
      ? createPublicV41ControllerRuntime(props.start, (revision, lineage, witness) =>
        commitPublicV41(props.locks, props.store, revision, lineage, witness),
        (revision, lineage) => requestPublicV41ReturnHome(props.locks, props.store, revision, lineage))
      : 'version' in props && props.version === 'v40'
      ? createPublicV40ControllerRuntime(props.start, (revision, lineage, witness) =>
        commitPublicV40(props.locks, props.store, revision, lineage, witness),
        (revision, lineage) => requestPublicV40ReturnHome(props.locks, props.store, revision, lineage))
      : 'version' in props && props.version === 'v39'
      ? createPublicV39ControllerRuntime(props.start, (revision, lineage, witness) =>
        commitPublicV39(props.locks, props.store, revision, lineage, witness),
        (revision, lineage) => requestPublicV39ReturnHome(props.locks, props.store, revision, lineage))
      : 'version' in props && props.version === 'v38'
      ? createPublicV38ControllerRuntime(props.start, (revision, lineage, witness) =>
        commitPublicV38(props.locks, props.store, revision, lineage, witness),
        (revision, lineage) => requestPublicV38ReturnHome(props.locks, props.store, revision, lineage))
      : 'version' in props && props.version === 'v37'
      ? createPublicV37ControllerRuntime(props.start, (revision, lineage, witness) =>
        commitPublicV37(props.locks, props.store, revision, lineage, witness),
        (revision, lineage) => requestPublicV37ReturnHome(props.locks, props.store, revision, lineage))
      : 'version' in props && props.version === 'v36'
      ? createPublicV36ControllerRuntime(props.start, (revision, lineage, witness) =>
        commitPublicV36(props.locks, props.store, revision, lineage, witness),
        (revision, lineage) => requestPublicV36ReturnHome(props.locks, props.store,
          revision, lineage))
      : 'version' in props && props.version === 'v35'
      ? createPublicV35ControllerRuntime(props.start, (revision, lineage, witness) =>
        commitPublicV35(props.locks, props.store, revision, lineage, witness),
        (revision, lineage) => requestPublicV35ReturnHome(props.locks, props.store,
          revision, lineage))
      : 'version' in props && props.version === 'v34'
      ? createPublicV34ControllerRuntime(props.start, (revision, lineage, witness) =>
        commitPublicV34(props.locks, props.store, revision, lineage, witness),
        (revision, lineage) => requestPublicV34ReturnHome(props.locks, props.store,
          revision, lineage))
      : 'version' in props && props.version === 'v33'
      ? createPublicV33ControllerRuntime(props.start, (revision, lineage, witness) =>
        commitPublicV33(props.locks, props.store, props.sourceStore, props.v31Store,
          props.v30Store, props.v29Store, props.v28Store, props.v27Store,
          props.v26Store, props.v25Store, props.v24Store, props.v23Store,
          props.v17Store, revision, lineage, witness),
        (revision, lineage) => requestPublicV33ReturnHome(props.locks, props.store,
          props.sourceStore, props.v31Store, props.v30Store, props.v29Store,
          props.v28Store, props.v27Store, props.v26Store, props.v25Store,
          props.v24Store, props.v23Store, props.v17Store, revision, lineage))
      : 'version' in props && props.version === 'v32'
      ? createPublicV32ControllerRuntime(props.start, (revision, lineage, witness) =>
        commitPublicV32(props.locks, props.store, props.sourceStore, props.v30Store,
          props.v29Store, props.v28Store, props.v27Store, props.v26Store,
          props.v25Store, props.v24Store, props.v23Store, props.v17Store,
          revision, lineage, witness),
        (revision, lineage) => requestPublicV32ReturnHome(props.locks, props.store,
          props.sourceStore, props.v30Store, props.v29Store, props.v28Store,
          props.v27Store, props.v26Store, props.v25Store, props.v24Store,
          props.v23Store, props.v17Store, revision, lineage))
      : 'version' in props && props.version === 'v31'
      ? createPublicV31ControllerRuntime(props.start, (revision, lineage, witness) =>
        commitPublicV31(props.locks, props.store, props.sourceStore, props.v29Store,
          props.v28Store, props.v27Store, props.v26Store, props.v25Store,
          props.v24Store, props.v23Store, props.v17Store, revision, lineage, witness),
        (revision, lineage) => requestPublicV31ReturnHome(props.locks, props.store,
          props.sourceStore, props.v29Store, props.v28Store, props.v27Store,
          props.v26Store, props.v25Store, props.v24Store, props.v23Store,
          props.v17Store, revision, lineage))
      : 'version' in props && props.version === 'v30'
      ? createPublicV30ControllerRuntime(props.start, (revision, lineage, witness) =>
        commitPublicV30(props.locks, props.store, props.sourceStore, props.v28Store,
          props.v27Store, props.v26Store, props.v25Store, props.v24Store,
          props.v23Store, props.v17Store, revision, lineage, witness, trace
            ? (sample) => trace.record('controller.save.phase', sample) : undefined),
        (revision, lineage) => requestPublicV30ReturnHome(props.locks, props.store,
          props.sourceStore, props.v28Store, props.v27Store, props.v26Store,
          props.v25Store, props.v24Store, props.v23Store, props.v17Store,
          revision, lineage))
      : 'version' in props && props.version === 'v29'
      ? createPublicV29ControllerRuntime(props.start, (revision, lineage, witness) =>
        commitPublicV29(props.locks, props.store, props.sourceStore, props.v27Store,
          props.v26Store, props.v25Store, props.v24Store, props.v23Store,
          props.v17Store, revision, lineage, witness),
        (revision, lineage) => requestPublicV29ReturnHome(props.locks, props.store,
          props.sourceStore, props.v27Store, props.v26Store, props.v25Store,
          props.v24Store, props.v23Store, props.v17Store, revision, lineage))
      : 'version' in props && props.version === 'v28'
      ? createPublicV28ControllerRuntime(props.start, (revision, lineage, witness) =>
        commitPublicV28(props.locks, props.store, props.sourceStore, props.v26Store,
          props.v25Store, props.v24Store, props.v23Store, props.v17Store,
          revision, lineage, witness),
        (revision, lineage) => requestPublicV28ReturnHome(props.locks, props.store,
          props.sourceStore, props.v26Store, props.v25Store, props.v24Store,
          props.v23Store, props.v17Store, revision, lineage))
      : 'version' in props && props.version === 'v27'
      ? createPublicV27ControllerRuntime(props.start, (revision, lineage, witness) =>
        commitPublicV27(props.locks, props.store, props.sourceStore, props.v25Store,
          props.v24Store, props.v23Store, props.v17Store, revision, lineage, witness),
        (revision, lineage) => requestPublicV27ReturnHome(props.locks, props.store,
          props.sourceStore, props.v25Store, props.v24Store, props.v23Store,
          props.v17Store, revision, lineage))
      : 'version' in props && props.version === 'v26'
      ? createPublicV26ControllerRuntime(props.start, (revision, lineage, witness) =>
        commitPublicV26(props.locks, props.store, props.sourceStore, props.v24Store,
          props.v23Store, props.v17Store, revision, lineage, witness),
        (revision, lineage) => requestPublicV26ReturnHome(props.locks, props.store,
          props.sourceStore, props.v24Store, props.v23Store, props.v17Store, revision, lineage))
      : 'version' in props && props.version === 'v25'
      ? createPublicV25ControllerRuntime(props.start, (revision, lineage, witness) =>
        commitPublicV25(props.locks, props.store, props.sourceStore, props.v23Store,
          props.v17Store, revision, lineage, witness), trace
        ? (sample) => trace.record('controller.save.phase', sample) : undefined)
      : 'version' in props && props.version === 'v24'
      ? createPublicV24ControllerRuntime(props.start, (revision, lineage, witness) =>
        commitPublicV24(props.locks, props.store, props.sourceStore, props.ancestorStore,
          revision, lineage, witness, trace
            ? (sample) => trace.record('controller.save.phase', sample) : undefined), trace
        ? (sample) => trace.record('controller.save.phase', sample) : undefined)
      : createPublicV23ControllerRuntime(props.start, (revision, lineage, witness) =>
        commitPublicV23(props.locks, props.store, props.sourceStore,
          revision, lineage, witness))
  }
  const runtime = runtimeRef.current
  const activeMemo = useRef<ActiveViewMemo | null>(null)
  const readActive = (status?: ReturnType<typeof runtime.status>) =>
    publicV23ReadActiveView(runtime, activeMemo, status)
  const [, redraw] = useState(0)
  const [messages, setMessages] = useState<string[]>([])
  const [walkRequested, setWalkRequested] = useState(false)
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [openStoreId, setOpenStoreId] = useState<string | null>(null)
  const [workMode, setWorkMode] = useState(false)
  const [workKind, setWorkKind] = useState<WorkKind>('bridge')
  const [aimX, setAimX] = useState<number | null>(null)
  const [aimZ, setAimZ] = useState<number | null>(null)
  const [traceJson, setTraceJson] = useState('')
  const [obstacleCue, setObstacleCue] = useState<string | null>(null)
  const held = useRef<readonly [number, number]>([0, 0])
  const timedHeld = useRef<{ nextAtMs: number; vector: readonly [number, number] } | null>(null)
  const inputQueue = useRef<InputToken[]>([])
  const devRoute = useRef<{ waypoints: readonly { x: number; z: number }[]; index: number } | null>(null)
  const edgePulse = useRef<Extract<InputToken, { kind: 'pulse' }> | null>(null)
  const busy = useRef(false)
  const running = useRef(false)
  const saveTask = useRef<Promise<void> | null>(null)
  const actionTask = useRef<Promise<void> | null>(null)
  const lastMovementRejection = useRef<string | null>(null)
  const obstacleCueUntil = useRef(0)
  const repaint = () => redraw((value) => value + 1)
  const repaintQueued = () => { if (!busy.current) repaint() }
  const tell = (message: string) => setMessages((prior) => [...prior.slice(-3), message])
  const renderStartedAt = trace ? performance.now() : 0
  const status = runtime.status(), active = readActive(status), snapshot = runtime.preview()
  const viewFinishedAt = trace ? performance.now() : 0
  const regionalAim = aimZ ?? publicV23ReticleAimZ(active.player.position, active.player.yaw)
  const baseProjectionStartedAt = trace ? performance.now() : 0
  const baseProjection = publicWorldV23ViewProjection(snapshot, active, messages,
    selectedSiteId, openStoreId, walkRequested, { kind: workKind,
      bodyYaw: active.player.yaw,
      aimX: aimX ?? publicV17ReticleAimX(active.player.position,
        active.player.yaw, workKind), aimZ: regionalAim,
      modeActive: workMode && status.gate !== 'blocked',
      actionsEnabled: status.gate !== 'blocked' })
  const baseProjectionFinishedAt = trace ? performance.now() : 0
  const mireglass = v24 ? projectPublicV24Mireglass(baseProjection, snapshot, active) : null
  const mireglassProjectionFinishedAt = trace && v24 ? performance.now() : baseProjectionFinishedAt
  const projected = mireglass?.projection ?? baseProjection
  const physical = physicalWorld ? publicWorldV26ViewProjection(snapshot as PublicV26Progress, projected)
    : projected
  const riverWork = riverBridgeWorld ? publicWorldV28ViewProjection(snapshot as PublicV28Progress, physical,
    { kind: workKind, modeActive: workMode && status.gate !== 'blocked',
      actionsEnabled: status.gate !== 'blocked', bodyYaw: active.player.yaw, aimX }) : physical
  const mined = miningWorld ? projectPublicV29WorldView(snapshot as PublicV29Progress, riverWork) : riverWork
  const bridgehead = bridgeheadWorld
    ? projectPublicV30WorldView(snapshot as PublicV30Progress, mined) : mined
  const soilWorld = v31 ? projectPublicV31WorldView(snapshot as PublicV31Progress, bridgehead)
    : bridgehead
  const v25Guidance = river ? publicV25NorthLadderGuidance({ ...soilWorld, v25RiverActive: true }) : null
  const v26Works = physicalWorld ? (snapshot as PublicV26Progress).greenwayWorks : null
  const v27Guide = (v27 || riverBridgeWorld) && v26Works
    ? publicV27StarterGuide(soilWorld, v26Works, { movementOwner: active.movementOwner,
      riverBridgeBuilt: riverBridgeWorld && (snapshot as PublicV28Progress).riverBridgeIds.length > 0,
      riverBridgeId: riverBridgeWorld ? (snapshot as PublicV28Progress).riverBridgeIds[0] : null,
      claimedBridgeheadId: bridgeheadWorld
        ? (snapshot as PublicV30Progress).claimedBridgeheadId : null,
      mireglassGuidance: mireglass?.projection.map.title === 'Mireglass Reach'
        ? mireglass.projection.map.guidance : null,
      fringeMarkerStudied: snapshot.state.mireglass.fringeMarkerStudied,
      mireglassCacheRevealed: snapshot.state.mireglass.cacheRevealed,
      mireglassCacheExcavated: snapshot.state.mireglass.cacheExcavated,
      authoredFenBridgeId: snapshot.state.mireglass.builtRoutes.bridge,
      authoredSlateLadderId: snapshot.state.mireglass.builtRoutes.ladder,
      regionalSlateLadderBuilt: snapshot.regionalWorks.builtLadderIds.length > 0,
      discoveryMask: snapshot.state.discoveryMask,
      builtTerrainWorkIds: snapshot.state.terrainWorks.builtWorkIds,
      grounded: active.player.verticalVelocity === 0,
      openPitColumns: physicalWorld ? (snapshot as PublicV26Progress).terrain.columns : [],
      depletedMireglassResourceIds: snapshot.state.mireglass.depletedResourceIds,
      fieldSpadeOwned: snapshot.state.player.inventory.some((stack) =>
        stack.itemId === 'field_spade' && stack.quantity > 0)
        || Object.values(snapshot.state.player.equipment).includes('field_spade') }) : null
  const guidedView = { ...soilWorld,
    ...((v27 || riverBridgeWorld) ? { v27WalkableSurface: true } : {}),
    ...(v24 ? { openStoreId: publicV24OpenStoreId(soilWorld, openStoreId) } : {}),
    ...(river ? { v25RiverActive: true } : {}),
    ...(v27Guide ? { map: { ...soilWorld.map, guidance: v27Guide.action } }
      : v25Guidance ? { map: { ...soilWorld.map, guidance: v25Guidance } } : {}),
    controllerActionsEnabled: status.gate !== 'blocked' }
  const highlandView = v32 ? projectPublicV32WorldView(snapshot as PublicV32Progress, guidedView)
    : guidedView
  const worldView = v33 ? projectPublicV33FairyRingView(snapshot as PublicV32Progress, highlandView)
    : highlandView
  const v34View = v34 && v26Works
    ? { ...worldView, v34Quest: surveyorCrossingQuest(worldView, v26Works,
      (snapshot as PublicV28Progress).riverBridgeIds,
      (snapshot as PublicV30Progress).claimedBridgeheadId) }
    : worldView
  const ledger = v35 ? snapshot as PublicV35Progress : null
  const ledgerQuest = ledger ? publicV35LedgerQuest(v34View, ledger) : null
  const surveyPost = ledgerQuest?.stage === 'survey' && v34View.v30Bridgehead
    && resolvePublicV28RiverBridge(snapshot.state.seed, v34View.v30Bridgehead.bridgeId)
    ? v34View.v30Bridgehead : null
  const surveyPreview = ledger && surveyPost
    ? previewPublicV35LedgerAction(ledger,
      { kind: 'ledger-survey/v1', bridgeId: surveyPost.bridgeId }) : null
  const deliverPreview = ledger && ledgerQuest
    && (ledgerQuest.stage === 'sample' || ledgerQuest.stage === 'return')
    && (v34View.nearbyStoreId === 'store-greenway' || v34View.openStoreId === 'store-greenway')
    ? previewPublicV35LedgerAction(ledger, { kind: 'ledger-deliver/v1' }) : null
  const ledgerView = ledgerQuest ? { ...v34View, v35LedgerQuest: ledgerQuest,
    ...(surveyPost && surveyPreview ? { v35LedgerSurvey: { bridgeId: surveyPost.bridgeId,
      rejection: surveyPreview.rejection, hint: surveyPreview.rejection
        ? publicV35LedgerRejectionMessage(surveyPreview.rejection) : null } } : {}),
    ...(deliverPreview ? { v35LedgerDeliver: { rejection: deliverPreview.rejection,
      hint: deliverPreview.rejection
        ? publicV35LedgerRejectionMessage(deliverPreview.rejection) : null } } : {}) }
    : v34View
  const markerProgress = v36 ? snapshot as PublicV36MarkerProgress : null
  const markerQuest = markerProgress ? publicV36MarkerQuest(ledgerView, markerProgress) : null
  const salvagerId = markerProgress ? mireglassAnchors(snapshot.state.seed).salvager.id : null
  const markerPreview = markerProgress && markerQuest?.stage === 'salvager'
    && (ledgerView.nearbyStoreId === salvagerId || ledgerView.openStoreId === salvagerId)
    ? previewPublicV36MarkerAction(markerProgress, { kind: 'marker-claim/v1' }) : null
  const markerView = markerQuest ? { ...ledgerView, v36MarkerQuest: markerQuest,
    ...(markerPreview ? { v36MarkerClaim: { rejection: markerPreview.rejection,
      hint: markerPreview.rejection
        ? publicV36MarkerRejectionMessage(markerPreview.rejection) : null } } : {}) }
    : ledgerView
  const windwardView = v37 ? projectPublicV37Windward(snapshot as PublicV36MarkerProgress, markerView) : markerView
  const signalView = v38 ? projectPublicV38Signal(snapshot as PublicV38SignalProgress, windwardView) : windwardView
  const ringView = v39 ? projectPublicV39Ringkeeper(snapshot as PublicV39RingProgress, signalView) : signalView
  const waystationView = v40 ? projectPublicV40Waystation(snapshot as PublicV40WaystationProgress, ringView) : ringView
  const view = v42 ? projectPublicV42IronHall(snapshot as PublicV42RewardProgress, waystationView)
    : v41 ? projectPublicV41IronHall(snapshot as PublicV41CombatProgress, waystationView) : waystationView
  trace?.record('controller.render', { viewMs: viewFinishedAt - renderStartedAt,
    projectionMs: performance.now() - viewFinishedAt,
    baseProjectionMs: baseProjectionFinishedAt - baseProjectionStartedAt,
    mireglassProjectionMs: mireglassProjectionFinishedAt - baseProjectionFinishedAt,
    gate: status.gate })

  function sampleTimedUntil(atMs: number) {
    const timed = timedHeld.current
    if (!timed || !Number.isFinite(atMs) || atMs < timed.nextAtMs) return
    const due = Math.floor((atMs - timed.nextAtMs) / STEP_MS) + 1
    timed.nextAtMs += due * STEP_MS
    if (!timed.vector.some(Boolean) || readActive().player.verticalVelocity !== 0) return
    let queued = inputQueue.current.filter((token) => token.kind === 'pulse').length
    let accepted = 0, merged = 0
    for (let index = 0; index < Math.min(due, MAX_PULSES + 1); index++) {
      const edge = edgePulse.current
      if (edge && inputQueue.current.includes(edge)
        && edge.vector.some((value, axis) => value && value === timed.vector[axis])) {
        edge.vector = timed.vector; edgePulse.current = null; merged++
      } else if (queued < MAX_PULSES) {
        inputQueue.current.push({ kind: 'pulse', vector: timed.vector, jump: false })
        queued++; accepted++
      } else break
    }
    trace?.record('controller.sample', { phase: busy.current ? 'write' : 'open',
      outcome: 'timed', vector: timed.vector, due, accepted, merged,
      dropped: due - accepted - merged, queued: inputQueue.current.length })
    if (accepted || merged) repaintQueued()
  }

  const save = (): Promise<void> => {
    if (saveTask.current) return saveTask.current
    if (busy.current || runtime.status().pendingFrames === 0) return Promise.resolve()
    busy.current = true; trace?.record('controller.save.start', {
      pendingFrames: runtime.status().pendingFrames, queued: inputQueue.current.length }); repaint()
    const task = (async () => {
      try {
        const result = await runtime.save()
        trace?.record('controller.save.result', { status: result.status })
        if (result.status === 'blocked') {
          devRoute.current = null
          held.current = [0, 0]; timedHeld.current = null; edgePulse.current = null
          inputQueue.current = inputQueue.current.filter((token) => token.kind === 'checked')
          tell(`Save blocked: ${result.reason}.`)
        } else if (result.status === 'saved') tell(`V${saveVersion} progress saved on this device.`)
        else if (result.status === 'deferred-airborne') tell('Land before saving pending travel.')
      } catch { devRoute.current = null
        held.current = [0, 0]; timedHeld.current = null; edgePulse.current = null
        inputQueue.current = [];
        tell('Save blocked: storage-error.') }
    })()
    saveTask.current = task.finally(() => {
      sampleTimedUntil(performance.now())
      busy.current = false; saveTask.current = null; repaint(); drainChecked()
    })
    return saveTask.current
  }
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (runtime.status().pendingFrames === 0 && !saveTask.current
        && !actionTask.current && inputQueue.current.length === 0) return
      event.preventDefault()
      event.returnValue = ''
    }
    const onVisibilityChange = () => {
      if (document.hidden && runtime.status().pendingFrames > 0 && !saveTask.current) void save()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [runtime])
  function drainChecked() {
    const token = inputQueue.current[0]
    if (token?.kind !== 'checked' || busy.current || saveTask.current || actionTask.current) return
    if (runtime.status().gate === 'blocked') {
      inputQueue.current.shift()
      tell('Queued action was not saved because the world is blocked.'); repaint(); return
    }
    if (runtime.status().gate !== 'open') return
    busy.current = true; repaint()
    actionTask.current = (async () => {
      try {
        const { intent } = token
        const result = 'kind' in intent && intent.kind === 'return-home-request'
          ? await (runtime as V26Runtime | V27Runtime | V28Runtime | V29Runtime | V30Runtime
            | V31Runtime | V32PlusRuntime).returnHome()
          : 'kind' in intent && (intent.kind === 'ironhall-claim/v1'
            || intent.kind === 'ironhall-vest-equip/v1'
            || intent.kind === 'ironhall-vest-unequip/v1'
            || intent.kind === 'ironhall-vest-repair/v1'
            || intent.kind === 'ironhall-spar/v1')
          ? await (runtime as V42Runtime).action(intent)
          : 'kind' in intent && (intent.kind === 'ironhall-study/v1'
            || intent.kind === 'ironhall-engage/v1' || intent.kind === 'ironhall-bolt/v1'
            || intent.kind === 'ironhall-guard/v1' || intent.kind === 'ironhall-rest/v1')
          ? await (runtime as V41Runtime).action(intent)
          : 'kind' in intent && (intent.kind === 'waystation-barter/v1'
            || intent.kind === 'waystation-cross/v1' || intent.kind === 'waystation-claim/v1')
          ? await (runtime as V40Runtime | V41Runtime).action(intent)
          : 'kind' in intent && (intent.kind === 'ringkeeper-discover/v1'
            || intent.kind === 'ringkeeper-link/v1' || intent.kind === 'ringkeeper-travel/v1'
            || intent.kind === 'ringkeeper-claim/v1')
          ? await (runtime as V39Runtime | V40Runtime | V41Runtime).action(intent)
          : 'kind' in intent && (intent.kind === 'signal-vantage/v1' || intent.kind === 'signal-claim/v1')
          ? await (runtime as V38Runtime | V39Runtime | V40Runtime | V41Runtime).action(intent)
          : 'kind' in intent && (intent.kind === 'windward-study/v1' || intent.kind === 'windward-cast/v1')
          ? await (runtime as V37Runtime | V38Runtime | V39Runtime | V40Runtime | V41Runtime).action(intent)
          : 'kind' in intent && intent.kind === 'marker-claim/v1'
          ? await (runtime as V36Runtime).action(intent)
          : 'kind' in intent && (intent.kind === 'ledger-survey/v1'
            || intent.kind === 'ledger-deliver/v1')
          ? await (runtime as V35Runtime | V36Runtime).action(intent)
          : 'kind' in intent && (intent.kind === 'fairy-ring-discover/v1'
            || intent.kind === 'fairy-ring-travel/v1')
          ? await (runtime as V33PlusRuntime).action(intent)
          : 'kind' in intent && (intent.kind === 'highland-discover/v1'
            || intent.kind === 'highland-extract/v1')
          ? await (runtime as V32PlusRuntime).action(intent)
          : 'kind' in intent && (intent.kind === 'soil-place/v1'
            || intent.kind === 'soil-remove/v1')
          ? await (runtime as V31Runtime | V32PlusRuntime).action(intent)
          : 'kind' in intent && intent.kind === 'bridgehead-claim/v1'
          ? await (runtime as V30Runtime | V31Runtime | V32PlusRuntime).action(intent)
          : 'kind' in intent && (intent.kind === 'mining-tool/v1'
            || intent.kind === 'deep-dig' || intent.kind === 'sell-mineral/v1')
          ? await (runtime as V29Runtime | V30Runtime | V31Runtime | V32PlusRuntime).action(intent)
          : 'kind' in intent && (intent.kind === 'terrain-action/v1'
            || intent.kind === 'pit-ladder/v1')
          ? await (runtime as V26Runtime | V27Runtime | V28Runtime | V29Runtime | V30Runtime
            | V31Runtime | V32PlusRuntime).action(intent)
          : 'kind' in intent && intent.kind === 'mireglass-action/v1'
          ? await (runtime as V24Runtime | V25Runtime | V26Runtime | V27Runtime
            | V28Runtime | V29Runtime | V30Runtime | V31Runtime | V32PlusRuntime).action(intent)
          : 'id' in intent && intent.kind === 'river-bridge/v1'
          ? await (runtime as V28Runtime | V29Runtime | V30Runtime | V31Runtime
            | V32PlusRuntime).action(intent)
          : 'id' in intent ? await runtime.action({ kind: intent.kind, id: intent.id })
            : await runtime.action({ kind: 'legacy-action', intent: intent as PublicWorldIntent })
        if (result.status === 'saved') {
          if (result.resetWalkRequested) setWalkRequested(false)
          if ('id' in intent) setWorkMode(false)
          tell('kind' in intent && intent.kind === 'return-home-request'
            ? 'Returned home safely. A 30-minute rescue cooldown has started.'
            : 'kind' in intent && intent.kind === 'ironhall-claim/v1'
            ? 'Iron Hall reward saved: 60 coins, 70 character XP, 70 Combat XP, and Guard Vest.'
            : 'kind' in intent && intent.kind === 'ironhall-vest-equip/v1'
            ? 'Guard Vest equipped and saved.'
            : 'kind' in intent && intent.kind === 'ironhall-vest-unequip/v1'
            ? 'Guard Vest removed and saved.'
            : 'kind' in intent && intent.kind === 'ironhall-vest-repair/v1'
            ? 'Guard Vest repaired to 12 durability for 18 coins and saved.'
            : 'kind' in intent && intent.kind === 'ironhall-spar/v1'
            ? 'Practice ward winding up for 20 ticks. Move beyond its slam ring to dodge.'
            : 'kind' in intent && intent.kind === 'windward-study/v1'
            ? 'Windward Step learned and saved. Walk west on the dry Highland trail to practice.'
            : 'kind' in intent && intent.kind === 'windward-cast/v1'
            ? 'Windward Step saved. Safe westbound walking steps on the revealed dry trail gain 25%.'
            : 'kind' in intent && intent.kind === 'signal-vantage/v1'
            ? 'Signal vane inspected and saved. Return to Quarry Crown to claim your reward.'
            : 'kind' in intent && intent.kind === 'signal-claim/v1'
            ? 'Highland Signal complete: 30 coins, 35 Spellcraft XP, 35 character XP, and a Stormline Foothill map bearing saved.'
            : 'kind' in intent && intent.kind === 'ringkeeper-discover/v1'
            ? 'Highland Quarry fairy ring discovered and saved. Return to the Greenway ring to establish its link.'
            : 'kind' in intent && intent.kind === 'ringkeeper-link/v1'
            ? 'Greenway to Highland Quarry ring link saved. Use the Fairy Rings panel to travel out and back.'
            : 'kind' in intent && intent.kind === 'ringkeeper-travel/v1'
            ? 'Ring travel saved. The linked path remains available in both directions.'
            : 'kind' in intent && intent.kind === 'ringkeeper-claim/v1'
            ? 'Ringkeeper reward saved: 25 coins, 30 Wayfinding XP, 20 Spellcraft XP, and 35 character XP.'
            : 'kind' in intent && intent.kind === 'marker-claim/v1'
            ? 'Beneath the Old Marker reward saved. Check your journal for the exact coin and Fen Waders branch.'
            : 'kind' in intent && intent.kind === 'ledger-survey/v1'
            ? 'Connected-river exit surveyed and saved. Find one excavated stone sample for Outfitters.'
            : 'kind' in intent && intent.kind === 'ledger-deliver/v1'
            ? 'Outfitters’ Ledger delivered and saved. Check your coins, Wayfinding XP, and travel gear.'
            : 'kind' in intent && intent.kind === 'fairy-ring-discover/v1'
            ? 'Greenway Ring discovered and saved. Discover the Mireglass Ring to link them.'
            : 'kind' in intent && intent.kind === 'fairy-ring-travel/v1'
            ? 'Fairy-ring travel saved. You can walk and explore from this destination.'
            : 'kind' in intent && intent.kind === 'highland-discover/v1'
            ? 'Quarry Crown studied and saved. Look for discovered stone outcrops nearby.'
            : 'kind' in intent && intent.kind === 'highland-extract/v1'
            ? 'Two Highland stone extracted and saved. Return west to Greenway Outfitters to trade.'
            : 'kind' in intent && intent.kind === 'soil-place/v1'
            ? `Soil placed at column ${intent.gx}, ${intent.gz}; the 0.4 m lift is saved.`
            : 'kind' in intent && intent.kind === 'soil-remove/v1'
            ? `Raised soil removed at column ${intent.gx}, ${intent.gz}; one soil returned without excavation XP.`
            : 'kind' in intent && intent.kind === 'bridgehead-claim/v1'
            ? 'bridgeheadReward' in result && result.bridgeheadReward === 'basic-pick'
              ? 'River Works claim saved: basic pick added to your tools. Equip it when ready; keep your spade for soil.'
              : 'bridgeheadReward' in result && result.bridgeheadReward === 'coins'
                ? 'River Works claim saved: 35 coins added. Return to Greenway Outfitters to sell recovered material.'
                : 'River Works claim saved. Check your tools and coins for the persisted reward.'
            : 'kind' in intent && intent.kind === 'deep-dig'
            ? publicV29DigSavedMessage('Excavation', intent.gx, intent.gz,
              miningWorld && 'digOutcome' in result
                ? result.digOutcome as PublicV29DigOutcome : undefined)
            : 'kind' in intent && intent.kind === 'mining-tool/v1'
            ? `${intent.action.tier === 'enchanted' ? 'Enchanted' : 'Basic'} pick ${intent.action.kind === 'buy' ? 'purchased' : 'equipped'} and saved.`
            : 'kind' in intent && intent.kind === 'sell-mineral/v1'
            ? `Sold ${intent.quantity} ${intent.material.replaceAll('_', ' ')} at Greenway Outfitters. Sale saved.`
            : 'kind' in intent && intent.kind === 'pit-ladder/v1'
            ? `Pit ladder saved at column ${intent.action.gx}, ${intent.action.gz}.`
            : 'kind' in intent && intent.kind === 'terrain-action/v1'
            ? intent.action.kind === 'dig' && miningWorld
              ? publicV29DigSavedMessage('Dig', intent.action.gx, intent.action.gz,
                'digOutcome' in result ? result.digOutcome as PublicV29DigOutcome : undefined)
              : `${intent.action.kind === 'dig' ? 'Dig' : 'Fill'} saved at column ${intent.action.gx}, ${intent.action.gz}.`
            : 'workEvent' in result && result.workEvent
              ? publicV23SavedWorkMessage(result.workEvent)
            : result.events.at(-1)?.type.replaceAll('_', ' ') ?? 'Action saved.')
        } else if (result.status === 'rejected') tell(v31 && result.reason === 'soil_overlap'
          ? 'Raised soil overlaps this route or build. Equip your spade and Dig the raised cell to remove it before building.'
          : 'kind' in intent && (intent.kind === 'ironhall-claim/v1'
            || intent.kind === 'ironhall-vest-equip/v1'
            || intent.kind === 'ironhall-vest-unequip/v1'
            || intent.kind === 'ironhall-vest-repair/v1'
            || intent.kind === 'ironhall-spar/v1')
          ? publicV42IronHallRejectionHint(result.reason as Parameters<typeof publicV42IronHallRejectionHint>[0])
          : 'kind' in intent && intent.kind === 'marker-claim/v1'
          ? publicV36MarkerRejectionMessage(result.reason ?? 'unavailable_here')
          : 'kind' in intent && (intent.kind === 'ledger-survey/v1'
            || intent.kind === 'ledger-deliver/v1')
          ? publicV35LedgerRejectionMessage(result.reason ?? 'unavailable_here')
          : 'kind' in intent && (intent.kind === 'fairy-ring-discover/v1'
            || intent.kind === 'fairy-ring-travel/v1')
          ? publicV33FairyRejectionMessage(result.reason ?? 'unavailable_here')
          : 'kind' in intent && (intent.kind === 'highland-discover/v1'
            || intent.kind === 'highland-extract/v1')
          ? publicV32HighlandRejectionMessage(result.reason ?? 'unavailable_here')
          : 'kind' in intent && (intent.kind === 'soil-place/v1' || intent.kind === 'soil-remove/v1')
          ? publicV31SoilRejectionMessage(result.reason ?? 'unavailable_here')
          : 'kind' in intent && intent.kind === 'bridgehead-claim/v1'
          ? publicV30ClaimRejectionMessage(result.reason ?? 'unavailable_here')
          : 'kind' in intent
          && (intent.kind === 'deep-dig' || intent.kind === 'mining-tool/v1'
            || intent.kind === 'sell-mineral/v1') ? publicV29ActionRejectionMessage(result.reason ?? 'unavailable_here')
          : 'kind' in intent && intent.kind === 'terrain-action/v1' ? publicV26TerrainRejectionMessage(result.reason ?? 'unavailable_here')
          : 'kind' in intent && (intent.kind === 'pit-ladder/v1'
            || intent.kind === 'return-home-request') ? publicV26SafetyRejectionMessage(result.reason ?? 'unavailable_here')
          : `Action rejected: ${result.reason}.`)
        else if (result.status === 'blocked') { held.current = [0, 0]
          timedHeld.current = null; edgePulse.current = null; inputQueue.current = [];
          tell(`Save blocked: ${result.reason}.`) }
        else if (result.status === 'deferred-airborne') tell('Land before interacting.')
      } catch { tell('Checked action failed; retry after rechecking the save.') }
      finally {
        if (inputQueue.current[0] === token) inputQueue.current.shift()
        busy.current = false; actionTask.current = null; repaint()
      }
    })()
  }
  const queueChecked = (intent: CheckedIntent) => {
    sampleTimedUntil(performance.now())
    if (inputQueue.current.some((token) => token.kind === 'checked')) {
      trace?.record('controller.checked', { admitted: false })
      tell('A checked action is already queued; retry after it finishes.'); return
    }
    devRoute.current = null
    trace?.record('controller.checked', { admitted: true, queued: inputQueue.current.length })
    inputQueue.current.push({ kind: 'checked', intent }); repaintQueued(); drainChecked()
  }
  const queueMireglassChoice = (id: PublicV24MireglassChoiceId | null,
    route: 'generic' | 'explicit') => {
    const witness = publicV24ActionForChoice(mireglass?.choices ?? [], id, route)
    if (witness && v24 && active.movementOwner === 'streamed') queueChecked(witness)
    else tell('This Mireglass action is not currently available.')
  }
  const queuePulse = (vector: readonly [number, number], jump: boolean) => {
    if (readActive().player.verticalVelocity !== 0) {
      tell('Land before starting another short movement or jump.'); return
    }
    if (inputQueue.current.some((token) => token.kind === 'pulse' && token.jump)) {
      tell('Finish the queued jump before another short movement or jump.'); return
    }
    if (inputQueue.current.filter((token) => token.kind === 'pulse').length >= MAX_PULSES) {
      tell('The 16-step input queue is full; retry this tap after the save.'); return
    }
    const token: Extract<InputToken, { kind: 'pulse' }> = { kind: 'pulse', vector, jump }
    inputQueue.current.push(token)
    if (!jump) edgePulse.current = token
    repaintQueued()
  }
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (obstacleCueUntil.current && performance.now() >= obstacleCueUntil.current) {
        obstacleCueUntil.current = 0; setObstacleCue(null)
      }
      if (busy.current) {
        if (timedHeld.current) { sampleTimedUntil(performance.now()); return }
        // Keep only sampled, bounded input while the checked writer owns the world.
        const vector = held.current, edge = edgePulse.current
        edgePulse.current = null
        if (runtime.status().gate === 'blocked' || !vector.some(Boolean)) return
        if (edge && inputQueue.current.includes(edge)
          && edge.vector.some((value, index) => value && value === vector[index])) {
          edge.vector = vector
          trace?.record('controller.sample', { phase: 'write', outcome: 'edge', vector,
            queued: inputQueue.current.length })
        } else if (inputQueue.current.filter((token) => token.kind === 'pulse').length < MAX_PULSES) {
          inputQueue.current.push({ kind: 'pulse', vector, jump: false })
          trace?.record('controller.sample', { phase: 'write', outcome: 'queued', vector,
            queued: inputQueue.current.length })
          repaintQueued()
        } else trace?.record('controller.sample', { phase: 'write', outcome: 'full', vector,
          queued: inputQueue.current.length })
        return
      }
      if (running.current || runtime.status().gate !== 'open') return
      running.current = true
      try {
        if (timedHeld.current) sampleTimedUntil(performance.now())
        if (inputQueue.current[0]?.kind === 'checked') { drainChecked(); return }
        if (!devRoute.current && !timedHeld.current && !held.current.some(Boolean) && !edgePulse.current
          && inputQueue.current.length === 0 && !runtime.idleFrameNeeded()) {
          if (runtime.status().pendingFrames === 0) return
          if (readActive().player.verticalVelocity === 0) { void save(); return }
        }
        const before = readActive()
        if (runtime.status().pendingFrames >= MOVE_RESERVE_AT
          && before.player.verticalVelocity === 0) { void save(); return }
        const neutral = runtime.status().pendingFrames >= MOVE_RESERVE_AT
          && before.player.verticalVelocity !== 0
        if (!neutral && timedHeld.current
          && (!inputQueue.current.length || inputQueue.current[0] === edgePulse.current)) return
        const request = !neutral && inputQueue.current[0]?.kind === 'pulse'
          ? inputQueue.current.shift() as Extract<InputToken, { kind: 'pulse' }> : null
        if (request === edgePulse.current) edgePulse.current = null
        let routeDriving = false
        let routeVector: readonly [number, number] = [0, 0]
        let routeStepMeters: number | null = null
        if (!neutral && !request && !held.current.some(Boolean)
          && before.player.verticalVelocity === 0 && devRoute.current) {
          const route = devRoute.current
          const position = before.player.position
          while (route.index < route.waypoints.length) {
            const waypoint = route.waypoints[route.index]
            const remaining = Math.hypot(waypoint.x - position.x, waypoint.z - position.z)
            if (remaining > (route.index === route.waypoints.length - 1 ? 0.5 : 0.04)) break
            route.index++
          }
          if (route.index === route.waypoints.length) {
            devRoute.current = null
            tell('Auto-route arrived at the selected ground.')
          } else {
            const waypoint = route.waypoints[route.index]
            const heading = Math.atan2(position.x - waypoint.x, position.z - waypoint.z)
            const turn = Math.atan2(Math.sin(heading - before.player.yaw),
              Math.cos(heading - before.player.yaw))
            routeVector = [-Math.max(-1, Math.min(1, turn / 0.13)), Math.abs(turn) <= 0.18 ? 1 : 0]
            routeStepMeters = Math.hypot(waypoint.x - position.x, waypoint.z - position.z)
            routeDriving = true
          }
        }
        const vector = request?.vector ?? (routeDriving ? routeVector : held.current)
        const jump = request?.jump ?? false
        const gaitStep = publicV11Gait(before.player.equipment.feet, walkRequested).metersPerStep
        const intents = neutral ? [] : jump ? [{ type: 'jump' as const }]
          : publicV14MovementIntents(before.player.yaw, vector,
            routeStepMeters === null ? gaitStep : Math.min(gaitStep, routeStepMeters))
        const frameStartedAt = trace ? performance.now() : 0
        const result = runtime.advanceFrame(intents, walkRequested)
        const frameFinishedAt = trace ? performance.now() : 0
        const after = readActive()
        trace?.record('controller.frame', { vector, jump, intents: intents.map((intent) => intent.type),
          rejections: result.rejections.map((rejection) => rejection.message),
          yawBefore: before.player.yaw, yawAfter: after.player.yaw,
          advanceMs: frameFinishedAt - frameStartedAt,
          viewMs: performance.now() - frameFinishedAt,
          queued: inputQueue.current.length })
        const movementRejection = intents.some((intent) => intent.type === 'move')
          ? result.rejections.find((rejection) => rejection.intentType === 'move'
            || rejection.code === 'terrain_missing') : undefined
        if (movementRejection) {
          if (routeDriving) {
            devRoute.current = null
            tell(`Auto-route blocked: ${movementRejection.message}`)
          }
          const newMessage = lastMovementRejection.current !== movementRejection.message
          const cueExpired = obstacleCueUntil.current === 0
          obstacleCueUntil.current = performance.now() + OBSTACLE_CUE_MS
          if (newMessage || cueExpired) {
            lastMovementRejection.current = movementRejection.message
            const hint = movementRejection.message === 'Build a Greenway bridge lane to cross the creek.'
              ? ' Chop 8 logs. Open Works (tap Works or press B), then choose Bridge.'
              : river && movementRejection.message === 'River crossing blocked. Build a bridge to cross.'
                ? ' A bridge costs 8 logs. Open Works (tap Works or press B), then choose Bridge.'
              : movementRejection.message === 'Build a ladder at this cliff face.'
                ? ' Chop 4 logs. Open Works (tap Works or press B), then choose Ladder.' : ''
            setObstacleCue(movementRejection.message + hint)
            if (newMessage && !routeDriving) tell(movementRejection.message)
          }
        } else if (result.rejections.length) {
          if (routeDriving) devRoute.current = null
          tell(routeDriving ? `Auto-route blocked: ${result.rejections.at(-1)!.message}`
            : result.rejections.at(-1)!.message)
        }
        else if (intents.some((intent) => intent.type === 'move')) {
          lastMovementRejection.current = null; obstacleCueUntil.current = 0
          setObstacleCue(null)
        }
        if (before.player.verticalVelocity === 0 && after.player.verticalVelocity !== 0) {
          timedHeld.current = null; edgePulse.current = null
          const remaining = inputQueue.current.filter((token) => token.kind === 'pulse').length
          inputQueue.current = inputQueue.current.filter((token) => token.kind === 'checked')
          if (remaining) tell('Short inputs queued before takeoff were cancelled; land before pressing again.')
        }
        if (runtime.status().pendingFrames >= 64
          && after.player.verticalVelocity === 0) void save()
        else drainChecked()
        repaint()
      } finally { running.current = false }
    }, STEP_MS)
    return () => window.clearInterval(timer)
  }, [runtime, walkRequested])

  const onIntent = (intent: WizardViewIntent) => {
    trace?.record('controller.intent', { type: intent.type,
      ...('vector' in intent ? { vector: intent.vector } : {}),
      gate: runtime.status().gate, busy: busy.current,
      queued: inputQueue.current.length })
    if (intent.type === 'dev.navigate.cancel') {
      if (devRoute.current) { devRoute.current = null; tell('Auto-route cancelled.') }
      return
    }
    if (runtime.status().gate === 'blocked') return
    if (intent.type === 'dev.navigate') {
      if (!v42 || new URLSearchParams(window.location.search).get('dev') !== '1') return
      if (actionTask.current || inputQueue.current.some((token) => token.kind === 'checked')) {
        tell('Finish the checked action before setting an auto-route.'); return
      }
      devRoute.current = null
      held.current = [0, 0]; timedHeld.current = null; edgePulse.current = null
      inputQueue.current = inputQueue.current.filter((token) => token.kind === 'checked')
      const player = readActive().player
      if (player.verticalVelocity !== 0) { tell('Land before setting an auto-route.'); return }
      const route = planDevRoute(view, player.position, intent.destination)
      if (!route.ok) tell(`Auto-route unavailable: ${route.reason}`)
      else if (!route.waypoints.length) tell('Already at the selected ground.')
      else { devRoute.current = { waypoints: route.waypoints, index: 0 }
        tell('Auto-route started. Use movement keys or Esc to cancel.') }
      return
    }
    if (intent.type === 'movement') {
      if (intent.vector.some(Boolean) || intent.atMs === undefined) devRoute.current = null
      const prior = held.current
      if (intent.atMs !== undefined) sampleTimedUntil(intent.atMs)
      held.current = intent.vector
      if (!prior.some(Boolean) && intent.vector.some(Boolean)
        && performance.now() >= obstacleCueUntil.current)
        lastMovementRejection.current = null
      if (!intent.vector.some(Boolean) && intent.atMs === undefined) {
        // Map open, blur and other untimed releases cancel unready taps.
        const cancelled = inputQueue.current.filter((token) => token.kind === 'pulse').length
        timedHeld.current = null; edgePulse.current = null
        inputQueue.current = inputQueue.current.filter((token) => token.kind === 'checked')
        if (cancelled) {
          trace?.record('controller.cancel', { reason: 'untimed-release', cancelled })
          tell(`${cancelled} queued movement step(s) cancelled when the map opened or controls lost focus.`)
        }
        repaintQueued(); drainChecked(); return
      }
      if (intent.atMs !== undefined && Number.isFinite(intent.atMs)
        && readActive().player.verticalVelocity === 0) {
        if (intent.vector.some(Boolean)) {
          if (timedHeld.current) timedHeld.current.vector = intent.vector
          else timedHeld.current = { nextAtMs: intent.atMs + STEP_MS, vector: intent.vector }
        } else timedHeld.current = null
      }
      if (readActive().player.verticalVelocity === 0 && intent.vector[1]
        && intent.vector[1] !== prior[1]) queuePulse([0, intent.vector[1]], false)
      return
    }
    if (intent.type === 'movement.tap') {
      devRoute.current = null
      if (performance.now() >= obstacleCueUntil.current) lastMovementRejection.current = null
      queuePulse(intent.vector, false); return
    }
    if (intent.type === 'jump') { devRoute.current = null; queuePulse([0, 0], true); return }
    if (intent.type === 'gait.toggle') { setWalkRequested((value) => !value); return }
    if (v37 && (intent.type === 'windward.study' || intent.type === 'windward.cast')) {
      queueChecked({ kind: intent.type === 'windward.study' ? 'windward-study/v1' : 'windward-cast/v1' })
      return
    }
    if (v38 && (intent.type === 'v38.signal.inspect' || intent.type === 'v38.signal.claim')) {
      queueChecked({ kind: intent.type === 'v38.signal.inspect' ? 'signal-vantage/v1' : 'signal-claim/v1' })
      return
    }
    if (v39 && (intent.type === 'v39.ring.discover' || intent.type === 'v39.ring.link'
      || intent.type === 'v39.ring.claim')) {
      queueChecked({ kind: intent.type === 'v39.ring.discover' ? 'ringkeeper-discover/v1'
        : intent.type === 'v39.ring.link' ? 'ringkeeper-link/v1' : 'ringkeeper-claim/v1' })
      return
    }
    if (v40 && (intent.type === 'v40.waystation.barter' || intent.type === 'v40.waystation.cross'
      || intent.type === 'v40.waystation.claim')) {
      queueChecked({ kind: intent.type === 'v40.waystation.barter' ? 'waystation-barter/v1'
        : intent.type === 'v40.waystation.cross' ? 'waystation-cross/v1' : 'waystation-claim/v1' })
      return
    }
    if (v41 && (intent.type === 'v41.ironhall.study' || intent.type === 'v41.ironhall.engage'
      || intent.type === 'v41.ironhall.bolt' || intent.type === 'v41.ironhall.guard'
      || intent.type === 'v41.ironhall.rest')) {
      queueChecked({ kind: intent.type === 'v41.ironhall.study' ? 'ironhall-study/v1'
        : intent.type === 'v41.ironhall.engage' ? 'ironhall-engage/v1'
          : intent.type === 'v41.ironhall.bolt' ? 'ironhall-bolt/v1'
            : intent.type === 'v41.ironhall.guard' ? 'ironhall-guard/v1' : 'ironhall-rest/v1' })
      return
    }
    if (v42 && (intent.type === 'v42.ironhall.claim'
      || intent.type === 'v42.ironhall.vest-equip'
      || intent.type === 'v42.ironhall.vest-unequip'
      || intent.type === 'v42.ironhall.vest-repair'
      || intent.type === 'v42.ironhall.spar')) {
      queueChecked({ kind: intent.type === 'v42.ironhall.claim' ? 'ironhall-claim/v1'
        : intent.type === 'v42.ironhall.vest-equip' ? 'ironhall-vest-equip/v1'
          : intent.type === 'v42.ironhall.vest-unequip' ? 'ironhall-vest-unequip/v1'
            : intent.type === 'v42.ironhall.vest-repair' ? 'ironhall-vest-repair/v1'
              : 'ironhall-spar/v1' })
      return
    }
    if (intent.type === 'v26.terrain') {
      if (v31 && intent.kind === 'dig' && publicV31HasRaisedSoilCell(
        (snapshot as PublicV31Progress).raisedSoilCells, intent.gx, intent.gz))
        queueChecked({ kind: 'soil-remove/v1', gx: intent.gx, gz: intent.gz })
      else if (physicalWorld) queueChecked({ kind: 'terrain-action/v1',
        action: { kind: intent.kind, gx: intent.gx, gz: intent.gz } })
      return
    }
    if (intent.type === 'v31.soil-place') {
      if (v31) queueChecked({ kind: 'soil-place/v1', gx: intent.gx, gz: intent.gz })
      return
    }
    if (intent.type === 'v29.mining-tool') {
      if (miningWorld) queueChecked({ kind: 'mining-tool/v1', action: { kind: intent.action, tier: intent.tier } })
      return
    }
    if (intent.type === 'v29.deep-dig') {
      if (miningWorld) queueChecked({ kind: 'deep-dig', gx: intent.gx, gz: intent.gz })
      return
    }
    if (intent.type === 'v29.sell-mineral') {
      if (miningWorld) queueChecked({ kind: 'sell-mineral/v1', material: intent.material,
        quantity: intent.quantity })
      return
    }
    if (intent.type === 'v30.bridgehead.claim') {
      if (bridgeheadWorld && view.v30Bridgehead?.bridgeId === intent.bridgeId
        && view.v30Bridgehead.claimReady) queueChecked({ kind: 'bridgehead-claim/v1',
        bridgeId: intent.bridgeId })
      else tell('The River Works claim is not ready from here. Check the saved post at the dry far exit.')
      return
    }
    if (intent.type === 'v35.ledger.survey') {
      if (v35 && view.v35LedgerSurvey?.bridgeId === intent.bridgeId
        && view.v35LedgerSurvey.rejection === null)
        queueChecked({ kind: 'ledger-survey/v1', bridgeId: intent.bridgeId })
      else tell(publicV35LedgerRejectionMessage(view.v35LedgerSurvey?.rejection ?? 'unavailable_here'))
      return
    }
    if (intent.type === 'v35.ledger.deliver') {
      if (v35 && view.v35LedgerDeliver?.rejection === null)
        queueChecked({ kind: 'ledger-deliver/v1' })
      else tell(publicV35LedgerRejectionMessage(view.v35LedgerDeliver?.rejection ?? 'unavailable_here'))
      return
    }
    if (intent.type === 'v36.marker.claim') {
      if (v36 && view.v36MarkerClaim?.rejection === null)
        queueChecked({ kind: 'marker-claim/v1' })
      else tell(publicV36MarkerRejectionMessage(view.v36MarkerClaim?.rejection ?? 'unavailable_here'))
      return
    }
    if (intent.type === 'saved-work.mode') { setWorkMode(intent.active)
      setAimX(intent.active && active.movementOwner === 'greenway' && workKind !== 'dig'
        ? publicV17SuggestedWorkAimX(view, workKind, active.player.position.x) : null)
      setAimZ(null); return }
    if (intent.type === 'saved-work.kind') { setWorkKind(intent.kind)
      setAimX(active.movementOwner === 'greenway' && intent.kind !== 'dig'
        ? publicV17SuggestedWorkAimX(view, intent.kind, active.player.position.x) : null)
      setAimZ(null); return }
    if (intent.type === 'saved-work.aim') {
      if (active.movementOwner === 'greenway') setAimX(intent.aimX)
      else if (riverBridgeWorld && workKind === 'bridge') setAimX(intent.aimX)
      else setAimZ(publicV23ReticleAimZ(active.player.position, active.player.yaw))
      return
    }
    if (intent.type === 'saved-work.aim-waystation') {
      const site = v40 && riverBridgeWorld && active.movementOwner === 'streamed'
        && view.v40WaystationQuest?.stage === 'build'
        && view.v40WaystationSite?.revealed && !view.v40WaystationSite.built
        ? waystationRiverSite(snapshot.state.seed) : null
      if (site && site.id === view.v40WaystationSite?.id) {
        setWorkMode(true); setWorkKind('bridge'); setAimX(site.approach.x); setAimZ(null)
      } else tell('The Waystation bridge is not ready to plan here.')
      return
    }
    if (intent.type === 'saved-work.aim-west') {
      if (active.movementOwner === 'streamed' && workMode && workKind === 'ladder'
        && publicV23DiscoveredWestSite(snapshot.state.seed,
          snapshot.state.discoveryMask, intent.aimZ)) setAimZ(intent.aimZ)
      return
    }
    if (intent.type === 'saved-work.confirm') {
      const kind = riverBridgeWorld ? publicV28WorkRouteForView(view, intent.id,
        active.movementOwner, snapshot.state.seed)
        : publicV23WorkRouteForView(view, intent.id,
          active.movementOwner, snapshot.state.seed)
      if (kind) queueChecked({ id: intent.id, kind })
      else tell('Aim at a ready, discovered work site first.')
      return
    }
    if (v32 && intent.type === 'highland.extract') {
      const action = publicV32ActionForProjectedChoice(view, { nodeId: intent.nodeId })
      if (action) queueChecked(action)
      else tell('This Highland outcrop is not currently ready. Check its nearby reason.')
      return
    }
    if (v32 && intent.type === 'interact'
      && view.nearbyInteraction?.targetId.startsWith('highland:')) {
      const action = publicV32ActionForProjectedChoice(view, 'generic')
      if (action) queueChecked(action)
      else tell('This Highland interaction is not ready from here. Check its nearby reason.')
      return
    }
    if (v33 && intent.type === 'interact'
      && view.nearbyInteraction?.kind === 'fairy-ring'
      && view.nearbyInteraction.targetId === 'ring-greenway') {
      const ready = view.nearbyInteraction.actionable
        && view.checkedActionChoices?.some((choice) =>
          choice.id === 'ring-greenway' && choice.actionable)
      if (ready) queueChecked({ kind: 'fairy-ring-discover/v1', ringId: 'ring-greenway' })
      else tell(view.fairyRings.find((ring) => ring.id === 'ring-greenway')?.discovered
        ? 'Choose a discovered destination in the Fairy Rings panel.'
        : view.nearbyInteraction.action)
      return
    }
    if (v33 && intent.type === 'fairy-ring.teleport') {
      const source = view.nearbyInteraction?.kind === 'fairy-ring'
        && view.nearbyInteraction.targetId === intent.ringId
        ? view.fairyRings.find((ring) => ring.id === intent.ringId && ring.discovered) : null
      const destination = source?.destinations.find((ring) =>
        ring.ringId === intent.destinationRingId && ring.discovered)
      const quarryPair = v39 && source && destination
        && (source.id === 'ring-greenway' && destination.ringId === 'ring-highland-quarry'
          || source.id === 'ring-highland-quarry' && destination.ringId === 'ring-greenway')
      if (quarryPair) {
        queueChecked({ kind: 'ringkeeper-travel/v1', direction: source.id === 'ring-greenway'
          ? 'greenway-to-highland' : 'highland-to-greenway' })
        return
      }
      if (intent.ringId === 'ring-highland-quarry'
        || intent.destinationRingId === 'ring-highland-quarry') {
        tell('Only the checked Greenway and Highland Quarry link can use this fairy path.')
        return
      }
      const action = source && destination && view.v33FairyTravel
        ? decodePublicV33FairyRingWitness({ kind: 'fairy-ring-travel/v1',
          sourceRingId: source.id, targetRingId: destination.ringId }) : null
      if (action) queueChecked(action)
      else tell('Stand beside a discovered ring and choose a discovered destination.')
      return
    }
    if (v24 && active.movementOwner === 'streamed' && intent.type === 'interact') {
      if (view.nearbyInteraction?.kind === 'store' && view.nearbyStoreId
        && view.nearbyInteraction.targetId === view.nearbyStoreId) {
        setOpenStoreId(view.nearbyStoreId)
      } else queueMireglassChoice(mireglass?.defaultInteractionId ?? null, 'generic')
      return
    }
    if (intent.type === 'store.close') { setOpenStoreId(null); return }
    if (intent.type === 'store.open' && view.nearbyStoreId === intent.storeId) {
      setOpenStoreId(intent.storeId); return }
    if (intent.type === 'interact' && view.nearbyInteraction?.kind === 'store'
      && view.nearbyStoreId) { setOpenStoreId(view.nearbyStoreId); return }
    if (intent.type === 'build-site.select') {
      setSelectedSiteId(view.buildSites.some((site) => site.id === intent.siteId
        && site.discovered) ? intent.siteId : null)
      return
    }
    if (v24 && active.movementOwner === 'streamed' && mireglass?.choices.length === 0
      && intent.type === 'equipment.equip') {
      const inherited = publicV17ActionForView(intent, view, active.movementOwner)
      if (inherited?.type === 'equip_item' && (inherited.itemId === 'field_spade'
        || inherited.itemId === 'woodcutters_axe' || inherited.itemId === 'leather_boots')) {
        queueChecked({ kind: 'mireglass-action/v1', action: {
          type: 'equip_item', itemId: inherited.itemId } })
        return
      }
    }
    if (v24 && active.movementOwner === 'streamed') {
      const action = publicV24ActionForSharedIntent(intent, mireglass?.choices ?? [],
        view.nearbyStoreId, openStoreId, view.backpack.stacks)
      if (action) queueChecked(action)
      else tell(intent.type === 'equipment.unequip'
        ? 'Unequip is unavailable in Mireglass; equip another item to switch.'
        : 'Choose a current Mireglass action or use Works for a route.')
      return
    }
    const mapped = publicV17ActionForView(intent, view, active.movementOwner)
    if (mapped) queueChecked(mapped)
    else tell('This action is unavailable in the V23 world.')
  }
  const nearWestFace = active.movementOwner === 'streamed'
    && publicV23HasWestStripSite(snapshot.state.seed)
    && Math.abs(active.player.position.x + 412) < 32
    && Math.abs(active.player.position.z - 432) < 32
  const regional = nearWestFace && workMode && workKind === 'ladder'
  const preview = view.regionalLadders?.preview
  const marker = regional ? [430.6, 433.4].map((z) =>
    publicV23DiscoveredWestSite(snapshot.state.seed, snapshot.state.discoveryMask, z))
    .find(Boolean) : null
  const slateGuideVisible = v27Guide?.summary.startsWith('Slate approach:')
    || v27Guide?.summary.startsWith('Slate ladder:')
    || v27Guide?.summary.startsWith('Upper Slate shelf:')
    || snapshot.regionalWorks.builtLadderIds.length > 0 || false
  const ladderBuilt = Boolean(v26Works?.builtLadderIds.length)
  const v32NorthLadderBuilt = ladderBuilt
    || snapshot.state.greenway.builtRouteIds.includes('greenway_ladder')
  const bridgeBuilt = Boolean(v26Works?.builtBridgeIds.length)
  const v32HighlandGuide = v32 ? publicV32HighlandObjective(view,
    active.movementOwner, active.player.position,
    snapshot.state.highland.landmarkDiscovered
      && snapshot.state.player.inventory.some((stack) => stack.itemId === 'stone'
        && stack.quantity > 0), v32NorthLadderBuilt) : null
  const queuedChecked = inputQueue.current.some((token) => token.kind === 'checked')
  const queuedPulses = inputQueue.current.filter((token) => token.kind === 'pulse').length
  const savedNotice = messages.at(-1) === `V${saveVersion} progress saved on this device.`
  const MireglassActionsPanel = v36 ? 'details' : 'aside'
  return <main data-public-v23="true" data-public-version={`v${saveVersion}`}
    data-owner={active.movementOwner}>
    <style>{PUBLIC_V23_PANEL_STYLES}</style>
    {v34 && !v35 && <p className="v34-branch-label" role="note">Experimental V34, separate save branch</p>}
    {status.gate !== 'blocked' && (saveTask.current || queuedChecked || queuedPulses > 0)
      && <p className="v23-status" role="status">{saveTask.current ? 'Checked save in progress. ' : ''}
        {actionTask.current ? 'Checked action is saving. ' : queuedChecked
          ? 'One checked action is queued and will be revalidated. ' : ''}
        {queuedPulses ? `${queuedPulses} short input step(s) queued.` : ''}</p>}
    {status.gate === 'blocked' && <p className="v23-status" role="alert">Save blocked ({status.blockedReason}).
      Movement is frozen; keep this tab open.</p>}
    {obstacleCue && <p className="v23-obstacle-cue" role="status" aria-label="Movement blocked">
      {obstacleCue}</p>}
    {(status.pendingFrames > 0 || saveTask.current || savedNotice) &&
      <div className="v23-save">
        {status.pendingFrames > 0 && <button type="button" onClick={() => void save()}
          disabled={busy.current || status.gate === 'blocked'}>Save now</button>}
        <p role="status">{status.gate === 'blocked' ? 'Save blocked. Keep this tab open.'
          : saveTask.current ? 'Saving progress…'
            : savedNotice ? status.pendingFrames > 0
              ? 'Last checkpoint saved on this device; newer progress is not yet saved.'
              : `V${saveVersion} progress saved on this device.`
              : 'Travel since the last checkpoint is not saved.'}</p>
      </div>}
    {nearWestFace && !regional && !slateGuideVisible && <aside className="v23-guide v23-guide-west" role="note">
      {marker ? `West Slate cliff lower foot: x ${marker.from.x}, z ${marker.from.z}. Gather 4 logs; use B Works, 2 Ladder, then aim.`
        : 'Explore the west Slate cliff and both ledges to reveal a four-log ladder placement.'}
    </aside>}
    {river && (!nearWestFace || slateGuideVisible) && (!v34 || view.v34Quest?.complete)
      && <details className="v23-guide v25-start-guide">
      {v32HighlandGuide ? <>
        <summary>{v32HighlandGuide.summary}</summary>
        <p>{v32HighlandGuide.action}</p>
        {v27Guide && <details><summary>Optional west route: {v27Guide.summary}</summary>
          <p>{v27Guide.action}</p><p>{v27Guide.boots} {v27Guide.spade}</p></details>}
      </> : v27Guide ? <>
        <summary>{v27Guide.summary}</summary>
        <p>{v27Guide.action}</p>
        {active.movementOwner === 'greenway' && <p>Route costs are separate: 4 logs for the north ladder,
          then 8 more for a connected-river bridge. Open Works and aim at a discovered Ready site.
          Not every river bank supports a bridge; follow the bank to check marked sites.</p>}
        <p>{v27Guide.boots} {v27Guide.spade}</p>
      </> : ladderBuilt && bridgeBuilt ? <>
        <summary>Routes ready: explore beyond the valley</summary>
        <p>Climb the built ladder from the lower cliff face and cross the river on your bridge.
          Follow these routes to explore beyond the starter valley.</p>
      </> : ladderBuilt ? <>
        <summary>North ladder ready: climb the cliff</summary>
        <p>Approach the built ladder’s rungs from the lower cliff face, then walk forward to climb.
          A river bridge costs 8 logs; open Works (tap Works or press B) to build one.</p>
      </> : bridgeBuilt ? <>
        <summary>River bridge ready: cross the creek</summary>
        <p>Approach your built bridge from the dry bank to cross the river. A north cliff ladder
          costs 4 logs; open Works (tap Works or press B) to build one.</p>
      </> : <>
        <summary>First steps: chop trees for logs</summary>
        <p>Chop trees to collect logs. A river bridge costs 8 logs; a cliff ladder costs 4.
          Open Works (tap Works or press B), choose Bridge or Ladder, aim at a supported site,
          then build. Equip boots to run, and follow visible routes as you explore.</p>
      </>}
    </details>}
    {physicalWorld && <details className="v26-safety" aria-label="Pit safety actions"
      open={Boolean(view.v26PitLadderOpportunity)}>
      <summary>Safety options</summary>
      {view.v26PitLadderOpportunity && <button type="button"
        disabled={status.gate !== 'open' || busy.current || queuedChecked}
        onClick={() => queueChecked(publicV26PitLadderWitness(view.v26PitLadderOpportunity!))}>
        Build pit ladder (4 logs)
      </button>}
      <button type="button" disabled={status.gate !== 'open'
        || busy.current || queuedChecked || publicV26KnownPitLadderHere(view)}
        onClick={() => queueChecked({ kind: 'return-home-request' })}>
        Return home if trapped
      </button>
      <p>The checked rescue works only when every exit is blocked.
        Successful rescue starts a 30-minute cooldown.</p>
    </details>}
    {regional && <section className="v23-aim" aria-label="West cliff ladder aim">
      {marker ? <><label htmlFor="v23-west-aim">West cliff ladder, {preview?.site
        ? `z ${preview.site.from.z.toFixed(1)} m` : 'aim along the discovered face'}</label>
        <input id="v23-west-aim" type="range" min="430.6" max="433.4" step="0.1"
          value={Math.max(430.6, Math.min(433.4, regionalAim ?? active.player.position.z))}
          style={{ width: '100%', minHeight: 44, touchAction: 'none' }}
          aria-label="Position ladder along west cliff" disabled={status.gate === 'blocked'}
          onChange={(event) => setAimZ(Number(event.currentTarget.value))} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" style={{ minHeight: 44 }} onClick={() => setAimZ(active.player.position.z)}>Aim at my lane</button>
          <button type="button" style={{ minHeight: 44 }} onClick={() => setAimZ(null)}>Use reticle</button>
        </div></> : <p>Explore the lower and upper ledges to reveal the ladder aim controls.</p>}
      <p role="status">{preview ? `Lower foot x ${preview.site.from.x}, z ${preview.site.from.z}; 4 logs, 60 Construction XP. ${view.savedTerrainWorks?.preview?.selected?.reason ?? preview.rejection ?? 'Ready to build'}`
        : !marker ? 'Explore both ledges to reveal a supported west-face footprint.'
          : view.savedTerrainWorks?.preview?.guidance
            ?? 'Face the west cliff or move the slider onto its supported strip.'}</p>
      {preview?.rejection === null && <button type="button" style={{ minHeight: 44 }}
        onClick={() => onIntent({ type: 'saved-work.confirm', id: preview.site.id })}>
        Build selected ladder · 4 logs
      </button>}
    </section>}
    <WizardSurface projection={view} onIntent={onIntent} inputTrace={trace} />
    {v24 && active.movementOwner === 'streamed' && mireglass?.choices.length
      ? <MireglassActionsPanel className="v24-actions" aria-label="Mireglass actions">
        {v36 ? <summary>Mireglass actions</summary> : <strong>Mireglass actions</strong>}
        {mireglass.choices.map((choice) => <button key={choice.id} type="button"
          disabled={!choice.actionable || status.gate === 'blocked'}
          onClick={() => queueMireglassChoice(choice.id, 'explicit')}>
          {choice.label}{choice.actionable ? '' : `: ${choice.disabledReason ?? 'Unavailable'}`}
        </button>)}
      </MireglassActionsPanel> : null}
    {trace && <details style={{ position: 'fixed', bottom: 8, left: 8, zIndex: 100,
      background: '#101a17', color: '#fff', maxWidth: 'min(640px, 95vw)', padding: 8 }}
      onToggle={(event) => { if (event.currentTarget.open) setTraceJson(trace.json()) }}>
      <summary>Input trace (local diagnostics)</summary>
      <button type="button" onClick={() => setTraceJson(trace.json())}>Refresh trace</button>
      <button type="button" onClick={() => {
        const json = trace.json(); setTraceJson(json)
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
        const link = document.createElement('a'); link.href = url
        link.download = `wizard-v${saveVersion}-input-trace.json`; link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }}>Download JSON</button>
      <button type="button" onClick={() => { trace.clear(); setTraceJson(trace.json()) }}>Clear trace</button>
      <pre aria-label="Input trace JSON" style={{ maxHeight: '45vh', overflow: 'auto',
        whiteSpace: 'pre-wrap', fontSize: 11 }}>{traceJson}</pre>
    </details>}
  </main>
}
