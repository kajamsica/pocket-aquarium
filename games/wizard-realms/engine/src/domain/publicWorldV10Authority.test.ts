import { describe, expect, it } from 'vitest'
import { applyFieldCampAction, applyFieldCampV10Action } from './fieldCamp'
import { createGeneratedWorld } from './generation'
import { mireglassAnchors } from './mireglassContent'
import { serializeWizardWorld } from './persistence'
import { actPublicMireglass, actPublicV10Mireglass } from './publicWorldActions'
import { advancePublicWorldFrame, advancePublicWorldV10Frame } from './publicWorldRuntime'
import { createFreshPublicWorld } from './publicWorldState'
import { commitLegacyImportToPublicV6, inspectLegacyImportSource } from './publicWorldV6'
import { createPublicV7StateFromV6Root, withFreshPublicV7Herbs } from './publicWorldV7'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { isValidPublicWorldV10State, withPublicV10TerrainRevision } from './publicWorldV10State'
import type { PublicWorldV10State } from './publicWorldV10State'
import { createStreamedWorldFromState } from './streamedWorld'
import { worldTileAtGrid } from './worldChunks'

const seed = 'greenway-alpha'
const cache = mireglassAnchors(seed).sealCache.tile
const camp = worldTileAtGrid(seed, -76, 100)
const fresh = withPublicV10TerrainRevision(withFreshPublicV9Camps(withFreshPublicV7Herbs(
  createFreshPublicWorld(seed, 'greenway-classic-v1'))))

function readyAtCache(): PublicWorldV10State {
  return { ...fresh, movementOwner: 'streamed',
    player: { ...fresh.player, xp: 40, level: 1, position: { ...cache.center },
      inventory: [...fresh.player.inventory, { itemId: 'field_spade', quantity: 1 }],
      equipment: { ...fresh.player.equipment, mainHand: 'field_spade' },
      learnedSpellIds: ['wayfinder_glow'],
      skillXp: { ...fresh.player.skillXp, wayfinding: 10, spellcraft: 10, excavation: 30 } },
    discoveredTileIds: [...fresh.discoveredTileIds, cache.id].sort(),
    mireglass: { ...fresh.mireglass, fringeMarkerStudied: true, cacheRevealed: true } }
}

