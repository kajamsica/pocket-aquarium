import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { resolvePublicV28RiverBridge } from '../domain/publicWorldV28RiverBridgeSites'
import { createFreshPublicV43Root } from '../domain/publicWorldV43Snapshot'
import type { PublicV43Progress } from '../domain/publicWorldV43Snapshot'
import type { WizardViewProjection } from './contracts'
import { publicV35LedgerQuest } from './publicV35LedgerQuest'
import { PublicV43QuestJournal } from './PublicV43QuestJournal'

function renderJournal(head: PublicV43Progress) {
  const view = { seed: head.state.seed,
    backpack: { stacks: head.state.player.inventory,
      capacity: head.state.player.backpackCapacity },
    tradeListings: head.state.player.tradeSlots.map((slot) =>
      slot.quantity > 0 ? { quantity: slot.quantity } : null),
    v26TerrainBag: head.terrain.bag,
    v29Mining: { tools: head.miningTools } } as unknown as WizardViewProjection
  const ledgerQuest = publicV35LedgerQuest(view, head)
  return renderToStaticMarkup(createElement(PublicV43QuestJournal, { head, ledgerQuest }))
}

describe('V43 quest journal', () => {
  it('shows an actionable starter lead and checked-reward caveat without changing the head', () => {
    const head = createFreshPublicV43Root('wizard-realms').head
    const before = structuredClone(head)
    const html = renderJournal(head)
    expect(html).toContain('Greenway quest journal')
    expect(html).toContain('Next: Creek Span.')
    expect(html).toContain('nearby oaks (4 logs per oak)')
    expect(html).toContain('Starter leads (0/5 resolved)')
    expect(html).toContain('Outfitters Ledger, first-find')
    expect(html).toContain('Each accepted care visit records 5 more Creature Care XP')
    expect(html).toContain('this journal does not claim extra rewards.')
    expect(head).toEqual(before)
  })

  it('takes the next uncompleted route from the checked built bridge state', () => {
    const fresh = createFreshPublicV43Root('wizard-realms').head
    const head = { ...fresh, greenwayWorks: { ...fresh.greenwayWorks,
      builtBridgeIds: ['works4:bridge:greenway-creek:-14'] },
    claimedBridgeheadId: 'works4:bridge:greenway-creek:-14' }
    const html = renderJournal(head)
    expect(html).toContain('Next: North Cliff.')
    expect(html).toContain('Starter leads (1/5 resolved)')
    expect(html).toContain('data-quest-status="complete"')
  })

  it('counts an unavailable creek reward as resolved without calling it complete', () => {
    const fresh = createFreshPublicV43Root('wizard-realms').head
    const river = resolvePublicV28RiverBridge(fresh.state.seed,
      'works6:river-bridge:-14')!
    const head = { ...fresh, greenwayWorks: { ...fresh.greenwayWorks,
      builtBridgeIds: ['works4:bridge:greenway-creek:-14'] },
    claimedBridgeheadId: river.id, riverBridgeIds: [river.id] }
    const html = renderJournal(head)
    expect(html).toContain('Starter leads (1/5 resolved)')
    expect(html).toContain('Creek Span: Closed')
    expect(html).toContain('data-quest-status="closed"')
  })

  it('keeps the optional order visible when only a later river route remains', () => {
    const fresh = createFreshPublicV43Root('wizard-realms').head
    const head = { ...fresh,
      greenwayWorks: { ...fresh.greenwayWorks,
        builtBridgeIds: ['works4:bridge:greenway-creek:-14'],
        builtLadderIds: ['works4:ladder:greenway-north-cliff:11'],
        dugTileIds: ['works3:dig:0:4'] },
      claimedBridgeheadId: 'works4:bridge:greenway-creek:-14',
      state: { ...fresh.state, greenway: { ...fresh.state.greenway,
        studiedInscriptionIds: ['greenway_waystone' as const] } } }
    const html = renderJournal(head)
    expect(html).toContain('Starter leads (4/5 resolved)')
    expect(html).toContain('Next: Outfitters Ledger.')
    expect(html).toContain('Carry 8 logs up your saved north cliff ladder')
    expect(html).toContain('Carpenter Order: Open')
  })

  it('uses the existing Ledger guidance for a blocked terrain sample', () => {
    const fresh = createFreshPublicV43Root('wizard-realms').head
    const river = resolvePublicV28RiverBridge(fresh.state.seed,
      'works6:river-bridge:-14')!
    const head = { ...fresh, ledgerSurveyBridgeId: river.id,
      state: { ...fresh.state, player: { ...fresh.state.player,
        inventory: [...fresh.state.player.inventory,
          { itemId: 'stone' as const, quantity: 19 }] } } }
    const html = renderJournal(head)
    expect(html).toContain('Outfitters Ledger, sample')
    expect(html).toContain('Your pack is full; use or sell carried materials to make room.')
    expect(html).toContain('Return to Greenway or a streamed area with active terrain controls.')
    expect(html).toContain('within 5 m of clear, revealed dry loam')
    expect(html).toContain('select Dig, and tap the same ground cell twice')
    expect(html).toContain('select Mine, and tap the exposed stone layer')
    expect(html).toContain('get a basic pick at Greenway Outfitters and equip it')
  })

  it('advances from the claimed Ledger to familiar care without requiring the optional order', () => {
    const fresh = createFreshPublicV43Root('wizard-realms').head
    const river = resolvePublicV28RiverBridge(fresh.state.seed,
      'works6:river-bridge:-14')!
    const head = { ...fresh,
      greenwayWorks: { ...fresh.greenwayWorks,
        builtBridgeIds: ['works4:bridge:greenway-creek:-14'],
        builtLadderIds: ['works4:ladder:greenway-north-cliff:11'],
        dugTileIds: ['works3:dig:0:4'] },
      claimedBridgeheadId: 'works4:bridge:greenway-creek:-14',
      riverBridgeIds: [river.id], ledgerSurveyBridgeId: river.id,
      ledgerClaimReward: 'coins' as const,
      state: { ...fresh.state, greenway: { ...fresh.state.greenway,
        studiedInscriptionIds: ['greenway_waystone' as const] } } }
    const html = renderJournal(head)
    expect(html).toContain('Next: Lost Familiar.')
    expect(html).toContain('Repair and record the Waystation crossing')
    expect(html).toContain('Carpenter Order: Open')
  })
})
