import { describe, expect, it } from 'vitest'
import { resolvePublicV17GreenwaySite } from '../domain/publicWorldV17GreenwaySites'
import { resolvePublicV28RiverBridge } from '../domain/publicWorldV28RiverBridgeSites'
import type { WizardViewProjection } from './contracts'
import { surveyorCrossingQuest } from './surveyorCrossingQuest'

const seed = 'wizard-realms'
const creekId = 'works4:bridge:greenway-creek:0'
const riverId = 'works6:river-bridge:-14'
const creek = resolvePublicV17GreenwaySite(seed, creekId)
const river = resolvePublicV28RiverBridge(seed, riverId)
if (creek?.kind !== 'bridge' || !river) throw new Error('Missing canonical test bridges')

function view(logs: number, position: readonly [number, number, number],
  post?: { bridgeId: string; claimReady: boolean; reward: 'basic-pick' | 'coins' },
  learnedGlow = false):
  WizardViewProjection {
  return { seed, backpack: { stacks: [
    { itemId: 'woodcutters_axe', quantity: 1 },
    ...(logs ? [{ itemId: 'logs', quantity: logs }] : []),
  ] }, equipment: { mainHand: null },
  player: { position }, learnedSpellIds: learnedGlow ? ['wayfinder_glow'] : [],
  v30Bridgehead: post ?? null } as unknown as WizardViewProjection
}

describe("The Surveyor's First Find read-only quest", () => {
  it('offers an optional first spell lesson without hiding the bridge goal', () => {
    const fresh = surveyorCrossingQuest(view(0, [0, 0, 0]),
      { builtBridgeIds: [] }, [], null)
    expect(fresh.stage).toBe('gather')
    expect(fresh.objective).toContain('Equip Woodcutter axe from Backpack')
    expect(fresh.objective).toContain('8 more logs (0/8)')
    expect(fresh.objective).toContain('Optional: study nearby waystone')
    expect(fresh.objective).toContain('then cast Glow near fog')
    expect(fresh.objective).toContain('bridge still needed')
    expect(fresh.objective.length).toBeLessThan(190)
  })

  it('moves from gathering to building only when eight logs are carried', () => {
    const atHome = view(7, [0, 0, 0])
    const gathering = surveyorCrossingQuest(atHome, { builtBridgeIds: [] }, [], null)
    expect(gathering).toMatchObject({ id: 'surveyor-first-find/v1', stage: 'gather',
      complete: false })
    expect(gathering.objective).toContain('Equip Woodcutter axe from Backpack')
    expect(gathering.objective).toContain('1 more log (7/8)')
    const learned = surveyorCrossingQuest(view(7, [0, 0, 0], undefined, true),
      { builtBridgeIds: [] }, [], null)
    expect(learned.stage).toBe('gather')
    expect(learned.objective).toContain('Optional: cast Glow near fog')
    expect(learned.objective).not.toContain('study nearby waystone')
    const skippedSpell = surveyorCrossingQuest(view(8, [0, 0, 0]),
      { builtBridgeIds: [] }, [], null)
    expect(skippedSpell.stage).toBe('build')
    expect(skippedSpell.objective).not.toContain('Glow')
    expect(skippedSpell.reward).toContain('basic pick')
  })

  it.each([
    { id: creekId, kind: 'creek', z: creek.exit.z, greenway: [creekId], river: [] },
    { id: riverId, kind: 'connected-river', z: river.exit.z, greenway: [], river: [riverId] },
  ])('accepts the canonical $kind bridge and shows the checked claim reward',
    ({ id, z, greenway, river: riverIds }) => {
      const works = { builtBridgeIds: greenway }
      const atApproach = view(0, [0, 0, -100])
      expect(surveyorCrossingQuest(atApproach, works, riverIds, null).stage).toBe('cross')
      const atPost = view(0, [0, 0, z],
        { bridgeId: id, claimReady: true, reward: 'basic-pick' })
      const ready = surveyorCrossingQuest(atPost, works, riverIds, null)
      expect(ready.stage).toBe('claim')
      expect(ready.objective).toContain('use Claim')
      expect(ready.reward).toContain('basic pick')
      expect(ready.objective).not.toContain('Glow')
      expect(ready.objective).toContain('River Works post')
      expect(surveyorCrossingQuest(view(0, [0, 0, z],
        { bridgeId: id, claimReady: true, reward: 'coins' }),
      works, riverIds, null).reward).toContain('35 coins')
    })

  it('remembers a checked claim without guessing the historical reward branch', () => {
    const works = { builtBridgeIds: [creekId] }
    const afterReload = surveyorCrossingQuest(view(0, [0, 0, -20]), works, [], creekId)
    expect(afterReload).toMatchObject({ stage: 'complete', complete: true })
    expect(afterReload.reward).toContain('does not say whether')
    expect(surveyorCrossingQuest(view(0, [0, 0, -20]), works, [],
      'works4:bridge:greenway-creek:0:forged').complete).toBe(false)
  })
})
