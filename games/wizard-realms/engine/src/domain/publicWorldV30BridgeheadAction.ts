import { discoveryMaskHasTileId } from './discoveryMask'
import { decodePublicV29ActionProgress } from './publicWorldV29MiningTools'
import type { PublicV29Progress } from './publicWorldV29Migration'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { projectPublicV28Pose } from './publicWorldV28RiverSupport'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import type { PublicV30Progress } from './publicWorldV30Migration'
import type { Vec3 } from './types'

export type PublicV30BridgeheadWitness = Readonly<{
  kind: 'bridgehead-claim/v1'; bridgeId: string }>
export type PublicV30BridgeheadReward = 'basic-pick' | 'coins'
export type PublicV30BridgeheadRejection = 'invalid_progress' | 'invalid_site'
  | 'not_built' | 'undiscovered' | 'unavailable_here' | 'too_far'
  | 'already_claimed' | 'invalid_value'
export type PublicV30BridgeheadSite = Readonly<{ id: string; exit: Readonly<Vec3> }>
export type PublicV30BridgeheadPreview = Readonly<{
  site: PublicV30BridgeheadSite | null; rejection: PublicV30BridgeheadRejection | null;
  reward: PublicV30BridgeheadReward | null }>
export type PublicV30BridgeheadResult = Readonly<{
  progress: PublicV30Progress; reward: PublicV30BridgeheadReward; rejection?: never
}> | Readonly<{ progress?: never; reward?: never; rejection: PublicV30BridgeheadRejection }>

type Checked = Readonly<{ progress: PublicV30Progress; site: PublicV30BridgeheadSite;
  reward: PublicV30BridgeheadReward }> | Readonly<{
  rejection: PublicV30BridgeheadRejection; site: PublicV30BridgeheadSite | null }>

const inherited = ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
  riverBridgeIds, miningTools }: PublicV30Progress): PublicV29Progress =>
  ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs, riverBridgeIds, miningTools })

function checked(raw: PublicV30Progress, bridgeId: unknown): Checked {
  const reject = (rejection: PublicV30BridgeheadRejection,
    site: PublicV30BridgeheadSite | null = null): Checked => ({ rejection, site })
  try {
    if (raw?.claimedBridgeheadId !== null &&
      typeof raw?.claimedBridgeheadId !== 'string') return reject('invalid_progress')
    const progress = decodePublicV29ActionProgress(inherited(raw))
    if (!progress) return reject('invalid_progress')
    const { state } = progress
    const greenway = resolvePublicV17GreenwaySite(state.seed, bridgeId)
    const site = greenway?.kind === 'bridge' ? greenway
      : resolvePublicV28RiverBridge(state.seed, bridgeId)
    if (!site || site.kind !== 'bridge') return reject('invalid_site')
    const located = { id: site.id, exit: site.exit }
    const oldBridge = site.obstacle === 'greenway_creek'
    if (!(oldBridge ? progress.greenwayWorks.builtBridgeIds : progress.riverBridgeIds)
      .includes(site.id)) return reject('not_built', located)
    if (raw.claimedBridgeheadId !== null) return reject('already_claimed', located)
    if (state.movementOwner !== (oldBridge ? 'greenway' : 'streamed'))
      return reject('unavailable_here', located)
    // Works4 appends lateral footprint rows after its five anchor rows.
    const exitTileId = site.footprintTileIds[oldBridge ? 4 : site.footprintTileIds.length - 1]
    if (!discoveryMaskHasTileId(state.discoveryMask, exitTileId))
      return reject('undiscovered', located)
    const { player } = state, position = player.position
    const pose = projectPublicV28Pose(progress, progress.terrain, progress.riverBridgeIds)
    const grounded = !!pose && player.verticalVelocity === 0
      && (oldBridge ? (() => {
        const support = publicV17StarterSupportAt({ seed: state.seed,
          profile: state.generationProfile,
          route: state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
          built: state.greenway.builtRouteIds.includes('greenway_ladder'),
          greenwayWorks: progress.greenwayWorks }, position)
        return support?.kind === 'ground' && Math.abs(position.y - support.floorY) <= 1e-6
      })() : pose.support === 'terrain'
        && Math.abs(position.y - pose.carrier.floorY) <= 1e-6
        && Math.abs(pose.effective.floorY - pose.carrier.floorY) <= 1e-6)
    if (!grounded || position.z <= site.to.z
      || Math.hypot(position.x - site.exit.x, position.y - site.exit.y,
        position.z - site.exit.z) > 3) return reject('too_far', located)
    const reward: PublicV30BridgeheadReward = progress.miningTools.basicPickOwned
      ? 'coins' : 'basic-pick'
    if (!Number.isSafeInteger(state.eventSequence + 1)
      || reward === 'coins' && !Number.isSafeInteger(player.coins + 35))
      return reject('invalid_value', located)
    return { progress: { ...progress, claimedBridgeheadId: null }, site: located, reward }
  } catch { return reject('invalid_progress') }
}

/** Advisory only. The locked writer checks the same action again. */
export function previewPublicV30BridgeheadClaim(progress: PublicV30Progress,
  bridgeId: unknown): PublicV30BridgeheadPreview {
  const result = checked(progress, bridgeId)
  return { site: result.site, rejection: 'rejection' in result ? result.rejection : null,
    reward: 'reward' in result ? result.reward : null }
}

/** Pure, checked reward transition. The witness contains no client chosen reward. */
export function confirmPublicV30BridgeheadClaim(progress: PublicV30Progress,
  bridgeId: unknown): PublicV30BridgeheadResult {
  const result = checked(progress, bridgeId)
  if ('rejection' in result) return { rejection: result.rejection }
  const { state, miningTools } = result.progress
  const next: PublicV30Progress = { ...result.progress, claimedBridgeheadId: result.site.id,
    state: { ...state, eventSequence: state.eventSequence + 1,
      player: result.reward === 'coins' ? { ...state.player, coins: state.player.coins + 35 }
        : state.player },
    miningTools: result.reward === 'basic-pick'
      ? { ...miningTools, basicPickOwned: true } : miningTools }
  return decodePublicV29ActionProgress(inherited(next))
    ? { progress: next, reward: result.reward } : { rejection: 'invalid_value' }
}
