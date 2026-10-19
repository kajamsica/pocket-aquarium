import { describe, expect, it, vi } from 'vitest'
import { createPublicV29ControllerRuntime } from './PublicV29ControllerRuntime'
import { createPublicV28ControllerRuntime } from './PublicV28ControllerRuntime'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { samePublicV14Value } from './domain/publicWorldV14Validation'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { createPublicV23Root } from './domain/publicWorldV23Snapshot'
import { createPublicV24Root } from './domain/publicWorldV24Snapshot'
import { createPublicV25Root } from './domain/publicWorldV25Snapshot'
import { createPublicV26Root } from './domain/publicWorldV26Snapshot'
import { createPublicV27Root } from './domain/publicWorldV27Snapshot'
import { createPublicV28Root } from './domain/publicWorldV28Snapshot'
import { replayPublicV28Witness } from './domain/publicWorldV28Snapshot'
import { resolvePublicV28RiverBridge } from './domain/publicWorldV28RiverBridgeSites'
import { projectPublicV28Pose } from './domain/publicWorldV28RiverSupport'
import { applyPublicV29MiningToolAction } from './domain/publicWorldV29MiningTools'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { createPublicV29Root, replayPublicV29Witness } from './domain/publicWorldV29Snapshot'
import type { PublicV29Progress } from './domain/publicWorldV29Migration'
import type { PublicV29Witness } from './domain/publicWorldV29Snapshot'
import type { PublicV29Start } from './domain/publicWorldV29Flow'

function start(seed = 'greenway-alpha'): PublicV29Start {
  const v23 = createPublicV23Root(seed)
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
  const v29 = createPublicV29Root({ head: v28.head, lineage: v28.lineage })
  return { head: v29.head, lineage: v29.lineage }
}
function writerFor(initial: PublicV29Start) {
  let current = initial
  const write = vi.fn(async (revision: number, lineage: PublicV29Start['lineage'],
    witness: PublicV29Witness) => {
    if (revision !== current.head.saveRevision || !samePublicV14Value(lineage, current.lineage))
      return { ok: false as const, reason: 'revision-changed' }
    const next = replayPublicV29Witness(current.head, witness)
    if (!next) return { ok: false as const, reason: 'frame-rejected' }
    current = { lineage, head: { ...current.head, ...next,
      saveRevision: revision + 1, witness } }
    return { ok: true as const, value: current }
  })
  return { write, current: () => current }
}

function deepPitStart(): PublicV29Start {
  const base = start('wizard-realms'), from = { x: -2.05, z: 2.2 }
  const support = publicV17StarterSupportAt({ seed: base.head.state.seed,
    profile: base.head.state.generationProfile,
    route: base.head.state.greenway.routes[0] ?? null, built: false,
    greenwayWorks: base.head.greenwayWorks }, from)
  if (!support) throw new Error('Missing dry starting support')
  return { ...base, head: { ...base.head,
    state: { ...base.head.state, player: { ...base.head.state.player,
      position: { ...from, y: support.floorY },
      inventory: [...base.head.state.player.inventory,
        { itemId: 'field_spade', quantity: 1 }],
      equipment: { ...base.head.state.player.equipment, mainHand: 'field_spade' } } },
    terrain: { ...base.head.terrain, columns: [{ gx: 0, gz: 1,
      openDepth: 3, rewardDepth: 3, pitLadder: false }],
    bag: { ...base.head.terrain.bag, soil: 2, stone: 1 } } } }
}

