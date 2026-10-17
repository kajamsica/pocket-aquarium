import { IDBFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createPublicV23ControllerRuntime, createPublicV24ControllerRuntime } from './PublicV23ControllerRuntime'
import { PublicV23Controller, publicV23SavedWorkMessage, publicV43SedgehornCareSavedMessage,
  publicV23WayfinderGlowSavedMessage,
  publicV23WorkRouteForView } from './PublicV23Controller'
import { choosePublicV23Entry, inspectPublicV23Entry } from './PublicV23Entry'
import { publicV23ReticleAimZ, publicWorldV23ViewProjection } from './PublicV23WorldView'
import { createPublicV17ContinuousSession } from './domain/publicWorldV17ContinuousSession'
import { createFreshPublicV17Head } from './domain/publicWorldV17Snapshot'
import { createAtomicV17Store } from './domain/atomicV17Database'
import { createAtomicV23Store } from './domain/atomicV23Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { commitPublicV17Snapshot, inspectPublicV17, startFreshPublicV17 } from './domain/publicWorldV17Flow'
import { encodePublicV17Head, PUBLIC_V17_DATABASE_NAME } from './domain/publicWorldV17Snapshot'
import { commitPublicV23, inspectPublicV23, resumePublicV23 } from './domain/publicWorldV23Flow'
import { createPublicV23Root } from './domain/publicWorldV23Snapshot'
import { createPublicV24Root } from './domain/publicWorldV24Snapshot'
import { mireglassHerbPatches } from './domain/mireglassHerbPatches'
import { decodePublicV23Progress } from './domain/publicWorldV23Snapshot'
import { applyPublicV23Witness } from './domain/publicWorldV23Transitions'
import { resolvePublicV23Site } from './domain/publicWorldV23Sites'
import { publicV23PlacementId } from './domain/publicWorldV23Sites'
import { discoveredTileIdsInActiveWindow } from './domain/publicV13DiscoveryWindow'
import { savedWorkKeyboardIntent } from './view/WizardSurface'
import { resolvePublicV14Surface } from './domain/publicWorldV14Terrain'
import { createPublicV23StreamTerrain } from './domain/publicWorldV14Terrain'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { resolveTerrainWorkSite } from './domain/terrainWorks'
import type { PublicV23Progress } from './domain/publicWorldV23Snapshot'

const seed = 'greenway-alpha'
const id = (q: number) => `works5:ladder:mireglass-slate:W:-103:${q}`
const lock = { request: async <T,>(_name: string,
  _options: { mode: 'exclusive' }, body: () => T | Promise<T>) => body() }

async function reached(q: number) {
  const factory = new IDBFactory()
  const sourceStore = createAtomicV17Store(factory), store = createAtomicV23Store(factory)
  const old = await startFreshPublicV17(lock, sourceStore, seed)
  if (!old.ok) throw new Error(old.reason)
  const site = resolvePublicV23Site(seed, id(q))!
  const state = old.value.state
  const fixture = { ...state, movementOwner: 'streamed' as const,
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(state.discoveryMask), ...site.footprintTileIds])].sort()),
    player: { ...state.player, position: { ...site.from }, inventory: [
      ...state.player.inventory, { itemId: 'logs' as const, quantity: 8 }] } }
  const db = await new Promise<IDBDatabase>((resolve) => {
    const request = factory.open(PUBLIC_V17_DATABASE_NAME, 1)
    request.onsuccess = () => resolve(request.result)
  })
  await new Promise<void>((resolve) => {
    const transaction = db.transaction('records', 'readwrite')
    for (const [slot, revision] of [['previous', 1], ['head', 2]] as const)
      transaction.objectStore('records').put({ saveRevision: revision,
        value: encodePublicV17Head({ state: fixture,
          greenwayWorks: old.value.greenwayWorks }, revision, old.value.lineage) }, slot)
    transaction.oncomplete = () => resolve()
  })
  db.close()
  const bindings = { locks: lock, store, sourceStore }
  const entry = await inspectPublicV23Entry(bindings)
  if (entry.status !== 'migration-available') throw new Error(`Unexpected ${entry.status}`)
  const promoted = await choosePublicV23Entry(entry, 'migrate', bindings, seed)
  if (!promoted.ok) throw new Error(promoted.reason)
  const runtime = createPublicV23ControllerRuntime(promoted.value,
    (revision, lineage, witness) => commitPublicV23(lock, store, sourceStore,
      revision, lineage, witness))
  return { factory, bindings, runtime, promoted: promoted.value }
}

