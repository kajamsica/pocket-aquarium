import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV28Store } from './atomicV28Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { createPublicV23Root, decodePublicV23Progress } from './publicWorldV23Snapshot'
import { createPublicV24Root } from './publicWorldV24Snapshot'
import { createPublicV25Root } from './publicWorldV25Snapshot'
import { publicV25RiverTouchesSegment } from './publicWorldV25RiverSweep'
import { emptyPublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { publicV26TerrainConserved } from './publicWorldV26TerrainConservation'
import { applyPublicV26TerrainAction } from './publicWorldV26TerrainAction'
import { createPublicV26Root, replayPublicV26Witness } from './publicWorldV26Snapshot'
import { createPublicV27Root, replayPublicV27FramesWithEvents,
  replayPublicV27Witness } from './publicWorldV27Snapshot'
import { visitPublicV23FramesWithEvents } from './publicWorldV23Transitions'
import { confirmPublicV28RiverBridge, previewPublicV28RiverBridge } from './publicWorldV28RiverBridgeAction'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import type { PublicV28Progress } from './publicWorldV28Migration'
import { replayPublicV28FramesWithEvents } from './publicWorldV28Replay'
import { publicV28RiverPassage } from './publicWorldV28RiverPassage'
import { projectPublicV28Pose } from './publicWorldV28RiverSupport'
import { createPublicV28Root, decodePublicV28CheckedSuccessor, decodePublicV28Root,
  decodePublicV28Witness, replayPublicV28Witness } from './publicWorldV28Snapshot'

const seed = 'greenway-alpha'
const site = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-14')!
const farSite = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-43')!
const offsetSite = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-44')!
const witness = { kind: 'river-bridge/v1' as const, id: site.id }
const frames = (z: number, count = 1) => Array.from({ length: count }, () => ({
  intents: [{ type: 'move' as const, delta: { x: 0, z } }], walkRequested: false }))

function ready(bridge = site): PublicV28Progress {
  const { head } = createPublicV23Root(seed)
  const floor = resolvePublicV23Surface(head.state, bridge.from, [])
  if (!floor) throw new Error('Missing canonical bank')
  const state = { ...head.state, movementOwner: 'streamed' as const,
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(head.state.discoveryMask), ...bridge.footprintTileIds])].sort()),
    player: { ...head.state.player, position: { ...bridge.from, y: floor.floorY },
      inventory: [...head.state.player.inventory, { itemId: 'logs' as const, quantity: 12 }] } }
  const old = decodePublicV23Progress({ state, greenwayWorks: head.greenwayWorks,
    regionalWorks: head.regionalWorks }, seed)
  if (!old) throw new Error('Missing checked bank progress')
  return { ...old, terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0, riverBridgeIds: [] }
}

