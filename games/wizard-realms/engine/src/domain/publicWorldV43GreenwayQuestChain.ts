import { backpackSlotsAfterAdd } from './backpackSlots'
import { publicV16InsideGreenway } from './publicWorldV16GreenwaySites'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { publicV25StratumAt } from './publicWorldV25Strata'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import { WORLD_CELL_METERS } from './worldChunks'
import { GREENWAY_BAG_UPGRADE } from './publicWorldV43BagUpgrade'
import { SEDGEHORN_CARES_TO_MATURE }
  from './publicWorldV43MountTraining'
import type { PublicV43Progress } from './publicWorldV43Snapshot'

export type GreenwayQuest = Readonly<{
  id: 'creek-span/v1' | 'north-cliff/v1' | 'waystone/v1'
    | 'first-excavation/v1' | 'carpenter-order/v1'
  title: string
  status: 'active' | 'complete' | 'closed'
  objective: string
  existingReward: string
}>

export type GreenwayQuestContinuation = Readonly<{
  familiar: Readonly<{
    id: 'sedgehorn-familiar/v1'
    stage: 'cross' | 'track' | 'feed' | 'prepare' | 'escort' | 'claim'
      | 'care' | 'mount-ready'
    objective: string
    existingReward: string
  }>
}>

const connectedRiverBuilt = (progress: Pick<PublicV43Progress,
  'state' | 'riverBridgeIds'>) => progress.riverBridgeIds.some((id) =>
  resolvePublicV28RiverBridge(progress.state.seed, id) !== null)

