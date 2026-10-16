import { discoveryMaskHasTileId } from './domain/discoveryMask'
import { ironHallQuartermasterSite } from './domain/ironHallQuartermasterSite'
import { previewPublicV42RewardActions } from './domain/publicWorldV42RewardAction'
import type { PublicV42RewardProgress, PublicV42RewardRejection } from './domain/publicWorldV42RewardAction'
import { projectPublicV41IronHall } from './PublicV41WorldView'
import { publicV42IronHallRejectionHint } from './view/publicV42IronHallQuest'
import type { WizardViewProjection } from './view/contracts'

/** Discovery-gated presentation of the V42 writer's reward state and preflight. */
export function projectPublicV42IronHall(progress: PublicV42RewardProgress,
  carrier: WizardViewProjection): WizardViewProjection {
  const inherited = projectPublicV41IronHall(progress, carrier)
  const site = ironHallQuartermasterSite(progress)
  const revealed = !!site && discoveryMaskHasTileId(progress.state.discoveryMask, site.id)
  const [claim, equip, unequip, repair, sparStart] = previewPublicV42RewardActions(progress, [
    'ironhall-claim/v1', 'ironhall-vest-equip/v1', 'ironhall-vest-unequip/v1',
    'ironhall-vest-repair/v1', 'ironhall-spar/v1',
  ])
  const preview = (rejection: PublicV42RewardRejection | null) => {
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
      claim: preview(claim.rejection), equip: preview(equip.rejection),
      unequip: preview(unequip.rejection), repair: preview(repair.rejection),
      sparStart: preview(sparStart.rejection),
    },
  }
}
