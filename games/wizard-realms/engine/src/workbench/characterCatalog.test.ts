import { describe, expect, it } from 'vitest'
import { CHARACTER_CANDIDATES, CHARACTER_CLIPS, selectCharacterCandidate } from './characterCatalog'

describe('Wizard character workbench catalog', () => {
  it('keeps the structural Wayfarer candidate visibly rejected and outside the playable avatar registry', () => {
    const candidate = selectCharacterCandidate('wayfarer', null)
    expect(candidate?.id).toBe('wayfarer-v2-male')
    expect(candidate?.status).toBe('candidate_no_go')
    expect(candidate?.statusLabel).toBe('Visual NO-GO')
    expect(candidate?.glbUrl).toContain('wayfarer_v2_male.glb')
    expect(candidate?.expectedClips).toEqual(CHARACTER_CLIPS)
    expect(CHARACTER_CANDIDATES).toHaveLength(1)
  })

  it('does not silently fall back for an unknown character or candidate', () => {
    expect(selectCharacterCandidate('unknown', null)).toBeUndefined()
    expect(selectCharacterCandidate('wayfarer', 'approved-male')).toBeUndefined()
  })
})
