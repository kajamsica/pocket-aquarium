import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createAtomicV8Store } from './atomicV8Database'
import { createAtomicV9Store } from './atomicV9Database'
import { createAtomicV10Store } from './atomicV10Database'
import { createAtomicV11Store } from './atomicV11Database'
import { createAtomicV12Store } from './atomicV12Database'
import { encodeDiscoveredTileIds, DISCOVERY_MASK_BYTES } from './discoveryMask'
import { createFreshPublicWorld } from './publicWorldState'
import { PUBLIC_V7_ROOT_KEY, PUBLIC_V7_SCHEMA, serializePublicV7World,
  withFreshPublicV7Herbs } from './publicWorldV7'
import { migratePublicV7ToV8 } from './publicWorldV8Flow'
import { encodePublicV8Head } from './publicWorldV8Snapshot'
import { migratePublicV8ToV9 } from './publicWorldV9Flow'
import { encodePublicV9Head } from './publicWorldV9Snapshot'
import { migratePublicV9ToV10 } from './publicWorldV10Flow'
import { encodePublicV10Head } from './publicWorldV10Snapshot'
import { migratePublicV10ToV11 } from './publicWorldV11Flow'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { encodePublicV11Head, PUBLIC_V11_SCHEMA } from './publicWorldV11Snapshot'
import * as v11Snapshot from './publicWorldV11Snapshot'
import { withPublicV11Highland } from './publicWorldV11State'
import { validatePublicWorldV12CompactState } from './publicWorldV12CompactValidation'
import { encodePublicV12Head, PUBLIC_V12_SCHEMA } from './publicWorldV12Snapshot'
import * as v12Snapshot from './publicWorldV12Snapshot'
import { withPublicV12Windstep } from './publicWorldV12State'
import { migratePublicV11ToV12 } from './publicWorldV12Flow'
import { provePublicWorldV13Pose } from './publicWorldV13Pose'
import { createPublicV13MigrationHead, decodePublicV13Head, decodePublicV13SourceLineage,
  encodePublicV13Head, PUBLIC_V13_SCHEMA, createPublicV13MigrationHeadWithSource,
  decodePublicV13HeadWithSource } from './publicWorldV13Snapshot'
import { createPublicV13SourceReader, resolvePublicV13SourceLease } from './publicWorldV13SourceReader'
import type { PublicV13SourceLease } from './publicWorldV13SourceReader'
import { appendTerrainWorkLedger, emptyTerrainWorkLedger } from './terrainWorkLedger'
import { terrainWorkSupportAt } from './terrainWorkSupport'
import { resolveTerrainWorkSite } from './terrainWorks'

