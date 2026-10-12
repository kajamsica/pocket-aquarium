import { describe, expect, it } from 'vitest'
import { publicV32ActionForProjectedChoice,
  publicV32HighlandObjective } from './PublicV23Controller'
import { PUBLIC_V32_CROWN_INTERACTION_ID,
  publicV32NodeInteractionId } from './PublicV32WorldView'
import { HIGHLAND_LANDMARK } from './domain/highlandContent'
import type { WizardViewProjection } from './view/contracts'

const view = (targetId: string, actionable = true,
  nodeId?: string): WizardViewProjection => ({
  nearbyInteraction: { kind: 'other', targetId, label: 'Highland',
    action: 'Study or extract', actionable },
  checkedActionChoices: [{ id: targetId, actionable,
    reason: actionable ? null : 'Move closer.' }],
  ...(nodeId ? { highlandExtraction: { nodeId, label: 'Stone', actionable,
    reason: actionable ? 'Ready' : 'Move closer.' } } : {}),
} as unknown as WizardViewProjection)

describe('V32 projected Highland choice gate', () => {
  it('maps only the current actionable Crown prompt to a study witness', () => {
    const current = view(PUBLIC_V32_CROWN_INTERACTION_ID)
    expect(publicV32ActionForProjectedChoice(current, 'generic'))
      .toEqual({ kind: 'highland-discover/v1', landmarkId: HIGHLAND_LANDMARK.id })
    expect(publicV32ActionForProjectedChoice(view(PUBLIC_V32_CROWN_INTERACTION_ID, false),
      'generic')).toBeNull()
    expect(publicV32ActionForProjectedChoice(current, { nodeId: 'unrelated' })).toBeNull()
  })

  it('never lets generic E or the explicit button target a stale or hidden node', () => {
    const node = 'highland_quarry/stone/1', target = publicV32NodeInteractionId(node)
    const current = view(target, true, node)
    expect(publicV32ActionForProjectedChoice(current, 'generic'))
      .toEqual({ kind: 'highland-extract/v1', nodeId: node })
    expect(publicV32ActionForProjectedChoice(current, { nodeId: node }))
      .toEqual({ kind: 'highland-extract/v1', nodeId: node })
    expect(publicV32ActionForProjectedChoice(current, { nodeId: 'other' })).toBeNull()
    expect(publicV32ActionForProjectedChoice(view(target, false, node), 'generic')).toBeNull()
    expect(publicV32ActionForProjectedChoice(view(target, false, node),
      { nodeId: node })).toBeNull()
    expect(publicV32ActionForProjectedChoice(view(target, true), 'generic')).toBeNull()
  })
})

describe('V32 east approach objective', () => {
  const mapView = (discovered: boolean, title = 'Greenway') => ({
    map: { title, guidance: 'The discovered eastern Greenway path leads to Highland Quarry.',
      tiles: [{ discovered, hasEastTrail: true }] },
  } as unknown as WizardViewProjection)

  it('routes a revealed east-valley exit around the actual rock wall, not straight through it', () => {
    expect(publicV32HighlandObjective(mapView(true), 'greenway',
      { x: 28.1, z: 0.3 }, false, true)).toMatchObject({
        summary: 'Highland Quarry: bypass the east rock wall',
      })
    const saved = publicV32HighlandObjective(mapView(true), 'greenway',
      { x: 28.1, z: 0.3 }, false, true)!.action
    expect(saved).toContain('Backtrack west to your saved north ladder')
    expect(saved).toContain('stay north of the wall while passing x 30')
    expect(saved).toContain('turn southeast')
    expect(saved).not.toContain('Walk east to chart the trail')
    expect(publicV32HighlandObjective(mapView(true), 'greenway',
      { x: 28.1, z: 0.3 }, false, false)?.action).toContain('build a supported north cliff ladder')
    expect(publicV32HighlandObjective(mapView(false), 'greenway',
      { x: 28.1, z: 0.3 }, false, true)).toBeNull()
    expect(publicV32HighlandObjective(mapView(true), 'greenway',
      { x: 0, z: 0 }, false, true)).toBeNull()
    expect(publicV32HighlandObjective(mapView(true), 'greenway',
      { x: 28.1, z: -8 }, false, true)?.action)
      .toContain('Stay on the north side of the rock wall')
  })

  it('keeps Quarry and return-trade guidance primary once the player progresses', () => {
    const quarry = mapView(false, 'Highland Quarry')
    expect(publicV32HighlandObjective(quarry, 'streamed',
      { x: 464, z: -432 }, false, true)?.summary).toBe('Highland Quarry: study and extract')
    expect(publicV32HighlandObjective(quarry, 'streamed',
      { x: 464, z: -432 }, true, true)?.summary).toBe('Highland stone: return west to trade')
  })

  it('shows the charted dry bypass at the first bend without a nearby trail marker', () => {
    const guidance = 'River water blocks the old east trail. Backtrack west along dry ground toward the charted x68 north-bypass entrance, then turn north to the z -4 bank before heading east.'
    const firstBend = { map: { title: 'South River', guidance, guidancePriority: true,
      tiles: [{ discovered: true, hasEastTrail: false, hasHighlandTrail: false }] },
    } as unknown as WizardViewProjection
    expect(publicV32HighlandObjective(firstBend, 'streamed',
      { x: 93.99, z: -1.43 }, false, true)).toEqual({
      summary: 'Highland route: backtrack west to the north bypass', action: guidance,
    })
    expect(publicV32HighlandObjective(firstBend, 'streamed',
      { x: 93.99, z: -1.43 }, true, true)?.summary)
      .toBe('Highland stone: return west to trade')
    expect(publicV32HighlandObjective({ ...firstBend,
      map: { ...firstBend.map, guidancePriority: undefined } }, 'streamed',
    { x: 93.99, z: -1.43 }, false, true)).toBeNull()
  })
})
