import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { mireglassAnchors } from './mireglassContent'
import { nearbyWorldTileIds, PUBLIC_SPELL_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { decodePublicV23Progress } from './publicWorldV23Snapshot'
import { applyPublicV23Witness } from './publicWorldV23Transitions'
import { applyPublicV24MireglassAction } from './publicWorldV24MireglassAction'
import { createPublicV24Root, decodePublicV24Head, decodePublicV24Lineage,
  decodePublicV24Root, decodePublicV24SourceReceipt, decodePublicV24Witness,
  replayPublicV24Transition, replayPublicV24Witness, PUBLIC_V24_SCHEMA } from './publicWorldV24Snapshot'

const seed = 'greenway-alpha'
const v23 = () => createPublicV23Root(seed)
const source = () => ({ ...v23() })
const root = () => createPublicV24Root(source())
const checkpoint = (before: ReturnType<typeof root>) => ({
  lineage: structuredClone(before.lineage), previous: structuredClone(before.head),
  head: { ...structuredClone(before.head), saveRevision: before.head.saveRevision + 1,
    witness: { kind: 'checkpoint' as const } },
})

describe('V24 pinned V23 snapshot', () => {
  it('replays old 8 m terrain and cache casts unchanged alongside a new wide witness', () => {
    for (const [point, action, knownRadius, eventType] of [
      [mireglassAnchors(seed).sealCache.tile.center,
        { type: 'cast_wayfinder_glow' as const }, 16, 'cache_revealed' as const],
      [mireglassAnchors(seed).fringeMarker.tile.center,
        { type: 'cast_wayfinder_glow_wide' as const }, 16, 'terrain_revealed' as const],
      [mireglassAnchors(seed).fringeMarker.tile.center,
        { type: 'cast_wayfinder_glow' as const }, 0, 'terrain_revealed' as const],
    ] as const) {
      const initial = root()
      const surface = resolvePublicV23Surface(initial.head.state, point, [])!
      const known = [...new Set([...decodeDiscoveredTileIds(initial.head.state.discoveryMask),
        ...nearbyWorldTileIds(point, knownRadius), surface.tileId])].sort()
      const beforeProgress = decodePublicV23Progress({
        state: { ...initial.head.state, movementOwner: 'streamed',
          discoveryMask: encodeDiscoveredTileIds(known),
          player: { ...initial.head.state.player,
            position: { x: point.x, y: surface.floorY, z: point.z },
            learnedSpellIds: ['wayfinder_glow' as const] } },
        greenwayWorks: initial.head.greenwayWorks,
        regionalWorks: initial.head.regionalWorks }, seed)
      if (!beforeProgress) throw new Error('Invalid grounded cast fixture')
      const before = { ...initial.head, ...beforeProgress, saveRevision: 1,
        witness: { kind: 'checkpoint' as const } }
      const witness = { kind: 'mireglass-action/v1' as const, action }
      expect(decodePublicV24Witness(witness)).toEqual(witness)
      expect(decodePublicV24Witness({ ...witness, radius: 24 })).toBeNull()
      expect(decodePublicV24Witness({ ...witness,
        action: { ...action, terrainRadius: 24 } })).toBeNull()
      const written = applyPublicV24MireglassAction(beforeProgress, action)
      if (!written.progress) throw new Error(written.rejection)
      const expected = nearbyWorldTileIds(point, action.type === 'cast_wayfinder_glow'
        ? 8 : PUBLIC_SPELL_REVEAL_RADIUS_METERS).filter((id) => !known.includes(id))
      if (knownRadius === 0) {
        expect(expected).toHaveLength(12)
        expect(expected).toContain(`tile-${point.x / 4 + 5}-${point.z / 4 + 3}`)
        expect(expected).not.toContain(`tile-${point.x / 4 + 6}-${point.z / 4 + 3}`)
      }
      expect(written.events[0]).toMatchObject({ type: eventType,
        revealedTileIds: expected,
        xp: 10 * (action.type === 'cast_wayfinder_glow_wide'
          ? Math.min(expected.length, 13) : expected.length)
          + (eventType === 'cache_revealed' ? 10 : 0) })
      expect(replayPublicV24Witness(beforeProgress, witness)).toEqual(written.progress)
      const after = { ...before, ...written.progress, saveRevision: 2, witness }
      const saved = { lineage: initial.lineage, previous: before, head: after }
      expect(replayPublicV24Transition(before, after)).toBe(true)
      expect(decodePublicV24Root(structuredClone(saved))).toEqual(saved)
    }
  })

  it('promotes a validated V23 head into an exact V24 revision zero without changing its source', () => {
    const original = source(), saved = structuredClone(original)
    const promoted = createPublicV24Root(original)
    expect(original).toEqual(saved)
    expect(promoted.lineage.sourceReceipt).toEqual(original)
    expect(promoted.head).toMatchObject({ schemaVersion: PUBLIC_V24_SCHEMA,
      saveRevision: 0, witness: null, state: original.head.state,
      greenwayWorks: original.head.greenwayWorks, regionalWorks: original.head.regionalWorks })
    expect(promoted.previous).toBeNull()
    expect(decodePublicV24Root(promoted)).toEqual(promoted)
  })

  it('rejects malformed or mismatched V23 receipts and exact-key violations', () => {
    const original = source()
    expect(decodePublicV24SourceReceipt({ ...original, previous: null })).toBeNull()
    expect(decodePublicV24SourceReceipt({ ...original, head: { ...original.head,
      schemaVersion: 'wizard-world/v24' } })).toBeNull()
    expect(() => createPublicV24Root({ head: original.head, lineage: null })).toThrow(RangeError)
    const promoted = root()
    expect(decodePublicV24Lineage({ ...promoted.lineage, seed: 'other-world' })).toBeNull()
    expect(decodePublicV24Lineage({ ...promoted.lineage, sourceReceipt: {
      ...promoted.lineage.sourceReceipt, head: { ...promoted.lineage.sourceReceipt.head,
        state: { ...promoted.lineage.sourceReceipt.head.state, seed: 'other-world' } } } })).toBeNull()
    expect(decodePublicV24Root({ ...promoted, stray: true })).toBeNull()
    expect(decodePublicV24Root({ ...promoted, previous: promoted.head })).toBeNull()
    expect(decodePublicV24Root({ ...promoted, head: { ...promoted.head,
      state: { ...promoted.head.state, player: { ...promoted.head.state.player,
        coins: promoted.head.state.player.coins + 1 } } } })).toBeNull()
  })

  it('replays only the previous checked head and rejects forged outcomes', () => {
    const before = root(), next = checkpoint(before)
    expect(decodePublicV24Witness(next.head.witness)).toEqual({ kind: 'checkpoint' })
    expect(replayPublicV24Transition(next.previous, next.head)).toBe(true)
    expect(decodePublicV24Root(next)).toEqual(next)
    const forged = structuredClone(next)
    forged.head.state.player.coins++
    expect(replayPublicV24Transition(forged.previous!, forged.head)).toBe(false)
    expect(decodePublicV24Root(forged)).toBeNull()
    expect(decodePublicV24Root({ ...next, previous: null })).toBeNull()
    expect(decodePublicV24Root({ ...next, head: { ...next.head,
      saveRevision: 2 } })).toBeNull()
    expect(decodePublicV24Head({ ...next.head, extra: true }, next.lineage)).toBeNull()
  })

  it('delegates inherited frame replay without changing the V23 witness grammar', () => {
    const before = root()
    const witness = { kind: 'frame-batch/v1' as const, frames: [
      { intents: [{ type: 'look' as const, yawDelta: 0.1, pitchDelta: 0 }], walkRequested: false }] }
    const result = applyPublicV23Witness({ state: before.head.state,
      greenwayWorks: before.head.greenwayWorks, regionalWorks: before.head.regionalWorks }, witness)
    if (!('progress' in result)) throw new Error(result.rejection)
    const next = { lineage: before.lineage, previous: before.head,
      head: { ...before.head, ...result.progress, saveRevision: 1, witness } }
    expect(decodePublicV24Root(next)).toEqual(next)
    expect(replayPublicV24Transition(before.head, next.head)).toBe(true)
  })

  it('inherits V23 witnesses but excludes teleport and loose Mireglass action shapes', () => {
    const frames = { kind: 'frame-batch/v1', frames: [
      { intents: [{ type: 'look', yawDelta: 0.1, pitchDelta: 0 }], walkRequested: false }] }
    expect(decodePublicV24Witness(frames)).toEqual(frames)
    expect(decodePublicV24Witness({ kind: 'mireglass-action/v1', action: {
      type: 'traverse_route', siteId: 'somewhere', from: 'from' } })).toBeNull()
    expect(decodePublicV24Witness({ kind: 'mireglass-action/v1', action: {
      type: 'study_fringe_marker' }, proposedCoins: 100 })).toBeNull()
  })

  it('replays a typed Mireglass action from a valid regional pose and rejects forged rewards', () => {
    const initial = root(), point = mireglassAnchors(seed).fringeMarker.tile.center
    const surface = resolvePublicV23Surface(initial.head.state, point, [])!
    const mask = new Uint8Array(initial.head.state.discoveryMask)
    const tile = encodeDiscoveredTileIds([surface.tileId])
    for (let index = 0; index < mask.length; index++) mask[index] |= tile[index]
    const beforeProgress = decodePublicV23Progress({
      state: { ...initial.head.state, movementOwner: 'streamed', discoveryMask: mask,
        player: { ...initial.head.state.player,
          position: { x: point.x, y: surface.floorY, z: point.z } } },
      greenwayWorks: initial.head.greenwayWorks, regionalWorks: initial.head.regionalWorks,
    }, seed)
    expect(beforeProgress).not.toBeNull()
    const witness = { kind: 'mireglass-action/v1' as const,
      action: { type: 'study_fringe_marker' as const } }
    const result = applyPublicV24MireglassAction(beforeProgress!, witness.action)
    if (!('progress' in result)) throw new Error(result.rejection)
    expect(replayPublicV24Witness(beforeProgress!, witness)).toEqual(result.progress)
    const before = { ...initial.head, ...beforeProgress!, saveRevision: 1,
      witness: { kind: 'checkpoint' as const } }
    const after = { ...before, ...result.progress, saveRevision: 2, witness }
    expect(replayPublicV24Transition(before, after)).toBe(true)
    const forged = structuredClone(after)
    forged.state.player.coins++
    expect(replayPublicV24Transition(before, forged)).toBe(false)
  })

  it('fails closed on hostile proxy-backed source, head, witness, and root input', () => {
    const hostile = <T extends object>(value: T) => new Proxy(value, {
      get() { throw new Error('hostile input') },
    })
    const promoted = root()
    expect(decodePublicV24SourceReceipt(hostile(source()))).toBeNull()
    expect(decodePublicV24Head(hostile(promoted.head), promoted.lineage)).toBeNull()
    expect(decodePublicV24Witness(hostile({ kind: 'mireglass-action/v1',
      action: { type: 'study_fringe_marker' } }))).toBeNull()
    expect(decodePublicV24Root(hostile(promoted))).toBeNull()
  })
})
