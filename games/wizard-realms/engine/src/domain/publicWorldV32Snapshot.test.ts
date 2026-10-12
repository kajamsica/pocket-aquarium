import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { highlandLandmark, highlandStoneNodes } from './highlandContent'
import { nearbyWorldTileIds } from './publicWorldDiscovery'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { createFreshPublicV17Head } from './publicWorldV17Snapshot'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { createPublicV24Root } from './publicWorldV24Snapshot'
import { createPublicV25Root } from './publicWorldV25Snapshot'
import { createPublicV26Root } from './publicWorldV26Snapshot'
import { createPublicV27Root } from './publicWorldV27Snapshot'
import { createPublicV28Root } from './publicWorldV28Snapshot'
import { createPublicV29Root } from './publicWorldV29Snapshot'
import { createPublicV30Root } from './publicWorldV30Snapshot'
import { createPublicV31Root, decodePublicV31Root } from './publicWorldV31Snapshot'
import { decodePublicV31ActionProgress } from './publicWorldV31Soil'
import { confirmPublicV32HighlandAction, decodePublicV32HighlandWitness } from './publicWorldV32Highland'
import type { PublicV32Progress } from './publicWorldV32Migration'
import { PUBLIC_V32_DATABASE_NAME } from './publicWorldV32Migration'
import { createPublicV32Root, decodePublicV32CheckedSuccessor,
  decodePublicV32Root, replayPublicV32Witness } from './publicWorldV32Snapshot'
import type { PublicV32Head } from './publicWorldV32Snapshot'

const seeds = ['wizard-realms', 'greenway-alpha'] as const
const owned = ({ schemaVersion: _schema, saveRevision: _revision,
  witness: _witness, ...progress }: PublicV32Head): PublicV32Progress => progress

function v31At(seed: string, site: 'crown' | 'node' | 'store' = 'crown',
  baselineStone = 0, baselineTradeStone = 0) {
  const v17 = createFreshPublicV17Head(seed)
  const crown = highlandLandmark(seed), node = highlandStoneNodes(seed)[0]
  const place = site === 'node' ? node.tile : crown.tile
  const store = v17.head.state.greenway.stores.find((entry) => entry.id === 'store-greenway')
  if (site === 'store' && !store) throw new Error('Missing Outfitters')
  const position = site === 'store' ? store!.position : place.center
  const surface = site === 'store'
    ? publicV17StarterSupportAt({ seed, profile: v17.head.state.generationProfile,
      route: v17.head.state.greenway.routes[0] ?? null, built: false,
      greenwayWorks: v17.head.greenwayWorks }, position)
    : resolvePublicV23Surface(v17.head.state, position, [])
  if (!surface) throw new Error('Missing Highland surface')
  const mask = encodeDiscoveredTileIds([...new Set([
    ...decodeDiscoveredTileIds(v17.head.state.discoveryMask),
    ...nearbyWorldTileIds(position, 8), ...(site === 'store' ? [] : [place.id]),
    ...(site === 'node' ? [crown.tile.id] : []),
  ])].sort())
  const state = { ...v17.head.state,
    movementOwner: site === 'store' ? 'greenway' as const : 'streamed' as const,
    discoveryMask: mask,
    highland: { ...v17.head.state.highland, landmarkDiscovered: site === 'node' },
    player: { ...v17.head.state.player, xp: 30,
      skillXp: { ...v17.head.state.player.skillXp, excavation: 30 },
      position: { x: position.x, y: surface.floorY, z: position.z },
      inventory: [...v17.head.state.player.inventory,
        { itemId: 'field_spade' as const, quantity: 1 },
        ...(baselineStone ? [{ itemId: 'stone' as const, quantity: baselineStone }] : [])],
      tradeSlots: baselineTradeStone ? [
        { slotIndex: 0 as const, itemId: 'stone' as const,
          quantity: baselineTradeStone, unitPrice: 3 },
        ...v17.head.state.player.tradeSlots.slice(1),
      ] as typeof v17.head.state.player.tradeSlots : v17.head.state.player.tradeSlots,
      equipment: { ...v17.head.state.player.equipment, mainHand: 'field_spade' as const } } }
  const v23 = createPublicV23Root(seed, { state,
    greenwayWorks: v17.head.greenwayWorks, saveRevision: 1, lineage: v17.lineage })
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
  const v29 = createPublicV29Root({ head: v28.head, lineage: v28.lineage })
  const v30 = createPublicV30Root({ head: v29.head, lineage: v29.lineage })
  const v31 = createPublicV31Root(v30)
  if (!decodePublicV31Root(v31)) throw new Error('Invalid checked Highland V31 source')
  return { v31, crown, node }
}

