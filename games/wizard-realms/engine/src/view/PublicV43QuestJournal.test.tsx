import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { resolvePublicV28RiverBridge } from '../domain/publicWorldV28RiverBridgeSites'
import { SEDGEHORN_CARES_TO_MATURE } from '../domain/publicWorldV43MountTraining'
import { createFreshPublicV43Root } from '../domain/publicWorldV43Snapshot'
import type { PublicV43Progress } from '../domain/publicWorldV43Snapshot'
import type { WizardViewProjection } from './contracts'
import { publicV35LedgerQuest } from './publicV35LedgerQuest'
import { publicV40WaystationQuest } from './publicV40WaystationQuest'
import { publicV42IronHallQuest } from './publicV42IronHallQuest'
import { PublicV43QuestJournal, selectPublicV43QuestLead } from './PublicV43QuestJournal'
import type { PublicV43QuestLeads } from './PublicV43QuestJournal'

type Extra = Omit<PublicV43QuestLeads, 'head' | 'ledgerQuest'>
const none = { rejection: null, hint: null }

const waystation = (crossed: boolean, claimed: boolean) => publicV40WaystationQuest(
  { backpack: { stacks: [] } } as unknown as WizardViewProjection, { timberBartered: false,
    southbankReached: crossed, waystationClaimed: claimed, barter: none, cross: none, claim: none })

const ironHall = (claimed: boolean) => publicV42IronHallQuest({ tick: 0,
  v41IronHall: { wardDefeated: true }, v42QuartermasterSite: { revealed: true },
  v42IronHall: { crestOutcome: 'won', questClaimed: claimed, vestDurability: 12,
    spar: { active: false, strikeAtTick: 0, nextReadyTick: 0 } } } as unknown as WizardViewProjection)

function ledgerClaimedHead(southbankReached = false): PublicV43Progress {
  const fresh = createFreshPublicV43Root('wizard-realms').head
  const river = resolvePublicV28RiverBridge(fresh.state.seed, 'works6:river-bridge:-14')!
  return { ...fresh, southbankReached,
    greenwayWorks: { ...fresh.greenwayWorks,
      builtBridgeIds: ['works4:bridge:greenway-creek:-14'],
      builtLadderIds: ['works4:ladder:greenway-north-cliff:11'],
      dugTileIds: ['works3:dig:0:4'] },
    claimedBridgeheadId: 'works4:bridge:greenway-creek:-14',
    riverBridgeIds: [river.id], ledgerSurveyBridgeId: river.id,
    ledgerClaimReward: 'coins' as const,
    state: { ...fresh.state, greenway: { ...fresh.state.greenway,
      studiedInscriptionIds: ['greenway_waystone' as const] } } }
}

function leadsFor(head: PublicV43Progress, extra: Extra = {}): PublicV43QuestLeads {
  const view = { seed: head.state.seed,
    backpack: { stacks: head.state.player.inventory,
      capacity: head.state.player.backpackCapacity },
    tradeListings: head.state.player.tradeSlots.map((slot) =>
      slot.quantity > 0 ? { quantity: slot.quantity } : null),
    v26TerrainBag: head.terrain.bag,
    v29Mining: { tools: head.miningTools } } as unknown as WizardViewProjection
  return { head, ledgerQuest: publicV35LedgerQuest(view, head), ...extra }
}

function renderJournal(head: PublicV43Progress, extra: Extra = {}) {
  return renderToStaticMarkup(createElement(PublicV43QuestJournal, leadsFor(head, extra)))
}

/** The collapsed summary renders this same selector result in the controller. */
function expectLead(head: PublicV43Progress, extra: Extra, title: string, objective: string) {
  const leads = leadsFor(head, extra)
  const before = structuredClone(leads)
  expect(selectPublicV43QuestLead(leads)).toMatchObject({ title, objective })
  const html = renderToStaticMarkup(createElement(PublicV43QuestJournal, leads))
  expect(html).toContain(`Next: ${title}.`)
  expect(leads).toEqual(before)
  return html
}

