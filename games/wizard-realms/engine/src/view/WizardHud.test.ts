import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { advanceWizardWorld, createWizardWorld } from '../domain'
import { toViewProjection } from '../App'
import { PUBLIC_V11_BOOTS_LISTING_ID } from '../domain/publicWorldGait'
import { publicWorldV15StarterSites } from '../domain/publicWorldV15StarterSites'
import { resolvePublicV17GreenwaySite } from '../domain/publicWorldV17GreenwaySites'
import { starterCliffCanonicalFace } from '../domain/starterCliffProfile'
import { resolveTerrainWorkSite } from '../domain/terrainWorks'
import type { WizardViewProjection } from './contracts'
import { publicV25NorthLadderGuidance, WizardHud, WizardWorksFocusBoundary } from './WizardHud'
import { resolvePublicV28RiverBridge } from '../domain/publicWorldV28RiverBridgeSites'
import { displayPublicV28RiverBridge } from '../PublicV28WorldView'

const projectionAtGreenwayRing = (discoveredRingIds: string[]) => {
  const state = createWizardWorld('greenway-alpha')
  state.player.position = { ...state.fairyRings.find((ring) => ring.id === 'ring-greenway')!.position }
  state.player.discoveredRingIds = discoveredRingIds
  const projection = toViewProjection(state, [])
  expect(projection.nearbyInteraction).toMatchObject({ kind: 'fairy-ring', targetId: 'ring-greenway' })
  return projection
}

const renderHud = (projection: ReturnType<typeof projectionAtGreenwayRing>,
  greenwayLogOrder?: ReactNode, starterChapterPrimary = false) =>
  renderToStaticMarkup(createElement(WizardHud, { projection, onIntent: () => {},
    greenwayLogOrder, starterChapterPrimary }))
const renderHudTree = (props: Parameters<typeof WizardHud>[0]): ReactNode => {
  let tree: ReactNode = null
  function CaptureHud() {
    tree = WizardHud(props)
    return null
  }
  renderToStaticMarkup(createElement(CaptureHud))
  return tree
}
type Props = Record<string, unknown>
const findElements = (node: ReactNode, matches: (element: ReactElement<Props>) => boolean): ReactElement<Props>[] => {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, matches))
  if (!isValidElement<Props>(node)) return []
  const nested = findElements(node.props.children as ReactNode, matches)
  return matches(node) ? [node, ...nested] : nested
}

