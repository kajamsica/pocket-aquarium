import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { beforeAll, describe, expect, it } from 'vitest'
import { backpackSlotsUsed } from './backpackSlots'
import { createAtomicV8Store } from './atomicV8Database'
import { createAtomicV9Store } from './atomicV9Database'
import { createAtomicV10Store } from './atomicV10Database'
import { createAtomicV11Store } from './atomicV11Database'
import { createAtomicV12Store } from './atomicV12Database'
import { encodeDiscoveredTileIds } from './discoveryMask'
import { confirmCompactPublicTerrainWork, confirmPublicTerrainWork,
  previewPublicTerrainWork } from './publicTerrainWorkAction'
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
import { encodePublicV11Head } from './publicWorldV11Snapshot'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { withPublicV11Highland } from './publicWorldV11State'
import { migratePublicV11ToV12 } from './publicWorldV12Flow'
import { isValidPublicWorldV12State, withPublicV12Windstep } from './publicWorldV12State'
import type { PublicWorldV12State } from './publicWorldV12State'
import { createPublicV13MigrationHeadWithSource,
  decodePublicV13HeadWithSource } from './publicWorldV13Snapshot'
import type { PublicV13Head } from './publicWorldV13Snapshot'
import { createPublicV13SourceReader } from './publicWorldV13SourceReader'
import type { PublicV13SourceLease } from './publicWorldV13SourceReader'
import { emptyTerrainWorkLedger } from './terrainWorkLedger'
import { resolveTerrainWorkSite } from './terrainWorks'
import { worldTileAtGrid } from './worldChunks'

const seed = 'greenway-alpha'
const bridgeId = 'works1:bridge:-102:92:z'
const ladderId = 'works1:ladder:-103:108:W'
const digId = 'tile--64-76'
const base = withPublicV12Windstep(withPublicV11Highland(withPublicV10TerrainRevision(
  withFreshPublicV9Camps(withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1'))))))
const site = (id: string) => {
  const found = resolveTerrainWorkSite(seed, id)
  if (!found) throw new Error(`Missing canonical fixture ${id}`)
  return found
}
const at = (id: string): PublicWorldV12State => {
  const found = site(id)
  const target = found.kind === 'dig' ? found.center : found.from
  const seen = found.kind === 'dig' ? found.footprintTileIds[0] : found.footprintTileIds[1]
  const state: PublicWorldV12State = { ...base, movementOwner: 'streamed',
    discoveredTileIds: [...new Set([...base.discoveredTileIds, seen])].sort(),
    player: { ...base.player, position: { ...target }, verticalVelocity: 0,
      backpackCapacity: 30,
      inventory: [...base.player.inventory.filter((stack) => stack.itemId !== 'logs'
        && stack.itemId !== 'field_spade'), { itemId: 'logs', quantity: 12 },
        { itemId: 'field_spade', quantity: 1 }],
      equipment: { ...base.player.equipment, mainHand: 'field_spade' } } }
  if (!isValidPublicWorldV12State(state, null)) throw new Error('Invalid action fixture.')
  return state
}
const unchanged = (state: PublicWorldV12State, id: unknown, code: string,
  ledger = emptyTerrainWorkLedger()) => {
  const before = JSON.stringify([state, ledger])
  const result = confirmPublicTerrainWork(state, ledger, null, id)
  expect(result.rejection).toBe(code)
  expect(result.state).toBe(state)
  expect(result.ledger).toBe(ledger)
  expect(JSON.stringify([state, ledger])).toBe(before)
}

async function activeLease() {
  const factory = new FakeFactory()
  const fresh = withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1'))
  const bytes = serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA, saveRevision: 4,
    bootstrap: null, migrationSourceV6Bytes: null, state: fresh })
  const values = new Map([[PUBLIC_V7_ROOT_KEY, bytes]])
  const storage = { getItem: (key: string) => values.get(key) ?? null }
  const locks = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
    callback: () => Promise<T>) => callback() }
  const v8 = createAtomicV8Store(factory), v9 = createAtomicV9Store(factory)
  const v10 = createAtomicV10Store(factory), v11 = createAtomicV11Store(factory)
  const v12 = createAtomicV12Store(factory)
  if (!(await migratePublicV7ToV8(storage, locks, v8, bytes)).ok) throw new Error('v8 fixture')
  const r9 = { sourceV8Head: encodePublicV8Head(fresh, null, 0), sourceV7Bytes: bytes }
  const s9 = withFreshPublicV9Camps(fresh)
  if (!(await migratePublicV8ToV9(storage, locks, v8, v9, r9)).ok) throw new Error('v9 fixture')
  const r10 = { sourceV9Head: encodePublicV9Head(s9, null, 0), sourceV9Lineage: r9 }
  const s10 = withPublicV10TerrainRevision(s9)
  if (!(await migratePublicV9ToV10(storage, locks, v8, v9, v10, r10)).ok) throw new Error('v10 fixture')
  const r11 = { sourceV10Head: encodePublicV10Head(s10, null, 0), sourceV10Lineage: r10 }
  const s11 = withPublicV11Highland(s10)
  if (!(await migratePublicV10ToV11(storage, locks, v8, v9, v10, v11, r11)).ok) throw new Error('v11 fixture')
  const r12 = { sourceV11Head: encodePublicV11Head(s11, null, 0), sourceV11Receipt: r11 }
  if (!(await migratePublicV11ToV12(storage, locks, v8, v9, v10, v11, v12, r12)).ok) {
    throw new Error('v12 fixture')
  }
  const reader = createPublicV13SourceReader(factory, storage, v8, v9, v10, v11, v12)
  const selected = await reader.readUnderLock()
  if (!selected.ok || selected.value.status !== 'v12') throw new Error('Missing source')
  const lease = reader.consumeProof(selected.value.proof)
  if (!lease) throw new Error('Missing source lease')
  return { reader, lease }
}

