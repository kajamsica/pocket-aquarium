import { describe, expect, it } from 'vitest'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import { GREENWAY_BAG_UPGRADE } from './publicWorldV43BagUpgrade'
import { createFreshPublicV43Root, replayPublicV43Witness }
  from './publicWorldV43Snapshot'
import { projectPublicV43GreenwayQuestChain, projectPublicV43QuestContinuation }
  from './publicWorldV43GreenwayQuestChain'

const fresh = () => createFreshPublicV43Root('wizard-realms').head

describe('checked Greenway quest guidance', () => {
  it('starts with the creek and stages timber before the optional log order', () => {
    const head = fresh()
    const original = structuredClone(head)
    const quests = projectPublicV43GreenwayQuestChain(head)
    expect(quests).toHaveLength(5)
    expect(quests[0]).toMatchObject({ id: 'creek-span/v1', status: 'active' })
    expect(quests[0].objective).toContain('Equip your woodcutter axe from Backpack')
    expect(quests[0].objective).toContain('Chop nearby oaks (4 logs per oak), pressing E twice on each: 0/8 logs')
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
      .toContain('Chop nearby oaks (4 logs per oak), pressing E twice on each: 4/8 logs')
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
    const beforeCare = projectPublicV43QuestContinuation(claimed).familiar
    expect(beforeCare).toMatchObject({ stage: 'care',
      objective: expect.stringContaining('3 more care visits') })
    expect(beforeCare.objective).toContain('600 ticks')
    expect(beforeCare.existingReward).toContain('care gives no additional coins')
    expect(beforeCare.existingReward).toContain('10, 10, and 20 Creature Care XP')
    const twoCares = { ...claimed, mountTraining: { careWitnesses: [
      { kind: 'sedgehorn-care/v1' as const, tick: 0, eventSequence: 1 },
      { kind: 'sedgehorn-care/v1' as const, tick: 600, eventSequence: 2 },
    ] } }
    expect(projectPublicV43QuestContinuation(twoCares).familiar.objective)
      .toContain('1 more care visit')
    const mature = { ...twoCares, mountTraining: { careWitnesses: [
      ...twoCares.mountTraining.careWitnesses,
      { kind: 'sedgehorn-care/v1' as const, tick: 1200, eventSequence: 3 },
    ] } }
    expect(projectPublicV43QuestContinuation(mature).familiar.stage)
      .toBe('mount-ready')
  })
})