describe('starter cliff HUD capability gate', () => {
  it('puts selected Works readiness and cost before the aim controls', () => {
    const state = createWizardWorld('greenway-alpha')
    const site = resolveTerrainWorkSite(state.seed, 'works1:ladder:-103:108:W')!
    const choice = { site, angleRadians: 0, distanceMeters: 2,
      rejection: null, reason: 'Ready', benefit: 'Climb the north cliff.' }
    const view: WizardViewProjection = { ...toViewProjection(state, []),
      savedTerrainWorks: { context: 'works4-greenway', builtSites: [], dugTileIds: [],
        modeActive: true, selectedKind: 'ladder', actionsEnabled: true,
        preview: { selected: choice, nearby: [choice], guidance: null } } }
    const html = renderHud(view)
    expect(html).toContain('aria-label="Selected Works status"')
    expect(html).toContain('4 logs · Ready')
    expect(html.indexOf('aria-label="Selected Works status"')).toBeLessThan(html.indexOf('aria-label="Move structure aim"'))
    expect(html).toContain('aria-label="Confirm selected saved work"')
    const blocked = renderHud({ ...view, savedTerrainWorks: { ...view.savedTerrainWorks!,
      preview: { selected: { ...choice, rejection: 'too_far' as const,
        reason: 'Move within 3 m' }, nearby: [], guidance: null } } })
    expect(blocked).toContain('4 logs · Move within 3 m')
  })

  it('shows V28 checked connected-river Works controls on keyboard and touch without Fen copy', () => {
    const state = createWizardWorld('greenway-alpha')
    const base = toViewProjection(state, [])
    const site = resolvePublicV28RiverBridge(state.seed, 'works6:river-bridge:-14')!
    const shownSite = displayPublicV28RiverBridge(site)
    const choice = { site: shownSite, angleRadians: 0, distanceMeters: 1,
      rejection: null, reason: 'Ready: checked source bank.', benefit: 'One saved deck.' }
    const view: WizardViewProjection = { ...base, v26ValleyRimSegments: [],
      savedTerrainWorks: { context: 'v28-river', builtSites: [], dugTileIds: [],
        suggestedSites: [shownSite], modeActive: true, selectedKind: 'bridge',
        actionsEnabled: true, preview: { selected: choice, nearby: [choice], guidance: null } },
      map: { ...base.map, guidance: 'Open Works at a marked dry-bank crossing.' } }
    const html = renderHud(view)
    expect(html).toContain('Connected-river bridge')
    expect(html).toContain('1 Bridge · F confirm')
    expect(html).toContain('tap a marked river crossing')
    expect(html).toContain('Not every bank supports a bridge')
    expect(html).toContain('Placement preview only. Confirm the build before crossing or climbing.')
    expect(html).not.toContain('Fen bridge')
    expect(renderHud({ ...view, savedTerrainWorks: { ...view.savedTerrainWorks!,
      modeActive: false } })).not.toContain('Placement preview only.')
    expect(renderHud({ ...view, savedTerrainWorks: { ...view.savedTerrainWorks!,
      builtSites: [shownSite] } })).not.toContain('Placement preview only.')
    const emitted: unknown[] = []
    const button = findElements(renderHudTree({ projection: view,
      onIntent: (intent) => emitted.push(intent) }), (element) => element.type === 'button')
      .find((element) => element.props['aria-label'] === 'Confirm aimed saved work')
    expect(button?.props.disabled).toBe(false)
    ;(button?.props.onClick as (() => void))()
    expect(emitted).toEqual([{ type: 'saved-work.confirm', id: site.id }])
  })

  it('keeps backpack route help aligned with saved ladder and connected-river stages', () => {
    const state = createWizardWorld('greenway-alpha')
    state.player.inventory.push({ itemId: 'logs', quantity: 3 })
    const base = toViewProjection(state, [])
    const ladder = resolveTerrainWorkSite(state.seed, 'works1:ladder:-103:108:W')!
    const bridge = displayPublicV28RiverBridge(resolvePublicV28RiverBridge(state.seed, 'works6:river-bridge:-14')!)
    if (ladder.kind !== 'ladder') throw new Error('Missing ladder fixture')
    const saved = { builtSites: [ladder], dugTileIds: [], preview: null,
      modeActive: false, actionsEnabled: true }
    const handoff: WizardViewProjection = { ...base, v27WalkableSurface: true,
      starterCliff: { face: starterCliffCanonicalFace(state.seed), ladder: null },
      savedTerrainWorks: saved, map: { ...base.map,
        guidance: 'Return east via your saved north ladder to accessible Greenway oaks. Gather 5 more logs for the 8-log connected-river bridge.' } }
    const backpack = (view: WizardViewProjection) => {
      const panel = findElements(renderHudTree({ projection: view, onIntent: () => {} }),
        (element) => element.type === 'aside' && element.props.id === 'wizard-backpack')[0]
      expect(panel).toBeDefined()
      return renderToStaticMarkup(panel)
    }
    const streamed = backpack(handoff)
    expect(streamed).toContain('Return east via your saved north ladder to accessible Greenway oaks')
    expect(streamed).toContain('5 more logs for the 8-log connected-river bridge')
    expect(streamed).not.toContain('Chop a nearby oak twice for 4 logs')
    expect(streamed).not.toContain('build the starter ladder')

    const river = { ...handoff, savedTerrainWorks: { ...saved, context: 'v28-river' as const } }
    const short = backpack(river)
    expect(short).toContain('Connected-river bridge needs 8 logs; 3 in your pack')
    expect(short).toContain('Return to accessible Greenway oaks, then use a marked Ready dry-bank site')
    expect(short).not.toContain('Chop a nearby oak')
    expect(short).not.toContain('build the starter ladder')
    const highland = backpack({ ...river, map: { ...river.map,
      guidance: 'Follow the pale quarry trail east.', guidancePriority: true } })
    expect(highland).toContain('Follow the pale quarry trail east.')
    expect(highland).not.toContain('Connected-river bridge needs 8 logs')

    const builtView = { ...river, savedTerrainWorks: { ...river.savedTerrainWorks,
      builtSites: [ladder, bridge] }, map: { ...river.map,
      guidance: 'Use the saved connected-river deck from its dry source bank to cross.' } }
    const built = backpack(builtView)
    expect(built).toContain(builtView.map.guidance)
    expect(built).not.toContain('Return to accessible Greenway oaks')
    expect(built).not.toContain('needs 8 logs')
    const claimed = backpack({ ...builtView, map: { ...builtView.map,
      guidance: 'Continue toward the Mireglass frontier marker along revealed dry ground.' } })
    expect(claimed).toContain('Mireglass frontier marker')
    expect(claimed).not.toContain('cross')
    const noHint = backpack({ ...builtView, map: { ...builtView.map,
      guidance: undefined } })
    expect(noHint).not.toContain('cross')
    expect(noHint).not.toContain('Mireglass frontier marker')
    expect(backpack({ ...handoff, v27WalkableSurface: undefined }))
      .toContain('Chop a nearby oak twice for 4 logs')
  })

  it('uses V27 starter objective and full-pack advice without changing V26 HUD copy', () => {
    const state = createWizardWorld('greenway-alpha')
    const base = toViewProjection(state, [])
    const v26 = { ...base, v26ValleyRimSegments: [],
      starterCliff: { face: starterCliffCanonicalFace(state.seed), ladder: null },
      savedTerrainWorks: { context: 'works4-greenway' as const, builtSites: [],
        dugTileIds: [], modeActive: false, selectedKind: 'bridge' as const,
        actionsEnabled: true, preview: null },
      map: { ...base.map, guidance: 'Chop trees for logs. A ladder needs 4; a bridge needs 8.' } }
    const v27 = { ...v26, v27WalkableSurface: true }
    expect(renderHud(v27)).toContain('Field objective:</strong> Chop trees for logs.')
    expect(renderHud(v27)).toContain('not every river bank is buildable')
    const full = { ...v27, backpack: { ...base.backpack,
      stacks: [{ ...base.backpack.stacks[0]!, id: 'logs-test', itemId: 'logs', quantity: 8 },
        { id: 'stone-test', itemId: 'stone', name: 'Stone', quantity: 19 }] } }
    expect(renderHud(full)).toContain('Pack full. A Ready ladder costs 4 logs; a Ready bridge costs 8.')
    expect(renderHud(full)).toContain('Excavated terrain-bag materials cannot be sold yet')
    expect(renderHud({ ...full, v26TerrainBag: { soil: 1, stone: 0,
      iron_ore: 0, gold_ore: 0, diamond: 0 } }))
      .toContain('Use Fill on an open pit in reach to refill it with carried soil')
    expect(renderHud({ ...full, v27WalkableSurface: undefined }))
      .not.toContain('Pack full. A Ready ladder costs 4 logs')
  })

  it('advances one checked first-run cue from axe to logs to bridge, then follows saved route guidance', () => {
    const state = createWizardWorld('greenway-alpha')
    const base = toViewProjection(state, [])
    const saved = { context: 'works4-greenway' as const, builtSites: [], dugTileIds: [],
      preview: null, modeActive: false, actionsEnabled: true }
    const fresh: WizardViewProjection = { ...base, v27WalkableSurface: true,
      starterCliff: { face: starterCliffCanonicalFace(state.seed), ladder: null },
      savedTerrainWorks: saved, map: { ...base.map, guidance: 'Original V27 route guidance.' },
      v29Mining: { tools: { basicPickOwned: false, enchantedPickOwned: false, activePick: null },
        offers: [], bids: { soil: 1, stone: 3, iron_ore: 8, gold_ore: 15, diamond: 60 },
        bag: { soil: 0, stone: 0, iron_ore: 0, gold_ore: 0, diamond: 0 },
        excavationLevel: 1, atOutfitters: false } }
    const objective = (view: WizardViewProjection) => renderHud(view)
    const opening = objective(fresh)
    const cue = (view: WizardViewProjection) => objective(view)
      .match(/aria-label="Greenway field objective"[^>]*>(.*?)<\/div>/)?.[1] ?? ''
    expect(cue(fresh)).toContain('Field objective:</strong> Open Backpack and equip your Woodcutter axe.')
    expect(cue(fresh)).toContain('Its logs build the required creek bridge')
    expect(cue(fresh)).toContain('Boots and the carpenter order are optional.')
    expect(cue(fresh)).not.toContain('connected-river bridge')
    expect(opening).not.toContain('Field objective:</strong> Buy a field spade')

    const axe = { ...fresh, equipment: { ...fresh.equipment, mainHand: {
      id: 'axe-test', itemId: 'woodcutters_axe', name: 'Woodcutter axe', quantity: 1 } } }
    expect(cue(axe)).toContain('Chop a Greenway oak twice (E) for your first 4 logs.')
    expect(cue(axe)).toContain('Keep them for the 8-log South creek bridge. 0/8 logs.')
    const logs = (quantity: number): WizardViewProjection => ({ ...axe,
      backpack: { ...axe.backpack, stacks: [{ id: 'logs-test', itemId: 'logs', name: 'Logs', quantity }] } })
    expect(cue(logs(4))).toContain('First 4 logs collected. Keep them; gather 4 more')
    expect(cue(logs(4))).toContain('4/8 logs.')
    expect(cue(logs(8))).toContain('Follow the map south to a discovered gold-stake creek crossing candidate')
    expect(cue(logs(8))).toContain('Open Works (B), choose Bridge (1), aim, then confirm (F)')
    expect(cue(logs(8))).toContain('only when the checked preview says Ready.')
    expect(cue(logs(8))).not.toContain('Ready South creek bridge')
    expect(cue(logs(8))).not.toContain('Chop a Greenway oak')
    const bridgeReadyWithoutAxe = { ...logs(8), equipment: fresh.equipment }
    expect(cue(bridgeReadyWithoutAxe)).toContain('discovered gold-stake creek crossing candidate')
    expect(cue(bridgeReadyWithoutAxe)).not.toContain('equip your Woodcutter axe')
    const nearlyFull: WizardViewProjection = { ...logs(7), backpack: {
      capacity: 20, stacks: [{ id: 'logs-test', itemId: 'logs', name: 'Logs', quantity: 7 },
        { id: 'stone-test', itemId: 'stone', name: 'Stone', quantity: 19 }] } }
    expect(cue(nearlyFull)).toContain('First 4 logs collected. Keep them; gather 1 more')
    expect(cue(nearlyFull)).not.toContain('Make room')
    const blocked: WizardViewProjection = { ...logs(0), backpack: {
      capacity: 20, stacks: [{ id: 'stone-test', itemId: 'stone', name: 'Stone', quantity: 20 }] } }
    expect(cue(blocked)).toContain('An oak yields 4 logs, needing 1 pack space, but only 0 are free.')
    expect(cue(blocked)).toContain('Keep your logs for the required 8-log creek bridge.')
    expect(cue(blocked)).toContain('Check Outfitters for a sale of carried stone or terrain materials')
    expect(cue(blocked)).not.toContain('Chop a Greenway oak')
    expect(objective(blocked)).not.toContain('Pack full. Use carried logs only')
    const full = { ...logs(8), backpack: {
      ...axe.backpack, stacks: [{ id: 'logs-test', itemId: 'logs', name: 'Logs', quantity: 8 },
        { id: 'stone-test', itemId: 'stone', name: 'Stone', quantity: 19 }] } }
    const fullHtml = objective(full)
    expect(fullHtml).toContain('Pack full of logs? Spend 8 at a discovered creek candidate only after Works says Ready.')
    expect(fullHtml).toContain('Greenway Outfitters does not buy logs.')
    expect(renderHud(full, createElement('span', null, 'Carpenter order')))
      .toContain('Greenway Outfitters does not buy logs as ordinary materials.')
    expect(fullHtml).not.toContain('sell terrain-bag soil, stone, or ore to free space')
    const quest = { id: 'surveyor-first-find/v1' as const, title: "The Surveyor's First Find" as const,
      stage: 'gather' as const, objective: 'Old multi-step opening objective.',
      reward: 'One-time checked find.', complete: false }
    const journal = objective({ ...logs(4), v34Quest: quest,
      v41IronHall: { health: 12, wardHealth: 9, phase: 'dormant', phaseUntilTick: 0,
        wardDefeated: false, learnedBolt: false } as NonNullable<WizardViewProjection['v41IronHall']> })
    expect(journal).toContain('Bridge 4/8 ▾')
    expect(journal).toContain('Bridge 4/8 ▾<small>Optional: Glow</small>')
    expect(journal).toContain('First 4 logs collected. Keep them; gather 4 more')
    expect(journal).toContain('Optional: study nearby waystone; cast Glow near fog.')
    expect(journal).toMatch(/aria-label="Open quest journal:[^"]*Optional: study nearby waystone; cast Glow near fog\./)
    expect(journal.indexOf('First 4 logs collected')).toBeLessThan(journal.indexOf('Optional: study nearby waystone'))
    expect(journal).not.toContain('Old multi-step opening objective.')
    const learnedJournal = objective({ ...logs(4), v34Quest: quest,
      learnedSpellIds: ['wayfinder_glow'] })
    expect(learnedJournal).toContain('Optional: cast Glow near fog.')
    expect(learnedJournal).toContain('Bridge 4/8 ▾<small>Optional: Glow</small>')
    expect(learnedJournal).not.toContain('Optional: study nearby waystone')
    expect(objective({ ...logs(8), v34Quest: quest })).not.toContain('Optional: cast Glow near fog.')
    expect(objective({ ...blocked, v34Quest: quest })).not.toContain('Optional: study nearby waystone')
    expect(objective({ ...blocked, v34Quest: quest })).not.toContain('<small>Optional: Glow</small>')
    expect(objective({ ...bridgeReadyWithoutAxe, v34Quest: quest })).toContain('Build bridge ▾')
    expect(objective({ ...blocked, v34Quest: quest })).toContain('Make room ▾')
    expect(objective({ ...full, v34Quest: quest })).toContain('Greenway Outfitters does not buy logs.')

    const readyCreek = resolvePublicV17GreenwaySite(state.seed, 'works4:bridge:greenway-creek:-14')!
    if (readyCreek?.kind !== 'bridge') throw new Error('Missing creek fixture')
    const readyChoice = { site: { ...readyCreek, obstacle: 'fen_channel' as const }, angleRadians: 0, distanceMeters: 2,
      rejection: null, reason: 'Ready', benefit: 'Cross the creek.' }
    const discovered = { ...logs(8), savedTerrainWorks: { ...saved,
      suggestedSites: [readyChoice.site] } }
    const candidate = cue(discovered)
    expect(candidate).toContain('Discovered South creek bridge site')
    expect(candidate).toContain('Go to its dry bank, open Works (B)')
    expect(candidate).toContain('confirm only when the checked preview says Ready')
    expect(candidate).toContain('Keep all 8 logs for this required crossing.')
    expect(candidate).not.toContain('Ready South creek bridge')
    expect(renderHud(discovered)).not.toContain('aria-label="Confirm selected saved work"')
    const connectedRiver = displayPublicV28RiverBridge(resolvePublicV28RiverBridge(
      state.seed, 'works6:river-bridge:-14')!)
    const nearRiver = { ...discovered, player: { ...discovered.player,
      position: [connectedRiver.from.x, connectedRiver.from.y, connectedRiver.from.z] as const } }
    const mixed = cue({ ...nearRiver, savedTerrainWorks: { ...saved,
      suggestedSites: [connectedRiver, readyChoice.site] } })
    expect(Math.hypot(connectedRiver.from.x - readyChoice.site.from.x,
      connectedRiver.from.z - readyChoice.site.from.z)).toBeGreaterThan(0)
    expect(mixed).toContain(`x ${Number(readyChoice.site.from.x.toFixed(1))}, z ${Number(readyChoice.site.from.z.toFixed(1))}`)
    expect(mixed).not.toContain(`x ${Number(connectedRiver.from.x.toFixed(1))}, z ${Number(connectedRiver.from.z.toFixed(1))}`)
    expect(cue({ ...nearRiver, savedTerrainWorks: { ...saved,
      suggestedSites: [connectedRiver] } })).toContain('Follow the map south')
    const offModePreview = cue({ ...discovered, savedTerrainWorks: {
      ...discovered.savedTerrainWorks,
      preview: { selected: readyChoice, nearby: [readyChoice], guidance: null } } })
    expect(offModePreview).toContain('Discovered South creek bridge site')
    expect(offModePreview).not.toContain('Ready South creek bridge')
    expect(cue({ ...logs(8), savedTerrainWorks: { ...saved, actionsEnabled: false,
      preview: { selected: readyChoice, nearby: [readyChoice], guidance: null } } }))
      .not.toContain('Ready South creek bridge')

    const ladder = resolveTerrainWorkSite(state.seed, 'works1:ladder:-103:108:W')!
    const bridge = publicWorldV15StarterSites(state.seed)[0]
    if (ladder.kind !== 'ladder' || bridge.kind !== 'bridge') throw new Error('Missing route fixtures')
    const displayedBridge = { ...bridge, obstacle: 'fen_channel' as const }
    const ladderGuidance = 'Ladder built: carry 8 logs west for the connected-river bridge.'
    const ladderStage = objective({ ...fresh, savedTerrainWorks: { ...saved, builtSites: [ladder] },
      map: { ...fresh.map, guidance: ladderGuidance } })
    expect(ladderStage).toContain(`Field objective:</strong> ${ladderGuidance}`)
    expect(ladderStage).not.toContain('Choose a 4-log north ladder')
    const bridgeGuidance = 'South creek bridge built: use its saved deck.'
    const bridgeStage = objective({ ...fresh, savedTerrainWorks: { ...saved, builtSites: [displayedBridge] },
      map: { ...fresh.map, guidance: bridgeGuidance } })
    expect(bridgeStage).toContain(`Field objective:</strong> ${bridgeGuidance}`)
    // Desktop top 192px + capped 85px leaves 8px before the Works panel at 285px.
    expect(bridgeStage).toContain('.wr-greenway-objective:not(.wr-v34-quest):not(.wr-v35-quest){max-height:85px;overflow-y:auto;overscroll-behavior:contain;pointer-events:auto}')
    expect(bridgeStage).toContain('Next route: keep 0/4 logs for the north cliff ladder; chop 4 more.')
    expect(bridgeStage).toContain('reserve 8 logs for the connected-river bridge')
    expect(bridgeStage).toContain('Boots and the carpenter order are optional.')
    expect(bridgeStage).not.toContain('Open Backpack and equip your Woodcutter axe.')
    expect(bridgeStage).not.toContain('Pack full of logs?')
    const ladderLogs = objective({ ...logs(4), savedTerrainWorks: { ...saved,
      builtSites: [displayedBridge] }, map: { ...fresh.map, guidance: bridgeGuidance } })
    expect(ladderLogs).toContain('Next route: keep 4 logs for a marked north cliff ladder.')
    const readyLadder = resolvePublicV17GreenwaySite(state.seed, 'works4:ladder:greenway-north-cliff:11')!
    if (readyLadder?.kind !== 'ladder') throw new Error('Missing ladder fixture')
    const readyLadderChoice = { site: { ...readyLadder, obstacle: 'slate_cliff' as const }, angleRadians: 0, distanceMeters: 2,
      rejection: null, reason: 'Ready', benefit: 'Climb north cliff.' }
    expect(objective({ ...logs(4), savedTerrainWorks: { ...saved,
      builtSites: [displayedBridge], preview: { selected: readyLadderChoice,
        nearby: [readyLadderChoice], guidance: null } } })).toContain('Ready north cliff ladder')
    expect(objective({ ...logs(4), v34Quest: quest, savedTerrainWorks: { ...saved,
      builtSites: [displayedBridge] } })).toContain('Next route: keep 4 logs for a marked north cliff ladder.')
    expect(objective({ ...logs(4), v34Quest: { ...quest, stage: 'cross' },
      savedTerrainWorks: { ...saved, builtSites: [displayedBridge] } }))
      .toContain('Quest ▾')
    expect(objective({ ...logs(4), v34Quest: { ...quest, stage: 'complete', complete: true },
      savedTerrainWorks: { ...saved, builtSites: [displayedBridge] } }))
      .toContain('Next route: keep 4 logs for a marked north cliff ladder.')
    expect(objective({ ...logs(4), controllerActionsEnabled: false,
      savedTerrainWorks: { ...saved, builtSites: [displayedBridge] } }))
      .not.toContain('Next route: keep 4 logs for a marked north cliff ladder.')

    const historical = objective({ ...fresh, v29Mining: undefined,
      map: { ...fresh.map, guidance: 'V27 route guidance.' } })
    expect(historical).toContain('Field objective:</strong> V27 route guidance.')
    expect(historical).not.toContain('Optional digging:')
    expect(historical).not.toContain('Choose a 4-log north ladder')
  })

  it('offers the V30 River Works claim only for a checked Ready post', () => {
    const base = toViewProjection(createWizardWorld('greenway-alpha'), [])
    const post = { bridgeId: 'works4:bridge:greenway-creek:0',
      position: [0, 1, 16] as const, tileId: 'tile-3-7', claimed: false,
      claimReady: true, reward: 'basic-pick' as const }
    const ready: WizardViewProjection = { ...base, controllerActionsEnabled: true,
      v30Bridgehead: post }
    const button = findElements(renderHudTree({ projection: ready,
      onIntent: () => {} }), (element) => element.type === 'button')
      .find((element) => element.props['aria-label'] === 'Claim River Works bridgehead reward')
    expect(button).toBeDefined()
    expect(renderHud(ready)).toContain('Basic mining pick, not auto-equipped.')
    expect(renderHud(ready)).toContain('A field spade still digs soil.')
    const emitted: unknown[] = []
    const actionable = findElements(renderHudTree({ projection: ready,
      onIntent: (intent) => emitted.push(intent) }), (element) => element.type === 'button')
      .find((element) => element.props['aria-label'] === 'Claim River Works bridgehead reward')
    ;(actionable?.props.onClick as (() => void))()
    expect(emitted).toEqual([{ type: 'v30.bridgehead.claim', bridgeId: post.bridgeId }])
    expect(renderHud({ ...ready, v30Bridgehead: { ...post, reward: 'coins' } }))
      .toContain('35 coins.')
    for (const unavailable of [{ ...ready, v30Bridgehead: { ...post,
      claimed: true, claimReady: false, reward: null } },
    { ...ready, v30Bridgehead: { ...post, claimReady: false } },
    { ...ready, controllerActionsEnabled: false },
    base]) {
      expect(renderHud(unavailable)).not.toContain('Claim River Works bridgehead reward')
    }
  })

  it('shows a checked V30 bridgehead claim in streamed wilderness without enabling legacy actions', () => {
    const base = toViewProjection(createWizardWorld('greenway-alpha'), [])
    const view: WizardViewProjection = { ...base, unavailableActions: true,
      controllerActionsEnabled: true,
      v30Bridgehead: { bridgeId: 'works6:river-bridge:-43', position: [-172, 1, 16],
        tileId: 'tile-3-7', claimed: false, claimReady: true, reward: 'basic-pick' },
      nearbyInteraction: { kind: 'resource', targetId: 'old-oak', label: 'Old oak',
        action: 'Chop', actionable: true } }
    const html = renderHud(view)
    expect(html).toContain('Claim River Works bridgehead reward')
    expect(html).not.toContain('<b>Chop</b>Old oak')
    const equip = findElements(renderHudTree({ projection: view,
      onIntent: () => {} }), (element) => element.type === 'button')
      .find((element) => element.props['aria-label'] === 'Equip Woodcutter axe')
    expect(equip?.props.disabled).toBe(true)
    expect(renderHud({ ...view, v30Bridgehead: undefined }))
      .toContain('Interaction unavailable here')
    expect(renderHud({ ...view, v30Bridgehead: { ...view.v30Bridgehead!, claimed: true,
      claimReady: false, reward: null } })).not.toContain('Claim River Works bridgehead reward')
    expect(renderHud({ ...view, v30Bridgehead: { ...view.v30Bridgehead!, claimReady: false } }))
      .not.toContain('Claim River Works bridgehead reward')
    expect(renderHud({ ...view, v30Bridgehead: { ...view.v30Bridgehead!, reward: null } }))
      .not.toContain('Claim River Works bridgehead reward')
    expect(renderHud({ ...view, controllerActionsEnabled: false }))
      .not.toContain('Claim River Works bridgehead reward')
  })

  it('keeps V26 Works on Bridge/Ladder and directs spade digging to terrain controls', () => {
    const state = createWizardWorld('greenway-alpha')
    const base = toViewProjection(state, [])
    const dig = publicWorldV15StarterSites(state.seed)[1]
    if (dig.kind !== 'dig') throw new Error('Missing dig fixture')
    const selected = { site: dig, angleRadians: 0, distanceMeters: 2,
      rejection: null, reason: 'Ready', benefit: 'Legacy bank dig' }
    const view = { ...base, v26ValleyRimSegments: [],
      starterCliff: { face: starterCliffCanonicalFace(state.seed), ladder: null },
      savedTerrainWorks: { context: 'works4-greenway' as const, builtSites: [], dugTileIds: [],
        modeActive: true, selectedKind: 'dig' as const, actionsEnabled: true,
        preview: { selected, nearby: [selected], guidance: 'B, 3, F legacy dig' } } }
    const html = renderHud(view)
    expect(html).toContain('Dig/Fill: equip spade, use Terrain tools, tap ground')
    expect(html).toContain('Choose Bridge or Ladder in Works')
    expect(html).not.toContain('aria-label="Choose dig"')
    expect(html).not.toContain('aria-label="Confirm selected saved work"')
    expect(html).not.toContain('B, 3, F legacy dig')
    expect(html).not.toContain('3 Dig · F confirm')
  })

  it('shows the exact unsupported Greenway ladder aim in the visible Works status', () => {
    const state = createWizardWorld('greenway-alpha')
    const base = toViewProjection(state, [])
    const guidance = 'No supported ladder position at x 2.9. Shift the aim along the obstacle.'
    const view: WizardViewProjection = { ...base, v26ValleyRimSegments: [],
      starterCliff: { face: starterCliffCanonicalFace(state.seed), ladder: null },
      savedTerrainWorks: { context: 'works4-greenway', builtSites: [], dugTileIds: [],
        modeActive: true, selectedKind: 'ladder', aimX: 2.9, actionsEnabled: true,
        preview: { selected: null, nearby: [], guidance } } }
    const statuses = (projection: WizardViewProjection) =>
      [...renderHud(projection).matchAll(/<p class="wr-work-selection" role="status" aria-label="Selected Works status">([^<]*)<\/p>/g)]
        .map(([, message]) => message)
    expect(statuses(view)).toContain(guidance)
    expect(statuses(view).some((message) => message.includes('Choose Bridge or Ladder in Works'))).toBe(false)
    expect(renderHud(view)).not.toContain('aria-label="Confirm selected saved work"')
    expect(statuses({ ...view, savedTerrainWorks: { ...view.savedTerrainWorks!,
      preview: { selected: null, nearby: [], guidance: null } } }))
      .toEqual([expect.stringContaining('No site selected. Aim at a discovered site to check Ready.')])
  })

  it('prioritizes the V25 north ladder after the bridge using actual remaining logs', () => {
    const state = createWizardWorld('greenway-alpha')
    const [bridge] = publicWorldV15StarterSites(state.seed)
    const ladder = resolveTerrainWorkSite(state.seed, 'works1:ladder:-103:108:W')!
    if (bridge.kind !== 'bridge' || ladder.kind !== 'ladder') throw new Error('Missing route fixtures')
    const displayedBridge = { ...bridge, obstacle: 'fen_channel' as const }
    const saved = { context: 'works4-greenway' as const, builtSites: [displayedBridge],
      dugTileIds: [], modeActive: false, selectedKind: 'bridge' as const,
      actionsEnabled: true, preview: null }
    const view = () => { const base = toViewProjection(state, [])
      return { ...base, v25RiverActive: true as const,
        starterCliff: { face: starterCliffCanonicalFace(state.seed), ladder: null },
        savedTerrainWorks: saved, map: { ...base.map, guidance: 'Old far-bank dig objective.' } } }
    state.player.inventory.push({ itemId: 'logs', quantity: 2 })
    const short = view(), guidance = publicV25NorthLadderGuidance(short)!
    expect(guidance).toContain('costs 4 logs; 2 in your bag, 2 more needed')
    expect(renderHud(short)).toContain(`Field objective:</strong> ${guidance}`)
    expect(renderHud(short)).toContain('Far-bank Dig remains optional in Works')
    expect(publicV25NorthLadderGuidance({ ...short, v25RiverActive: undefined })).toBeNull()
    expect(renderHud({ ...short, v25RiverActive: undefined }))
      .toContain('Dry far-bank Dig for stone: buy and equip a field spade')
    state.player.inventory.push({ itemId: 'logs', quantity: 2 })
    expect(publicV25NorthLadderGuidance(view())).toContain('4 in your bag, enough to build')
    expect(publicV25NorthLadderGuidance({ ...view(), savedTerrainWorks: {
      ...saved, builtSites: [displayedBridge, ladder] } })).toBeNull()
  })

  it('gives a checked Greenway waystone lesson before study and a frontier casting hint after learning', () => {
    const state = createWizardWorld('greenway-alpha')
    const base = toViewProjection(state, [])
    const inscription = base.inscriptions.find((entry) => entry.id === 'greenway_waystone')!
    const view: WizardViewProjection = { ...base,
      starterCliff: { face: starterCliffCanonicalFace(state.seed), ladder: null },
      inscriptions: [inscription],
      savedTerrainWorks: { context: 'works4-greenway', builtSites: [], dugTileIds: [],
        modeActive: false, actionsEnabled: true, preview: null } }
    const distant = renderHud(view)
    expect(distant).toContain('aria-label="Wayfinder Glow lesson"')
    expect(distant).toContain('Explore Greenway for W on Map / routes. Get close and Study the waystone.')
    expect(distant).not.toContain('Unexplored ground nearby: Cast Wayfinder Glow')

    const nearby = renderHud({ ...view, player: { ...view.player,
      position: inscription.position } })
    expect(nearby).toContain('Waystone in reach: Study Greenway waystone to learn Wayfinder Glow.')
    expect(nearby).toContain('aria-label="Study Greenway waystone"')

    const learned = { ...view, inscriptions: [{ ...inscription, studied: true }],
      learnedSpellIds: ['wayfinder_glow' as const] }
    const frontier = renderHud(learned)
    expect(frontier).toContain('Unexplored ground nearby: Cast Wayfinder Glow to reveal it. Barriers still need a route.')
    expect(frontier).not.toContain('Explore Greenway for W')
    expect(frontier).not.toContain('Waystone in reach:')
    const afterLocalReveal = renderHud({ ...learned, map: { ...learned.map,
      tiles: [...learned.map.tiles.map((tile) => ({ ...tile, discovered: true })),
        { ...learned.map.tiles[0]!, id: 'tile-100-100', gridX: 100, gridZ: 100,
          discovered: false }] } })
    expect(afterLocalReveal).not.toContain('aria-label="Wayfinder Glow lesson"')
    expect(afterLocalReveal).toContain('aria-label="Cast Wayfinder Glow"')
    expect(renderHud({ ...learned, controllerActionsEnabled: false }))
      .not.toContain('aria-label="Wayfinder Glow lesson"')
    expect(renderHud({ ...view, unavailableActions: true }))
      .not.toContain('aria-label="Wayfinder Glow lesson"')
    expect(renderHud({ ...view, inscriptions: [] }))
      .not.toContain('aria-label="Wayfinder Glow lesson"')
  })

  it('offers v16 waystone study and learned Glow on desktop and touch only while enabled', () => {
    const state = createWizardWorld('greenway-alpha')
    const base = toViewProjection(state, [])
    const inscription = base.inscriptions.find((entry) => entry.id === 'greenway_waystone')!
    const view = { ...base,
      player: { ...base.player, position: inscription.position },
      starterCliff: { face: starterCliffCanonicalFace(state.seed), ladder: null },
      inscriptions: [inscription],
      savedTerrainWorks: { context: 'works3-greenway' as const,
        builtSites: [], dugTileIds: [], modeActive: false,
        selectedKind: 'bridge' as const, actionsEnabled: true, preview: null } }
    const emitted: unknown[] = []
    const buttons = (projection: WizardViewProjection) => findElements(renderHudTree({ projection,
      onIntent: (intent) => emitted.push(intent) }), (element) => element.type === 'button')
    const study = buttons(view).filter((button) =>
      button.props['aria-label'] === 'Study Greenway waystone')
    expect(study).toHaveLength(2)
    study.forEach((button) => (button.props.onClick as () => void)())
    expect(emitted).toEqual([
      { type: 'inscription.study', inscriptionId: 'greenway_waystone' },
      { type: 'inscription.study', inscriptionId: 'greenway_waystone' },
    ])
    expect(buttons(view).filter((button) => button.props['aria-label'] === 'Cast Wayfinder Glow')
      .every((button) => button.props.disabled === true)).toBe(true)

    const learned = { ...view, inscriptions: [{ ...inscription, studied: true }],
      learnedSpellIds: ['wayfinder_glow' as const] }
    const cast = buttons(learned).filter((button) =>
      button.props['aria-label'] === 'Cast Wayfinder Glow')
    expect(cast).toHaveLength(2)
    expect(cast.every((button) => button.props.disabled === false)).toBe(true)
    cast.forEach((button) => (button.props.onClick as () => void)())
    expect(emitted.slice(-2)).toEqual([
      { type: 'spell.cast', spellId: 'wayfinder_glow' },
      { type: 'spell.cast', spellId: 'wayfinder_glow' },
    ])
    expect(buttons({ ...learned, controllerActionsEnabled: false }).filter((button) =>
      button.props['aria-label'] === 'Cast Wayfinder Glow').every((button) =>
        button.props.disabled === true)).toBe(true)
    for (const disabled of [{ ...view, savedTerrainWorks: { ...view.savedTerrainWorks,
      actionsEnabled: false } }, { ...view, savedTerrainWorks: { ...view.savedTerrainWorks,
      context: 'starter-greenway' as const } }, { ...view, unavailableActions: true as const }]) {
      const labels = buttons(disabled).map((button) => button.props['aria-label'])
      expect(labels).not.toContain('Study Greenway waystone')
      expect(labels).not.toContain('Cast Wayfinder Glow')
    }
  })

  it('exposes all three v16 Greenway Works choices while preserving the v15 two-choice gate', () => {
    const state = createWizardWorld('greenway-alpha')
    const base = { ...toViewProjection(state, []),
      starterCliff: { face: starterCliffCanonicalFace(state.seed), ladder: null } }
    const saved = { builtSites: [], dugTileIds: [], preview: null, actionsEnabled: true,
      modeActive: true, selectedKind: 'bridge' as const }
    const emitted: unknown[] = []
    const v16 = { ...base, savedTerrainWorks: { ...saved, context: 'works3-greenway' as const } }
    const buttons = findElements(renderHudTree({ projection: v16,
      onIntent: (intent) => emitted.push(intent) }),
    (element) => element.type === 'button')
    const ladder = buttons.find((button) => button.props['aria-label'] === 'Choose ladder')
    expect(ladder).toBeDefined()
    ;(ladder!.props.onClick as () => void)()
    expect(emitted).toEqual([{ type: 'saved-work.kind', kind: 'ladder' }])
    const html = renderHud(v16)
    expect(html).toContain('1 Bridge · 2 Ladder · 3 Dig')
    expect(html).toContain('Bridge: south creek deck to the far bank, 8 logs; B, 1, aim at a discovered dry crossing, F.')
    expect(html).toContain('Ladder: north cliff rungs to the upper ledge, 4 logs; B, 2, aim at a discovered clear face, F.')
    expect(html).toContain('Dig: revealed dry far-bank loam; equip a field spade, free one bag slot, stand beside the patch within 4 m, not on it; then B, 3, F.')
    expect(html).toContain('Earn one stone and 30 Excavation XP; sell the stone at Greenway Outfitters.')
    expect(html).not.toContain('a separate starter route, not a Works kind')
    const ladderSite = resolveTerrainWorkSite(state.seed, 'works1:ladder:-103:108:W')!
    const ladderChoice = { site: ladderSite, distanceMeters: 2, angleRadians: 0,
      rejection: null, reason: 'Ready', benefit: 'Climb the cliff.' }
    const aimed = renderHud({ ...v16, savedTerrainWorks: { ...v16.savedTerrainWorks,
      preview: { selected: ladderChoice, nearby: [ladderChoice], guidance: null } } })
    expect(aimed).toContain('North cliff ladder')
    expect(aimed).not.toContain('Slate ladder')
    const v15 = renderHud({ ...base,
      savedTerrainWorks: { ...saved, context: 'starter-greenway' as const } })
    expect(v15).not.toContain('aria-label="Choose ladder"')
    expect(v15).toContain('1 Bridge · 3 Dig')
  })

  it('keeps precise v16 ladder coordinates readable and gives actionable occupancy guidance', () => {
    const state = createWizardWorld('greenway-alpha')
    const site = resolveTerrainWorkSite(state.seed, 'works1:ladder:-103:108:W')
    if (site?.kind !== 'ladder') throw new Error('Missing ladder fixture')
    const ladder = { ...site, from: { ...site.from, x: -5.130633475526702, z: -4 } }
    const choice = { site: ladder, distanceMeters: 2, angleRadians: 0,
      rejection: 'occupied' as const, reason: 'Move clear of the footprint and other works.',
      benefit: 'Climb the north cliff.' }
    const base = toViewProjection(state, [])
    const view = { ...base, starterCliff: {
      face: starterCliffCanonicalFace(state.seed), ladder: null },
    savedTerrainWorks: { context: 'works3-greenway' as const, builtSites: [], dugTileIds: [],
      modeActive: true, selectedKind: 'ladder' as const, actionsEnabled: true,
      preview: { selected: choice, nearby: [choice], guidance: null } } }
    const html = renderHud(view)
    expect(html).toContain('x -5.1, z -4')
    expect(html).not.toContain('-5.130633475526702')
    expect(html).toContain('Step beside the ghost route, staying within 3 m')
    expect(html).not.toContain('Move clear of the footprint and other works.')
  })

  it('points v17 players at the committed off-center Works ladder and out of its ghost', () => {
    const state = createWizardWorld('greenway-alpha')
    const site = resolveTerrainWorkSite(state.seed, 'works1:ladder:-103:108:W')
    if (site?.kind !== 'ladder') throw new Error('Missing ladder fixture')
    const ladder = { ...site,
      from: { ...site.from, x: -5.1, z: -4 }, to: { ...site.to, x: -5.1, z: -8 },
      supportPath: [{ x: -5.1, y: 1, z: -4 }, { x: -5.1, y: 1, z: -5.35 },
        { x: -5.1, y: 2.56, z: -6 }, { x: -5.1, y: 2.56, z: -8 }],
      widthMeters: 1.05 }
    const choice = { site: ladder, distanceMeters: 1.6, angleRadians: 0,
      rejection: 'occupied' as const, reason: 'Move clear of the footprint and other works.',
      benefit: 'Climb the north cliff.' }
    const base = toViewProjection(state, [])
    const view = { ...base,
      player: { ...base.player, position: [-5.1, 1, -5.6] as const },
      starterCliff: { face: starterCliffCanonicalFace(state.seed), ladder: null },
      savedTerrainWorks: { context: 'works4-greenway' as const, builtSites: [ladder],
        dugTileIds: [], modeActive: true, selectedKind: 'ladder' as const,
        actionsEnabled: true, preview: { selected: choice, nearby: [choice], guidance: null } } }
    const built = renderHud({ ...view, savedTerrainWorks: { ...view.savedTerrainWorks,
      preview: null } })
    expect(built).toContain('Built Works north cliff ladder, separate from the authored x 0 route')
    expect(built).toContain('lower foot x -5.1, z -4; upper foot x -5.1, z -8')
    expect(built).toContain('Rails center on x -5.1 from z -5.35 to -6 (width 1.05 m)')
    expect(built).toContain('face north and walk with W to climb; S descends')
    expect(built).not.toContain('aria-label="Greenway field objective"')
    expect(renderHud({ ...view, savedTerrainWorks: { ...view.savedTerrainWorks,
      modeActive: false, preview: null } }))
      .toContain('back south past z -5.2, align x -5.1, then face north and press W')
    const ghost = { ...view, savedTerrainWorks: { ...view.savedTerrainWorks,
      builtSites: [] } }
    const html = renderHud(ghost)
    expect(html).toContain('You are standing in this ladder ghost. Step south to the lower foot x -5.1, z -4')
    expect(html).not.toContain('Move clear of the footprint and other works.')
    const outside = renderHud({ ...ghost, player: { ...ghost.player,
      position: [-5.1, 1, -4] as const } })
    expect(outside).not.toContain('You are standing in this ladder ghost.')
    expect(outside).toContain('Step beside the ghost route, staying within 3 m')
  })

  it('aims the nearest discovered site of the selected kind without clearing a Ready ladder', () => {
    const state = createWizardWorld('greenway-alpha')
    const base = toViewProjection(state, [])
    const ladder = resolveTerrainWorkSite(state.seed, 'works1:ladder:-103:108:W')!
    const bridge = publicWorldV15StarterSites(state.seed)[0]
    if (ladder.kind !== 'ladder' || bridge.kind !== 'bridge') throw new Error('Missing work fixtures')
    const suggestedBridge = { ...bridge, obstacle: 'fen_channel' as const }
    const nearLadder = { ...ladder, from: { ...ladder.from, x: 1.1 } }
    const farLadder = { ...ladder, id: `${ladder.id}:far`, from: { ...ladder.from, x: -4 } }
    const choice = { site: nearLadder, distanceMeters: 2, angleRadians: 0,
      rejection: null, reason: 'Ready', benefit: 'Climb the north cliff.' }
    const view = { ...base,
      player: { ...base.player, position: [0, 1, 2] as const },
      starterCliff: { face: starterCliffCanonicalFace(state.seed), ladder: null },
      savedTerrainWorks: { context: 'works4-greenway' as const, builtSites: [],
        dugTileIds: [], modeActive: true, selectedKind: 'ladder' as const,
        aimX: 1.1, actionsEnabled: true, suggestedSites: [suggestedBridge, farLadder, nearLadder],
        preview: { selected: choice, nearby: [choice], guidance: null } } }
    const emitted: unknown[] = []
    const buttons = findElements(renderHudTree({ projection: view,
      onIntent: (intent) => emitted.push(intent) }), (element) => element.type === 'button')
    const nearest = buttons.find((button) => button.props['aria-label'] === 'Nearest discovered site')
    expect(nearest?.props.disabled).toBe(false)
    ;(nearest!.props.onClick as () => void)()
    expect(emitted).toEqual([{ type: 'saved-work.aim', aimX: 1.1 }])
    expect(renderHud(view)).toContain('aria-label="Confirm selected saved work"')
    expect(renderHud(view)).toContain('Place along north cliff · x 1.1 m')
    const otherKind = { ...view, savedTerrainWorks: { ...view.savedTerrainWorks,
      suggestedSites: [suggestedBridge] } }
    const otherKindButton = findElements(renderHudTree({ projection: otherKind, onIntent: () => {} }),
      (element) => element.type === 'button'
        && element.props['aria-label'] === 'Nearest discovered site')[0]
    expect(otherKindButton.props.disabled).toBe(true)
    expect(renderHud(otherKind)).toContain('No discovered ladder site to aim at')
  })

  it('guides an eight-log V29 bridge search without bypassing discovery or changing other Works states', () => {
    const state = createWizardWorld('greenway-alpha')
    state.player.inventory.push({ itemId: 'logs', quantity: 8 })
    const base = toViewProjection(state, [])
    const view = { ...base,
      player: { ...base.player, position: [0, 1, 2] as const, yaw: 0 },
      starterCliff: { face: starterCliffCanonicalFace(state.seed), ladder: null },
      v29Mining: { tools: { basicPickOwned: false, enchantedPickOwned: false, activePick: null },
        offers: [], bids: { soil: 1, stone: 3, iron_ore: 8, gold_ore: 15, diamond: 60 },
        bag: { soil: 0, stone: 0, iron_ore: 0, gold_ore: 0, diamond: 0 },
        excavationLevel: 1, atOutfitters: false },
      savedTerrainWorks: { context: 'works4-greenway' as const, builtSites: [],
        dugTileIds: [], modeActive: true, selectedKind: 'bridge' as const,
        aimX: null, actionsEnabled: true, preview: null } }
    const emitted: unknown[] = []
    const buttons = findElements(renderHudTree({ projection: view,
      onIntent: (intent) => emitted.push(intent) }),
    (element) => element.type === 'button')
    const nearest = buttons.find((button) => button.props['aria-label'] === 'Nearest discovered site')
    expect(nearest?.props.disabled).toBe(true)
    const markup = renderHud(view)
    const cue = [...markup.matchAll(/<small role="note">([^<]*)<\/small>/g)]
      .map(([, copy]) => copy).find((copy) => copy.includes('South creek'))
    for (const phrase of ['south', 'dry ground', 'both banks', 'marked crossing',
      'Nearest', 'north cliff ladder', 'west']) expect(cue?.toLowerCase()).toContain(phrase.toLowerCase())
    expect(cue).not.toMatch(/slider|aim manually/i)
    const slider = findElements(renderHudTree({ projection: view,
      onIntent: (intent) => emitted.push(intent) }), (element) => element.type === 'input'
      && element.props['aria-label'] === 'Structure position along obstacle')[0]
    ;(slider.props.onChange as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value: '2.4' } })
    expect(emitted).toEqual([{ type: 'saved-work.aim', aimX: 2.4 }])
    const facing = buttons.find((button) => button.props['aria-label'] === 'Use avatar facing')
    expect(facing).toBeDefined()
    ;(facing!.props.onClick as () => void)()
    expect(emitted[1]).toEqual({ type: 'saved-work.aim', aimX: null })
    expect(markup).toContain('avatar facing; slider is not applied')
    expect(markup).not.toContain('x not aimed m')
    expect(markup).not.toContain('works4:bridge:')
    expect(renderHud({ ...view, savedTerrainWorks: { ...view.savedTerrainWorks,
      aimX: 0 } })).toContain('Place along south creek · x 0 m')
    const bridge = resolvePublicV17GreenwaySite('wizard-realms', 'works4:bridge:greenway-creek:0')
    if (bridge?.kind !== 'bridge') throw new Error('Missing Works4 bridge fixture')
    const shownBridge = { ...bridge, obstacle: 'fen_channel' as const }
    const choice = { site: shownBridge, angleRadians: 0, distanceMeters: 2,
      rejection: null, reason: 'Ready', benefit: 'Cross South creek.' }
    const discovered = { ...view, savedTerrainWorks: { ...view.savedTerrainWorks,
      suggestedSites: [shownBridge], preview: { selected: choice, nearby: [choice], guidance: null } } }
    const discoveredButtons = findElements(renderHudTree({ projection: discovered, onIntent: () => {} }),
      (element) => element.type === 'button')
    expect(discoveredButtons.find((button) => button.props['aria-label'] === 'Nearest discovered site')
      ?.props.disabled).toBe(false)
    expect(renderHud(discovered)).toContain('Confirm Creek bridge')
    expect(renderHud(discovered)).not.toContain(cue)
    expect(renderHud({ ...view, savedTerrainWorks: { ...view.savedTerrainWorks,
      selectedKind: 'ladder' as const } })).toContain('No discovered ladder site to aim at. Explore to reveal one, or use the slider to aim manually.')
    expect(renderHud({ ...view, v29Mining: undefined }))
      .toContain('No discovered bridge site to aim at. Explore to reveal one, or use the slider to aim manually.')
    expect(renderHud({ ...view, savedTerrainWorks: { ...view.savedTerrainWorks,
      context: 'v28-river' as const } })).not.toContain(cue)
  })

  it('keeps v17 Works compact while off and restores its checked controls on open', () => {
    const state = createWizardWorld('greenway-alpha')
    state.player.inventory.push({ itemId: 'logs', quantity: 8 })
    const base = toViewProjection(state, [])
    const ladder = resolveTerrainWorkSite(state.seed, 'works1:ladder:-103:108:W')!
    if (ladder.kind !== 'ladder') throw new Error('Missing ladder fixture')
    const saved = { context: 'works4-greenway' as const, builtSites: [ladder],
      dugTileIds: [], modeActive: false, selectedKind: 'ladder' as const,
      actionsEnabled: true, preview: null }
    const view = { ...base, recentEvents: ['Checked action queued'],
      starterCliff: { face: starterCliffCanonicalFace(state.seed), ladder: null },
      savedTerrainWorks: saved }
    const emitted: unknown[] = []
    const offTree = renderHudTree({ projection: view, onIntent: (intent) => emitted.push(intent) })
    const panel = findElements(offTree, (element) => element.type === 'aside'
      && element.props['aria-label'] === 'Saved terrain works')[0]
    expect(panel.props.style).toMatchObject({ width: 'auto', maxHeight: 'none', padding: 5 })
    const off = renderHud(view)
    expect(off).toContain('aria-label="Greenway field objective"')
    expect(off).toContain('aria-label="Open Works mode"')
    expect(off).toContain('Works Off · B')
    expect(off).toContain('Greenway logs</b><small>×8')
    expect(off).toContain('Checked action queued')
    expect(off).not.toContain('Built Works north cliff ladder')
    expect(off).not.toContain('Works details')
    expect(off).not.toContain('Move structure aim')
    const open = findElements(offTree, (element) => element.type === 'button'
      && element.props['aria-label'] === 'Open Works mode')[0]
    expect(open.props['aria-expanded']).toBe(false)
    ;(open.props.onClick as () => void)()
    expect(emitted).toEqual([{ type: 'saved-work.mode', active: true }])

    const choice = { site: ladder, distanceMeters: 2, angleRadians: 0,
      rejection: null, reason: 'Ready', benefit: 'Climb the north cliff.' }
    const onView = { ...view, savedTerrainWorks: { ...saved, builtSites: [],
      modeActive: true, preview: { selected: choice, nearby: [choice], guidance: null } } }
    const onTree = renderHudTree({ projection: onView, onIntent: (intent) => emitted.push(intent) })
    const on = renderHud(onView)
    expect(on).toContain('aria-label="Close Works mode"')
    expect(on).toContain('aria-label="Choose ladder" aria-pressed="true"')
    expect(on).toContain('aria-label="Move structure aim"')
    expect(on).toContain('Climb the north cliff.')
    expect(on).toContain('aria-label="Confirm selected saved work"')
    expect(on).toContain('Greenway logs</b><small>×8')
    const close = findElements(onTree, (element) => element.type === 'button'
      && element.props['aria-label'] === 'Close Works mode')[0]
    expect(close.props['aria-expanded']).toBe(true)
    ;(close.props.onClick as () => void)()
    expect(emitted).toEqual([{ type: 'saved-work.mode', active: true },
      { type: 'saved-work.mode', active: false }])
    const queued = renderHud({ ...onView, controllerActionsEnabled: false })
    expect(queued).toContain('Saved Works paused; check the save status.')
    expect(queued).toContain('disabled="" aria-label="Confirm selected saved work"')
  })

  it('returns focus to the Works toggle only when a v17 child loses focus on collapse', () => {
    const toggle = { focus: vi.fn() }
    const child = {}
    const outside = {}
    let focused: object = child
    const panel = { ownerDocument: { get activeElement() { return focused } },
      contains: (node: object) => node === child || node === toggle,
      querySelector: () => toggle } as unknown as HTMLDivElement
    const collapsed = { active: true, expanded: false, children: null }
    const boundary = new WizardWorksFocusBoundary(collapsed)
    const wrapper = boundary.render() as ReactElement<{ ref: (node: HTMLDivElement | null) => void }>
    wrapper.props.ref(panel)
    const previous = { ...collapsed, expanded: true }
    const restore = boundary.getSnapshotBeforeUpdate(previous)
    expect(restore).toBe(true)
    boundary.componentDidUpdate(previous, undefined, restore)
    expect(toggle.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true })
    focused = outside
    expect(boundary.getSnapshotBeforeUpdate(previous)).toBe(false)
    focused = toggle
    expect(boundary.getSnapshotBeforeUpdate(previous)).toBe(false)
    expect(boundary.getSnapshotBeforeUpdate(collapsed)).toBe(false)
    boundary.componentDidUpdate(previous, undefined, false)
    expect(toggle.focus).toHaveBeenCalledTimes(1)
  })

  it('keeps a v17 field objective ahead of Works through the bridge, dig, sale, and boot loop', () => {
    const state = createWizardWorld('greenway-alpha')
    const [bridge, dig] = publicWorldV15StarterSites(state.seed)
    const ladder = resolveTerrainWorkSite(state.seed, 'works1:ladder:-103:108:W')!
    if (bridge.kind !== 'bridge' || dig.kind !== 'dig' || ladder.kind !== 'ladder') {
      throw new Error('Missing Greenway work fixtures')
    }
    const displayedBridge = { ...bridge, obstacle: 'fen_channel' as const }
    const saved = { context: 'works4-greenway' as const, builtSites: [], dugTileIds: [],
      modeActive: false, selectedKind: 'bridge' as const, actionsEnabled: true, preview: null }
    const view = () => ({ ...toViewProjection(state, []),
      starterCliff: { face: starterCliffCanonicalFace(state.seed), ladder: null },
      savedTerrainWorks: saved })
    const fresh = renderHud(view())
    expect(fresh.indexOf('aria-label="Greenway field objective"'))
      .toBeLessThan(fresh.indexOf('aria-label="Saved terrain works"'))
    expect(fresh).toContain('South creek Bridge to far bank: chop 8 more logs; B, 1, aim at a discovered dry crossing, F.')
    expect(fresh).toContain('North cliff Ladder: 4 logs, B, 2, aim, F; climb rungs to the upper ledge.')
    expect(fresh).toContain('Barefoot walks; boots run by default, R toggles walk.')
    expect(fresh).not.toContain('x 0, z -4')
    expect(fresh).toContain('.wr-greenway-objective{position:relative;right:auto;top:156px')
    expect(fresh).toContain('.wr-surface:has(.wr-greenway-objective) .wr-saved-work-panel{position:relative;right:auto;top:164px')
    expect(fresh).toContain('@media(min-width:720px) and (max-width:900px) and (orientation:portrait){.wr-greenway-objective{position:relative;right:auto;top:192px')
    expect(fresh).toContain('@media(min-width:720px) and (max-width:900px) and (min-height:591px) and (orientation:landscape){[data-public-version=v42] .wr-v35-quest,[data-public-version=v43] .wr-v35-quest{left:280px;right:auto;width:240px}}')
    expect(fresh).toContain('.wr-surface:has(.wr-greenway-objective) .wr-saved-work-panel{position:relative;right:auto;top:200px')
    expect(fresh).toContain('@media(max-width:360px) and (max-height:600px){.wr-surface:has(.wr-greenway-objective) .wr-saved-work-panel{margin:0 auto 0 8px}')
    expect(fresh).toContain('[data-public-v23]:has(.wr-greenway-objective) .v23-guide{display:none}')
    expect(fresh).toContain('@media(min-width:720px) and (max-width:900px) and (max-height:590px){.wr-greenway-objective{max-height:60px;overflow-y:auto;pointer-events:auto}')
    expect(fresh).toContain('.wr-surface:has(.wr-greenway-objective) .wr-saved-work-panel{top:140px;right:240px}')
    expect(fresh).toContain('[data-public-v23]:has(.wr-greenway-objective) .v23-save{max-height:120px;overflow-y:auto')
    expect(renderHud({ ...view(), savedTerrainWorks: { ...saved,
      context: 'works3-greenway' as const } })).not.toContain('Greenway field objective')

    state.player.inventory.push({ itemId: 'logs', quantity: 8 })
    expect(renderHud(view())).toContain('South creek Bridge to far bank: B, 1, aim')
    const builtBridge = { ...saved, builtSites: [displayedBridge] }
    const resumed = renderHud({ ...view(), savedTerrainWorks: builtBridge })
    expect(resumed).toContain('Dry far-bank Dig for stone: buy and equip a field spade at Outfitters.')
    expect(resumed).toContain('Dig yields one stone and 30 Excavation XP; sell at Outfitters.')
    state.player.inventory.push({ itemId: 'field_spade', quantity: 1 })
    expect(renderHud({ ...view(), savedTerrainWorks: builtBridge }))
      .toContain('Dry far-bank Dig: equip your field spade and free one bag slot.')
    state.player.equipment.mainHand = 'field_spade'
    expect(renderHud({ ...view(), savedTerrainWorks: builtBridge }))
      .toContain('free one bag slot, stand beside revealed loam, then B, 3, F.')

    state.player.inventory.push({ itemId: 'stone', quantity: 1 })
    const dug = { ...builtBridge, dugTileIds: [dig.footprintTileIds[0]] }
    expect(renderHud({ ...view(), savedTerrainWorks: dug }))
      .toContain('Sell 1 stone at Greenway Outfitters for 1g each')
    state.player.inventory = state.player.inventory.filter((stack) => stack.itemId !== 'stone')
    expect(renderHud({ ...view(), savedTerrainWorks: dug }))
      .toContain('Buy and equip leather boots at Outfitters to run by default')
    state.player.inventory.push({ itemId: 'leather_boots', quantity: 1 })
    expect(renderHud({ ...view(), savedTerrainWorks: dug }))
      .toContain('Equip your leather boots to run by default')
    state.player.equipment.feet = 'leather_boots'
    const booted = renderHud({ ...view(), savedTerrainWorks: dug,
      gait: { pace: 'run' as const, canRun: true, reason: 'Running in leather boots' } })
    expect(booted).toContain('North cliff Ladder to upper ledge: gather 4 logs')
    expect(booted).toContain('Boots: run now; R or Walk/Run toggles pace')
    expect(booted).not.toContain('North cliff Ladder: 4 logs, B, 2')
    const walking = renderHud({ ...view(), savedTerrainWorks: dug,
      gait: { pace: 'walk' as const, canRun: true, reason: 'Walking in leather boots' } })
    expect(walking).toContain('Boots: walk now; R or Walk/Run toggles pace')
    expect(walking).toContain('Walk now in leather boots; R or Walk/Run switches to Run.')
    const readyLadder = { site: ladder, distanceMeters: 2, angleRadians: 0,
      rejection: null, reason: 'Ready', benefit: 'Climb the north cliff.' }
    const worksOn = renderHud({ ...view(), savedTerrainWorks: { ...dug,
      modeActive: true, selectedKind: 'ladder' as const,
      preview: { selected: readyLadder, nearby: [readyLadder], guidance: null } } })
    expect(worksOn).not.toContain('aria-label="Greenway field objective"')
    expect(worksOn).toContain('.wr-surface[data-work-mode="true"] .wr-saved-work-panel{top:136px')
    expect(worksOn).toContain('.v23-guide{display:none}')
    expect(worksOn).toContain('.v23-save{max-height:120px;overflow-y:auto')
    expect(worksOn).toContain('.v23-save{top:8px}')
    expect(worksOn).toContain('.wr-saved-work-panel{top:204px')
    expect(worksOn).toContain('class="wr-saved-work-actions"')
    expect(worksOn).toContain('aria-label="Confirm selected saved work"')
    const complete = renderHud({ ...view(), savedTerrainWorks: { ...dug,
      builtSites: [displayedBridge, ladder], modeActive: true } })
    expect(complete).not.toContain('aria-label="Greenway field objective"')
    expect(complete).toContain('Built Works north cliff ladder')
    expect(complete).toContain('wr-saved-work-actions')
    expect(complete).toContain('Works On · B')
  })

  it('does not disclose the canonical foot or preview a phantom site before discovery', () => {
    const state = createWizardWorld('greenway-alpha')
    const base = toViewProjection(state, [])
    const marker = { face: starterCliffCanonicalFace(state.seed), ladder: null }
    const undiscovered = renderHud({ ...base, starterCliff: marker,
      buildSites: [], selectedBuildSiteId: null })
    expect(undiscovered).toContain('Find the Greenway cliff foot')
    expect(undiscovered).not.toContain('x 0, z -4')
    const phantom = { id: 'greenway_ladder:x:2', routeId: 'greenway_ladder',
      label: 'Phantom site at x 2', from: [2, 1, -4], to: [2, 2.56, -8],
      logCost: 4, status: 'ready', reason: 'Ready to build', discovered: true } as const
    const withPhantom = renderHud({ ...base, starterCliff: marker,
      buildSites: [phantom], selectedBuildSiteId: phantom.id })
    expect(withPhantom).not.toContain('Phantom site at x 2')
    expect(withPhantom).not.toContain('Build</button>')
  })

  it('allows starter spade equipment but hides duplicate purchase and legacy controls', () => {
    const state = createWizardWorld('greenway-alpha')
    state.player.position = { ...state.stores.find((store) => store.id === 'store-greenway')!.position }
    state.player.inventory.push({ itemId: 'leather_boots', quantity: 1 },
      { itemId: 'field_spade', quantity: 1 })
    const base = toViewProjection(state, [], 'store-greenway')
    const view = { ...base, starterCliff: { face: starterCliffCanonicalFace(state.seed), ladder: null },
      stores: base.stores.map((store) => store.id === 'store-greenway' ? { ...store,
        listings: [...store.listings, { id: PUBLIC_V11_BOOTS_LISTING_ID,
          name: 'Leather boots', price: 25 }],
      } : store) }
    const markup = renderHud(view)
    expect(markup).toContain('Equip Woodcutter')
    expect(markup).toContain('Equip Leather boots')
    expect(markup).toContain('Chop a nearby oak twice for 4 logs')
    expect(markup).toContain('Equip Field spade')
    expect(markup).not.toContain('Leather boots</b><span>25g')
    expect(markup).not.toContain('Field spade</b><span>18g')
    expect(markup).not.toContain('Apprentice hat</b><span>')
    expect(markup).not.toContain('Sell materials')
    expect(markup).not.toContain('>List</button>')
    expect(markup).not.toContain('Trade board')
    expect(markup).not.toContain('Cast Wayfinder Glow')
    const legacy = renderHud(base)
    expect(legacy).toContain('Sell materials')
    expect(legacy).toContain('>List</button>')
    expect(legacy).toContain('Cast Wayfinder Glow')
  })

  it('emits only projected starter spade and 1g stone store intents while nearby', () => {
    const state = createWizardWorld('greenway-alpha')
    state.player.position = { ...state.stores[0].position }
    state.player.inventory.push({ itemId: 'stone', quantity: 3 })
    const base = toViewProjection(state, [], 'store-greenway')
    const view = { ...base, starterCliff: { face: starterCliffCanonicalFace(state.seed), ladder: null },
      stores: base.stores.map((store) => store.id === 'store-greenway' ? { ...store,
        listings: [{ id: PUBLIC_V11_BOOTS_LISTING_ID, name: 'Leather boots', price: 25 },
          { id: 'spade', name: 'Field spade', price: 18, stock: 3 },
          { id: 'hat', name: 'Apprentice hat', price: 20, stock: 3 }],
        sellOffers: [{ itemId: 'stone', name: 'Stone', quantity: 3, unitPrice: 1 },
          { itemId: 'logs', name: 'Greenway logs', quantity: 4, unitPrice: 2 }],
      } : store) }
    const emitted: unknown[] = []
    const buttons = findElements(renderHudTree({ projection: view, onIntent: (intent) => emitted.push(intent) }),
      (element) => element.type === 'button')
    const spade = buttons.find((button) => findElements(button,
      (element) => element.type === 'b' && element.props.children === 'Field spade').length > 0)
    const sellOne = buttons.find((button) => button.props['aria-label'] === 'Sell 1 Stone')
    const sellAll = buttons.find((button) => button.props['aria-label'] === 'Sell all 3 Stone for 3 gold')
    expect(spade).toBeDefined()
    expect(sellOne).toBeDefined()
    expect(sellAll).toBeDefined()
    for (const button of [spade, sellOne, sellAll]) (button!.props.onClick as () => void)()
    expect(emitted).toEqual([
      { type: 'store.select-listing', storeId: 'store-greenway', listingId: 'spade' },
      { type: 'store.sell-item', storeId: 'store-greenway', itemId: 'stone', quantity: 1 },
      { type: 'store.sell-item', storeId: 'store-greenway', itemId: 'stone', quantity: 3 },
    ])
    const markup = renderHud(view)
    expect(markup).toContain('Stone ×3 · 1g each')
    expect(markup).not.toContain('Sell 1 Greenway logs')
    expect(markup).not.toContain('Apprentice hat</b><span>')
    const hidden = renderHud({ ...view, openStoreId: null })
    expect(hidden).not.toContain('Sell 1 Stone')
    expect(hidden).not.toContain('Field spade</b><span>18g')
    const unowned = renderHud({ ...view, backpack: { ...view.backpack,
      stacks: view.backpack.stacks.filter((stack) => stack.itemId !== 'stone') } })
    expect(unowned).not.toContain('Sell 1 Stone')
    const paused = findElements(renderHudTree({ projection: { ...view,
      controllerActionsEnabled: false }, onIntent: () => {} }),
    (element) => element.type === 'button')
    expect(paused.find((button) => button.props['aria-label'] === 'Sell 1 Stone')?.props.disabled).toBe(true)
    expect(paused.find((button) => button.props['aria-label'] === 'Sell all 3 Stone for 3 gold')?.props.disabled).toBe(true)
    expect(paused.find((button) => findElements(button,
      (element) => element.type === 'b' && element.props.children === 'Field spade').length > 0)?.props.disabled).toBe(true)
  })

  it('switches the main-hand axe and spade without offering unsupported unequip', () => {
    const state = createWizardWorld('greenway-alpha')
    state.player.inventory.push({ itemId: 'field_spade', quantity: 1 })
    state.player.equipment.mainHand = 'woodcutters_axe'
    const marker = { face: starterCliffCanonicalFace(state.seed), ladder: null }
    const emitted: unknown[] = []
    const spadeView = { ...toViewProjection(state, []), starterCliff: marker }
    const spade = findElements(renderHudTree({ projection: spadeView,
      onIntent: (intent) => emitted.push(intent) }),
    (element) => element.type === 'button' && element.props['aria-label'] === 'Equip Field spade')[0]
    expect(spade).toBeDefined()
    ;(spade.props.onClick as () => void)()
    state.player.equipment.mainHand = 'field_spade'
    const axeView = { ...toViewProjection(state, []), starterCliff: marker }
    const axe = findElements(renderHudTree({ projection: axeView,
      onIntent: (intent) => emitted.push(intent) }),
    (element) => element.type === 'button' && element.props['aria-label'] === 'Equip Woodcutter axe')[0]
    expect(axe).toBeDefined()
    ;(axe.props.onClick as () => void)()
    expect(emitted).toEqual([
      { type: 'equipment.equip', stackId: 'inventory-field_spade', slot: 'mainHand' },
      { type: 'equipment.equip', stackId: 'inventory-woodcutters_axe', slot: 'mainHand' },
    ])
    expect(renderHud(axeView)).not.toContain('Unequip Field spade')
    const paused = findElements(renderHudTree({ projection: { ...spadeView,
      controllerActionsEnabled: false }, onIntent: () => {} }),
    (element) => element.type === 'button' && element.props['aria-label'] === 'Equip Field spade')[0]
    expect(paused.props.disabled).toBe(true)
  })

  it('shows wired streamed v14 Works despite the persistent cliff marker, never Greenway read-only Works', () => {
    const state = createWizardWorld('greenway-alpha')
    const marker = { face: starterCliffCanonicalFace(state.seed), ladder: null }
    const base = { ...toViewProjection(state, []), starterCliff: marker,
      unavailableActions: true as const }
    const ledger = { builtSites: [], dugTileIds: [], preview: null, actionsEnabled: false }
    expect(renderHud({ ...base, savedTerrainWorks: ledger })).not.toContain('Saved terrain works')
    const off = { ...base, savedTerrainWorks: { ...ledger, modeActive: false,
      selectedKind: 'bridge' as const, actionsEnabled: true } }
    expect(renderHud(off)).toContain('aria-label="Saved terrain works"')
    expect(renderHud(off)).toContain('aria-label="Open Works mode"')
    const site = resolveTerrainWorkSite(state.seed, 'works1:bridge:-102:92:z')!
    const choice = { site, rejection: null, angleRadians: 0, distanceMeters: 1,
      reason: 'Ready to build here.', benefit: 'Cross the Fen.' }
    const on = { ...off, savedTerrainWorks: { ...off.savedTerrainWorks,
      modeActive: true, preview: { selected: choice, nearby: [choice], guidance: null } } }
    const emitted: unknown[] = []
    const confirm = findElements(renderHudTree({ projection: on, onIntent: (intent) => emitted.push(intent) }),
      (element) => element.type === 'button'
        && element.props['aria-label'] === 'Confirm aimed saved work')[0]
    expect(confirm.props.disabled).toBe(false)
    ;(confirm.props.onClick as () => void)()
    expect(emitted).toEqual([{ type: 'saved-work.confirm', id: site.id }])
    const paused = findElements(renderHudTree({ projection: { ...on,
      controllerActionsEnabled: false, savedTerrainWorks: { ...on.savedTerrainWorks,
        actionsEnabled: false } }, onIntent: () => {} }),
    (element) => element.type === 'button' && element.props['aria-label'] === 'Open Works mode'
      || element.type === 'button' && element.props['aria-label'] === 'Close Works mode')[0]
    expect(paused.props.disabled).toBe(true)
    expect(renderHud({ ...base, starterCliff: undefined, savedTerrainWorks: ledger }))
      .toContain('aria-label="Saved terrain works"')
  })

  it('labels the near-spawn v15 creek work without misleading Mireglass copy', () => {
    const state = createWizardWorld('greenway-alpha')
    const base = toViewProjection(state, [])
    const markup = renderHud({ ...base,
      starterCliff: { face: starterCliffCanonicalFace(state.seed), ladder: null },
      map: { ...base.map, guidance: 'Gather 8 logs for the creek bridge.' },
      savedTerrainWorks: { context: 'starter-greenway', builtSites: [], dugTileIds: [],
        preview: null, modeActive: false, selectedKind: 'bridge', actionsEnabled: true } })
    expect(markup).toContain('Gather 8 logs for the creek bridge.')
    expect(markup).toContain('cross the creek near spawn')
    expect(markup).not.toContain('Works start in Mireglass')
    expect(markup).not.toContain('Bridge: cross a Fen channel')
    expect(markup).not.toContain('Find the Greenway cliff foot')
  })

  it('shows discovered v15 work directions, benefit, cost and blocking reason while Works is on', () => {
    const state = createWizardWorld('greenway-alpha')
    const [bridge, dig] = publicWorldV15StarterSites(state.seed)
    if (bridge.kind !== 'bridge' || dig.kind !== 'dig') throw new Error('Missing v15 sites')
    const base = toViewProjection(state, [])
    const position = [bridge.from.x, 0, bridge.from.z - 6] as const
    const choice = { site: { ...bridge, obstacle: 'fen_channel' as const },
      distanceMeters: 6, angleRadians: 1, rejection: 'not_owned' as const,
      reason: 'Gather 8 logs from nearby oaks.',
      benefit: 'Costs 8 logs; cross the creek on a narrow supported deck and gain 80 construction XP.' }
    const view = { ...base, player: { ...base.player, position },
      starterCliff: { face: starterCliffCanonicalFace(state.seed), ladder: null },
      gait: { pace: 'walk' as const, canRun: false, reason: 'Barefoot: walk only' },
      savedTerrainWorks: { context: 'starter-greenway' as const, builtSites: [], dugTileIds: [],
        modeActive: true, selectedKind: 'bridge' as const, actionsEnabled: true,
        preview: { selected: null, nearby: [choice], guidance: null } } }
    const markup = renderHud(view)
    expect(markup).toContain('Creek bridge · S · 6 m on map')
    expect(markup).toContain('Costs 8 logs; cross the creek on a narrow supported deck')
    expect(markup).toContain('Face the site to aim. Gather 8 logs from nearby oaks.')
    expect(markup).toContain('North cliff ladder: rungs to the upper ledge')
    expect(markup).toContain('a separate starter route, not a Works kind')
    expect(markup).toContain('Barefoot walks · Outfitters boots run')
    expect(markup).not.toContain(bridge.id)

    const hidden = renderHud({ ...view, savedTerrainWorks: { ...view.savedTerrainWorks,
      preview: { selected: null, nearby: [],
        guidance: 'Discover the full creek crossing south of the starting area.' } } })
    expect(hidden).toContain('Discover the full creek crossing south of the starting area.')
    expect(hidden).not.toContain(`x ${bridge.from.x}, z ${bridge.from.z}`)
    expect(hidden).not.toContain(bridge.id)

    const digChoice = { site: dig, distanceMeters: 3, angleRadians: 0, rejection: 'requires_spade' as const,
      reason: 'Own and equip a field spade.',
      benefit: 'Requires an equipped owned field spade and one free backpack slot; lower the patch by 0.24 m for one stone and 30 excavation XP.' }
    const digging = renderHud({ ...view, savedTerrainWorks: { ...view.savedTerrainWorks,
      selectedKind: 'dig' as const,
      preview: { selected: digChoice, nearby: [digChoice], guidance: null } } })
    expect(digging).toContain('Bank dig ·')
    expect(digging).toContain('one free backpack slot; lower the patch by 0.24 m')
    expect(digging).toContain('Own and equip a field spade.')
    expect(digging).toContain('sell stone at Greenway Outfitters')
    expect(digging).toContain('disabled="" aria-label="Confirm aimed saved work"')

    const running = renderHud({ ...view, gait: { pace: 'run' as const, canRun: true,
      reason: 'Running in leather boots' } })
    expect(running).toContain('Leather boots: run · default run · Walk/R')

    const farBridge = { ...choice, distanceMeters: 11, rejection: 'too_far' as const,
      reason: 'Move within 3 m of this site.' }
    const completed = { ...view,
      map: { ...view.map, guidance: 'Return across the bridge to Greenway Outfitters and sell the stone.' },
      savedTerrainWorks: { ...view.savedTerrainWorks, builtSites: [choice.site],
        dugTileIds: [dig.footprintTileIds[0]],
        preview: { selected: null, nearby: [farBridge], guidance: null } } }
    const completedBridge = renderHud(completed)
    expect(completedBridge).toContain('Creek bridge complete. Return across the bridge to Greenway Outfitters')
    expect(completedBridge).not.toContain('Face the site to aim')
    expect(completedBridge).not.toContain('Move within 3 m of this site')

    const farDig = { ...digChoice, rejection: 'too_far' as const,
      reason: 'Move within 3 m of this site.' }
    const completedDig = renderHud({ ...completed, savedTerrainWorks: { ...completed.savedTerrainWorks,
      selectedKind: 'dig' as const, preview: { selected: farDig, nearby: [farDig], guidance: null } } })
    expect(completedDig).toContain('Bank dig complete. Return across the bridge to Greenway Outfitters')
    expect(completedDig).not.toContain('Move within 3 m of this site')
    expect(completedDig).not.toContain('aria-label="Confirm aimed saved work"')
  })

  it('hides unsupported nearby interactions and axe unequip, while preserving boots unequip', () => {
    const state = createWizardWorld('greenway-alpha')
    state.player.equipment.mainHand = 'woodcutters_axe'
    state.player.inventory.push({ itemId: 'leather_boots', quantity: 1 })
    state.player.equipment.feet = 'leather_boots'
    const base = toViewProjection(state, [])
    const view = { ...base, starterCliff: { face: starterCliffCanonicalFace(state.seed), ladder: 'built' as const },
      nearbyInteraction: { kind: 'route' as const, targetId: 'greenway_ladder', label: 'Old shortcut',
        action: 'Cross', actionable: true } }
    const markup = renderHud(view)
    expect(markup).not.toContain('Old shortcut')
    expect(markup).not.toContain('Unequip Woodcutter')
    expect(markup).toContain('Unequip Leather boots')
    expect(markup).toContain('<button class="wr-touch-action" disabled="">Interact</button>')
  })
})

