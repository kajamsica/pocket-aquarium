import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { createFreshPublicV43Root, decodePublicV43Progress }
  from './publicWorldV43Snapshot'
import { confirmPublicV45MountTransition } from './publicWorldV45MountTransition'
import type { PublicV45Progress } from './publicWorldV45RideAction'
import { resolveSedgehornFamiliarSite } from './sedgehornFamiliarContent'

const mount = { kind: 'sedgehorn-mount/v1' } as const
const dismount = { kind: 'sedgehorn-dismount/v1' } as const

function parked(): PublicV45Progress {
  const head = createFreshPublicV43Root('wizard-realms').head
  const site = resolveSedgehornFamiliarSite(head)!
  const player = head.state.player
  const state = { ...head.state, tick: 1300, eventSequence: 10,
    movementOwner: 'streamed' as const,
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(head.state.discoveryMask), site.keeper.id])].sort()),
    player: { ...player, position: { ...site.keeper.center }, verticalVelocity: 0,
      coins: player.coins + 25, xp: player.xp + 40,
      level: 1 + Math.floor((player.xp + 40) / 100) } }
  const familiar = { ...head.familiar, phase: 'claimed' as const,
    routeChoice: 'shelter' as const, position: { ...site.keeper.center },
    trust: 2, creatureCareXp: 40, stationKnown: true }
  const mountTraining = { careWitnesses: [0, 600, 1200].map((tick, index) => ({
    kind: 'sedgehorn-care/v1' as const, tick, eventSequence: index + 1 })) }
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...flat } = head
  const progress = decodePublicV43Progress({ ...flat, state, familiar, mountTraining })
  if (!progress) throw new Error('Invalid claimed mount fixture')
  return { ...progress, groundMount: { mode: 'parked', parkedPosition: null },
    tack: 'legacy' }
}

describe('V45 checked ground mount transition', () => {
  it('mounts a nearby mature legacy Sedgehorn and dismounts at the current pose', () => {
    const before = parked(), saved = structuredClone(before)
    const mounted = confirmPublicV45MountTransition(before, mount)
    expect(mounted.rejection).toBeUndefined()
    expect(mounted.progress!.groundMount).toEqual({ mode: 'riding', parkedPosition: null })
    const after = confirmPublicV45MountTransition(mounted.progress!, dismount)
    expect(after.rejection).toBeUndefined()
    expect(after.progress!.groundMount).toEqual({ mode: 'parked',
      parkedPosition: before.state.player.position })
    const { groundMount: _mount, ...unchanged } = after.progress!
    expect(unchanged).toEqual((({ groundMount: _beforeMount, ...rest }) => rest)(before))
    expect(before).toEqual(saved)
  })

  it('rejects free, immature, distant, unrevealed, and wrong-region mounts', () => {
    const before = parked()
    expect(confirmPublicV45MountTransition({ ...before, tack: 'not_owned' }, mount).rejection)
      .toBe('tack_required')
    expect(confirmPublicV45MountTransition({ ...before, mountTraining: {
      careWitnesses: before.mountTraining!.careWitnesses.slice(0, 2) } }, mount).rejection)
      .toBe('not_mature')
    expect(confirmPublicV45MountTransition({ ...before, groundMount: {
      mode: 'parked', parkedPosition: { ...before.state.player.position,
        x: before.state.player.position.x + 4 } } }, mount).rejection).toBe('too_far')
    expect(confirmPublicV45MountTransition({ ...before, state: { ...before.state,
      discoveryMask: encodeDiscoveredTileIds([]) } }, mount).progress)
      .toBeUndefined()
    expect(confirmPublicV45MountTransition({ ...before, state: { ...before.state,
      movementOwner: 'greenway' } }, mount).progress).toBeUndefined()
  })

  it('rejects unsafe animal support, wrong mode, and extra witness fields', () => {
    const before = parked()
    expect(confirmPublicV45MountTransition(before, dismount).rejection).toBe('not_riding')
    expect(confirmPublicV45MountTransition(before, { ...mount, price: 0 }).rejection)
      .toBe('invalid_witness')
    const misplaced = { ...before, groundMount: { mode: 'parked' as const,
      parkedPosition: { ...before.state.player.position,
        y: before.state.player.position.y + 0.1 } } }
    expect(confirmPublicV45MountTransition(misplaced, mount).rejection)
      .toBe('unsafe_mount')
    const mounted = confirmPublicV45MountTransition(before, mount).progress!
    expect(confirmPublicV45MountTransition(mounted, mount).rejection)
      .toBe('already_riding')
    expect(confirmPublicV45MountTransition({ ...mounted, state: { ...mounted.state,
      player: { ...mounted.state.player, verticalVelocity: 0.1 } } }, dismount).rejection)
      .toBe('not_grounded')
  })
})