function rooted(initial = ready()) {
  const v23 = createPublicV23Root(seed)
  const v24 = createPublicV24Root({ head: { ...v23.head, state: initial.state,
    greenwayWorks: initial.greenwayWorks, regionalWorks: initial.regionalWorks,
    saveRevision: 1, witness: { kind: 'checkpoint' as const } }, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  return createPublicV28Root({ head: v27.head, lineage: v27.lineage })
}

describe('V28 checked connected-river bridge witness', () => {
  it('replays a streamed terrain dig through the V27/V26 boundary without losing bridge ledger', () => {
    const base = ready(), gx = 20, gz = -2, point = { x: 80, z: -8 }
    const floor = resolvePublicV23Surface(base.state, point, [])
    if (!floor) throw new Error('Missing streamed dig support')
    const player = { ...base.state.player,
      position: { ...point, y: floor.floorY },
      equipment: { ...base.state.player.equipment, mainHand: 'field_spade' as const },
      inventory: [...base.state.player.inventory, { itemId: 'field_spade' as const, quantity: 1 }] }
    const state = { ...base.state, player, discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(base.state.discoveryMask), floor.tileId])].sort()) }
    const old = decodePublicV23Progress({ state, greenwayWorks: base.greenwayWorks,
      regionalWorks: base.regionalWorks }, seed)
    if (!old) throw new Error('Missing checked streamed dig progress')
    const root = rooted({ ...old, terrain: base.terrain, nextHomeAtMs: 0, riverBridgeIds: [] })
    const before: PublicV28Progress = { state: root.head.state,
      greenwayWorks: root.head.greenwayWorks, regionalWorks: root.head.regionalWorks,
      terrain: root.head.terrain, nextHomeAtMs: root.head.nextHomeAtMs,
      riverBridgeIds: root.head.riverBridgeIds }
    const witness = { kind: 'terrain-action/v1' as const,
      action: { kind: 'dig' as const, gx, gz } }
    const v27Before = { state: before.state, greenwayWorks: before.greenwayWorks,
      regionalWorks: before.regionalWorks, terrain: before.terrain,
      nextHomeAtMs: before.nextHomeAtMs }
    const v26 = applyPublicV26TerrainAction(v27Before, witness.action)
    expect(v26.rejection).toBeUndefined()
    expect(replayPublicV26Witness(v27Before, witness)).toEqual(v26.progress)
    expect(replayPublicV27Witness(v27Before, witness)).toEqual(v26.progress)
    expect(replayPublicV26Witness(before, witness)).toBeNull()
    expect(replayPublicV27Witness(before, witness)).toBeNull()
    const next = replayPublicV28Witness(before, witness)
    if (!next) throw new Error('V28 rejected an inherited valid terrain dig')
    expect(next).toEqual({ ...v26.progress, riverBridgeIds: [] })
    expect(replayPublicV28Witness(root.head, witness)).toEqual(next)
    expect(publicV26TerrainConserved(before.terrain, next.terrain, seed)).toBe(true)
    const successor = { lineage: root.lineage, previous: root.head,
      head: { ...root.head, ...next, saveRevision: 1, witness } }
    expect(decodePublicV28Root(successor)).toEqual(successor)
    expect(decodePublicV28CheckedSuccessor(root, successor)).toEqual(successor)
    expect(replayPublicV28Witness(before, { ...witness,
      action: { ...witness.action, eligible: true } })).toBeNull()
    expect(replayPublicV28Witness({ ...before, forged: true } as PublicV28Progress,
      witness)).toBeNull()
    expect(decodePublicV28Root({ ...successor,
      head: { ...successor.head, terrain: before.terrain } })).toBeNull()
  })
  it('rejects a tiny downhill diagonal whose dry endpoints thread a wet river corner', () => {
    const from = { x: -426.06, z: -9.94 }, to = { x: -425.94, z: -10.06 }
    const readyState = ready(farSite)
    const fromFloor = resolvePublicV23Surface(readyState.state, from, [])!
    const toFloor = resolvePublicV23Surface(readyState.state, to, [])!
    expect(fromFloor.floorY - toFloor.floorY).toBeCloseTo(0.012159722821771135)
    expect(publicV25RiverTouchesSegment(seed, from, to)).toBe(true)
    const before: PublicV28Progress = { ...readyState, riverBridgeIds: [farSite.id],
      state: { ...readyState.state,
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(readyState.state.discoveryMask), fromFloor.tileId])].sort()),
        player: { ...readyState.state.player,
          position: { ...from, y: fromFloor.floorY }, verticalVelocity: 0 } } }
    const diagonal = [{ intents: [{ type: 'move' as const,
      delta: { x: to.x - from.x, z: to.z - from.z } }], walkRequested: false }]
    expect(decodePublicV23Progress({ state: before.state,
      greenwayWorks: before.greenwayWorks, regionalWorks: before.regionalWorks }, seed)).not.toBeNull()
    expect(replayPublicV28FramesWithEvents(before, diagonal)).toBeNull()
  })
  it('keeps an old Greenway bridge replay exactly on the V27 path', () => {
    const oldSeed = 'wizard-realms', { head } = createPublicV23Root(oldSeed)
    const old = resolvePublicV17GreenwaySite(oldSeed, 'works3:bridge:1')
    if (!old || old.kind !== 'bridge') throw new Error('Missing old Greenway bridge')
    const greenwayWorks = { ...head.greenwayWorks, builtBridgeIds: [old.id] }
    const point = { x: old.gapCenter.x, z: old.gapCenter.z }
    const floor = publicV17StarterSupportAt({ seed: oldSeed,
      profile: head.state.generationProfile, route: head.state.greenway.routes[0] ?? null,
      built: false, greenwayWorks }, point)
    if (floor?.kind !== 'bridge') throw new Error('Missing old bridge support')
    const oldProgress = decodePublicV23Progress({ state: { ...head.state,
      player: { ...head.state.player, xp: head.state.player.xp + 80,
        skillXp: { ...head.state.player.skillXp, construction: 80 },
        position: { ...point, y: floor.floorY } } }, greenwayWorks,
    regionalWorks: head.regionalWorks }, oldSeed)
    if (!oldProgress) throw new Error('Invalid old bridge progress')
    const wrapped = { ...oldProgress, terrain: emptyPublicV26TerrainLedger(),
      nextHomeAtMs: 0, riverBridgeIds: [] }
    const one = frames(0.16)
    const inherited = replayPublicV27FramesWithEvents(wrapped, one)
    expect(inherited).not.toBeNull()
    expect(replayPublicV28FramesWithEvents(wrapped, one)).toEqual({
      progress: { ...inherited!.progress, riverBridgeIds: [] }, events: inherited!.events })
  })

  it('requires discovery, dry grounded north bank, materials, canonical site and free footprint', () => {
    const before = ready()
    expect(previewPublicV28RiverBridge(before, site.id)).toMatchObject({ site, rejection: null })
    for (const id of ['works6:river-bridge:-014', 'works6:river-bridge:255', 'works6:river-bridge:-0'])
      expect(confirmPublicV28RiverBridge(before, id)).toEqual({ rejection: 'invalid_site' })
    expect(decodePublicV28Witness({ ...witness, position: site.from })).toBeNull()
    expect(confirmPublicV28RiverBridge({ ...before, state: { ...before.state,
      discoveryMask: encodeDiscoveredTileIds(decodeDiscoveredTileIds(before.state.discoveryMask)
        .filter((id) => id !== site.footprintTileIds[2])) } }, site.id))
      .toEqual({ rejection: 'undiscovered' })
    expect(confirmPublicV28RiverBridge({ ...before, state: { ...before.state,
      player: { ...before.state.player, inventory: [] } } }, site.id))
      .toEqual({ rejection: 'not_owned' })
    const moved = structuredClone(before)
    const approachFloor = resolvePublicV23Surface(moved.state, site.approach, [])!
    moved.state.player.position = { ...site.approach, y: approachFloor.floorY }
    expect(confirmPublicV28RiverBridge(moved, site.id)).toEqual({ rejection: 'too_far' })
    const occupied = { ...before, terrain: { ...before.terrain, columns: [{ gx: -14, gz: 3,
      openDepth: 1, rewardDepth: 1, pitLadder: false }] } }
    expect(confirmPublicV28RiverBridge(occupied, site.id)).toEqual({ rejection: 'occupied' })
  })

  it('charges exactly eight logs and awards one reward, then replays 50 frames across and back', () => {
    const before = ready()
    const built = confirmPublicV28RiverBridge(before, site.id)
    if ('rejection' in built) throw new Error(`Bridge rejected: ${built.rejection}`)
    expect(before.riverBridgeIds).toEqual([])
    expect(built.progress.riverBridgeIds).toEqual([site.id])
    expect(built.progress.state.player.inventory.find((stack) => stack.itemId === 'logs')?.quantity).toBe(4)
    expect(built.progress.state.player.xp - before.state.player.xp).toBe(80)
    expect(built.progress.state.player.skillXp.construction - before.state.player.skillXp.construction).toBe(80)
    expect(built.event).toMatchObject({ id: site.id, logsSpent: 8, xp: 80 })
    expect(confirmPublicV28RiverBridge(built.progress, site.id)).toEqual({ rejection: 'already_done' })
    expect(replayPublicV28Witness(before, witness)).toEqual(built.progress)
    expect(replayPublicV27Witness(built.progress, { kind: 'frame-batch/v1', frames: frames(0.16, 50) }))
      .toBeNull()
    const crossed = replayPublicV28FramesWithEvents(built.progress, frames(0.16, 50))
    expect(crossed?.progress.state.player.position.z).toBeCloseTo(16, 8)
    if (!crossed) throw new Error('North-to-south crossing rejected')
    const returned = replayPublicV28FramesWithEvents(crossed.progress, frames(-0.16, 50))
    expect(returned?.progress.state.player.position.z).toBeCloseTo(8, 8)
    const wetReplay = replayPublicV28FramesWithEvents(built.progress, frames(0.16, 25))
    const wet = wetReplay?.progress
    expect(wet && projectPublicV28Pose(wet, wet.terrain, wet.riverBridgeIds)?.bridgeId).toBe(site.id)
    expect(wetReplay?.events.filter((event) => event.type === 'player_moved').at(-1))
      .toMatchObject({ position: wet?.state.player.position })
    const offRail = { ...wet!, state: { ...wet!.state, player: { ...wet!.state.player,
      position: { ...wet!.state.player.position, x: -55.1 } } } }
    expect(replayPublicV28FramesWithEvents(offRail, frames(0.16))).toBeNull()
    const forgedElevation = { ...wet!, state: { ...wet!.state, player: { ...wet!.state.player,
      position: { ...wet!.state.player.position, y: wet!.state.player.position.y + 0.1 },
      verticalVelocity: -0.49 } } }
    expect(replayPublicV28FramesWithEvents(forgedElevation, frames(0.16))).toBeNull()
    expect(replayPublicV28FramesWithEvents(before, frames(0.16, 50))).toBeNull()
  })

  it('carries the saved -43 bridge over both dry-end seams and rejects off-lane exits', async () => {
    const built = confirmPublicV28RiverBridge(ready(farSite), farSite.id)
    if ('rejection' in built) throw new Error(`Bridge rejected: ${built.rejection}`)
    let progress = built.progress
    let firstSeam: PublicV28Progress | null = null
    let secondSeam: PublicV28Progress | null = null
    const beyondExit = farSite.exit.z + 0.16
    while (progress.state.player.position.z < beyondExit - 1e-6) {
      const next = replayPublicV28FramesWithEvents(progress, frames(0.16))
      if (!next) throw new Error(`Bridge crossing rejected at z=${progress.state.player.position.z}`)
      const fromTile = resolvePublicV23Surface(progress.state, progress.state.player.position, [])?.tileId
      const toTile = resolvePublicV23Surface(next.progress.state, next.progress.state.player.position, [])?.tileId
      if (fromTile === farSite.wetGapTileIds.at(-1)
        && toTile === farSite.footprintTileIds.at(-2)) firstSeam = progress
      if (fromTile === farSite.footprintTileIds.at(-2)
        && toTile === farSite.footprintTileIds.at(-1)) secondSeam = progress
      if (fromTile !== toTile && (toTile === farSite.footprintTileIds.at(-2)
        || toTile === farSite.footprintTileIds.at(-1))) {
        expect(next.progress.state.player.verticalVelocity).toBe(0)
        expect(next.events.filter((event) => event.type === 'player_moved').at(-1))
          .toMatchObject({ position: next.progress.state.player.position })
        expect(replayPublicV28FramesWithEvents(next.progress,
          [{ intents: [], walkRequested: false }])?.progress.state.player.verticalVelocity).toBe(0)
      }
      progress = next.progress
    }
    expect(firstSeam).not.toBeNull()
    expect(secondSeam).not.toBeNull()
    expect(progress.state.player.position.z).toBeGreaterThan(farSite.exit.z)
    expect(progress.state.player.verticalVelocity).toBe(0)
    if (!firstSeam || !secondSeam) throw new Error('Missing guarded bridge seam')
    for (const seam of [firstSeam, secondSeam]) {
      const trial = visitPublicV23FramesWithEvents({ state: seam.state,
        greenwayWorks: seam.greenwayWorks, regionalWorks: seam.regionalWorks },
        frames(0.16), () => true, true, { maxOrdinaryGroundStepMeters: 0.8 })
      expect(trial?.progress.state.player.verticalVelocity).toBeLessThan(0)
    }
    const offLane = structuredClone(firstSeam)
    offLane.state.player.position.x = farSite.to.x + farSite.widthMeters / 2 + 0.2
    expect(projectPublicV28Pose(offLane, offLane.terrain, offLane.riverBridgeIds)).not.toBeNull()
    expect(replayPublicV28FramesWithEvents(offLane, frames(0.16))).toBeNull()
    const pit = { ...secondSeam, terrain: { ...secondSeam.terrain,
      columns: [...secondSeam.terrain.columns,
      { gx: farSite.exit.x / 4, gz: farSite.exit.z / 4,
        openDepth: 1, rewardDepth: 1, pitLadder: false }] } }
    expect(replayPublicV28FramesWithEvents(pit, frames(0.16))).toBeNull()
    const dryPoint = { x: farSite.approach.x, z: farSite.from.z - 2.08 }
    const dryFloor = resolvePublicV23Surface(progress.state, dryPoint, [])!
    const unrelated = { ...progress, state: { ...progress.state, player: { ...progress.state.player,
      position: { ...dryPoint, y: dryFloor.floorY } } } }
    const oldTrial = visitPublicV23FramesWithEvents({ state: unrelated.state,
      greenwayWorks: unrelated.greenwayWorks, regionalWorks: unrelated.regionalWorks },
      frames(0.16), () => true, true, { maxOrdinaryGroundStepMeters: 0.8 })
    expect(oldTrial).not.toBeNull()
    expect(oldTrial?.progress.state.player.verticalVelocity).toBeLessThan(0)
    const dryStep = replayPublicV28FramesWithEvents(unrelated, frames(0.16))
    expect(dryStep?.progress.state.player.verticalVelocity).toBe(0)
    expect(dryStep?.progress.state.player.position.y).toBeCloseTo(
      resolvePublicV23Surface(progress.state, dryStep!.progress.state.player.position, [])!.floorY)
    expect(dryStep?.events.find((event) => event.type === 'player_moved'))
      .toMatchObject({ position: dryStep?.progress.state.player.position })
    const postPoint = { x: -170.04, z: 16.68 }
    const postFloor = resolvePublicV23Surface(progress.state, postPoint, [])!
    const post = { ...progress, state: { ...progress.state, player: { ...progress.state.player,
      position: { ...postPoint, y: postFloor.floorY }, verticalVelocity: 0 } } }
    const east = [{ intents: [{ type: 'move' as const, delta: { x: 0.16, z: 0 } }],
      walkRequested: false }]
    const oldPreview = replayPublicV28FramesWithEvents(post, east, true)
    expect(oldPreview?.progress.state.player.position.y).toBe(1.276151702590684)
    expect(oldPreview?.progress.state.player.verticalVelocity).toBe(-0.49000000000000005)
    expect(oldPreview?.events.find((event) => event.type === 'player_moved'))
      .toMatchObject({ position: oldPreview?.progress.state.player.position })
    const previewDigest = await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(JSON.stringify(oldPreview)))
    expect(Array.from(new Uint8Array(previewDigest), (byte) => byte.toString(16).padStart(2, '0')).join(''))
      .toBe('5a0227a45dd2c56d82f657c1b3a827d2944325227121590d52dbf094341127b7')
    const withBridge = replayPublicV28FramesWithEvents(post, east)
    expect(withBridge?.progress.state.player.verticalVelocity).toBe(0)
    expect(withBridge?.progress.state.player.position.y).toBeCloseTo(
      resolvePublicV23Surface(progress.state, withBridge!.progress.state.player.position, [])!.floorY)
    const withoutBridge = replayPublicV28FramesWithEvents({ ...post, riverBridgeIds: [] }, east)
    expect(withoutBridge?.progress.state.player).toEqual(withBridge?.progress.state.player)
    expect(withoutBridge?.events).toEqual(withBridge?.events)
  })

  it('returns from the saved -43 far bank across only its guarded dry-to-wet seam', async () => {
    const built = confirmPublicV28RiverBridge(ready(farSite), farSite.id)
    if ('rejection' in built) throw new Error(`Bridge rejected: ${built.rejection}`)
    let progress = built.progress
    const outwardResults: unknown[] = [], outwardEvents: unknown[] = []
    const returnResults: unknown[] = [], returnEvents: unknown[] = []
    const digest = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(JSON.stringify(value)))), (byte) => byte.toString(16).padStart(2, '0')).join('')
    for (const frame of frames(0.16, 76)) {
      const step = replayPublicV28FramesWithEvents(progress, [frame])
      if (!step) throw new Error(`Outward crossing rejected at z=${progress.state.player.position.z}`)
      outwardResults.push(step)
      outwardEvents.push(...step.events)
      progress = step.progress
    }
    expect(progress.state.player.position.z).toBeGreaterThan(farSite.exit.z)
    expect(await digest(outwardResults)).toBe('e0021c8ea3e5284e978c630282605af8ca7fbbf92cc02a7678b0d6cadff0bbd8')
    expect(await digest(outwardEvents)).toBe('67606e91fab9bc9063239862ffeddedb0a0c69e40463dc8feeda90e87ccfd7b3')
    for (const [index, frame] of frames(-0.16, 76).entries()) {
      if (index === 38) {
        expect(await digest(returnResults)).toBe('abc84f052dc2e5ad0d8b22ba7c01104a5a4c1fa0ed5260adf75b423e07ba893d')
        expect(await digest(returnEvents)).toBe('5564a621cfd354dc31d5e2b57b4aae7cdd9fe0212550f0bad801a3b475dc322f')
        const from = progress.state.player.position
        const raw = visitPublicV23FramesWithEvents({ state: progress.state,
          greenwayWorks: progress.greenwayWorks, regionalWorks: progress.regionalWorks },
        [frame], () => true, true, { maxOrdinaryGroundStepMeters: 0.8 })
        if (!raw) throw new Error('Missing V23 return trial')
        const to = raw.progress.state.player.position
        const passage = (ids: readonly string[], start = from, end = to,
          terrain = progress.terrain) => publicV28RiverPassage(progress, terrain, ids, start, end)
        expect(passage(progress.riverBridgeIds)).toEqual({ ok: true })
        expect(passage([])).toEqual({ ok: false, reason: 'river-needs-bridge' })
        expect(passage([site.id])).toEqual({ ok: false, reason: 'river-needs-bridge' })
        const offLaneX = farSite.to.x + farSite.widthMeters / 2 + 0.2
        expect(passage(progress.riverBridgeIds, { ...from, x: offLaneX },
          { ...to, x: offLaneX }).ok).toBe(false)
        expect(passage(progress.riverBridgeIds, from, { ...to, y: to.y - 0.1 }).ok).toBe(false)
        const pit = { ...progress.terrain, columns: [...progress.terrain.columns,
          { gx: Math.ceil(from.x / 4 - 0.5), gz: Math.ceil(from.z / 4 - 0.5),
            openDepth: 1, rewardDepth: 1, pitLadder: false }] }
        expect(passage(progress.riverBridgeIds, from, to, pit).ok).toBe(false)
      }
      const step = replayPublicV28FramesWithEvents(progress, [frame])
      if (!step) throw new Error(`Return frame ${index} rejected at z=${progress.state.player.position.z}`)
      returnResults.push(step)
      returnEvents.push(...step.events)
      progress = step.progress
    }
    expect(progress.state.player.position.z).toBeCloseTo(farSite.from.z, 8)
  })

  it('crosses the saved -44 deck from the visible offset approach', async () => {
    const built = confirmPublicV28RiverBridge(ready(offsetSite), offsetSite.id)
    if ('rejection' in built) throw new Error(`Bridge rejected: ${built.rejection}`)
    const startXZ = { x: -175.44, z: 1.84 }, yaw = 3.12
    const floor = resolvePublicV23Surface(built.progress.state, startXZ, [])!
    let progress: PublicV28Progress = { ...built.progress, state: { ...built.progress.state,
      player: { ...built.progress.state.player,
        position: { ...startXZ, y: floor.floorY }, yaw, verticalVelocity: 0 } } }
    const frame = { intents: [{ type: 'move' as const, delta: {
      x: -Math.sin(yaw) * 0.16, z: -Math.cos(yaw) * 0.16 } }], walkRequested: false }
    const accepted: unknown[] = [], events: unknown[] = []
    for (let index = 0; index < 26; index++) {
      const step = replayPublicV28FramesWithEvents(progress, [frame])
      if (!step) throw new Error(`Old accepted -44 frame ${index} rejected`)
      accepted.push(step)
      events.push(...step.events)
      progress = step.progress
    }
    expect(progress.state.player.position.x).toBeCloseTo(-175.529818, 5)
    expect(progress.state.player.position.z).toBeCloseTo(5.99903, 5)
    const digest = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(JSON.stringify(value)))), (byte) => byte.toString(16).padStart(2, '0')).join('')
    expect(await digest(accepted)).toBe('0bbabe411dc5eeded1c1197d86c86917355c68a3b0346acdbcba20b6ae60f889')
    expect(await digest(events)).toBe('930c4aab66a405102ddc7bfa6fd30e2ca2dee3bb0ca5acc6bc1c21d4017920db')
    const from = progress.state.player.position
    const raw = visitPublicV23FramesWithEvents({ state: progress.state,
      greenwayWorks: progress.greenwayWorks, regionalWorks: progress.regionalWorks },
    [frame], () => true, true, { maxOrdinaryGroundStepMeters: 0.8 })
    if (!raw) throw new Error('Missing V23 outward trial')
    const to = raw.progress.state.player.position
    const passage = (ids: readonly string[], start = from, end = to,
      terrain = progress.terrain) => publicV28RiverPassage(progress, terrain, ids, start, end)
    expect(passage(progress.riverBridgeIds)).toEqual({ ok: true })
    expect(passage([]).ok).toBe(false)
    expect(passage([farSite.id]).ok).toBe(false)
    const offLaneX = offsetSite.from.x + offsetSite.widthMeters / 2 + 0.2
    expect(passage(progress.riverBridgeIds, { ...from, x: offLaneX },
      { ...to, x: offLaneX }).ok).toBe(false)
    expect(passage(progress.riverBridgeIds, { ...from, y: from.y + 0.1 },
      { ...to, y: to.y + 0.1 }).ok).toBe(false)
    const pit = { ...progress.terrain, columns: [...progress.terrain.columns,
      { gx: Math.ceil(from.x / 4 - 0.5), gz: Math.ceil(from.z / 4 - 0.5),
        openDepth: 1, rewardDepth: 1, pitLadder: false }] }
    expect(passage(progress.riverBridgeIds, from, to, pit).ok).toBe(false)
    for (let index = 26; index < 90; index++) {
      const step = replayPublicV28FramesWithEvents(progress, [frame])
      if (!step) throw new Error(`Outward -44 frame ${index} rejected at z=${progress.state.player.position.z}`)
      progress = step.progress
    }
    expect(progress.state.player.position.z).toBeGreaterThan(offsetSite.exit.z)
    const reverse = { ...frame, intents: [{ type: 'move' as const,
      delta: { x: -frame.intents[0].delta.x, z: -frame.intents[0].delta.z } }] }
    for (let index = 0; index < 90; index++) {
      if (index === 63) {
        expect(replayPublicV28FramesWithEvents({ ...progress, riverBridgeIds: [] }, [reverse])).toBeNull()
        expect(replayPublicV28FramesWithEvents({ ...progress,
          riverBridgeIds: [farSite.id] }, [reverse])).toBeNull()
        const offLane = structuredClone(progress)
        offLane.state.player.position.x = offsetSite.from.x + offsetSite.widthMeters / 2 + 0.2
        expect(replayPublicV28FramesWithEvents(offLane, [reverse])).toBeNull()
        const forged = structuredClone(progress)
        forged.state.player.position.y += 0.1
        expect(replayPublicV28FramesWithEvents(forged, [reverse])).toBeNull()
        const dryZ = progress.state.player.position.z + reverse.intents[0].delta.z
        const pit = { ...progress, terrain: { ...progress.terrain,
          columns: [{ gx: Math.ceil(progress.state.player.position.x / 4 - 0.5),
            gz: Math.ceil(dryZ / 4 - 0.5), openDepth: 1, rewardDepth: 1,
            pitLadder: false }] } }
        expect(replayPublicV28FramesWithEvents(pit, [reverse])).toBeNull()
      }
      const step = replayPublicV28FramesWithEvents(progress, [reverse])
      if (!step) throw new Error(`Return -44 frame ${index} rejected at z=${progress.state.player.position.z}`)
      if (index === 63) {
        const dryFloor = resolvePublicV23Surface(progress.state, step.progress.state.player.position, [])!
        expect(step.progress.state.player.position.y).toBe(dryFloor.floorY)
        expect(step.progress.state.player.verticalVelocity).toBe(0)
        expect(step.events.filter((event) => event.type === 'player_moved').at(-1))
          .toMatchObject({ position: step.progress.state.player.position })
      }
      progress = step.progress
    }
    expect(progress.state.player.position.x).toBeCloseTo(startXZ.x, 8)
    expect(progress.state.player.position.z).toBeCloseTo(startXZ.z, 8)
    const centerXZ = { x: offsetSite.from.x, z: startXZ.z }
    const centerFloor = resolvePublicV23Surface(built.progress.state, centerXZ, [])!
    let center: PublicV28Progress = { ...built.progress, state: { ...built.progress.state,
      player: { ...built.progress.state.player,
        position: { ...centerXZ, y: centerFloor.floorY }, yaw: Math.PI, verticalVelocity: 0 } } }
    for (let index = 0; index < 27; index++) {
      const step = replayPublicV28FramesWithEvents(center, frames(0.16))
      if (!step) throw new Error(`Centerline -44 frame ${index} rejected`)
      center = step.progress
    }
    expect(center.state.player.position.z).toBeGreaterThan(offsetSite.from.z + 2)
  })

  it('checks three-slot bridge replay, forged ledger rejection, atomic reload and stale CAS', async () => {
    const root = rooted()
    expect(decodePublicV28Root(root)).toEqual(root)
    const built = replayPublicV28Witness(root.head, witness)
    if (!built) throw new Error('Expected checked bridge candidate')
    const saved = { lineage: root.lineage, previous: root.head,
      head: { ...root.head, ...built, saveRevision: 1, witness } }
    expect(decodePublicV28Root(saved)).toEqual(saved)
    expect(decodePublicV28CheckedSuccessor(root, saved)).toEqual(saved)
    expect(decodePublicV28Root({ ...saved, head: { ...saved.head,
      riverBridgeIds: ['works6:river-bridge:-13'] } })).toBeNull()
    expect(decodePublicV28Root({ ...root, head: { ...root.head,
      riverBridgeIds: [site.id] } })).toBeNull()
    const factory = new IDBFactory(), store = createAtomicV28Store(factory)
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Expected missing V28 root')
    expect(await store.commit(missing.proof, root)).toBe('committed')
    const competitor = createAtomicV28Store(factory)
    const left = await store.readChecked(), right = await competitor.readChecked()
    if (left.status !== 'valid' || right.status !== 'valid') throw new Error('Expected V28 genesis')
    expect(await store.commit(left.proof, saved)).toBe('committed')
    expect(await competitor.commit(right.proof, saved)).toBe('revision-changed')
    const loaded = await createAtomicV28Store(factory).readChecked()
    expect(loaded).toMatchObject({
      status: 'valid', root: { head: { riverBridgeIds: [site.id], saveRevision: 1 } } })
    if (loaded.status !== 'valid') throw new Error('Missing reloaded bridge')
    const journey = { kind: 'frame-batch/v1' as const, frames: frames(0.16, 50) }
    const crossed = replayPublicV28Witness(loaded.root.head, journey)
    if (!crossed) throw new Error('Could not cross from reloaded bridge')
    const farBank = { lineage: loaded.root.lineage, previous: loaded.root.head,
      head: { ...loaded.root.head, ...crossed, saveRevision: 2, witness: journey } }
    expect(decodePublicV28Root(farBank)).toEqual(farBank)
    const reread = await store.readChecked()
    if (reread.status !== 'valid') throw new Error('Missing bridge commit')
    expect(await store.commit(reread.proof, farBank)).toBe('committed')
    const persisted = await createAtomicV28Store(factory).readChecked()
    if (persisted.status !== 'valid') throw new Error('Missing saved far bank')
    expect(persisted.root.head.state.player.position.z).toBeCloseTo(16, 8)
    const reverse = { kind: 'frame-batch/v1' as const, frames: frames(-0.16, 50) }
    const returned = replayPublicV28Witness(persisted.root.head, reverse)
    if (!returned) throw new Error('Could not return from saved far bank')
    expect(returned.state.player.position.z).toBeCloseTo(8, 8)
    expect(decodePublicV28Root({ lineage: persisted.root.lineage, previous: persisted.root.head,
      head: { ...persisted.root.head, ...returned, saveRevision: 3, witness: reverse } }))
      .not.toBeNull()
  }, 30_000)
})