describe('Wizard fairy ring HUD', () => {
  it('shows only the Discover prompt at an undiscovered source, even with a discovered destination', () => {
    const markup = renderHud(projectionAtGreenwayRing(['ring-highland']))
    expect(markup).toContain('<button class="wr-prompt" data-actionable="true"')
    expect(markup).toContain('<b>Discover</b>Greenway Ring')
    expect(markup).not.toContain('<aside class="wr-panel wr-context">')
    expect(markup).not.toContain('>Travel</span>')
  })

  it('asks for another ring when only the source is discovered', () => {
    const markup = renderHud(projectionAtGreenwayRing(['ring-greenway']))
    expect(markup).toContain('<aside class="wr-panel wr-context">')
    expect(markup).toContain('Discover another fairy ring to unlock travel.')
    expect(markup).not.toContain('>Travel</span>')
  })

  it('offers travel only to discovered destinations when the source is discovered', () => {
    const projection = projectionAtGreenwayRing(['ring-greenway', 'ring-highland'])
    const withHiddenRing = {
      ...projection,
      fairyRings: projection.fairyRings.map((ring) => ring.id === 'ring-greenway'
        ? { ...ring, destinations: [...ring.destinations, { ringId: 'ring-hidden', label: 'Hidden Ring', discovered: false }] }
        : ring),
    }
    const markup = renderHud(withHiddenRing)
    expect(markup).toContain('<aside class="wr-panel wr-context">')
    expect(markup).toContain('Discovered fairy paths')
    expect(markup).toContain('<b>Highland Ring</b><span>Travel</span>')
    expect(markup).not.toContain('Hidden Ring')
    expect(markup.match(/>Travel<\/span>/g)).toHaveLength(1)
  })
})

