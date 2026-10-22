import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { createFreshPublicV42Root, decodePublicV42Root, PUBLIC_V42_SCHEMA }
  from './publicWorldV42Snapshot'
import type { PublicV42Root } from './publicWorldV42Snapshot'
import { createFreshPublicV43Root, createPublicV43Root,
  decodePublicV43CheckedSuccessor, decodePublicV43Progress,
  decodePublicV43Root, replayPublicV43Witness, PUBLIC_V43_SCHEMA }
  from './publicWorldV43Snapshot'
import type { PublicV43Root, PublicV43Witness } from './publicWorldV43Snapshot'
import { confirmPublicV44GroundMountAction } from './publicWorldV44GroundMount'
import { createPublicV44Root, decodePublicV44Root, PUBLIC_V44_SCHEMA }
  from './publicWorldV44Snapshot'
import { createPublicV45Genesis, decodePublicV45Genesis, PUBLIC_V45_SCHEMA }
  from './publicWorldV45Migration'
import { resolveSedgehornFamiliarSite } from './sedgehornFamiliarContent'
import { waystationRiverSite } from './waystationRiverContent'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const seed = 'wizard-realms'
const idle = { kind: 'frame-batch/v1' as const,
  frames: [{ intents: [], walkRequested: true }] }

function eligibleSource(): PublicV42Root {
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
  const source: PublicV42Root = { lineage: { origin: 'v41-migration',
    rulesProfile: 'iron-hall-rewards/v1', seed, sourceRevision: 4, genesis },
    previous: null, head: { ...structuredClone(genesis),
      schemaVersion: PUBLIC_V42_SCHEMA, saveRevision: 0, witness: null } }
  expect(decodePublicV42Root(source)).not.toBeNull()
  return source
}

function next(root: PublicV43Root, witness: PublicV43Witness): PublicV43Root {
  const progress = replayPublicV43Witness(root.head, witness)
  expect(progress).not.toBeNull()
  const checked = decodePublicV43CheckedSuccessor(root, {
    lineage: root.lineage, previous: root.head,
    head: { ...progress!, schemaVersion: PUBLIC_V43_SCHEMA,
      saveRevision: root.head.saveRevision + 1, witness } })
  expect(checked).not.toBeNull()
  return checked!
}

function matureRoot(): PublicV43Root {
  let root = createPublicV43Root(eligibleSource())
  for (let i = 0; i < 3; i++) root = next(root, idle)
  const site = resolveSedgehornFamiliarSite(root.head)!
  const careWitnesses = [0, 600, 1200].map((tick, index) => ({
    kind: 'sedgehorn-care/v1' as const, tick, eventSequence: index + 1 }))
  const claimed = (head: PublicV43Root['head']) => ({ ...head,
    familiar: { ...head.familiar, phase: 'claimed' as const,
      routeChoice: 'shelter' as const, position: { ...site.keeper.center },
      trust: 2, creatureCareXp: 40, stationKnown: true },
    mountTraining: { careWitnesses },
    state: { ...head.state, player: { ...head.state.player,
      position: { ...site.keeper.center },
      coins: head.state.player.coins + 25, xp: head.state.player.xp + 40,
      level: 1 + Math.floor((head.state.player.xp + 40) / 100) } } })
  const checked = decodePublicV43Root({ ...root,
    previous: claimed(root.previous!), head: claimed(root.head) })
  expect(checked).not.toBeNull()
  return checked!
}

describe('V45 checked V44 genesis migration', () => {
  it('pins a fresh parked V44 source, projects only flat V43 progress, and stays detached', () => {
    const source = createPublicV44Root(createFreshPublicV43Root(seed))
    const before = JSON.stringify(source)
    const genesis = createPublicV45Genesis(source)
    const { schemaVersion: _schema, saveRevision: _revision,
      witness: _witness, ...flat } = source.head.v43.head
    expect(genesis.lineage).toEqual({ origin: 'v44-migration', source,
      sourceRevision: source.head.saveRevision, seed })
    expect(genesis.lineage.source).not.toBe(source)
    expect(genesis.head).toEqual({ ...flat,
      groundMount: source.head.groundMount, tack: 'not_owned',
      schemaVersion: PUBLIC_V45_SCHEMA, saveRevision: 0, witness: null })
    expect(decodePublicV43Progress(flat)).toEqual(flat)
    expect(genesis.previous).toBeNull()
    expect(decodePublicV45Genesis(structuredClone(genesis))).toEqual(genesis)
    expect(JSON.stringify(source)).toBe(before)
  })

  it('grandfathers only a mature claimed Sedgehorn, including a riding source', () => {
    const parked = createPublicV44Root(matureRoot())
    expect(createPublicV45Genesis(parked).head.tack).toBe('legacy')
    const witness = { kind: 'sedgehorn-mount/v1' as const }
    const mounted = confirmPublicV44GroundMountAction({ v43: parked.head.v43,
      groundMount: parked.head.groundMount }, witness).progress
    expect(mounted?.groundMount.mode).toBe('riding')
    const source = decodePublicV44Root({ lineage: parked.lineage,
      previous: parked.head, head: { ...mounted,
        schemaVersion: PUBLIC_V44_SCHEMA, saveRevision: 1, witness } })
    expect(source).not.toBeNull()
    const genesis = createPublicV45Genesis(source!)
    expect(genesis.lineage.source).toEqual(source)
    expect(genesis.lineage.sourceRevision).toBe(1)
    expect(genesis.head.groundMount).toEqual(source!.head.groundMount)
    expect(genesis.head.tack).toBe('legacy')
    expect(decodePublicV45Genesis(structuredClone(genesis))).toEqual(genesis)
  })

  it('rejects invalid V44 inputs and any changed genesis, lineage, or source', () => {
    const source = createPublicV44Root(createFreshPublicV43Root(seed))
    expect(() => createPublicV45Genesis({ ...source,
      head: { ...source.head, saveRevision: 1 } })).toThrow(RangeError)
    const genesis = createPublicV45Genesis(source)
    const invalid = [
      { ...genesis, previous: genesis.head },
      { ...genesis, extra: true },
      { ...genesis, lineage: { ...genesis.lineage, seed: 'other' } },
      { ...genesis, lineage: { ...genesis.lineage, sourceRevision: 1 } },
      { ...genesis, lineage: { ...genesis.lineage, extra: true } },
      { ...genesis, lineage: { ...genesis.lineage, source: {
        ...source, head: { ...source.head, saveRevision: 1 } } } },
      { ...genesis, head: { ...genesis.head, tack: 'legacy' } },
      { ...genesis, head: { ...genesis.head, groundMount: {
        mode: 'riding', parkedPosition: null } } },
      { ...genesis, head: { ...genesis.head, schemaVersion: 'wizard-world/v44' } },
      { ...genesis, head: { ...genesis.head, saveRevision: 1 } },
      { ...genesis, head: { ...genesis.head, witness: {} } },
      { ...genesis, head: { ...genesis.head, extra: true } },
    ]
    for (const raw of invalid) expect(decodePublicV45Genesis(raw)).toBeNull()
    expect(decodePublicV45Genesis(genesis)).toEqual(genesis)
  })
})
