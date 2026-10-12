import { describe, expect, it } from 'vitest'
import { createPublicV31ControllerRuntime } from '../PublicV31ControllerRuntime'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { mireglassAnchors } from './mireglassContent'
import type { PublicV14Frame } from './publicWorldV14Snapshot'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { createPublicV23Root, decodePublicV23Progress } from './publicWorldV23Snapshot'
import { advancePublicV23Frames, previewPublicV23Frames } from './publicWorldV23Transitions'
import { applyPublicV24MireglassAction } from './publicWorldV24MireglassAction'
import { createPublicV24Root, replayPublicV24Witness } from './publicWorldV24Snapshot'
import type { PublicV24Progress } from './publicWorldV24Snapshot'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { createPublicV25Root, decodePublicV25Root } from './publicWorldV25Snapshot'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { publicV25StratumAt } from './publicWorldV25Strata'
import { createPublicV26Migration, PUBLIC_V26_SCHEMA } from './publicWorldV26Migration'
import { applyPublicV26PitLadderAction } from './publicWorldV26PitLadder'
import { applyPublicV26TerrainAction } from './publicWorldV26TerrainAction'
import { createPublicV26Root, decodePublicV26Head, decodePublicV26Root,
  previewPublicV26Frames, publicV26MovementSegmentAccepted, publicV26SavedLadderSpans,
  replayPublicV26InheritedWitness,
  replayPublicV26Witness } from './publicWorldV26Snapshot'
import type { PublicV26Head, PublicV26Witness } from './publicWorldV26Snapshot'
import { createPublicV27Root } from './publicWorldV27Snapshot'
import { createPublicV28Root } from './publicWorldV28Snapshot'
import { createPublicV29Root } from './publicWorldV29Snapshot'
import { createPublicV30Root } from './publicWorldV30Snapshot'
import { createPublicV31Root, decodePublicV31CheckedSuccessor, decodePublicV31Root,
  replayPublicV31Witness } from './publicWorldV31Snapshot'
import type { PublicV31Witness } from './publicWorldV31Snapshot'
import { worldTileAtGrid } from './worldChunks'

const seed = 'wizard-realms'
const source = () => {
  const v23 = createPublicV23Root(seed)
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  return { head: v25.head, lineage: v25.lineage }
}
const genesis = () => createPublicV26Root(source())
const old = (head: PublicV24Progress): PublicV24Progress => ({ state: head.state,
  greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks })
const move = (x: number, z: number): PublicV14Frame =>
  ({ intents: [{ type: 'move', delta: { x, z } }], walkRequested: false })
const framed = (root: ReturnType<typeof genesis>, frames: PublicV14Frame[]) => {
  const next = advancePublicV23Frames(old(root.head), frames)
  if (!next) throw new Error(JSON.stringify(previewPublicV23Frames(old(root.head), frames)))
  return { lineage: root.lineage, previous: root.head, head: { ...root.head, ...next,
    saveRevision: root.head.saveRevision + 1, witness: { kind: 'frame-batch/v1' as const, frames } } }
}

function v25At(point: { x: number; z: number }, builtLadderId?: string,
  excavation?: { gx: number; gz: number; depth: number }, builtBridgeId?: string,
  logs = 0) {
  const v23 = createPublicV23Root(seed)
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const base = old(v24.head), works = { ...base.greenwayWorks,
    builtLadderIds: builtLadderId ? [builtLadderId] : base.greenwayWorks.builtLadderIds,
    builtBridgeIds: builtBridgeId ? [builtBridgeId] : base.greenwayWorks.builtBridgeIds }
  const route = base.state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null
  const support = publicV17StarterSupportAt({ seed, profile: base.state.generationProfile,
    route, built: base.state.greenway.builtRouteIds.includes('greenway_ladder'),
    greenwayWorks: works }, point)
  if (!support) throw new Error('Missing old support fixture')
  const construction = (builtLadderId ? 60 : 0) + (builtBridgeId ? 80 : 0)
  const player = structuredClone(base.state.player)
  player.position = { ...point, y: support.floorY }
  if (logs) player.inventory.push({ itemId: 'logs', quantity: logs })
  const progressed = decodePublicV23Progress({ ...base, greenwayWorks: works,
    state: { ...base.state, player: { ...player, xp: player.xp + construction,
      skillXp: { ...player.skillXp,
        construction: player.skillXp.construction + construction } } } }, seed)
  if (!progressed) throw new Error('Invalid old pose fixture')
  const shapedV24 = { head: { ...v24.head, ...progressed, saveRevision: 1,
    witness: { kind: 'checkpoint' as const } }, lineage: v24.lineage }
  const v25 = createPublicV25Root(shapedV24)
  const head = excavation ? { ...v25.head, saveRevision: 1,
    witness: { kind: 'checkpoint' as const }, excavation: {
      columns: [excavation], bag: { ...v25.head.excavation.bag } } } : v25.head
  return { head, lineage: v25.lineage }
}
const at = (point: { x: number; z: number }, builtLadderId?: string,
  excavation?: { gx: number; gz: number; depth: number }, logs = 0) =>
  createPublicV26Root(v25At(point, builtLadderId, excavation, undefined, logs))
