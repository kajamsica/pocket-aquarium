import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { publicWorldV16TileAtGrid } from './publicWorldV16GreenwaySites'
import { decodePublicV23Progress, exactPublicV23 } from './publicWorldV23Snapshot'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { publicV25RiverPassage } from './publicWorldV25Passage'
import type { PublicV24Progress } from './publicWorldV24Snapshot'
import type { PublicV26Progress } from './publicWorldV26Migration'
import { projectPublicV26Pose } from './publicWorldV26Pose'
import { decodePublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { publicV26ValleyRimPassage } from './publicWorldV26ValleyRim'
import type { PublicV26LadderSpan } from './publicWorldV26ValleyRim'
import { starterCliffFace } from './starterCliffProfile'
import type { Vec3 } from './types'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

const COOLDOWN_MS = 1_800_000
const STEP_METERS = 0.16
const EPSILON = 1e-6
type Result = Readonly<{ progress: PublicV26Progress; rejection?: never }>
  | Readonly<{ progress?: never; rejection: string }>
type Exit = 'reachable' | 'blocked' | 'unknown'
const cell = (value: number) => Math.ceil(value / WORLD_CELL_METERS - 0.5)

function checked(raw: PublicV26Progress): PublicV26Progress | null {
  try {
    if (!exactPublicV23(raw, ['state', 'greenwayWorks', 'regionalWorks', 'terrain', 'nextHomeAtMs'])
      || !Number.isSafeInteger(raw.nextHomeAtMs) || raw.nextHomeAtMs < 0) return null
    const old = decodePublicV23Progress({ state: raw.state,
      greenwayWorks: raw.greenwayWorks, regionalWorks: raw.regionalWorks }, raw.state.seed)
    const terrain = decodePublicV26TerrainLedger(raw.terrain)
    return old && terrain ? { ...old, terrain, nextHomeAtMs: raw.nextHomeAtMs } : null
  } catch { return null }
}

function ladderSpans(progress: PublicV24Progress): PublicV26LadderSpan[] | null {
  const { state, greenwayWorks } = progress, seed = state.seed
  const route = state.greenway.routes.find((entry) => entry.id === 'greenway_ladder')
  const built = state.greenway.builtRouteIds.includes('greenway_ladder')
  const authored = route && starterCliffFace(seed, route, state.generationProfile, built)
  if (built && !authored) return null
  const spans: PublicV26LadderSpan[] = authored
    ? [{ x: authored.from.x, widthMeters: authored.width }] : []
  for (const id of greenwayWorks.builtLadderIds) {
    const site = resolvePublicV17GreenwaySite(seed, id)
    if (!site || site.kind !== 'ladder') return null
    spans.push({ x: site.from.x, widthMeters: site.widthMeters })
  }
  return spans
}

function oldFloor(progress: PublicV24Progress, point: { x: number; z: number }): number | null {
  const { state } = progress
  if (state.movementOwner === 'greenway') {
    const support = publicV17StarterSupportAt({ seed: state.seed,
      profile: state.generationProfile,
      route: state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null,
      built: state.greenway.builtRouteIds.includes('greenway_ladder'),
      greenwayWorks: progress.greenwayWorks }, point)
    return support?.floorY ?? null
  }
  return resolvePublicV23Surface(state, point, progress.regionalWorks.builtLadderIds)?.floorY ?? null
}

/** A whole adjacent column is tested in legal-size steps, not only its first 16 cm. */
function cardinalExit(progress: PublicV24Progress, terrain: PublicV26Progress['terrain'],
  start: Vec3, dx: number, dz: number, spans: readonly PublicV26LadderSpan[]): Exit {
  const target = { x: start.x + dx * WORLD_CELL_METERS,
    z: start.z + dz * WORLD_CELL_METERS }
  if ([cell(target.x), cell(target.z)].some((grid) => grid < WORLD_GRID_MIN
    || grid > WORLD_GRID_MAX)) return 'blocked'
  let previous = start, previousPose = projectPublicV26Pose(progress, terrain, start)
  if (!previousPose) return 'unknown'
  const steps = Math.ceil(WORLD_CELL_METERS / STEP_METERS)
  for (let index = 1; index <= steps; index += 1) {
    const point = { x: start.x + dx * WORLD_CELL_METERS * index / steps,
      z: start.z + dz * WORLD_CELL_METERS * index / steps }
    const floorY = oldFloor(progress, point)
    if (floorY === null || !Number.isFinite(floorY)) return 'unknown'
    const next = { ...point, y: floorY }
    const nextPose = projectPublicV26Pose(progress, terrain, next)
    if (!nextPose) return 'unknown'
    const river = publicV25RiverPassage(progress, previous, next)
    if (!river.ok) return river.reason === 'river-needs-bridge' ? 'blocked' : 'unknown'
    const rim = publicV26ValleyRimPassage(progress.state.seed, previous, next, spans)
    if (!rim.ok) return rim.reason === 'invalid-segment' ? 'unknown' : 'blocked'
    const change = nextPose.effective.floorY - previousPose.effective.floorY
    if (Math.abs(change) > 0.55 + EPSILON) {
      const pit = previousPose.effective.floorY < previousPose.carrier.floorY - EPSILON
        || nextPose.effective.floorY < nextPose.carrier.floorY - EPSILON
      if (pit || !['bridge', 'ladder'].includes(previousPose.support)
        && !['bridge', 'ladder'].includes(nextPose.support)) return 'blocked'
    }
    previous = next
    previousPose = nextPose
  }
  return 'reachable'
}

/** `atMs` must be stamped by the checked writer and stored as the replay witness. */
export function applyPublicV26ReturnHome(rawProgress: PublicV26Progress, atMs: number): Result {
  const reject = (rejection: string): Result => ({ rejection })
  const progress = checked(rawProgress)
  if (!progress) return reject('invalid_progress')
  if (!Number.isSafeInteger(atMs) || atMs < 0 || atMs > Number.MAX_SAFE_INTEGER - COOLDOWN_MS)
    return reject('invalid_time')
  if (atMs < progress.nextHomeAtMs) return reject('cooldown')
  const old: PublicV24Progress = { state: progress.state,
    greenwayWorks: progress.greenwayWorks, regionalWorks: progress.regionalWorks }
  const pose = projectPublicV26Pose(old, progress.terrain)
  const home = pose?.homePose
  if (!pose || !home || publicV25RiverCellAtGrid(progress.state.seed, 0, 0)
    || publicWorldV16TileAtGrid(progress.state.seed, 0, 0).terrain === 'wetland'
    || progress.terrain.columns.some((column) => column.gx === 0 && column.gz === 0
      && column.openDepth > 0)) return reject('unsafe_home')
  if (progress.state.player.verticalVelocity !== 0
    || Math.abs(pose.effective.position.y - pose.effective.floorY) > EPSILON)
    return reject('invalid_pose')
  const ownColumn = progress.terrain.columns.find((column) =>
    column.gx === pose.cell.gx && column.gz === pose.cell.gz)
  if (ownColumn?.pitLadder) return reject('not_trapped')
  const spans = ladderSpans(old)
  if (!spans) return reject('invalid_progress')
  const exits = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
  const inspected = exits.map(([dx, dz]) =>
    cardinalExit(old, progress.terrain, progress.state.player.position, dx, dz, spans))
  if (inspected.includes('reachable')) return reject('not_trapped')
  if (inspected.includes('unknown')) return reject('unproven_trap')
  const state = { ...progress.state, movementOwner: 'greenway' as const,
    player: { ...progress.state.player, position: home, verticalVelocity: 0 } }
  const next = decodePublicV23Progress({ ...old, state }, state.seed)
  if (!next) return reject('invalid_destination')
  return { progress: { ...next, terrain: progress.terrain,
    nextHomeAtMs: atMs + COOLDOWN_MS } }
}
