import { IDBFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { publicV14MovementIntents } from './PublicV14Controller'
import { PublicV23Controller } from './PublicV23Controller'
import type { PublicV17InputTrace } from './PublicV17InputScheduler'
import { createPublicV42ControllerRuntime } from './PublicV42ControllerRuntime'
import { PublicV41EntryView } from './PublicV41Entry'
import { choosePublicV42Entry, inspectPublicV42Entry, PublicV42EntryView } from './PublicV42Entry'
import type { PublicV42EntryBindings } from './PublicV42Entry'
import { projectPublicV42IronHall } from './PublicV42WorldView'
import { createAtomicV40Store } from './domain/atomicV40Database'
import { createAtomicV41Store } from './domain/atomicV41Database'
import { createAtomicV42Store } from './domain/atomicV42Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { ironHallQuartermasterSite } from './domain/ironHallQuartermasterSite'
import { ironHallSite } from './domain/ironHallSite'
import { nearbyWorldTileIds } from './domain/publicWorldDiscovery'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { resolvePublicV28RiverBridge } from './domain/publicWorldV28RiverBridgeSites'
import { replayPublicV28FramesWithEvents } from './domain/publicWorldV28Replay'
import { createFreshPublicV36Root, PUBLIC_V36_SCHEMA } from './domain/publicWorldV36Snapshot'
import { createPublicV37Root } from './domain/publicWorldV37Snapshot'
import { createPublicV38Root } from './domain/publicWorldV38Snapshot'
import { createPublicV39Root } from './domain/publicWorldV39Snapshot'
import { commitPublicV40 } from './domain/publicWorldV40Flow'
import { createPublicV40Root } from './domain/publicWorldV40Snapshot'
import { createFreshPublicV41Root, createPublicV41Root } from './domain/publicWorldV41Snapshot'
import { commitPublicV42, resumePublicV42 } from './domain/publicWorldV42Flow'
import { previewPublicV41CombatAction, previewPublicV41CombatActions } from './domain/publicWorldV41CombatAction'
import { previewPublicV42RewardAction, previewPublicV42RewardActions,
  resolveIronHallCrestOutcome } from './domain/publicWorldV42RewardAction'
import type { PublicV42RewardProgress } from './domain/publicWorldV42RewardAction'
import { createFreshPublicV42Root, createPublicV42Root } from './domain/publicWorldV42Snapshot'
import { waystationRiverSite } from './domain/waystationRiverContent'
import type { WizardViewIntent, WizardViewProjection } from './view/contracts'
import { WizardHud } from './view/WizardHud'

const probe = vi.hoisted(() => ({ projection: null as WizardViewProjection | null,
  onIntent: null as ((intent: WizardViewIntent) => void) | null,
  trace: null as PublicV17InputTrace | null,
  advance: null as null | ((count: number) => Promise<unknown>),
  actions: [] as unknown[], outcomes: [] as unknown[] }))
vi.mock('./view/WizardSurface', () => ({ WizardSurface: ({ projection, onIntent, inputTrace }: {
  projection: WizardViewProjection; onIntent: (intent: WizardViewIntent) => void;
  inputTrace?: PublicV17InputTrace | null }) => {
  probe.projection = projection; probe.onIntent = onIntent; probe.trace = inputTrace ?? null
  return null
} }))
vi.mock('./PublicV42ControllerRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV42ControllerRuntime')>()
  return { ...actual, createPublicV42ControllerRuntime: (
    ...args: Parameters<typeof actual.createPublicV42ControllerRuntime>) => {
    const runtime = actual.createPublicV42ControllerRuntime(...args)
    probe.advance = async (count) => {
      for (let index = 0; index < count; index++)
        expect(runtime.advanceFrame([], false).rejections).toEqual([])
      return runtime.save()
    }
    return { ...runtime, action: async (witness: Parameters<typeof runtime.action>[0]) => {
      probe.actions.push(witness)
      const outcome = await runtime.action(witness)
      probe.outcomes.push(outcome)
      return outcome
    } }
  } }
})
const locks = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
  body: () => T | Promise<T>) => body() }
const hud = (projection: WizardViewProjection) => renderToStaticMarkup(
  createElement(WizardHud, { projection, onIntent: vi.fn() }))
