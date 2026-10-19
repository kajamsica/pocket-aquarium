import { describe, expect, it } from 'vitest'
import { discoveryMaskHasTileId, encodeDiscoveredTileIds } from './discoveryMask'
import { resolvePublicV14Surface } from './publicWorldV14Terrain'
import { starterCliffSupportAt } from './starterCliffMovement'
import { STARTER_CLIFF_PROFILE, STARTER_CLIFF_SITE_ID } from './starterCliffProfile'
import { resolveTerrainWorkSite } from './terrainWorks'
import { createFreshPublicV14Head, decodePublicV14Head,
  decodePublicV14FrameWitness, decodePublicV14Lineage, encodePublicV14Head,
  PUBLIC_V14_MAX_FRAME_BATCH, PUBLIC_V14_SCHEMA } from './publicWorldV14Snapshot'

const clone = <T,>(value: T): T => structuredClone(value)
const streamedAt = (state: ReturnType<typeof createFreshPublicV14Head>['head']['state'],
  point: { x: number; z: number }) => {
  const surface = resolvePublicV14Surface(state, point)!
  const mask = new Uint8Array(state.discoveryMask)
  const tile = encodeDiscoveredTileIds([surface.tileId])
  for (let index = 0; index < mask.length; index++) mask[index] |= tile[index]
  return { ...clone(state), movementOwner: 'streamed' as const, discoveryMask: mask,
    player: { ...clone(state.player), position: { ...point, y: surface.floorY }, verticalVelocity: 0 } }
}

