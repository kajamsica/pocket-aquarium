import { describe, expect, it } from 'vitest'
import { CHARACTER_CANDIDATES, CHARACTER_CLIPS, selectCharacterCandidate } from './characterCatalog'

describe('Wizard character workbench catalog', () => {
  it('defaults to the approved V9 design and keeps rejected V2 inspectable', () => {
    const candidate = selectCharacterCandidate('wayfarer', null)
    expect(candidate?.id).toBe('wayfarer-v9-male')
    expect(candidate?.status).toBe('design_approved')
    expect(candidate?.statusLabel).toBe('V9 design approved')
    expect(candidate?.glbUrl).toContain('wayfarer_v9_game/wayfarer_v9_male.glb')
    expect(candidate?.approvedRenders[1].url).toContain('wayfarer_v9_approved/v9_three_quarter.png')
    expect(candidate?.conceptUrl).toContain('wayfarer-male-concept-v4.png')
    expect(candidate?.expectedClips).toEqual(CHARACTER_CLIPS)
    const rejected = selectCharacterCandidate('wayfarer', 'wayfarer-v2-male')
    expect(rejected?.status).toBe('candidate_no_go')
    expect(rejected?.approvedRenders).toBe(candidate?.approvedRenders)
    expect(CHARACTER_CANDIDATES).toHaveLength(2)
  })

  it('does not silently fall back for an unknown character or candidate', () => {
    expect(selectCharacterCandidate('unknown', null)).toBeUndefined()
    expect(selectCharacterCandidate('wayfarer', 'approved-male')).toBeUndefined()
    expect(selectCharacterCandidate('wayfarer', 'wayfarer-v10-male')).toBeUndefined()
  })
})
