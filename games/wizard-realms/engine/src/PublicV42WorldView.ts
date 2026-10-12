import { discoveryMaskHasTileId } from './domain/discoveryMask'
import { ironHallQuartermasterSite } from './domain/ironHallQuartermasterSite'
import { previewPublicV42RewardAction } from './domain/publicWorldV42RewardAction'
import type { PublicV42RewardProgress, PublicV42RewardWitness } from './domain/publicWorldV42RewardAction'
import { projectPublicV41IronHall } from './PublicV41WorldView'
import { publicV42IronHallRejectionHint } from './view/publicV42IronHallQuest'
import type { WizardViewProjection } from './view/contracts'

/** Discovery-gated presentation of the V42 writer's reward state and preflight. */
export function projectPublicV42IronHall(progress: PublicV42RewardProgress,
  carrier: WizardViewProjection): WizardViewProjection {
  const inherited = projectPublicV41IronHall(progress, carrier)
  const site = ironHallQuartermasterSite(progress)
  const revealed = !!site && discoveryMaskHasTileId(progress.state.discoveryMask, site.id)
  const preview = (kind: PublicV42RewardWitness['kind']) => {
    const rejection = previewPublicV42RewardAction(progress, { kind }).rejection
    return { rejection, hint: rejection ? publicV42IronHallRejectionHint(rejection) : null }
  }
  const reward = progress.ironHallReward
  return { ...inherited,
    v42QuartermasterSite: site && revealed
      ? { position: [site.center.x, site.center.y, site.center.z], revealed: true }
      : null,
    v42IronHall: {
      crestOutcome: reward.crestOutcome,
      questClaimed: reward.questClaimed,
      vestOwned: reward.vestOwned,
      vestEquipped: reward.vestEquipped,
      vestDurability: reward.vestDurability,
      spar: reward.spar,
      claim: preview('ironhall-claim/v1'),
      equip: preview('ironhall-vest-equip/v1'),
      unequip: preview('ironhall-vest-unequip/v1'),
      repair: preview('ironhall-vest-repair/v1'),
      sparStart: preview('ironhall-spar/v1'),
    },
  }
}
