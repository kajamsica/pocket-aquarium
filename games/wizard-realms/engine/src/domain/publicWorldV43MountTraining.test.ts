import { describe, expect, it } from 'vitest'
// Initialize V41 ancestry before the cross-version V43 module graph.
import './atomicV41Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { createFreshPublicV42Root } from './publicWorldV42Snapshot'
import { confirmPublicV43FamiliarAction, createPublicV43FamiliarProgress } from './publicWorldV43FamiliarAction'
import type { PublicV43FamiliarProgress, PublicV43FamiliarWitness } from './publicWorldV43FamiliarAction'
import { confirmPublicV43MountTraining, createPublicV43MountTraining,
  decodePublicV43MountTrainingProgress, decodePublicV43MountTrainingWitness,
  projectPublicV43MountTraining } from './publicWorldV43MountTraining'
import type { PublicV43MountTrainingProgress } from './publicWorldV43MountTraining'
import { resolveSedgehornFamiliarSite } from './sedgehornFamiliarContent'
import { waystationRiverSite } from './waystationRiverContent'
import type { WorldTile } from './types'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const care = { kind: 'sedgehorn-care/v1' } as const
const herbs = (progress: PublicV43FamiliarProgress) => progress.state.player.inventory
  .filter(({ itemId }) => itemId === 'marsh_herb').reduce((sum, { quantity }) => sum + quantity, 0)
const at = <T extends PublicV43FamiliarProgress>(progress: T, tile: WorldTile): T =>
  ({ ...progress, state: { ...progress.state, player: { ...progress.state.player,
    position: { ...tile.center }, verticalVelocity: 0 } } })
const later = <T extends PublicV43FamiliarProgress>(progress: T, ticks: number): T =>
  ({ ...progress, state: { ...progress.state, tick: progress.state.tick + ticks } })
const act = (progress: PublicV43FamiliarProgress, kind: PublicV43FamiliarWitness['kind']) => {
  const result = confirmPublicV43FamiliarAction(progress, { kind })
  expect(result.rejection).toBeUndefined()
  return result.progress!
}

function escorted() {
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...base } = createFreshPublicV42Root('wizard-realms').head
  const site = resolveSedgehornFamiliarSite(base)!
  const bridge = waystationRiverSite(base.state.seed)!
  const anchors = [site.tracks, site.habitat, site.shelter, site.dryApproach, site.keeper]
  const span = (axis: 'x' | 'z', pick: typeof Math.min, pad: number) =>
    pick(...anchors.map(({ center }) => center[axis])) / WORLD_CELL_METERS + pad
  const pocket = [] as string[]
  for (let gz = span('z', Math.min, -1); gz <= span('z', Math.max, 1); gz++)
    for (let gx = span('x', Math.min, -1); gx <= span('x', Math.max, 1); gx++)
      pocket.push(worldTileAtGrid(base.state.seed, gx, gz).id)
  const familiar = createPublicV43FamiliarProgress({ ...base, southbankReached: true,
    riverBridgeIds: [bridge.id], state: { ...base.state, movementOwner: 'streamed',
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(base.state.discoveryMask),
        ...bridge.footprintTileIds, ...pocket])].sort()),
      player: { ...base.state.player, position: { ...site.tracks.center },
        verticalVelocity: 0, inventory: [...base.state.player.inventory,
          { itemId: 'marsh_herb', quantity: 4 }, { itemId: 'logs', quantity: 2 }] } } })!
  const fed = act(at(act(familiar, 'familiar-tracks/v1'), site.shelter), 'familiar-herb/v1')
  return { site, escort: act(act(fed, 'familiar-shelter/v1'), 'familiar-escort/v1') }
}

function station() {
  const { site, escort } = escorted()
  // The follower walk is covered by the familiar suite; only its endpoint is placed here.
  const home = at({ ...escort, familiar: { ...escort.familiar,
    position: { ...site.keeper.center } } }, site.keeper)
  const claimed = act(act(home, 'familiar-return/v1'), 'familiar-claim/v1')
  const trainee = createPublicV43MountTraining(at(claimed, site.careStation))
  expect(trainee).not.toBeNull()
  return { site, escort, trainee: trainee! }
}

const step = (progress: PublicV43MountTrainingProgress) => {
  const result = confirmPublicV43MountTraining(progress, care)
  expect(result.rejection).toBeUndefined()
  return result.progress!
}