describe('unmounted public terrain-work action', () => {
  it.each([[bridgeId, 8, 80], [ladderId, 4, 60]] as const)(
    'builds %s with real logs and construction XP, without changing its v12 source', (id, cost, xp) => {
      const state = at(id), ledger = emptyTerrainWorkLedger(), before = structuredClone(state)
      expect(previewPublicTerrainWork(state, ledger, null, id).rejection).toBeNull()
      const result = confirmPublicTerrainWork(state, ledger, null, id)
      expect(result.rejection).toBeUndefined()
      expect(result.event).toEqual({ type: 'terrain_work_built', id, tick: state.tick,
        sequence: state.eventSequence + 1, logsSpent: cost, stoneGained: 0, xp })
      expect(result.state.player.inventory.filter((stack) => stack.itemId === 'logs')
        .reduce((sum, stack) => sum + stack.quantity, 0)).toBe(12 - cost)
      expect(result.state.player.skillXp.construction).toBe(state.player.skillXp.construction + xp)
      expect(result.state.player.xp).toBe(state.player.xp + xp)
      expect(result.state.player.level).toBe(1 + Math.floor(result.state.player.xp / 100))
      expect(result.ledger.builtWorkIds).toEqual([id])
      expect(result.state.discoveredTileIds).not.toBe(state.discoveredTileIds)
      expect(isValidPublicWorldV12State(result.state, null)).toBe(true)
      expect(state).toEqual(before)
      unchanged(result.state, id, 'already_done', result.ledger)
    })

  it('digs suitable dry ground with an owned equipped spade, bag space and real stone', () => {
    const state = at(digId), ledger = emptyTerrainWorkLedger()
    const result = confirmPublicTerrainWork(state, ledger, null, digId)
    expect(result.event).toEqual({ type: 'terrain_work_dug', id: digId, tick: state.tick,
      sequence: state.eventSequence + 1, logsSpent: 0, stoneGained: 1, xp: 30 })
    expect(result.ledger.dugTileIds).toEqual([digId])
    expect(result.state.player.inventory.filter((stack) => stack.itemId === 'stone')
      .reduce((sum, stack) => sum + stack.quantity, 0)).toBe(1)
    expect(result.state.player.skillXp.excavation).toBe(state.player.skillXp.excavation + 30)
    unchanged(result.state, digId, 'already_done', result.ledger)
  })

  it('rechecks a stale preview against current discovery, reach, logs, spade and capacity', () => {
    const state = at(bridgeId), bridge = site(bridgeId)
    expect(previewPublicTerrainWork(state, emptyTerrainWorkLedger(), null, bridgeId).rejection).toBeNull()
    if (bridge.kind === 'dig') throw new Error('Expected bridge fixture.')
    unchanged({ ...state, player: { ...state.player, position: { ...bridge.approach } },
      discoveredTileIds: [...new Set([...state.discoveredTileIds, bridge.footprintTileIds[0]])].sort() },
    bridgeId, 'too_far')
    const nearUndiscovered = { ...state,
      discoveredTileIds: [...new Set([...base.discoveredTileIds, bridge.footprintTileIds[0]])].sort(),
      player: { ...state.player, position: { ...bridge.approach,
        x: bridge.approach.x + 0.4 * (bridge.from.x - bridge.approach.x),
        z: bridge.approach.z + 0.4 * (bridge.from.z - bridge.approach.z) } } }
    expect(isValidPublicWorldV12State(nearUndiscovered, null)).toBe(true)
    unchanged(nearUndiscovered, bridgeId, 'undiscovered')
    const short = { ...state, player: { ...state.player,
      inventory: state.player.inventory.map((stack) => stack.itemId === 'logs'
        ? { ...stack, quantity: 7 } : stack) } }
    unchanged(short, bridgeId, 'not_owned')
    const dig = at(digId)
    unchanged({ ...dig, player: { ...dig.player,
      equipment: { ...dig.player.equipment, mainHand: null } } }, digId, 'requires_spade')
    const used = backpackSlotsUsed(dig.player.inventory, dig.player.tradeSlots)
    const full = { ...dig, player: { ...dig.player, backpackCapacity: used } }
    expect(isValidPublicWorldV12State(full, null)).toBe(true)
    unchanged(full, digId, 'capacity')
  })

  it('rejects invalid state, ledger, owner, malformed/wet ID and authored occupancy', () => {
    const state = at(bridgeId)
    unchanged({ ...state, unexpected: true } as never, bridgeId, 'invalid_progress')
    const hidden = { ...state }
    Object.defineProperty(hidden, 'unexpected', { value: true })
    unchanged(hidden, bridgeId, 'invalid_progress')
    unchanged(base, bridgeId, 'unavailable_here')
    unchanged(state, { id: bridgeId }, 'invalid_site')
    unchanged(state, worldTileAtGrid(seed, -102, 92).id, 'invalid_site')
    unchanged(state, bridgeId, 'invalid_ledger', { builtWorkIds: [bridgeId, bridgeId], dugTileIds: [] })
    const exhausted = { ...state, eventSequence: Number.MAX_SAFE_INTEGER }
    expect(isValidPublicWorldV12State(exhausted, null)).toBe(true)
    unchanged(exhausted, bridgeId, 'invalid_value')
    const routeId = 'mireglass_reach/route/fen_bridge/-98/92'
    const approachDig = 'tile--95-93'
    const approachState = at(approachDig)
    const occupied: PublicWorldV12State = { ...approachState,
      player: { ...approachState.player, xp: approachState.player.xp + 80,
        level: 1 + Math.floor((approachState.player.xp + 80) / 100),
        skillXp: { ...approachState.player.skillXp,
          construction: approachState.player.skillXp.construction + 80 } },
      mireglass: { ...approachState.mireglass,
      builtRoutes: { ...approachState.mireglass.builtRoutes, bridge: routeId } } }
    expect(isValidPublicWorldV12State(occupied, null)).toBe(true)
    unchanged(occupied, approachDig, 'occupied')
  })
  it('fails closed on a ledger Proxy whose descriptor and get values disagree', () => {
    const state = at(bridgeId), ledger = new Proxy(emptyTerrainWorkLedger(), {
      get(target, key, receiver) {
        return key === 'builtWorkIds' ? null : Reflect.get(target, key, receiver)
      },
    })
    expect(previewPublicTerrainWork(state, ledger, null, bridgeId).rejection).toBe('invalid_ledger')
    const result = confirmPublicTerrainWork(state, ledger, null, bridgeId)
    expect(result.rejection).toBe('invalid_ledger')
    expect(result.state).toBe(state)
    expect(result.ledger).toBe(ledger)
  })
  it('fails closed when a validator-accepted state Proxy cannot be cloned', () => {
    const state = new Proxy(at(bridgeId), {})
    expect(isValidPublicWorldV12State(state, null)).toBe(true)
    unchanged(state, bridgeId, 'invalid_progress')
  })
  it('never charges an event against a different inventory snapshot', () => {
    const state = at(bridgeId), rich = structuredClone(state.player.inventory)
    const poor = rich.filter((stack) => stack.itemId !== 'logs')
    let reads = 0, richUntil = Number.POSITIVE_INFINITY
    const player = { ...state.player }
    Object.defineProperty(player, 'inventory', { enumerable: true, configurable: true,
      get: () => ++reads <= richUntil ? rich : poor })
    const forged = { ...state, player }
    expect(previewPublicTerrainWork(forged, emptyTerrainWorkLedger(), null, bridgeId).rejection)
      .toBeNull()
    richUntil = reads
    reads = 0
    const result = confirmPublicTerrainWork(forged, emptyTerrainWorkLedger(), null, bridgeId)
    expect(result.rejection).toBeUndefined()
    expect(result.event?.logsSpent).toBe(8)
    expect(result.state.player.inventory.find((stack) => stack.itemId === 'logs')?.quantity).toBe(4)
  })
})

