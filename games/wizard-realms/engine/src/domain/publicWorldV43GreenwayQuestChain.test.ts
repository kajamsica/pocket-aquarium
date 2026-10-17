import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { GREENWAY_LOG_ORDER } from './greenwayProcurementOrder'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { publicV25StratumAt } from './publicWorldV25Strata'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import { publicWorldV15ClearStarterResources, publicWorldV15StarterTileAtGrid }
  from './publicWorldV15StarterSites'
import { createStarterCliffGreenwayFacts } from './starterCliffWorld'
import { GREENWAY_BAG_UPGRADE } from './publicWorldV43BagUpgrade'
import { createFreshPublicV43Root, replayPublicV43Witness }
  from './publicWorldV43Snapshot'
import { projectPublicV43GreenwayQuestChain, projectPublicV43QuestContinuation }
  from './publicWorldV43GreenwayQuestChain'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const fresh = () => createFreshPublicV43Root('wizard-realms').head
const firstDig = (head: Parameters<typeof projectPublicV43GreenwayQuestChain>[0]) =>
  projectPublicV43GreenwayQuestChain(head).find((quest) => quest.id === 'first-excavation/v1')!

function rewardedGreenwayDig() {
  const head = fresh(), seed = head.state.seed
  for (let gz = -5; gz <= 1; gz += 1) for (let gx = -6; gx <= 6; gx += 1) {
    if (gx === 0 && gz === 0 || publicV25RiverCellAtGrid(seed, gx, gz)
      || worldTileAtGrid(seed, gx, gz).terrain !== 'loam'
      || publicV25StratumAt(seed, gx, gz, 0).material !== 'soil') continue
    const x = gx * WORLD_CELL_METERS, z = gz * WORLD_CELL_METERS
    const support = publicV17StarterSupportAt({ seed, profile: head.state.generationProfile,
      route: head.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
      built: false, greenwayWorks: head.greenwayWorks }, { x, z })
    if (!support || support.kind !== 'ground') continue
    const tileId = `tile-${gx + 3}-${gz + 3}`
    const before = { ...head, state: { ...head.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(head.state.discoveryMask), tileId])].sort()),
      player: { ...head.state.player, position: { x, y: support.floorY, z },
        inventory: [...head.state.player.inventory, { itemId: 'field_spade' as const, quantity: 1 }],
        equipment: { ...head.state.player.equipment, mainHand: 'field_spade' as const } } } }
    const action = { kind: 'terrain-action/v1' as const,
      action: { kind: 'dig' as const, gx, gz } }
    const dug = replayPublicV43Witness(before, action)
    if (dug) return { before, dug, gx, gz }
  }
  throw new Error('No legal rewarded Greenway soil dig from fresh V43 progress')
}

