import { describe, expect, it } from 'vitest'
import { createPublicV17ContinuousSession } from './publicWorldV17ContinuousSession'
import { createFreshPublicV17Head, createFreshPublicV17Lineage,
  decodePublicV17Lineage } from './publicWorldV17Snapshot'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { advancePublicV23Frames } from './publicWorldV23Transitions'

describe('fresh V17 lineage without world genesis', () => {
  it.each(['greenway-alpha', 'wizard-realms', 'a', 'a'.repeat(128)])(
    'matches the validated fresh head lineage for %s', (seed) => {
      const lineage = createFreshPublicV17Lineage(seed)
      expect(lineage).toEqual(createFreshPublicV17Head(seed).lineage)
      expect(decodePublicV17Lineage(lineage)).toEqual(lineage)
    })

  it.each(['', 'a'.repeat(129), null, 42])('rejects invalid seed %s', (seed) => {
    expect(() => createFreshPublicV17Lineage(seed as string)).toThrow(RangeError)
  })

  it('keeps V23 Greenway frame results identical to the V17 continuous session', () => {
    const seed = 'greenway-alpha'
    const { head } = createPublicV23Root(seed)
    const before = { state: head.state, greenwayWorks: head.greenwayWorks,
      regionalWorks: head.regionalWorks }
    const frames = [
      { intents: [{ type: 'look' as const, yawDelta: -0.13, pitchDelta: 0 },
        { type: 'move' as const, delta: { x: 0.16, z: 0 } }], walkRequested: true },
      { intents: [{ type: 'look' as const, yawDelta: -0.13, pitchDelta: 0 }], walkRequested: true },
      { intents: [{ type: 'move' as const, delta: { x: 0, z: -0.16 } }], walkRequested: true },
    ]
    const session = createPublicV17ContinuousSession({ ...before, saveRevision: 1,
      lineage: createFreshPublicV17Head(seed).lineage })
    for (const frame of frames) {
      expect(session.advanceFrame(frame.intents, { walkRequested: frame.walkRequested }).rejections).toEqual([])
    }
    expect(advancePublicV23Frames(before, frames)).toEqual({ ...session.previewSnapshot(),
      regionalWorks: before.regionalWorks })
  })
})
