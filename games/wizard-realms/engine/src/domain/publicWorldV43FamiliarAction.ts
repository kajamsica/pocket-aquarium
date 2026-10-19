import { discoveryMaskHasTileId } from './discoveryMask'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { publicV26TerrainCellIsWet } from './publicWorldV26TerrainSurface'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { publicV31HasRaisedSoilCell } from './publicWorldV31Soil'
import { projectPublicV31Pose } from './publicWorldV31Support'
import { decodePublicV42RewardProgress, PUBLIC_V42_PROGRESS_KEYS } from './publicWorldV42RewardAction'
import type { PublicV42RewardProgress } from './publicWorldV42RewardAction'
import { resolveSedgehornFamiliarSite } from './sedgehornFamiliarContent'
import type { Vec3 } from './types'

export type FamiliarPhase = 'search' | 'tracks' | 'fed' | 'route-ready'
  | 'escort' | 'returned' | 'claimed'
export type FamiliarRouteChoice = 'shelter' | 'dry-approach' | null
export type FamiliarWaitReason = 'none' | 'separated' | 'unsafe_support'
export type PublicV43FamiliarState = Readonly<{
  id: string
  phase: FamiliarPhase
  routeChoice: FamiliarRouteChoice
  position: Vec3
  trust: number
  creatureCareXp: number
  calmed: boolean
  waitReason: FamiliarWaitReason
  stationKnown: boolean
}>
export type PublicV43FamiliarProgress = PublicV42RewardProgress & Readonly<{
  familiar: PublicV43FamiliarState
}>
export type PublicV43FamiliarWitness = Readonly<{ kind:
  'familiar-tracks/v1' | 'familiar-herb/v1' | 'familiar-shelter/v1'
  | 'familiar-dry-approach/v1' | 'familiar-escort/v1' | 'familiar-calm/v1'
  | 'familiar-return/v1' | 'familiar-claim/v1' }>
export type PublicV43FamiliarRejection = 'invalid_value' | 'invalid_progress'
  | 'requires_crossing' | 'wrong_region' | 'not_grounded' | 'unsafe_source'
  | 'unrevealed' | 'too_far' | 'wrong_stage' | 'not_owned'
  | 'companion_not_here' | 'already_claimed'
export type PublicV43FamiliarResult = Readonly<{ progress: PublicV43FamiliarProgress;
  rejection?: never }> | Readonly<{ progress?: never;
    rejection: PublicV43FamiliarRejection }>

export const PUBLIC_V43_PROGRESS_KEYS = [...PUBLIC_V42_PROGRESS_KEYS, 'familiar'] as const
const FAMILIAR_KEYS = ['id', 'phase', 'routeChoice', 'position', 'trust',
  'creatureCareXp', 'calmed', 'waitReason', 'stationKnown'] as const
const PHASES: readonly FamiliarPhase[] = ['search', 'tracks', 'fed', 'route-ready',
  'escort', 'returned', 'claimed']
const KINDS: readonly PublicV43FamiliarWitness['kind'][] = [
  'familiar-tracks/v1', 'familiar-herb/v1', 'familiar-shelter/v1',
  'familiar-dry-approach/v1', 'familiar-escort/v1', 'familiar-calm/v1',
  'familiar-return/v1', 'familiar-claim/v1',
]
const safeCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const finitePosition = (value: unknown): value is Vec3 =>
  exactPublicV23(value, ['x', 'y', 'z'])
  && [value.x, value.y, value.z].every((coordinate) =>
    typeof coordinate === 'number' && Number.isFinite(coordinate))

/** A distinct overlay; no V42 player skill keys or source record are changed. */
export function createPublicV43FamiliarProgress(source: PublicV42RewardProgress):
  PublicV43FamiliarProgress | null {
  const parent = decodePublicV42RewardProgress(Object.fromEntries(
    PUBLIC_V42_PROGRESS_KEYS.map((key) => [key, source[key]])))
  const site = parent && resolveSedgehornFamiliarSite(parent)
  return parent && site ? { ...parent, familiar: {
    id: site.id, phase: 'search', routeChoice: null,
    position: { ...site.habitat.center }, trust: 0, creatureCareXp: 0,
    calmed: false, waitReason: 'none', stationKnown: false,
  } } : null
}

