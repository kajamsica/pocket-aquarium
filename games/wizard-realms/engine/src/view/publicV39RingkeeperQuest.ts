import type { WizardViewProjection } from './contracts'

export type PublicV39RingkeeperActionPreview = Readonly<{
  rejection: string | null
  hint: string | null
}>

export type PublicV39RingkeeperQuestFacts = Readonly<{
  quarryRingDiscovered: boolean
  ringLinkEstablished: boolean
  ringOutboundCompleted: boolean
  ringReturnCompleted: boolean
  ringkeeperClaimed: boolean
  discover: PublicV39RingkeeperActionPreview
  link: PublicV39RingkeeperActionPreview
  claim: PublicV39RingkeeperActionPreview
}>

export type PublicV39RingkeeperQuest = Readonly<{
  id: 'ringkeepers-trail/v1'
  title: "Ringkeeper's Trail"
  stage: 'find' | 'return' | 'link' | 'outbound' | 'return-via-ring' | 'claim' | 'complete'
  objective: string
  reward: string
  complete: boolean
  discover: PublicV39RingkeeperActionPreview
  link: PublicV39RingkeeperActionPreview
  claim: PublicV39RingkeeperActionPreview
}>

const reward = 'Claim at the Greenway fairy ring: 25 coins, 30 Wayfinding XP, 20 Spellcraft XP, and 35 character XP. The two-way Highland shortcut remains after the claim.'

/** Read-only journal copy. The checked V39 writer owns discovery, travel, and rewards. */
export function publicV39RingkeeperQuest(view: WizardViewProjection,
  facts: PublicV39RingkeeperQuestFacts): PublicV39RingkeeperQuest {
  const finish = (stage: PublicV39RingkeeperQuest['stage'], objective: string): PublicV39RingkeeperQuest => ({
    id: 'ringkeepers-trail/v1', title: "Ringkeeper's Trail", stage, objective, reward,
    complete: stage === 'complete', discover: facts.discover, link: facts.link, claim: facts.claim,
  })
  if (facts.ringkeeperClaimed) return finish('complete',
    'The Ringkeeper reward was claimed. The checked Greenway and Highland Quarry ring link remains available for two-way travel.')
  if (facts.ringReturnCompleted) return finish('claim',
    'Back in Greenway, approach its fairy ring and claim your Ringkeeper reward.')
  if (facts.ringOutboundCompleted) return finish('return-via-ring',
    'At the Highland Quarry fairy ring, choose Greenway in the existing travel panel to complete the return journey.')
  if (facts.ringLinkEstablished) return finish('outbound',
    'At the Greenway fairy ring, choose Highland Quarry in the existing travel panel to take the new route out.')
  if (facts.quarryRingDiscovered) {
    const greenway = view.fairyRings.find((ring) => ring.id === 'ring-greenway')
    const nearGreenway = greenway && Math.hypot(view.player.position[0] - greenway.position[0],
      view.player.position[2] - greenway.position[2]) < 12
    return nearGreenway ? finish('link',
      'At the Greenway fairy ring, establish the checked link to Highland Quarry.')
      : finish('return', 'Walk back to the Greenway fairy ring to establish the Highland Quarry link.')
  }
  return finish('find', view.v39QuarryRing
    ? 'At the revealed Highland Quarry fairy ring, use Discover to record the site.'
    : 'Follow the dry Highland trail beyond Quarry Crown and find the Highland Quarry fairy ring.')
}
