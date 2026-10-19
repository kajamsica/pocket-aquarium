import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createPublicV37ControllerRuntime } from './PublicV37ControllerRuntime'
import { projectPublicV37Windward } from './PublicV37WorldView'
import { createAtomicV37Store } from './domain/atomicV37Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { highlandCorridorCells, highlandLandmark } from './domain/highlandContent'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { createFreshPublicV36Root, decodePublicV36Root, PUBLIC_V36_SCHEMA } from './domain/publicWorldV36Snapshot'
import { createPublicV37Root, replayPublicV37Witness } from './domain/publicWorldV37Snapshot'
import { createFreshPublicV37Root } from './domain/publicWorldV37Snapshot'
import { commitPublicV37 } from './domain/publicWorldV37Flow'
import type { PublicV36MarkerProgress } from './domain/publicWorldV36MarkerAction'
import type { WizardViewProjection } from './view/contracts'
import { createPublicV23Root } from './domain/publicWorldV23Snapshot'

const locks = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
  body: () => T | Promise<T>) => body() }

/** Checked synthetic glyph fixture, separate from proof of the fresh-player journey. */
function fixture(position?: { x: number; z: number }, active = false) {
  const base = createFreshPublicV36Root('wizard-realms'), glyph = highlandLandmark('wizard-realms')
  const point = { ...glyph.tile.center, ...(position ?? { z: glyph.tile.center.z + 1 }) }
  const floor = resolvePublicV23Surface(base.head.state, point, [])!.floorY
  const ids = [...new Set([...decodeDiscoveredTileIds(base.head.state.discoveryMask),
    ...highlandCorridorCells().map(({ x, z }) => `tile-${x / 4 + 3}-${z / 4 + 3}`), glyph.tile.id])].sort()
  const progress: PublicV36MarkerProgress = { ...base.lineage.genesis, markerClaimReward: null,
    state: { ...base.head.state, movementOwner: 'streamed',
      ...(active ? { windstep: { learned: true, activeUntilTick: 1200,
        nextCastTick: 1800, practicedRouteIndices: [] } } : {}),
      highland: { ...base.head.state.highland, landmarkDiscovered: true },
      discoveryMask: encodeDiscoveredTileIds(ids), player: { ...base.head.state.player,
        position: { ...point, y: floor } } } }
  const { markerClaimReward: _marker, ...genesis } = progress
  const source = { lineage: { origin: 'v35-migration' as const, rulesProfile: 'old-marker/v1' as const,
    seed: 'wizard-realms', sourceRevision: 9, genesis }, previous: null,
  head: { ...progress, schemaVersion: PUBLIC_V36_SCHEMA, saveRevision: 0, witness: null } }
  expect(decodePublicV36Root(source)).not.toBeNull()
  return createPublicV37Root(source)
}
describe('V37 controller and checked spell projection', () => {
  it('studies and casts through V37, previews 0.20 from normal 0.16, and reloads the identical result', async () => {
    const root = fixture(), store = createAtomicV37Store(new IDBFactory())
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected target')
    expect(await store.commit(missing.proof, root)).toBe('committed')
    const write = vi.fn((revision, lineage, witness) => commitPublicV37(locks, store, revision, lineage, witness))
    const runtime = createPublicV37ControllerRuntime(root, write)
    const base = { windwardStep: { unavailableReason: 'Inherited V13 restriction' } } as WizardViewProjection
    const before = structuredClone(root)
    expect(projectPublicV37Windward(runtime.preview(), base).windwardStep)
      .toMatchObject({ learned: false, checkedActions: true, glyph: { canStudy: true }, canCast: false })
    expect(await runtime.action({ kind: 'windward-study/v1' })).toMatchObject({ status: 'saved' })
    expect(await runtime.action({ kind: 'windward-study/v1' }))
      .toEqual({ status: 'rejected', reason: 'already_learned' })
    expect(projectPublicV37Windward(runtime.preview(), base).windwardStep)
      .toMatchObject({ learned: true, canCast: true, glyph: { canStudy: false } })
    expect(await runtime.action({ kind: 'windward-cast/v1' })).toMatchObject({ status: 'saved' })
    const from = runtime.preview().state.player.position
    const intents = [{ type: 'move' as const, delta: { x: 0, z: 0.16 } }]
    expect(runtime.advanceFrame(intents, true).rejections).toEqual([])
    expect(runtime.preview().state.player.position.z - from.z).toBeCloseTo(0.20)
    expect(runtime.committed().head.state.player.position).toEqual(from)
    expect(runtime.advanceFrame([{ type: 'jump' }], true).rejections).toEqual([])
    for (let index = 0; index < 48; index++) expect(runtime.advanceFrame([], true).rejections).toEqual([])
    expect(runtime.preview().state.player.position.z - from.z).toBeCloseTo(0.20)
    expect(runtime.preview().state.player.verticalVelocity).toBe(0)
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(write.mock.calls.map((call) => call[2].kind)).toEqual([
      'windward-study/v1', 'windward-cast/v1', 'frame-batch/v1'])
    expect(write.mock.calls[2][2]).toMatchObject({ kind: 'frame-batch/v1', frames: [
      { intents, walkRequested: true }, { intents: [{ type: 'jump' }], walkRequested: true },
      ...Array.from({ length: 48 }, () => ({ intents: [], walkRequested: true }))] })
    const read = await store.readChecked()
    if (read.status !== 'valid') throw Error('Reload failed')
    const resumed = createPublicV37ControllerRuntime(read.root, write)
    expect(resumed.preview()).toEqual(runtime.preview())
    expect(resumed.committed().head.saveRevision).toBe(3)
    expect(projectPublicV37Windward(resumed.preview(), base).windwardStep)
      .toMatchObject({ learned: true, activeSeconds: 58, cooldownSeconds: 88, canCast: false })
    expect(root).toEqual(before)
    expect(await resumed.action({ kind: 'marker-claim/v1' })).toMatchObject({ status: 'rejected', reason: 'requires_ledger' })
  }, 120_000)

  it('flushes ordinary travel before study and freezes a lying writer', async () => {
    const root = fixture(), write = vi.fn(async () => ({ ok: true as const, value: root }))
    const runtime = createPublicV37ControllerRuntime(root, write)
    expect(runtime.advanceFrame([{ type: 'look', yawDelta: 0.01, pitchDelta: 0 }], false).rejections).toEqual([])
    expect(await runtime.action({ kind: 'windward-study/v1' }))
      .toEqual({ status: 'blocked', reason: 'writer-mismatch' })
    expect(write.mock.calls).toHaveLength(1)
    expect(runtime.preview().state.windstep.learned).toBe(false)
    expect(runtime.status().gate).toBe('blocked')
    expect(runtime.advanceFrame([], false).rejections[0]?.code).toBe('unavailable_here')
    expect(await runtime.save()).toEqual({ status: 'blocked', reason: 'writer-mismatch' })
  })

  it('previews canonical fresh jump-start, defers airborne save, lands and commits the checked batch', async () => {
    const root = createFreshPublicV37Root('wizard-realms'), store = createAtomicV37Store(new IDBFactory())
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected target')
    expect(await store.commit(missing.proof, root)).toBe('committed')
    const runtime = createPublicV37ControllerRuntime(root, (revision, lineage, witness) =>
      commitPublicV37(locks, store, revision, lineage, witness))
    expect(runtime.advanceFrame([{ type: 'jump' }], true).rejections).toEqual([])
    expect(runtime.status().pendingFrames).toBe(1)
    expect(runtime.preview().state.player.position.y).toBeCloseTo(1.3431104366667568)
    expect(runtime.preview().state.player.verticalVelocity).toBeCloseTo(4.51)
    expect(await runtime.save()).toEqual({ status: 'deferred-airborne' })
    for (let index = 0; index < 48; index++) expect(runtime.advanceFrame([], true).rejections).toEqual([])
    expect(runtime.preview().state.player.verticalVelocity).toBe(0)
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(runtime.committed().head.state.player.position).toEqual(root.head.state.player.position)
    expect(await runtime.action({ kind: 'legacy-action', intent: {
      type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' } }))
      .toMatchObject({ status: 'saved' })
    expect(runtime.preview().state.player.equipment.mainHand).toBe('woodcutters_axe')
  }, 120_000)

  it('keeps gentle dry descent airborne at frames 63/64, then lands and saves at 65', async () => {
    const base = createFreshPublicV36Root('wizard-realms'), seed = 'greenway-alpha'
    const state = createPublicV23Root(seed).head.state
    const point = { x: -80.43882791987258, z: -30.0020115161052 }
    const floor = resolvePublicV23Surface(state, point, [])!
    const genesis = { ...base.lineage.genesis, state: { ...state, movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(state.discoveryMask), floor.tileId])].sort()),
      player: { ...state.player, position: { ...point, y: floor.floorY } } } }
    const source = { lineage: { origin: 'v35-migration' as const, rulesProfile: 'old-marker/v1' as const,
      seed, sourceRevision: 0, genesis }, previous: null,
    head: { ...genesis, markerClaimReward: null, schemaVersion: PUBLIC_V36_SCHEMA, saveRevision: 0, witness: null } }
    expect(decodePublicV36Root(source)).not.toBeNull()
    const root = createPublicV37Root(source), store = createAtomicV37Store(new IDBFactory())
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected target')
    expect(await store.commit(missing.proof, root)).toBe('committed')
    const write = vi.fn((revision, lineage, witness) => commitPublicV37(locks, store, revision, lineage, witness))
    const runtime = createPublicV37ControllerRuntime(root, write)
    const intents = [{ type: 'move' as const, delta: { x: -0.15505746062087306, z: 0.03946116959501334 } }]
    for (let index = 1; index <= 65; index++) {
      expect(runtime.advanceFrame(intents, false).rejections, `frame ${index}`).toEqual([])
      if (index === 63 || index === 64) {
        expect(runtime.preview().state.player.verticalVelocity).toBeLessThan(0)
        expect(await runtime.save()).toEqual({ status: 'deferred-airborne' })
        expect(write).not.toHaveBeenCalled()
      }
    }
    expect(runtime.preview().state.player.position.x).toBeCloseTo(-90.51756286022894)
    expect(runtime.preview().state.player.verticalVelocity).toBe(0)
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(write).toHaveBeenCalledOnce()
  }, 120_000)

  it('defers the exact assisted downhill batch, then saves and reloads its identical checked landing', async () => {
    const root = fixture({ x: 462.18, z: -428 }, true)
    const store = createAtomicV37Store(new IDBFactory()), missing = await store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected target')
    expect(await store.commit(missing.proof, root)).toBe('committed')
    const write = vi.fn((revision, lineage, witness) => commitPublicV37(locks, store, revision, lineage, witness))
    const runtime = createPublicV37ControllerRuntime(root, write)
    const frame = { intents: [{ type: 'move' as const, delta: { x: -0.16, z: 0 } }], walkRequested: true }
    expect(runtime.advanceFrame(frame.intents, true).rejections).toEqual([])
    expect(runtime.preview().state.player.position.x).toBeCloseTo(461.98)
    expect(runtime.preview()).toEqual(replayPublicV37Witness(root.head,
      { kind: 'frame-batch/v1', frames: [frame] }))
    expect(runtime.advanceFrame(frame.intents, true).rejections).toEqual([])
    expect(runtime.preview().state.player.position.x).toBeCloseTo(461.82)
    expect(runtime.preview().state.player.verticalVelocity).toBeLessThan(0)
    expect(replayPublicV37Witness(root.head, { kind: 'frame-batch/v1', frames: [frame, frame] })).toBeNull()
    expect(await runtime.save()).toEqual({ status: 'deferred-airborne' })
    expect(write).not.toHaveBeenCalled()
    expect(runtime.status().gate).toBe('open')
    expect(runtime.advanceFrame([], true).rejections).toEqual([])
    const landed = runtime.preview()
    expect(landed.state.player.position.x).toBeCloseTo(461.82)
    expect(landed.state.player.verticalVelocity).toBe(0)
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(write).toHaveBeenCalledOnce()
    expect(runtime.preview()).toEqual(landed)
    const reloaded = await store.readChecked()
    if (reloaded.status !== 'valid') throw Error('Reload failed')
    expect(createPublicV37ControllerRuntime(reloaded.root, write).preview()).toEqual(landed)
  }, 120_000)
})
