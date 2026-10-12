import { describe, expect, it } from 'vitest'
import type { WizardViewProjection } from './contracts'
import { publicV35LedgerQuest } from './publicV35LedgerQuest'
import type { PublicV35LedgerQuestFacts } from './publicV35LedgerQuest'

const view = { seed: 'wizard-realms', backpack: { stacks: [], capacity: 20 },
  tradeListings: [], v26TerrainBag: { soil: 0, stone: 0, iron_ore: 0,
    gold_ore: 0, diamond: 0 }, v29Mining: { tools: {
    basicPickOwned: true, activePick: 'basic' } } } as unknown as WizardViewProjection
const base: PublicV35LedgerQuestFacts = {
  claimedBridgeheadId: null, riverBridgeIds: [],
  greenwayWorks: { builtLadderIds: [] },
  ledgerSurveyBridgeId: null, ledgerClaimReward: null,
  terrain: { bag: { stone: 0 } },
}
const bridge = 'works6:river-bridge:-14'
const ladder = 'works4:ladder:greenway-north-cliff:11'

describe('V35 read-only ledger journal', () => {
  it('shows the staged route and actionable sample hint', () => {
    expect(publicV35LedgerQuest(view, base).stage).toBe('first-find')
    const claimed = { ...base, claimedBridgeheadId: 'works4:bridge:greenway-creek:0' }
    expect(publicV35LedgerQuest(view, claimed).stage).toBe('route')
    expect(publicV35LedgerQuest(view, { ...claimed,
      greenwayWorks: { builtLadderIds: [ladder] }, riverBridgeIds: [bridge] }).stage)
      .toBe('survey')
    const surveyed = { ...claimed, ledgerSurveyBridgeId: bridge }
    const sample = publicV35LedgerQuest(view, surveyed)
    expect(sample.stage).toBe('sample')
    expect(sample.objective).toContain('tap the exposed deeper layer for stone')
    expect(publicV35LedgerQuest(view, { ...surveyed,
      terrain: { bag: { stone: 1 } } }).stage).toBe('return')
  })

  it('guides the built-ladder Ledger route without promising an unmarked bridge', () => {
    const claimed = { ...base, claimedBridgeheadId: 'works4:bridge:greenway-creek:0' }
    const withoutLadder = publicV35LedgerQuest(view, claimed)
    expect(withoutLadder.objective).toContain('Build or use a marked north cliff ladder with 4 logs')
    const withLadder = publicV35LedgerQuest(view, { ...claimed,
      greenwayWorks: { builtLadderIds: [ladder] } })
    expect(withLadder.stage).toBe('route')
    expect(withLadder.objective).toMatch(/8 logs.*saved north cliff ladder/)
    expect(withLadder.objective).toMatch(/revealed dry upper ground west.*west rock return/)
    expect(withLadder.objective).toMatch(/descend on revealed dry ground.*connected river/)
    expect(withLadder.objective).toMatch(/dry bank until a site is marked Ready.*Build there, then cross/)
    expect(withLadder.reward).toBe(withoutLadder.reward)
    expect(publicV35LedgerQuest(view, { ...claimed, greenwayWorks: { builtLadderIds: [ladder] },
      riverBridgeIds: [bridge] }).stage).toBe('survey')
  })

  it.each([['traveler_tunic', '50 coins'], ['coins', '85 coins']] as const)(
    'renders saved %s claim instead of inferring it from inventory', (reward, label) => {
      const complete = publicV35LedgerQuest(view, { ...base,
        ledgerSurveyBridgeId: bridge, ledgerClaimReward: reward })
      expect(complete).toMatchObject({ stage: 'complete', complete: true })
      expect(complete.reward).toContain(label)
    })
})
