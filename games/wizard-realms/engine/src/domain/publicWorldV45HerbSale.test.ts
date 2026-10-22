import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { mireglassAnchors } from './mireglassContent'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { createFreshPublicV43Root, decodePublicV43Progress }
  from './publicWorldV43Snapshot'
import { confirmPublicV45HerbSale, MIREGLASS_HERB_UNIT_PRICE }
  from './publicWorldV45HerbSale'
import type { PublicV45Progress } from './publicWorldV45RideAction'

const seed = 'wizard-realms'

function atSalvager(): PublicV45Progress {
  const head = createFreshPublicV43Root(seed).head
  const salvager = mireglassAnchors(seed).salvager.tile
  const surface = resolvePublicV23Surface(head.state, salvager.center, [])
  if (!surface) throw new Error('Missing salvager floor')
  const state = { ...head.state, movementOwner: 'streamed' as const,
    eventSequence: 10,
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(head.state.discoveryMask), salvager.id,
    ])].sort()),
    player: { ...head.state.player,
      position: { ...salvager.center, y: surface.floorY },
      verticalVelocity: 0, coins: 10,
      inventory: [{ itemId: 'marsh_herb' as const, quantity: 1 },
        { itemId: 'stone' as const, quantity: 2 },
        { itemId: 'marsh_herb' as const, quantity: 3 }] } }
  const { schemaVersion: _schema, saveRevision: _revision,
    witness: _witness, ...flat } = head
  const progress = decodePublicV43Progress({ ...flat, state })
  if (!progress) throw new Error('Invalid salvager fixture')
  return { ...progress, groundMount: { mode: 'parked', parkedPosition: null },
    tack: 'not_owned' }
}

describe('V45 Mireglass marsh herb sale', () => {
  it('debits actual herbs across stacks and credits fixed coins once', () => {
    const before = atSalvager()
    const saved = structuredClone(before)
    const result = confirmPublicV45HerbSale(before, 3)
    expect(result.rejection).toBeUndefined()
    expect(MIREGLASS_HERB_UNIT_PRICE).toBe(8)
    expect(result.progress).toEqual({ ...before, state: { ...before.state,
      eventSequence: before.state.eventSequence + 1,
      player: { ...before.state.player, coins: 34,
        inventory: [{ itemId: 'stone', quantity: 2 },
          { itemId: 'marsh_herb', quantity: 1 }] } } })
    expect(before).toEqual(saved)
    expect(result.progress!.tack).toBe(before.tack)
    expect(result.progress!.groundMount).toEqual(before.groundMount)
  })

  it('rejects invalid quantity and unsourced herbs without mutation', () => {
    const before = atSalvager()
    const saved = structuredClone(before)
    for (const quantity of [0, -1, 1.5, 257, NaN, Infinity])
      expect(confirmPublicV45HerbSale(before, quantity).rejection)
        .toBe('invalid_quantity')
    expect(confirmPublicV45HerbSale(before, 5).rejection).toBe('not_owned')
    expect(before).toEqual(saved)
  })

  it('requires parked, streamed, revealed, nearby, grounded dry terrain', () => {
    const before = atSalvager()
    const state = before.state
    expect(confirmPublicV45HerbSale({ ...before,
      groundMount: { mode: 'riding', parkedPosition: null } }, 1).rejection)
      .toBe('not_eligible')
    expect(confirmPublicV45HerbSale({ ...before,
      state: { ...state, movementOwner: 'greenway' } }, 1).rejection)
      .toBe('unavailable_here')
    const distant = mireglassAnchors(seed).fringeMarker.tile
    const distantFloor = resolvePublicV23Surface(state, distant.center,
      before.regionalWorks.builtLadderIds)
    if (!distantFloor) throw new Error('Missing distant floor')
    expect(confirmPublicV45HerbSale({ ...before, state: { ...state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(state.discoveryMask), distant.id])].sort()),
      player: { ...state.player, position: { ...distant.center,
        y: distantFloor.floorY } } } }, 1).rejection).toBe('too_far')
    expect(confirmPublicV45HerbSale({ ...before, state: { ...state,
      discoveryMask: new Uint8Array(state.discoveryMask.length) } }, 1).rejection)
      .toBe('unrevealed')
    expect(confirmPublicV45HerbSale({ ...before, state: { ...state,
      player: { ...state.player, verticalVelocity: 1 } } }, 1).rejection)
      .toBe('unsafe_pose')
    const wet = mireglassAnchors(seed).bellAlder.tile
    expect(wet.terrain).toBe('wetland')
    const floor = resolvePublicV23Surface(state, wet.center,
      before.regionalWorks.builtLadderIds)
    if (!floor) throw new Error('Missing wetland floor')
    expect(confirmPublicV45HerbSale({ ...before, state: { ...state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(state.discoveryMask), wet.id])].sort()),
      player: { ...state.player, position: { ...wet.center, y: floor.floorY } } } }, 1)
      .rejection).toBe('unsafe_pose')
  })

  it('blocks unsafe coin and sequence arithmetic', () => {
    const before = atSalvager()
    expect(confirmPublicV45HerbSale({ ...before, state: { ...before.state,
      player: { ...before.state.player, coins: Number.MAX_SAFE_INTEGER - 7 } } },
    1).rejection).toBe('invalid_value')
    expect(confirmPublicV45HerbSale({ ...before, state: { ...before.state,
      eventSequence: Number.MAX_SAFE_INTEGER } }, 1).rejection)
      .toBe('invalid_value')
  })
})
