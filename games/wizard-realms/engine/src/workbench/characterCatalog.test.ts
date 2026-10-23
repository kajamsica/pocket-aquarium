import { describe, expect, it } from 'vitest'
import { combinedRideBounds, shouldFrameHeldStaff } from './CharacterWorkbench'
import { ADULT_SEDGEHORN_PREVIEW, CHARACTER_CANDIDATES, CHARACTER_HELD_TOOLS, CHARACTER_ON_FOOT_CLIPS, CHARACTER_RIDE_CLIPS, CHARACTER_TOOL_GRIP_CLIP, RIDER_SEAT_OFFSET, missingAdultSedgehornClips, onFootHeldTool, overlappingToolGripTracks, selectCharacterCandidate } from './characterCatalog'

describe('Wizard character workbench catalog', () => {
  it('defaults to the approved V9 design and keeps rejected V2 inspectable', () => {
    const candidate = selectCharacterCandidate('wayfarer', null)
    expect(candidate?.id).toBe('wayfarer-v9-male')
    expect(candidate?.status).toBe('design_approved')
    expect(candidate?.statusLabel).toBe('V9 design approved')
    expect(candidate?.glbUrl).toContain('wayfarer_v9_game/wayfarer_v9_male.glb')
    expect(candidate?.approvedRenders[1].url).toContain('wayfarer_v9_approved/v9_three_quarter.png')
    expect(candidate?.conceptUrl).toContain('wayfarer-male-concept-v4.png')
    expect(candidate?.expectedClips).toEqual([...CHARACTER_ON_FOOT_CLIPS, ...CHARACTER_RIDE_CLIPS])
    const rejected = selectCharacterCandidate('wayfarer', 'wayfarer-v2-male')
    expect(rejected?.status).toBe('candidate_no_go')
    expect(rejected?.expectedClips).toEqual(['Idle', 'Walk', 'Turn'])
    expect(rejected?.approvedRenders).toBe(candidate?.approvedRenders)
    expect(CHARACTER_CANDIDATES).toHaveLength(2)
  })

  it('offers only the modeled right-hand game tools with an honest wand label', () => {
    expect(CHARACTER_HELD_TOOLS).toEqual([
      { id: 'none', label: 'None' },
      { id: 'axe', label: 'Axe' },
      { id: 'basic-pick', label: 'Basic pick' },
      { id: 'enchanted-pick', label: 'Enchanted pick' },
      { id: 'spade', label: 'Field spade' },
      { id: 'wand', label: 'Oak wand (staff-like)' },
    ])
  })

  it('enables equipped carry only for V9 on foot with a selected tool', () => {
    expect(onFootHeldTool('wayfarer-v9-male', 'axe', false)).toBe('axe')
    expect(onFootHeldTool('wayfarer-v9-male', 'wand', false)).toBe('wand')
    expect(onFootHeldTool('wayfarer-v9-male', 'none', false)).toBeNull()
    expect(onFootHeldTool('wayfarer-v9-male', 'axe', true)).toBeNull()
    expect(onFootHeldTool('wayfarer-v2-male', 'axe', false)).toBeNull()
  })

  it('keeps adult riding clips separate from on-foot inspection and maps them to the mount', () => {
    expect(CHARACTER_ON_FOOT_CLIPS).toEqual(['Idle', 'Walk', 'Run', 'TurnLeft', 'TurnRight', 'Jump', 'Chop', 'Dig', 'Mine', 'Cast'])
    expect(CHARACTER_RIDE_CLIPS).toEqual(['RideIdle', 'RideWalk', 'RideRun'])
    expect(ADULT_SEDGEHORN_PREVIEW.clipsByRiderClip).toEqual({ RideIdle: 'Idle', RideWalk: 'Walk', RideRun: 'Run' })
    expect(ADULT_SEDGEHORN_PREVIEW.requiredClips).toEqual(['Idle', 'Walk', 'Run'])
    expect(missingAdultSedgehornClips(['Idle', 'Walk', 'Run'])).toEqual([])
    expect(missingAdultSedgehornClips(['Idle', 'Run'])).toEqual(['Walk'])
    expect(ADULT_SEDGEHORN_PREVIEW.glbUrl).toContain('sedgehorn_mount/sedgehorn_adult.glb')
    expect(RIDER_SEAT_OFFSET).toEqual([0, 1.1502, -0.04])
  })

  it('frames the rider and adult mount together in riding mode', () => {
    const bounds = combinedRideBounds(
      { center: [0, 1, 0], size: [2, 2, 2] },
      { center: [0, 0.5, 0], size: [4, 1, 6] },
    )
    expect(bounds.center[1]).toBeCloseTo(1.5751)
    expect(bounds.size[1]).toBeCloseTo(3.1502)
    expect([bounds.size[0], bounds.size[2]]).toEqual([4, 6])
  })

  it('widens only on-foot side and three-quarter staff views', () => {
    expect(shouldFrameHeldStaff('side', 'wand', false)).toBe(true)
    expect(shouldFrameHeldStaff('three-quarter', 'wand', false)).toBe(true)
    expect(shouldFrameHeldStaff('front', 'wand', false)).toBe(false)
    expect(shouldFrameHeldStaff('side', 'axe', false)).toBe(false)
    expect(shouldFrameHeldStaff('side', 'wand', true)).toBe(false)
  })

  it('keeps the held-tool grip separate from every on-foot motion track', () => {
    expect(CHARACTER_TOOL_GRIP_CLIP).toBe('ToolGrip')
    const clips = [
      { name: 'Idle', tracks: [{ name: 'Arm.quaternion' }] },
      { name: 'Walk', tracks: [{ name: 'Leg.quaternion' }] },
      { name: 'ToolGrip', tracks: [{ name: 'Finger.quaternion' }] },
    ]
    expect(overlappingToolGripTracks(clips)).toEqual([])
    expect(overlappingToolGripTracks([
      ...clips.slice(0, 2),
      { name: 'ToolGrip', tracks: [{ name: 'Finger.quaternion' }, { name: 'Arm.quaternion' }] },
    ])).toEqual(['Arm.quaternion'])
  })

  it('does not silently fall back for an unknown character or candidate', () => {
    expect(selectCharacterCandidate('unknown', null)).toBeUndefined()
    expect(selectCharacterCandidate('wayfarer', 'approved-male')).toBeUndefined()
    expect(selectCharacterCandidate('wayfarer', 'wayfarer-v10-male')).toBeUndefined()
  })
})
