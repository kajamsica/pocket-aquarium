import { describe, expect, it } from 'vitest'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { createFreshPublicV43Root, decodePublicV43Progress }
  from './publicWorldV43Snapshot'
import type { PublicV45Progress } from './publicWorldV45RideAction'
import { confirmPublicV45TackPurchase, SEDGEHORN_TACK_PRICE }
  from './publicWorldV45TackPurchase'
import { resolveSedgehornFamiliarSite } from './sedgehornFamiliarContent'

const seed = 'wizard-realms'

function ready(coins = SEDGEHORN_TACK_PRICE): PublicV45Progress {
  const head = createFreshPublicV43Root(seed).head
  const store = head.state.greenway.stores.find((entry) => entry.id === 'store-greenway')!
  const site = resolveSedgehornFamiliarSite(head)!
  const familiar = { ...head.familiar, phase: 'claimed' as const,
    routeChoice: 'shelter' as const, position: { ...site.keeper.center },
    trust: 2, creatureCareXp: 40, stationKnown: true }
  const mountTraining = { careWitnesses: [0, 600, 1200].map((tick, index) => ({
    kind: 'sedgehorn-care/v1' as const, tick, eventSequence: index + 1 })) }
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...flat } = head
  const progress = decodePublicV43Progress({ ...flat, familiar, mountTraining,
    state: { ...head.state, tick: 1300, eventSequence: 10,
      player: { ...head.state.player, position: { ...store.position },
        coins, xp: head.state.player.xp + 40 } } })
  if (!progress) throw new Error('Invalid mature Greenway fixture')
  return { ...progress, groundMount: { mode: 'parked', parkedPosition: null },
    tack: 'not_owned' }
}

describe('V45 fixed-price Sedgehorn tack purchase', () => {
  it('debits exactly 240 coins once and preserves every other progress field', () => {
    const before = ready(300), original = structuredClone(before)
    const result = confirmPublicV45TackPurchase(before)
    expect(result.rejection).toBeUndefined()
    const after = result.progress!
    expect(after.tack).toBe('purchased')
    expect(after.state.player.coins).toBe(60)
    expect(after.state.eventSequence).toBe(before.state.eventSequence + 1)
    expect(after.state).toEqual({ ...before.state,
      eventSequence: before.state.eventSequence + 1,
      player: { ...before.state.player, coins: 60 } })
    expect({ ...after, state: before.state, tack: before.tack }).toEqual(before)
    expect(before).toEqual(original)
  })

  it('rejects insufficient coins, immature or unclaimed companions, and repeat buys', () => {
    expect(confirmPublicV45TackPurchase(ready(239)).rejection).toBe('insufficient_coins')
    const before = ready()
    expect(confirmPublicV45TackPurchase({ ...before, mountTraining: {
      careWitnesses: before.mountTraining!.careWitnesses.slice(0, 2) } }).rejection)
      .toBe('not_mature')
    expect(confirmPublicV45TackPurchase({ ...before, familiar: {
      ...before.familiar, phase: 'returned' } }).rejection).toBe('not_mature')
    expect(confirmPublicV45TackPurchase({ ...before, tack: 'legacy' }).rejection)
      .toBe('already_owned')
    const bought = confirmPublicV45TackPurchase(before).progress!
    expect(confirmPublicV45TackPurchase(bought as unknown as PublicV45Progress).rejection)
      .toBe('already_owned')
  })

  it('rejects riding, wrong region, airborne, ungrounded, and distant purchases', () => {
    const before = ready()
    expect(confirmPublicV45TackPurchase({ ...before, groundMount: {
      mode: 'riding', parkedPosition: null } }).rejection).toBe('not_parked')
    expect(confirmPublicV45TackPurchase({ ...before, state: { ...before.state,
      movementOwner: 'streamed' } }).rejection).toBe('wrong_region')
    expect(confirmPublicV45TackPurchase({ ...before, state: { ...before.state,
      player: { ...before.state.player, verticalVelocity: 1 } } }).rejection)
      .toBe('not_grounded')
    expect(confirmPublicV45TackPurchase({ ...before, state: { ...before.state,
      player: { ...before.state.player, position: { ...before.state.player.position,
        y: before.state.player.position.y + 1 } } } }).rejection).toBe('not_grounded')
    const store = before.state.greenway.stores.find((entry) => entry.id === 'store-greenway')!
    const farPoint = { ...store.position, x: store.position.x + 8 }
    const floor = resolvePublicV23Surface(before.state, farPoint, [])
    if (!floor) throw new Error('Missing distant fixture floor')
    expect(confirmPublicV45TackPurchase({ ...before, state: { ...before.state,
      player: { ...before.state.player, position: { ...farPoint,
        y: floor.floorY } } } }).rejection).toBe('too_far')
  })

  it('rejects unsafe integer sequence or coin totals without mutating the input', () => {
    const before = ready(), original = structuredClone(before)
    expect(confirmPublicV45TackPurchase({ ...before, state: { ...before.state,
      eventSequence: Number.MAX_SAFE_INTEGER } }).rejection).toBe('invalid_value')
    expect(confirmPublicV45TackPurchase({ ...before, state: { ...before.state,
      player: { ...before.state.player,
        coins: Number.MAX_SAFE_INTEGER + 1 } } }).rejection).toBe('invalid_value')
    expect(before).toEqual(original)
  })
})
