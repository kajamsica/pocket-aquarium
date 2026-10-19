import { createFreshPublicV14State, requiredPublicV14EarnedXpMinima,
  validatePublicV14State } from './publicWorldV14Validation'
import type { PublicV14State } from './publicWorldV14Snapshot'
import { publicV15StarterPoseValid } from './publicWorldV15StarterMovement'
import { publicWorldV15SuppressedStarterResourceIds } from './publicWorldV15StarterSites'
import type { PublicV15StarterWorks } from './publicWorldV15Snapshot'
import { starterCliffSupportAt } from './starterCliffMovement'

export type PublicV15Progress = Readonly<{
  state: PublicV14State
  starterWorks: PublicV15StarterWorks
}>

const exactWorks = (value: unknown): value is PublicV15StarterWorks => {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype
      || Reflect.ownKeys(value).length !== 2) return false
    return (['bridgeBuilt', 'bankCacheDug'] as const).every((key) => {
      const field = Object.getOwnPropertyDescriptor(value, key)
      return !!field?.enumerable && Object.hasOwn(field, 'value')
        && typeof field.value === 'boolean'
    })
  } catch { return false }
}

/** A starter work cannot be erased by a later frame, action or saved head. */
export function preservesPublicV15StarterWorks(before: unknown, after: unknown): boolean {
  return exactWorks(before) && exactWorks(after)
    && (!before.bridgeBuilt || after.bridgeBuilt)
    && (!before.bankCacheDug || after.bankCacheDug)
}

/**
 * V14 proves the unchanged core fields at a projected v14 floor. That projected
 * pose is never returned or played: the actual pose must satisfy the v15
 * creek/bridge/dig support. Suppressed resources remain in the v14 core and
 * must retain their canonical unharvested state.
 */
export function decodePublicV15Progress(value: unknown, expectedSeed: string): PublicV15Progress | null {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype
      || Reflect.ownKeys(value).length !== 2
      || !Object.hasOwn(value, 'state') || !Object.hasOwn(value, 'starterWorks')) return null
    const raw = value as Record<string, unknown>
    if (!exactWorks(raw.starterWorks)) return null
    const owned = structuredClone(value) as PublicV15Progress
    if (!exactWorks(owned.starterWorks) || typeof expectedSeed !== 'string'
      || !expectedSeed || expectedSeed.length > 128
      || owned.state?.seed !== expectedSeed) return null
    const state = owned.state
    const route = state.greenway?.routes?.find((entry) => entry.id === 'greenway_ladder') ?? null
    const context = { seed: expectedSeed, profile: state.generationProfile,
      route, built: state.greenway?.builtRouteIds?.includes('greenway_ladder') ?? false,
      starterWorks: owned.starterWorks }
    let coreInput: PublicV14State = state
    if (state.movementOwner === 'greenway') {
      if (!publicV15StarterPoseValid(context, state.player.position,
        state.player.verticalVelocity)) return null
      const oldSupport = starterCliffSupportAt(context, state.player.position)
      if (!oldSupport) return null
      coreInput = { ...state, player: { ...state.player,
        position: { ...state.player.position, y: oldSupport.floorY } } }
    }
    if (!validatePublicV14State(coreInput, expectedSeed)) return null
    const canonical = createFreshPublicV14State(expectedSeed).greenway.resources
    const suppressed = publicWorldV15SuppressedStarterResourceIds(expectedSeed, canonical)
    const byId = new Map(state.greenway.resources.map((resource) => [resource.id, resource]))
    if (suppressed.some((id) => {
      const initial = canonical.find((resource) => resource.id === id)
      const current = byId.get(id)
      return !initial || !current || current.health !== initial.health
        || current.depleted !== initial.depleted
    })) return null
    const bridgeXp = owned.starterWorks.bridgeBuilt ? 80 : 0
    const digXp = owned.starterWorks.bankCacheDug ? 30 : 0
    const prior = requiredPublicV14EarnedXpMinima(state)
    if (state.player.xp < prior.total + bridgeXp + digXp
      || state.player.skillXp.construction < prior.construction + bridgeXp
      || state.player.skillXp.excavation < prior.excavation + digXp) return null
    return owned
  } catch { return null }
}

export function validatePublicV15Progress(value: unknown, expectedSeed: string): boolean {
  return decodePublicV15Progress(value, expectedSeed) !== null
}
