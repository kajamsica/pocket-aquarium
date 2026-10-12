import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV30Store } from './atomicV30Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { createPublicV24Root } from './publicWorldV24Snapshot'
import { createPublicV25Root } from './publicWorldV25Snapshot'
import { createPublicV26Root } from './publicWorldV26Snapshot'
import { createPublicV27Root } from './publicWorldV27Snapshot'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import { createPublicV28Root } from './publicWorldV28Snapshot'
import { createPublicV29Root } from './publicWorldV29Snapshot'
import { confirmPublicV30BridgeheadClaim as claim,
  previewPublicV30BridgeheadClaim as preview } from './publicWorldV30BridgeheadAction'
import type { PublicV30Progress } from './publicWorldV30Migration'
import { createPublicV30Root, decodePublicV30CheckedSuccessor,
  decodePublicV30Root, decodePublicV30Witness,
  replayPublicV30Witness } from './publicWorldV30Snapshot'

const seed = 'wizard-realms'
const ids = ['works3:bridge:1', 'works4:bridge:greenway-creek:0',
  'works6:river-bridge:-14'] as const

function sourceRoot() {
  const v23 = createPublicV23Root(seed)
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
  return createPublicV29Root({ head: v28.head, lineage: v28.lineage })
}

const v29 = sourceRoot()
const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
  ...v29Progress } = v29.head
const genesis: PublicV30Progress = { ...v29Progress, claimedBridgeheadId: null }

function atFarExit(id: string, owned = false): PublicV30Progress {
  const initial = structuredClone(genesis)
  const greenway = resolvePublicV17GreenwaySite(seed, id)
  const site = greenway?.kind === 'bridge' ? greenway
    : resolvePublicV28RiverBridge(seed, id)
  if (!site) throw new Error(`Missing bridge ${id}`)
  const old = site.obstacle === 'greenway_creek'
  const greenwayWorks = old ? { ...initial.greenwayWorks, builtBridgeIds: [id] }
    : initial.greenwayWorks
  const floor = old ? publicV17StarterSupportAt({ seed,
    profile: initial.state.generationProfile,
    route: initial.state.greenway.routes[0] ?? null,
    built: false, greenwayWorks }, site.exit)?.floorY
    : resolvePublicV23Surface(initial.state, site.exit, [])?.floorY
  if (floor === undefined) throw new Error(`Missing exit support ${id}`)
  return { ...initial, greenwayWorks, riverBridgeIds: old ? [] : [id],
    miningTools: owned ? { basicPickOwned: true, enchantedPickOwned: false,
      activePick: null } : initial.miningTools,
    state: { ...initial.state, movementOwner: old ? 'greenway' : 'streamed',
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(initial.state.discoveryMask), ...site.footprintTileIds])].sort()),
      player: { ...initial.state.player, xp: initial.state.player.xp + 80,
        skillXp: { ...initial.state.player.skillXp, construction: 80 },
        position: { ...site.exit, y: floor } } } }
}