describe('independent dormant v14 snapshot', () => {
  it.each(['greenway-alpha', 'wizard-realms', 'cliff-three'])('pins fresh %s directly to cliff facts', (seed) => {
    const { head, lineage } = createFreshPublicV14Head(seed)
    expect(head).toMatchObject({ schemaVersion: PUBLIC_V14_SCHEMA, saveRevision: 0,
      bootstrap: null, state: { seed, generationProfile: STARTER_CLIFF_PROFILE,
        movementOwner: 'greenway' } })
    expect(lineage).toEqual({ origin: 'fresh', seed, generationProfile: STARTER_CLIFF_PROFILE })
    expect(head.state.greenway.routes[0].siteId).toBeNull()
    expect(head.state.terrainWorks).toEqual({ builtWorkIds: [], dugTileIds: [] })
    expect(discoveryMaskHasTileId(head.state.discoveryMask, 'tile-3-3')).toBe(true)
    expect(decodePublicV14Head(head, lineage)).toEqual(head)
    expect(encodePublicV14Head(head.state, 0, lineage)).toEqual(head)
  })

  it('rejects forged origin, terrain, route, grounded objects and revision-zero changes', () => {
    const { head, lineage } = createFreshPublicV14Head('greenway-alpha')
    expect(decodePublicV14Lineage({ ...lineage, seed: 'changed' })).not.toBeNull()
    expect(decodePublicV14Head(head, { ...lineage, seed: 'changed' })).toBeNull()
    expect(decodePublicV14Head({ ...head, state: { ...head.state, tick: 1 } }, lineage)).toBeNull()
    expect(decodePublicV14Head({ ...head, state: { ...head.state,
      generationProfile: 'greenway-expanded-v1' } }, lineage)).toBeNull()
    const tile = clone(head)
    tile.state.greenway.tiles[0].center.y += 0.01
    expect(decodePublicV14Head(tile, lineage)).toBeNull()
    const route = clone(head)
    route.state.greenway.routes[0].to.y += 0.01
    expect(decodePublicV14Head(route, lineage)).toBeNull()
    const resource = clone(head)
    resource.state.greenway.resources[0].position.y += 0.01
    expect(decodePublicV14Head(resource, lineage)).toBeNull()
    const hidden = clone(head)
    Object.defineProperty(hidden, 'extra', { value: 1 })
    expect(decodePublicV14Head(hidden, lineage)).toBeNull()
    const mask = clone(head)
    Object.defineProperty(mask.state.discoveryMask, 'extra', { value: 1 })
    expect(decodePublicV14Head(mask, lineage)).toBeNull()
  })

  it('decodes only bounded canonical frame witnesses without changing old head bytes', () => {
    const { head, lineage } = createFreshPublicV14Head('greenway-alpha')
    expect(Object.keys(head)).toEqual(['schemaVersion', 'saveRevision', 'bootstrap', 'state'])
    const witness = { kind: 'frame-batch/v1' as const, frames: [
      { intents: [{ type: 'look' as const, yawDelta: 0.1, pitchDelta: 0 },
        { type: 'move' as const, delta: { x: 0.16, z: 0 } }], walkRequested: true },
    ] }
    expect(decodePublicV14FrameWitness(witness)).toEqual(witness)
    expect(encodePublicV14Head({ ...head.state, tick: 1 }, 1, lineage, witness).frameWitness)
      .toEqual(witness)
    expect(decodePublicV14Head({ ...head, frameWitness: witness }, lineage)).toBeNull()
    expect(decodePublicV14FrameWitness({ ...witness,
      frames: Array(PUBLIC_V14_MAX_FRAME_BATCH + 1).fill(witness.frames[0]) })).toBeNull()
    expect(decodePublicV14FrameWitness({ ...witness,
      frames: [{ ...witness.frames[0], extra: true }] })).toBeNull()
    expect(decodePublicV14FrameWitness({ ...witness,
      frames: [{ intents: [{ type: 'harvest', resourceId: 'resource' }], walkRequested: false }] }))
      .toBeNull()
    expect(decodePublicV14FrameWitness(new Proxy(witness, { get() { throw Error('trap') } })))
      .toBeNull()
  })

  it('rejects sparse or inherited-iterator frame and intent arrays', () => {
    const frame = { intents: [{ type: 'move', delta: { x: 0.16, z: 0 } }],
      walkRequested: true }
    const sneaky = <T,>(item: T): T[] => {
      const array = Array<T>(1)
      Object.defineProperty(array, 'foo', { value: item, enumerable: true })
      Object.setPrototypeOf(array, { ...Array.prototype,
        *[Symbol.iterator]() { yield item } })
      return array
    }
    expect(decodePublicV14FrameWitness({ kind: 'frame-batch/v1',
      frames: sneaky(frame) })).toBeNull()
    let iteratorCalls = 0
    const overrun = Array<typeof frame>(1)
    Object.defineProperty(overrun, 'foo', { value: frame, enumerable: true })
    Object.setPrototypeOf(overrun, { ...Array.prototype,
      *[Symbol.iterator]() { iteratorCalls++; for (let index = 0; index < 129; index++) yield frame } })
    expect(decodePublicV14FrameWitness({ kind: 'frame-batch/v1', frames: overrun })).toBeNull()
    expect(iteratorCalls).toBe(0)
    expect(decodePublicV14FrameWitness({ kind: 'frame-batch/v1',
      frames: [{ intents: sneaky(frame.intents[0]), walkRequested: true }] })).toBeNull()
    const inherited = [frame]
    Object.setPrototypeOf(inherited, { ...Array.prototype,
      *[Symbol.iterator]() { yield frame } })
    expect(decodePublicV14FrameWitness({ kind: 'frame-batch/v1', frames: inherited })).toBeNull()
    const accessor = [frame]
    Object.defineProperty(accessor, '0', { enumerable: true, get: () => frame })
    expect(decodePublicV14FrameWitness({ kind: 'frame-batch/v1', frames: accessor })).toBeNull()
  })

  it('accepts a supported built mid-climb pose and rejects unsupported or airborne saves', () => {
    const { head, lineage } = createFreshPublicV14Head('greenway-alpha')
    const state = { ...clone(head.state), tick: 10, eventSequence: 2 }
    state.greenway.builtRouteIds.push('greenway_ladder')
    state.greenway.routes[0].siteId = STARTER_CLIFF_SITE_ID
    state.player.xp = 60
    state.player.skillXp.construction = 60
    const context = { seed: state.seed, profile: state.generationProfile,
      route: state.greenway.routes[0], built: true }
    const support = starterCliffSupportAt(context, { x: 0, z: -5.7 })
    expect(support?.kind).toBe('ladder')
    state.player.position = { x: 0, y: support!.floorY, z: -5.7 }
    const saved = encodePublicV14Head(state, 1, lineage)
    expect(decodePublicV14Head(saved, lineage)?.state.player.position).toEqual(state.player.position)
    const below = clone(saved)
    below.state.player.position.y -= 0.01
    expect(decodePublicV14Head(below, lineage)).toBeNull()
    const side = clone(saved)
    side.state.player.position.x = 0.8
    expect(decodePublicV14Head(side, lineage)).toBeNull()
    const airborne = clone(saved)
    airborne.state.player.verticalVelocity = 5
    expect(decodePublicV14Head(airborne, lineage)).toBeNull()
    const streamed = clone(saved) as unknown as { state: { movementOwner: string } }
    streamed.state.movementOwner = 'streamed'
    expect(decodePublicV14Head(streamed, lineage)).toBeNull()
  })

  it('resumes exact streamed floors from the Greenway edge to the far world edge', () => {
    const { head, lineage } = createFreshPublicV14Head('greenway-alpha')
    for (const point of [{ x: 34.001, z: 0 }, { x: 1_000, z: 0 },
      { x: -1_026 + 1e-7, z: 0 }, { x: 1_022, z: 0 }]) {
      const state = { ...streamedAt(head.state, point), tick: 1 }
      expect(encodePublicV14Head(state, 1, lineage).state.player.position).toEqual(state.player.position)
      const floor = clone(state)
      floor.player.position.y += 0.001
      expect(decodePublicV14Head({ ...head, saveRevision: 1, state: floor }, lineage)).toBeNull()
      const hidden = clone(state)
      hidden.discoveryMask = new Uint8Array(head.state.discoveryMask)
      expect(decodePublicV14Head({ ...head, saveRevision: 1, state: hidden }, lineage)).toBeNull()
      const airborne = clone(state)
      airborne.player.verticalVelocity = 0.49
      expect(decodePublicV14Head({ ...head, saveRevision: 1, state: airborne }, lineage)).toBeNull()
      const wrongOwner = { ...state, movementOwner: 'greenway' }
      expect(decodePublicV14Head({ ...head, saveRevision: 1, state: wrongOwner }, lineage)).toBeNull()
      const cachedChunks = { ...state, activeChunks: [] }
      expect(decodePublicV14Head({ ...head, saveRevision: 1, state: cachedChunks }, lineage)).toBeNull()
    }
    const beyond = streamedAt(head.state, { x: 1_022, z: 0 })
    beyond.player.position.x += 1e-7
    expect(decodePublicV14Head({ ...head, saveRevision: 1, state: beyond }, lineage)).toBeNull()
    const seam = streamedAt(head.state, { x: 34, z: 0 })
    expect(decodePublicV14Head({ ...head, saveRevision: 1, state: seam }, lineage)).toBeNull()
  })

  it('validates canonical sparse bridge and dig work with additive progression', () => {
    const { head, lineage } = createFreshPublicV14Head('greenway-alpha')
    const bridge = resolveTerrainWorkSite(head.state.seed, 'works1:bridge:-102:92:z')!
    const dig = resolveTerrainWorkSite(head.state.seed, 'tile--64-76')!
    if (bridge.kind !== 'bridge' || dig.kind !== 'dig') throw new Error('Missing canonical work sites')
    const point = { x: (bridge.from.x + bridge.to.x) / 2,
      z: (bridge.from.z + bridge.to.z) / 2 }
    const work = { ...head.state, terrainWorks: { builtWorkIds: [bridge.id], dugTileIds: [dig.id] },
      player: { ...head.state.player, xp: 110, level: 2,
        skillXp: { ...head.state.player.skillXp, construction: 80, excavation: 30 } } }
    const state = { ...streamedAt(work, point), tick: 1 }
    expect(resolvePublicV14Surface(state, point)?.support).toBe('work')
    expect(decodePublicV14Head({ ...head, saveRevision: 1, state }, lineage)).not.toBeNull()
    const noXp = clone(state)
    noXp.player.skillXp.excavation = 0
    expect(decodePublicV14Head({ ...head, saveRevision: 1, state: noXp }, lineage)).toBeNull()
    const duplicate = clone(state)
    duplicate.terrainWorks = { ...duplicate.terrainWorks,
      builtWorkIds: [...duplicate.terrainWorks.builtWorkIds, bridge.id] }
    expect(decodePublicV14Head({ ...head, saveRevision: 1, state: duplicate }, lineage)).toBeNull()
    const unsupportedFen = { ...streamedAt(head.state, bridge.supportPath[1]), tick: 1 }
    expect(decodePublicV14Head({ ...head, saveRevision: 1, state: unsupportedFen }, lineage)).toBeNull()
  })
})
