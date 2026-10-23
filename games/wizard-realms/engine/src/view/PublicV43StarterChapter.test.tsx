import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from '../domain/discoveryMask'
import { publicV17StarterSupportAt } from '../domain/publicWorldV17StarterMovement'
import { publicV25RiverCellAtGrid } from '../domain/publicWorldV25River'
import { publicV25StratumAt } from '../domain/publicWorldV25Strata'
import type { PublicV31Progress } from '../domain/publicWorldV31Migration'
import { previewPublicV31SoilAction } from '../domain/publicWorldV31Soil'
import { createFreshPublicV43Root } from '../domain/publicWorldV43Snapshot'
import type { PublicV43Progress } from '../domain/publicWorldV43Snapshot'
import { worldTileAtGrid } from '../domain/worldChunks'
import { PublicV43StarterChapter, projectPublicV43StarterChapter }
  from './PublicV43StarterChapter'

const creekBridgeId = 'works4:bridge:greenway-creek:-14'
const fresh = (): PublicV43Progress => createFreshPublicV43Root('wizard-realms').head
const withLogs = (head: PublicV43Progress, quantity: number): PublicV43Progress => ({
  ...head, state: { ...head.state, player: { ...head.state.player,
    inventory: [...head.state.player.inventory, { itemId: 'logs' as const, quantity }] } } })
const withBridge = (head: PublicV43Progress): PublicV43Progress => ({
  ...head, greenwayWorks: { ...head.greenwayWorks,
    builtBridgeIds: [creekBridgeId] } })
const withSpade = (head: PublicV43Progress): PublicV43Progress => ({
  ...head, state: { ...head.state, player: { ...head.state.player,
    inventory: [...head.state.player.inventory, { itemId: 'field_spade' as const, quantity: 1 }],
    equipment: { ...head.state.player.equipment, mainHand: 'field_spade' as const } } } })

const farBankLoam = (() => {
  for (let gz = 4; gz <= 8; gz += 1) for (let gx = -7; gx <= 7; gx += 1) {
    if (worldTileAtGrid('wizard-realms', gx, gz).terrain === 'loam'
      && !publicV25RiverCellAtGrid('wizard-realms', gx, gz)
      && publicV25StratumAt('wizard-realms', gx, gz, 0).material === 'soil')
      return { gx, gz }
  }
  throw new Error('Fresh V43 world has no far-bank soil cell for the starter chapter')
})()

const withDig = (head: PublicV43Progress): PublicV43Progress => ({
  ...head, terrain: { ...head.terrain,
    columns: [{ ...farBankLoam, openDepth: 1, rewardDepth: 1, pitLadder: false }],
    bag: { ...head.terrain.bag, soil: 1 } } })
// This coordinates-only probe checks a separate far-bank target with V31's
// placement guard. It does not claim the shaped chapter fixture is a saved journey.
const farBankStep = (() => {
  const head = withDig(withSpade(fresh())), seed = head.state.seed
  const route = head.state.greenway.routes.find(({ id }) => id === 'greenway_ladder') ?? null
  for (let gz = 4; gz <= 8; gz += 1) for (let gx = -7; gx <= 7; gx += 1) {
    if (gx === farBankLoam.gx && gz === farBankLoam.gz) continue
    const x = (gx - 1) * 4, z = gz * 4
    const support = publicV17StarterSupportAt({ seed,
      profile: head.state.generationProfile, route,
      built: false, greenwayWorks: head.greenwayWorks }, { x, z })
    if (support?.kind !== 'ground') continue
    const targetId = `tile-${gx + 3}-${gz + 3}`
    const progress: PublicV31Progress = { state: { ...head.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(head.state.discoveryMask), targetId])].sort()),
      player: { ...head.state.player, position: { x, y: support.floorY, z } } },
    greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks,
    terrain: head.terrain, nextHomeAtMs: head.nextHomeAtMs,
    riverBridgeIds: head.riverBridgeIds, miningTools: head.miningTools,
    claimedBridgeheadId: head.claimedBridgeheadId, raisedSoilCells: [] }
    if (previewPublicV31SoilAction(progress,
      { kind: 'soil-place/v1', gx, gz }).rejection === null) return { gx, gz }
  }
  throw new Error('No separate eligible far-bank soil-step cell for the chapter fixture')
})()
const withSoilStep = (head: PublicV43Progress): PublicV43Progress => ({
  ...head, raisedSoilCells: [farBankStep],
  terrain: { ...head.terrain, bag: { ...head.terrain.bag, soil: 0 } } })

