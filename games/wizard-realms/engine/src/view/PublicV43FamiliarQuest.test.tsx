import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from '../domain/discoveryMask'
import { createFreshPublicV43Root } from '../domain/publicWorldV43Snapshot'
import type { PublicV43Head } from '../domain/publicWorldV43Snapshot'
import { resolveSedgehornFamiliarSite } from '../domain/sedgehornFamiliarContent'
import { projectPublicV43FamiliarQuest, PublicV43FamiliarQuestPanel }
  from './PublicV43FamiliarQuest'

const initial = createFreshPublicV43Root('wizard-realms').head
const site = resolveSedgehornFamiliarSite(initial)!
const withTiles = (head: PublicV43Head, ...tileIds: string[]): PublicV43Head => ({
  ...head, state: { ...head.state, discoveryMask: encodeDiscoveredTileIds([
    ...new Set([...decodeDiscoveredTileIds(head.state.discoveryMask), ...tileIds]),
  ].sort()) },
})
const phase = (head: PublicV43Head, next: PublicV43Head['familiar']['phase']):
  PublicV43Head => ({ ...head, familiar: { ...head.familiar, phase: next } })

describe('V43 Lost Familiar quest readout', () => {
  it('locks on the actual south-bank crossing, without revealing a hidden target or requiring Iron Hall', () => {
    const quest = projectPublicV43FamiliarQuest(initial)!
    expect(quest.eligible).toBe(false)
    expect(quest.completedSteps).toBe(0)
    expect(quest.objective).toContain('Windward Waystation south-bank crossing')
    expect(quest.targets).toEqual([])
    expect(quest.location).not.toContain('Iron Hall')
    expect(quest.reward).toContain('not a rideable mount')
    expect(quest.reward).not.toContain('bridge escort')
  })

  it('only points to discovered tracks and advances from the checked phase', () => {
    const crossed = { ...initial, southbankReached: true }
    expect(projectPublicV43FamiliarQuest(crossed)!.targets).toEqual([])
    const revealed = withTiles(crossed, site.tracks.id)
    const quest = projectPublicV43FamiliarQuest(revealed)!
    expect(quest.eligible).toBe(true)
    expect(quest.completedSteps).toBe(1)
    expect(quest.objective).toContain('Inspect the revealed sedgehorn tracks')
    expect(quest.targets).toMatchObject([{ tileId: site.tracks.id, label: 'Tracks' }])
    expect(projectPublicV43FamiliarQuest(phase(revealed, 'tracks'))!.completedSteps).toBe(2)
  })

  it('shows real herb and route choices, including the supported dry alternative', () => {
    const base = withTiles({ ...initial, southbankReached: true },
      site.shelter.id, site.dryApproach.id)
    const tracks = phase(base, 'tracks')
    expect(projectPublicV43FamiliarQuest(tracks)!.objective).toContain('Gather one marsh herb')
    const carrying = { ...tracks, state: { ...tracks.state, player: {
      ...tracks.state.player, inventory: [
        ...tracks.state.player.inventory, { itemId: 'marsh_herb' as const, quantity: 1 }],
    } } }
    expect(projectPublicV43FamiliarQuest(carrying)!.objective).toContain('Offer one carried marsh herb')
    const fed = { ...phase(base, 'fed'), familiar: {
      ...base.familiar, phase: 'fed' as const, trust: 1, creatureCareXp: 10 } }
    const offer = projectPublicV43FamiliarQuest(fed)!
    expect(offer.objective).toContain('two logs on shelter (0/2 carried)')
    expect(offer.objective).toContain('supported dry approach')
    expect(offer.targets.map((target) => target.tileId)).toEqual([
      site.careStation.id, site.dryApproach.id])
    expect(offer.careXp).toBe(10)
  })

  it('does not imply that a waiting companion can cross unsafe support', () => {
    const base = withTiles({ ...initial, southbankReached: true }, site.keeper.id)
    const escort = { ...phase(base, 'escort'), familiar: {
      ...base.familiar, phase: 'escort' as const, waitReason: 'unsafe_support' as const } }
    const quest = projectPublicV43FamiliarQuest(escort)!
    expect(quest.completedSteps).toBe(5)
    expect(quest.objective).toContain('cannot follow over this support')
    expect(quest.objective).toContain('revealed dry terrain')
    expect(projectPublicV43FamiliarQuest({ ...escort, familiar: {
      ...escort.familiar, waitReason: 'separated' } })!.objective)
      .toContain('last safe position')
  })

  it('renders an accessible, read-only reward and completion state', () => {
    const claimed = { ...initial, southbankReached: true, familiar: {
      ...initial.familiar, phase: 'claimed' as const,
      routeChoice: 'dry-approach' as const, trust: 2, creatureCareXp: 40,
      stationKnown: true } }
    const html = renderToStaticMarkup(createElement(PublicV43FamiliarQuestPanel,
      { head: claimed }))
    expect(html).toContain('aria-label="The Lost Familiar quest"')
    expect(html).toContain('aria-label="Lost Familiar progress"')
    expect(html).toContain('Step 7 of 7')
    expect(html).toContain('<strong>Complete</strong>')
    expect(html).toContain('Claimed reward:')
    expect(html).toContain('25 coins and 40 character XP')
    expect(html).toContain('not a rideable mount')
    expect(html).not.toContain('<button')
  })

  it('shows an actionable revealed clue nearby and a clear disabled reason out of reach', () => {
    const crossed = withTiles({ ...initial, southbankReached: true,
      state: { ...initial.state, movementOwner: 'streamed' as const,
        player: { ...initial.state.player, position: { ...site.tracks.center } } } },
    site.tracks.id)
    const nearby = renderToStaticMarkup(createElement(PublicV43FamiliarQuestPanel,
      { head: crossed, actionsEnabled: true, onAction: () => {} }))
    expect(nearby).toContain('Inspect tracks</button>')
    expect(nearby).not.toContain('Move within 3 m')
    const distant = { ...crossed, state: { ...crossed.state, player: {
      ...crossed.state.player, position: { ...crossed.state.player.position,
        x: crossed.state.player.position.x + 12 } } } }
    const far = renderToStaticMarkup(createElement(PublicV43FamiliarQuestPanel,
      { head: distant, actionsEnabled: true, onAction: () => {} }))
    expect(far).toContain('disabled=""')
    expect(far).toContain('Move within 3 m of the marked quest location.')
  })

  it('targets the checked shelter for the herb offer, including near and far hints', () => {
    // The current site resolver aliases the later care station to this shelter tile.
    expect(site.careStation.id).toBe(site.shelter.id)
    const crossed = withTiles({ ...initial, southbankReached: true,
      familiar: { ...initial.familiar, phase: 'tracks' as const },
      state: { ...initial.state, movementOwner: 'streamed' as const,
        player: { ...initial.state.player, position: { ...site.shelter.center },
          inventory: [...initial.state.player.inventory,
            { itemId: 'marsh_herb' as const, quantity: 1 }] } } }, site.shelter.id)
    const near = renderToStaticMarkup(createElement(PublicV43FamiliarQuestPanel,
      { head: crossed, actionsEnabled: true, onAction: () => {} }))
    expect(near).toContain('Offer marsh herb</button>')
    expect(near).not.toContain('disabled=""')
    const distant = { ...crossed, state: { ...crossed.state, player: {
      ...crossed.state.player, position: { ...site.shelter.center,
        x: site.shelter.center.x + 12 } } } }
    const far = renderToStaticMarkup(createElement(PublicV43FamiliarQuestPanel,
      { head: distant, actionsEnabled: true, onAction: () => {} }))
    expect(far).toContain('disabled=""')
    expect(far).toContain('Move within 3 m of the marked quest location.')
  })

  it('offers checked care after claim without presenting the companion as rideable', () => {
    const claimed = { ...initial, southbankReached: true, familiar: {
      ...initial.familiar, phase: 'claimed' as const,
      routeChoice: 'dry-approach' as const, trust: 2, creatureCareXp: 40,
      stationKnown: true } }
    const html = renderToStaticMarkup(createElement(PublicV43FamiliarQuestPanel,
      { head: claimed, actionsEnabled: true, onAction: () => {} }))
    expect(html).toContain('Sedgehorn care visits: 0/3')
    expect(html).toContain('Care for sedgehorn')
    expect(html).toContain('Return to Mireglass Reach.')
    expect(html).toContain('not a rideable mount')
  })

  it('keeps the completed rescue and ongoing care instructions distinct at 0, 2, and 3 visits', () => {
    const claimed = { ...initial, southbankReached: true, familiar: {
      ...initial.familiar, phase: 'claimed' as const,
      routeChoice: 'dry-approach' as const, trust: 2, creatureCareXp: 40,
      stationKnown: true } }
    const withCares = (count: number) => ({ ...claimed, mountTraining: { careWitnesses:
      Array.from({ length: count }, (_, index) => ({
        kind: 'sedgehorn-care/v1' as const, tick: index * 600,
        eventSequence: index + 1,
      })) } })
    const first = projectPublicV43FamiliarQuest(withCares(0))!
    expect(first.objective).toContain('Rescue complete.')
    expect(first.objective).toContain('3 more care visits')
    expect(first.objective).toContain('one marsh herb per visit')
    expect(first.objective).toContain('cannot be ridden in this preview')
    expect(first.objective).not.toContain('ticks')
    const html = renderToStaticMarkup(createElement(PublicV43FamiliarQuestPanel,
      { head: withCares(0) }))
    expect(html).toContain('<strong>Complete</strong>')
    expect(html).toContain('Step 7 of 7')
    expect(html).toContain('<strong>Next:</strong> Rescue complete.')
    expect(projectPublicV43FamiliarQuest(withCares(2))!.objective)
      .toContain('1 more care visit at the station')
    const mature = projectPublicV43FamiliarQuest(withCares(3))!
    expect(mature.objective).toContain('All three care visits are recorded.')
    expect(mature.objective).toContain('cannot be ridden in this preview')
    expect(mature.objective).not.toContain('more care')
    expect(mature.objective).not.toContain('ticks')
    const matureHtml = renderToStaticMarkup(createElement(PublicV43FamiliarQuestPanel,
      { head: withCares(3), actionsEnabled: true, onAction: () => {} }))
    expect(matureHtml).toContain('Mature, but cannot be ridden in this preview.')
    expect(matureHtml).not.toContain('not rideable yet')
  })
})
