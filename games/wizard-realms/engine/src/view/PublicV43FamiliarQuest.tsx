import { discoveryMaskHasTileId } from '../domain/discoveryMask'
import { resolveSedgehornFamiliarSite } from '../domain/sedgehornFamiliarContent'
import type { PublicV43Head } from '../domain/publicWorldV43Snapshot'
import type { WorldTile } from '../domain/types'

export type PublicV43FamiliarQuestView = Readonly<{
  stage: PublicV43Head['familiar']['phase']
  eligible: boolean
  completedSteps: number
  routeChoice: PublicV43Head['familiar']['routeChoice']
  objective: string
  location: string
  targets: readonly Readonly<{ tileId: string; label: string; distanceMeters: number }>[]
  herbCount: number
  logCount: number
  careXp: number
  reward: string
}>

const TOTAL_STEPS = 7
const reward = '25 coins and 40 character XP at the keeper; Creature Care grows to 40 XP across the quest. The sedgehorn becomes a bonded companion, not a rideable mount.'

/** Presentation only. The caller must supply a head from the checked V43 runtime or store. */
export function projectPublicV43FamiliarQuest(head: PublicV43Head):
  PublicV43FamiliarQuestView | null {
  const site = resolveSedgehornFamiliarSite(head)
  if (!site) return null
  const { familiar, state } = head
  const revealed = (tile: WorldTile) => discoveryMaskHasTileId(state.discoveryMask, tile.id)
  const target = (tile: WorldTile, label: string) => revealed(tile) ? [{
    tileId: tile.id, label, distanceMeters: Math.round(Math.hypot(
      state.player.position.x - tile.center.x,
      state.player.position.z - tile.center.z)),
  }] : []
  const herbCount = state.player.inventory.filter((stack) => stack.itemId === 'marsh_herb')
    .reduce((sum, stack) => sum + stack.quantity, 0)
  const logCount = state.player.inventory.filter((stack) => stack.itemId === 'logs')
    .reduce((sum, stack) => sum + stack.quantity, 0)
  const base = { stage: familiar.phase, eligible: head.southbankReached,
    routeChoice: familiar.routeChoice,
    herbCount, logCount, careXp: familiar.creatureCareXp, reward }
  if (!head.southbankReached) return { ...base, completedSteps: 0,
    objective: 'Record the Windward Waystation south-bank crossing to unlock this lead.',
    location: 'Windward Waystation, at the dry south-bank exit', targets: [] }
  if (familiar.phase === 'search') return { ...base, completedSteps: 1,
    objective: revealed(site.tracks)
      ? 'Inspect the revealed sedgehorn tracks from within 3 m.'
      : 'Explore the dry Mireglass marsh edge near Bell Alder on foot to reveal tracks.',
    location: revealed(site.tracks) ? 'Revealed tracks' : 'Mireglass near Bell Alder',
    targets: target(site.tracks, 'Tracks') }
  if (familiar.phase === 'tracks') return { ...base, completedSteps: 2,
    objective: !revealed(site.careStation)
      ? 'Find and reveal the dry care station, then offer one marsh herb there.'
      : herbCount > 0
      ? 'Offer one carried marsh herb at the revealed care station, within 3 m.'
      : 'Gather one marsh herb, then offer it at the dry care station.',
    location: revealed(site.careStation) ? 'Revealed care station'
      : 'Explore the dry marsh edge to reveal the care station',
    targets: target(site.careStation, 'Care station') }
  if (familiar.phase === 'fed') return { ...base, completedSteps: 3,
    objective: `Choose a route: spend two logs on shelter (${logCount}/2 carried), or walk the longer supported dry approach.`,
    location: revealed(site.dryApproach)
      ? 'Shelter at the care station or the revealed dry-approach marker'
      : 'Shelter at the care station; explore dry ground to reveal the longer approach',
    targets: [...target(site.careStation, 'Shelter'),
      ...target(site.dryApproach, 'Dry approach')] }
  if (familiar.phase === 'route-ready') return { ...base, completedSteps: 4,
    objective: 'Begin the escort at the care station. Keep the sedgehorn on revealed, supported dry ground.',
    location: 'Revealed care station', targets: target(site.careStation, 'Care station') }
  if (familiar.phase === 'escort') return { ...base, completedSteps: 5,
    objective: familiar.waitReason === 'separated'
      ? 'The sedgehorn is waiting. Return near its last safe position before continuing.'
      : familiar.waitReason === 'unsafe_support'
        ? 'The sedgehorn cannot follow over this support. Rejoin it and choose revealed dry terrain.'
        : 'Lead the sedgehorn to the keeper on revealed dry ground, then record your return together. It cannot cross water or pits.',
    location: revealed(site.keeper) ? 'Revealed keeper' : 'Discover the keeper along the dry marsh edge',
    targets: target(site.keeper, 'Keeper') }
  if (familiar.phase === 'returned') return { ...base, completedSteps: 6,
    objective: 'Claim the one-time reward at the keeper from within 3 m.',
    location: 'Revealed keeper', targets: target(site.keeper, 'Keeper') }
  return { ...base, completedSteps: TOTAL_STEPS,
    objective: 'The familiar bond and care station are saved. The sedgehorn is a companion, not a mount.',
    location: 'Care station known', targets: target(site.careStation, 'Care station') }
}

export function PublicV43FamiliarQuestPanel({ head }: { head: PublicV43Head }) {
  const quest = projectPublicV43FamiliarQuest(head)
  if (!quest) return null
  return <section aria-label="The Lost Familiar quest" data-quest-stage={quest.stage}
    style={{ background: '#172b25', border: '1px solid #8ea87e', borderRadius: 12,
      color: '#f4efda', padding: 16, maxWidth: 440, font: '16px/1.5 system-ui' }}>
    <h2 style={{ margin: '0 0 8px' }}>The Lost Familiar</h2>
    <p style={{ margin: '0 0 8px' }}><strong>{quest.stage === 'claimed' ? 'Complete'
      : !quest.eligible ? 'Locked' : quest.stage === 'search' ? 'Available'
        : 'In progress'}</strong>
      {' · '}Step {quest.completedSteps} of {TOTAL_STEPS}</p>
    <progress aria-label="Lost Familiar progress" value={quest.completedSteps}
      max={TOTAL_STEPS} style={{ width: '100%' }} />
    <p><strong>Next:</strong> {quest.objective}</p>
    <p><strong>Where:</strong> {quest.location}</p>
    {quest.targets.length > 0 && <ul aria-label="Revealed quest markers">
      {quest.targets.map(({ tileId, label, distanceMeters }) =>
        <li key={tileId}>{label}: about {distanceMeters} m away</li>)}
    </ul>}
    {quest.stage === 'tracks' && <p>Marsh herbs carried: {quest.herbCount}/1</p>}
    {quest.stage === 'fed' && <p>Logs carried for shelter: {quest.logCount}/2</p>}
    {quest.routeChoice && <p>Chosen route: {quest.routeChoice === 'shelter'
      ? 'Shelter' : 'Dry approach'}</p>}
    <p>Creature Care XP: {quest.careXp}/40</p>
    <p><strong>{quest.stage === 'claimed' ? 'Claimed reward:' : 'Reward:'}</strong> {quest.reward}</p>
  </section>
}