describe('Wizard field action range', () => {
  it('matches the authoritative three-dimensional range on sloped ground', () => {
    const state = createWizardWorld('greenway-alpha')
    const mound = state.digSites.find((site) => site.id === 'practice_mound')!
    state.player.position = { ...mound.position, y: mound.position.y + 3.1 }
    state.player.inventory.push({ itemId: 'field_spade', quantity: 1 })
    state.player.equipment.mainHand = 'field_spade'
    expect(renderHud(toViewProjection(state, []))).not.toContain('aria-label="Excavate Practice mound"')
    state.player.position.y = mound.position.y + 2.9
    expect(renderHud(toViewProjection(state, []))).toContain('aria-label="Excavate Practice mound"')
  })
})

describe('Wizard backpack capacity', () => {
  it('distinguishes full squares with four-log stack headroom from a full wood stack', () => {
    const base = toViewProjection(createWizardWorld('greenway-alpha'), [])
    const mining: NonNullable<WizardViewProjection['v29Mining']> = {
      tools: { basicPickOwned: false, enchantedPickOwned: false, activePick: null },
      offers: [], bids: { soil: 1, stone: 3, iron_ore: 8, gold_ore: 15, diamond: 60 },
      bag: { soil: 0, stone: 0, iron_ore: 0, gold_ore: 0, diamond: 0 },
      excavationLevel: 1, atOutfitters: false,
    }
    const fullPack = (logs: number): WizardViewProjection => ({ ...base, v29Mining: mining,
      backpack: { ...base.backpack, stacks: [base.backpack.stacks[0]!,
        { id: 'stone-filler', itemId: 'stone', name: 'Stone', quantity: 18 },
        { id: 'logs-test', itemId: 'logs', name: 'Greenway logs', quantity: logs }] } })
    const withHeadroom = renderHud(fullPack(8))
    expect(withHeadroom).toContain('20/20 item spaces')
    expect(withHeadroom).toContain('wood stack can hold another 4-log oak harvest')
    expect(withHeadroom).not.toContain('next 4-log oak harvest needs another item space')

    const woodStackFull = renderHud(fullPack(20))
    expect(woodStackFull).toContain('20/20 item spaces')
    expect(woodStackFull).toContain('next 4-log oak harvest needs another item space')
    expect(woodStackFull).not.toContain('wood stack can hold another 4-log oak harvest')
  })

  it('counts excavated material, shows only earned quantities, and offers no fake sale action', () => {
    const state = createWizardWorld('greenway-alpha')
    const base = toViewProjection(state, [])
    const materials = { soil: 2, stone: 0, iron_ore: 1, gold_ore: 0, diamond: 0 }
    const baseUsed = base.backpack.stacks.reduce((sum, stack) => sum + stack.quantity, 0)
      + base.tradeListings.reduce((sum, listing) => sum + (listing?.quantity ?? 0), 0)
    const html = renderHud({ ...base, v26TerrainBag: materials })
    expect(html).toContain(`<header><span>Backpack</span><small>${baseUsed + 3}/${base.backpack.capacity} item spaces</small></header>`)
    expect(html).toContain(`<progress aria-label="Item spaces used" value="${baseUsed + 3}" max="${base.backpack.capacity}"`)
    expect(html).toContain(`${base.backpack.capacity - baseUsed - 3} free item spaces`)
    expect(html).toContain('Wood: 0 logs')
    expect(html).toContain('Wood stacks: up to 20 logs per item space.')
    expect(html.match(/data-item="terrain-(soil|iron_ore)"/g)).toHaveLength(3)
    expect(html.match(/data-miniature="soil"/g)).toHaveLength(2)
    expect(html.match(/data-miniature="rock"/g)).toHaveLength(1)
    expect(html).toContain('terrain bag soil ×2')
    const soilSpaces = html.match(/<span[^>]*data-item="terrain-soil"[^>]*>.*?<\/span>/g) ?? []
    expect(soilSpaces).toHaveLength(2)
    expect(soilSpaces.every((space) => !space.includes('data-stack-count'))).toBe(true)
    const excavated = html.match(/<section class="wr-caption" aria-label="Excavated materials">.*?<\/section>/)?.[0]
    expect(excavated).toContain('Soil ×2')
    expect(excavated).toContain('Iron ore ×1')
    expect(excavated).not.toContain('Stone ×')
    expect(excavated).not.toContain('<button')
    expect(excavated).toContain('Store sales are not available yet')
    expect(renderHud(base)).not.toContain('aria-label="Excavated materials"')
    expect(renderHud({ ...base, v26TerrainBag: { soil: 0, stone: 0,
      iron_ore: 0, gold_ore: 0, diamond: 0 } })).not.toContain('aria-label="Excavated materials"')
  })

  it('keeps listed items reserved when showing used capacity', () => {
    const state = createWizardWorld('greenway-alpha')
    state.player.inventory.push({ itemId: 'logs', quantity: 19 })
    const fullHtml = renderHud(toViewProjection(state, []))
    expect(fullHtml).toContain('<header><span>Backpack</span><small>2/20 item spaces</small></header>')
    expect(fullHtml).toContain('18 free item spaces')
    expect(fullHtml).toContain('Wood: 19 logs')

    const listed = advanceWizardWorld(state, [
      { type: 'create_trade_listing', slotIndex: 0, itemId: 'logs', quantity: 2, unitPrice: 7 },
      { type: 'create_trade_listing', slotIndex: 3, itemId: 'logs', quantity: 3, unitPrice: 7 },
    ])
    expect(listed.rejections).toEqual([])
    expect(listed.state.player.inventory.find((stack) => stack.itemId === 'logs')?.quantity).toBe(14)
    expect(listed.state.player.tradeSlots.map((slot) => slot.quantity)).toEqual([2, 0, 0, 3])
    const listedHtml = renderHud(toViewProjection(listed.state, []))
    expect(listedHtml).toContain('<header><span>Backpack</span><small>4/20 item spaces</small></header>')
    expect(listedHtml).toContain('16 free item spaces')
    expect(listedHtml).toContain('Wood: 14 logs')
    expect(listedHtml.match(/data-item="listed"/g)).toHaveLength(2)
    expect(listedHtml.match(/data-miniature="listing"/g)).toHaveLength(2)
    expect(listedHtml).toContain('listed Greenway logs ×2')
    expect(listedHtml).toContain('listed Greenway logs ×3')
    const reservedSpaces = listedHtml.match(/<span[^>]*data-item="listed"[^>]*>.*?<\/span>/g) ?? []
    expect(reservedSpaces[0]).toContain('data-stack-count="2"')
    expect(reservedSpaces[1]).toContain('data-stack-count="3"')
    expect(reservedSpaces.filter((space) => space.includes('data-stack-count'))).toHaveLength(2)
    expect(listedHtml.match(/data-occupied="false"/g) ?? []).toHaveLength(16)
  })

  it('shows one square per 20-log stack and scales to the upgraded backpack', () => {
    const state = createWizardWorld('greenway-alpha')
    state.player.inventory.push({ itemId: 'logs', quantity: 8 })
    const base = toViewProjection(state, [])
    const starter = renderHud(base)
    expect(starter).toContain('aria-label="2 of 20 item spaces filled; 18 free. Contents: Woodcutter axe ×1; Greenway logs ×8"')
    expect(starter).toContain('grid-template-columns:repeat(7,minmax(0,1fr))')
    expect(starter.match(/data-item="woodcutters_axe"/g)).toHaveLength(1)
    expect(starter.match(/data-item="logs"/g)).toHaveLength(1)
    expect(starter.match(/data-miniature="axe"/g)).toHaveLength(1)
    expect(starter.match(/data-miniature="log"/g)).toHaveLength(1)
    const logSpaces = starter.match(/<span[^>]*data-item="logs"[^>]*>.*?<\/span>/g) ?? []
    expect(logSpaces).toHaveLength(1)
    expect(logSpaces[0]).toContain('data-stack-count="8"')
    const axeSpace = starter.match(/<span[^>]*data-item="woodcutters_axe"[^>]*>.*?<\/span>/)?.[0]
    expect(axeSpace).not.toContain('data-stack-count')
    expect(starter.match(/data-occupied="true"/g)).toHaveLength(2)
    expect(starter.match(/data-occupied="false"/g)).toHaveLength(18)
    expect(starter).toContain('title="Greenway logs, 8 in stack 1 of 1"')
    expect(starter).toContain('Wood: 8 logs')

    const withLogs = (quantity: number) => renderHud(toViewProjection({ ...state,
      player: { ...state.player, inventory: [{ itemId: 'woodcutters_axe', quantity: 1 },
        { itemId: 'logs', quantity }] } }, []))
    expect(withLogs(20)).toContain('2/20 item spaces')
    expect(withLogs(20).match(/data-item="logs"/g)).toHaveLength(1)
    expect(withLogs(20)).toContain('data-stack-count="20"')
    const twentyOne = withLogs(21)
    expect(twentyOne).toContain('3/20 item spaces')
    expect(twentyOne.match(/data-item="logs"/g)).toHaveLength(2)
    expect(twentyOne).toContain('title="Greenway logs, 20 in stack 1 of 2"')
    expect(twentyOne).toContain('title="Greenway logs, 1 in stack 2 of 2"')

    const upgraded = renderHud({ ...base, backpack: { ...base.backpack, capacity: 28 } })
    expect(upgraded).toContain('aria-label="2 of 28 item spaces filled; 26 free. Contents: Woodcutter axe ×1; Greenway logs ×8"')
    expect(upgraded.match(/data-occupied="true"/g)).toHaveLength(2)
    expect(upgraded.match(/data-occupied="false"/g)).toHaveLength(26)
  })

  it('shows carried wood and first bridge target before the item list at upgraded capacity', () => {
    const state = createWizardWorld('greenway-alpha')
    const base = toViewProjection(state, [])
    const view: WizardViewProjection = { ...base, v27WalkableSurface: true,
      backpack: { capacity: 30, stacks: [{ id: 'logs-test', itemId: 'logs', name: 'Greenway logs', quantity: 4 }] },
      savedTerrainWorks: { context: 'works4-greenway', builtSites: [], dugTileIds: [],
        modeActive: false, selectedKind: 'bridge', actionsEnabled: true, preview: null },
      v29Mining: { tools: { basicPickOwned: false, enchantedPickOwned: false, activePick: null },
        offers: [], bids: { soil: 1, stone: 3, iron_ore: 8, gold_ore: 15, diamond: 60 },
        bag: { soil: 0, stone: 0, iron_ore: 0, gold_ore: 0, diamond: 0 },
        excavationLevel: 1, atOutfitters: false } }
    const html = renderHud(view)
    expect(html).toContain('1/30 item spaces')
    expect(html).toContain('29 free item spaces')
    expect(html).toContain('Wood: 4 logs')
    expect(html).toContain('Creek bridge 4/8')
    expect(html.indexOf('Wood: 4 logs')).toBeLessThan(html.indexOf('<b>Greenway logs</b>'))
  })
})

