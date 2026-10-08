import { toViewProjection } from './App'
import { mireglassViewProjection } from './MireglassPlayableApp'
import { MIREGLASS_CONTENT_REVISION } from './domain/mireglassContent'
import type { MireglassWorldRuntime, MireglassWorldState } from './domain/mireglassWorld'
import type { PublicWorldState } from './domain/publicWorldState'
import { createStreamedWorldFromState } from './domain/streamedWorld'
import type { PlayerState, WizardWorldState } from './domain/types'
import type { WizardItemStack, WizardViewProjection } from './view/contracts'

const V6_ITEM_NAMES: Readonly<Record<string, string>> = {
  'mireglass_reach/item/seal': 'Mireglass seal',
  'mireglass_reach/item/waders': 'Fen waders',
}

function namedV6Stack(stack: WizardItemStack | null): WizardItemStack | null {
  if (!stack || !V6_ITEM_NAMES[stack.itemId]) return stack
  return {
    ...stack, name: V6_ITEM_NAMES[stack.itemId],
    ...(stack.itemId === 'mireglass_reach/item/waders' ? { equippableSlots: ['feet'] as const } : {}),
  }
}

/** Reassemble a transient read model, never another mutable or persisted player. */
function greenwayView(state: PublicWorldState, messages: readonly string[],
  selectedSiteId: string | null, openStoreId: string | null): WizardViewProjection {
  const world: WizardWorldState = {
    ...state.greenway, seed: state.seed, generationProfile: state.generationProfile,
    tick: state.tick, rng: state.rng, eventSequence: state.eventSequence,
    player: state.player as PlayerState,
    discoveredTileIds: [...state.discoveredTileIds],
  }
  const projection = toViewProjection(world, messages.map((text, id) => ({ id, text })),
    openStoreId, selectedSiteId)
  const tradeListing = (index: 0 | 1 | 2 | 3) => {
    const listing = projection.tradeListings[index]
    return listing ? { ...listing,
      itemName: V6_ITEM_NAMES[state.player.tradeSlots[index].itemId ?? ''] ?? listing.itemName } : null
  }
  return {
    ...projection,
    backpack: { ...projection.backpack, stacks: projection.backpack.stacks.map((stack) => namedV6Stack(stack)!) },
    equipment: {
      head: namedV6Stack(projection.equipment.head), chest: namedV6Stack(projection.equipment.chest),
      legs: namedV6Stack(projection.equipment.legs), feet: namedV6Stack(projection.equipment.feet),
      mainHand: namedV6Stack(projection.equipment.mainHand), offHand: namedV6Stack(projection.equipment.offHand),
    },
    tradeListings: [tradeListing(0), tradeListing(1), tradeListing(2), tradeListing(3)],
  }
}

/** Only the tile-read methods are supplied to the existing Mireglass projection. */
function mireglassView(state: PublicWorldState, messages: readonly string[],
  selectedSiteId: string | null): WizardViewProjection {
  const streamed = createStreamedWorldFromState({
    seed: state.seed, tick: state.tick, discoveredTileIds: [...state.discoveredTileIds],
    player: {
      position: state.player.position, yaw: state.player.yaw, pitch: state.player.pitch,
      verticalVelocity: state.player.verticalVelocity,
    },
  })
  const tileReader = {
    activeTiles: () => streamed.activeTiles(),
    tileAtWorld: (x: number, z: number) => streamed.tileAtWorld(x, z),
  }
  const world: MireglassWorldState = {
    seed: state.seed, contentRevision: MIREGLASS_CONTENT_REVISION, tick: state.tick,
    player: state.player, discoveredTileIds: state.discoveredTileIds, expedition: state.mireglass,
  }
  // mireglassViewProjection reads exactly these two tile methods; it never calls advance or act.
  return mireglassViewProjection(tileReader as MireglassWorldRuntime, world, messages, selectedSiteId)
}

/** One public player and facts projected through the existing region-specific view adapters. */
export function publicWorldViewProjection(state: PublicWorldState, messages: readonly string[],
  selectedSiteId: string | null, openStoreId: string | null = null): WizardViewProjection {
  return state.movementOwner === 'greenway'
    ? greenwayView(state, messages, selectedSiteId, openStoreId)
    : mireglassView(state, messages, selectedSiteId)
}
