import { describe, expect, it } from 'vitest'
import { publicV29ActionRejectionMessage, publicV29DigSavedMessage } from './PublicV23Controller'

describe('V29 checked excavation feedback', () => {
  it('explains the same-cell spade-to-pick sequence when Mine reaches soil', () => {
    expect(publicV29ActionRejectionMessage('requires_spade'))
      .toBe('This cell’s top two layers are soil. Use a field spade to Dig any remaining soil in this same cell, then switch back to your pick and Mine.')
  })

  it('names only the verified yield and depth, and never invents a re-dig reward', () => {
    expect(publicV29DigSavedMessage('Dig', 1, 0, { material: 'soil', depthLayers: 1 }))
      .toBe('Dig saved at column 1, 0. Found soil. Depth 0.4 m.')
    expect(publicV29DigSavedMessage('Excavation', 1, 0,
      { material: 'iron_ore', depthLayers: 4 }))
      .toBe('Excavation saved at column 1, 0. Found iron ore. Depth 1.6 m.')
    expect(publicV29DigSavedMessage('Excavation', 1, 0,
      { material: null, depthLayers: 3 }))
      .toBe('Excavation saved at column 1, 0. No new material. Depth 1.2 m.')
    expect(publicV29DigSavedMessage('Dig', 1, 0))
      .toBe('Dig saved at column 1, 0.')
  })

  it.each([
    ['requires_spade', 'spade'], ['requires_pick', 'pick'],
    ['requires_enchanted_pick', 'enchanted pick'], ['skill_locked', 'Excavation skill'],
    ['too_far', 'within'], ['capacity', 'full'], ['occupied', 'occupies'],
    ['wet', 'wet'], ['bedrock', 'bedrock'], ['unrevealed', 'Explore'],
    ['invalid_pose', 'Land'],
  ])('names %s rather than showing only an opaque code', (reason, phrase) => {
    expect(publicV29ActionRejectionMessage(reason)).toContain(phrase)
  })
})