function readyLegacyWork(id: string): PublicV23Progress {
  const root = createPublicV23Root(seed), work = resolveTerrainWorkSite(seed, id)
  if (!work) throw new Error('Missing legacy work')
  const points = work.kind === 'dig'
    ? [{ x: work.center.x + 2.5, z: work.center.z },
      { x: work.center.x - 2.5, z: work.center.z },
      { x: work.center.x, z: work.center.z + 2.5 },
      { x: work.center.x, z: work.center.z - 2.5 }]
    : [{ x: work.from.x, z: work.from.z }]
  for (const point of points) {
    const floor = resolvePublicV14Surface(root.head.state, point)
    if (!floor) continue
    const state = { ...root.head.state, tick: 1, movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(root.head.state.discoveryMask), floor.tileId,
        ...work.footprintTileIds])].sort()),
      player: { ...root.head.state.player,
        position: { ...point, y: floor.floorY }, backpackCapacity: 30,
        inventory: [...root.head.state.player.inventory.filter((stack) =>
          stack.itemId !== 'logs' && stack.itemId !== 'field_spade'),
        { itemId: 'logs' as const, quantity: 12 },
        { itemId: 'field_spade' as const, quantity: 1 }],
        equipment: { ...root.head.state.player.equipment, mainHand: 'field_spade' as const } } }
    const progress = decodePublicV23Progress({ state, greenwayWorks: root.head.greenwayWorks,
      regionalWorks: root.head.regionalWorks }, seed)
    if (progress) return progress
  }
  throw new Error('No valid legacy work stance')
}