describe('V36 marker quest journal', () => {
  it('gives Chapter 1 the only opening lead while retaining checked quest actions', () => {
    const base = projectionAtGreenwayRing([])
    const surveyor = { id: 'surveyor-first-find/v1' as const,
      title: "The Surveyor's First Find" as const, stage: 'gather' as const,
      objective: 'Chop eight logs.', reward: 'Basic pick.', complete: false }
    const ledger = { id: 'outfitters-ledger/v1' as const,
      title: "Outfitters' Ledger" as const, stage: 'first-find' as const,
      objective: 'Claim the first find.', reward: 'Traveler Tunic.', complete: false }
    const first: WizardViewProjection = { ...base, v34Quest: surveyor,
      v35LedgerQuest: ledger, controllerActionsEnabled: true,
      v30Bridgehead: { bridgeId: 'works4:bridge:greenway-creek:0',
        position: base.player.position, tileId: 'tile-3-7', claimed: false,
        claimReady: true, reward: 'basic-pick' } }
    expect(renderHud(first)).toContain('aria-label="Quest journal: The Surveyor&#x27;s First Find"')
    const opening = renderHud(first, undefined, true)
    expect(opening).not.toContain('aria-label="Quest journal: The Surveyor&#x27;s First Find"')
    expect(opening).toContain('aria-label="Claim River Works bridgehead reward"')
    expect(opening).toContain('id="wizard-backpack"')

    const ready = { rejection: null, hint: null }
    const next: WizardViewProjection = { ...first,
      v34Quest: { ...surveyor, stage: 'complete', complete: true },
      v35LedgerSurvey: { bridgeId: 'bridge', ...ready } }
    const actionOnly = renderHud(next, undefined, true)
    expect(actionOnly).toContain('aria-label="Available Ledger action"')
    expect(actionOnly).toContain('Survey connected-river exit</button>')
    expect(actionOnly).not.toContain('aria-label="Quest journal: Outfitters&#x27; Ledger"')
    expect(renderHud(next)).toContain('aria-label="Quest journal: Outfitters&#x27; Ledger"')

    const deliver = renderHud({ ...next, v35LedgerSurvey: undefined,
      v35LedgerDeliver: ready }, undefined, true)
    expect(deliver).toContain('Deliver stone to Outfitters</button>')
  })

  it('leads with Surveyor, then Ledger, then the active Old Marker chapter', () => {
    const base = projectionAtGreenwayRing([])
    const surveyor = { id: 'surveyor-first-find/v1' as const,
      title: "The Surveyor's First Find" as const, stage: 'gather' as const,
      objective: 'Chop eight logs.', reward: 'Basic pick.', complete: false }
    const ledger = { id: 'outfitters-ledger/v1' as const,
      title: "Outfitters' Ledger" as const, stage: 'first-find' as const,
      objective: 'Claim the first find.', reward: 'Traveler Tunic.', complete: false }
    const marker = { id: 'beneath-old-marker/v1' as const,
      title: 'Beneath the Old Marker' as const, stage: 'ledger' as const,
      objective: 'Finish the Ledger.', reward: 'Fen Waders.', active: false, complete: false }
    const first: WizardViewProjection = { ...base, v34Quest: surveyor,
      v35LedgerQuest: ledger, v36MarkerQuest: marker,
      v35LedgerSurvey: { bridgeId: 'bridge', rejection: 'requires_first_find', hint: null } }
    const firstHtml = renderHud(first)
    expect(firstHtml).toContain('aria-label="Quest journal: The Surveyor&#x27;s First Find"')
    expect(firstHtml).not.toContain('Outfitters&#x27; Ledger')
    expect(firstHtml).not.toContain('Survey connected-river exit')
    const claimed: WizardViewProjection = { ...first,
      v34Quest: { ...surveyor, stage: 'complete', complete: true } }
    const ledgerHtml = renderHud(claimed)
    expect(ledgerHtml).toContain('aria-label="Quest journal: Outfitters&#x27; Ledger"')
    expect(ledgerHtml).toContain('The Surveyor&#x27;s First Find')
    const delivered: WizardViewProjection = { ...claimed,
      v35LedgerQuest: { ...ledger, stage: 'complete', complete: true },
      v36MarkerQuest: { ...marker, stage: 'trail', active: true } }
    const markerHtml = renderHud(delivered)
    expect(markerHtml).toContain('aria-label="Quest journal: Beneath the Old Marker"')
    expect(markerHtml).toContain('Outfitters&#x27; Ledger')
    expect(markerHtml).toContain('The Surveyor&#x27;s First Find')
  })

  it('keeps the next chapter compact, prior quests inspectable, and checked claim explicit', () => {
    const base = projectionAtGreenwayRing([])
    const view: WizardViewProjection = { ...base,
      v34Quest: { id: 'surveyor-first-find/v1', title: "The Surveyor's First Find",
        stage: 'complete', objective: 'The saved first find is complete.', reward: 'Basic pick.', complete: true },
      v35LedgerQuest: { id: 'outfitters-ledger/v1', title: "Outfitters' Ledger",
        stage: 'complete', objective: 'The saved Ledger is complete.', reward: 'Traveler Tunic.', complete: true },
      v36MarkerQuest: { id: 'beneath-old-marker/v1', title: 'Beneath the Old Marker',
        stage: 'salvager', objective: 'Return to the Mireglass salvager.',
        reward: '80 coins and Fen Waders.', active: true, complete: false },
      v36MarkerClaim: { rejection: null, hint: null } }
    const html = renderHud(view)
    expect(html).toContain('aria-label="Quest journal: Beneath the Old Marker"')
    expect(html).toContain('data-expanded="false"')
    expect(html).toContain('Claim Old Marker reward')
    expect(html).toContain("Outfitters&#x27; Ledger")
    expect(html).toContain("The Surveyor&#x27;s First Find")
    expect(html).toContain('.wr-v35-quest[data-expanded="false"] .wr-v35-quest-content{display:none}')
    expect(html).toContain('Claim Old Marker reward</button>')
    const blocked = renderHud({ ...view,
      v36MarkerClaim: { rejection: 'capacity', hint: null } })
    expect(blocked).toContain('Free one pack space for Fen Waders.')
    expect(blocked).toContain('disabled=""')
  })
})