describe('checked Greenway quest guidance', () => {
  it('completes First Excavation from a legal rewarded Greenway Terrain Dig', () => {
    const { before, dug, gx, gz } = rewardedGreenwayDig()
    expect(firstDig(before)).toMatchObject({ status: 'active',
      objective: expect.stringContaining('choose Terrain Dig, and tap clear, revealed dry loam') })
    expect(firstDig(dug)).toMatchObject({ status: 'complete',
      objective: expect.stringContaining('terrain-bag soil'),
      existingReward: expect.stringContaining('one soil unit in the terrain bag') })
    expect(dug.terrain.columns.find((column) => column.gx === gx && column.gz === gz))
      .toMatchObject({ openDepth: 1, rewardDepth: 1 })
    expect(dug.terrain.bag.soil).toBe(before.terrain.bag.soil + 1)
    expect(dug.state.player.skillXp.excavation)
      .toBe(before.state.player.skillXp.excavation + 30)
  })

  it('keeps First Excavation complete after the rewarded pit is filled', () => {
    const { dug, gx, gz } = rewardedGreenwayDig()
    const filled = replayPublicV43Witness(dug,
      { kind: 'terrain-action/v1', action: { kind: 'fill', gx, gz } })
    expect(filled).not.toBeNull()
    expect(filled!.terrain.columns.find((column) => column.gx === gx && column.gz === gz))
      .toMatchObject({ openDepth: 0, rewardDepth: 1 })
    expect(firstDig(filled!)).toMatchObject({ status: 'complete',
      objective: expect.stringContaining('even if its pit was filled') })
  })

  it('still completes First Excavation from a saved legacy Works dig', () => {
    const head = fresh()
    const legacy = { ...head, greenwayWorks: { ...head.greenwayWorks,
      dugTileIds: ['works3:dig:0:4'] } }
    expect(firstDig(legacy)).toMatchObject({ status: 'complete',
      objective: expect.stringContaining('backpack stone'),
      existingReward: expect.stringContaining('legacy Greenway Works dig') })
  })

  it('does not count rewarded columns outside Greenway or with a stone top layer', () => {
    const head = fresh(), seed = head.state.seed
    let outsideSoil: { gx: number; gz: number } | null = null
    let insideStone: { gx: number; gz: number } | null = null
    for (let gz = -7; gz <= 8; gz += 1) for (let gx = -7; gx <= 16; gx += 1) {
      const soil = publicV25StratumAt(seed, gx, gz, 0).material === 'soil'
      if (!outsideSoil && gx >= 9 && soil) outsideSoil = { gx, gz }
      if (!insideStone && gx <= 8 && !soil) insideStone = { gx, gz }
    }
    if (!outsideSoil || !insideStone) throw new Error('Missing boundary geology fixtures')
    for (const cell of [outsideSoil, insideStone]) {
      const projected = { ...head, terrain: { ...head.terrain,
        columns: [{ ...cell, openDepth: 1, rewardDepth: 1, pitLadder: false }] } }
      expect(firstDig(projected).status).toBe('active')
    }
  })

  it('keeps first-route timber and backpack use viable without optional purchases', () => {
    const head = fresh()
    const creek = resolvePublicV17GreenwaySite(head.state.seed,
      'works4:bridge:greenway-creek:-14')
    const ladder = resolvePublicV17GreenwaySite(head.state.seed,
      'works4:ladder:greenway-north-cliff:11')
    const river = resolvePublicV28RiverBridge(head.state.seed,
      'works6:river-bridge:-14')
    const costs = [creek?.kind === 'bridge' ? creek.logCost : null,
      ladder?.kind === 'ladder' ? ladder.logCost : null, river?.logCost]
    expect(costs).toEqual([8, 4, 8])
    if (costs.some((cost) => cost == null)) throw new Error('Missing starter route')
    expect(head.state.player.inventory).toEqual([{ itemId: 'woodcutters_axe', quantity: 1 }])
    expect(head.state.player.backpackCapacity).toBe(20)
    expect(head.state.player.coins).toBe(120)
    let carried = 1
    for (const cost of costs) {
      carried += cost!
      expect(carried).toBeLessThanOrEqual(head.state.player.backpackCapacity)
      carried -= cost!
    }
    expect(costs.reduce((total, cost) => total + cost!, 0)
      + GREENWAY_LOG_ORDER.quantity).toBe(6 * 4)
    const seeds = ['wizard-realms', 'greenway-alpha', 'region-0', 'starter-seed-17',
      ...Array.from({ length: 48 }, (_, index) => `resource-probe-${index}`)]
    for (const seed of seeds) {
      const trees = publicWorldV15ClearStarterResources(seed,
        createStarterCliffGreenwayFacts(seed).resources).filter((node) => node.kind === 'tree')
      const near = trees.filter((node) => node.position.z < 6 && node.position.z >= -5
        && Math.hypot(node.position.x, node.position.z) < 18
        && publicWorldV15StarterTileAtGrid(seed,
          Math.ceil(node.position.x / 4 - 0.5),
          Math.ceil(node.position.z / 4 - 0.5)).terrain !== 'wetland')
      expect(near.length, seed).toBeGreaterThanOrEqual(6)
    }
  })
  it('starts with the creek and stages timber before the optional log order', () => {
    const head = fresh()
    const original = structuredClone(head)
    const quests = projectPublicV43GreenwayQuestChain(head)
    expect(quests).toHaveLength(5)
    expect(quests[0]).toMatchObject({ id: 'creek-span/v1', status: 'active' })
    expect(quests[0].objective).toContain('Equip your woodcutter axe from Backpack')
    expect(quests[0].objective).toContain('Chop each nearby oak twice (4 logs per oak): 0/8 logs')
    expect(quests[0].objective).toContain('creek bridge to reach the dry far bank')
    expect(quests[0].existingReward).toContain('20 character XP, and 20 Woodcutting XP')
    expect(quests[0].objective).toContain('Boots let you run but are not required')
    expect(quests[0].objective).not.toContain('wet-ground travel')
    expect(quests[0].objective).not.toContain('buy leather boots')
    expect(quests[1]).toMatchObject({ id: 'north-cliff/v1', status: 'active' })
    expect(quests[4]).toMatchObject({ id: 'carpenter-order/v1', status: 'active' })
    expect(head.state.player.backpackCapacity).toBe(20)
    expect(head.state.player.inventory.reduce((sum, stack) => sum + stack.quantity, 0))
      .toBeGreaterThan(0)
    expect(quests[1].objective).toContain('After the creek bridge')
    expect(quests[4].objective).toContain('keep timber for the marked creek bridge (8 logs)')
    expect(quests[4].objective).toContain('The order is available now')
    expect(quests[4].objective).toContain('4 surplus logs')
    expect(quests[4].objective).not.toContain('Reserve 20 logs')
    expect(quests[4].existingReward).toContain('no character XP')
    expect(head).toEqual(original)
  })

  it('derives completion from the matching saved creek claim, with boots optional', () => {
    const head = fresh()
    const prepared = { ...head, state: { ...head.state,
      player: { ...head.state.player,
        inventory: [...head.state.player.inventory,
          { itemId: 'leather_boots' as const, quantity: 1 },
          { itemId: 'logs' as const, quantity: 8 }] } } }
    expect(projectPublicV43GreenwayQuestChain(prepared)[0].objective)
      .toContain('8/8 logs: find the marked creek bridge on Map / routes')
    const equipped = { ...prepared, state: { ...prepared.state,
      player: { ...prepared.state.player,
        equipment: { ...prepared.state.player.equipment, feet: 'leather_boots' as const } } } }
    expect(projectPublicV43GreenwayQuestChain(equipped)[0].objective)
      .toContain('B opens Works, 1 selects Bridge; confirm with F only when Ready')
    expect(projectPublicV43GreenwayQuestChain(equipped)[0].objective)
      .toBe(projectPublicV43GreenwayQuestChain(prepared)[0].objective)
    expect(projectPublicV43GreenwayQuestChain(equipped)[0].status).toBe('active')
    expect(projectPublicV43GreenwayQuestChain(equipped)[4].objective)
      .toContain('marked creek bridge (8 logs)')
    const oneOak = { ...head, state: { ...head.state,
      player: { ...head.state.player,
        inventory: [...head.state.player.inventory,
          { itemId: 'logs' as const, quantity: 4 }] } } }
    expect(projectPublicV43GreenwayQuestChain(oneOak)[0].objective)
      .toContain('4/8 logs')
    const axeEquipped = { ...oneOak, state: { ...oneOak.state,
      player: { ...oneOak.state.player, equipment: {
        ...oneOak.state.player.equipment, mainHand: 'woodcutters_axe' as const } } } }
    expect(projectPublicV43GreenwayQuestChain(axeEquipped)[0].objective)
      .not.toContain('Equip your woodcutter axe')
    expect(projectPublicV43GreenwayQuestChain(axeEquipped)[0].objective)
      .toContain('Chop each nearby oak twice (4 logs per oak): 4/8 logs')
    expect(projectPublicV43GreenwayQuestChain(oneOak)[1].objective)
      .toContain('After the creek bridge')

    const bridgeOnly = { ...equipped,
      state: { ...equipped.state, player: { ...equipped.state.player,
        inventory: equipped.state.player.inventory.filter((stack) =>
          stack.itemId !== 'logs') } },
      greenwayWorks: { ...head.greenwayWorks,
        builtBridgeIds: ['works4:bridge:greenway-creek:-14'] } }
    expect(projectPublicV43GreenwayQuestChain(bridgeOnly)[0]).toMatchObject({
      status: 'active', objective: expect.stringContaining('bridgehead reward'),
    })
    expect(projectPublicV43GreenwayQuestChain(bridgeOnly)[0].objective)
      .toContain('approach the River Works post, then Claim')
    expect(projectPublicV43GreenwayQuestChain(bridgeOnly)[4].objective)
      .toContain('marked north-cliff ladder (4 logs)')
    expect(projectPublicV43GreenwayQuestChain(bridgeOnly)[1].objective)
      .toContain('Chop another oak for at least 4 more logs')
    expect(projectPublicV43GreenwayQuestChain(bridgeOnly)[1].objective)
      .toContain('on the starting side of the creek')
    const bridgeWithLadderLogs = { ...bridgeOnly,
      state: { ...bridgeOnly.state, player: { ...bridgeOnly.state.player,
        inventory: [...bridgeOnly.state.player.inventory,
          { itemId: 'logs' as const, quantity: 4 }] } } }
    expect(projectPublicV43GreenwayQuestChain(bridgeWithLadderLogs)[1].objective)
      .toContain('on the starting side of the creek')
    const bridgeAndLadder = { ...bridgeOnly, greenwayWorks: {
      ...bridgeOnly.greenwayWorks,
      builtLadderIds: ['works4:ladder:greenway-north-cliff:11'],
    } }
    expect(projectPublicV43GreenwayQuestChain(bridgeAndLadder)[4].objective)
      .toContain('connected-river bridge (8 logs)')

    const river = resolvePublicV28RiverBridge('wizard-realms',
      'works6:river-bridge:-14')
    expect(river).not.toBeNull()
    const claimedElsewhere = { ...bridgeOnly, claimedBridgeheadId: river!.id,
      riverBridgeIds: [river!.id] }
    expect(projectPublicV43GreenwayQuestChain(claimedElsewhere)[0]).toMatchObject({
      status: 'closed', objective: expect.stringContaining('claimed at another bridge'),
    })
    expect(projectPublicV43GreenwayQuestChain(claimedElsewhere)[0].existingReward)
      .toContain('already used at another bridge')

    const advanced = { ...head,
      greenwayWorks: { ...head.greenwayWorks,
        builtBridgeIds: ['works4:bridge:greenway-creek:-14'],
        builtLadderIds: ['works4:ladder:greenway-north-cliff:11'],
        dugTileIds: ['works3:dig:0:4'] },
      claimedBridgeheadId: 'works4:bridge:greenway-creek:-14',
      riverBridgeIds: [river!.id],
      greenwayOrder: { claimedAtSequence: 3 },
      state: { ...head.state, eventSequence: 3,
        greenway: { ...head.state.greenway,
          studiedInscriptionIds: ['greenway_waystone' as const] } } }
    expect(projectPublicV43GreenwayQuestChain(advanced)
      .map((quest) => quest.status)).toEqual(Array(5).fill('complete'))
  })

  it('asks for pack room before either four-log oak harvest', () => {
    const head = fresh()
    const crowded = { ...head, state: { ...head.state,
      player: { ...head.state.player,
        inventory: [...head.state.player.inventory,
          { itemId: 'logs' as const, quantity: 4 },
          { itemId: 'stone' as const, quantity: 12 }] } } }
    expect(projectPublicV43GreenwayQuestChain(crowded)[0].objective)
      .toMatch(/^Free 1 backpack space before chopping an oak\./)
    expect(projectPublicV43GreenwayQuestChain(crowded)[0].objective)
      .toContain('Greenway Outfitters offers 8 more spaces for 70 coins')
    const withTerrainBag = { ...crowded,
      terrain: { ...crowded.terrain, bag: { ...crowded.terrain.bag, soil: 2 } } }
    expect(projectPublicV43GreenwayQuestChain(withTerrainBag)[0].objective)
      .toMatch(/^Free 3 backpack spaces before chopping an oak\./)
    const withListing = { ...crowded, state: { ...crowded.state,
      player: { ...crowded.state.player,
        tradeSlots: [
          { ...crowded.state.player.tradeSlots[0], itemId: 'stone' as const,
            quantity: 1, unitPrice: 1 },
          crowded.state.player.tradeSlots[1],
          crowded.state.player.tradeSlots[2],
          crowded.state.player.tradeSlots[3],
        ] as typeof crowded.state.player.tradeSlots } } }
    expect(projectPublicV43GreenwayQuestChain(withListing)[0].objective)
      .toMatch(/^Free 2 backpack spaces before chopping an oak\./)
    const afterCreek = { ...crowded, state: { ...crowded.state,
      player: { ...crowded.state.player,
        inventory: [...head.state.player.inventory,
          { itemId: 'stone' as const, quantity: 16 }] } },
    greenwayWorks: { ...head.greenwayWorks,
      builtBridgeIds: ['works4:bridge:greenway-creek:-14'] } }
    expect(projectPublicV43GreenwayQuestChain(afterCreek)[1].objective)
      .toMatch(/^Free 1 backpack space before chopping an oak\./)
    const noRoom = { ...crowded, state: { ...crowded.state,
      player: { ...crowded.state.player,
        inventory: [...head.state.player.inventory,
          { itemId: 'logs' as const, quantity: 4 },
          { itemId: 'stone' as const, quantity: 15 }] } } }
    expect(projectPublicV43GreenwayQuestChain(noRoom)[0].objective)
      .toMatch(/^Free 4 backpack spaces before chopping an oak\./)
  })

  it('does not offer the one-time bag upgrade after a checked purchase fills again', () => {
    const head = fresh()
    const store = head.state.greenway.stores.find((entry) =>
      entry.id === GREENWAY_BAG_UPGRADE.storeId)!
    const atStore = { ...head, state: { ...head.state, player: {
      ...head.state.player, position: { ...store.position } } } }
    const purchased = replayPublicV43Witness(atStore,
      { kind: 'buy-greenway-backpack/v1' })!
    expect(purchased.state.player.backpackCapacity).toBe(GREENWAY_BAG_UPGRADE.upgradedCapacity)
    expect(purchased.greenwayBagUpgrade?.claimedAtSequence).toBeGreaterThanOrEqual(1)
    const carried = purchased.state.player.inventory.reduce((sum, stack) =>
      sum + stack.quantity, 0)
    const fullAgain = { ...purchased, state: { ...purchased.state, player: {
      ...purchased.state.player, inventory: [...purchased.state.player.inventory,
        { itemId: 'logs' as const, quantity: 4 },
        { itemId: 'stone' as const,
          quantity: GREENWAY_BAG_UPGRADE.upgradedCapacity - carried - 4 }] } } }
    expect(fullAgain.state.player.inventory.reduce((sum, stack) =>
      sum + stack.quantity, 0)).toBe(GREENWAY_BAG_UPGRADE.upgradedCapacity)
    const original = structuredClone(fullAgain)
    const objective = projectPublicV43GreenwayQuestChain(fullAgain)[0].objective
    expect(objective).toMatch(/^Free 4 backpack spaces before chopping an oak\./)
    expect(objective).not.toContain('Greenway Outfitters offers')
    expect(fullAgain).toEqual(original)
  })

  it('guides later care visits without presenting a mount or payout before maturity', () => {
    const head = fresh()
    expect(projectPublicV43QuestContinuation(head).familiar.stage).toBe('cross')
    const claimed = { ...head, southbankReached: true,
      familiar: { ...head.familiar, phase: 'claimed' as const } }
    const keeper = projectPublicV43QuestContinuation({ ...claimed,
      familiar: { ...claimed.familiar, phase: 'returned' as const } }).familiar
    expect(keeper.stage).toBe('claim')
    expect(keeper.objective).toContain('cannot be ridden in this preview')
    expect(keeper.objective).not.toContain('yet')
    const beforeCare = projectPublicV43QuestContinuation(claimed).familiar
    expect(beforeCare).toMatchObject({ stage: 'care',
      objective: expect.stringContaining('3 more care visits') })
    expect(beforeCare.objective).toContain('Rescue complete.')
    expect(beforeCare.objective).toContain('one marsh herb per visit')
    expect(beforeCare.objective).toContain('explore and return')
    expect(beforeCare.objective).toContain('cannot be ridden in this preview')
    expect(beforeCare.objective).not.toContain('ticks')
    expect(beforeCare.existingReward).toContain('care gives no additional coins')
    expect(beforeCare.existingReward).toContain('10, 10, and 20 Creature Care XP')
    const twoCares = { ...claimed, mountTraining: { careWitnesses: [
      { kind: 'sedgehorn-care/v1' as const, tick: 0, eventSequence: 1 },
      { kind: 'sedgehorn-care/v1' as const, tick: 600, eventSequence: 2 },
    ] } }
    const oneLeft = projectPublicV43QuestContinuation(twoCares).familiar.objective
    expect(oneLeft).toContain('1 more care visit at the station')
    expect(oneLeft).toContain('one marsh herb per visit')
    expect(oneLeft).not.toContain('ticks')
    const mature = { ...twoCares, mountTraining: { careWitnesses: [
      ...twoCares.mountTraining.careWitnesses,
      { kind: 'sedgehorn-care/v1' as const, tick: 1200, eventSequence: 3 },
    ] } }
    const ready = projectPublicV43QuestContinuation(mature).familiar
    expect(ready.stage).toBe('mount-ready')
    expect(ready.objective).toContain('All three care visits are recorded.')
    expect(ready.objective).toContain('cannot be ridden in this preview')
    expect(ready.objective).not.toContain('Ground mounting')
    expect(ready.objective).not.toContain('ticks')
  })
})