/** Guidance from a checked V43 head. It does not claim or award anything. */
export function projectPublicV43GreenwayQuestChain(
  progress: Pick<PublicV43Progress, 'state' | 'greenwayWorks'
    | 'terrain' | 'claimedBridgeheadId' | 'greenwayOrder' | 'greenwayBagUpgrade'
    | 'riverBridgeIds'>):
  readonly GreenwayQuest[] {
  const { state, greenwayWorks } = progress
  const { player } = state
  const logs = player.inventory.reduce((total, stack) =>
    total + (stack.itemId === 'logs' ? stack.quantity : 0), 0)
  const bagCount = Object.values(progress.terrain.bag).reduce((total, quantity) => total + quantity, 0)
  const oakRoom = Math.max(0, backpackSlotsAfterAdd(player.inventory,
    player.tradeSlots, 'logs', 4, bagCount) - player.backpackCapacity)
  const bagOffer = player.backpackCapacity === GREENWAY_BAG_UPGRADE.initialCapacity
    && progress.greenwayBagUpgrade?.claimedAtSequence == null
    ? ` Greenway Outfitters offers ${GREENWAY_BAG_UPGRADE.extraSlots} more spaces for ${GREENWAY_BAG_UPGRADE.price} coins.` : ''
  const makeOakRoom = oakRoom > 0
    ? `Free ${oakRoom} backpack ${oakRoom === 1 ? 'space' : 'spaces'} before chopping an oak.${bagOffer} ` : ''
  const built = (ids: readonly string[], kind: 'bridge' | 'ladder') => ids.some((id) => {
    const site = resolvePublicV17GreenwaySite(state.seed, id)
    return site?.kind === kind && site.obstacle ===
      (kind === 'bridge' ? 'greenway_creek' : 'greenway_north_cliff')
  })
  const creekBridgeIds = greenwayWorks.builtBridgeIds.filter((id) =>
    resolvePublicV17GreenwaySite(state.seed, id)?.obstacle === 'greenway_creek')
  const bridgeBuilt = creekBridgeIds.length > 0
  const bridgeheadClaimed = progress.claimedBridgeheadId !== null
    && creekBridgeIds.includes(progress.claimedBridgeheadId)
  const bridgeheadClaimedElsewhere = progress.claimedBridgeheadId !== null
    && !bridgeheadClaimed
  const ladderBuilt = state.greenway.builtRouteIds.includes('greenway_ladder')
    || built(greenwayWorks.builtLadderIds, 'ladder')
  const waystoneStudied = state.greenway.studiedInscriptionIds
    .includes('greenway_waystone')
  const legacyDigDone = greenwayWorks.dugTileIds.some((id) =>
    resolvePublicV17GreenwaySite(state.seed, id)?.kind === 'dig')
  const terrainDigDone = progress.terrain.columns.some(({ gx, gz, rewardDepth }) =>
    rewardDepth > 0
    && publicV16InsideGreenway({ x: gx * WORLD_CELL_METERS, z: gz * WORLD_CELL_METERS })
    && publicV25StratumAt(state.seed, gx, gz, 0).material === 'soil')
  const firstDigDone = legacyDigDone || terrainDigDone
  const orderClaimed = progress.greenwayOrder?.claimedAtSequence != null
  const bridgeObjective = logs < 8
    ? `${makeOakRoom}${player.equipment.mainHand === 'woodcutters_axe' ? '' : 'Equip your woodcutter axe from Backpack. '}Chop each nearby oak twice (4 logs per oak): ${logs}/8 logs. Keep them for the creek bridge to reach the dry far bank. Boots let you run but are not required.`
    : '8/8 logs: find the marked creek bridge on Map / routes. B opens Works, 1 selects Bridge; confirm with F only when Ready. Cross to its dry far bank. Boots are optional.'
  // The Ledger route also needs a separate connected-river bridge and a mined
  // terrain-bag stone; a first Greenway soil dig does not supply that sample.
  const nextRoute = !bridgeBuilt ? 'marked creek bridge (8 logs)'
    : !ladderBuilt ? 'marked north-cliff ladder (4 logs)'
      : !connectedRiverBuilt(progress) ? 'connected-river bridge (8 logs)' : null
  const orderObjective = nextRoute
    ? `Optional: keep timber for the ${nextRoute} before delivering 4 surplus logs to Greenway Outfitters. The order is available now, but the route needs its own logs.`
    : logs < 4
      ? `${makeOakRoom}Chop another oak for 4 logs, then deliver 4 surplus logs to Greenway Outfitters for the optional order.`
      : 'Deliver 4 surplus logs to Greenway Outfitters for the one-time carpenter order.'

  return [
    { id: 'creek-span/v1', title: 'Creek Span',
      status: bridgeBuilt && bridgeheadClaimed ? 'complete'
        : bridgeBuilt && bridgeheadClaimedElsewhere ? 'closed' : 'active',
      objective: bridgeBuilt
        ? !bridgeheadClaimed
          ? !bridgeheadClaimedElsewhere
            ? 'Cross the saved deck to the dry far bank, approach the River Works post, then Claim the one-time bridgehead reward: a basic pick, or 35 coins if already owned.'
            : 'The creek bridge is built. The one-time bridgehead reward was claimed at another bridge, so no creek claim remains.'
          : 'The creek bridge is built and the bridgehead reward has been claimed.'
        : bridgeObjective,
      existingReward: bridgeheadClaimedElsewhere
        ? 'Each felled oak grants 4 logs, 20 character XP, and 20 Woodcutting XP. Building grants 80 character XP and 80 Construction XP. The one-time bridgehead reward was already used at another bridge.'
        : 'Each felled oak grants 4 logs, 20 character XP, and 20 Woodcutting XP. Building grants 80 character XP and 80 Construction XP. An available bridgehead claim grants a basic pick, or 35 coins if already owned.' },
    { id: 'north-cliff/v1', title: 'North Cliff',
      status: ladderBuilt ? 'complete' : 'active',
      objective: ladderBuilt ? 'The marked north-cliff ladder is built.'
        : !bridgeBuilt ? 'After the creek bridge, gather 4 logs for the marked north-cliff ladder.'
          : logs < 4 ? `${makeOakRoom}Chop another oak for at least ${4 - logs} more logs, then build the marked north-cliff ladder on the starting side of the creek with 4 logs.`
            : 'Build the marked north-cliff ladder on the starting side of the creek with 4 logs.',
      existingReward: 'Building grants 60 character XP and 60 Construction XP.' },
    { id: 'waystone/v1', title: 'Waystone Spark',
      status: waystoneStudied ? 'complete' : 'active',
      objective: waystoneStudied
        ? 'Wayfinder Glow is learned. Cast it near undiscovered tiles to reveal the route.'
        : 'Find and study the Greenway waystone to learn Wayfinder Glow.',
      existingReward: 'The study teaches Wayfinder Glow. Revealing new tiles with it grants Wayfinding and Spellcraft XP.' },
    { id: 'first-excavation/v1', title: 'First Excavation',
      status: firstDigDone ? 'complete' : 'active',
      objective: firstDigDone
        ? terrainDigDone
          ? 'Your Greenway Terrain Dig is recorded, even if its pit was filled. Its terrain-bag soil is not the later Ledger stone sample.'
          : 'Your legacy Greenway Works dig is recorded. Its backpack stone is not the later Ledger terrain-bag stone sample.'
        : 'Equip a field spade (sold at Greenway Outfitters if needed), choose Terrain Dig, and tap clear, revealed dry loam within 5 m in Greenway. The later Ledger needs a mined terrain-bag stone sample.',
      existingReward: terrainDigDone || !legacyDigDone
        ? 'A rewarded Greenway Terrain Dig grants 30 character XP, 30 Excavation XP, and one soil unit in the terrain bag.'
        : 'A legacy Greenway Works dig granted 30 character XP, 30 Excavation XP, and one backpack stone.' },
    { id: 'carpenter-order/v1', title: 'Carpenter Order',
      status: orderClaimed ? 'complete' : 'active',
      objective: orderClaimed ? 'The one-time carpenter order is fulfilled.'
        : orderObjective,
      existingReward: 'The current one-time order pays 10 coins and no character XP.' },
  ]
}

