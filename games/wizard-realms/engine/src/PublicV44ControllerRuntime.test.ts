import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { publicV14MovementIntents } from './PublicV14Controller'
import { createPublicV43ControllerRuntime } from './PublicV43ControllerRuntime'
import { createPublicV44ControllerRuntime } from './PublicV44ControllerRuntime'
import { choosePublicV44Entry, inspectPublicV44Entry } from './PublicV44Entry'
import { createAtomicV43Store } from './domain/atomicV43Database'
import { createAtomicV44Store } from './domain/atomicV44Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { createFreshPublicV42Root, PUBLIC_V42_SCHEMA } from './domain/publicWorldV42Snapshot'
import type { PublicV42Root } from './domain/publicWorldV42Snapshot'
import { commitPublicV44, requestPublicV44ReturnHome } from './domain/publicWorldV44Flow'
import { createPublicV44Root } from './domain/publicWorldV44Snapshot'
import { createPublicV43Root, decodePublicV43CheckedSuccessor,
  decodePublicV43Root, PUBLIC_V43_DATABASE_NAME,
  PUBLIC_V43_SCHEMA, replayPublicV43Witness } from './domain/publicWorldV43Snapshot'
import type { PublicV43Root } from './domain/publicWorldV43Snapshot'
import { resolveSedgehornFamiliarSite } from './domain/sedgehornFamiliarContent'
import { waystationRiverSite } from './domain/waystationRiverContent'
import { WORLD_CELL_METERS, worldTileAtGrid } from './domain/worldChunks'

const seed = 'wizard-realms'
const locks = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
  body: () => T | Promise<T>): Promise<T> => body() }
const idle = { kind: 'frame-batch/v1' as const,
  frames: [{ intents: [], walkRequested: true }] }

/** A decoder-checked mature source, without replaying the entire quest in this bridge test. */
function matureSource(boots = false): PublicV43Root {
  const fresh = createFreshPublicV42Root(seed)
  const site = resolveSedgehornFamiliarSite(fresh.head)!
  const bridge = waystationRiverSite(seed)!
  const nearby: string[] = []
  for (const tile of [site.tracks, site.shelter, site.dryApproach, site.keeper]) {
    const gx = Math.round(tile.center.x / WORLD_CELL_METERS)
    const gz = Math.round(tile.center.z / WORLD_CELL_METERS)
    for (let x = gx - 1; x <= gx + 1; x++)
      for (let z = gz - 1; z <= gz + 1; z++)
        nearby.push(worldTileAtGrid(seed, x, z).id)
  }
  const genesis = { ...fresh.lineage.genesis, southbankReached: true,
    riverBridgeIds: [bridge.id], state: { ...fresh.head.state,
      tick: 1300, eventSequence: 10, movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(fresh.head.state.discoveryMask),
        ...bridge.footprintTileIds, ...nearby,
      ])].sort()), player: { ...fresh.head.state.player,
        position: { ...site.keeper.center }, verticalVelocity: 0 } } }
  const v42: PublicV42Root = { lineage: { origin: 'v41-migration',
    rulesProfile: 'iron-hall-rewards/v1', seed, sourceRevision: 4, genesis },
  previous: null, head: { ...structuredClone(genesis), schemaVersion: PUBLIC_V42_SCHEMA,
    saveRevision: 0, witness: null } }
  let v43 = createPublicV43Root(v42)
  for (let index = 0; index < 3; index++) {
    const progress = replayPublicV43Witness(v43.head, idle)!
    v43 = decodePublicV43CheckedSuccessor(v43, { lineage: v43.lineage,
      previous: v43.head, head: { ...progress, schemaVersion: PUBLIC_V43_SCHEMA,
        saveRevision: v43.head.saveRevision + 1, witness: idle } })!
  }
  const careWitnesses = [0, 600, 1200].map((tick, index) => ({
    kind: 'sedgehorn-care/v1' as const, tick, eventSequence: index + 1 }))
  const mature = (head: PublicV43Root['head']) => ({ ...head,
    familiar: { ...head.familiar, phase: 'claimed' as const,
      routeChoice: 'shelter' as const, position: { ...site.keeper.center },
      trust: 2, creatureCareXp: 40, stationKnown: true },
    mountTraining: { careWitnesses }, state: { ...head.state,
      player: { ...head.state.player, coins: head.state.player.coins + 25,
        inventory: boots ? [...head.state.player.inventory,
          { itemId: 'leather_boots' as const, quantity: 1 }]
          : head.state.player.inventory,
        equipment: boots ? { ...head.state.player.equipment,
          feet: 'leather_boots' as const } : head.state.player.equipment,
        xp: head.state.player.xp + 40,
        level: 1 + Math.floor((head.state.player.xp + 40) / 100) } } })
  const checked = decodePublicV43Root({ ...v43,
    previous: mature(v43.previous!), head: mature(v43.head) })
  if (!checked) throw new Error('Mature fixture is invalid')
  return checked
}