describe('V43 quest journal', () => {
  it('shows an actionable starter lead and checked-reward caveat without changing the head', () => {
    const head = createFreshPublicV43Root('wizard-realms').head
    const before = structuredClone(head)
    const html = expectLead(head, { waystationQuest: waystation(false, false),
      ironHallQuest: ironHall(false) }, 'Creek Span', expect.any(String))
    expect(html).toContain('Greenway quest journal')
    expect(html).toContain('Creek Span: Next')
    expect(html).toContain('North Cliff: Suggested')
    expect(html).toContain('Carpenter Order: Optional')
    expect(html).toContain('Chop each nearby oak twice (4 logs per oak)')
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
    expect(html).toContain('North Cliff: Next')
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
    expect(html).toContain('Carpenter Order: Optional')
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

  it('suggests the Waystation after the claimed Ledger until its crossing is recorded', () => {
    const html = expectLead(ledgerClaimedHead(), { waystationQuest: waystation(false, false),
      ironHallQuest: ironHall(false) }, 'Windward Waystation',
    'Follow the eastbound Highland trail to find the broken crossing at the river.')
    expect(html).toContain('Windward Waystation, find:')
    expect(html).toContain('Claim at Greenway Outfitters after crossing: 45 coins')
    expect(html).toContain('Iron Hall Watch, Return to the quartermaster:')
    expect(html).toContain('60 coins, 70 character XP, 70 Combat XP, and the Guard Vest.')
    expect(html).toContain('Lost Familiar, cross:')
    expect(html).toContain('Carpenter Order: Optional')
  })

  it('suggests Iron Hall after the recorded crossing, then the Waystation claim, then the familiar', () => {
    const head = ledgerClaimedHead(true)
    expectLead(head, { waystationQuest: waystation(true, false), ironHallQuest: ironHall(false) },
      'Iron Hall Watch', 'Return to the Iron Hall quartermaster on foot to claim your reward.')
    expectLead(head, { waystationQuest: waystation(true, true), ironHallQuest: ironHall(false) },
      'Iron Hall Watch', 'Return to the Iron Hall quartermaster on foot to claim your reward.')
    expectLead(head, { waystationQuest: waystation(true, false), ironHallQuest: ironHall(true) },
      'Windward Waystation', 'Return to Greenway Outfitters and claim the Waystation repair reward.')
    expectLead(head, { waystationQuest: waystation(true, true), ironHallQuest: ironHall(true) },
      'Lost Familiar', 'Find the sedgehorn tracks.')
  })

  it('uses Waystation then familiar without inventing a Hall state when Iron Hall is unavailable', () => {
    const head = ledgerClaimedHead(true)
    const html = expectLead(head, { waystationQuest: waystation(true, false), ironHallQuest: null },
      'Windward Waystation', 'Return to Greenway Outfitters and claim the Waystation repair reward.')
    expect(html).not.toContain('Iron Hall')
    expectLead(head, { waystationQuest: waystation(true, true), ironHallQuest: null },
      'Lost Familiar', 'Find the sedgehorn tracks.')
    expectLead(ledgerClaimedHead(), {}, 'Lost Familiar',
      'Repair and record the Waystation crossing before searching for the sedgehorn.')
  })

  it('records the route once every lead is claimed and the familiar is mature', () => {
    const crossed = ledgerClaimedHead(true)
    const head = { ...crossed, familiar: { ...crossed.familiar, phase: 'claimed' as const },
      mountTraining: { careWitnesses: Array.from({ length: SEDGEHORN_CARES_TO_MATURE },
        (_, tick) => ({ tick })) } } as unknown as PublicV43Progress
    const extra = { waystationQuest: waystation(true, true), ironHallQuest: ironHall(true) }
    expect(selectPublicV43QuestLead(leadsFor(head, extra))).toBeNull()
    const html = renderJournal(head, extra)
    expect(html).not.toContain('Next:')
    expect(html).toContain('Starter route, Ledger, and familiar care are recorded.')
    expect(html).toContain('Lost Familiar, mount-ready:')
  })
})