/** Structural and cross-field proof. The future V43 lineage must additionally replay history. */
export function decodePublicV43FamiliarProgress(raw: unknown):
  PublicV43FamiliarProgress | null {
  try {
    if (!exactPublicV23(raw, PUBLIC_V43_PROGRESS_KEYS)
      || !exactPublicV23(raw.familiar, FAMILIAR_KEYS)) return null
    const familiar = raw.familiar
    const position = familiar.position
    const parent = decodePublicV42RewardProgress(Object.fromEntries(
      PUBLIC_V42_PROGRESS_KEYS.map((key) => [key, raw[key]])))
    const site = parent && resolveSedgehornFamiliarSite(parent)
    if (!parent || !site || familiar.id !== site.id
      || !PHASES.includes(familiar.phase as FamiliarPhase)
      || familiar.routeChoice !== null && familiar.routeChoice !== 'shelter'
        && familiar.routeChoice !== 'dry-approach'
      || !finitePosition(position)
      || !safeCount(familiar.trust) || familiar.trust > 3
      || !safeCount(familiar.creatureCareXp) || familiar.creatureCareXp > 40
      || typeof familiar.calmed !== 'boolean'
      || !['none', 'separated', 'unsafe_support'].includes(familiar.waitReason as string)
      || typeof familiar.stationKnown !== 'boolean') return null
    const rank = PHASES.indexOf(familiar.phase as FamiliarPhase)
    const expectedCareXp = rank <= 1 ? 0 : rank === 2 ? 10
      : rank >= 6 ? 40 : 20
    const followerPose = rank >= 4 ? projectPublicV31Pose(parent, position) : null
    if (familiar.creatureCareXp !== expectedCareXp
      || familiar.trust !== (rank <= 1 ? 0 : rank === 2 ? 1
        : familiar.calmed ? 3 : 2)
      || (familiar.routeChoice !== null) !== (rank >= 3)
      || familiar.calmed && rank < 4
      || rank !== 4 && familiar.waitReason !== 'none'
      || familiar.stationKnown !== (rank >= 6)
      || rank < 4 && distance(position, site.habitat.center) > 1e-6
      || rank >= 4 && (!followerPose || Math.abs(position.y
        - followerPose.effective.floorY) > 1e-6)
      || rank >= 5 && distance(position, site.keeper.center) > 3) return null
    return { ...parent, familiar: structuredClone(familiar) as PublicV43FamiliarState }
  } catch { return null }
}

/** The client supplies only intent, never coordinates, trust, resources or rewards. */
export function decodePublicV43FamiliarWitness(raw: unknown):
  PublicV43FamiliarWitness | null {
  try {
    if (!exactPublicV23(raw, ['kind'])
      || !KINDS.includes(raw.kind as PublicV43FamiliarWitness['kind'])) return null
    structuredClone(raw)
    return { kind: raw.kind as PublicV43FamiliarWitness['kind'] }
  } catch { return null }
}

