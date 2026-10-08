import { describe, expect, it } from 'vitest'
import { createStreamedWorld } from './streamedWorld'
import { createStreamedWorldFromState } from './index'
import type { StreamedWorldIntent, StreamedWorldState } from './streamedWorld'
import { mireglassBermFaceRowAt, mireglassFenRowAt } from './mireglassTerrain'
import { mireglassAnchors } from './mireglassContent'
import { worldTileAtGrid } from './worldChunks'

const move = (x: number, z = 0): StreamedWorldIntent => ({ type: 'move', delta: { x, z } })
const mireglassSeed = 'mireglass-authority'
const fenRow = mireglassFenRowAt(mireglassSeed, -352)
const bermRow = mireglassBermFaceRowAt(mireglassSeed, -400)
const barriers = [
  { name: 'fen front', from: { x: -352, z: fenRow - 4 }, to: { x: -352, z: fenRow }, code: 'fen_channel' },
  { name: 'fen west side', from: { x: -452, z: 400 }, to: { x: -448, z: 400 }, code: 'fen_channel' },
  { name: 'fen east side', from: { x: -252, z: 400 }, to: { x: -256, z: 400 }, code: 'fen_channel' },
  { name: 'fen back', from: { x: -352, z: 520 }, to: { x: -352, z: 516 }, code: 'fen_channel' },
  { name: 'fen diagonal', from: { x: -353, z: fenRow - 3 }, to: { x: -351, z: fenRow - 1 }, code: 'fen_channel' },
  { name: 'slate south', from: { x: -400, z: bermRow - 4 }, to: { x: -400, z: bermRow }, code: 'slate_cliff' },
  { name: 'slate west', from: { x: -444, z: 460 }, to: { x: -440, z: 460 }, code: 'slate_cliff' },
  { name: 'slate east', from: { x: -356, z: 460 }, to: { x: -360, z: 460 }, code: 'slate_cliff' },
  { name: 'slate diagonal', from: { x: -401, z: bermRow - 3 }, to: { x: -399, z: bermRow - 1 }, code: 'slate_cliff' },
] as const

