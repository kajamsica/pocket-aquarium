import { describe, expect, it } from 'vitest'
import { createStreamedWorld } from './streamedWorld'
import type { StreamedWorldIntent } from './streamedWorld'
import { worldTileAtGrid } from './worldChunks'

const move = (x: number, z = 0): StreamedWorldIntent => ({ type: 'move', delta: { x, z } })

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

  it('rejects look deltas that would overflow authoritative orientation', () => {
    const runtime = createStreamedWorld('look-overflow')
    runtime.advance([{ type: 'look', yawDelta: 1e308, pitchDelta: 0 }])
    const rejected = runtime.advance([{ type: 'look', yawDelta: 1e308, pitchDelta: 0 }])
    expect(rejected.rejections).toEqual([{ intentIndex: 0, intentType: 'look', code: 'invalid_value' }])
    expect(rejected.state.player.yaw).toBe(1e308)
    expect(Number.isFinite(rejected.state.player.yaw)).toBe(true)
  })
})