function trappedSource(): PublicV43Root {
  const source = matureSource()
  const point = { x: 12, z: 4 }
  const support = publicV17StarterSupportAt({ seed,
    profile: source.head.state.generationProfile,
    route: source.head.state.greenway.routes.find((entry) =>
      entry.id === 'greenway_ladder') ?? null,
    built: false, greenwayWorks: source.head.greenwayWorks }, point)
  if (!support || support.kind !== 'ground') throw new Error('Missing pit floor')
  const trapped = (head: PublicV43Root['head']) => ({ ...head,
    terrain: { ...head.terrain, columns: [{ gx: 3, gz: 1,
      openDepth: 8, rewardDepth: 8, pitLadder: false }] },
    state: { ...head.state, movementOwner: 'greenway' as const,
      player: { ...head.state.player, verticalVelocity: 0,
        position: { ...point, y: support.floorY } } } })
  const checked = decodePublicV43Root({ ...source,
    previous: trapped(source.previous!), head: trapped(source.head) })
  if (!checked) throw new Error('Trapped fixture is invalid')
  return checked
}

function hiddenBoundarySource() {
  const base = matureSource(true)
  const center = base.head.state.player.position
  const gx = Math.round(center.x / WORLD_CELL_METERS)
  const gz = Math.round(center.z / WORLD_CELL_METERS)
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const edge = { x: center.x + dx * 1.85, y: center.y,
      z: center.z + dz * 1.85 }
    const floor = resolvePublicV23Surface(base.head.state, edge,
      base.head.regionalWorks.builtLadderIds)
    if (floor?.support !== 'terrain') continue
    edge.y = floor.floorY
    const next = { x: edge.x + dx * 0.24, z: edge.z + dz * 0.24 }
    const destination = resolvePublicV23Surface(base.head.state, next,
      base.head.regionalWorks.builtLadderIds)
    const hiddenId = worldTileAtGrid(seed, gx + dx, gz + dz).id
    if (destination?.support !== 'terrain' || destination.tileId !== hiddenId) continue
    const hiddenMask = (mask: Uint8Array) => encodeDiscoveredTileIds(
      decodeDiscoveredTileIds(mask).filter((id) => id !== hiddenId))
    const hide = (head: PublicV43Root['head']) => ({ ...head,
      state: { ...head.state,
        discoveryMask: hiddenMask(head.state.discoveryMask),
        player: { ...head.state.player, position: { ...edge } } } })
    const source = decodePublicV43Root({ ...base, lineage: { ...base.lineage,
      genesis: { ...base.lineage.genesis, state: { ...base.lineage.genesis.state,
        discoveryMask: hiddenMask(base.lineage.genesis.state.discoveryMask) } } },
      previous: hide(base.previous!), head: hide(base.head) })
    if (!source) continue
    const intents = [{ type: 'move' as const,
      delta: { x: dx * 0.24, z: dz * 0.24 } }]
    const shell = createPublicV43ControllerRuntime({ head: source.head,
      lineage: source.lineage }, async () => ({ ok: false,
      reason: 'revision-changed' }))
    const step = shell.advanceFrame(intents, false)
    if (!step.rejections.length) return { source, intents }
  }
  throw new Error('No shell-accepted hidden boundary in mature fixture')
}

