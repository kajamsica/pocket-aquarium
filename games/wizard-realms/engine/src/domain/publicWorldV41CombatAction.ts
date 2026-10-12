import { discoveryMaskHasTileId } from './discoveryMask'
import { ironHallSite } from './ironHallSite'
import { decodePublicV14FrameWitness } from './publicWorldV14Snapshot'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { publicV26TerrainCellIsWet } from './publicWorldV26TerrainSurface'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { publicV31HasRaisedSoilCell } from './publicWorldV31Soil'
import { projectPublicV31Pose } from './publicWorldV31Support'
import { decodePublicV40WaystationProgress, PUBLIC_V40_PROGRESS_KEYS } from './publicWorldV40WaystationAction'
import type { PublicV40WaystationProgress } from './publicWorldV40WaystationAction'
import { replayPublicV40Witness } from './publicWorldV40Snapshot'
import { waystationRiverSite } from './waystationRiverContent'
import type { Vec3 } from './types'

export type IronHallCombatState = Readonly<{
  learnedBolt: boolean; engaged: boolean; playerHealth: number; wardHealth: number
  phase: 'dormant' | 'windup' | 'recovery' | 'defeated'; phaseUntilTick: number
  nextBoltTick: number; nextGuardTick: number; guardUntilTick: number
  combatXp: number; wardDefeated: boolean; knockouts: number
}>
export type PublicV41CombatProgress = PublicV40WaystationProgress & Readonly<{
  ironHall: IronHallCombatState
}>
export type PublicV41CombatWitness = Readonly<{ kind: 'ironhall-study/v1'
  | 'ironhall-engage/v1' | 'ironhall-bolt/v1' | 'ironhall-guard/v1' | 'ironhall-rest/v1' }>
export type PublicV41CombatRejection = 'invalid_value' | 'invalid_progress'
  | 'requires_crossing' | 'wrong_region' | 'not_grounded' | 'unsafe_source'
  | 'unrevealed' | 'too_far' | 'already_learned' | 'not_learned'
  | 'already_engaged' | 'not_engaged' | 'cooldown' | 'ward_defeated'
  | 'cannot_rest' | 'already_full'
export type PublicV41CombatResult = Readonly<{ progress: PublicV41CombatProgress;
  rejection?: never }> | Readonly<{ progress?: never; rejection: PublicV41CombatRejection }>

export const INITIAL_IRON_HALL_COMBAT: IronHallCombatState = Object.freeze({
  learnedBolt: false, engaged: false, playerHealth: 12, wardHealth: 9,
  phase: 'dormant', phaseUntilTick: 0, nextBoltTick: 0, nextGuardTick: 0,
  guardUntilTick: 0, combatXp: 0, wardDefeated: false, knockouts: 0,
})
export const PUBLIC_V41_PROGRESS_KEYS = [...PUBLIC_V40_PROGRESS_KEYS, 'ironHall'] as const
const combatKeys = Object.keys(INITIAL_IRON_HALL_COMBAT)
const reach = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const horizontal = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z)
const safeCounter = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Strict progress decoder. Action ingress projects the exact keys from a V41 head. */
export function decodePublicV41CombatProgress(raw: unknown): PublicV41CombatProgress | null {
  try {
    if (!exactPublicV23(raw, PUBLIC_V41_PROGRESS_KEYS)
      || !exactPublicV23(raw.ironHall, combatKeys)) return null
    const h = raw.ironHall
    if (typeof h.learnedBolt !== 'boolean' || typeof h.engaged !== 'boolean'
      || typeof h.wardDefeated !== 'boolean'
      || !['dormant', 'windup', 'recovery', 'defeated'].includes(h.phase as string)
      || ![h.playerHealth, h.wardHealth, h.phaseUntilTick, h.nextBoltTick,
        h.nextGuardTick, h.guardUntilTick, h.combatXp, h.knockouts].every(safeCounter)
      || (h.playerHealth as number) < 1 || (h.playerHealth as number) > 12
      || (h.wardHealth as number) > 9
      || h.wardDefeated !== (h.phase === 'defeated')
      || (h.wardDefeated ? h.engaged || h.wardHealth !== 0
        : h.wardHealth === 0)
      || h.engaged !== (h.phase === 'windup' || h.phase === 'recovery')
      || h.engaged && !h.learnedBolt
      || !h.engaged && !h.wardDefeated && h.wardHealth !== 9
      || h.phase === 'dormant' && h.phaseUntilTick !== 0) return null
    const inherited = decodePublicV40WaystationProgress(Object.fromEntries(
      PUBLIC_V40_PROGRESS_KEYS.map((key) => [key, raw[key]])))
    return inherited ? { ...inherited, ironHall: structuredClone(h) as IronHallCombatState } : null
  } catch { return null }
}