describe('V43 sedgehorn mount training domain prototype (NOT PLAYABLE)', () => {
  it('stores only bounded care witnesses and refuses malformed or forged fields', () => {
    const { trainee } = station()
    expect(trainee.mountTraining).toEqual({ careWitnesses: [] })
    expect(projectPublicV43MountTraining(trainee)).toEqual({ careCount: 0,
      careXp: 0, lastCareTick: null, mature: false })
    expect(decodePublicV43MountTrainingProgress(structuredClone(trainee))).toEqual(trainee)
    const forged = (mountTraining: unknown) =>
      decodePublicV43MountTrainingProgress({ ...trainee, mountTraining })
    expect(forged({ careWitnesses: [], age: 9 })).toBeNull()
    expect(forged({ careCount: 3, careXp: 15, lastCareTick: 1200,
      mature: true })).toBeNull()
    expect(forged({ careWitnesses: [], careCount: 3 })).toBeNull()
    expect(forged({ careWitnesses: 'three' })).toBeNull()
    const first = step(trainee)
    const event = first.mountTraining.careWitnesses[0]
    const forgedAfterOneCare = (careWitnesses: unknown) =>
      decodePublicV43MountTrainingProgress({ ...first,
        mountTraining: { careWitnesses } })
    expect(forgedAfterOneCare([{ ...event, careXp: 15 }])).toBeNull()
    expect(forgedAfterOneCare([{ ...event, kind: 'familiar-claim/v1' }])).toBeNull()
    expect(forgedAfterOneCare([{ ...event, tick: first.state.tick + 1 }])).toBeNull()
    expect(forgedAfterOneCare([{ ...event, eventSequence: 0 }])).toBeNull()
    expect(forgedAfterOneCare([{ ...event, eventSequence: 0.5 }])).toBeNull()
    expect(forgedAfterOneCare([event, { ...event }])).toBeNull()
    const after599 = later(first, 599)
    const advanced = { ...after599, state: { ...after599.state,
      eventSequence: event.eventSequence + 1 } }
    expect(decodePublicV43MountTrainingProgress({ ...advanced,
      mountTraining: { careWitnesses: [event, { ...event, tick: event.tick + 599,
        eventSequence: event.eventSequence + 1 }] } })).toBeNull()
    expect(forgedAfterOneCare([event, event, event, event])).toBeNull()
    expect(decodePublicV43MountTrainingProgress({ ...trainee, mount: {} })).toBeNull()
    const { mountTraining: _drop, ...bare } = trainee
    expect(decodePublicV43MountTrainingProgress(bare)).toBeNull()
    expect(decodePublicV43MountTrainingWitness(care)).toEqual(care)
    expect(decodePublicV43MountTrainingWitness({ ...care, careCount: 3 })).toBeNull()
  })

  it('matures after three spaced cares, spending one herb each and nothing else', () => {
    const { trainee } = station()
    const first = step(trainee)
    expect(first.mountTraining.careWitnesses).toEqual([{ ...care,
      tick: trainee.state.tick, eventSequence: trainee.state.eventSequence + 1 }])
    expect(projectPublicV43MountTraining(first)).toEqual({ careCount: 1,
      careXp: 5, lastCareTick: trainee.state.tick, mature: false })
    expect(confirmPublicV43MountTraining(later(first, 599), care).rejection).toBe('too_soon')
    const second = step(later(first, 600))
    expect(confirmPublicV43MountTraining(later(second, 599), care).rejection).toBe('too_soon')
    const third = step(later(second, 600))
    expect(third.mountTraining.careWitnesses.map(({ tick }) => tick))
      .toEqual([trainee.state.tick, trainee.state.tick + 600,
        trainee.state.tick + 1200])
    expect(projectPublicV43MountTraining(third)).toEqual({ careCount: 3,
      careXp: 15, lastCareTick: trainee.state.tick + 1200, mature: true })
    expect(decodePublicV43MountTrainingProgress(structuredClone(third))).toEqual(third)
    expect([trainee, first, second, third].map(herbs)).toEqual([3, 2, 1, 0])
    expect(third.state.eventSequence).toBe(trainee.state.eventSequence + 3)
    const others = (p: PublicV43MountTrainingProgress) => ({ ...p, mountTraining: null, state: {
      ...p.state, eventSequence: 0, tick: 0, player: { ...p.state.player, inventory: [] } } })
    expect(others(third)).toEqual(others(trainee))
    expect(confirmPublicV43MountTraining(later(third, 600), care).rejection)
      .toBe('already_mature')
  })

  it('rejects unclaimed, remote, airborne, unsafe, unfed and forged requests', () => {
    const { site, escort, trainee } = station()
    const juvenile = createPublicV43MountTraining(at(escort, site.careStation))!
    expect(confirmPublicV43MountTraining(juvenile, care).rejection).toBe('not_claimed')
    expect(confirmPublicV43MountTraining(at(trainee, site.keeper), care).rejection)
      .toBe('too_far')
    expect(confirmPublicV43MountTraining({ ...trainee, state: { ...trainee.state,
      player: { ...trainee.state.player, verticalVelocity: 1 } } }, care).rejection)
      .toBe('invalid_progress')
    const cell = { gx: Math.round(site.careStation.center.x / WORLD_CELL_METERS),
      gz: Math.round(site.careStation.center.z / WORLD_CELL_METERS) }
    expect(confirmPublicV43MountTraining({ ...trainee, terrain: { ...trainee.terrain,
      columns: [...trainee.terrain.columns, { ...cell, openDepth: 1, rewardDepth: 0, pitLadder: false }] } }, care).rejection)
      .toBe('invalid_progress')
    expect(confirmPublicV43MountTraining({ ...trainee, raisedSoilCells: [cell] }, care)
      .rejection).toBe('unsafe_source')
    expect(confirmPublicV43MountTraining({ ...trainee, state: { ...trainee.state,
      player: { ...trainee.state.player, inventory: trainee.state.player.inventory
        .filter(({ itemId }) => itemId !== 'marsh_herb') } } }, care).rejection)
      .toBe('not_owned')
    expect(confirmPublicV43MountTraining(trainee, { ...care, quantity: 9 }).rejection)
      .toBe('invalid_value')
    expect(confirmPublicV43MountTraining(trainee, { ...care, careXp: 15 }).rejection)
      .toBe('invalid_value')
    expect(confirmPublicV43MountTraining(trainee, { kind: 'familiar-claim/v1' }).rejection)
      .toBe('invalid_value')
    expect(confirmPublicV43MountTraining({ ...trainee, forgedXp: 50 } as
      PublicV43MountTrainingProgress, care).rejection).toBe('invalid_progress')
    expect(confirmPublicV43MountTraining({ ...trainee, state: { ...trainee.state,
      eventSequence: Number.MAX_SAFE_INTEGER } }, care).rejection)
      .toBe('invalid_progress')
  })
})
