import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { mireglassAnchors } from './mireglassContent'
import { createFreshPublicV42Root, decodePublicV42Root, PUBLIC_V42_SCHEMA }
  from './publicWorldV42Snapshot'
import type { PublicV42Root } from './publicWorldV42Snapshot'
import { createPublicV43Root, decodePublicV43CheckedSuccessor,
  decodePublicV43Root, replayPublicV43Witness, PUBLIC_V43_SCHEMA }
  from './publicWorldV43Snapshot'
import type { PublicV43Root, PublicV43Witness } from './publicWorldV43Snapshot'
import { confirmPublicV44GroundMountAction } from './publicWorldV44GroundMount'
import { createPublicV44Root, decodePublicV44Root, PUBLIC_V44_SCHEMA }
  from './publicWorldV44Snapshot'
import { confirmPublicV45Action, confirmPublicV45RideFrame,
  PUBLIC_V45_MAX_RIDE_BATCH }
  from './publicWorldV45RideAction'
import type { PublicV45RideFrameWitness } from './publicWorldV45RideAction'
import { createPublicV45Genesis, PUBLIC_V45_SCHEMA } from './publicWorldV45Migration'
import { decodePublicV45CheckedSuccessor, decodePublicV45Root,
  decodePublicV45Witness } from './publicWorldV45Snapshot'
import type { PublicV45Root, PublicV45Witness } from './publicWorldV45Snapshot'
import { resolveSedgehornFamiliarSite } from './sedgehornFamiliarContent'
import { waystationRiverSite } from './waystationRiverContent'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const seed = 'wizard-realms'
const idle = { kind: 'frame-batch/v1' as const,
  frames: [{ intents: [], walkRequested: true }] }
const ride = (x: number): PublicV45RideFrameWitness => ({
  kind: 'sedgehorn-assisted-ride-frame/v1', intents: [{ type: 'move', delta: { x, z: 0 } }],
})

function eligibleSource(atTracks = false): PublicV42Root {
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
        position: { ...(atTracks ? site.tracks.center : site.keeper.center) },
        verticalVelocity: 0 } } }
  const source: PublicV42Root = { lineage: { origin: 'v41-migration',
    rulesProfile: 'iron-hall-rewards/v1', seed, sourceRevision: 4, genesis },
    previous: null, head: { ...structuredClone(genesis),
      schemaVersion: PUBLIC_V42_SCHEMA, saveRevision: 0, witness: null } }
  expect(decodePublicV42Root(source)).not.toBeNull()
  return source
}

function matureRoot(boots: boolean): PublicV43Root {
  let root = createPublicV43Root(eligibleSource())
  for (let i = 0; i < 3; i++) {
    const progress = replayPublicV43Witness(root.head, idle)!
    root = decodePublicV43CheckedSuccessor(root, { lineage: root.lineage,
      previous: root.head, head: { ...progress, schemaVersion: PUBLIC_V43_SCHEMA,
        saveRevision: root.head.saveRevision + 1, witness: idle } })!
  }
  const site = resolveSedgehornFamiliarSite(root.head)!
  const careWitnesses = [0, 600, 1200].map((tick, index) => ({
    kind: 'sedgehorn-care/v1' as const, tick, eventSequence: index + 1 }))
  const claimed = (head: PublicV43Root['head']) => ({ ...head,
    familiar: { ...head.familiar, phase: 'claimed' as const,
      routeChoice: 'shelter' as const, position: { ...site.keeper.center },
      trust: 2, creatureCareXp: 40, stationKnown: true },
    mountTraining: { careWitnesses },
    greenwayOrder: { claimedAtSequence: null },
    greenwayBagUpgrade: { claimedAtSequence: null },
    state: { ...head.state, player: { ...head.state.player,
      position: { ...site.keeper.center },
      inventory: boots ? [...head.state.player.inventory, { itemId: 'leather_boots' as const,
        quantity: 1 }] : head.state.player.inventory,
      equipment: boots ? { ...head.state.player.equipment, feet: 'leather_boots' as const }
        : head.state.player.equipment,
      coins: head.state.player.coins + 25, xp: head.state.player.xp + 40,
      level: 1 + Math.floor((head.state.player.xp + 40) / 100) } } })
  const checked = decodePublicV43Root({ ...root,
    previous: claimed(root.previous!), head: claimed(root.head) })
  expect(checked).not.toBeNull()
  return checked!
}