describe('V23 controller journey', () => {
  it('reports a saved sedgehorn care visit without suggesting a current ride', () => {
    expect(publicV43SedgehornCareSavedMessage).toBe(
      'Sedgehorn care visit saved. The sedgehorn cannot be ridden in this preview.')
    expect(publicV43SedgehornCareSavedMessage).not.toContain('yet')
  })

  it.each([
    ['creek', 5.9, 0.16, 'Build a Greenway bridge lane to cross the creek.'],
    ['cliff', -5.9, -0.16, 'Build a ladder at this cliff face.'],
  ] as const)('passes the exact %s rejection through V23 and V24 local previews',
    (_name, z, dz, message) => {
      const root = createPublicV23Root(seed)
      const support = publicV17StarterSupportAt({ seed,
        profile: root.head.state.generationProfile,
        route: root.head.state.greenway.routes[0] ?? null,
        built: false, greenwayWorks: root.head.greenwayWorks }, { x: 0, z })
      if (!support) throw new Error('Missing Greenway fixture support')
      const v24 = createPublicV24Root(root)
      root.head.state.player.position = { x: 0, y: support.floorY, z }
      v24.head.state.player.position = { x: 0, y: support.floorY, z }
      for (const runtime of [
        createPublicV23ControllerRuntime(root, async () => ({ ok: false, reason: 'not-called' })),
        createPublicV24ControllerRuntime(v24, async () =>
          ({ ok: false, reason: 'not-called' })),
      ]) {
        const move = [{ type: 'move' as const, delta: { x: 0, z: dz } }]
        const before = runtime.preview()
        expect(runtime.advanceFrame(move, true).rejections).toEqual([expect.objectContaining({
          code: 'locked_area', message,
        })])
        expect(runtime.preview()).toEqual(before)
        expect(runtime.status().pendingFrames).toBe(0)
      }
    })

  it('passes a streamed movement rejection but not an invalid frame diagnostic', () => {
    const root = createPublicV23Root(seed), ready = readyLegacyWork('works1:bridge:-102:92:z')
    const start = { ...root, head: { ...root.head, ...ready, saveRevision: 1,
      witness: { kind: 'checkpoint' as const } } }
    const move = [{ type: 'move' as const, delta: { x: 0, z: 0.16 } }]
    const source = createPublicV23StreamTerrain(ready.state, ready.regionalWorks.builtLadderIds)
    const runtime = createPublicV23ControllerRuntime(start, async () =>
      ({ ok: false, reason: 'not-called' }))
    let blocked = false
    for (let frame = 0; frame < 60; frame++) {
      const sourceResult = source.advance(move, { atomicOnRejection: true, nearbyDiscovery: true })
      const localResult = runtime.advanceFrame(move, true)
      expect(localResult.rejections).toEqual(sourceResult.rejections.map((rejection) => ({
        ...rejection, message: `Streamed movement was rejected: ${rejection.code}.`,
      })))
      if (sourceResult.rejections.length) { blocked = true; break }
    }
    expect(blocked).toBe(true)
    const pending = runtime.status().pendingFrames
    expect(runtime.advanceFrame([{ type: 'move', delta: { x: 100, z: 0 } }], true)
      .rejections).toEqual([expect.objectContaining({
        code: 'invalid_frame', message: 'Invalid replayable frame.',
      })])
    expect(runtime.status().pendingFrames).toBe(pending)
  })

  it('retains the current rejection after replaying earlier pending frames', () => {
    const root = createPublicV23Root(seed), z = 5.74
    const support = publicV17StarterSupportAt({ seed,
      profile: root.head.state.generationProfile,
      route: root.head.state.greenway.routes[0] ?? null,
      built: false, greenwayWorks: root.head.greenwayWorks }, { x: 0, z })
    if (!support) throw new Error('Missing creek approach')
    root.head.state.player.position = { x: 0, y: support.floorY, z }
    const runtime = createPublicV23ControllerRuntime(root, async () =>
      ({ ok: false, reason: 'not-called' }))
    const move = [{ type: 'move' as const, delta: { x: 0, z: 0.16 } }]
    expect(runtime.advanceFrame(move, true).rejections).toEqual([])
    expect(runtime.status().pendingFrames).toBe(1)
    expect(runtime.advanceFrame(move, true).rejections).toEqual([expect.objectContaining({
      code: 'locked_area', message: 'Build a Greenway bridge lane to cross the creek.',
    })])
    expect(runtime.status().pendingFrames).toBe(1)
    expect(runtime.preview().state.player.position.z).toBeCloseTo(5.9)
  })

  it('omits only grounded inert idle time and resumes the real clock during a jump', () => {
    const root = createPublicV23Root(seed)
    const runtime = createPublicV23ControllerRuntime(root, async () =>
      ({ ok: false, reason: 'not-called' }))
    expect(runtime.idleFrameNeeded()).toBe(false)
    expect(runtime.status().pendingFrames).toBe(0)
    expect(runtime.advanceFrame([{ type: 'jump' }], false).rejections).toEqual([])
    expect(runtime.idleFrameNeeded()).toBe(true)
    expect(runtime.advanceFrame([], false).rejections).toEqual([])
    expect(runtime.status().pendingFrames).toBe(2)
    expect(runtime.preview().state.tick).toBe(2)

    const unsupported = createPublicV23Root(seed)
    unsupported.head.state.player.position.y += 1
    expect(createPublicV23ControllerRuntime(unsupported, async () =>
      ({ ok: false, reason: 'not-called' })).idleFrameNeeded()).toBe(true)
  })

  it('keeps market, herb, quarry, and Windward clocks live in the real V23/V24 runtime', () => {
    const needed = (state: ReturnType<typeof createPublicV23Root>['head']['state']) => {
      const root = createPublicV23Root(seed)
      const runtime = createPublicV23ControllerRuntime({ ...root,
        head: { ...root.head, state } }, async () => ({ ok: false, reason: 'not-called' }))
      expect(runtime.idleFrameNeeded()).toBe(true)
      expect(runtime.advanceFrame([], false).rejections).toEqual([])
      expect(runtime.status().pendingFrames).toBe(1)
      return runtime
    }
    const base = createPublicV23Root(seed).head.state
    const market = needed({ ...base, tick: 599, player: { ...base.player, tradeSlots: [
      { ...base.player.tradeSlots[0], itemId: 'logs', quantity: 1, unitPrice: 1 },
      base.player.tradeSlots[1], base.player.tradeSlots[2], base.player.tradeSlots[3],
    ] } })
    expect(market.preview().state.player.tradeSlots[0].itemId).toBeNull()
    expect(market.preview().state.player.coins).toBe(base.player.coins + 1)
    const quarry = needed({ ...base, tick: 3099, highland: { ...base.highland, landmarkDiscovered: true,
      stoneNodes: base.highland.stoneNodes.map((node, index) =>
        index === 0 ? { ...node, readyAtTick: 3100 } : node) } })
    expect(quarry.idleFrameNeeded()).toBe(false)
    const wind = needed({ ...base, tick: 1899, highland: { ...base.highland, landmarkDiscovered: true },
      windstep: { learned: true, activeUntilTick: 1300,
        nextCastTick: 1900, practicedRouteIndices: [] } })
    expect(wind.idleFrameNeeded()).toBe(false)

    const source = createPublicV24Root(createPublicV23Root(seed))
    const v24 = { ...source, head: { ...source.head, state: { ...source.head.state,
      tick: 5999,
      mireglass: { ...source.head.state.mireglass,
        herbHarvestCycles: [{ patchId: mireglassHerbPatches(seed)[0].id, cycle: 0 }] } } } }
    const herb = createPublicV24ControllerRuntime(v24, async () =>
      ({ ok: false, reason: 'not-called' }))
    expect(herb.idleFrameNeeded()).toBe(true)
    expect(herb.advanceFrame([], false).rejections).toEqual([])
    expect(herb.status().pendingFrames).toBe(1)
    expect(herb.idleFrameNeeded()).toBe(false)
  })

  it('mounts the isolated playable route with west trail guidance', () => {
    const factory = new IDBFactory(), start = createPublicV23Root(seed)
    const markup = renderToStaticMarkup(createElement(PublicV23Controller, {
      start, locks: lock, store: createAtomicV23Store(factory),
      sourceStore: createAtomicV17Store(factory) }))
    expect(markup).toContain('data-public-v23="true"')
    expect(markup).not.toContain('class="v23-guide"')
  })

  it('replays airborne previews from the grounded head and preserves multi-frame Greenway motion', async () => {
    const root = createPublicV23Root(seed)
    const runtime = createPublicV23ControllerRuntime(root, async () =>
      ({ ok: false, reason: 'not-called' }))
    expect(() => publicWorldV23ViewProjection(runtime.preview(), runtime.view(), [],
      null, null, false, { kind: 'bridge', bodyYaw: 0, aimX: 0, aimZ: null,
        modeActive: false, actionsEnabled: true })).not.toThrow()
    const legacy = createPublicV17ContinuousSession({ state: root.head.state,
      greenwayWorks: root.head.greenwayWorks, saveRevision: 0,
      lineage: createFreshPublicV17Head(seed).lineage })
    const frames = [
      { intents: [{ type: 'look' as const, yawDelta: 0.12, pitchDelta: 0 }], walkRequested: false },
      { intents: [{ type: 'move' as const, delta: { x: 0.08, z: -0.12 } }], walkRequested: true },
      { intents: [], walkRequested: false },
    ]
    for (const frame of frames) {
      expect(runtime.advanceFrame(frame.intents, frame.walkRequested).rejections).toEqual([])
      expect(legacy.advanceFrame(frame.intents, { walkRequested: frame.walkRequested }).rejections).toEqual([])
    }
    expect(runtime.preview()).toEqual({ ...legacy.previewSnapshot(), regionalWorks: { builtLadderIds: [] } })
    const jump = runtime.advanceFrame([{ type: 'jump' }], false)
    expect(jump.rejections).toEqual([])
    const firstY = runtime.preview().state.player.position.y
    expect(runtime.preview().state.player.verticalVelocity).toBeGreaterThan(0)
    expect(runtime.advanceFrame([], false).rejections).toEqual([])
    expect(runtime.preview().state.player.position.y).toBeGreaterThan(firstY)
    expect((await runtime.save()).status).toBe('deferred-airborne')
  })

  it('offers fresh only without a V17 source and resumes the chosen V23 head', async () => {
    const factory = new IDBFactory(), bindings = { locks: lock,
      store: createAtomicV23Store(factory), sourceStore: createAtomicV17Store(factory) }
    const entry = await inspectPublicV23Entry(bindings)
    expect(entry).toEqual({ status: 'fresh-available' })
    const chosen = await choosePublicV23Entry(entry, 'fresh', bindings, seed)
    if (!chosen.ok) throw new Error(chosen.reason)
    expect(await inspectPublicV23Entry(bindings)).toEqual({ status: 'resume', start: chosen.value })
    expect(await choosePublicV23Entry(entry, 'fresh', bindings, 'different-seed'))
      .toEqual({ ok: false, reason: 'target-conflict' })
  })

  it('feeds one fully discovered canonical west aim to Works, map, and scene', async () => {
    const { runtime } = await reached(4306)
    expect(publicV23ReticleAimZ({ x: -409, z: 430.6 }, Math.PI / 2)).toBeCloseTo(430.6)
    expect(publicV23ReticleAimZ({ x: -409, z: 430.6 }, 0)).toBeNull()
    const project = () => publicWorldV23ViewProjection(runtime.preview(), runtime.view(), [],
      null, null, false, { kind: 'ladder', bodyYaw: Math.PI / 2, aimX: null,
        aimZ: 430.6, modeActive: true, actionsEnabled: true })
    const before = project()
    expect(before.savedTerrainWorks?.preview?.selected?.site.id).toBe(id(4306))
    expect(before.savedTerrainWorks?.preview?.selected?.rejection).toBeNull()
    expect(before.regionalLadders?.preview?.site.id).toBe(id(4306))
    expect(publicV23WorkRouteForView(before, id(4306), 'streamed', seed)).toBe('regional-work')
    expect(publicV23WorkRouteForView(before, id(4334), 'streamed', seed)).toBeNull()
    expect(savedWorkKeyboardIntent('KeyF', before.savedTerrainWorks))
      .toEqual({ type: 'saved-work.confirm', id: id(4306) })
    expect(publicV23PlacementId(publicV23ReticleAimZ({ x: -409, z: 430.6 }, Math.PI / 2)!))
      .toBe(publicV23PlacementId(430.6))
    expect(before.visualWorld?.discoveredTileIds.every((tile) =>
      runtime.view().activeKnownTileIds.includes(tile))).toBe(true)
    expect((await runtime.action({ kind: 'regional-work', id: id(4306) })).status).toBe('saved')
    const built = project()
    expect(built.regionalLadders?.builtSites.map((site) => site.id)).toEqual([id(4306)])
    expect(built.regionalLadders?.preview?.rejection).toBe('already_done')
    expect(publicV23WorkRouteForView(built, id(4306), 'streamed', seed)).toBeNull()
  })

  it.each([
    ['works1:bridge:-102:92:z', 'Build', 8, 0, 80],
    ['tile--64-76', 'Dig', 0, 1, 30],
  ] as const)('reports checked V23 %s costs and rewards', async (id, label, logs, stone, xp) => {
    const root = createPublicV23Root(seed), before = readyLegacyWork(id)
    let server = { lineage: root.lineage, head: { ...root.head, ...before,
      saveRevision: 1, witness: { kind: 'checkpoint' as const } } }
    const runtime = createPublicV23ControllerRuntime(server, async (revision, lineage, witness) => {
      expect(revision).toBe(server.head.saveRevision)
      const applied = applyPublicV23Witness({ state: server.head.state,
        greenwayWorks: server.head.greenwayWorks,
        regionalWorks: server.head.regionalWorks }, witness)
      if ('rejection' in applied) return { ok: false as const, reason: applied.rejection }
      server = { lineage, head: { ...server.head, ...applied.progress,
        saveRevision: revision + 1, witness: { kind: 'checkpoint' as const } } }
      return { ok: true as const, value: { ...server, head: { ...server.head, witness } } }
    })
    const result = await runtime.action({ kind: 'legacy-work', id })
    expect(result).toMatchObject({ status: 'saved', workEvent: {
      id, logsSpent: logs, stoneGained: stone, xp } })
    if (result.status !== 'saved' || !result.workEvent) throw new Error('Missing work receipt')
    expect(publicV23SavedWorkMessage(result.workEvent)).toBe(label === 'Dig'
      ? `Dig saved: ${id}. 1 stone gained, 30 XP.`
      : `Build saved: ${id}. 8 logs spent, 80 XP.`)
  })

  it('reports only the checked Wayfinder Glow reveal count and points to the map', () => {
    const message = publicV23WayfinderGlowSavedMessage([
      { type: 'spell_cast', spellId: 'wayfinder_glow', revealedTileIds: ['tile-1', 'tile-2'] },
      { type: 'skill_xp_gained' },
    ])
    expect(message).toBe('Wayfinder Glow charted 2 new tiles. Open Map / routes to inspect the revealed ground and any newly visible works sites.')
    expect(publicV23WayfinderGlowSavedMessage([{ type: 'skill_xp_gained' }])).toBeNull()
  })

  it('gives a fog-edge cue when a checked Wayfinder Glow cast reveals no new tiles', () => {
    expect(publicV23WayfinderGlowSavedMessage([
      { type: 'spell_cast', spellId: 'wayfinder_glow', revealedTileIds: [] },
    ])).toBe('Wayfinder Glow found no new terrain nearby. Move toward the fog and cast again.')
  })

  it('does not expose a regional ghost or lower-foot coordinate for a partial discovery', async () => {
    const { runtime } = await reached(4306)
    const before = runtime.preview(), site = resolvePublicV23Site(seed, id(4306))!
    const hidden = { ...before, state: { ...before.state,
      discoveryMask: encodeDiscoveredTileIds(decodeDiscoveredTileIds(
        before.state.discoveryMask).filter((tile) => tile !== site.footprintTileIds.at(-1))) } }
    const active = { ...runtime.view(), activeKnownTileIds: discoveredTileIdsInActiveWindow(
      hidden.state.discoveryMask, hidden.state.player.position) }
    const view = publicWorldV23ViewProjection(hidden, active, [], null, null, false,
      { kind: 'ladder', bodyYaw: Math.PI / 2, aimX: null,
        aimZ: 430.6, modeActive: true, actionsEnabled: true })
    expect(view.regionalLadders?.preview).toBeNull()
    expect(view.savedTerrainWorks?.preview?.selected).toBeNull()
    expect(JSON.stringify(view.regionalLadders)).not.toContain(id(4306))
  })

  it('keeps V22 gait policy and treats voluntary Walk as unsaved UI state', () => {
    const root = createPublicV23Root(seed), equippedSource = structuredClone({
      state: root.head.state, greenwayWorks: root.head.greenwayWorks,
      regionalWorks: root.head.regionalWorks })
    const bareRuntime = createPublicV23ControllerRuntime(root, async () =>
      ({ ok: false, reason: 'not-called' }))
    const work = { kind: 'bridge' as const, bodyYaw: 0, aimX: null, aimZ: null,
      modeActive: false, actionsEnabled: true }
    expect(publicWorldV23ViewProjection(bareRuntime.preview(), bareRuntime.view(), [],
      null, null, false, work).gait?.pace).toBe('walk')
    equippedSource.state.player.inventory.push({ itemId: 'leather_boots', quantity: 1 })
    const action = applyPublicV23Witness(equippedSource,
      { kind: 'legacy-action', intent: { type: 'equip_item',
        itemId: 'leather_boots', slot: 'feet' } })
    if (!('progress' in action)) throw new Error(action.rejection)
    const worn = action.progress
    const resumed = createPublicV23ControllerRuntime({ lineage: root.lineage, head: {
      ...root.head, ...worn, saveRevision: 1, witness: { kind: 'legacy-action',
        intent: { type: 'equip_item', itemId: 'leather_boots', slot: 'feet' } } } },
    async () => ({ ok: false, reason: 'not-called' }))
    const pace = (walk: boolean) => publicWorldV23ViewProjection(resumed.preview(),
      resumed.view(), [], null, null, walk, work).gait?.pace
    expect(pace(false)).toBe('run')
    expect(pace(true)).toBe('walk')
    expect(pace(false)).toBe('run')
    expect(resumed.committed().head.state.player.equipment.feet).toBe('leather_boots')
  })

  it('migrates, builds q4306, climbs and descends, then reloads the same checked position', async () => {
    const { factory, bindings, runtime, promoted } = await reached(4306)
    const built = await runtime.action({ kind: 'regional-work', id: id(4306) })
    expect(built).toMatchObject({ status: 'saved', workEvent: { logsSpent: 4, xp: 60 } })
    if (built.status !== 'saved' || !built.workEvent) throw new Error('Missing ladder receipt')
    expect(publicV23SavedWorkMessage(built.workEvent)).toBe(
      `Build saved: ${id(4306)}. 4 logs spent, 60 XP.`)
    expect(runtime.preview().regionalWorks.builtLadderIds).toEqual([id(4306)])
    const logs = runtime.preview().state.player.inventory.find((stack) => stack.itemId === 'logs')!.quantity
    const xp = runtime.preview().state.player.xp
    for (let n = 0; n < 25; n++) expect(runtime.advanceFrame([
      { type: 'move', delta: { x: -0.16, z: 0 } }], true).rejections).toEqual([])
    expect((await runtime.save()).status).toBe('saved')
    expect(runtime.preview().state.player.position.x).toBeCloseTo(-416)
    expect(runtime.preview().state.player.position.z).toBe(430.6)
    expect(runtime.preview().state.player.position.y).toBeCloseTo(2.4)
    const midway = await resumePublicV23(lock, createAtomicV23Store(factory), bindings.sourceStore,
      runtime.status().saveRevision, promoted.lineage)
    expect(midway.ok).toBe(true)
    for (let n = 0; n < 25; n++) expect(runtime.advanceFrame([
      { type: 'move', delta: { x: 0.16, z: 0 } }], true).rejections).toEqual([])
    expect((await runtime.save()).status).toBe('saved')
    expect(runtime.preview().state.player.position.x).toBeCloseTo(-412)
    expect(runtime.preview().state.player.position.z).toBe(430.6)
    expect(runtime.preview().state.player.inventory.find((stack) => stack.itemId === 'logs')!.quantity).toBe(logs)
    expect(runtime.preview().state.player.xp).toBe(xp)
    const reloaded = await inspectPublicV23(lock, createAtomicV23Store(factory), bindings.sourceStore)
    expect(reloaded).toMatchObject({ ok: true, value: { status: 'valid', start: runtime.committed() } })
  }, 20_000)

  it('rejects an overlapping fixed ladder cleanly and freezes after the V17 source advances', async () => {
    const { bindings, runtime, promoted } = await reached(4320)
    expect((await runtime.action({ kind: 'regional-work', id: id(4320) })).status).toBe('saved')
    const revision = runtime.status().saveRevision
    const before = runtime.preview()
    expect(await runtime.action({ kind: 'legacy-work', id: 'works1:ladder:-103:108:W' }))
      .toEqual({ status: 'rejected', reason: 'occupied' })
    expect(runtime.preview()).toEqual(before)
    expect(runtime.status().saveRevision).toBe(revision)
    const sourceRead = await inspectPublicV17(lock, bindings.sourceStore)
    if (!sourceRead.ok || sourceRead.value.status !== 'valid') throw new Error('Missing V17 source')
    const source = sourceRead.value.start
    const changed = await commitPublicV17Snapshot(lock, bindings.sourceStore,
      { state: source.state, greenwayWorks: source.greenwayWorks },
      source.saveRevision, source.lineage)
    expect(changed.ok).toBe(true)
    expect(await resumePublicV23(lock, bindings.store, bindings.sourceStore,
      revision, promoted.lineage)).toEqual({ ok: false, reason: 'source-changed' })
    expect(runtime.advanceFrame([], false).rejections).toEqual([])
    expect(await runtime.save()).toEqual({ status: 'blocked', reason: 'source-changed' })
    expect(runtime.preview().regionalWorks.builtLadderIds).toEqual([id(4320)])
  })
})
