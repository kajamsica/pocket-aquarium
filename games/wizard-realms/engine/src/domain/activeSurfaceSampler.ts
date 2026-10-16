import { createPublicV23SurfaceSampler } from './publicWorldV14Terrain'
import type { PublicV31Progress } from './publicWorldV31Migration'

/** A V31 batch's streamed carrier surface; V31 effective pit, deck, and soil pose stays canonical. */
export function createActiveSurfaceSampler(progress: Pick<PublicV31Progress,
  'state' | 'regionalWorks'>) {
  return createPublicV23SurfaceSampler(progress.state, progress.regionalWorks.builtLadderIds)
}