describe('lease-validated compact v13 terrain-work candidate', () => {
  let lease: PublicV13SourceLease
  let reader: Awaited<ReturnType<typeof activeLease>>['reader']
  beforeAll(async () => ({ reader, lease } = await activeLease()))
  const compactAt = (id: string): PublicV13Head => {
    const { discoveredTileIds, ...state } = at(id)
    const migrated = createPublicV13MigrationHeadWithSource(lease)
    if (!migrated) throw new Error('Missing migration head')
    const head = decodePublicV13HeadWithSource({ ...migrated, saveRevision: 1,
      state: { ...state, discoveryMask: encodeDiscoveredTileIds(discoveredTileIds),
        terrainWorks: emptyTerrainWorkLedger() } }, lease)
    if (!head) throw new Error(`Invalid compact action fixture: ${id}`)
    return head
  }
  const rejected = (head: unknown, id: unknown, code: string,
    sourceLease: PublicV13SourceLease = lease) => {
    const before = structuredClone(head)
    const result = confirmCompactPublicTerrainWork(head, sourceLease, id)
    expect(result).toEqual({ rejection: code })
    expect(head).toEqual(before)
  }

  it.each([[bridgeId, 8, 80], [ladderId, 4, 60], [digId, 0, 30]] as const)(
    'returns a detached validated rev+1 candidate for %s', (id, cost, xp) => {
      const head = compactAt(id), before = structuredClone(head)
      const result = confirmCompactPublicTerrainWork(head, lease, id)
      expect(result.rejection).toBeUndefined()
      if (!result.head || !result.event) throw new Error('Expected candidate')
      expect(result.head).toEqual(decodePublicV13HeadWithSource(result.head, lease))
      expect(result.head.saveRevision).toBe(head.saveRevision + 1)
      expect(result.head.state.player.position.y).toBe(head.state.player.position.y)
      expect(result.head.state.discoveryMask).not.toBe(head.state.discoveryMask)
      expect(result.event).toEqual({ type: id === digId ? 'terrain_work_dug' : 'terrain_work_built',
        id, tick: head.state.tick, sequence: head.state.eventSequence + 1,
        logsSpent: cost, stoneGained: Number(id === digId), xp })
      expect(result.head.state.player.xp).toBe(head.state.player.xp + xp)
      expect(result.head.state.player.skillXp[id === digId ? 'excavation' : 'construction'])
        .toBe(head.state.player.skillXp[id === digId ? 'excavation' : 'construction'] + xp)
      expect(result.head.state.player.inventory.filter((stack) => stack.itemId === 'logs')
        .reduce((sum, stack) => sum + stack.quantity, 0)).toBe(12 - cost)
      expect(result.head.state.player.inventory.filter((stack) => stack.itemId === 'stone')
        .reduce((sum, stack) => sum + stack.quantity, 0)).toBe(Number(id === digId))
      expect(result.head.state.terrainWorks[id === digId ? 'dugTileIds' : 'builtWorkIds'])
        .toEqual([id])
      const legacy = confirmPublicTerrainWork(at(id), emptyTerrainWorkLedger(), null, id)
      expect(result.event).toEqual(legacy.event)
      expect(result.head.state.player).toEqual(legacy.state.player)
      expect(result.head.state.terrainWorks).toEqual(legacy.ledger)
      expect(head).toEqual(before)
      rejected(result.head, id, 'already_done')
    })

  it('rejects absent resources and bag capacity from the validated compact snapshot', () => {
    const bridge = compactAt(bridgeId), dig = compactAt(digId)
    rejected({ ...bridge, state: { ...bridge.state, player: { ...bridge.state.player,
      inventory: bridge.state.player.inventory.map((stack) => stack.itemId === 'logs'
        ? { ...stack, quantity: 7 } : stack) } } }, bridgeId, 'not_owned')
    rejected({ ...dig, state: { ...dig.state, player: { ...dig.state.player,
      equipment: { ...dig.state.player.equipment, mainHand: null } } } }, digId, 'requires_spade')
    const used = backpackSlotsUsed(dig.state.player.inventory, dig.state.player.tradeSlots)
    rejected({ ...dig, state: { ...dig.state, player: { ...dig.state.player,
      backpackCapacity: used } } }, digId, 'capacity')
  })

  it('requires the canonical discovered site within three meters of original Y', () => {
    const head = compactAt(bridgeId)
    rejected(head, worldTileAtGrid(seed, -102, 92).id, 'invalid_site')
    rejected(head, { id: bridgeId }, 'invalid_site')
    const mask = encodeDiscoveredTileIds([...new Set([
      ...base.discoveredTileIds, site(bridgeId).footprintTileIds[0]])].sort())
    const bridge = site(bridgeId)
    if (bridge.kind === 'dig') throw new Error('Expected bridge fixture')
    const near = { ...bridge.approach,
      x: bridge.approach.x + 0.4 * (bridge.from.x - bridge.approach.x),
      z: bridge.approach.z + 0.4 * (bridge.from.z - bridge.approach.z) }
    rejected({ ...head, state: { ...head.state, discoveryMask: mask,
      player: { ...head.state.player, position: near } } }, bridgeId, 'undiscovered')
    const originalY = head.state.player.position.y
    const raised = { ...head, state: { ...head.state, player: { ...head.state.player,
      position: { ...head.state.player.position, y: originalY + 3.01 } } } }
    expect(decodePublicV13HeadWithSource(raised, lease)).not.toBeNull()
    rejected(raised, bridgeId, 'too_far')
  })

  it('rejects a canonical dig site occupied by an authored built route', () => {
    const id = 'tile--95-93', head = compactAt(id)
    const xp = head.state.player.xp + 80
    const occupied = { ...head, state: { ...head.state,
      player: { ...head.state.player, xp, level: 1 + Math.floor(xp / 100),
        skillXp: { ...head.state.player.skillXp,
          construction: head.state.player.skillXp.construction + 80 } },
      mireglass: { ...head.state.mireglass,
        builtRoutes: { ...head.state.mireglass.builtRoutes,
          bridge: 'mireglass_reach/route/fen_bridge/-98/92' } } } }
    expect(decodePublicV13HeadWithSource(occupied, lease)).not.toBeNull()
    rejected(occupied, id, 'occupied')
  })

  it('rejects forged or stale leases, malformed heads, duplicate work and revision overflow', async () => {
    const head = compactAt(bridgeId)
    rejected(head, bridgeId, 'invalid_progress', {} as PublicV13SourceLease)
    rejected(head, bridgeId, 'invalid_progress', structuredClone(lease))
    rejected({ ...head, state: { ...head.state, discoveryMask: new Uint8Array(1) } },
      bridgeId, 'invalid_progress')
    rejected({ ...head, state: { ...head.state, terrainWorks: {
      builtWorkIds: [bridgeId, bridgeId], dugTileIds: [] } } }, bridgeId, 'invalid_progress')
    rejected({ ...head, saveRevision: Number.MAX_SAFE_INTEGER }, bridgeId, 'invalid_value')
    const built = confirmCompactPublicTerrainWork(head, lease, bridgeId).head!
    rejected(built, bridgeId, 'already_done')
    await reader.readUnderLock()
    rejected(head, bridgeId, 'invalid_progress')
  })
})
