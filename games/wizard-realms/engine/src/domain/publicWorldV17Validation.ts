import { canonicalPublicV14StarterFacts, requiredPublicV14EarnedXpMinima,
  validatePublicV14State } from './publicWorldV14Validation'
import type { PublicV14State } from './publicWorldV14Snapshot'
import { publicWorldV15SuppressedStarterResourceIds } from './publicWorldV15StarterSites'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import type { PublicV17GreenwayWorks } from './publicWorldV17Migration'
import { publicV17StarterPoseValid, publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { starterCliffSupportAt } from './starterCliffMovement'

export type PublicV17Progress = Readonly<{
  state: PublicV14State
  greenwayWorks: PublicV17GreenwayWorks
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
    const legacy = new RegExp(`^works3:${kind}:(?:0|-?[1-9]\\d*)${kind === 'dig'
      ? ':(?:0|-?[1-9]\\d*)' : ''}$`)
    const free = kind === 'dig' ? null : new RegExp(
      `^works4:${kind}:greenway-${kind === 'bridge' ? 'creek' : 'north-cliff'}:(?:0|-?[1-9]\\d*)$`)
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
        || (seed ? resolvePublicV17GreenwaySite(seed, field.value)?.kind !== kind
          : !legacy.test(field.value) && !free?.test(field.value))) return false
    }
    return true
  } catch { return false }
}

function validWorks(value: unknown, seed?: string): value is PublicV17GreenwayWorks {
  if (!exact(value, ['builtBridgeIds', 'builtLadderIds', 'dugTileIds'])) return false
  return validIds(value.builtBridgeIds, seed, 'bridge', 32)
    && validIds(value.builtLadderIds, seed, 'ladder', 32)
    && validIds(value.dugTileIds, seed, 'dig', 64)
}

/** A later frame, action or checkpoint cannot erase a completed work. */
export function preservesPublicV17GreenwayWorks(before: unknown, after: unknown,
  seed?: string): boolean {
  if (!validWorks(before, seed) || !validWorks(after, seed)) return false
  return before.builtBridgeIds.every((id) => after.builtBridgeIds.includes(id))
    && before.builtLadderIds.every((id) => after.builtLadderIds.includes(id))
    && before.dugTileIds.every((id) => after.dugTileIds.includes(id))
}

/** The actual pose is checked on v17 support; the v14 floor is only a core subproof. */
export function decodePublicV17Progress(value: unknown,
  expectedSeed: string): PublicV17Progress | null {
  try {
    if (!exact(value, ['state', 'greenwayWorks'])
      || typeof expectedSeed !== 'string' || !expectedSeed || expectedSeed.length > 128
      || !validWorks(value.greenwayWorks, expectedSeed)) return null
    const owned = structuredClone(value) as PublicV17Progress
    if (!validWorks(owned.greenwayWorks, expectedSeed)
      || owned.state?.seed !== expectedSeed) return null
    const state = owned.state
    const canonicalFacts = canonicalPublicV14StarterFacts(expectedSeed)
    const route = state.greenway?.routes?.find((entry) => entry.id === 'greenway_ladder') ?? null
    const context = { seed: expectedSeed, profile: state.generationProfile, route,
      built: state.greenway?.builtRouteIds?.includes('greenway_ladder') ?? false,
      greenwayWorks: owned.greenwayWorks }
    let core: PublicV14State = state
    if (state.movementOwner === 'greenway') {
      if (!publicV17StarterPoseValid(context, state.player.position,
        state.player.verticalVelocity)) return null
      const oldSupport = starterCliffSupportAt(context, state.player.position)
      const projected = oldSupport
        ? { ...state.player.position, y: oldSupport.floorY }
        : canonicalFacts.playerStart
      core = { ...state, player: { ...state.player,
        position: projected, verticalVelocity: oldSupport
          ? state.player.verticalVelocity : 0 } }
    }
    if (!validatePublicV14State(core, expectedSeed)) return null
    const canonical = canonicalFacts.resources
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
      const site = resolvePublicV17GreenwaySite(expectedSeed, id)
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

/** A live jump may be shown, but must never become a durable checkpoint. */
export function decodePublicV17ViewProgress(value: unknown,
  expectedSeed: string): PublicV17Progress | null {
  const grounded = decodePublicV17Progress(value, expectedSeed)
  if (grounded) return grounded
  try {
    if (!exact(value, ['state', 'greenwayWorks'])) return null
    const live = structuredClone(value) as PublicV17Progress
    const state = live.state
    if (state?.movementOwner !== 'greenway') return null
    const position = state.player.position
    const velocity = state.player.verticalVelocity
    const support = publicV17StarterSupportAt({ seed: expectedSeed,
      profile: state.generationProfile,
      route: state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null,
      built: state.greenway.builtRouteIds.includes('greenway_ladder'),
      greenwayWorks: live.greenwayWorks }, position)
    // The frame solver starts at 5 m/s, caps falling at 50 m/s, and cannot
    // traverse a ladder while airborne. This envelope is view-only.
    if (!support || support.kind === 'ladder' || !Number.isFinite(position.y)
      || !Number.isFinite(support.floorY) || !Number.isFinite(velocity)
      || velocity === 0 || velocity > 5 || velocity < -50
      || position.y <= support.floorY || position.y - support.floorY > 8) return null
    const checked = decodePublicV17Progress({ ...live, state: { ...state,
      player: { ...state.player,
        position: { ...position, y: support.floorY }, verticalVelocity: 0 } } }, expectedSeed)
    return checked ? { ...checked, state: { ...checked.state, player: {
      ...checked.state.player, position: { ...checked.state.player.position, y: position.y },
      verticalVelocity: velocity } } } : null
  } catch { return null }
}