const progressOf = (root: ReturnType<typeof createFreshPublicV42Root>): PublicV42RewardProgress => {
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness, ...progress } = root.head
  return progress
}

function movementAt(point: { x: number; z: number },
  owner: 'greenway' | 'streamed' = 'streamed',
  raisedSoilCells: { gx: number; gz: number }[] = []) {
  const seed = 'wizard-realms', root = createFreshPublicV42Root(seed), state = root.head.state
  const support = owner === 'greenway' ? publicV17StarterSupportAt({ seed,
    profile: state.generationProfile,
    route: state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
    built: false, greenwayWorks: root.head.greenwayWorks }, point)
    : resolvePublicV23Surface(state, point, root.head.regionalWorks.builtLadderIds)
  if (!support) throw Error(`No support at ${point.x},${point.z}`)
  const discoveryMask = encodeDiscoveredTileIds([...new Set([
    ...decodeDiscoveredTileIds(state.discoveryMask), ...nearbyWorldTileIds(point, 24),
  ])].sort())
  return createPublicV42ControllerRuntime({ ...root, head: { ...root.head, raisedSoilCells,
    state: { ...state, movementOwner: owner, discoveryMask,
      player: { ...state.player, position: { ...point, y: support.floorY } } } } },
  async () => ({ ok: false, reason: 'not-called' }))
}

/** A checked V40 crossing, reused as a valid Hall-side source for view projection. */
async function crossedHallRoot(nearHall = false) {
  const base = createFreshPublicV36Root('wizard-realms')
  const bridge = waystationRiverSite('wizard-realms')!
  const hall = ironHallSite(createFreshPublicV42Root('wizard-realms').head)!
  const quartermaster = ironHallQuartermasterSite(createFreshPublicV42Root('wizard-realms').head)!
  const floor = resolvePublicV23Surface(base.head.state, bridge.exit, [])!.floorY
  const ids = [...new Set([...decodeDiscoveredTileIds(base.head.state.discoveryMask),
    ...bridge.footprintTileIds, hall.alcove.id, hall.ward.id, hall.door.id,
    quartermaster.id])].sort()
  const state = { ...base.head.state, movementOwner: 'streamed' as const,
    discoveryMask: encodeDiscoveredTileIds(ids), player: { ...base.head.state.player,
      position: { ...bridge.exit, y: floor } } }
  const genesis = { ...base.lineage.genesis, state, riverBridgeIds: [bridge.id] }
  const old = { lineage: { origin: 'v35-migration' as const,
    rulesProfile: 'old-marker/v1' as const, seed: 'wizard-realms',
    sourceRevision: 0, genesis }, previous: null,
  head: { ...genesis, markerClaimReward: null, schemaVersion: PUBLIC_V36_SCHEMA,
    saveRevision: 0, witness: null } }
  const root = createPublicV40Root(createPublicV39Root(
    createPublicV38Root(createPublicV37Root(old))))
  const store = createAtomicV40Store(new IDBFactory())
  const missing = await store.readChecked()
  if (missing.status !== 'missing') throw Error('Unexpected V40 target')
  expect(await store.commit(missing.proof, root)).toBe('committed')
  const crossed = await commitPublicV40(locks, store, 0, root.lineage,
    { kind: 'waystation-cross/v1' })
  expect(crossed.ok).toBe(true)
  if (!crossed.ok) throw Error(crossed.reason)
  if (nearHall) {
    const frames = Array.from({ length: 16 }, () => ({ intents: [{ type: 'move' as const,
      delta: { x: 0, z: 0.16 } }], walkRequested: true }))
    expect((await commitPublicV40(locks, store, 1, crossed.value.lineage,
      { kind: 'frame-batch/v1', frames })).ok).toBe(true)
  }
  const checked = await store.readChecked()
  if (checked.status !== 'valid') throw Error('V40 crossing failed checked reload')
  return createPublicV42Root(createPublicV41Root(checked.root))
}