const v26Progress = (head: PublicV26Head) => ({ ...old(head),
  terrain: head.terrain, nextHomeAtMs: head.nextHomeAtMs })
const terrainWitness = (kind: 'dig' | 'fill', gx: number, gz: number): PublicV26Witness =>
  ({ kind: 'terrain-action/v1', action: { kind, gx, gz } })
function terrainGenesis() {
  for (let gz = -5; gz <= 1; gz += 1) for (let gx = -6; gx <= 6; gx += 1) {
    if (gx === 0 && gz === 0 || publicV25RiverCellAtGrid(seed, gx, gz)
      || worldTileAtGrid(seed, gx, gz).terrain !== 'loam'
      || publicV25StratumAt(seed, gx, gz, 0).material !== 'soil') continue
    try {
      const source = v25At({ x: gx * 4, z: gz * 4 }), base = old(source.head)
      const player = structuredClone(base.state.player)
      if (!player.inventory.some((stack) => stack.itemId === 'field_spade')) {
        player.inventory.push({ itemId: 'field_spade', quantity: 1 })
      }
      player.equipment.mainHand = 'field_spade'
      const id = `tile-${gx + 3}-${gz + 3}`
      const discoveryMask = encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(base.state.discoveryMask), id])].sort())
      const shaped = decodePublicV23Progress({ ...base,
        state: { ...base.state, player, discoveryMask } }, seed)
      if (!shaped) continue
      const root = createPublicV26Root({ ...source, head: { ...source.head,
        ...shaped, saveRevision: 1, witness: { kind: 'checkpoint' as const } } })
      if (applyPublicV26TerrainAction(v26Progress(root.head), { kind: 'dig', gx, gz }).progress) {
        return { root, gx, gz }
      }
    } catch { /* Not an ordinary reachable excavation cell. */ }
  }
  throw new Error('No reachable V26 soil fixture')
}
function terrainStep(root: ReturnType<typeof genesis>, kind: 'dig' | 'fill', gx: number, gz: number) {
  const witness = terrainWitness(kind, gx, gz)
  const next = replayPublicV26Witness(v26Progress(root.head), witness)
  if (!next) throw new Error(`Rejected ${kind} fixture`)
  return { lineage: root.lineage, previous: root.head, head: { ...root.head, ...next,
    saveRevision: root.head.saveRevision + 1, witness } }
}

function cacheReadyRoot(worldSeed: string, offsetX = 0, withBoots = false) {
  const v23 = createPublicV23Root(worldSeed)
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const before = old(v24.head), cache = mireglassAnchors(worldSeed).sealCache.tile.center
  const x = cache.x + offsetX, z = cache.z
  const state = { ...before.state, movementOwner: 'streamed' as const }
  const surface = resolvePublicV23Surface(state, { x, z }, before.regionalWorks.builtLadderIds)
  if (!surface) throw new Error('Missing cache support')
  const player = structuredClone(state.player)
  player.position = { x, y: surface.floorY, z }
  player.skillXp.excavation = 30
  player.xp += 30
  player.level = 1 + Math.floor(player.xp / 100)
  player.learnedSpellIds.push('wayfinder_glow')
  player.equipment.mainHand = 'field_spade'
  player.inventory.push({ itemId: 'field_spade', quantity: 1 })
  if (withBoots) player.inventory.push({ itemId: 'leather_boots', quantity: 1 })
  const discoveryMask = encodeDiscoveredTileIds([...new Set([
    ...decodeDiscoveredTileIds(state.discoveryMask), surface.tileId,
  ])].sort())
  const ready = decodePublicV23Progress({ ...before,
    state: { ...state, player, discoveryMask } }, worldSeed)
  if (!ready) throw new Error('Invalid cache pose')
  const cast = applyPublicV24MireglassAction(ready, { type: 'cast_wayfinder_glow' })
  if (!cast.progress || !cast.progress.state.mireglass.cacheRevealed)
    throw new Error('Cache reveal was rejected')
  const v25 = createPublicV25Root({ lineage: v24.lineage,
    head: { ...v24.head, ...cast.progress, saveRevision: 1,
      witness: { kind: 'checkpoint' as const } } })
  return createPublicV26Root({ head: v25.head, lineage: v25.lineage })
}

