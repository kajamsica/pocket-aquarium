import { createFreshPublicV14State, requiredPublicV14EarnedXpMinima,
  validatePublicV14State } from './publicWorldV14Validation'
import type { PublicV14State } from './publicWorldV14Snapshot'
import { publicWorldV15SuppressedStarterResourceIds } from './publicWorldV15StarterSites'
import { resolvePublicV16GreenwaySite } from './publicWorldV16GreenwaySites'
import type { PublicV16GreenwayWorks } from './publicWorldV16Migration'
import { publicV16StarterPoseValid } from './publicWorldV16StarterMovement'
import { starterCliffSupportAt } from './starterCliffMovement'

export type PublicV16Progress = Readonly<{
  state: PublicV14State
  greenwayWorks: PublicV16GreenwayWorks
}>

const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  try {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && Object.getPrototypeOf(value) === Object.prototype
      && Reflect.ownKeys(value).length === keys.length
      && keys.every((key) => {
        const field = Object.getOwnPropertyDescriptor(value, key)
        return !!field?.enumerable && Object.hasOwn(field, 'value')
      })
  } catch { return false }
}

function validIds(value: unknown, seed: string | undefined, kind: 'bridge' | 'ladder' | 'dig',
  limit: number): value is string[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
      || value.length > limit || Reflect.ownKeys(value).length !== value.length + 1) return false
    const keys = Reflect.ownKeys(value)
    const length = Object.getOwnPropertyDescriptor(value, 'length')
    if (keys[value.length] !== 'length' || length?.value !== value.length) return false
    for (let index = 0; index < value.length; index++) {
      const field = Object.getOwnPropertyDescriptor(value, String(index))
      if (keys[index] !== String(index) || !field?.enumerable
        || !Object.hasOwn(field, 'value')
        || typeof field.value !== 'string'
        || index > 0 && value[index - 1] >= field.value
        || (seed ? resolvePublicV16GreenwaySite(seed, field.value)?.kind !== kind
          : !new RegExp(`^works3:${kind}:(?:0|-?[1-9]\\d*)${kind === 'dig'
            ? ':(?:0|-?[1-9]\\d*)' : ''}$`).test(field.value))) return false
    }
    return true
  } catch { return false }
}

function validWorks(value: unknown, seed?: string): value is PublicV16GreenwayWorks {
  if (!exact(value, ['builtBridgeIds', 'builtLadderIds', 'dugTileIds'])) return false
  return validIds(value.builtBridgeIds, seed, 'bridge', 32)
    && validIds(value.builtLadderIds, seed, 'ladder', 32)
    && validIds(value.dugTileIds, seed, 'dig', 64)
}

/** A later frame, action or checkpoint cannot erase a completed work. */
export function preservesPublicV16GreenwayWorks(before: unknown, after: unknown,
  seed?: string): boolean {
  if (!validWorks(before, seed) || !validWorks(after, seed)) return false
  return before.builtBridgeIds.every((id) => after.builtBridgeIds.includes(id))
    && before.builtLadderIds.every((id) => after.builtLadderIds.includes(id))
    && before.dugTileIds.every((id) => after.dugTileIds.includes(id))
}

/** The actual pose is checked on v16 support; the v14 floor is only a core subproof. */
export function decodePublicV16Progress(value: unknown,
  expectedSeed: string): PublicV16Progress | null {
  try {
    if (!exact(value, ['state', 'greenwayWorks'])
      || typeof expectedSeed !== 'string' || !expectedSeed || expectedSeed.length > 128
      || !validWorks(value.greenwayWorks, expectedSeed)) return null
    const owned = structuredClone(value) as PublicV16Progress
    if (!validWorks(owned.greenwayWorks, expectedSeed)
      || owned.state?.seed !== expectedSeed) return null
    const state = owned.state
    const route = state.greenway?.routes?.find((entry) => entry.id === 'greenway_ladder') ?? null
    const context = { seed: expectedSeed, profile: state.generationProfile, route,
      built: state.greenway?.builtRouteIds?.includes('greenway_ladder') ?? false,
      greenwayWorks: owned.greenwayWorks }
    let core: PublicV14State = state
    if (state.movementOwner === 'greenway') {
      if (!publicV16StarterPoseValid(context, state.player.position,
        state.player.verticalVelocity)) return null
      const oldSupport = starterCliffSupportAt(context, state.player.position)
      if (!oldSupport) return null
      core = { ...state, player: { ...state.player,
        position: { ...state.player.position, y: oldSupport.floorY } } }
    }
    if (!validatePublicV14State(core, expectedSeed)) return null
    const canonical = createFreshPublicV14State(expectedSeed).greenway.resources
    const suppressed = publicWorldV15SuppressedStarterResourceIds(expectedSeed, canonical)
    const resources = new Map(state.greenway.resources.map((resource) => [resource.id, resource]))
    if (suppressed.some((id) => {
      const initial = canonical.find((resource) => resource.id === id)
      const current = resources.get(id)
      return !initial || !current || current.health !== initial.health
        || current.depleted !== initial.depleted
    })) return null
    for (const id of [...owned.greenwayWorks.builtBridgeIds,
      ...owned.greenwayWorks.builtLadderIds]) {
      const site = resolvePublicV16GreenwaySite(expectedSeed, id)
      if (!site || site.kind === 'dig'
        || site.blockingResourceIds.some((blockedId) =>
          !resources.get(blockedId)?.depleted || resources.get(blockedId)?.health !== 0)) return null
    }
    const prior = requiredPublicV14EarnedXpMinima(state)
    const construction = owned.greenwayWorks.builtBridgeIds.length * 80
      + owned.greenwayWorks.builtLadderIds.length * 60
    const excavation = owned.greenwayWorks.dugTileIds.length * 30
    if (state.player.xp < prior.total + construction + excavation
      || state.player.skillXp.construction < prior.construction + construction
      || state.player.skillXp.excavation < prior.excavation + excavation) return null
    return owned
  } catch { return null }
}