describe('V42 controller, Iron Hall view and entry integration', () => {
  it('names the checked river and cliff barriers without moving the player', () => {
    const riverSite = resolvePublicV28RiverBridge('wizard-realms',
      'works6:river-bridge:-11')!
    const river = movementAt({ x: riverSite.from.x, z: riverSite.from.z + 1.95 })
    const bank = river.preview().state.player.position
    expect(river.advanceFrame([{ type: 'move', delta: { x: 0, z: 0.1 } }], false)
      .rejections).toEqual([expect.objectContaining({ code: 'terrain_missing',
        message: expect.stringMatching(/river blocks this step/i) })])
    expect(river.preview().state.player.position).toEqual(bank)

    const cliff = movementAt({ x: -24.9, z: -5.92 }, 'greenway')
    const foot = cliff.preview().state.player.position
    expect(cliff.advanceFrame([{ type: 'move', delta: { x: 0, z: -0.16 } }], false)
      .rejections).toEqual([expect.objectContaining({ code: 'terrain_missing',
        message: expect.stringMatching(/cliff needs a ladder/i) })])
    expect(cliff.preview().state.player.position).toEqual(foot)
  })

  it('prioritizes the physical world edge and still accepts an Iron Hall ground step', () => {
    const edge = movementAt({ x: 1021.95, z: 0 })
    const before = edge.preview().state.player.position
    expect(edge.advanceFrame([{ type: 'move', delta: { x: 0.1, z: 0 } }], false)
      .rejections).toEqual([expect.objectContaining({ code: 'terrain_missing',
        message: 'You reached the edge of this world. Turn back and explore another direction.' })])
    expect(edge.preview().state.player.position).toEqual(before)

    const hall = movementAt({ x: 80, z: 28 })
    expect(hall.advanceFrame([{ type: 'move', delta: { x: 0.16, z: 0 } }], false)
      .rejections).toEqual([])
    expect(hall.preview().state.player.position.x).toBeCloseTo(80.16)
  })

  it('keeps a V42-only raised-soil rejection generic when V28 accepts the step', () => {
    const runtime = movementAt({ x: 13.95, z: 4 }, 'greenway', [{ gx: 4, gz: 1 }])
    const intents = [{ type: 'move' as const, delta: { x: 0.1, z: 0 } }]
    expect(replayPublicV28FramesWithEvents(runtime.preview(),
      [{ intents, walkRequested: false }], true)).not.toBeNull()
    const before = runtime.preview().state.player.position
    expect(runtime.advanceFrame(intents, false).rejections).toEqual([
      expect.objectContaining({ code: 'terrain_missing',
        message: 'This move cannot be replayed safely.' }),
    ])
    expect(runtime.preview().state.player.position).toEqual(before)
  })

  it('splits opt-in V42 projection timing across V26-V36 and V37-V42', () => {
    const root = createFreshPublicV42Root('wizard-realms'), factory = new IDBFactory()
    vi.stubGlobal('window', { location: { hostname: 'localhost', search: '?inputTrace=1' } })
    try {
      renderToStaticMarkup(createElement(PublicV23Controller, { version: 'v42',
        start: { head: root.head, lineage: root.lineage }, locks,
        store: createAtomicV42Store(factory), v41Store: createAtomicV41Store(factory) }))
      const records = (JSON.parse(probe.trace!.json()) as { records: { event: string;
        data: Record<string, unknown> }[] }).records
      const render = records.find((record) => record.event === 'controller.render')!.data
      for (const key of ['v26ToV36ProjectionMs', 'v37ToV42ProjectionMs']) {
        expect(typeof render[key]).toBe('number')
        expect(Number.isFinite(render[key])).toBe(true)
        expect(render[key]).toBeGreaterThanOrEqual(0)
      }
      const chapterParts = ['v37ProjectionMs', 'v38ProjectionMs', 'v39ProjectionMs',
        'v40ProjectionMs', 'v41V42ProjectionMs']
      for (const key of chapterParts) {
        expect(Number.isFinite(render[key])).toBe(true)
        expect(render[key]).toBeGreaterThanOrEqual(0)
      }
      expect(chapterParts.reduce((sum, key) => sum + (render[key] as number), 0))
        .toBeCloseTo(render.v37ToV42ProjectionMs as number, 5)
      expect(render.projectionMs).toBeGreaterThanOrEqual(
        (render.v26ToV36ProjectionMs as number) + (render.v37ToV42ProjectionMs as number))
    } finally { vi.unstubAllGlobals() }
  })

  it('keeps witness-first invalid_value for forged batched kinds even with invalid progress', () => {
    const valid = progressOf(createFreshPublicV42Root('wizard-realms'))
    const invalid = { ...valid, state: { ...valid.state, tick: -1 } }
    const combatKinds = ['forged/v1', 'ironhall-study/v1'] as unknown as Parameters<
      typeof previewPublicV41CombatActions>[1]
    const rewardKinds = ['forged/v1', 'ironhall-claim/v1'] as unknown as Parameters<
      typeof previewPublicV42RewardActions>[1]
    for (const progress of [valid, invalid]) {
      expect(previewPublicV41CombatActions(progress, combatKinds)).toEqual(
        combatKinds.map((kind) => previewPublicV41CombatAction(progress, { kind })))
      expect(previewPublicV42RewardActions(progress, rewardKinds)).toEqual(
        rewardKinds.map((kind) => previewPublicV42RewardAction(progress, { kind })))
    }
  })

  it('saves a visible Waystation spade equip through V42 and rejects invalid shared intents', async () => {
    probe.actions.length = probe.outcomes.length = 0
    const base = createFreshPublicV36Root('wizard-realms')
    const site = waystationRiverSite('wizard-realms')!
    const floor = resolvePublicV23Surface(base.head.state, site.approach, [])!.floorY
    const ids = [...new Set([...decodeDiscoveredTileIds(base.head.state.discoveryMask),
      ...site.footprintTileIds])].sort()
    const state = { ...base.head.state, movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds(ids), player: { ...base.head.state.player,
        position: { ...site.approach, y: floor },
        equipment: { ...base.head.state.player.equipment,
          mainHand: 'woodcutters_axe' as const },
        inventory: [{ itemId: 'woodcutters_axe' as const, quantity: 1 },
          { itemId: 'field_spade' as const, quantity: 1 }] } }
    const genesis = { ...base.lineage.genesis, state }
    const source = { lineage: { origin: 'v35-migration' as const,
      rulesProfile: 'old-marker/v1' as const, seed: 'wizard-realms',
      sourceRevision: 0, genesis }, previous: null,
    head: { ...genesis, markerClaimReward: null, schemaVersion: PUBLIC_V36_SCHEMA,
      saveRevision: 0, witness: null } }
    const root = createPublicV42Root(createPublicV41Root(createPublicV40Root(
      createPublicV39Root(createPublicV38Root(createPublicV37Root(source))))))
    const factory = new IDBFactory(), store = createAtomicV42Store(factory)
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected V42 target')
    expect(await store.commit(missing.proof, root)).toBe('committed')
    renderToStaticMarkup(createElement(PublicV23Controller, { version: 'v42',
      start: { head: root.head, lineage: root.lineage }, locks, store,
      v41Store: createAtomicV41Store(factory) }))
    const projection = probe.projection!, spade = projection.backpack.stacks.find(
      (stack) => stack.itemId === 'field_spade')
    expect(projection.v40WaystationSite).toMatchObject({ revealed: true })
    expect(projection.equipment.mainHand?.itemId).toBe('woodcutters_axe')
    const equipButton = hud(projection).match(/<button[^>]*aria-label="Equip Field spade"[^>]*>/)?.[0]
    expect(equipButton).toBeDefined()
    expect(equipButton).not.toContain('disabled')
    probe.onIntent!({ type: 'equipment.equip', stackId: spade!.id, slot: 'feet' })
    probe.onIntent!({ type: 'equipment.equip', stackId: 'absent', slot: 'mainHand' })
    expect(probe.actions).toEqual([])
    probe.onIntent!({ type: 'equipment.equip', stackId: spade!.id, slot: 'mainHand' })
    await vi.waitFor(() => expect(probe.outcomes).toHaveLength(1))
    expect(probe.actions).toEqual([{ kind: 'mireglass-action/v1', action: {
      type: 'equip_item', itemId: 'field_spade' } }])
    expect(probe.outcomes[0]).toMatchObject({ status: 'saved' })
    expect(await store.readChecked()).toMatchObject({ status: 'valid', root: { head: {
      saveRevision: 1, witness: { kind: 'mireglass-action/v1', action: {
        type: 'equip_item', itemId: 'field_spade' } },
      state: { player: { equipment: { mainHand: 'field_spade' } } },
    } } })
  }, 120_000)

  it('routes normal V42 and inherited intents while only checked writes can change the save', async () => {
    probe.actions.length = probe.outcomes.length = 0
    const factory = new IDBFactory(), root = createFreshPublicV42Root('wizard-realms')
    const store = createAtomicV42Store(factory), missing = await store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected V42 target')
    expect(await store.commit(missing.proof, root)).toBe('committed')
    const html = renderToStaticMarkup(createElement(PublicV23Controller, { version: 'v42',
      start: { head: root.head, lineage: root.lineage }, locks, store,
      v41Store: createAtomicV41Store(factory) }))
    expect(html).toContain('data-public-version="v42"')
    expect(hud(probe.projection!)).toContain('Equip axe ▾')
    const axe = probe.projection!.backpack.stacks.find((stack) => stack.itemId === 'woodcutters_axe')!
    expect(hud({ ...probe.projection!, equipment: { ...probe.projection!.equipment,
      mainHand: axe } })).toContain('Bridge 0/8 ▾')
    expect(probe.projection?.v42IronHall).toMatchObject({ questClaimed: false,
      vestOwned: false, crestOutcome: 'unrolled' })
    const intents = ['v42.ironhall.claim', 'v42.ironhall.vest-equip',
      'v42.ironhall.vest-unequip', 'v42.ironhall.vest-repair', 'v42.ironhall.spar',
      'v41.ironhall.study', 'v40.waystation.cross'] as const
    for (const [index, type] of intents.entries()) {
      probe.onIntent!({ type })
      await vi.waitFor(() => expect(probe.outcomes).toHaveLength(index + 1))
    }
    expect(probe.actions).toEqual(['ironhall-claim/v1', 'ironhall-vest-equip/v1',
      'ironhall-vest-unequip/v1', 'ironhall-vest-repair/v1', 'ironhall-spar/v1',
      'ironhall-study/v1', 'waystation-cross/v1'].map((kind) => ({ kind })))
    expect(probe.outcomes).toEqual(Array(intents.length).fill(
      expect.objectContaining({ status: 'rejected' })))
    expect(await store.readChecked()).toMatchObject({ status: 'valid', root })
  }, 120_000)

  it('accepts inherited combat intents and the reward claim through checked V42 writes', async () => {
    probe.actions.length = probe.outcomes.length = 0
    const root = await crossedHallRoot(true), factory = new IDBFactory()
    const store = createAtomicV42Store(factory)
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected V42 target')
    expect(await store.commit(missing.proof, root)).toBe('committed')
    renderToStaticMarkup(createElement(PublicV23Controller, { version: 'v42',
      start: { head: root.head, lineage: root.lineage }, locks, store,
      v41Store: createAtomicV41Store(factory) }))
    const action = async (type: WizardViewIntent['type']) => {
      const index = probe.outcomes.length
      probe.onIntent!({ type } as WizardViewIntent)
      await vi.waitFor(() => expect(probe.outcomes).toHaveLength(index + 1))
      expect(probe.outcomes[index]).toMatchObject({ status: 'saved' })
    }
    await action('v41.ironhall.study')
    await action('v41.ironhall.engage')
    for (let bolt = 0; bolt < 3; bolt++) {
      if (bolt) expect(await probe.advance!(12)).toMatchObject({ status: 'saved' })
      await action('v41.ironhall.bolt')
    }
    const defeated = await store.readChecked()
    expect(defeated).toMatchObject({ status: 'valid', root: { head: {
      ironHall: { wardDefeated: true, wardHealth: 0 },
      ironHallReward: { crestOutcome: resolveIronHallCrestOutcome('wizard-realms') } } } })
    if (defeated.status !== 'valid') throw Error('V42 defeat failed checked reload')
    await action('v42.ironhall.claim')
    expect(probe.actions).toEqual(['ironhall-study/v1', 'ironhall-engage/v1',
      'ironhall-bolt/v1', 'ironhall-bolt/v1', 'ironhall-bolt/v1',
      'ironhall-claim/v1'].map((kind) => ({ kind })))
    expect(await store.readChecked()).toMatchObject({ status: 'valid', root: { head: {
      state: { player: { coins: defeated.root.head.state.player.coins + 60,
        xp: defeated.root.head.state.player.xp + 70 } },
      ironHall: { combatXp: defeated.root.head.ironHall.combatXp + 70 },
      ironHallReward: { questClaimed: true,
        vestOwned: true, vestEquipped: true, vestDurability: 12 } } } })
  }, 120_000)

  it('reveals quartermaster only after discovery and projects claim, vest, spar and repair', async () => {
    const root = await crossedHallRoot(), factory = new IDBFactory()
    renderToStaticMarkup(createElement(PublicV23Controller, { version: 'v42',
      start: { head: root.head, lineage: root.lineage }, locks,
      store: createAtomicV42Store(factory), v41Store: createAtomicV41Store(factory) }))
    const carrier = probe.projection!, quartermaster = ironHallQuartermasterSite(root.head)!
    const hall = ironHallSite(root.head)!
    const assertPreviewParity = (progress: PublicV42RewardProgress,
      view: WizardViewProjection) => {
      for (const [field, kind] of [
        ['study', 'ironhall-study/v1'], ['engage', 'ironhall-engage/v1'],
        ['bolt', 'ironhall-bolt/v1'], ['guard', 'ironhall-guard/v1'],
        ['rest', 'ironhall-rest/v1'],
      ] as const) expect(view.v41IronHall?.[field].rejection).toBe(
        previewPublicV41CombatAction(progress, { kind }).rejection)
      for (const [field, kind] of [
        ['claim', 'ironhall-claim/v1'], ['equip', 'ironhall-vest-equip/v1'],
        ['unequip', 'ironhall-vest-unequip/v1'], ['repair', 'ironhall-vest-repair/v1'],
        ['sparStart', 'ironhall-spar/v1'],
      ] as const) expect(view.v42IronHall?.[field].rejection).toBe(
        previewPublicV42RewardAction(progress, { kind }).rejection)
    }
    assertPreviewParity(progressOf(root), projectPublicV42IronHall(progressOf(root), carrier))
    const invalidProgress = { ...progressOf(root), state: { ...root.head.state, tick: -1 } }
    assertPreviewParity(invalidProgress, projectPublicV42IronHall(invalidProgress, carrier))
    const hidden = projectPublicV42IronHall({ ...progressOf(root), state: {
      ...root.head.state, discoveryMask: encodeDiscoveredTileIds([]) } }, carrier)
    expect(hidden.v42QuartermasterSite).toBeNull()
    expect(hud(hidden)).not.toContain('Claim at quartermaster')

    // This is a view fixture, not a forged save or an accepted checked action.
    const ready: PublicV42RewardProgress = { ...progressOf(root),
      ironHall: { ...root.head.ironHall, learnedBolt: true, wardDefeated: true,
        wardHealth: 0, phase: 'defeated' },
      ironHallReward: { ...root.head.ironHallReward,
        crestOutcome: resolveIronHallCrestOutcome('wizard-realms') },
      state: { ...root.head.state, movementOwner: 'streamed',
        discoveryMask: encodeDiscoveredTileIds(
          [...new Set([...decodeDiscoveredTileIds(root.head.state.discoveryMask),
            quartermaster.id, hall.alcove.id, hall.ward.id])].sort()),
        player: { ...root.head.state.player, position: { ...quartermaster.center } } } }
    const atQuartermaster = { ...carrier, player: { ...carrier.player,
      position: [quartermaster.center.x, quartermaster.center.y,
        quartermaster.center.z] as const } }
    const claim = projectPublicV42IronHall(ready, atQuartermaster)
    assertPreviewParity(ready, claim)
    expect(claim.v42QuartermasterSite).toMatchObject({ revealed: true,
      position: [quartermaster.center.x, quartermaster.center.y, quartermaster.center.z] })
    expect(claim.v42IronHall?.claim.rejection).toBeNull()
    const claimHud = hud(claim)
    expect(claimHud).toContain('<button type="button">Claim at quartermaster</button>')
    expect(claimHud).toContain('60 coins, 70 character XP, 70 Combat XP')
    expect(claimHud).toContain('10% on the first defeat, no pity')
    const remote = projectPublicV42IronHall({ ...ready, state: { ...ready.state,
      player: { ...ready.state.player, position: { ...hall.ward.center } } } },
    { ...atQuartermaster, player: { ...atQuartermaster.player,
      position: [hall.ward.center.x, hall.ward.center.y, hall.ward.center.z] as const } })
    expect(remote.v42IronHall?.claim.rejection).toBe('too_far')
    expect(hud(remote)).not.toContain('Claim at quartermaster')

    const claimed: PublicV42RewardProgress = { ...ready,
      ironHallReward: { ...ready.ironHallReward, questClaimed: true,
        vestOwned: true, vestEquipped: true, vestDurability: 11 },
      state: { ...ready.state, player: { ...ready.state.player, coins: 60, xp: 70 } },
      ironHall: { ...ready.ironHall, combatXp: 70 } }
    const vest = projectPublicV42IronHall(claimed, atQuartermaster)
    assertPreviewParity(claimed, vest)
    expect(vest.v42IronHall).toMatchObject({ vestEquipped: true, vestDurability: 11 })
    expect(vest.v42IronHall?.repair.rejection).toBeNull()
    expect(hud(vest)).toContain('11/12 durability')
    expect(hud(vest)).toContain('Repair Guard Vest · 18 coins')
    expect(hud(vest)).toContain('Remove Guard Vest')
    expect(hud(vest)).toContain('lower Iron Hall challenge')
    expect(hud(vest)).not.toContain('Claim at quartermaster')
    const unequipped = projectPublicV42IronHall({ ...claimed,
      ironHallReward: { ...claimed.ironHallReward, vestEquipped: false } }, atQuartermaster)
    expect(unequipped.v42IronHall?.equip.rejection).toBeNull()
    expect(hud(unequipped)).toContain('Wear Guard Vest')
    const depleted = projectPublicV42IronHall({ ...claimed,
      ironHallReward: { ...claimed.ironHallReward, vestEquipped: false,
        vestDurability: 0 } }, atQuartermaster)
    expect(depleted.v42IronHall?.equip.rejection).toBe('depleted')
    expect(hud(depleted)).toContain('0/12 durability')
    expect(hud(depleted)).toContain('Repair Guard Vest · 18 coins')
    const atWard = { ...claimed, state: { ...claimed.state, player: { ...claimed.state.player,
      position: { ...hall.ward.center } } } }
    const wardCarrier = { ...atQuartermaster, player: { ...atQuartermaster.player,
      position: [hall.ward.center.x, hall.ward.center.y, hall.ward.center.z] as const } }
    const spar = projectPublicV42IronHall(atWard, wardCarrier)
    expect(spar.v42IronHall?.sparStart.rejection).toBeNull()
    expect(hud(spar)).toContain('Start ward spar')
    const activeProgress = { ...atWard,
      ironHallReward: { ...atWard.ironHallReward, spar: { active: true,
        strikeAtTick: atWard.state.tick + 20, nextReadyTick: 0,
        strikesResolved: 0 } } }
    const active = projectPublicV42IronHall(activeProgress, wardCarrier)
    assertPreviewParity(activeProgress, active)
    expect(hud(active)).toContain('Practice slam in 20 ticks')
    expect(hud(active)).not.toContain('Start ward spar')
  })

  it('saves and resumes sustained turn plus forward movement without replay rejection', async () => {
    const factory = new IDBFactory(), root = createFreshPublicV42Root('wizard-realms')
    const store = createAtomicV42Store(factory), missing = await store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected V42 target')
    expect(await store.commit(missing.proof, root)).toBe('committed')
    const runtime = createPublicV42ControllerRuntime({ head: root.head, lineage: root.lineage },
      (revision, lineage, witness) => commitPublicV42(locks, store, revision, lineage, witness))
    const submitted: { intents: ReturnType<typeof publicV14MovementIntents>;
      walkRequested: boolean }[] = []
    for (let index = 0; index < 12; index++) {
      const yaw = runtime.preview().state.player.yaw
      const intents = publicV14MovementIntents(yaw, [1, 1], 0.16)
      expect(intents.map((intent) => intent.type)).toEqual(['look', 'move'])
      expect(runtime.advanceFrame(intents, true).rejections).toEqual([])
      submitted.push({ intents, walkRequested: true })
    }
    const player = runtime.preview().state.player
    expect(player.yaw).not.toBe(root.head.state.player.yaw)
    expect(player.position).not.toEqual(root.head.state.player.position)
    expect(runtime.status().pendingFrames).toBe(12)
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    const reopened = createAtomicV42Store(factory)
    const checked = await reopened.readChecked()
    expect(checked.status).toBe('valid')
    if (checked.status !== 'valid') throw Error('Turn and move did not persist as a checked V42 root')
    expect(checked.root.head.state.player).toMatchObject({ yaw: player.yaw,
      position: player.position })
    const resumed = await resumePublicV42(locks, reopened, 1, root.lineage)
    expect(resumed.ok).toBe(true)
    if (!resumed.ok) throw Error(resumed.reason)
    expect(resumed.value.head.witness).toEqual({ kind: 'frame-batch/v1', frames: submitted })
    const replayed = createPublicV42ControllerRuntime(resumed.value,
      (revision, lineage, witness) => commitPublicV42(locks, reopened, revision, lineage, witness))
    expect(replayed.preview().state.player).toMatchObject({ yaw: player.yaw,
      position: player.position })
    expect(replayed.advanceFrame(publicV14MovementIntents(player.yaw, [0, 1], 0.16), true)
      .rejections).toEqual([])
    const afterContinue = replayed.preview().state.player
    expect(afterContinue.yaw).toBe(player.yaw)
    expect(afterContinue.position.x).toBeCloseTo(player.position.x - Math.sin(player.yaw) * 0.16)
    expect(afterContinue.position.z).toBeCloseTo(player.position.z - Math.cos(player.yaw) * 0.16)
    expect(await replayed.save()).toMatchObject({ status: 'saved' })
    expect(await reopened.readChecked()).toMatchObject({ status: 'valid', root: { head: {
      state: { player: { yaw: player.yaw, position: afterContinue.position } } } } })
  }, 120_000)

  it('offers checked V41 copy, independent fresh start, resume and older preview links', async () => {
    const factory = new IDBFactory(), source = createFreshPublicV41Root('wizard-realms')
    const v41Store = createAtomicV41Store(factory), store = createAtomicV42Store(factory)
    const missing = await v41Store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected V41 source')
    expect(await v41Store.commit(missing.proof, source)).toBe('committed')
    const bindings: PublicV42EntryBindings = { locks, store, v41Store }
    const decision = await inspectPublicV42Entry(bindings)
    expect(decision).toEqual({ status: 'copy-available', sourceRevision: 0 })
    const html = renderToStaticMarkup(createElement(PublicV42EntryView, {
      entry: decision, busyChoice: null, onChoose: vi.fn(), onRetry: vi.fn(), actionError: null }))
    expect(html).toContain('Copy V41 adventure into V42')
    expect(html).toContain('New Game')
    expect(html).toContain('href="?publicWorld=v41"')
    expect(renderToStaticMarkup(createElement(PublicV41EntryView, {
      entry: { status: 'fresh-available', sourceWarning: null }, busyChoice: null,
      onChoose: vi.fn(), onRetry: vi.fn(), actionError: null })))
      .toContain('href="?publicWorld=v40"')
    const copied = await choosePublicV42Entry(decision, 'copy', bindings)
    expect(copied).toMatchObject({ ok: true, value: { lineage: {
      origin: 'v41-migration', sourceRevision: 0 } } })
    expect(await v41Store.readChecked()).toMatchObject({ status: 'valid', root: source })
    const resume = await inspectPublicV42Entry(bindings)
    expect(resume.status).toBe('resume')
    expect(await choosePublicV42Entry(resume, 'resume', bindings)).toEqual(copied)
    expect(await choosePublicV42Entry(resume, 'create', bindings))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    expect(renderToStaticMarkup(createElement(PublicV42EntryView, { entry: resume,
      busyChoice: null, onChoose: vi.fn(), onRetry: vi.fn(), actionError: null })))
      .toContain('Continue V42 adventure')
    const fresh = await choosePublicV42Entry(decision, 'create', { ...bindings,
      store: createAtomicV42Store(new IDBFactory()) })
    expect(fresh).toMatchObject({ ok: true, value: { lineage: { origin: 'fresh' } } })
    expect(await v41Store.readChecked()).toMatchObject({ status: 'valid', root: source })
  }, 120_000)
})