/** A pure request transition. Only a future locked V43 writer may make it durable. */
export function confirmPublicV43FamiliarAction(raw: PublicV43FamiliarProgress,
  rawWitness: unknown): PublicV43FamiliarResult {
  const reject = (rejection: PublicV43FamiliarRejection): PublicV43FamiliarResult =>
    ({ rejection })
  const witness = decodePublicV43FamiliarWitness(rawWitness)
  if (!witness) return reject('invalid_value')
  const progress = decodePublicV43FamiliarProgress(raw)
  if (!progress) return reject('invalid_progress')
  const { state, familiar } = progress
  const site = resolveSedgehornFamiliarSite(progress)
  if (!site || !safeCount(state.eventSequence + 1)) return reject('invalid_progress')
  if (!progress.southbankReached) return reject('requires_crossing')
  if (state.movementOwner !== 'streamed') return reject('wrong_region')
  const pose = projectPublicV31Pose(progress)
  if (!pose || state.player.verticalVelocity !== 0 || pose.support !== 'terrain'
    || Math.abs(pose.effective.position.y - pose.effective.floorY) > 1e-6)
    return reject('not_grounded')
  if (publicV25RiverCellAtGrid(state.seed, pose.cell.gx, pose.cell.gz)
    || publicV26TerrainCellIsWet(state.seed, pose.cell.gx, pose.cell.gz, 'streamed')
    || progress.terrain.columns.some(({ gx, gz, openDepth }) =>
      gx === pose.cell.gx && gz === pose.cell.gz && openDepth > 0)
    || publicV31HasRaisedSoilCell(progress.raisedSoilCells, pose.cell.gx, pose.cell.gz))
    return reject('unsafe_source')
  const { kind } = witness
  const destination = kind === 'familiar-tracks/v1' ? site.tracks
    : kind === 'familiar-herb/v1' ? site.shelter
      : kind === 'familiar-dry-approach/v1' ? site.dryApproach
        : kind === 'familiar-return/v1' || kind === 'familiar-claim/v1'
          ? site.keeper : site.careStation
  if (!discoveryMaskHasTileId(state.discoveryMask, destination.id)) return reject('unrevealed')
  if (distance(pose.effective.position, destination.center) > 3) return reject('too_far')
  if (kind === 'familiar-claim/v1' && familiar.phase === 'claimed')
    return reject('already_claimed')
  const expectedPhase: Record<PublicV43FamiliarWitness['kind'], FamiliarPhase> = {
    'familiar-tracks/v1': 'search', 'familiar-herb/v1': 'tracks',
    'familiar-shelter/v1': 'fed', 'familiar-dry-approach/v1': 'fed',
    'familiar-escort/v1': 'route-ready', 'familiar-calm/v1': 'escort',
    'familiar-return/v1': 'escort', 'familiar-claim/v1': 'returned',
  }
  if (familiar.phase !== expectedPhase[kind] || kind === 'familiar-calm/v1'
    && familiar.calmed) return reject('wrong_stage')
  let nextFamiliar: PublicV43FamiliarState = familiar
  let player = state.player
  if (kind === 'familiar-tracks/v1') nextFamiliar = { ...familiar, phase: 'tracks' }
  if (kind === 'familiar-herb/v1' || kind === 'familiar-shelter/v1') {
    const itemId = kind === 'familiar-herb/v1' ? 'marsh_herb' : 'logs'
    const cost = kind === 'familiar-herb/v1' ? 1 : 2
    if (player.inventory.filter((stack) => stack.itemId === itemId)
      .reduce((sum, stack) => sum + stack.quantity, 0) < cost) return reject('not_owned')
    let remaining = cost
    const inventory = player.inventory.flatMap((stack) => {
      if (stack.itemId !== itemId || !remaining) return [stack]
      const spent = Math.min(remaining, stack.quantity)
      remaining -= spent
      return spent === stack.quantity ? [] : [{ ...stack, quantity: stack.quantity - spent }]
    })
    player = { ...player, inventory }
    nextFamiliar = kind === 'familiar-herb/v1'
      ? { ...familiar, phase: 'fed', trust: 1, creatureCareXp: 10 }
      : { ...familiar, phase: 'route-ready', routeChoice: 'shelter',
        trust: 2, creatureCareXp: 20 }
  }
  if (kind === 'familiar-dry-approach/v1') nextFamiliar = {
    ...familiar, phase: 'route-ready', routeChoice: 'dry-approach',
    trust: 2, creatureCareXp: 20,
  }
  if (kind === 'familiar-escort/v1') nextFamiliar = { ...familiar, phase: 'escort' }
  if (kind === 'familiar-calm/v1') nextFamiliar = { ...familiar, trust: 3, calmed: true }
  if (kind === 'familiar-return/v1') {
    if (familiar.waitReason !== 'none'
      || distance(familiar.position, site.keeper.center) > 3)
      return reject('companion_not_here')
    nextFamiliar = { ...familiar, phase: 'returned', waitReason: 'none' }
  }
  if (kind === 'familiar-claim/v1') {
    const coins = player.coins + 25, xp = player.xp + 40
    if (!safeCount(coins) || !safeCount(xp)) return reject('invalid_value')
    player = { ...player, coins, xp, level: 1 + Math.floor(xp / 100) }
    nextFamiliar = { ...familiar, phase: 'claimed', stationKnown: true,
      creatureCareXp: 40 }
  }
  const next: PublicV43FamiliarProgress = { ...progress, familiar: nextFamiliar,
    state: { ...state, eventSequence: state.eventSequence + 1, player } }
  return decodePublicV43FamiliarProgress(next) ? { progress: next }
    : reject('invalid_value')
}
