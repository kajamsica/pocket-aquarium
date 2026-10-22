import { decodePublicV44GroundMountWitness } from './publicWorldV44GroundMount'
import type { PublicV44GroundMountWitness } from './publicWorldV44GroundMount'
import { projectPublicV43MountTraining } from './publicWorldV43MountTraining'
import { publicV45SafePose } from './publicWorldV45RideAction'
import type { PublicV45Progress } from './publicWorldV45RideAction'

export type PublicV45MountWitness = Extract<PublicV44GroundMountWitness,
  { kind: 'sedgehorn-mount/v1' | 'sedgehorn-dismount/v1' }>
export type PublicV45MountRejection = 'invalid_witness' | 'invalid_progress'
  | 'already_riding' | 'not_riding' | 'not_mature' | 'tack_required'
  | 'wrong_region' | 'too_far' | 'unsafe_mount' | 'not_grounded'
export type PublicV45MountResult = Readonly<{
  progress: PublicV45Progress; rejection?: never
}> | Readonly<{ progress?: never; rejection: PublicV45MountRejection }>

/** V44 proximity and dry support, with V45 tack required before mounting. */
export function confirmPublicV45MountTransition(before: PublicV45Progress,
  rawWitness: unknown): PublicV45MountResult {
  try {
    const witness = decodePublicV44GroundMountWitness(rawWitness)
    if (witness?.kind !== 'sedgehorn-mount/v1'
      && witness?.kind !== 'sedgehorn-dismount/v1')
      return { rejection: 'invalid_witness' }
    const { groundMount, state } = before
    const position = state.player.position
    if (witness.kind === 'sedgehorn-mount/v1') {
      if (groundMount.mode === 'riding') return { rejection: 'already_riding' }
      if (before.familiar.phase !== 'claimed'
        || projectPublicV43MountTraining(before)?.mature !== true)
        return { rejection: 'not_mature' }
      if (before.tack === 'not_owned') return { rejection: 'tack_required' }
      if (state.movementOwner !== 'streamed') return { rejection: 'wrong_region' }
      const animal = groundMount.parkedPosition ?? before.familiar.position
      if (Math.hypot(position.x - animal.x, position.y - animal.y,
        position.z - animal.z) > 3) return { rejection: 'too_far' }
      if (!publicV45SafePose(before, position) || !publicV45SafePose(before, animal))
        return { rejection: 'unsafe_mount' }
      return { progress: { ...before, groundMount: { ...groundMount, mode: 'riding' } } }
    }
    if (groundMount.mode !== 'riding') return { rejection: 'not_riding' }
    if (!publicV45SafePose(before, position)) return { rejection: 'not_grounded' }
    return { progress: { ...before, groundMount: { mode: 'parked',
      parkedPosition: { ...position } } } }
  } catch { return { rejection: 'invalid_progress' } }
}