const seed = 'greenway-alpha'
const v11 = withPublicV11Highland(withPublicV10TerrainRevision(withFreshPublicV9Camps(
  withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1')))))
const v12 = withPublicV12Windstep(v11)
const source11 = { sourceSchemaVersion: PUBLIC_V11_SCHEMA as typeof PUBLIC_V11_SCHEMA,
  sourceHead: encodePublicV11Head(v11, null, 3) }
const source12 = { sourceSchemaVersion: PUBLIC_V12_SCHEMA as typeof PUBLIC_V12_SCHEMA,
  sourceHead: encodePublicV12Head(v12, null, 4) }
const bridgeId = 'works1:bridge:-102:92:z'
const ladderId = 'works1:ladder:-103:108:W'
const digId = 'tile--64-76'
const context = { seed, fieldCampTileIds: [], authoredBuiltRouteIds: [] }
const works = (id: string) => appendTerrainWorkLedger(emptyTerrainWorkLedger(), id, context)!
const clone = <T>(value: T): T => structuredClone(value)
const site = (id: string) => {
  const result = resolveTerrainWorkSite(seed, id)
  if (!result) throw new Error(`Missing fixture: ${id}`)
  return result
}
function placed(id: string, t = 0.55) {
  const found = site(id)
  const point = found.kind === 'dig' ? found.loweredCenter : {
    x: found.from.x + (found.to.x - found.from.x) * t,
    z: found.from.z + (found.to.z - found.from.z) * t,
  }
  const y = found.kind === 'dig' ? found.loweredCenter.y
    : terrainWorkSupportAt(found, point).floorY!
  const discoveredTileIds = [...new Set([...v12.discoveredTileIds, ...found.footprintTileIds])].sort()
  const { discoveredTileIds: _ids, ...compact } = v12
  return { ...compact, movementOwner: 'streamed' as const,
    player: { ...compact.player, position: { ...point, y }, verticalVelocity: -0.1 },
    discoveryMask: encodeDiscoveredTileIds(discoveredTileIds), terrainWorks: works(id) }
}

async function sourceLease(schema: 'v11' | 'v12') {
  const factory = new FakeFactory()
  const base = withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1'))
  const bytes = serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA, saveRevision: 4,
    bootstrap: null, migrationSourceV6Bytes: null, state: base })
  const values = new Map([[PUBLIC_V7_ROOT_KEY, bytes]])
  const storage = { getItem: (key: string) => values.get(key) ?? null }
  const locks = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
    callback: () => Promise<T>) => callback() }
  const v8 = createAtomicV8Store(factory), v9 = createAtomicV9Store(factory)
  const v10 = createAtomicV10Store(factory), v11 = createAtomicV11Store(factory)
  const v12 = createAtomicV12Store(factory)
  if (!(await migratePublicV7ToV8(storage, locks, v8, bytes)).ok) throw new Error('v8 fixture')
  const r9 = { sourceV8Head: encodePublicV8Head(base, null, 0), sourceV7Bytes: bytes }
  const s9 = withFreshPublicV9Camps(base)
  if (!(await migratePublicV8ToV9(storage, locks, v8, v9, r9)).ok) throw new Error('v9 fixture')
  const r10 = { sourceV9Head: encodePublicV9Head(s9, null, 0), sourceV9Lineage: r9 }
  const s10 = withPublicV10TerrainRevision(s9)
  if (!(await migratePublicV9ToV10(storage, locks, v8, v9, v10, r10)).ok) throw new Error('v10 fixture')
  const r11 = { sourceV10Head: encodePublicV10Head(s10, null, 0), sourceV10Lineage: r10 }
  const s11 = withPublicV11Highland(s10)
  if (!(await migratePublicV10ToV11(storage, locks, v8, v9, v10, v11, r11)).ok) throw new Error('v11 fixture')
  if (schema === 'v12') {
    const r12 = { sourceV11Head: encodePublicV11Head(s11, null, 0), sourceV11Receipt: r11 }
    if (!(await migratePublicV11ToV12(storage, locks, v8, v9, v10, v11, v12, r12)).ok) {
      throw new Error('v12 fixture')
    }
  }
  const reader = createPublicV13SourceReader(factory, storage, v8, v9, v10, v11, v12)
  const selected = await reader.readUnderLock()
  if (!selected.ok || selected.value.status !== schema) throw new Error('Missing selected source')
  const lease = reader.consumeProof(selected.value.proof)
  if (!lease) throw new Error('Missing source lease')
  return { reader, lease }
}

