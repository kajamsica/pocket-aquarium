import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { applyPublicV26ReturnHome } from './publicWorldV26Escape'
import { publicV26SavedLadderSpans } from './publicWorldV26Snapshot'
import { publicV26ValleyRimPassage } from './publicWorldV26ValleyRim'
import type { PublicV26LadderSpan } from './publicWorldV26ValleyRim'
import { publicV28RiverPassage } from './publicWorldV28RiverPassage'
import { replayPublicV30Witness } from './publicWorldV30Snapshot'
import type { PublicV30Progress } from './publicWorldV30Migration'
import type { PublicV31Progress } from './publicWorldV31Migration'
import { decodePublicV31ActionProgress } from './publicWorldV31Soil'
import { projectPublicV31Pose, publicV31EffectiveStepAccepted } from './publicWorldV31Support'
import type { Vec3 } from './types'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

const STEP_METERS = 0.16
const COOLDOWN_MS = 1_800_000
const cell = (value: number) => Math.ceil(value / WORLD_CELL_METERS - 0.5)
type Exit = 'reachable' | 'blocked' | 'unknown'
const inherited = ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
  riverBridgeIds, miningTools, claimedBridgeheadId }: PublicV31Progress): PublicV30Progress =>
  ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
    riverBridgeIds, miningTools, claimedBridgeheadId })

function nativeFloor(progress: PublicV31Progress, point: { x: number; z: number }): number | null {
  const { state } = progress
  if (state.movementOwner === 'greenway') {
    const support = publicV17StarterSupportAt({ seed: state.seed,
      profile: state.generationProfile,
      route: state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null,
      built: state.greenway.builtRouteIds.includes('greenway_ladder'),
      greenwayWorks: progress.greenwayWorks }, point)
    return support?.floorY ?? null
  }
  return resolvePublicV23Surface(state, point,
    progress.regionalWorks.builtLadderIds)?.floorY ?? null
}

/** A full four-metre column is scanned in legal 16 cm increments. */
function cardinalExit(progress: PublicV31Progress, start: Vec3,
  dx: number, dz: number, spans: readonly PublicV26LadderSpan[]): Exit {
  const target = { x: start.x + dx * WORLD_CELL_METERS,
    z: start.z + dz * WORLD_CELL_METERS }
  if ([cell(target.x), cell(target.z)].some((grid) => grid < WORLD_GRID_MIN
    || grid > WORLD_GRID_MAX)) return 'blocked'
  let previous = start, previousPose = projectPublicV31Pose(progress, start)
  if (!previousPose) return 'unknown'
  const steps = Math.ceil(WORLD_CELL_METERS / STEP_METERS)
  for (let index = 1; index <= steps; index += 1) {
    const point = { x: start.x + dx * WORLD_CELL_METERS * index / steps,
      z: start.z + dz * WORLD_CELL_METERS * index / steps }
    const floorY = nativeFloor(progress, point)
    if (floorY === null || !Number.isFinite(floorY)) return 'unknown'
    const next = { ...point, y: floorY }
    const nextPose = projectPublicV31Pose(progress, next)
    if (!nextPose) return 'unknown'
    const river = publicV28RiverPassage(progress, progress.terrain,
      progress.riverBridgeIds, previous, next)
    if (!river.ok) return river.reason === 'river-needs-bridge' ? 'blocked' : 'unknown'
    const rim = publicV26ValleyRimPassage(progress.state.seed, previous, next, spans)
    if (!rim.ok) return rim.reason === 'invalid-segment' ? 'unknown' : 'blocked'
    if (!publicV31EffectiveStepAccepted(previousPose, nextPose, progress.terrain)) return 'blocked'
    previous = next
    previousPose = nextPose
  }
  return 'reachable'
}

/** Keep inherited eligibility; add only the escape proof that a soil lift can change. */
export function applyPublicV31ReturnHome(raw: PublicV31Progress,
  atMs: number): PublicV31Progress | null {
  try {
    const progress = decodePublicV31ActionProgress(raw)
    if (!progress) return null
    const witness = { kind: 'return-home/v1' as const, atMs }
    const old = replayPublicV30Witness(inherited(progress), witness)
    if (old) return decodePublicV31ActionProgress({ ...old,
      raisedSoilCells: progress.raisedSoilCells })
    const v26 = applyPublicV26ReturnHome({ state: progress.state,
      greenwayWorks: progress.greenwayWorks, regionalWorks: progress.regionalWorks,
      terrain: progress.terrain, nextHomeAtMs: progress.nextHomeAtMs }, atMs)
    if (v26.rejection !== 'not_trapped') return null
    const spans = publicV26SavedLadderSpans(progress)
    const home = projectPublicV31Pose(progress)?.homePose
    if (!spans || !home) return null
    const exits = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
    const inspected = exits.map(([dx, dz]) => cardinalExit(progress,
      progress.state.player.position, dx, dz, spans))
    if (inspected.some((exit) => exit !== 'blocked')) return null
    const state = { ...progress.state, movementOwner: 'greenway' as const,
      player: { ...progress.state.player, position: home, verticalVelocity: 0 } }
    return decodePublicV31ActionProgress({ ...progress, state,
      nextHomeAtMs: atMs + COOLDOWN_MS })
  } catch { return null }
}