describe('V42 Iron Hall journal precedence', () => {
  it('keeps unfinished starter claims primary after ward defeat while Hall stays inspectable', () => {
    const base = projectionAtGreenwayRing([])
    const ready = { rejection: null, hint: null }
    const surveyor = { id: 'surveyor-first-find/v1' as const,
      title: "The Surveyor's First Find" as const, stage: 'complete' as const,
      objective: 'The first find is complete.', reward: 'Basic pick.', complete: true }
    const ledger = { id: 'outfitters-ledger/v1' as const,
      title: "Outfitters' Ledger" as const, stage: 'first-find' as const,
      objective: 'Deliver stone.', reward: 'Traveler Tunic.', complete: false }
    const marker = { id: 'beneath-old-marker/v1' as const,
      title: 'Beneath the Old Marker' as const, stage: 'salvager' as const,
      objective: 'Claim at the salvager.', reward: 'Fen Waders.', active: true, complete: false }
    const view: WizardViewProjection = { ...base, v34Quest: surveyor,
      v35LedgerQuest: ledger, v35LedgerDeliver: ready, v36MarkerQuest: marker,
      v36MarkerClaim: ready,
      v41IronHall: { health: 12, wardHealth: 0, phase: 'defeated', phaseUntilTick: 0,
        learnedBolt: true, wardDefeated: true, study: ready, engage: ready,
        bolt: ready, guard: ready, rest: ready },
      v42IronHall: { crestOutcome: 'won', questClaimed: false, vestOwned: false,
        vestEquipped: false, vestDurability: 0,
        spar: { active: false, strikeAtTick: 0, nextReadyTick: 0, strikesResolved: 0 },
        claim: ready, equip: ready, unequip: ready, repair: ready, sparStart: ready },
      v42QuartermasterSite: { position: base.player.position, revealed: true } }

    const ledgerHtml = renderHud(view)
    expect(ledgerHtml).toContain('aria-label="Quest journal: Outfitters&#x27; Ledger"')
    expect(ledgerHtml).toContain('Deliver stone to Outfitters</button>')
    expect(ledgerHtml).toContain('aria-label="Quest chapter: Iron Hall Watch"')
    expect(ledgerHtml).toContain('Claim at quartermaster</button>')

    const markerView: WizardViewProjection = { ...view,
      v35LedgerQuest: { ...ledger, stage: 'complete', complete: true } }
    const markerHtml = renderHud(markerView)
    expect(markerHtml).toContain('aria-label="Quest journal: Beneath the Old Marker"')
    expect(markerHtml).toContain('Claim Old Marker reward</button>')
    expect(markerHtml).toContain('aria-label="Quest chapter: Iron Hall Watch"')

    const completeHtml = renderHud({ ...markerView,
      v36MarkerQuest: { ...marker, stage: 'complete', complete: true } })
    expect(completeHtml).toContain('aria-label="Quest journal: Iron Hall Watch"')
  })

  it('leads through Waystation build, crossing, and claim before Iron Hall without losing other claims', () => {
    const base = projectionAtGreenwayRing([])
    const ready = { rejection: null, hint: null }
    const surveyor = { id: 'surveyor-first-find/v1' as const,
      title: "The Surveyor's First Find" as const, stage: 'gather' as const,
      objective: 'Build the creek bridge.', reward: 'Basic pick.', complete: false }
    const ledger = { id: 'outfitters-ledger/v1' as const,
      title: "Outfitters' Ledger" as const, stage: 'route' as const,
      objective: 'Deliver a terrain-bag stone.', reward: 'Traveler Tunic.', complete: false }
    const marker = { id: 'beneath-old-marker/v1' as const,
      title: 'Beneath the Old Marker' as const, stage: 'salvager' as const,
      objective: 'Return to the salvager.', reward: 'Fen Waders.', active: true, complete: false }
    const signal = { id: 'highland-signal/v1' as const, title: 'Highland Signal' as const,
      stage: 'return' as const, objective: 'Claim at Quarry Crown.', reward: '30 coins.',
      complete: false, inspect: ready, claim: ready }
    const waystation = { id: 'waystation-repair/v1' as const,
      title: 'Windward Waystation' as const, stage: 'build' as const,
      objective: 'Build the marked bridge.', reward: '45 coins.', complete: false,
      barter: ready, cross: ready, claim: ready }
    const hall = { health: 12, wardHealth: 9, phase: 'dormant' as const, phaseUntilTick: 0,
      learnedBolt: false, wardDefeated: false, study: ready, engage: ready,
      bolt: ready, guard: ready, rest: ready }
    const view: WizardViewProjection = { ...base, v34Quest: surveyor,
      v35LedgerQuest: ledger, v36MarkerQuest: marker, v36MarkerClaim: ready,
      v38SignalQuest: signal, v40WaystationQuest: waystation,
      v40WaystationSite: { id: 'waystation', approach: base.player.position,
        exit: base.player.position, built: false, revealed: true },
      v41IronHall: hall,
      v42IronHall: { crestOutcome: 'unrolled', questClaimed: false,
        vestOwned: false, vestEquipped: false, vestDurability: 0,
        spar: { active: false, strikeAtTick: 0, nextReadyTick: 0, strikesResolved: 0 },
        claim: ready, equip: ready, unequip: ready, repair: ready, sparStart: ready } }

    const fresh = renderHud(view)
    expect(fresh).toContain('aria-label="Quest journal: The Surveyor&#x27;s First Find"')
    const ledgerPending = renderHud({ ...view, v34Quest: { ...surveyor,
      stage: 'complete', complete: true } })
    expect(ledgerPending).toContain('aria-label="Quest journal: Outfitters&#x27; Ledger"')
    expect(ledgerPending).not.toContain('Open quest journal: Iron Hall Watch')

    const routed: WizardViewProjection = { ...view,
      v34Quest: { ...surveyor, stage: 'complete', complete: true },
      v35LedgerQuest: { ...ledger, stage: 'complete', complete: true } }
    for (const [stage, next] of [
      ['find', 'Find the river crossing'],
      ['choose-materials', 'Gather or barter timber'],
      ['build', 'Build the bridge'], ['cross', 'Reach the south bank'],
      ['return', 'Claim at Outfitters'],
    ] as const) {
      const html = renderHud({ ...routed, v40WaystationQuest: { ...waystation, stage } })
      expect(html).toContain('aria-label="Quest journal: Windward Waystation"')
      expect(html).toContain(`Waystation: ${next} ▾`)
      expect(html).toContain('class="wr-waystation-chapter" open=""')
      expect(html).toContain('aria-label="Quest chapter: Beneath the Old Marker"')
      expect(html).toContain('<button type="button">Claim Old Marker reward</button>')
      expect(html).toContain('aria-label="Quest chapter: Highland Signal"')
      expect(html).toContain('<button type="button">Claim Highland Signal reward</button>')
    }
    const inspecting = renderHud({ ...routed,
      v38SignalQuest: { ...signal, stage: 'vane' } })
    expect(inspecting).toContain('<button type="button">Inspect signal vane</button>')
    const building = renderHud(routed)
    expect(building).toContain('Plan Waystation bridge</button>')
    const crossing = renderHud({ ...routed,
      v40WaystationQuest: { ...waystation, stage: 'cross' },
      v40WaystationSite: { ...routed.v40WaystationSite!, built: true } })
    expect(crossing).toContain('Record south-bank crossing</button>')
    const store = base.stores.find((entry) => entry.id === 'store-greenway')!
    const returning = renderHud({ ...routed,
      player: { ...base.player, position: store.position },
      v40WaystationQuest: { ...waystation, stage: 'return' } })
    expect(returning).toContain('Claim Waystation reward</button>')

    const atHall = renderHud({ ...routed,
      v40WaystationQuest: { ...waystation, stage: 'complete', complete: true } })
    expect(atHall).toContain('aria-label="Quest journal: Iron Hall Watch"')
    expect(atHall).toContain('Iron Hall ▾')
    expect(atHall).toContain('aria-label="Quest chapter: Beneath the Old Marker"')
  })
})