/** Exact, payload-free intent. Damage, coordinates and rewards never come from the client. */
export function decodePublicV41CombatWitness(raw: unknown): PublicV41CombatWitness | null {
  try {
    if (!exactPublicV23(raw, ['kind']) || ![
      'ironhall-study/v1', 'ironhall-engage/v1', 'ironhall-bolt/v1',
      'ironhall-guard/v1', 'ironhall-rest/v1',
    ].includes(raw.kind as string)) return null
    structuredClone(raw)
    return { kind: raw.kind as PublicV41CombatWitness['kind'] }
  } catch { return null }
}

function progressOf(raw: PublicV41CombatProgress): PublicV41CombatProgress | null {
  try { return decodePublicV41CombatProgress(Object.fromEntries(
    PUBLIC_V41_PROGRESS_KEYS.map((key) => [key, raw[key]]))) }
  catch { return null }
}

/** Pure checked action; the V41 CAS writer replays this against its locked head. */
export function confirmPublicV41CombatAction(raw: PublicV41CombatProgress,
  rawWitness: unknown): PublicV41CombatResult {
  const reject = (rejection: PublicV41CombatRejection): PublicV41CombatResult => ({ rejection })
  const witness = decodePublicV41CombatWitness(rawWitness)
  if (!witness) return reject('invalid_value')
  const progress = progressOf(raw)
  if (!progress) return reject('invalid_progress')
  try {
    const { state, ironHall: h } = progress, { player } = state
    const bridge = waystationRiverSite(state.seed), site = ironHallSite(progress)
    if (!bridge || !site) return reject('invalid_progress')
    if (!progress.southbankReached || !progress.riverBridgeIds.includes(bridge.id))
      return reject('requires_crossing')
    if (state.movementOwner !== 'streamed') return reject('wrong_region')
    const pose = projectPublicV31Pose(progress)
    if (!pose || player.verticalVelocity !== 0 || pose.support !== 'terrain'
      || Math.abs(pose.effective.position.y - pose.effective.floorY) > 1e-6)
      return reject('not_grounded')
    if (publicV25RiverCellAtGrid(state.seed, pose.cell.gx, pose.cell.gz)
      || publicV26TerrainCellIsWet(state.seed, pose.cell.gx, pose.cell.gz, 'streamed')
      || progress.terrain.columns.some(({ gx, gz, openDepth }) =>
        gx === pose.cell.gx && gz === pose.cell.gz && openDepth > 0)
      || publicV31HasRaisedSoilCell(progress.raisedSoilCells, pose.cell.gx, pose.cell.gz))
      return reject('unsafe_source')
    const kind = witness.kind, destination = kind === 'ironhall-study/v1'
      || kind === 'ironhall-rest/v1' ? site.alcove : site.ward
    if (!discoveryMaskHasTileId(state.discoveryMask, destination.id)) return reject('unrevealed')
    if (reach(pose.effective.position, destination.center) >
      (destination === site.ward ? 7 : 3)) return reject('too_far')
    if (!safeCounter(state.eventSequence + 1)) return reject('invalid_value')
    let nextHall: IronHallCombatState = h, xp = player.xp, spellcraft = player.skillXp.spellcraft
    if (kind === 'ironhall-study/v1') {
      if (h.learnedBolt) return reject('already_learned')
      xp += 10; spellcraft += 10
      nextHall = { ...h, learnedBolt: true }
    } else if (kind === 'ironhall-engage/v1') {
      if (h.wardDefeated) return reject('ward_defeated')
      if (!h.learnedBolt) return reject('not_learned')
      if (h.engaged) return reject('already_engaged')
      if (!safeCounter(state.tick + 20)) return reject('invalid_value')
      nextHall = { ...h, engaged: true, phase: 'windup', phaseUntilTick: state.tick + 20 }
    } else if (kind === 'ironhall-bolt/v1') {
      if (!h.learnedBolt) return reject('not_learned')
      if (!h.engaged) return reject('not_engaged')
      if (state.tick < h.nextBoltTick) return reject('cooldown')
      if (!safeCounter(state.tick + 12) || !safeCounter(h.combatXp + 2))
        return reject('invalid_value')
      xp += 2
      const wardHealth = Math.max(0, h.wardHealth - 3), wardDefeated = wardHealth === 0
      nextHall = { ...h, wardHealth, combatXp: h.combatXp + 2,
        nextBoltTick: state.tick + 12, wardDefeated,
        engaged: !wardDefeated, phase: wardDefeated ? 'defeated' : h.phase,
        phaseUntilTick: wardDefeated ? 0 : h.phaseUntilTick }
    } else if (kind === 'ironhall-guard/v1') {
      if (!h.engaged) return reject('not_engaged')
      if (state.tick < h.nextGuardTick) return reject('cooldown')
      if (!safeCounter(state.tick + 20) || !safeCounter(state.tick + 30))
        return reject('invalid_value')
      nextHall = { ...h, guardUntilTick: state.tick + 20,
        nextGuardTick: state.tick + 30 }
    } else {
      if (h.engaged) return reject('cannot_rest')
      if (h.playerHealth === 12) return reject('already_full')
      nextHall = { ...h, playerHealth: 12 }
    }
    if (![xp, spellcraft].every(safeCounter)) return reject('invalid_value')
    const next: PublicV41CombatProgress = { ...progress, ironHall: nextHall,
      state: { ...state, eventSequence: state.eventSequence + 1,
        player: { ...player, xp, level: 1 + Math.floor(xp / 100),
          skillXp: { ...player.skillXp, spellcraft } } } }
    return decodePublicV41CombatProgress(next) ? { progress: next } : reject('invalid_value')
  } catch { return reject('invalid_progress') }
}