function atNode(progress: PublicV32Progress, node: ReturnType<typeof highlandStoneNodes>[number],
  equip = true): PublicV32Progress {
  const surface = resolvePublicV23Surface(progress.state, node.tile.center,
    progress.regionalWorks.builtLadderIds)
  if (!surface) throw new Error('Missing Highland node surface')
  return { ...progress, state: { ...progress.state,
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(progress.state.discoveryMask),
      ...nearbyWorldTileIds(node.tile.center, 8), node.tile.id,
    ])].sort()),
    player: { ...progress.state.player,
      position: { x: node.tile.center.x, y: surface.floorY, z: node.tile.center.z },
      equipment: { ...progress.state.player.equipment,
        mainHand: equip ? 'field_spade' : null } } } }
}

describe('V32 checked Highland authority', () => {
  it('rejects free stone hidden in the older slot of a revision-three root', () => {
    const root = createPublicV32Root(v31At(seeds[0], 'node').v31)
    const checkpoint = { kind: 'checkpoint' as const }
    const firstProgress = replayPublicV32Witness(root.head, checkpoint)!
    const first = { lineage: root.lineage, previous: root.head,
      head: { ...root.head, ...firstProgress, saveRevision: 1, witness: checkpoint } }
    expect(decodePublicV32CheckedSuccessor(root, first) === null).toBe(false)
    const secondProgress = replayPublicV32Witness(first.head, checkpoint)!
    const second = { lineage: root.lineage, previous: first.head,
      head: { ...first.head, ...secondProgress, saveRevision: 2, witness: checkpoint } }
    expect(decodePublicV32CheckedSuccessor(first, second) === null).toBe(false)
    const freeStone = { ...second.head, state: { ...second.head.state,
      player: { ...second.head.state.player,
        inventory: [...second.head.state.player.inventory,
          { itemId: 'stone' as const, quantity: 2 }] } } }
    const forgedThird = { lineage: root.lineage, previous: freeStone,
      head: { ...freeStone, saveRevision: 3, witness: checkpoint } }
    expect(decodePublicV32Root(forgedThird) === null).toBe(true)
  }, 120_000)

  it.each(seeds)('pins the complete V31 source and studies Crown only on interaction: %s', (seed) => {
    const { v31, crown } = v31At(seed)
    expect(PUBLIC_V32_DATABASE_NAME).toBe('wizard-realms:world:v32')
    const root = createPublicV32Root(v31)
    expect(decodePublicV32Root(root)).toEqual(root)
    expect(root.lineage.sourceReceipt).toEqual(v31)
    expect(root.head.state.highland.landmarkDiscovered).toBe(false)
    const witness = { kind: 'highland-discover/v1' as const, landmarkId: crown.id }
    expect(decodePublicV32HighlandWitness({ ...witness, extra: true })).toBeNull()
    expect(decodePublicV32HighlandWitness({ ...witness, landmarkId: 'other' })).toBeNull()
    expect(replayPublicV32Witness(root.head, { kind: 'checkpoint' })).toEqual({
      state: root.head.state, greenwayWorks: root.head.greenwayWorks,
      regionalWorks: root.head.regionalWorks, terrain: root.head.terrain,
      nextHomeAtMs: root.head.nextHomeAtMs, riverBridgeIds: root.head.riverBridgeIds,
      miningTools: root.head.miningTools, claimedBridgeheadId: root.head.claimedBridgeheadId,
      raisedSoilCells: root.head.raisedSoilCells,
    })
    expect(confirmPublicV32HighlandAction(atNode(owned(root.head), highlandStoneNodes(seed)[0]),
      witness).rejection).toBe('too_far')
    const studied = replayPublicV32Witness(root.head, witness)
    expect(studied?.state.highland.landmarkDiscovered).toBe(true)
    expect(studied?.state.eventSequence).toBe(root.head.state.eventSequence + 1)
    expect(replayPublicV32Witness(studied!, witness)).toBeNull()
    const next = { lineage: root.lineage, previous: root.head,
      head: { ...root.head, ...studied, saveRevision: 1, witness } }
    expect(decodePublicV32CheckedSuccessor(root, next)).toEqual(next)
    expect(decodePublicV32Root(structuredClone(next))).toEqual(next)
    expect(decodePublicV31Root(v31)).toEqual(v31)
    const forged = { ...next, head: { ...next.head, state: { ...next.head.state,
      player: { ...next.head.state.player, coins: next.head.state.player.coins + 80 } } } }
    expect(decodePublicV32CheckedSuccessor(root, forged)).toBeNull()
    expect(decodePublicV32Root(forged)).toBeNull()
    const changedSource = { ...v31, head: { ...v31.head, state: { ...v31.head.state,
      player: { ...v31.head.state.player, coins: v31.head.state.player.coins + 1 } } } }
    expect(decodePublicV32Root({ ...next, lineage: { ...next.lineage,
      sourceReceipt: changedSource } }) === null).toBe(true)
  }, 120_000)

  it.each(seeds)('extracts two stone with cooldown, exact XP, and save replay: %s', (seed) => {
    const { v31, node } = v31At(seed, 'node')
    const root = createPublicV32Root(v31), ready = owned(root.head)
    expect(decodePublicV31ActionProgress(ready)).not.toBeNull()
    const extract = { kind: 'highland-extract/v1' as const, nodeId: node.id }
    expect(confirmPublicV32HighlandAction(ready,
      { ...extract, nodeId: 'highland_quarry/stone/fake' }).rejection).toBe('not_found')
    expect(confirmPublicV32HighlandAction({ ...ready, state: { ...ready.state,
      highland: { ...ready.state.highland, landmarkDiscovered: false } } },
      extract).rejection).toBe('study_crown_first')
    expect(confirmPublicV32HighlandAction(atNode(ready, node, false),
      extract).rejection).toBe('requires_spade')
    const novice = { ...ready, state: { ...ready.state, player: { ...ready.state.player,
      skillXp: { ...ready.state.player.skillXp, excavation: 0 } } } }
    expect(confirmPublicV32HighlandAction(novice, extract).rejection).toBe('skill_locked')
    const carried = ready.state.player.inventory.reduce((sum, row) => sum + row.quantity, 0)
      + ready.state.player.tradeSlots.reduce((sum, row) => sum + row.quantity, 0)
      + Object.values(ready.terrain.bag).reduce((sum, count) => sum + count, 0)
    const full = { ...ready, state: { ...ready.state, player: { ...ready.state.player,
      inventory: [...ready.state.player.inventory,
        { itemId: 'stone' as const,
          quantity: ready.state.player.backpackCapacity - carried }] } } }
    expect(confirmPublicV32HighlandAction(full, extract).rejection).toBe('capacity')
    const overflowing = { ...ready, state: { ...ready.state,
      tick: Number.MAX_SAFE_INTEGER - 2999 } }
    expect(confirmPublicV32HighlandAction(overflowing, extract).rejection).toBe('overflow')
    const mined = confirmPublicV32HighlandAction(ready, extract)
    if (!mined.progress) throw new Error(`Stone rejection: ${mined.rejection}`)
    expect(mined.progress.state.player.inventory.find((row) => row.itemId === 'stone')?.quantity).toBe(2)
    expect(mined.progress.state.player.xp).toBe(ready.state.player.xp + 20)
    expect(mined.progress.state.player.skillXp.excavation).toBe(ready.state.player.skillXp.excavation + 20)
    expect(mined.progress.state.highland.stoneNodes.find((row) => row.id === node.id)?.readyAtTick)
      .toBe(ready.state.tick + 3000)
    expect(confirmPublicV32HighlandAction(mined.progress, extract).rejection).toBe('recovering')
    const recovered = { ...mined.progress, state: { ...mined.progress.state,
      tick: mined.progress.state.tick + 3000 } }
    const minedAgain = confirmPublicV32HighlandAction(recovered, extract)
    expect(minedAgain.progress?.state.player.inventory.find((row) => row.itemId === 'stone')
      ?.quantity).toBe(4)
    expect(minedAgain.progress?.state.highland.stoneNodes.find((row) => row.id === node.id)
      ?.readyAtTick).toBe(ready.state.tick + 6000)
    const saved = { lineage: root.lineage, previous: root.head,
      head: { ...root.head, ...mined.progress, saveRevision: 1, witness: extract } }
    expect(decodePublicV32CheckedSuccessor(root, saved)).toEqual(saved)
    expect(decodePublicV32Root(structuredClone(saved))).toEqual(saved)
    const forged = { ...saved, head: { ...saved.head,
      state: { ...saved.head.state, player: { ...saved.head.state.player,
        inventory: saved.head.state.player.inventory.map((stack) => stack.itemId === 'stone'
          ? { ...stack, quantity: stack.quantity + 2 } : stack) } } } }
    expect(decodePublicV32CheckedSuccessor(root, forged)).toBeNull()
    expect(decodePublicV32Root(forged)).toBeNull()
    expect(decodePublicV32HighlandWitness({ ...extract, itemId: 'stone' })).toBeNull()
  }, 120_000)

  it('preserves migrated V31 stone as a baseline before V32 harvest', () => {
    const { v31, node } = v31At(seeds[0], 'node', 2)
    const root = createPublicV32Root(v31)
    expect(decodePublicV32Root(root) === null).toBe(false)
    const witness = { kind: 'highland-extract/v1' as const, nodeId: node.id }
    const harvested = replayPublicV32Witness(root.head, witness)
    expect(harvested?.state.player.inventory.find((row) => row.itemId === 'stone')
      ?.quantity).toBe(4)
    const saved = { lineage: root.lineage, previous: root.head,
      head: { ...root.head, ...harvested, saveRevision: 1, witness } }
    expect(decodePublicV32Root(saved) === null).toBe(false)
  }, 120_000)

  it('counts escrowed trade stone and permits an inherited Outfitters sale', () => {
    const escrow = createPublicV32Root(v31At(seeds[0], 'node', 1, 1).v31)
    expect(decodePublicV32Root(escrow) === null).toBe(false)
    const store = createPublicV32Root(v31At(seeds[0], 'store', 2).v31)
    const witness = { kind: 'legacy-action' as const, intent: {
      type: 'sell_to_store' as const, storeId: 'store-greenway',
      itemId: 'stone' as const, quantity: 1 } }
    const sold = replayPublicV32Witness(store.head, witness)
    expect(sold?.state.player.inventory.find((row) => row.itemId === 'stone')?.quantity).toBe(1)
    expect(sold?.state.player.coins).toBeGreaterThan(store.head.state.player.coins)
    const saved = { lineage: store.lineage, previous: store.head,
      head: { ...store.head, ...sold, saveRevision: 1, witness } }
    expect(decodePublicV32CheckedSuccessor(store, saved) === null).toBe(false)
  }, 120_000)

  it('reloads a second checked extraction after the full recovery interval', () => {
    const { v31, node } = v31At(seeds[0], 'node')
    let root = createPublicV32Root(v31)
    const extract = { kind: 'highland-extract/v1' as const, nodeId: node.id }
    const first = replayPublicV32Witness(root.head, extract)
    if (!first) throw new Error('First quarry extraction rejected')
    const firstCandidate = { lineage: root.lineage, previous: root.head,
      head: { ...root.head, ...first, saveRevision: 1, witness: extract } }
    const checkedFirst = decodePublicV32CheckedSuccessor(root, firstCandidate)
    if (!checkedFirst) throw new Error('First quarry extraction did not save')
    root = checkedFirst
    for (let remaining = 3000; remaining > 0;) {
      const count = Math.min(remaining, 128)
      const witness = { kind: 'frame-batch/v1' as const,
        frames: Array.from({ length: count }, () => ({ intents: [], walkRequested: false })) }
      const progress = replayPublicV32Witness(root.head, witness)
      if (!progress) throw new Error('Recovery frames rejected')
      const candidate = { lineage: root.lineage, previous: root.head,
        head: { ...root.head, ...progress, saveRevision: root.head.saveRevision + 1, witness } }
      const checked = decodePublicV32CheckedSuccessor(root, candidate)
      if (!checked) throw new Error('Recovery frames did not save')
      root = checked
      remaining -= count
    }
    expect(root.head.state.tick).toBe(first.state.tick + 3000)
    const second = replayPublicV32Witness(root.head, extract)
    expect(second?.state.player.inventory.find((row) => row.itemId === 'stone')?.quantity).toBe(4)
    const candidate = { lineage: root.lineage, previous: root.head,
      head: { ...root.head, ...second, saveRevision: root.head.saveRevision + 1,
        witness: extract } }
    const checked = decodePublicV32CheckedSuccessor(root, candidate)
    expect(checked === null).toBe(false)
    expect(decodePublicV32Root(structuredClone(candidate)) === null).toBe(false)
  }, 240_000)
})
