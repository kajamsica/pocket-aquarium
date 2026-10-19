import { describe, expect, it } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { vi } from 'vitest'
import { createAtomicV17Store } from './atomicV17Database'
import { createAtomicV23Store } from './atomicV23Database'
import { startFreshPublicV17, commitPublicV17Snapshot, inspectPublicV17 } from './publicWorldV17Flow'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import { confirmPublicV14TerrainWork } from './publicWorldV14TerrainWork'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { publicV23CampOverlaps, publicV23CanonicalPropBlockers, publicV23CorridorsOverlap, publicV23WorkCorridor, resolvePublicV23Site } from './publicWorldV23Sites'
import { resolveFieldCampSite } from './fieldCamp'
import { mireglassAnchors } from './mireglassContent'
import { confirmPublicV23Work, createPublicV23Root, decodePublicV23Progress,
  previewPublicV23Work, PUBLIC_V23_DATABASE_NAME, replayPublicV23Transition } from './publicWorldV23Snapshot'
import { encodePublicV17Head, PUBLIC_V17_DATABASE_NAME } from './publicWorldV17Snapshot'
import type { PublicV23Progress, PublicV23SourceReceipt } from './publicWorldV23Snapshot'
import { commitPublicV23, inspectPublicV23, resumePublicV23, startPublicV23 } from './publicWorldV23Flow'
import { advancePublicV23Frames, applyPublicV23Witness, decodePublicV23Witness,
  previewPublicV23Frames, publicV23LegacyWorkOccupied, replayPublicV23Witness,
  visitPublicV23Frames, visitPublicV23FramesWithEvents } from './publicWorldV23Transitions'
import { createPublicV17ContinuousSession } from './publicWorldV17ContinuousSession'
import { createFreshPublicV17Head } from './publicWorldV17Snapshot'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'

const seed = 'greenway-alpha', id = (q: number) => `works5:ladder:mireglass-slate:W:-103:${q}`
function locks() {
  let active = false
  return { request: async <T,>(name: string, _options: { mode: 'exclusive' }, body: () => T | Promise<T>) => {
    expect(name).toBe(PUBLIC_V7_LOCK_NAME)
    if (active) throw new Error('Nested lock')
    active = true
    try { return await body() } finally { active = false }
  } }
}
function ready(q = 4306): PublicV23Progress {
  const { head } = createPublicV23Root(seed), site = resolvePublicV23Site(seed, id(q))!
  const state = head.state
  return { state: { ...state, movementOwner: 'streamed',
    discoveryMask: encodeDiscoveredTileIds([...new Set([...decodeDiscoveredTileIds(state.discoveryMask), ...site.footprintTileIds])].sort()),
    player: { ...state.player, position: { ...site.from }, inventory: [
      ...state.player.inventory, { itemId: 'logs', quantity: 12 }] } },
  greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks }
}
function sourceReceipt(source: Awaited<ReturnType<typeof startFreshPublicV17>>): PublicV23SourceReceipt {
  if (!source.ok) throw new Error(source.reason)
  const { state, greenwayWorks, saveRevision, lineage } = source.value
  return { state, greenwayWorks, saveRevision, lineage }
}

function greenwayAt(x: number, z: number): PublicV23Progress {
  const { head } = createPublicV23Root(seed)
  const support = publicV17StarterSupportAt({ seed,
    profile: head.state.generationProfile,
    route: head.state.greenway.routes[0] ?? null,
    built: false, greenwayWorks: head.greenwayWorks }, { x, z })
  if (!support) throw new Error('Missing Greenway fixture support')
  const progress = { state: { ...head.state,
    player: { ...head.state.player, position: { x, y: support.floorY, z } } },
  greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks }
  if (!decodePublicV23Progress(progress, seed)) throw new Error('Invalid Greenway fixture')
  return progress
}