async function setup(source: PublicV43Root) {
  const factory = new IDBFactory()
  const v43Store = createAtomicV43Store(factory), store = createAtomicV44Store(factory)
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(PUBLIC_V43_DATABASE_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('records')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite')
    tx.objectStore('records').put(source, 'root')
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
  db.close()
  const bindings = { locks, store, v43Store }
  const decision = await inspectPublicV44Entry(bindings)
  if (decision.status !== 'migration-available') throw new Error('Missing V44 handoff')
  const chosen = await choosePublicV44Entry(decision, 'migrate', bindings)
  if (!chosen.ok) throw new Error(chosen.reason)
  const runtime = createPublicV44ControllerRuntime(chosen.value,
    (revision, lineage, witness) => commitPublicV44(locks, store, v43Store,
      revision, lineage, witness),
    (revision, lineage) => requestPublicV44ReturnHome(locks, store, v43Store,
      revision, lineage))
  return { factory, bindings, runtime }
}

describe('V44 checked controller bridge', () => {
  it('previews a mature mount, batches mounted frames, saves once, and dismounts', async () => {
    const { runtime, bindings } = await setup(matureSource(true))
    expect(runtime.groundMount()).toMatchObject({ mode: 'parked', mature: true,
      visible: true })
    expect(await runtime.action({ kind: 'sedgehorn-mount/v1' }))
      .toMatchObject({ status: 'saved' })
    expect(runtime.groundMount().mode).toBe('riding')
    for (let index = 0; index < 32; index++) {
      const vector: readonly [number, number] = index === 0 ? [1, 0]
        : index % 2 ? [0, 1] : [0, -1]
      const intents = publicV14MovementIntents(runtime.view().player.yaw,
        vector, 0.24)
      expect(runtime.advanceFrame(intents, false).rejections).toEqual([])
    }
    expect(runtime.status()).toMatchObject({ pendingFrames: 32,
      checkpointRequired: true, gate: 'cap-paused' })
    expect(runtime.advanceFrame([], false).rejections).toHaveLength(1)
    expect(runtime.committed().head.saveRevision).toBe(1)
    const previewBeforeSave = runtime.preview()
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(runtime.committed().head.v43.head.state).toEqual(previewBeforeSave.state)
    expect(runtime.committed().head.witness).toMatchObject({
      kind: 'sedgehorn-ride-batch/v1', frames: Array.from({ length: 32 }, () => ({
        kind: 'sedgehorn-ride-frame/v2' })) })
    expect(runtime.status().pendingFrames).toBe(0)
    const saved = await bindings.store.readChecked()
    if (saved.status !== 'valid') throw new Error('Mounted V44 save failed checked read')
    const resumed = createPublicV44ControllerRuntime({ head: saved.root.head,
      lineage: saved.root.lineage }, (revision, lineage, witness) =>
      commitPublicV44(locks, bindings.store, bindings.v43Store,
        revision, lineage, witness))
    expect(resumed.groundMount().mode).toBe('riding')
    expect(resumed.view().player.position).toEqual(runtime.view().player.position)
    expect(await resumed.action({ kind: 'sedgehorn-dismount/v1' }))
      .toMatchObject({ status: 'saved' })
    expect(resumed.groundMount().mode).toBe('parked')
    expect(await bindings.store.readChecked()).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 3, groundMount: { mode: 'parked' } } } })
  }, 120_000)

  it('uses a writer-minted Return Home after the V43 source is fenced', async () => {
    const { runtime, bindings } = await setup(trappedSource())
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10_000)
    try {
      expect(await runtime.returnHome()).toMatchObject({ status: 'saved' })
      expect(runtime.committed().head.witness).toEqual({ kind: 'return-home/v1',
        atMs: 10_000 })
      expect(runtime.view().player.position).toMatchObject({ x: 0, z: 0 })
      expect(await runtime.returnHome()).toEqual({ status: 'rejected', reason: 'cooldown' })
      expect(runtime.status().gate).toBe('open')
      expect(await bindings.store.readChecked()).toMatchObject({ status: 'valid',
        root: { head: { saveRevision: 1,
          witness: { kind: 'return-home/v1', atMs: 10_000 } } } })
    } finally { clock.mockRestore() }
  }, 20_000)

  it('requires dismount before Return Home and preserves pending ride frames', async () => {
    const { runtime } = await setup(matureSource())
    expect(await runtime.action({ kind: 'sedgehorn-mount/v1' }))
      .toMatchObject({ status: 'saved' })
    expect(runtime.advanceFrame([], true).rejections).toEqual([])
    expect(await runtime.returnHome()).toEqual({ status: 'rejected',
      reason: 'must-dismount' })
    expect(runtime.status().pendingFrames).toBe(1)
  }, 20_000)

  it('rolls back a V44-only rejected step without losing accepted ride frames', async () => {
    const { source, intents } = hiddenBoundarySource()
    const { runtime } = await setup(source)
    expect(await runtime.action({ kind: 'sedgehorn-mount/v1' }))
      .toMatchObject({ status: 'saved' })
    expect(runtime.advanceFrame([], false).rejections).toEqual([])
    const before = runtime.preview()
    expect(runtime.status().pendingFrames).toBe(1)
    expect(runtime.advanceFrame(intents, false).rejections).toMatchObject([
      { code: 'terrain_missing' }])
    expect(runtime.preview()).toEqual(before)
    expect(runtime.status()).toMatchObject({ pendingFrames: 1, gate: 'open' })
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(runtime.committed().head.witness).toMatchObject({
      kind: 'sedgehorn-ride-batch/v1', frames: [{ kind: 'sedgehorn-ride-frame/v2' }] })
  }, 30_000)

  it('freezes on a checked writer conflict without changing the committed mount state', async () => {
    const root = createPublicV44Root(matureSource())
    const runtime = createPublicV44ControllerRuntime({ head: root.head,
      lineage: root.lineage }, async () => ({ ok: false, reason: 'revision-changed' }))
    expect(await runtime.action({ kind: 'sedgehorn-mount/v1' }))
      .toEqual({ status: 'blocked', reason: 'revision-changed' })
    expect(runtime.status().gate).toBe('blocked')
    expect(runtime.committed().head).toEqual(root.head)
  }, 20_000)
})