function liftCacheRootToV31(v26: ReturnType<typeof cacheReadyRoot>) {
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
  const v29 = createPublicV29Root({ head: v28.head, lineage: v28.lineage })
  const v30 = createPublicV30Root({ head: v29.head, lineage: v29.lineage })
  return createPublicV31Root(v30)
}

describe('V26 exact root and inherited replay', () => {
  it.each(['greenway-alpha', 'wizard-realms'])(
    'replays a checked on-cache-cell excavation through V26 and V31 in %s', async (worldSeed) => {
      const root = cacheReadyRoot(worldSeed)
      const witness = { kind: 'mireglass-action/v1' as const,
        action: { type: 'excavate_cache' as const } }
      const v24 = replayPublicV24Witness(old(root.head), witness)
      const next = replayPublicV26Witness(v26Progress(root.head), witness)
      expect(v24).not.toBeNull()
      expect(next).toEqual({ ...v24, terrain: root.head.terrain,
        nextHomeAtMs: root.head.nextHomeAtMs })
      if (!next) throw new Error('Canonical cache excavation was rejected')
      expect(root.head.state.mireglass.cacheExcavated).toBe(false)
      expect(next.state.mireglass.cacheExcavated).toBe(true)
      expect(next.state.player.position).toEqual({ ...root.head.state.player.position, y: 1.65 })
      expect(root.head.state.player.position.y - next.state.player.position.y).toBeCloseTo(0.75)
      expect(next.state.player.inventory.filter((stack) =>
        stack.itemId === 'mireglass_reach/item/seal'))
        .toEqual([{ itemId: 'mireglass_reach/item/seal', quantity: 1 }])
      expect(next.state.player.skillXp.excavation)
        .toBeGreaterThan(root.head.state.player.skillXp.excavation)
      expect(next.state.eventSequence).toBe(root.head.state.eventSequence + 1)
      expect(publicV26MovementSegmentAccepted(v26Progress(root.head), next)).toBe(false)
      expect(replayPublicV26Witness(v26Progress(root.head), { kind: 'mireglass-action/v1',
        action: { type: 'equip_item', itemId: 'field_spade' } })).toBeNull()
      expect(replayPublicV26Witness(next, witness)).toBeNull()
      expect(replayPublicV26Witness(v26Progress(root.head), { ...witness,
        action: { ...witness.action, allowed: true } })).toBeNull()
      const saved = { lineage: root.lineage, previous: root.head,
        head: { ...root.head, ...next, saveRevision: 1, witness } }
      expect(decodePublicV26Root(structuredClone(saved))).toEqual(saved)
      expect(decodePublicV26Root({ ...saved, head: { ...saved.head,
        state: { ...saved.head.state, player: { ...saved.head.state.player,
          xp: saved.head.state.player.xp + 1 } } } })).toBeNull()

      const v31 = liftCacheRootToV31(root)
      const v31Next = replayPublicV31Witness(v31.head, witness)
      expect(v31Next?.state).toEqual(next.state)
      if (!v31Next) throw new Error('V31 inherited cache replay was rejected')
      const v31Saved = { lineage: v31.lineage, previous: v31.head,
        head: { ...v31.head, ...v31Next, saveRevision: 1, witness } }
      expect(decodePublicV31CheckedSuccessor(v31, structuredClone(v31Saved)))
        .toEqual(v31Saved)
      expect(decodePublicV31Root(structuredClone(v31Saved))).toEqual(v31Saved)
      expect(replayPublicV31Witness(v31Next, witness)).toBeNull()
      let stored = structuredClone(v31)
      let writes = 0
      const runtime = createPublicV31ControllerRuntime(v31,
        async (revision: number, lineage: typeof v31.lineage, requested: PublicV31Witness) => {
          if (revision !== stored.head.saveRevision)
            return { ok: false as const, reason: 'revision-changed' }
          const replayed = replayPublicV31Witness(stored.head, requested)
          if (!replayed) return { ok: false as const, reason: 'frame-rejected' }
          const successor = { lineage, previous: stored.head,
            head: { ...stored.head, ...replayed, saveRevision: revision + 1,
              witness: requested } }
          if (!decodePublicV31CheckedSuccessor(stored, successor))
            return { ok: false as const, reason: 'frame-rejected' }
          writes++
          stored = successor
          return { ok: true as const, value: successor }
        })
      expect(await runtime.action(witness)).toMatchObject({ status: 'saved' })
      expect(writes).toBe(1)
      expect(decodePublicV31Root(structuredClone(stored))).toEqual(stored)
      expect(await runtime.action(witness)).toMatchObject({ status: 'rejected' })
      expect(writes).toBe(1)
    }, 120_000)

  it.each(['greenway-alpha', 'wizard-realms'])(
    'keeps adjacent-footing excavation on its old floor in %s', (worldSeed) => {
      const root = cacheReadyRoot(worldSeed, 2.1)
      const witness = { kind: 'mireglass-action/v1' as const,
        action: { type: 'excavate_cache' as const } }
      const next = replayPublicV26Witness(v26Progress(root.head), witness)
      expect(next).not.toBeNull()
      expect(next?.state.player.position).toEqual(root.head.state.player.position)
      expect(next?.state.mireglass.cacheExcavated).toBe(true)
    })

  it.each(['greenway-alpha', 'wizard-realms'])(
    'keeps a dug cache pit edge impassable to an inherited frame in %s', (worldSeed) => {
      const root = cacheReadyRoot(worldSeed)
      const dug = replayPublicV26Witness(v26Progress(root.head), { kind: 'mireglass-action/v1',
        action: { type: 'excavate_cache' } })
      if (!dug) throw new Error('Canonical cache dig was rejected')
      const frames = Array.from({ length: 14 }, () => move(0.16, 0))
      const v23 = advancePublicV23Frames(old(dug), frames)
      expect(v23).not.toBeNull()
      expect(v23!.state.player.position.x)
        .toBeGreaterThan(mireglassAnchors(worldSeed).sealCache.tile.center.x + 2)
      expect(resolvePublicV23Surface(v23!.state, v23!.state.player.position,
        v23!.regionalWorks.builtLadderIds)?.floorY).toBe(v23!.state.player.position.y)
      expect(v23!.state.player.position.y - dug.state.player.position.y).toBeCloseTo(0.75)
      const witness = { kind: 'frame-batch/v1' as const, frames }
      expect(replayPublicV26InheritedWitness(dug, witness)).toBeNull()
      expect(previewPublicV26Frames(dug, frames)).toBeNull()
    })

  it.each(['greenway-alpha', 'wizard-realms'])(
    'replays a non-cache action but rejects its forged cache successor in %s', (worldSeed) => {
      const root = cacheReadyRoot(worldSeed, 0, true)
      const equip = { kind: 'mireglass-action/v1' as const,
        action: { type: 'equip_item' as const, itemId: 'leather_boots' as const } }
      const v24 = replayPublicV24Witness(old(root.head), equip)
      expect(v24).not.toBeNull()
      expect(replayPublicV26Witness(v26Progress(root.head), equip))
        .toEqual({ ...v24, terrain: root.head.terrain,
          nextHomeAtMs: root.head.nextHomeAtMs })
      const dug = replayPublicV26Witness(v26Progress(root.head), { kind: 'mireglass-action/v1',
        action: { type: 'excavate_cache' } })
      if (!dug) throw new Error('Canonical cache dig was rejected')
      const forged = { lineage: root.lineage, previous: root.head,
        head: { ...root.head, ...dug, saveRevision: 1, witness: equip } }
      expect(decodePublicV26Root(forged)).toBeNull()
    })

  it('makes deterministic byte-equal genesis without changing the pinned V25 source', () => {
    const v25 = source(), before = structuredClone(v25)
    const root = createPublicV26Root(v25), migration = createPublicV26Migration(v25)
    expect(Object.keys(root).sort()).toEqual(['head', 'lineage', 'previous'])
    expect(Object.keys(root.head).sort()).toEqual(['greenwayWorks', 'nextHomeAtMs',
      'regionalWorks', 'saveRevision', 'schemaVersion', 'state', 'terrain', 'witness'])
    expect(root).toEqual({ lineage: migration.lineage, previous: null,
      head: { ...migration.progress, schemaVersion: PUBLIC_V26_SCHEMA,
        saveRevision: 0, witness: null } })
    expect(decodePublicV26Head(root.head, root.lineage)).toEqual(root.head)
    expect(decodePublicV26Root(root)).toEqual(root)
    expect(root.head.nextHomeAtMs).toBe(0)
    expect(v25).toEqual(before)
    expect(decodePublicV25Root({ ...v25, previous: null })).not.toBeNull()
  })

  it('accepts a checkpoint and dry movement, but no terrain or cooldown mutation', () => {
    const root = genesis(), checkpoint = { lineage: root.lineage, previous: root.head,
      head: { ...root.head, saveRevision: 1, witness: { kind: 'checkpoint' as const } } }
    expect(decodePublicV26Root(checkpoint)).toEqual(checkpoint)
    expect(replayPublicV26InheritedWitness(root.head, checkpoint.head.witness))
      .toEqual({ state: root.head.state, greenwayWorks: root.head.greenwayWorks,
        regionalWorks: root.head.regionalWorks, terrain: root.head.terrain, nextHomeAtMs: 0 })
    const dry = framed(at({ x: 12, z: 4 }), [move(0.1, 0)])
    expect(publicV26MovementSegmentAccepted(v26Progress(dry.previous), v26Progress(dry.head)))
      .toBe(true)
    expect(decodePublicV26Root(dry)).not.toBeNull()
    expect(decodePublicV26Root({ ...checkpoint, head: { ...checkpoint.head,
      terrain: { ...checkpoint.head.terrain, bag: { ...checkpoint.head.terrain.bag, soil: 1 } } } }))
      .toBeNull()
    expect(decodePublicV26Root({ ...checkpoint, head: { ...checkpoint.head,
      nextHomeAtMs: 1_800_000 } })).toBeNull()
    const forgedPrevious = { ...checkpoint.head, saveRevision: 1,
      terrain: { ...checkpoint.head.terrain,
        bag: { ...checkpoint.head.terrain.bag, soil: 1 } } }
    expect(decodePublicV26Root({ ...checkpoint, previous: forgedPrevious,
      head: { ...forgedPrevious, saveRevision: 2 } })).toBeNull()
    const forgedCooldown = { ...checkpoint.head, saveRevision: 1, nextHomeAtMs: 1_800_000 }
    expect(decodePublicV26Root({ ...checkpoint, previous: forgedCooldown,
      head: { ...forgedCooldown, saveRevision: 2 } })).toBeNull()
    expect(decodePublicV26Root({ ...checkpoint, head: { ...checkpoint.head,
      state: { ...checkpoint.head.state, player: { ...checkpoint.head.state.player,
        coins: checkpoint.head.state.player.coins + 1 } } } })).toBeNull()
  })

  it('previews an airborne jump through landing without allowing airborne durable replay', () => {
    const root = at({ x: 12, z: 4 }), base = v26Progress(root.head)
    const jump: PublicV14Frame = { intents: [{ type: 'jump' }], walkRequested: false }
    const idle: PublicV14Frame = { intents: [], walkRequested: false }
    const first = previewPublicV26Frames(base, [jump])
    expect(first).not.toBeNull()
    expect(first!.state.player.position.y).toBeGreaterThan(base.state.player.position.y)
    expect(first!.state.player.verticalVelocity).not.toBe(0)
    expect(previewPublicV26Frames(base, [jump, idle])?.state.player.position.y)
      .toBeGreaterThan(first!.state.player.position.y)
    const landed = previewPublicV26Frames(base, [jump, ...Array<PublicV14Frame>(24).fill(idle)])
    expect(landed).not.toBeNull()
    expect(landed!.state.player.verticalVelocity).toBe(0)
    expect(landed!.state.player.position.y).toBeCloseTo(base.state.player.position.y)
    expect(replayPublicV26InheritedWitness(base, { kind: 'frame-batch/v1', frames: [jump] }))
      .toBeNull()
    expect(previewPublicV26Frames(base, [])).toBeNull()
    expect(previewPublicV26Frames(base, Array<PublicV14Frame>(129).fill(idle))).toBeNull()
  })

  it('rejects airborne cliff and river bypasses at the crossed segment', () => {
    const jump: PublicV14Frame = { intents: [{ type: 'jump' }], walkRequested: false }
    for (const [point, crossing, back] of [
      [{ x: 28, z: -5.95 }, move(0, -0.1), move(0, 0.1)],
      [{ x: 12, z: 5.9 }, move(0, 0.16), move(0, -0.16)],
    ] as const) {
      const root = at(point), base = v26Progress(root.head)
      const frames = [jump, crossing]
      expect(previewPublicV23Frames(old(root.head), frames, true).progress).not.toBeNull()
      expect(previewPublicV26Frames(base, [jump])).not.toBeNull()
      expect(previewPublicV26Frames(base, frames)).toBeNull()
      expect(previewPublicV26Frames(base, [...frames, back]))
        .toBeNull()
    }
  })

  it('replays witnessed dig, fill, and re-dig without a second reward', () => {
    const { root, gx, gz } = terrainGenesis()
    expect(decodePublicV26Root(root)).toEqual(root)
    const dig = terrainStep(root, 'dig', gx, gz)
    expect(decodePublicV26Root(dig)).toEqual(dig)
    expect(dig.head.terrain.columns).toEqual([{ gx, gz, openDepth: 1,
      rewardDepth: 1, pitLadder: false }])
    expect(dig.head.terrain.bag.soil).toBe(1)
    expect(dig.head.state.player.xp).toBe(root.head.state.player.xp + 30)
    expect(dig.head.state.eventSequence).toBe(root.head.state.eventSequence + 1)
    const checkpoint = { lineage: dig.lineage, previous: dig.head,
      head: { ...dig.head, saveRevision: 2, witness: { kind: 'checkpoint' as const } } }
    expect(decodePublicV26Root(checkpoint)).toEqual(checkpoint)
    const fill = terrainStep({ lineage: dig.lineage, head: dig.head,
      previous: dig.previous }, 'fill', gx, gz)
    expect(decodePublicV26Root(fill)).toEqual(fill)
    expect(fill.head.terrain.columns[0]).toMatchObject({ openDepth: 0, rewardDepth: 1 })
    expect(fill.head.terrain.bag.soil).toBe(0)
    const reopened = terrainStep({ lineage: fill.lineage, head: fill.head,
      previous: fill.previous }, 'dig', gx, gz)
    expect(decodePublicV26Root(reopened)).toEqual(reopened)
    expect(reopened.head.terrain.columns[0]).toMatchObject({ openDepth: 1, rewardDepth: 1 })
    expect(reopened.head.terrain.bag.soil).toBe(0)
    expect(reopened.head.state.player.xp).toBe(dig.head.state.player.xp)
    expect(reopened.head.state.player.skillXp.excavation)
      .toBe(dig.head.state.player.skillXp.excavation)
    expect(reopened.head.state.eventSequence).toBe(dig.head.state.eventSequence)
  })

  it('rejects terrain-action witness and resulting ledger, XP, or sequence tampering', () => {
    const { root, gx, gz } = terrainGenesis(), dig = terrainStep(root, 'dig', gx, gz)
    expect(decodePublicV26Root({ ...dig, head: { ...dig.head, terrain: root.head.terrain } }))
      .toBeNull()
    expect(decodePublicV26Root({ ...dig, head: { ...dig.head, terrain: { ...dig.head.terrain,
      bag: { ...dig.head.terrain.bag, soil: 2 } } } })).toBeNull()
    expect(decodePublicV26Root({ ...dig, head: { ...dig.head, state: { ...dig.head.state,
      player: { ...dig.head.state.player, xp: dig.head.state.player.xp + 1 } } } }))
      .toBeNull()
    expect(decodePublicV26Root({ ...dig, head: { ...dig.head, state: { ...dig.head.state,
      eventSequence: dig.head.state.eventSequence + 1 } } })).toBeNull()
    expect(decodePublicV26Root({ ...dig, head: { ...dig.head,
      witness: { ...terrainWitness('dig', gx, gz), extra: true } } })).toBeNull()
    expect(decodePublicV26Root({ ...dig, head: { ...dig.head,
      witness: { kind: 'terrain-action/v1', action: { kind: 'dig', gx, gz, eligible: true } } } }))
      .toBeNull()
    expect(replayPublicV26Witness(v26Progress(root.head), { kind: 'terrain-action/v1',
      action: { kind: 'dig', gx: 0, gz: 0 } })).toBeNull()
    const forgedPrevious = { ...dig.head, terrain: root.head.terrain }
    expect(decodePublicV26Root({ lineage: dig.lineage, previous: forgedPrevious,
      head: { ...forgedPrevious, saveRevision: 2, witness: { kind: 'checkpoint' } } })).toBeNull()
  })

  it('rejects an unearned bag item in both slots of a revision-three dig/fill chain', () => {
    const { root, gx, gz } = terrainGenesis()
    const dig = terrainStep(root, 'dig', gx, gz)
    const fill = terrainStep(dig, 'fill', gx, gz)
    const reopened = terrainStep(fill, 'dig', gx, gz)
    expect(decodePublicV26Root(reopened)).toEqual(reopened)
    const previous = { ...fill.head, terrain: { ...fill.head.terrain,
      bag: { ...fill.head.terrain.bag, soil: 2 } } }
    const head = { ...reopened.head, terrain: { ...reopened.head.terrain,
      bag: { ...reopened.head.terrain.bag, soil: 2 } } }
    expect(replayPublicV26Witness(v26Progress(previous), head.witness))
      .toEqual(v26Progress(head))
    expect(decodePublicV26Root({ lineage: reopened.lineage, previous, head })).toBeNull()
  })

  it('closes the old x=28 cliff taper without a ladder, including a return trip', () => {
    const root = at({ x: 28, z: -5.95 })
    const crossing = framed(root, [move(0, -0.1)])
    expect(decodePublicV26Root(crossing)).toBeNull()
    expect(decodePublicV26Root(framed(root, [move(0, -0.1), move(0, 0.1)])))
      .toBeNull()
  })

  it('opens the saved Works4 ladder span at x=-2, not the center or adjacent rock', () => {
    const id = 'works4:ladder:greenway-north-cliff:-20'
    const site = resolvePublicV17GreenwaySite(seed, id)
    expect(site).toMatchObject({ kind: 'ladder', from: { x: -2 }, widthMeters: 1.05 })
    const root = at({ x: -2, z: -5.95 }, id)
    expect(publicV26SavedLadderSpans(old(root.head)))
      .toContainEqual({ x: -2, widthMeters: 1.05 })
    expect(decodePublicV26Root(framed(root, [move(0, -0.1)]))).not.toBeNull()
  })

  it('rejects an effective uphill step out of an inherited pit', () => {
    const root = at({ x: 12, z: -1.95 }, undefined, { gx: 3, gz: 0, depth: 2 })
    expect(root.head.terrain.columns).toMatchObject([{ openDepth: 2, rewardDepth: 2 }])
    const climb = framed(root, [move(0, -0.1)])
    expect(publicV26MovementSegmentAccepted(v26Progress(climb.previous), v26Progress(climb.head)))
      .toBe(false)
    expect(decodePublicV26Root(climb)).toBeNull()
  })

  it('accepts a witnessed four-log pit ladder and then permits its saved edge climb', () => {
    const gx = 3, gz = 0
    const root = at({ x: 12, z: -1.95 }, undefined, { gx, gz, depth: 2 }, 4)
    expect(decodePublicV26Root(root)).toEqual(root)
    expect(decodePublicV26Root(framed(root, [move(0, -0.1)]))).toBeNull()
    const witness = { kind: 'pit-ladder/v1' as const,
      action: { kind: 'place-pit-ladder' as const, gx, gz } }
    const next = replayPublicV26Witness(v26Progress(root.head), witness)
    if (!next) throw new Error('Expected witnessed pit ladder to replay')
    const placed = { lineage: root.lineage, previous: root.head,
      head: { ...root.head, ...next, saveRevision: 1, witness } }
    expect(decodePublicV26Root(placed)).toEqual(placed)
    expect(placed.head.terrain.columns[0].pitLadder).toBe(true)
    expect(placed.head.state.player.inventory.some((stack) => stack.itemId === 'logs')).toBe(false)
    expect(placed.head.state.player.skillXp.construction)
      .toBe(root.head.state.player.skillXp.construction + 60)
    const climb = framed(placed, [move(0, -0.1)])
    expect(publicV26MovementSegmentAccepted(v26Progress(climb.previous), v26Progress(climb.head)))
      .toBe(true)
    expect(decodePublicV26Root(climb)).toEqual(climb)
  })

  it('rejects forged pit ladder, unspent logs, XP, and client eligibility flags', () => {
    const gx = 3, gz = 0
    const root = at({ x: 12, z: -1.95 }, undefined, { gx, gz, depth: 2 }, 4)
    const witness = { kind: 'pit-ladder/v1' as const,
      action: { kind: 'place-pit-ladder' as const, gx, gz } }
    const next = applyPublicV26PitLadderAction(v26Progress(root.head), witness.action).progress
    if (!next) throw new Error('Expected valid pit ladder')
    const placed = { lineage: root.lineage, previous: root.head,
      head: { ...root.head, ...next, saveRevision: 1, witness } }
    expect(decodePublicV26Root(placed)).toEqual(placed)
    expect(decodePublicV26Root({ ...placed, head: { ...placed.head,
      witness: { ...witness, action: { ...witness.action, eligible: true } } } })).toBeNull()
    expect(decodePublicV26Root({ ...placed, head: { ...placed.head,
      state: { ...placed.head.state, player: { ...placed.head.state.player,
        xp: placed.head.state.player.xp + 1 } } } })).toBeNull()
    expect(decodePublicV26Root({ ...placed, head: { ...placed.head,
      state: { ...placed.head.state, player: root.head.state.player } } })).toBeNull()
    expect(decodePublicV26Root({ ...placed, head: { ...placed.head,
      witness: { kind: 'checkpoint' } } })).toBeNull()
    const poor = at({ x: 12, z: -1.95 }, undefined, { gx, gz, depth: 2 }, 3)
    expect(replayPublicV26Witness(v26Progress(poor.head), witness)).toBeNull()
  })

  it('does not let a pit ladder override an unbridged river or the closed north rim', () => {
    for (const [point, step, gx, gz] of [
      [{ x: 12, z: 5.9 }, move(0, 0.16), 3, 1],
      [{ x: 28, z: -5.95 }, move(0, -0.1), 7, -1],
    ] as const) {
      const root = at(point), crossing = framed(root, [step])
      const terrain = { ...root.head.terrain, columns: [{ gx, gz, openDepth: 2,
        rewardDepth: 2, pitLadder: true }] }
      expect(publicV26MovementSegmentAccepted({ ...v26Progress(root.head), terrain },
        { ...v26Progress(crossing.head), terrain })).toBe(false)
    }
  })

  it('replays a trapped return home with a witnessed cooldown without changing V25 source', () => {
    const root = at({ x: 12, z: 4 }, undefined, { gx: 3, gz: 1, depth: 8 })
    const sourceBefore = structuredClone(root.lineage.sourceReceipt)
    const witness = { kind: 'return-home/v1' as const, atMs: 10_000 }
    const next = replayPublicV26Witness(v26Progress(root.head), witness)
    if (!next) throw new Error('Expected trapped return-home replay')
    const returned = { lineage: root.lineage, previous: root.head,
      head: { ...root.head, ...next, saveRevision: 1, witness } }
    expect(decodePublicV26Root(returned)).toEqual(returned)
    expect(returned.head.state.player.position).toMatchObject({ x: 0, z: 0 })
    expect(returned.head.nextHomeAtMs).toBe(1_810_000)
    expect(root.lineage.sourceReceipt).toEqual(sourceBefore)
    expect(root.head.nextHomeAtMs).toBe(0)
    expect(decodePublicV26Root({ ...returned, head: { ...returned.head,
      nextHomeAtMs: 1_810_001 } })).toBeNull()
    expect(decodePublicV26Root({ ...returned, head: { ...returned.head,
      witness: { kind: 'checkpoint' } } })).toBeNull()
  })

  it('rejects return home when untrapped, cooling down, or given an inexact witness', () => {
    const dry = at({ x: 12, z: 4 })
    const witness = { kind: 'return-home/v1' as const, atMs: 10_000 }
    expect(replayPublicV26Witness(v26Progress(dry.head), witness)).toBeNull()
    const trapped = at({ x: 12, z: 4 }, undefined, { gx: 3, gz: 1, depth: 8 })
    expect(replayPublicV26Witness({ ...v26Progress(trapped.head), nextHomeAtMs: 20_000 }, witness))
      .toBeNull()
    expect(replayPublicV26Witness(v26Progress(trapped.head), { ...witness, trusted: true }))
      .toBeNull()
    expect(replayPublicV26Witness(v26Progress(trapped.head), { ...witness, atMs: -1 }))
      .toBeNull()
  })

  it('rejects the reverse deep-pit descent instead of snapping the effective pose down', () => {
    const root = at({ x: 12, z: -2.05 }, undefined, { gx: 3, gz: 0, depth: 12 })
    expect(decodePublicV26Root(root)).toEqual(root)
    expect(decodePublicV26Root(framed(root, [move(0, 0.1)]))).toBeNull()
  })

  it('accepts an inherited saved-bridge witness and blocks an off-bridge wet crossing', () => {
    const id = 'works3:bridge:1', site = resolvePublicV17GreenwaySite(seed, id)
    if (!site || site.kind !== 'bridge') throw new Error('Missing bridge fixture')
    const v25 = v25At(site.gapCenter, undefined, undefined, id)
    const firstFrames = [move(0, 0.1)]
    const first = advancePublicV23Frames(old(v25.head), firstFrames)
    if (!first) throw new Error('Old saved bridge frame was rejected')
    const witnessed = { lineage: v25.lineage, previous: v25.head, head: { ...v25.head,
      ...first, saveRevision: 1, witness: { kind: 'frame-batch/v1' as const,
        frames: firstFrames } } }
    expect(decodePublicV25Root(witnessed)).not.toBeNull()
    const bridge = createPublicV26Root({ head: witnessed.head, lineage: witnessed.lineage })
    expect(decodePublicV26Root(framed(bridge, [move(0, 0.1)]))).not.toBeNull()
    const offBridge = at({ x: 12, z: 5.9 })
    expect(decodePublicV26Root(framed(offBridge, [move(0, 0.16)]))).toBeNull()
  })

  it('rejects malformed heads, witnesses, revision gaps, and hostile values', () => {
    const root = genesis(), next = { ...root.head, saveRevision: 1,
      witness: { kind: 'checkpoint' as const } }
    expect(decodePublicV26Head({ ...root.head, extra: true }, root.lineage)).toBeNull()
    expect(decodePublicV26Head({ ...root.head, schemaVersion: 'wizard-world/v25' }, root.lineage)).toBeNull()
    expect(decodePublicV26Head({ ...root.head, nextHomeAtMs: -1 }, root.lineage)).toBeNull()
    expect(decodePublicV26Head({ ...root.head, nextHomeAtMs: 1 }, root.lineage)).toBeNull()
    expect(decodePublicV26Head({ ...next, witness: { kind: 'dig-column/v1', gx: 1, gz: 1 } },
      root.lineage)).toBeNull()
    expect(decodePublicV26Head({ ...next, witness: null }, root.lineage)).toBeNull()
    expect(decodePublicV26Head({ ...next, terrain: { ...next.terrain,
      columns: [{ gx: 0, gz: 0, openDepth: 0, rewardDepth: 0, pitLadder: false }] } },
    root.lineage)).toBeNull()
    expect(decodePublicV26Root({ ...root, extra: true })).toBeNull()
    expect(decodePublicV26Root({ ...root, previous: root.head })).toBeNull()
    expect(decodePublicV26Root({ ...root, previous: root.head,
      head: { ...next, saveRevision: 2 } })).toBeNull()
    expect(decodePublicV26Root(new Proxy(root, { get() { throw new Error('hostile') } })))
      .toBeNull()
  })
})