/** Checked familiar facts, displayed as a lead rather than a new payout. */
export function projectPublicV43QuestContinuation(
  progress: Pick<PublicV43Progress, 'southbankReached' | 'familiar'
    | 'mountTraining'>):
  GreenwayQuestContinuation {
  const phase = progress.familiar.phase
  const careCount = progress.mountTraining?.careWitnesses.length ?? 0
  const familiar = !progress.southbankReached
    ? { stage: 'cross' as const,
      objective: 'Repair and record the Waystation crossing before searching for the sedgehorn.' }
    : phase === 'search'
      ? { stage: 'track' as const, objective: 'Find the sedgehorn tracks.' }
      : phase === 'tracks'
        ? { stage: 'feed' as const, objective: 'Offer one marsh herb at the shelter.' }
        : phase === 'fed'
          ? { stage: 'prepare' as const,
            objective: 'Choose a two-log shelter or the dry approach before escorting the sedgehorn.' }
          : phase === 'route-ready' || phase === 'escort'
            ? { stage: 'escort' as const,
              objective: 'Escort the sedgehorn safely to its keeper and record the return.' }
            : phase === 'returned'
              ? { stage: 'claim' as const,
                objective: 'Claim the one-time keeper reward. The sedgehorn cannot be ridden in this preview.' }
              : careCount < SEDGEHORN_CARES_TO_MATURE
                ? { stage: 'care' as const,
                  objective: `Rescue complete. Make ${SEDGEHORN_CARES_TO_MATURE - careCount} more care ${SEDGEHORN_CARES_TO_MATURE - careCount === 1 ? 'visit' : 'visits'} at the station, using one marsh herb per visit. If it is too soon, explore and return. The sedgehorn cannot be ridden in this preview.` }
                : { stage: 'mount-ready' as const,
                  objective: 'All three care visits are recorded. The sedgehorn is mature, but cannot be ridden in this preview.' }
  return { familiar: { id: 'sedgehorn-familiar/v1', ...familiar,
    existingReward: 'Feeding, route choice, and keeper claim record 10, 10, and 20 Creature Care XP in the familiar record. The keeper claim also grants 25 coins and 40 character XP. Each accepted care visit adds one of three maturity marks; care gives no additional coins or character XP.' } }
}