describe('V43 starter chapter', () => {
  it('starts at an actionable eight-log objective and renders a semantic, read-only panel', () => {
    const head = fresh(), before = structuredClone(head)
    expect(projectPublicV43StarterChapter(head)).toMatchObject({
      stage: 'gather', complete: false, progressLabel: 'Chapter step 1 of 6' })
    const html = renderToStaticMarkup(createElement(PublicV43StarterChapter, { head }))
    expect(html).toContain('aria-label="Starter chapter"')
    expect(html).toContain('data-starter-chapter="gather"')
    expect(html).toContain('0/8 logs')
    expect(html).toContain('Equip your woodcutter axe')
    expect(html).toContain('Later: seek the north-cliff ladder')
    expect(head).toEqual(before)
  })

  it('replaces the ladder lead after either built north-cliff ladder is recorded', () => {
    const head = fresh()
    const canonical: PublicV43Progress = { ...head,
      state: { ...head.state, greenway: { ...head.state.greenway,
        builtRouteIds: [...head.state.greenway.builtRouteIds, 'greenway_ladder' as const] } } }
    const works: PublicV43Progress = { ...head, greenwayWorks: { ...head.greenwayWorks,
      builtLadderIds: ['works4:ladder:greenway-north-cliff:11'] } }
    for (const built of [canonical, works]) {
      expect(projectPublicV43StarterChapter(built).stage).toBe('gather')
      const html = renderToStaticMarkup(createElement(PublicV43StarterChapter, { head: built }))
      expect(html).toContain('North-cliff ladder built')
      expect(html).toContain('Finish any chapter objective above')
      expect(html).toContain('active lead in the Greenway journal')
      expect(html).not.toContain('Check the Greenway journal for Wayfinder Glow')
      expect(html).not.toContain('Later: seek the north-cliff ladder')
    }
  })

  it('requires the saved creek crossing and bridgehead claim after eight logs', () => {
    const gathered = withLogs(fresh(), 8)
    expect(projectPublicV43StarterChapter(gathered).stage).toBe('crossing')
    const built = withBridge(fresh())
    expect(projectPublicV43StarterChapter(built).stage).toBe('crossing')
    expect(projectPublicV43StarterChapter(built).objective).toContain('Claim')
    const claimed = { ...built, claimedBridgeheadId: creekBridgeId }
    expect(projectPublicV43StarterChapter(claimed).stage).toBe('spade')
  })

  it('guides spade purchase, equipment, rewarded loam dig, and one soil lift', () => {
    const crossed = { ...withBridge(fresh()), claimedBridgeheadId: creekBridgeId }
    expect(projectPublicV43StarterChapter(crossed).objective).toContain('Buy a field spade')
    const equipped = withSpade(crossed)
    expect(projectPublicV43StarterChapter(equipped)).toMatchObject({
      stage: 'dig', progressLabel: 'Chapter step 4 of 6' })
    const dug = withDig(equipped)
    expect(projectPublicV43StarterChapter(dug)).toMatchObject({
      stage: 'soil-step', progressLabel: 'Chapter step 5 of 6' })
    expect(projectPublicV43StarterChapter(dug).objective).toContain('Terrain Place soil')
    expect(farBankStep).not.toEqual(farBankLoam)
    expect(projectPublicV43StarterChapter(withSoilStep(dug)).stage)
      .toBe('carpenter-order')
  })

  it('completes only after the existing carpenter order claim', () => {
    const step = withSoilStep(withDig(withSpade({ ...withBridge(fresh()),
      claimedBridgeheadId: creekBridgeId })))
    expect(projectPublicV43StarterChapter(step).objective).toContain('4 surplus logs')
    const ordered: PublicV43Progress = { ...step,
      greenwayOrder: { claimedAtSequence: 1 },
      state: { ...step.state, eventSequence: 1 } }
    expect(projectPublicV43StarterChapter(ordered)).toMatchObject({
      stage: 'complete', complete: true,
      progressLabel: 'Chapter complete, 6 of 6 steps' })
  })

  it('reopens route maintenance when the far-bank soil lift is removed', () => {
    const raised = withSoilStep(withDig(withSpade({ ...withBridge(fresh()),
      claimedBridgeheadId: creekBridgeId })))
    const ordered: PublicV43Progress = { ...raised,
      greenwayOrder: { claimedAtSequence: 1 },
      state: { ...raised.state, eventSequence: 1 } }
    expect(projectPublicV43StarterChapter(ordered).complete).toBe(true)
    const removed: PublicV43Progress = { ...ordered, raisedSoilCells: [],
      terrain: { ...ordered.terrain,
        bag: { ...ordered.terrain.bag, soil: 1 } } }
    expect(projectPublicV43StarterChapter(removed)).toMatchObject({
      stage: 'soil-step', complete: false })
    expect(projectPublicV43StarterChapter(withSoilStep(removed)).complete).toBe(true)
  })
})