function mountedGenesis(boots = false): PublicV45Root {
  const parked = createPublicV44Root(matureRoot(boots))
  const witness = { kind: 'sedgehorn-mount/v1' as const }
  const mounted = confirmPublicV44GroundMountAction({ v43: parked.head.v43,
    groundMount: parked.head.groundMount }, witness).progress
  expect(mounted?.groundMount.mode).toBe('riding')
  const source = decodePublicV44Root({ lineage: parked.lineage,
    previous: parked.head, head: { ...mounted,
      schemaVersion: PUBLIC_V44_SCHEMA, saveRevision: 1, witness } })
  expect(source).not.toBeNull()
  const genesis = createPublicV45Genesis(source!)
  expect(genesis.head.tack).toBe('legacy')
  return genesis
}

function economyGenesis(region: 'greenway' | 'mireglass'): PublicV45Root {
  const root = matureRoot(false)
  const salvager = mireglassAnchors(seed).salvager.tile
  const store = root.head.state.greenway.stores.find(({ id }) => id === 'store-greenway')!
  const position = region === 'greenway' ? store.position : salvager.center
  const ready = (head: PublicV43Root['head']) => ({ ...head,
    mountTraining: region === 'greenway'
      ? { careWitnesses: head.mountTraining!.careWitnesses.slice(0, 2) }
      : head.mountTraining,
    state: { ...head.state,
      movementOwner: region === 'greenway' ? 'greenway' as const : 'streamed' as const,
      discoveryMask: region === 'mireglass'
        ? encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(head.state.discoveryMask), salvager.id])].sort())
        : head.state.discoveryMask,
      player: { ...head.state.player, position: { ...position }, coins: 300,
        inventory: region === 'mireglass'
          ? [...head.state.player.inventory, { itemId: 'marsh_herb' as const,
            quantity: 3 }] : head.state.player.inventory } } })
  const imported = decodePublicV43Root({ ...root,
    previous: ready(root.previous!), head: ready(root.head) })
  expect(imported).not.toBeNull()
  return createPublicV45Genesis(createPublicV44Root(imported!))
}

/** Retained pair after the earlier care and travel edges have been evicted. */
function purchaseReadyRoot(): PublicV45Root {
  const genesis = economyGenesis('greenway')
  const care = { kind: 'sedgehorn-care/v1' as const,
    tick: genesis.head.state.tick, eventSequence: genesis.head.state.eventSequence + 1 }
  const previous = { ...genesis.head, saveRevision: 3, witness: idle,
    mountTraining: { careWitnesses: [...genesis.head.mountTraining!.careWitnesses, care] },
    state: { ...genesis.head.state, eventSequence: care.eventSequence } }
  const { schemaVersion: _schema, saveRevision: _revision,
    witness: _prior, ...flat } = previous
  const progress = confirmPublicV45Action(flat, idle).progress!
  const root = decodePublicV45Root({ lineage: genesis.lineage, previous,
    head: { ...progress, schemaVersion: PUBLIC_V45_SCHEMA,
      saveRevision: 4, witness: idle } })
  expect(root).not.toBeNull()
  return root!
}

function next(before: PublicV45Root, witness: PublicV45Witness): PublicV45Root {
  const { schemaVersion: _schema, saveRevision: _revision,
    witness: _prior, ...flat } = before.head
  const progress = confirmPublicV45Action(flat, witness).progress
  expect(progress).toBeDefined()
  const checked = decodePublicV45CheckedSuccessor(before, { lineage: before.lineage,
    previous: before.head, head: { ...progress, schemaVersion: PUBLIC_V45_SCHEMA,
      saveRevision: before.head.saveRevision + 1, witness } })
  expect(checked).not.toBeNull()
  return checked!
}