describe('separate streamed-world authority', () => {
  it('starts at safe Greenway ground and discovers each entered global tile only once', () => {
    const runtime = createStreamedWorld('first-discovery')
    const start = worldTileAtGrid('first-discovery', 0, 0)
    expect(runtime.state).toEqual({
      seed: 'first-discovery', tick: 0,
      player: { position: { x: 0, y: start.center.y, z: 0 }, yaw: 0, pitch: 0, verticalVelocity: 0 },
      discoveredTileIds: [start.id],
    })
    expect(runtime.activeChunkCount()).toBe(9)
    expect(runtime.tileAtWorld(256, 256)).toBeNull()
    expect(runtime.advance([move(1)]).events.map((event) => event.type)).toEqual(['player_moved'])
    const entered = runtime.advance([move(3)])
    expect(entered.events).toContainEqual({ type: 'tile_discovered', tick: 2, tileId: 'tile-4-3' })
    expect(runtime.advance([move(1)]).events.map((event) => event.type)).toEqual(['player_moved'])
    expect(runtime.advance([move(-4)]).events.map((event) => event.type)).toEqual(['player_moved'])
    expect(runtime.state.discoveredTileIds).toEqual(['tile-3-3', 'tile-4-3'])
    expect(JSON.stringify(runtime.state)).not.toMatch(/cache|chunks|tiles/i)
    expect(JSON.stringify(runtime)).not.toMatch(/cache|chunks|terrain/i)
  })

  it('reuses frozen discovery on known moves and inserts first visits in lexical order', () => {
    const runtime = createStreamedWorld('discovery-reuse')
    const initialIds = runtime.state.discoveredTileIds
    const repeated = runtime.advance([move(1), move(-1)])
    expect(repeated.events.map((event) => event.type)).toEqual(['player_moved', 'player_moved'])
    expect(repeated.state.discoveredTileIds).toBe(initialIds)
    expect(Object.isFrozen(initialIds)).toBe(true)

    const firstVisits = runtime.advance([move(-4), move(4), move(4)])
    expect(firstVisits.events.map((event) => event.type)).toEqual([
      'player_moved', 'tile_discovered', 'player_moved', 'player_moved', 'tile_discovered',
    ])
    expect(firstVisits.events.filter((event) => event.type === 'tile_discovered')).toEqual([
      { type: 'tile_discovered', tick: 2, tileId: 'tile-2-3' },
      { type: 'tile_discovered', tick: 2, tileId: 'tile-4-3' },
    ])
    expect(firstVisits.state.discoveredTileIds).toEqual(['tile-2-3', 'tile-3-3', 'tile-4-3'])
    expect(firstVisits.state.discoveredTileIds).not.toBe(initialIds)
    expect(initialIds).toEqual(['tile-3-3'])
    expect(Object.isFrozen(firstVisits.state.discoveredTileIds)).toBe(true)

    const revisited = runtime.advance([move(-4), move(-4)])
    expect(revisited.events.map((event) => event.type)).toEqual(['player_moved', 'player_moved'])
    expect(revisited.state.discoveredTileIds).toBe(firstVisits.state.discoveredTileIds)
    const rejected = runtime.advance([move(5)])
    expect(rejected.events).toEqual([])
    expect(rejected.rejections).toEqual([{ intentIndex: 0, intentType: 'move', code: 'invalid_value' }])
    expect(rejected.state.discoveredTileIds).toBe(firstVisits.state.discoveredTileIds)

    const restored = createStreamedWorldFromState(JSON.parse(JSON.stringify(rejected.state)))
    const restoredIds = restored.state.discoveredTileIds
    expect(restored.advance([move(4)]).state.discoveredTileIds).toBe(restoredIds)
    const nextVisit = restored.advance([move(-4), move(-4)])
    expect(nextVisit.events.filter((event) => event.type === 'tile_discovered')).toEqual([
      { type: 'tile_discovered', tick: 6, tileId: 'tile-1-3' },
    ])
    expect(nextVisit.state.discoveredTileIds).toEqual(['tile-1-3', 'tile-2-3', 'tile-3-3', 'tile-4-3'])
    expect(restoredIds).toEqual(['tile-2-3', 'tile-3-3', 'tile-4-3'])
  })

  it('retries discovery after a later intent throws without committing the frame', () => {
    const runtime = createStreamedWorld('discovery-rollback')
    const before = runtime.state
    expect(() => runtime.advance([move(4), null as unknown as StreamedWorldIntent])).toThrow(TypeError)
    expect(runtime.state).toBe(before)

    const retry = runtime.advance([move(4), move(-4), move(4)])
    expect(retry.events.map((event) => event.type)).toEqual([
      'player_moved', 'tile_discovered', 'player_moved', 'player_moved',
    ])
    expect(retry.events.filter((event) => event.type === 'tile_discovered')).toEqual([
      { type: 'tile_discovered', tick: 1, tileId: 'tile-4-3' },
    ])
    expect(retry.state.discoveredTileIds).toEqual(['tile-3-3', 'tile-4-3'])
  })

  it('accepts a distant Mireglass start without changing the one-argument default', () => {
    const seed = 'mireglass-start'
    const defaultStart = createStreamedWorld(seed)
    expect(defaultStart.state.player.position.x).toBe(0)
    expect(defaultStart.state.player.position.z).toBe(0)

    const start = { x: -288, z: 288 }
    const runtime = createStreamedWorld(seed, start)
    const ground = runtime.tileAtWorld(start.x, start.z)
    expect(ground).toEqual(worldTileAtGrid(seed, -72, 72))
    expect(runtime.state.player.position).toEqual({ ...start, y: ground!.center.y })
    expect(runtime.state.discoveredTileIds).toEqual([ground!.id])
    expect(runtime.activeChunkCount()).toBe(9)
    expect(runtime.tileAtWorld(0, 0)).toBeNull()
  })

  it('uses the effective pit for start, snapshot validation, gravity landing, and reload', () => {
    const seed = 'pit-runtime-landing'
    const cache = mireglassAnchors(seed).sealCache.tile
    const facts = { cachePitDug: true }
    const original = createStreamedWorld(seed, cache.center)
    const oldStateBytes = JSON.stringify(original.state)
    const dugStart = createStreamedWorld(seed, cache.center, facts)
    expect(dugStart.state.player.position.y).toBe(1.65)
    expect(dugStart.tileAtWorld(cache.center.x, cache.center.z)!.center.y).toBe(1.65)
    const explicitFalse = createStreamedWorld(seed, cache.center, { cachePitDug: false })
    expect(JSON.stringify(explicitFalse.state)).toBe(oldStateBytes)
    expect(JSON.stringify(explicitFalse.advance([]))).toBe(JSON.stringify(createStreamedWorld(seed, cache.center).advance([])))
    expect(createStreamedWorldFromState(original.state).state).toEqual(original.state)

    const landing = createStreamedWorldFromState(original.state, facts)
    expect(landing.state.player.position.y).toBe(cache.center.y)
    for (let frame = 0; frame < 60 && landing.state.player.position.y > 1.65; frame += 1) landing.advance([])
    expect(landing.state.player.position.y).toBe(1.65)
    expect(landing.state.player.verticalVelocity).toBe(0)
    expect(landing.advance([{ type: 'jump' }]).rejections).toEqual([])
    expect(JSON.stringify(original.state)).toBe(oldStateBytes)

    const groundedSnapshot = { ...dugStart.state }
    const resumed = createStreamedWorldFromState(groundedSnapshot, facts)
    expect(resumed.state).toEqual(dugStart.state)
    expect(resumed.tileAtWorld(cache.center.x, cache.center.z)!.center.y).toBe(1.65)
    expect(() => createStreamedWorldFromState(groundedSnapshot)).toThrow('Invalid streamed-world snapshot position.')
  })

  it('round-trips a serialized snapshot without mutating or retaining its input objects', () => {
    const live = createStreamedWorld('hydrate-roundtrip')
    live.advance([move(4), { type: 'look', yawDelta: 0.25, pitchDelta: 0.1 }, { type: 'jump' }])
    const snapshot = JSON.parse(JSON.stringify(live.state))
    const snapshotBytes = JSON.stringify(snapshot)
    const restored = createStreamedWorldFromState(snapshot)
    expect(restored.state).toEqual(live.state)
    expect(JSON.stringify(snapshot)).toBe(snapshotBytes)
    expect(Object.isFrozen(snapshot.player.position)).toBe(false)
    expect(Object.isFrozen(restored.state.player.position)).toBe(true)
    snapshot.player.position.x = 100
    snapshot.discoveredTileIds.push('tile-4-3')
    expect(restored.state).toEqual(live.state)
  })

  it('hydrates a caller-validated relocation with canonical discovery and a bounded destination window', () => {
    const seed = 'hydrate-relocation'
    const source = createStreamedWorld(seed).state
    const destination = worldTileAtGrid(seed, -72, 72)
    const snapshot: StreamedWorldState = {
      ...source, tick: source.tick + 1,
      player: { ...source.player, position: { ...destination.center }, verticalVelocity: 0 },
      discoveredTileIds: [source.discoveredTileIds[0], destination.id].sort(),
    }
    const restored = createStreamedWorldFromState(snapshot)
    expect(restored.state).toEqual(snapshot)
    expect(restored.activeChunkCount()).toBe(9)
    expect(restored.activeChunkCoordinates()).toContainEqual({ chunkX: -5, chunkZ: 4 })
    expect(restored.tileAtWorld(destination.center.x, destination.center.z)).toEqual(destination)
    expect(restored.tileAtWorld(0, 0)).toBeNull()
  })

  it('rejects malformed or tampered snapshots before restoring authority', () => {
    const base = createStreamedWorld('hydrate-validation').state
    const position = (patch: Partial<StreamedWorldState['player']['position']>) =>
      ({ ...base, player: { ...base.player, position: { ...base.player.position, ...patch } } })
    const player = (patch: Partial<StreamedWorldState['player']>) =>
      ({ ...base, player: { ...base.player, ...patch } })
    const invalid = [
      { name: 'empty seed', state: { ...base, seed: '' } },
      { name: 'non-string seed', state: { ...base, seed: 7 as unknown as string } },
      { name: 'negative tick', state: { ...base, tick: -1 } },
      { name: 'unsafe tick', state: { ...base, tick: Number.MAX_SAFE_INTEGER + 1 } },
      { name: 'non-finite x', state: position({ x: NaN }) },
      { name: 'out-of-world z', state: position({ z: 1024 }) },
      { name: 'non-finite y', state: position({ y: Infinity }) },
      { name: 'underground y', state: position({ y: base.player.position.y - 0.001 }) },
      { name: 'out-of-range yaw', state: player({ yaw: 1e6 + 1 }) },
      { name: 'out-of-range pitch', state: player({ pitch: Math.PI / 2 + 0.001 }) },
      { name: 'out-of-range vertical velocity', state: player({ verticalVelocity: -50.01 }) },
      { name: 'non-array discovery', state: { ...base, discoveredTileIds: null as unknown as readonly string[] } },
      { name: 'noncanonical tile ID', state: { ...base, discoveredTileIds: ['tile-03-3', ...base.discoveredTileIds] } },
      { name: 'out-of-world tile ID', state: { ...base, discoveredTileIds: ['tile-259-3', ...base.discoveredTileIds] } },
      { name: 'duplicate tile ID', state: { ...base, discoveredTileIds: [base.discoveredTileIds[0], base.discoveredTileIds[0]] } },
      { name: 'unsorted tile IDs', state: { ...base, discoveredTileIds: ['tile-4-3', base.discoveredTileIds[0]] } },
      { name: 'missing current tile', state: { ...base, discoveredTileIds: ['tile-4-3'] } },
    ]
    for (const { name, state } of invalid) {
      expect(() => createStreamedWorldFromState(state), name).toThrow(RangeError)
    }
    expect(createStreamedWorldFromState(player({ yaw: 1e6, pitch: -Math.PI / 2, verticalVelocity: -50 })).state.player)
      .toMatchObject({ yaw: 1e6, pitch: -Math.PI / 2, verticalVelocity: -50 })
  })

  it('keeps restored ticks and airborne velocity within their restorable ranges', () => {
    const base = createStreamedWorld('hydrate-limits').state
    const falling = createStreamedWorldFromState({
      ...base,
      player: {
        ...base.player,
        position: { ...base.player.position, y: base.player.position.y + 100 },
        verticalVelocity: -50,
      },
    })
    const advanced = falling.advance([])
    expect(advanced.state.player.verticalVelocity).toBe(-50)
    expect(createStreamedWorldFromState(advanced.state).state).toEqual(advanced.state)

    const finalTick = createStreamedWorldFromState({ ...base, tick: Number.MAX_SAFE_INTEGER })
    expect(() => finalTick.advance([])).toThrow(RangeError)
    expect(finalTick.state.tick).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('replays movement, rejection, and gravity identically after hydration', () => {
    const live = createStreamedWorld(mireglassSeed, barriers[0].from)
    live.advance([{ type: 'look', yawDelta: 1, pitchDelta: 0.2 }, { type: 'jump' }])
    const restored = createStreamedWorldFromState(JSON.parse(JSON.stringify(live.state)))
    const script: StreamedWorldIntent[][] = [
      [move(0, 4)], [move(4)], [{ type: 'look', yawDelta: -0.25, pitchDelta: 0 }], [], [move(-4)],
    ]
    for (const intents of script) {
      expect(restored.advance(intents)).toEqual(live.advance(intents))
      expect(restored.activeChunkCoordinates()).toEqual(live.activeChunkCoordinates())
    }
  })

  it.each(barriers)('rejects $name in both directions without moving or discovering', ({ from, to, code }) => {
    for (const [origin, target] of [[from, to], [to, from]]) {
      const runtime = createStreamedWorld(mireglassSeed, origin)
      const before = runtime.state
      const window = runtime.activeChunkCoordinates()
      const rejected = runtime.advance([move(target.x - origin.x, target.z - origin.z)])
      expect(rejected.rejections).toEqual([{ intentIndex: 0, intentType: 'move', code }])
      expect(rejected.events).toEqual([])
      expect(rejected.state.player.position).toEqual(before.player.position)
      expect(rejected.state.discoveredTileIds).toEqual(before.discoveredTileIds)
      expect(runtime.activeChunkCoordinates()).toEqual(window)
    }
  })

  it.each([barriers[0], barriers[5]])('does not bypass $name while jumping, and gravity continues', ({ from, to, code }) => {
    const runtime = createStreamedWorld(mireglassSeed, from)
    const jumped = runtime.advance([{ type: 'jump' }])
    const rejected = runtime.advance([move(to.x - from.x, to.z - from.z)])
    expect(rejected.rejections).toEqual([{ intentIndex: 0, intentType: 'move', code }])
    expect(rejected.events).toEqual([])
    expect(rejected.state.tick).toBe(jumped.state.tick + 1)
    expect(rejected.state.player.position.x).toBe(from.x)
    expect(rejected.state.player.position.z).toBe(from.z)
    expect(rejected.state.player.position.y).toBeGreaterThan(jumped.state.player.position.y)
    expect(rejected.state.discoveredTileIds).toEqual(jumped.state.discoveredTileIds)
  })

  it('rolls back an atomic look and blocked move without advancing gravity', () => {
    const { from, to } = barriers[0]
    const runtime = createStreamedWorld(mireglassSeed, from)
    runtime.advance([{ type: 'jump' }])
    const before = runtime.state
    const window = runtime.activeChunkCoordinates()
    const rejected = runtime.advance([
      { type: 'look', yawDelta: 0.2, pitchDelta: 0.1 },
      move(to.x - from.x, to.z - from.z),
    ], { atomicOnRejection: true })
    expect(rejected.rejections).toEqual([{ intentIndex: 1, intentType: 'move', code: 'fen_channel' }])
    expect(rejected.state).toBe(before)
    expect(runtime.state).toBe(before)
    expect(rejected.events).toEqual([])
    expect(runtime.activeChunkCoordinates()).toEqual(window)
  })

  it('restores the prior window and pending discovery after an atomic rejection', () => {
    const runtime = createStreamedWorld('chunk-crossing')
    for (let x = 4; x <= 60; x += 4) runtime.advance([move(4)])
    const before = runtime.state
    const window = runtime.activeChunkCoordinates()
    const targetId = worldTileAtGrid('chunk-crossing', 16, 0).id
    expect(before.discoveredTileIds).not.toContain(targetId)
    const rejected = runtime.advance([
      move(4), { type: 'look', yawDelta: Infinity, pitchDelta: 0 },
    ], { atomicOnRejection: true })
    expect(rejected.rejections).toEqual([{ intentIndex: 1, intentType: 'look', code: 'invalid_value' }])
    expect(rejected.state).toBe(before)
    expect(rejected.events).toEqual([])
    expect(runtime.activeChunkCoordinates()).toEqual(window)
    expect(runtime.tileAtWorld(-64, 0)).not.toBeNull()

    const retry = runtime.advance([move(4)], { atomicOnRejection: true })
    expect(retry.rejections).toEqual([])
    expect(retry.state.tick).toBe(before.tick + 1)
    expect(retry.events).toContainEqual({ type: 'tile_discovered', tick: before.tick + 1, tileId: targetId })
    expect(retry.state.discoveredTileIds).toContain(targetId)
  })

  it('keeps the current chunk window when a rejected move crosses a chunk boundary', () => {
    const runtime = createStreamedWorld(mireglassSeed, { x: -452, z: 400 })
    const window = runtime.activeChunkCoordinates()
    expect(window).not.toContainEqual({ chunkX: -6, chunkZ: 6 })
    expect(runtime.advance([move(4)]).rejections[0]?.code).toBe('fen_channel')
    expect(runtime.activeChunkCoordinates()).toEqual(window)
    expect(runtime.tileAtWorld(-384, 400)).toBeNull()
  })

  it('allows ordinary wetland outside the authored channel', () => {
    const runtime = createStreamedWorld('mireglass-seed', { x: -372, z: 336 })
    const wetland = runtime.tileAtWorld(-368, 336)!
    expect(wetland.terrain).toBe('wetland')
    const advanced = runtime.advance([move(4)])
    expect(advanced.rejections).toEqual([])
    expect(advanced.state.player.position.x).toBe(-368)
    expect(advanced.state.discoveredTileIds).toContain(wetland.id)
    expect(advanced.events).toContainEqual({ type: 'tile_discovered', tick: 1, tileId: wetland.id })
  })

  it.each([
    { x: Number.NaN, z: 0 },
    { x: 0, z: Infinity },
    { x: 1024, z: 0 },
    { x: -1028, z: 0 },
  ])('rejects an invalid start at $x, $z', (start) => {
    expect(() => createStreamedWorld('invalid-start', start)).toThrow(RangeError)
  })

  it('replays move, look, jump, and rejection ticks deterministically without mutating prior state', () => {
    const left = createStreamedWorld('replay')
    const right = createStreamedWorld('replay')
    const before = left.state
    const beforeBytes = JSON.stringify(before)
    const script: StreamedWorldIntent[][] = [
      [move(4), { type: 'look', yawDelta: 0.25, pitchDelta: 3 }],
      [{ type: 'jump' }],
      [move(4), { type: 'jump' }],
      [move(Number.NaN)],
      [],
    ]
    for (const intents of script) {
      expect(left.advance(intents)).toEqual(right.advance(intents))
    }
    expect(left.state.tick).toBe(script.length)
    expect(left.state.player.pitch).toBe(Math.PI / 2)
    expect(JSON.stringify(before)).toBe(beforeBytes)
    expect(left.state).not.toBe(before)
    expect(left.state.player).not.toBe(before.player)
    expect(left.state.discoveredTileIds).not.toBe(before.discoveredTileIds)
    expect(Object.isFrozen(before.player.position)).toBe(true)
    expect(Reflect.set(before.player.position, 'x', 99)).toBe(false)
    expect(left.state.player.position.x).toBe(8)
  })

  it('activates a target chunk before crossing and keeps the terrain window bounded', () => {
    const runtime = createStreamedWorld('chunk-crossing')
    for (let x = 4; x <= 60; x += 4) runtime.advance([move(4)])
    expect(runtime.state.player.position.x).toBe(60)
    const priorGround = runtime.tileAtWorld(60, 0)!.center.y
    const crossed = runtime.advance([move(4)])
    expect(crossed.rejections).toEqual([])
    expect(crossed.state.player.position.x).toBe(64)
    expect(runtime.tileAtWorld(64, 0)).toEqual(worldTileAtGrid('chunk-crossing', 16, 0))
    expect(Math.abs(runtime.tileAtWorld(64, 0)!.center.y - priorGround)).toBeLessThanOrEqual(0.9)
    expect(runtime.activeChunkCoordinates()).toContainEqual({ chunkX: 2, chunkZ: 0 })
    expect(runtime.activeChunkCount()).toBe(9)
    expect(runtime.activeTiles()).toHaveLength(2304)
    expect(crossed.state.player.position.y).toBeGreaterThanOrEqual(runtime.tileAtWorld(64, 0)!.center.y)
  })

  it('rejects world edges and invalid movement without committing horizontal displacement', () => {
    for (const direction of [-1, 1]) {
      const runtime = createStreamedWorld(`edge-${direction}`)
      const steps = direction === 1 ? 255 : 256
      for (let step = 0; step < steps; step += 1) {
        expect(runtime.advance([move(direction * 4)]).rejections).toEqual([])
        expect(runtime.activeChunkCount()).toBeLessThanOrEqual(9)
      }
      for (let step = 0; step < 50 && runtime.state.player.verticalVelocity !== 0; step += 1) runtime.advance([])
      const before = runtime.state.player.position
      const previousDiscovery = runtime.state.discoveredTileIds
      const rejected = runtime.advance([move(direction * 4)])
      expect(rejected.rejections).toEqual([{ intentIndex: 0, intentType: 'move', code: 'out_of_bounds' }])
      expect(rejected.state.player.position).toEqual(before)
      expect(rejected.state.discoveredTileIds).toEqual(previousDiscovery)
      expect(runtime.activeChunkCount()).toBeLessThanOrEqual(9)
    }
    const runtime = createStreamedWorld('bad-move')
    const before = runtime.state.player.position
    expect(runtime.advance([move(5)]).rejections[0]?.code).toBe('invalid_value')
    expect(runtime.state.player.position).toEqual(before)
  })

  it('keeps independent gravity running after an invalid move while airborne', () => {
    const runtime = createStreamedWorld('airborne-rejection')
    const jumped = runtime.advance([{ type: 'jump' }])
    expect(jumped.events).toContainEqual({ type: 'player_jumped', tick: 1 })
    const airborne = jumped.state.player.position
    const rejected = runtime.advance([move(Infinity)])
    expect(rejected.rejections[0]?.code).toBe('invalid_value')
    expect(rejected.state.player.position.x).toBe(airborne.x)
    expect(rejected.state.player.position.z).toBe(airborne.z)
    expect(rejected.state.player.position.y).toBeGreaterThan(airborne.y)
  })

  it('rejects look deltas beyond the restorable yaw range', () => {
    const runtime = createStreamedWorld('look-overflow')
    expect(runtime.advance([{ type: 'look', yawDelta: 1e6, pitchDelta: 0 }]).rejections).toEqual([])
    const rejected = runtime.advance([{ type: 'look', yawDelta: 0.001, pitchDelta: 0 }])
    expect(rejected.rejections).toEqual([{ intentIndex: 0, intentType: 'look', code: 'invalid_value' }])
    expect(rejected.state.player.yaw).toBe(1e6)
    expect(createStreamedWorldFromState(rejected.state).state).toEqual(rejected.state)
  })
})
