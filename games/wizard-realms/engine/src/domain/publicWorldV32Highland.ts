import { backpackSlotsUsed } from './backpackSlots'
import { discoveryMaskHasTileId } from './discoveryMask'
import { HIGHLAND_LANDMARK, highlandLandmark, highlandStoneNodes } from './highlandContent'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { decodePublicV31ActionProgress } from './publicWorldV31Soil'
import { projectPublicV31Pose } from './publicWorldV31Support'
import type { PublicV32Progress } from './publicWorldV32Migration'

export type PublicV32HighlandWitness = Readonly<{
  kind: 'highland-discover/v1'; landmarkId: typeof HIGHLAND_LANDMARK.id
}> | Readonly<{ kind: 'highland-extract/v1'; nodeId: string }>
export type PublicV32HighlandResult = Readonly<{ progress: PublicV32Progress; rejection?: never }>
  | Readonly<{ progress?: never; rejection: string }>

export function decodePublicV32HighlandWitness(value: unknown): PublicV32HighlandWitness | null {
  try {
    if (exactPublicV23(value, ['kind', 'landmarkId'])
      && value.kind === 'highland-discover/v1'
      && value.landmarkId === HIGHLAND_LANDMARK.id)
      return { kind: 'highland-discover/v1', landmarkId: HIGHLAND_LANDMARK.id }
    if (exactPublicV23(value, ['kind', 'nodeId'])
      && value.kind === 'highland-extract/v1'
      && typeof value.nodeId === 'string' && value.nodeId.length > 0
      && value.nodeId.length <= 128)
      return { kind: 'highland-extract/v1', nodeId: value.nodeId }
  } catch { /* Fail closed on proxy or accessor input. */ }
  return null
}

/** The only V32 Highland writer. Every changed field is reconstructed by the witness. */
export function confirmPublicV32HighlandAction(rawProgress: PublicV32Progress,
  rawWitness: unknown): PublicV32HighlandResult {
  const reject = (rejection: string): PublicV32HighlandResult => ({ rejection })
  const witness = decodePublicV32HighlandWitness(rawWitness)
  if (!witness) return reject('invalid_action')
  const progress = decodePublicV31ActionProgress(rawProgress)
  if (!progress) return reject('invalid_progress')
  try {
    const { state } = progress
    const pose = projectPublicV31Pose(progress)
    if (!pose || state.player.verticalVelocity !== 0
      || Math.abs(pose.effective.position.y - pose.effective.floorY) > 1e-6)
      return reject('not_grounded')
    if (!Number.isSafeInteger(state.eventSequence + 1)) return reject('overflow')
    if (witness.kind === 'highland-discover/v1') {
      const crown = highlandLandmark(state.seed)
      if (state.highland.landmarkDiscovered) return reject('already_studied')
      if (!discoveryMaskHasTileId(state.discoveryMask, crown.tile.id)) return reject('unrevealed')
      if (Math.hypot(pose.effective.position.x - crown.tile.center.x,
        pose.effective.position.z - crown.tile.center.z) > 8) return reject('too_far')
      const next: PublicV32Progress = { ...progress, state: { ...state,
        eventSequence: state.eventSequence + 1,
        highland: { ...state.highland, landmarkDiscovered: true } } }
      return decodePublicV31ActionProgress(next) ? { progress: next } : reject('invalid_value')
    }
    const node = highlandStoneNodes(state.seed).find(({ id }) => id === witness.nodeId)
    if (!node) return reject('not_found')
    if (!state.highland.landmarkDiscovered) return reject('study_crown_first')
    if (!discoveryMaskHasTileId(state.discoveryMask, node.tile.id)) return reject('unrevealed')
    if (Math.hypot(pose.effective.position.x - node.tile.center.x,
      pose.effective.position.y - node.tile.center.y,
      pose.effective.position.z - node.tile.center.z) > 3) return reject('too_far')
    if (state.player.equipment.mainHand !== 'field_spade'
      || !state.player.inventory.some((stack) => stack.itemId === 'field_spade'
        && stack.quantity > 0)) return reject('requires_spade')
    if (1 + Math.floor(state.player.skillXp.excavation / 30) < 2)
      return reject('skill_locked')
    const bagCount = Object.values(progress.terrain.bag).reduce((sum, count) => sum + count, 0)
    if (backpackSlotsUsed(state.player.inventory, state.player.tradeSlots,
      bagCount) + 2 > state.player.backpackCapacity) return reject('capacity')
    const entry = state.highland.stoneNodes.find(({ id }) => id === node.id)
    if (!entry) return reject('invalid_progress')
    if (state.tick < entry.readyAtTick) return reject('recovering')
    const stoneIndex = state.player.inventory.findIndex((stack) => stack.itemId === 'stone')
    const stone = stoneIndex < 0 ? null : state.player.inventory[stoneIndex]
    const readyAtTick = state.tick + 3000, xp = state.player.xp + 20
    const excavationXp = state.player.skillXp.excavation + 20
    if (![readyAtTick, xp, excavationXp, (stone?.quantity ?? 0) + 2]
      .every(Number.isSafeInteger)) return reject('overflow')
    const inventory = stone
      ? state.player.inventory.map((stack, index) => index === stoneIndex
        ? { ...stack, quantity: stack.quantity + 2 } : stack)
      : [...state.player.inventory, { itemId: 'stone' as const, quantity: 2 }]
    const next: PublicV32Progress = { ...progress, state: { ...state,
      eventSequence: state.eventSequence + 1,
      player: { ...state.player, inventory, xp, level: 1 + Math.floor(xp / 100),
        skillXp: { ...state.player.skillXp, excavation: excavationXp } },
      highland: { ...state.highland, stoneNodes: state.highland.stoneNodes.map((row) =>
        row.id === node.id ? { ...row, readyAtTick } : row) } } }
    return decodePublicV31ActionProgress(next) ? { progress: next } : reject('invalid_value')
  } catch { return reject('invalid_progress') }
}