describe('V45 checked assisted-ride root', () => {
  it('replays parked V43 frame and familiar action without changing V44 lineage', () => {
    const source = createPublicV44Root(createPublicV43Root(eligibleSource(true)))
    const genesis = createPublicV45Genesis(source)
    const saved = structuredClone(genesis)
    const first = next(genesis, { kind: 'familiar-tracks/v1' })
    expect(first.head.familiar.phase).toBe('tracks')
    expect(first.head.groundMount).toEqual(genesis.head.groundMount)
    expect(first.head.tack).toBe(genesis.head.tack)
    expect(first.lineage.source).toEqual(source)
    expect(decodePublicV45Root(structuredClone(first))).toEqual(first)
    const second = next(first, idle)
    expect(second.head.state.tick).toBe(first.head.state.tick + 1)
    expect(second.previous).toEqual(first.head)
    expect(decodePublicV45Root(structuredClone(second))).toEqual(second)
    expect(genesis).toEqual(saved)
    for (const playerChange of [
      { coins: first.head.state.player.coins + 100 },
      { position: { ...first.head.state.player.position,
        x: first.head.state.player.position.x + 0.01 } },
    ]) {
      const previous = { ...first.head, state: { ...first.head.state,
        player: { ...first.head.state.player, ...playerChange } } }
      const { schemaVersion: _schema, saveRevision: _revision,
        witness: _prior, ...flat } = previous
      const advanced = confirmPublicV45Action(flat, idle).progress
      expect(advanced).toBeDefined()
      expect(decodePublicV45Root({ lineage: second.lineage, previous,
        head: { ...advanced, schemaVersion: PUBLIC_V45_SCHEMA,
          saveRevision: 2, witness: idle } })).toBeNull()
    }
  }, 30_000)

  it('rejects rollback of an imported mining entitlement after revision one is evicted', () => {
    const eligible = eligibleSource(true)
    const miningTools = { ...eligible.head.miningTools, basicPickOwned: true }
    const source: PublicV42Root = { lineage: { ...eligible.lineage,
      genesis: { ...eligible.lineage.genesis, miningTools } }, previous: null,
    head: { ...eligible.head, miningTools } }
    expect(decodePublicV42Root(source)).not.toBeNull()
    const genesis = createPublicV45Genesis(createPublicV44Root(createPublicV43Root(source)))
    const first = next(genesis, idle)
    const second = next(first, idle)
    const previous = { ...second.head, miningTools: {
      ...second.head.miningTools, basicPickOwned: false } }
    const { schemaVersion: _schema, saveRevision: _revision,
      witness: _prior, ...flat } = previous
    const advanced = confirmPublicV45Action(flat, idle).progress
    expect(advanced).toBeDefined()
    expect(decodePublicV45Root({ lineage: second.lineage, previous,
      head: { ...advanced, schemaVersion: PUBLIC_V45_SCHEMA,
        saveRevision: 3, witness: idle } })).toBeNull()
    expect(decodePublicV45Root(second)).not.toBeNull()
  }, 30_000)

  it('retains imported mount training after early revisions are evicted', () => {
    const genesis = createPublicV45Genesis(createPublicV44Root(matureRoot(false)))
    expect(genesis.head.mountTraining?.careWitnesses).toHaveLength(3)
    const first = next(genesis, idle)
    const second = next(first, idle)
    const { mountTraining: _training, ...previous } = second.head
    const { schemaVersion: _schema, saveRevision: _revision,
      witness: _prior, ...flat } = previous
    const advanced = confirmPublicV45Action(flat, idle).progress
    expect(advanced).toBeDefined()
    expect(decodePublicV45Root({ lineage: second.lineage, previous,
      head: { ...advanced, schemaVersion: PUBLIC_V45_SCHEMA,
        saveRevision: 3, witness: idle } })).toBeNull()
    expect(decodePublicV45Root(second)).not.toBeNull()
  }, 30_000)

  it('accepts a checked parked care append after importing partial V44 training', () => {
    const trained = matureRoot(false)
    const station = resolveSedgehornFamiliarSite(trained.head)!.careStation
    const partial = (head: PublicV43Root['head']) => ({ ...head,
      mountTraining: { careWitnesses: head.mountTraining!.careWitnesses.slice(0, 2) },
      state: { ...head.state, player: { ...head.state.player,
        position: { ...station.center }, inventory: [...head.state.player.inventory,
          { itemId: 'marsh_herb' as const, quantity: 1 }] } } })
    const imported = decodePublicV43Root({ ...trained,
      previous: partial(trained.previous!), head: partial(trained.head) })
    expect(imported).not.toBeNull()
    const source = createPublicV44Root(imported!)
    const genesis = createPublicV45Genesis(source)
    const saved = structuredClone(genesis)
    expect(genesis.head.groundMount.mode).toBe('parked')
    expect(genesis.head.mountTraining?.careWitnesses).toHaveLength(2)
    const witness = { kind: 'sedgehorn-care/v1' as const }
    const { schemaVersion: _schema, saveRevision: _revision,
      witness: _prior, ...flat } = genesis.head
    const action = confirmPublicV45Action(flat, witness)
    expect(action.rejection).toBeUndefined()
    expect(action.events).toEqual([])
    expect(action.progress!.mountTraining!.careWitnesses).toHaveLength(3)
    expect(action.progress!.mountTraining!.careWitnesses.slice(0, 2))
      .toEqual(genesis.head.mountTraining!.careWitnesses)
    expect(action.progress!.state.eventSequence).toBe(genesis.head.state.eventSequence + 1)
    expect(action.progress!.state.player.inventory.some((stack) =>
      stack.itemId === 'marsh_herb')).toBe(false)
    expect(action.progress!.groundMount).toEqual(genesis.head.groundMount)
    expect(action.progress!.tack).toBe(genesis.head.tack)
    const checked = decodePublicV45CheckedSuccessor(genesis, { lineage: genesis.lineage,
      previous: genesis.head, head: { ...action.progress,
        schemaVersion: PUBLIC_V45_SCHEMA, saveRevision: 1, witness } })
    expect(checked).not.toBeNull()
    expect(decodePublicV45Root(structuredClone(checked))).toEqual(checked)
    expect(genesis).toEqual(saved)
    expect(checked!.lineage.source).toEqual(source)
  }, 30_000)

  it('accepts exact imported genesis but no flat or forged tack entitlement', () => {
    const source = createPublicV44Root(createPublicV43Root(eligibleSource()))
    const genesis = createPublicV45Genesis(source)
    expect(decodePublicV45Root(structuredClone(genesis))).toEqual(genesis)
    expect(decodePublicV45Root(genesis.head)).toBeNull()
    expect(decodePublicV45Root({ ...genesis,
      head: { ...genesis.head, tack: 'legacy' } })).toBeNull()
    expect(decodePublicV45Root({ ...genesis,
      head: { ...genesis.head, groundMount: { mode: 'riding', parkedPosition: null } } }))
      .toBeNull()
  })

  it.each([false, true])('replays one and two %s-boot successors with full overlays', (boots) => {
    const genesis = mountedGenesis(boots), saved = structuredClone(genesis)
    const witness = ride(boots ? 0.2 : 0.16)
    const first = next(genesis, witness)
    expect(first.head.saveRevision).toBe(1)
    expect(first.head.state.tick).toBe(genesis.head.state.tick + 1)
    expect(first.head.state.player.position.x - genesis.head.state.player.position.x)
      .toBeCloseTo((boots ? 0.2 : 0.16) * 5 / 3)
    expect(first.head.familiar).toEqual(genesis.head.familiar)
    expect(first.head.mountTraining).toEqual(genesis.head.mountTraining)
    expect(first.head.ironHallReward).toEqual(genesis.head.ironHallReward)
    expect(first.head.greenwayOrder).toEqual(genesis.head.greenwayOrder)
    expect(first.head.greenwayBagUpgrade).toEqual(genesis.head.greenwayBagUpgrade)
    expect(first.head.tack).toBe('legacy')
    expect(decodePublicV45Root(structuredClone(first))).toEqual(first)
    const second = next(first, witness)
    expect(second.head.saveRevision).toBe(2)
    expect(second.head.state.tick).toBe(genesis.head.state.tick + 2)
    expect(second.previous).toEqual(first.head)
    expect(decodePublicV45Root(structuredClone(second))).toEqual(second)
    expect(genesis).toEqual(saved)
  }, 30_000)

  it('accepts exact V45 economy, mount, ride, and V43 witnesses', () => {
    expect(decodePublicV45Witness(ride(0.16))).toEqual(ride(0.16))
    expect(decodePublicV45Witness(idle)).toEqual(idle)
    expect(decodePublicV45Witness({ kind: 'familiar-tracks/v1' }))
      .toEqual({ kind: 'familiar-tracks/v1' })
    for (const witness of [{ kind: 'sedgehorn-mount/v1' },
      { kind: 'sedgehorn-dismount/v1' }, { kind: 'buy-sedgehorn-tack/v1' },
      { kind: 'sell-marsh-herb/v1', quantity: 2 }])
      expect(decodePublicV45Witness(witness)).toEqual(witness)
    for (const invalid of [null, { ...ride(0.16), speed: 2 },
      { kind: 'sedgehorn-mount/v1', speed: 2 },
      { kind: 'buy-sedgehorn-tack/v1', price: 0 },
      { kind: 'sell-marsh-herb/v1', quantity: 0 },
      { kind: 'sell-marsh-herb/v1', quantity: 257 },
      { kind: 'sell-marsh-herb/v1', quantity: 2, unitPrice: 999 },
      { ...ride(0.16), admission: {} }, { ...ride(0), intents: [] },
      { kind: 'sedgehorn-assisted-ride-frame/v1', intents: [{ type: 'jump' }] },
      { kind: 'sedgehorn-assisted-ride-frame/v1', intents: [
        { type: 'move', delta: { x: 0.16, z: 0 } },
        { type: 'look', yawDelta: 0, pitchDelta: 0 }] }])
      expect(decodePublicV45Witness(invalid)).toBeNull()
  })

  it('replays 32 assisted frames as one checked edge and rejects malformed batches', () => {
    const genesis = mountedGenesis()
    const frames = Array.from({ length: PUBLIC_V45_MAX_RIDE_BATCH }, () => ride(0.002))
    const witness = { kind: 'sedgehorn-assisted-ride-batch/v1' as const, frames }
    expect(decodePublicV45Witness(witness)).toEqual(witness)
    const saved = structuredClone(genesis)
    const { schemaVersion: _schema, saveRevision: _revision,
      witness: _prior, ...progress } = genesis.head
    const action = confirmPublicV45Action(progress, witness)
    expect(action.rejection).toBeUndefined()
    expect(action.events?.filter((event) => event.type === 'player_moved'))
      .toHaveLength(PUBLIC_V45_MAX_RIDE_BATCH * 2)
    const checked = next(genesis, witness)
    expect(checked.head.saveRevision).toBe(1)
    expect(checked.head.state.tick).toBe(genesis.head.state.tick + PUBLIC_V45_MAX_RIDE_BATCH)
    expect(checked.previous).toEqual(genesis.head)
    expect(decodePublicV45Root(structuredClone(checked))).toEqual(checked)
    expect(genesis).toEqual(saved)
    const sparse = [ride(0.002), ride(0.002)]
    delete sparse[1]
    const extra = Object.assign([ride(0.002)], { speed: 2 })
    const getter = [ride(0.002)]
    Object.defineProperty(getter, '0', { get: () => ride(0.002), enumerable: true })
    for (const invalid of [{ ...witness, frames: [] },
      { ...witness, frames: [...frames, ride(0.002)] },
      { ...witness, frames: sparse }, { ...witness, frames: extra },
      { ...witness, frames: getter },
      { ...witness, frames: [...frames.slice(0, -1), ride(0)] },
      { ...witness, speed: 2 }]) {
      expect(decodePublicV45Witness(invalid)).toBeNull()
      expect(confirmPublicV45Action(progress, invalid).progress).toBeUndefined()
    }
  }, 60_000)

  it('checks purchase replay and retained tack monotonicity', () => {
    const genesis = economyGenesis('greenway')
    expect(genesis.head.tack).toBe('not_owned')
    const ready = purchaseReadyRoot()
    const source = structuredClone(genesis.lineage.source)
    expect(decodePublicV45Root({ ...ready,
      previous: { ...ready.previous!, tack: 'legacy' },
      head: { ...ready.head, tack: 'legacy' } })).toBeNull()
    const { schemaVersion: _schema, saveRevision: _revision,
      witness: _prior, ...flatReady } = ready.head
    expect(confirmPublicV45Action(flatReady,
      { kind: 'sedgehorn-mount/v1' }).rejection).toBe('tack_required')
    const bought = next(ready, { kind: 'buy-sedgehorn-tack/v1' })
    expect(bought.head.tack).toBe('purchased')
    expect(bought.head.state.player.coins).toBe(60)
    expect(decodePublicV45Root(structuredClone(bought))).toEqual(bought)
    const stale = decodePublicV45CheckedSuccessor(ready, { ...bought,
      previous: bought.head })
    expect(stale).toBeNull()
    expect(decodePublicV45Root({ ...bought,
      head: { ...bought.head, state: { ...bought.head.state,
        player: { ...bought.head.state.player, coins: 300 } } } })).toBeNull()
    expect(decodePublicV45Root({ ...bought,
      head: { ...bought.head, tack: 'legacy' } })).toBeNull()
    const retained = next(bought, idle)
    expect(decodePublicV45Root({ ...retained,
      previous: { ...retained.previous!, tack: 'not_owned' } })).toBeNull()
    expect(decodePublicV45Root({ ...retained,
      head: { ...retained.head, tack: 'not_owned' } })).toBeNull()
    expect(bought.lineage.source).toEqual(source)
    expect(genesis.lineage.source).toEqual(source)
  }, 30_000)

  it('replays dismount and remount without accepting forged mount positions or modes', () => {
    const genesis = mountedGenesis()
    const ridden = next(genesis, ride(0.16))
    const parked = next(ridden, { kind: 'sedgehorn-dismount/v1' })
    expect(parked.head.groundMount).toEqual({ mode: 'parked',
      parkedPosition: parked.head.state.player.position })
    expect(decodePublicV45Root({ ...parked,
      head: { ...parked.head, groundMount: { mode: 'parked',
        parkedPosition: { ...parked.head.groundMount.parkedPosition!, x: 0 } } } }))
      .toBeNull()
    const mounted = next(parked, { kind: 'sedgehorn-mount/v1' })
    expect(mounted.head.groundMount.mode).toBe('riding')
    expect(decodePublicV45Root({ ...mounted,
      head: { ...mounted.head, groundMount: { mode: 'parked', parkedPosition: null } } }))
      .toBeNull()
    expect(decodePublicV45Root(structuredClone(mounted))).toEqual(mounted)
  }, 30_000)

  it('replays a fixed-price marsh herb sale without changing legacy tack or V44', () => {
    const genesis = economyGenesis('mireglass')
    const source = structuredClone(genesis.lineage.source)
    const sold = next(genesis, { kind: 'sell-marsh-herb/v1', quantity: 2 })
    expect(sold.head.tack).toBe('legacy')
    expect(sold.head.state.player.coins).toBe(316)
    expect(sold.head.state.player.inventory.filter(({ itemId }) =>
      itemId === 'marsh_herb')).toEqual([{ itemId: 'marsh_herb', quantity: 1 }])
    expect(decodePublicV45Root(structuredClone(sold))).toEqual(sold)
    expect(decodePublicV45Root({ ...sold,
      head: { ...sold.head, state: { ...sold.head.state,
        player: { ...sold.head.state.player, coins: 324 } } } })).toBeNull()
    expect(sold.lineage.source).toEqual(source)
  }, 30_000)

  it('checks retained revision one against genesis before accepting revision two', () => {
    const genesis = mountedGenesis(true)
    const first = next(genesis, ride(0.2))
    for (const playerChange of [
      { coins: first.head.state.player.coins + 100 },
      { position: { ...first.head.state.player.position,
        x: first.head.state.player.position.x + 0.01 } },
    ]) {
      const previous = { ...first.head, state: { ...first.head.state,
        player: { ...first.head.state.player, ...playerChange } } }
      const { schemaVersion: _schema, saveRevision: _revision,
        witness: _prior, ...flat } = previous
      const advanced = confirmPublicV45RideFrame(flat, ride(0.2)).progress
      expect(advanced).toBeDefined()
      const forged = { lineage: first.lineage, previous,
        head: { ...advanced, schemaVersion: PUBLIC_V45_SCHEMA,
          saveRevision: 2, witness: ride(0.2) } }
      expect(decodePublicV45Root(forged)).toBeNull()
    }
    expect(decodePublicV45Root(next(first, ride(0.2)))).not.toBeNull()
  }, 30_000)

  it('rejects truncated, swapped, forged, cross-seed, and noncontiguous roots', () => {
    const genesis = mountedGenesis(true)
    const first = next(genesis, ride(0.2))
    const second = next(first, ride(0.2))
    const wrong = mountedGenesis(false)
    const bad = [
      { ...first, previous: null },
      { ...first, previous: wrong.head },
      { ...first, head: { ...first.head, saveRevision: 3 } },
      { ...first, head: { ...first.head, tack: 'not_owned' } },
      { ...first, head: { ...first.head, state: { ...first.head.state,
        player: { ...first.head.state.player, position: {
          ...first.head.state.player.position, x: first.head.state.player.position.x + 0.01 } } } } },
      { ...first, head: { ...first.head, familiar: {
        ...first.head.familiar, trust: 3 } } },
      { ...first, head: { ...first.head, witness: ride(0.1) } },
      { ...first, head: { ...first.head, extra: true } },
      { ...first, lineage: { ...first.lineage, seed: 'other' } },
      { ...first, lineage: { ...first.lineage, sourceRevision: 2 } },
      { ...first, lineage: { ...first.lineage, source: {
        ...first.lineage.source, head: { ...first.lineage.source.head, saveRevision: 2 } } } },
      { ...second, previous: genesis.head },
    ]
    for (const raw of bad) expect(decodePublicV45Root(raw)).toBeNull()
    const forgedPrevious = { ...first.head,
      greenwayOrder: { claimedAtSequence: 1 } }
    const { schemaVersion: _schema, saveRevision: _revision,
      witness: _witness, ...flat } = forgedPrevious
    const forgedProgress = confirmPublicV45RideFrame(flat, ride(0.2)).progress
    expect(forgedProgress).toBeDefined()
    expect(decodePublicV45Root({ lineage: second.lineage,
      previous: forgedPrevious, head: { ...forgedProgress,
        schemaVersion: PUBLIC_V45_SCHEMA, saveRevision: 2,
        witness: ride(0.2) } })).toBeNull()
    expect(decodePublicV45CheckedSuccessor(genesis, { ...first,
      previous: wrong.head })).toBeNull()
    expect(decodePublicV45CheckedSuccessor(genesis, { ...first,
      lineage: wrong.lineage })).toBeNull()
  }, 30_000)
})
