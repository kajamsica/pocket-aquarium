import { isDiscoveryMaskSubset } from './discoveryMask'
import type { PublicV13Head } from './publicWorldV13Snapshot'

const allIn = <T,>(before: readonly T[], after: readonly T[]) =>
  before.every((entry) => after.includes(entry))

/** History that cannot be undone by any public v13 action or older source. */
export function preservesPublicV13History(before: PublicV13Head['state'],
  after: PublicV13Head['state']): boolean {
  const old = before.mireglass, next = after.mireglass
  const greenway = before.greenway, laterGreenway = after.greenway
  return before.tick <= after.tick && before.eventSequence <= after.eventSequence
    && isDiscoveryMaskSubset(before.discoveryMask, after.discoveryMask)
    && before.fieldCampTileIds.length <= after.fieldCampTileIds.length
    && before.fieldCampTileIds.every((id, index) => id === after.fieldCampTileIds[index])
    && allIn(before.player.discoveredRingIds, after.player.discoveredRingIds)
    && allIn(before.player.learnedSpellIds, after.player.learnedSpellIds)
    && before.player.xp <= after.player.xp
    && Object.entries(before.player.skillXp).every(([key, xp]) =>
      xp <= after.player.skillXp[key as keyof typeof before.player.skillXp])
    && allIn(greenway.builtRouteIds, laterGreenway.builtRouteIds)
    && allIn(greenway.unlockedRecipeIds, laterGreenway.unlockedRecipeIds)
    && allIn(greenway.studiedInscriptionIds, laterGreenway.studiedInscriptionIds)
    && allIn(greenway.revealedDigSiteIds, laterGreenway.revealedDigSiteIds)
    && allIn(greenway.excavatedDigSiteIds, laterGreenway.excavatedDigSiteIds)
    && greenway.routes.every((route, index) => route.siteId === null
      || route.siteId === laterGreenway.routes[index]?.siteId)
    && greenway.resources.every((resource, index) => {
      const later = laterGreenway.resources[index]
      return resource.id === later?.id && resource.health >= later.health
        && (!resource.depleted || later.depleted)
    })
    && greenway.stores.every((store, index) => store.listings.every((listing, listingIndex) =>
      listing.id === laterGreenway.stores[index]?.listings[listingIndex]?.id
      && listing.stock >= laterGreenway.stores[index].listings[listingIndex].stock))
    && old.shopStock.field_spade >= next.shopStock.field_spade
    && old.shopStock['mireglass_reach/item/waders'] >= next.shopStock['mireglass_reach/item/waders']
    && allIn(old.depletedResourceIds, next.depletedResourceIds)
    && allIn(old.dugStumpIds, next.dugStumpIds)
    && (old.builtRoutes.bridge === null || old.builtRoutes.bridge === next.builtRoutes.bridge)
    && (old.builtRoutes.ladder === null || old.builtRoutes.ladder === next.builtRoutes.ladder)
    && (!old.fringeMarkerStudied || next.fringeMarkerStudied)
    && (!old.cacheRevealed || next.cacheRevealed)
    && (!old.cacheExcavated || next.cacheExcavated)
    && (!before.highland.landmarkDiscovered || after.highland.landmarkDiscovered)
    && before.highland.stoneNodes.length === after.highland.stoneNodes.length
    && before.highland.stoneNodes.every((node, index) =>
      node.id === after.highland.stoneNodes[index]?.id
      && node.readyAtTick <= after.highland.stoneNodes[index].readyAtTick)
    && (!before.windstep.learned || after.windstep.learned)
    && before.windstep.activeUntilTick <= after.windstep.activeUntilTick
    && before.windstep.nextCastTick <= after.windstep.nextCastTick
    && allIn(before.windstep.practicedRouteIndices, after.windstep.practicedRouteIndices)
    && allIn(before.terrainWorks.builtWorkIds, after.terrainWorks.builtWorkIds)
    && allIn(before.terrainWorks.dugTileIds, after.terrainWorks.dugTileIds)
    && old.herbHarvestCycles.every((entry) =>
      next.herbHarvestCycles.some((later) => later.patchId === entry.patchId
        && later.cycle >= entry.cycle))
}
