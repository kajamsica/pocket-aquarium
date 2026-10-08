import { createGeneratedWorld } from './generation'
import { createMireglassRegionProgress } from './mireglassExpedition'
import type { MireglassRegionProgress, MireglassV6Player } from './mireglassExpedition'
import { parsePublicV6BootstrapRoot, publicWorldCompatibility } from './publicWorldV6'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { restoreWizardWorld } from './persistence'
import type { GenerationProfile, WizardWorldState } from './types'

type GreenwayFacts = Omit<WizardWorldState,
  'seed' | 'generationProfile' | 'tick' | 'rng' | 'eventSequence' | 'player' | 'discoveredTileIds'>

/** In-memory construction state, not a playable runtime or a v6 persistence schema. */
export interface PublicWorldState {
  readonly seed: string
  readonly generationProfile: GenerationProfile
  readonly tick: number
  readonly rng: WizardWorldState['rng']
  readonly eventSequence: number
  readonly player: MireglassV6Player
  readonly discoveredTileIds: readonly string[]
  readonly greenway: Readonly<GreenwayFacts>
  readonly mireglass: MireglassRegionProgress
}

function fromGreenway(world: WizardWorldState): PublicWorldState {
  const { seed, generationProfile, tick, rng, eventSequence, player, discoveredTileIds, ...greenway } = world
  return {
    seed, generationProfile, tick, rng, eventSequence,
    player, discoveredTileIds, greenway,
    mireglass: createMireglassRegionProgress(seed),
  }
}

/** Restores every normalized Greenway fact, including the saved pose, without retaining a second active player. */
export function createPublicWorldFromBootstrap(root: PublicV6BootstrapRoot): PublicWorldState {
  let bytes: string | undefined
  try { bytes = JSON.stringify(root) } catch { throw new RangeError('Invalid public v6 bootstrap root.') }
  if (!bytes) throw new RangeError('Invalid public v6 bootstrap root.')
  const verified = parsePublicV6BootstrapRoot(bytes)
  if (!verified) throw new RangeError('Invalid or incompatible public v6 bootstrap root.')
  return fromGreenway(restoreWizardWorld(verified.greenwaySaveBytes))
}

/** A fresh public journey starts at the original Greenway origin, not the dev frontier marker. */
export function createFreshPublicWorld(seed: string, profile: GenerationProfile): PublicWorldState {
  if (typeof seed !== 'string' || !seed
    || (profile !== 'greenway-classic-v1' && profile !== 'greenway-expanded-v1')) {
    throw new RangeError('Invalid public v6 seed or Greenway profile.')
  }
  const world = createGeneratedWorld(seed, profile)
  const issue = publicWorldCompatibility(world)
  if (issue) throw new RangeError(`Public v6 content is incompatible: ${issue}.`)
  return fromGreenway(world)
}