describe('V23 canonical regional placement and replay', () => {
  it('keeps old dry-step replay pinned and returns checked events for opt-in dry steps', () => {
    const drySeed = 'wizard-realms'
    const { head } = createPublicV23Root(drySeed)
    const point = { x: 13.95, z: 4 }
    const floor = publicV17StarterSupportAt({ seed: drySeed,
      profile: head.state.generationProfile,
      route: head.state.greenway.routes[0] ?? null,
      built: false, greenwayWorks: head.greenwayWorks }, point)?.floorY
    if (floor === undefined) throw new Error('Missing dry-step fixture support')
    const before = { state: { ...head.state, player: { ...head.state.player,
      position: { ...point, y: floor } } }, greenwayWorks: head.greenwayWorks,
    regionalWorks: head.regionalWorks }
    expect(decodePublicV23Progress(before, drySeed)).not.toBeNull()
    const frames = [{ intents: [{ type: 'move' as const, delta: { x: 0.1, z: 0 } }],
      walkRequested: true }]
    expect(visitPublicV23Frames(before, frames, () => true)).toBeNull()
    const result = visitPublicV23FramesWithEvents(before, frames, () => true, false,
      { maxOrdinaryGroundStepMeters: 0.8 })
    expect(result?.progress.state.player.position.x).toBeCloseTo(14.05)
    expect(result?.events).toContainEqual(expect.objectContaining({ type: 'player_moved' }))

    const safe = greenwayAt(0, 0)
    const safeFrames = [{ intents: [{ type: 'move' as const, delta: { x: 0.16, z: 0 } }],
      walkRequested: true }]
    expect(visitPublicV23FramesWithEvents(safe, safeFrames, () => true))
      .toEqual(applyPublicV23Witness(safe, { kind: 'frame-batch/v1', frames: safeFrames }))
  })

  it('visits every accepted Greenway and streamed frame once without changing old replay', () => {
    const built = confirmPublicV23Work(ready(), id(4306))
    if (!('progress' in built)) throw new Error(built.rejection)
    for (const before of [greenwayAt(0, 0), built.progress]) {
      const dx = before.state.movementOwner === 'greenway' ? 0.16 : -0.16
      const frames = Array.from({ length: 2 }, () => ({
        intents: [{ type: 'move' as const, delta: { x: dx, z: 0 } }], walkRequested: true }))
      const pairs: [PublicV23Progress, PublicV23Progress][] = []
      const observed = visitPublicV23Frames(before, frames, (from, to) => {
        pairs.push([from, to]); return true
      })
      expect(pairs).toHaveLength(2)
      expect(pairs[0][0]).toEqual(decodePublicV23Progress(before, seed))
      expect(pairs[1][0]).toBe(pairs[0][1])
      expect(pairs[1][1]).toEqual(observed)
      pairs.forEach(([from, to], index) => {
        expect(from.state.player.position.x).toBeCloseTo(before.state.player.position.x + dx * index)
        expect(to.state.player.position.x).toBeCloseTo(before.state.player.position.x + dx * (index + 1))
        expect(to.state.tick).toBe(from.state.tick + 1)
      })
      expect(observed).toEqual(advancePublicV23Frames(before, frames))
      expect(observed).toEqual(replayPublicV23Witness(before, { kind: 'frame-batch/v1', frames }))
      let calls = 0
      expect(visitPublicV23Frames(before, frames, () => ++calls < 2)).toBeNull()
      expect(calls).toBe(2)
      expect(visitPublicV23Frames(before, frames, () => { throw new Error('stop') })).toBeNull()
    }
  })

  it('keeps the first Greenway session detached from caller and visitor mutations', () => {
    const before = greenwayAt(0, 0)
    const frames = Array.from({ length: 2 }, () => ({ intents: [{ type: 'move' as const,
      delta: { x: 0.16, z: 0 } }], walkRequested: true }))
    const expected = advancePublicV23Frames(before, frames)
    const checked = createPublicV17ContinuousSession({ state: before.state,
      greenwayWorks: before.greenwayWorks, saveRevision: 1,
      lineage: createFreshPublicV17Head(seed).lineage })
    for (const frame of frames) expect(checked.advanceFrame(frame.intents,
      { walkRequested: frame.walkRequested }).rejections).toEqual([])
    let visits = 0
    const actual = visitPublicV23FramesWithEvents(before, frames, (_prior, after) => {
      if (visits++ === 0) {
        before.state.greenway.tiles[0].elevation = 999
        before.state.discoveryMask[0] ^= 1
        after.state.greenway.tiles[0].elevation = 998
        after.state.discoveryMask[0] ^= 1
      }
      return true
    })
    expect(visits).toBe(2)
    expect(actual?.progress).toEqual(expected)
    expect(actual?.progress.state).toEqual(checked.previewSnapshot().state)
    expect(decodePublicV23Progress(actual?.progress, seed)).toEqual(expected)
    expect(advancePublicV23Frames(new Proxy(greenwayAt(0, 0), {}), frames)).toBeNull()
  })

  it.each([
    ['creek', 5.9, 0.16, 'Build a Greenway bridge lane to cross the creek.'],
    ['cliff', -5.9, -0.16, 'Build a ladder at this cliff face.'],
  ] as const)('reports the exact %s source rejection without changing checked witness semantics',
    (_name, z, dz, message) => {
      const before = greenwayAt(0, z)
      const frames = [{ intents: [{ type: 'move' as const, delta: { x: 0, z: dz } }],
        walkRequested: true }]
      const source = createPublicV17ContinuousSession({ state: before.state,
        greenwayWorks: before.greenwayWorks, saveRevision: 1,
        lineage: createFreshPublicV17Head(seed).lineage })
      const rejection = source.advanceFrame(frames[0].intents, { walkRequested: true }).rejections[0]
      expect(rejection.message).toBe(message)
      expect(previewPublicV23Frames(before, frames, true)).toEqual({ progress: null,
        rejection, rejectedFrameIndex: 0 })
      expect(advancePublicV23Frames(before, frames, true)).toBeNull()
      expect(applyPublicV23Witness(before, { kind: 'frame-batch/v1', frames }))
        .toEqual({ rejection: 'frame-rejected' })
    })

  it('keeps malformed or internally invalid frame diagnostics generic', () => {
    const before = greenwayAt(0, 0)
    expect(previewPublicV23Frames(before, [{ intents: [{ type: 'move',
      delta: { x: 100, z: 0 } }], walkRequested: true }], true))
      .toEqual({ progress: null, rejection: null, rejectedFrameIndex: null })
    expect(applyPublicV23Witness(before, { kind: 'frame-batch/v1', frames: [
      { intents: [{ type: 'move', delta: { x: 100, z: 0 } }], walkRequested: true }] }))
      .toEqual({ rejection: 'invalid-witness' })
  })

  it('resolves both guarded limits, rejects adjacent rows and forged tokens', () => {
    const a = resolvePublicV23Site(seed, id(4306))!, b = resolvePublicV23Site(seed, id(4334))!
    expect(a.from).toMatchObject({ x: -412, z: 430.6 })
    expect(a.from.y).toBeCloseTo(0.84)
    expect(a.to).toMatchObject({ x: -416, z: 430.6 })
    expect(a.to.y).toBeCloseTo(2.4)
    expect(a.supportPath.slice(1, 3).map((p) => p.x)).toEqual([-413.675, -414.325])
    expect(a.footprintTileIds).toEqual(b.footprintTileIds)
    expect(a.footprintTileIds).toHaveLength(4)
    expect(a.corridor.halfWidth).toBe(0.54)
    for (const token of [id(4305), id(4335), id(4306).replace(':4306', ':04306'),
      id(4306).replace(':4306', ':-0'), id(4306).replace(':W:', ':E:'), id(4306) + ':x']) {
      expect(resolvePublicV23Site(seed, token)).toBeNull()
    }
  })
  it('separates shared tiles, fixed structure gap, and actual world overlap with clearance', () => {
    const a = resolvePublicV23Site(seed, id(4306))!, b = resolvePublicV23Site(seed, id(4334))!
    const fixed = publicV23WorkCorridor(seed, 'works1:ladder:-103:108:W')!
    expect(publicV23CorridorsOverlap(a.corridor, b.corridor)).toBe(false)
    expect(publicV23CorridorsOverlap(a.corridor, fixed)).toBe(false)
    expect(publicV23CorridorsOverlap(b.corridor, fixed)).toBe(false)
    expect(432 - 0.54 - (430.6 + 0.54)).toBeCloseTo(0.32)
    expect(publicV23CorridorsOverlap(a.corridor, resolvePublicV23Site(seed, id(4310))!.corridor)).toBe(true)
    const shifted = (gap: number) => ({ ...a.corridor, center: { ...a.corridor.center, z: a.from.z + 1.08 + gap } })
    expect(publicV23CorridorsOverlap(a.corridor, shifted(0.049))).toBe(true)
    expect(publicV23CorridorsOverlap(a.corridor, shifted(0.05))).toBe(false)
  })
  it('checks canonical props across the complete shifted guarded approach', () => {
    for (let q = 4306; q <= 4334; q++) {
      const site = resolvePublicV23Site(seed, id(q))!
      expect(site, `clear canonical q=${q}`).not.toBeNull()
      expect(publicV23CanonicalPropBlockers(seed, site.approach, site.exit)).toEqual([])
      expect(site.blockingResourceIds).toEqual([])
    }
    const anchor = mireglassAnchors(seed).slateBerm
    expect(publicV23CanonicalPropBlockers(seed, { ...anchor.tile.center, x: anchor.tile.center.x + 4 },
      { ...anchor.tile.center, x: anchor.tile.center.x - 4 })).toContain(anchor.id)
  })
  it('reserves the entire canonical camp footprint, not just its center tile', () => {
    const campId = 'tile--73-103', camp = resolveFieldCampSite(seed, campId)!
    expect(camp).not.toBeNull()
    const corridor = resolvePublicV23Site(seed, id(4306))!.corridor
    expect(publicV23CampOverlaps(seed, corridor, campId)).toBe(false)
    expect(publicV23CampOverlaps(seed, { ...corridor, center: {
      ...camp.tile.center, z: camp.tile.center.z + 5.9 } }, campId)).toBe(true)
  })
  it('spends exactly four logs, rewards once, rejects duplicate/hidden/overlapping placement and tampered replay', () => {
    const before = ready(), built = confirmPublicV23Work(before, id(4306))
    expect(decodePublicV23Progress(before, seed)).not.toBeNull()
    if (!('progress' in built)) throw new Error(built.rejection)
    expect(built.progress.state.player.inventory.find((s) => s.itemId === 'logs')?.quantity).toBe(8)
    expect(built.progress.state.player.xp - before.state.player.xp).toBe(60)
    expect(built.progress.state.player.skillXp.construction - before.state.player.skillXp.construction).toBe(60)
    expect(built.progress.state.player.position).toEqual(before.state.player.position)
    expect(confirmPublicV23Work(built.progress, id(4306))).toEqual({ rejection: 'already_done' })
    expect(confirmPublicV23Work(built.progress, id(4310))).toEqual({ rejection: 'occupied' })
    const hidden = { ...before, state: { ...before.state, discoveryMask: createPublicV23Root(seed).head.state.discoveryMask } }
    expect(confirmPublicV23Work(hidden, id(4306))).toHaveProperty('rejection')
    const base = { ...createPublicV23Root(seed).head, ...before, saveRevision: 1 }
    const after = { ...base, ...built.progress, saveRevision: 2, witness: { kind: 'regional-work' as const, id: id(4306) } }
    expect(replayPublicV23Transition(base, after)).toBe(true)
    const forged = structuredClone(after); forged.state.player.xp++
    expect(replayPublicV23Transition(base, forged)).toBe(false)
    const moved = structuredClone(after); moved.state.player.position.x += 0.1
    expect(replayPublicV23Transition(base, moved)).toBe(false)
    const inventory = structuredClone(after); inventory.state.player.inventory.find((s) => s.itemId === 'logs')!.quantity++
    expect(replayPublicV23Transition(base, inventory)).toBe(false)
    expect(before.state.player.inventory.find((s) => s.itemId === 'logs')?.quantity).toBe(12)
  })
  it('rejects unsorted/duplicate IDs and accepts a grounded rung pose only with built support', () => {
    const first = confirmPublicV23Work(ready(), id(4306))
    if (!('progress' in first)) throw new Error(first.rejection)
    const rung = structuredClone(first.progress)
    rung.state.player.position = { x: -414, y: 1.62, z: 430.6 }
    expect(decodePublicV23Progress(rung, seed)).not.toBeNull()
    expect(decodePublicV23Progress({ ...rung, regionalWorks: { builtLadderIds: [] } }, seed)).toBeNull()
    expect(decodePublicV23Progress({ ...rung, regionalWorks: { builtLadderIds: [id(4306), id(4306)] } }, seed)).toBeNull()
    expect(decodePublicV23Progress({ ...rung, regionalWorks: { builtLadderIds: [id(4334), id(4306)] } }, seed)).toBeNull()
    expect(decodePublicV23Progress({ ...rung, regionalWorks: { builtLadderIds: Array(33).fill(id(4306)) } }, seed)).toBeNull()
    const accessor = [id(4306)]
    Object.defineProperty(accessor, '0', { enumerable: true, get: () => id(4306) })
    expect(decodePublicV23Progress({ ...rung, regionalWorks: { builtLadderIds: accessor } }, seed)).toBeNull()
    const lowReward = structuredClone(first.progress); lowReward.state.player.skillXp.construction--
    expect(decodePublicV23Progress(lowReward, seed)).toBeNull()
  })
  it('requires the whole discovered footprint and grounded lower-foot reach with four logs', () => {
    const initial = ready(), site = resolvePublicV23Site(seed, id(4306))!
    const partial = { ...initial, state: { ...initial.state, discoveryMask: encodeDiscoveredTileIds(
      decodeDiscoveredTileIds(initial.state.discoveryMask).filter((tile) => tile !== site.footprintTileIds[3])) } }
    expect(confirmPublicV23Work(partial, site.id)).toEqual({ rejection: 'undiscovered' })
    expect(previewPublicV23Work(partial, site.id)).toEqual({ site: null, rejection: 'undiscovered' })
    const poor = structuredClone(initial); poor.state.player.inventory.find((s) => s.itemId === 'logs')!.quantity = 3
    expect(confirmPublicV23Work(poor, site.id)).toEqual({ rejection: 'not_owned' })
    const upper = structuredClone(initial); upper.state.player.position = { ...site.to }
    expect(confirmPublicV23Work(upper, site.id)).toEqual({ rejection: 'too_far' })
  })
  it('builds both edges alongside the fixed ladder despite identical discovery footprints', () => {
    const initial = ready(), fixed = confirmPublicV14TerrainWork(initial.state, 'works1:ladder:-103:108:W')
    if (!fixed.candidate) throw new Error(fixed.rejection)
    const a = confirmPublicV23Work({ ...initial, state: fixed.candidate }, id(4306))
    if (!('progress' in a)) throw new Error(a.rejection)
    const next = { ...a.progress, state: { ...a.progress.state,
      player: { ...a.progress.state.player, position: resolvePublicV23Site(seed, id(4334))!.from } } }
    const b = confirmPublicV23Work(next, id(4334))
    if (!('progress' in b)) throw new Error(b.rejection)
    expect(b.progress.regionalWorks.builtLadderIds).toEqual([id(4306), id(4334)])
    expect(b.progress.state.terrainWorks.builtWorkIds).toEqual(['works1:ladder:-103:108:W'])
    expect(b.progress.state.player.inventory.some((s) => s.itemId === 'logs')).toBe(false)
    expect(b.progress.state.player.skillXp.construction).toBe(initial.state.player.skillXp.construction + 180)
  })
  it('replays west climb and descent with discovery while rejecting tampered movement and overlap', () => {
    const built = confirmPublicV23Work(ready(), id(4306))
    if (!('progress' in built)) throw new Error(built.rejection)
    const frames = Array.from({ length: 25 }, () => ({
      intents: [{ type: 'move' as const, delta: { x: -0.16, z: 0 } }], walkRequested: true }))
    const upper = advancePublicV23Frames(built.progress, frames)!
    expect(upper).not.toBeNull()
    expect(upper.state.player.position.x).toBeCloseTo(-416)
    expect(upper.state.player.position.y).toBeCloseTo(2.4)
    expect(upper.state.tick).toBe(built.progress.state.tick + 25)
    expect(decodeDiscoveredTileIds(upper.state.discoveryMask).length).toBeGreaterThan(
      decodeDiscoveredTileIds(built.progress.state.discoveryMask).length)
    expect(advancePublicV23Frames(built.progress, frames)).toEqual(upper)
    const down = advancePublicV23Frames(upper, frames.map((frame) => ({ ...frame,
      intents: [{ type: 'move' as const, delta: { x: 0.16, z: 0 } }] })))!
    expect(down.state.player.position.x).toBeCloseTo(-412)
    expect(down.state.player.position.y).toBeCloseTo(0.84)
    expect(down.state.player.inventory).toEqual(built.progress.state.player.inventory)
    expect(down.state.player.xp).toBe(built.progress.state.player.xp)
    const before = { ...createPublicV23Root(seed).head, ...built.progress, saveRevision: 1 }
    const after = { ...before, ...upper, saveRevision: 2, witness: { kind: 'frame-batch/v1' as const, frames } }
    expect(replayPublicV23Transition(before, after)).toBe(true)
    const forged = structuredClone(after); forged.state.player.position.z += 0.1
    expect(replayPublicV23Transition(before, forged)).toBe(false)
    const middle = confirmPublicV23Work(ready(4320), id(4320))
    if (!('progress' in middle)) throw new Error(middle.rejection)
    expect(publicV23LegacyWorkOccupied(middle.progress, 'works1:ladder:-103:108:W')).toBe(true)
    expect(applyPublicV23Witness(middle.progress, { kind: 'legacy-work', id: 'works1:ladder:-103:108:W' }))
      .toEqual({ rejection: 'occupied' })
    expect(publicV23LegacyWorkOccupied(built.progress, 'works1:ladder:-103:108:W')).toBe(false)
  })
  it('preserves Greenway frame parity, replays equipment, and rejects loose witness shapes', () => {
    const { head } = createPublicV23Root(seed)
    const progress = { state: head.state, greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks }
    const frames = [{ intents: [{ type: 'move' as const, delta: { x: 0.16, z: 0 } }], walkRequested: true }]
    const old = createPublicV17ContinuousSession({ ...progress, saveRevision: 0,
      lineage: createFreshPublicV17Head(seed).lineage })
    expect(old.advanceFrame(frames[0].intents, { walkRequested: true }).rejections).toEqual([])
    expect(advancePublicV23Frames(progress, frames)).toEqual({ ...old.previewSnapshot(), regionalWorks: progress.regionalWorks })
    const jump = [{ intents: [{ type: 'jump' as const }], walkRequested: false }]
    expect(advancePublicV23Frames(progress, jump)).toBeNull()
    expect(advancePublicV23Frames(progress, jump, true)?.state.player.verticalVelocity).toBeGreaterThan(0)
    const action = { kind: 'legacy-action' as const, intent: { type: 'equip_item' as const, itemId: 'woodcutters_axe' as const, slot: 'mainHand' as const } }
    const equipped = applyPublicV23Witness(progress, action)
    if (!('progress' in equipped)) throw new Error(equipped.rejection)
    expect(equipped.progress.state.player.equipment.mainHand).toBe('woodcutters_axe')
    const after = { ...head, ...equipped.progress, saveRevision: 1, witness: action }
    expect(replayPublicV23Transition(head, after)).toBe(true)
    const forged = structuredClone(after); forged.state.player.xp++
    expect(replayPublicV23Transition(head, forged)).toBe(false)
    expect(decodePublicV23Witness({ ...action, next: progress })).toBeNull()
    expect(decodePublicV23Witness({ kind: 'legacy-action', intent: { type: 'place_camp', tileId: 'tile-1-1' } })).toBeNull()
    expect(decodePublicV23Witness({ kind: 'checkpoint', frames: [] })).toBeNull()
  })
})

