import { describe, expect, it } from 'vitest'
import { createPublicV45ControllerRuntime } from './PublicV45ControllerRuntime'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { createFreshPublicV42Root, decodePublicV42Root, PUBLIC_V42_SCHEMA }
  from './domain/publicWorldV42Snapshot'
import type { PublicV42Root } from './domain/publicWorldV42Snapshot'
import { createPublicV43Root, decodePublicV43CheckedSuccessor,
  decodePublicV43Root, replayPublicV43Witness, PUBLIC_V43_SCHEMA }
  from './domain/publicWorldV43Snapshot'
import type { PublicV43Root } from './domain/publicWorldV43Snapshot'
import { createPublicV44Root } from './domain/publicWorldV44Snapshot'
import { confirmPublicV45Action } from './domain/publicWorldV45RideAction'
import { createPublicV45Genesis, PUBLIC_V45_SCHEMA }
  from './domain/publicWorldV45Migration'
import { decodePublicV45Root } from './domain/publicWorldV45Snapshot'
import type { PublicV45Root, PublicV45Witness } from './domain/publicWorldV45Snapshot'
import { resolveSedgehornFamiliarSite } from './domain/sedgehornFamiliarContent'
import { sameStrictBoundedRaw } from './domain/strictBoundedRaw'
import { waystationRiverSite } from './domain/waystationRiverContent'
import { WORLD_CELL_METERS, worldTileAtGrid } from './domain/worldChunks'

function matureSource(): PublicV43Root {
  const seed = 'wizard-realms'
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
        ...bridge.footprintTileIds, ...nearby])].sort()),
      player: { ...fresh.head.state.player, position: { ...site.keeper.center },
        verticalVelocity: 0 } } }
  const v42: PublicV42Root = { lineage: { origin: 'v41-migration',
    rulesProfile: 'iron-hall-rewards/v1', seed, sourceRevision: 4, genesis },
    previous: null, head: { ...structuredClone(genesis), schemaVersion: PUBLIC_V42_SCHEMA,
      saveRevision: 0, witness: null } }
  if (!decodePublicV42Root(v42)) throw new Error('Invalid V42 fixture')
  let root = createPublicV43Root(v42)
  const idle = { kind: 'frame-batch/v1' as const,
    frames: [{ intents: [], walkRequested: true }] }
  for (let index = 0; index < 3; index++) {
    const progress = replayPublicV43Witness(root.head, idle)!
    root = decodePublicV43CheckedSuccessor(root, { lineage: root.lineage,
      previous: root.head, head: { ...progress, schemaVersion: PUBLIC_V43_SCHEMA,
        saveRevision: root.head.saveRevision + 1, witness: idle } })!
  }
  const careWitnesses = [0, 600, 1200].map((tick, index) => ({
    kind: 'sedgehorn-care/v1' as const, tick, eventSequence: index + 1 }))
  const claimed = (head: PublicV43Root['head']) => ({ ...head,
    familiar: { ...head.familiar, phase: 'claimed' as const,
      routeChoice: 'shelter' as const, position: { ...site.keeper.center },
      trust: 2, creatureCareXp: 40, stationKnown: true },
    mountTraining: { careWitnesses }, state: { ...head.state,
      player: { ...head.state.player, position: { ...site.keeper.center },
        coins: head.state.player.coins + 25, xp: head.state.player.xp + 40,
        level: 1 + Math.floor((head.state.player.xp + 40) / 100) } } })
  const checked = decodePublicV43Root({ ...root,
    previous: claimed(root.previous!), head: claimed(root.head) })
  if (!checked) throw new Error('Invalid mature V43 fixture')
  return checked
}

describe('V45 controller runtime', () => {
  it('keeps assisted preview transient and writes one checked bounded ride batch', async () => {
    const genesis = createPublicV45Genesis(createPublicV44Root(matureSource()))
    let current: PublicV45Root = genesis
    const writes: PublicV45Witness[] = []
    const runtime = createPublicV45ControllerRuntime(genesis,
      async (revision, lineage, witness) => {
        writes.push(witness)
        if (revision !== current.head.saveRevision
          || !sameStrictBoundedRaw(lineage, current.lineage, 3 << 20))
          return { ok: false, reason: 'revision-changed' }
        const { schemaVersion: _schema, saveRevision: _revision,
          witness: _prior, ...before } = current.head
        const checked = confirmPublicV45Action(before, witness)
        if (!checked.progress) return { ok: false, reason: checked.rejection }
        const next = decodePublicV45Root({ lineage: current.lineage,
          previous: current.head, head: { ...checked.progress,
            schemaVersion: PUBLIC_V45_SCHEMA, saveRevision: revision + 1, witness } })
        if (!next) return { ok: false, reason: 'invalid-successor' }
        current = next
        return { ok: true, value: { head: next.head, lineage: next.lineage } }
      })
    expect(runtime.advanceFrame([], true).rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(writes.at(-1)?.kind).toBe('frame-batch/v1')
    expect(await runtime.action({ kind: 'sedgehorn-mount/v1' })).toMatchObject({
      status: 'saved' })
    const count = writes.length
    const frame = [{ type: 'move' as const, delta: { x: 0.12, z: 0 } }]
    const initial = runtime.preview().state.player.position.x
    expect(runtime.advanceFrame(frame, false).rejections).toEqual([])
    expect(runtime.advanceFrame(frame, false).rejections).toEqual([])
    expect(runtime.preview().state.player.position.x).toBeGreaterThan(initial + 0.3)
    expect(writes).toHaveLength(count)
    const beforeBad = runtime.preview().state.player.position
    expect(await runtime.action({ kind: 'buy-sedgehorn-tack/v1' }))
      .toMatchObject({ status: 'rejected' })
    expect(writes).toHaveLength(count)
    expect(runtime.preview().state.player.position).toEqual(beforeBad)
    expect(runtime.advanceFrame([{ type: 'move', delta: { x: 9, z: 0 } }], false)
      .rejections).toHaveLength(1)
    expect(runtime.preview().state.player.position).toEqual(beforeBad)
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(writes).toHaveLength(count + 1)
    expect(writes.at(-1)).toMatchObject({ kind: 'sedgehorn-assisted-ride-batch/v1',
      frames: [{ kind: 'sedgehorn-assisted-ride-frame/v1' },
        { kind: 'sedgehorn-assisted-ride-frame/v1' }] })
    expect(runtime.committed().head.state.player.position)
      .toEqual(runtime.preview().state.player.position)
  }, 30_000)
})
