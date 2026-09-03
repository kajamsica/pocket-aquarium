import { describe, expect, it } from 'vitest'

import { specimenAssetFor } from './assetRegistry'
import { resolveSemanticAnimationPlan } from './RiggedSpecimen'

describe('rigged specimen semantic animation plan', () => {
  it.each(['ocellaris', 'watchman_goby', 'epaulette_shark'])('maps %s fish behavior to idle, swim, and burst', (speciesId) => {
    const asset = specimenAssetFor(speciesId)
    expect(asset).toBeDefined()
    expect(resolveSemanticAnimationPlan(asset!)).toEqual({
      idle: { clipName: 'idle', loop: true },
      locomotion: { clipName: 'swim', loop: true },
      response: { clipName: 'burst', loop: false },
    })
  })

  it('maps pistol shrimp behavior to rest, walk, and snap without fish-specific clip assumptions', () => {
    const asset = specimenAssetFor('pistol_shrimp')
    expect(asset).toBeDefined()
    expect(resolveSemanticAnimationPlan(asset!)).toEqual({
      idle: { clipName: 'rest', loop: true },
      locomotion: { clipName: 'walk', loop: true },
      response: { clipName: 'snap', loop: false },
    })
  })
})
