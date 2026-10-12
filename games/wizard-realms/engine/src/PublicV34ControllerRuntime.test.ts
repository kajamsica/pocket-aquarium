import { IDBFactory } from 'fake-indexeddb'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createPublicV33ControllerRuntime } from './PublicV33ControllerRuntime'
import { createPublicV34ControllerRuntime } from './PublicV34ControllerRuntime'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { highlandLandmark } from './domain/highlandContent'
import { applyPublicV26ReturnHome } from './domain/publicWorldV26Escape'
import { nearbyWorldTileIds } from './domain/publicWorldDiscovery'
import { samePublicV14Value } from './domain/publicWorldV14Validation'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { createFreshPublicV17Head } from './domain/publicWorldV17Snapshot'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { createPublicV23Root } from './domain/publicWorldV23Snapshot'
import { createAtomicV34Store } from './domain/atomicV34Database'
import { createPublicV24Root } from './domain/publicWorldV24Snapshot'
import { createPublicV25Root } from './domain/publicWorldV25Snapshot'
import { createPublicV26Root } from './domain/publicWorldV26Snapshot'
import { createPublicV27Root } from './domain/publicWorldV27Snapshot'
import { createPublicV28Root } from './domain/publicWorldV28Snapshot'
import { createPublicV29Root } from './domain/publicWorldV29Snapshot'
import { createPublicV30Root } from './domain/publicWorldV30Snapshot'
import { createPublicV31Root } from './domain/publicWorldV31Snapshot'
import { createPublicV32Root } from './domain/publicWorldV32Snapshot'
import type { PublicV33Progress } from './domain/publicWorldV33Migration'
import { createPublicV33Root, replayPublicV33Witness } from './domain/publicWorldV33Snapshot'
import type { PublicV33Witness } from './domain/publicWorldV33Snapshot'
import type { PublicV33Start } from './domain/publicWorldV33Flow'
import { commitPublicV34, requestPublicV34ReturnHome,
  resumePublicV34 } from './domain/publicWorldV34Flow'
import { createPublicV34Root, decodePublicV34CheckedSuccessor,
  decodePublicV34Root } from './domain/publicWorldV34Snapshot'
import type { PublicV34Root } from './domain/publicWorldV34Snapshot'
import type { PublicV34Start } from './domain/publicWorldV34Flow'
import { WORLD_CELL_METERS, worldTileAtGrid } from './domain/worldChunks'

const seed = 'wizard-realms'
let atRing: PublicV34Root
let atCrown: PublicV34Root
let atRingV33: ReturnType<typeof createPublicV33Root>

function makeRoot(site: 'ring' | 'crown') {
  const v17 = createFreshPublicV17Head(seed)
  const ring = v17.head.state.greenway.fairyRings.find(({ id }) => id === 'ring-greenway')!
  const crown = highlandLandmark(seed)
  const place = site === 'ring' ? ring.position : crown.tile.center
  const floor = site === 'ring'
    ? publicV17StarterSupportAt({ seed, profile: v17.head.state.generationProfile,
      route: v17.head.state.greenway.routes.find(({ id }) => id === 'greenway_ladder') ?? null,
      built: false, greenwayWorks: v17.head.greenwayWorks }, place)?.floorY
    : resolvePublicV23Surface(v17.head.state, place, [])?.floorY
  if (floor === undefined) throw Error('Missing fixture support')
  const tileId = site === 'ring'
    ? worldTileAtGrid(seed, Math.ceil(ring.position.x / WORLD_CELL_METERS - 0.5),
      Math.ceil(ring.position.z / WORLD_CELL_METERS - 0.5)).id : crown.tile.id
  const state = { ...v17.head.state,
    ...(site === 'crown' ? { movementOwner: 'streamed' as const } : {}),
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(v17.head.state.discoveryMask), tileId,
      ...(site === 'crown' ? nearbyWorldTileIds(crown.tile.center, 8) : [])])].sort()),
    player: { ...v17.head.state.player, position: { ...place, y: floor } } }
  const v23 = createPublicV23Root(seed, { state, greenwayWorks: v17.head.greenwayWorks,
    saveRevision: 1, lineage: v17.lineage })
  const v24 = createPublicV24Root(v23)
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
  const v29 = createPublicV29Root({ head: v28.head, lineage: v28.lineage })
  const v30 = createPublicV30Root({ head: v29.head, lineage: v29.lineage })
  const v31 = createPublicV31Root(v30)
  const v32 = createPublicV32Root(v31)
  const v33 = createPublicV33Root(v32)
  if (site === 'ring') atRingV33 = v33
  return createPublicV34Root(v33.head)
}

beforeAll(() => { atRing = makeRoot('ring'); atCrown = makeRoot('crown') }, 120_000)