describe('public v10 terrain authority', () => {
  it('rejects bad dig input atomically, then drops one tile with one reward and no replay', () => {
    const ready = readyAtCache()
    expect(isValidPublicWorldV10State(ready, null)).toBe(true)
    const missingSpade = { ...ready, player: { ...ready.player,
      equipment: { ...ready.player.equipment, mainHand: null } } }
    const rejected = actPublicV10Mireglass(missingSpade, { type: 'excavate_cache' })
    expect(rejected.rejection?.code).toBe('requires_spade')
    expect(rejected.state).toBe(missingSpade)
    const before = JSON.stringify(ready)
    const dug = actPublicV10Mireglass(ready, { type: 'excavate_cache' })
    expect(dug.rejection).toBeUndefined()
    expect(dug.event).toMatchObject({ type: 'cache_excavated', sequence: ready.eventSequence + 1 })
    expect(dug.state.mireglass.cacheExcavated).toBe(true)
    expect(dug.state.terrainRevision).toBe('mireglass-cache-pit-v1')
    expect(dug.state.player.inventory).toContainEqual({ itemId: 'mireglass_reach/item/seal', quantity: 1 })
    expect(dug.state.player.skillXp.excavation).toBe(70)
    expect(dug.state.tick).toBe(ready.tick)
    expect(dug.state.rng).toBe(ready.rng)
    expect(isValidPublicWorldV10State(dug.state, null)).toBe(true)
    expect(JSON.stringify(ready)).toBe(before)
    const replay = actPublicV10Mireglass(dug.state, { type: 'excavate_cache' })
    expect(replay.state).toBe(dug.state)
    expect(replay.rejection?.code).toBe('already_excavated')
    expect(replay.event).toBeUndefined()
    expect(replay.state.eventSequence).toBe(dug.state.eventSequence)
    const old = actPublicMireglass(ready, { type: 'excavate_cache' })
    expect(old.state.mireglass.cacheExcavated).toBe(true)
    expect(() => createStreamedWorldFromState({ seed, tick: old.state.tick,
      player: { position: old.state.player.position, yaw: old.state.player.yaw,
        pitch: old.state.player.pitch, verticalVelocity: old.state.player.verticalVelocity },
      discoveredTileIds: old.state.discoveredTileIds })).not.toThrow()
  })

  it('rebuilds movement against the lowered tile, lands, and keeps legacy frames on seed ground', () => {
    const dug = actPublicV10Mireglass(readyAtCache(), { type: 'excavate_cache' })
    expect(dug.rejection).toBeUndefined()
    const seedOnly = advancePublicWorldFrame(dug.state, [])
    expect(seedOnly.state.player.position.y).toBeCloseTo(2.4)
    const overlaid = advancePublicWorldV10Frame(dug.state, [])
    expect(overlaid.state.player.verticalVelocity).toBeLessThan(0)
    let state = overlaid.state
    for (let frame = 0; frame < 60 && state.player.position.y > 1.65; frame += 1) {
      const step = advancePublicWorldV10Frame(state, [])
      expect(step.rejections).toEqual([])
      state = step.state
    }
    expect(state.player.position.y).toBe(1.65)
    expect(state.player.verticalVelocity).toBe(0)
    expect(isValidPublicWorldV10State(state, null)).toBe(true)
    const snapshot = { seed, tick: state.tick,
      player: { position: state.player.position, yaw: state.player.yaw,
        pitch: state.player.pitch, verticalVelocity: state.player.verticalVelocity },
      discoveredTileIds: state.discoveredTileIds }
    expect(createStreamedWorldFromState(snapshot, { cachePitDug: true })
      .tileAtWorld(cache.center.x, cache.center.z)?.center.y).toBe(1.65)
    expect(() => createStreamedWorldFromState(snapshot)).toThrow(RangeError)

    const legacy = { ...dug.state }
    const { terrainRevision: _revision, ...v9 } = legacy
    const oldStep = advancePublicWorldFrame(v9, [])
    expect(oldStep.rejections).toEqual([])
    expect(oldStep.state.player.position.y).toBeCloseTo(2.4)
  })

  it('adapts camp placement without rewriting a landed v10 pose or accepting a second camp', () => {
    const dug = actPublicV10Mireglass(readyAtCache(), { type: 'excavate_cache' })
    expect(dug.rejection).toBeUndefined()
    let landed = dug.state
    for (let frame = 0; frame < 60 && landed.player.position.y > 1.65; frame += 1) {
      landed = advancePublicWorldV10Frame(landed, []).state
    }
    expect(isValidPublicWorldV10State(landed, null)).toBe(true)
    expect(applyFieldCampAction(landed, cache.id).rejection?.code).toBe('invalid_progress')
    const invalidSite = applyFieldCampV10Action(landed, cache.id)
    expect(invalidSite.rejection?.code).toBe('invalid_site')
    expect(invalidSite.state).toBe(landed)
    expect(landed.player.position.y).toBe(1.65)

    const onSite: PublicWorldV10State = { ...landed,
      player: { ...landed.player, position: { ...camp.center }, verticalVelocity: 0,
        inventory: [...landed.player.inventory, { itemId: 'logs', quantity: 4 },
          { itemId: 'stone', quantity: 1 }] },
      discoveredTileIds: [...new Set([...landed.discoveredTileIds, camp.id])].sort() }
    expect(isValidPublicWorldV10State(onSite, null)).toBe(true)
    const placed = applyFieldCampV10Action(onSite, camp.id)
    expect(placed.rejection).toBeUndefined()
    expect(placed.event).toMatchObject({ type: 'field_camp_placed', sequence: onSite.eventSequence + 1 })
    expect(placed.state.fieldCampTileIds).toEqual([camp.id])
    expect(placed.state.terrainRevision).toBe('mireglass-cache-pit-v1')
    expect(placed.state.player.position).toEqual(camp.center)
    expect(isValidPublicWorldV10State(placed.state, null)).toBe(true)
    expect(applyFieldCampV10Action(placed.state, camp.id)).toMatchObject({
      state: placed.state, rejection: { code: 'already_built' },
    })
  })

  it('rejects malformed v10 action and camp states without changing their objects', () => {
    const invalid = { ...readyAtCache(), terrainRevision: 'wrong' } as unknown as PublicWorldV10State
    const bytes = JSON.stringify(invalid)
    expect(actPublicV10Mireglass(invalid, { type: 'excavate_cache' })).toMatchObject({
      state: invalid, rejection: { code: 'invalid_progress' },
    })
    expect(applyFieldCampV10Action(invalid, camp.id)).toMatchObject({
      state: invalid, rejection: { code: 'invalid_progress' },
    })
    expect(JSON.stringify(invalid)).toBe(bytes)
  })

  it('does not trust a previously checked state after same-object marker or pose mutation', () => {
    const look = [{ type: 'look' as const, yawDelta: 0, pitchDelta: 0 }]
    const marker = readyAtCache()
    expect(advancePublicWorldV10Frame(marker, look).rejections).toEqual([])
    Object.assign(marker, { terrainRevision: 'wrong' })
    const wrongMarker = advancePublicWorldV10Frame(marker, look)
    expect(wrongMarker.state).toBe(marker)
    expect(wrongMarker.rejections).toMatchObject([{ code: 'invalid_value' }])

    const pose = readyAtCache()
    expect(advancePublicWorldV10Frame(pose, look).rejections).toEqual([])
    pose.player.position.y = -10
    const wrongPose = advancePublicWorldV10Frame(pose, look)
    expect(wrongPose.state).toBe(pose)
    expect(wrongPose.rejections).toMatchObject([{ code: 'invalid_value' }])
  })

  it('rechecks a changed bootstrap even when the same state object passed an earlier frame', () => {
    const values = new Map([['wizard-realms:world:v5',
      serializeWizardWorld(createGeneratedWorld(seed))]])
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, bytes: string) => { values.set(key, bytes) } }
    const source = inspectLegacyImportSource(storage, 'greenway-classic-v1')
    if (source.status !== 'available') throw new Error(source.status)
    const imported = commitLegacyImportToPublicV6(storage, source)
    if (imported.status !== 'committed') throw new Error(imported.status)
    const state = withPublicV10TerrainRevision(withFreshPublicV9Camps(
      createPublicV7StateFromV6Root(imported.root)))
    const look = [{ type: 'look' as const, yawDelta: 0, pitchDelta: 0 }]
    expect(advancePublicWorldV10Frame(state, look, imported.root).rejections).toEqual([])
    const changed = advancePublicWorldV10Frame(state, look, { ...imported.root, seed: 'other' })
    expect(changed.state).toBe(state)
    expect(changed.rejections).toMatchObject([{ code: 'invalid_value' }])

    const bootstrap = structuredClone(imported.root)
    const accepted = advancePublicWorldV10Frame(state, look, bootstrap)
    expect(accepted.rejections).toEqual([])
    expect(advancePublicWorldV10Frame(accepted.state, look,
      structuredClone(bootstrap)).rejections).toEqual([])
    Object.assign(bootstrap.source, { bytes: 'corrupt-source' })
    const mutated = advancePublicWorldV10Frame(accepted.state, look, bootstrap)
    expect(mutated.state).toBe(accepted.state)
    expect(mutated.rejections).toMatchObject([{ code: 'invalid_value' }])

    const shapeBootstrap = structuredClone(imported.root)
    const shapeState = advancePublicWorldV10Frame(state, look, shapeBootstrap).state
    Object.defineProperty(shapeBootstrap, 'seed', { value: seed, enumerable: false,
      configurable: true })
    const hiddenSeed = advancePublicWorldV10Frame(shapeState, look, shapeBootstrap)
    expect(hiddenSeed.state).toBe(shapeState)
    expect(hiddenSeed.rejections).toMatchObject([{ code: 'invalid_value' }])
  })

  it('freezes only internally returned states and detects deep mutation of caller-owned inputs', () => {
    const input = readyAtCache()
    const first = advancePublicWorldV10Frame(input, [])
    expect(first.rejections).toEqual([])
    expect(Object.isFrozen(input)).toBe(false)
    expect(Object.isFrozen(input.player.inventory)).toBe(false)
    expect(Object.isFrozen(first.state)).toBe(true)
    expect(Object.isFrozen(first.state.player.inventory)).toBe(true)
    expect(Object.isFrozen(first.state.player.equipment)).toBe(true)
    expect(Object.isFrozen(first.state.greenway.areas[0])).toBe(true)
    expect(Reflect.set(first.state.player.inventory.at(-1)!, 'quantity', -1)).toBe(false)
    expect(Reflect.set(first.state.mireglass, 'cacheExcavated', true)).toBe(false)

    input.player.inventory.at(-1)!.quantity = -1
    const rejected = advancePublicWorldV10Frame(input,
      [{ type: 'look', yawDelta: 0, pitchDelta: 0 }])
    expect(rejected.state).toBe(input)
    expect(rejected.rejections).toMatchObject([{ code: 'invalid_value' }])
    expect(first.state.player.inventory.at(-1)?.quantity).toBe(1)

    const next = advancePublicWorldV10Frame(first.state, [])
    expect(next.rejections).toEqual([])
    expect(next.state.tick).toBe(first.state.tick + 1)
    expect(Object.isFrozen(next.state.player.position)).toBe(true)
  })

  it('keeps a rejected frame atomic even when the input is a trusted frozen output', () => {
    const trusted = advancePublicWorldV10Frame(readyAtCache(), []).state
    const rejected = advancePublicWorldV10Frame(trusted,
      [{ type: 'move', delta: { x: 0, y: 1, z: 0 } }])
    expect(rejected.state).toBe(trusted)
    expect(rejected.events).toEqual([])
    expect(rejected.rejections).toMatchObject([{ code: 'invalid_value' }])
    expect(rejected.state.tick).toBe(trusted.tick)
    expect(rejected.state.rng).toBe(trusted.rng)
    const accepted = advancePublicWorldV10Frame(trusted, [])
    expect(accepted.rejections).toEqual([])
    expect(accepted.state.tick).toBe(trusted.tick + 1)
  })

  it('never brands a getter-flipped caller state that changes after validation', () => {
    const input = readyAtCache()
    let reads = 0
    Object.defineProperty(input, 'terrainRevision', { enumerable: true, configurable: true,
      get: () => ++reads === 1 ? 'mireglass-cache-pit-v1' : 'wrong' })
    const frame = advancePublicWorldV10Frame(input,
      [{ type: 'look', yawDelta: 0, pitchDelta: 0 }])
    expect(frame.state).toBe(input)
    expect(frame.rejections).toMatchObject([{ code: 'invalid_value' }])

    const invalid = readyAtCache()
    Object.defineProperty(invalid, 'terrainRevision', { enumerable: true,
      get: () => 'wrong' })
    const rejected = advancePublicWorldV10Frame(invalid,
      [{ type: 'look', yawDelta: 0, pitchDelta: 0 }])
    expect(rejected.state).toBe(invalid)
    expect(rejected.rejections).toMatchObject([{ code: 'invalid_value' }])
  })

  it('rejects hidden and symbol fields on original input before cloning can erase them', () => {
    const intent = [{ type: 'look' as const, yawDelta: 0, pitchDelta: 0 }]
    const symbolState = readyAtCache()
    Object.defineProperty(symbolState, Symbol('hidden'), { value: true })
    const symbolResult = advancePublicWorldV10Frame(symbolState, intent)
    expect(symbolResult.state).toBe(symbolState)
    expect(symbolResult.rejections).toMatchObject([{ code: 'invalid_value' }])

    const hiddenState = readyAtCache()
    Object.defineProperty(hiddenState, 'hidden', { value: true, enumerable: false })
    const hiddenResult = advancePublicWorldV10Frame(hiddenState, intent)
    expect(hiddenResult.state).toBe(hiddenState)
    expect(hiddenResult.rejections).toMatchObject([{ code: 'invalid_value' }])
  })

  it('does not reuse a rejected runtime after the caller changes a valid pose in place', () => {
    const input = readyAtCache()
    input.player.position.y += 1
    expect(isValidPublicWorldV10State(input, null)).toBe(true)
    const rejected = advancePublicWorldV10Frame(input, [{ type: 'jump' }])
    expect(rejected.state).toBe(input)
    expect(rejected.rejections).toMatchObject([{ code: 'airborne' }])
    input.player.position.y = cache.center.y
    expect(isValidPublicWorldV10State(input, null)).toBe(true)
    const resumed = advancePublicWorldV10Frame(input, [])
    expect(resumed.rejections).toEqual([])
    expect(resumed.state.player.position.y).toBeCloseTo(cache.center.y)
    expect(resumed.state.player.verticalVelocity).toBe(0)
  })
})