describe('V23 source-checked atomic root', () => {
  it('offers fresh then resumes checkpoint with shared lock and no nested source lock', async () => {
    const factory = new IDBFactory(), gate = locks(), store = createAtomicV23Store(factory), source = createAtomicV17Store(factory)
    expect(await inspectPublicV23(gate, store, source)).toEqual({ ok: true, value: { status: 'fresh-available' } })
    const started = await startPublicV23(gate, store, source, seed, null)
    if (!started.ok) throw new Error(started.reason)
    const saved = await commitPublicV23(gate, store, source, 0, started.value.lineage, { kind: 'checkpoint' })
    expect(saved.ok).toBe(true)
    expect(await resumePublicV23(gate, store, source, 1, started.value.lineage)).toEqual(saved)
  })
  it('detaches a frame witness before the store write and reloads the committed result', async () => {
    const factory = new IDBFactory(), gate = locks(), store = createAtomicV23Store(factory), source = createAtomicV17Store(factory)
    const start = await startPublicV23(gate, store, source, seed, null)
    if (!start.ok) throw new Error(start.reason)
    const witness = { kind: 'frame-batch/v1' as const, frames: [
      { intents: [{ type: 'look' as const, yawDelta: -0.13, pitchDelta: 0 }], walkRequested: false }] }
    let entered!: () => void, release!: () => void
    const atStore = new Promise<void>((resolve) => { entered = resolve })
    const resumeStore = new Promise<void>((resolve) => { release = resolve })
    const commit = store.commit.bind(store)
    const spy = vi.spyOn(store, 'commit').mockImplementation(async (proof, next) => {
      entered()
      await resumeStore
      return commit(proof, next)
    })
    try {
      const writing = commitPublicV23(gate, store, source, 0, start.value.lineage, witness)
      await atStore
      witness.frames[0].intents[0].yawDelta = 0.13
      release()
      const saved = await writing
      if (!saved.ok) throw new Error(saved.reason)
      expect(saved.value.head.witness).toMatchObject({ frames: [
        { intents: [{ yawDelta: -0.13 }] }] })
      expect(await resumePublicV23(gate, createAtomicV23Store(factory), source, 1, start.value.lineage)).toEqual(saved)
    } finally { release(); spy.mockRestore() }
  })
  it('preserves the exact V17 receipt and retries a lost completion after later checkpoints', async () => {
    const factory = new IDBFactory(), gate = locks(), store = createAtomicV23Store(factory), source = createAtomicV17Store(factory)
    const old = await startFreshPublicV17(gate, source, seed), receipt = sourceReceipt(old)
    const before = await source.read()
    expect(await inspectPublicV23(gate, store, source)).toMatchObject({ ok: true, value: { status: 'migration-available', sourceReceipt: receipt } })
    const started = await startPublicV23(gate, store, source, seed, receipt)
    if (!started.ok) throw new Error(started.reason)
    expect(started.value.lineage.sourceReceipt).toEqual(receipt)
    expect(await startPublicV23(gate, store, source, seed, receipt)).toEqual(started)
    const later = await commitPublicV23(gate, store, source, 0, started.value.lineage, { kind: 'checkpoint' })
    expect(await startPublicV23(gate, store, source, seed, receipt)).toEqual(later)
    expect(await source.read()).toEqual(before)
  })
  it('migrates a discovered source, commits one checked build, and reloads the complete replay result', async () => {
    const factory = new IDBFactory(), gate = locks(), store = createAtomicV23Store(factory), source = createAtomicV17Store(factory)
    const receipt = sourceReceipt(await startFreshPublicV17(gate, source, seed)), fixture = ready()
    // Existing V17 tests seed a valid predecessor/head pair for a reached region.
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(PUBLIC_V17_DATABASE_NAME, 1); request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve) => {
      const tx = db.transaction('records', 'readwrite'), records = tx.objectStore('records')
      for (const [slot, revision] of [['previous', 1], ['head', 2]] as const) records.put({ saveRevision: revision,
        value: encodePublicV17Head({ state: fixture.state, greenwayWorks: fixture.greenwayWorks }, revision, receipt.lineage) }, slot)
      tx.oncomplete = () => resolve()
    })
    db.close()
    const inspected = await inspectPublicV17(gate, source)
    if (!inspected.ok || inspected.value.status !== 'valid') throw new Error('Invalid reached source fixture')
    const reached = sourceReceipt({ ok: true, value: inspected.value.start })
    const migrated = await startPublicV23(gate, store, source, seed, reached)
    if (!migrated.ok) throw new Error(migrated.reason)
    const built = await commitPublicV23(gate, store, source, 0, migrated.value.lineage,
      { kind: 'regional-work', id: id(4306) })
    if (!built.ok) throw new Error(built.reason)
    const reloaded = await resumePublicV23(gate, createAtomicV23Store(factory), source, 1, migrated.value.lineage)
    expect(reloaded).toEqual(built)
    expect(built.value.head.regionalWorks.builtLadderIds).toEqual([id(4306)])
    expect(built.value.head.state.player.inventory.find((s) => s.itemId === 'logs')?.quantity).toBe(8)
    expect(built.value.head.state.player.position).toEqual(fixture.state.player.position)
    expect(await commitPublicV23(gate, store, source, 1, migrated.value.lineage,
      { kind: 'regional-work', id: id(4306) })).toEqual({ ok: false, reason: 'already_done' })
    const frames = Array.from({ length: 13 }, () => ({
      intents: [{ type: 'move' as const, delta: { x: -0.16, z: 0 } }], walkRequested: true }))
    const climbed = await commitPublicV23(gate, store, source, 1, migrated.value.lineage,
      { kind: 'frame-batch/v1', frames })
    if (!climbed.ok) throw new Error(climbed.reason)
    expect(climbed.value.head.state.player.position.y).toBeGreaterThan(0.84)
    expect(climbed.value.head.state.player.position.y).toBeLessThan(2.4)
    expect(await resumePublicV23(gate, createAtomicV23Store(factory), source, 2, migrated.value.lineage)).toEqual(climbed)
    expect((await commitPublicV17Snapshot(gate, source, { state: reached.state, greenwayWorks: reached.greenwayWorks },
      reached.saveRevision, reached.lineage)).ok).toBe(true)
    expect(await commitPublicV23(gate, store, source, 2, migrated.value.lineage,
      { kind: 'frame-batch/v1', frames })).toEqual({ ok: false, reason: 'source-changed' })
  }, 15_000)
  it.each([0, 1])('blocks stale V17 source after V23 revision %i, retaining both roots', async (revision) => {
    const factory = new IDBFactory(), gate = locks(), store = createAtomicV23Store(factory), source = createAtomicV17Store(factory)
    const old = await startFreshPublicV17(gate, source, seed), receipt = sourceReceipt(old)
    const started = await startPublicV23(gate, store, source, seed, receipt)
    if (!started.ok) throw new Error(started.reason)
    if (revision) await commitPublicV23(gate, store, source, 0, started.value.lineage, { kind: 'checkpoint' })
    const target = await store.readChecked()
    expect((await commitPublicV17Snapshot(gate, source, { state: receipt.state, greenwayWorks: receipt.greenwayWorks }, 0, receipt.lineage)).ok).toBe(true)
    expect(await inspectPublicV23(gate, store, source)).toEqual({ ok: true, value: { status: 'blocked', reason: 'source-changed' } })
    expect(await commitPublicV23(gate, store, source, revision, started.value.lineage, { kind: 'checkpoint' })).toEqual({ ok: false, reason: 'source-changed' })
    const after = await store.readChecked()
    expect(after.status === 'valid' && after.root).toEqual(target.status === 'valid' && target.root)
  })
  it('aborts promotion atomically, leaves source intact, then recovers on retry', async () => {
    const factory = new IDBFactory(), gate = locks(), store = createAtomicV23Store(factory), source = createAtomicV17Store(factory)
    const old = await startFreshPublicV17(gate, source, seed), receipt = sourceReceipt(old)
    const before = await source.read(), original = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args) {
      const request = original.apply(this, args)
      if (this.transaction.db.name === PUBLIC_V23_DATABASE_NAME) this.transaction.abort()
      return request
    })
    try { expect(await startPublicV23(gate, store, source, seed, receipt)).toEqual({ ok: false, reason: 'storage-error' }) }
    finally { spy.mockRestore() }
    expect((await store.readChecked()).status).toBe('missing')
    expect(await source.read()).toEqual(before)
    expect((await startPublicV23(gate, store, source, seed, receipt)).ok).toBe(true)
  })
  it('blocks a partial target instead of offering fresh or migrating over it', async () => {
    const factory = new IDBFactory(), gate = locks(), store = createAtomicV23Store(factory), source = createAtomicV17Store(factory)
    await store.readChecked()
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(PUBLIC_V23_DATABASE_NAME, 1)
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve) => {
      const tx = db.transaction('records', 'readwrite')
      tx.objectStore('records').put(createPublicV23Root(seed).lineage, 'lineage')
      tx.oncomplete = () => resolve()
    })
    db.close()
    expect(await inspectPublicV23(gate, store, source)).toEqual({ ok: true, value: { status: 'blocked', reason: 'invalid-v23-root' } })
    expect(await startPublicV23(gate, store, source, seed, null)).toEqual({ ok: false, reason: 'invalid-v23-root' })
  })
  it('rejects a stale promotion request and a different target seed', async () => {
    const factory = new IDBFactory(), gate = locks(), store = createAtomicV23Store(factory), source = createAtomicV17Store(factory)
    const receipt = sourceReceipt(await startFreshPublicV17(gate, source, seed))
    expect((await commitPublicV17Snapshot(gate, source, { state: receipt.state, greenwayWorks: receipt.greenwayWorks }, 0, receipt.lineage)).ok).toBe(true)
    expect(await startPublicV23(gate, store, source, seed, receipt)).toEqual({ ok: false, reason: 'source-changed' })
    expect((await store.readChecked()).status).toBe('missing')
    const freshFactory = new IDBFactory(), fresh = createAtomicV23Store(freshFactory), empty = createAtomicV17Store(freshFactory)
    expect((await startPublicV23(gate, fresh, empty, seed, null)).ok).toBe(true)
    expect(await startPublicV23(gate, fresh, empty, 'another-world', null)).toEqual({ ok: false, reason: 'target-conflict' })
  })
  it('blocks a disappeared source and rejects reused or forged transaction proof', async () => {
    const factory = new IDBFactory(), gate = locks(), store = createAtomicV23Store(factory), source = createAtomicV17Store(factory)
    const receipt = sourceReceipt(await startFreshPublicV17(gate, source, seed))
    const started = await startPublicV23(gate, store, source, seed, receipt)
    if (!started.ok) throw new Error(started.reason)
    await new Promise<void>((resolve, reject) => {
      const request = factory.deleteDatabase(PUBLIC_V17_DATABASE_NAME)
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error)
    })
    expect(await resumePublicV23(gate, store, source, 0, started.value.lineage)).toEqual({ ok: false, reason: 'source-changed' })
    const empty = createAtomicV23Store(new IDBFactory()), read = await empty.readChecked()
    if (read.status !== 'missing') throw new Error('Expected empty store')
    const root = { ...createPublicV23Root(seed), previous: null }
    expect(await empty.commit({}, root)).toBe('invalid')
    expect(await empty.commit(read.proof, root)).toBe('committed')
    expect(await empty.commit(read.proof, root)).toBe('invalid')
  })
})