describe('V30 River Works bridgehead claim', () => {
  it.each(ids)('requires a built, discovered, grounded far exit for %s', (id) => {
    const ready = atFarExit(id)
    expect(preview(ready, id)).toMatchObject({ rejection: null, reward: 'basic-pick' })
    const before = structuredClone(ready)
    const result = claim(ready, id)
    if (!result.progress) throw new Error(result.rejection)
    expect(result.reward).toBe('basic-pick')
    expect(result.progress.claimedBridgeheadId).toBe(id)
    expect(result.progress.miningTools).toEqual({ basicPickOwned: true,
      enchantedPickOwned: false, activePick: null })
    expect(result.progress.state.player.equipment).toEqual(ready.state.player.equipment)
    expect(result.progress.state.eventSequence).toBe(ready.state.eventSequence + 1)
    expect(ready).toEqual(before)
    expect(claim(result.progress, id)).toEqual({ rejection: 'already_claimed' })
    expect(replayPublicV30Witness(ready,
      { kind: 'bridgehead-claim/v1', bridgeId: id })).toEqual(result.progress)

    const unbuilt = { ...ready, greenwayWorks: { ...ready.greenwayWorks,
      builtBridgeIds: [] }, riverBridgeIds: [] }
    expect(claim(unbuilt, id)).toEqual({ rejection: 'not_built' })
    const greenway = resolvePublicV17GreenwaySite(seed, id)
    const site = greenway?.kind === 'bridge' ? greenway
      : resolvePublicV28RiverBridge(seed, id)
    if (!site) throw new Error(`Missing bridge ${id}`)
    const approachFloor = site.obstacle === 'greenway_creek'
      ? publicV17StarterSupportAt({ seed, profile: ready.state.generationProfile,
        route: ready.state.greenway.routes[0] ?? null, built: false,
        greenwayWorks: ready.greenwayWorks }, site.approach)?.floorY
      : resolvePublicV23Surface(ready.state, site.approach, [])?.floorY
    if (approachFloor === undefined) throw new Error(`Missing approach support ${id}`)
    const nearBank = { ...ready, state: { ...ready.state,
      player: { ...ready.state.player, position: { ...site.approach,
        y: approachFloor } } } }
    expect(claim(nearBank, id)).toEqual({ rejection: 'too_far' })
    const hidden = { ...ready, state: { ...ready.state,
      discoveryMask: encodeDiscoveredTileIds(decodeDiscoveredTileIds(ready.state.discoveryMask)
        .filter((tileId) => tileId !== (id.startsWith('works6:')
          ? resolvePublicV28RiverBridge(seed, id)!.footprintTileIds.at(-1)
          : resolvePublicV17GreenwaySite(seed, id)!.footprintTileIds[4]))) } }
    expect(claim(hidden, id)).toEqual({ rejection: id.startsWith('works6:')
      ? 'invalid_progress' : 'undiscovered' })
    expect(claim(ready, `${id}:forged`)).toEqual({ rejection: 'invalid_site' })
  })

  it('awards exactly 35 coins to an existing pick owner and rejects overflow', () => {
    const ready = atFarExit(ids[1], true)
    const result = claim(ready, ids[1])
    if (!result.progress) throw new Error(result.rejection)
    expect(result.reward).toBe('coins')
    expect(result.progress.state.player.coins).toBe(ready.state.player.coins + 35)
    expect(result.progress.miningTools).toEqual(ready.miningTools)
    const overflow = { ...ready, state: { ...ready.state,
      player: { ...ready.state.player, coins: Number.MAX_SAFE_INTEGER - 34 } } }
    expect(claim(overflow, ids[1])).toEqual({ rejection: 'invalid_value' })
    const sequenceOverflow = { ...ready, state: { ...ready.state,
      eventSequence: Number.MAX_SAFE_INTEGER } }
    expect(claim(sequenceOverflow, ids[1])).toEqual({ rejection: 'invalid_value' })
  })

  it('accepts only a bridge ID in the witness', () => {
    const ready = atFarExit(ids[0])
    const witness = { kind: 'bridgehead-claim/v1', bridgeId: ids[0] }
    expect(decodePublicV30Witness(witness)).toEqual(witness)
    for (const forged of [{ ...witness, reward: 'coins' },
      { ...witness, bridgeId: 'works3:bridge:01' },
      { ...witness, bridgeId: null }, Object.create(witness)]) {
      const decoded = decodePublicV30Witness(forged)
      if (forged.bridgeId === 'works3:bridge:01') expect(decoded).toEqual(forged)
      else expect(decoded).toBeNull()
      expect(replayPublicV30Witness(ready, forged)).toBeNull()
    }
  }, 30_000)

  it('replays a checked one-claim successor and keeps it after atomic reload', async () => {
    const ready = atFarExit(ids[1])
    const { claimedBridgeheadId: _claim, ...priorProgress } = ready
    const receipt = { lineage: v29.lineage, head: { ...v29.head, ...priorProgress,
      saveRevision: 1, witness: { kind: 'checkpoint' as const } } }
    const root = createPublicV30Root(receipt)
    expect(decodePublicV30Root(root)).toEqual(root)
    const witness = { kind: 'bridgehead-claim/v1' as const, bridgeId: ids[1] }
    const replayed = replayPublicV30Witness(root.head, witness)
    if (!replayed) throw new Error('Claim replay rejected')
    const next = { lineage: root.lineage, previous: root.head,
      head: { ...root.head, ...replayed, saveRevision: 1, witness } }
    expect(decodePublicV30CheckedSuccessor(root, next)).toEqual(next)
    expect(decodePublicV30Root(next)).toEqual(next)
    expect(decodePublicV30Root({ ...next, head: { ...next.head,
      claimedBridgeheadId: ids[0] } })).toBeNull()
    expect(decodePublicV30Root({ ...next, head: { ...next.head,
      state: { ...next.head.state, player: { ...next.head.state.player,
        coins: next.head.state.player.coins + 35 } } } })).toBeNull()
    const factory = new IDBFactory(), store = createAtomicV30Store(factory)
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('V30 store not missing')
    expect(await store.commit(missing.proof, root)).toBe('committed')
    const competitor = createAtomicV30Store(factory)
    const left = await store.readChecked(), right = await competitor.readChecked()
    if (left.status !== 'valid' || right.status !== 'valid') throw new Error('V30 root missing')
    expect(await store.commit(left.proof, next)).toBe('committed')
    expect(await competitor.commit(right.proof, next)).toBe('revision-changed')
    const reloaded = await createAtomicV30Store(factory).readChecked()
    expect(reloaded).toMatchObject({ status: 'valid', root: { head: {
      claimedBridgeheadId: ids[1], saveRevision: 1,
      miningTools: { basicPickOwned: true, activePick: null } } } })
    if (reloaded.status !== 'valid') throw new Error('Claim reload missing')
    expect(claim({ ...atFarExit(ids[2]),
      claimedBridgeheadId: reloaded.root.head.claimedBridgeheadId }, ids[2]))
      .toEqual({ rejection: 'already_claimed' })
    expect(Object.hasOwn(v29.head, 'claimedBridgeheadId')).toBe(false)
  }, 120_000)
})