export function previewPublicV41CombatAction(progress: PublicV41CombatProgress,
  witness: unknown): Readonly<{ rejection: PublicV41CombatRejection | null }> {
  return { rejection: confirmPublicV41CombatAction(progress, witness).rejection ?? null }
}

/** Reuse the V40 movement authority one frame at a time before resolving each strike. */
export function replayPublicV41CombatFrameBatch(before: PublicV41CombatProgress,
  rawWitness: unknown): PublicV41CombatProgress | null {
  const witness = decodePublicV14FrameWitness(rawWitness)
  let current = progressOf(before)
  if (!witness || !current) return null
  for (const frame of witness.frames) {
    const moved = replayPublicV40Witness(current,
      { kind: 'frame-batch/v1', frames: [frame] })
    if (!moved) return null
    current = { ...moved, ironHall: current.ironHall }
    const h: IronHallCombatState = current.ironHall
    if (!h.engaged || h.wardDefeated) continue
    const site = ironHallSite(current)
    if (!site) return null
    const distance = horizontal(current.state.player.position, site.ward.center)
    if (distance > 12) {
      current = { ...current, ironHall: { ...h, engaged: false,
        wardHealth: 9, phase: 'dormant', phaseUntilTick: 0 } }
      continue
    }
    if (h.phase === 'recovery' && current.state.tick >= h.phaseUntilTick) {
      if (!safeCounter(current.state.tick + 20)) return null
      current = { ...current, ironHall: { ...h, phase: 'windup',
        phaseUntilTick: current.state.tick + 20 } }
    } else if (h.phase === 'windup' && current.state.tick >= h.phaseUntilTick) {
      const damage: number = distance <= 2.7
        ? current.state.tick <= h.guardUntilTick ? 1 : 4 : 0
      if (h.playerHealth <= damage) {
        if (!safeCounter(h.knockouts + 1)) return null
        current = { ...current, ironHall: { ...h, engaged: false,
          playerHealth: 6, wardHealth: 9, phase: 'dormant', phaseUntilTick: 0,
          knockouts: h.knockouts + 1 },
        state: { ...current.state, player: { ...current.state.player,
          position: { ...site.alcove.center }, verticalVelocity: 0 } } }
      } else {
        if (!safeCounter(current.state.tick + 15)) return null
        current = { ...current, ironHall: { ...h, playerHealth: h.playerHealth - damage,
          phase: 'recovery', phaseUntilTick: current.state.tick + 15 } }
      }
    }
  }
  return decodePublicV41CombatProgress(current)
}