function writerFor(initial: PublicV34Root) {
  let root = structuredClone(initial)
  const write = vi.fn(async (revision: number, lineage: PublicV34Start['lineage'],
    witness: PublicV33Witness) => {
    if (revision !== root.head.saveRevision || !samePublicV14Value(lineage, root.lineage))
      return { ok: false as const, reason: 'revision-changed' }
    const next = replayPublicV33Witness(root.head, witness)
    if (!next) return { ok: false as const, reason: 'replay-rejected' }
    const candidate: PublicV34Root = { lineage, previous: root.head,
      head: { ...root.head, ...next, saveRevision: revision + 1, witness } }
    if (!decodePublicV34CheckedSuccessor(root, candidate))
      return { ok: false as const, reason: 'invalid-successor' }
    root = structuredClone(candidate)
    return { ok: true as const, value: { head: root.head, lineage: root.lineage } }
  })
  return { write, root: () => root }
}

describe('V34 compact controller adapter', () => {
  it('passes a revision- and witness-bound V33 frame proof once, never for an action', async () => {
    let current: PublicV33Start = { head: atRingV33.head, lineage: atRingV33.lineage }
    const frameChecks: Array<{ provided: boolean; correct?: boolean;
      repeated?: PublicV33Progress | null; wrongRevision?: PublicV33Progress | null;
      wrongWitness?: PublicV33Progress | null }> = []
    let actionProof: unknown = 'not-called'
    const write = vi.fn(async (revision: number, lineage: PublicV33Start['lineage'],
      witness: PublicV33Witness,
      frameProof?: (revision: number, witness: unknown) => PublicV33Progress | null) => {
      const next = replayPublicV33Witness(current.head, witness)
      if (!next) return { ok: false as const, reason: 'replay-rejected' }
      if (witness.kind === 'frame-batch/v1') {
        const wrongWitness = { ...witness, frames: [{ ...witness.frames[0],
          walkRequested: !witness.frames[0].walkRequested }, ...witness.frames.slice(1)] }
        if (frameChecks.length === 0) frameChecks.push({ provided: !!frameProof,
          correct: !!frameProof && samePublicV14Value(frameProof(revision, witness), next),
          repeated: frameProof?.(revision, witness) ?? null })
        else if (frameChecks.length === 1) frameChecks.push({ provided: !!frameProof,
          wrongRevision: frameProof?.(revision + 1, witness) ?? null })
        else frameChecks.push({ provided: !!frameProof,
          wrongWitness: frameProof?.(revision, wrongWitness) ?? null })
      } else actionProof = frameProof
      current = { lineage, head: { ...current.head, ...next,
        saveRevision: revision + 1, witness } }
      return { ok: true as const, value: structuredClone(current) }
    })
    const runtime = createPublicV33ControllerRuntime(current, write)
    for (let index = 0; index < 3; index++) {
      expect(runtime.advanceFrame([{ type: 'look', yawDelta: 0.01, pitchDelta: 0 }], false)
        .rejections).toEqual([])
      expect(await runtime.save()).toMatchObject({ status: 'saved' })
    }
    expect(frameChecks).toEqual([
      { provided: true, correct: true, repeated: null },
      { provided: true, wrongRevision: null },
      { provided: true, wrongWitness: null },
    ])
    expect(await runtime.action({ kind: 'fairy-ring-discover/v1', ringId: 'ring-greenway' }))
      .toMatchObject({ status: 'saved' })
    expect(actionProof).toBeUndefined()
    expect(write.mock.calls.map((call) => call[2].kind))
      .toEqual(['frame-batch/v1', 'frame-batch/v1', 'frame-batch/v1',
        'fairy-ring-discover/v1'])
  }, 120_000)

  it('saves frames to V34 only and exposes no simulation lineage', async () => {
    const writer = writerFor(atRing)
    const runtime = createPublicV34ControllerRuntime(atRing, writer.write)
    expect(runtime.advanceFrame([{ type: 'look', yawDelta: 0.01, pitchDelta: 0 }], false)
      .rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(writer.write).toHaveBeenCalledOnce()
    expect(writer.write.mock.calls[0][1]).toEqual(atRing.lineage)
    expect(runtime.committed()).toEqual({ head: writer.root().head,
      lineage: writer.root().lineage })
    expect(Object.keys(writer.root())).toEqual(['lineage', 'previous', 'head'])
    expect(Object.hasOwn(runtime.committed().lineage, 'sourceReceipt')).toBe(false)
    expect(decodePublicV34Root(writer.root())).toEqual(writer.root())
  }, 120_000)

  it('inherits checked Highland study, then rebuilds movement', async () => {
    const writer = writerFor(atCrown)
    const runtime = createPublicV34ControllerRuntime(atCrown, writer.write)
    expect(await runtime.action({ kind: 'highland-discover/v1',
      landmarkId: highlandLandmark(seed).id })).toMatchObject({ status: 'saved' })
    expect(runtime.preview().state.highland.landmarkDiscovered).toBe(true)
    expect(runtime.advanceFrame([{ type: 'look', yawDelta: 0.01, pitchDelta: 0 }], false)
      .rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(writer.write.mock.calls.map((call) => call[2].kind))
      .toEqual(['highland-discover/v1', 'frame-batch/v1'])
    expect(decodePublicV34Root(writer.root())).toEqual(writer.root())
  }, 120_000)

  it('discovers a fairy ring, then moves and saves in the same V34 branch', async () => {
    const writer = writerFor(atRing)
    const runtime = createPublicV34ControllerRuntime(atRing, writer.write)
    expect(await runtime.action({ kind: 'fairy-ring-discover/v1',
      ringId: 'ring-greenway' })).toMatchObject({ status: 'saved' })
    expect(runtime.preview().state.player.discoveredRingIds).toContain('ring-greenway')
    expect(runtime.advanceFrame([{ type: 'look', yawDelta: 0.01, pitchDelta: 0 }], false)
      .rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(writer.write.mock.calls.map((call) => call[2].kind))
      .toEqual(['fairy-ring-discover/v1', 'frame-batch/v1'])
    expect(decodePublicV34Root(writer.root())).toEqual(writer.root())
  }, 120_000)

  it('resumes from the V34-only tuple without any old store', async () => {
    const writer = writerFor(atRing)
    const first = createPublicV34ControllerRuntime(atRing, writer.write)
    expect(first.advanceFrame([{ type: 'look', yawDelta: 0.01, pitchDelta: 0 }], false)
      .rejections).toEqual([])
    expect(await first.save()).toMatchObject({ status: 'saved' })
    const resumed = createPublicV34ControllerRuntime(first.committed(), writer.write)
    expect(resumed.advanceFrame([{ type: 'look', yawDelta: 0.01, pitchDelta: 0 }], false)
      .rejections).toEqual([])
    expect(await resumed.save()).toMatchObject({ status: 'saved' })
    expect(resumed.committed().head.saveRevision).toBe(2)
    expect(decodePublicV34Root(writer.root())).toEqual(writer.root())
  }, 120_000)

  it('returns home from a trapped post-Highland state, then can move again', async () => {
    const studied = createPublicV34ControllerRuntime(atCrown, writerFor(atCrown).write)
    expect(await studied.action({ kind: 'highland-discover/v1',
      landmarkId: highlandLandmark(seed).id })).toMatchObject({ status: 'saved' })
    const saved = studied.committed()
    const place = { x: 12, z: 4 }
    const support = publicV17StarterSupportAt({ seed,
      profile: saved.head.state.generationProfile,
      route: saved.head.state.greenway.routes.find(({ id }) => id === 'greenway_ladder') ?? null,
      built: saved.head.state.greenway.builtRouteIds.includes('greenway_ladder'),
      greenwayWorks: saved.head.greenwayWorks }, place)
    if (!support || support.kind !== 'ground') throw Error('Missing pit fixture support')
    const trapped: PublicV34Root = { ...atCrown, head: { ...saved.head,
      terrain: { ...saved.head.terrain, columns: [{ gx: 3, gz: 1,
        openDepth: 8, rewardDepth: 8, pitLadder: false }] },
      state: { ...saved.head.state, movementOwner: 'greenway',
        player: { ...saved.head.state.player, verticalVelocity: 0,
          position: { ...place, y: support.floorY } } } }, previous: null }
    expect(applyPublicV26ReturnHome({ state: trapped.head.state,
      greenwayWorks: trapped.head.greenwayWorks, regionalWorks: trapped.head.regionalWorks,
      terrain: trapped.head.terrain, nextHomeAtMs: trapped.head.nextHomeAtMs }, 10_000)
      .progress).toBeDefined()
    let current = structuredClone(trapped)
    const write = vi.fn(async (revision: number, lineage: PublicV34Start['lineage'],
      witness: PublicV33Witness) => {
      const next = replayPublicV33Witness(current.head, witness)!
      current = { lineage, previous: current.head, head: { ...current.head, ...next,
        saveRevision: revision + 1, witness } }
      return { ok: true as const, value: { lineage, head: current.head } }
    })
    const returnHome = vi.fn(async (revision: number, lineage: PublicV34Start['lineage']) => {
      const witness = { kind: 'return-home/v1' as const, atMs: 10_000 }
      const next = replayPublicV33Witness(current.head, witness)!
      current = { lineage, previous: current.head, head: { ...current.head, ...next,
        saveRevision: revision + 1, witness } }
      return { ok: true as const, value: { lineage, head: current.head } }
    })
    const runtime = createPublicV34ControllerRuntime(trapped, write, returnHome)
    expect(await runtime.returnHome()).toMatchObject({ status: 'saved' })
    expect(runtime.preview().state.highland.landmarkDiscovered).toBe(true)
    expect(runtime.preview().state.player.position).toMatchObject({ x: 0, z: 0 })
    expect(runtime.advanceFrame([{ type: 'look', yawDelta: 0.01, pitchDelta: 0 }], false)
      .rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(returnHome).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledOnce()
  }, 120_000)

  it('returns home through the V34 store, reloads, and saves another frame', async () => {
    const place = { x: 12, z: 4 }
    const support = publicV17StarterSupportAt({ seed,
      profile: atRing.head.state.generationProfile,
      route: atRing.head.state.greenway.routes.find(({ id }) => id === 'greenway_ladder') ?? null,
      built: atRing.head.state.greenway.builtRouteIds.includes('greenway_ladder'),
      greenwayWorks: atRing.head.greenwayWorks }, place)
    if (!support || support.kind !== 'ground') throw Error('Missing trapped-site floor')
    const source = { ...atRing.head, schemaVersion: 'wizard-world/v33' as const,
      saveRevision: 1, witness: null,
      terrain: { ...atRing.head.terrain,
        columns: [{ gx: 3, gz: 1, openDepth: 8, rewardDepth: 8, pitLadder: false }] },
      state: { ...atRing.head.state, movementOwner: 'greenway' as const,
        player: { ...atRing.head.state.player, verticalVelocity: 0,
          position: { ...place, y: support.floorY } } } }
    const genesis = createPublicV34Root(source)
    expect(decodePublicV34Root(genesis)).toEqual(genesis)
    const factory = new IDBFactory(), name = 'v34-runtime-return-home'
    const store = createAtomicV34Store(factory, name)
    const locks = { request: async (_name: string, _options: unknown,
      body: () => Promise<unknown>) => body() } as never
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw Error('Expected missing V34 target')
    expect(await store.commit(missing.proof, genesis)).toBe('committed')
    const started: PublicV34Start = { lineage: genesis.lineage, head: genesis.head }
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000)
    try {
      const returned = await requestPublicV34ReturnHome(locks, store, 0, started.lineage)
      expect(returned).toMatchObject({ ok: true, value: { head: { saveRevision: 1 } } })
      if (!returned.ok) throw Error(returned.reason)
      expect(returned.value.head.state.player.position).toMatchObject({ x: 0, z: 0 })
      const reloadedStore = createAtomicV34Store(factory, name)
      const resumed = await resumePublicV34(locks, reloadedStore, 1, returned.value.lineage)
      expect(resumed).toEqual(returned)
      if (!resumed.ok) throw Error(resumed.reason)
      const runtime = createPublicV34ControllerRuntime(resumed.value,
        (revision, lineage, witness) => commitPublicV34(locks, reloadedStore,
          revision, lineage, witness))
      expect(runtime.advanceFrame([{ type: 'look', yawDelta: 0.01, pitchDelta: 0 }], false)
        .rejections).toEqual([])
      expect(await runtime.save()).toMatchObject({ status: 'saved' })
      expect(runtime.committed().head.saveRevision).toBe(2)
      const checked = await reloadedStore.readChecked()
      expect(checked).toMatchObject({ status: 'valid',
        root: { head: { saveRevision: 2 }, previous: { saveRevision: 1 } } })
      if (checked.status !== 'valid') throw Error('Expected valid V34 record')
      expect(Object.keys(checked.root)).toEqual(['lineage', 'head', 'previous'])
      expect(Object.hasOwn(checked.root.lineage, 'sourceReceipt')).toBe(false)
    } finally { now.mockRestore() }
  }, 120_000)

  it('blocks a forged synthetic lineage or extra writer envelope field', async () => {
    const before = structuredClone(atRing)
    for (const forged of ['lineage', 'outer'] as const) {
      const runtime = createPublicV34ControllerRuntime(before, async (revision, _lineage, witness) => {
        const next = replayPublicV33Witness(before.head, witness)!
        const value = { lineage: before.lineage,
          head: { ...before.head, ...next, saveRevision: revision + 1, witness } }
        return { ok: true, value: forged === 'lineage'
          ? { ...value, lineage: { ...before.lineage,
            sourceReceipt: { lineage: { simulationOnly: 'v34' } } } as never }
          : { ...value, previous: before.head } }
      })
      expect(runtime.advanceFrame([{ type: 'look', yawDelta: 0.01, pitchDelta: 0 }], false)
        .rejections).toEqual([])
      expect(await runtime.save()).toEqual({ status: 'blocked', reason: 'writer-mismatch' })
      expect(runtime.committed()).toEqual({ head: before.head, lineage: before.lineage })
    }
  }, 120_000)
})
