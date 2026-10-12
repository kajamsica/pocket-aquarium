import { describe, expect, it } from 'vitest'
import { createWizardWorld } from '../domain'
import { mireglassAnchors } from '../domain/mireglassContent'
import { toViewProjection } from '../App'
import type { WizardViewProjection } from './contracts'
import { publicV36MarkerQuest, publicV36MarkerRejectionMessage,
  type PublicV36MarkerQuestFacts } from './publicV36MarkerQuest'

const baseView = toViewProjection(createWizardWorld('greenway-alpha'), [])
const facts: PublicV36MarkerQuestFacts = {
  ledgerClaimReward: null, markerClaimReward: null,
  state: { mireglass: { fringeMarkerStudied: false,
    cacheRevealed: false, cacheExcavated: false } },
}
const withRegion = (mireglass: Partial<PublicV36MarkerQuestFacts['state']['mireglass']>,
  extra: Partial<PublicV36MarkerQuestFacts> = {}): PublicV36MarkerQuestFacts => ({
  ...facts, ledgerClaimReward: 'traveler_tunic', ...extra,
  state: { mireglass: { ...facts.state.mireglass, ...mireglass } },
})

describe('V36 read-only Old Marker journal', () => {
  it('waits for the checked Ledger claim, then guides trail and marker', () => {
    expect(publicV36MarkerQuest(baseView, facts)).toMatchObject({ stage: 'ledger', active: false })
    const started = withRegion({})
    expect(publicV36MarkerQuest(baseView, started)).toMatchObject({ stage: 'trail', active: true })
    const marker = mireglassAnchors(baseView.seed).fringeMarker.tile.center
    const nearby: WizardViewProjection = { ...baseView, player: { ...baseView.player,
      position: [marker.x, marker.y, marker.z] } }
    expect(publicV36MarkerQuest(nearby, started)).toMatchObject({ stage: 'marker', active: true })
  })

  it('uses saved marker and cache milestones, then gives real spade and skill guidance', () => {
    const studied = withRegion({ fringeMarkerStudied: true })
    expect(publicV36MarkerQuest(baseView, studied)).toMatchObject({ stage: 'cast' })
    const revealed = withRegion({ fringeMarkerStudied: true, cacheRevealed: true })
    const training = publicV36MarkerQuest(baseView, revealed)
    expect(training.stage).toBe('training')
    expect(training.objective).toContain('chop a Mireglass tree, then dig its stump')
    expect(training.objective).toContain('Buy a field spade')
    const skilled: WizardViewProjection = { ...baseView,
      skillXp: { ...baseView.skillXp, excavation: 30 } }
    const cache = publicV36MarkerQuest(skilled, revealed)
    expect(cache.stage).toBe('cache')
    expect(cache.objective).toContain('Free one pack space')
    expect(cache.reward).toContain('Spellcasting and excavation grant their own action XP')
  })

  it('accepts saved excavation even after the seal was sold, and reports the exact saved branch', () => {
    const excavated = withRegion({ fringeMarkerStudied: true,
      cacheRevealed: true, cacheExcavated: true })
    expect(publicV36MarkerQuest(baseView, excavated)).toMatchObject({ stage: 'salvager' })
    expect(publicV36MarkerQuest(baseView, excavated).objective).toContain('even if you sold the seal')
    const waders = publicV36MarkerQuest(baseView, { ...excavated,
      markerClaimReward: 'fen_waders' })
    expect(waders).toMatchObject({ stage: 'complete', complete: true })
    expect(waders.reward).toContain('80 coins, unequipped Fen Waders')
    expect(waders.reward).toContain('not armor')
    const coins = publicV36MarkerQuest(baseView, { ...excavated,
      markerClaimReward: 'coins' })
    expect(coins.reward).toContain('230 coins')
    expect(coins.reward).not.toContain('80 coins')
  })

  it('turns checked claim rejections into useful nearby guidance', () => {
    expect(publicV36MarkerRejectionMessage('capacity')).toContain('Free one pack space')
    expect(publicV36MarkerRejectionMessage('too_far')).toContain('3 m')
    expect(publicV36MarkerRejectionMessage('unknown')).toContain('not ready')
  })
})