describe('V29 checked controller adapter', () => {
  it('identifies only a causally blocked deep-pit step without changing movement authority', () => {
    const initial = deepPitStart()
    const writer = writerFor(initial), runtime = createPublicV29ControllerRuntime(initial, writer.write)
    const before = runtime.preview(), move = [{ type: 'move' as const,
      delta: { x: 0.1, z: 0 } }]
    const { miningTools: _tools, ...older } = before
    const shallow = { ...older, terrain: { ...older.terrain,
      columns: older.terrain.columns.map((entry) => ({ ...entry, openDepth: 1 })) } }
    const counterfactual = replayPublicV28Witness(shallow, { kind: 'frame-batch/v1',
      frames: [{ intents: move, walkRequested: false }] })
    expect(counterfactual?.state.player.position.x).toBeCloseTo(-1.95)
    expect(counterfactual?.state.player.position.z).toBeCloseTo(2.2)
    const blocked = runtime.advanceFrame(move, false)
    expect(blocked.rejections).toHaveLength(1)
    expect(blocked.rejections[0].message).toContain('This saved pit is 3 layers deep')
    expect(blocked.rejections[0].message).toContain('Use Fill 2 times')
    expect(runtime.preview()).toEqual(before)
    expect(runtime.committed()).toEqual(initial)
    expect(writer.write).not.toHaveBeenCalled()
    expect(runtime.advanceFrame(move, false)).toEqual(blocked)

    const v28 = createPublicV28ControllerRuntime({
      lineage: structuredClone(initial.lineage.sourceReceipt.lineage),
      head: { state: initial.head.state, greenwayWorks: initial.head.greenwayWorks,
        regionalWorks: initial.head.regionalWorks, terrain: initial.head.terrain,
        nextHomeAtMs: initial.head.nextHomeAtMs, riverBridgeIds: initial.head.riverBridgeIds,
        schemaVersion: 'wizard-world/v28', saveRevision: initial.head.saveRevision,
        witness: null },
    }, async () => ({ ok: false as const, reason: 'not-called' }))
    const original = v28.advanceFrame(move, false)
    expect(original.rejections[0].message)
      .not.toContain('This saved pit is 3 layers deep')
    expect(blocked.events).toEqual(original.events)
    expect(blocked.rejections[0]).toMatchObject({
      intentIndex: original.rejections[0].intentIndex,
      intentType: original.rejections[0].intentType,
      code: original.rejections[0].code })
    expect(v28.preview().state.player.position).toEqual(before.state.player.position)
  })

  it('distinguishes missing soil, missing spade, and a saved pit ladder', () => {
    const base = deepPitStart()
    const move = [{ type: 'move' as const, delta: { x: 0.1, z: 0 } }]
    const variants = [
      { initial: { ...base, head: { ...base.head, terrain: { ...base.head.terrain,
        bag: { ...base.head.terrain.bag, soil: 0 } } } }, expected: 'Gather 2 more soil' },
      { initial: { ...base, head: { ...base.head, state: { ...base.head.state,
        player: { ...base.head.state.player,
          inventory: base.head.state.player.inventory.filter((item) => item.itemId !== 'field_spade'),
          equipment: { ...base.head.state.player.equipment, mainHand: null } } } } },
      expected: 'Buy and equip a spade' },
    ]
    for (const { initial, expected } of variants) {
      const runtime = createPublicV29ControllerRuntime(initial, writerFor(initial).write)
      const before = runtime.preview()
      expect(runtime.advanceFrame(move, false).rejections[0].message).toContain(expected)
      expect(runtime.preview()).toEqual(before)
    }
    const ladder: PublicV29Start = { ...base, head: { ...base.head,
      terrain: { ...base.head.terrain, columns: base.head.terrain.columns.map((column) =>
        ({ ...column, pitLadder: true })) } } }
    const runtime = createPublicV29ControllerRuntime(ladder, writerFor(ladder).write)
    expect(runtime.advanceFrame(move, false).rejections[0]?.message ?? '')
      .not.toContain('This saved pit')
  })

  it('retains ordinary cliff rejection outside saved pits', () => {
    const base = start('wizard-realms'), from = { x: -24.9, z: -5.92 }
    const support = publicV17StarterSupportAt({ seed: base.head.state.seed,
      profile: base.head.state.generationProfile,
      route: base.head.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
      built: false, greenwayWorks: base.head.greenwayWorks }, from)
    if (!support) throw new Error('Missing cliff approach support')
    const initial: PublicV29Start = { ...base, head: { ...base.head,
      state: { ...base.head.state, player: { ...base.head.state.player,
        position: { ...from, y: support.floorY } } } } }
    const runtime = createPublicV29ControllerRuntime(initial, writerFor(initial).write)
    const before = runtime.preview()
    expect(runtime.advanceFrame([{ type: 'move', delta: { x: 0, z: -0.16 } }], false)
      .rejections[0].message).toMatch(/cliff needs a ladder/i)
    expect(runtime.preview()).toEqual(before)
  })

  it('retains ordinary river rejection outside saved pits', () => {
    const base = start('greenway-alpha')
    const site = resolvePublicV28RiverBridge('greenway-alpha', 'works6:river-bridge:-14')
    if (!site) throw new Error('Missing canonical river bridge site')
    const floor = resolvePublicV23Surface(base.head.state, site.from, [])
    if (!floor) throw new Error('Missing canonical north bank')
    const initial: PublicV29Start = { ...base, head: { ...base.head,
      state: { ...base.head.state, movementOwner: 'streamed',
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(base.head.state.discoveryMask),
          ...site.footprintTileIds])].sort()),
        player: { ...base.head.state.player,
          position: { ...site.from, y: floor.floorY } } } } }
    const runtime = createPublicV29ControllerRuntime(initial, writerFor(initial).write)
    let rejection: ReturnType<typeof runtime.advanceFrame>['rejections'][number] | null = null
    for (let index = 0; index < 50; index++) {
      const result = runtime.advanceFrame([{ type: 'move', delta: { x: 0, z: 0.16 } }], false)
      if (result.rejections.length) { rejection = result.rejections[0]; break }
    }
    expect(rejection).toMatchObject({ code: 'terrain_missing',
      message: expect.stringMatching(/river blocks this step/i) })
    expect(rejection?.message).not.toContain('This saved pit')
  })

  it('enters a saved one-layer pit and digs a checked second layer from inside', async () => {
    const base = start('wizard-realms'), staged = deepPitStart()
    const initial: PublicV29Start = { ...staged, head: { ...staged.head,
      terrain: base.head.terrain } }
    const writer = writerFor(initial)
    const runtime = createPublicV29ControllerRuntime(initial, writer.write)
    expect(await runtime.action({ kind: 'terrain-action/v1', action: {
      kind: 'dig', gx: 0, gz: 1 } })).toMatchObject({ status: 'saved',
      digOutcome: { material: 'soil', depthLayers: 1 } })
    const before = runtime.preview()
    expect(before.terrain.columns).toMatchObject([{ gx: 0, gz: 1, openDepth: 1 }])
    const move = [{ type: 'move' as const, delta: { x: 0.1, z: 0 } }]
    const { miningTools: _tools, ...v28Before } = before
    const olderStep = replayPublicV28Witness(v28Before, { kind: 'frame-batch/v1',
      frames: [{ intents: move, walkRequested: false }] })
    const step = runtime.advanceFrame(move, false)
    expect(step.rejections).toEqual([])
    expect(runtime.preview().state.player.position).toEqual(olderStep?.state.player.position)
    expect(runtime.preview().state.player.position.x).toBeCloseTo(-1.95)
    const pose = projectPublicV28Pose(runtime.preview(), runtime.preview().terrain,
      runtime.preview().riverBridgeIds)
    expect(pose?.cell.gx).toBeCloseTo(0)
    expect(pose?.cell.gz).toBe(1)
    expect(pose?.effective.position.y).toBeCloseTo((pose?.carrier.floorY ?? 0) - 0.4)
    expect(pose?.effective.floorY).toBeCloseTo((pose?.carrier.floorY ?? 0) - 0.4)
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(writer.current().head.state.player.position.x).toBeCloseTo(-1.95)
    expect(await runtime.action({ kind: 'terrain-action/v1', action: {
      kind: 'dig', gx: 0, gz: 1 } })).toMatchObject({ status: 'saved',
      digOutcome: { depthLayers: 2 } })
    expect(runtime.preview().terrain.columns).toMatchObject([{ gx: 0, gz: 1, openDepth: 2 }])
    expect(runtime.committed().head.terrain.columns).toMatchObject([{
      gx: 0, gz: 1, openDepth: 2 }])
    expect(runtime.preview().state.player.position.x).toBeCloseTo(-1.95)
  }, 120_000)

  it('records movement through V29 and retains its sidecar after save and reload', async () => {
    const initial = start(), writer = writerFor(initial)
    const runtime = createPublicV29ControllerRuntime(initial, writer.write)
    const before = runtime.preview().state.player.position
    expect(runtime.advanceFrame([{ type: 'move', delta: { x: 0.1, z: 0 } }], false)
      .rejections).toEqual([])
    expect(runtime.preview().state.player.position.x).toBeGreaterThan(before.x)
    expect(runtime.preview().miningTools).toEqual(initial.head.miningTools)
    const saved = await runtime.save()
    if (saved.status !== 'saved') throw new Error(JSON.stringify(saved))
    expect(runtime.committed()).toEqual(writer.current())
    expect(runtime.committed().head.schemaVersion).toBe('wizard-world/v29')
    const reload = createPublicV29ControllerRuntime(runtime.committed(), writer.write)
    expect(reload.preview()).toEqual(runtime.preview())
    expect(reload.status()).toMatchObject({ gate: 'open', saveRevision: 1,
      pendingFrames: 0 })
  })

  it.each([false, true])('forwards a checked 64-frame proof with pick equipped: %s',
    async (mainHandEquipped) => {
      const base = start(), initial: PublicV29Start = { ...base, head: { ...base.head,
        miningTools: { basicPickOwned: true, enchantedPickOwned: false,
          activePick: mainHandEquipped ? null : 'basic' },
        state: { ...base.head.state, player: { ...base.head.state.player,
          equipment: { ...base.head.state.player.equipment,
            mainHand: mainHandEquipped ? 'woodcutters_axe' : null } } } } }
      const writer = writerFor(initial), proofs: PublicV29Progress[] = []
      const runtime = createPublicV29ControllerRuntime(initial,
        async (revision, lineage, witness, frameExpected) => {
          if (frameExpected) {
            proofs.push(structuredClone(frameExpected))
            Reflect.set(frameExpected.state.player, 'coins', -1)
          }
          return writer.write(revision, lineage, witness)
        })
      for (let index = 0; index < 64; index++)
        expect(runtime.advanceFrame([{ type: 'move', delta: {
          x: index % 2 ? -0.02 : 0.02, z: 0 } }], false).rejections).toEqual([])
      const before = initial.head
      expect(await runtime.save()).toMatchObject({ status: 'saved' })
      const witness = writer.write.mock.calls[0]?.[2]
      const replayed = replayPublicV29Witness(before, witness)
      expect(proofs).toEqual([replayed])
      expect(proofs[0].miningTools.activePick).toBe(mainHandEquipped ? null : 'basic')
      expect(runtime.preview()).toEqual(replayed)
      expect(createPublicV29ControllerRuntime(runtime.committed(), writer.write).preview())
        .toEqual(replayed)
    }, 60_000)

  it('rejects a checked V29-only action without modifying the ledger or calling writer', async () => {
    const initial = start(), writer = writerFor(initial)
    const runtime = createPublicV29ControllerRuntime(initial, writer.write)
    const before = runtime.preview()
    expect(await runtime.action({ kind: 'mining-tool/v1', action: {
      kind: 'equip', tier: 'basic' } })).toEqual({ status: 'rejected', reason: 'not_owned' })
    expect(runtime.preview()).toEqual(before)
    expect(writer.write).not.toHaveBeenCalled()
  })

  it('persists a checked pick purchase through the V29 sidecar and reload', async () => {
    const base = start()
    const store = base.head.state.greenway.stores.find((entry) => entry.id === 'store-greenway')
    if (!store) throw new Error('Missing canonical Outfitters')
    const initial: PublicV29Start = { ...base, head: { ...base.head,
      state: { ...base.head.state, player: { ...base.head.state.player,
        position: store.position } } } }
    const witness = { kind: 'mining-tool/v1' as const,
      action: { kind: 'buy' as const, tier: 'basic' as const } }
    const local = applyPublicV29MiningToolAction({ state: initial.head.state,
      greenwayWorks: initial.head.greenwayWorks, regionalWorks: initial.head.regionalWorks,
      terrain: initial.head.terrain, nextHomeAtMs: initial.head.nextHomeAtMs,
      riverBridgeIds: initial.head.riverBridgeIds, miningTools: initial.head.miningTools },
    witness.action)
    if (!local.progress) throw new Error(`Expected checked buy: ${local.rejection}`)
    const writer = writerFor(initial), runtime = createPublicV29ControllerRuntime(initial, writer.write)
    expect(await runtime.action(witness)).toMatchObject({ status: 'saved' })
    expect(runtime.committed().head.miningTools.basicPickOwned).toBe(true)
    expect(runtime.committed().head.state.player.coins).toBe(initial.head.state.player.coins - 35)
    expect(await runtime.action({ kind: 'mining-tool/v1', action: {
      kind: 'equip', tier: 'basic' } })).toMatchObject({ status: 'saved' })
    expect(runtime.preview().miningTools.activePick).toBe('basic')
    expect(runtime.advanceFrame([{ type: 'move', delta: { x: 0.1, z: 0 } }], false)
      .rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(runtime.committed().head.miningTools.activePick).toBe('basic')
    expect(createPublicV29ControllerRuntime(runtime.committed(), writer.write).preview())
      .toEqual(runtime.preview())
  })

  it('saves a real spade divot after buying a basic pick in the same V29 controller', async () => {
    const initial = start('wizard-realms'), writer = writerFor(initial)
    const runtime = createPublicV29ControllerRuntime(initial, writer.write)
    const walk = async (target: { x: number; z: number }, steps: number) => {
      const from = runtime.preview().state.player.position
      for (let index = 0; index < steps; index++) {
        const step = runtime.advanceFrame([{ type: 'move', delta: {
          x: (target.x - from.x) / steps, z: (target.z - from.z) / steps } }], false)
        expect(step.rejections).toEqual([])
      }
      expect(await runtime.save()).toMatchObject({ status: 'saved' })
    }
    const outfitter = initial.head.state.greenway.stores.find((entry) => entry.id === 'store-greenway')
    if (!outfitter) throw new Error('Missing canonical Outfitters')
    await walk(outfitter.position, 40)
    expect(await runtime.action({ kind: 'legacy-action', intent: {
      type: 'buy_store_listing', storeId: 'store-greenway', listingId: 'spade' } }))
      .toMatchObject({ status: 'saved' })
    expect(await runtime.action({ kind: 'mining-tool/v1', action: {
      kind: 'buy', tier: 'basic' } })).toMatchObject({ status: 'saved' })
    expect(await runtime.action({ kind: 'legacy-action', intent: {
      type: 'equip_item', itemId: 'field_spade', slot: 'mainHand' } }))
      .toMatchObject({ status: 'saved' })
    expect(runtime.preview().miningTools.basicPickOwned).toBe(true)
    await walk({ x: 1.5, z: 0 }, 50)
    const witness = { kind: 'terrain-action/v1' as const,
      action: { kind: 'dig' as const, gx: 1, gz: 0 } }
    const dug = await runtime.action(witness)
    expect(dug).toMatchObject({ status: 'saved', digOutcome: {
      material: 'soil', depthLayers: 1 } })
    expect(writer.write).toHaveBeenLastCalledWith(expect.any(Number),
      expect.any(Object), witness)
    expect(runtime.preview().terrain.bag.soil).toBe(1)
    expect(runtime.preview().terrain.columns).toMatchObject([{
      gx: 1, gz: 0, openDepth: 1 }])
    expect(runtime.preview().riverBridgeIds).toEqual(initial.head.riverBridgeIds)
    expect(createPublicV29ControllerRuntime(runtime.committed(), writer.write).preview())
      .toEqual(runtime.preview())

    const forged = createPublicV29ControllerRuntime(runtime.committed(),
      async (revision, lineage, action) => {
        const next = replayPublicV29Witness(runtime.committed().head, action)
        if (!next) return { ok: false as const, reason: 'frame-rejected' }
        return { ok: true as const, value: { lineage, head: {
          ...runtime.committed().head, ...next,
          terrain: { ...next.terrain, bag: { ...next.terrain.bag, diamond: 1 } },
          saveRevision: revision + 1, witness: action } } }
      })
    expect(await forged.action(witness)).toEqual({ status: 'blocked', reason: 'writer-mismatch' })
    expect(forged.committed()).toEqual(runtime.committed())

    expect(await runtime.action(witness)).toMatchObject({ status: 'saved', digOutcome: {
      material: 'soil', depthLayers: 2 } })
    expect(await runtime.action({ kind: 'mining-tool/v1', action: {
      kind: 'equip', tier: 'basic' } })).toMatchObject({ status: 'saved' })
    expect(await runtime.action({ kind: 'deep-dig', gx: 1, gz: 0 }))
      .toMatchObject({ status: 'saved', digOutcome: { material: 'stone', depthLayers: 3 } })
    expect(await runtime.action({ kind: 'legacy-action', intent: {
      type: 'equip_item', itemId: 'field_spade', slot: 'mainHand' } }))
      .toMatchObject({ status: 'saved' })
    expect(await runtime.action({ kind: 'terrain-action/v1', action: {
      kind: 'fill', gx: 1, gz: 0 } })).toMatchObject({ status: 'saved' })
    expect(await runtime.action({ kind: 'mining-tool/v1', action: {
      kind: 'equip', tier: 'basic' } })).toMatchObject({ status: 'saved' })
    const bagBeforeRedig = runtime.preview().terrain.bag
    expect(await runtime.action({ kind: 'deep-dig', gx: 1, gz: 0 }))
      .toMatchObject({ status: 'saved', digOutcome: { material: null, depthLayers: 3 } })
    expect(runtime.preview().terrain.bag).toEqual(bagBeforeRedig)
  }, 120_000)

  it('freezes on a forged V29 writer reply rather than accepting an invented sidecar', async () => {
    const initial = start()
    const runtime = createPublicV29ControllerRuntime(initial, async (revision, lineage, witness) => {
      const next = replayPublicV29Witness(initial.head, witness)
      if (!next) return { ok: false as const, reason: 'frame-rejected' }
      return { ok: true as const, value: { lineage, head: { ...initial.head, ...next,
        saveRevision: revision + 1, witness, miningTools: {
          basicPickOwned: true, enchantedPickOwned: false, activePick: null } } } }
    })
    expect(runtime.advanceFrame([{ type: 'move', delta: { x: 0.1, z: 0 } }], false)
      .rejections).toEqual([])
    expect(await runtime.save()).toEqual({ status: 'blocked', reason: 'writer-mismatch' })
    expect(runtime.status().gate).toBe('blocked')
  })
})