describe('unmounted v13 compact head codec', () => {
  it('migrates exact selected v11 and v12 heads at revision zero with an empty ledger', () => {
    for (const source of [source11, source12]) {
      const lineage = decodePublicV13SourceLineage(source)
      expect(lineage).not.toBeNull()
      const migrated = createPublicV13MigrationHead(source)!
      expect(migrated.schemaVersion).toBe(PUBLIC_V13_SCHEMA)
      expect(migrated.saveRevision).toBe(0)
      expect(migrated.state.terrainWorks).toEqual({ builtWorkIds: [], dugTileIds: [] })
      expect(decodePublicV13Head(migrated, source)).toEqual(migrated)
      expect(encodePublicV13Head(migrated.state, null, 0, lineage!)).toEqual(migrated)
      expect(migrated.state.windstep).toEqual(v12.windstep)
      expect(migrated.state.discoveryMask).toEqual(source.sourceHead.state.discoveryMask)
    }
  })
  it('rejects extra, hidden, and malformed keys, bad ledger and altered rev0 source state', () => {
    const head = createPublicV13MigrationHead(source12)!
    expect(decodePublicV13Head({ ...head, extra: 1 }, source12)).toBeNull()
    expect(decodePublicV13Head({ ...head, state: { ...head.state, extra: 1 } }, source12)).toBeNull()
    expect(decodePublicV13Head(head, { ...source12, extra: 1 })).toBeNull()
    expect(decodePublicV13SourceLineage({ ...source12, sourceSchemaVersion: PUBLIC_V11_SCHEMA })).toBeNull()
    expect(decodePublicV13Head({ ...head, state: { ...head.state, tick: head.state.tick + 1 } }, source12)).toBeNull()
    expect(decodePublicV13Head({ ...head, state: { ...head.state,
      terrainWorks: { builtWorkIds: [bridgeId, bridgeId], dugTileIds: [] } } }, source12)).toBeNull()
    expect(decodePublicV13Head({ ...head, state: { ...head.state,
      terrainWorks: { builtWorkIds: ['works1:bridge:9999:9999:z'], dugTileIds: [] } } }, source12)).toBeNull()
    const hidden = clone(head)
    Object.defineProperty(hidden, 'extra', { value: 1 })
    expect(decodePublicV13Head(hidden, source12)).toBeNull()
    const accessor = clone(head)
    Object.defineProperty(accessor, 'state', { enumerable: true, get: () => head.state })
    expect(decodePublicV13Head(accessor, source12)).toBeNull()
  })
  it('roundtrips useful bridge, ladder and suitable dig without projecting persisted Y', () => {
    for (const id of [bridgeId, ladderId, digId]) {
      const state = placed(id)
      const originalY = state.player.position.y
      const head = encodePublicV13Head(state, null, 1, source12)
      expect(head.state.player.position.y).toBe(originalY)
      expect(head.state.player.verticalVelocity).toBe(-0.1)
      expect(decodePublicV13Head(head, source12)?.state.player.position.y).toBe(originalY)
      if (id !== bridgeId) {
        expect(validatePublicWorldV12CompactState((({ terrainWorks: _works, ...inherited }) => inherited)(state), null))
          .toBeNull()
      }
    }
  })
  it('stores original lower-side ladder Y, never its projected v12 validation witness', () => {
    const state = placed(ladderId)
    const { terrainWorks, ...inherited } = state
    const proof = provePublicWorldV13Pose(inherited, terrainWorks)!
    expect(proof.witness.player.position.y).toBeGreaterThan(state.player.position.y)
    const head = encodePublicV13Head(state, null, 1, source12)
    expect(head.state.player.position.y).toBe(state.player.position.y)
    expect(head.state.player.position.y).not.toBe(proof.witness.player.position.y)
  })
  it('rejects bad v13 effective pose and remains detached from caller mutation', () => {
    const head = encodePublicV13Head(placed(ladderId), null, 1, source12)
    const bad = clone(head)
    bad.state.player.position.y -= 0.001
    expect(decodePublicV13Head(bad, source12)).toBeNull()
    const owned = decodePublicV13Head(head, source12)!
    const originalY = owned.state.player.position.y
    head.state.player.position.y += 10
    head.state.discoveryMask[0] ^= 1
    expect(owned.state.player.position.y).toBe(originalY)
    expect(owned.state.discoveryMask[0]).not.toBe(head.state.discoveryMask[0])
  })
  it('rejects oversized typed backing before copying its mask', () => {
    const head = createPublicV13MigrationHead(source12)!
    const mask = new Uint8Array(new ArrayBuffer(5 * 1024 * 1024), 0, DISCOVERY_MASK_BYTES)
    const spy = vi.spyOn(globalThis, 'structuredClone')
    try {
      expect(decodePublicV13Head({ ...head, state: { ...head.state, discoveryMask: mask } }, source12))
        .toBeNull()
      expect(spy).not.toHaveBeenCalled()
    } finally { spy.mockRestore() }
  })
  it('rejects a shared mask instead of returning an aliased head', () => {
    if (typeof SharedArrayBuffer !== 'function') return
    const head = createPublicV13MigrationHead(source12)!
    const shared = new Uint8Array(new SharedArrayBuffer(DISCOVERY_MASK_BYTES))
    shared.set(head.state.discoveryMask)
    expect(decodePublicV13Head({ ...head, state: { ...head.state,
      discoveryMask: shared } }, source12)).toBeNull()
  })

  it('stops at the second nested mask before copying it or cloning the source', () => {
    const head = createPublicV13MigrationHead(source12)!
    const first = new Uint8Array(head.state.discoveryMask)
    const second = new Uint8Array(head.state.discoveryMask)
    const copied: unknown[] = []
    const native = Uint8Array
    vi.stubGlobal('Uint8Array', new Proxy(native, { construct(target, args, newTarget) {
      copied.push(args[0])
      return Reflect.construct(target, args, newTarget)
    } }))
    const cloneSpy = vi.spyOn(globalThis, 'structuredClone')
    try {
      expect(decodePublicV13Head({ ...head, state: { ...head.state,
        player: { ...head.state.player, extraMask: first }, discoveryMask: second } }, source12)).toBeNull()
      expect(copied).toContain(first)
      expect(copied).not.toContain(second)
      expect(cloneSpy).not.toHaveBeenCalled()
    } finally { cloneSpy.mockRestore(); vi.unstubAllGlobals() }
  })
  it('rejects revision-positive source mask, camp, clock, Highland and wind regressions', () => {
    const head = { ...createPublicV13MigrationHead(source12)!, saveRevision: 1 }
    const source = (state: typeof v12) => ({ ...source12, sourceHead: encodePublicV12Head(state, null, 5) })
    const camp = 'tile--76-100'
    const discovered = { ...v12, discoveredTileIds: [...v12.discoveredTileIds, camp].sort() }
    const highland = { ...v12.highland, landmarkDiscovered: true }
    expect(decodePublicV13Head(head, source12)).not.toBeNull()
    expect(decodePublicV13Head(head, source(discovered))).toBeNull()
    const campCurrent = { ...head, state: { ...head.state,
      discoveryMask: encodeDiscoveredTileIds(discovered.discoveredTileIds) } }
    expect(decodePublicV13Head(campCurrent, source(discovered))).not.toBeNull()
    expect(decodePublicV13Head(campCurrent, source({ ...discovered, fieldCampTileIds: [camp] }))).toBeNull()
    expect(decodePublicV13Head(head, source({ ...v12, tick: 1, eventSequence: 1 }))).toBeNull()
    expect(decodePublicV13Head(head, source({ ...v12, highland }))).toBeNull()
    const current = { ...head, state: { ...head.state, highland } }
    expect(decodePublicV13Head(current, source({ ...v12, highland }))).not.toBeNull()
    expect(decodePublicV13Head(current, source({ ...v12, highland,
      windstep: { ...v12.windstep, learned: true } }))).toBeNull()
  })
  it('matches strict cold rev0/revN heads for both authentic leases without old decoder calls', async () => {
    for (const schema of ['v11', 'v12'] as const) {
      const { lease } = await sourceLease(schema)
      const lineage = resolvePublicV13SourceLease(lease)!
      const cold = createPublicV13MigrationHead(lineage)!
      const next = { ...cold, saveRevision: 1 }
      const coldNext = decodePublicV13Head(next, lineage)
      const old11 = vi.spyOn(v11Snapshot, 'decodePublicV11Head')
      const old12 = vi.spyOn(v12Snapshot, 'decodePublicV12Head')
      try {
        expect(createPublicV13MigrationHeadWithSource(lease)).toEqual(cold)
        expect(decodePublicV13HeadWithSource(next, lease)).toEqual(coldNext)
        expect(old11).not.toHaveBeenCalled()
        expect(old12).not.toHaveBeenCalled()
      } finally { old11.mockRestore(); old12.mockRestore() }
    }
  })
  it('rejects forged, cloned, revoked and stale leases plus invalid head facts', async () => {
    const { reader, lease } = await sourceLease('v12')
    const head = createPublicV13MigrationHeadWithSource(lease)!
    const forged = {} as PublicV13SourceLease
    const cloned = structuredClone(lease) as PublicV13SourceLease
    for (const invalid of [forged, cloned]) {
      expect(createPublicV13MigrationHeadWithSource(invalid)).toBeNull()
      expect(decodePublicV13HeadWithSource(head, invalid)).toBeNull()
    }
    expect(decodePublicV13HeadWithSource({ ...head, extra: 1 }, lease)).toBeNull()
    expect(decodePublicV13HeadWithSource({ ...head, state: { ...head.state,
      terrainWorks: { builtWorkIds: [bridgeId, bridgeId], dugTileIds: [] } } }, lease)).toBeNull()
    reader.revoke(lease)
    expect(createPublicV13MigrationHeadWithSource(lease)).toBeNull()
    expect(decodePublicV13HeadWithSource(head, lease)).toBeNull()
    const fresh = await sourceLease('v11')
    const stale = fresh.lease
    expect((await fresh.reader.readUnderLock()).ok).toBe(true)
    expect(createPublicV13MigrationHeadWithSource(stale)).toBeNull()
    expect(decodePublicV13HeadWithSource(head, stale)).toBeNull()
  })
})
